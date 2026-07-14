import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CARD_RENDER_CACHE_VERSION, type CardStorageClient } from './card-storage';
import { matchRowToMatchData, type MatchRow } from './auto-report';
import { detectReferenceImageType } from './laoli-video';
import type { LaoliVideoReport } from './laoli-video-script';
import type { ReportStyle } from '../prompts';

interface QueryResult {
  data: unknown;
  error?: { message: string } | null;
}

interface QueryBuilder extends PromiseLike<QueryResult> {
  select(columns: string): QueryBuilder;
  eq(column: string, value: string): QueryBuilder;
  maybeSingle(): PromiseLike<QueryResult>;
}

export interface LaoliVideoContextDb {
  from(table: string): QueryBuilder;
}

interface ReportContextRow extends LaoliVideoReport {
  id: string;
}

export async function loadLaoliVideoContext(
  db: LaoliVideoContextDb,
  storage: CardStorageClient,
  matchId: string,
): Promise<{
  match: ReturnType<typeof matchRowToMatchData>;
  reports: Partial<Record<ReportStyle, LaoliVideoReport>>;
  referenceImage: Buffer;
  referenceImageType: ReturnType<typeof detectReferenceImageType>;
  briefImage?: Buffer;
  bgm?: Buffer;
} | null> {
  const { data: matchData, error: matchError } = await db
    .from('matches')
    .select('id,external_id,competition,home_team,away_team,home_score,away_score,match_date,status,stats,events')
    .eq('id', matchId)
    .maybeSingle();
  if (matchError) throw new Error(`[laoli-video] match query failed: ${matchError.message}`);
  if (!isMatchRow(matchData)) return null;

  const { data: reportData, error: reportError } = await db
    .from('reports')
    .select('id,style,title,subtitle,lead,share_quote')
    .eq('match_id', matchId);
  if (reportError) throw new Error(`[laoli-video] report query failed: ${reportError.message}`);
  const rows = Array.isArray(reportData) ? reportData.filter(isReportRow) : [];
  if (rows.length === 0) return null;
  const reports: Partial<Record<ReportStyle, LaoliVideoReport>> = {};
  for (const row of rows) reports[row.style] = row;

  const referenceImage = await readFile(path.join(process.cwd(), 'public', 'persona', 'laoli-ref.png'));
  const duanzi = rows.find((row) => row.style === 'duanzi') ?? rows[0];
  const briefKey = duanzi
    ? `cards/${CARD_RENDER_CACHE_VERSION}/${duanzi.id}/brief-full-xhs.png`
    : null;
  const briefImage = briefKey ? (await storage.getBytes?.(briefKey)) ?? undefined : undefined;
  const bgm = await readFile(path.join(process.cwd(), 'assets', 'bgm', 'heat.wav')).catch(() => undefined);
  return {
    match: matchRowToMatchData(matchData),
    reports,
    referenceImage,
    referenceImageType: detectReferenceImageType(referenceImage),
    briefImage,
    bgm,
  };
}

/**
 * reel 专用上下文:只查 match+reports + 取 reportId(duanzi.id)+ brief 卡字节。
 * **不读** cwd/public 的老李参考图(standalone cwd=/app·该路径不存在·readFile 必错)——
 * 老李 PiP 由 seedance avatar 走 https refImageUrl 取(同 lean 路径),不依赖本地文件。
 */
export async function loadLaoliReelContext(
  db: LaoliVideoContextDb,
  storage: CardStorageClient,
  matchId: string,
): Promise<{
  match: ReturnType<typeof matchRowToMatchData>;
  reports: Partial<Record<ReportStyle, LaoliVideoReport>>;
  reportId: string;
  briefImage?: Buffer;
} | null> {
  const { data: matchData, error: matchError } = await db
    .from('matches')
    .select('id,external_id,competition,home_team,away_team,home_score,away_score,match_date,status,stats,events')
    .eq('id', matchId)
    .maybeSingle();
  if (matchError) throw new Error(`[laoli-reel] match query failed: ${matchError.message}`);
  if (!isMatchRow(matchData)) return null;

  const { data: reportData, error: reportError } = await db
    .from('reports')
    .select('id,style,title,subtitle,lead,share_quote')
    .eq('match_id', matchId);
  if (reportError) throw new Error(`[laoli-reel] report query failed: ${reportError.message}`);
  const rows = Array.isArray(reportData) ? reportData.filter(isReportRow) : [];
  if (rows.length === 0) return null;
  const reports: Partial<Record<ReportStyle, LaoliVideoReport>> = {};
  for (const row of rows) reports[row.style] = row;

  const duanzi = rows.find((row) => row.style === 'duanzi') ?? rows[0]!;
  const reportId = duanzi.id;
  const briefImage = (await storage.getBytes?.(`cards/${CARD_RENDER_CACHE_VERSION}/${reportId}/brief-full-xhs.png`)) ?? undefined;
  return { match: matchRowToMatchData(matchData), reports, reportId, briefImage };
}

function isMatchRow(value: unknown): value is MatchRow {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string'
    && typeof row.competition === 'string'
    && typeof row.home_team === 'string'
    && typeof row.away_team === 'string'
    && typeof row.match_date === 'string'
    && typeof row.status === 'string';
}

function isReportRow(value: unknown): value is ReportContextRow {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string'
    && (row.style === 'hardcore' || row.style === 'duanzi' || row.style === 'emotion')
    && typeof row.title === 'string'
    && typeof row.lead === 'string'
    && typeof row.share_quote === 'string';
}
