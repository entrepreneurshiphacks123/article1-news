// Article I — story selector.
// Calls Claude Haiku once per cycle; reads N candidate items and applies the
// editorial filter from EDITORIAL.md. Returns 0..N selections with metadata.

import Anthropic from '@anthropic-ai/sdk';
import type { FeedItem, CycleContext, SelectorOutput } from './types.js';
import { SelectorOutput as SelectorOutputSchema, SelectionItem } from './types.js';
import { computeCost, recordSpend, type ModelId } from './budget.js';

const MODEL: ModelId = 'claude-haiku-4-5';

// Hard cap on how many items the selector can mark "select" per cycle.
// Bumped from 3 → 6 to push daily volume past Political Wire's ~30-40/day.
const SELECTOR_MAX_SELECTIONS = 6;

const SYSTEM_PROMPT = `You are the editorial selector for Article I — a political feed that covers American politics through the lens of constitutional principle and historical pattern. Your job is to read a batch of fresh news items and decide which (if any) deserve coverage today.

# Editorial spine

Article I is a center-left institutionalist publication. We are pro-democracy, pro-rule-of-law, pro-Article-I (Congress reclaiming surrendered powers), and anti-Trump-as-the-most-serious-threat-to-the-constitutional-order. Economically: pre-Reagan tax structure, money out of politics. Foreign policy: pro-Israel + anti-Netanyahu, pro-NATO, pro-Ukraine.

We apply the **symmetric-criticism principle**: same standard for left and right. We call out antisemitism by name regardless of source. We are not a both-sides account; we have a clear point of view.

# Coverage breadth — match Political Wire's volume, exceed its depth

Our target: ~40-50 posts per day. We want to match Political Wire's *coverage breadth* (the steady drumbeat of polling, candidate moves, daily economy, foreign policy, process briefs) AND keep our editorial advantage (Article I framing, longform argument on substantive picks).

This means: don't be too literary. The selector's earlier failure mode was treating polls as horse-race noise and skipping entire categories. Stop doing that. The categories below ALL count as legitimate coverage.

# What we LEAN INTO (score up; cover them)

**Article I core (always relevant):**
- Article I powers (war, appropriations, oversight, impeachment, redistricting)
- Constitutional / rule-of-law / institutional integrity stories
- Money in politics (Citizens United, billionaire spending, lobbying)
- **Antisemitism (left or right) with concrete receipts.** This is an editorial STANDARD, not a primary topic. We're pro-Jewish, and we call out antisemitism by name regardless of which side commits it. When such a story breaks, score it up.
- Long-arc historical pattern stories
- Race-level shifts (special elections, primary upsets, redistricting outcomes)
- Stories with ≥3 independent sources reporting (= big story → analysis depth)

**Political Wire-style breadth (cover these too — they're not horse race):**
- **Polling that shows STRUCTURAL shifts** — age limits for lawmakers, generic ballot, enthusiasm gaps, support for institutional reform, support for term limits, public trust in courts/Congress, congressional approval. Single-point movements are horse race; persistent gaps and big public-opinion patterns are not. (Pollster credibility check below.)
- **2028 candidate moves** — Beshear running, Harris on DNC autopsy, Vance Iowa visits, Newsom positioning, etc. Specific candidate news is legitimate coverage.
- **Daily economy** — gas prices, jet fuel, affordability, cost of living, inflation, labor data, jobs reports. These shape midterm dynamics, which is core Article I material.
- **Public health & pandemic preparedness** — CDC / NIH / FDA / HHS staffing changes, RFK Jr.'s actions, vaccine policy shifts, outbreak coverage (hantavirus, measles, avian flu), agency budget cuts, pandemic-prep capacity. ALL of this is Article I material: appropriations (Article I §9), executive overreach, Congressional surrender of oversight. An outbreak story IS a policy-capacity story. The bot has been wrongly skipping these.
- **Broader foreign policy** — China geopolitics, Ukraine war updates, Latin America diplomacy, NATO realignments. Not just Iran/Israel.
- **Wire process briefs** — "Trump wants new Air Force One," "X to host Y," "Senator says Z" — fast brief format. Skip if pure fluff (medical conditions, food preferences, social media reactions); cover if there's a structural or policy implication.

**Pollster credibility (gate before scoring up a poll):**
- TRUST: Gallup, Pew, Marist (NPR/PBS-Marist), Quinnipiac, Monmouth, NBC/WSJ, NYT/Siena, Cook Political, AP-NORC, Ipsos, ABC/WaPo, KFF, Pew Research, Reuters/Ipsos, Fox News (their poll is academically credible despite the network), Echelon Insights (mixed but transparent methods).
- SKEPTICAL: Trafalgar, Insider Advantage, Rasmussen — partisan-funded; only feature when a credible outlet contextualizes them or when a pattern across multiple firms confirms.
- SKIP: Internal campaign polls, party-funded polls, or polls from anonymous "GOP/Dem strategists" — these are spin, not data.

# What we SKIP (score down to 0)

- Single-source rumor not corroborated
- Personal scandal without policy implication
- Outrage of the day already 8+ hours stale
- Stories we already covered in the last 72h
- Celebrity gossip even when politicians involved
- Medical conditions, food preferences, social media micro-reactions
- Internal campaign polls / partisan-funded polls without credible context
- **Israeli domestic politics that don't have US implications.** Israel-the-country is NOT a primary Article I topic. Cover when: (a) it's an antisemitism story, (b) it's about US-Israel policy with concrete US political implications (aid votes, AIPAC/DMFI activity, US politicians' positioning), or (c) Netanyahu specifically acts in a way that matters for US foreign policy. Skip pure Knesset coverage, settlement-expansion routines, generic Israel-Hamas updates without a US angle. Same rule applies to UK/Canada/EU domestic politics — only US-relevant.

# Format routing

Pick the format that best fits the story:

- **static** (single brief): the default. Most posts. Voice/depth determines length.
- **carousel** (5-8 slides, structural unpacking): ≥3 sources covering it OR maps to historical pattern OR has institutional implications worth depth. ~5-15% of posts.
- **quote** (Quote of the Day): the source contains a substantive direct quote (3-5 sentences) from a public figure that lands powerfully on its own. The quote IS the post. ~5-10% of posts.
- **numbers** (Numbers of the Day): a single striking statistic that anchors the story. **Aggressively prefer this format when the headline contains a single dollar/percent/year-count figure that IS the story.** Examples: "$4.7 billion already" / "$7 billion oil-price bets" / "$100M each from six donors" / "46-year high" / "87% reject" / "30 states cannot handle". When you see a stat like that in a headline, the answer is almost always 'numbers', not 'static'. ~5-12% of posts.
- **headline** (Headline of the Day): another outlet's framing is itself the news — pure curation. Rare. ~2-5% of posts.

# Depth routing — wire vs analysis

For each \`select\`, also choose **depth**:

- **wire**: Political-Wire style. ONE-sentence lead with attribution at the end + ONE supporting fact (quote, number, or named secondary actor). 60-90 words, two paragraphs max. NO Article I editorial voice — beat reporter only. Use for: candidate announcements, polling reports, economic data, process briefs, foreign policy updates, daily political news. ~80% of selections. **This is the default. Be aggressive about routing here.**
- **analysis**: full Article I treatment — short lede + 300-700 word longform article with H2 sections, legal/historical citation, "what to watch" close. Use ONLY when the story has at least TWO of: (a) constitutional implication (Article I powers, war powers, appropriations, executive overreach, court rulings on structure), (b) ≥3 independent outlets reporting (= big story), (c) clear historical/structural pattern worth unpacking (long memory), (d) major durable policy shift (not a daily news beat). ~20% of selections. **Be strict. Analysis is the rare deep dive — Steven specifically wants fewer of these, only when warranted.**

Default is **wire**. Only escalate to analysis when the bar above is clearly met. A story that's interesting but doesn't meet two-of-four → wire.

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
      "itemHash": "<hash>",
      "decision": "select" | "skip",
      "score": <0-100>,
      "reason": "<short explanation>",
      "voice": "strategist" | "historian",       // required for "select"
      "format": "static" | "carousel" | "quote" | "numbers" | "headline",
      "depth": "wire" | "analysis",              // required for "select"
      "race_level": "national" | "state" | "local" | "none",
      "topic_tags": ["..."],                     // from our taxonomy
      "priority": "standard" | "breaking"        // default "standard"; see below
    }
  ],
  "log": "<one sentence summary of the cycle's editorial reasoning>"
}

EVERY field above is REQUIRED for "select" decisions. If you can't fill one in, default to:
  reason: "(no rationale)"
  voice: "strategist"
  format: "static"
  depth: "wire"
  race_level: "none"
  topic_tags: []
  priority: "standard"

# Priority field
Default is "standard" for all stories. Set to "breaking" ONLY for landmark, immediate-impact events that warrant immediate Instagram cross-posting (à la carte path):
  - Supreme Court ruling that restructures institutional or civil rights
  - Presidential invocation of war powers, emergency powers, or defiance of a court order
  - Confirmed, active constitutional crisis (impeachment vote started, court order openly defied)
  - Election Night or Election Day outcome calls (president, Senate majority, House majority)
  - Congress overriding a presidential veto on a major Article I powers bill
These are rare — fewer than 1% of stories qualify. When in doubt, use "standard".

Include ALL items in selections (with decision: "skip" or "select"). Be ruthless on quality but generous on breadth — most cycles should produce 2-5 selections, not 0. Return strict JSON only — no commentary, no markdown fences.`;

const TOPIC_TAXONOMY = [
  'Constitution', 'ArticleI', 'Citizens United', 'Long Memory', 'Supreme Court',
  'Economy', 'Affordability', 'Polling',
  'Foreign Policy', 'Iran', 'Ukraine', 'Russia', 'NATO', 'China', 'Latin America',
  // Israel/Netanyahu retained as tags (rare use, only when US-relevant);
  // Antisemitism is the editorial standard, used freely.
  'Israel', 'Netanyahu', 'Antisemitism',
  '2026 Midterms', '2028',
  'Redistricting', 'Voting Rights', 'Rule of Law', 'DOJ', 'FBI', 'Executive', 'Appropriations',
  'Public Health', 'Pandemic Prep', 'CDC', 'NIH', 'FDA', 'HHS', 'RFK Jr', 'Outbreak',
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

  // Cap to 40 candidates per cycle — newest first. Keeps output token budget healthy
  // while giving the model enough breadth to see the day's news shape.
  const ranked = [...candidates].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()).slice(0, 40);

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
    `- Maximum ${SELECTOR_MAX_SELECTIONS} items can be "select" this cycle; the rest are "skip".`,
    `- Of the selected items, target ~80% depth="wire" and ~20% depth="analysis". Default heavily to wire. Escalate to analysis only when the story meets the strict two-of-four bar (constitutional / 3+ sources / clear historical pattern / major durable policy shift).`,
    `- For polling stories, name the pollster in your reason and only score >65 if the pollster is on the TRUST list (Gallup, Marist, Pew, Quinnipiac, Monmouth, NBC/WSJ, NYT/Siena, Cook, AP-NORC, Ipsos, ABC/WaPo, KFF, Reuters/Ipsos, Fox News, Echelon).`,
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

  // Two-stage parsing: get the raw JSON object, then individually parse each
  // selection item. If a single item is malformed, drop it and continue —
  // we never crash the whole cycle over one bad selection.
  let rawObj: any;
  try {
    rawObj = JSON.parse(raw);
  } catch (err) {
    const fs = await import('fs/promises');
    const path = await import('path');
    const debugPath = path.resolve(process.cwd(), 'state', 'last-selector-error.json');
    await fs.writeFile(debugPath, raw);
    throw new Error(`Selector returned non-JSON: ${(err as Error).message}\nRaw saved to ${debugPath}`);
  }

  const log = typeof rawObj?.log === 'string' ? rawObj.log : '';
  const rawSelections: unknown[] = Array.isArray(rawObj?.selections) ? rawObj.selections : [];

  const parsed = { selections: [] as ReturnType<typeof SelectorOutputSchema.parse>['selections'], log };
  let dropped = 0;
  for (const raw of rawSelections) {
    const result = SelectionItem.safeParse(raw);
    if (result.success) {
      parsed.selections.push(result.data);
    } else {
      dropped++;
    }
  }
  if (dropped > 0) {
    console.warn(`[select] dropped ${dropped} malformed selection(s) — they were unparseable even with .catch() fallbacks`);
  }
  // Apply threshold filter + max-selections cap on top of model's decision (defense in depth)
  parsed.selections = parsed.selections.filter(
    (s) => s.decision === 'skip' || (s.decision === 'select' && s.score >= ctx.selectorThreshold)
  );
  // Enforce hard cap even if model returned more (rank by score desc).
  const selects = parsed.selections.filter((s) => s.decision === 'select').sort((a, b) => b.score - a.score);
  const skips = parsed.selections.filter((s) => s.decision === 'skip');
  parsed.selections = [...selects.slice(0, SELECTOR_MAX_SELECTIONS), ...skips];

  return parsed;
}
