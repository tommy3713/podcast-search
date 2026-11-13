// Where a browser really is in an episode after a seek (worker/seek-table.ts makes the table).
// SoundOn's MP3s are VBR, and browsers seek them through the Xing table of contents, then keep
// counting currentTime from the time they meant to reach. Measured on EP699 against the
// decoded audio, on a fresh element or right after load() (later seeks also depend on what
// the element has read, so the player reloads before each seek):
// - 'entry' (Chromium): setting currentTime to t in the i-th 1% of the episode plays
//   t + offsets[10 i]. Model within 0.07 s at 4 points.
// - 'interp' (Safari on macOS): it interpolates a byte position between the entries and plays
//   from there. Model within 0.16 s at 5 points.
// offsets[k] (k = 0..1000) is where a seek that interpolates to k/1000 of the duration plays,
// less that time; TOC entry i is point 10 i.
export type SeekTable = { duration: number; offsets: number[] };
export type SeekModel = 'entry' | 'interp';

export const GRID = 1000;
const PER_ENTRY = GRID / 100;

// What seek_json holds for a file with nothing to correct (CBR, or no table of contents)
export const NO_SEEK_TABLE: SeekTable = { duration: 0, offsets: [] };

// Browsers not measured are left alone, since correcting one that seeks some other way would
// add an error instead: Firefox, every iOS browser (WebKit with iOS's own media stack), and
// WebKit on Linux. navigator.userAgentData exists only in Chromium; iPadOS sends a Mac user
// agent, but has a touch screen.
export function seekModel(nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator): SeekModel | null {
  if (!nav) return null;
  if ('userAgentData' in nav) return 'entry';
  const ua = nav.userAgent;
  const macSafari =
    /\bMacintosh\b/.test(ua) &&
    /\bVersion\/[\d.]+.*\bSafari\//.test(ua) &&
    !/(Chrome|Chromium|CriOS|FxiOS|EdgiOS|Edg|OPR|Firefox)\//.test(ua) &&
    (nav.maxTouchPoints ?? 0) <= 1;
  return macSafari ? 'interp' : null;
}

// A stored seek_json; null when there's nothing to correct, it can't be read, or it's from
// an older format (seek-index.ts redoes those)
export function parseSeekTable(json: string | null): SeekTable | null {
  if (!json) return null;
  try {
    const t = JSON.parse(json) as SeekTable;
    if (!(t.duration > 0) || !Array.isArray(t.offsets) || t.offsets.length !== GRID + 1) return null;
    if (!t.offsets.every(Number.isFinite)) return null;
    // Landings never go down (interpTarget searches them); allow the rounding to 0.01 s
    const step = t.duration / GRID;
    for (let k = 1; k <= GRID; k++) if (step + t.offsets[k]! - t.offsets[k - 1]! < -0.02) return null;
    return { duration: t.duration, offsets: t.offsets };
  } catch {
    return null;
  }
}

// Kept from window edges, and the landing allowed past the target: the browser's duration
// differs from the stored one by a few hundredths
const EDGE = 0.05;

const entryOffset = (table: SeekTable, i: number) => table.offsets[i * PER_ENTRY]!;

function windowOf(table: SeekTable, t: number): number {
  return Math.min(99, Math.max(0, Math.floor((t / table.duration) * 100)));
}

function landingAt(table: SeekTable, t: number): number {
  const o = table.offsets;
  const pos = Math.min(Math.max(0, t / table.duration), 1) * GRID;
  const k = Math.min(GRID - 1, Math.floor(pos));
  return t + o[k]! + (o[k + 1]! - o[k]!) * (pos - k);
}

// How far the audio is from currentTime after seeking to t
export function offsetAt(table: SeekTable, t: number, model: SeekModel): number {
  return model === 'interp' ? landingAt(table, t) - t : entryOffset(table, windowOf(table, t));
}

// The currentTime to set so the audio plays as close to x as it can. Some positions can't be
// reached exactly (the windows on either side land past them); the nearest landing no more
// than a margin past x wins then, so nothing the listener asked for is skipped.
export function seekTarget(table: SeekTable, x: number, model: SeekModel): number {
  if (!(table.duration > 0) || table.offsets.length !== GRID + 1) return x;
  return model === 'interp' ? interpTarget(table, x) : entryTarget(table, x);
}

function entryTarget(table: SeekTable, x: number): number {
  const w = table.duration / 100;
  let best = x;
  let bestLand = Number.NaN;
  for (let i = 0; i < 100; i++) {
    const e = entryOffset(table, i);
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

// The last grid point landing at or before x and the straight line to the next one give the
// time (landings never go down: parseSeekTable)
function interpTarget(table: SeekTable, x: number): number {
  const step = table.duration / GRID;
  const land = (k: number) => k * step + table.offsets[k]!;
  if (x <= land(0)) return 0;
  if (x >= land(GRID)) return table.duration;
  let lo = 0;
  let hi = GRID;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (land(mid) <= x) lo = mid;
    else hi = mid;
  }
  const span = land(hi) - land(lo);
  return (lo + (span > 0 ? (x - land(lo)) / span : 0)) * step;
}

// For a page that plays one spot of many episodes (a stock's page): the currentTime to set
// on a freshly loaded element and how far the audio then is from it, for each model, so the
// page needn't carry the tables. [currentTime, offset], to 0.01 s.
export type PlayPoint = { entry: [number, number]; interp: [number, number] };

export function playPoint(table: SeekTable | null, t: number): PlayPoint | null {
  if (!table) return null;
  const round = (x: number) => Math.round(x * 100) / 100;
  const at = (model: SeekModel): [number, number] => {
    const target = seekTarget(table, t, model);
    return [round(target), round(offsetAt(table, target, model))];
  };
  return { entry: at('entry'), interp: at('interp') };
}
