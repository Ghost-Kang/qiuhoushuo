import { describe, expect, it } from 'vitest';
import { fetchFixtureEvents, parseEventsResponse } from '@/lib/api-football/events';

const raw = (over: Record<string, unknown> = {}) => ({
  time: { elapsed: 28, extra: null },
  team: { name: 'Mexico' },
  player: { name: 'R. Jiménez' },
  assist: { name: null },
  type: 'Goal',
  detail: 'Normal Goal',
  ...over,
});

describe('parseEventsResponse', () => {
  it('maps goals with assist and stoppage-time minutes', () => {
    const events = parseEventsResponse([
      raw({ assist: { name: 'H. Lozano' } }),
      raw({ time: { elapsed: 90, extra: 4 }, detail: 'Penalty' }),
    ]);
    expect(events[0]).toEqual({ minute: 28, type: 'goal', team: 'Mexico', player: 'R. Jiménez', assist: 'H. Lozano' });
    expect(events[1]).toMatchObject({ minute: 94, type: 'penalty' });
  });

  it('maps cards/subs/own goals + 保留争议事件(点球射失/VAR),丢弃畸形', () => {
    const events = parseEventsResponse([
      raw({ type: 'Card', detail: 'Yellow Card' }),
      raw({ type: 'Card', detail: 'Red Card' }),
      raw({ type: 'subst', detail: 'Substitution 1' }),
      raw({ detail: 'Own Goal' }),
      raw({ detail: 'Missed Penalty' }),
      raw({ type: 'Var', detail: 'Goal cancelled' }),
      { type: 'Goal' }, // 无 time/team → 丢弃
      null,
    ]);
    expect(events.map((e) => e.type)).toEqual(['yellow_card', 'red_card', 'substitution', 'goal', 'penalty_missed', 'var']);
    expect(events[3]!.description).toBe('乌龙球');
    expect(events[5]).toMatchObject({ type: 'var', description: '进球被 VAR 吹无效' });
  });

  it('VAR 细分中文看点', () => {
    const types = parseEventsResponse([
      raw({ type: 'Var', detail: 'Penalty confirmed' }),
      raw({ type: 'Var', detail: 'Penalty cancelled' }),
      raw({ type: 'Var', detail: 'Goal Disallowed - offside' }),
      raw({ type: 'Var', detail: 'Something else' }),
    ]).map((e) => e.description);
    expect(types).toEqual(['VAR 改判点球', 'VAR 取消点球', '进球被 VAR 吹无效', 'VAR 介入改判']);
  });

  it('returns [] for non-array payloads', () => {
    expect(parseEventsResponse(null)).toEqual([]);
    expect(parseEventsResponse({})).toEqual([]);
  });
});

describe('fetchFixtureEvents', () => {
  it('calls /fixtures/events with the fixture id', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: RequestInfo | URL) => {
      calls.push(String(url));
      return Response.json({ errors: {}, results: 1, response: [raw()] });
    }) as typeof fetch;
    const events = await fetchFixtureEvents(1489369, { apiKey: 'k', fetchImpl });
    expect(calls[0]).toContain('/fixtures/events?fixture=1489369');
    expect(events).toHaveLength(1);
  });
});
