import { chromium, type Browser, type Page } from 'playwright';
import { installBridge } from './bridge.js';
import { SHAPES } from './geometry.js';
import type { Action, GamePort, Snapshot } from './types.js';
const keys: Record<Action, { name: string; code: number }> = {
  left: { name: 'ArrowLeft', code: 37 },
  right: { name: 'ArrowRight', code: 39 },
  cw: { name: 'ArrowUp', code: 38 },
  ccw: { name: 'z', code: 90 },
  hardDrop: { name: 'Space', code: 32 },
};
export class JstrisBrowser implements GamePort {
  private browser?: Browser;
  private page?: Page;
  async open(mode: 'practice' | 'sprint40'): Promise<void> {
    if (this.browser) throw new Error('BROWSER_ALREADY_OPEN');
    this.browser = await chromium.launch({ headless: false });
    try {
      const context = await this.browser.newContext({
        viewport: { width: 1280, height: 900 },
        locale: 'en-US',
      });
      this.page = await context.newPage();
      await this.page.goto(
        `https://jstris.jezevec10.com/play/${mode === 'practice' ? 'practice' : 'sprint'}`,
      );
      await this.page.waitForFunction(() => typeof (window as any).Game === 'function');
      const asset = await this.page.locator('script[src*="/js/game.js"]').getAttribute('src');
      if (!asset?.includes('id=6edfa3a78423ea5d4e68')) throw new Error('UNVERIFIED_JSTRIS_VERSION');
      await this.page.evaluate(installBridge, { mode, shapes: SHAPES });
      await this.page.bringToFront();
      // Starting a new round is the only non-movement control; no game internals are modified.
      await this.page.locator('#res').click();
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        try {
          if ((await this.read()).phase === 'active') return;
        } catch (error) {
          if (!(error instanceof Error) || !error.message.includes('WAITING_FOR_GAME')) throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('GAME_START_TIMEOUT');
    } catch (error) {
      await this.close();
      throw error;
    }
  }
  async read(): Promise<Snapshot> {
    if (!this.page || this.page.isClosed()) throw new Error('BROWSER_CLOSED');
    return this.page.evaluate(() => (window as any).__jevJstris.read());
  }
  async press(action: Action, signal: AbortSignal, expected: Snapshot): Promise<void> {
    signal.throwIfAborted();
    const page = this.page;
    if (!page || page.isClosed()) throw new Error('BROWSER_CLOSED');
    const key = keys[action];
    await page.evaluate(
      ({ code, snapshot }) => (window as any).__jevJstris.expectKey(code, snapshot),
      { code: key.code, snapshot: expected },
    );
    try {
      signal.throwIfAborted();
      await page.keyboard.down(key.name);
    } finally {
      await page.keyboard.up(key.name).catch(() => {});
    }
    const error = await page.evaluate(() => {
      const bridge = (window as any).__jevJstris;
      bridge.clearExpectedKey();
      return bridge.inputError();
    });
    if (error) throw new Error(error);
  }
  async release(): Promise<void> {
    if (!this.page || this.page.isClosed()) return;
    // press() always pairs keydown with keyup; do not emit unmatched keyups here.
    await this.page.evaluate(() => (window as any).__jevJstris?.clearExpectedKey()).catch(() => {});
  }
  async close(): Promise<void> {
    await this.release();
    await this.page?.evaluate(() => (window as any).__jevJstris?.dispose()).catch(() => {});
    await this.browser?.close();
    this.browser = undefined;
    this.page = undefined;
  }
}
