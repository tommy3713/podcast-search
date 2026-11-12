import { beforeEach, describe, expect, it } from 'vitest';
import { type DB, openDb } from '@/lib/db.ts';
import { NO_SEEK_TABLE, offsetAt, parseSeekTable, type SeekTable, seekModel, seekTarget, usableModel } from '@/lib/seek.ts';
import { insertDiscovered } from '../worker/repo.ts';
import { indexSeekTables } from '../worker/seek-index.ts';
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
    expect(t.offsets).toHaveLength(100);
    expect(t.offsets[0]).toBe(0);
    // Entry 50 points at byte 287000 (half of 574000): past the 500 small frames (52000
    // bytes), 226 big frames in, so frame 726 plays while the entry claims 50% of the time
    expect(t.offsets[50]).toBeCloseTo(726 * SPF - DURATION / 2, 1);
    // The cheap first half is crossed in a few entries, so early entries land late
    expect(Math.max(...t.offsets)).toBeGreaterThan(5);
  });

  it("works out where Safari's interpolated seeks land", () => {
    const t = parse(mp3(FRAMES, linearToc))!;
    expect(t.landings).toHaveLength(1001);
    expect(t.landings![0]).toBe(0);
    // 50% interpolates to entry 50 exactly: the same byte as above
    expect(t.landings![500]).toBeCloseTo(726 * SPF, 1);
    // 25%: entry 25, byte 64/256 of 574000 = 143500, 88 big frames past the small ones
    expect(t.landings![250]).toBeCloseTo(588 * SPF, 1);
    expect(t.landings![1000]).toBeCloseTo(DURATION, 1);
    for (let k = 1; k < t.landings!.length; k++) expect(t.landings![k]).toBeGreaterThanOrEqual(t.landings![k - 1]!);
  });

  it('gives near-zero offsets for an accurate table, apart from its 1/256 rounding', () => {
    const t = parse(mp3(FRAMES, exactToc))!;
    // 1/256 of 574000 bytes is 2242, 22 of the small frames
    for (const e of t.offsets) expect(Math.abs(e)).toBeLessThan(22 * SPF);
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

  it('has nothing to correct without the byte count the browser places entries by', () => {
    const file = mp3(FRAMES, linearToc);
    // Flags: frames and TOC, no bytes
    new DataView(file.buffer).setUint32(310 + 25, 5);
    expect(parse(file)).toBeNull();
  });
});

describe('seekTarget / offsetAt', () => {
  const table = (f: (i: number) => number): SeekTable => ({ duration: 100, offsets: Array.from({ length: 100 }, (_, i) => f(i)) });

  it('leaves a table without offsets alone', () => {
    const t = table(() => 0);
    expect(seekTarget(t, 42.5)).toBe(42.5);
    expect(offsetAt(t, 42.5)).toBe(0);
  });

  it('asks for the time that lands on x', () => {
    const t = table(() => -5);
    // 55 is the very start of window 55, so within the margin kept from either edge
    const at = seekTarget(t, 50);
    expect(Math.abs(at - 55)).toBeLessThanOrEqual(0.05 + 1e-9);
    expect(Math.abs(at + offsetAt(t, at) - 50)).toBeLessThanOrEqual(0.05 + 1e-9);
    expect(seekTarget(t, 50.5) + offsetAt(t, seekTarget(t, 50.5))).toBeCloseTo(50.5, 5);
  });

  it('lands just before a position no seek reaches', () => {
    // Window 49 plays 49–50, window 50 plays 55–56 (each less the margins): 52 can't be reached
    const t = table((i) => (i < 50 ? 0 : 5));
    const at = seekTarget(t, 52);
    expect(at + offsetAt(t, at)).toBeCloseTo(49.95, 5);
    expect(seekTarget(t, 55.5) + offsetAt(t, seekTarget(t, 55.5))).toBeCloseTo(55.5, 5);
  });

  it('lands on every position of a real-looking table, or at most a gap early', () => {
    const t = parse(mp3(FRAMES, linearToc))!;
    for (let x = 0; x < t.duration; x += 0.1) {
      const at = seekTarget(t, x);
      const land = at + offsetAt(t, at);
      expect(land).toBeLessThanOrEqual(x + 0.05 + 1e-6);
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
    expect(parseSeekTable(null)).toBeNull();
    expect(parseSeekTable(JSON.stringify(NO_SEEK_TABLE))).toBeNull();
    expect(parseSeekTable('{oops')).toBeNull();
    expect(parseSeekTable('{"duration":10,"offsets":[0,1]}')).toEqual({ duration: 10, offsets: [0, 1] });
    expect(parseSeekTable('{"duration":10,"offsets":[0,1],"landings":[0,9.5,10]}')).toEqual({
      duration: 10,
      offsets: [0, 1],
      landings: [0, 9.5, 10],
    });
  });

  it('picks the model of the browser, and none for one not measured', () => {
    const nav = (userAgent: string, chromium = false) =>
      ({ userAgent, ...(chromium && { userAgentData: {} }) }) as unknown as Navigator;
    const safariMac =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Safari/605.1.15';
    const safariIos =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1';
    const chromeIos =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1';
    const chrome =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
    const firefox = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0';
    expect(seekModel(nav(chrome, true))).toBe('entry');
    expect(seekModel(nav(safariMac))).toBe('interp');
    expect(seekModel(nav(safariIos))).toBe('interp');
    expect(seekModel(nav(chromeIos))).toBe('interp');
    // Chromium without userAgentData (old, or not a secure context): its model isn't known to hold
    expect(seekModel(nav(chrome))).toBeNull();
    expect(seekModel(nav(firefox))).toBeNull();
    expect(seekModel(undefined)).toBeNull();
    // A table from before landings were kept can't serve Safari
    expect(usableModel({ duration: 10, offsets: [0] }, 'interp')).toBeNull();
    expect(usableModel({ duration: 10, offsets: [0] }, 'entry')).toBe('entry');
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
    const asked: string[] = [];
    const r = await indexSeekTables(db, {
      fetch: async (url) => {
        asked.push(url);
        if (url.endsWith('/1.mp3')) throw new Error('403');
        return { duration: 10, offsets: [1] };
      },
    });
    expect(asked).toEqual(['https://example.com/2.mp3', 'https://example.com/1.mp3']);
    expect(r).toEqual({ episodes: 1, failed: [1] });
    expect(stored()).toEqual([
      { episode_no: 1, seek_json: null },
      { episode_no: 2, seek_json: '{"duration":10,"offsets":[1]}' },
      { episode_no: 3, seek_json: null },
    ]);

    // Next time only the one that failed; a file with nothing to correct is remembered too
    const again = await indexSeekTables(db, { fetch: async () => null });
    expect(again).toEqual({ episodes: 1, failed: [] });
    expect(stored()[0]!.seek_json).toBe(JSON.stringify(NO_SEEK_TABLE));
  });
});
