import { describe, expect, it } from 'vitest';
import type { TrackDb } from '@/app/api/track/route';
import type { MeDb } from '@/app/api/me/route';
import type { ReportDetailDb } from '@/app/api/report/[id]/route';
import type { ShortCodeDb } from '@/app/api/report/route';

function acceptsTrackDb(_db: TrackDb) {
  return 'track';
}

function acceptsMeDb(_db: MeDb) {
  return 'me';
}

function acceptsReportDetailDb(_db: ReportDetailDb) {
  return 'report-detail';
}

function acceptsShortCodeDb(_db: ShortCodeDb) {
  return 'short-code';
}

describe('route DB type compatibility', () => {
  it('exports compile-time contracts for track route DB access', () => {
    expect(acceptsTrackDb).toBeTypeOf('function');
  });

  it('exports compile-time contracts for me route DB access', () => {
    expect(acceptsMeDb).toBeTypeOf('function');
  });

  it('exports compile-time contracts for report detail route DB access', () => {
    expect(acceptsReportDetailDb).toBeTypeOf('function');
  });

  it('exports compile-time contracts for report short_code DB access', () => {
    expect(acceptsShortCodeDb).toBeTypeOf('function');
  });
});
