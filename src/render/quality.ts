export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';

export interface QualitySettings {
  pixelRatioCap: number;
  antialias: boolean;
  shadows: boolean;
  shadowMapSize: number;
  shadowDistance: number;
  trees: number;
  treeShadows: boolean;
  anisotropy: number;
  catchFence: boolean;
  drawDistance: number;
  /** Forest tiles further than this from the camera are hidden (they are fog-faded anyway). */
  treeDistance: number;
}

export const QUALITY: Record<QualityPreset, QualitySettings> = {
  low: { treeDistance: 800, pixelRatioCap: 1, antialias: false, shadows: false, shadowMapSize: 512, shadowDistance: 0, trees: 8000, treeShadows: false, anisotropy: 2, catchFence: false, drawDistance: 2500 },
  medium: { treeDistance: 1300, pixelRatioCap: 1, antialias: true, shadows: true, shadowMapSize: 1024, shadowDistance: 120, trees: 20000, treeShadows: false, anisotropy: 4, catchFence: true, drawDistance: 3500 },
  high: { treeDistance: 1900, pixelRatioCap: 1.5, antialias: true, shadows: true, shadowMapSize: 2048, shadowDistance: 180, trees: 40000, treeShadows: false, anisotropy: 8, catchFence: true, drawDistance: 5000 },
  ultra: { treeDistance: 2800, pixelRatioCap: 2, antialias: true, shadows: true, shadowMapSize: 4096, shadowDistance: 260, trees: 70000, treeShadows: true, anisotropy: 16, catchFence: true, drawDistance: 6000 },
};

export function isQualityPreset(v: string | null): v is QualityPreset {
  return v === 'low' || v === 'medium' || v === 'high' || v === 'ultra';
}
