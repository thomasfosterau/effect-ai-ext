---
"@thomasfosterau/effect-evals": minor
---

Retrieval-ranking evaluation, ported from gardeneria's `packages/evaluation` harness (its hand-computed tests are the fixtures):

- **`Ranking`** — nDCG@k, recall@k, MRR@k and precision@k over a ranked list of document handles and a graded-relevance map (`Ranking.ndcg` / `recall` / `mrr` / `precision` / `scoreCase` as pure functions; `Ranking.ndcgAtK(k)` etc. as `Scorer`s over a `RankingCase`; `Ranking.metricAtK` / `metricsAtK` as `Metric`s with optional thresholds). Exponential gain, normalised against the case's own relevant set, precision divided by `k`, every scorer re-applying `k`, and the cutoff in every name (`ndcg@10`).
- **`Runner.runRetrievalSuite`** — the retrieval counterpart of `runSuite`: a dataset of `RetrievalGolden`s, a consumer-supplied one-method `RetrievalPort` (`{ id, retrieve(query, { limit }) }`), and a cutoff `k`; returns the ordinary per-case `SuiteResult` plus a cross-query `aggregate`. Built on `runSuite`, so trials, retries, caching (keyed on the port's `id` and `k`) and reporters apply. A failed query is recorded and excluded from every mean, never scored as a zero; cases run sequentially by default.
- **`Result.aggregate`** — per-metric means across a suite's cases (over the cases that scored), with `totalCases` / `successfulCases` / `failedCases`; useful for any suite, not only retrieval.
