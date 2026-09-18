# Project conventions

- Keep Jstris observation, pure placement calculation, policy selection, and keyboard execution separate.
- Never write to game coordinates, board, gravity, timers, or randomizer. Practice and solo sprint only.
- A Jev failure stops input; heuristic mode must be explicitly selected.
- Keep API keys server-side. Do not commit runs, browser profiles, downloaded game assets, or credentials.
- Run `npm run verify`. Document live evidence separately from simulated tests and paid API tests.
