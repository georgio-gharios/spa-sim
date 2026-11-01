/**
 * Controls menu: per-device rebinding ("press a control"), response curves, keyboard smoothing, wheel
 * rotation, rumble, live input meters and reset to defaults. Opens with Esc or the pad's Menu/Options
 * button and pauses the car. Changes are saved to localStorage as they are made.
 */
import { ACTIONS, type ActionId, type BindingSource, RESERVED_KEYS } from '../input/actions';
import type { DeviceConfig } from '../input/bindings';
import { shape } from '../input/curves';
import type { DeviceInfo, InputEvent, InputManager } from '../input/InputManager';
import { sourceColour, sourceLabel } from '../input/labels';

interface Capture {
  action: ActionId;
  poll: (key?: string) => BindingSource | null;
}

const KIND_LABEL: Record<string, string> = {
  keyboard: 'Keyboard',
  xbox: 'Xbox',
  dualshock4: 'DualShock 4',
  dualsense: 'DualSense',
  gamepad: 'Gamepad',
  wheel: 'Wheel',
};

export class ControlsMenu {
  readonly root: HTMLElement;
  private readonly toastEl: HTMLElement;
  open = false;
  private selected = 'keyboard';
  private capture: Capture | null = null;
  private notice = '';
  onToggle: ((open: boolean) => void) | null = null;

  constructor(private readonly input: InputManager) {
    this.root = document.createElement('div');
    this.root.id = 'controls-menu';
    this.root.hidden = true;
    document.body.appendChild(this.root);
    this.toastEl = document.createElement('div');
    this.toastEl.id = 'input-toast';
    document.body.appendChild(this.toastEl);
    // capture phase on window: runs before the viewer's own key handlers, so menu keys don't leak
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.code === 'Escape') {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (this.capture) {
            this.capture = null;
            this.render();
          } else this.toggle();
          return;
        }
        if (!this.open) return;
        if (e.target instanceof HTMLInputElement && e.target.type === 'range' && e.code.startsWith('Arrow')) return;
        // keep the viewer's own shortcuts (F, C, Space…) from firing behind the menu, but still feed the
        // input manager so the live meters show keyboard input
        e.stopImmediatePropagation();
        if (!this.capture && !e.repeat) this.input.keyDown(e.code);
        if (this.capture && this.selected === 'keyboard') {
          e.preventDefault();
          if (RESERVED_KEYS.has(e.code)) {
            this.notice = `${e.code} is reserved by the viewer.`;
            this.render();
            return;
          }
          const src = this.capture.poll(e.code);
          if (src) this.finishCapture(src);
        }
      },
      { capture: true },
    );
    const prev = input.onEvent;
    input.onEvent = (e) => {
      prev?.(e);
      this.onDevice(e);
    };
  }

  toggle(force?: boolean): void {
    this.open = force ?? !this.open;
    this.capture = null;
    this.notice = '';
    this.root.hidden = !this.open;
    if (this.open) {
      if (this.input.lastActive && this.input.device(this.input.lastActive.key)) this.selected = this.input.lastActive.key;
      this.render();
    }
    this.onToggle?.(this.open);
  }

  private onDevice(e: InputEvent): void {
    const verb = e.type === 'connected' ? 'connected' : 'disconnected';
    this.toast(`${e.device.name} ${verb}${e.type === 'connected' && e.device.kind === 'wheel' ? ' · check pedal axes in Controls (Esc)' : ''}`);
    if (e.type === 'disconnected' && this.selected === e.device.key) this.selected = 'keyboard';
    if (this.open) this.render();
  }

  toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout((this.toastEl as unknown as { _t?: number })._t);
    (this.toastEl as unknown as { _t?: number })._t = window.setTimeout(() => this.toastEl.classList.remove('show'), 3500);
  }

  private dev(): DeviceInfo {
    return this.input.device(this.selected) ?? this.input.keyboard;
  }

  private cfg(): DeviceConfig {
    return this.input.configFor(this.dev());
  }

  private change(fn: (c: DeviceConfig) => void): void {
    const d = this.dev();
    this.input.config.update(d.key, d.kind, d.standard, fn);
  }

  private finishCapture(src: BindingSource): void {
    if (!this.capture) return;
    const d = this.dev();
    const displaced = this.input.config.bind(d.key, d.kind, d.standard, this.capture.action, src);
    this.notice = displaced ? `${sourceLabel(src, d)} moved from “${ACTIONS.find((a) => a.id === displaced)!.label}”.` : '';
    this.capture = null;
    this.render();
  }

  /** Per-frame: poll pad capture and refresh live meters. */
  update(): void {
    if (!this.open) return;
    if (this.capture && this.selected !== 'keyboard') {
      const src = this.capture.poll();
      if (src) this.finishCapture(src);
    }
    const p = this.input.preview;
    const set = (id: string, v: number, signed = false) => {
      const el = this.root.querySelector<HTMLElement>(`#cm-m-${id}`);
      if (!el) return;
      if (signed) {
        el.style.left = `${50 - Math.max(0, v) * 50}%`;
        el.style.width = `${Math.abs(v) * 50}%`;
      } else el.style.width = `${v * 100}%`;
    };
    set('steer', p.steer, true);
    set('throttle', p.throttle);
    set('brake', p.brake);
  }

  render(): void {
    const d = this.dev();
    const c = this.cfg();
    const devices = this.input.devices();
    const tabs = devices
      .map((x) => `<button class="cm-tab${x.key === d.key ? ' on' : ''}" data-dev="${esc(x.key)}">${esc(KIND_LABEL[x.kind] ?? x.kind)}${x.kind === 'gamepad' || x.kind === 'wheel' ? `<small>${esc(x.name)}</small>` : ''}</button>`)
      .join('');
    const rows = ACTIONS.map((a) => {
      const chips = c.bindings[a.id]
        .map((s, i) => {
          const col = sourceColour(s, d);
          return `<span class="cm-chip"${col ? ` style="border-color:${col};color:${col}"` : ''}>${esc(sourceLabel(s, d))}<button data-unbind="${a.id}:${i}" title="Remove">×</button></span>`;
        })
        .join('');
      const capturing = this.capture?.action === a.id;
      return `<tr class="${capturing ? 'cap' : ''}"><td>${esc(a.label)}${a.kind === 'toggle' ? ' <small>(toggle)</small>' : ''}</td><td>${chips}${
        capturing ? `<span class="cm-wait">${d.kind === 'keyboard' ? 'Press a key…' : a.kind === 'analog' ? 'Move the stick / pedal / trigger…' : 'Press a button…'} (Esc cancels)</span>` : ''
      }</td><td><button data-bind="${a.id}">${capturing ? '…' : '+ Bind'}</button></td></tr>`;
    }).join('');
    const slider = (id: string, label: string, v: number, min: number, max: number, step: number, unit = '') =>
      `<label class="cm-sl"><span>${label}</span><input type="range" id="cm-${id}" data-unit="${unit}" min="${min}" max="${max}" step="${step}" value="${v}"><b>${fmtNum(v, step)}${unit}</b></label>`;
    const curve = (axis: 'steer' | 'throttle' | 'brake', label: string) => {
      const k = c.curves[axis];
      const pts = Array.from({ length: 41 }, (_, i) => `${(i / 40) * 100},${100 - shape(i / 40, k) * 100}`).join(' ');
      return `<fieldset class="cm-hascurve"><legend>${label}</legend><svg viewBox="0 0 100 100" class="cm-curve"><polyline points="${pts}"/></svg>
        ${slider(`${axis}-dz`, 'Deadzone', k.deadzone, 0, 0.5, 0.01)}
        ${slider(`${axis}-sat`, 'Saturation', k.saturation, 0.5, 1, 0.01)}
        ${slider(`${axis}-lin`, 'Linearity', k.linearity, 0.3, 3, 0.05)}</fieldset>`;
    };
    let settings = '';
    if (d.kind === 'keyboard') {
      const f = c.keyboard;
      settings = `<fieldset><legend>Keyboard smoothing</legend>
        ${slider('kb-steerSpeed', 'Steer speed', f.steerSpeed, 0.5, 8, 0.1, '/s')}
        ${slider('kb-steerReturn', 'Steer return', f.steerReturn, 0.5, 12, 0.1, '/s')}
        ${slider('kb-speedSensitivity', 'Speed sensitivity', f.speedSensitivity, 0, 1, 0.05)}
        ${slider('kb-throttleRise', 'Throttle rise', f.throttleRise, 1, 30, 0.5, '/s')}
        ${slider('kb-throttleFall', 'Throttle release', f.throttleFall, 1, 30, 0.5, '/s')}
        ${slider('kb-brakeRise', 'Brake rise', f.brakeRise, 1, 30, 0.5, '/s')}
        ${slider('kb-brakeFall', 'Brake release', f.brakeFall, 1, 30, 0.5, '/s')}</fieldset>`;
    } else {
      settings = curve('steer', 'Steering') + curve('throttle', 'Throttle') + curve('brake', 'Brake');
      if (d.kind === 'wheel') {
        settings += `<fieldset><legend>Wheel rotation</legend>
          ${slider('wh-hardwareDeg', 'Wheel (driver setting)', c.wheel.hardwareDeg, 180, 1080, 10, '°')}
          ${slider('wh-carDeg', 'Car steering lock', c.wheel.carDeg, 180, 540, 10, '°')}
          <p class="cm-note">Set both to the same value for 1:1 steering (set the wheel's own software to ${c.wheel.carDeg}°). Browsers have no force-feedback API, so the wheel has no FFB.</p></fieldset>`;
      } else {
        settings += `<fieldset><legend>Rumble</legend>
          <label class="cm-sl"><span>Enabled</span><input type="checkbox" id="cm-rumble-on" ${c.rumble.enabled ? 'checked' : ''}></label>
          ${slider('rumble-strength', 'Strength', c.rumble.strength, 0, 1, 0.05)}
          <p class="cm-note">${d.rumbleSupported ? 'Kerbs, lock-ups, wheelspin, grass/gravel and impacts.' : 'This browser does not expose rumble for this pad (Firefox has no Gamepad vibration API).'}</p></fieldset>`;
      }
    }
    this.root.innerHTML = `
      <div class="cm-panel">
        <div class="cm-head"><b>Controls</b><span class="cm-tabs">${tabs}</span><button id="cm-close">Resume (Esc)</button></div>
        <div class="cm-body">
          <div class="cm-left">
            <table class="cm-binds">${rows}</table>
            <div class="cm-notice">${esc(this.notice)}</div>
            <div class="cm-foot"><button id="cm-reset">Reset ${esc(KIND_LABEL[d.kind] ?? '')} to defaults</button>
            <span class="cm-saved">${this.input.config.isCustom(d.key) ? 'Custom · saved in this browser' : 'Defaults'}</span></div>
          </div>
          <div class="cm-right">
            <fieldset><legend>Live input</legend>
              <div class="cm-meter">Steer<div><i id="cm-m-steer"></i></div></div>
              <div class="cm-meter">Throttle<div><i id="cm-m-throttle" class="thr"></i></div></div>
              <div class="cm-meter">Brake<div><i id="cm-m-brake" class="brk"></i></div></div>
            </fieldset>
            ${settings}
          </div>
        </div>
      </div>`;
    this.wire();
    this.update();
  }

  private wire(): void {
    const r = this.root;
    r.querySelector('#cm-close')!.addEventListener('click', () => this.toggle(false));
    r.querySelectorAll<HTMLButtonElement>('[data-dev]').forEach((b) =>
      b.addEventListener('click', () => {
        this.selected = b.dataset.dev!;
        this.capture = null;
        this.notice = '';
        this.render();
      }),
    );
    r.querySelectorAll<HTMLButtonElement>('[data-bind]').forEach((b) =>
      b.addEventListener('click', () => {
        const action = b.dataset.bind as ActionId;
        const analog = ACTIONS.find((a) => a.id === action)!.kind === 'analog';
        this.capture = { action, poll: this.input.beginCapture(this.selected, analog) };
        this.notice = '';
        this.render();
        b.blur();
      }),
    );
    r.querySelectorAll<HTMLButtonElement>('[data-unbind]').forEach((b) =>
      b.addEventListener('click', () => {
        const [a, i] = b.dataset.unbind!.split(':');
        const d = this.dev();
        this.input.config.unbind(d.key, d.kind, d.standard, a as ActionId, Number(i));
        this.render();
      }),
    );
    r.querySelector('#cm-reset')!.addEventListener('click', () => {
      this.input.config.reset(this.selected);
      this.notice = 'Defaults restored.';
      this.render();
    });
    const range = (id: string, fn: (c: DeviceConfig, v: number) => void) => {
      const el = r.querySelector<HTMLInputElement>(`#cm-${id}`);
      el?.addEventListener('input', () => {
        this.change((c) => fn(c, Number(el.value)));
        el.nextElementSibling!.textContent = fmtNum(Number(el.value), Number(el.step)) + (el.dataset.unit ?? '');
      });
      el?.addEventListener('change', () => this.render());
    };
    for (const axis of ['steer', 'throttle', 'brake'] as const) {
      range(`${axis}-dz`, (c, v) => (c.curves[axis].deadzone = v));
      range(`${axis}-sat`, (c, v) => (c.curves[axis].saturation = v));
      range(`${axis}-lin`, (c, v) => (c.curves[axis].linearity = v));
    }
    for (const k of ['steerSpeed', 'steerReturn', 'speedSensitivity', 'throttleRise', 'throttleFall', 'brakeRise', 'brakeFall'] as const) {
      range(`kb-${k}`, (c, v) => (c.keyboard[k] = v));
    }
    range('wh-hardwareDeg', (c, v) => (c.wheel.hardwareDeg = v));
    range('wh-carDeg', (c, v) => (c.wheel.carDeg = v));
    range('rumble-strength', (c, v) => (c.rumble.strength = v));
    r.querySelector<HTMLInputElement>('#cm-rumble-on')?.addEventListener('change', (e) => {
      const on = (e.target as HTMLInputElement).checked;
      this.change((c) => (c.rumble.enabled = on));
    });
  }
}

function fmtNum(v: number, step: number): string {
  return step >= 1 ? v.toFixed(0) : step >= 0.1 ? v.toFixed(1) : v.toFixed(2);
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
