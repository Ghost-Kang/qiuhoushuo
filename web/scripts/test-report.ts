/**
 * 战报生成本地验证脚本
 *
 * 用途：
 * - W1 跑通 LLM 接入（豆包 / DeepSeek / Claude dev）
 * - W1 末做 5 人评分（5 篇样例），评分 ≥ 3.0/5 才能进 W2
 * - 任何 prompt 调整后回归
 *
 * 使用：
 *   pnpm tsx scripts/test-report.ts
 *   pnpm tsx scripts/test-report.ts --provider=deepseek
 */

import { generateAllStyles } from '../lib/report';
import type { MatchData } from '../lib/prompts';

const SAMPLE_MATCH: MatchData = {
  match: '巴西 vs 西班牙',
  competition: '国际大赛小组赛 G 组',
  date: '2026-06-22',
  final_score: '2-1',
  halftime_score: '1-1',
  events: [
    { minute: 23, type: 'goal', team: 'BRA', player: '维尼修斯', description: '禁区内连过两人后低射远角' },
    { minute: 41, type: 'goal', team: 'ESP', player: '亚马尔', description: '禁区外远射打入死角' },
    { minute: 78, type: 'goal', team: 'BRA', player: '罗德里戈', assist: '维尼修斯', description: '反击中冷静推射' },
    { minute: 87, type: 'key_save', team: 'ESP', player: '19 岁中后卫', description: '门线解围' },
    { minute: 89, type: 'yellow_card', team: 'ESP', player: '罗德里' },
  ],
  stats: {
    possession: { home: 42, away: 58 },
    shots: { home: 11, away: 14 },
    shots_on_target: { home: 5, away: 4 },
    xg: { home: 1.9, away: 1.4 },
    pass_accuracy: { home: 84, away: 89 },
    corners: { home: 5, away: 7 },
  },
  key_players: [
    { name: '维尼修斯', team: 'BRA', rating: 9.2, highlights: ['1 球 1 助攻', '5 次成功过人'] },
    { name: '亚马尔', team: 'ESP', rating: 8.5, highlights: ['1 球', '3 次关键传球'] },
  ],
};

(async () => {
  console.log('━━━ 球后说 · 战报生成本地验证 ━━━');
  console.log(`Provider: ${process.env.LLM_PROVIDER || 'doubao'}`);
  console.log(`Match: ${SAMPLE_MATCH.match} ${SAMPLE_MATCH.final_score}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const t0 = Date.now();
  const reports = await generateAllStyles(SAMPLE_MATCH);
  const totalMs = Date.now() - t0;

  for (const [style, r] of Object.entries(reports)) {
    console.log(`\n━━━ ${style.toUpperCase()} ${r.meta.provider === 'fallback' ? '(FALLBACK!)' : ''} ━━━`);
    console.log(`Title:       ${r.title}`);
    console.log(`Subtitle:    ${r.subtitle}`);
    console.log(`Lead:        ${r.lead}`);
    console.log(`Body[0]:     ${r.body[0]?.slice(0, 80)}...`);
    console.log(`Quote:       ${r.share_quote}`);
    console.log(`Tags:        ${r.tags.join(', ')}`);
    console.log(`Meta:        ${r.meta.provider} · ${r.meta.model} · ${r.meta.latencyMs}ms`);
    console.log(`Tokens:      in=${r.meta.inputTokens} out=${r.meta.outputTokens}`);
  }

  console.log(`\n━━━ 总耗时 ${totalMs}ms ━━━\n`);
})();
