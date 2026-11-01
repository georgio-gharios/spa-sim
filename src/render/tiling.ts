/**
 * Spatial tiling so three.js can frustum-cull (main and shadow passes). A whole-lap mesh has a bounding
 * sphere covering the site and is always drawn; tiles of ~TILE m are culled individually.
 */
import { BufferAttribute, BufferGeometry, Group, Matrix4, Mesh, type Material, type TypedArray } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const TILE = 250;

/** Split an indexed geometry into per-tile geometries by triangle centroid on the XZ plane. */
export function splitByTiles(geo: BufferGeometry, tile = TILE): BufferGeometry[] {
  const index = geo.getIndex();
  if (!index) throw new Error('splitByTiles: indexed geometry expected');
  const pos = geo.getAttribute('position');
  const buckets = new Map<string, number[]>();
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t);
    const b = index.getX(t + 1);
    const c = index.getX(t + 2);
    const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
    const cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
    const key = `${Math.floor(cx / tile)},${Math.floor(cz / tile)}`;
    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    list.push(a, b, c);
  }
  const names = Object.keys(geo.attributes);
  const out: BufferGeometry[] = [];
  for (const tris of buckets.values()) {
    const remap = new Map<number, number>();
    const newIndex: number[] = [];
    for (const v of tris) {
      let n = remap.get(v);
      if (n === undefined) remap.set(v, (n = remap.size));
      newIndex.push(n);
    }
    const g = new BufferGeometry();
    for (const name of names) {
      const src = geo.getAttribute(name) as BufferAttribute;
      const size = src.itemSize;
      const arr = new (src.array.constructor as new (n: number) => TypedArray)(remap.size * size);
      for (const [oldI, newI] of remap) {
        for (let k = 0; k < size; k++) arr[newI * size + k] = src.array[oldI * size + k]!;
      }
      g.setAttribute(name, new BufferAttribute(arr, size, src.normalized));
    }
    g.setIndex(remap.size > 65535 ? new BufferAttribute(new Uint32Array(newIndex), 1) : new BufferAttribute(new Uint16Array(newIndex), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    out.push(g);
  }
  return out;
}

export function tileKey(x: number, z: number, tile = TILE): string {
  return `${Math.floor(x / tile)},${Math.floor(z / tile)}`;
}

/**
 * Merge all static meshes in a group that share a material (baking their transforms), then re-tile.
 * Meshes with a name in `keep` (e.g. start lights that are animated later) stay separate.
 */
export function mergeStaticByMaterial(group: Group, keep: (m: Mesh) => boolean = () => false): Group {
  group.updateMatrixWorld(true);
  const byMat = new Map<Material, { geos: BufferGeometry[]; cast: boolean; receive: boolean }>();
  const out = new Group();
  out.name = group.name;
  group.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    if (keep(m) || Array.isArray(m.material)) {
      const c = m.clone();
      c.applyMatrix4(m.parent?.matrixWorld ?? new Matrix4());
      out.add(c);
      return;
    }
    const mat = m.material;
    let e = byMat.get(mat);
    if (!e) byMat.set(mat, (e = { geos: [], cast: false, receive: false }));
    const g = m.geometry.index ? m.geometry.clone() : m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    // keep only attributes common to all (position/normal/uv)
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (!g.index) {
      const idx = new Uint32Array(g.getAttribute('position').count);
      for (let i = 0; i < idx.length; i++) idx[i] = i;
      g.setIndex(new BufferAttribute(idx, 1));
    }
    e.geos.push(g);
    e.cast ||= m.castShadow;
    e.receive ||= m.receiveShadow;
  });
  for (const [mat, e] of byMat) {
    const merged = mergeGeometries(e.geos, false);
    if (!merged) throw new Error('mergeStaticByMaterial: incompatible geometries');
    for (const g of splitByTiles(merged)) {
      const m = new Mesh(g, mat);
      m.castShadow = e.cast;
      m.receiveShadow = e.receive;
      out.add(m);
    }
  }
  return out;
}
