// Article I — story deduplication.
// Stores URL hashes processed in the last 30 days so we don't re-cover the same story.

import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { FeedItem } from './types.js';

const STATE_DIR = path.resolve(process.cwd(), 'state');
const PROCESSED_PATH = path.join(STATE_DIR, 'processed.json');
const RETENTION_DAYS = 30;

interface ProcessedState {
  [hash: string]: { url: string; firstSeen: string; outlet: string };
}

const ensureDir = async () => {
  await fs.mkdir(STATE_DIR, { recursive: true });
};

export function hashUrl(url: string): string {
  // Strip query strings and fragments to canonicalize
  let canonical: string;
  try {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    canonical = u.toString();
  } catch {
    canonical = url;
  }
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

const load = async (): Promise<ProcessedState> => {
  try {
    const raw = await fs.readFile(PROCESSED_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

const save = async (state: ProcessedState) => {
  await ensureDir();
  await fs.writeFile(PROCESSED_PATH, JSON.stringify(state, null, 2));
};

const prune = (state: ProcessedState, now: Date): ProcessedState => {
  const cutoff = now.getTime() - RETENTION_DAYS * 24 * 3600 * 1000;
  const out: ProcessedState = {};
  for (const [hash, entry] of Object.entries(state)) {
    if (new Date(entry.firstSeen).getTime() >= cutoff) {
      out[hash] = entry;
    }
  }
  return out;
};

export async function filterUnseen(items: FeedItem[], now: Date): Promise<FeedItem[]> {
  const state = await load();
  return items.filter((it) => !state[it.hash]);
}

export async function markProcessed(items: FeedItem[], now: Date): Promise<void> {
  const state = prune(await load(), now);
  for (const it of items) {
    if (!state[it.hash]) {
      state[it.hash] = { url: it.url, firstSeen: now.toISOString(), outlet: it.outlet };
    }
  }
  await save(state);
}
