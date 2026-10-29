import { z } from 'zod';

// Closed list so search_mentions can validate its category argument. 股票 lives in
// `stocks` in the summary but is stored as a mention row with category 股票.
export const MENTION_CATEGORIES = [
  '美食', '運動', '旅遊', '書影音', '遊戲', '科技產品', '健康', '家庭', '公益', '其他',
] as const;
export const STOCK_CATEGORY = '股票';
export type MentionCategory = (typeof MENTION_CATEGORIES)[number];

// What the model returns. Timestamps are "m:ss" strings copied from the transcript
// line labels (minutes may exceed 59); the worker converts them to seconds.
const Ts = z.string().describe('時間戳，照抄逐字稿行首的 m:ss，例如 "30:49"');
const Point = z.object({ t: Ts, text: z.string() });

export const LlmSummary = z.object({
  keys: z.array(Point).describe('整集最重要的 3 個重點，每個一句話'),
  chapters: z.array(z.object({
    t: Ts,
    title: z.string().describe('章節標題，15 字以內'),
    ad: z.boolean().describe('業配段落為 true'),
    bullets: z.array(Point).describe('章節重點，每個一兩句話'),
    quote: Point.nullable().describe('這段最有代表性的一句原話，沒有就 null'),
  })),
  stocks: z.array(z.object({
    name: z.string().describe('公司名稱'),
    code: z.string().nullable().describe('台股代號或美股 ticker，不確定就 null'),
    t: Ts,
    note: z.string().describe('主持人說了什麼，只轉述，不判斷看多看空'),
  })),
  mentions: z.array(z.object({
    category: z.enum(MENTION_CATEGORIES),
    name: z.string().describe('具體名稱，例如店名、運動、地點、書名'),
    t: Ts,
    quote: z.string().describe('提到時的原話，30 字以內'),
  })),
});
export type LlmSummary = z.infer<typeof LlmSummary>;

// What is stored in episodes.summary_json and rendered on the episode page.
export type Point = { t: number; text: string };
export type Summary = {
  keys: Point[];
  chapters: { t: number; title: string; ad: boolean; bullets: Point[]; quote: Point | null }[];
  stocks: { name: string; code: string | null; t: number; note: string }[];
  mentions: { category: MentionCategory; name: string; t: number; quote: string }[];
};

export function parseTimestamp(s: string): number | null {
  const m = /^\s*(?:(\d+):)?(\d+):(\d{1,2})(?:\.\d+)?\s*$/.exec(s);
  if (!m) return null;
  const [, h, mm, ss] = m;
  const sec = Number(h ?? 0) * 3600 + Number(mm) * 60 + Number(ss);
  return Number(ss) < 60 ? sec : null;
}

export function formatTimestamp(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Model output is untrusted (transcripts include listener messages read on air), so
// cap every field and drop items whose timestamp doesn't land inside the episode.
export function sanitizeSummary(raw: LlmSummary, durationSec: number): Summary {
  const sec = (t: string) => {
    const v = parseTimestamp(t);
    return v !== null && v <= durationSec + 5 ? v : null;
  };
  const point = (p: { t: string; text: string }, max: number): Point | null => {
    const t = sec(p.t);
    const text = clean(p.text, max);
    return t === null || !text ? null : { t, text };
  };
  const nonNull = <T>(x: T | null): x is T => x !== null;

  return {
    keys: raw.keys.map((p) => point(p, 80)).filter(nonNull).slice(0, 3),
    chapters: raw.chapters
      .map((c) => {
        const t = sec(c.t);
        const title = clean(c.title, 30);
        if (t === null || !title) return null;
        return {
          t,
          title,
          ad: c.ad,
          bullets: c.bullets.map((p) => point(p, 160)).filter(nonNull).slice(0, 12),
          quote: c.quote ? point(c.quote, 100) : null,
        };
      })
      .filter(nonNull)
      .sort((a, b) => a.t - b.t)
      .slice(0, 20),
    stocks: raw.stocks
      .map((s) => {
        const t = sec(s.t);
        const name = clean(s.name, 30);
        if (t === null || !name) return null;
        const code = s.code ? clean(s.code, 12).toUpperCase() || null : null;
        return { name, code, t, note: clean(s.note, 80) };
      })
      .filter(nonNull)
      .slice(0, 40),
    mentions: raw.mentions
      .map((m) => {
        const t = sec(m.t);
        const name = clean(m.name, 40);
        if (t === null || !name || !MENTION_CATEGORIES.includes(m.category)) return null;
        return { category: m.category, name, t, quote: clean(m.quote, 60) };
      })
      .filter(nonNull)
      .slice(0, 60),
  };
}

function clean(s: string, max: number): string {
  const flat = s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return [...flat].slice(0, max).join('');
}
