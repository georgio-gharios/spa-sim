import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TrackModel } from '../../src/track/TrackModel';
import type { TrackData } from '../../src/track/types';

const root = fileURLToPath(new URL('../../', import.meta.url));
let cached: TrackModel | null = null;

/** Node loader for tests and headless tools. */
export function loadTrackNode(): TrackModel {
  if (cached) return cached;
  const data = JSON.parse(readFileSync(`${root}data/track/spa-2026.json`, 'utf8')) as TrackData;
  const bin = readFileSync(`${root}data/track/terrain.bin`);
  const terrain = new Float32Array(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
  cached = new TrackModel(data, terrain);
  return cached;
}

export function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(`${root}${rel}`, 'utf8')) as T;
}
