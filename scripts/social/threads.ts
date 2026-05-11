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
 *
 * Pass `replyToId` to post as a reply to an existing thread instead of
 * a top-level thread.
 */
export async function postThread(
  cfg: ThreadsConfig,
  text: string,
  replyToId?: string,
): Promise<string> {
  if (text.length > 500) {
    text = text.slice(0, 497) + '…';
  }

  // Step 1: create container
  const createParams: Record<string, string> = {
    media_type: 'TEXT',
    text,
    access_token: cfg.accessToken,
  };
  if (replyToId) createParams.reply_to_id = replyToId;
  const create = await postJson(`${THREADS_BASE}/${cfg.userId}/threads`, createParams);
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
 * Reply to an existing Threads post with text. Used by the cross-poster
 * to attach the article URL as a comment under the main headline post.
 *
 * Steven's spec: keep the main Threads post clean (no URL inline);
 * the URL lives in a reply so readers see clean content first.
 */
export async function postThreadReply(
  cfg: ThreadsConfig,
  replyToId: string,
  text: string,
): Promise<string> {
  return postThread(cfg, text, replyToId);
}

/**
 * Build the MAIN Threads text for an Article I post.
 *
 * Format:
 *   <headline>
 *
 *   <first 1-2 sentences of body>
 *
 *   #<hashtag1> #<hashtag2> #<hashtag3>
 *
 * The article URL is NOT in the main post — it goes as a reply via
 * buildThreadsReply() / postThreadReply(). Per Steven 5/11: keep the
 * main post clean, URL in the comment.
 *
 * Hashtag count capped at 3 — Threads doesn't reward heavy hashtagging.
 */
export function buildThreadsText(opts: {
  headline: string;
  body: string;
  slug: string;
  hashtags: string[];
}): string {
  const excerpt = firstTwoSentences(opts.body, 320);
  // Zero-width space prefix before the hashtag block. Threads strips a
  // line-leading '#' (it treats # at column 0 as a markdown header
  // marker), so the first hashtag arrives without its hash. The ZWSP
  // is invisible to humans but prevents the # from being at column 0.
  const tagBody = opts.hashtags.slice(0, 3).map((h) => `#${h.replace(/^#/, '')}`).join(' ');
  const tags = tagBody ? '​' + tagBody : '';

  // Greedy assemble with a 480-char cushion to leave room for ellipsis.
  const parts = [opts.headline, excerpt, tags].filter(Boolean);
  let text = parts.join('\n\n');

  if (text.length > 490) {
    // Drop excerpt down to one sentence
    const oneSentence = firstTwoSentences(opts.body, 160);
    text = [opts.headline, oneSentence, tags].filter(Boolean).join('\n\n');
  }
  if (text.length > 490) {
    // Last resort: drop excerpt entirely
    text = [opts.headline, tags].filter(Boolean).join('\n\n');
  }
  if (text.length > 500) text = text.slice(0, 497) + '…';
  return text;
}

/**
 * Build the REPLY text — just the article URL with a brief lead-in.
 * Posted as a reply to the main thread by the cross-poster.
 */
export function buildThreadsReply(opts: { slug: string }): string {
  return `Read in full → https://article1.news/posts/${opts.slug}`;
}

function firstTwoSentences(text: string, maxChars: number): string {
  if (!text) return '';
  const cleaned = text.replace(/\s+/g, ' ').trim();
  // Require sentence-ending punctuation to be followed by whitespace —
  // otherwise "$4.52" or "U.S." breaks the regex inside numbers/abbreviations.
  const m = cleaned.match(/^.{40,}?[.!?]\s+.{20,}?[.!?](?=\s|$)/);
  if (m) {
    const out = m[0];
    return out.length > maxChars ? firstSentence(cleaned, maxChars) : out;
  }
  return firstSentence(cleaned, maxChars);
}

function firstSentence(cleaned: string, maxChars: number): string {
  const m = cleaned.match(/^.{40,}?[.!?](?=\s|$)/);
  const out = m ? m[0] : cleaned.slice(0, maxChars);
  return out.length > maxChars ? out.slice(0, maxChars).replace(/\s+\S*$/, '') + '…' : out;
}
