// What a typo report may hold, shared by the episode page's form (in the browser) and
// src/lib/reports.ts (on the server). No imports, so the page's bundle stays small.

export type ReportTarget = 'transcript' | 'summary';

export const REPORT_DAILY_LIMIT = 10;
// Code points, for the words selected and the suggestion: a typo is a word or a name
export const MAX_REPORT_CHARS = 30;
export const MAX_NOTE_CHARS = 200;

export const charCount = (s: string) => [...s].length;
