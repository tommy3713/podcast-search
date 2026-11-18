import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ImageResponse } from 'next/og';
import subsetFont from 'subset-font';
import type { DB } from '../db.ts';
import { formatDate } from '../format.ts';
import type { Summary } from '../summary.ts';

// An episode's share image (/ep/<n>/opengraph-image, 1200×630): its number and date, line and
// first key points, and stocks, from the summary only, like the page. Drawn by next/og
// (satori + resvg) with Noto Serif TC Bold for the line and Noto Sans TC Medium for the rest
// (OFL, in assets/og-fonts: outside src, so the worker's image doesn't carry them), each cut
// down first to the characters this image uses (subset-font, harfbuzz): a whole CJK font is
// 6–8 MB, which satori would parse on every image. Kept in memory per episode and its
// updated_at, so a summary edit draws it again.
export const OG_SIZE = { width: 1200, height: 630 };
export const OG_KEYS = 3;
export const OG_STOCKS = 4;
// About 120 KB each; Cloudflare keeps them a day too, so few are drawn twice
const CACHE_MAX = 60;

export type OgEpisode = { no: number; publishedAt: string; updatedAt: string; line: string; keys: string[]; stocks: string[] };

// Characters the two fonts have: CJK ideographs, kana, bopomofo, CJK and full-width
// punctuation, Latin. next/og fetches any other (an emoji, Hangul) from a CDN while it draws,
// a request from the server on untrusted text, so they are left out instead.
const DRAWABLE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Bopomofo} -~ -ÿ‐-‧‰-⁞　-〿＀-￯]/u;
export const drawable = (s: string) => [...s].filter((ch) => DRAWABLE.test(ch)).join('').replace(/\s+/g, ' ').trim();

// The summary as the page reads it (JSON.parse as Summary, written by sanitizeSummary), each
// part only where it has the shape the page expects
export function ogEpisode(db: DB, no: number): OgEpisode | null {
  const r = db
    .prepare(`SELECT episode_no AS no, published_at AS publishedAt, updated_at AS updatedAt, summary_json FROM episodes WHERE episode_no = ? AND status = 'done'`)
    .get(no) as { no: number; publishedAt: string; updatedAt: string; summary_json: string | null } | undefined;
  if (!r) return null;
  let s: Partial<Summary> = {};
  try {
    s = (JSON.parse(r.summary_json ?? '{}') ?? {}) as Partial<Summary>;
  } catch {
    // a summary that doesn't parse: the episode without it
  }
  const texts = (xs: unknown, pick: (x: Record<string, unknown>) => unknown, max: number) =>
    [...new Set((Array.isArray(xs) ? xs : []).map((x) => (x && typeof x === 'object' ? pick(x as Record<string, unknown>) : null)).filter((t): t is string => typeof t === 'string').map(drawable).filter(Boolean))].slice(0, max);
  return {
    no: r.no,
    publishedAt: r.publishedAt,
    updatedAt: r.updatedAt,
    line: typeof s.line === 'string' ? drawable(s.line) : '',
    keys: texts(s.keys, (k) => k.text, OG_KEYS),
    stocks: texts(s.stocks, (k) => k.name, OG_STOCKS),
  };
}

const FONT_DIR = path.join(process.cwd(), 'assets/og-fonts');
let fonts: Promise<{ serif: Buffer; sans: Buffer }> | undefined;
// Read once; a failed read is tried again on the next image rather than kept
const loadFonts = () =>
  (fonts ??= Promise.all([readFile(path.join(FONT_DIR, 'NotoSerifTC-Bold.otf')), readFile(path.join(FONT_DIR, 'NotoSansTC-Medium.otf'))])
    .then(([serif, sans]) => ({ serif, sans }))
    .catch((err) => {
      fonts = undefined;
      throw err;
    }));

// Text cut to about `units` CJK characters wide, with … where it was cut. Done here rather
// than by satori's text-overflow, which cut its own ellipsis in half on a line full of CJK.
// Widths in em of Noto Sans / Serif TC, rounded up: capitals and W, M are wider than the
// rest of ASCII.
const width = (ch: string) => (/[A-Z]/.test(ch) ? (/[MW]/.test(ch) ? 0.9 : 0.7) : /[\x20-\x7e]/.test(ch) ? 0.55 : 1);
export function fit(text: string, units: number): string {
  let w = 0;
  let out = '';
  const chars = [...text];
  for (const [i, ch] of chars.entries()) {
    w += width(ch);
    if (w > units - (i < chars.length - 1 ? 1 : 0)) return `${out.trimEnd()}…`;
    out += ch;
  }
  return out;
}
export const textWidth = (text: string) => [...text].reduce((w, ch) => w + width(ch), 0);
// About how many CJK characters fit: a key point on its line (28 px over ~1018 px); the line
// on its two (58 px over ~1044 px is 36, less a margin for words moved whole to the next line)
const KEY_UNITS = 35;
const LINE_UNITS = 30;
// The stock chips share their row with the footer (about 400 px): each cut to 8 characters
// (22 px), and only as many as fit in about 620 px (a chip's padding, border and gap are about
// 1.9 characters)
const STOCK_UNITS = 8;
const STOCK_ROW_UNITS = 28;
export function fitStocks(names: string[]): string[] {
  const out: string[] = [];
  let used = 0;
  for (const n of names) {
    const s = fit(n, STOCK_UNITS);
    const w = textWidth(s) + 1.9;
    if (used + w > STOCK_ROW_UNITS) break;
    out.push(s);
    used += w;
  }
  return out;
}

// Every character drawn in each font
export function glyphs(texts: string[]): string {
  return [...new Set(texts.join(''))].join('');
}

const INK = '#1d2733';
const MUTED = '#5f6b7a';
const SLATE = '#537395';
const TEAL = '#2f8f73';
const TEAL_SOFT = 'rgba(106, 215, 180, 0.22)';

function card(ep: OgEpisode, date: string) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#f6f8fb', fontFamily: 'Sans', color: INK, position: 'relative' }}>
      {/* The episode number, large and faint behind the card's right side */}
      <div style={{ position: 'absolute', right: -10, bottom: -70, fontFamily: 'Serif', fontSize: 300, color: SLATE, opacity: 0.06, letterSpacing: -12 }}>{`EP${ep.no}`}</div>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 14, background: `linear-gradient(180deg, ${SLATE}, #6ad7b4)` }} />
      <div style={{ display: 'flex', flexDirection: 'column', padding: '56px 72px 48px 84px', height: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 28 }}>
          <div style={{ display: 'flex', background: TEAL_SOFT, color: TEAL, borderRadius: 999, padding: '6px 18px', fontSize: 24 }}>股癌 Gooaye</div>
          <div style={{ display: 'flex', fontFamily: 'Serif', fontSize: 40, color: INK }}>{`EP${ep.no}`}</div>
          <div style={{ display: 'flex', color: MUTED }}>{date}</div>
        </div>
        {ep.line && (
          <div style={{ display: 'block', marginTop: 30, fontFamily: 'Serif', fontSize: 58, lineHeight: 1.3, maxHeight: 151, overflow: 'hidden', color: INK }}>{ep.line}</div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 30 }}>
          {ep.keys.map((k, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16, width: '100%', fontSize: 28, color: '#2b3644' }}>
              <div style={{ display: 'flex', width: 10, height: 10, borderRadius: 999, background: '#6ad7b4', flexShrink: 0 }} />
              <div style={{ display: 'block', flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' }}>{k}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 'auto', gap: 12 }}>
          {ep.stocks.map((s) => (
            <div key={s} style={{ display: 'flex', flexShrink: 0, border: '2px solid #d7dee7', background: '#ffffff', borderRadius: 10, padding: '4px 14px', fontSize: 22, color: '#2b3644', whiteSpace: 'nowrap' }}>
              {s}
            </div>
          ))}
          <div style={{ display: 'flex', flexShrink: 0, marginLeft: 'auto', alignItems: 'baseline', gap: 12, fontSize: 22, color: MUTED }}>
            <span style={{ fontSize: 28, color: SLATE }}>Gooaye Search</span>
            <span>非官方粉絲網站</span>
          </div>
        </div>
      </div>
    </div>
  );
}

async function draw(ep: OgEpisode): Promise<ArrayBuffer> {
  const date = formatDate(ep.publishedAt);
  const shown = { ...ep, line: fit(ep.line, LINE_UNITS), keys: ep.keys.map((k) => fit(k, KEY_UNITS)), stocks: fitStocks(ep.stocks) };
  const { serif, sans } = await loadFonts();
  const serifText = glyphs([`EP${ep.no}`, shown.line]);
  const sansText = glyphs(['股癌 Gooaye', date, ...shown.keys, ...shown.stocks, 'Gooaye Search', '非官方粉絲網站']);
  const [serifSub, sansSub] = await Promise.all([subsetFont(serif, serifText, { targetFormat: 'sfnt' }), subsetFont(sans, sansText, { targetFormat: 'sfnt' })]);
  return new ImageResponse(card(shown, date), {
    ...OG_SIZE,
    fonts: [
      { name: 'Serif', data: serifSub, weight: 700, style: 'normal' },
      { name: 'Sans', data: sansSub, weight: 500, style: 'normal' },
    ],
  }).arrayBuffer();
}

// The drawing, kept while it is under way too, so crawlers asking for a new episode's image at
// once (X, Facebook, LINE and Cloudflare's edges) share one drawing on the one-CPU server
const cache = new Map<string, Promise<ArrayBuffer>>();

// The PNG for an episode, drawn once per version of its summary
export function episodeImage(ep: OgEpisode): Promise<ArrayBuffer> {
  const key = `${ep.no} ${ep.updatedAt}`;
  const hit = cache.get(key);
  if (hit) {
    // To the back: the least recently used goes first
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  // An older version of this episode's goes, then the least recently used past the limit
  for (const k of [...cache.keys()]) if (k.startsWith(`${ep.no} `)) cache.delete(k);
  while (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  const drawing = draw(ep);
  cache.set(key, drawing);
  // A failure isn't kept: the next request draws again
  drawing.catch(() => {
    if (cache.get(key) === drawing) cache.delete(key);
  });
  return drawing;
}
