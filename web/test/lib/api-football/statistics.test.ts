import { describe, expect, it } from 'vitest';
import { fetchFixtureStatistics, parseStatisticsResponse } from '@/lib/api-football/statistics';

const turkey = {
  team: { id: 10, name: 'Turkey' },
  statistics: [
    { type: 'Ball Possession', value: '45%' },
    { type: 'Total Shots', value: 12 },
    { type: 'Shots on Goal', value: 5 },
    { type: 'Corner Kicks', value: 6 },
    { type: 'Fouls', value: 14 },
    { type: 'Offsides', value: 2 },
    { type: 'Passes %', value: '82%' },
    { type: 'Goalkeeper Saves', value: 4 },
    { type: 'Red Cards', value: null }, // 未知键 → 丢弃
    { type: 'expected_goals', value: '1.8' },
  ],
};
const usa = {
  team: { id: 20, name: 'USA' },
  statistics: [
    { type: 'Ball Possession', value: '55%' },
    { type: 'Total Shots', value: 9 },
    { type: 'Shots on Goal', value: 3 },
    { type: 'Corner Kicks', value: 4 },
    { type: 'Fouls', value: 10 },
    { type: 'Offsides', value: 1 },
    { type: 'Passes %', value: '88%' },
    { type: 'Goalkeeper Saves', value: 3 },
    { type: 'expected_goals', value: '1.2' },
  ],
};

describe('parseStatisticsResponse', () => {
  it('按 team id 映射主客队,解析百分号/数字,丢弃 null 与未知项', () => {
    const stats = parseStatisticsResponse([turkey, usa], 10, 20);
    expect(stats).toEqual({
      possession: { home: 45, away: 55 },
      shots: { home: 12, away: 9 },
      shots_on_target: { home: 5, away: 3 },
      corners: { home: 6, away: 4 },
      fouls: { home: 14, away: 10 },
      offsides: { home: 2, away: 1 },
      pass_accuracy: { home: 82, away: 88 },
      saves: { home: 4, away: 3 },
      xg: { home: 1.8, away: 1.2 },
    });
  });

  it('team id 反转 → 主客对调', () => {
    const stats = parseStatisticsResponse([turkey, usa], 20, 10);
    expect(stats.possession).toEqual({ home: 55, away: 45 });
    expect(stats.shots).toEqual({ home: 9, away: 12 });
  });

  it('无 team id 时退回响应顺序(0=主,1=客)', () => {
    const stats = parseStatisticsResponse([turkey, usa]);
    expect(stats.possession).toEqual({ home: 45, away: 55 });
  });

  it('一侧 team id 命中即正确二分(响应非主队在前、另一侧 id 缺失也不对调)', () => {
    // 响应顺序 [usa, turkey],只给有效 homeTeamId=10(土耳其)、awayTeamId=null
    const stats = parseStatisticsResponse([usa, turkey], 10, null);
    expect(stats.possession).toEqual({ home: 45, away: 55 }); // 主队=土耳其(45),不被退回顺序对调
  });

  it('某项只有一方有值则不成对,不落该项', () => {
    const stats = parseStatisticsResponse([
      { team: { id: 1 }, statistics: [{ type: 'Total Shots', value: 10 }, { type: 'Corner Kicks', value: 5 }] },
      { team: { id: 2 }, statistics: [{ type: 'Total Shots', value: 8 }] }, // 无角球
    ], 1, 2);
    expect(stats.shots).toEqual({ home: 10, away: 8 });
    expect(stats.corners).toBeUndefined();
  });

  it('非数组 / 不足两队 → 空对象', () => {
    expect(parseStatisticsResponse(null)).toEqual({});
    expect(parseStatisticsResponse([turkey])).toEqual({});
    expect(parseStatisticsResponse({})).toEqual({});
  });
});

describe('fetchFixtureStatistics', () => {
  it('打 /fixtures/statistics?fixture= 并按 team id 映射', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: RequestInfo | URL) => {
      calls.push(String(url));
      return Response.json({ errors: {}, results: 2, response: [turkey, usa] });
    }) as typeof fetch;
    const stats = await fetchFixtureStatistics(1489369, 10, 20, { apiKey: 'k', fetchImpl });
    expect(calls[0]).toContain('/fixtures/statistics?fixture=1489369');
    expect(stats.possession).toEqual({ home: 45, away: 55 });
  });
});
