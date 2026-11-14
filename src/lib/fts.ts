// Quoting for the chunks_fts / chunks_pinyin MATCH queries and the LIKE fallback, shared by
// the Q&A search (src/lib/ask/search.ts) and the admin's report hints (src/lib/reports.ts).
// No imports: search.ts loads pinyin-pro, which the report routes shouldn't.

// One FTS5 phrase: the term as it is, double quotes doubled
export const ftsPhrase = (term: string) => `"${term.replace(/"/g, '""')}"`;
// A LIKE pattern for the term anywhere, with ESCAPE '\'
export const likePattern = (term: string) => `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
