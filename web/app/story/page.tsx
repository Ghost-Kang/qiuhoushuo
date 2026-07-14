import { createElement } from 'react';
import { notFound } from 'next/navigation';
import { storyEnabled } from '@/lib/api/feature-flags';
import { storyContent } from '@/lib/story/story-content';
import { StoryPageClient } from './story-page-client';

export const dynamic = 'force-dynamic';

export default function StoryPage() {
  if (!storyEnabled()) notFound();
  return createElement(StoryPageClient, { content: storyContent });
}
