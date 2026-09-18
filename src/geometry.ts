import {
  boardHash,
  type Action,
  type Board,
  type Cell,
  type Features,
  type Piece,
  type Placement,
  type Pose,
} from './types.js';

// Jstris uses a 4x4 origin, with JLSTZ one row below the common 3x3 diagrams.
const patterns: Record<Piece, string[]> = {
  I: ['..../####/..../....', '..#./..#./..#./..#.', '..../..../####/....', '.#../.#../.#../.#..'],
  O: ['..../.##./.##./....', '..../.##./.##./....', '..../.##./.##./....', '..../.##./.##./....'],
  T: ['..../.#../###./....', '..../.#../.##./.#..', '..../..../###./.#..', '..../.#../##../.#..'],
  L: ['..../..#./###./....', '..../.#../.#../.##.', '..../..../###./#...', '..../##../.#../.#..'],
  J: ['..../#.../###./....', '..../.##./.#../.#..', '..../..../###./..#.', '..../.#../.#../##..'],
  S: ['..../.##./##../....', '..../.#../.##./..#.', '..../..../.##./##..', '..../#.../##../.#..'],
  Z: ['..../##../.##./....', '..../..#./.##./.#..', '..../..../##../.##.', '..../.#../##../#...'],
};
export const SHAPES = Object.fromEntries(
  Object.entries(patterns).map(([kind, rotations]) => [
    kind,
    rotations.map((pattern) =>
      pattern
        .split('/')
        .flatMap((row, y) => [...row].flatMap((v, x) => (v === '#' ? [[x, y] as Cell] : []))),
    ),
  ]),
) as Record<Piece, Cell[][]>;
export const COLORS: Record<Piece, number> = { I: 5, O: 3, T: 7, L: 2, J: 6, S: 4, Z: 1 };
const normalKicks: Record<string, Cell[]> = {
  '0>1': [
    [0, 0],
    [-1, 0],
    [-1, 1],
    [0, -2],
    [-1, -2],
  ],
  '1>0': [
    [0, 0],
    [1, 0],
    [1, -1],
    [0, 2],
    [1, 2],
  ],
  '1>2': [
    [0, 0],
    [1, 0],
    [1, -1],
    [0, 2],
    [1, 2],
  ],
  '2>1': [
    [0, 0],
    [-1, 0],
    [-1, 1],
    [0, -2],
    [-1, -2],
  ],
  '2>3': [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, -2],
    [1, -2],
  ],
  '3>2': [
    [0, 0],
    [-1, 0],
    [-1, -1],
    [0, 2],
    [-1, 2],
  ],
  '3>0': [
    [0, 0],
    [-1, 0],
    [-1, -1],
    [0, 2],
    [-1, 2],
  ],
  '0>3': [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, -2],
    [1, -2],
  ],
};
const iKicks: Record<string, Cell[]> = {
  '0>1': [
    [0, 0],
    [-2, 0],
    [1, 0],
    [-2, -1],
    [1, 2],
  ],
  '1>0': [
    [0, 0],
    [2, 0],
    [-1, 0],
    [2, 1],
    [-1, -2],
  ],
  '1>2': [
    [0, 0],
    [-1, 0],
    [2, 0],
    [-1, 2],
    [2, -1],
  ],
  '2>1': [
    [0, 0],
    [1, 0],
    [-2, 0],
    [1, -2],
    [-2, 1],
  ],
  '2>3': [
    [0, 0],
    [2, 0],
    [-1, 0],
    [2, 1],
    [-1, -2],
  ],
  '3>2': [
    [0, 0],
    [-2, 0],
    [1, 0],
    [-2, -1],
    [1, 2],
  ],
  '3>0': [
    [0, 0],
    [1, 0],
    [-2, 0],
    [1, -2],
    [-2, 1],
  ],
  '0>3': [
    [0, 0],
    [-1, 0],
    [2, 0],
    [-1, 2],
    [2, -1],
  ],
};
export function cellsAt(pose: Pose): Cell[] {
  return SHAPES[pose.kind][pose.rotation].map(([x, y]) => [x + pose.x, y + pose.y]);
}
export function cellsKey(cells: Cell[]): string {
  return [...cells]
    .sort((a, b) => a[1] - b[1] || a[0] - b[0])
    .map((c) => c.join(','))
    .join(';');
}
export function fits(board: Board, pose: Pose): boolean {
  return (
    pose.y >= -4 &&
    cellsAt(pose).every(([x, y]) => x >= 0 && x < 10 && y < 20 && (y < 0 || board[y][x] === 0))
  );
}
export function move(board: Board, pose: Pose, action: Exclude<Action, 'hardDrop'>): Pose | null {
  if (action === 'left' || action === 'right') {
    const next = { ...pose, x: pose.x + (action === 'left' ? -1 : 1) };
    return fits(board, next) ? next : null;
  }
  const rotation = (pose.rotation + (action === 'cw' ? 1 : 3)) % 4;
  const kicks =
    pose.kind === 'O'
      ? [[0, 0]]
      : (pose.kind === 'I' ? iKicks : normalKicks)[`${pose.rotation}>${rotation}`];
  for (const [dx, dy] of kicks) {
    const next = { ...pose, rotation, x: pose.x + dx, y: pose.y - dy };
    if (fits(board, next)) return next;
  }
  return null;
}
export function drop(board: Board, pose: Pose): Pose {
  let result = { ...pose };
  while (fits(board, { ...result, y: result.y + 1 })) result.y++;
  return result;
}
export function measure(board: Board): Omit<Features, 'clearedLines' | 'holesDelta'> {
  const heights: number[] = [];
  let holes = 0;
  for (let x = 0; x < 10; x++) {
    let height = 0;
    for (let y = 0; y < 20; y++) {
      if (board[y][x] !== 0 && height === 0) height = 20 - y;
      if (board[y][x] === 0 && height > 0) holes++;
    }
    heights.push(height);
  }
  return {
    holesAfter: holes,
    aggregateHeightAfter: heights.reduce((a, b) => a + b, 0),
    maxHeightAfter: Math.max(...heights),
    bumpinessAfter: heights.slice(1).reduce((sum, h, i) => sum + Math.abs(h - heights[i]), 0),
  };
}
export function lock(board: Board, pose: Pose): { board: Board; cleared: number } | null {
  if (!fits(board, pose) || cellsAt(pose).some(([, y]) => y < 0)) return null;
  const result = board.map((row) => [...row]);
  for (const [x, y] of cellsAt(pose)) result[y][x] = COLORS[pose.kind];
  const remaining = result.filter((row) => row.some((cell) => cell === 0));
  const cleared = 20 - remaining.length;
  return {
    board: [...Array.from({ length: cleared }, () => Array(10).fill(0)), ...remaining],
    cleared,
  };
}
export function placements(board: Board, active: Pose): Placement[] {
  if (board.length !== 20 || board.some((r) => r.length !== 10))
    throw new Error('UNSUPPORTED_BOARD');
  if (!fits(board, active)) return [];
  const queue: { pose: Pose; path: Action[] }[] = [{ pose: active, path: [] }];
  const visited = new Set<string>();
  const result = new Map<string, Placement>();
  const initialHoles = measure(board).holesAfter;
  for (let index = 0; index < queue.length; index++) {
    const { pose, path } = queue[index];
    const poseKey = `${pose.x},${pose.y},${pose.rotation}`;
    if (visited.has(poseKey)) continue;
    visited.add(poseKey);
    const landing = drop(board, pose);
    const cells = cellsAt(landing);
    const key = cellsKey(cells);
    const locked = lock(board, landing);
    if (locked && !result.has(key)) {
      const features = measure(locked.board);
      result.set(key, {
        id: '',
        cells,
        pose: landing,
        path: [...path, 'hardDrop'],
        afterBoard: locked.board,
        afterBoardHash: boardHash(locked.board),
        features: {
          ...features,
          clearedLines: locked.cleared,
          holesDelta: features.holesAfter - initialHoles,
        },
      });
    }
    for (const action of ['left', 'right', 'cw', 'ccw'] as const) {
      const next = move(board, pose, action);
      if (next && !visited.has(`${next.x},${next.y},${next.rotation}`))
        queue.push({ pose: next, path: [...path, action] });
    }
  }
  if (result.size > 255) throw new Error('TOO_MANY_CANDIDATES');
  return [...result.values()];
}
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function labelCandidates(candidates: Placement[], seed: number): Placement[] {
  const result = [...candidates];
  const random = seededRandom(seed);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result.map((candidate, i) => ({
    ...candidate,
    id: `p_${i.toString(36).padStart(2, '0')}`,
  }));
}
