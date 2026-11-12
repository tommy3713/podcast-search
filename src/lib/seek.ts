// Where a browser really is in an episode after a seek (worker/seek-table.ts makes the table).
// SoundOn's MP3s are VBR, and browsers seek them through the Xing table of contents, then keep
// counting currentTime from the time they meant to reach. Measured on EP699 against the
// decoded audio, on a fresh element or right after load() (later seeks also depend on what
// the element has read, so the player reloads before each seek):
// - 'entry' (Chromium): setting currentTime to t in the i-th 1% of the episode plays
//   t + offsets[i]. Model within 0.07 s at 4 points.
// - 'interp' (Safari): it interpolates a byte position between the entries and plays from
//   there: landings[k] is where a seek to k/1000 of the duration plays. Model within 0.16 s at 5
//   points.
export type SeekTable = { duration: number; offsets: number[]; landings?: number[] };
export type SeekModel = 'entry' | 'interp';

// What seek_json holds for a file with nothing to correct (CBR, or no table of contents)
export const NO_SEEK_TABLE: SeekTable = { duration: 0, offsets: [] };

// Firefox isn't measured yet, and correcting a browser that seeks some other way would add an
// error instead, so it's left alone. navigator.userAgentData exists only in Chromium (not on
// iOS, where every browser is WebKit).
export function seekModel(nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator): SeekModel | null {
  if (!nav) return null;
  if ('userAgentData' in nav) return 'entry';
  const ua = nav.userAgent;
  if (/(CriOS|FxiOS|EdgiOS)\//.test(ua)) return 'interp';
  if (/AppleWebKit\//.test(ua) && !/(Chrome|Chromium|Edg|OPR|Android)\b/.test(ua)) return 'interp';
  return null;
}

// The model to use for this table, or null when the table can't serve it
export function usableModel(table: SeekTable | null, model: SeekModel | null): SeekModel | null {
  if (!table || !model) return null;
  if (model === 'interp' && !(table.landings && table.landings.length >= 2)) return null;
  return model;
}

// A stored seek_json; null when there's nothing to correct or it can't be read
export function parseSeekTable(json: string | null): SeekTable | null {
  if (!json) return null;
  try {
    const t = JSON.parse(json) as SeekTable;
    const ok = t.duration > 0 && Array.isArray(t.offsets) && t.offsets.length > 0 && t.offsets.every(Number.isFinite);
    if (!ok) return null;
    const landings = Array.isArray(t.landings) && t.landings.every(Number.isFinite) ? t.landings : undefined;
    return { duration: t.duration, offsets: t.offsets, ...(landings && { landings }) };
  } catch {
    return null;
  }
}

// Kept from window edges, and the landing allowed past the target: the browser's duration
// differs from the stored one by a few hundredths
const EDGE = 0.05;

function windowOf(table: SeekTable, t: number): number {
  const n = table.offsets.length;
  return Math.min(n - 1, Math.max(0, Math.floor((t / table.duration) * n)));
}

function landingAt(table: SeekTable, t: number): number {
  const l = table.landings!;
  const pos = Math.min(Math.max(0, t / table.duration), 1) * (l.length - 1);
  const k = Math.min(l.length - 2, Math.floor(pos));
  return l[k]! + (l[k + 1]! - l[k]!) * (pos - k);
}

// How far the audio is from currentTime after seeking to t
export function offsetAt(table: SeekTable, t: number, model: SeekModel = 'entry'): number {
  if (model === 'interp') return landingAt(table, t) - t;
  return table.offsets[windowOf(table, t)] ?? 0;
}

// The currentTime to set so the audio plays as close to x as it can. Some positions can't be
// reached exactly (the windows on either side land past them); the nearest landing no more
// than a margin past x wins then, so nothing the listener asked for is skipped.
export function seekTarget(table: SeekTable, x: number, model: SeekModel = 'entry'): number {
  if (!(table.duration > 0)) return x;
  return model === 'interp' ? interpTarget(table, x) : entryTarget(table, x);
}

function entryTarget(table: SeekTable, x: number): number {
  const n = table.offsets.length;
  if (!n) return x;
  const w = table.duration / n;
  let best = x;
  let bestLand = Number.NaN;
  for (let i = 0; i < n; i++) {
    const e = table.offsets[i]!;
    const t = Math.min(Math.max(x - e, i * w + EDGE), (i + 1) * w - EDGE);
    const land = t + e;
    const ok = land <= x + EDGE + 1e-6;
    const bestOk = bestLand <= x + EDGE + 1e-6;
    const better =
      Number.isNaN(bestLand) ||
      (ok && (!bestOk || Math.abs(land - x) < Math.abs(bestLand - x))) ||
      (!ok && !bestOk && land < bestLand);
    if (better && windowOf(table, t) === i) {
      best = t;
      bestLand = land;
    }
  }
  return Math.max(0, best);
}

// Landings never go down, so the last grid point landing at or before x and the straight
// line to the next one give the time
function interpTarget(table: SeekTable, x: number): number {
  const l = table.landings;
  if (!l || l.length < 2) return x;
  const step = table.duration / (l.length - 1);
  if (x <= l[0]!) return 0;
  if (x >= l.at(-1)!) return table.duration;
  let lo = 0;
  let hi = l.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (l[mid]! <= x) lo = mid;
    else hi = mid;
  }
  const span = l[hi]! - l[lo]!;
  return (lo + (span > 0 ? (x - l[lo]!) / span : 0)) * step;
}
