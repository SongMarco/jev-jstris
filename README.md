# Jev × Jstris

[![CI](https://github.com/SongMarco/jev-jstris/actions/workflows/ci.yml/badge.svg)](https://github.com/SongMarco/jev-jstris/actions/workflows/ci.yml)

Jev chooses a reachable Tetris placement. A local controller executes it in **the real Jstris browser game**, with keyboard input and a board check after every lock.

**Current status:** both the free local heuristic and **the real `jev-1.13.0` model** completed a Jstris 40-line sprint. The Jev run used 105 decisions, with every landing verified; mean API latency was 263.5 ms and estimated input cost was $0.00935634. This is one live validation run, not a completion-rate benchmark. [Jev live results](docs/jev-live-validation.md) · [Implementation validation](docs/validation.md).

## Run without an API key

Requires Node.js 22+ and a graphical desktop. Tested on macOS.

```sh
git clone https://github.com/SongMarco/jev-jstris.git
cd jev-jstris
npm ci
npx playwright install chromium
npm run build
npm start
```

Open **http://127.0.0.1:4318**. Select `로컬 휴리스틱 · 무료 검증` (local heuristic), then start a private practice game or a 40-line sprint. A fresh, signed-out Chromium window opens automatically. Keep that game window focused while the bot plays. The dashboard is an observation panel; returning focus to it stops the bot.

- **새 게임 시작:** start a new round and run the selected policy.
- **새 게임 한 수:** start a new round, execute one placement, then stop input.
- **중단:** cancel the policy request and stop sending inputs. Jstris gravity continues.
- **게임 창 닫기:** stop and close the dedicated browser.

The three policies are distinct:

| Policy | What selects the placement | API call |
|---|---|---|
| Jev | TypeSafe Choice response | Yes; key required |
| Local heuristic | Fixed height / hole / bumpiness / line-clear formula | None |
| Random | Seeded uniform candidate choice | None |

Missing keys and failed Jev requests **never fall back to the heuristic**. The candidate-order seed is logged; it is not the Jstris bag seed.

## Connect Jev

```sh
cp .env.example .env
```

Set `TYPESAFE_API_KEY` in `.env`, restart the server, then select Jev in the dashboard. The key stays in the Node process and is not injected into Jstris, returned to the dashboard, or stored in run logs. `.env` and `runs/` are ignored by Git.

The default model is `jev-1.13.0`; `JEV_MODEL` may override it, but the response must report that exact version. Live authenticated inference and one 40-line completion have been verified; new accounts, locations, and repeated-game quality require their own validation. Default request timeout: 3 seconds; game identity and focus are still monitored while waiting, and the placement is revalidated before input. Per-run limits: 1,000 decisions and $0.25 estimated input cost; a full-context request allowance is reserved before each call. Cost uses the documented $0.042 / million input tokens and is an estimate, not a billing receipt.

## How it works

```text
Jstris state → reachable placements → policy choice
     ↑                                   ↓
verify board ← real key input ← replan from current state
```

- A small page observer captures the current game instance. It reads the 20×10 board, piece, visible queue, hold, counters, and lifecycle.
- Pure TypeScript enumerates reachable placements using translations and 90° SRS rotations, computes resulting boards and features, shuffles candidates, and gives them request-local IDs.
- Jev receives computed consequences rather than solving collision geometry. It gets no heuristic ranking or recommended move.
- While a decision is pending, the runner watches for reset, new piece, user input, rule changes, and loss of focus.
- The controller replans to the selected cells after gravity advances. Every input is checked again at the page's keyboard capture listener. After a hard drop, the actual board, line count, and locked-piece count must match the prediction.
- A completed or topped-out game preserves its final logical board before Jstris recolors it for presentation.

The observer never assigns game coordinates, board cells, gravity, timers, or randomizer state. Hooks are restored when the dedicated browser closes.

## Validation and development

```sh
npm run verify
npm start -- --smoke --steps 20 --mode practice
npm start -- --smoke --steps 200 --mode sprint40
```

`--smoke` explicitly runs the **free local heuristic**, using real Jstris keyboard input. It does not exercise Jev. It closes its browser when finished and writes a summary under `runs/`.

The test suite covers board geometry, line clearing, kicks, repeated identical pieces, resets, stale responses, input races, cancellation, board drift, API response validation, request timeout, and local control access. CI runs formatting, types, tests, and build without a key or live Jstris access.

Run records are JSONL under `runs/`: observations, candidate order/seed, prepared Jev payload, decision probabilities and usage when available, input preconditions, verified locks, and final status. Logs exclude API keys, cookies, chat, and other players. A request that fails before verified usage is marked as usage unknown.

## Supported scope and remaining work

- Jstris **1.40.1**, pinned game asset `6edfa3a78423ea5d4e68`. A changed asset fails closed until its contract is verified.
- Default 10×20 private practice and solo 40-line sprint, default keyboard bindings, no user login/profile.
- No hold, 180° rotations, soft-drop tucks, multiplayer, custom rules, or automatic resume in this initial version. Candidate coverage is intentionally limited to supported paths.
- Jstris stores an above-board `deadline` row separately. The adapter rejects any occupied deadline/hidden row until its full top-out contract is supported; it never silently drops those cells.
- The dashboard shows the **last observed** board; it is not a continuous mirror after the runner stops.
- Initial smoke validation is a small sample, not a completion-rate benchmark. Repeated-game Jev quality, latency across regions, and extended stress testing remain pending.

See [design](docs/design.md), [state-reading evidence](docs/jstris-live-state-verification.md), and [implementation validation](docs/validation.md).

## References and licensing

The project was written independently. Research references include [jbrot/jstris-ai](https://github.com/jbrot/jstris-ai) for game-instance observation, [MachineLearning-Nerd/jev-tetris](https://github.com/MachineLearning-Nerd/jev-tetris) and [Yasserbhb/Agent-JEV-Tetris](https://github.com/Yasserbhb/Agent-JEV-Tetris) for placement-choice experiments, and [fhshaik/typesafe-mario](https://github.com/fhshaik/typesafe-mario) for the game-agent loop. No source from those repositories or Jstris game bundles is vendored here. The local comparison heuristic uses familiar published height/hole/line/bumpiness weights; it is not a learned model.

[TypeSafe Choice documentation](https://docs.typesafe.ai/primitives/choice) · [TypeSafe HTTP API](https://docs.typesafe.ai/api) · [Jstris](https://jstris.jezevec10.com/)

Original project code is [MIT licensed](LICENSE). Jstris and TypeSafe are independent third-party services; this is an unofficial experiment.
