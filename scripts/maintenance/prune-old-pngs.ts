// Article I — prune Story + Feed PNGs older than N days.
//
// Repo grows ~13 MB/day from committed Story (1080×1920) and Feed
// (1080×1350) PNGs. Pruning the working tree after 30 days keeps the
// HEAD bounded (~400 MB rolling) without changing infra.
//
// What this removes:
//   public/og-stories/<slug>.png           (single-image Story per post)
//   public/og-feed/<slug>.png              (single-image Feed)
//   public/og-feed/<slug>-<n>.png          (carousel slides: -1.png .. -N.png)
//
// What this keeps forever:
//   public/cartoons/*                      (self-hosted public-domain art)
//   public/og-default.png                  (homepage social card)
//   public/apple-touch-icon.png, icon-*.png, favicon.svg  (brand assets)
//
// Cutoff is based on the POST's `date` frontmatter, not the file mtime —
// re-rendering shouldn't reset the clock.
//
// Run via:  npm run maintenance:prune-pngs              (LIVE: deletes files)
//           npm run maintenance:prune-pngs -- --dry     (dry run: prints, no delete)
//           npm run maintenance:prune-pngs -- --days=60 (custom cutoff)
//
// Orphan policy: PNGs whose post markdown no longer exists are ALSO
// removed. Those are leftovers from deleted/renamed posts.

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SITE_ROOT = path.resolve(__dirname, '..', '..');
const POSTS_DIR = path.join(SITE_ROOT, 'src', 'content', 'posts');
const STORIES_DIR = path.join(SITE_ROOT, 'public', 'og-stories');
const FEED_DIR = path.join(SITE_ROOT, 'public', 'og-feed');

const argv = process.argv.slice(2);
const args = new Set(argv);
const DRY = args.has('--dry');

const DAYS_FLAG = argv.find((a) => a.startsWith('--days='));
const CUTOFF_DAYS = DAYS_FLAG ? parseInt(DAYS_FLAG.slice('--days='.length), 10) : 30;

if (!Number.isFinite(CUTOFF_DAYS) || CUTOFF_DAYS < 1) {
  console.error(`[prune] --days must be a positive integer; got ${DAYS_FLAG}`);
  process.exit(2);
}

const CUTOFF_MS = Date.now() - CUTOFF_DAYS * 24 * 3600 * 1000;
const CUTOFF_ISO = new Date(CUTOFF_MS).toISOString();

interface PostInfo {
  slug: string;
  dateMs: number;
}

async function loadPostsIndex(): Promise<Map<string, PostInfo>> {
  const files = (await fs.readdir(POSTS_DIR)).filter((f) => f.endsWith('.md'));
  const out = new Map<string, PostInfo>();
  for (const f of files) {
    const slug = f.replace(/\.md$/, '');
    try {
      const raw = await fs.readFile(path.join(POSTS_DIR, f), 'utf8');
      const fm = matter(raw);
      const dateRaw = (fm.data as { date?: string | Date }).date;
      const ms = dateRaw ? new Date(dateRaw as unknown as string).getTime() : NaN;
      if (Number.isFinite(ms)) out.set(slug, { slug, dateMs: ms });
    } catch {
      // bad file → skip; PNG-orphan logic will surface anything pointing at it
    }
  }
  return out;
}

/**
 * Resolve a PNG filename to the post slug it belongs to.
 *
 *   og-stories/<slug>.png        → slug   (only single-image; Stories aren't carousels)
 *   og-feed/<slug>.png           → slug   (single-image feed post)
 *   og-feed/<slug>-<n>.png       → slug   (carousel slide; n=1..9)
 *
 * Slugs themselves often end in `-<digits>` (e.g. "dies-at-86" or "trump-2024").
 * Naive `-<digits>` stripping treats those as carousel suffixes. To avoid that:
 *   1. First check if the full filename matches a real post slug. If yes,
 *      it's a single-image. Done.
 *   2. Only IF no exact match, try carousel: strip a single-digit `-<n>` and
 *      look up that shorter slug. Limited to single-digit because our
 *      renderer produces at most 5-8 slides per carousel.
 * Returns null if neither resolution finds a real post (genuine orphan).
 */
function resolvePostSlug(filename: string, postsIndex: Map<string, PostInfo>): string | null {
  const noExt = filename.replace(/\.png$/, '');
  if (postsIndex.has(noExt)) return noExt;
  const carouselMatch = noExt.match(/^(.*)-\d$/);
  if (carouselMatch && postsIndex.has(carouselMatch[1])) return carouselMatch[1];
  return null;
}

interface PruneTarget {
  fullPath: string;
  reason: string;
}

async function findPruneTargets(dir: string, postsIndex: Map<string, PostInfo>): Promise<PruneTarget[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const targets: PruneTarget[] = [];
  for (const f of entries) {
    if (!f.endsWith('.png')) continue;
    const slug = resolvePostSlug(f, postsIndex);
    const full = path.join(dir, f);
    if (slug === null) {
      // Genuine orphan — no post matches even after trying carousel suffix
      targets.push({ fullPath: full, reason: `orphan (no matching post)` });
      continue;
    }
    const info = postsIndex.get(slug)!;
    if (info.dateMs < CUTOFF_MS) {
      const ageDays = Math.floor((Date.now() - info.dateMs) / (24 * 3600 * 1000));
      targets.push({ fullPath: full, reason: `${ageDays}d old` });
    }
  }
  return targets;
}

async function main() {
  console.log(`[prune] Cutoff: ${CUTOFF_DAYS} days (posts dated before ${CUTOFF_ISO})`);
  console.log(`[prune] Mode: ${DRY ? 'DRY (will NOT delete)' : 'LIVE'}`);
  console.log('');

  const postsIndex = await loadPostsIndex();
  console.log(`[prune] Indexed ${postsIndex.size} posts.`);

  const storyTargets = await findPruneTargets(STORIES_DIR, postsIndex);
  const feedTargets = await findPruneTargets(FEED_DIR, postsIndex);
  const all = [...storyTargets, ...feedTargets];

  if (all.length === 0) {
    console.log('[prune] Nothing to prune.');
    return;
  }

  console.log(`[prune] og-stories/: ${storyTargets.length} candidates`);
  console.log(`[prune] og-feed/:    ${feedTargets.length} candidates`);
  console.log('');

  let bytesFreed = 0;
  for (const t of all) {
    try {
      const stat = await fs.stat(t.fullPath);
      bytesFreed += stat.size;
      const rel = path.relative(SITE_ROOT, t.fullPath);
      if (DRY) {
        console.log(`  [dry] would delete  ${rel}  (${(stat.size / 1024).toFixed(1)} KB · ${t.reason})`);
      } else {
        await fs.unlink(t.fullPath);
        console.log(`  ✗ deleted  ${rel}  (${(stat.size / 1024).toFixed(1)} KB · ${t.reason})`);
      }
    } catch (err) {
      console.error(`  ! failed on ${t.fullPath}: ${(err as Error).message}`);
    }
  }

  console.log('');
  console.log(`[prune] ${DRY ? 'Would free' : 'Freed'} ${(bytesFreed / 1024 / 1024).toFixed(1)} MB across ${all.length} file(s).`);
}

main().catch((err) => {
  console.error('prune-old-pngs crashed:', err);
  process.exit(1);
});
