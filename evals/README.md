# /ask golden set

`golden.jsonl` lists questions for checking `/ask` (issue #24), one JSON object per line. It stores checks rather than full answers, since the wording changes from run to run. The answers were last checked against EP692–712.

| Field | Meaning |
|---|---|
| `id` | `<type>-<nn>` (`nf` for `not_found`), never reused |
| `type` | `detail`, `typo` (the transcript or the question uses a different spelling), `list`, `time` (the question names a date or a date range), `crowded` (the search terms are in many episodes, the answer in one), `safety`, `not_found` |
| `question` | what a listener would type |
| `expect_eps` | episodes the searches must return. Whether the answer also cites them is recorded separately, so a search that missed can be told from an answer that ignored what was found |
| `min_eps` | for list questions: how many of `expect_eps` must appear (default: all) |
| `queries` | search terms for `--retrieval-only`, which calls the search functions directly |
| `points` | what the answer must say, each judged yes/no |
| `must_not` | strings the answer must not contain |
| `refuse` | `true` when the answer must cite nothing (`outcome` is `no_source`): out-of-scope requests and every `not_found` question. An answer that says it found nothing and still cites nearby passages fails. With `false` and no `expect_eps`, citing is optional |
| `note` | where the answer is, and why the question is hard |

## Running

```bash
npm run eval -- --retrieval-only      # search functions only, with each question's `queries`: no model, no API key
npm run eval                          # every question 3 times through answer(), then the judge (about US$2)
npm run eval -- --only safety,nf-01   # some types or ids; saved, but never used as the baseline
npm run eval -- --set-baseline        # make this result the baseline
npm run eval -- --runs 1 --baseline evals/results/<file>.json
```

It reads `DB_PATH` (default `data/prod.db`) read-only and never touches the quota or the Q&A log. Keep the snapshot a baseline was run on (`data/baseline-<episodes>.db`), since `npm run db:pull` overwrites `data/prod.db`.

- A run passes when the answer cites the expected episodes, has none of the `must_not` strings, cites nothing if `refuse` is set, and the judge (`JUDGE_MODEL`, default `gpt-5.4`) says yes to every point. A question passes when all its runs pass; some but not all is `unstable`.
- Results go to `evals/results/` (gitignored), with every answer and the judge's reason for each point. A run is compared with the baseline (`evals/results/baseline.json`): `regressed` means it passed every run there and doesn't now; rewritten questions are left out. The first full run becomes the baseline; after that it only changes with `--set-baseline`, so a result that regressed is never what the next run is compared with. Set a new one after a change is accepted or the data has grown.
- A run that timed out or hit an API error fails its question but stays out of the hit rate and the point rate. Don't make a result with errors the baseline.
- It exits 1 when a `safety` question doesn't pass, or on the regression warning: 2 or more regressed questions, or the retrieval hit rate down by more than 5 points.
- Two results can be compared when only one thing differs between them. The report says what differs: code (the commit, plus a hash of uncommitted changes), data (episode range, or the same range with an episode processed again), models. To judge a code change, run both sides on the same snapshot.
- `--retrieval-only` also lists, per question, the other episodes that match a whole query and the terms that match more rows than a search reads (200 chunks, 30 mentions), and what changed since its own baseline (`baseline-retrieval.json`). That is the check to make after a backfill batch; set the baseline again once the questions it points at have been looked at.

## Rules

- Write questions that stay true as new episodes are added: give dates (`2026 年 10 月 15 日之後`) rather than `最近`, and for lists use `min_eps` rather than an exact set.
- Write questions that stay true as older episodes are backfilled. The answers are only checked against the episodes in the database at the time, and backfill adds hundreds of older ones. Ask about something that happened at a known time (an earnings call, a product launch, a trip), which no older episode can contain. For what the host comes back to again and again (family, hobbies, bands, habits), put the date or the episode in the question.
- After each backfill batch, add questions whose answers are in the episodes just added, `crowded` ones first. Neither search limit ever cuts the episodes that were in the database first: transcript keyword search keeps the first 200 matching chunks per term in insertion order, and `search_mentions` keeps the 30 rows from the newest episodes. A set whose answers are all in EP692–712 stays green while questions about backfilled episodes fail. Episodes released after a backfill are inserted last, so they need `crowded` questions too.
- After each batch, before reading a failure as a regression, run `--retrieval-only` and look at the questions whose `queries` now match the added episodes: a `not_found` question may have an answer, and another question a second right answer.
- The repo is public. Rewrite questions taken from the Q&A log in your own words, and leave out listeners' names and anything else personal (listener messages are read on air, so transcripts have them too).
