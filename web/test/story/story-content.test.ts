import { describe, expect, it } from 'vitest';
import { storyContent, type StorySection } from '@/lib/story/story-content';

function expectSection(section: StorySection) {
  expect(section.id.trim()).not.toBe('');
  expect(section.title.trim()).not.toBe('');
  expect(section.lead.trim()).not.toBe('');
}

describe('storyContent schema', () => {
  it('has complete section titles and leads', () => {
    expectSection(storyContent.hero);
    for (const section of Object.values(storyContent.sections)) {
      expectSection(section);
    }
    expect([storyContent.hero, ...Object.values(storyContent.sections)].map((section) => section.id)).toEqual([
      'hero',
      'facts',
      'proof',
      'org',
      'factory',
      'cost',
      'governance',
      'timeline',
      'assets',
      'contact',
    ]);
  });

  it('has stat freshness metadata', () => {
    expect(storyContent.stats.length).toBeGreaterThan(0);
    for (const stat of storyContent.stats) {
      expect(stat.label.trim()).not.toBe('');
      expect(stat.value.trim()).not.toBe('');
      expect(stat.asOf.trim()).not.toBe('');
      expect(typeof stat.verified).toBe('boolean');
    }
  });

  it('has required story collections', () => {
    expect(storyContent.hero.audiences).toHaveLength(4);
    expect(storyContent.proofFeatures).toHaveLength(6);
    expect(storyContent.factory.lanes).toHaveLength(5);
    expect(storyContent.cost.pairs).toHaveLength(3);
    expect(storyContent.assets.playbooks).toHaveLength(10);
    expect(storyContent.assets.skills).toHaveLength(3);
  });
});
