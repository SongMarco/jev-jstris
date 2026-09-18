import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { startServer } from '../src/server.js';
let server: Awaited<ReturnType<typeof startServer>>;
let token: string;
beforeAll(async () => {
  server = await startServer(49318);
  const html = await fetch(server.url).then((r) => r.text());
  token = html.match(/name="run-token" content="([^"]+)"/)![1];
});
afterAll(async () => {
  await server.close();
});
describe('local control server', () => {
  it('serves the panel and omits credentials', async () => {
    const response = await fetch(`${server.url}/api/state`);
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.state).toBeNull();
    expect(Object.keys(data)).not.toContain('key');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('rejects commands without its local origin and request token', async () => {
    const response = await fetch(`${server.url}/api/start`, { method: 'POST', body: '{}' });
    expect(response.status).toBe(403);
  });
  it('rejects invalid modes before launching a browser', async () => {
    const response = await fetch(`${server.url}/api/start`, {
      method: 'POST',
      headers: { Origin: server.url, 'X-Run-Token': token },
      body: JSON.stringify({ policy: 'heuristic', mode: 'multiplayer' }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'INVALID_MODE' });
  });
  it('has no generic file-serving or key-setting endpoint', async () => {
    expect((await fetch(`${server.url}/.env`)).status).toBe(404);
    expect(
      (
        await fetch(`${server.url}/api/key`, {
          method: 'POST',
          headers: { Origin: server.url, 'X-Run-Token': token },
          body: '{}',
        })
      ).status,
    ).toBe(404);
  });
});
