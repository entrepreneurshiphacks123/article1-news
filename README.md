# Article I — site

American politics through the lens of the Constitution and the long memory.

Static editorial site at **article1.news**. Astro SSG, deploys to Cloudflare Pages.

## Stack

- **Astro 5** (static output, no SSR)
- **Vanilla JS islands** for the swipeable carousels and read-state (no React in production)
- **Markdown content collection** — each post is one `.md` file
- **Source Serif 4 / Inter / JetBrains Mono** via Google Fonts
- **Cloudflare Pages** for hosting

## Develop

```bash
npm install
npm run dev
```

Dev server defaults to `http://localhost:4321`.

## Build

```bash
npm run build
```

Output goes to `./dist`. That's the directory you deploy.

## Deploy to Cloudflare Pages

```bash
# One-time
npx wrangler pages project create article1 --production-branch main

# Each deploy
npm run build
npx wrangler pages deploy dist --project-name article1
```

Or connect this repo to Cloudflare Pages and set:

- **Build command:** `npm run build`
- **Build output directory:** `dist`
- **Node version:** 20+

Then add the custom domain `article1.news` in the Pages dashboard and set up DNS via the Cloudflare Registrar (or wherever the domain lives).

## Adding a post

Drop a Markdown file into `src/content/posts/` with the slug as the filename:

```markdown
---
id: 21
type: static                 # or "carousel"
date: '2026-05-07T09:00:00-04:00'
headline: "Headline goes here."
tags: ['Constitution', 'Polling']
source:
  outlet: New York Times
  url: https://example.com/article    # optional
body: |
  Two-to-four sentence body in the Article I voice.
  Paragraphs separated by blank lines.
hashtags: ['ArticleI']
---
```

For carousel posts, replace `body:` with:

```yaml
slides:
  - kind: hook
    body: "..."
  - kind: context
    body: "..."
  - kind: pattern
    body: "..."
  - kind: stakes
    body: "..."
  - kind: watch
    body: "..."
  - kind: sources
    body: ""
  - kind: cta
    body: "Article I — American politics through the lens of the Constitution and the long memory."
citations:
  - outlet: "New York Times — Article title"
    url: https://example.com
    date: "May 6, 2026"
```

The schema is enforced in `src/content/config.ts` — invalid posts fail the build.

## Routes

- `/` — homepage feed (Top Stories rail + chronological feed + lede + fleurons)
- `/topic/[topic]` — filtered feed (e.g. `/topic/Constitution`)
- `/posts/[slug]` — post detail (static or carousel)
- `/about` — colophon / manifesto
- `/rss.xml` — RSS feed
- `/sitemap-index.xml` — sitemap (auto-generated)
- `/robots.txt`, `/humans.txt`, `/favicon.svg`
- 404 page is `/404` (Cloudflare Pages serves it for unknown routes)

## Design system

- Tokens live in `src/styles/global.css` — never hardcode hex codes elsewhere.
- Brand mark: `<BrandMark />` (Article + oversized italic red I).
- The visual design comes verbatim from the Claude Design handoff bundle. Don't re-skin without reviewing the bundle in `_design_unpack/` (one folder up).

## Search

Cmd-K (or Ctrl-K) opens a client-side search modal that filters by headline, tag, or outlet across all posts. The index is built at compile time and inlined into each page; no backend.

## Read state

The "Top Stories" rail and feed cards track read state in `localStorage` (`a1.read.v1`). Marking a post read hides it from the Top Stories rail and dims it in the feed. State is per-browser; no server-side tracking.

## Content pipeline (planned, not in this repo)

The site is fed by a content pipeline in a sibling repo: RSS aggregation across politicalwire / Punchbowl / Axios / NYT politics / etc. → Claude API with the EDITORIAL.md system prompt → writes a Markdown file into this repo → git push → Cloudflare auto-rebuild.

## License

All rights reserved.
