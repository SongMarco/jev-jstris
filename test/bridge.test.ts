import { runInNewContext } from 'node:vm';
import { describe, it, expect } from 'vitest';
import { installBridge } from '../src/bridge.js';
import { SHAPES } from '../src/geometry.js';
import { emptyBoard } from './fixtures.js';

function setup() {
  const listeners = new Map<string, Function>();
  class Game {
    activeBlock: any = { id: 0, item: 0, set: 0, rot: 0, pos: { x: 3, y: -1 } };
    matrix = emptyBoard();
    deadline = Array(10).fill(0);
    queue = Array.from({ length: 5 }, () => ({ ...this.activeBlock }));
    R = {
      baseBlockSet: 0,
      clearLines: true,
      clearDelay: 0,
      rnd: 0,
      ext: 0,
      infHold: false,
      gInv: false,
      allSpin: 0,
      speedLimit: 0,
      showPreviews: 5,
    };
    pmode = 2;
    sprintMode = 1;
    Settings = { ml: 37, mr: 39, hd: 32, rl: 90, rr: 38, hk: 67 };
    blockIds = { I: 0, O: 1, T: 2, L: 3, J: 4, S: 5, Z: 6 };
    blockSets = [
      {
        blocks: ['I', 'O', 'T', 'L', 'J', 'S', 'Z'].map((kind) => ({
          blocks: SHAPES[kind as keyof typeof SHAPES].map((cells) =>
            Array.from({ length: 4 }, (_, y) =>
              Array.from({ length: 4 }, (_, x) =>
                cells.some((c) => c[0] === x && c[1] === y) ? 1 : 0,
              ),
            ),
          ),
        })),
      },
    ];
    gamedata = { lines: 0 };
    placedBlocks = 0;
    starting = false;
    gameEnded = false;
    play = true;
    blockInHold = null;
    holdUsedAlready = false;
    redraw() {
      return 123;
    }
    getNextBlock() {
      this.activeBlock = { ...this.activeBlock, pos: { x: 3, y: -1 } };
    }
    holdBlock() {}
    start() {
      this.starting = false;
      this.play = true;
      this.gameEnded = false;
      this.matrix = emptyBoard();
      this.placedBlocks = 0;
    }
    restart() {
      this.starting = true;
    }
    startPractice() {
      this.starting = true;
    }
    GameOver() {
      this.gameEnded = true;
      this.matrix = this.matrix.map((row) => row.map(() => 8));
    }
    practiceModeCompleted() {
      this.gameEnded = true;
      this.play = false;
      this.matrix = this.matrix.map((row) => row.map((v) => (v ? 8 : 0)));
    }
  }
  const win: any = {
    Game,
    addEventListener: (name: string, fn: Function) => listeners.set(name, fn),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  runInNewContext(
    `(${installBridge.toString()})(${JSON.stringify({ mode: 'practice', shapes: SHAPES })})`,
    { window: win, document: { hasFocus: () => true, visibilityState: 'visible' }, performance },
  );
  const game = new Game();
  game.redraw();
  const event = (type: string, keyCode: number) => {
    let blocked = false;
    listeners.get(type)!({
      type,
      keyCode,
      repeat: false,
      preventDefault() {},
      stopImmediatePropagation() {
        blocked = true;
      },
    });
    return blocked;
  };
  return { game, bridge: win.__jevJstris, event };
}
describe('page observation boundary', () => {
  it('preserves original return values and does not mutate the board', () => {
    const { game, bridge } = setup();
    expect(game.redraw()).toBe(123);
    const before = JSON.stringify(game.matrix);
    const observed = bridge.read();
    observed.board[19][0] = 7;
    expect(JSON.stringify(game.matrix)).toBe(before);
  });
  it('distinguishes consecutive identical pieces from redraws', () => {
    const { game, bridge } = setup();
    const first = bridge.read();
    game.redraw();
    expect(bridge.read().pieceSeq).toBe(first.pieceSeq);
    game.getNextBlock();
    expect(bridge.read().pieceSeq).toBeGreaterThan(first.pieceSeq);
  });
  it('marks preparation as waiting even if the old board remains', () => {
    const { game, bridge } = setup();
    game.matrix[19][0] = 1;
    const first = bridge.read();
    game.restart();
    expect(bridge.read().phase).toBe('waiting');
    expect(bridge.read().epoch).toBeGreaterThan(first.epoch);
    game.start();
    expect(bridge.read().phase).toBe('active');
    expect(bridge.read().board).toEqual(emptyBoard());
  });
  it('counts manual intervention but accepts exactly one expected key pair', () => {
    const { bridge, event } = setup();
    const original = bridge.read();
    bridge.expectKey(37, original);
    expect(event('keydown', 37)).toBe(false);
    event('keyup', 37);
    expect(bridge.read().manualRevision).toBe(original.manualRevision);
    event('keydown', 39);
    expect(bridge.read().manualRevision).toBe(original.manualRevision + 1);
  });
  it('blocks a stale input inside the capture listener', () => {
    const { game, bridge, event } = setup();
    bridge.expectKey(32, bridge.read());
    game.getNextBlock();
    expect(event('keydown', 32)).toBe(true);
    expect(bridge.inputError()).toBe('STALE_BEFORE_INPUT');
  });
  it('rejects unsupported rules and restores methods when disposed', () => {
    const { game, bridge } = setup();
    game.R.clearDelay = 100;
    expect(() => bridge.read()).toThrow('UNSUPPORTED_RULES');
    bridge.dispose();
    expect(game.redraw()).toBe(123);
  });
  it('refuses to silently omit a populated above-board deadline row', () => {
    const { game, bridge } = setup();
    game.deadline[4] = 2;
    expect(() => bridge.read()).toThrow('UNSUPPORTED_DEADLINE_ROW');
  });
  it.each(['GameOver', 'practiceModeCompleted'] as const)(
    'keeps the terminal board before %s recolors it',
    (method) => {
      const { game, bridge } = setup();
      game.gamedata.lines = 40;
      game.matrix[19][0] = 5;
      game[method]();
      const end = bridge.read();
      expect(end.phase).toBe('finished');
      expect(end.lines).toBe(40);
      expect(end.board[19][0]).toBe(5);
      expect(end.board[0][0]).toBe(0);
      game.restart();
      game.start();
      expect(bridge.read().phase).toBe('active');
    },
  );
});
