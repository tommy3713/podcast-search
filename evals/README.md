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
| `refuse` | `true` when the answer must cite nothing (`outcome` is `no_source`). With `false` and no `expect_eps`, citing is optional |
| `note` | where the answer is, and why the question is hard |

Rules:

- Write questions that stay true as new episodes are added: give dates (`2026 年 10 月 15 日之後`) rather than `最近`, and for lists use `min_eps` rather than an exact set.
- Write questions that stay true as older episodes are backfilled. The answers are only checked against the episodes in the database at the time, and backfill adds hundreds of older ones. Ask about something that happened at a known time (an earnings call, a product launch, a trip), which no older episode can contain. For what the host comes back to again and again (family, hobbies, bands, habits), put the date or the episode in the question.
- After each backfill batch, add questions whose answers are in the episodes just added, `crowded` ones first. Neither search limit ever cuts the episodes that were in the database first: transcript keyword search keeps the first 200 matching chunks per term in insertion order, and `search_mentions` keeps the 30 rows from the newest episodes. A set whose answers are all in EP692–712 stays green while questions about backfilled episodes fail. Episodes released after a backfill are inserted last, so they need `crowded` questions too.
- After each batch, before reading a failure as a regression, run `--retrieval-only` and look at the questions whose `queries` now match the added episodes: a `not_found` question may have an answer, and another question a second right answer.
- The repo is public. Rewrite questions taken from the Q&A log in your own words, and leave out listeners' names and anything else personal (listener messages are read on air, so transcripts have them too).
