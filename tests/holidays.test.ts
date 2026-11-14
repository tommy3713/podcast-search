import { describe, expect, it } from 'vitest';
import { openDb } from '@/lib/db.ts';
import { addHolidays, type HolidayEpisode, holidayNotes } from '@/lib/holidays.ts';
import { holidayEpisodes, topicRows } from '@/lib/stock-pages.ts';
import type { EpisodeOutline } from '@/lib/stocks.ts';
import { findTopic, HOLIDAYS, holidayPattern, listedTopics, type TopicIndex, topicCategory, topicHref } from '@/lib/topics.ts';

const seg = (start: number, text: string) => ({ start, end: start + 5, text });
const pattern = (slug: string) => holidayPattern(HOLIDAYS.find((h) => h.slug === slug)!);

const outline: EpisodeOutline = {
  line: '聊萬聖節和記憶體',
  keys: [],
  chapters: [
    { t: 0, title: 'NordVPN業配', ad: true, bullets: [{ t: 0, text: '萬聖節出國記得開 VPN' }] },
    { t: 60, title: '開場近況', ad: false, bullets: [{ t: 70, text: '一家人參加學校萬聖節活動。' }] },
    { t: 600, title: '生活問答', ad: false, bullets: [{ t: 610, text: '聽眾問怎麼休息' }] },
  ],
};

describe('HOLIDAYS', () => {
  it('names each holiday the ways the transcripts do, and not the words it leaves out', () => {
    const which = (text: string) => HOLIDAYS.filter((h) => holidayPattern(h).test(text)).map((h) => h.slug);
    expect(which('抱股過年')).toEqual(['lunar-new-year']);
    expect(which('農曆春節除夕')).toEqual(['lunar-new-year']);
    expect(which('祝大家 Halloween 快樂')).toEqual(['halloween']);
    expect(which('聖誕跨年怎麼過')).toEqual(['new-years-eve', 'christmas']);
    expect(which('七夕情人節快樂')).toEqual(['valentines-day']);
    // Listeners' 新年快樂 doesn't say which new year; 雙11 is nearly all ads
    expect(which('祝大家新年快樂')).toEqual([]);
    expect(which('雙11優惠')).toEqual([]);
  });

  it('has a category and unique slugs', () => {
    expect(topicCategory('holidays')).toMatchObject({ label: '節日', source: 'transcript' });
    expect(new Set(HOLIDAYS.map((h) => h.slug)).size).toBe(HOLIDAYS.length);
  });
});

describe('holidayNotes', () => {
  it('gives a chapter one note, at the first time it comes up there, by its bullet that names it', () => {
    const notes = holidayNotes([seg(75.6, '昨天去萬聖節活動'), seg(90, '萬聖節的裝扮')], outline, pattern('halloween'), '萬聖節');
    expect(notes).toEqual([{ t: 75, text: '一家人參加學校萬聖節活動。', quoted: false }]);
  });

  it('leaves out ad chapters and falls back to the chapter title', () => {
    const notes = holidayNotes([seg(10, '萬聖節出國'), seg(650, '萬聖節要扮什麼')], outline, pattern('halloween'), '萬聖節');
    expect(notes).toEqual([{ t: 650, text: '生活問答', quoted: false }]);
  });

  it('names the holiday when the summary has no chapters', () => {
    expect(holidayNotes([seg(5, '中秋快樂'), seg(9, '中秋烤肉')], undefined, pattern('mid-autumn-festival'), '中秋節')).toEqual([{ t: 5, text: '提到中秋節', quoted: false }]);
  });

  it('skips segments that aren’t the expected shape', () => {
    expect(holidayNotes([{ start: 1 } as never, seg(2, '端午')], undefined, pattern('dragon-boat-festival'), '端午節')).toHaveLength(1);
  });
});

describe('addHolidays', () => {
  const ep = (episodeNo: number, publishedAt: string, ...texts: string[]): HolidayEpisode => ({
    episodeNo,
    title: '⭐',
    publishedAt,
    audioUrl: `https://audio.example/${episodeNo}.mp3`,
    segments: texts.map((t, i) => seg(100 + i * 700, t)),
  });

  const build = (): TopicIndex => {
    const index: TopicIndex = new Map();
    addHolidays(
      index,
      [ep(606, '2025-11-01T04:00:00Z', '萬聖節的氛圍'), ep(710, '2026-10-31T04:00:00Z', '萬聖節活動', '聖誕節也是'), ep(709, '2026-10-28T04:00:00Z', '沒有節日')],
      new Map([[710, outline]]),
    );
    return index;
  };

  it('makes an item per holiday that comes up, newest episode first, with each episode’s line', () => {
    const index = build();
    const items = listedTopics(index, 'holidays');
    expect(items.map((i) => [i.slug, i.episodes.map((e) => e.no)])).toEqual([
      ['halloween', [710, 606]],
      ['christmas', [710]],
    ]);
    expect(items[0]!.episodes[0]).toMatchObject({ line: '聊萬聖節和記憶體', notes: [{ t: 100, text: '一家人參加學校萬聖節活動。' }] });
    expect(items[0]!.episodes[1]!.notes).toEqual([{ t: 100, text: '提到萬聖節', quoted: false }]);
  });

  it('finds a holiday’s page by its slug or its name', () => {
    const index = build();
    expect(findTopic(index, 'holidays', 'halloween')?.name).toBe('萬聖節');
    expect(findTopic(index, 'holidays', '萬聖節')?.slug).toBe('halloween');
    expect(topicHref(findTopic(index, 'holidays', 'christmas')!)).toBe('/topic/holidays/christmas');
    expect(findTopic(index, 'holidays', 'easter')).toBeNull();
  });
});

describe('holidayEpisodes', () => {
  it('reads live episodes whose transcript has a holiday’s word, and leaves the rest', () => {
    const db = openDb(':memory:', { migrate: true });
    const add = db.prepare(`INSERT INTO episodes (episode_no, guid, title, published_at, audio_url, status, segments_json) VALUES (?, ?, '⭐', '2026-10-31T04:00:00Z', 'https://x', ?, ?)`);
    const segs = (text: string) => JSON.stringify([seg(1, text)]);
    add.run(710, 'g710', 'done', segs('萬聖節活動'));
    add.run(709, 'g709', 'done', segs('記憶體'));
    add.run(711, 'g711', 'failed', segs('萬聖節還沒上線'));
    add.run(712, 'g712', 'done', '[{"start": 1, "text": "中秋"');
    add.run(713, 'g713', 'done', segs('HALLOWEEN'));
    expect([...holidayEpisodes(db)].map((e) => e.episodeNo).sort()).toEqual([710, 713]);
    // 節日 isn't a mention category: a mention row with it is no topic
    const id = db.prepare('SELECT id FROM episodes WHERE episode_no = 710').get() as { id: number };
    db.prepare(`INSERT INTO mentions (episode_id, category, name, code, detail, quote, start_sec) VALUES (?, '節日', '萬聖節', NULL, NULL, '', 1)`).run(id.id);
    expect(topicRows(db)).toEqual([]);
  });
});
