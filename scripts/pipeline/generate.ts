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
  "headline": "<≤12 words. ARTICLE I'S OWN framing — concrete subject + active verb. Read for what's implied: who benefits, what shifts, what pattern this fits. Examples of good Article I headlines: 'Vance's 2028 Is Tied to Trump's Approval. That's a Problem.' / 'Trump Buries Indiana Republicans Who Wouldn't Redistrict for Him.' / 'DOJ Drops the Andy Ogles Probe. Evidence to Be Destroyed.' Notice these are NOT the source outlets' headlines — they're our reframings. Do not write 'Vance Visits Iowa' or anything that sounds like a wire-service summary. No questions, no 'BREAKING:'.>",
  "body": "<Card-visible LEDE in **Political Wire short-paragraph style**: 2-4 SHORT paragraphs separated by blank lines (\\n\\n). Each paragraph is 1-2 sentences max. Pattern: Para 1 = what happened, with attribution ('..., the Wall Street Journal reports.'). Para 2 = a verbatim direct quote on its own line if available: 'Said [Name]: \"...\"'. Para 3 = optional second quote ('He added: \"...\"') OR our strategist/historian framing. Use blank lines between paragraphs — do NOT write one wall of prose. The lede is the hook; the full argument lives in article_md.>",
  "article_md": "<300-700 word LONGFORM MARKDOWN article that appears on the detail page. This is where the actual argument lives — receipts, sources, historical/structural context, implications. Use markdown: paragraphs separated by blank lines, [inline links](url) to sources where you can, blockquotes (>) for pull quotes, ## for section headings if it helps. NEVER make a claim in the lede that isn't backed up here. NEVER write the article with the lede repeated; the lede is a hook, the article picks up from there.>",
  "tags": ["<from taxonomy>", "<2-4 tags>"],
  "hashtags": ["<2-3 brand-style hashtags, no spaces, no #>"],
  "race_level": "national" | "state" | "local" | "none",
  "citations": [{ "outlet": "...", "url": "...", "date": "..." }]
}

Longform article rules (very important):
- Receipts discipline: every claim ties to a source above or to a well-known public fact a reader can verify. Never invent quotes, votes, polls, or statistics. If a source paraphrases, use the source's paraphrase verbatim.
- Voice: same as the lede — strategist (Goddard register) or historian (HCR register), as instructed. Don't switch.
- Symmetric-criticism principle applies fully: when calling out an actor, hold them to the same standard you'd apply to the other side.
- Length: 300-700 words. Tight. Don't pad. End when the argument lands.
- Structure: hook → context (what happened, with sources) → pattern or stakes (the structural read) → what to watch.
- Never a "What this means for [demographic]" finishing line. End with a concrete observation.`;
}

function quotePostSchemaText(): string {
  return `For quote posts (Quote of the Day), return:
{
  "type": "quote",
  "headline": "<≤10 words, an editorial label like 'Obama on the Politicization of Justice' — used for slug + meta. NOT the quote itself.>",
  "quote": {
    "text": "<the verbatim quote — 3-5 sentences typical, a SUBSTANTIVE SNIPPET. NOT a one-liner. Drawn faithfully from the source story. Do NOT invent or paraphrase. If the source paraphrases the speaker, use the source's exact paraphrase wording. If the source provides only a brief quote, this format may not be appropriate — pick a different format.>",
    "speaker": "<full name, e.g. 'Barack Obama'>",
    "speaker_title": "<role/title, e.g. 'Former President of the United States'>",
    "via": "<source/context line, e.g. 'in an interview with Stephen Colbert'>"
  },
  "tags": ["<2-4 tags from taxonomy>"],
  "hashtags": ["<1-3>"],
  "race_level": "national" | "state" | "local" | "none"
}`;
}

function numbersPostSchemaText(): string {
  return `For numbers posts (Numbers of the Day), return:
{
  "type": "numbers",
  "headline": "<≤10 words editorial label, e.g. 'Six Billionaires, $100M Each, to Elect Trump'>",
  "numbers": {
    "value": "<the headline number, short — '$100M', '87%', '46-year high', '$4.54'>",
    "unit": "<optional 1-line caption under the number, e.g. 'each, from six donors' or 'national gas average'>",
    "body": "<2-3 sentences of context: what the number means, why it matters, what the strategic/historical read is.>"
  },
  "tags": ["<2-4 tags>"],
  "hashtags": ["<1-3>"],
  "race_level": "national" | "state" | "local" | "none"
}`;
}

function headlinePostSchemaText(): string {
  return `For headline posts (Headline of the Day), return:
{
  "type": "headline",
  "headline": "<≤10 words editorial label, e.g. 'Headline of the Day — DOJ Closes Ogles Probe'>",
  "headline_card": {
    "text": "<the verbatim original headline from another outlet that you're elevating>",
    "outlet": "<who published it, with date — e.g. 'WTVF Nashville · May 6, 2026'>",
    "url": "<direct link to the original story>"
  },
  "tags": ["<2-4 tags>"],
  "hashtags": ["<1-3>"],
  "race_level": "national" | "state" | "local" | "none"
}

IMPORTANT: Headline of the Day is PURE CURATION. We point at another outlet's headline; we do NOT add a take or any editorial commentary. The choice of which headline to elevate IS the editorial. If you have something you want to argue about the story, generate a "static" brief or "carousel" instead. Headline format = no opinion text.`;
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
  articleText?: string | null,
): Promise<GeneratedPost> {
  const editorial = await getEditorial();
  const schemaText = selection.format === 'carousel'
    ? carouselPostSchemaText()
    : selection.format === 'quote'
    ? quotePostSchemaText()
    : selection.format === 'numbers'
    ? numbersPostSchemaText()
    : selection.format === 'headline'
    ? headlinePostSchemaText()
    : staticPostSchemaText();

  const sourceHeadlineNotice = selection.format === 'headline'
    ? `(For "Headline of the Day" only: this format quotes the source outlet's headline verbatim. That's the exception.)`
    : `IMPORTANT: Write our OWN headline in Article I's voice. NEVER copy or near-paraphrase the source outlet's headline below — that's lazy and off-brand. The source headline is for context only; our headline reframes the story for our reader (the Article I reader cares about constitutional / strategic / historical implications, not the outlet's framing). Different angle, different verb, different stakes.`;

  const articleBlock = articleText
    ? [
        ``,
        `Full article body (use this to surface concrete quotes, numbers, and named-source details — this is what lets us produce real reportage instead of summaries-of-summaries):`,
        `--- BEGIN ARTICLE ---`,
        articleText,
        `--- END ARTICLE ---`,
        ``,
        `When the article contains direct quotes from a named figure, **surface the most newsworthy 1-2 quotes verbatim** in the body / first slide. Use the Political Wire pattern: "Said [Name]: \\"...\\"" or "[Name] told [outlet]: \\"...\\"". Lead with the quote that has the most editorial weight; if there are multiple, pick the one that lands hardest. Don't paraphrase a quote you have verbatim.`,
        ``,
        `When the article contains specific numbers, dates, or named institutions, prefer those over vague summaries. Receipts always.`,
        ``,
      ]
    : [
        ``,
        `(No full article body available — the URL didn't fetch or wasn't extractable. Work from the RSS summary above. Be careful: claim only what's actually in the summary.)`,
        ``,
      ];

  const userMessage = [
    `Write a ${selection.format} post in the **${selection.voice}** voice.`,
    selection.voice === 'strategist'
      ? `Strategist register: tactical, operator's lens. Who benefits. What's the play. Concrete strategic reads. Punchy.`
      : `Historian register: long-arc context. Reads the news against 250 years of American self-government. "The last time X..." / "This pattern goes back to..."`,
    ``,
    `Story metadata (FOR REFERENCE — do not mirror the source's headline or framing):`,
    `  outlet: ${feedItem.outlet}`,
    `  source headline: ${feedItem.title}`,
    `  url: ${feedItem.url}`,
    `  published: ${feedItem.publishedAt.toISOString()}`,
    `  RSS summary: ${feedItem.summary}`,
    ...articleBlock,
    sourceHeadlineNotice,
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

  const maxTokens = selection.format === 'carousel' ? 2500
    : selection.format === 'quote' ? 600
    : selection.format === 'numbers' ? 600
    : selection.format === 'headline' ? 500
    : 2200;  // static brief now includes 300-700 word article_md

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
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
