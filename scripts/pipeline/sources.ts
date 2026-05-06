// Article I — RSS source list. Tuned per Steven's spec May 6, 2026.
// Drop individual-state feeds; keep all-state coverage (Ballotpedia, StateScoop).

export type SourceTier = 'strategic' | 'historian' | 'hard-news' | 'polling' | 'state-local' | 'foreign-policy';

export interface Source {
  name: string;
  url: string;            // RSS or Atom
  tier: SourceTier;
  weight: number;         // 1-5 — how much we trust + want to use this source
  notes?: string;
}

export const SOURCES: Source[] = [
  // ── Strategic / insider (Goddard register) ────────────────────────────
  { name: 'Political Wire', url: 'https://politicalwire.com/feed/', tier: 'strategic', weight: 5 },
  { name: 'The Dispatch', url: 'https://thedispatch.com/feed/', tier: 'strategic', weight: 4 },
  { name: 'Punchbowl News', url: 'https://punchbowl.news/feed/', tier: 'strategic', weight: 5 },
  { name: 'Axios Politics', url: 'https://api.axios.com/feed/', tier: 'strategic', weight: 4 },
  { name: 'Politico Politics', url: 'https://rss.politico.com/politics-news.xml', tier: 'strategic', weight: 5 },
  { name: 'Semafor', url: 'https://www.semafor.com/feed', tier: 'strategic', weight: 4 },
  { name: 'The Bulwark', url: 'https://www.thebulwark.com/feed', tier: 'strategic', weight: 4 },
  { name: 'Persuasion', url: 'https://www.persuasion.community/feed', tier: 'strategic', weight: 3 },
  { name: 'Public (Bari Weiss)', url: 'https://www.thefp.com/feed', tier: 'strategic', weight: 3, notes: 'Use cautiously; flag bias when relevant.' },

  // ── Historian register (HCR-style) ────────────────────────────────────
  { name: 'Heather Cox Richardson', url: 'https://heathercoxrichardson.substack.com/feed', tier: 'historian', weight: 5 },
  { name: 'Timothy Snyder', url: 'https://snyder.substack.com/feed', tier: 'historian', weight: 4 },
  { name: 'Jamelle Bouie', url: 'https://www.jamellebouie.net/?format=rss', tier: 'historian', weight: 4 },
  { name: 'Popehat (Ken White)', url: 'https://popehat.substack.com/feed', tier: 'historian', weight: 4, notes: 'Legal/constitutional commentary.' },

  // ── Hard news ground truth ────────────────────────────────────────────
  { name: 'NYT Politics', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml', tier: 'hard-news', weight: 5 },
  { name: 'Washington Post Politics', url: 'https://feeds.washingtonpost.com/rss/politics', tier: 'hard-news', weight: 5 },
  { name: 'Reuters World', url: 'https://www.reuters.com/arc/outboundfeeds/v3/category/world/us/?outputType=xml', tier: 'hard-news', weight: 5 },
  { name: 'Bloomberg Politics', url: 'https://feeds.bloomberg.com/politics/news.rss', tier: 'hard-news', weight: 4 },
  { name: 'The Atlantic', url: 'https://www.theatlantic.com/feed/channel/politics/', tier: 'hard-news', weight: 4 },

  // ── Polling / data ────────────────────────────────────────────────────
  { name: 'Cook Political Report', url: 'https://www.cookpolitical.com/rss.xml', tier: 'polling', weight: 4 },
  { name: 'Sabato\'s Crystal Ball', url: 'https://centerforpolitics.org/crystalball/feed/', tier: 'polling', weight: 4 },
  { name: 'RealClearPolitics', url: 'https://www.realclearpolitics.com/index.xml', tier: 'polling', weight: 3 },

  // ── State / local — all-state coverage only (no individual states) ───
  { name: 'Ballotpedia News', url: 'https://news.ballotpedia.org/feed/', tier: 'state-local', weight: 4 },
  { name: 'StateScoop', url: 'https://statescoop.com/feed/', tier: 'state-local', weight: 3 },

  // ── Foreign policy / Israel ──────────────────────────────────────────
  { name: 'War on the Rocks', url: 'https://warontherocks.com/feed/', tier: 'foreign-policy', weight: 4 },
  { name: 'Times of Israel', url: 'https://www.timesofisrael.com/feed/', tier: 'foreign-policy', weight: 4 },
  { name: 'Yair Rosenberg', url: 'https://yairrosenberg.substack.com/feed', tier: 'foreign-policy', weight: 4 },
  { name: 'Jewish Insider', url: 'https://jewishinsider.com/feed/', tier: 'foreign-policy', weight: 3 },
];
