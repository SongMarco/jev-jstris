// Runs in the Jstris page. Keep this function self-contained: no imported runtime values.
// Untyped client fields are validated at this boundary and never exposed to policies.
export function installBridge(config: {
  mode: 'practice' | 'sprint40';
  shapes: Record<string, number[][][]>;
}) {
  const w = window as any;
  if (w.__jevJstris) throw new Error('BRIDGE_ALREADY_INSTALLED');
  if (typeof w.Game !== 'function') throw new Error('JSTRIS_GAME_MISSING');
  const prototype = w.Game.prototype;
  const names = ['I', 'O', 'T', 'L', 'J', 'S', 'Z'];
  let game: any = null;
  let epoch = 0;
  let pieceSeq = 0;
  let manualRevision = 0;
  let revision = 0;
  let previousBoard = '';
  let previousPiece: any = null;
  let expectedKey: { code: number; expires: number; down: boolean; snapshot: any } | null = null;
  let inputError: string | null = null;
  let terminalSnapshot: any = null;
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const capture = (instance: any) => {
    if (game !== instance) {
      game = instance;
      epoch++;
      previousPiece = null;
    }
    if (game.activeBlock !== previousPiece) {
      pieceSeq++;
      previousPiece = game.activeBlock;
    }
  };
  for (const name of [
    'redraw',
    'getNextBlock',
    'holdBlock',
    'start',
    'startPractice',
    'restart',
    'GameOver',
    'practiceModeCompleted',
  ]) {
    const original = prototype[name];
    if (typeof original !== 'function') throw new Error(`JSTRIS_METHOD_MISSING:${name}`);
    originals.set(name, Object.getOwnPropertyDescriptor(prototype, name));
    prototype[name] = function (this: any, ...args: unknown[]) {
      capture(this);
      if (name === 'restart' || name === 'start' || name === 'startPractice') {
        epoch++;
        terminalSnapshot = null;
      }
      // Jstris recolors its matrix for the end animation. Preserve the final game
      // board before that presentation-only change, including the last line clear.
      let beforeEnd = null;
      if (name === 'GameOver' || name === 'practiceModeCompleted') {
        // Observation must never interrupt the game's own termination method.
        try {
          beforeEnd = read();
        } catch {
          /* read() will report the unsupported contract to the runner. */
        }
      }
      const result = original.apply(this, args);
      capture(this);
      if (beforeEnd && this.gameEnded) terminalSnapshot = { ...beforeEnd, phase: 'finished' };
      return result;
    };
  }
  const onKey = (event: KeyboardEvent) => {
    if (
      expectedKey &&
      expectedKey.code === event.keyCode &&
      performance.now() <= expectedKey.expires
    ) {
      if (event.type === 'keydown' && !expectedKey.down && !event.repeat) {
        expectedKey.down = true;
        try {
          const current = read();
          const expected = expectedKey.snapshot;
          const unchanged = [
            'epoch',
            'pieceSeq',
            'boardRevision',
            'manualRevision',
            'ruleSignature',
            'placed',
          ].every((k) => (current as any)[k] === expected[k]);
          if (
            !unchanged ||
            current.phase !== 'active' ||
            !current.focused ||
            JSON.stringify(current.active) !== JSON.stringify(expected.active)
          )
            throw new Error('STALE_BEFORE_INPUT');
        } catch {
          inputError = 'STALE_BEFORE_INPUT';
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        return;
      }
      if (event.type === 'keyup' && expectedKey.down) {
        expectedKey = null;
        return;
      }
    }
    manualRevision++;
  };
  const onBlur = () => {
    manualRevision++;
  };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);
  window.addEventListener('blur', onBlur, true);
  window.addEventListener('mousedown', onBlur, true);
  const read = () => {
    if (!game) throw new Error('WAITING_FOR_GAME');
    if (terminalSnapshot) return JSON.parse(JSON.stringify(terminalSnapshot));
    const g = game;
    if (
      !Array.isArray(g.matrix) ||
      g.matrix.length !== 20 ||
      g.matrix.some(
        (r: any) =>
          !Array.isArray(r) ||
          r.length !== 10 ||
          r.some((c: any) => !Number.isInteger(c) || c < 0 || c > 7),
      )
    )
      throw new Error('UNSUPPORTED_BOARD');
    if (
      Object.keys(g.matrix).some((k) => Number(k) < 0 && g.matrix[k]?.some((c: number) => c !== 0))
    )
      throw new Error('UNSUPPORTED_HIDDEN_CELLS');
    // Jstris has an extra above-board row outside matrix. Do not silently omit it.
    if (
      !Array.isArray(g.deadline) ||
      g.deadline.length !== 10 ||
      g.deadline.some((cell: unknown) => cell !== 0)
    ) {
      throw new Error('UNSUPPORTED_DEADLINE_ROW');
    }
    const r = g.R;
    if (
      !r ||
      r.baseBlockSet !== 0 ||
      r.clearLines !== true ||
      r.clearDelay !== 0 ||
      r.rnd !== 0 ||
      r.ext !== 0 ||
      r.infHold ||
      r.gInv ||
      r.allSpin !== 0 ||
      r.speedLimit !== 0 ||
      r.showPreviews !== 5
    )
      throw new Error('UNSUPPORTED_RULES');
    if (
      g.pmode !== (config.mode === 'practice' ? 2 : 1) ||
      (config.mode === 'sprint40' && g.sprintMode !== 1)
    )
      throw new Error('UNSUPPORTED_MODE');
    const expectedControls: Record<string, number> = {
      ml: 37,
      mr: 39,
      hd: 32,
      rl: 90,
      rr: 38,
      hk: 67,
    };
    for (const [key, value] of Object.entries(expectedControls))
      if (g.Settings[key] !== value) throw new Error('UNSUPPORTED_CONTROLS');
    for (const [id, kind] of names.entries()) {
      if (g.blockIds[kind] !== id) throw new Error('UNSUPPORTED_PIECE_IDS');
      const shapes = g.blockSets[0].blocks[id].blocks.map((grid: number[][]) =>
        grid.flatMap((row, y) => row.flatMap((v, x) => (v ? [[x, y]] : []))),
      );
      if (JSON.stringify(shapes) !== JSON.stringify(config.shapes[kind]))
        throw new Error('UNSUPPORTED_SHAPES');
    }
    const copyPiece = (piece: any) => {
      if (!piece) return null;
      if (
        piece.set !== 0 ||
        piece.item !== 0 ||
        !Number.isInteger(piece.id) ||
        !names[piece.id] ||
        !Number.isInteger(piece.rot) ||
        piece.rot < 0 ||
        piece.rot > 3 ||
        !Number.isInteger(piece.pos.x) ||
        !Number.isInteger(piece.pos.y)
      )
        throw new Error('UNSUPPORTED_PIECE');
      return { kind: names[piece.id], x: piece.pos.x, y: piece.pos.y, rotation: piece.rot };
    };
    capture(g);
    const board = g.matrix.map((row: number[]) => [...row]);
    const hash = board.map((row: number[]) => row.join(',')).join('/');
    if (hash !== previousBoard) {
      revision++;
      previousBoard = hash;
    }
    if (!Number.isInteger(g.gamedata.lines) || !Number.isInteger(g.placedBlocks))
      throw new Error('UNSUPPORTED_COUNTERS');
    return {
      epoch,
      pieceSeq,
      boardRevision: revision,
      manualRevision,
      observedAt: performance.now(),
      phase: g.starting ? 'waiting' : g.gameEnded ? 'finished' : g.play ? 'active' : 'waiting',
      focused: document.hasFocus() && document.visibilityState === 'visible',
      mode: config.mode,
      ruleSignature: JSON.stringify({ rules: r, controls: expectedControls }),
      board,
      active: copyPiece(g.activeBlock),
      next: g.queue.slice(0, 5).map((p: any) => copyPiece(p)!.kind),
      hold: copyPiece(g.blockInHold)?.kind ?? null,
      holdAvailable: !g.holdUsedAlready,
      lines: g.gamedata.lines,
      placed: g.placedBlocks,
    };
  };
  w.__jevJstris = {
    read,
    expectKey(code: number, snapshot: unknown) {
      inputError = null;
      expectedKey = { code, snapshot, down: false, expires: performance.now() + 1000 };
    },
    inputError() {
      return inputError;
    },
    clearExpectedKey() {
      expectedKey = null;
    },
    dispose() {
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(prototype, name, descriptor);
        else delete prototype[name];
      }
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      window.removeEventListener('blur', onBlur, true);
      window.removeEventListener('mousedown', onBlur, true);
      delete w.__jevJstris;
    },
  };
  return { installed: true };
}
