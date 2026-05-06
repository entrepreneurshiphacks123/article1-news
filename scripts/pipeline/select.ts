// Article I — story selector.
// Calls Claude Haiku once per cycle; reads N candidate items and applies the
// editorial filter from EDITORIAL.md. Returns 0..N selections with metadata.

import Anthropic from '@anthropic-ai/sdk';
import type { FeedItem, CycleContext, SelectorOutput } from './types.js';
import { SelectorOutput as SelectorOutputSchema } from './types.js';
import { computeCost, recordSpend, type ModelId } from './budget.js';

const MODEL: ModelId = 'claude-haiku-4-5';

const SYSTEM_PROMPT = `You are the editorial selector for Article I — a political feed that covers American politics through the lens of constitutional principle and historical pattern. Your job is to read a batch of fresh news items and decide which (if any) deserve coverage today.

# Editorial spine

Article I is a center-left institutionalist publication. We are pro-democracy, pro-rule-of-law, pro-Article-I (Congress reclaiming surrendered powers), and anti-Trump-as-the-most-serious-threat-to-the-constitutional-order. Economically: pre-Reagan tax structure, money out of politics. Foreign policy: pro-Israel + anti-Netanyahu, pro-NATO, pro-Ukraine.

We apply the **symmetric-criticism principle**: same standard for left and right. We call out antisemitism by name regardless of source. We are not a both-sides account; we have a clear point of view.

# What we LEAN INTO (score up)

- Article I powers (war, appropriations, oversight, impeachment, redistricting)
- Constitutional / rule-of-law / institutional integrity stories
- Money in politics (Citizens United, billionaire spending, lobbying)
- Antisemitism (left or right) with concrete receipts
- Israel / Netanyahu coalition / settlement policy / judicial overreach
- Polling that contradicts conventional wisdom (NOT horse-race deltas)
- Long-arc historical pattern stories
- Race-level shifts (special elections, primary upsets, redistricting outcomes)
- Stories with ≥3 independent sources reporting (= big story)

# What we SKIP (score down to 0)

- Pure horse-race ("X up 2 points") with no structural read
- Celebrity gossip even when politicians involved
- Single-source rumor not corroborated
- Personal scandal without policy implication
- Outrage of the day already 8+ hours stale
- Stories we already covered in the last 72h

# Format routing

- **static** (single brief): breaking, narrow tactical implication, fast turnaround. ~70-90% of posts.
- **carousel** (5-8 slides, structural unpacking): ≥3 sources covering it OR maps to historical pattern OR has institutional implications worth depth. ~10-30% of posts.

# Voice routing

- **strategist** (Goddard/Mike Allen register): tactical, operator-lens, who-benefits, what's-the-play
- **historian** (Heather Cox Richardson register): long-arc context, "this fits a pattern that goes back to..."

# Race-level tagging

- **national**: president, Senate, House (esp. leadership/swing), national policy
- **state**: governor, state legislature, state AG/SoS/treasurer, ballot measures
- **local**: mayor, DA, city council, school board
- **none**: institutional, polling, foreign policy, Article I generally

# Output protocol

Return ONLY a JSON object matching this schema:

{
  "selections": [
    {
      "itemHash": "<hash of selected item>",
      "decision": "select" | "skip",
      "score": <0-100>,
      "reason": "<short explanation>",
      "voice": "strategist" | "historian",       // only for "select"
      "format": "static" | "carousel",           // only for "select"
      "race_level": "national" | "state" | "local" | "none",  // only for "select"
      "topic_tags": ["..."]                       // only for "select"; from our taxonomy
    }
  ],
  "log": "<one sentence summary of the cycle's editorial reasoning>"
}

Include ALL items in selections (with decision: "skip" or "select"). Be ruthless: most items should be skipped. Return strict JSON only — no commentary, no markdown fences.`;

const TOPIC_TAXONOMY = [
  'Constitution', 'ArticleI', 'Citizens United', 'Long Memory',
  'Economy', 'Polling',
  'Foreign Policy', 'Iran', 'Israel', 'Netanyahu', 'Ukraine', 'NATO', 'China',
  'Antisemitism',
  '2026 Midterms', '2028',
  'Redistricting', 'Rule of Law', 'DOJ', 'FDA', 'Executive', 'Appropriations',
  'GOP', 'Democrats',
];

export async function selectStories(
  client: Anthropic,
  candidates: FeedItem[],
  ctx: CycleContext,
): Promise<SelectorOutput> {
  if (candidates.length === 0) {
    return { selections: [], log: 'No candidate items this cycle.' };
  }

  // Cap to 35 candidates per cycle — newest first. Keeps output token budget healthy.
  const ranked = [...candidates].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()).slice(0, 35);

  const userMessage = [
    `Current ET time: ${ctx.nowET.toLocaleString('en-US', { timeZone: 'America/New_York' })}.`,
    `Editorial threshold floor for this hour: ${ctx.selectorThreshold}/100. Be more selective at night, more open during morning rush.`,
    `Topic taxonomy (use these tag names exactly): ${TOPIC_TAXONOMY.join(', ')}.`,
    ``,
    `Candidate items (${ranked.length}):`,
    ...ranked.map((it, i) =>
      `\n[${i}] hash=${it.hash}\n  outlet: ${it.outlet}\n  title: ${it.title}\n  summary: ${it.summary.slice(0, 280)}\n  published: ${it.publishedAt.toISOString()}`
    ),
    ``,
    `Output rules:`,
    `- Strict JSON only. No markdown fences, no commentary outside the JSON.`,
    `- Include EVERY item in selections (even skipped ones).`,
    `- Keep "reason" to ≤12 words. Be terse.`,
    `- Maximum 3 items can be "select"; the rest are "skip".`,
    `- Use double quotes only. No single quotes anywhere.`,
  ].join('\n');

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userMessage }],
  });

  // Record cost
  const usage = resp.usage;
  const cachedIn = (usage as any).cache_read_input_tokens ?? 0;
  const cacheCreate = (usage as any).cache_creation_input_tokens ?? 0;
  const cost = computeCost(MODEL, usage.input_tokens + cacheCreate, cachedIn, usage.output_tokens);
  await recordSpend(ctx.nowET, cost);

  const textBlock = resp.content.find((c) => c.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('Selector returned no text');
  const raw = textBlock.text.trim().replace(/^```json\s*/, '').replace(/```\s*$/, '');

  let parsed: ReturnType<typeof SelectorOutputSchema.parse>;
  try {
    parsed = SelectorOutputSchema.parse(JSON.parse(raw));
  } catch (err) {
    // Save the bad output for inspection
    const fs = await import('fs/promises');
    const path = await import('path');
    const debugPath = path.resolve(process.cwd(), 'state', 'last-selector-error.json');
    await fs.writeFile(debugPath, raw);
    throw new Error(
      `Selector JSON parse failed: ${(err as Error).message}\n` +
      `Raw output saved to ${debugPath}`,
    );
  }
  // Apply threshold filter on top of model's decision (defense in depth)
  parsed.selections = parsed.selections.filter(
    (s) => s.decision === 'skip' || (s.decision === 'select' && s.score >= ctx.selectorThreshold)
  );
  return parsed;
}
