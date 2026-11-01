import trackJson from '../../data/track/spa-2026.json';
import terrainUrl from '../../data/track/terrain.bin?url';
import { TrackModel } from './TrackModel';
import type { TrackData } from './types';

/** Browser loader: track JSON is bundled, the terrain heightfield is fetched as a binary asset. */
export async function loadTrack(): Promise<TrackModel> {
  const res = await fetch(terrainUrl);
  if (!res.ok) throw new Error(`terrain fetch failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  return new TrackModel(trackJson as unknown as TrackData, new Float32Array(buf));
}
