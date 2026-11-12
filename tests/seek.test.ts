import { beforeEach, describe, expect, it } from 'vitest';
import { type DB, openDb } from '@/lib/db.ts';
import { GRID, NO_SEEK_TABLE, offsetAt, parseSeekTable, type SeekTable, seekModel, seekTarget } from '@/lib/seek.ts';
import { insertDiscovered } from '../worker/repo.ts';
import { indexSeekTables, resetSeekFailures } from '../worker/seek-index.ts';
import { SeekTableParser } from '../worker/seek-table.ts';

// MPEG-1 layer III, 44.1 kHz, mono: frame size = floor(144 * kbps * 1000 / 44100) + padding
const KBPS_INDEX: Record<number, number> = { 32: 1, 128: 9, 320: 14 };
const SPF = 1152 / 44100;

function frame(kbps: number): Uint8Array {
  const size = Math.floor((144 * kbps * 1000) / 44100);
  const f = new Uint8Array(size);
  f.set([0xff, 0xfb, KBPS_INDEX[kbps]! << 4, 0xc0]);
  return f;
}

// An ID3 tag, a Xing frame with the given table of contents, then the audio frames
function mp3(frames: number[], toc: (bytes: number, starts: number[]) => number[], tag: 'Xing' | 'Info' = 'Xing'): Uint8Array {
  const audio = frames.map(frame);
  const bytes = audio.reduce((n, f) => n + f.length, 0);
  const starts: number[] = [];
  audio.reduce((at, f) => (starts.push(at), at + f.length), 0);
  const x = frame(128);
  const view = new DataView(x.buffer);
  x.set([...tag].map((c) => c.charCodeAt(0)), 21);
  view.setUint32(25, 7); // frames, bytes, TOC
  view.setUint32(29, frames.length);
  view.setUint32(33, bytes);
  x.set(toc(bytes, starts), 37);
  const id3 = new Uint8Array(10 + 300);
  id3.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 2, 300 - 256]); // syncsafe 300
  const out = new Uint8Array(id3.length + x.length + bytes);
  let at = 0;
  for (const part of [id3, x, ...audio]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

// 500 small frames, then 500 big ones: 26.1 s, most of the bytes in the second half
const FRAMES = [...Array(500).fill(32), ...Array(500).fill(320)];
const DURATION = 1000 * SPF;
// A table of contents that treats the file as if it were CBR: entry i at i% of the bytes
const linearToc = () => Array.from({ length: 100 }, (_, i) => Math.floor((256 * i) / 100));
// What a VBR encoder writes: entry i at the byte where i% of the duration starts
const exactToc = (bytes: number, starts: number[]) =>
  Array.from({ length: 100 }, (_, i) => Math.floor((256 * starts[Math.floor((i / 100) * starts.length)]!) / bytes));

function parse(file: Uint8Array, piece = file.length): SeekTable | null {
  const p = new SeekTableParser();
  for (let i = 0; i < file.length; i += piece) p.push(file.subarray(i, i + piece));
  return p.finish();
}

describe('SeekTableParser', () => {
  it('works out where each table-of-contents entry really lands', () => {
    const t = parse(mp3(FRAMES, linearToc))!;
    expect(t.duration).toBeCloseTo(DURATION, 2);
    expect(t.offsets).toHaveLength(GRID + 1);
    expect(t.offsets[0]).toBe(0);
    // Entry 50 (grid point 500) points at byte 287000 (half of 574000): past the 500 small
    // frames (52000 bytes), 226 big frames in, so frame 726 plays while it claims 50% of the time
    expect(t.offsets[500]).toBeCloseTo(726 * SPF - DURATION / 2, 1);
    // The cheap first half is crossed in a few entries, so early entries land late
    expect(Math.max(...t.offsets)).toBeGreaterThan(5);
    expect(t.offsets[GRID]).toBeCloseTo(0, 1);
  });

  it('places the points between entries the way Safari interpolates them', () => {
    const t = parse(mp3(FRAMES, linearToc))!;
    // 25.5%: halfway between entries 25 (64/256) and 26 (66/256), byte 65/256 of 574000 =
    // 145742, 90 big frames past the small ones
    expect(t.offsets[255]! + 0.255 * DURATION).toBeCloseTo(590 * SPF, 1);
    const step = DURATION / GRID;
    for (let k = 1; k <= GRID; k++) expect(step + t.offsets[k]! - t.offsets[k - 1]!).toBeGreaterThan(-0.02);
  });

  it('gives near-zero offsets for an accurate table, apart from its 1/256 rounding', () => {
    const t = parse(mp3(FRAMES, exactToc))!;
    // 1/256 of 574000 bytes is 2242, 22 of the small frames
    for (let i = 0; i < 100; i++) expect(Math.abs(t.offsets[i * 10]!)).toBeLessThan(22 * SPF);
  });

  it('gives the same table however the file arrives', () => {
    const file = mp3(FRAMES, linearToc);
    expect(parse(file, 7)).toEqual(parse(file));
    expect(parse(file, 4096)).toEqual(parse(file));
  });

  it('has nothing to correct in a CBR file or one without a table of contents', () => {
    expect(parse(mp3(FRAMES, linearToc, 'Info'))).toBeNull();
    expect(parse(Uint8Array.from([...frame(128), ...frame(128)]))).toBeNull();
  });

  it('refuses what is not a whole MP3, so it is not remembered as nothing to correct', () => {
    expect(() => parse(new TextEncoder().encode('<html>403 Forbidden</html>'.repeat(100)))).toThrow(/no MP3 frame/);
    const file = mp3(FRAMES, linearToc);
    expect(() => parse(file.subarray(0, file.length / 2))).toThrow(/ends early/);
  });

  it('has nothing to correct without the byte count, or with a table that goes down', () => {
    const noBytes = mp3(FRAMES, linearToc);
    // Flags: frames and TOC, no bytes
    new DataView(noBytes.buffer).setUint32(310 + 25, 5);
    expect(parse(noBytes)).toBeNull();
    const broken = mp3(FRAMES, (b, s) => linearToc().map((v, i) => (i === 40 ? 10 : v)));
    expect(parse(broken)).toBeNull();
  });
});

// A table whose 100 entries are off by entry(i) and whose points in between are interpolated
function table(entry: (i: number) => number, duration = 100): SeekTable {
  const offsets = Array.from({ length: GRID + 1 }, (_, k) => {
    const i = Math.min(99, Math.floor(k / 10));
    const next = i < 99 ? entry(i + 1) : 0;
    return entry(i) + (next - entry(i)) * (k / 10 - i);
  });
  return { duration, offsets };
}

describe('seekTarget / offsetAt', () => {
  it('leaves a table without offsets alone', () => {
    const t = table(() => 0);
    for (const m of ['entry', 'interp'] as const) {
      expect(seekTarget(t, 42.5, m)).toBeCloseTo(42.5, 9);
      expect(offsetAt(t, 42.5, m)).toBeCloseTo(0, 9);
    }
    expect(seekTarget(NO_SEEK_TABLE, 42.5, 'entry')).toBe(42.5);
  });

  it('asks Chromium for the time that lands on x', () => {
    const t = table(() => -5);
    // 55 is the very start of window 55, so within the margin kept from either edge
    const at = seekTarget(t, 50, 'entry');
    expect(Math.abs(at - 55)).toBeLessThanOrEqual(0.05 + 1e-9);
    expect(Math.abs(at + offsetAt(t, at, 'entry') - 50)).toBeLessThanOrEqual(0.05 + 1e-9);
    const at2 = seekTarget(t, 50.5, 'entry');
    expect(at2 + offsetAt(t, at2, 'entry')).toBeCloseTo(50.5, 5);
  });

  it('lands just before a position no Chromium seek reaches', () => {
    // Window 49 plays 49–50, window 50 plays 55–56 (each less the margins): 52 can't be reached
    const t = table((i) => (i < 50 ? 0 : 5));
    const at = seekTarget(t, 52, 'entry');
    expect(at + offsetAt(t, at, 'entry')).toBeCloseTo(49.95, 5);
    const at2 = seekTarget(t, 55.5, 'entry');
    expect(at2 + offsetAt(t, at2, 'entry')).toBeCloseTo(55.5, 5);
  });

  it('lands on every position of a real-looking table, or at most a gap early', () => {
    const t = parse(mp3(FRAMES, linearToc))!;
    for (let x = 0; x < t.duration; x += 0.1) {
      const at = seekTarget(t, x, 'entry');
      expect(at + offsetAt(t, at, 'entry')).toBeLessThanOrEqual(x + 0.05 + 1e-6);
      expect(at).toBeGreaterThanOrEqual(0);
    }
  });

  it('asks Safari for the time whose interpolated landing is x', () => {
    const t = parse(mp3(FRAMES, linearToc))!;
    for (let x = 0.5; x < t.duration - 0.5; x += 0.37) {
      const at = seekTarget(t, x, 'interp');
      expect(at + offsetAt(t, at, 'interp')).toBeCloseTo(x, 5);
    }
    expect(seekTarget(t, 0, 'interp')).toBe(0);
    // A seek to 50% lands 726 frames in: the offset there
    expect(offsetAt(t, t.duration / 2, 'interp')).toBeCloseTo(726 * SPF - DURATION / 2, 1);
  });

  it('reads stored tables', () => {
    const t = table((i) => (i % 2 ? 0.5 : -0.5));
    expect(parseSeekTable(JSON.stringify(t))).toEqual(t);
    expect(parseSeekTable(null)).toBeNull();
    expect(parseSeekTable(JSON.stringify(NO_SEEK_TABLE))).toBeNull();
    expect(parseSeekTable('{oops')).toBeNull();
    // The first release's format: 100 entry offsets only
    expect(parseSeekTable('{"duration":10,"offsets":[0,1]}')).toBeNull();
    // Landings that go down
    expect(parseSeekTable(JSON.stringify({ duration: 100, offsets: t.offsets.map((o, k) => (k === 300 ? o - 5 : o)) }))).toBeNull();
  });

  it('picks the model of a browser that was measured, and none for the others', () => {
    const nav = (userAgent: string, extra: object = {}) => ({ userAgent, maxTouchPoints: 0, ...extra }) as unknown as Navigator;
    const safariMac =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Safari/605.1.15';
    const safariIos =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1';
    const chromeIos =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1';
    const chrome =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
    const firefox = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0';
    const epiphany = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
    expect(seekModel(nav(chrome, { userAgentData: {} }))).toBe('entry');
    expect(seekModel(nav(safariMac))).toBe('interp');
    // Not measured: iOS (and iPadOS, which sends the Mac user agent), WebKit on Linux, Firefox
    expect(seekModel(nav(safariIos))).toBeNull();
    expect(seekModel(nav(chromeIos))).toBeNull();
    expect(seekModel(nav(safariMac, { maxTouchPoints: 5 }))).toBeNull();
    expect(seekModel(nav(epiphany))).toBeNull();
    expect(seekModel(nav(firefox))).toBeNull();
    // Chromium without userAgentData (old, or not a secure context): its model isn't known to hold
    expect(seekModel(nav(chrome))).toBeNull();
    expect(seekModel(undefined)).toBeNull();
  });
});

describe('indexSeekTables', () => {
  let db: DB;
  beforeEach(() => {
    db = openDb(':memory:');
    for (const n of [1, 2, 3]) {
      insertDiscovered(db, {
        guid: `g${n}`,
        episodeNo: n,
        title: '⭐',
        publishedAt: '2026-10-28T08:13:55.000Z',
        audioUrl: `https://example.com/${n}.mp3`,
        duration: 3000,
      });
    }
    db.prepare(`UPDATE episodes SET status = 'done' WHERE episode_no != 3`).run();
  });
  const stored = () =>
    db.prepare('SELECT episode_no, seek_json FROM episodes ORDER BY episode_no').all() as { episode_no: number; seek_json: string | null }[];

  it('fills live episodes, leaves a failed download for next time', async () => {
    resetSeekFailures();
    const good = table(() => 1);
    const asked: string[] = [];
    const r = await indexSeekTables(db, {
      fetch: async (url) => {
        asked.push(url);
        if (url.endsWith('/1.mp3')) throw new Error('403');
        return good;
      },
    });
    expect(asked).toEqual(['https://example.com/2.mp3', 'https://example.com/1.mp3']);
    expect(r).toEqual({ episodes: 1, failed: [1] });
    expect(stored()).toEqual([
      { episode_no: 1, seek_json: null },
      { episode_no: 2, seek_json: JSON.stringify(good) },
      { episode_no: 3, seek_json: null },
    ]);

    // Next time only the one that failed; a file with nothing to correct is remembered too
    const again = await indexSeekTables(db, { fetch: async () => null });
    expect(again).toEqual({ episodes: 1, failed: [] });
    expect(stored()[0]!.seek_json).toBe(JSON.stringify(NO_SEEK_TABLE));
    expect(await indexSeekTables(db, { fetch: async () => good })).toEqual({ episodes: 0, failed: [] });
  });

  it('redoes a table in an older format', async () => {
    resetSeekFailures();
    db.prepare(`UPDATE episodes SET seek_json = ? WHERE episode_no = 1`).run('{"duration":10,"offsets":[1,2]}');
    db.prepare(`UPDATE episodes SET seek_json = ? WHERE episode_no = 2`).run(JSON.stringify(NO_SEEK_TABLE));
    const asked: string[] = [];
    await indexSeekTables(db, { fetch: async (url) => (asked.push(url), table(() => 0)) });
    expect(asked).toEqual(['https://example.com/1.mp3']);
  });

  it('gives up on an episode after 3 failed downloads, until the worker restarts', async () => {
    resetSeekFailures();
    let calls = 0;
    const failing = async () => {
      calls++;
      throw new Error('timeout');
    };
    for (let i = 0; i < 5; i++) await indexSeekTables(db, { only: 2, fetch: failing });
    expect(calls).toBe(3);
    resetSeekFailures();
    await indexSeekTables(db, { only: 2, fetch: failing });
    expect(calls).toBe(4);
  });
});
