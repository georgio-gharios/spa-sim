/**
 * Tyre model: Magic-Formula-shaped force curve on a normalised combined-slip vector (so longitudinal and
 * lateral forces share one friction budget), load sensitivity, and grip multipliers for temperature,
 * wear, surface and wetness. Thermal model: surface + carcass temperatures. All functions are pure.
 */
import type { CompoundSpec, TyreModelSpec } from './spec';

export interface TyreShape {
  B: number;
  C: number;
  E: number;
}

/** Solve B so the force curve peaks exactly at normalised slip 1. */
export function tyreShape(spec: Pick<TyreModelSpec, 'shapeC' | 'curvatureE'>): TyreShape {
  const C = spec.shapeC;
  const E = spec.curvatureE;
  const uStar = Math.tan(Math.PI / (2 * C));
  const inner = (B: number) => B - E * (B - Math.atan(B));
  let lo = 0.01;
  let hi = 50;
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi);
    if (inner(mid) < uStar) lo = mid;
    else hi = mid;
  }
  return { B: 0.5 * (lo + hi), C, E };
}

/** Normalised force curve f(σ) in [0, 1], peak 1 at σ = 1. */
export function curve(sh: TyreShape, sigma: number): number {
  const bs = sh.B * sigma;
  return Math.sin(sh.C * Math.atan(bs - sh.E * (bs - Math.atan(bs))));
}

export interface TyreForces {
  fx: number;
  fy: number;
  /** |F| / (mu Fz): utilisation of the friction budget. */
  utilisation: number;
}

/**
 * Combined-slip forces in the wheel frame. slipRatio κ (positive = driving), slipAngle α (rad; positive when
 * the contact patch moves to the wheel's left), muFz = friction coefficient × vertical load (N).
 * Fy opposes α.
 */
export function tyreForces(spec: TyreModelSpec, sh: TyreShape, slipRatio: number, slipAngle: number, muFz: number): TyreForces {
  const sx = slipRatio / spec.peakSlipRatio;
  const sy = Math.tan(Math.max(-1.4, Math.min(1.4, slipAngle))) / Math.tan(spec.peakSlipAngleRad);
  const s = Math.hypot(sx, sy);
  if (s < 1e-9 || muFz <= 0) return { fx: 0, fy: 0, utilisation: 0 };
  const f = curve(sh, s);
  const F = muFz * f;
  return {
    fx: (F * sx * spec.longitudinalGripScale) / s,
    fy: (-F * sy * spec.lateralGripScale) / s,
    utilisation: f,
  };
}

/** Load-sensitive friction coefficient (degressive: grip per newton falls as load rises). */
export function loadMu(spec: TyreModelSpec, mu0: number, fz: number): number {
  const k = 1 - spec.loadSensitivity * (fz / spec.referenceLoadN - 1);
  return mu0 * Math.max(0.6, Math.min(1.25, k));
}

/** Temperature grip factor: 1 at the compound's optimum, falling to ~0.82 when far too cold or hot. */
export function temperatureFactor(c: CompoundSpec, tempC: number): number {
  const x = (tempC - c.tempOptC) / c.tempWidthC;
  return 1 - 0.18 * (1 - Math.exp(-x * x));
}

export function wearFactor(spec: TyreModelSpec, wear: number): number {
  return 1 - spec.wear.gripLossAtFullWear * Math.pow(Math.max(0, Math.min(1, wear)), 1.5);
}

/** Wetness grip multiplier for a compound family, piecewise-linear over w = 0, 0.3, 0.6, 1. */
export function wetFactor(table: readonly number[], w: number): number {
  const xs = [0, 0.3, 0.6, 1];
  const ww = Math.max(0, Math.min(1, w));
  for (let i = 1; i < xs.length; i++) {
    if (ww <= xs[i]!) {
      const f = (ww - xs[i - 1]!) / (xs[i]! - xs[i - 1]!);
      return table[i - 1]! + (table[i]! - table[i - 1]!) * f;
    }
  }
  return table[table.length - 1]!;
}

export interface TyreThermalState {
  surfaceC: number;
  carcassC: number;
  wear: number;
}

/**
 * Advance surface/carcass temperature and wear by dt.
 * slidePowerW = |F|·|v_slip|, rollW = rolling heat input (Fz·v), speedMs for convective cooling.
 */
export function updateThermal(
  st: TyreThermalState,
  spec: TyreModelSpec,
  c: CompoundSpec,
  slidePowerW: number,
  fz: number,
  speedMs: number,
  ambientC: number,
  dt: number,
): void {
  const t = spec.thermal;
  const heatIn = (t.slidingHeatFraction * slidePowerW + t.rollingHeatCoef * fz * speedMs) * c.warmup;
  const sToC = t.surfaceToCarcassWPerK * (st.surfaceC - st.carcassC);
  const cool = (t.surfaceCoolingWPerK + t.surfaceCoolingPerSpeed * speedMs) * (st.surfaceC - ambientC);
  st.surfaceC += ((heatIn - sToC - cool) / t.surfaceHeatCapacityJPerK) * dt;
  const carcIn = sToC + 0.002 * fz * speedMs * c.warmup;
  st.carcassC += ((carcIn - t.carcassCoolingWPerK * (st.carcassC - ambientC)) / t.carcassHeatCapacityJPerK) * dt;
  // overheating accelerates wear
  const hot = Math.max(0, st.surfaceC - (c.tempOptC + c.tempWidthC)) / 20;
  st.wear = Math.min(1, st.wear + spec.wear.perJoule * c.wearRate * slidePowerW * (1 + hot) * dt);
}
