// Article I — Instagram Graph API client.
//
// Two flows we support:
//
//   FEED POST (single image OR carousel):
//     1a. Single: POST /{ig-user-id}/media with image_url + caption → container id
//     1b. Carousel: POST /{ig-user-id}/media for EACH image with is_carousel_item=true
//                   → N children container ids
//                   then POST /{ig-user-id}/media with media_type=CAROUSEL +
//                   children=[id1,id2,...] + caption → parent container id
//     2.  POST /{ig-user-id}/media_publish with creation_id → published media id
//     3.  POST /{media-id}/comments with message=<first comment> → comment id
//
//   STORY:
//     1. POST /{ig-user-id}/media with image_url + media_type=STORIES → container id
//     2. POST /{ig-user-id}/media_publish with creation_id → published story id
//        (Stories don't accept link stickers via the Graph API in the
//         current public release — that's an Instagram limitation. We post
//         the story image and rely on the bio link.)
//
// IG Graph API base: https://graph.facebook.com/v23.0
// Token: long-lived Page access token (scope: instagram_basic,
//        instagram_content_publish, pages_show_list, pages_read_engagement)
//
// IMPORTANT: image_url must be PUBLICLY reachable. We point at the
// production article1.news CDN (Cloudflare Pages), which serves
// /og-feed/<slug>.png and /og-stories/<slug>.png — both are already in
// the repo and deployed by Cloudflare Pages on push.

const GRAPH_BASE = 'https://graph.facebook.com/v23.0';

export interface InstagramConfig {
  igUserId: string;     // Instagram Business Account ID
  accessToken: string;  // long-lived Page access token (covers IG too)
}

async function postJson(url: string, body: Record<string, string>): Promise<any> {
  const params = new URLSearchParams(body);
  const resp = await fetch(`${url}?${params.toString()}`, { method: 'POST' });
  const json = await resp.json();
  if (!resp.ok) {
    throw new Error(`IG Graph API ${resp.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

/**
 * Wait for an IG media container to finish processing.
 *
 * IG's video/image processing can take a few seconds. The container goes
 * through statuses: IN_PROGRESS → FINISHED (success) or ERROR / EXPIRED.
 * We poll with backoff up to ~30s.
 */
async function waitForContainer(cfg: InstagramConfig, containerId: string): Promise<void> {
  const start = Date.now();
  const deadline = start + 30_000;
  let delay = 1000;
  while (Date.now() < deadline) {
    const resp = await fetch(
      `${GRAPH_BASE}/${containerId}?fields=status_code&access_token=${encodeURIComponent(cfg.accessToken)}`,
    );
    const json = await resp.json();
    if (json.status_code === 'FINISHED') return;
    if (json.status_code === 'ERROR' || json.status_code === 'EXPIRED') {
      throw new Error(`IG container ${containerId} failed: ${JSON.stringify(json)}`);
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 4000);
  }
  throw new Error(`IG container ${containerId} not ready after 30s`);
}

/**
 * Publish a single-image IG Feed post. Returns published media ID.
 */
export async function postFeedImage(
  cfg: InstagramConfig,
  imageUrl: string,
  caption: string,
): Promise<string> {
  const create = await postJson(`${GRAPH_BASE}/${cfg.igUserId}/media`, {
    image_url: imageUrl,
    caption,
    access_token: cfg.accessToken,
  });
  const creationId = create.id as string;
  if (!creationId) throw new Error(`IG create returned no id: ${JSON.stringify(create)}`);

  await waitForContainer(cfg, creationId);

  const publish = await postJson(`${GRAPH_BASE}/${cfg.igUserId}/media_publish`, {
    creation_id: creationId,
    access_token: cfg.accessToken,
  });
  if (!publish.id) throw new Error(`IG publish returned no id: ${JSON.stringify(publish)}`);
  return publish.id as string;
}

/**
 * Publish a multi-image IG Feed carousel post. Returns published media ID.
 *
 * IG carousels accept 2-10 images. Each child must be created first with
 * is_carousel_item=true; then the parent container references them.
 */
export async function postFeedCarousel(
  cfg: InstagramConfig,
  imageUrls: string[],
  caption: string,
): Promise<string> {
  if (imageUrls.length < 2 || imageUrls.length > 10) {
    throw new Error(`IG carousels need 2-10 images; got ${imageUrls.length}`);
  }

  // 1. Create N child containers
  const childIds: string[] = [];
  for (const url of imageUrls) {
    const child = await postJson(`${GRAPH_BASE}/${cfg.igUserId}/media`, {
      image_url: url,
      is_carousel_item: 'true',
      access_token: cfg.accessToken,
    });
    if (!child.id) throw new Error(`IG carousel child create failed: ${JSON.stringify(child)}`);
    childIds.push(child.id);
  }

  // 2. Wait for all children to finish (parallel-ish: sequential checks but
  //    they're typically all ready by the time the parent create happens).
  for (const id of childIds) {
    await waitForContainer(cfg, id);
  }

  // 3. Create the parent carousel container
  const parent = await postJson(`${GRAPH_BASE}/${cfg.igUserId}/media`, {
    media_type: 'CAROUSEL',
    children: childIds.join(','),
    caption,
    access_token: cfg.accessToken,
  });
  if (!parent.id) throw new Error(`IG carousel parent create failed: ${JSON.stringify(parent)}`);

  await waitForContainer(cfg, parent.id);

  // 4. Publish
  const publish = await postJson(`${GRAPH_BASE}/${cfg.igUserId}/media_publish`, {
    creation_id: parent.id,
    access_token: cfg.accessToken,
  });
  if (!publish.id) throw new Error(`IG carousel publish failed: ${JSON.stringify(publish)}`);
  return publish.id as string;
}

/**
 * Publish a Story (24h ephemeral). Returns published media ID.
 *
 * Note: IG Stories via Graph API do NOT currently support adding link
 * stickers programmatically. The image goes up; the bio link is the
 * only way to drive traffic.
 */
export async function postStory(cfg: InstagramConfig, imageUrl: string): Promise<string> {
  const create = await postJson(`${GRAPH_BASE}/${cfg.igUserId}/media`, {
    image_url: imageUrl,
    media_type: 'STORIES',
    access_token: cfg.accessToken,
  });
  const creationId = create.id as string;
  if (!creationId) throw new Error(`IG story create returned no id: ${JSON.stringify(create)}`);

  await waitForContainer(cfg, creationId);

  const publish = await postJson(`${GRAPH_BASE}/${cfg.igUserId}/media_publish`, {
    creation_id: creationId,
    access_token: cfg.accessToken,
  });
  if (!publish.id) throw new Error(`IG story publish failed: ${JSON.stringify(publish)}`);
  return publish.id as string;
}

/**
 * Post a comment on an existing IG media. Used for the "first comment"
 * pattern — hashtags + keywords + sources go in a comment, not the
 * caption, so the caption stays clean and readable.
 */
export async function commentOnMedia(
  cfg: InstagramConfig,
  mediaId: string,
  message: string,
): Promise<string> {
  const resp = await postJson(`${GRAPH_BASE}/${mediaId}/comments`, {
    message,
    access_token: cfg.accessToken,
  });
  if (!resp.id) throw new Error(`IG comment failed: ${JSON.stringify(resp)}`);
  return resp.id as string;
}

/**
 * Build the IG Feed caption for a post.
 *
 * Format:
 *   <headline>
 *
 *   <body — full, or truncated if extremely long>
 *
 *   Read at article1.news (link in bio)
 *
 * Hashtags + keywords go in the FIRST COMMENT, not the caption. This is
 * the IG best-practice convention (cleaner caption presentation; same
 * discoverability since IG indexes comment hashtags too).
 */
export function buildFeedCaption(opts: { headline: string; body: string; slug: string }): string {
  const trimmedBody = opts.body.trim();
  const bodyForCaption = trimmedBody.length > 1500
    ? trimmedBody.slice(0, 1500).replace(/\s+\S*$/, '') + '…'
    : trimmedBody;

  return `${opts.headline}\n\n${bodyForCaption}\n\nRead at article1.news (link in bio)`;
}

/**
 * Build the IG first-comment text — hashtags, keywords (from tags),
 * and source attribution.
 *
 * Format:
 *   Source: <outlet> — <url>
 *   [More sources from citations]
 *
 *   #<editorial hashtag 1> #<editorial hashtag 2> #<editorial hashtag 3>
 *   #<tag1NoSpaces> #<tag2NoSpaces> ...
 *   #article1 #articleinews #politics #constitution
 */
export function buildFirstComment(opts: {
  source: { outlet: string; url?: string };
  citations?: { outlet: string; url?: string; date?: string }[];
  hashtags?: string[];
  tags?: string[];
}): string {
  const lines: string[] = [];

  // Sources block
  lines.push(`Source: ${opts.source.outlet}${opts.source.url ? ` — ${opts.source.url}` : ''}`);
  for (const c of opts.citations ?? []) {
    if (!c.outlet) continue;
    const dateStr = c.date ? ` (${c.date})` : '';
    const urlStr = c.url ? ` — ${c.url}` : '';
    lines.push(`Source: ${c.outlet}${dateStr}${urlStr}`);
  }
  lines.push('');

  // Hashtags + keyword tags
  const editorialTags = (opts.hashtags ?? []).slice(0, 5).map((h) => `#${h.replace(/^#/, '').replace(/\s+/g, '')}`);
  const keywordTags = (opts.tags ?? []).slice(0, 8).map((t) => `#${t.replace(/\s+/g, '')}`);
  const brandTags = ['#Article1', '#ArticleINews', '#Politics', '#Constitution', '#LongMemory'];

  // Dedupe + cap at ~25 total (IG comments allow more but bunching too many
  // looks spammy)
  const all = [...editorialTags, ...keywordTags, ...brandTags];
  const seen = new Set<string>();
  const deduped = all.filter((h) => {
    const k = h.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 25);

  lines.push(deduped.join(' '));

  return lines.join('\n');
}
