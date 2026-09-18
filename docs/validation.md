# Implementation validation — 2026-09-18

This is an initial implementation checkpoint, not a Jev performance benchmark.

## Real Jstris

| Check | Observed result |
|---|---|
| Client | Jstris 1.40.1, asset `6edfa3a78423ea5d4e68` |
| Practice smoke | 20 verified locks, 7 cleared lines |
| Solo sprint | **40 cleared lines, 105 verified locks, 420 keyboard inputs** |
| API usage | **0 requests, 0 tokens, $0** — explicit local heuristic |
| Dashboard | Free single-step executed one verified lock; game close succeeded |
| API key state | Jev option disabled when no key is configured |

The sprint completed with `SPRINT_COMPLETE`. All 105 selected afterboards, line-count deltas, and lock-count deltas matched the real client. Candidate ordering used seed 42; Jstris's random bag was not controlled. A compact [machine-readable summary](validation-summary.json) includes the source trace hash. Full traces remain local in ignored `runs/` files.

Two initial sprint attempts reached 39 lines before the observer rejected the completion animation's recolored board. Investigation of the current client showed that successful completion uses `practiceModeCompleted`, while top-out uses `GameOver`. Both observer paths now capture the logical board before recoloring and preserve the game's original method execution. The successful sprint above followed that correction.

Final boundary hardening adds an explicit rejection for occupied above-board `deadline` cells and observes `startPractice` restarts. It is covered by unit tests and a final one-lock live regression; a populated deadline row remains unsupported.

## Automated verification

`npm run verify` runs formatting, TypeScript checking, **48 tests**, and a production build. No real API credentials or live service access are used by the tests.

- Empty-board reachable placements for all seven pieces, line deletion, I wall kicks, T floor kicks, above-board lock rejection, and reproducible candidate ordering.
- Read-only snapshots, consecutive identical pieces, preparation/restart, intervention tracking, stale keydown blocking, terminal-board capture, and populated deadline rejection.
- Complete decision/input/lock cycle, post-lock drift, reset/spawn/manual/focus changes during a decision, gravity replanning, cancellation, and request-cost reservation.
- Choice payload/response validation, bearer header construction with a fake key, unknown choices, invalid probability distributions, negative token usage, HTTP failure without retry, and timeout.
- Local-only dashboard origin/token checks and rejection of invalid modes / arbitrary file access.

The mock game validates controller behavior; it is not evidence that Jstris physics matches. The separate real-client runs provide that evidence for the tested paths.

## Ready for the API key

Implemented: server-only bearer authentication, pinned model version, one Choice per piece, response validation, 1-second timeout, no implicit fallback/retry, cancellation, probability and token display, cost limits, and local decision records.

Pending: first successful live Jev response, actual account/rate limits, regional latency, model quality, confidence analysis, and repeated matched-condition comparison runs. Do not interpret the local heuristic's 40-line completion as Jev completion.

## Deliberate limits

No hold execution, 180-degree rotations, soft-drop tucks, arbitrary/custom rules, multiplayer, account/profile reuse, or automatic resume. High-stack deadline/top-out edge cases are not fully supported. A changed client asset stops startup until reverified. A version guard plus runtime validation is a compatibility boundary, not a claim that all game mechanics have been exhaustively proven.
