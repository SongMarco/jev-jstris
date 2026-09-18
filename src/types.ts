export type Piece = 'I' | 'O' | 'T' | 'L' | 'J' | 'S' | 'Z';
export type Action = 'left' | 'right' | 'cw' | 'ccw' | 'hardDrop';
export type PolicyName = 'jev' | 'heuristic' | 'random';
export type Board = number[][];
export type Cell = [number, number];
export interface Pose {
  kind: Piece;
  x: number;
  y: number;
  rotation: number;
}
export interface Snapshot {
  epoch: number;
  pieceSeq: number;
  boardRevision: number;
  manualRevision: number;
  observedAt: number;
  phase: 'waiting' | 'active' | 'finished';
  focused: boolean;
  mode: 'practice' | 'sprint40';
  ruleSignature: string;
  board: Board;
  active: Pose | null;
  next: Piece[];
  hold: Piece | null;
  holdAvailable: boolean;
  lines: number;
  placed: number;
}
export interface Features {
  clearedLines: number;
  holesAfter: number;
  holesDelta: number;
  aggregateHeightAfter: number;
  maxHeightAfter: number;
  bumpinessAfter: number;
}
export interface Placement {
  id: string;
  cells: Cell[];
  pose: Pose;
  path: Action[];
  afterBoard: Board;
  afterBoardHash: string;
  features: Features;
}
export interface Decision {
  choice: string;
  model: string;
  latencyMs: number;
  confidence: number | null;
  probabilities: Record<string, number> | null;
  usage: { input_tokens: number; output_tokens: number } | null;
}
export interface Policy {
  name: PolicyName;
  prepare?(snapshot: Snapshot, candidates: Placement[]): unknown;
  choose(snapshot: Snapshot, candidates: Placement[], signal: AbortSignal): Promise<Decision>;
}
export interface GamePort {
  read(): Promise<Snapshot>;
  press(action: Action, signal: AbortSignal, expected: Snapshot): Promise<void>;
  release(): Promise<void>;
}
export function boardHash(board: Board): string {
  return board.map((row) => row.map((cell) => (cell ? '1' : '0')).join('')).join('/');
}
export function identityMatches(a: Snapshot, b: Snapshot): boolean {
  return (
    a.epoch === b.epoch &&
    a.pieceSeq === b.pieceSeq &&
    a.boardRevision === b.boardRevision &&
    a.ruleSignature === b.ruleSignature &&
    a.manualRevision === b.manualRevision &&
    a.placed === b.placed &&
    a.active?.kind === b.active?.kind &&
    a.hold === b.hold
  );
}
