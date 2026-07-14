/**
 * F62:auto-report 战报成功后连带补镜头配图。
 * 6/12 揭幕战实测缺口——战报自动化了,生图还停在 admin 手动触发,真实比赛镜头卡全员无图。
 */
import { describe, expect, it, vi } from 'vitest';
import { enrichMatchWithEvents, generateMissingHighlightImages, type MatchRow } from '@/lib/api/auto-report';
import { buildHighlightImageKey, createMockHighlightImageProvider } from '@/lib/api/highlight-image';

function row(over: Partial<MatchRow> = {}): MatchRow {
  return {
    id: 'match-x',
    competition: '国际大赛',
    home_team: 'Mexico',
    away_team: 'South Africa',
    home_score: 2,
    away_score: 0,
    match_date: '2026-06-11T19:00:00Z',
    status: 'finished',
    stats: { shots: { home: 14, away: 5 }, xg: { home: 2.1, away: 0.4 } },
    events: [],
    ...over,
  };
}

describe('generateMissingHighlightImages', () => {
  it('generates one image per derived moment and stores under highlight-images keys', async () => {
    const put = vi.fn(async (key: string) => `https://cdn.example.com/${key}`);
    const storage = { exists: vi.fn(async () => null), put };
    const result = await generateMissingHighlightImages(row(), {
      provider: createMockHighlightImageProvider(),
      storage,
    });
    expect(result).toEqual({ generated: 3, skipped: 0, failed: 0 });
    const keys = put.mock.calls.map((c) => c[0] as string);
    expect(keys).toHaveLength(3);
    expect(keys.every((k) => k.startsWith('highlight-images/match-x/'))).toBe(true);
  });

  it('is idempotent: skips moments whose image already exists in storage', async () => {
    const existingKey = buildHighlightImageKey({ matchId: 'match-x', momentId: 'score-turn' });
    const storage = {
      exists: vi.fn(async (key: string) => (key === existingKey ? 'https://cdn.example.com/x.png' : null)),
      put: vi.fn(async (key: string) => `https://cdn.example.com/${key}`),
    };
    const result = await generateMissingHighlightImages(row(), {
      provider: createMockHighlightImageProvider(),
      storage,
    });
    expect(result.skipped).toBe(1);
    expect(result.generated).toBe(2);
  });

  it('counts single-moment failures without throwing（图是增强项,不拖垮战报主链路）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const provider = {
      name: 'mock' as const,
      generate: vi.fn()
        .mockRejectedValueOnce(new Error('doubao down'))
        .mockResolvedValue({ image: Buffer.from('89504e470d0a1a0a', 'hex'), contentType: 'image/png' as const, prompt: 'p' }),
    };
    const storage = { exists: vi.fn(async () => null), put: vi.fn(async (key: string) => `https://cdn.example.com/${key}`) };
    const result = await generateMissingHighlightImages(row(), { provider, storage });
    expect(result.failed).toBe(1);
    expect(result.generated).toBe(2);
    expect(warn).toHaveBeenCalled();
  });
});

describe('enrichMatchWithEvents（F63:真实事件落库,失败不拖垮主链路）', () => {
  const fixtureIdOf = (ext: string) => (ext === 'apifoot:1489369' ? 1489369 : null);
  const goal = { minute: 28, type: 'goal', team: 'Mexico', player: 'R. Jiménez' };

  function dbStub(updates: Array<{ events: unknown; id: string }>) {
    return {
      from: () => ({
        update: (values: { events: unknown }) => ({
          eq: async (_col: string, id: string) => {
            updates.push({ events: values.events, id });
            return { error: null };
          },
        }),
      }),
    } as never;
  }

  it('fetches events, persists them, and returns the enriched row', async () => {
    const updates: Array<{ events: unknown; id: string }> = [];
    const out = await enrichMatchWithEvents(dbStub(updates), row(), async () => [goal], fixtureIdOf, 'apifoot:1489369');
    expect(out.events).toEqual([goal]);
    expect(updates).toEqual([{ events: [goal], id: 'match-x' }]);
  });

  it('is idempotent when events already exist and skips unparseable external ids', async () => {
    const updates: Array<{ events: unknown; id: string }> = [];
    const withEvents = row({ events: [goal] });
    expect(await enrichMatchWithEvents(dbStub(updates), withEvents, async () => [], fixtureIdOf, 'apifoot:1489369')).toBe(withEvents);
    const noFixture = await enrichMatchWithEvents(dbStub(updates), row(), async () => [goal], fixtureIdOf, 'openfootball:x');
    expect(noFixture.events).toEqual([]);
    expect(updates).toEqual([]);
  });

  it('returns the original row when the events fetch throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const original = row();
    const out = await enrichMatchWithEvents(dbStub([]), original, async () => { throw new Error('quota'); }, fixtureIdOf, 'apifoot:1489369');
    expect(out).toBe(original);
    expect(warn).toHaveBeenCalled();
  });
});
