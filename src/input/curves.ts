/**
 * Response curves for analogue inputs. Everything here is pure maths (unit-tested).
 *
 * For an input magnitude x in 0..1:
 *   x ≤ deadzone           → 0
 *   x ≥ saturation         → 1
 *   otherwise              → ((x − deadzone) / (saturation − deadzone)) ^ linearity
 * linearity 1 is linear; > 1 makes the centre less sensitive (finer small corrections), < 1 more sensitive.
 */

export interface AxisCurve {
  /** 0..0.9: input below this reads as zero. */
  deadzone: number;
  /** 0.1..1: input at or above this reads as full. Always > deadzone. */
  saturation: number;
  /** 0.2..5: response exponent. */
  linearity: number;
}

export const LINEAR: AxisCurve = { deadzone: 0, saturation: 1, linearity: 1 };

export function clampCurve(c: AxisCurve): AxisCurve {
  const deadzone = clamp(c.deadzone, 0, 0.9);
  const saturation = clamp(c.saturation, deadzone + 0.05, 1);
  return { deadzone, saturation, linearity: clamp(c.linearity, 0.2, 5) };
}

/** Shape a magnitude 0..1. */
export function shape(x: number, c: AxisCurve): number {
  const m = clamp(x, 0, 1);
  if (m <= c.deadzone) return 0;
  if (m >= c.saturation) return 1;
  const n = (m - c.deadzone) / (c.saturation - c.deadzone);
  return c.linearity === 1 ? n : Math.pow(n, c.linearity);
}

/** Shape a signed axis −1..1 symmetrically. */
export function shapeSigned(x: number, c: AxisCurve): number {
  return Math.sign(x) * shape(Math.abs(x), c);
}

/**
 * Radial deadzone for a 2-D stick: removes the dead centre without creating the "cross" artefact of
 * per-axis deadzones, then rescales so the output still reaches the rim.
 */
export function radialDeadzone(x: number, y: number, c: AxisCurve): [number, number] {
  const r = Math.hypot(x, y);
  if (r <= c.deadzone || r === 0) return [0, 0];
  const k = shape(Math.min(1, r), c) / r;
  return [x * k, y * k];
}

/** Read a raw axis as 0..1 over its full travel. */
export function fullAxis(v: number, invert: boolean): number {
  const u = (clamp(v, -1, 1) + 1) / 2;
  return invert ? 1 - u : u;
}

/** Read one half of a raw axis as 0..1. */
export function halfAxis(v: number, dir: 1 | -1): number {
  return Math.max(0, clamp(v, -1, 1) * dir);
}

/**
 * Steering-wheel rotation mapping. The wheel's driver sets its physical lock-to-lock rotation
 * (e.g. 900°); the car's steering wheel turns `carDeg` lock to lock (≈360° for a 2026 car). The axis
 * reports −1..1 over the physical rotation, so the car's full lock is reached at carDeg/hardwareDeg of the
 * axis. With both equal the mapping is 1:1 (the recommended setting).
 */
export function wheelSteer(axis: number, hardwareDeg: number, carDeg: number): number {
  const deg = clamp(axis, -1, 1) * (hardwareDeg / 2);
  return clamp(deg / (carDeg / 2), -1, 1);
}

/** Move v towards target at `rate` per second. */
export function approach(v: number, target: number, rate: number, dt: number): number {
  return v < target ? Math.min(target, v + rate * dt) : Math.max(target, v - rate * dt);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
