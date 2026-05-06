// Article I — markdown writer.
// Outputs frontmatter + body to src/content/posts/<slug>.md.

import { promises as fs } from 'fs';
import path from 'path';
import slugify from 'slugify';
import matter from 'gray-matter';
import type { GeneratedPost, FeedItem } from './types.js';

const POSTS_DIR = path.resolve(process.cwd(), 'src', 'content', 'posts');
const DRAFTS_DIR = path.resolve(process.cwd(), 'src', 'content', 'drafts');

export async function nextId(): Promise<number> {
  await fs.mkdir(POSTS_DIR, { recursive: true });
  const files = await fs.readdir(POSTS_DIR);
  let max = 0;
  for (const f of files) {
    if (!f.endsWith('.md')) continue;
    try {
      const raw = await fs.readFile(path.join(POSTS_DIR, f), 'utf8');
      const fm = matter(raw);
      const id = Number(fm.data?.id ?? 0);
      if (id > max) max = id;
    } catch { /* ignore */ }
  }
  return max + 1;
}

function deriveSlug(headline: string): string {
  // strict: true already strips non-alphanumerics; lower: true lowercases.
  // Don't pass a custom `remove` regex — it runs BEFORE lowercasing and was
  // stripping the first letter of every word.
  return slugify(headline, { lower: true, strict: true }).slice(0, 80);
}

export interface WriteOpts {
  draftMode: boolean;
  itemDate: Date;
  feedItem: FeedItem;
  post: GeneratedPost;
  id: number;
}

export async function writePostMarkdown(opts: WriteOpts): Promise<string> {
  const dir = opts.draftMode ? DRAFTS_DIR : POSTS_DIR;
  await fs.mkdir(dir, { recursive: true });
  const slug = deriveSlug(opts.post.headline);
  const filePath = path.join(dir, `${slug}.md`);

  // Build frontmatter
  const fm: Record<string, any> = {
    id: opts.id,
    type: opts.post.type,
    date: opts.itemDate.toISOString(),
    headline: opts.post.headline,
    tags: opts.post.tags,
    source: {
      outlet: opts.feedItem.outlet,
      url: opts.feedItem.url,
    },
    hashtags: opts.post.hashtags,
    race_level: opts.post.race_level,
  };

  if (opts.post.type === 'static') {
    fm.body = opts.post.body ?? '';
  } else {
    fm.slides = opts.post.slides ?? [];
    if (opts.post.citations && opts.post.citations.length > 0) {
      fm.citations = opts.post.citations;
    }
  }

  // gray-matter stringify writes YAML frontmatter + body. For posts where body
  // lives in frontmatter (per our schema), the body section is empty.
  const yaml = matter.stringify('', fm);
  await fs.writeFile(filePath, yaml);
  return filePath;
}
