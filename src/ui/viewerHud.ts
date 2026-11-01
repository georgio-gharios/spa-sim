import type { TrackViewer } from '../render/TrackViewer';
import { isQualityPreset } from '../render/quality';

/** Minimal overlay for the Phase 1 track viewer. */
export function mountViewerHud(v: TrackViewer): void {
  const el = document.createElement('div');
  el.id = 'hud';
  el.innerHTML = `
    <div class="title">SPA 2026 — track viewer</div>
    <div id="hud-stats"></div>
    <div id="hud-pos"></div>
    <label>Quality <select id="hud-quality">
      <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="ultra">Ultra</option>
    </select></label>
    <label>Weather <select id="hud-weather"><option value="sunny">Sunny</option><option value="overcast">Overcast</option></select></label>
    <div class="keys">F fly-around · C free camera (WASD/QE, drag to look, wheel = speed) · Space pause</div>`;
  document.body.appendChild(el);
  const q = el.querySelector<HTMLSelectElement>('#hud-quality')!;
  const w = el.querySelector<HTMLSelectElement>('#hud-weather')!;
  q.value = v.quality;
  w.value = v.lighting.weather;
  q.addEventListener('change', () => {
    if (isQualityPreset(q.value)) v.setQuality(q.value);
    q.blur();
  });
  w.addEventListener('change', () => {
    v.setWeather(w.value === 'overcast' ? 'overcast' : 'sunny');
    w.blur();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyF') v.setMode('fly-around');
    if (e.code === 'KeyC') v.setMode('free');
    if (e.code === 'Space') v.paused = !v.paused;
  });
  const stats = el.querySelector<HTMLDivElement>('#hud-stats')!;
  const pos = el.querySelector<HTMLDivElement>('#hud-pos')!;
  let n = 0;
  v.onFrame = () => {
    if (n++ % 10) return;
    const s = v.getStats();
    stats.textContent = `${s.fps.toFixed(0)} fps · ${s.frameMs.toFixed(1)} ms · ${s.drawCalls} draws · ${(s.triangles / 1e6).toFixed(2)} M tris · ${v.treeCount} trees`;
    const p = v.track.project(v.camera.position.x, -v.camera.position.z);
    const c = v.track.cornerAt(p.s);
    pos.textContent = `s ${p.s.toFixed(0)} m · S${v.track.sectorAt(p.s) + 1} · mini ${v.track.miniSectorAt(p.s) + 1} · ${c ? `T${c.n} ${c.name}` : '—'} · ${v.track.elevation(p.s).toFixed(1)} m ASL · ${v.mode}`;
  };
}
