// Article I — RSS source list. Tuned per Steven's spec May 6, 2026.
// Drop individual-state feeds; keep all-state coverage (Ballotpedia, StateScoop).

export type SourceTier = 'strategic' | 'historian' | 'hard-news' | 'polling' | 'state-local' | 'foreign-policy' | 'public-health';

export interface Source {
  name: string;
  url: string;            // RSS or Atom
  tier: SourceTier;
  weight: number;         // 1-5 — how much we trust + want to use this source
  notes?: string;
}

export const SOURCES: Source[] = [
  // NOTE: Political Wire is the *inspiration* for this brand and is itself an
  // aggregator. We do NOT subscribe to it as a source — that would make us
  // derivative-of-derivative. Instead we pull from the primary outlets Political
  // Wire draws from (NYT, WaPo, Politico, Axios, Punchbowl, NPR, NBC, CBS, etc.)
  // plus the institutional/historian newsletters Steven values directly.

  // ── Strategic / insider (Goddard register equivalents) ────────────────
  { name: 'The Dispatch', url: 'https://thedispatch.com/feed/', tier: 'strategic', weight: 4 },
  { name: 'Punchbowl News', url: 'https://punchbowl.news/feed/', tier: 'strategic', weight: 5 },
  { name: 'Axios Politics', url: 'https://api.axios.com/feed/', tier: 'strategic', weight: 4 },
  { name: 'Politico Politics', url: 'https://rss.politico.com/politics-news.xml', tier: 'strategic', weight: 5 },
  { name: 'The Hill', url: 'https://thehill.com/news/feed/', tier: 'strategic', weight: 4 },
  { name: 'Roll Call', url: 'https://rollcall.com/feed/', tier: 'strategic', weight: 4 },
  { name: 'The Bulwark', url: 'https://www.thebulwark.com/feed', tier: 'strategic', weight: 4 },
  { name: 'Persuasion', url: 'https://www.persuasion.community/feed', tier: 'strategic', weight: 3 },

  // ── Historian register (HCR-style) ────────────────────────────────────
  { name: 'Heather Cox Richardson', url: 'https://heathercoxrichardson.substack.com/feed', tier: 'historian', weight: 5 },
  // Rachel Bade Substack URL not yet identified — rachelbade.substack.com 404s.
  // She's currently at Politico Playbook (which we already pull from RSS).
  // If she launches a separate Substack, add it here.
  { name: 'Timothy Snyder', url: 'https://snyder.substack.com/feed', tier: 'historian', weight: 4 },
  { name: 'Jamelle Bouie', url: 'https://www.jamellebouie.net/?format=rss', tier: 'historian', weight: 4 },
  { name: 'Popehat (Ken White)', url: 'https://popehat.substack.com/feed', tier: 'historian', weight: 4, notes: 'Legal/constitutional commentary.' },

  // ── Hard news primary sources (the wire / national papers / networks) ─
  { name: 'NYT Politics', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml', tier: 'hard-news', weight: 5 },
  { name: 'Washington Post Politics', url: 'https://feeds.washingtonpost.com/rss/politics', tier: 'hard-news', weight: 5 },
  { name: 'NPR Politics', url: 'https://feeds.npr.org/1014/rss.xml', tier: 'hard-news', weight: 5 },
  { name: 'NBC News Politics', url: 'https://feeds.nbcnews.com/nbcnews/public/politics', tier: 'hard-news', weight: 4 },
  { name: 'CBS News Politics', url: 'https://www.cbsnews.com/latest/rss/politics', tier: 'hard-news', weight: 4 },
  { name: 'CNN Politics', url: 'http://rss.cnn.com/rss/cnn_allpolitics.rss', tier: 'hard-news', weight: 4 },
  { name: 'Bloomberg Politics', url: 'https://feeds.bloomberg.com/politics/news.rss', tier: 'hard-news', weight: 4 },
  { name: 'The Atlantic', url: 'https://www.theatlantic.com/feed/channel/politics/', tier: 'hard-news', weight: 4 },
  { name: 'The New Yorker Politics', url: 'https://www.newyorker.com/feed/news', tier: 'hard-news', weight: 4 },

  // ── Polling / data ────────────────────────────────────────────────────
  { name: 'Cook Political Report', url: 'https://www.cookpolitical.com/rss.xml', tier: 'polling', weight: 4 },
  { name: 'Sabato\'s Crystal Ball', url: 'https://centerforpolitics.org/crystalball/feed/', tier: 'polling', weight: 4 },
  { name: 'RealClearPolitics', url: 'https://www.realclearpolitics.com/index.xml', tier: 'polling', weight: 3 },

  // ── State / local — all-state coverage only (no individual states) ───
  { name: 'Ballotpedia News', url: 'https://news.ballotpedia.org/feed/', tier: 'state-local', weight: 4 },
  { name: 'StateScoop', url: 'https://statescoop.com/feed/', tier: 'state-local', weight: 3 },

  // ── Public health / pandemic prep / CDC-NIH-FDA-HHS ──────────────────
  // Article I-relevant: appropriations (Article I §9), executive overreach
  // (RFK Jr. dismantling agencies), Congressional surrender of oversight,
  // institutional capacity. Outbreaks (hantavirus, measles) intersect with
  // policy capacity directly.
  { name: 'STAT News', url: 'https://www.statnews.com/feed/', tier: 'public-health', weight: 5 },
  { name: 'KFF Health News', url: 'https://kffhealthnews.org/feed/', tier: 'public-health', weight: 5 },
  { name: 'NPR Health', url: 'https://feeds.npr.org/1128/rss.xml', tier: 'public-health', weight: 4 },
  { name: 'CIDRAP News', url: 'https://www.cidrap.umn.edu/news-perspective/feed', tier: 'public-health', weight: 4, notes: 'Center for Infectious Disease Research and Policy — outbreaks, biosecurity.' },

  // ── Foreign policy ───────────────────────────────────────────────────
  // Note: Times of Israel + Jewish Insider were dropped 2026-05-07 — they
  // surface Israeli domestic news that isn't Article I material. We still
  // cover antisemitism (any source) and US-Israel policy (any major US
  // outlet does). Yair Rosenberg stays because he writes broadly about
  // US politics + antisemitism, not Israeli domestic affairs.
  { name: 'War on the Rocks', url: 'https://warontherocks.com/feed/', tier: 'foreign-policy', weight: 4 },
  { name: 'Yair Rosenberg', url: 'https://yairrosenberg.substack.com/feed', tier: 'foreign-policy', weight: 3 },
];
