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

// What the selector returns per cycle
export const SelectionItem = z.object({
  itemHash: z.string(),
  decision: z.enum(['skip', 'select']),
  score: z.number().min(0).max(100),
  reason: z.string(),
  voice: z.enum(['strategist', 'historian']).optional(),
  format: z.enum(['static', 'carousel', 'quote', 'numbers', 'headline']).optional(),
  race_level: z.enum(['national', 'state', 'local', 'none']).optional(),
  topic_tags: z.array(z.string()).optional(),
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
