import './style.css';
import { loadTrack } from './track/load';
import { TrackViewer } from './render/TrackViewer';
import { isQualityPreset } from './render/quality';
import { mountViewerHud } from './ui/viewerHud';

declare global {
  interface Window {
    __spa?: {
      ready: boolean;
      viewer: TrackViewer;
      placeFly: (s: number, opts?: { height?: number; back?: number; lateral?: number }) => void;
      bench?: { frames: number; p50: number; p95: number; p99: number; avgFps: number };
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
  const viewer = new TrackViewer(track, app, quality, weather);
  if (params.get('hud') !== '0') mountViewerHud(viewer);
  window.__spa = {
    ready: true,
    viewer,
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
  let last = performance.now();
  let travelled = 0;
  const step = (t: number) => {
    const dt = (t - last) / 1000;
    last = t;
    if (times.length > 5) travelled += viewer.fly.speed * dt;
    viewer.frame(t);
    times.push(dt * 1000);
    if (travelled < viewer.track.length) {
      requestAnimationFrame(step);
      return;
    }
    const sorted = times.slice(5).sort((a, b) => a - b);
    const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    window.__spa!.bench = { frames: sorted.length, p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), avgFps: 1000 / avg };
    console.info('[bench]', JSON.stringify(window.__spa!.bench));
    const div = document.createElement('div');
    div.id = 'bench-result';
    div.textContent = `Benchmark (${viewer.quality}): avg ${(1000 / avg).toFixed(1)} fps, p50 ${pct(0.5).toFixed(2)} ms, p95 ${pct(0.95).toFixed(2)} ms, p99 ${pct(0.99).toFixed(2)} ms over ${sorted.length} frames`;
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
