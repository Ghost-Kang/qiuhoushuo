import { describe, expect, it } from 'vitest';
import { fetchFixturePlayers, parsePlayersResponse } from '@/lib/api-football/player-stats';

const arg = {
  team: { id: 10, name: 'Argentina' },
  players: [
    { player: { name: 'L. Messi' }, statistics: [{ games: { minutes: 90, position: 'F', rating: '9.6' }, goals: { total: 2, assists: 1, saves: null } }] },
    { player: { name: 'Á. Di María' }, statistics: [{ games: { minutes: 75, position: 'M', rating: '8.1' }, goals: { total: 0, assists: 1 } }] },
    { player: { name: 'E. Martínez' }, statistics: [{ games: { minutes: 90, position: 'G', rating: '7.0' }, goals: { total: null, assists: 0, saves: 4 } }] },
    { player: { name: '替补' }, statistics: [{ games: { minutes: 0, position: 'M', rating: null }, goals: { total: null, assists: null } }] }, // 未出场 → 过滤
  ],
};
const fra = {
  team: { id: 20, name: 'France' },
  players: [
    { player: { name: 'K. Mbappé' }, statistics: [{ games: { minutes: 90, position: 'F', rating: '8.9' }, goals: { total: 1, assists: 0 } }] },
    { player: { name: 'A. Tchouaméni' }, statistics: [{ games: { minutes: 90, position: 'M', rating: '7.5' }, goals: { total: 0, assists: 0 } }] },
  ],
};

describe('parsePlayersResponse', () => {
  it('按 team id 映射、过滤未出场、按评分降序、派生全场最佳', () => {
    const ps = parsePlayersResponse([arg, fra], 10, 20);
    expect(ps.motm).toEqual({ name: 'L. Messi', team: 'Argentina', rating: 9.6, position: '前锋' });
    expect(ps.home.map((l) => l.name)).toEqual(['L. Messi', 'Á. Di María', 'E. Martínez']); // 替补(0min)过滤,按评分降序
    expect(ps.home[0]).toMatchObject({ rating: 9.6, position: '前锋', goals: 2, assists: 1, minutes: 90 });
    expect(ps.home[2]).toMatchObject({ name: 'E. Martínez', position: '门将', goals: 0 }); // goals.total null → 0
    expect(ps.away[0]).toMatchObject({ name: 'K. Mbappé', rating: 8.9 });
  });

  it('team id 反转 → 主客对调', () => {
    const ps = parsePlayersResponse([arg, fra], 20, 10);
    expect(ps.home[0]!.name).toBe('K. Mbappé');
    expect(ps.away[0]!.name).toBe('L. Messi');
  });

  it('一侧 team id 命中即正确二分(/fixtures/players 不保证主队在前,另一侧 id 缺失也不对调)', () => {
    // response 顺序 [France, Argentina],只给有效 homeTeamId=10(阿根廷)、awayTeamId=null
    const ps = parsePlayersResponse([fra, arg], 10, null);
    expect(ps.home[0]!.name).toBe('L. Messi'); // 主队=阿根廷,不被退回顺序对调
    expect(ps.away[0]!.name).toBe('K. Mbappé');
    expect(ps.motm!.team).toBe('Argentina');
  });

  it('在场但 rating=null 的球员保留、排末位、不入选 MOTM', () => {
    const a = { team: { id: 1, name: 'A' }, players: [
      { player: { name: 'Rated' }, statistics: [{ games: { minutes: 90, position: 'M', rating: '7.5' } }] },
      { player: { name: 'NoRating' }, statistics: [{ games: { minutes: 70, position: 'D', rating: null } }] }, // 在场无评分
    ] };
    const b = { team: { id: 2, name: 'B' }, players: [{ player: { name: 'X' }, statistics: [{ games: { minutes: 90, position: 'M', rating: '7.0' } }] }] };
    const ps = parsePlayersResponse([a, b], 1, 2);
    expect(ps.home.map((l) => l.name)).toEqual(['Rated', 'NoRating']); // null 评分保留但排末位
    expect(ps.home[1]!.rating).toBeNull();
    expect(ps.motm!.name).toBe('Rated'); // null 评分不入选 MOTM
  });

  it('MOTM 中间档:无人 ≥45 分钟时,取 ≥30 分钟里评分最高', () => {
    const a = { team: { id: 1, name: 'A' }, players: [{ player: { name: 'Cameo35' }, statistics: [{ games: { minutes: 35, position: 'F', rating: '8.5' } }] }] };
    const b = { team: { id: 2, name: 'B' }, players: [{ player: { name: 'Cameo40' }, statistics: [{ games: { minutes: 40, position: 'M', rating: '8.0' } }] }] };
    expect(parsePlayersResponse([a, b], 1, 2).motm!.name).toBe('Cameo35');
  });

  it('全场最佳优先 ≥45 分钟;无评分/不足两队 → null/空', () => {
    // 高分但只踢 20 分钟的替补不该当选(放宽规则前先看 ≥45)
    const sub = { team: { id: 1, name: 'A' }, players: [{ player: { name: 'Cameo' }, statistics: [{ games: { minutes: 20, position: 'F', rating: '9.9' } }] }] };
    const starter = { team: { id: 2, name: 'B' }, players: [{ player: { name: 'Starter' }, statistics: [{ games: { minutes: 90, position: 'M', rating: '8.0' } }] }] };
    expect(parsePlayersResponse([sub, starter], 1, 2).motm!.name).toBe('Starter');
    expect(parsePlayersResponse(null)).toEqual({ motm: null, home: [], away: [] });
    expect(parsePlayersResponse([arg])).toEqual({ motm: null, home: [], away: [] });
  });
});

describe('fetchFixturePlayers', () => {
  it('打 /fixtures/players?fixture= 并解析', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: RequestInfo | URL) => {
      calls.push(String(url));
      return Response.json({ errors: [], results: 2, response: [arg, fra] });
    }) as typeof fetch;
    const ps = await fetchFixturePlayers(1489410, 10, 20, { apiKey: 'k', fetchImpl });
    expect(calls[0]).toContain('/fixtures/players?fixture=1489410');
    expect(ps.motm!.name).toBe('L. Messi');
  });
});
