// Article I — IG digest poster.
//
// Posts scheduled Instagram digests at 7am / 4pm / 7pm ET:
//   - IG Feed: carousel of top stories for the time window
//   - IG Story: single-slide headline rundown (same stories)
//
// Two phases (run separately in GHA — images must be on CDN before posting):
//   --phase=render   Select stories, render PNGs, save pending state
//   --phase=post     Read pending state, post to IG, save posted state
//
// Slot is auto-detected from ET time or overridden with --slot=morning|afternoon|evening.
// The GHA workflow fires at 11:xx / 12:xx / 20:xx / 21:xx / 23:xx / 00:xx UTC
// to cover both DST and standard time.
//
// Output files:
//   public/og-feed/digest-{slot}-{YYYY-MM-DD}-{N}.png  (N=1..slideCount)
//   public/og-stories/digest-{slot}-{YYYY-MM-DD}.png
//
// State:
//   state/digest-pending.json   — set by --phase=render, cleared by --phase=post
//   state/digest-posted.json    — permanent record of posted digests

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import http from 'http';
import matter from 'gray-matter';

import {
  postFeedImage,
  postFeedCarousel,
  postStory,
  type InstagramConfig,
} from './instagram.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SITE_ROOT = path.resolve(__dirname, '..', '..');
const POSTS_DIR = path.join(SITE_ROOT, 'src', 'content', 'posts');
const FEED_OUT_DIR = path.join(SITE_ROOT, 'public', 'og-feed');
const STORY_OUT_DIR = path.join(SITE_ROOT, 'public', 'og-stories');
const RENDER_DIR = path.join(SITE_ROOT, '.og-digest-render');
const CHROME_SCRATCH = path.join(SITE_ROOT, '.og-chrome-scratch');
const PENDING_STATE_PATH = path.join(SITE_ROOT, 'state', 'digest-pending.json');
const POSTED_STATE_PATH = path.join(SITE_ROOT, 'state', 'digest-posted.json');
const CDN_BASE = 'https://article1.news';
const CHROME_TIMEOUT_MS = 30_000;

// ── CLI args ─────────────────────────────────────────────
const argv = process.argv.slice(2);
const argsSet = new Set(argv);
const DRY = argsSet.has('--dry');

const PHASE_FLAG = argv.find((a) => a.startsWith('--phase='));
const PHASE: 'render' | 'post' | 'both' = PHASE_FLAG
  ? (PHASE_FLAG.slice('--phase='.length).trim() as 'render' | 'post' | 'both')
  : 'both';

const SLOT_FLAG = argv.find((a) => a.startsWith('--slot='));
const SLOT_ARG = SLOT_FLAG ? SLOT_FLAG.slice('--slot='.length).trim() : 'auto';

const FORCE = argsSet.has('--force');  // ignore already-posted state

// ── Types ────────────────────────────────────────────────
type DigestSlot = 'morning' | 'afternoon' | 'evening';

interface DigestPost {
  slug: string;
  headline: string;
  outlet: string;
  date: string;
}

interface DigestPending {
  slot: DigestSlot;
  date: string;   // YYYY-MM-DD in ET
  posts: DigestPost[];
  feedFiles: string[];  // relative paths inside public/og-feed/
  storyFile: string;    // relative path inside public/og-stories/
  renderedAt: string;
}

interface DigestRecord {
  slot: DigestSlot;
  date: string;
  ig_feed?: string;
  ig_story?: string;
  slugs: string[];
  posted_at?: string;
  errors?: { platform: string; message: string; at: string }[];
}

type DigestPostedState = Record<string, DigestRecord>;  // key: "{date}-{slot}"

// ── ET time helpers ──────────────────────────────────────
function getETHour(date: Date): number {
  return parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      hour12: false,
    }).format(date),
    10,
  );
}

function getETDateStr(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const p: Record<string, string> = {};
  for (const part of parts) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}`;
}

function detectSlot(date: Date): DigestSlot | null {
  const hour = getETHour(date);
  // ±1h window around target — handles GHA cron delay
  if (hour >= 6 && hour <= 8) return 'morning';    // 7am ±1h
  if (hour >= 15 && hour <= 17) return 'afternoon'; // 4pm ±1h
  if (hour >= 18 && hour <= 20) return 'evening';   // 7pm ±1h
  return null;  // not in a digest window
}

// ── Slot window: how many hours back to look ─────────────
function lookbackHours(slot: DigestSlot): number {
  // morning (7am):    overnight window, 12h back covers 7pm → 7am
  // afternoon (4pm):  9h back covers 7am → 4pm
  // evening (7pm):    3h back covers 4pm → 7pm
  switch (slot) {
    case 'morning':   return 12;
    case 'afternoon': return 9;
    case 'evening':   return 3;
  }
}

function slotLabel(slot: DigestSlot): string {
  switch (slot) {
    case 'morning':   return 'MORNING DIGEST';
    case 'afternoon': return 'AFTERNOON DIGEST';
    case 'evening':   return 'EVENING DIGEST';
  }
}

// ── Post selection ────────────────────────────────────────
interface PostFront {
  id: number;
  type: string;
  date: string;
  headline: string;
  source: { outlet: string; url?: string };
  body?: string;
}

async function selectPostsForSlot(slot: DigestSlot, maxCount = 5): Promise<DigestPost[]> {
  const cutoffMs = Date.now() - lookbackHours(slot) * 3600 * 1000;
  const files = (await fs.readdir(POSTS_DIR)).filter((f) => f.endsWith('.md'));

  const candidates: { slug: string; post: PostFront; dateMs: number }[] = [];
  for (const f of files) {
    const slug = f.replace(/\.md$/, '');
    // Skip digest slugs
    if (slug.startsWith('digest-')) continue;
    const raw = await fs.readFile(path.join(POSTS_DIR, f), 'utf8');
    const fm = matter(raw);
    const post = fm.data as PostFront;
    if (!post?.headline) continue;
    const ms = new Date(post.date as unknown as string).getTime();
    if (!Number.isFinite(ms) || ms < cutoffMs) continue;
    candidates.push({ slug, post, dateMs: ms });
  }

  // Sort newest first, take top N
  candidates.sort((a, b) => b.dateMs - a.dateMs);
  return candidates.slice(0, maxCount).map(({ slug, post }) => ({
    slug,
    headline: post.headline,
    outlet: post.source?.outlet ?? 'Article I',
    date: post.date,
  }));
}

// ── Chrome rendering ──────────────────────────────────────
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

async function chromeShot(
  chrome: string,
  url: string,
  outFile: string,
  windowSize: string,
): Promise<void> {
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
        `--window-size=${windowSize}`,
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

async function startStaticServer(
  rootDir: string,
  port = 8770,
): Promise<{ stop: () => Promise<void> }> {
  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url ?? '/', `http://localhost:${port}`);
      let p = decodeURIComponent(u.pathname);
      if (p === '/' || p === '') p = '/index.html';
      const full = path.join(rootDir, p);
      if (!full.startsWith(rootDir)) { res.writeHead(403); res.end('forbidden'); return; }
      const data = await fs.readFile(full);
      const ct = full.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'no-store' });
      res.end(data);
    } catch {
      res.writeHead(404); res.end('not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', () => resolve()));
  return {
    stop: () => new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    ),
  };
}

// ── HTML generators ───────────────────────────────────────
const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const COMMON_FONTS = `
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700;1,8..60,400;1,8..60,600;1,8..60,700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />`;

const COMMON_VARS = `
  :root {
    --parchment: #FAFAF7;
    --ink: #1A1A1A;
    --ink-2: #4A4A47;
    --ink-3: #76736C;
    --red: #9B1C1C;
    --serif: 'Source Serif 4', 'Lora', Georgia, serif;
    --mono: 'JetBrains Mono', ui-monospace, Menlo, monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }`;

/** Feed carousel slide — 1080×1350 (4:5) */
function buildFeedSlideHtml(opts: {
  label: string;      // "MORNING DIGEST"
  dateStr: string;    // "May 14, 2026"
  slideType: 'cover' | 'story' | 'cta';
  slideIndex: number; // 1-based (for counter)
  totalSlides: number;
  storyNum?: number;  // 1-based story number (story slides only)
  headline?: string;
  outlet?: string;
}): string {
  const counterHtml = `<span style="
    position:absolute;top:72px;right:72px;
    font-family:var(--mono);font-size:16px;letter-spacing:0.16em;color:var(--ink-3);
  ">${String(opts.slideIndex).padStart(2, '0')} / ${String(opts.totalSlides).padStart(2, '0')}</span>`;

  let mainHtml = '';
  if (opts.slideType === 'cover') {
    mainHtml = `
      <div style="font-family:var(--mono);font-size:18px;letter-spacing:0.24em;text-transform:uppercase;color:var(--ink-3);margin-bottom:24px;">${escapeHtml(opts.label)}</div>
      <div style="font-family:var(--serif);font-weight:700;font-size:100px;line-height:0.95;letter-spacing:-0.02em;color:var(--red);font-style:italic;margin-bottom:32px;">Today</div>
      <div style="font-family:var(--serif);font-size:36px;color:var(--ink-2);font-style:italic;margin-bottom:48px;">${escapeHtml(opts.dateStr)}</div>
      <div style="font-family:var(--mono);font-size:22px;letter-spacing:0.14em;text-transform:uppercase;color:var(--ink);border:2px solid var(--ink);display:inline-block;padding:14px 28px;">Top Stories · Link in Bio</div>`;
  } else if (opts.slideType === 'story') {
    const numHtml = `<div style="font-family:var(--mono);font-size:22px;letter-spacing:0.20em;color:var(--red);margin-bottom:28px;">0${opts.storyNum ?? 1}</div>`;
    const sizeClass = (opts.headline?.length ?? 0) > 80 ? 48 : (opts.headline?.length ?? 0) > 55 ? 58 : 68;
    mainHtml = `
      ${numHtml}
      <h1 style="font-family:var(--serif);font-weight:700;font-size:${sizeClass}px;line-height:1.08;letter-spacing:-0.012em;color:var(--ink);text-wrap:balance;margin-bottom:40px;">${escapeHtml(opts.headline ?? '')}</h1>
      <div style="font-family:var(--mono);font-size:18px;letter-spacing:0.16em;text-transform:uppercase;color:var(--ink-3);">Source: <span style="color:var(--ink-2);font-weight:500;">${escapeHtml(opts.outlet ?? '')}</span></div>`;
  } else if (opts.slideType === 'cta') {
    mainHtml = `
      <div style="font-family:var(--serif);font-weight:700;font-size:72px;line-height:1.05;color:var(--ink);margin-bottom:32px;">Read more.</div>
      <div style="font-family:var(--serif);font-size:36px;font-style:italic;color:var(--ink-2);margin-bottom:48px;">All stories at article1.news</div>
      <div style="font-family:var(--mono);font-size:22px;letter-spacing:0.14em;text-transform:uppercase;color:var(--ink);border:2px solid var(--ink);display:inline-block;padding:14px 28px;">Link in Bio</div>`;
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8">${COMMON_FONTS}
<style>
${COMMON_VARS}
html, body { width: 1080px; height: 1350px; overflow: hidden; }
body {
  background: var(--parchment);
  font-family: var(--serif);
  color: var(--ink);
  display: flex;
  flex-direction: column;
  padding: 80px 72px 88px;
  position: relative;
}
header { margin-bottom: 48px; }
.top-rule { width:100%;height:4px;border-top:1px solid var(--ink);border-bottom:1px solid var(--ink);margin-bottom:32px; }
.brand-mark { font-family:var(--serif);font-weight:700;letter-spacing:0.01em;line-height:0.92;display:inline-flex;align-items:baseline;color:var(--ink);font-size:54px; }
.brand-mark .word { letter-spacing:0.02em; }
.brand-mark .roman { color:var(--red);font-style:italic;margin-left:0.08em;position:relative;top:0.06em;font-size:80px; }
main { flex:1;display:flex;flex-direction:column;justify-content:flex-start; }
footer { margin-top:auto; }
.bottom-rule { width:100%;height:4px;border-top:1px solid var(--ink);border-bottom:1px solid var(--ink);margin-bottom:24px; }
.footer-row { display:flex;align-items:baseline;justify-content:space-between;font-family:var(--mono);font-size:18px;letter-spacing:0.18em;text-transform:uppercase;color:var(--ink-3); }
.footer-row .domain { color:var(--ink);font-weight:500; }
.footer-row .tagline { font-family:var(--serif);font-style:italic;font-size:18px;letter-spacing:0;text-transform:none;color:var(--ink-2); }
</style>
</head>
<body>
  ${counterHtml}
  <header>
    <div class="top-rule"></div>
    <span class="brand-mark"><span class="word">Article</span><span class="roman">I</span></span>
  </header>
  <main>${mainHtml}</main>
  <footer>
    <div class="bottom-rule"></div>
    <div class="footer-row">
      <span class="domain">article1.news</span>
      <span class="tagline">Constitution. Long memory.</span>
    </div>
  </footer>
</body></html>`;
}

/** Story single-slide — 1080×1920 (9:16) */
function buildStoryHtml(opts: {
  label: string;     // "MORNING DIGEST"
  dateStr: string;   // "May 14, 2026"
  posts: DigestPost[];
}): string {
  const storiesHtml = opts.posts.map((p, i) => `
    <div style="display:flex;align-items:flex-start;gap:20px;margin-bottom:30px;">
      <span style="font-family:var(--mono);font-size:20px;letter-spacing:0.12em;color:var(--red);min-width:36px;padding-top:6px;">0${i + 1}</span>
      <div>
        <div style="font-family:var(--serif);font-weight:700;font-size:36px;line-height:1.2;color:var(--ink);text-wrap:pretty;">${escapeHtml(p.headline)}</div>
        <div style="font-family:var(--mono);font-size:16px;letter-spacing:0.14em;text-transform:uppercase;color:var(--ink-3);margin-top:8px;">${escapeHtml(p.outlet)}</div>
      </div>
    </div>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8">${COMMON_FONTS}
<style>
${COMMON_VARS}
html, body { width: 1080px; height: 1920px; overflow: hidden; }
body {
  background: var(--parchment);
  font-family: var(--serif);
  color: var(--ink);
  display: flex;
  flex-direction: column;
  padding: 96px 88px;
  position: relative;
}
header { margin-bottom: 64px; }
.top-rule { width:100%;height:5px;border-top:1px solid var(--ink);border-bottom:1px solid var(--ink);margin-bottom:48px; }
.brand-mark { font-family:var(--serif);font-weight:700;letter-spacing:0.01em;line-height:0.92;display:inline-flex;align-items:baseline;color:var(--ink);font-size:72px; }
.brand-mark .word { letter-spacing:0.02em; }
.brand-mark .roman { color:var(--red);font-style:italic;margin-left:0.08em;position:relative;top:0.06em;font-size:108px; }
main { flex:1;display:flex;flex-direction:column;justify-content:flex-start; }
footer { margin-top:auto; }
.bottom-rule { width:100%;height:5px;border-top:1px solid var(--ink);border-bottom:1px solid var(--ink);margin-bottom:32px; }
.footer-row { display:flex;align-items:baseline;justify-content:space-between;font-family:var(--mono);font-size:22px;letter-spacing:0.18em;text-transform:uppercase;color:var(--ink-3); }
.footer-row .domain { color:var(--ink);font-weight:500; }
.footer-row .tagline { font-family:var(--serif);font-style:italic;font-size:22px;letter-spacing:0;text-transform:none;color:var(--ink-2); }
.link-in-bio-sticker {
  position:absolute;bottom:260px;right:88px;
  background:var(--parchment);border:6px solid var(--red);border-radius:10px;
  padding:22px 34px;font-family:var(--mono);font-size:34px;font-weight:700;
  letter-spacing:0.14em;text-transform:uppercase;color:var(--ink);
  transform:rotate(-3.5deg);box-shadow:0 12px 28px rgba(0,0,0,0.14);
  white-space:nowrap;z-index:2;
}
.link-in-bio-sticker .arrow { color:var(--red);margin-right:12px;display:inline-block;transform:translateY(-2px); }
</style>
</head>
<body>
  <div class="link-in-bio-sticker"><span class="arrow">↗</span>LINK IN BIO</div>
  <header>
    <div class="top-rule"></div>
    <span class="brand-mark"><span class="word">Article</span><span class="roman">I</span></span>
  </header>
  <main>
    <div style="font-family:var(--mono);font-size:18px;letter-spacing:0.24em;text-transform:uppercase;color:var(--ink-3);margin-bottom:16px;">${escapeHtml(opts.label)}</div>
    <div style="font-family:var(--serif);font-size:28px;font-style:italic;color:var(--ink-2);margin-bottom:52px;">${escapeHtml(opts.dateStr)}</div>
    <div style="width:100%;height:2px;background:var(--ink);margin-bottom:40px;"></div>
    ${storiesHtml}
  </main>
  <footer>
    <div class="bottom-rule"></div>
    <div class="footer-row">
      <span class="domain">article1.news</span>
      <span class="tagline">Constitution. Long memory.</span>
    </div>
  </footer>
</body></html>`;
}

// ── Format date for display ───────────────────────────────
function formatDateDisplay(dateStr: string): string {
  // dateStr is YYYY-MM-DD
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// ── State helpers ─────────────────────────────────────────
async function loadPostedState(): Promise<DigestPostedState> {
  try {
    const raw = await fs.readFile(POSTED_STATE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function savePostedState(state: DigestPostedState): Promise<void> {
  await fs.mkdir(path.dirname(POSTED_STATE_PATH), { recursive: true });
  await fs.writeFile(POSTED_STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

async function loadPending(): Promise<DigestPending | null> {
  try {
    const raw = await fs.readFile(PENDING_STATE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function savePending(pending: DigestPending): Promise<void> {
  await fs.mkdir(path.dirname(PENDING_STATE_PATH), { recursive: true });
  await fs.writeFile(PENDING_STATE_PATH, JSON.stringify(pending, null, 2) + '\n');
}

async function clearPending(): Promise<void> {
  await fs.rm(PENDING_STATE_PATH, { force: true });
}

// ── Phase: render ─────────────────────────────────────────
async function phaseRender(slot: DigestSlot, now: Date): Promise<void> {
  const dateStr = getETDateStr(now);
  const stateKey = `${dateStr}-${slot}`;

  // Check already posted
  if (!FORCE) {
    const posted = await loadPostedState();
    if (posted[stateKey]?.ig_feed) {
      console.log(`[digest:render] ${stateKey} already posted — skipping. Use --force to override.`);
      return;
    }
  }

  // Select posts
  const posts = await selectPostsForSlot(slot);
  if (posts.length === 0) {
    console.log(`[digest:render] No posts in window for ${slot} slot — skipping.`);
    return;
  }
  console.log(`[digest:render] ${slot} / ${dateStr}: ${posts.length} posts selected`);
  for (const p of posts) console.log(`  • ${p.headline.slice(0, 70)}`);

  if (DRY) {
    console.log(`[digest:render] DRY — would render ${posts.length + 2} feed slides + 1 story`);
    return;
  }

  const label = slotLabel(slot);
  const dateDisplay = formatDateDisplay(dateStr);
  const slugBase = `digest-${slot}-${dateStr}`;
  const totalSlides = posts.length + 2; // cover + N stories + CTA

  // Build feed slide HTML
  const feedSlides: { html: string; filename: string }[] = [];

  // Cover slide
  feedSlides.push({
    html: buildFeedSlideHtml({
      label, dateStr: dateDisplay,
      slideType: 'cover',
      slideIndex: 1, totalSlides,
    }),
    filename: `${slugBase}-1.html`,
  });

  // Story slides
  for (let i = 0; i < posts.length; i++) {
    feedSlides.push({
      html: buildFeedSlideHtml({
        label, dateStr: dateDisplay,
        slideType: 'story',
        slideIndex: i + 2, totalSlides,
        storyNum: i + 1,
        headline: posts[i].headline,
        outlet: posts[i].outlet,
      }),
      filename: `${slugBase}-${i + 2}.html`,
    });
  }

  // CTA slide
  feedSlides.push({
    html: buildFeedSlideHtml({
      label, dateStr: dateDisplay,
      slideType: 'cta',
      slideIndex: totalSlides, totalSlides,
    }),
    filename: `${slugBase}-${totalSlides}.html`,
  });

  // Story HTML
  const storyHtml = buildStoryHtml({ label, dateStr: dateDisplay, posts });
  const storyHtmlFilename = `${slugBase}-story.html`;

  // Write HTML files
  await fs.mkdir(RENDER_DIR, { recursive: true });
  for (const slide of feedSlides) {
    await fs.writeFile(path.join(RENDER_DIR, slide.filename), slide.html);
  }
  await fs.writeFile(path.join(RENDER_DIR, storyHtmlFilename), storyHtml);

  // Render with Chrome
  const chrome = await findChrome();
  console.log(`[digest:render] Chrome: ${chrome}`);

  await fs.mkdir(FEED_OUT_DIR, { recursive: true });
  await fs.mkdir(STORY_OUT_DIR, { recursive: true });

  const server = await startStaticServer(RENDER_DIR, 8770);
  const feedFiles: string[] = [];
  let ok = 0, failed = 0;

  try {
    // Feed slides (1080×1350)
    for (let i = 0; i < feedSlides.length; i++) {
      const slide = feedSlides[i];
      const outFilename = `${slugBase}-${i + 1}.png`;
      const outPath = path.join(FEED_OUT_DIR, outFilename);
      const url = `http://127.0.0.1:8770/${slide.filename}`;
      try {
        await chromeShot(chrome, url, outPath, '1080,1350');
        const stat = await fs.stat(outPath);
        console.log(`  ✓ feed slide ${i + 1}/${feedSlides.length}  (${stat.size} bytes)`);
        feedFiles.push(`og-feed/${outFilename}`);
        ok++;
      } catch (err: any) {
        console.error(`  ✗ feed slide ${i + 1} failed: ${err?.message ?? err}`);
        failed++;
      }
    }

    // Story slide (1080×1920)
    const storyFilename = `${slugBase}.png`;
    const storyOutPath = path.join(STORY_OUT_DIR, storyFilename);
    const storyUrl = `http://127.0.0.1:8770/${storyHtmlFilename}`;
    try {
      await chromeShot(chrome, storyUrl, storyOutPath, '1080,1920');
      const stat = await fs.stat(storyOutPath);
      console.log(`  ✓ story slide  (${stat.size} bytes)`);
      ok++;
    } catch (err: any) {
      console.error(`  ✗ story slide failed: ${err?.message ?? err}`);
      failed++;
    }
  } finally {
    await server.stop();
    await fs.rm(RENDER_DIR, { recursive: true, force: true }).catch(() => {});
    await fs.rm(CHROME_SCRATCH, { recursive: true, force: true }).catch(() => {});
  }

  console.log(`[digest:render] Done. ${ok} rendered, ${failed} failed.`);
  if (failed > 0) {
    console.error(`[digest:render] Some slides failed — aborting pending state save.`);
    process.exit(1);
  }

  // Save pending state
  const pending: DigestPending = {
    slot,
    date: dateStr,
    posts,
    feedFiles,
    storyFile: `og-stories/${slugBase}.png`,
    renderedAt: new Date().toISOString(),
  };
  await savePending(pending);
  console.log(`[digest:render] Pending state saved → ${PENDING_STATE_PATH}`);
}

// ── Phase: post ───────────────────────────────────────────
async function phasePost(slot: DigestSlot): Promise<void> {
  const pending = await loadPending();
  if (!pending) {
    console.log('[digest:post] No pending state — nothing to post (render phase may not have run or had 0 posts).');
    return;
  }

  if (pending.slot !== slot) {
    console.warn(`[digest:post] Pending state is for slot=${pending.slot} but current slot=${slot} — proceeding anyway.`);
  }

  const stateKey = `${pending.date}-${pending.slot}`;

  // Check already posted
  if (!FORCE) {
    const posted = await loadPostedState();
    if (posted[stateKey]?.ig_feed) {
      console.log(`[digest:post] ${stateKey} already posted — skipping.`);
      await clearPending();
      return;
    }
  }

  if (DRY) {
    console.log(`[digest:post] DRY — would post ${pending.feedFiles.length} slides + 1 story for ${stateKey}`);
    console.log(`  Feed images: ${pending.feedFiles.map((f) => `${CDN_BASE}/${f}`).join(', ')}`);
    console.log(`  Story image: ${CDN_BASE}/${pending.storyFile}`);
    return;
  }

  const userId = process.env.META_IG_USER_ID;
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!userId || !token) {
    throw new Error('META_IG_USER_ID / META_PAGE_ACCESS_TOKEN not set');
  }
  const ig: InstagramConfig = { igUserId: userId, accessToken: token };

  const postedState = await loadPostedState();
  const record: DigestRecord = postedState[stateKey] ?? {
    slot: pending.slot,
    date: pending.date,
    slugs: pending.posts.map((p) => p.slug),
  };
  postedState[stateKey] = record;

  const feedUrls = pending.feedFiles.map((f) => `${CDN_BASE}/${f}`);
  const storyUrl = `${CDN_BASE}/${pending.storyFile}`;
  const caption = buildDigestCaption(pending);

  // Post IG Feed carousel (or single image if only 1 slide somehow)
  if (!record.ig_feed) {
    try {
      console.log(`[digest:post] Posting IG feed (${feedUrls.length} images)...`);
      if (feedUrls.length === 1) {
        record.ig_feed = await postFeedImage(ig, feedUrls[0], caption);
      } else {
        record.ig_feed = await postFeedCarousel(ig, feedUrls, caption);
      }
      console.log(`  ✓ ig_feed=${record.ig_feed}`);
      record.posted_at = record.posted_at ?? new Date().toISOString();
    } catch (err) {
      console.error(`  ✗ ig feed failed: ${(err as Error).message}`);
      if (!record.errors) record.errors = [];
      record.errors.push({ platform: 'ig_feed', message: (err as Error).message, at: new Date().toISOString() });
    }
  }

  // Post IG Story
  if (!record.ig_story) {
    try {
      console.log(`[digest:post] Posting IG story...`);
      record.ig_story = await postStory(ig, storyUrl);
      console.log(`  ✓ ig_story=${record.ig_story}`);
      record.posted_at = record.posted_at ?? new Date().toISOString();
    } catch (err) {
      console.error(`  ✗ ig story failed: ${(err as Error).message}`);
      if (!record.errors) record.errors = [];
      record.errors.push({ platform: 'ig_story', message: (err as Error).message, at: new Date().toISOString() });
    }
  }

  await savePostedState(postedState);
  console.log(`[digest:post] State saved → ${POSTED_STATE_PATH}`);

  // Clear pending only if both posted successfully
  if (record.ig_feed && record.ig_story) {
    await clearPending();
    console.log(`[digest:post] Pending cleared.`);
  } else {
    console.warn(`[digest:post] One or both platforms failed — pending state retained for retry.`);
  }
}

function buildDigestCaption(pending: DigestPending): string {
  const label = slotLabel(pending.slot);
  const headlines = pending.posts.map((p, i) => `${i + 1}. ${p.headline}`).join('\n');
  return `${label}\n\n${headlines}\n\nFull stories at article1.news (link in bio)`;
}

// ── Main ──────────────────────────────────────────────────
async function main() {
  const now = new Date();
  console.log(`[digest] ${new Date().toISOString()}`);
  console.log(`[digest] Phase: ${PHASE}, Slot arg: ${SLOT_ARG}, Dry: ${DRY}, Force: ${FORCE}`);

  // Determine slot
  let slot: DigestSlot;
  if (SLOT_ARG === 'auto') {
    const detected = detectSlot(now);
    if (!detected) {
      const etHour = getETHour(now);
      console.log(`[digest] ET hour=${etHour} is outside any digest window — nothing to do.`);
      console.log(`  Windows: morning=6-8 ET, afternoon=15-17 ET, evening=18-20 ET`);
      return;
    }
    slot = detected;
  } else if (['morning', 'afternoon', 'evening'].includes(SLOT_ARG)) {
    slot = SLOT_ARG as DigestSlot;
  } else {
    throw new Error(`Unknown --slot value: ${SLOT_ARG}. Use morning | afternoon | evening | auto`);
  }

  const etHour = getETHour(now);
  console.log(`[digest] Slot: ${slot} (ET hour=${etHour})`);

  if (PHASE === 'render' || PHASE === 'both') {
    await phaseRender(slot, now);
  }
  if (PHASE === 'post' || PHASE === 'both') {
    await phasePost(slot);
  }
}

main().catch((err) => {
  console.error('ig-digest crashed:', err);
  process.exit(1);
});
