// Article I — post generator. Sonnet writes the post in Article I voice.

import Anthropic from '@anthropic-ai/sdk';
import { promises as fs } from 'fs';
import path from 'path';
import type { FeedItem, GeneratedPost, SelectionItem, CycleContext } from './types.js';
import { GeneratedPost as GeneratedPostSchema } from './types.js';
import { computeCost, recordSpend, type ModelId } from './budget.js';

const MODEL: ModelId = 'claude-sonnet-4-6';

// We load EDITORIAL.md from the parent project folder once at module load.
// Path: site lives at <root>/site, editorial doc at <root>/EDITORIAL.md (one up).
const EDITORIAL_PATH = path.resolve(process.cwd(), '..', 'EDITORIAL.md');

let editorialCache: string | null = null;
async function getEditorial(): Promise<string> {
  if (editorialCache) return editorialCache;
  try {
    editorialCache = await fs.readFile(EDITORIAL_PATH, 'utf8');
  } catch {
    // Fallback if running outside the parent dir layout — use embedded short version
    editorialCache = `Article I — center-left institutionalist publication covering American politics through the lens of constitutional principle and historical pattern. Two voices: strategist (Goddard register) and historian (HCR register). Symmetric-criticism principle. Pro-Israel, anti-Netanyahu. Pro pre-Reagan tax structure, money out of politics. Anti-Trump-as-threat-to-constitutional-order. Receipts discipline; no horse-race; no celebrity gossip; no engagement bait.`;
  }
  return editorialCache;
}

function staticPostSchemaText(): string {
  return `For static posts, return:
{
  "type": "static",
  "headline": "<≤12 words, no questions, no 'BREAKING:'>",
  "body": "<2-4 sentence body in Article I voice. Sentence 1 = what happened (with a number or quote). Sentence 2-3 = strategist or historian read. Sentence 4 (optional) = forward implication.>",
  "tags": ["<from taxonomy>", "<2-4 tags>"],
  "hashtags": ["<2-3 brand-style hashtags, no spaces, no #>"],
  "race_level": "national" | "state" | "local" | "none",
  "citations": [{ "outlet": "...", "url": "...", "date": "..." }]
}`;
}

function carouselPostSchemaText(): string {
  return `For carousel posts, return:
{
  "type": "carousel",
  "headline": "<≤14 words, the master headline>",
  "slides": [
    { "kind": "hook",     "body": "<concrete claim or question that earns the swipe>" },
    { "kind": "context",  "body": "<what happened, with receipts>" },
    { "kind": "pattern",  "body": "<the historical or structural lens — 'Last time X...' / 'Article I gives Congress...'>" },
    { "kind": "stakes",   "body": "<what changes if this stands>" },
    { "kind": "watch",    "body": "<the next data point, vote, or test>" },
    { "kind": "sources",  "body": "" },
    { "kind": "cta",      "body": "Article I — American politics through the lens of the Constitution and the long memory." }
  ],
  "citations": [
    { "outlet": "<source name>", "url": "<link>", "date": "<date if known>", "note": "<optional>" }
  ],
  "tags": ["<from taxonomy>"],
  "hashtags": ["<brand-style>"],
  "race_level": "national" | "state" | "local" | "none"
}`;
}

const NEVER_RULES = `# NEVER
- Cheap dunks, gotchas, "ratio" bait
- ALL CAPS HEADLINES, excessive punctuation
- "Folks", "y'all", "imagine being", "reading this you'll"
- Slurs (even sarcastic) targeting characters on any side
- "This is OUTRAGEOUS" / telling readers how to feel — show the facts, conclusion is implicit
- Hedging on Trump's autocratic behavior — be plain
- Hedging on antisemitism — name it
- Inventing facts not in the source. If a number, quote, or date isn't in the source, don't put it in the post.`;

export async function generatePost(
  client: Anthropic,
  selection: SelectionItem,
  feedItem: FeedItem,
  ctx: CycleContext,
): Promise<GeneratedPost> {
  const editorial = await getEditorial();
  const schemaText = selection.format === 'carousel' ? carouselPostSchemaText() : staticPostSchemaText();

  const userMessage = [
    `Write a ${selection.format} post in the **${selection.voice}** voice.`,
    selection.voice === 'strategist'
      ? `Strategist register: tactical, operator's lens. Who benefits. What's the play. Concrete strategic reads. Punchy.`
      : `Historian register: long-arc context. Reads the news against 250 years of American self-government. "The last time X..." / "This pattern goes back to..."`,
    ``,
    `Story:`,
    `  outlet: ${feedItem.outlet}`,
    `  headline: ${feedItem.title}`,
    `  url: ${feedItem.url}`,
    `  published: ${feedItem.publishedAt.toISOString()}`,
    `  summary: ${feedItem.summary}`,
    ``,
    `Tags suggested by selector: ${selection.topic_tags?.join(', ') ?? '(none)'}`,
    `Race level: ${selection.race_level}`,
    `Selector reason for picking this: ${selection.reason}`,
    ``,
    schemaText,
    ``,
    NEVER_RULES,
    ``,
    `Return strict JSON only. No commentary, no markdown fences.`,
  ].join('\n');

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: selection.format === 'carousel' ? 2500 : 800,
    system: [
      {
        type: 'text',
        text: editorial,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userMessage }],
  });

  const usage = resp.usage;
  const cachedIn = (usage as any).cache_read_input_tokens ?? 0;
  const cacheCreate = (usage as any).cache_creation_input_tokens ?? 0;
  const cost = computeCost(MODEL, usage.input_tokens + cacheCreate, cachedIn, usage.output_tokens);
  await recordSpend(ctx.nowET, cost);

  const textBlock = resp.content.find((c) => c.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('Generator returned no text');
  const raw = textBlock.text.trim().replace(/^```json\s*/, '').replace(/```\s*$/, '');
  return GeneratedPostSchema.parse(JSON.parse(raw));
}
