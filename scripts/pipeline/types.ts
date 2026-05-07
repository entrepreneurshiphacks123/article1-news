// Article I — pipeline shared types

import { z } from 'zod';

export type FormatType = 'static' | 'carousel' | 'quote' | 'numbers' | 'headline';
export type Voice = 'strategist' | 'historian';
export type RaceLevel = 'national' | 'state' | 'local' | 'none';

export interface FeedItem {
  source: string;            // human-readable source name
  outlet: string;            // canonical outlet name for attribution
  url: string;               // canonical link
  title: string;
  summary: string;           // first 1-2 paragraphs
  publishedAt: Date;
  hash: string;              // url-hash for dedupe
}

// What the selector returns per cycle.
// Bulletproof against malformed model output: every field uses .catch()
// so any single bad value falls back to a safe default instead of crashing
// the whole cycle. (Zod 4's .default() only fires for explicit `undefined`
// at object-key level, not for missing keys in some cases — .catch() is
// runtime-permissive in a way .default() isn't, and we need that here.)
export const SelectionItem = z.object({
  itemHash: z.string(),
  decision: z.enum(['skip', 'select']).catch('skip' as const),
  score: z.number().catch(0),
  reason: z.string().catch(''),
  voice: z.enum(['strategist', 'historian']).optional().catch(undefined),
  format: z.enum(['static', 'carousel', 'quote', 'numbers', 'headline']).optional().catch(undefined),
  // Depth determines whether the generator does a full article fetch +
  // longform article body ("analysis") or a fast wire-style brief ("wire").
  // Wire posts are ~5x cheaper and let us match Political Wire's coverage
  // breadth without exceeding the daily Anthropic cap.
  depth: z.enum(['wire', 'analysis']).optional().catch('wire' as const),
  race_level: z.enum(['national', 'state', 'local', 'none']).optional().catch(undefined),
  topic_tags: z.array(z.string()).optional().catch(undefined),
});
export type SelectionItem = z.infer<typeof SelectionItem>;

export const SelectorOutput = z.object({
  selections: z.array(SelectionItem),
  log: z.string(),
});
export type SelectorOutput = z.infer<typeof SelectorOutput>;

// What the generator returns per story
const SlideKind = z.enum(['hook', 'context', 'pattern', 'stakes', 'watch', 'sources', 'cta']);

export const GeneratedPost = z.object({
  type: z.enum(['static', 'carousel', 'quote', 'numbers', 'headline']),
  headline: z.string(),
  body: z.string().optional(),
  slides: z.array(z.object({
    kind: SlideKind,
    body: z.string(),
  })).optional(),
  citations: z.array(z.object({
    outlet: z.string(),
    url: z.string().optional(),
    date: z.string().optional(),
    note: z.string().optional(),
  })).optional(),
  tags: z.array(z.string()).default([]),
  hashtags: z.array(z.string()).default([]),
  race_level: z.enum(['national', 'state', 'local', 'none']).default('none'),

  // Format-specific payloads (only one applies based on `type`).
  quote: z.object({
    text: z.string(),
    speaker: z.string(),
    speaker_title: z.string().optional(),
    via: z.string().optional(),
  }).optional(),
  numbers: z.object({
    value: z.string(),
    unit: z.string().optional(),
    body: z.string(),
  }).optional(),
  headline_card: z.object({
    text: z.string(),
    outlet: z.string(),
    url: z.string().optional(),
  }).optional(),

  // Longform article — Markdown body. Required for static briefs (the lede on
  // the card opens to a full argument on the detail page). Optional for
  // carousels (the slides already do the work). Never set for quote/numbers/
  // headline (those are pure curation or single-stat cards, no argument).
  article_md: z.string().optional(),
});
export type GeneratedPost = z.infer<typeof GeneratedPost>;

export interface CycleContext {
  nowET: Date;
  isMorningRush: boolean;        // 6-9a ET
  isOvernight: boolean;          // 10p-5a ET
  selectorThreshold: number;     // floats 55 / 65 / 80 by hour
  budgetRemaining: number;       // $ available today
  isHalted: boolean;             // budget exhausted
  dryRun: boolean;
}
