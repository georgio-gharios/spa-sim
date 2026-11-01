import { expect, type Page, test } from '@playwright/test';

/** Replace the Gamepad API with controllable mocks (real Chrome-format ids and layouts). */
async function installMockGamepads(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Btn = { value: number; pressed: boolean; touched: boolean };
    interface Mock { id: string; index: number; connected: boolean; mapping: string; axes: number[]; buttons: Btn[]; timestamp: number; vibrationActuator: { playEffect: (t: string, p: unknown) => Promise<string> } }
    const pads: (Mock | null)[] = [];
    const rumble: unknown[] = [];
    const make = (id: string, index: number, mapping: string, nAxes: number, nButtons: number, rest: Record<number, number> = {}): Mock => ({
      id,
      index,
      connected: true,
      mapping,
      timestamp: 0,
      axes: Array.from({ length: nAxes }, (_, i) => rest[i] ?? 0),
      buttons: Array.from({ length: nButtons }, () => ({ value: 0, pressed: false, touched: false })),
      vibrationActuator: { playEffect: (_t, p) => (rumble.push(p), Promise.resolve('complete')) },
    });
    Object.defineProperty(navigator, 'getGamepads', { value: () => pads.slice() });
    const w = window as unknown as Record<string, unknown>;
    w.__pads = {
      rumble,
      connect(kind: 'dualsense' | 'wheel', index: number) {
        const p =
          kind === 'dualsense'
            ? make('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)', index, 'standard', 4, 18)
            : make('Logitech G29 Driving Force Racing Wheel (Vendor: 046d Product: c24f)', index, '', 6, 25, { 1: 1, 2: 1, 5: 1 });
        pads[index] = p;
        window.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: p }));
      },
      disconnect(index: number) {
        const p = pads[index];
        if (!p) return;
        p.connected = false;
        pads[index] = null;
        window.dispatchEvent(Object.assign(new Event('gamepaddisconnected'), { gamepad: p }));
      },
      button(index: number, b: number, v: number) {
        pads[index]!.buttons[b] = { value: v, pressed: v > 0.5, touched: v > 0 };
      },
      axis(index: number, a: number, v: number) {
        pads[index]!.axes[a] = v;
      },
    };
  });
}

type PadsApi = {
  connect: (k: string, i: number) => void;
  disconnect: (i: number) => void;
  button: (i: number, b: number, v: number) => void;
  axis: (i: number, a: number, v: number) => void;
  rumble: unknown[];
};
const pads = (page: Page, fn: string, ...args: (string | number)[]) =>
  page.evaluate(([f, a]) => ((window as unknown as { __pads: Record<string, (...x: unknown[]) => void> }).__pads[f as string]!)(...(a as unknown[])), [fn, args] as const);

const speed = (page: Page) => page.evaluate(() => window.__spa!.session!.car.telemetry().speedKmh);

test('gamepads and wheels: hot-plug, glyphs, driving, rebinding that persists across reloads', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await installMockGamepads(page);
  await page.goto('/?quality=low');
  await page.waitForFunction(() => window.__spa?.ready === true, null, { timeout: 120_000 });
  await page.evaluate(() => localStorage.clear());

  // hot-plug a DualSense mid-session
  await pads(page, 'connect', 'dualsense', 0);
  await expect(page.locator('#input-toast')).toContainText('DualSense connected', { timeout: 15_000 });
  // R2 accelerates the car; the HUD shows PlayStation glyphs for the active pad
  await pads(page, 'button', 0, 7, 1);
  await page.waitForFunction(() => window.__spa!.session!.car.telemetry().speedKmh > 30, null, { timeout: 60_000 });
  await expect(page.locator('#dh-help')).toContainText('R2 throttle', { timeout: 15_000 });
  await expect(page.locator('#dh-help')).toContainText('✕/□ gears');
  await pads(page, 'button', 0, 7, 0);

  // Options opens the controls menu and pauses the car
  await pads(page, 'button', 0, 9, 1);
  await expect(page.locator('#controls-menu')).toBeVisible({ timeout: 15_000 });
  await pads(page, 'button', 0, 9, 0);
  const t0 = await page.evaluate(() => window.__spa!.session!.car.time);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__spa!.session!.car.time)).toBe(t0);
  await expect(page.locator('.cm-tab.on')).toContainText('DualSense');

  // rebind throttle to ✕ by pressing it
  await page.locator('[data-bind="throttle"]').click();
  await expect(page.locator('.cm-wait')).toBeVisible();
  await pads(page, 'button', 0, 0, 1);
  await expect(page.locator('.cm-binds tr', { hasText: 'Throttle' })).toContainText('✕', { timeout: 15_000 });
  await pads(page, 'button', 0, 0, 0);
  // ✕ was "shift up": it moved
  await expect(page.locator('.cm-notice')).toContainText('moved from');

  // keyboard: rebind brake to K
  await page.locator('.cm-tab', { hasText: 'Keyboard' }).click();
  await page.locator('[data-bind="brake"]').click();
  await page.keyboard.press('KeyK');
  await expect(page.locator('.cm-binds tr', { hasText: 'Brake' })).toContainText('K');

  // a wheel connects while the menu is open; bind its brake pedal by pressing it
  await pads(page, 'connect', 'wheel', 1);
  await expect(page.locator('.cm-tab', { hasText: 'Wheel' })).toBeVisible({ timeout: 15_000 });
  await page.locator('.cm-tab', { hasText: 'Wheel' }).click();
  await expect(page.locator('.cm-binds tr', { hasText: 'Throttle' })).toContainText('Axis 3 (pedal)');
  await page.locator('[data-bind="brake"]').click();
  await pads(page, 'axis', 1, 1, -1); // the pedal on axis 2 (index 1) pressed from rest +1
  await expect(page.locator('.cm-binds tr', { hasText: 'Brake' })).toContainText('Axis 2 (pedal)', { timeout: 15_000 });
  await expect(page.locator('.cm-binds tr', { hasText: 'Brake' })).not.toContainText('Axis 6');
  await pads(page, 'axis', 1, 1, 1);
  await page.screenshot({ path: 'test-results/controls-menu.jpg', type: 'jpeg', quality: 75 });
  await page.keyboard.press('Escape');
  await expect(page.locator('#controls-menu')).toBeHidden();

  // reload: everything persists
  await page.reload();
  await page.waitForFunction(() => window.__spa?.ready === true, null, { timeout: 120_000 });
  await pads(page, 'connect', 'dualsense', 0);
  await page.waitForFunction(() => (window.__spa!.input!.devices().length ?? 0) > 1, null, { timeout: 15_000 });
  const persisted = await page.evaluate(() => {
    const inp = window.__spa!.input!;
    const ds = inp.devices().find((d) => d.kind === 'dualsense')!;
    return {
      dsThrottle: inp.configFor(ds).bindings.throttle,
      kbBrake: inp.configFor(inp.keyboard).bindings.brake,
    };
  });
  expect(persisted.dsThrottle).toEqual([{ type: 'button', index: 7 }, { type: 'button', index: 0 }]);
  expect(persisted.kbBrake).toEqual([
    { type: 'key', code: 'KeyS' },
    { type: 'key', code: 'ArrowDown' },
    { type: 'key', code: 'KeyK' },
  ]);
  // the rebound ✕ drives the car
  const v0 = await speed(page);
  await pads(page, 'button', 0, 0, 1);
  await page.waitForFunction((v) => window.__spa!.session!.car.telemetry().speedKmh > v + 20, v0, { timeout: 60_000 });
  await pads(page, 'button', 0, 0, 0);

  // unplugging releases the inputs and shows a toast
  await pads(page, 'button', 0, 0, 1);
  await pads(page, 'disconnect', 0);
  await expect(page.locator('#input-toast')).toContainText('disconnected', { timeout: 15_000 });
  await page.waitForFunction(() => window.__spa!.input!.current.throttle === 0, null, { timeout: 15_000 });

  // reset to defaults
  await page.keyboard.press('Escape');
  await page.locator('.cm-tab', { hasText: 'Keyboard' }).click();
  await page.locator('#cm-reset').click();
  await expect(page.locator('.cm-saved')).toHaveText('Defaults');
  expect(await page.evaluate(() => window.__spa!.input!.configFor(window.__spa!.input!.keyboard).bindings.brake.length)).toBe(2);
  expect(errors).toEqual([]);
});
