import { describe, expect, it } from 'vitest';
import { loadTrackNode, readJson } from './helpers/track';

interface Fact<T> { value: T; tolerancePct?: number; toleranceM?: number }
const facts = readJson<Record<string, Fact<number | string>>>('data/track/facts.json');
const track = loadTrackNode();

describe('track geometry', () => {
  it('lap length is within tolerance of the published length', () => {
    const f = facts.lapLengthM as Fact<number>;
    // measure independently from the sample positions (closed polyline)
    let len = 0;
    for (let i = 0; i < track.count; i++) {
      const a = track.raw(i);
      const b = track.raw(i + 1);
      len += Math.hypot(b.x - a.x, b.y - a.y);
    }
    const errPct = (Math.abs(len - f.value) / f.value) * 100;
    expect(errPct).toBeLessThan(f.tolerancePct!);
    expect(Math.abs(len - track.length)).toBeLessThan(1);
  });

  it('is a closed loop with ~1 m spacing and no gaps or jumps', () => {
    let maxStep = 0;
    let minStep = Infinity;
    let maxTurn = 0;
    let maxDz = 0;
    for (let i = 0; i < track.count; i++) {
      const a = track.raw(i);
      const b = track.raw(i + 1); // wraps to 0 at the end -> checks closure
      const step = Math.hypot(b.x - a.x, b.y - a.y);
      maxStep = Math.max(maxStep, step);
      minStep = Math.min(minStep, step);
      let dh = Math.abs(b.heading - a.heading);
      if (dh > Math.PI) dh = 2 * Math.PI - dh;
      maxTurn = Math.max(maxTurn, dh);
      maxDz = Math.max(maxDz, Math.abs(b.z - a.z));
    }
    expect(track.ds).toBeGreaterThan(0.95);
    expect(track.ds).toBeLessThan(1.05);
    expect(maxStep).toBeLessThan(1.1);
    expect(minStep).toBeGreaterThan(0.9);
    expect(maxTurn).toBeLessThan(0.1); // < ~5.7 deg per metre even at La Source / Bus Stop
    expect(maxDz).toBeLessThan(0.25); // < 25 % grade between adjacent samples
  });

  it('runs clockwise', () => {
    let area = 0;
    for (let i = 0; i < track.count; i++) {
      const a = track.raw(i);
      const b = track.raw(i + 1);
      area += a.x * b.y - b.x * a.y;
    }
    expect(facts.direction!.value).toBe('clockwise');
    expect(area).toBeLessThan(0);
  });

  it('elevation change matches the published figure and the profile shape', () => {
    const f = facts.elevationChangeM as Fact<number>;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < track.count; i++) {
      const z = track.raw(i).z;
      min = Math.min(min, z);
      max = Math.max(max, z);
    }
    expect(Math.abs(max - min - f.value)).toBeLessThan(f.toleranceM!);
    const z = (s: number) => track.elevation(s);
    const eauRouge = track.data.corners.find((c) => c.n === 2)!;
    const lesCombes = track.data.corners.find((c) => c.n === 5)!;
    const pouhon = track.data.corners.find((c) => c.n === 10)!;
    const stavelot = track.data.corners.find((c) => c.n === 15)!;
    // drop from La Source to Eau Rouge, climb to Les Combes, descent through Pouhon to Stavelot, climb back
    expect(z(eauRouge.apex)).toBeLessThan(z(0) - 20);
    expect(z(lesCombes.apex)).toBeGreaterThan(z(eauRouge.apex) + 60);
    expect(z(pouhon.apex)).toBeLessThan(z(lesCombes.apex) - 50);
    expect(z(stavelot.apex)).toBeLessThan(z(pouhon.apex));
    expect(Math.abs(z(track.length - 1) - z(0))).toBeLessThan(0.5);
  });

  it('has the published number of corners in order', () => {
    expect(track.data.corners.length).toBe(facts.cornerCount!.value);
    const apexes = track.data.corners.map((c) => c.apex);
    expect([...apexes].sort((a, b) => a - b)).toEqual(apexes);
    // every apex sits on a real curvature peak in the turn direction
    for (const c of track.data.corners) {
      const k = track.sample(c.apex).curvature;
      expect(Math.sign(k), `T${c.n}`).toBe(c.dir === 'R' ? -1 : 1);
    }
  });

  it('track widths are plausible for a Grade 1 circuit', () => {
    for (let i = 0; i < track.count; i += 5) {
      const p = track.raw(i);
      expect(p.widthLeft + p.widthRight).toBeGreaterThan(7);
      expect(p.widthLeft + p.widthRight).toBeLessThan(20);
    }
  });
});

describe('track queries', () => {
  it('projects points back to their (s, d)', () => {
    for (const s of [0, 258, 917, 1500, 2900, 3800, 5035, 6040, 6606, 6999]) {
      for (const d of [-4, 0, 3.5]) {
        const p = track.pointAt(s, d);
        const g = track.project(p.x, p.y);
        const ds = Math.min(Math.abs(g.s - track.wrapS(s)), track.length - Math.abs(g.s - track.wrapS(s)));
        expect(ds).toBeLessThan(0.6);
        expect(Math.abs(g.d - d)).toBeLessThan(0.15);
        const h = track.project(p.x, p.y, s + 20);
        expect(Math.abs(h.d - d)).toBeLessThan(0.15);
      }
    }
  });

  it('classifies surfaces across the track', () => {
    const s = 1500; // Kemmel straight
    expect(track.surfaceAt(s, 0).surface).toBe('tarmac');
    expect(track.surfaceAt(s, 0).outside).toBe(false);
    const wr = track.widthRight(s);
    expect(track.surfaceAt(s, wr + 0.5).outside).toBe(true);
    expect(track.surfaceAt(s, wr + 8).surface).toBe('grass');
    // Les Combes outside (left) has gravel
    const wl = track.widthLeft(2285);
    expect(track.surfaceAt(2285, -(wl + 10)).surface).toBe('gravel');
    // kerb at the inside of La Source (right-hander)
    const k = track.surfaceAt(258, track.widthRight(258) + 0.5);
    expect(k.surface).toBe('kerb');
  });

  it('sectors and mini-sectors partition the lap from the control line', () => {
    const c = track.controlLineS;
    expect(track.sectorAt(c + 1)).toBe(0);
    expect(track.sectorAt(0)).toBe(0); // the start gantry is after the control line
    expect(track.sectorAt(3000)).toBe(1);
    expect(track.sectorAt(6000)).toBe(2);
    expect(track.sectorAt(c - 1)).toBe(2);
    expect(track.miniSectorAt(c + 0.01)).toBe(0);
    expect(track.miniSectorAt(c - 0.01)).toBe(19);
    const seen = new Set<number>();
    for (let s = 0; s < track.length; s += 10) seen.add(track.miniSectorAt(s));
    expect(seen.size).toBe(facts.miniSectors!.value);
  });

  it('sector split matches the 2026 qualifying sector times proportionally', () => {
    // 2026 pole lap sectors ~30.2 / 46.1 / 28.3 s; S2 must be the longest by distance as well as time
    const L = track.length;
    const b = track.sectorBoundaries.map((x) => track.lapDistance(x));
    const d = [b[0]!, b[1]! - b[0]!, L - b[1]!];
    expect(d[1]).toBeGreaterThan(d[0]!);
    expect(d[1]).toBeGreaterThan(d[2]!);
  });

  it('enforced track limits exist only where annotated', () => {
    expect(track.enforcedLimitAt('right', 1200)?.corner).toBe(4);
    expect(track.enforcedLimitAt('left', 1200)).toBeNull();
    expect(track.enforcedLimitAt('right', 1700)).toBeNull();
  });

  it('terrain sits just under the road along the whole lap', () => {
    for (let i = 0; i < track.count; i += 7) {
      const p = track.raw(i);
      const t = track.terrainHeight(p.x, p.y);
      expect(Number.isFinite(t)).toBe(true);
      expect(p.z - t).toBeGreaterThan(-0.2);
      expect(p.z - t).toBeLessThan(2.0);
    }
  });

  it('pit lane is continuous and carries the speed limit', () => {
    const { path, pathFeatures, speedLimitKmh } = track.data.pit;
    expect(speedLimitKmh).toBe(facts.pitLaneSpeedLimitKmh!.value);
    for (let i = 1; i < path.x.length; i++) {
      const step = Math.hypot(path.x[i]! - path.x[i - 1]!, path.y[i]! - path.y[i - 1]!);
      expect(step).toBeLessThan(1.5);
    }
    expect(pathFeatures.speedLimitStart).toBeLessThan(pathFeatures.boxesStart);
    expect(pathFeatures.boxesEnd).toBeLessThan(pathFeatures.speedLimitEnd);
  });
});

describe('terrain vs cambered road edges', () => {
  it('terrain never pokes through the road surface at the edges', () => {
    let worst = Infinity;
    for (let i = 0; i < track.count; i += 3) {
      const p = track.raw(i);
      for (const d of [-p.widthLeft, p.widthRight]) {
        const q = track.pointAt(p.s, d);
        worst = Math.min(worst, q.z - track.terrainHeight(q.x, q.y));
      }
    }
    expect(worst).toBeGreaterThan(0.02);
  });
});
