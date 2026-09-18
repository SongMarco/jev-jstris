import { performance } from 'node:perf_hooks';
import { measure, seededRandom } from './geometry.js';
import type { Decision, Placement, Policy, PolicyName, Snapshot } from './types.js';
export const MODEL = 'jev-1.13.0';
export const INPUT_PRICE_PER_MILLION = 0.042;
export const MAX_REQUEST_COST = (64000 * INPUT_PRICE_PER_MILLION) / 1_000_000;
export function buildRequest(snapshot: Snapshot, candidates: Placement[], model = MODEL) {
  if (!candidates.length || candidates.length > 255) throw new Error('INVALID_CANDIDATE_COUNT');
  const criteria = Object.fromEntries(
    candidates.map((candidate) => [
      candidate.id,
      JSON.stringify({
        ...candidate.features,
        rotation: candidate.pose.rotation,
        leftmostColumn: Math.min(...candidate.cells.map(([x]) => x)),
      }),
    ]),
  );
  return {
    model,
    state: {
      objective: 'Complete a 40-line sprint without topping out.',
      currentPiece: snapshot.active?.kind,
      nextVisible: snapshot.next,
      linesRemaining: Math.max(0, 40 - snapshot.lines),
      currentFeatures: measure(snapshot.board),
    },
    questions: {
      placement: {
        type: 'choice',
        instructions:
          'Choose one reachable placement. Prioritize survival, avoiding buried empty cells, and clearing lines while keeping the stack manageable. All consequences are already computed. Do not recalculate geometry. A hole is an empty cell below an occupied cell in the same column. Lower holes, height and bumpiness are usually better; clearing lines is beneficial.',
        criteria,
      },
    },
  };
}
function probability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}
export function parseDecision(body: any, candidates: Placement[], latencyMs: number): Decision {
  const answer = body?.answers?.placement;
  const ids = candidates.map((c) => c.id);
  if (
    typeof body?.model !== 'string' ||
    !answer ||
    answer.type !== 'choice' ||
    !ids.includes(answer.choice) ||
    !probability(answer.confidence)
  )
    throw new Error('INVALID_JEV_RESPONSE');
  const distribution = answer.probabilities;
  if (
    !distribution ||
    typeof distribution !== 'object' ||
    Object.keys(distribution).length !== ids.length ||
    ids.some((id) => !probability(distribution[id]))
  )
    throw new Error('INVALID_JEV_PROBABILITIES');
  const values = ids.map((id) => distribution[id] as number);
  const sum = values.reduce((a, b) => a + b, 0);
  // Live Jev responses round probabilities to hundredths. Their displayed sum
  // can differ from 1; accept only a distribution consistent with that rounding.
  const hundredths = values.every(
    (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9,
  );
  const lower = values.reduce((total, value) => total + Math.max(0, value - 0.005), 0);
  const upper = values.reduce((total, value) => total + Math.min(1, value + 0.005), 0);
  const validSum =
    Math.abs(sum - 1) <= 1e-9 || (sum > 0 && hundredths && lower <= 1 + 1e-9 && upper >= 1 - 1e-9);
  if (!validSum || distribution[answer.choice] + 0.00001 < Math.max(...values))
    throw new Error('INVALID_JEV_PROBABILITIES');
  if (
    !Number.isSafeInteger(body.usage?.input_tokens) ||
    body.usage.input_tokens < 0 ||
    !Number.isSafeInteger(body.usage?.output_tokens) ||
    body.usage.output_tokens < 0
  )
    throw new Error('INVALID_JEV_USAGE');
  return {
    choice: answer.choice,
    model: body.model,
    confidence: answer.confidence,
    probabilities: Object.fromEntries(ids.map((id) => [id, distribution[id]])),
    usage: { input_tokens: body.usage.input_tokens, output_tokens: body.usage.output_tokens },
    latencyMs,
  };
}
export class JevPolicy implements Policy {
  readonly name = 'jev';
  prepare(snapshot: Snapshot, candidates: Placement[]) {
    return buildRequest(snapshot, candidates, this.model);
  }
  constructor(
    private key: string,
    private model = MODEL,
    private request: typeof fetch = fetch,
    private timeoutMs = 1000,
  ) {
    if (!key.trim()) throw new Error('TYPESAFE_API_KEY_REQUIRED');
  }
  async choose(
    snapshot: Snapshot,
    candidates: Placement[],
    signal: AbortSignal,
  ): Promise<Decision> {
    const body = JSON.stringify(this.prepare(snapshot, candidates));
    if (Buffer.byteLength(body, 'utf8') > 24000) throw new Error('JEV_REQUEST_TOO_LARGE');
    const started = performance.now();
    const response = await this.request('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`JEV_HTTP_${response.status}`);
    }
    const data = await response.json();
    const decision = parseDecision(data, candidates, performance.now() - started);
    if (decision.model !== this.model) throw new Error('JEV_MODEL_MISMATCH');
    return decision;
  }
}
export class LocalPolicy implements Policy {
  readonly name: Exclude<PolicyName, 'jev'>;
  private random: () => number;
  constructor(name: Exclude<PolicyName, 'jev'>, seed = 1) {
    this.name = name;
    this.random = seededRandom(seed);
  }
  async choose(
    _snapshot: Snapshot,
    candidates: Placement[],
    signal: AbortSignal,
  ): Promise<Decision> {
    signal.throwIfAborted();
    if (!candidates.length) throw new Error('NO_SUPPORTED_PLACEMENT');
    let selected = candidates[Math.floor(this.random() * candidates.length)];
    if (this.name === 'heuristic') {
      const score = (c: Placement) =>
        0.760666 * c.features.clearedLines -
        0.510066 * c.features.aggregateHeightAfter -
        0.35663 * c.features.holesAfter -
        0.184483 * c.features.bumpinessAfter;
      selected = [...candidates].sort((a, b) => score(b) - score(a))[0];
    }
    return {
      choice: selected.id,
      model: `local-${this.name}`,
      latencyMs: 0,
      confidence: null,
      probabilities: null,
      usage: null,
    };
  }
}
