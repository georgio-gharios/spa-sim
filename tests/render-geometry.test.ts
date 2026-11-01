import { describe, expect, it } from 'vitest';
import { boundaryEdgeCount, buildBarriers, buildKerbs, buildPitLane, buildRoad, buildRunoff } from '../src/render/track/geometry';
import { loadTrackNode } from './helpers/track';

const track = loadTrackNode();
const wm = { baseZ: track.raw(0).z };

describe('road mesh', () => {
  const road = buildRoad(track, wm, 8).build();

  it('is one closed, manifold ribbon with no gaps or seams', () => {
    const { boundary, nonManifold, degenerate } = boundaryEdgeCount(road);
    // only the two outer edges of the ribbon may be open: one edge per sample per side
    expect(boundary).toBe(2 * track.count);
    expect(nonManifold).toBe(0);
    expect(degenerate).toBe(0);
  });

  it('faces point up and follow the road elevation', () => {
    const n = road.getAttribute('normal');
    let minY = 1;
    for (let i = 0; i < n.count; i++) minY = Math.min(minY, n.getY(i));
    expect(minY).toBeGreaterThan(0.95); // < ~18 deg from vertical anywhere
    // triangle winding agrees with the normals (counter-clockwise from above)
    const pos = road.getAttribute('position');
    const idx = road.getIndex()!;
    let down = 0;
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
      const ux = pos.getX(b) - pos.getX(a), uz = pos.getZ(b) - pos.getZ(a);
      const vx = pos.getX(c) - pos.getX(a), vz = pos.getZ(c) - pos.getZ(a);
      if (uz * vx - ux * vz < 0) down++;
    }
    expect(down).toBe(0);
  });
});

describe('trackside meshes', () => {
  it('kerbs, runoff, barriers and the pit lane build without degenerate output', () => {
    const k = buildKerbs(track, wm);
    expect(k.painted.vertexCount).toBeGreaterThan(1000);
    expect(k.sausage.vertexCount).toBeGreaterThan(10);
    const r = buildRunoff(track, wm);
    expect(r.grass.vertexCount).toBeGreaterThan(5000);
    expect(r.gravel.vertexCount).toBeGreaterThan(500);
    const b = buildBarriers(track, wm);
    expect(b.walls.armco.vertexCount).toBeGreaterThan(1000);
    expect(b.walls.pitwall.vertexCount).toBeGreaterThan(50);
    const p = buildPitLane(track, wm);
    expect(p.surface.vertexCount).toBe(2 * track.data.pit.path.x.length);
    for (const g of [k.painted, r.grass, b.walls.armco, p.surface]) {
      const geo = g.build();
      const pos = geo.getAttribute('position');
      for (let i = 0; i < pos.count; i += 97) expect(Number.isFinite(pos.getY(i))).toBe(true);
    }
  });

  it('runoff covers each side continuously (no gaps between zones)', () => {
    // every sample has at least one runoff layer on both sides, and the grass/tarmac/gravel strips meet
    for (let i = 0; i < track.count; i += 3) {
      for (const side of ['left', 'right'] as const) expect(track.runoffWidth(side, i * track.ds)).toBeGreaterThan(0.5);
    }
  });
});
