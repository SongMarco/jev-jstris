import { describe, it, expect } from 'vitest';
import { Runner } from '../src/runner.js';
import { LocalPolicy } from '../src/policy.js';
import type { Policy } from '../src/types.js';
import { FakeGame } from './fixtures.js';
const options = { seed: 5, maxDecisions: 10, maxCost: 0.25, maxSteps: 1 };
describe('decision lifecycle', () => {
  it('verifies a full lock and emits exactly one hard drop', async () => {
    const game = new FakeGame();
    const events: any[] = [];
    const result = await new Runner(game, new LocalPolicy('heuristic'), options, async (e) => {
      events.push(e);
    }).run();
    expect(result.reason).toBe('STEP_COMPLETE');
    expect(result.verifiedLocks).toBe(1);
    expect(game.actions.filter((a) => a === 'hardDrop')).toHaveLength(1);
    expect(game.released).toBe(true);
    expect(events.map((e) => e.type)).toContain('verified-lock');
  });
  it('detects post-lock board drift', async () => {
    const game = new FakeGame();
    game.corruptLock = true;
    const result = await new Runner(game, new LocalPolicy('heuristic'), options).run();
    expect(result.reason).toBe('DESYNC_AFTER_LOCK');
    expect(result.verifiedLocks).toBe(0);
  });
  it.each(['restart', 'same-kind-spawn', 'manual', 'blur'])(
    'discards delayed decisions after %s',
    async (change) => {
      const game = new FakeGame();
      const policy: Policy = {
        name: 'heuristic',
        async choose(s, c, signal) {
          if (change === 'restart') game.state.epoch++;
          if (change === 'same-kind-spawn') game.state.pieceSeq++;
          if (change === 'manual') game.state.manualRevision++;
          if (change === 'blur') game.state.focused = false;
          await new Promise((r) => setTimeout(r, 50));
          return new LocalPolicy('heuristic').choose(s, c, signal);
        },
      };
      const result = await new Runner(game, policy, options).run();
      expect(result.reason).toBe('STATE_CHANGED_DURING_DECISION');
      expect(game.actions).toHaveLength(0);
    },
  );
  it('replans for gravity while preserving the chosen landing cells', async () => {
    const game = new FakeGame();
    const policy: Policy = {
      name: 'heuristic',
      async choose(s, c, signal) {
        game.state.active!.y += 3;
        return new LocalPolicy('heuristic').choose(s, c, signal);
      },
    };
    const result = await new Runner(game, policy, options).run();
    expect(result.reason).toBe('STEP_COMPLETE');
  });
  it('stops before keydown if state changes at the input boundary', async () => {
    const game = new FakeGame();
    game.beforeInput = () => {
      game.state.manualRevision++;
    };
    const result = await new Runner(game, new LocalPolicy('heuristic'), options).run();
    expect(result.reason).toBe('STALE_BEFORE_INPUT');
    expect(game.actions).toHaveLength(0);
  });
  it('stops in-flight decisions without fallback inputs', async () => {
    const game = new FakeGame();
    let runner: Runner;
    const policy: Policy = {
      name: 'heuristic',
      async choose(s, c, signal) {
        runner.stop();
        return new LocalPolicy('heuristic').choose(s, c, signal);
      },
    };
    runner = new Runner(game, policy, options);
    const result = await runner.run();
    expect(result.phase).toBe('stopped');
    expect(game.actions).toHaveLength(0);
    expect(game.released).toBe(true);
  });
  it('reserves a request budget before calling Jev', async () => {
    const game = new FakeGame();
    let called = false;
    const policy: Policy = {
      name: 'jev',
      async choose() {
        called = true;
        throw new Error('must not call');
      },
    };
    const result = await new Runner(game, policy, { ...options, maxCost: 0 }).run();
    expect(result.reason).toBe('COST_LIMIT');
    expect(called).toBe(false);
  });
});
