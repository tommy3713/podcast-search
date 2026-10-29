// Ask a question from the terminal against the local database (dev only; no quota).
// Usage: tsx --env-file=.env.local scripts/ask-cli.ts "問題"
import OpenAI from 'openai';
import { answer, type Source } from '../src/lib/ask/agent.ts';
import { taipeiDate } from '../src/lib/ask/quota.ts';
import { openDb } from '../src/lib/db.ts';

const question = process.argv[2];
if (!question) throw new Error('usage: ask-cli.ts "問題"');
const db = openDb(undefined, { readonly: true });
const cov = db.prepare(`SELECT COUNT(*) AS count, MIN(episode_no) AS oldest, MAX(episode_no) AS newest FROM episodes WHERE status = 'done'`).get() as {
  count: number;
  oldest: number;
  newest: number;
};
const sources = new Map<number, Source>();
const started = Date.now();
const logs = await answer(question, {
  db,
  client: new OpenAI(),
  coverage: { ...cov, today: taipeiDate() },
  emit: (e) => {
    if (e.type === 'status') console.log(`… ${e.text}`);
    if (e.type === 'sources') for (const s of e.sources) sources.set(s.n, s);
    if (e.type === 'delta') process.stdout.write(e.text);
    if (e.type === 'reset') console.log('\n[reset]');
  },
});
console.log(`\n\n${logs.length} tool calls, ${sources.size} sources, ${((Date.now() - started) / 1000).toFixed(1)}s`);
for (const n of new Set([...(process.env.SHOW_ALL ? sources.keys() : [])])) console.log(n, sources.get(n));
