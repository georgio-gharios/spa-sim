import { DoubleSide, Group, Mesh, MeshStandardMaterial } from 'three';
import type { TrackModel } from '../../track/TrackModel';
import { splitByTiles } from '../tiling';
import {
  armcoTexture,
  asphaltTexture,
  chequerTexture,
  concreteTexture,
  fenceTexture,
  gravelTexture,
  kerbTexture,
  runoffTarmacTexture,
  sausageTexture,
  tecproTexture,
  tyreWallTexture,
  grassTexture,
} from '../textures';
import { buildBarriers, buildCrossLine, buildEdgeLines, buildKerbs, buildPitLane, buildRoad, buildRunoff, GeoBuilder, type WorldMap } from './geometry';

export interface TrackSceneOptions {
  anisotropy: number;
  catchFence: boolean;
}

/** Assemble all circuit-surface meshes (road, lines, kerbs, runoff, barriers, fencing, pit lane). */
export function buildTrackScene(track: TrackModel, wm: WorldMap, opts: TrackSceneOptions): Group {
  const group = new Group();
  group.name = 'track';
  const add = (g: GeoBuilder, mat: MeshStandardMaterial, name: string, shadows = { cast: false, receive: true }) => {
    if (!g.vertexCount) return;
    // one mesh per spatial tile so the main and shadow passes can frustum-cull
    for (const geo of splitByTiles(g.build())) {
      const m = new Mesh(geo, mat);
      m.name = name;
      m.castShadow = shadows.cast;
      m.receiveShadow = shadows.receive;
      group.add(m);
    }
  };
  const a = opts.anisotropy;

  add(buildRoad(track, wm), new MeshStandardMaterial({ map: asphaltTexture(a), roughness: 0.92, metalness: 0 }), 'road');

  const lineMat = new MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  add(buildEdgeLines(track, wm), lineMat, 'white-lines');

  const timing = buildCrossLine(track, wm, 0, 0.6);
  add(timing, new MeshStandardMaterial({ map: chequerTexture(), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), 'timing-line');
  const sectorLines = new GeoBuilder();
  for (const b of track.sectorBoundaries) buildCrossLine(track, wm, b, 0.3, sectorLines);
  add(sectorLines, lineMat, 'sector-lines');

  const kerbs = buildKerbs(track, wm);
  add(kerbs.painted, new MeshStandardMaterial({ map: kerbTexture(), roughness: 0.55 }), 'kerbs', { cast: false, receive: true });
  add(kerbs.sausage, new MeshStandardMaterial({ map: sausageTexture(), roughness: 0.5 }), 'sausage-kerbs', { cast: true, receive: true });

  const runoff = buildRunoff(track, wm);
  add(runoff.tarmac, new MeshStandardMaterial({ map: runoffTarmacTexture(a), roughness: 0.9 }), 'runoff-tarmac');
  add(runoff.gravel, new MeshStandardMaterial({ map: gravelTexture(a), roughness: 1 }), 'runoff-gravel');
  add(runoff.grass, new MeshStandardMaterial({ map: grassTexture(a), roughness: 1, color: 0xb8d8a0 }), 'runoff-grass');

  const barriers = buildBarriers(track, wm);
  const wallMat = (map: ReturnType<typeof armcoTexture>, metal = 0) => new MeshStandardMaterial({ map, roughness: metal ? 0.35 : 0.8, metalness: metal, side: DoubleSide });
  add(barriers.walls.armco, wallMat(armcoTexture(), 0.7), 'armco', { cast: true, receive: true });
  add(barriers.walls.tyres, wallMat(tyreWallTexture()), 'tyre-walls', { cast: true, receive: true });
  add(barriers.walls.tecpro, wallMat(tecproTexture()), 'tecpro', { cast: true, receive: true });
  add(barriers.walls.concrete, wallMat(concreteTexture(false)), 'concrete', { cast: true, receive: true });
  add(barriers.walls.pitwall, wallMat(concreteTexture(true)), 'pit-wall', { cast: true, receive: true });
  if (opts.catchFence) {
    add(barriers.fence, new MeshStandardMaterial({ map: fenceTexture(), transparent: false, alphaTest: 0.4, side: DoubleSide, roughness: 0.5, metalness: 0.4 }), 'catch-fence');
  }

  const pit = buildPitLane(track, wm);
  add(pit.surface, new MeshStandardMaterial({ map: asphaltTexture(a), roughness: 0.85, color: 0xd0d0d0 }), 'pit-lane');
  add(pit.lines, lineMat, 'pit-lines');
  return group;
}
