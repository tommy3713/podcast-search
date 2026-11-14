import { type AdminSegment, adminEpisode } from './admin-edits.ts';
import type { DB } from './db.ts';
import { toPinyin } from './pinyin.ts';
import { type AdminReport, paragraphSegments } from './reports.ts';
import type { Summary } from './summary.ts';
import { countInSummary, summaryTexts } from './summary-edits.ts';
import { replaceMatches, replaceOpen } from './transcript-edits.ts';

// What /admin/reports shows beside a report so it can be decided without leaving the page, and
// what accepting it would change. Worked out on the transcript as it will read with the
// pending edits applied, like the transcript editor.
export type ReportContext = {
  // transcript reports: the first segment of the paragraph selected that has the words
  here: { index: number; start: number; text: string } | null;
  // Occurrences in the episode's transcript (and the segments they're in) and summary
  transcriptCount: number;
  transcriptSegments: number;
  summaryCount: number;
  // A few summary texts with the words, for summary reports
  summaryLines: string[];
  // The words and the suggestion read the same in toneless pinyin: a misheard name, most likely
  sameSound: boolean;
  // Live episodes whose transcript has the words: a hint for a rule across episodes
  episodes: number;
};

const HAN = /\p{Script=Han}/u;

export type ReportEpisode = { id: number; segments: AdminSegment[]; summary: Summary };

export function reportEpisode(db: DB, no: number): ReportEpisode | null {
  const ep = adminEpisode(db, no);
  if (!ep) return null;
  const s = db.prepare('SELECT summary_json FROM episodes WHERE id = ?').get(ep.id) as { summary_json: string | null };
  if (!s.summary_json) return null;
  return { id: ep.id, segments: ep.segments, summary: JSON.parse(s.summary_json) as Summary };
}

// The paragraph's first segment where the words would change with this suggestion (not
// where the suggestion is already written: replaceOpen)
export function reportHere(ep: ReportEpisode, r: AdminReport, suggestion = r.suggestion): ReportContext['here'] {
  if (r.target !== 'transcript' || r.at === null) return null;
  const i = paragraphSegments(ep.segments, r.at).find((k) => replaceOpen(ep.segments[k]!.text, r.original, suggestion, 1).count > 0);
  return i === undefined ? null : { index: i, start: ep.segments[i]!.start, text: ep.segments[i]!.text };
}

// `episodes` takes a cache, since one page asks about the same words for several reports
export function reportContext(ep: ReportEpisode, r: AdminReport, episodes: (words: string) => number): ReportContext {
  const matches = replaceMatches(ep.segments, r.original, r.suggestion);
  return {
    here: reportHere(ep, r),
    transcriptCount: matches.reduce((n, m) => n + m.count, 0),
    transcriptSegments: matches.length,
    summaryCount: countInSummary(ep.summary, r.original, r.suggestion),
    summaryLines: summaryTexts(ep.summary)
      .filter((t) => replaceOpen(t, r.original, r.suggestion, 1).count > 0)
      .slice(0, 5),
    sameSound: HAN.test(r.original) && HAN.test(r.suggestion) && toPinyin(r.original) === toPinyin(r.suggestion),
    episodes: episodes(r.original),
  };
}
