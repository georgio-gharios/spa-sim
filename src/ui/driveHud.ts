/**
 * Prototype driving HUD. Widgets for systems the car does not have (battery, active aero, overtake) are not
 * created: the HUD reads the car's capabilities, never the era.
 */
import type { DriveSession } from '../game/DriveSession';

const fmt = (t: number | null) => (t === null ? '--:--.---' : `${Math.floor(t / 60)}:${(t % 60).toFixed(3).padStart(6, '0')}`);

export function mountDriveHud(session: DriveSession, getCameraMode: () => string): { update: () => void; root: HTMLElement } {
  const caps = session.car.capabilities;
  const root = document.createElement('div');
  root.id = 'drive-hud';
  root.innerHTML = `
    <div class="dh-left">
      <div class="dh-lap"><span id="dh-cur">--</span><small>last <span id="dh-last"></span> · best <span id="dh-best"></span></small></div>
      <div class="dh-tyres" id="dh-tyres"></div>
      <div class="dh-small" id="dh-misc"></div>
    </div>
    <div class="dh-center">
      <div class="dh-lights" id="dh-lights">${'<i></i>'.repeat(10)}</div>
      <div class="dh-speed"><span id="dh-speed">0</span><small>km/h</small></div>
      <div class="dh-gear" id="dh-gear">N</div>
      <div class="dh-pedals"><div><b id="dh-thr"></b></div><div><b id="dh-brk"></b></div></div>
    </div>
    <div class="dh-right">
      ${caps.hybrid ? `<div class="dh-soc"><label>ERS</label><div class="bar"><b id="dh-soc"></b></div><span id="dh-kw"></span></div>` : ''}
      ${caps.activeAero ? `<div class="dh-badge" id="dh-aero">CORNER</div>` : ''}
      ${caps.overtakeMode ? `<div class="dh-badge dim" id="dh-ot">OVERTAKE</div>` : ''}
      <div class="dh-small" id="dh-assist"></div>
    </div>
    <div class="dh-help">W/S or ↑/↓ throttle/brake · A/D or ←/→ steer · E/Q gears (auto in Casual)${caps.activeAero ? ' · X straight mode' : ''}${caps.overtakeMode ? ' · O overtake' : ''} · P pit limiter · R reset · H assists · V camera · F fly-around · C free cam</div>`;
  document.body.appendChild(root);
  const $ = (id: string) => root.querySelector<HTMLElement>(`#${id}`);
  const lights = [...root.querySelectorAll<HTMLElement>('#dh-lights i')];
  let n = 0;
  const update = () => {
    const car = session.car;
    const t = car.telemetry();
    $('dh-speed')!.textContent = Math.max(0, t.speedKmh).toFixed(0);
    $('dh-gear')!.textContent = String(t.gear);
    $('dh-thr')!.style.height = `${t.throttle * 100}%`;
    $('dh-brk')!.style.height = `${t.brake * 100}%`;
    const pu = car.modules.powerUnit;
    const frac = Math.max(0, Math.min(1, (t.rpm - pu.downshiftRpm) / (pu.upshiftRpm - pu.downshiftRpm)));
    lights.forEach((l, i) => l.classList.toggle('on', frac * lights.length > i));
    if (n++ % 4 !== 0) return;
    $('dh-cur')!.textContent = fmt(session.timing.current || null);
    $('dh-last')!.textContent = fmt(session.timing.last);
    $('dh-best')!.textContent = fmt(session.timing.best);
    $('dh-tyres')!.innerHTML = t.wheels
      .map((w) => `<span style="background:${tyreColour(w.surfaceC)}">${w.surfaceC.toFixed(0)}°</span>`)
      .join('');
    $('dh-misc')!.textContent = `fuel ${t.fuelKg.toFixed(1)} kg · ${car.compoundId} · ${t.wheelsOutside === 4 ? 'OFF TRACK' : t.wheelsOutside > 0 ? `${t.wheelsOutside} wheels over` : 'on track'}`;
    if (caps.hybrid) {
      $('dh-soc')!.style.width = `${t.soc * 100}%`;
      $('dh-kw')!.textContent = `${t.electricKw >= 0 ? '+' : ''}${t.electricKw.toFixed(0)} kW${t.derating ? ' · DERATE' : ''}${t.superclip ? ' · CLIP' : ''}`;
    }
    if (caps.activeAero) {
      const a = $('dh-aero')!;
      a.textContent = t.aeroState === 'straight' ? 'STRAIGHT' : t.aeroState === 'corner' ? 'CORNER' : '…';
      a.classList.toggle('lit', t.aeroBlend > 0.5);
    }
    if (caps.overtakeMode) $('dh-ot')!.classList.toggle('lit', t.overtakeActive);
    $('dh-assist')!.textContent = `${session.assistsPreset.toUpperCase()} · ${getCameraMode()}${t.tcActive ? ' · TC' : ''}${t.absActive ? ' · ABS' : ''}`;
  };
  return { update, root };
}

function tyreColour(c: number): string {
  if (c < 70) return '#2c6fd6';
  if (c < 90) return '#2aa36b';
  if (c < 115) return '#c9a227';
  return '#d0402b';
}
