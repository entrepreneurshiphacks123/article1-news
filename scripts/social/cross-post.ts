// Article I — social cross-poster.
//
// Reads new posts from src/content/posts/ (filtered by --since=Nh) and
// publishes each to Threads + Instagram (Story + Feed). FB Page can be
// added later by extending postOne().
//
// State persistence: state/social-posted.json tracks per-slug, per-platform
// successes so reruns don't double-post. When a platform fails, we record
// the others and retry the failed one next cycle.
//
// Required env vars:
//   META_PAGE_ACCESS_TOKEN     — long-lived Page token (covers IG)
//   META_IG_USER_ID            — Instagram Business Account ID
//   META_THREADS_USER_ID       — Threads user ID
//   META_THREADS_ACCESS_TOKEN  — Threads access token (separate from Page token)
//
// CDN base for image URLs — the IG Graph API requires PUBLICLY reachable
// image URLs. The og-feed/og-stories PNGs are deployed alongside the site
// to article1.news/og-feed/<slug>.png and /og-stories/<slug>.png.

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';

import { postThread, buildThreadsText, type ThreadsConfig } from './threads.js';
import {
  postFeedImage,
  postFeedCarousel,
  postStory,
  commentOnMedia,
  buildFeedCaption,
  buildFirstComment,
  type InstagramConfig,
} from './instagram.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SITE_ROOT = path.resolve(__dirname, '..', '..');
const POSTS_DIR = path.join(SITE_ROOT, 'src', 'content', 'posts');
const STATE_PATH = path.join(SITE_ROOT, 'state', 'social-posted.json');
const CDN_BASE = 'https://article1.news';

const argv = process.argv.slice(2);
const args = new Set(argv);
const DRY = args.has('--dry');

const SINCE_FLAG = argv.find((a) => a.startsWith('--since='));
const SINCE_MS: number | null = SINCE_FLAG
  ? (() => {
      const v = SINCE_FLAG.slice('--since='.length).trim();
      const m = v.match(/^(\d+)\s*([hd])?$/i);
      if (!m) return null;
      const n = parseInt(m[1], 10);
      const unit = (m[2] ?? 'h').toLowerCase();
      return unit === 'd' ? n * 24 * 3600 * 1000 : n * 3600 * 1000;
    })()
  : null;

// --slug=<slug> — target exactly one post by slug. Used for manual test
// runs and the GHA workflow's smoke-test path. Bypasses the --since
// filter and the "already-posted" state check (so it can re-publish a
// platform that failed earlier).
const SLUG_FLAG = argv.find((a) => a.startsWith('--slug='));
const TARGET_SLUG: string | null = SLUG_FLAG ? SLUG_FLAG.slice('--slug='.length).trim() : null;

type FormatType = 'static' | 'carousel' | 'quote' | 'numbers' | 'headline' | 'cartoon';

interface PostFront {
  id: number;
  type: FormatType;
  date: string;
  headline: string;
  source: { outlet: string; url?: string };
  body?: string;
  hashtags?: string[];
  tags?: string[];
  slides?: { kind: string; body: string }[];
  citations?: { outlet: string; url?: string; date?: string; note?: string }[];
  quote?: { text: string; speaker: string; speaker_title?: string };
  numbers?: { value: string; unit?: string; body: string };
  headline_card?: { text: string; outlet: string };
}

interface PostState {
  threads?: string;
  ig_feed?: string;
  ig_story?: string;
  posted_at?: string;
  errors?: { platform: string; message: string; at: string }[];
}
type SocialState = Record<string, PostState>;

async function loadState(): Promise<SocialState> {
  try {
    const raw = await fs.readFile(STATE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveState(state: SocialState): Promise<void> {
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

function recordError(s: PostState, platform: string, err: unknown): void {
  if (!s.errors) s.errors = [];
  s.errors.push({
    platform,
    message: err instanceof Error ? err.message : String(err),
    at: new Date().toISOString(),
  });
  // Keep the last 6 errors per slug to limit state file growth.
  if (s.errors.length > 6) s.errors = s.errors.slice(-6);
}

// Slide-kinds we render as IG-carousel images. Must match the og-feed renderer.
const CAROUSEL_SLIDE_KINDS = new Set(['hook', 'context', 'pattern', 'stakes', 'watch']);

function getThreadsBody(post: PostFront): string {
  if (post.body) return post.body;
  if (post.quote?.text) return `"${post.quote.text}" — ${post.quote.speaker}`;
  if (post.numbers) return `${post.numbers.value}${post.numbers.unit ? ' ' + post.numbers.unit : ''}. ${post.numbers.body}`;
  if (post.headline_card) return `"${post.headline_card.text}" — ${post.headline_card.outlet}`;
  if (post.slides?.[0]) return post.slides[0].body;
  return '';
}

function feedImageUrls(slug: string, post: PostFront): string[] {
  if (post.type === 'carousel') {
    const visibleSlides = (post.slides ?? []).filter((s) => CAROUSEL_SLIDE_KINDS.has(s.kind));
    return visibleSlides.map((_, i) => `${CDN_BASE}/og-feed/${slug}-${i + 1}.png`);
  }
  return [`${CDN_BASE}/og-feed/${slug}.png`];
}

function storyImageUrl(slug: string): string {
  return `${CDN_BASE}/og-stories/${slug}.png`;
}

async function postOne(slug: string, post: PostFront, state: SocialState): Promise<void> {
  const s: PostState = state[slug] ?? {};
  state[slug] = s;

  // Lazily build configs only when needed so we can run --dry without tokens.
  const lazyThreads = (): ThreadsConfig => {
    const userId = process.env.META_THREADS_USER_ID;
    const token = process.env.META_THREADS_ACCESS_TOKEN;
    if (!userId || !token) throw new Error('META_THREADS_USER_ID / META_THREADS_ACCESS_TOKEN missing');
    return { userId, accessToken: token };
  };
  const lazyIg = (): InstagramConfig => {
    const userId = process.env.META_IG_USER_ID;
    const token = process.env.META_PAGE_ACCESS_TOKEN;
    if (!userId || !token) throw new Error('META_IG_USER_ID / META_PAGE_ACCESS_TOKEN missing');
    return { igUserId: userId, accessToken: token };
  };

  const url = `${CDN_BASE}/posts/${slug}`;

  // 1. Threads (text-only)
  if (!s.threads) {
    try {
      const text = buildThreadsText({
        headline: post.headline,
        body: getThreadsBody(post),
        slug,
        hashtags: post.hashtags ?? [],
      });
      console.log(`  → threads: ${post.headline.slice(0, 60)}`);
      if (DRY) {
        console.log(`    [dry] text (${text.length} chars):\n${indent(text)}`);
      } else {
        s.threads = await postThread(lazyThreads(), text);
        console.log(`    ✓ threads id=${s.threads}`);
      }
    } catch (err) {
      console.error(`    ✗ threads failed: ${(err as Error).message}`);
      recordError(s, 'threads', err);
    }
  }

  // 2. IG Story (1080x1920 Story PNG)
  if (!s.ig_story) {
    try {
      const imageUrl = storyImageUrl(slug);
      console.log(`  → ig story: ${imageUrl}`);
      if (DRY) {
        console.log(`    [dry] would POST story with image=${imageUrl}`);
      } else {
        s.ig_story = await postStory(lazyIg(), imageUrl);
        console.log(`    ✓ ig story id=${s.ig_story}`);
      }
    } catch (err) {
      console.error(`    ✗ ig story failed: ${(err as Error).message}`);
      recordError(s, 'ig_story', err);
    }
  }

  // 3. IG Feed (single or carousel, with first comment)
  if (!s.ig_feed) {
    try {
      const imageUrls = feedImageUrls(slug, post);
      const caption = buildFeedCaption({
        headline: post.headline,
        body: post.body ?? getThreadsBody(post),
        slug,
      });
      console.log(`  → ig feed: ${imageUrls.length} image(s)`);
      if (DRY) {
        console.log(`    [dry] caption (${caption.length} chars):\n${indent(caption)}`);
        console.log(`    [dry] images: ${imageUrls.join(', ')}`);
      } else {
        const ig = lazyIg();
        if (imageUrls.length > 1) {
          s.ig_feed = await postFeedCarousel(ig, imageUrls, caption);
        } else {
          s.ig_feed = await postFeedImage(ig, imageUrls[0], caption);
        }
        console.log(`    ✓ ig feed id=${s.ig_feed}`);

        // First comment with sources + hashtags + keyword tags
        const firstComment = buildFirstComment({
          source: post.source,
          citations: post.citations,
          hashtags: post.hashtags,
          tags: post.tags,
        });
        try {
          const commentId = await commentOnMedia(ig, s.ig_feed, firstComment);
          console.log(`    ✓ ig first-comment id=${commentId}`);
        } catch (commentErr) {
          // Don't fail the whole post if the comment fails — the media is up.
          console.error(`    ⚠ ig first-comment failed (post still up): ${(commentErr as Error).message}`);
          recordError(s, 'ig_first_comment', commentErr);
        }
      }
    } catch (err) {
      console.error(`    ✗ ig feed failed: ${(err as Error).message}`);
      recordError(s, 'ig_feed', err);
    }
  }

  if (s.threads || s.ig_feed || s.ig_story) {
    s.posted_at = s.posted_at ?? new Date().toISOString();
  }
}

function indent(text: string): string {
  return text.split('\n').map((l) => '      ' + l).join('\n');
}

async function main() {
  const files = (await fs.readdir(POSTS_DIR)).filter((f) => f.endsWith('.md'));
  console.log(`[social] Found ${files.length} posts.`);
  if (SINCE_MS !== null) {
    const hours = (SINCE_MS / 3600000).toFixed(0);
    console.log(`[social] Filter: posts within last ${hours}h.`);
  }
  console.log(`[social] Mode: ${DRY ? 'DRY (no posts will be made)' : 'LIVE'}`);

  const state = await loadState();
  const cutoff = SINCE_MS !== null ? Date.now() - SINCE_MS : null;

  let processed = 0;
  let skipped = 0;
  for (const f of files) {
    const slug = f.replace(/\.md$/, '');

    // --slug=X filter: skip everything that isn't the target.
    if (TARGET_SLUG !== null && slug !== TARGET_SLUG) continue;

    const raw = await fs.readFile(path.join(POSTS_DIR, f), 'utf8');
    const fm = matter(raw);
    const post = fm.data as PostFront;
    if (!post?.headline) continue;

    // --since filter applies only when no --slug given.
    if (TARGET_SLUG === null && cutoff !== null) {
      const ms = new Date(post.date as unknown as string).getTime();
      if (!Number.isFinite(ms) || ms < cutoff) continue;
    }

    // --slug bypasses the already-posted check so we can re-fire a platform.
    if (TARGET_SLUG === null) {
      const existing = state[slug];
      if (existing && existing.threads && existing.ig_feed && existing.ig_story) {
        skipped++;
        continue;
      }
    }

    console.log(`\n[social] ${slug}`);
    await postOne(slug, post, state);
    processed++;
    // Save state incrementally so partial successes survive a crash mid-batch.
    if (!DRY) await saveState(state);
  }

  console.log(`\n[social] Done. ${processed} processed, ${skipped} already complete.`);
  if (!DRY) await saveState(state);
}

main().catch((err) => {
  console.error('cross-poster crashed:', err);
  process.exit(1);
});
