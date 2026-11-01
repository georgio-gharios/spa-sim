/**
 * Pure geometry builders for the circuit (no WebGL, no DOM) so they can be unit-tested in Node.
 * Track frame (x east, y north, z up) is mapped to three.js (X = x, Y = z - baseZ, Z = -y).
 */
import { BufferAttribute, BufferGeometry } from 'three';
import type { TrackModel } from '../../track/TrackModel';
import type { BarrierType, KerbDef, RunoffSurface, Side } from '../../track/types';

export interface WorldMap {
  baseZ: number;
}

export class GeoBuilder {
  readonly pos: number[] = [];
  readonly uv: number[] = [];
  readonly col: number[] = [];
  readonly idx: number[] = [];
  readonly nrm: number[] = [];
  withColor = false;
  withNormals = false;

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  vertex(x: number, y: number, z: number, u: number, v: number, wm: WorldMap): number {
    this.pos.push(x, z - wm.baseZ, -y);
    this.uv.push(u, v);
    return this.vertexCount - 1;
  }

  quad(a: number, b: number, c: number, d: number): void {
    // a->b across the strip (increasing lateral offset) on one ring, c->d on the next ring.
    // Wound counter-clockwise when seen from above (+Y), so faces point up.
    this.idx.push(a, b, c, b, d, c);
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    if (this.withColor) g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    const n = this.vertexCount;
    g.setIndex(n > 65535 ? new BufferAttribute(new Uint32Array(this.idx), 1) : new BufferAttribute(new Uint16Array(this.idx), 1));
    if (this.withNormals) g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nrm), 3));
    else g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/** One cross-section point: lateral offset (positive right) and height above the cambered road plane. */
export type Section = Array<[d: number, dz: number]>;

/**
 * Sweep a cross-section along sample indices [i0, i0 + n]. If `closed`, the last ring connects back to ring 0
 * through a duplicated ring (same positions, u continues) so textures don't seam and geometry has no gap.
 */
export function sweep(
  track: TrackModel,
  wm: WorldMap,
  g: GeoBuilder,
  i0: number,
  n: number,
  section: (i: number) => Section,
  opts: { closed?: boolean; uLen?: number; vMode?: 'd' | 'index'; vLen?: number; useSurfaceNormal?: boolean } = {},
): void {
  const uLen = opts.uLen ?? 8;
  const vLen = opts.vLen ?? 8;
  const rings = opts.closed ? n + 1 : n + 1;
  let prev: number[] | null = null;
  const base = g.vertexCount;
  let sectionLen = -1;
  for (let r = 0; r < rings; r++) {
    const i = i0 + r;
    const p = track.raw(i);
    const sec = section(i);
    if (sectionLen < 0) sectionLen = sec.length;
    if (sec.length !== sectionLen) throw new Error('sweep: section length must be constant');
    const rx = Math.sin(p.heading);
    const ry = -Math.cos(p.heading);
    const tc = Math.tan(p.camber);
    const ring: number[] = [];
    // u continues monotonically even past the wrap so closed strips get a seamless texture
    const u = (r * track.ds) / uLen;
    sec.forEach(([d, dz], k) => {
      const v = opts.vMode === 'index' ? k / Math.max(1, sec.length - 1) : d / vLen;
      ring.push(g.vertex(p.x + rx * d, p.y + ry * d, p.z - d * tc + dz, u, v, wm));
      if (g.withNormals) {
        // analytic surface normal of the cambered, graded road plane
        const grade = (track.raw(i + 1).z - track.raw(i - 1).z) / (2 * track.ds);
        const hx = Math.cos(p.heading);
        const hy = Math.sin(p.heading);
        // tangent t = (hx, hy, grade), lateral l = (rx, ry, -tc); normal = l x t
        let ax = ry * grade - -tc * hy;
        let ay = -tc * hx - rx * grade;
        let az = rx * hy - ry * hx;
        if (az < 0) {
          ax = -ax;
          ay = -ay;
          az = -az;
        }
        const len = Math.hypot(ax, ay, az);
        g.nrm.push(ax / len, az / len, -ay / len);
      }
    });
    if (prev) {
      for (let k = 0; k < sec.length - 1; k++) g.quad(prev[k]!, prev[k + 1]!, ring[k]!, ring[k + 1]!);
    }
    prev = ring;
  }
  void base;
}

// ------------------------------------------------------------------------------------------------ road

export function buildRoad(track: TrackModel, wm: WorldMap, segments = 8): GeoBuilder {
  const g = new GeoBuilder();
  g.withNormals = true;
  const N = track.count;
  // choose the u-length so the loop holds an integer number of texture repeats (no texture seam)
  const uLen = track.length / Math.round(track.length / 10);
  sweep(
    track,
    wm,
    g,
    0,
    N,
    (i) => {
      const p = track.raw(i);
      const sec: Section = [];
      for (let k = 0; k <= segments; k++) sec.push([-p.widthLeft + ((p.widthLeft + p.widthRight) * k) / segments, 0]);
      return sec;
    },
    { closed: true, uLen, vLen: 10 },
  );
  return g;
}

export function buildEdgeLines(track: TrackModel, wm: WorldMap, width = 0.25): GeoBuilder {
  const g = new GeoBuilder();
  g.withNormals = true;
  const lift = 0.012;
  for (const side of ['left', 'right'] as const) {
    sweep(
      track,
      wm,
      g,
      0,
      track.count,
      (i) => {
        const p = track.raw(i);
        return side === 'left'
          ? [
              [-p.widthLeft, lift],
              [-p.widthLeft + width, lift],
            ]
          : [
              [p.widthRight - width, lift],
              [p.widthRight, lift],
            ];
      },
      { closed: true, uLen: 4, vMode: 'index' },
    );
  }
  return g;
}

/** Painted line across the track at distance s (timing line, sector lines). */
export function buildCrossLine(track: TrackModel, wm: WorldMap, s: number, width: number, g = new GeoBuilder()): GeoBuilder {
  const p0 = track.sample(s);
  const lift = 0.014;
  const a = track.pointAt(s, -p0.widthLeft);
  const b = track.pointAt(s, p0.widthRight);
  const a2 = track.pointAt(s + width, -track.widthLeft(s + width));
  const b2 = track.pointAt(s + width, track.widthRight(s + width));
  const v0 = g.vertex(a.x, a.y, a.z + lift, 0, 0, wm);
  const v1 = g.vertex(b.x, b.y, b.z + lift, 1, 0, wm);
  const v2 = g.vertex(a2.x, a2.y, a2.z + lift, 0, 1, wm);
  const v3 = g.vertex(b2.x, b2.y, b2.z + lift, 1, 1, wm);
  g.quad(v0, v1, v2, v3);
  return g;
}

// ------------------------------------------------------------------------------------------------ kerbs

const KERB_HEIGHT: Record<KerbDef['type'], number> = { flat: 0.008, standard: 0.035, sausage: 0.1 };

function rangeIndices(track: TrackModel, s0: number, s1: number): { i0: number; n: number } {
  const i0 = Math.round(track.wrapS(s0) / track.ds);
  let i1 = Math.round(track.wrapS(s1) / track.ds);
  if (i1 <= i0) i1 += track.count;
  return { i0, n: i1 - i0 };
}

export function kerbSection(type: KerbDef['type'], inner: number, width: number, sign: 1 | -1): Section {
  const h = KERB_HEIGHT[type];
  const pts: Section = [];
  if (type === 'sausage') {
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      pts.push([sign * (inner + t * width), h * Math.sin(Math.PI * t) + 0.004]);
    }
  } else {
    // sloped top rising outward, then a short vertical face back to the ground
    pts.push([sign * inner, 0.004], [sign * (inner + width * 0.35), h * 0.8], [sign * (inner + width), h], [sign * (inner + width + 0.02), 0.0]);
  }
  // keep triangle winding consistent (left-to-right across the strip)
  return sign === 1 ? pts : pts.reverse();
}

export function buildKerbs(track: TrackModel, wm: WorldMap): { painted: GeoBuilder; sausage: GeoBuilder } {
  const painted = new GeoBuilder();
  const sausage = new GeoBuilder();
  for (const k of track.data.kerbs) {
    const { i0, n } = rangeIndices(track, k.s0, k.s1);
    const sign: 1 | -1 = k.side === 'right' ? 1 : -1;
    const g = k.type === 'sausage' ? sausage : painted;
    sweep(
      track,
      wm,
      g,
      i0,
      n,
      (i) => {
        const p = track.raw(i);
        const edge = k.side === 'right' ? p.widthRight : p.widthLeft;
        return kerbSection(k.type, edge + k.offset, k.width, sign);
      },
      { uLen: 3, vMode: 'index' },
    );
  }
  return { painted, sausage };
}

// ------------------------------------------------------------------------------------------------ inside-of-corner clamp

/** See TrackModel.maxOffset (shared with physics so barriers are where they are drawn). */
export function maxOffset(track: TrackModel, side: Side, i: number): number {
  return track.maxOffset(side, i * track.ds);
}

// ------------------------------------------------------------------------------------------------ runoff

/** Runoff ribbons grouped by surface. Each layer slot is swept separately; widths follow the zones. */
export function buildRunoff(track: TrackModel, wm: WorldMap): Record<RunoffSurface, GeoBuilder> {
  const out: Record<RunoffSurface, GeoBuilder> = { tarmac: new GeoBuilder(), grass: new GeoBuilder(), gravel: new GeoBuilder() };
  const N = track.count;
  for (const side of ['left', 'right'] as const) {
    const sign = side === 'right' ? 1 : -1;
    for (let slot = 0; slot < 3; slot++) {
      let i = 0;
      while (i < N) {
        const layers = track.runoffLayers(side, i * track.ds);
        const layer = layers[slot];
        if (!layer) {
          i++;
          continue;
        }
        // extend while this slot keeps the same surface
        let j = i;
        while (j < N && track.runoffLayers(side, j * track.ds)[slot]?.surface === layer.surface) j++;
        const surface = layer.surface;
        // include one extra ring so neighbouring runs meet without a gap
        const n = Math.min(j - i + 1, N - i + (j >= N ? 1 : 0));
        sweep(
          track,
          wm,
          out[surface],
          i,
          n,
          (ii) => {
            const p = track.raw(ii);
            const ls = track.runoffLayers(side, p.s);
            const edge = side === 'right' ? p.widthRight : p.widthLeft;
            let inner = edge;
            for (let k = 0; k < slot; k++) inner += ls[k]?.width ?? 0;
            const lim = Math.max(edge + 0.2, maxOffset(track, side, ii));
            const w0 = ls[slot]?.width ?? 0;
            inner = Math.min(inner, lim);
            const w = Math.min(inner + w0, lim) - inner;
            // slight fall-away from the road edge (drainage), never above the road
            const drop0 = -0.01 - (inner - edge) * 0.015;
            const drop1 = -0.01 - (inner + w - edge) * 0.015;
            const sec: Section = [
              [sign * inner, drop0],
              [sign * (inner + w), drop1],
            ];
            return sign === 1 ? sec : (sec.reverse() as Section);
          },
          { uLen: 6, vLen: 6 },
        );
        i = j;
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ barriers

export const BARRIER_HEIGHT: Record<Exclude<BarrierType, 'none'>, number> = {
  armco: 0.85,
  tyres: 1.0,
  tecpro: 1.05,
  concrete: 1.1,
  pitwall: 1.2,
};

export function barrierOffset(track: TrackModel, side: Side, s: number): number {
  return track.barrierOffset(side, s);
}

/** Vertical barrier walls grouped by type, plus the catch-fence ribbon above them. */
export function buildBarriers(
  track: TrackModel,
  wm: WorldMap,
  fenceHeight = 3.2,
): { walls: Record<Exclude<BarrierType, 'none'>, GeoBuilder>; fence: GeoBuilder } {
  const walls = {
    armco: new GeoBuilder(),
    tyres: new GeoBuilder(),
    tecpro: new GeoBuilder(),
    concrete: new GeoBuilder(),
    pitwall: new GeoBuilder(),
  };
  const fence = new GeoBuilder();
  const N = track.count;
  const step = 2;
  for (const side of ['left', 'right'] as const) {
    const sign = side === 'right' ? 1 : -1;
    let i = 0;
    while (i < N) {
      const type = track.barrierAt(side, i * track.ds);
      let j = i;
      while (j < N && track.barrierAt(side, j * track.ds) === type) j++;
      if (type !== 'none') {
        const h = BARRIER_HEIGHT[type];
        const gw = walls[type];
        let prevW: [number, number] | null = null;
        let prevF: [number, number] | null = null;
        for (let k = i; k <= Math.min(j, N); k += step) {
          const kk = Math.min(k, j);
          const p = track.raw(kk);
          const off = barrierOffset(track, side, p.s);
          const q = track.pointAt(p.s, sign * off);
          const z0 = track.terrainData ? Math.min(q.z, track.terrainHeight(q.x, q.y)) - 0.3 : q.z - 0.3;
          const zr = q.z - 0.02 - (off - (side === 'right' ? p.widthRight : p.widthLeft)) * 0.015;
          const u = (kk * track.ds) / 4;
          const a = gw.vertex(q.x, q.y, Math.min(z0, zr), u, 0, wm);
          const b = gw.vertex(q.x, q.y, zr + h, u, 1, wm);
          if (prevW) gw.quad(prevW[0], prevW[1], a, b);
          prevW = [a, b];
          // no catch fence on the inside of tight corners (it would block the view and isn't used there)
          if (maxOffset(track, side, kk) > 80) {
            const fa = fence.vertex(q.x, q.y, zr + h, u, 0, wm);
            const fb = fence.vertex(q.x, q.y, zr + h + fenceHeight, u, fenceHeight / 4, wm);
            if (prevF) fence.quad(prevF[0], prevF[1], fa, fb);
            prevF = [fa, fb];
          } else {
            prevF = null;
          }
          if (kk === j) break;
        }
      }
      i = j;
    }
  }
  return { walls, fence };
}

// ------------------------------------------------------------------------------------------------ pit lane

export function buildPitLane(track: TrackModel, wm: WorldMap): { surface: GeoBuilder; lines: GeoBuilder } {
  const { path, laneWidth, pathFeatures } = track.data.pit;
  const surface = new GeoBuilder();
  const lines = new GeoBuilder();
  const n = path.x.length;
  const at = (i: number) => {
    const j = Math.max(0, Math.min(n - 1, i));
    return { x: path.x[j]!, y: path.y[j]!, z: path.z[j]!, half: (path.w?.[j] ?? laneWidth) / 2 };
  };
  const dir = (i: number) => {
    const a = at(i - 1);
    const b = at(i + 1);
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { hx: (b.x - a.x) / l, hy: (b.y - a.y) / l };
  };
  /** Sweep between lateral offsets d0(i)..d1(i) (positive = right of the lane direction). */
  const strip = (g: GeoBuilder, i0: number, i1: number, d0: (i: number) => number, d1: (i: number) => number, lift: number) => {
    let prev: [number, number] | null = null;
    for (let i = Math.max(0, i0); i <= Math.min(n - 1, i1); i++) {
      const p = at(i);
      const { hx, hy } = dir(i);
      const rx = hy;
      const ry = -hx;
      const a = g.vertex(p.x + rx * d0(i), p.y + ry * d0(i), p.z + lift, i / 6, 0, wm);
      const b = g.vertex(p.x + rx * d1(i), p.y + ry * d1(i), p.z + lift, i / 6, 1, wm);
      if (prev) g.quad(prev[0], prev[1], a, b);
      prev = [a, b];
    }
  };
  const h = (i: number) => at(i).half;
  strip(surface, 0, n - 1, (i) => -h(i), h, -0.015);
  // solid edge lines
  strip(lines, 0, n - 1, (i) => h(i) - 0.2, h, 0.0);
  strip(lines, 0, n - 1, (i) => -h(i), (i) => -h(i) + 0.2, 0.0);
  // which side of the lane faces the track along the pit-exit line?
  const mid = at(Math.round((pathFeatures.exitLineStart + pathFeatures.exitLineEnd) / 2));
  const md = dir(Math.round((pathFeatures.exitLineStart + pathFeatures.exitLineEnd) / 2));
  const tp = track.project(mid.x, mid.y);
  const tq = track.pointAt(tp.s, 0);
  const trackOnRight = (tq.x - mid.x) * md.hy - (tq.y - mid.y) * md.hx > 0;
  const sgn = trackOnRight ? 1 : -1;
  // pit-exit line: solid, on the track side of the lane
  strip(lines, Math.round(pathFeatures.exitLineStart), Math.round(pathFeatures.exitLineEnd), (i) => (sgn > 0 ? h(i) : -h(i) - 0.3), (i) => (sgn > 0 ? h(i) + 0.3 : -h(i)), 0.0);
  // fast lane / working lane divider (dashed) on the side away from the track, between the boxes
  for (let i = Math.round(pathFeatures.boxesStart); i < pathFeatures.boxesEnd; i += 6) {
    strip(lines, i, i + 3, () => -sgn * 0.6 - 0.075, () => -sgn * 0.6 + 0.075, 0.0);
  }
  // speed-limit lines across the lane
  for (const f of [pathFeatures.speedLimitStart, pathFeatures.speedLimitEnd]) strip(lines, Math.round(f), Math.round(f) + 1, (i) => -h(i), h, 0.0);
  return { surface, lines };
}

/** Utility for tests: count edges used by exactly one triangle (after welding by position). */
export function boundaryEdgeCount(g: BufferGeometry, eps = 1e-3): { boundary: number; nonManifold: number; degenerate: number } {
  const pos = g.getAttribute('position');
  const index = g.getIndex();
  if (!index) throw new Error('indexed geometry expected');
  const key = (i: number) =>
    `${Math.round(pos.getX(i) / eps)},${Math.round(pos.getY(i) / eps)},${Math.round(pos.getZ(i) / eps)}`;
  const weld = new Map<string, number>();
  const id = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const k = key(i);
    let w = weld.get(k);
    if (w === undefined) weld.set(k, (w = weld.size));
    id[i] = w;
  }
  const edges = new Map<string, number>();
  let degenerate = 0;
  for (let t = 0; t < index.count; t += 3) {
    const a = id[index.getX(t)]!;
    const b = id[index.getX(t + 1)]!;
    const c = id[index.getX(t + 2)]!;
    if (a === b || b === c || a === c) {
      degenerate++;
      continue;
    }
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const k = u < v ? `${u}_${v}` : `${v}_${u}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  let boundary = 0;
  let nonManifold = 0;
  for (const c of edges.values()) {
    if (c === 1) boundary++;
    else if (c > 2) nonManifold++;
  }
  return { boundary, nonManifold, degenerate };
}
