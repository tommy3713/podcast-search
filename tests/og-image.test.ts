import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DB, openDb } from '@/lib/db';

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('@/lib/server-db', () => ({ readDb: async () => mocks.db }));

const { drawable, episodeImage, fit, fitStocks, glyphs, OG_KEYS, OG_STOCKS, ogEpisode, textWidth } = await import('@/lib/og/episode-image');
const { default: Image } = await import('@/app/ep/[no]/opengraph-image');

let db: DB;
beforeEach(() => {
  db = openDb(':memory:');
  mocks.db = db;
});

function add(no: number, summary: object | string, opts: { status?: string; updatedAt?: string } = {}) {
  db.prepare(
    `INSERT INTO episodes (episode_no, guid, title, published_at, audio_url, status, summary_json, updated_at) VALUES (?, ?, '⭐', '2025-11-19T07:00:00.000Z', 'x', ?, ?, ?)`,
  ).run(no, `g${no}`, opts.status ?? 'done', typeof summary === 'string' ? summary : JSON.stringify(summary), opts.updatedAt ?? '2026-01-01T00:00:00Z');
}

const summary = {
  line: '主委談市場加碼、記憶體被動元件與 AWS 鏈傳聞',
  keys: ['重點一', '重點二', '重點三', '重點四'].map((text, i) => ({ t: i * 60, text })),
  chapters: [],
  stocks: ['旺宏', '金居', '旺宏', '台積電', '聯發科', '輝達'].map((name) => ({ name, code: null, note: '' })),
  mentions: [],
};

// A PNG's width and height, from its IHDR chunk
const pngSize = (b: ArrayBuffer) => {
  const v = new DataView(b);
  return { png: v.getUint32(0) === 0x89504e47, width: v.getUint32(16), height: v.getUint32(20) };
};

describe('fit', () => {
  it('keeps text that fits and cuts the rest with an ellipsis', () => {
    expect(fit('短短的', 10)).toBe('短短的');
    expect(fit('一二三四五六七八九十', 10)).toBe('一二三四五六七八九十');
    expect(fit('一二三四五六七八九十一', 10)).toBe('一二三四五六七八九…');
  });

  it('counts Latin letters and digits about half a CJK character', () => {
    expect(fit('AWS Trainium 3', 10)).toBe('AWS Trainium 3');
    // 15 narrow characters are 8.25 wide; 時 would pass the 9 left before the ellipsis
    expect(fit('AWS Trainium 3 時程傳聞', 10)).toBe('AWS Trainium 3…');
  });
});

describe('fit, wide letters', () => {
  it('counts capitals wider, W and M widest', () => {
    // NVDA、AMD、A is 7.8 wide; V would pass the 8 left before the ellipsis
    expect(fit('NVDA、AMD、AVGO', 9)).toBe('NVDA、AMD、A…');
    expect(fit('NVDA、AMD、AVGO', 20)).toBe('NVDA、AMD、AVGO');
    expect(textWidth('MW')).toBeCloseTo(1.8);
    expect(textWidth('ab1')).toBeCloseTo(1.65);
  });
});

describe('drawable', () => {
  it('leaves out characters the fonts lack, which next/og would fetch from a CDN', () => {
    expect(drawable('主委😂說 한국 OK！「好」')).toBe('主委說 OK！「好」');
    expect(drawable('ひらがな カタカナ ㄅㄆ')).toBe('ひらがな カタカナ ㄅㄆ');
  });
});

describe('fitStocks', () => {
  it('cuts long names and keeps only the chips that fit beside the footer', () => {
    expect(fitStocks(['旺宏', '金居', '台積電'])).toEqual(['旺宏', '金居', '台積電']);
    const long = fitStocks(['Berkshire Hathaway', 'Taiwan Semiconductor', 'Alphabet（Google）', 'SK海力士']);
    expect(long.every((s) => textWidth(s) <= 8)).toBe(true);
    expect(long.reduce((w, s) => w + textWidth(s) + 1.9, 0)).toBeLessThanOrEqual(28);
    expect(long.length).toBeLessThan(4);
  });
});

describe('glyphs', () => {
  it('lists each character once', () => {
    expect(glyphs(['EP611', '主委主委'])).toBe('EP61主委');
  });
});

describe('ogEpisode', () => {
  it('reads the line, the first key points and stocks once each, of live episodes only', () => {
    add(611, summary);
    add(612, summary, { status: 'failed' });
    const ep = ogEpisode(db, 611)!;
    expect(ep.line).toBe(summary.line);
    expect(ep.keys).toEqual(['重點一', '重點二', '重點三'].slice(0, OG_KEYS));
    expect(ep.stocks).toEqual(['旺宏', '金居', '台積電', '聯發科'].slice(0, OG_STOCKS));
    expect(ogEpisode(db, 612)).toBeNull();
    expect(ogEpisode(db, 999)).toBeNull();
  });

  it('leaves out what is not shaped as the summary writes it', () => {
    add(1, { line: 5, keys: 'abc', stocks: ['TSMC', { name: '台積電' }] });
    add(2, 'not json');
    expect(ogEpisode(db, 1)).toMatchObject({ line: '', keys: [], stocks: ['台積電'] });
    expect(ogEpisode(db, 2)).toMatchObject({ line: '', keys: [], stocks: [] });
  });
});

describe('episodeImage', () => {
  it('draws a 1200×630 PNG, once per version of the summary', async () => {
    add(611, summary);
    const ep = ogEpisode(db, 611)!;
    const a = await episodeImage(ep);
    expect(pngSize(a)).toEqual({ png: true, width: 1200, height: 630 });
    expect(await episodeImage(ep)).toBe(a);
    const b = await episodeImage({ ...ep, updatedAt: '2026-02-01T00:00:00Z', line: '改過的一句話' });
    expect(b).not.toBe(a);
    expect(pngSize(b).width).toBe(1200);
  }, 30_000);

  it('shares one drawing among requests that come at once', async () => {
    add(700, summary, { updatedAt: '2026-03-01T00:00:00Z' });
    const ep = ogEpisode(db, 700)!;
    const [a, b] = [episodeImage(ep), episodeImage(ep)];
    expect(a).toBe(b);
    expect(pngSize(await a).png).toBe(true);
  }, 30_000);

  it('draws an episode with no summary too', async () => {
    add(1, 'not json');
    expect(pngSize(await episodeImage(ogEpisode(db, 1)!)).png).toBe(true);
  }, 30_000);
});

describe('the route', () => {
  it('answers a live episode with its PNG, cached for a day', async () => {
    add(611, summary);
    const res = await Image({ params: Promise.resolve({ no: '611' }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toContain('max-age=86400');
  }, 30_000);

  it('is a 404 for an episode that is not there or not live', async () => {
    add(612, summary, { status: 'failed' });
    for (const no of ['612', '999', 'abc']) await expect(Image({ params: Promise.resolve({ no }) })).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
  });
});
