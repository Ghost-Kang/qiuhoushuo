/**
 * 战报生成主流程
 *
 * 输入：MatchData（赛事结构化事件流，从 API-Football 拿）
 * 输出：3 个风格的 Report，已通过 ReportSchema 校验
 *
 * 关键决策：
 * - 3 个风格并行调用（节省时间，单场 < 90s P95 目标）
 * - 任一风格失败重试 1 次，再失败用模板兜底（不能让用户看到空白）
 * - 所有输出落库前必走 contentSafety 检查
 * - 任何输出加 "AI 生成" 标识由前端在卡片/详情页显式标注
 */

import { callLLM, parseReport, defaultProvider, backupProvidersFor, type Report } from './llm';
import {
  buildReportUserPrompt,
  getReportSystemPrompt,
  type MatchData,
  type ReportStyle,
  PROMPT_VERSION,
} from './prompts';
import { addAIGCWatermark, contentSafetyCheck } from './safety';
import { notifyOpsFireAndForget } from './alerts';
import { trackServerEventGlobal } from './api/tracker';

export interface GeneratedReport extends Report {
  style: ReportStyle;
  promptVersion: string;
  /** 用于追溯 / debug */
  meta: {
    provider: string;
    model: string;
    latencyMs: number;
    inputTokens?: number;
    outputTokens?: number;
    safetyPassed: boolean;
  };
}

/**
 * 为显示层附 AIGC 合规标识（《生成式 AI 服务管理办法》§8 + AIGC 备案要求）。
 *
 * **关键设计**：不修改原 report 对象（reports 表落库数据保持纯净），仅返新对象。
 * **接入点**：路由层在 GET /api/report/[id] 等返用户响应前调用一次。
 * **被覆盖字段**：`ending` 段末尾追加 `【AI 生成内容】`；其他字段不动（避免污染 LLM 输出原文）。
 * **不接入卡片**：share-cards 模板已有 `brand: '超帧球后说 · AI 生成'` 字段独立标识。
 *
 * 5/14 W3 末发现 `addAIGCWatermark` 全仓 0 生产调用 = 合规缺口，本 helper 修复。
 */
export function applyAIGCFooterForDisplay(report: GeneratedReport): GeneratedReport {
  return {
    ...report,
    ending: addAIGCWatermark(report.ending, 'footer'),
  };
}

/**
 * 单风格生成。失败抛出，由 generateAllStyles 决定是否兜底。
 */
async function generateOneStyle(
  style: ReportStyle,
  match: MatchData,
): Promise<GeneratedReport> {
  const systemPrompt = getReportSystemPrompt(style);
  const userPrompt = buildReportUserPrompt(match);

  // 决赛日双 LLM:主 provider 跟 LLM_PROVIDER（默认 doubao），fallback 动态取互补的境内 provider。
  // 不能写死 ['deepseek']——否则 LLM_PROVIDER=deepseek 时主备同源、failover 失效（见 llm.backupProvidersFor）。
  const primaryProvider = defaultProvider();
  const fallbackProviders = backupProvidersFor(primaryProvider);

  let attempt = 0;
  let lastError: unknown;

  while (attempt < 2) {
    try {
      const result = await callLLM({
        caller: `report:${style}`,
        provider: primaryProvider,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: style === 'duanzi' ? 0.85 : 0.75,
        // 中文 token 编码密度高（1 字 ≈ 2-3 token），hardcore 设计 600-900 字 ≈ 1800-2700 token，
        // 加上 JSON 字段 key + tags 数组开销，2200 上限多次触发截断（W3 dry-run 6/15 失败）。提到 4000 给余量。
        maxTokens: 4000,
        responseFormat: 'json',
        // 决赛日双 LLM：主挂切互补境内 provider（doubao↔deepseek）
        fallback: fallbackProviders,
        // 参 tasks/TASK-69 / F36+N1: 默认 50s 是 Vercel free tier 60s HTTP cap 的遗留约束；
        // 腾讯云自托管无此限制,6/12 揭幕战实测 50s 会把 doubao 三风格并发掐死("aborted"),
        // 服务器侧用 REPORT_LLM_TIMEOUT_MS=120000 放宽。
        timeoutMs: reportLlmTimeoutMs(),
      });

      const parsed = parseReport(result.content);
      const safety = await contentSafetyCheck({
        text: [parsed.title, parsed.subtitle, parsed.lead, ...parsed.body, parsed.ending, parsed.share_quote].join('\n'),
        scenario: 'report',
      });
      if (!safety.pass) {
        throw new Error(`safety fail: ${safety.reason}`);
      }

      return {
        ...parsed,
        style,
        promptVersion: PROMPT_VERSION,
        meta: {
          provider: result.provider,
          model: result.meta.model,
          latencyMs: result.meta.latencyMs,
          inputTokens: result.usage?.input,
          outputTokens: result.usage?.output,
          safetyPassed: true,
        },
      };
    } catch (err) {
      lastError = err;
      attempt += 1;
      console.warn(`[report:${style}] attempt ${attempt} failed:`, (err as Error).message);
    }
  }

  throw new Error(`[report:${style}] 2 次重试均失败: ${(lastError as Error).message}`);
}

/**
 * 模板兜底：当 LLM 全部失败时使用。
 *
 * 设计目标：**看起来不像占位**。利用输入的 events / stats 拼装可读内容，让用户
 * 看到 "AI 生成简版" 也能拿到价值。三种风格分别走不同模板，保留差异化。
 *
 * 约束：所有字段必须满足 ReportSchema 长度（lead ≥ 40 / body[i] ≥ 60 / ending ≥ 40 / share_quote ≥ 8）。
 * 入库时 is_fallback=true，前端可视化角标 + 触发 P1 人工补救告警。
 */
/** 单次 LLM 调用超时；默认 50s(Vercel 遗留),自托管经 REPORT_LLM_TIMEOUT_MS 放宽。 */
export function reportLlmTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.REPORT_LLM_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed >= 10_000 && parsed <= 300_000 ? Math.floor(parsed) : 50_000;
}

/**
 * match 串两种形态并存（6/12 揭幕战 fallback 实测踩坑）：
 * - 手动 /api/report 路径："巴西 vs 西班牙"
 * - auto-report matchRowToMatchData："Mexico 2:0 South Africa"
 * 都要能拆出队名；拆不出时退化为整串 + "对手"，绝不输出 undefined。
 */
function parseTeams(matchLine: string): [string, string] {
  const byVs = matchLine.split(/\s*vs\s*/i);
  if (byVs.length === 2 && byVs[0]!.trim() && byVs[1]!.trim()) {
    return [byVs[0]!.trim(), byVs[1]!.trim()];
  }
  const byScore = /^(.+?)\s+\d+\s*[:-]\s*\d+\s+(.+)$/.exec(matchLine);
  if (byScore) return [byScore[1]!.trim(), byScore[2]!.trim()];
  return [matchLine.trim() || '主队', '对手'];
}

export function fallbackReport(style: ReportStyle, match: MatchData): GeneratedReport {
  const [home, away] = parseTeams(match.match);
  const [homeGoals, awayGoals] = parseScore(match.final_score);
  const winnerLine =
    homeGoals === awayGoals ? `${home} 与 ${away} 战成平局` :
    homeGoals > awayGoals ? `${home} 胜出` : `${away} 胜出`;

  const goals = (match.events ?? []).filter((e) => e.type === 'goal');
  const goalSummary = goals.length
    ? goals
        .map((e) => `第 ${e.minute} 分钟 ${e.player}（${e.team}）${e.assist ? `经 ${e.assist} 助攻` : ''}破门`)
        .join('；')
    : '本场进球数据暂未完整同步';

  const stats = match.stats ?? {};
  const possLine = stats.possession
    ? `${home} 控球率 ${stats.possession.home}%，${away} 控球率 ${stats.possession.away}%`
    : `控球率数据暂未同步`;
  const xgLine = stats.xg
    ? `预期进球（xG）${stats.xg.home} vs ${stats.xg.away}`
    : `xG 数据暂未同步`;
  const shotsLine = stats.shots
    ? `射门 ${stats.shots.home} 比 ${stats.shots.away}`
    : `射门数据暂未同步`;

  const base = {
    style,
    promptVersion: PROMPT_VERSION + '-fallback',
    tags: ['赛后', '战报', home, away, match.competition].filter(Boolean) as string[],
    meta: {
      provider: 'fallback',
      model: 'template',
      latencyMs: 0,
      safetyPassed: true,
    },
  };

  if (style === 'hardcore') {
    return {
      ...base,
      title: `${home} ${match.final_score} ${away}：数据速览`,
      subtitle: `${match.competition} · ${winnerLine}（深度复盘补录中）`,
      lead: `${match.competition}于 ${match.date} 落幕，${match.match} 终场比分 ${match.final_score}。${possLine}。${xgLine}。`,
      body: [
        `进球节奏：${goalSummary}。${shotsLine}，从射门数对比可大致判断双方进攻强度差异。完整战术拆解将由编辑团队在 30 分钟内补录。`,
        `本场关键事件还包括 ${countByType(match.events, 'yellow_card')} 张黄牌、${countByType(match.events, 'red_card')} 张红牌、${countByType(match.events, 'substitution')} 次换人。深度数据分析（阵型变化、压迫强度、传球网络变化、定位球质量、关键拦截位置）将由数据编辑团队在赛后 30 分钟内逐项补录到完整版战报中。`,
      ],
      ending: `数据已落档，详尽战术分析正在补录中。如需第一时间查看深度版本（含阵型演变图、xG shot map、传球网络），请关注本场战报更新提醒。`,
      share_quote: `${home} ${match.final_score} ${away} · xG 速览版`,
    };
  }

  if (style === 'duanzi') {
    return {
      ...base,
      title: `${home} 对 ${away}：${match.final_score} 这场你别走神`,
      subtitle: `${match.competition} · ${winnerLine}（段子版稍后送达）`,
      lead: `${match.match} 这场 ${match.final_score} 收官，${winnerLine}。AI 写手暂时罢工，先给你看个速览，正经段子半小时内补上。`,
      body: [
        `今儿这比赛说人话就是：${goalSummary}。${possLine}——但你也知道，控球率不能当饭吃。完整吐槽稍后送达。`,
        `${shotsLine}，${xgLine}。这数据搁哪儿吹都行，就等编辑把段子续上来。点关注不迷路，错过等四年。`,
      ],
      ending: `今儿先就这样，更香的版本马上补——梗、金句、对线素材，半小时内一次性给你打包齐。错过这场，下一场可能就轮到你队哭了。`,
      share_quote: `${home} ${match.final_score} ${away}：段子稍后送达`,
    };
  }

  // emotion
  return {
    ...base,
    title: `${home} 与 ${away}：${match.final_score} 的那 90 分钟`,
    subtitle: `${match.competition} · ${winnerLine}（完整故事补录中）`,
    lead: `${match.date} 这个夜晚，${match.match} 以 ${match.final_score} 落幕。每一粒进球都有它的故事，每一次失误都有它的代价。完整版稍后呈上。`,
    body: [
      `场上发生过的：${goalSummary}。${possLine}。这些只是数据。真正的故事——那个第几分钟的眼神、替补席上的那个拥抱、镜头切到看台的那一秒——正在被编辑慢慢写下来。`,
      `${shotsLine}，但比赛从来不只是关于射门。今晚有人第一次踢这种舞台，有人可能是最后一次。完整版本会告诉你他们的名字。`,
    ],
    ending: `这一夜的故事还没讲完。给我们 30 分钟，把那些数据背后的人——进球的、失误的、第一次站上这个舞台的——一个一个写出来。`,
    share_quote: `${home} ${match.final_score} ${away} · 故事稍后`,
  };
}

function parseScore(s: string): [number, number] {
  // 兼容 "2:1" / "2-1" / "2 vs 1" 等格式
  const m = s.match(/(\d+)\s*[:\-vs—–\s]+\s*(\d+)/i);
  if (!m) return [0, 0];
  return [Number(m[1]), Number(m[2])];
}

function countByType(events: MatchData['events'] | undefined, type: string): number {
  return (events ?? []).filter((e) => e.type === type).length;
}

/**
 * 战报落库行的形状（对应 web/db/schema.sql > reports 表）。
 * 由 persistReport() 构造，不暴露给路由层，路由只调 persistReport。
 */
export interface ReportRow {
  match_id: string;
  style: ReportStyle;
  title: string;
  subtitle: string | null;
  lead: string;
  body: string[];
  ending: string;
  share_quote: string;
  tags: string[];
  prompt_version: string;
  llm_provider: string;
  llm_model: string | null;
  is_fallback: boolean;
}

export function toReportRow(matchId: string, report: GeneratedReport): ReportRow {
  return {
    match_id: matchId,
    style: report.style,
    title: report.title,
    subtitle: report.subtitle ?? null,
    lead: report.lead,
    body: report.body,
    ending: report.ending,
    share_quote: report.share_quote,
    tags: report.tags ?? [],
    prompt_version: report.promptVersion,
    llm_provider: report.meta.provider,
    llm_model: report.meta.model ?? null,
    is_fallback: report.meta.provider === 'fallback',
  };
}

/**
 * 最小 supabase 客户端契约。我们只需要 from().upsert()，避免引入 supabase 类型对 lib 的依赖。
 *
 * 类型放松（W3 F3 finding）：
 * - `from` 接 `string`（非字面量 'reports'），让 supabase 严格 generic `from<keyof Schema['Tables']>` 也结构兼容
 * - `onConflict` 接 `string`（非字面量），允许调用方传任意列组合
 * - `upsert` 返 `PromiseLike`（不限制必须是 Promise），兼容 supabase 的 thenable PostgrestFilterBuilder
 *
 * 这样路由层可以直接 `await client.from('reports').upsert(...)`，supabase service client
 * 不需要宽松类型转换 —— 走 structural typing 直接兼容（参 `app/api/report/route.ts`）。
 */
export interface ReportPersistClient {
  from(table: string): {
    upsert(
      values: ReportRow[],
      options: { onConflict: string },
    ): PromiseLike<{ error: { message: string } | null }>;
  };
}

/**
 * 把 3 风格战报 upsert 到 reports 表（按 match_id+style 唯一）。
 *
 * - 失败抛错由路由层兜（返 500 + 告警），不在这里 swallow
 * - 不区分 fallback / 真生成，全部入库（fallback 由 is_fallback=true 标记 + 人工补救）
 * - human_reviewed / is_premium 不在这里写，由后台补录流程负责
 */
export async function persistReport(
  client: ReportPersistClient,
  matchId: string,
  reports: Record<ReportStyle, GeneratedReport>,
): Promise<{ inserted: number }> {
  const rows: ReportRow[] = (Object.keys(reports) as ReportStyle[]).map((style) =>
    toReportRow(matchId, reports[style]),
  );
  const { error } = await client.from('reports').upsert(rows, { onConflict: 'match_id,style' });
  if (error) {
    throw new Error(`persistReport upsert failed: ${error.message}`);
  }
  return { inserted: rows.length };
}

/**
 * 主入口：并行生成 3 风格。任一风格失败用兜底。
 * 返回 Map<style, GeneratedReport>
 */
export async function generateAllStyles(
  match: MatchData,
): Promise<Record<ReportStyle, GeneratedReport>> {
  const styles: ReportStyle[] = ['hardcore', 'duanzi', 'emotion'];
  const results = await Promise.allSettled(
    styles.map((s) => generateOneStyle(s, match)),
  );

  const out = {} as Record<ReportStyle, GeneratedReport>;
  results.forEach((r, i) => {
    const style = styles[i]!;
    if (r.status === 'fulfilled') {
      out[style] = r.value;
    } else {
      const reason = (r.reason as Error)?.message ?? String(r.reason);
      console.error(`[report] ${style} fallback used:`, reason);
      out[style] = fallbackReport(style, match);
      // E041 report_fallback_triggered
      trackServerEventGlobal({
        eventId: 'E041',
        properties: { match: match.match, competition: match.competition, date: match.date, style, reason },
      });
      // PROCESS.md §5 L4: 自动兜底 = 半事故，运营 30min 内人工补救
      notifyOpsFireAndForget(
        {
          severity: 'P1',
          title: `战报兜底触发 · ${style}`,
          body:
            `**比赛**：${match.match}（${match.competition}）\n` +
            `**日期**：${match.date}\n` +
            `**比分**：${match.final_score}\n` +
            `**失败原因**：${reason}\n\n` +
            `已用模板版兜底，请运营 30 min 内人工补一篇 ${style} 战报，覆盖该 style 行。`,
          tags: ['report-fallback', style],
        },
        {
          dedupKey: `report-fallback:${style}`,
          dedupWindowMs: 5 * 60 * 1000,
        },
      );
    }
  });
  return out;
}

/**
 * 一步到位：生成 3 风格 + 落库。
 *
 * 失败语义（关键）：
 * - generateAllStyles **从不抛**（内部用 fallbackReport 兜底）；调用方拿到的 reports **永远不为 null**
 * - persistReport 失败时**仍返已生成的 reports**（用户不至于看不到内容）+ fire-and-forget P0 告警
 * - 返回 `{ reports, persisted, persistError? }` 让调用方知道落库状态（用于日志 / 响应）
 *
 * Codex 路由层（H4 POST /api/report、TASK-09 §2.2 预生成）应优先用本 helper，避免重复"生成 + 落库 + 告警"三段式样板代码。
 */
export interface GenerateAndPersistResult {
  reports: Record<ReportStyle, GeneratedReport>;
  persisted: boolean;
  /** persisted=false 时存在；包含 upsert 错误原因 */
  persistError?: string;
}

export async function generateAllStylesWithPersist(
  client: ReportPersistClient,
  matchId: string,
  match: MatchData,
): Promise<GenerateAndPersistResult> {
  const reports = await generateAllStyles(match);
  try {
    await persistReport(client, matchId, reports);
    return { reports, persisted: true };
  } catch (err) {
    const persistError = (err as Error).message;
    notifyOpsFireAndForget(
      {
        severity: 'P0',
        title: `report 落库失败 · ${match.match}`,
        body:
          `**matchId**：${matchId}\n` +
          `**比赛**：${match.match}（${match.competition}）\n` +
          `**日期**：${match.date}\n` +
          `**比分**：${match.final_score}\n` +
          `**错误**：${persistError}\n\n` +
          `已生成 3 风格内容但落库失败。用户能看到响应内容，但数据库无记录 → 30 min 内必须人工补录或回放本次请求。`,
        tags: ['report-persist', 'p0'],
      },
      {
        dedupKey: `report-persist-fail:${matchId}`,
        dedupWindowMs: 5 * 60 * 1000,
      },
    );
    return { reports, persisted: false, persistError };
  }
}
