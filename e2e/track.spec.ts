import { expect, test } from '@playwright/test';

test('track viewer boots and a full-lap fly-around renders without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  // Low preset keeps the software-rendered (SwiftShader) CI run fast; presets share all geometry.
  await page.goto('/?static=1&quality=low');
  await page.waitForFunction(() => window.__spa?.ready === true, null, { timeout: 120_000 });

  const length = await page.evaluate(() => window.__spa!.viewer.track.length);
  expect(length).toBeGreaterThan(6969);
  expect(length).toBeLessThan(7039);

  // Fly the whole lap in 25 m steps; render every step, sample the frame for blank output.
  const step = 50;
  const shots = [0, 900, 1150, 2300, 2900, 3800, 5035, 6040, 6610];
  for (let s = 0; s < length; s += step) {
    const stats = await page.evaluate((s) => {
      window.__spa!.placeFly(s);
      const v = window.__spa!.viewer;
      const info = v.renderer.info.render;
      // camera must stay above the road surface it is following
      const p = v.track.pointAt(s - v.fly.back, 0);
      return { calls: info.calls, tris: info.triangles, camAbove: v.camera.position.y - (p.z - v.wm.baseZ) };
    }, s);
    expect(stats.calls).toBeGreaterThan(10);
    expect(stats.tris).toBeGreaterThan(10_000);
    expect(stats.camAbove).toBeGreaterThan(3);
    const near = shots.find((x) => x >= s && x < s + step);
    if (near !== undefined) {
      await page.evaluate((x) => window.__spa!.placeFly(x), near);
      await page.screenshot({ path: `test-results/fly/s${String(near).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 70 });
    }
  }

  // the frame is not blank: sample the canvas for colour variance
  const variance = await page.evaluate(() => {
    const c = window.__spa!.viewer.renderer.domElement;
    const tmp = document.createElement('canvas');
    tmp.width = 64;
    tmp.height = 36;
    const ctx = tmp.getContext('2d')!;
    ctx.drawImage(c, 0, 0, 64, 36);
    const d = ctx.getImageData(0, 0, 64, 36).data;
    let sum = 0;
    let sum2 = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
      sum += l;
      sum2 += l * l;
    }
    const n = d.length / 4;
    return sum2 / n - (sum / n) ** 2;
  });
  expect(variance).toBeGreaterThan(100);

  // overcast preset switches without errors
  await page.evaluate(() => {
    window.__spa!.viewer.setWeather('overcast');
    window.__spa!.placeFly(3800);
  });
  await page.screenshot({ path: 'test-results/fly/overcast-3800.jpg', type: 'jpeg', quality: 70 });
  expect(errors).toEqual([]);
});
