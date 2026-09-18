import { identityMatches, type Action, type GamePort, type Snapshot } from '../src/types.js';
import { drop, lock, move } from '../src/geometry.js';
export const emptyBoard = () => Array.from({ length: 20 }, () => Array(10).fill(0));
export function snapshot(): Snapshot {
  return {
    epoch: 1,
    pieceSeq: 1,
    boardRevision: 1,
    manualRevision: 0,
    observedAt: 0,
    phase: 'active',
    focused: true,
    mode: 'practice',
    ruleSignature: 'test-default',
    board: emptyBoard(),
    active: { kind: 'I', x: 3, y: -1, rotation: 0 },
    next: ['O', 'T', 'L', 'J', 'S'],
    hold: null,
    holdAvailable: true,
    lines: 0,
    placed: 0,
  };
}
export class FakeGame implements GamePort {
  state = snapshot();
  actions: Action[] = [];
  released = false;
  corruptLock = false;
  beforeInput?: () => void;
  async read() {
    return structuredClone(this.state);
  }
  async press(action: Action, signal: AbortSignal, expected: Snapshot) {
    signal.throwIfAborted();
    this.beforeInput?.();
    if (
      !identityMatches(expected, this.state) ||
      JSON.stringify(expected.active) !== JSON.stringify(this.state.active)
    )
      throw new Error('STALE_BEFORE_INPUT');
    this.actions.push(action);
    if (action === 'hardDrop') {
      const result = lock(this.state.board, drop(this.state.board, this.state.active!))!;
      this.state.board = result.board;
      this.state.lines += result.cleared;
      this.state.placed++;
      this.state.boardRevision++;
      this.state.pieceSeq++;
      this.state.active = { kind: this.state.next.shift() || 'T', x: 3, y: -2, rotation: 0 };
      this.state.next.push('T');
      if (this.corruptLock) this.state.board[19][9] = this.state.board[19][9] ? 0 : 7;
    } else this.state.active = move(this.state.board, this.state.active!, action)!;
  }
  async release() {
    this.released = true;
  }
}
