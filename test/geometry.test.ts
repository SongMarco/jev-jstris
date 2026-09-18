import { describe, it, expect } from 'vitest';
import {
  cellsAt,
  cellsKey,
  drop,
  fits,
  labelCandidates,
  lock,
  measure,
  move,
  placements,
} from '../src/geometry.js';
import { emptyBoard } from './fixtures.js';
import type { Piece, Pose } from '../src/types.js';
describe('placement geometry', () => {
  it.each<[Piece, number]>([
    ['I', 17],
    ['O', 9],
    ['T', 34],
    ['L', 34],
    ['J', 34],
    ['S', 17],
    ['Z', 17],
  ])('enumerates %s empty-board placements', (kind, count) => {
    const board = emptyBoard();
    const start: Pose = { kind, x: 3, y: -2, rotation: 0 };
    const candidates = placements(board, start);
    expect(candidates).toHaveLength(count);
    expect(new Set(candidates.map((c) => cellsKey(c.cells))).size).toBe(count);
    for (const candidate of candidates) {
      let pose = start;
      for (const action of candidate.path)
        pose = action === 'hardDrop' ? drop(board, pose) : move(board, pose, action)!;
      expect(cellsKey(cellsAt(pose))).toBe(cellsKey(candidate.cells));
      expect(candidate.cells).toHaveLength(4);
      expect(fits(board, { ...pose, y: pose.y + 1 })).toBe(false);
    }
  });
  it('clears a line and measures the resulting board', () => {
    const board = emptyBoard();
    board[19] = [0, 0, 0, 0, 1, 1, 1, 1, 1, 1];
    const result = lock(board, { kind: 'I', x: 0, y: 18, rotation: 0 })!;
    expect(result.cleared).toBe(1);
    expect(result.board).toEqual(emptyBoard());
    expect(board[19][0]).toBe(0);
  });
  it('counts buried cells rather than empty columns as holes', () => {
    const board = emptyBoard();
    board[17][0] = 1;
    board[19][0] = 1;
    expect(measure(board)).toEqual({
      holesAfter: 1,
      aggregateHeightAfter: 3,
      maxHeightAfter: 3,
      bumpinessAfter: 3,
    });
  });
  it('applies I wall kicks and keeps the 4x4 origin', () => {
    expect(move(emptyBoard(), { kind: 'I', x: -2, y: 4, rotation: 1 }, 'ccw')).toEqual({
      kind: 'I',
      x: 0,
      y: 4,
      rotation: 0,
    });
  });
  it('applies a T floor kick with upward y', () => {
    expect(move(emptyBoard(), { kind: 'T', x: 3, y: 17, rotation: 0 }, 'cw')).toEqual({
      kind: 'T',
      x: 2,
      y: 16,
      rotation: 1,
    });
  });
  it('rejects a lock above the visible board', () => {
    expect(lock(emptyBoard(), { kind: 'T', x: 3, y: -2, rotation: 0 })).toBeNull();
  });
  it('never chooses intersecting placements on a filled board', () => {
    const board = emptyBoard();
    for (let y = 2; y < 20; y++) board[y].fill(1);
    expect(
      placements(board, { kind: 'I', x: 3, y: -1, rotation: 0 }).every((c) =>
        c.cells.every(([, y]) => y >= 0 && y < 2),
      ),
    ).toBe(true);
  });
  it('shuffles reproducibly without dropping candidates', () => {
    const candidates = placements(emptyBoard(), { kind: 'T', x: 3, y: -2, rotation: 0 });
    const first = labelCandidates(candidates, 7);
    expect(first).toEqual(labelCandidates(candidates, 7));
    expect(first).not.toEqual(labelCandidates(candidates, 8));
    expect(new Set(first.map((c) => c.id)).size).toBe(candidates.length);
  });
});
