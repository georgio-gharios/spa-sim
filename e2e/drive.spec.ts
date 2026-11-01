import { expect, test } from '@playwright/test';

test('drivable prototype: keyboard throttle accelerates the 2026 car and the cockpit camera works', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/?quality=low');
  await page.waitForFunction(() => window.__spa?.ready === true, null, { timeout: 120_000 });
  expect(await page.evaluate(() => window.__spa!.viewer.mode)).toBe('drive');
  // HUD shows the systems this car has
  await expect(page.locator('#dh-soc')).toHaveCount(1);
  await expect(page.locator('#dh-aero')).toHaveCount(1);
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => (window.__spa!.session?.car.telemetry().speedKmh ?? 0) > 40, null, { timeout: 60_000 });
  await page.keyboard.up('KeyW');
  const t = await page.evaluate(() => {
    const c = window.__spa!.session!.car.telemetry();
    return { v: c.speedKmh, out: c.wheelsOutside, fuel: c.fuelKg };
  });
  expect(t.v).toBeGreaterThan(40);
  expect(t.out).toBe(0);
  // keys are read on the next rendered frame (slow under software rendering): wait for it
  await page.keyboard.press('KeyV');
  await page.waitForFunction(() => window.__spa!.viewer.drive!.cameraMode === 'cockpit', null, { timeout: 15_000 });
  await page.screenshot({ path: 'test-results/drive-cockpit.jpg', type: 'jpeg', quality: 70 });
  expect(errors).toEqual([]);
});
