/** Terrain, forest and trackside structures. Browser-side (uses three.js materials/instancing). */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Material,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng } from '../core/rng';
import type { TrackModel } from '../track/TrackModel';
import type { Side } from '../track/types';
import { barrierOffset, GeoBuilder, type WorldMap } from './track/geometry';
import { crowdTexture, grassTexture, signTexture } from './textures';
import { mergeStaticByMaterial, splitByTiles, tileKey } from './tiling';

export const toThree = (x: number, y: number, z: number, wm: WorldMap): Vector3 => new Vector3(x, z - wm.baseZ, -y);

// ------------------------------------------------------------------------------------------------ terrain

export function buildTerrain(track: TrackModel, wm: WorldMap, aniso: number): Group {
  const t = track.data.terrain;
  const h = track.terrainData;
  if (!h) throw new Error('terrain not loaded');
  const g = new GeoBuilder();
  g.withColor = true;
  const rng = new Rng('terrain-colour');
  const c = new Color();
  for (let j = 0; j < t.ny; j++) {
    for (let i = 0; i < t.nx; i++) {
      const x = t.x0 + i * t.cell;
      const y = t.y0 + j * t.cell;
      g.vertex(x, y, h[j * t.nx + i]!, x / 12, y / 12, wm);
      const v = valueNoise(x / 180, y / 180, 7) * 0.6 + rng.next() * 0.08;
      c.setRGB(0.36 + v * 0.18, 0.5 + v * 0.18, 0.28 + v * 0.08);
      g.col.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < t.ny - 1; j++) {
    for (let i = 0; i < t.nx - 1; i++) {
      const a = j * t.nx + i;
      // rows increase northwards (-Z in three); wind so faces point up
      g.idx.push(a, a + 1, a + t.nx, a + 1, a + t.nx + 1, a + t.nx);
    }
  }
  const mat = new MeshStandardMaterial({ map: grassTexture(aniso), vertexColors: true, roughness: 0.95 });
  const group = new Group();
  group.name = 'terrain';
  for (const geo of splitByTiles(g.build(), 400)) {
    const m = new Mesh(geo, mat);
    m.receiveShadow = true;
    group.add(m);
  }
  return group;
}

/** Smooth value noise in [0, 1). */
export function valueNoise(x: number, y: number, seed: number): number {
  const hash = (ix: number, iy: number) => {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 2147483647);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

// ------------------------------------------------------------------------------------------------ exclusion zones

interface Rect {
  cx: number;
  cy: number;
  hx: number;
  hy: number;
  rot: number;
}

const exclusion: Rect[] = [];

function excluded(x: number, y: number): boolean {
  for (const r of exclusion) {
    const dx = x - r.cx;
    const dy = y - r.cy;
    const c = Math.cos(-r.rot);
    const s = Math.sin(-r.rot);
    const lx = dx * c - dy * s;
    const ly = dx * s + dy * c;
    if (Math.abs(lx) < r.hx && Math.abs(ly) < r.hy) return true;
  }
  return false;
}

// ------------------------------------------------------------------------------------------------ forest

export interface ForestOptions {
  maxTrees: number;
  castShadow: boolean;
}

function conifer(): BufferGeometry {
  const trunk = new CylinderGeometry(0.25, 0.35, 4, 5);
  trunk.translate(0, 2, 0);
  const parts: BufferGeometry[] = [trunk];
  const tiers = [
    [3.2, 9, 6.5],
    [2.6, 8, 11],
    [1.8, 7, 15.5],
  ] as const;
  for (const [r, hgt, y] of tiers) {
    const cone = new ConeGeometry(r, hgt, 7);
    cone.translate(0, y, 0);
    parts.push(cone);
  }
  const colours = [new Color(0x4a3524), new Color(0x2a4f30), new Color(0x2e5634), new Color(0x335c38)];
  parts.forEach((p, k) => {
    const n = p.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    const cc = colours[k]!;
    for (let i = 0; i < n; i++) col.set([cc.r, cc.g, cc.b], i * 3);
    p.setAttribute('color', new BufferAttribute(col, 3));
    p.deleteAttribute('uv');
  });
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  if (!g) throw new Error('merge failed');
  g.computeVertexNormals();
  return g;
}

function broadleaf(): BufferGeometry {
  const trunk = new CylinderGeometry(0.3, 0.45, 6, 5);
  trunk.translate(0, 3, 0);
  const crown = new IcosahedronGeometry(5, 0);
  crown.scale(1, 1.15, 1);
  crown.translate(0, 10, 0);
  const crown2 = new IcosahedronGeometry(3.6, 0);
  crown2.translate(1.8, 13, 0.8);
  const colours = [new Color(0x5a4430), new Color(0x557f38), new Color(0x63893d)];
  const parts = [trunk, crown, crown2];
  parts.forEach((p, k) => {
    const n = p.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    const cc = colours[k]!;
    for (let i = 0; i < n; i++) col.set([cc.r, cc.g, cc.b], i * 3);
    p.setAttribute('color', new BufferAttribute(col, 3));
    p.deleteAttribute('uv');
  });
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  if (!g) throw new Error('merge failed');
  g.computeVertexNormals();
  return g;
}

/** Deterministic Ardennes forest: mostly spruce, some broadleaf, kept clear of the circuit corridor. */
export function buildForest(track: TrackModel, wm: WorldMap, opts: ForestOptions): Group {
  const t = track.data.terrain;
  const rng = new Rng('forest');
  const spacing = 6.5;
  const pts: Array<{ x: number; y: number; z: number; broad: boolean; s: number; r: number }> = [];
  const x1 = t.x0 + (t.nx - 1) * t.cell;
  const y1 = t.y0 + (t.ny - 1) * t.cell;
  for (let y = t.y0 + 20; y < y1 - 20; y += spacing) {
    for (let x = t.x0 + 20; x < x1 - 20; x += spacing) {
      const px = x + rng.range(-spacing * 0.45, spacing * 0.45);
      const py = y + rng.range(-spacing * 0.45, spacing * 0.45);
      const density = valueNoise(px / 260, py / 260, 3) * 0.75 + valueNoise(px / 60, py / 60, 11) * 0.35;
      const keep = rng.next();
      if (density < 0.52 || keep > (density - 0.45) * 2.2) continue;
      const pr = track.project(px, py);
      const side: Side = pr.d < 0 ? 'left' : 'right';
      const clear = barrierOffset(track, side, pr.s) + 9;
      if (Math.abs(pr.d) < clear) continue;
      if (excluded(px, py)) continue;
      const z = track.terrainHeight(px, py);
      if (!Number.isFinite(z)) continue;
      pts.push({ x: px, y: py, z, broad: valueNoise(px / 140, py / 140, 5) > 0.62, s: rng.range(0.75, 1.35), r: rng.range(0, Math.PI * 2) });
    }
  }
  // thin uniformly (deterministic) down to the quality budget
  const stride = Math.max(1, pts.length / opts.maxTrees);
  const chosen = stride <= 1 ? pts : pts.filter((_, k) => Math.floor(k / stride) !== Math.floor((k - 1) / stride));
  const group = new Group();
  group.name = 'forest';
  const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  const geos = { conifer: conifer(), broad: broadleaf() };
  const tiles = new Map<string, typeof chosen>();
  for (const p of chosen) {
    const key = `${p.broad ? 'b' : 'c'}:${tileKey(p.x, -p.y, 300)}`;
    let l = tiles.get(key);
    if (!l) tiles.set(key, (l = []));
    l.push(p);
  }
  const m = new Matrix4();
  const q = new Quaternion();
  const tint = new Color();
  const up = new Vector3(0, 1, 0);
  for (const [key, list] of tiles) {
    const broad = key.startsWith('b');
    const mesh = new InstancedMesh(broad ? geos.broad : geos.conifer, mat, list.length);
    list.forEach((p, k) => {
      q.setFromAxisAngle(up, p.r);
      m.compose(toThree(p.x, p.y, p.z - 0.3, wm), q, new Vector3(p.s, p.s * (broad ? 1 : 1.1), p.s));
      mesh.setMatrixAt(k, m);
      const v = 0.82 + valueNoise(p.x / 40, p.y / 40, 9) * 0.3;
      mesh.setColorAt(k, tint.setRGB(v, v * (0.95 + 0.1 * rng.next()), v));
    });
    mesh.castShadow = opts.castShadow;
    mesh.receiveShadow = false;
    mesh.computeBoundingSphere(); // per-tile bounds: culled like any other mesh
    group.add(mesh);
  }
  group.userData.count = chosen.length;
  return group;
}

// ------------------------------------------------------------------------------------------------ helpers for oriented boxes

function placeBox(
  parent: Object3D,
  mat: Material,
  wm: WorldMap,
  x: number,
  y: number,
  zBase: number,
  heading: number,
  len: number,
  depth: number,
  height: number,
  shadows = true,
): Mesh {
  const geo = new BoxGeometry(len, height, depth);
  const m = new Mesh(geo, mat);
  m.position.copy(toThree(x, y, zBase + height / 2, wm));
  m.rotation.y = heading; // heading is CCW from east; three Y-rotation is CCW seen from above with Z = -north
  m.castShadow = shadows;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function frameAt(track: TrackModel, s: number, d: number) {
  const p = track.sample(s);
  const q = track.pointAt(s, d);
  return { ...q, heading: p.heading, groundZ: Math.min(q.z, track.terrainHeight(q.x, q.y)) };
}

// ------------------------------------------------------------------------------------------------ grandstands

function grandstand(
  track: TrackModel,
  wm: WorldMap,
  parent: Group,
  s0: number,
  s1: number,
  side: Side,
  rows: number,
  mats: { seats: Material; steel: Material; roof: Material },
): void {
  const sign = side === 'right' ? 1 : -1;
  const step = 5;
  const g = new GeoBuilder();
  const rowDepth = 0.85;
  const rowRise = 0.5;
  // stepped profile (outward offset, height): riser then tread for every row
  const profile: Array<[number, number]> = [[0, 0]];
  for (let r = 0; r < rows; r++) {
    profile.push([r * rowDepth, (r + 1) * rowRise], [(r + 1) * rowDepth, (r + 1) * rowRise]);
  }
  let prev: number[] | null = null;
  for (let s = s0; s <= s1 + 1e-6; s += step) {
    const f = frameAt(track, s, sign * (barrierOffset(track, side, s) + 7));
    const base = f.groundZ + 1.2;
    const rx = Math.sin(f.heading) * sign;
    const ry = -Math.cos(f.heading) * sign;
    const ring = profile.map(([o, h], k) => g.vertex(f.x + rx * o, f.y + ry * o, base + h, (s - s0) / 8, k / 4, wm));
    if (prev) for (let k = 0; k < ring.length - 1; k++) g.quad(prev[k]!, prev[k + 1]!, ring[k]!, ring[k + 1]!);
    prev = ring;
  }
  const seats = new Mesh(g.build(), mats.seats);
  seats.receiveShadow = true;
  seats.castShadow = true;
  parent.add(seats);
  // roof and support columns
  for (let s = s0; s <= s1; s += 20) {
    const off = barrierOffset(track, side, s) + 7;
    const f = frameAt(track, s, sign * (off + (rows * rowDepth) / 2));
    const height = rows * rowRise + 5;
    placeBox(parent, mats.roof, wm, f.x, f.y, f.groundZ + 1.2 + height, f.heading, 20.5, rows * rowDepth + 3, 0.4);
    const back = frameAt(track, s, sign * (off + rows * rowDepth));
    placeBox(parent, mats.steel, wm, back.x, back.y, back.groundZ, f.heading, 0.5, 0.5, height + 1.2, false);
    exclusion.push({ cx: f.x, cy: f.y, hx: 14, hy: rows * rowDepth + 8, rot: f.heading });
  }
}

// ------------------------------------------------------------------------------------------------ pit building

/** Fictional team colours (11 teams). Names live in data later; only colours are needed here. */
const TEAM_COLOURS = [0xd8362b, 0x1e5fd6, 0x10a37f, 0xf2a20c, 0x7a3bd1, 0xe6e6e6, 0x1b1b1b, 0x0fb5c9, 0xd6286f, 0x6e8b1f, 0xb87333];

function pitBuilding(track: TrackModel, wm: WorldMap, parent: Group): void {
  const { path, laneWidth, pathFeatures, boxCount } = track.data.pit;
  const at = (i: number) => {
    const j = Math.max(1, Math.min(path.x.length - 2, Math.round(i)));
    const hx = path.x[j + 1]! - path.x[j - 1]!;
    const hy = path.y[j + 1]! - path.y[j - 1]!;
    return { x: path.x[j]!, y: path.y[j]!, z: path.z[j]!, heading: Math.atan2(hy, hx) };
  };
  const wall = new MeshStandardMaterial({ color: 0xd9dde2, roughness: 0.7 });
  const glass = new MeshStandardMaterial({ color: 0x24313d, roughness: 0.15, metalness: 0.6 });
  const roof = new MeshStandardMaterial({ color: 0x7f868c, roughness: 0.8 });
  const a = pathFeatures.boxesStart - 25;
  const b = pathFeatures.boxesEnd + 25;
  // garages go on the side of the lane away from the track
  const pm = at((pathFeatures.boxesStart + pathFeatures.boxesEnd) / 2);
  const tp = track.pointAt(track.project(pm.x, pm.y).s, 0);
  const awayRight = (tp.x - pm.x) * -Math.sin(pm.heading) + (tp.y - pm.y) * Math.cos(pm.heading) > 0; // track on the left
  const side = awayRight ? 1 : -1;
  const halfW = (i: number) => (path.w?.[Math.round(i)] ?? laneWidth) / 2;
  const depth = 22;
  const segLen = 20;
  for (let i = a; i < b; i += segLen) {
    const p = at(i + segLen / 2);
    const lx = side * Math.sin(p.heading);
    const ly = -side * Math.cos(p.heading);
    const off = halfW(i + segLen / 2) + 1 + depth / 2;
    const cx = p.x + lx * off;
    const cy = p.y + ly * off;
    placeBox(parent, wall, wm, cx, cy, p.z - 0.5, p.heading, segLen + 0.2, depth, 5.5);
    placeBox(parent, glass, wm, cx, cy, p.z + 5, p.heading, segLen + 0.2, depth - 1, 4);
    placeBox(parent, roof, wm, cx, cy, p.z + 9, p.heading, segLen + 1, depth + 2, 0.5);
    exclusion.push({ cx, cy, hx: segLen, hy: depth + 30, rot: p.heading });
  }
  // garage doors with team colours, one garage per team
  const per = (pathFeatures.boxesEnd - pathFeatures.boxesStart) / boxCount;
  for (let k = 0; k < boxCount; k++) {
    const ik = pathFeatures.boxesStart + per * (k + 0.5);
    const p = at(ik);
    const lx = side * Math.sin(p.heading);
    const ly = -side * Math.cos(p.heading);
    const off = halfW(ik) + 1 + 0.15;
    const mat = new MeshStandardMaterial({ color: TEAM_COLOURS[k % TEAM_COLOURS.length]!, roughness: 0.5 });
    placeBox(parent, mat, wm, p.x + lx * off, p.y + ly * off, p.z, p.heading, per * 0.8, 0.3, 4.2, false);
  }
}

// ------------------------------------------------------------------------------------------------ marshal posts, gantries, signage

function marshalPosts(track: TrackModel, wm: WorldMap, parent: Group): void {
  const body = new MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.7 });
  const roof = new MeshStandardMaterial({ color: 0xf07a12, roughness: 0.6 });
  let k = 0;
  for (let s = 150; s < track.length - 50; s += 330) {
    const side: Side = k++ % 2 ? 'left' : 'right';
    if (track.barrierAt(side, s) === 'none' || track.barrierAt(side, s) === 'pitwall') continue;
    const sign = side === 'right' ? 1 : -1;
    const f = frameAt(track, s, sign * (barrierOffset(track, side, s) + 2.5));
    placeBox(parent, body, wm, f.x, f.y, f.groundZ, f.heading, 2.4, 2.0, 2.4);
    placeBox(parent, roof, wm, f.x, f.y, f.groundZ + 2.4, f.heading, 2.8, 2.4, 0.25);
  }
}

const BRANDS: Array<[string, string, string, string]> = [
  ['VELMORA', '#0f2a4a', '#ffffff', '#e8452c'],
  ['QUINTAR FUELS', '#f4c20d', '#111111', '#111111'],
  ['BRIGHTWAVE', '#ffffff', '#1747a6', '#1aa6e0'],
  ['OLTRIX', '#121212', '#7dd23a', '#7dd23a'],
  ['ARDENVALE WATER', '#1f8fd6', '#ffffff', '#bfe6ff'],
  ['KESTRAVA', '#8a1020', '#ffffff', '#ffffff'],
  ['NOVAPLEX', '#2b2b2b', '#ff8a1d', '#ff8a1d'],
  ['HALDEN & CO', '#e9e2d0', '#2b2b2b', '#a8842c'],
];

function signage(track: TrackModel, wm: WorldMap, parent: Group): void {
  const mats = BRANDS.map(([t, bg, fg, ac]) => new MeshStandardMaterial({ map: signTexture(t, bg, fg, ac), roughness: 0.6 }));
  const rng = new Rng('signage');
  const builders = BRANDS.map(() => new GeoBuilder());
  const boardLen = 6;
  const addBoard = (s: number, side: Side) => {
    const b = track.barrierAt(side, s);
    if (b === 'none') return;
    const sign = side === 'right' ? 1 : -1;
    const off = barrierOffset(track, side, s) - 0.05;
    const a = track.pointAt(s, sign * off);
    const c = track.pointAt(s + boardLen, sign * barrierOffset(track, side, s + boardLen) * 1 - sign * 0.05);
    const z0 = Math.max(a.z, c.z) + 0.05;
    const gi = rng.int(0, BRANDS.length);
    const g = builders[gi]!;
    // face the track: order vertices so the front faces the road
    const flip = side === 'right';
    const v0 = g.vertex(a.x, a.y, z0, flip ? 1 : 0, 0, wm);
    const v1 = g.vertex(c.x, c.y, z0, flip ? 0 : 1, 0, wm);
    const v2 = g.vertex(a.x, a.y, z0 + 1.0, flip ? 1 : 0, 1, wm);
    const v3 = g.vertex(c.x, c.y, z0 + 1.0, flip ? 0 : 1, 1, wm);
    g.idx.push(v0, v1, v2, v1, v3, v2);
  };
  // braking zones before the main corners + scattered boards elsewhere
  for (const c of track.data.corners) {
    for (let k = 1; k <= 4; k++) {
      addBoard(c.s0 - k * (boardLen + 2), c.dir === 'R' ? 'left' : 'right');
    }
  }
  for (let s = 40; s < track.length; s += 90) if (rng.next() < 0.45) addBoard(s, rng.next() < 0.5 ? 'left' : 'right');
  builders.forEach((g, k) => {
    if (!g.vertexCount) return;
    mats[k]!.side = DoubleSide;
    for (const geo of splitByTiles(g.build())) parent.add(new Mesh(geo, mats[k]!));
  });
}

function gantry(track: TrackModel, wm: WorldMap, parent: Group, s: number, label: string | null, withLights: boolean): void {
  const steel = new MeshStandardMaterial({ color: 0x3d4247, roughness: 0.5, metalness: 0.6 });
  const p = track.sample(s);
  const l = track.pointAt(s, -(p.widthLeft + 2.5));
  const r = track.pointAt(s, p.widthRight + 2.5);
  const span = Math.hypot(r.x - l.x, r.y - l.y);
  const height = 7.5;
  placeBox(parent, steel, wm, l.x, l.y, l.z - 0.5, p.heading, 0.6, 0.6, height + 1);
  placeBox(parent, steel, wm, r.x, r.y, r.z - 0.5, p.heading, 0.6, 0.6, height + 1);
  const mid = { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2, z: (l.z + r.z) / 2 };
  const beam = placeBox(parent, steel, wm, mid.x, mid.y, mid.z + height, p.heading + Math.PI / 2, span + 1, 1.2, 1.4);
  void beam;
  if (label) {
    const k = Math.abs(label.length) % BRANDS.length;
    const [t, bg, fg, ac] = BRANDS[k]!;
    const tex: Texture = signTexture(label === 'brand' ? t : label, bg, fg, ac);
    const board = new Mesh(new PlaneGeometry(span * 0.8, 1.6), new MeshStandardMaterial({ map: tex, side: DoubleSide }));
    board.position.copy(toThree(mid.x - Math.cos(p.heading) * 0.7, mid.y - Math.sin(p.heading) * 0.7, mid.z + height + 0.7, wm));
    board.rotation.y = p.heading + Math.PI / 2 + Math.PI;
    parent.add(board);
  }
  if (withLights) {
    const pod = new MeshStandardMaterial({ color: 0x111111, roughness: 0.4 });
    const lamp = new MeshStandardMaterial({ color: 0x330000, emissive: 0x550000, roughness: 0.3 });
    for (let k = 0; k < 5; k++) {
      const f = (k - 2) * 1.4;
      const px = mid.x + Math.sin(p.heading) * f - Math.cos(p.heading) * 0.8;
      const py = mid.y - Math.cos(p.heading) * f - Math.sin(p.heading) * 0.8;
      placeBox(parent, pod, wm, px, py, mid.z + height - 1.4, p.heading + Math.PI / 2, 0.9, 0.3, 1.4, false);
      const m = placeBox(parent, lamp, wm, px - Math.cos(p.heading) * 0.16, py - Math.sin(p.heading) * 0.16, mid.z + height - 0.9, p.heading + Math.PI / 2, 0.5, 0.05, 0.5, false);
      m.name = `start-light-${k}`;
    }
  }
}

// ------------------------------------------------------------------------------------------------ public

export function buildStructures(track: TrackModel, wm: WorldMap): Group {
  exclusion.length = 0;
  const group = new Group();
  group.name = 'structures';
  const mats = {
    seats: new MeshStandardMaterial({ map: crowdTexture(), roughness: 0.9 }),
    steel: new MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.5, metalness: 0.5 }),
    roof: new MeshStandardMaterial({ color: 0xe8ebee, roughness: 0.6, side: DoubleSide }),
  };
  mats.seats.side = DoubleSide;
  pitBuilding(track, wm, group);
  // positions follow the spring-2026 orthophoto: main stand opposite the pits, stands on the run to Eau Rouge
  grandstand(track, wm, group, track.length - 150, track.length - 20, 'left', 14, mats);
  grandstand(track, wm, group, 470, 560, 'left', 10, mats);
  grandstand(track, wm, group, 590, 690, 'left', 14, mats);
  grandstand(track, wm, group, 3700, 3800, 'right', 9, mats);
  grandstand(track, wm, group, 6150, 6230, 'right', 8, mats);
  marshalPosts(track, wm, group);
  signage(track, wm, group);
  gantry(track, wm, group, 0, null, true);
  gantry(track, wm, group, 1650, 'brand', false);
  gantry(track, wm, group, 6250, 'brand', false);
  // ~200 small boxes -> a handful of merged, tiled meshes (draw calls matter in both render passes)
  return mergeStaticByMaterial(group, (m) => m.name.startsWith('start-light'));
}
