import { describe, it, expect, vi } from 'vitest';
import { buildRequest, JevPolicy, LocalPolicy, MODEL, parseDecision } from '../src/policy.js';
import { labelCandidates, placements } from '../src/geometry.js';
import { snapshot } from './fixtures.js';
const state = snapshot();
const candidates = labelCandidates(placements(state.board, state.active!), 3);
const body = () => ({
  model: MODEL,
  answers: {
    placement: {
      type: 'choice',
      choice: candidates[0].id,
      confidence: 1,
      probabilities: Object.fromEntries(candidates.map((c, i) => [c.id, i === 0 ? 1 : 0])),
    },
  },
  usage: { input_tokens: 500, output_tokens: 20 },
});
describe('policies', () => {
  it('prepares a single choice without heuristic scores or full boards', () => {
    const request = buildRequest(state, candidates);
    expect(Object.keys(request.questions)).toEqual(['placement']);
    expect(Object.keys(request.questions.placement.criteria)).toHaveLength(candidates.length);
    expect(JSON.stringify(request)).not.toMatch(/afterBoard|recommended|bestPlan|Bearer/);
    expect(request.state.nextVisible).toEqual(state.next);
  });
  it('requires a key instead of silently using a local policy', () => {
    expect(() => new JevPolicy('')).toThrow('TYPESAFE_API_KEY_REQUIRED');
  });
  it('parses only validated protocol fields', () => {
    expect(parseDecision(body(), candidates, 100)).toMatchObject({
      model: MODEL,
      choice: candidates[0].id,
      usage: { input_tokens: 500 },
    });
  });
  it.each([0.99, 1.01])('preserves rounded probabilities whose sum is %s', (sum) => {
    const data = body();
    data.answers.placement.probabilities[candidates[0].id] = 0.56;
    data.answers.placement.probabilities[candidates[1].id] = Math.round((sum - 0.56) * 100) / 100;
    const decision = parseDecision(data, candidates, 100);
    expect(decision.probabilities).toEqual(data.answers.placement.probabilities);
  });
  it('rejects a sum error not explained by hundredth rounding', () => {
    const data = body();
    data.answers.placement.probabilities[candidates[0].id] = 0.561234;
    data.answers.placement.probabilities[candidates[1].id] = 0.428765;
    expect(() => parseDecision(data, candidates, 0)).toThrow('INVALID_JEV_PROBABILITIES');
  });
  it.each(['unknown', 'distribution', 'negativeUsage', 'confidence'])(
    'rejects malformed %s',
    (kind) => {
      const data = body();
      if (kind === 'unknown') data.answers.placement.choice = 'foreign';
      if (kind === 'distribution') data.answers.placement.probabilities[candidates[0].id] = 0.5;
      if (kind === 'negativeUsage') data.usage.input_tokens = -1;
      if (kind === 'confidence') data.answers.placement.confidence = 2;
      expect(() => parseDecision(data, candidates, 0)).toThrow();
    },
  );
  it('sends one authenticated request and returns its decision', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body())));
    const policy = new JevPolicy('test-only-key', MODEL, request);
    const decision = await policy.choose(state, candidates, new AbortController().signal);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: 'Bearer test-only-key',
    });
    expect(JSON.stringify(decision)).not.toContain('test-only-key');
  });
  it('never retries HTTP failures or exposes the response text', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('sensitive upstream response', { status: 429 }));
    await expect(
      new JevPolicy('test', MODEL, request).choose(state, candidates, new AbortController().signal),
    ).rejects.toThrow('JEV_HTTP_429');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('enforces request timeout', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async (_url, options) =>
          new Promise((_resolve, reject) =>
            options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason)),
          ),
      );
    await expect(
      new JevPolicy('test', MODEL, request, 15).choose(
        state,
        candidates,
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('marks the free comparison policy explicitly', async () => {
    const decision = await new LocalPolicy('heuristic').choose(
      state,
      candidates,
      new AbortController().signal,
    );
    expect(decision.model).toBe('local-heuristic');
    expect(decision.usage).toBeNull();
    expect(decision.confidence).toBeNull();
  });
});
