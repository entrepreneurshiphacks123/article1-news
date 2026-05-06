// Quick health check on all feed sources. Run via: npm run pipeline:check
// Reports which feeds are reachable, how many items each returned in the
// lookback window, and which are failing.

import { SOURCES } from './sources.js';
import Parser from 'rss-parser';

const parser = new Parser({
  timeout: 10000,
  headers: { 'User-Agent': 'Article1Bot/0.1 (+https://article1.news)' },
});

async function check(src: typeof SOURCES[number]): Promise<{ name: string; ok: boolean; items: number; error?: string }> {
  try {
    const feed = await parser.parseURL(src.url);
    return { name: src.name, ok: true, items: feed.items?.length ?? 0 };
  } catch (err: any) {
    return { name: src.name, ok: false, items: 0, error: err?.message ?? String(err) };
  }
}

async function main() {
  console.log(`Checking ${SOURCES.length} feeds…\n`);
  const results = await Promise.all(SOURCES.map(check));
  let ok = 0, fail = 0;
  for (const r of results) {
    if (r.ok) {
      ok++;
      console.log(`  ✓  ${r.name.padEnd(36)}  ${r.items} items`);
    } else {
      fail++;
      console.log(`  ✗  ${r.name.padEnd(36)}  ${r.error}`);
    }
  }
  console.log(`\n${ok} ok / ${fail} failed (${SOURCES.length} total)`);
}

main();
