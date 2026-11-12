// Where a browser really is in an episode after a seek (worker/seek-table.ts makes the table).
// Chromium seeks a VBR MP3 through its Xing table of contents: setting currentTime to t in
// the i-th 1% of the episode plays t + offsets[i], and currentTime keeps counting from t.
// Measured on EP699 in Chrome against the decoded audio, within 0.05 s at 4 points.
export type SeekTable = { duration: number; offsets: number[] };

// Only Chromium is known to seek this way. Others (Safari, Firefox) are left as they are
// until measured: correcting a browser that seeks exactly would add the error instead.
// navigator.userAgentData exists only in Chromium, which iOS doesn't have.
export function seeksByToc(nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  return !!nav && 'userAgentData' in nav;
}

const EDGE = 0.05;

function windowOf(table: SeekTable, t: number): number {
  const n = table.offsets.length;
  return Math.min(n - 1, Math.max(0, Math.floor((t / table.duration) * n)));
}

// What seek_json holds for a file with nothing to correct (CBR, or no table of contents)
export const NO_SEEK_TABLE: SeekTable = { duration: 0, offsets: [] };

// A stored seek_json; null when there's nothing to correct or it can't be read
export function parseSeekTable(json: string | null): SeekTable | null {
  if (!json) return null;
  try {
    const t = JSON.parse(json) as SeekTable;
    const ok = t.duration > 0 && Array.isArray(t.offsets) && t.offsets.length > 0 && t.offsets.every(Number.isFinite);
    return ok ? { duration: t.duration, offsets: t.offsets } : null;
  } catch {
    return null;
  }
}

// How far the audio is from currentTime after seeking to t
export function offsetAt(table: SeekTable, t: number): number {
  return table.offsets[windowOf(table, t)] ?? 0;
}

// The currentTime to set so the audio plays as close to x as it can. Some positions can't be
// reached exactly (the windows on either side land past them); the nearest landing at or
// before x wins then, so nothing the listener asked for is skipped.
export function seekTarget(table: SeekTable, x: number): number {
  const n = table.offsets.length;
  if (!n || !(table.duration > 0)) return x;
  const w = table.duration / n;
  let best = x;
  let bestLand = Number.NaN;
  for (let i = 0; i < n; i++) {
    const e = table.offsets[i]!;
    // Inside window i with a margin at both ends, since the browser's duration differs from
    // the stored one by a few hundredths
    const t = Math.min(Math.max(x - e, i * w + EDGE), (i + 1) * w - EDGE);
    const land = t + e;
    // Landing up to the margin past x skips nothing worth hearing
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
