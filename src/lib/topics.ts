// Fixed taxonomy. Filter posts by tag overlap, not auto-derived.
export type Topic = {
  label: string;
  tags: string[];
};

export const TOPICS: Topic[] = [
  { label: 'All', tags: [] },
  { label: 'Constitution', tags: ['Constitution', 'ArticleI', 'Article I', 'Rule of Law'] },
  { label: 'Economy', tags: ['Economy'] },
  { label: 'Foreign Policy', tags: ['Foreign Policy', 'Iran', 'Israel', 'Netanyahu', 'NATO', 'Ukraine', 'China'] },
  { label: 'Antisemitism', tags: ['Antisemitism'] },
  { label: 'Polling', tags: ['Polling'] },
  { label: '2026 Midterms', tags: ['2026 Midterms', 'Michigan'] },
  { label: '2028', tags: ['2028'] },
];

export type RaceLevel = 'all' | 'national' | 'state' | 'local';

export const RACE_LEVELS: { label: string; key: RaceLevel }[] = [
  { label: 'All Races', key: 'all' },
  { label: 'National', key: 'national' },
  { label: 'State', key: 'state' },
  { label: 'Local', key: 'local' },
];

export function postMatchesRaceLevel(post: { data: { race_level?: string } }, key: RaceLevel): boolean {
  if (key === 'all') return true;
  return (post.data.race_level ?? 'none') === key;
}

export function postMatchesTopic(post: { data: { tags: string[] } }, topic: Topic): boolean {
  if (topic.label === 'All') return true;
  return post.data.tags.some((t) => topic.tags.includes(t));
}

export function fmtRelative(date: Date, now = new Date()): string {
  const diffH = (now.getTime() - date.getTime()) / 3600000;
  if (diffH < 1) return Math.max(1, Math.round(diffH * 60)) + 'm ago';
  if (diffH < 24) return Math.round(diffH) + 'h ago';
  const days = Math.round(diffH / 24);
  return days === 1 ? '1d ago' : days + 'd ago';
}

export function fmtAbsolute(date: Date): string {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const m = months[date.getMonth()];
  const d = date.getDate();
  const y = date.getFullYear();
  let h = date.getHours();
  const mins = String(date.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${m} ${d}, ${y} · ${h}:${mins} ${ampm} ET`;
}

export function fmtDateline(date: Date): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}
