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

function staticPostSchemaText(depth: 'wire' | 'analysis'): string {
  const wireHeadlineRule = `<≤10 words. NEUTRAL subject + verb + object. Flat statement of fact. The take lives in the body, NEVER in the headline. BANNED: editorial verbs ('purges,' 'fractures,' 'hits,' 'forces,' 'buries,' 'torches,' 'bets,' 'squeezes'), em dashes, two-clause headlines ('X. That's a Y.'), question marks, 'BREAKING:'. USE: 'expands,' 'proposes,' 'announces,' 'rejects,' 'wins,' 'loses,' 'targets,' 'sends,' 'tells,' 'says,' 'visits,' 'fires,' 'orders,' 'signs.' Good wire headlines: 'Vance Visits Iowa Ahead of 2028' / 'Indiana GOP Senators Lose Primaries After Redistricting Vote' / 'DOJ Closes Andy Ogles Probe' / 'Trump Proposes H-1B Wage Floor Increase.' Yes, this reads like a wire-service summary — that's the point.>`;

  const analysisHeadlineRule = `<≤12 words. ARTICLE I'S OWN framing — concrete subject + active verb that signals the take. Editorial verbs OK. Em dashes OK. Two-clause headlines OK. The take in the headline is the moat. Examples: 'Vance's 2028 Is Tied to Trump's Approval. That's a Problem.' / 'Trump Buries Indiana Republicans Who Wouldn't Redistrict for Him.' / 'DOJ Drops the Andy Ogles Probe. Evidence to Be Destroyed.' These are NOT source outlets' headlines — they're our reframings. No questions, no 'BREAKING:'.>`;

  if (depth === 'wire') {
    return `For WIRE-DEPTH static posts, return:
{
  "type": "static",
  "headline": "${wireHeadlineRule}",
  "body": "<TWO paragraphs max. 60-90 words total. Para 1: ONE sentence. Format — '[Actor] [neutral verb] [object/consequence], according to [outlet].' Attribution at the END. Para 2: ONE additional fact — a verbatim direct quote with named speaker ('Said [Name]: \"...\"'), a specific number/vote/dollar figure with named source, OR a named secondary actor's position. That's it. NO third paragraph.>",
  "tags": ["<from taxonomy, 2-3 tags>"],
  "hashtags": ["<1-3 brand-style hashtags, no spaces, no #>"],
  "race_level": "national" | "state" | "local" | "none",
  "citations": [{ "outlet": "...", "url": "...", "date": "..." }]
}

DO NOT include "article_md" — wire posts don't get a separate longform article body.

WIRE VOICE — beat reporter, NOT editorialist. NON-NEGOTIABLE:
- NO inline mid-sentence attribution. WRONG: "...military assets, per The Bulwark (May 8), and the U.S..." RIGHT: "...military assets, according to The Bulwark." Attribution lives at the END of the sentence.
- NO date stamps in the body. WRONG: "...sent letters Thursday..." or "(May 8)". The post has its own timestamp.
- BANNED PHRASES: "the strategic read," "the play here," "the operational contradiction," "the fracture matters," "doing a lot of work," "isn't spin for X — it's spin for Y," "shelf-stable," "paper trail," "what to watch," "why it matters." These are Article I voice — save them for analysis posts.
- NO em-dash editorial reframes. WRONG: "Active combat at sea — and the administration is calling it a ceasefire." RIGHT: "The administration called it a ceasefire."
- NO three-act structure (fact → strategic read → what to watch). Just: news + one supporting detail. Stop.
- Receipts always: every claim ties to the source. Never invent quotes/numbers/dates.
- 60-90 words. Hard cap. If you're at 100+ words rewriting, you've slipped into analysis voice — cut.
- If the source has no quote, no number, no named secondary actor, the post is one paragraph. Don't pad.`;
  }

  return `For ANALYSIS-DEPTH static posts, return:
{
  "type": "static",
  "headline": "${analysisHeadlineRule}",
  "body": "<Card-visible LEDE in Political Wire short-paragraph style: 2-3 SHORT paragraphs separated by blank lines (\\n\\n). Each paragraph 1-2 sentences. Pattern: Para 1 = what happened with outlet attribution. Para 2 = verbatim quote on its own line if available ('Said [Name]: \"...\"'). Para 3 = optional second quote OR strategist/historian framing. Don't write one wall of prose. The lede is the hook; the full argument lives in article_md.>",
  "article_md": "<300-700 word LONGFORM MARKDOWN article that appears on the detail page. This is where the actual argument lives — receipts, sources, historical/structural context, implications. Use markdown: paragraphs, [inline links](url), blockquotes (>), ## section headings. NEVER make a claim in the lede that isn't backed up here. NEVER repeat the lede in the article — the lede is a hook, the article picks up from there.>",
  "tags": ["<from taxonomy, 2-4 tags>"],
  "hashtags": ["<2-3 brand-style hashtags, no spaces, no #>"],
  "race_level": "national" | "state" | "local" | "none",
  "citations": [{ "outlet": "...", "url": "...", "date": "..." }]
}

Longform article rules:
- Receipts discipline: every claim ties to a source or well-known public fact. Never invent quotes/numbers/dates.
- Voice: same as the lede (strategist or historian). Don't switch.
- Symmetric-criticism: hold any actor to the same standard you'd apply to the other side.
- Length: 300-700 words. Tight. End when the argument lands.
- Structure: hook → context → pattern/stakes → what to watch.
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

const NORTH_STAR = `# NORTH STAR

The reader's goal: **make Article I their only news source AND become the most informed person in the room.** Every post is judged against that bar. Vague paraphrase fails. Specifics — names, numbers, quotes, dates, voting records, district demographics, polling crosstabs — pass.

If you find yourself writing a sentence like "the pattern goes back to 1948" without naming WHAT the pattern is or what 1948 reference you mean, stop and either pull the specifics from the article or cut the sentence.`;

const NEVER_RULES = `# NEVER
- Cheap dunks, gotchas, "ratio" bait
- ALL CAPS HEADLINES, excessive punctuation
- "Folks", "y'all", "imagine being", "reading this you'll"
- Slurs (even sarcastic) targeting characters on any side
- "This is OUTRAGEOUS" / telling readers how to feel — show the facts, conclusion is implicit
- Hedging on Trump's autocratic behavior — be plain
- Hedging on antisemitism — name it
- Inventing facts not in the source. If a number, quote, or date isn't in the source, don't put it in the post.
- Vague gestures at history without specifics ("the pattern goes back to 1948" with no named pattern or named precedent) — these read as filler.
- **NEVER tell the reader the article wasn't extractable, was paywalled, you couldn't access it, or you're working from a summary.** This is internal pipeline state and has no place in the post body. Write what you know in our voice and stop. If the source detail is thin, the post is shorter — that's it.
- **NEVER pad to hit a length target.** A 1-sentence brief that lands beats a 4-sentence brief with filler. If you only have a fact + a frame, write a fact + a frame and stop.`;

export async function generatePost(
  client: Anthropic,
  selection: SelectionItem,
  feedItem: FeedItem,
  ctx: CycleContext,
  articleText?: string | null,
): Promise<GeneratedPost> {
  const editorial = await getEditorial();
  const depth = selection.depth ?? 'analysis';
  const schemaText = selection.format === 'carousel'
    ? carouselPostSchemaText()
    : selection.format === 'quote'
    ? quotePostSchemaText()
    : selection.format === 'numbers'
    ? numbersPostSchemaText()
    : selection.format === 'headline'
    ? headlinePostSchemaText()
    : staticPostSchemaText(depth);

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
        `(Internal: full article text isn't available this cycle. Work from the RSS summary. **DO NOT mention this in the post body.** Just write what you know in our voice — if the detail is thin, the post is shorter. Never tell the reader you couldn't access the article.)`,
        ``,
      ];

  const isWireStatic = selection.format === 'static' && depth === 'wire';
  const voiceDirective = isWireStatic
    ? `BEAT REPORTER VOICE. Not strategist, not historian. Plain reportage in Political Wire style: who did what, attribution at the end, one supporting fact. The selector's "voice" tag (${selection.voice}) does NOT apply to wire posts — IGNORE it. Article I voice is reserved for analysis-depth posts and longform articles. On wire, you are a wire-service beat reporter.`
    : selection.voice === 'strategist'
      ? `Strategist register: tactical, operator's lens. Who benefits. What's the play. Concrete strategic reads. Punchy.`
      : `Historian register: long-arc context. Reads the news against 250 years of American self-government. "The last time X..." / "This pattern goes back to..."`;

  const userMessage = [
    `Write a ${selection.format} post${isWireStatic ? ' (WIRE depth — Political Wire style, beat reporter)' : ` in the **${selection.voice}** voice`}.`,
    voiceDirective,
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
    NORTH_STAR,
    ``,
    NEVER_RULES,
    ``,
    `Return strict JSON only. No commentary, no markdown fences.`,
  ].join('\n');

  // Wire-depth statics target 60-90 words with one supporting fact (~150 tokens body).
  // Cap at 500 to physically prevent the model from drifting into analysis-length wire posts.
  // Analysis-depth statics include a 300-700 word longform article on top of the lede (~2200 tokens).
  const maxTokens = selection.format === 'carousel' ? 2500
    : selection.format === 'quote' ? 600
    : selection.format === 'numbers' ? 600
    : selection.format === 'headline' ? 500
    : depth === 'wire' ? 500
    : 2200;

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
