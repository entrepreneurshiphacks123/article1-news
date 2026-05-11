// Article I — IG Feed image renderer (1080x1350 / 4:5).
//
// Counterpart to scripts/og-stories/render.ts. Same content/template
// language; different aspect ratio and slightly tighter layout. Output
// goes to public/og-feed/<slug>.png (single image) OR
// public/og-feed/<slug>-N.png (carousel: one file per non-meta slide).
//
// Carousel rule: post.type='carousel' renders 5 images by default — one
// per slide where kind is one of hook | context | pattern | stakes | watch.
// The 'sources' and 'cta' slides are SKIPPED for IG (they don't translate;
// sources go in the first comment on the IG post, and the CTA slide is a
// site-only colophon). Each carousel image gets a "N / M" counter pill in
// the top-right corner so the brand identity holds across the carousel.
//
// Run via:  npm run og:feed                  (renders posts missing an image)
//           npm run og:feed -- --all         (re-renders every post)
//           npm run og:feed -- --since=4h    (only posts from the last 4h
//                                             — matches GHA cycle window)

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
const OUT_DIR = path.join(SITE_ROOT, 'public', 'og-feed');
const TEMPLATE = path.join(__dirname, 'template.html');
const RENDER_DIR = path.join(SITE_ROOT, '.og-feed-render');
const CHROME_SCRATCH = path.join(SITE_ROOT, '.og-chrome-scratch');

const argv = process.argv.slice(2);
const args = new Set(argv);
const RENDER_ALL = args.has('--all');

const SINCE_FLAG = argv.find((a) => a.startsWith('--since='));
const SINCE_MS: number | null = SINCE_FLAG
  ? (() => {
      const v = SINCE_FLAG.slice('--since='.length).trim();
      const m = v.match(/^(\d+)\s*([hd])?$/i);
      if (!m) {
        console.warn(`[og:feed] --since must be like '4h' or '2d'; got '${v}' — ignoring.`);
        return null;
      }
      const n = parseInt(m[1], 10);
      const unit = (m[2] ?? 'h').toLowerCase();
      return unit === 'd' ? n * 24 * 3600 * 1000 : n * 3600 * 1000;
    })()
  : null;

const CONCURRENCY = 4;
const CHROME_TIMEOUT_MS = 30_000;

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];
async function findChrome(): Promise<string> {
  for (const p of CHROME_CANDIDATES) {
    try { await fs.access(p); return p; } catch {}
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

function firstSentence(text: string, maxChars = 220): string {
  if (!text) return '';
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const m = cleaned.match(/^.{40,}?[.!?]/);
  const out = m ? m[0] : cleaned.slice(0, maxChars);
  return out.length > maxChars ? out.slice(0, maxChars).replace(/\s+\S*$/, '') + '…' : out;
}

function renderEyebrow(post: PostFront, slideKind?: string): string {
  // For carousels we use the slide-kind as the eyebrow label so the slide
  // tells the reader what beat they're on (hook / context / pattern / etc).
  if (post.type === 'carousel' && slideKind) {
    return `<span class="label red">${slideKind.charAt(0).toUpperCase() + slideKind.slice(1)}</span>`;
  }
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

function renderMain(post: PostFront, slideBody?: string): string {
  // Carousel slide path — render the slide body as a large excerpt.
  // The first slide ALSO renders the headline as the top of the carousel
  // so the user knows what story this is.
  if (post.type === 'carousel' && slideBody !== undefined) {
    return `<p class="excerpt" style="font-size:42px;line-height:1.32;font-style:normal;color:var(--ink);text-wrap:pretty;max-width:920px;">${escapeHtml(slideBody)}</p>`;
  }

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
      <p class="excerpt" style="margin-top:18px;font-size:24px;color:var(--ink-3);">— ${escapeHtml(post.headline_card.outlet)}</p>`;
  }

  // static / cartoon — headline + excerpt
  let excerpt = '';
  if (post.body) excerpt = firstSentence(post.body);
  return `${headlineHtml}${excerpt ? `<p class="excerpt">${escapeHtml(excerpt)}</p>` : ''}`;
}

function renderSourceLine(post: PostFront): string {
  return `Source: <span class="outlet">${escapeHtml(post.source.outlet)}</span>`;
}

function renderSlideCounter(idx: number, total: number): string {
  return total > 1 ? `${String(idx + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}` : '';
}

async function buildPerSlideHtml(
  post: PostFront,
  options: { slideBody?: string; slideKind?: string; idx?: number; total?: number } = {},
): Promise<string> {
  const template = await fs.readFile(TEMPLATE, 'utf8');
  const eyebrow = renderEyebrow(post, options.slideKind);
  const main = renderMain(post, options.slideBody);
  const sourceLine = renderSourceLine(post);
  const counter = options.idx !== undefined && options.total !== undefined
    ? renderSlideCounter(options.idx, options.total)
    : '';

  return template
    .replace(/<span class="slide-counter" id="slide-counter"><\/span>/, `<span class="slide-counter">${counter}</span>`)
    .replace(/<div class="eyebrow" id="eyebrow"><\/div>/, `<div class="eyebrow">${eyebrow}</div>`)
    .replace(/<main id="main">[\s\S]*?<\/main>/, `<main>${main}</main>`)
    .replace(/<div class="source-line" id="source-line"><\/div>/, `<div class="source-line">${sourceLine}</div>`);
}

async function startStaticServer(rootDir: string, port = 8768): Promise<{ stop: () => Promise<void> }> {
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

async function chromeShot(chrome: string, url: string, outFile: string): Promise<void> {
  await fs.mkdir(CHROME_SCRATCH, { recursive: true });
  const tmp = await fs.mkdtemp(path.join(CHROME_SCRATCH, 'chrome-'));
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(chrome, [
        '--headless=new',
        '--hide-scrollbars',
        '--disable-gpu',
        '--no-sandbox',
        `--user-data-dir=${tmp}`,
        '--window-size=1080,1350',
        `--screenshot=${outFile}`,
        '--virtual-time-budget=2500',
        url,
      ], { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      const timer = setTimeout(async () => {
        try { proc.kill('SIGKILL'); } catch {}
        try {
          const stat = await fs.stat(outFile);
          if (stat.size > 0) return resolve();
        } catch {}
        reject(new Error(`Chrome timed out after ${CHROME_TIMEOUT_MS}ms`));
      }, CHROME_TIMEOUT_MS);
      proc.on('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) return resolve();
        fs.stat(outFile).then((s) => {
          if (s.size > 0) resolve();
          else reject(new Error(`Chrome exited ${code}: ${stderr.split('\n').filter((l) => !l.includes('ERROR:net')).slice(-3).join(' | ')}`));
        }).catch(() => {
          reject(new Error(`Chrome exited ${code}: ${stderr.split('\n').filter((l) => !l.includes('ERROR:net')).slice(-3).join(' | ')}`));
        });
      });
      proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    });
  } finally {
    fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

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

// Slide kinds we render as IG-carousel images. 'sources' goes in the
// first comment of the IG post; 'cta' is the in-site colophon, not for IG.
const CAROUSEL_SLIDE_KINDS = new Set(['hook', 'context', 'pattern', 'stakes', 'watch']);

interface RenderTask {
  slug: string;
  post: PostFront;
  htmlFile: string;       // filename inside RENDER_DIR
  outPath: string;        // absolute path inside OUT_DIR
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

  const tasks: RenderTask[] = [];
  let agedOut = 0;

  for (const f of files) {
    const slug = f.replace(/\.md$/, '');
    const raw = await fs.readFile(path.join(POSTS_DIR, f), 'utf8');
    const fm = matter(raw);
    const post = fm.data as PostFront;
    if (!post?.headline) continue;

    if (cutoff !== null) {
      const postMs = new Date(post.date as unknown as string).getTime();
      if (!Number.isFinite(postMs) || postMs < cutoff) { agedOut++; continue; }
    }

    if (post.type === 'carousel') {
      const visibleSlides = (post.slides ?? []).filter((s) => CAROUSEL_SLIDE_KINDS.has(s.kind));
      for (let i = 0; i < visibleSlides.length; i++) {
        const outPath = path.join(OUT_DIR, `${slug}-${i + 1}.png`);
        if (!RENDER_ALL) {
          try { await fs.access(outPath); continue; } catch {}
        }
        const slide = visibleSlides[i];
        const htmlName = `${slug}-${i + 1}.html`;
        const html = await buildPerSlideHtml(post, {
          slideBody: slide.body,
          slideKind: slide.kind,
          idx: i,
          total: visibleSlides.length,
        });
        await fs.writeFile(path.join(RENDER_DIR, htmlName), html);
        tasks.push({ slug, post, htmlFile: htmlName, outPath });
      }
    } else {
      const outPath = path.join(OUT_DIR, `${slug}.png`);
      if (!RENDER_ALL) {
        try { await fs.access(outPath); continue; } catch {}
      }
      const htmlName = `${slug}.html`;
      const html = await buildPerSlideHtml(post);
      await fs.writeFile(path.join(RENDER_DIR, htmlName), html);
      tasks.push({ slug, post, htmlFile: htmlName, outPath });
    }
  }

  if (agedOut > 0) console.log(`Skipped ${agedOut} post(s) older than the --since cutoff.`);

  if (tasks.length === 0) {
    console.log('Nothing to render.');
    return;
  }
  console.log(`Rendering ${tasks.length} feed image(s)…`);

  const server = await startStaticServer(RENDER_DIR, 8768);

  let ok = 0, failed = 0;
  console.log(`Concurrency: ${CONCURRENCY}`);
  await runWithConcurrency(tasks, CONCURRENCY, async (t, i) => {
    const url = `http://127.0.0.1:8768/${t.htmlFile}`;
    try {
      await chromeShot(chrome, url, t.outPath);
      const stat = await fs.stat(t.outPath);
      console.log(`  ✓ [${i + 1}/${tasks.length}] ${path.basename(t.outPath)}  (${stat.size} bytes)`);
      ok++;
    } catch (err: any) {
      console.error(`  ✗ [${i + 1}/${tasks.length}] ${path.basename(t.outPath)}  ${err?.message ?? err}`);
      failed++;
    }
  });

  await server.stop();
  await fs.rm(RENDER_DIR, { recursive: true, force: true }).catch(() => {});
  await fs.rm(CHROME_SCRATCH, { recursive: true, force: true }).catch(() => {});

  console.log(`Done. ${ok} rendered, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('feed renderer crashed:', err);
  process.exit(1);
});
