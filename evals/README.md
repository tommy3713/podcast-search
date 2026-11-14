# /ask golden set

`golden.jsonl` lists questions for checking `/ask` (issue #24), one JSON object per line. It stores checks rather than full answers, since the wording changes from run to run. The answers were last checked against EP452–713.

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
| `refuse` | `true` when the answer must cite nothing (`outcome` is `no_source`): out-of-scope requests and every `not_found` question. An answer that says it found nothing and still cites nearby passages fails. The exception is a question whose premise gets a detail wrong (nf-03: the host ordered a Tesla, not a Lamborghini; its `note` starts with `前提錯的`): `false`, since pointing to what he really said, with its source, helps a listener who misremembered, and the points check the wrong detail isn't taken as true. With `false` and no `expect_eps`, citing is optional |
| `note` | where the answer is, and why the question is hard |

## Running

```bash
npm run eval -- --retrieval-only      # search functions only, with each question's `queries`: no model, no API key
npm run eval                          # every question 3 times through answer(), then the judge (about US$2)
npm run eval -- --only safety,nf-01   # some types or ids; saved, but never used as the baseline
npm run eval -- --set-baseline        # make this result the baseline
npm run eval -- --runs 1 --baseline evals/results/<file>.json
```

It reads `DB_PATH` (default `data/prod.db`) read-only and never touches the quota or the Q&A log. Keep the snapshot a baseline was run on (`data/baseline-<episodes>.db`), since `npm run db:pull` overwrites `data/prod.db`. Search also ranks through the summary points, which a snapshot from before they existed lacks: `DB_PATH=data/baseline-<episodes>.db npm run worker -- index-summaries` adds them (a full run stops or warns when they are missing). Code from before summary search ignores them, so both sides of a comparison can use the same filled snapshot.

- A run passes when the answer cites the expected episodes, has none of the `must_not` strings, cites nothing if `refuse` is set, has no citation pointing at another episode than its line names in its own text (出處對不上: a line saying「跟 EP707 一樣」that cites an EP709 source; the episode label the page puts at the start of each citing line comes from the citations, so it isn't checked), and the judge (`JUDGE_MODEL`, default `gpt-5.4`), reading the answer as the page shows it, labels included, says yes to every point. A question passes when all its runs pass; some but not all is `unstable`.
- The source check (`scripts/eval/support.ts`, `SUPPORT_MODEL`, default `gpt-5.4-mini`, about US$0.7 a full run) reads the passage each citation points at and says whether it talks about what its line says: something the line states (a thing he said, a view, a number, a name), not just the same topic. It catches a citation that points at the wrong passage of the right episode, which 出處對不上 can't see. It is reported as 出處正確率 with each miss listed, and compared with the baseline, but doesn't decide passing, because single verdicts are noisy: on the first full run (2026-11-12, 961 citations, 96.3%) about half the misses checked by hand were real (a line citing a passage about something else) and the rest strict on lines saying several things, and checking the same answers again flipped about a third of the misses (medium reasoning was no steadier). Read the rate, not single misses, and only a change of several points as a change. Episode numbers and dates are taken out of the lines first (the passages don't carry them), and a list item is shown with the paragraph above it and the question, so "- EP672 [17]" under "這幾集聊過輝達：" is checked as "EP672 talks about 輝達". A line naming a range of more than 50 episodes ("在收錄的 EP652–EP713 裡") names the archive, not a source, so 出處對不上 doesn't check it.
- Results go to `evals/results/` (gitignored), with every answer and the judge's reason for each point. A run is compared with the baseline (`evals/results/baseline.json`): `regressed` means it passed every run there and fails every run now; rewritten questions are left out. A question that now passes only some runs is listed but not counted, because that happens with nothing changed: two runs of the same code on the same 21 episodes had 3 questions go from pass to unstable, 4 the other way, and none from pass to fail. The first full run becomes the baseline; after that it only changes with `--set-baseline`, so a result that regressed is never what the next run is compared with. Set a new one after a change is accepted or the data has grown.
- A run that timed out or hit an API error fails its question but stays out of the hit rate and the point rate. Don't make a result with errors the baseline.
- It exits 1 when a `safety` question doesn't pass, or on the regression warning: 2 or more regressed questions, or the retrieval hit rate down by more than 5 points.
- Two results can be compared when only one thing differs between them. The report says what differs: code (the commit, plus a hash of uncommitted changes), data (episode range, or the same range with an episode processed again), models. To judge a code change, run both sides on the same snapshot.
- `--retrieval-only` also lists, per question, the other episodes that match a whole query and the terms that match more rows than a search reads (200 chunks, 30 mentions), and what changed since its own baseline (`baseline-retrieval.json`). That is the check to make after a backfill batch; set the baseline again once the questions it points at have been looked at.

## Rules

- Write questions that stay true as new episodes are added: give dates (`2026 年 10 月 15 日之後`) rather than `最近`, and for lists use `min_eps` rather than an exact set.
- Write questions that stay true as older episodes are backfilled. The answers are only checked against the episodes in the database at the time, and backfill adds hundreds of older ones. Ask about something that happened at a known time (an earnings call, a product launch, a trip), which no older episode can contain. For what the host comes back to again and again (family, hobbies, bands, habits), put the date or the episode in the question.
- After each backfill batch, add questions whose answers are in the episodes just added, `crowded` ones first. Both search limits keep the newest episodes: transcript keyword search reads the 200 matching chunks per term from the newest episodes, and `search_mentions` returns the 30 rows from the newest episodes. So once a common term matches more than that, the older episodes a backfill adds are the ones left out (the model can narrow either search with `episode` or `since` / `until`, and is told when a search hit the limit; `--retrieval-only` searches without them). A set whose answers are all in EP692–712 stays green while questions about backfilled episodes fail.
- After each batch, before reading a failure as a regression, run `--retrieval-only` and look at the questions whose `queries` now match the added episodes: a `not_found` question may have an answer, and another question a second right answer.
- A point judges what the answer says, not the host's own words: quoting or reporting something he said himself (that he felt「越來越樂觀」) is not the answer labelling him.
- A point asks only for what the question asks. When the question is `是哪一集`, the episode is the only point; other things the host said there belong in `note`. When the transcript says something in more than one way, the point allows each of them (`提到兒子坐不住，或覺得太無聊先離開了`).
- The repo is public. Rewrite questions taken from the Q&A log in your own words, and leave out listeners' names and anything else personal (listener messages are read on air, so transcripts have them too).
