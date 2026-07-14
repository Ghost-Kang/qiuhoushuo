/**
 * /fixtures/* 多端点(statistics / players)响应里「两队条目」→ 主客二分的统一逻辑。
 *
 * 关键:/fixtures/* **不保证主队在前**(只有 lineups 经验上主队在前)。所以主客对齐必须靠 team id,
 * 且**任一侧 id 命中即可正确二分**(取另一条当对家)——照 lineups.ts pickFormations 的正确范式。
 * 旧实现「两侧各自 find + 任一未命中就整体退回顺序」会在一侧 id 缺失/陈旧时把主客整体对调(评审报修)。
 */
export function pickHomeAway<T extends { team?: { id?: number } }>(
  entries: T[],
  homeTeamId?: number | null,
  awayTeamId?: number | null,
): [T | undefined, T | undefined] {
  if (entries.length < 2) return [entries[0], entries[1]];
  let home = homeTeamId != null ? entries.find((e) => e?.team?.id === homeTeamId) : undefined;
  let away = awayTeamId != null ? entries.find((e) => e?.team?.id === awayTeamId) : undefined;
  // 任一侧命中即取另一条当对家;同 id 退化(home===away)也取另一条,避免一队算两遍、另一队丢失。
  if (home && (!away || away === home)) away = entries.find((e) => e !== home);
  else if (away && !home) home = entries.find((e) => e !== away);
  // 都没命中 → 退回响应顺序(0=主、1=客)。
  if (!home || !away) return [entries[0], entries[1]];
  return [home, away];
}
