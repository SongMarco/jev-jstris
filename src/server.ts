import { createServer, type IncomingMessage } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, mkdir, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { JstrisBrowser } from './browser.js';
import { JevPolicy, LocalPolicy, MODEL } from './policy.js';
import { Runner, type RunnerState } from './runner.js';
import type { PolicyName } from './types.js';
import { cellsAt } from './geometry.js';

export async function startServer(port: number) {
  const token = randomBytes(24).toString('hex');
  const host = `127.0.0.1:${port}`;
  const origin = `http://${host}`;
  let game: JstrisBrowser | null = null;
  let runner: Runner | null = null;
  let running: Promise<RunnerState> | null = null;
  let opening = false;
  let generation = 0;
  let openingWork: Promise<void> | null = null;
  let message = '실행 방식을 선택하고 새 게임을 시작하세요.';
  let logFile: string | null = null;
  const key = process.env.TYPESAFE_API_KEY?.trim() || '';
  const readBody = async (req: IncomingMessage) => {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 4096) throw new Error('REQUEST_TOO_LARGE');
    }
    return JSON.parse(body || '{}');
  };
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
    );
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    try {
      if (req.headers.host !== host) return json(403, { error: 'LOCAL_HOST_ONLY' });
      if (req.method === 'GET' && req.url === '/api/state')
        return json(200, {
          readyForJev: Boolean(key),
          model: process.env.JEV_MODEL || MODEL,
          opening,
          running: Boolean(running),
          message,
          logFile,
          state: runner?.state ?? null,
          activeCells: runner?.state.snapshot?.active ? cellsAt(runner.state.snapshot.active) : [],
        });
      if (req.method === 'GET' && ['/', '/app.js', '/style.css'].includes(req.url || '')) {
        const name = req.url === '/' ? 'index.html' : req.url!.slice(1);
        let body = await readFile(new URL(`../public/${name}`, import.meta.url), 'utf8');
        if (name === 'index.html') body = body.replace('RUN_TOKEN', token);
        let mime = 'text/html';
        if (name.endsWith('.js')) mime = 'text/javascript';
        if (name.endsWith('.css')) mime = 'text/css';
        res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8` });
        res.end(body);
        return;
      }
      if (req.method !== 'POST') return json(404, { error: 'NOT_FOUND' });
      if (req.headers.origin !== origin || req.headers['x-run-token'] !== token)
        return json(403, { error: 'INVALID_ORIGIN_OR_TOKEN' });
      const body = await readBody(req);
      if (req.url === '/api/stop') {
        generation++;
        runner?.stop();
        message = '봇 입력을 중단했습니다. 게임의 중력은 계속 진행됩니다.';
        return json(200, { ok: true });
      }
      if (req.url === '/api/close') {
        generation++;
        runner?.stop();
        await openingWork;
        await running;
        await game?.close();
        game = null;
        message = '게임 창을 닫았습니다.';
        return json(200, { ok: true });
      }
      if (req.url !== '/api/start') return json(404, { error: 'NOT_FOUND' });
      if (opening || running) return json(409, { error: 'ALREADY_RUNNING' });
      const policyName = body.policy as PolicyName;
      if (!['jev', 'heuristic', 'random'].includes(policyName))
        return json(400, { error: 'INVALID_POLICY' });
      if (policyName === 'jev' && !key) return json(400, { error: 'TYPESAFE_API_KEY_REQUIRED' });
      const mode = body.mode;
      if (mode !== 'practice' && mode !== 'sprint40') return json(400, { error: 'INVALID_MODE' });
      const seed = Number.isInteger(body.seed) ? body.seed >>> 0 : Date.now() >>> 0;
      opening = true;
      const currentGeneration = ++generation;
      json(202, { ok: true });
      openingWork = (async () => {
        try {
          await game?.close();
          const openedGame = new JstrisBrowser();
          game = openedGame;
          message = '전용 Jstris 창을 여는 중입니다.';
          await openedGame.open(mode);
          if (generation !== currentGeneration) {
            await openedGame.close();
            game = null;
            return;
          }
          const runId = `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`;
          await mkdir('runs', { recursive: true, mode: 0o700 });
          logFile = join('runs', `${runId}.jsonl`);
          const record = async (event: Record<string, unknown>) =>
            appendFile(
              logFile!,
              JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n',
              { mode: 0o600 },
            );
          const policy =
            policyName === 'jev'
              ? new JevPolicy(key, process.env.JEV_MODEL || MODEL)
              : new LocalPolicy(policyName, seed);
          runner = new Runner(
            openedGame,
            policy,
            {
              seed,
              maxCost: 0.25,
              maxDecisions: 1000,
              maxSteps: body.step === true ? 1 : undefined,
            },
            record,
          );
          message =
            policyName === 'jev'
              ? 'Jev가 선택합니다.'
              : '로컬 검증 모드입니다. Jev API를 호출하지 않습니다.';
          running = runner.run();
          void running
            .catch(() => {
              message = '기록 저장 중 오류가 발생했습니다.';
            })
            .finally(() => {
              running = null;
            });
        } catch (error) {
          message = error instanceof Error ? error.message : 'START_FAILED';
          await game?.close();
          game = null;
        } finally {
          opening = false;
        }
      })();
      await openingWork;
    } catch (error) {
      if (!res.headersSent)
        json(400, { error: error instanceof Error ? error.message : 'REQUEST_FAILED' });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  return {
    url: origin,
    async close() {
      generation++;
      runner?.stop();
      await openingWork;
      await running;
      await game?.close();
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    },
  };
}
