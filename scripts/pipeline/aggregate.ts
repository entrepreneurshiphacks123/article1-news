// Article I — RSS aggregator.
// Pulls all sources in parallel, returns FeedItems with hashes for dedupe.

import Parser from 'rss-parser';
import type { FeedItem } from './types.js';
import { hashUrl } from './dedupe.js';
import { SOURCES, type Source } from './sources.js';

const parser = new Parser({
  timeout: 12000,
  headers: { 'User-Agent': 'Article1Bot/0.1 (+https://article1.news)' },
});

const stripHtml = (s: string): string =>
  s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

async function fetchSource(src: Source, sinceMs: number): Promise<FeedItem[]> {
  try {
    const feed = await parser.parseURL(src.url);
    const items: FeedItem[] = [];
    for (const item of feed.items ?? []) {
      const link = item.link ?? item.guid;
      const title = item.title ?? '';
      if (!link || !title) continue;
      const pubMs = item.isoDate ? new Date(item.isoDate).getTime() : Date.now();
      if (pubMs < sinceMs) continue;
      const summary = stripHtml(item.contentSnippet ?? item.content ?? item.summary ?? '').slice(0, 800);
      items.push({
        source: src.name,
        outlet: src.name,
        url: link,
        title: stripHtml(title),
        summary,
        publishedAt: new Date(pubMs),
        hash: hashUrl(link),
      });
    }
    return items;
  } catch (err: any) {
    console.error(`[aggregator] ${src.name} failed: ${err?.message ?? err}`);
    return [];
  }
}

export async function aggregate(opts: { lookbackHours: number }): Promise<FeedItem[]> {
  const sinceMs = Date.now() - opts.lookbackHours * 3600 * 1000;
  const results = await Promise.all(SOURCES.map((src) => fetchSource(src, sinceMs)));
  const flat = results.flat();
  // Dedupe within this run (same story from multiple feeds)
  const seen = new Set<string>();
  const out: FeedItem[] = [];
  for (const item of flat) {
    if (seen.has(item.hash)) continue;
    seen.add(item.hash);
    out.push(item);
  }
  // Newest first
  out.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  return out;
}
