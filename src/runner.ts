import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { cellsAt, cellsKey, drop, labelCandidates, move, placements } from './geometry.js';
import { INPUT_PRICE_PER_MILLION, MAX_REQUEST_COST } from './policy.js';
import {
  boardHash,
  identityMatches,
  type Decision,
  type GamePort,
  type Placement,
  type Policy,
  type Snapshot,
} from './types.js';

export interface RunnerState {
  phase: 'idle' | 'observing' | 'requesting' | 'executing' | 'stopped' | 'finished' | 'error';
  reason: string | null;
  policy: string;
  decisions: number;
  verifiedLocks: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  usageUnknown: number;
  snapshot: Snapshot | null;
  candidates: Placement[];
  decision: Decision | null;
  lastDurationMs: number | null;
}
export interface RunnerOptions {
  seed: number;
  maxDecisions: number;
  maxCost: number;
  maxSteps?: number;
}
export type RecordEvent = (event: Record<string, unknown>) => Promise<void>;
export class Runner {
  readonly state: RunnerState;
  private controller = new AbortController();
  constructor(
    private game: GamePort,
    private policy: Policy,
    private options: RunnerOptions,
    private record: RecordEvent = async () => {},
  ) {
    this.state = {
      phase: 'idle',
      reason: null,
      policy: policy.name,
      decisions: 0,
      verifiedLocks: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCost: 0,
      usageUnknown: 0,
      snapshot: null,
      candidates: [],
      decision: null,
      lastDurationMs: null,
    };
  }
  stop(reason = 'STOPPED_BY_USER') {
    this.controller.abort(new Error(reason));
  }
  private async observe(): Promise<Snapshot> {
    const snapshot = await this.game.read();
    this.state.snapshot = snapshot;
    return snapshot;
  }
  private assertActive(snapshot: Snapshot) {
    this.controller.signal.throwIfAborted();
    if (snapshot.phase !== 'active' || !snapshot.active) throw new Error('GAME_NOT_ACTIVE');
    if (!snapshot.focused) throw new Error('GAME_FOCUS_LOST');
  }
  private async decide(snapshot: Snapshot, candidates: Placement[]): Promise<Decision> {
    const pending = new AbortController();
    const signal = AbortSignal.any([this.controller.signal, pending.signal]);
    let watching = true;
    let usageReceived = false;
    const monitor = (async () => {
      while (watching && !signal.aborted) {
        await delay(25);
        if (!watching) return;
        try {
          const current = await this.observe();
          if (current.phase !== 'active' || !current.focused || !identityMatches(snapshot, current))
            throw new Error('STATE_CHANGED_DURING_DECISION');
        } catch (error) {
          pending.abort(error);
          return;
        }
      }
    })();
    try {
      const decision = await this.policy.choose(snapshot, candidates, signal);
      // A completed response is still billed even when its placement became stale.
      if (decision.usage) {
        usageReceived = true;
        this.state.inputTokens += decision.usage.input_tokens;
        this.state.outputTokens += decision.usage.output_tokens;
        this.state.estimatedCost = (this.state.inputTokens * INPUT_PRICE_PER_MILLION) / 1_000_000;
      }
      signal.throwIfAborted();
      return decision;
    } catch (error) {
      if (this.policy.name === 'jev' && !usageReceived) this.state.usageUnknown++;
      if (signal.aborted) throw signal.reason;
      throw error;
    } finally {
      watching = false;
      await monitor;
    }
  }
  private async execute(original: Snapshot, target: Placement): Promise<Snapshot> {
    const signal = this.controller.signal;
    const deadline = performance.now() + 2000;
    let inputs = 0;
    while (performance.now() < deadline && inputs < 50) {
      const current = await this.observe();
      this.assertActive(current);
      if (!identityMatches(original, current)) throw new Error('STALE_DECISION');
      const path = placements(current.board, current.active!).find(
        (p) => cellsKey(p.cells) === cellsKey(target.cells),
      );
      if (!path) throw new Error('TARGET_NO_LONGER_REACHABLE');
      const action = path.path[0];
      const expectedPose =
        action === 'hardDrop'
          ? drop(current.board, current.active!)
          : move(current.board, current.active!, action);
      if (!expectedPose) throw new Error('INVALID_INPUT_PATH');
      if (action === 'hardDrop' && cellsKey(cellsAt(expectedPose)) !== cellsKey(target.cells))
        throw new Error('DROP_TARGET_MISMATCH');
      await this.record({ type: 'input', action, before: current, expectedPose });
      await this.game.press(action, signal, current);
      inputs++;
      if (action === 'hardDrop') {
        const lockDeadline = performance.now() + 2000;
        while (performance.now() < lockDeadline) {
          signal.throwIfAborted();
          const after = await this.observe();
          if (
            after.epoch !== original.epoch ||
            after.manualRevision !== original.manualRevision ||
            after.ruleSignature !== original.ruleSignature
          )
            throw new Error('RESET_OR_INTERVENTION_DURING_LOCK');
          if (after.placed === original.placed + 1) {
            if (
              after.lines !== original.lines + target.features.clearedLines ||
              boardHash(after.board) !== target.afterBoardHash
            )
              throw new Error('DESYNC_AFTER_LOCK');
            if (after.phase !== 'finished' && after.pieceSeq === original.pieceSeq)
              throw new Error('SPAWN_NOT_OBSERVED');
            return after;
          }
          if (after.placed > original.placed + 1 || after.phase === 'finished')
            throw new Error('UNEXPECTED_LOCK');
          await delay(10, undefined, { signal });
        }
        throw new Error('LOCK_TIMEOUT');
      }
      const after = await this.observe();
      this.assertActive(after);
      if (!identityMatches(original, after)) throw new Error('STATE_CHANGED_DURING_INPUT');
      // Gravity may lower y between observations. Unexpected x/rotation indicates input drift.
      if (
        after.active!.x !== expectedPose.x ||
        after.active!.rotation !== expectedPose.rotation ||
        after.active!.y < expectedPose.y
      )
        throw new Error('INPUT_MISMATCH');
    }
    throw new Error('EXECUTION_LIMIT');
  }
  async run(): Promise<RunnerState> {
    if (this.state.phase !== 'idle') throw new Error('RUNNER_ALREADY_USED');
    try {
      await this.record({ type: 'run-start', policy: this.policy.name, options: this.options });
      while (true) {
        this.state.phase = 'observing';
        const snapshot = await this.observe();
        this.controller.signal.throwIfAborted();
        if (
          snapshot.phase === 'finished' ||
          (snapshot.mode === 'sprint40' && snapshot.lines >= 40)
        ) {
          this.state.phase = 'finished';
          this.state.reason = snapshot.lines >= 40 ? 'SPRINT_COMPLETE' : 'GAME_ENDED';
          break;
        }
        this.assertActive(snapshot);
        if (this.state.decisions >= this.options.maxDecisions) throw new Error('DECISION_LIMIT');
        if (
          this.policy.name === 'jev' &&
          this.state.estimatedCost + MAX_REQUEST_COST > this.options.maxCost
        )
          throw new Error('COST_LIMIT');
        const seed = (this.options.seed + this.state.decisions) >>> 0;
        const candidates = labelCandidates(placements(snapshot.board, snapshot.active!), seed);
        if (!candidates.length) throw new Error('NO_SUPPORTED_PLACEMENT');
        this.state.candidates = candidates;
        this.state.phase = 'requesting';
        this.state.decisions++;
        const started = performance.now();
        await this.record({
          type: 'request',
          seed,
          snapshot,
          candidates,
          payload: this.policy.prepare?.(snapshot, candidates) ?? null,
        });
        const decision = await this.decide(snapshot, candidates);
        this.state.decision = decision;
        await this.record({ type: 'decision', decision });
        const selected = candidates.find((c) => c.id === decision.choice);
        if (!selected) throw new Error('UNKNOWN_PLACEMENT');
        this.state.phase = 'executing';
        const after = await this.execute(snapshot, selected);
        this.state.verifiedLocks++;
        this.state.lastDurationMs = performance.now() - started;
        await this.record({
          type: 'verified-lock',
          choice: decision.choice,
          after,
          durationMs: this.state.lastDurationMs,
        });
        if (this.options.maxSteps && this.state.verifiedLocks >= this.options.maxSteps) {
          this.state.phase = 'stopped';
          this.state.reason = 'STEP_COMPLETE';
          break;
        }
      }
    } catch (error) {
      this.state.phase = this.controller.signal.aborted ? 'stopped' : 'error';
      this.state.reason = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    } finally {
      await this.game.release();
      await this.record({
        type: 'run-end',
        phase: this.state.phase,
        reason: this.state.reason,
        decisions: this.state.decisions,
        verifiedLocks: this.state.verifiedLocks,
        inputTokens: this.state.inputTokens,
        outputTokens: this.state.outputTokens,
        estimatedCost: this.state.estimatedCost,
        usageUnknown: this.state.usageUnknown,
      });
    }
    return this.state;
  }
}
