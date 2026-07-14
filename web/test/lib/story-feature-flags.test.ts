import { describe, expect, it } from 'vitest';
import { storyEnabled } from '@/lib/api/feature-flags';

describe('storyEnabled', () => {
  it('defaults to false', () => {
    expect(storyEnabled({})).toBe(false);
  });

  it('accepts explicit enabled values', () => {
    expect(storyEnabled({ STORY_ENABLED: '1' })).toBe(true);
    expect(storyEnabled({ STORY_ENABLED: 'true' })).toBe(true);
  });
});
