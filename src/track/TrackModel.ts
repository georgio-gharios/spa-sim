import type {
  BarrierType,
  CornerDef,
  KerbDef,
  RunoffLayer,
  Side,
  Surface,
  TrackData,
  TrackLimitDef,
} from './types';

export interface TrackSample {
  s: number;
  x: number;
  y: number;
  z: number;
  /** Heading of the tangent, radians CCW from +x (east). */
  heading: number;
  /** Banking in radians; > 0 means the surface falls towards the right edge. */
  camber: number;
  widthLeft: number;
  widthRight: number;
  curvature: number;
}

export interface Projection {
  /** Distance along the centerline, [0, length). */
  s: number;
  /** Signed lateral offset from the centerline, positive to the right of the driving direction. */
  d: number;
}

export interface SurfaceInfo {
  surface: Surface;
  kerb: KerbDef | null;
  /** True when this point is beyond the white line (outside the track). */
  outside: boolean;
  side: Side | null;
}

const TWO_PI = Math.PI * 2;

function wrapAngle(a: number): number {
  a = (a + Math.PI) % TWO_PI;
  if (a < 0) a += TWO_PI;
  return a - Math.PI;
}

/** True if s lies within [s0, s1] on a loop (s1 < s0 means the range wraps through s = 0). */
export function inLoopRange(s: number, s0: number, s1: number): boolean {
  return s0 <= s1 ? s >= s0 && s <= s1 : s >= s0 || s <= s1;
}

/**
 * Headless, renderer-independent model of the circuit. All queries are pure functions of the data,
 * so physics, timing and Race Control can use them deterministically.
 */
export class TrackModel {
  readonly data: TrackData;
  readonly length: number;
  readonly count: number;
  readonly ds: number;
  readonly sectorBoundaries: readonly number[];
  readonly miniSectorCount: number;

  private readonly xs: Float64Array;
  private readonly ys: Float64Array;
  private readonly zs: Float64Array;
  private readonly hs: Float64Array;
  private readonly cambers: Float64Array;
  private readonly wl: Float64Array;
  private readonly wr: Float64Array;
  private readonly ks: Float64Array;

  /** Per-sample index into runoff zones (-1 = default) for left/right. */
  private readonly runoffIdx: { left: Int16Array; right: Int16Array };
  private readonly barrierType: { left: BarrierType[]; right: BarrierType[] };
  private readonly kerbIdx: { left: Int16Array[]; right: Int16Array[] };
  private readonly limitIdx: { left: Int16Array; right: Int16Array };
  private readonly cornerIdx: Int16Array;

  /** Spatial hash of centerline samples for global projection. */
  private readonly gridCell = 25;
  private readonly grid = new Map<number, number[]>();

  private readonly terrain: Float32Array | null;

  constructor(data: TrackData, terrain: Float32Array | null = null) {
    if (data.format !== 'spa-track/1') throw new Error(`Unsupported track format ${String(data.format)}`);
    this.data = data;
    this.length = data.length;
    this.count = data.count;
    this.ds = data.ds;
    this.sectorBoundaries = data.sectors.boundaries;
    this.miniSectorCount = data.sectors.miniSectorCount;
    this.xs = Float64Array.from(data.x);
    this.ys = Float64Array.from(data.y);
    this.zs = Float64Array.from(data.z);
    this.hs = Float64Array.from(data.heading);
    this.cambers = Float64Array.from(data.camberDeg, (d) => (d * Math.PI) / 180);
    this.wl = Float64Array.from(data.widthLeft);
    this.wr = Float64Array.from(data.widthRight);
    this.ks = Float64Array.from(data.curvature);
    if (terrain && terrain.length !== data.terrain.nx * data.terrain.ny) {
      throw new Error(`terrain size ${terrain.length} != ${data.terrain.nx}x${data.terrain.ny}`);
    }
    this.terrain = terrain;

    const n = this.count;
    const sAt = (i: number) => i * this.ds;

    const mkZoneIdx = (side: Side) => {
      const out = new Int16Array(n).fill(-1);
      data.runoff.zones.forEach((z, zi) => {
        if (z.side !== side) return;
        for (let i = 0; i < n; i++) if (inLoopRange(sAt(i), z.s0, z.s1)) out[i] = zi;
      });
      return out;
    };
    this.runoffIdx = { left: mkZoneIdx('left'), right: mkZoneIdx('right') };

    const mkBarrier = (side: Side) => {
      const out: BarrierType[] = new Array<BarrierType>(n).fill(data.barriers.default);
      for (const z of data.barriers.zones) {
        if (z.side !== side) continue;
        for (let i = 0; i < n; i++) if (inLoopRange(sAt(i), z.s0, z.s1)) out[i] = z.type;
      }
      return out;
    };
    this.barrierType = { left: mkBarrier('left'), right: mkBarrier('right') };

    // up to two kerbs may overlap per side per sample (e.g. kerb + sausage behind it)
    const mkKerb = (side: Side) => {
      const a = new Int16Array(n).fill(-1);
      const b = new Int16Array(n).fill(-1);
      data.kerbs.forEach((k, ki) => {
        if (k.side !== side) return;
        for (let i = 0; i < n; i++) {
          if (!inLoopRange(sAt(i), k.s0, k.s1)) continue;
          if (a[i] === -1) a[i] = ki;
          else b[i] = ki;
        }
      });
      return [a, b];
    };
    this.kerbIdx = { left: mkKerb('left'), right: mkKerb('right') };

    const mkLimit = (side: Side) => {
      const out = new Int16Array(n).fill(-1);
      data.trackLimits.forEach((l, li) => {
        if (l.side !== side) return;
        for (let i = 0; i < n; i++) if (inLoopRange(sAt(i), l.s0, l.s1)) out[i] = li;
      });
      return out;
    };
    this.limitIdx = { left: mkLimit('left'), right: mkLimit('right') };

    this.cornerIdx = new Int16Array(n).fill(-1);
    data.corners.forEach((c, ci) => {
      for (let i = 0; i < n; i++) if (inLoopRange(sAt(i), c.s0, c.s1)) this.cornerIdx[i] = ci;
    });

    for (let i = 0; i < n; i++) {
      const key = this.gridKey(this.xs[i]!, this.ys[i]!);
      let bucket = this.grid.get(key);
      if (!bucket) this.grid.set(key, (bucket = []));
      bucket.push(i);
    }
  }

  // ------------------------------------------------------------------ basic sampling

  wrapS(s: number): number {
    const L = this.length;
    s %= L;
    return s < 0 ? s + L : s;
  }

  private idx(s: number): { i0: number; i1: number; f: number } {
    const u = this.wrapS(s) / this.ds;
    const i0 = Math.floor(u) % this.count;
    return { i0, i1: (i0 + 1) % this.count, f: u - Math.floor(u) };
  }

  private lerpArr(a: Float64Array, s: number): number {
    const { i0, i1, f } = this.idx(s);
    return a[i0]! + (a[i1]! - a[i0]!) * f;
  }

  sample(s: number): TrackSample {
    const { i0, i1, f } = this.idx(s);
    const h0 = this.hs[i0]!;
    const h1 = h0 + wrapAngle(this.hs[i1]! - h0);
    return {
      s: this.wrapS(s),
      x: this.xs[i0]! + (this.xs[i1]! - this.xs[i0]!) * f,
      y: this.ys[i0]! + (this.ys[i1]! - this.ys[i0]!) * f,
      z: this.zs[i0]! + (this.zs[i1]! - this.zs[i0]!) * f,
      heading: wrapAngle(h0 + (h1 - h0) * f),
      camber: this.cambers[i0]! + (this.cambers[i1]! - this.cambers[i0]!) * f,
      widthLeft: this.wl[i0]! + (this.wl[i1]! - this.wl[i0]!) * f,
      widthRight: this.wr[i0]! + (this.wr[i1]! - this.wr[i0]!) * f,
      curvature: this.ks[i0]! + (this.ks[i1]! - this.ks[i0]!) * f,
    };
  }

  elevation(s: number): number {
    return this.lerpArr(this.zs, s);
  }

  widthLeft(s: number): number {
    return this.lerpArr(this.wl, s);
  }

  widthRight(s: number): number {
    return this.lerpArr(this.wr, s);
  }

  /** World position of the point at distance s, lateral offset d (positive right), on the cambered surface plane. */
  pointAt(s: number, d: number): { x: number; y: number; z: number } {
    const p = this.sample(s);
    const rx = Math.sin(p.heading);
    const ry = -Math.cos(p.heading);
    return { x: p.x + rx * d, y: p.y + ry * d, z: p.z - d * Math.tan(p.camber) };
  }

  /** Raw sample access for mesh builders (index in [0, count)). */
  raw(i: number): TrackSample {
    const j = ((i % this.count) + this.count) % this.count;
    return {
      s: j * this.ds,
      x: this.xs[j]!,
      y: this.ys[j]!,
      z: this.zs[j]!,
      heading: this.hs[j]!,
      camber: this.cambers[j]!,
      widthLeft: this.wl[j]!,
      widthRight: this.wr[j]!,
      curvature: this.ks[j]!,
    };
  }

  // ------------------------------------------------------------------ projection

  private gridKey(x: number, y: number): number {
    const gx = Math.floor(x / this.gridCell) + 1000;
    const gy = Math.floor(y / this.gridCell) + 1000;
    return gx * 4096 + gy;
  }

  private projectOnSegment(i: number, x: number, y: number): { s: number; d: number; dist2: number } {
    const j = (i + 1) % this.count;
    const ax = this.xs[i]!;
    const ay = this.ys[i]!;
    const bx = this.xs[j]!;
    const by = this.ys[j]!;
    const ex = bx - ax;
    const ey = by - ay;
    const len2 = ex * ex + ey * ey;
    let t = len2 > 0 ? ((x - ax) * ex + (y - ay) * ey) / len2 : 0;
    t = Math.min(1, Math.max(0, t));
    const px = ax + ex * t;
    const py = ay + ey * t;
    const dx = x - px;
    const dy = y - py;
    // right normal of the segment = (ey, -ex)/|e|
    const len = Math.sqrt(len2) || 1;
    const d = (dx * ey - dy * ex) / len;
    return { s: this.wrapS((i + t) * this.ds), d, dist2: dx * dx + dy * dy };
  }

  /**
   * Project a world (x, y) onto the centerline. With a hint (previous s) the search is local and O(window);
   * otherwise a spatial hash is used. Near crossings of the layout the hint disambiguates.
   */
  project(x: number, y: number, hintS?: number, window = 60): Projection {
    let best = { s: 0, d: 0, dist2: Infinity };
    if (hintS !== undefined) {
      const c = Math.round(this.wrapS(hintS) / this.ds);
      const w = Math.ceil(window / this.ds);
      for (let k = -w; k <= w; k++) {
        const i = (((c + k) % this.count) + this.count) % this.count;
        const r = this.projectOnSegment(i, x, y);
        if (r.dist2 < best.dist2) best = r;
      }
      // if the hint was wrong (far away), fall back to the global search
      if (best.dist2 < 60 * 60) return { s: best.s, d: best.d };
    }
    const gx = Math.floor(x / this.gridCell);
    const gy = Math.floor(y / this.gridCell);
    for (let radius = 1; radius <= 40 && best.dist2 === Infinity; radius *= 2) {
      for (let ix = gx - radius; ix <= gx + radius; ix++) {
        for (let iy = gy - radius; iy <= gy + radius; iy++) {
          const bucket = this.grid.get((ix + 1000) * 4096 + iy + 1000);
          if (!bucket) continue;
          for (const i of bucket) {
            for (const k of [i - 1, i]) {
              const r = this.projectOnSegment((k + this.count) % this.count, x, y);
              if (r.dist2 < best.dist2) best = r;
            }
          }
        }
      }
    }
    return { s: best.s, d: best.d };
  }

  // ------------------------------------------------------------------ annotations

  private sampleIndex(s: number): number {
    return Math.round(this.wrapS(s) / this.ds) % this.count;
  }

  runoffLayers(side: Side, s: number): RunoffLayer[] {
    const zi = this.runoffIdx[side][this.sampleIndex(s)]!;
    return zi >= 0 ? this.data.runoff.zones[zi]!.layers : this.data.runoff.default;
  }

  runoffWidth(side: Side, s: number): number {
    return this.runoffLayers(side, s).reduce((a, l) => a + l.width, 0);
  }

  barrierAt(side: Side, s: number): BarrierType {
    return this.barrierType[side][this.sampleIndex(s)]!;
  }

  kerbsAt(side: Side, s: number): KerbDef[] {
    const i = this.sampleIndex(s);
    const out: KerbDef[] = [];
    for (const arr of this.kerbIdx[side]) {
      const k = arr[i]!;
      if (k >= 0) out.push(this.data.kerbs[k]!);
    }
    return out;
  }

  /** Enforced track-limits definition at (side, s), or null if this edge is not policed here. */
  enforcedLimitAt(side: Side, s: number): TrackLimitDef | null {
    const li = this.limitIdx[side][this.sampleIndex(s)]!;
    return li >= 0 ? this.data.trackLimits[li]! : null;
  }

  cornerAt(s: number): CornerDef | null {
    const ci = this.cornerIdx[this.sampleIndex(s)]!;
    return ci >= 0 ? this.data.corners[ci]! : null;
  }

  /** Sector index 0..2. */
  sectorAt(s: number): number {
    const w = this.wrapS(s);
    let k = 0;
    for (const b of this.sectorBoundaries) if (w >= b) k++;
    return k;
  }

  /** Mini-sector index 0..miniSectorCount-1 (equal-length by distance). */
  miniSectorAt(s: number): number {
    return Math.min(this.miniSectorCount - 1, Math.floor((this.wrapS(s) / this.length) * this.miniSectorCount));
  }

  /** Surface under a point given in track coordinates. */
  surfaceAt(s: number, d: number): SurfaceInfo {
    const wl = this.widthLeft(s);
    const wr = this.widthRight(s);
    if (d >= -wl && d <= wr) return { surface: 'tarmac', kerb: null, outside: false, side: null };
    const side: Side = d < 0 ? 'left' : 'right';
    const beyond = side === 'left' ? -d - wl : d - wr;
    for (const k of this.kerbsAt(side, s)) {
      if (beyond >= k.offset && beyond <= k.offset + k.width) return { surface: 'kerb', kerb: k, outside: true, side };
    }
    let acc = 0;
    for (const layer of this.runoffLayers(side, s)) {
      acc += layer.width;
      if (beyond <= acc) return { surface: layer.surface, kerb: null, outside: true, side };
    }
    return { surface: 'wall', kerb: null, outside: true, side };
  }

  // ------------------------------------------------------------------ terrain

  /** Terrain height (m ASL) at world (x, y), bilinear; NaN outside the grid or if terrain isn't loaded. */
  terrainHeight(x: number, y: number): number {
    const t = this.data.terrain;
    if (!this.terrain) return Number.NaN;
    const u = (x - t.x0) / t.cell;
    const v = (y - t.y0) / t.cell;
    if (u < 0 || v < 0 || u > t.nx - 1 || v > t.ny - 1) return Number.NaN;
    const i0 = Math.min(t.nx - 2, Math.floor(u));
    const j0 = Math.min(t.ny - 2, Math.floor(v));
    const fu = u - i0;
    const fv = v - j0;
    const h = this.terrain;
    const a = h[j0 * t.nx + i0]!;
    const b = h[j0 * t.nx + i0 + 1]!;
    const c = h[(j0 + 1) * t.nx + i0]!;
    const e = h[(j0 + 1) * t.nx + i0 + 1]!;
    return a * (1 - fu) * (1 - fv) + b * fu * (1 - fv) + c * (1 - fu) * fv + e * fu * fv;
  }

  get terrainData(): Float32Array | null {
    return this.terrain;
  }
}
