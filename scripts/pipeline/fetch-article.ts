// Article I — full-article fetcher.
// Selector picks ~3 stories per cycle. For each one, we go fetch the actual
// article page and extract the main content via Mozilla Readability. The
// generator then has the full body — quotes, sources, paragraph structure —
// instead of a 200-char RSS summary. This is what lets us produce
// Political-Wire-grade briefs with direct quotes rather than summaries-of-
// summaries.

import { JSDOM, VirtualConsole } from 'jsdom';
import { Readability } from '@mozilla/readability';

const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_CHARS = 8_000; // cap article text to keep generator input token cost bounded

export interface FetchedArticle {
  url: string;
  title?: string;
  byline?: string;
  excerpt?: string;
  text: string;
  siteName?: string;
  length: number;
}

export async function fetchArticle(
  url: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<FetchedArticle | null> {
  let html: string;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const resp = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Article1Bot/0.1 (+https://article1.news; bot@article1.news)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const ct = resp.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml/i.test(ct)) return null;
    html = await resp.text();
  } catch {
    return null;
  }

  // Silence jsdom's CSS / resource warnings — they spam stderr on real pages.
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('error', () => {});
  virtualConsole.on('warn', () => {});
  virtualConsole.on('log', () => {});

  let dom: JSDOM;
  try {
    dom = new JSDOM(html, { url, virtualConsole });
  } catch {
    return null;
  }

  let parsed;
  try {
    const reader = new Readability(dom.window.document);
    parsed = reader.parse();
  } catch {
    parsed = null;
  } finally {
    dom.window.close();
  }

  if (!parsed || !parsed.textContent) return null;

  const text = parsed.textContent
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (text.length < 200) return null; // too short to be useful

  return {
    url,
    title: parsed.title ?? undefined,
    byline: parsed.byline ?? undefined,
    excerpt: parsed.excerpt ?? undefined,
    text: text.slice(0, MAX_CHARS),
    siteName: parsed.siteName ?? undefined,
    length: parsed.length ?? text.length,
  };
}
