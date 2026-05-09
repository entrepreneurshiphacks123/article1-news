// Article I — story-image renderer.
//
// For each post in src/content/posts/, generate a 1080×1920 PNG suitable
// for sharing to Instagram Stories (and 9:16 surfaces generally). Output
// goes to public/og-stories/<slug>.png so it's served at /og-stories/<slug>.png.
//
// Renderer strategy: write a tiny self-contained HTML file (template.html
// with format-specific main content patched in), launch headless Chrome,
// screenshot the page, save to public/og-stories/.
//
// Run via:  npm run og:stories                 (renders posts missing an image)
//           npm run og:stories -- --all        (re-renders every post)
//           npm run og:stories -- --since=4h   (only posts whose date is within
//                                              the last 4h — used by GHA to keep
//                                              cycle time bounded; we don't
//                                              backfill old posts.)

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import http from 'http';
import matter from 'gray-matter';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SITE_ROOT = path.resolve(__dirname, '..', '..');
const POSTS_DIR = path.join(SITE_ROOT, 'src', 'content', 'posts');
const OUT_DIR = path.join(SITE_ROOT, 'public', 'og-stories');
const TEMPLATE = path.join(__dirname, 'template.html');
const RENDER_DIR = path.join(SITE_ROOT, '.og-stories-render');  // gitignored, holds per-post HTML for chrome to fetch

const argv = process.argv.slice(2);
const args = new Set(argv);
const RENDER_ALL = args.has('--all');

// Parse --since=<N>h flag. When set, only posts whose `date` frontmatter is
// within the last N hours are rendered. GHA passes this so the per-cycle
// renderer never tries to backfill 200+ historical posts (which would blow
// past the 12-min step timeout).
const SINCE_FLAG = argv.find((a) => a.startsWith('--since='));
const SINCE_MS: number | null = SINCE_FLAG
  ? (() => {
      const v = SINCE_FLAG.slice('--since='.length).trim();
      const m = v.match(/^(\d+)\s*([hd])?$/i);
      if (!m) {
        console.warn(`[og:stories] --since must be like '4h' or '2d'; got '${v}' — ignoring.`);
        return null;
      }
      const n = parseInt(m[1], 10);
      const unit = (m[2] ?? 'h').toLowerCase();
      return unit === 'd' ? n * 24 * 3600 * 1000 : n * 3600 * 1000;
    })()
  : null;

// Resolve Chrome binary across macOS variants.
const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];
async function findChrome(): Promise<string> {
  for (const p of CHROME_CANDIDATES) {
    try {
      await fs.access(p);
      return p;
    } catch {}
  }
  throw new Error(`No Chrome binary found in ${CHROME_CANDIDATES.join(', ')}`);
}

type FormatType = 'static' | 'carousel' | 'quote' | 'numbers' | 'headline' | 'cartoon';

interface PostFront {
  id: number;
  type: FormatType;
  date: string;
  headline: string;
  source: { outlet: string; url?: string };
  body?: string;
  slides?: { kind: string; body: string }[];
  quote?: { text: string; speaker: string; speaker_title?: string };
  numbers?: { value: string; unit?: string; body: string };
  headline_card?: { text: string; outlet: string };
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function pickHeadlineSizeClass(headline: string): string {
  const len = headline.length;
  if (len > 80) return 'very-long';
  if (len > 55) return 'long';
  return '';
}

function firstSentence(text: string, maxChars = 240): string {
  if (!text) return '';
  const cleaned = text.replace(/\s+/g, ' ').trim();
  // Try to break at sentence end
  const m = cleaned.match(/^.{40,}?[.!?]/);
  const out = m ? m[0] : cleaned.slice(0, maxChars);
  return out.length > maxChars ? out.slice(0, maxChars).replace(/\s+\S*$/, '') + '…' : out;
}

function renderEyebrow(post: PostFront): string {
  switch (post.type) {
    case 'carousel':
      return `<span class="label red">${(post.slides ?? []).length} slides</span>`;
    case 'quote':
      return `<span class="label red">Quote of the Day</span>`;
    case 'numbers':
      return `<span class="label">Numbers of the Day</span>`;
    case 'headline':
      return `<span class="label">Headline of the Day</span>`;
    case 'cartoon':
      return `<span class="label">Cartoon of the Day</span>`;
    default:
      return `<span class="label">Brief</span>`;
  }
}

function renderMain(post: PostFront): string {
  const headlineClass = pickHeadlineSizeClass(post.headline);
  const headlineHtml = `<h1 class="headline ${headlineClass}">${escapeHtml(post.headline)}</h1>`;

  if (post.type === 'quote' && post.quote) {
    return `${headlineHtml}
      <div class="quote-block">
        <p class="quote-text">"${escapeHtml(post.quote.text)}"</p>
        <div class="quote-attrib">
          <span class="quote-speaker">— ${escapeHtml(post.quote.speaker)}</span>${post.quote.speaker_title ? `<br>${escapeHtml(post.quote.speaker_title)}` : ''}
        </div>
      </div>`;
  }

  if (post.type === 'numbers' && post.numbers) {
    return `<div class="numbers-value">${escapeHtml(post.numbers.value)}</div>
      ${post.numbers.unit ? `<div class="numbers-unit">${escapeHtml(post.numbers.unit)}</div>` : ''}
      ${headlineHtml}
      <p class="numbers-body">${escapeHtml(post.numbers.body)}</p>`;
  }

  if (post.type === 'headline' && post.headline_card) {
    return `${headlineHtml}
      <p class="excerpt">"${escapeHtml(post.headline_card.text)}"</p>
      <p class="excerpt" style="margin-top:24px;font-size:30px;color:var(--ink-3);">— ${escapeHtml(post.headline_card.outlet)}</p>`;
  }

  // static / carousel / cartoon — headline + excerpt
  let excerpt = '';
  if (post.body) excerpt = firstSentence(post.body);
  else if (post.slides && post.slides[0]) excerpt = firstSentence(post.slides[0].body);

  return `${headlineHtml}${excerpt ? `<p class="excerpt">${escapeHtml(excerpt)}</p>` : ''}`;
}

function renderSourceLine(post: PostFront): string {
  return `Source: <span class="outlet">${escapeHtml(post.source.outlet)}</span>`;
}

async function buildPerPostHtml(post: PostFront, slug: string): Promise<string> {
  const template = await fs.readFile(TEMPLATE, 'utf8');
  const eyebrow = renderEyebrow(post);
  const main = renderMain(post);
  const sourceLine = renderSourceLine(post);

  return template
    .replace(/<div class="eyebrow" id="eyebrow"><\/div>/, `<div class="eyebrow">${eyebrow}</div>`)
    .replace(/<main id="main">[\s\S]*?<\/main>/, `<main>${main}</main>`)
    .replace(/<div class="source-line" id="source-line"><\/div>/, `<div class="source-line">${sourceLine}</div>`);
}

async function startStaticServer(rootDir: string, port = 8765): Promise<{ stop: () => Promise<void> }> {
  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url ?? '/', `http://localhost:${port}`);
      let p = decodeURIComponent(u.pathname);
      if (p === '/' || p === '') p = '/index.html';
      const full = path.join(rootDir, p);
      if (!full.startsWith(rootDir)) { res.writeHead(403); res.end('forbidden'); return; }
      const data = await fs.readFile(full);
      const ct = full.endsWith('.html') ? 'text/html; charset=utf-8'
        : full.endsWith('.css') ? 'text/css'
        : full.endsWith('.png') ? 'image/png'
        : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'no-store' });
      res.end(data);
    } catch (err) {
      res.writeHead(404); res.end('not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', () => resolve()));
  return {
    stop: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

// Use a dedicated scratch dir for Chrome user-data-dirs (NOT in public/og-stories/).
const CHROME_SCRATCH = path.join(SITE_ROOT, '.og-chrome-scratch');

// Hard kill any Chrome that doesn't return a screenshot within 30s. Chrome
// occasionally hangs on first launch (font loading, profile setup) and a hung
// process blocks the concurrency slot indefinitely. 30s is far above the
// observed median render time (~3-5s) but well below the GHA step timeout.
const CHROME_TIMEOUT_MS = 30_000;

async function chromeShot(chrome: string, url: string, outFile: string): Promise<void> {
  await fs.mkdir(CHROME_SCRATCH, { recursive: true });
  // Each call uses an isolated user-data-dir so concurrent invocations don't
  // fight over locks.
  const tmp = await fs.mkdtemp(path.join(CHROME_SCRATCH, 'chrome-'));
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(chrome, [
        '--headless=new',
        '--hide-scrollbars',
        '--disable-gpu',
        '--no-sandbox',  // required on GHA runners; harmless locally
        `--user-data-dir=${tmp}`,
        '--window-size=1080,1920',
        `--screenshot=${outFile}`,
        '--virtual-time-budget=2500',
        url,
      ], { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      // Chrome writes the PNG synchronously after the screenshot capture,
      // but its post-screenshot cleanup can hang for 10-30s on macOS. We
      // SIGKILL on timeout and then check whether the screenshot already
      // landed — if it did, the shot is a success even though Chrome never
      // exited cleanly.
      const timer = setTimeout(async () => {
        try { proc.kill('SIGKILL'); } catch { /* already gone */ }
        try {
          const stat = await fs.stat(outFile);
          if (stat.size > 0) return resolve();
        } catch { /* fall through to reject */ }
        reject(new Error(`Chrome timed out after ${CHROME_TIMEOUT_MS}ms`));
      }, CHROME_TIMEOUT_MS);
      proc.on('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) return resolve();
        // Even on non-zero exit, the PNG might have landed (SIGKILL paths,
        // SIGTERM from CI). Check the file before rejecting.
        fs.stat(outFile).then((s) => {
          if (s.size > 0) resolve();
          else reject(new Error(`Chrome exited ${code}: ${stderr.split('\n').filter((l) => !l.includes('ERROR:net')).slice(-3).join(' | ')}`));
        }).catch(() => {
          reject(new Error(`Chrome exited ${code}: ${stderr.split('\n').filter((l) => !l.includes('ERROR:net')).slice(-3).join(' | ')}`));
        });
      });
      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  } finally {
    fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

const CONCURRENCY = Number(process.env.OG_STORIES_CONCURRENCY ?? '4');

async function runWithConcurrency<T>(items: T[], n: number, fn: (item: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(n, items.length); w++) {
    workers.push((async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) break;
        await fn(items[i], i);
      }
    })());
  }
  await Promise.all(workers);
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(RENDER_DIR, { recursive: true });

  const chrome = await findChrome();
  console.log(`Using Chrome: ${chrome}`);

  const files = (await fs.readdir(POSTS_DIR)).filter((f) => f.endsWith('.md'));
  console.log(`Found ${files.length} posts.`);
  if (SINCE_MS !== null) {
    const hours = (SINCE_MS / 3600000).toFixed(0);
    console.log(`Filter: only posts within the last ${hours}h (--since flag).`);
  }
  const cutoff = SINCE_MS !== null ? Date.now() - SINCE_MS : null;

  // Decide which to render.
  const tasks: Array<{ slug: string; post: PostFront; htmlPath: string; outPath: string }> = [];
  let agedOut = 0;
  for (const f of files) {
    const slug = f.replace(/\.md$/, '');
    const outPath = path.join(OUT_DIR, `${slug}.png`);
    if (!RENDER_ALL) {
      try { await fs.access(outPath); continue; } catch { /* needs render */ }
    }
    const raw = await fs.readFile(path.join(POSTS_DIR, f), 'utf8');
    const fm = matter(raw);
    const post = fm.data as PostFront;
    if (!post?.headline) continue;
    // Age filter — applied after we've loaded frontmatter so we know `date`.
    if (cutoff !== null) {
      const postMs = new Date(post.date as unknown as string).getTime();
      if (!Number.isFinite(postMs) || postMs < cutoff) {
        agedOut++;
        continue;
      }
    }
    const html = await buildPerPostHtml(post, slug);
    const htmlPath = path.join(RENDER_DIR, `${slug}.html`);
    await fs.writeFile(htmlPath, html);
    tasks.push({ slug, post, htmlPath, outPath });
  }
  if (agedOut > 0) console.log(`Skipped ${agedOut} post(s) older than the --since cutoff.`);

  if (tasks.length === 0) {
    console.log('Nothing to render.');
    return;
  }
  console.log(`Rendering ${tasks.length} story image(s)…`);

  // Serve RENDER_DIR over HTTP so Chrome can fetch the per-post HTML.
  // (file:// works but image references like our parchment-only design have
  // no local images, so http://127.0.0.1 is fine and simpler.)
  const server = await startStaticServer(RENDER_DIR, 8766);

  let ok = 0, failed = 0;
  console.log(`Concurrency: ${CONCURRENCY}`);
  await runWithConcurrency(tasks, CONCURRENCY, async (t, i) => {
    const url = `http://127.0.0.1:8766/${t.slug}.html`;
    try {
      await chromeShot(chrome, url, t.outPath);
      const stat = await fs.stat(t.outPath);
      console.log(`  ✓ [${i + 1}/${tasks.length}] ${t.slug}  (${stat.size} bytes)`);
      ok++;
    } catch (err: any) {
      console.error(`  ✗ [${i + 1}/${tasks.length}] ${t.slug}  ${err?.message ?? err}`);
      failed++;
    }
  });

  await server.stop();

  // Cleanup: scratch dirs
  await fs.rm(RENDER_DIR, { recursive: true, force: true }).catch(() => {});
  await fs.rm(CHROME_SCRATCH, { recursive: true, force: true }).catch(() => {});

  console.log(`Done. ${ok} rendered, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('renderer crashed:', err);
  process.exit(1);
});
