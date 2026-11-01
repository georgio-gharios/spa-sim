/**
 * First-pass racing line: minimise the sum of squared discrete curvature of the path
 * P_i = C_i + n_i N_i within the track width (projected gradient descent on the lateral offsets n_i).
 * Phase 8 refines this toward minimum lap time with a quasi-steady-state speed profile.
 */
import type { TrackModel } from '../../track/TrackModel';

export interface RacingLine {
  /** Spacing along the centerline (m). */
  step: number;
  /** Centerline distance of each point. */
  s: Float64Array;
  /** Lateral offset of each point (m, positive right). */
  n: Float64Array;
  x: Float64Array;
  y: Float64Array;
  /** Signed curvature of the line (1/m, positive = left turn). */
  k: Float64Array;
  /** Cumulative distance along the line (m). */
  dist: Float64Array;
  length: number;
}

export interface LineOptions {
  step?: number;
  /** Distance kept from each white line (m): roughly half the car width plus a safety margin. */
  margin?: number;
  iterations?: number;
}

/** Gradient-descent min-curvature solve of lateral offsets on one resolution level. */
function solveLevel(
  cx: Float64Array,
  cy: Float64Array,
  nx: Float64Array,
  ny: Float64Array,
  lo: Float64Array,
  hi: Float64Array,
  n: Float64Array,
  iters: number,
): void {
  const N = cx.length;
  const px = new Float64Array(N);
  const py = new Float64Array(N);
  const dx = new Float64Array(N);
  const dy = new Float64Array(N);
  // the 4th-difference operator has eigenvalues up to 16, so a step of 1/16 per unit is stable
  const lr = 0.06;
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < N; i++) {
      px[i] = cx[i]! + nx[i]! * n[i]!;
      py[i] = cy[i]! + ny[i]! * n[i]!;
    }
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N;
      const b = (i + 1) % N;
      dx[i] = px[a]! - 2 * px[i]! + px[b]!;
      dy[i] = py[a]! - 2 * py[i]! + py[b]!;
    }
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N;
      const b = (i + 1) % N;
      const g = (dx[a]! - 2 * dx[i]! + dx[b]!) * nx[i]! + (dy[a]! - 2 * dy[i]! + dy[b]!) * ny[i]!;
      n[i] = Math.max(lo[i]!, Math.min(hi[i]!, n[i]! - lr * g));
    }
  }
}

export function computeRacingLine(track: TrackModel, opts: LineOptions = {}): RacingLine {
  const step = opts.step ?? 4;
  const margin = opts.margin ?? 1.0;
  const iters = opts.iterations ?? 4000;
  // coarse-to-fine: long-wavelength line shape converges in few iterations on a coarse grid
  const levels = iters > 0 ? [32, 16, 8, step] : [step];
  let prevN: Float64Array | null = null;
  let prevDs = 0;
  let out: { cx: Float64Array; cy: Float64Array; nx: Float64Array; ny: Float64Array; n: Float64Array; ds: number } | null = null;
  for (const lv of levels) {
    const N = Math.round(track.length / lv);
    const ds = track.length / N;
    const cx = new Float64Array(N);
    const cy = new Float64Array(N);
    const nx = new Float64Array(N);
    const ny = new Float64Array(N);
    const lo = new Float64Array(N);
    const hi = new Float64Array(N);
    const n = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const p = track.sample(i * ds);
      cx[i] = p.x;
      cy[i] = p.y;
      nx[i] = Math.sin(p.heading);
      ny[i] = -Math.cos(p.heading);
      lo[i] = Math.min(0, -p.widthLeft + margin);
      hi[i] = Math.max(0, p.widthRight - margin);
      if (prevN) {
        // interpolate the coarser solution
        const u = (i * ds) / prevDs;
        const i0 = Math.floor(u) % prevN.length;
        const f = u - Math.floor(u);
        n[i] = Math.max(lo[i]!, Math.min(hi[i]!, prevN[i0]! * (1 - f) + prevN[(i0 + 1) % prevN.length]! * f));
      }
    }
    if (iters > 0) solveLevel(cx, cy, nx, ny, lo, hi, n, iters);
    prevN = n;
    prevDs = ds;
    out = { cx, cy, nx, ny, n, ds };
  }
  const { cx, cy, nx, ny, n, ds } = out!;
  const N = cx.length;
  const px = new Float64Array(N);
  const py = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    px[i] = cx[i]! + nx[i]! * n[i]!;
    py[i] = cy[i]! + ny[i]! * n[i]!;
  }
  const s = new Float64Array(N);
  const k = new Float64Array(N);
  const dist = new Float64Array(N);
  let acc = 0;
  for (let i = 0; i < N; i++) {
    s[i] = i * ds;
    const a = (i - 1 + N) % N;
    const b = (i + 1) % N;
    const ax = px[i]! - px[a]!;
    const ay = py[i]! - py[a]!;
    const bx = px[b]! - px[i]!;
    const by = py[b]! - py[i]!;
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    const cross = ax * by - ay * bx;
    k[i] = (2 * cross) / Math.max(1e-9, la * lb * Math.hypot(px[b]! - px[a]!, py[b]! - py[a]!));
    dist[i] = acc;
    acc += lb;
  }
  return { step: ds, s, n, x: px, y: py, k, dist, length: acc };
}
