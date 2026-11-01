/** Shape of data/track/spa-2026.json (format "spa-track/1"), produced by tools/track/build_track.py. */

export type Side = 'left' | 'right';
export type Surface = 'tarmac' | 'kerb' | 'grass' | 'gravel' | 'pitlane' | 'wall';
export type RunoffSurface = 'tarmac' | 'grass' | 'gravel';
export type KerbType = 'flat' | 'standard' | 'sausage';
export type BarrierType = 'armco' | 'tyres' | 'tecpro' | 'concrete' | 'pitwall' | 'none';

export interface CornerDef {
  n: number;
  name: string;
  dir: 'L' | 'R';
  apex: number;
  s0: number;
  s1: number;
}

export interface KerbDef {
  corner: number | null;
  side: Side;
  s0: number;
  s1: number;
  type: KerbType;
  width: number;
  /** Distance outward from the white line where the kerb starts. */
  offset: number;
}

export interface RunoffLayer {
  surface: RunoffSurface;
  width: number;
}

export interface RunoffZone {
  side: Side;
  s0: number;
  s1: number;
  layers: RunoffLayer[];
  note?: string;
}

export interface BarrierZone {
  side: Side;
  s0: number;
  s1: number;
  type: BarrierType;
  note?: string;
}

export interface TrackLimitDef {
  corner: number;
  side: Side;
  s0: number;
  s1: number;
}

export interface PitDef {
  entryS: number;
  laneOffset: number;
  laneWidth: number;
  speedLimitStartS: number;
  speedLimitEndS: number;
  boxesS0: number;
  boxesS1: number;
  boxCount: number;
  mergeS: number;
  exitLine: { side: Side; s0: number; s1: number };
  speedLimitKmh: number;
  pathFeatures: {
    speedLimitStart: number;
    speedLimitEnd: number;
    boxesStart: number;
    boxesEnd: number;
    exitLineStart: number;
    exitLineEnd: number;
  };
  /** Pit-lane centre line at ~1 m; w = lane width per point (m). */
  path: { x: number[]; y: number[]; z: number[]; w?: number[] };
}

export interface TerrainDef {
  file: string;
  x0: number;
  y0: number;
  cell: number;
  nx: number;
  ny: number;
}

export interface TrackData {
  format: 'spa-track/1';
  name: string;
  configuration: string;
  direction: 'clockwise' | 'counterclockwise';
  sources: Record<string, string>;
  frame: { description: string; originLat: number; originLon: number };
  length: number;
  nominalLength: number;
  count: number;
  ds: number;
  x: number[];
  y: number[];
  z: number[];
  heading: number[];
  curvature: number[];
  camberDeg: number[];
  widthLeft: number[];
  widthRight: number[];
  corners: CornerDef[];
  sectors: { boundaries: number[]; miniSectorCount: number };
  kerbs: KerbDef[];
  runoff: { default: RunoffLayer[]; zones: RunoffZone[] };
  barriers: { default: BarrierType; zones: BarrierZone[] };
  trackLimits: TrackLimitDef[];
  pit: PitDef;
  terrain: TerrainDef;
}
