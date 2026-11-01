/**
 * Quasi-steady-state speed profile along a line: lateral limit from tyre grip with downforce,
 * then forward (traction/power) and backward (braking) passes with a friction ellipse.
 * Uses only the CarSpec + environment, so every era's car gets its own profile automatically.
 */
import type { CarSpec, CompoundSpec } from '../../physics/spec';
import type { TrackModel } from '../../track/TrackModel';
import { inLoopRange } from '../../track/TrackModel';
import type { RacingLine } from './minCurvature';

export interface ProfileEnv {
  airDensity: number;
  gravity: number;
  compound: CompoundSpec;
  /** Active-aero low-drag zones (s ranges); empty for cars without active aero. */
  lowDragZones: Array<{ s0: number; s1: number }>;
  fuelKg: number;
  /** Fraction of the modelled grip the driver uses (1 = on the limit). */
  gripUse: number;
  /** Extra power available from electrical deployment as a function of speed (W). */
  electricW?: (v: number) => number;
}

export interface SpeedProfile {
  /** Achievable speed (lateral, traction/power and braking limits). */
  v: Float64Array;
  /** Speed ceiling from cornering and braking only: what a driver must not exceed (no acceleration cap). */
  vMax: Float64Array;
  /** Lap time along the line at these speeds (s). */
  lapTime: number;
}

export function computeSpeedProfile(track: TrackModel, line: RacingLine, spec: CarSpec, env: ProfileEnv): SpeedProfile {
  const N = line.s.length;
  const m = spec.mass.minimumKg + env.fuelKg;
  const g = env.gravity;
  const rho = env.airDensity;
  const modes = spec.aero.modes;
  const corner = modes.corner ?? modes.fixed ?? Object.values(modes)[0]!;
  const straight = modes.straight ?? corner;
  const tm = spec.tyreModel;
  const mu0 = env.compound.mu * env.gripUse;
  const iceW = Math.max(...spec.powerUnitParams.ice.kw) * 1000 * spec.drivetrain.efficiency;
  const widthAvg = 0.5 * (1 + spec.wheels.widthRearM / spec.wheels.widthFrontM);
  const muAt = (load: number) => mu0 * Math.max(0.6, Math.min(1.25, 1 - tm.loadSensitivity * (load / 4 / widthAvg / tm.referenceLoadN - 1)));
  const lowDrag = (s: number) => env.lowDragZones.some((z) => inLoopRange(s, z.s0, z.s1));

  // lateral limit per axle: each axle must supply its share of m·ay (front b/L, rear a/L)
  const wf = spec.mass.frontWeightFraction;
  const rearW = spec.wheels.widthRearM / spec.wheels.widthFrontM;
  const muTyre = (fzPerTyre: number, width: number) => mu0 * Math.max(0.6, Math.min(1.25, 1 - tm.loadSensitivity * (fzPerTyre / width / tm.referenceLoadN - 1)));
  const aLatAxles = (vv: number, s: number, braking: boolean) => {
    const aero = braking || !lowDrag(s) ? corner : straight;
    const w = m * Math.max(0, g + vv * vv * track.verticalCurvature(s));
    const df = 0.5 * rho * aero.clA * vv * vv;
    const fzF = w * wf + df * aero.frontBalance;
    const fzR = w * (1 - wf) + df * (1 - aero.frontBalance);
    // lateral load transfer costs ~6 % of axle grip at typical F1 g levels (load sensitivity)
    const capF = muTyre(fzF / 2, 1) * fzF * 0.96;
    const capR = muTyre(fzR / 2, rearW) * fzR * 0.96;
    // moment balance: the front axle supplies m·ay·(b/L) = m·ay·wf, the rear m·ay·(1 - wf)
    return Math.min(capF / (m * wf), capR / (m * (1 - wf)));
  };
  const vLat = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const s = line.s[i]!;
    const k = Math.abs(line.k[i]!);
    let v = 100;
    for (let it = 0; it < 30; it++) {
      const aLat = aLatAxles(v, s, true);
      const vn = k > 1e-5 ? Math.sqrt(Math.max(1, aLat / k)) : 120;
      v = 0.5 * (v + Math.min(120, vn));
    }
    vLat[i] = v;
  }
  const v = Float64Array.from(vLat);
  const vMax = Float64Array.from(vLat);
  const segLen = (i: number) => line.dist[(i + 1) % N]! - line.dist[i]! + (i === N - 1 ? line.length : 0);
  const longAvail = (i: number, vv: number, braking: boolean) => {
    const s = line.s[i]!;
    const aero = braking || !lowDrag(s) ? corner : straight;
    const load = m * (g + vv * vv * track.verticalCurvature(s)) + 0.5 * rho * aero.clA * vv * vv;
    const aLatMax = aLatAxles(vv, s, braking);
    const aLat = vv * vv * Math.abs(line.k[i]!);
    const ell = Math.sqrt(Math.max(0, 1 - Math.min(1, aLat / Math.max(aLatMax, 1e-6)) ** 2));
    const drag = (0.5 * rho * aero.cdA * vv * vv) / m;
    const grade = track.grade(s);
    if (braking) return aLatMax * 0.9 * ell + drag + g * grade;
    const rearLoad = load * (1 - spec.mass.frontWeightFraction) * 1.1;
    const traction = (muAt(load) * rearLoad) / m;
    const power = (iceW + (env.electricW ? env.electricW(vv) : 0)) / (m * Math.max(vv, 5));
    return Math.min(traction * ell, power) - drag - g * grade - spec.rollingResistance * g;
  };
  // forward pass (two laps so the start wraps correctly)
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < N; j++) {
      const i = j;
      const nxt = (i + 1) % N;
      const a = longAvail(i, v[i]!, false);
      const vn = Math.sqrt(Math.max(0, v[i]! * v[i]! + 2 * a * segLen(i)));
      if (vn < v[nxt]!) v[nxt] = vn;
    }
  }
  // backward pass
  for (let pass = 0; pass < 2; pass++) {
    for (let j = N - 1; j >= 0; j--) {
      const i = j;
      const prv = (i - 1 + N) % N;
      const a = longAvail(i, v[i]!, true);
      const vp = Math.sqrt(Math.max(0, v[i]! * v[i]! + 2 * a * segLen(prv)));
      if (vp < v[prv]!) v[prv] = vp;
      const am = longAvail(i, vMax[i]!, true);
      const vpm = Math.sqrt(Math.max(0, vMax[i]! * vMax[i]! + 2 * am * segLen(prv)));
      if (vpm < vMax[prv]!) vMax[prv] = vpm;
    }
  }
  let t = 0;
  for (let i = 0; i < N; i++) t += segLen(i) / Math.max(1, 0.5 * (v[i]! + v[(i + 1) % N]!));
  return { v, vMax, lapTime: t };
}
