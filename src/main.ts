import './style.css';
import { loadTrack } from './track/load';
import { TrackViewer } from './render/TrackViewer';
import { isQualityPreset } from './render/quality';
import { mountViewerHud } from './ui/viewerHud';
import { CAR_2026, makeEnv } from './physics/data';
import { DriveSession } from './game/DriveSession';
import { createBrowserInput } from './input/browser';
import type { InputManager } from './input/InputManager';
import { ControlsMenu } from './ui/controlsMenu';
import { DriveController } from './render/DriveController';
import { mountDriveHud } from './ui/driveHud';

declare global {
  interface Window {
    __spa?: {
      ready: boolean;
      viewer: TrackViewer;
      placeFly: (s: number, opts?: { height?: number; back?: number; lateral?: number }) => void;
      session?: DriveSession;
      input?: InputManager;
      controls?: ControlsMenu;
      bench?: { frames: number; p50: number; p95: number; p99: number; avgFps: number; cpuMs: number; gpu: string; dpr: number; size: string };
    };
  }
}

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const qp = params.get('quality');
  const quality = isQualityPreset(qp) ? qp : 'high';
  const weather = params.get('weather') === 'overcast' ? 'overcast' : 'sunny';
  const track = await loadTrack();
  const app = document.getElementById('app')!;
  const viewer = new TrackViewer(track, app, quality, weather, { preserveDrawingBuffer: params.get('static') === '1' });
  if (params.get('hud') !== '0') mountViewerHud(viewer);
  // drive the 2026 car from the grid: keyboard, gamepads and wheels (hot-pluggable, rebindable)
  const input = createBrowserInput();
  const session = new DriveSession(CAR_2026, makeEnv(track), track.wrapS(track.startLineS - 12));
  const drive = new DriveController(session, input, viewer.scene, viewer.wm);
  viewer.drive = drive;
  const controls = new ControlsMenu(input);
  controls.onToggle = (open) => {
    drive.paused = open;
    if (open && viewer.mode !== 'drive') viewer.setMode('drive');
  };
  drive.onMenu = () => controls.toggle();
  const driveHud = params.get('hud') !== '0' ? mountDriveHud(session, () => viewer.drive?.cameraMode ?? '', input) : null;
  const prevOnFrame = viewer.onFrame;
  viewer.onFrame = (v) => {
    prevOnFrame?.(v);
    controls.update();
    if (driveHud) driveHud.root.style.display = v.mode === 'drive' ? '' : 'none';
    if (v.mode === 'drive') driveHud?.update();
  };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Enter' || e.code === 'KeyG') viewer.setMode('drive');
  });
  const mode = params.get('mode');
  if (mode !== 'fly' && params.get('bench') !== '1' && params.get('static') !== '1') viewer.setMode('drive');
  window.__spa = {
    ready: true,
    viewer,
    session,
    input,
    controls,
    placeFly: (s, o = {}) => {
      viewer.setMode('fly-around');
      viewer.paused = true;
      viewer.fly.height = o.height ?? 4.5;
      viewer.fly.back = o.back ?? 18;
      viewer.fly.lateral = o.lateral ?? 0;
      viewer.fly.place(s);
      viewer.renderOnce();
    },
  };
  if (params.get('bench') === '1') {
    runBenchmark(viewer);
  } else if (params.get('static') !== '1') {
    viewer.start();
  }
}

/** Fly one lap at 80 m/s and report frame-time percentiles (window.__spa.bench + console). */
function runBenchmark(viewer: TrackViewer): void {
  viewer.fly.speed = 80;
  const times: number[] = [];
  const cpu: number[] = [];
  let last = performance.now();
  let travelled = 0;
  const step = (t: number) => {
    const dt = (t - last) / 1000;
    last = t;
    if (times.length > 5) travelled += viewer.fly.speed * dt;
    viewer.frame(t);
    times.push(dt * 1000);
    cpu.push(viewer.cpuMs);
    if (travelled < viewer.track.length) {
      requestAnimationFrame(step);
      return;
    }
    const sorted = times.slice(5).sort((a, b) => a - b);
    const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const cpuMs = cpu.reduce((a, b) => a + b, 0) / Math.max(1, cpu.length);
    const c = viewer.renderer.domElement;
    const size = `${c.width}x${c.height}`;
    const dpr = viewer.renderer.getPixelRatio();
    window.__spa!.bench = { frames: sorted.length, p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), avgFps: 1000 / avg, cpuMs, gpu: viewer.gpuName, dpr, size };
    console.info('[bench]', JSON.stringify(window.__spa!.bench));
    const div = document.createElement('div');
    div.id = 'bench-result';
    div.textContent =
      `Benchmark (${viewer.quality}): avg ${(1000 / avg).toFixed(1)} fps, p50 ${pct(0.5).toFixed(2)} ms, p95 ${pct(0.95).toFixed(2)} ms, ` +
      `p99 ${pct(0.99).toFixed(2)} ms over ${sorted.length} frames | cpu ${cpuMs.toFixed(2)} ms/frame | ${size} @ ${dpr} | GPU: ${viewer.gpuName}`;
    document.body.appendChild(div);
  };
  requestAnimationFrame(step);
}

boot().catch((e: unknown) => {
  const div = document.createElement('pre');
  div.id = 'fatal';
  div.textContent = `Failed to start: ${e instanceof Error ? e.stack ?? e.message : String(e)}`;
  document.body.appendChild(div);
  console.error(e);
});
