// Article I — orchestrator. Runs the full cycle:
//   aggregate → dedupe → select → generate (per selection) → write markdown
// Honors the daily budget cap. Logs telemetry. Commits via separate step in CI.

import { config as loadDotenv } from 'dotenv';
loadDotenv({ override: true });
import Anthropic from '@anthropic-ai/sdk';
import { aggregate } from './aggregate.js';
import { filterUnseen, markProcessed } from './dedupe.js';
import { selectStories } from './select.js';
import { generatePost } from './generate.js';
import { fetchArticle } from './fetch-article.js';
import { writePostMarkdown, nextId } from './write-markdown.js';
import { getRemainingBudget, isHalted, DAILY_CAP_USD } from './budget.js';
import type { CycleContext } from './types.js';

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry');
const DRAFT = args.has('--draft') || process.env.PIPELINE_DRAFT_MODE === '1';

function buildContext(): CycleContext {
  const now = new Date();
  // Hour in ET
  const hourET = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }).format(now),
  );
  const isMorningRush = hourET >= 6 && hourET < 9;
  const isOvernight = hourET >= 22 || hourET < 6;
  const selectorThreshold = isMorningRush ? 55 : isOvernight ? 80 : 65;
  return {
    nowET: now,
    isMorningRush,
    isOvernight,
    selectorThreshold,
    budgetRemaining: 0, // filled in async below
    isHalted: false,
    dryRun: DRY,
  };
}

async function main() {
  const startedAt = new Date();
  const ctx = buildContext();
  ctx.budgetRemaining = await getRemainingBudget(ctx.nowET);
  ctx.isHalted = await isHalted(ctx.nowET);

  console.log(`──────────────────────────────────────────────`);
  console.log(`Article I pipeline cycle @ ${ctx.nowET.toISOString()}`);
  console.log(`  ET hour: ${ctx.nowET.toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
  console.log(`  Mode: morning-rush=${ctx.isMorningRush} overnight=${ctx.isOvernight}`);
  console.log(`  Selector threshold: ${ctx.selectorThreshold}/100`);
  console.log(`  Budget: $${ctx.budgetRemaining.toFixed(4)} remaining (cap $${DAILY_CAP_USD.toFixed(2)}/day)`);
  console.log(`  Halted: ${ctx.isHalted}`);
  console.log(`  Dry run: ${ctx.dryRun}`);
  console.log(`  Draft mode: ${DRAFT}`);
  console.log(``);

  // ── 1. Aggregate ──────────────────────────────────────
  const lookbackHours = ctx.isMorningRush ? 6 : 4;
  console.log(`[aggregate] Lookback: ${lookbackHours}h`);
  const items = await aggregate({ lookbackHours });
  console.log(`[aggregate] Got ${items.length} fresh items`);

  // ── 2. Dedupe ─────────────────────────────────────────
  const fresh = await filterUnseen(items, ctx.nowET);
  console.log(`[dedupe] ${fresh.length} new (out of ${items.length})`);
  if (fresh.length === 0) {
    console.log(`No new items. Cycle complete.`);
    return;
  }

  // Mark all as seen now — even unselected ones are "considered" so we don't
  // re-cover them in subsequent cycles.
  await markProcessed(fresh, ctx.nowET);

  // ── 3. Selector ───────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set in environment');
  const client = new Anthropic({ apiKey });

  // Cap candidates we send to selector to top 60 by recency.
  const candidates = fresh.slice(0, 60);
  console.log(`[select] Sending ${candidates.length} candidates to selector...`);
  const selectorOut = await selectStories(client, candidates, ctx);
  const selected = selectorOut.selections.filter((s) => s.decision === 'select');
  console.log(`[select] ${selected.length} selected; ${selectorOut.selections.length - selected.length} skipped`);
  console.log(`[select] log: ${selectorOut.log}`);
  for (const s of selected) {
    console.log(`  • [${s.score}] ${s.format}/${s.voice}/${s.race_level}  — ${s.reason}`);
  }

  if (ctx.dryRun) {
    console.log(`Dry run — stopping before generation.`);
    return;
  }

  if (selected.length === 0) {
    console.log(`Nothing met the bar. Cycle complete.`);
    return;
  }

  // ── 4. Generate (one post per selection, halt on budget) ─────
  let id = await nextId();
  const written: string[] = [];
  for (const sel of selected) {
    if (await isHalted(ctx.nowET)) {
      console.log(`[generate] Budget cap hit — halting remaining generations.`);
      break;
    }
    const item = candidates.find((c) => c.hash === sel.itemHash);
    if (!item) {
      console.log(`[generate] No item matches hash ${sel.itemHash}; skipping.`);
      continue;
    }
    try {
      // Always fetch the source article, regardless of depth. The marginal
      // cost (~$0.007 extra per wire post) is worth it: every post needs to
      // be substantive enough to make the reader the most-informed person
      // in the room. Skipping the fetch on wire-depth was costing us quotes,
      // specific names, numbers, and dates — the receipts that make a brief
      // useful instead of just paraphrase-of-summary.
      console.log(`[fetch] ${item.url.slice(0, 90)}`);
      const article = await fetchArticle(item.url);
      if (article) {
        console.log(`[fetch]   → ${article.length} chars extracted${article.byline ? ` · by ${article.byline}` : ''}`);
      } else {
        console.log(`[fetch]   ✗ extraction failed; proceeding with RSS summary only`);
      }
      const depthLabel = sel.depth ?? 'analysis';
      console.log(`[generate] Writing ${sel.format}/${depthLabel}: ${item.title.slice(0, 80)}…`);
      const post = await generatePost(client, sel, item, ctx, article?.text ?? null);
      const filePath = await writePostMarkdown({
        draftMode: DRAFT,
        feedItem: item,
        post,
        itemDate: item.publishedAt,
        id,
      });
      console.log(`[generate]   → wrote ${filePath}`);
      written.push(filePath);
      id++;
    } catch (err: any) {
      console.error(`[generate]   ✗ failed: ${err?.message ?? err}`);
    }
  }

  // ── 5. Telemetry footer ───────────────────────────────
  const remainingAfter = await getRemainingBudget(ctx.nowET);
  const elapsedMs = Date.now() - startedAt.getTime();
  console.log(``);
  console.log(`Cycle complete in ${(elapsedMs / 1000).toFixed(1)}s.`);
  console.log(`  Posts written: ${written.length}`);
  console.log(`  Budget remaining: $${remainingAfter.toFixed(4)}`);
}

main().catch((err) => {
  console.error('Pipeline crashed:', err);
  process.exit(1);
});
