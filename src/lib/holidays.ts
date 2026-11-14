// 節日 pages (/topic/holidays/<holiday>): the episodes whose transcript names a holiday. The
// summaries don't keep holidays as mentions, so the transcripts are read when the index is
// built, ad chapters left out (ads name 雙11, 母親節 and 中秋 for their sales).
//
// What a card shows comes from the summary, never the transcript: a sentence naming a holiday
// is often a listener's message read on air (祝我老婆七夕情人節快樂), so the words themselves
// show only behind 看逐字稿. Each chapter a holiday comes up in is one note: the chapter's bullet
// that names it, or else the chapter's title, at the first time the transcript names it there.
// Nothing heavy is imported here: no database.
import type { Segment } from './segments.ts';
import type { EpisodeOutline } from './stocks.ts';
import { HOLIDAYS, holidayPattern, newestFirst, topicCategory, type TopicIndex, type TopicItem, type TopicNote } from './topics.ts';

export type HolidayEpisode = { episodeNo: number; title: string; publishedAt: string; audioUrl: string; segments: Segment[] };

// Every word, for the query that picks the episodes worth parsing
export const HOLIDAY_TERMS = HOLIDAYS.flatMap((h) => h.terms);

const PATTERNS = HOLIDAYS.map((h) => ({ holiday: h, pattern: holidayPattern(h) }));

// One holiday's notes in one episode, by time. `name`: the holiday's, for a passage with no
// chapter to name it by (a summary without chapters).
export function holidayNotes(segments: Segment[], outline: EpisodeOutline | undefined, pattern: RegExp, name: string): TopicNote[] {
  const chapters = outline?.chapters ?? [];
  // By chapter; -1 before the first or without chapters
  const notes = new Map<number, TopicNote>();
  for (const seg of segments) {
    if (typeof seg?.text !== 'string' || !pattern.test(seg.text)) continue;
    const i = chapters.findLastIndex((c) => c.t <= seg.start);
    const c = chapters[i];
    if (c?.ad || notes.has(i)) continue;
    const bullet = c?.bullets.find((b) => pattern.test(b.text));
    notes.set(i, { t: Math.floor(seg.start), text: bullet?.text || c?.title || `提到${name}`, quoted: false });
  }
  return [...notes.values()].sort((a, b) => a.t - b.t);
}

// Fills the 節日 category of `index` from the episodes that name a holiday
export function addHolidays(index: TopicIndex, episodes: Iterable<HolidayEpisode>, outlines: Map<number, EpisodeOutline>): void {
  const category = topicCategory('holidays')!;
  let items = index.get(category.slug);
  if (!items) index.set(category.slug, (items = new Map()));
  for (const e of episodes) {
    const outline = outlines.get(e.episodeNo);
    for (const { holiday, pattern } of PATTERNS) {
      const notes = holidayNotes(e.segments, outline, pattern, holiday.name);
      if (!notes.length) continue;
      let item: TopicItem | undefined = items.get(holiday.slug);
      if (!item) items.set(holiday.slug, (item = { category, slug: holiday.slug, name: holiday.name, episodes: [] }));
      item.episodes.push({ no: e.episodeNo, title: e.title, publishedAt: e.publishedAt, audioUrl: e.audioUrl, line: outline?.line ?? '', notes });
    }
  }
  for (const item of items.values()) item.episodes.sort(newestFirst);
}
