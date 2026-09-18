import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { JstrisBrowser } from './browser.js';
import { LocalPolicy } from './policy.js';
import { Runner } from './runner.js';
import { startServer } from './server.js';
const args = process.argv.slice(2);
if (args.includes('--smoke')) {
  // Explicit, free live validation. Never substitutes this policy for Jev.
  const value = (flag: string, fallback: string) => {
    const i = args.indexOf(flag);
    return i < 0 ? fallback : args[i + 1];
  };
  const maxSteps = Number(value('--steps', '20'));
  const mode = value('--mode', 'practice');
  if (
    !Number.isInteger(maxSteps) ||
    maxSteps < 1 ||
    maxSteps > 1000 ||
    !['practice', 'sprint40'].includes(mode)
  )
    throw new Error('INVALID_SMOKE_OPTIONS');
  const game = new JstrisBrowser();
  let runner: Runner | null = null;
  process.once('SIGINT', () => runner?.stop());
  try {
    await mkdir('runs', { recursive: true });
    const path = `runs/smoke-${Date.now()}.jsonl`;
    await game.open(mode as 'practice' | 'sprint40');
    runner = new Runner(
      game,
      new LocalPolicy('heuristic', 42),
      { seed: 42, maxDecisions: 1000, maxCost: 0, maxSteps },
      async (event) => appendFile(path, JSON.stringify(event) + '\n'),
    );
    const result = await runner.run();
    const summary = {
      phase: result.phase,
      reason: result.reason,
      locks: result.verifiedLocks,
      lines: result.snapshot?.lines,
      log: path,
    };
    await writeFile('runs/latest-smoke-summary.json', JSON.stringify(summary, null, 2) + '\n');
    console.log(JSON.stringify(summary, null, 2));
    if (result.phase === 'error') process.exitCode = 1;
  } finally {
    await game.close();
  }
} else {
  const port = Number(process.env.PORT || '4318');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('INVALID_PORT');
  const server = await startServer(port);
  console.log(`Jev × Jstris: ${server.url}`);
  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
