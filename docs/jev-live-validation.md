# Real Jev validation — 2026-09-18

**`jev-1.13.0` completed a real Jstris 40-line sprint.** Every placement was selected by a live TypeSafe API response and executed through ordinary keyboard input. No heuristic fallback was used.

| Measurement | Successful sprint |
|---|---:|
| Cleared lines | 40 |
| Live model decisions | 105 |
| Verified landings | 105 / 105 |
| Mean API latency | 263.5 ms |
| Median API latency | 238.9 ms |
| p95 API latency (nearest rank) | 404.1 ms |
| Min / max API latency | 195.8 / 778.1 ms |
| Controller run duration | 31.795 s |
| Input / output tokens | 222,770 / 26,400 |
| Estimated API cost | **$0.00935634** |
| Unknown-usage requests in this run | 0 |

Duration is measured from the controller's `run-start` to `run-end`, not from a Jstris leaderboard time. Latency includes the HTTP round trip and response parsing. Cost applies the configured $0.042 per million input tokens with free output; it is not a billing receipt.

[Machine-readable evidence](jev-validation-summary.json) records the implementation commit, model, client asset, run summary, and local trace hash. All 105 actual afterboards and line/lock counter changes matched their predictions. Jstris's bag seed was not controlled, so the prior heuristic run is not a matched-seed comparison.

## First-call verification and protocol correction

The initial single-step test returned `jev-1.13.0`, took 949.3 ms, used 1,651 input tokens, and produced one verified lock.

The first sprint attempt completed 35 verified locks and 12 lines before stopping on the 36th response's probability validation. A separate replay of that request showed 34 valid choice entries, the chosen entry equal to the maximum probability, and a sum of **0.99**: values were rounded to hundredths. The old check treated a difference slightly larger than 0.01 in floating point as invalid.

The parser now accepts either a normalized sum or hundredth-rounded values whose possible rounding intervals contain 1. It still checks every candidate, numeric bounds, choice membership, maximum selection, confidence, usage, and the pinned model. Returned probabilities are preserved, not silently renormalized. Regression tests cover 0.99 and 1.01 sums and reject unexplained discrepancies.

The successful sprint in the table followed this correction. The test suite now has 51 passing tests.

## Scope of credential use

The supplied key was stored only in the ignored local `.env` with owner-only permissions and used as the bearer credential for `https://api.typesafe.ai/v1/systemone`. It was not placed in Jstris, browser UI, public documentation, run payloads, or Git history.

This validation session made 143 API attempts: one initial placement, 36 attempts in the interrupted sprint, one diagnostic replay, and 105 in the completed sprint. Known input usage totals 301,335 tokens, approximately $0.01265607 at the configured price, **plus one failed-validation request whose usage was not retained**. That unknown request is not treated as free.

## What remains unproven

One completed game does not establish a completion rate or superiority over a heuristic. Repeated-game quality, matched-condition comparisons, account rate-limit behavior, other regions, and difficult top-out/hidden-row cases need further evaluation. The supported controls and conservative compatibility limits in the README still apply.
