import { ACESFilmicToneMapping, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer, type Group } from 'three';
import type { TrackModel } from '../track/TrackModel';
import type { DriveController } from './DriveController';
import { FlyAround } from './cameras/FlyAround';
import { FreeCamera } from './cameras/FreeCamera';
import { LightingRig, type WeatherPreset } from './lighting';
import { QUALITY, type QualityPreset, type QualitySettings } from './quality';
import { buildForest, buildStructures, buildTerrain } from './scenery';
import type { WorldMap } from './track/geometry';
import { buildTrackScene } from './track/trackScene';

export type CameraMode = 'fly-around' | 'free' | 'drive';

export interface FrameStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
}

/** Phase 1 track viewer: builds the circuit scene and drives free / fly-around cameras. */
export class TrackViewer {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGLRenderer;
  readonly wm: WorldMap;
  readonly lighting: LightingRig;
  readonly fly: FlyAround;
  readonly free: FreeCamera;
  mode: CameraMode = 'fly-around';
  paused = false;
  quality: QualityPreset;
  private settings: QualitySettings;
  private forest: Group | null = null;
  private last = performance.now();
  private frameTimes: number[] = [];
  private stats: FrameStats = { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0 };
  onFrame: ((v: TrackViewer) => void) | null = null;
  drive: DriveController | null = null;
  /** Smoothed CPU time spent submitting a frame (scene traversal + WebGL calls), ms. */
  cpuMs = 0;

  constructor(
    readonly track: TrackModel,
    readonly container: HTMLElement,
    quality: QualityPreset,
    weather: WeatherPreset,
    opts: { preserveDrawingBuffer?: boolean } = {},
  ) {
    this.quality = quality;
    this.settings = QUALITY[quality];
    this.wm = { baseZ: Math.round(track.raw(0).z) };
    this.renderer = new WebGLRenderer({ antialias: this.settings.antialias, powerPreference: 'high-performance',
      // only needed for canvas read-back in tests; it costs a buffer copy every frame otherwise
      preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.settings.pixelRatioCap));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);
    this.camera = new PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, this.settings.drawDistance * 1.2);
    this.lighting = new LightingRig(this.scene, this.renderer);
    this.lighting.configureShadows(this.settings.shadows, this.settings.shadowMapSize, this.settings.shadowDistance);
    this.lighting.setWeather(weather, this.settings.drawDistance);

    this.scene.add(buildTrackScene(track, this.wm, { anisotropy: this.settings.anisotropy, catchFence: this.settings.catchFence }));
    this.scene.add(buildTerrain(track, this.wm, this.settings.anisotropy));
    this.scene.add(buildStructures(track, this.wm));
    this.rebuildForest();

    this.fly = new FlyAround(track, this.wm, this.camera);
    this.free = new FreeCamera(this.camera, this.renderer.domElement);
    this.fly.place(0);
    window.addEventListener('resize', () => this.resize());
  }

  private rebuildForest(): void {
    if (this.forest) {
      this.scene.remove(this.forest);
      this.forest.traverse((o) => (o as { geometry?: { dispose(): void } }).geometry?.dispose());
    }
    this.forest = buildForest(this.track, this.wm, { maxTrees: this.settings.trees, castShadow: this.settings.treeShadows && this.settings.shadows });
    this.scene.add(this.forest);
  }

  get treeCount(): number {
    return (this.forest?.userData.count as number | undefined) ?? 0;
  }

  setQuality(q: QualityPreset): void {
    this.quality = q;
    this.settings = QUALITY[q];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.settings.pixelRatioCap));
    this.lighting.configureShadows(this.settings.shadows, this.settings.shadowMapSize, this.settings.shadowDistance);
    this.lighting.setWeather(this.lighting.weather, this.settings.drawDistance);
    this.camera.far = this.settings.drawDistance * 1.2;
    this.camera.updateProjectionMatrix();
    this.rebuildForest();
  }

  setWeather(w: WeatherPreset): void {
    this.lighting.setWeather(w, this.settings.drawDistance);
  }

  setMode(m: CameraMode): void {
    this.mode = m;
    this.free.enabled = m === 'free';
    if (m !== 'drive') {
      this.camera.fov = 60;
      this.camera.near = 0.1;
      this.camera.updateProjectionMatrix();
    }
    if (m === 'fly-around') {
      // continue from the nearest point on the lap
      const p = this.track.project(this.camera.position.x, -this.camera.position.z);
      this.fly.place(p.s);
    }
  }

  resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  /** GPU name as reported by the browser (helps spot laptops rendering on the integrated GPU). */
  get gpuName(): string {
    const gl = this.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  }

  private cullForest(): void {
    if (!this.forest) return;
    const max2 = this.settings.treeDistance * this.settings.treeDistance;
    const c = this.camera.position;
    for (const m of this.forest.children) {
      const sph = (m as { boundingSphere?: { center: { x: number; z: number }; radius: number } | null }).boundingSphere;
      if (!sph) continue;
      const dx = sph.center.x - c.x;
      const dz = sph.center.z - c.z;
      const d = Math.max(0, Math.hypot(dx, dz) - sph.radius);
      m.visible = d * d < max2;
    }
  }

  renderOnce(): void {
    this.cullForest();
    this.lighting.follow(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }

  frame(now: number): void {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.paused) {
      if (this.mode === 'fly-around') this.fly.update(dt);
      else if (this.mode === 'drive' && this.drive) this.drive.update(dt, this.camera);
      else this.free.update(dt);
    }
    const t0 = performance.now();
    this.renderOnce();
    this.cpuMs = this.cpuMs * 0.95 + (performance.now() - t0) * 0.05;
    this.frameTimes.push(dt * 1000);
    if (this.frameTimes.length > 120) this.frameTimes.shift();
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    const info = this.renderer.info.render;
    this.stats = { fps: 1000 / avg, frameMs: avg, drawCalls: info.calls, triangles: info.triangles };
    this.onFrame?.(this);
  }

  getStats(): FrameStats {
    return this.stats;
  }

  start(): void {
    const loop = (t: number) => {
      this.frame(t);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}
