// Article I — Threads API client. Text-only posts (no media per spec).
//
// Flow per Threads docs:
//   1. POST /v1.0/{threads-user-id}/threads with media_type=TEXT + text → creation id
//   2. POST /v1.0/{threads-user-id}/threads_publish with creation id → published id
//
// Threads API base: https://graph.threads.net
// Token: long-lived Threads user access token (scope: threads_basic, threads_content_publish)
//
// Per-platform character limit: 500. We pre-truncate; caller should already
// have produced a sub-500 string.

const THREADS_BASE = 'https://graph.threads.net/v1.0';

export interface ThreadsConfig {
  userId: string;       // Threads user ID (numeric string)
  accessToken: string;  // long-lived Threads access token
}

async function postJson(url: string, body: Record<string, string>): Promise<any> {
  const params = new URLSearchParams(body);
  const resp = await fetch(`${url}?${params.toString()}`, { method: 'POST' });
  const json = await resp.json();
  if (!resp.ok) {
    throw new Error(`Threads API ${resp.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

/**
 * Publish a text-only Threads post. Returns the published post ID.
 *
 * Threads API requires two calls — create the container, then publish it.
 * If the publish call fails we still leak the created container; Threads
 * auto-cleans abandoned containers after ~24h, so we don't manage that.
 */
export async function postThread(cfg: ThreadsConfig, text: string): Promise<string> {
  if (text.length > 500) {
    text = text.slice(0, 497) + '…';
  }

  // Step 1: create container
  const create = await postJson(`${THREADS_BASE}/${cfg.userId}/threads`, {
    media_type: 'TEXT',
    text,
    access_token: cfg.accessToken,
  });
  const creationId = create.id as string;
  if (!creationId) throw new Error(`Threads create returned no id: ${JSON.stringify(create)}`);

  // Step 2: publish (Threads requires a brief delay between create and publish
  // in some cases — observed ~1-2s. Wait 3s to be safe.)
  await new Promise((r) => setTimeout(r, 3000));

  const publish = await postJson(`${THREADS_BASE}/${cfg.userId}/threads_publish`, {
    creation_id: creationId,
    access_token: cfg.accessToken,
  });
  if (!publish.id) throw new Error(`Threads publish returned no id: ${JSON.stringify(publish)}`);
  return publish.id as string;
}

/**
 * Build the Threads text for an Article I post.
 *
 * Format:
 *   <headline>
 *
 *   <first 1-2 sentences of body>
 *
 *   article1.news/posts/<slug>
 *
 *   #<hashtag1> #<hashtag2>
 *
 * We omit hashtag-spam — Threads doesn't reward heavy hashtagging the way
 * X used to. Three or fewer is the sweet spot.
 */
export function buildThreadsText(opts: {
  headline: string;
  body: string;
  slug: string;
  hashtags: string[];
}): string {
  const url = `https://article1.news/posts/${opts.slug}`;
  const excerpt = firstTwoSentences(opts.body, 280);
  const tags = opts.hashtags.slice(0, 3).map((h) => `#${h.replace(/^#/, '')}`).join(' ');

  // Greedy assemble with a 480-char cushion to leave room for ellipsis.
  const parts = [opts.headline, excerpt, url, tags].filter(Boolean);
  let text = parts.join('\n\n');

  if (text.length > 490) {
    // Drop excerpt down to one sentence
    const oneSentence = firstTwoSentences(opts.body, 160);
    text = [opts.headline, oneSentence, url, tags].filter(Boolean).join('\n\n');
  }
  if (text.length > 490) {
    // Last resort: drop excerpt entirely
    text = [opts.headline, url, tags].filter(Boolean).join('\n\n');
  }
  if (text.length > 500) text = text.slice(0, 497) + '…';
  return text;
}

function firstTwoSentences(text: string, maxChars: number): string {
  if (!text) return '';
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const m = cleaned.match(/^.{40,}?[.!?]\s+.{20,}?[.!?]/);
  if (m) {
    const out = m[0];
    return out.length > maxChars ? firstSentence(cleaned, maxChars) : out;
  }
  return firstSentence(cleaned, maxChars);
}

function firstSentence(cleaned: string, maxChars: number): string {
  const m = cleaned.match(/^.{40,}?[.!?]/);
  const out = m ? m[0] : cleaned.slice(0, maxChars);
  return out.length > maxChars ? out.slice(0, maxChars).replace(/\s+\S*$/, '') + '…' : out;
}
