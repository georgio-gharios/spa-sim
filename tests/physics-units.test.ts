import { describe, expect, it } from 'vitest';
import { ActiveAero2026 } from '../src/physics/modules/activeAero2026';
import { EnergyStore2026 } from '../src/physics/modules/energyStore2026';
import { FixedAero } from '../src/physics/modules/fixedAero';
import { HybridV6_2026 } from '../src/physics/modules/hybridV6_2026';
import { createModules } from '../src/physics/modules/registry';
import { ASSISTS_PRO } from '../src/physics/modules/interfaces';
import { CAR_2026, COMPOUNDS, RULES_2026 } from '../src/physics/data';
import type { CarSpec, RuleSetData } from '../src/physics/spec';
import { curve, loadMu, temperatureFactor, tyreForces, tyreShape, wearFactor, wetFactor } from '../src/physics/tyre';
import { readJson } from './helpers/track';

const tm = CAR_2026.tyreModel;
const sh = tyreShape(tm);
const SIMPLE = readJson<CarSpec>('tests/fixtures/cars/test-simple.json');
const RULES_TEST = readJson<RuleSetData>('tests/fixtures/rules/test.json');

describe('tyre model', () => {
  it('force curve rises monotonically to its peak at normalised slip 1, then falls gently', () => {
    let prev = -1;
    for (let s = 0; s <= 1.0001; s += 0.01) {
      const f = curve(sh, s);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
    expect(curve(sh, 1)).toBeCloseTo(1, 3);
    for (let s = 1; s < 6; s += 0.1) expect(curve(sh, s + 0.1)).toBeLessThanOrEqual(curve(sh, s) + 1e-9);
    expect(curve(sh, 6)).toBeGreaterThan(0.7); // sliding friction stays a large fraction of peak
  });

  it('longitudinal and lateral force are monotonic in their own slip below the peak', () => {
    const muFz = 2 * 4000;
    let px = -Infinity;
    for (let k = 0; k <= tm.peakSlipRatio; k += tm.peakSlipRatio / 50) {
      const f = tyreForces(tm, sh, k, 0, muFz).fx;
      expect(f).toBeGreaterThanOrEqual(px);
      px = f;
    }
    let py = Infinity;
    for (let a = 0; a <= tm.peakSlipAngleRad; a += tm.peakSlipAngleRad / 50) {
      const f = tyreForces(tm, sh, 0, a, muFz).fy; // Fy opposes alpha: decreasing
      expect(f).toBeLessThanOrEqual(py);
      py = f;
    }
  });

  it('combined slip shares one friction budget', () => {
    const muFz = 8000;
    const pureLat = Math.abs(tyreForces(tm, sh, 0, tm.peakSlipAngleRad, muFz).fy);
    const combined = tyreForces(tm, sh, tm.peakSlipRatio, tm.peakSlipAngleRad, muFz);
    expect(Math.abs(combined.fy)).toBeLessThan(pureLat);
    expect(Math.hypot(combined.fx, combined.fy)).toBeLessThanOrEqual(muFz * 1.0001);
  });

  it('grip is degressive with load, peaks at the optimum temperature, falls with wear and wetness', () => {
    expect(loadMu(tm, 2, 2000)).toBeGreaterThan(loadMu(tm, 2, 8000));
    expect(loadMu(tm, 2, 8000) * 8000).toBeGreaterThan(loadMu(tm, 2, 2000) * 2000); // total force still rises
    const soft = COMPOUNDS.soft!;
    expect(temperatureFactor(soft, soft.tempOptC)).toBeCloseTo(1, 6);
    expect(temperatureFactor(soft, soft.tempOptC - 40)).toBeLessThan(0.95);
    expect(temperatureFactor(soft, soft.tempOptC + 40)).toBeLessThan(0.95);
    expect(wearFactor(tm, 0)).toBe(1);
    expect(wearFactor(tm, 1)).toBeCloseTo(1 - tm.wear.gripLossAtFullWear, 6);
    expect(wetFactor([1, 0.72, 0.5, 0.36], 0)).toBe(1);
    expect(wetFactor([1, 0.72, 0.5, 0.36], 0.45)).toBeCloseTo(0.61, 2);
  });

  it('compounds are ordered: softer = more grip and more wear', () => {
    const c = COMPOUNDS;
    expect(c.soft!.mu).toBeGreaterThan(c.medium!.mu);
    expect(c.medium!.mu).toBeGreaterThan(c.hard!.mu);
    expect(c.soft!.wearRate).toBeGreaterThan(c.medium!.wearRate);
    expect(c.medium!.wearRate).toBeGreaterThan(c.hard!.wearRate);
  });
});

describe('energy store (2026)', () => {
  it('respects the SoC window and the per-lap harvest and deploy limits', () => {
    const es = new EnergyStore2026(CAR_2026, RULES_2026);
    const win = RULES_2026.energy!.esSocWindowMJ * 1e6;
    const lap = RULES_2026.energy!.harvestPerLapMJ * 1e6;
    expect(es.telemetry().soc).toBe(1);
    expect(es.harvest(1e6)).toBe(0); // full
    expect(es.deploy(win * 2)).toBe(win); // cannot draw more than stored
    expect(es.telemetry().soc).toBe(0);
    expect(es.deploy(1)).toBe(0);
    // harvest and deploy repeatedly: totals per lap are capped
    let harvested = 0;
    let deployed = 0;
    for (let i = 0; i < 100; i++) {
      harvested += es.harvest(0.5e6);
      deployed += es.deploy(0.5e6);
    }
    expect(harvested).toBeLessThanOrEqual(lap + 1);
    expect(deployed + win).toBeLessThanOrEqual(lap + win + 1);
    expect(es.telemetry().deployedLapMJ).toBeLessThanOrEqual(RULES_2026.energy!.harvestPerLapMJ + 1e-9);
    // a new lap resets the counters; overtake mode adds its allowance
    es.onNewLap(RULES_2026.overtake!.extraEnergyMJ);
    expect(es.telemetry().harvestLimitLapMJ).toBeCloseTo(RULES_2026.energy!.harvestPerLapMJ + RULES_2026.overtake!.extraEnergyMJ, 9);
    expect(es.telemetry().harvestedLapMJ).toBe(0);
  });

  it('MGU-K deployment follows the regulation speed taper (and the longer overtake taper)', () => {
    const pu = new HybridV6_2026(CAR_2026, RULES_2026);
    const t = RULES_2026.energy!.mgukTaper;
    expect(pu.deployLimitW(200, false)).toBe(350e3);
    expect(pu.deployLimitW(t.fullUntilKmh, false)).toBe(350e3);
    expect(pu.deployLimitW((t.fullUntilKmh + t.zeroAtKmh) / 2, false)).toBeCloseTo(175e3, 0);
    expect(pu.deployLimitW(t.zeroAtKmh + 1, false)).toBe(0);
    expect(pu.deployLimitW(330, true)).toBeGreaterThan(pu.deployLimitW(330, false));
  });
});

describe('active aero state machine', () => {
  const step = (a: ActiveAero2026, n: number, inp: { inZone: boolean; request: boolean; throttle?: number; brake?: number }) => {
    let out = a.step({ dt: 0.002, throttle: inp.throttle ?? 1, brake: inp.brake ?? 0, inZone: inp.inZone, request: inp.request });
    for (let i = 1; i < n; i++) out = a.step({ dt: 0.002, throttle: inp.throttle ?? 1, brake: inp.brake ?? 0, inZone: inp.inZone, request: inp.request });
    return out;
  };
  it('stays in corner mode outside zones or without a request', () => {
    const a = new ActiveAero2026(CAR_2026, RULES_2026);
    expect(step(a, 500, { inZone: false, request: true }).state).toBe('corner');
    expect(step(a, 500, { inZone: true, request: false }).state).toBe('corner');
  });
  it('switches to straight mode in a zone within the regulation transition time, and back on brake or lift', () => {
    const a = new ActiveAero2026(CAR_2026, RULES_2026);
    const tt = RULES_2026.activeAero.transitionTimeS;
    let o = step(a, 1, { inZone: true, request: true });
    expect(o.state).toBe('to-straight');
    o = step(a, Math.ceil(tt / 0.002), { inZone: true, request: true });
    expect(o.state).toBe('straight');
    expect(o.cdA).toBeCloseTo(CAR_2026.aero.modes.straight!.cdA, 6);
    o = step(a, 1, { inZone: true, request: true, brake: 0.5, throttle: 0 });
    expect(o.state).toBe('to-corner');
    o = step(a, Math.ceil(tt / 0.002), { inZone: true, request: true, brake: 0.5, throttle: 0 });
    expect(o.state).toBe('corner');
    expect(o.clA).toBeCloseTo(CAR_2026.aero.modes.corner!.clA, 6);
    // lift also returns to corner mode
    step(a, 300, { inZone: true, request: true });
    expect(step(a, 300, { inZone: true, request: true, throttle: 0.2 }).state).toBe('corner');
    // leaving the zone returns it as well
    step(a, 300, { inZone: true, request: true });
    expect(step(a, 300, { inZone: false, request: true }).state).toBe('corner');
  });
  it('fixed aero never changes', () => {
    const f = new FixedAero(SIMPLE);
    expect(f.step().state).toBe('fixed');
  });
});

describe('modular car architecture', () => {
  it('derives capabilities from modules', () => {
    const m26 = createModules(CAR_2026, RULES_2026, ASSISTS_PRO);
    expect(m26.capabilities).toEqual({ hybrid: true, activeAero: true, overtakeMode: true, drs: false });
    const ms = createModules(SIMPLE, RULES_TEST, ASSISTS_PRO);
    expect(ms.capabilities).toEqual({ hybrid: false, activeAero: false, overtakeMode: false, drs: false });
    expect(ms.energyStore).toBeNull();
  });
  it('rejects unknown modules and mismatched RuleSets with clear errors', () => {
    expect(() => createModules({ ...CAR_2026, modules: { ...CAR_2026.modules, powerUnit: 'warp-drive' } }, RULES_2026, ASSISTS_PRO)).toThrow(/Unknown power unit module "warp-drive"/);
    expect(() => createModules(SIMPLE, RULES_2026, ASSISTS_PRO)).toThrow(/expects RuleSet test/);
  });
});
