# /ask golden set

`golden.jsonl` lists questions for checking `/ask` (issue #24), one JSON object per line. It stores checks rather than full answers, since the wording changes from run to run.

| Field | Meaning |
|---|---|
| `id` | `<type>-<nn>`, never reused |
| `type` | `detail`, `typo` (the transcript or the question uses a different spelling), `list`, `time`, `old`, `safety`, `not_found` |
| `question` | what a listener would type |
| `expect_eps` | episodes that must appear in the answer's sources |
| `min_eps` | for list questions: how many of `expect_eps` must appear (default: all) |
| `queries` | search terms for `--retrieval-only`, which calls the search functions directly |
| `points` | what the answer must say, each judged yes/no |
| `must_not` | strings the answer must not contain |
| `refuse` | `true` when the answer should cite nothing (`outcome` is `no_source`) |
| `note` | where the answer is, and why the question is hard |

Rules:

- Write questions that stay true as episodes are added: give dates (`2026 年 10 月 15 日之後`) rather than `最近`, and for lists use `min_eps` rather than an exact set.
- The repo is public. Rewrite questions taken from the Q&A log in your own words, and leave out listeners' names and anything else personal (listener messages are read on air, so transcripts have them too).
