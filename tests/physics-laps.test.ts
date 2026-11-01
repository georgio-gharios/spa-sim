import { describe, expect, it } from 'vitest';
import { CAR_2026, makeEnv, registerRuleSet } from '../src/physics/data';
import { ASSISTS_PRO } from '../src/physics/modules/interfaces';
import type { CarSpec, RuleSetData } from '../src/physics/spec';
import { NO_INPUT, Vehicle } from '../src/physics/Vehicle';
import { runHotLap } from '../src/sim/lapRunner';
import { loadTrackNode, readJson } from './helpers/track';

const track = loadTrackNode();
const env = makeEnv(track);
const pace = readJson<{
  targets: { dryQualiLapS: { min: number; max: number }; idealProfileLapS: { max: number }; kemmelTopSpeedKmh: { min: number; max: number } };
}>(
  'data/reference/spa-2026-pace.json',
);
const SIMPLE = readJson<CarSpec>('tests/fixtures/cars/test-simple.json');
registerRuleSet(readJson<RuleSetData>('tests/fixtures/rules/test.json'));

describe('headless laps', () => {
  it('a scripted controller follows the centerline and completes a lap without leaving the track', () => {
    const r = runHotLap(CAR_2026, env, { centerline: true, tuning: { paceScale: 0.85 } });
    expect(r.lapTime).not.toBeNull();
    expect(r.timeFullyOutside).toBe(0);
    expect(r.maxWheelsOutside).toBeLessThanOrEqual(2);
    expect(r.impacts).toBe(0);
    expect(r.fuelUsedKg).toBeGreaterThan(0.5);
  });

  const hot = runHotLap(CAR_2026, env, { compound: 'soft' });

  it('a full-pace dry lap lands in the plausible 2026 range (pole 1:44.361)', () => {
    expect(hot.lapTime).not.toBeNull();
    expect(hot.lapTime!).toBeGreaterThan(pace.targets.dryQualiLapS.min);
    expect(hot.lapTime!).toBeLessThan(pace.targets.dryQualiLapS.max);
    expect(hot.impacts).toBe(0);
    // the car model itself is capable of the real pole time on its racing line
    expect(hot.profileLapTime).toBeLessThan(pace.targets.idealProfileLapS.max);
  });

  it('top speed at the end of Kemmel is plausible and battery derating / superclipping show in telemetry', () => {
    const lesCombesBraking = track.lapDistance(2150);
    const kemmel = hot.samples.filter((s) => s.lapDistance > track.lapDistance(1300) && s.lapDistance < lesCombesBraking);
    const top = Math.max(...kemmel.map((s) => s.speedKmh));
    expect(top).toBeGreaterThan(pace.targets.kemmelTopSpeedKmh.min);
    expect(top).toBeLessThan(pace.targets.kemmelTopSpeedKmh.max);
    expect(hot.samples.some((s) => s.derating)).toBe(true);
    expect(hot.samples.some((s) => s.superclip)).toBe(true);
    expect(Math.min(...hot.samples.map((s) => s.soc))).toBeLessThan(0.1);
  });

  it('the Eau Rouge compression loads the car: higher vertical g and a ride-height dip', () => {
    const near = (s0: number) => hot.samples.filter((s) => Math.abs(s.lapDistance - track.lapDistance(s0)) < 25);
    const eau = near(955);
    const kemmel = near(1700);
    const gEau = Math.max(...eau.map((s) => s.verticalG));
    expect(gEau).toBeGreaterThan(1.3);
    const rhEau = Math.min(...eau.map((s) => s.rideHeightFrontM));
    const rhKemmel = Math.min(...kemmel.map((s) => s.rideHeightFrontM));
    expect(rhEau).toBeLessThan(rhKemmel - 0.002);
  });

  it('the test-only car (no hybrid, fixed wings) runs through the same physics core', () => {
    const r = runHotLap(SIMPLE, makeEnv(track, SIMPLE), { centerline: true, compound: 'medium', tuning: { paceScale: 0.85 } });
    expect(r.lapTime).not.toBeNull();
    expect(r.timeFullyOutside).toBe(0);
    expect(r.samples.every((s) => s.electricKw === 0 && s.aeroBlend === 0)).toBe(true);
  });
});

describe('vehicle invariants', () => {
  it('is deterministic: identical inputs give bit-identical state', () => {
    const run = () => {
      const car = new Vehicle(CAR_2026, env, { assists: ASSISTS_PRO, startS: 1300, startSpeedMs: 60, soc: 0.7 });
      for (let i = 0; i < 3000; i++) {
        const t = i / 500;
        car.step(1 / 500, { ...NO_INPUT, throttle: 0.6 + 0.4 * Math.sin(t), steer: 0.05 * Math.sin(3 * t), brake: t > 4 ? 0.3 : 0 });
      }
      return car.snapshot();
    };
    expect(run()).toEqual(run());
  });

  it('brakes harder on tarmac than on grass and gravel', () => {
    const decel = (d: number) => {
      const car = new Vehicle(CAR_2026, env, { assists: ASSISTS_PRO, startS: 1600, startD: d, startSpeedMs: 30, soc: 0.5 });
      const v0 = car.vx;
      for (let i = 0; i < 250; i++) car.step(1 / 500, { ...NO_INPUT, brake: 0.25 });
      return (v0 - car.vx) / 0.5;
    };
    const wr = track.widthRight(1600);
    expect(decel(0)).toBeGreaterThan(decel(wr + 6) * 1.3); // Kemmel straight: grass beyond the verge
  });

  it('burns fuel under power and loses mass', () => {
    const car = new Vehicle(CAR_2026, env, { assists: ASSISTS_PRO, startS: 1300, startSpeedMs: 60, fuelKg: 50 });
    const m0 = car.mass;
    for (let i = 0; i < 2500; i++) car.step(1 / 500, { ...NO_INPUT, throttle: 1 });
    expect(car.mass).toBeLessThan(m0);
    expect(m0 - car.mass).toBeLessThan(0.2); // ~5 s flat out
  });
});
