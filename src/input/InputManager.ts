/**
 * Merges keyboard, gamepads and wheels into one DriverInput, applying each device's bindings, response
 * curves, keyboard smoothing and wheel rotation. Handles hot-plugging (connect/disconnect at any time),
 * toggles/latches, one-shot UI actions, rumble output and "press a control to bind" capture.
 *
 * DOM-free: the browser wiring (`attachBrowserInput`) feeds keys in and supplies navigator.getGamepads,
 * so tests drive it with mock devices.
 */
import type { DriverInput, VehicleTelemetry } from '../physics/Vehicle';
import { ACTIONS, ACTION_IDS, type ActionId, type BindingSource, RESERVED_KEYS } from './actions';
import { type DeviceConfig, InputConfigStore } from './bindings';
import { approach, clamp, fullAxis, halfAxis, shape, shapeSigned, wheelSteer } from './curves';
import { type DeviceIdentity, type DeviceKind, identify, remapToStandard } from './devices';
import { RumbleEngine, type RumbleOutput } from './rumble';

/** The parts of the W3C Gamepad the manager reads (real Gamepads and test mocks both fit). */
export interface GamepadLike {
  readonly id: string;
  readonly index: number;
  readonly connected: boolean;
  readonly mapping: string;
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly value: number; readonly pressed: boolean }[];
  readonly vibrationActuator?: { playEffect?: (type: string, params: Record<string, number>) => Promise<unknown> } | null;
}

export interface DeviceInfo extends DeviceIdentity {
  /** "keyboard" or "pad:<Gamepad.id>" — the key bindings are stored under. */
  key: string;
  /** navigator.getGamepads() slot, −1 for the keyboard. */
  index: number;
  rumbleSupported: boolean;
}

export type InputEvent = { type: 'connected' | 'disconnected'; device: DeviceInfo };

interface PadState {
  info: DeviceInfo;
  buttons: number[];
  axes: number[];
  pad: GamepadLike;
  /** Axes that have reported a non-zero value at least once. */
  touched: Set<number>;
}

const KEYBOARD_INFO: DeviceInfo = {
  key: 'keyboard',
  index: -1,
  kind: 'keyboard',
  vendor: null,
  product: null,
  name: 'Keyboard',
  standard: true,
  remap: null,
  rumbleSupported: false,
};

/** Value at which a digital action counts as pressed. */
const PRESS = 0.5;

export class InputManager {
  readonly config: InputConfigStore;
  private readonly keysDown = new Set<string>();
  /** Keys pressed since the last update (a tap shorter than a frame still counts once). */
  private readonly keyTaps = new Set<string>();
  private readonly pads = new Map<number, PadState>();
  private readonly prevDigital = new Map<ActionId, boolean>();
  private readonly edges = new Set<ActionId>();
  private readonly latches = { aero: false, pitLimiter: false };
  private kb = { steer: 0, throttle: 0, brake: 0 };
  private rumbleEngine = new RumbleEngine();
  private rumbleTimer = 0;
  private lastRumble: RumbleOutput = { strong: 0, weak: 0 };
  /** Last DriverInput produced. */
  current: DriverInput = { throttle: 0, brake: 0, steer: 0, shiftUp: false, shiftDown: false, aeroRequest: false, overtake: false, pitLimiter: false };
  /** This frame's input even while disabled (live meters in the controls menu). */
  preview: DriverInput = this.current;
  /** Device that most recently produced input (for HUD hints). */
  lastActive: DeviceInfo = KEYBOARD_INFO;
  /** When false (menu open), driving inputs read as released; edges are still tracked. */
  enabled = true;
  readonly events: InputEvent[] = [];
  onEvent: ((e: InputEvent) => void) | null = null;

  constructor(
    store: InputConfigStore,
    private readonly getPads: () => readonly (GamepadLike | null)[] = () => [],
  ) {
    this.config = store;
  }

  // ---------------------------------------------------------------- keyboard
  keyDown(code: string): void {
    this.keysDown.add(code);
    this.keyTaps.add(code);
  }

  keyUp(code: string): void {
    this.keysDown.delete(code);
  }

  /** Window lost focus: release everything. */
  releaseAll(): void {
    this.keysDown.clear();
    this.keyTaps.clear();
  }

  isKeyDown(code: string): boolean {
    return this.keysDown.has(code);
  }

  /** Is this key code used by any keyboard binding? (browser default actions are suppressed for those) */
  isBoundKey(code: string): boolean {
    const c = this.configFor(KEYBOARD_INFO);
    return ACTION_IDS.some((a) => c.bindings[a].some((b) => b.type === 'key' && b.code === code));
  }

  // ---------------------------------------------------------------- devices
  get keyboard(): DeviceInfo {
    return KEYBOARD_INFO;
  }

  devices(): DeviceInfo[] {
    return [KEYBOARD_INFO, ...[...this.pads.values()].map((p) => p.info)];
  }

  device(key: string): DeviceInfo | undefined {
    return this.devices().find((d) => d.key === key);
  }

  configFor(info: DeviceInfo): DeviceConfig {
    return this.config.get(info.key, info.kind, info.standard);
  }

  /** Read the Gamepad API; emits connected/disconnected events (hot-plugging). */
  poll(): void {
    const seen = new Set<number>();
    for (const gp of this.getPads()) {
      if (!gp || !gp.connected) continue;
      seen.add(gp.index);
      let st = this.pads.get(gp.index);
      if (!st || st.info.key !== `pad:${gp.id}`) {
        if (st) this.emit({ type: 'disconnected', device: st.info });
        const ident = identify(gp.id, gp.mapping);
        const info: DeviceInfo = { ...ident, key: `pad:${gp.id}`, index: gp.index, rumbleSupported: typeof gp.vibrationActuator?.playEffect === 'function' };
        st = { info, buttons: [], axes: [], pad: gp, touched: new Set() };
        this.pads.set(gp.index, st);
        this.emit({ type: 'connected', device: info });
      }
      st.pad = gp;
      const rawButtons = gp.buttons.map((b) => (typeof b.value === 'number' && b.value > 0 ? b.value : b.pressed ? 1 : 0));
      if (st.info.remap) {
        const r = remapToStandard(st.info.remap, rawButtons, gp.axes);
        st.buttons = r.buttons;
        st.axes = r.axes;
      } else {
        st.buttons = rawButtons;
        st.axes = [...gp.axes];
      }
      st.axes.forEach((v, i) => {
        if (v !== 0) st!.touched.add(i);
      });
    }
    for (const [i, st] of this.pads) {
      if (!seen.has(i)) {
        this.pads.delete(i);
        this.emit({ type: 'disconnected', device: st.info });
      }
    }
  }

  private emit(e: InputEvent): void {
    this.events.push(e);
    if (this.events.length > 20) this.events.shift();
    this.onEvent?.(e);
  }

  /** Current (post-remap) state of a pad, for the bind-capture UI and live meters. */
  padState(key: string): { buttons: readonly number[]; axes: readonly number[] } | null {
    for (const p of this.pads.values()) if (p.info.key === key) return { buttons: p.buttons, axes: p.axes };
    return null;
  }

  // ---------------------------------------------------------------- reading sources
  private readSource(src: BindingSource, pad: PadState | null): number {
    switch (src.type) {
      case 'key':
        return pad === null && (this.keysDown.has(src.code) || this.keyTaps.has(src.code)) ? 1 : 0;
      case 'button':
        return pad ? clamp(pad.buttons[src.index] ?? 0, 0, 1) : 0;
      case 'axis':
        return pad ? halfAxis(pad.axes[src.index] ?? 0, src.dir) : 0;
      case 'axisFull': {
        if (!pad) return 0;
        // some browsers report a pedal axis as exactly 0 until it first moves; 0 on a full axis would read
        // as half throttle, so a full axis counts as released until it has reported a real value
        const v = pad.axes[src.index];
        return v === undefined || !pad.touched.has(src.index) ? 0 : fullAxis(v, src.invert);
      }
    }
  }

  private actionValue(cfg: DeviceConfig, a: ActionId, pad: PadState | null): number {
    let v = 0;
    for (const b of cfg.bindings[a]) v = Math.max(v, this.readSource(b, pad));
    return v;
  }

  // ---------------------------------------------------------------- per frame
  /**
   * Produce this frame's DriverInput. `speedMs` feeds keyboard speed-sensitive steering.
   * Call poll() first (or let update do it).
   */
  update(dt: number, speedMs = 0, doPoll = true): DriverInput {
    if (doPoll) this.poll();
    // keyboard: digital → smoothed analogue
    const kc = this.configFor(KEYBOARD_INFO);
    const f = kc.keyboard;
    const kL = this.actionValue(kc, 'steerLeft', null);
    const kR = this.actionValue(kc, 'steerRight', null);
    const kT = this.actionValue(kc, 'throttle', null);
    const kB = this.actionValue(kc, 'brake', null);
    const limit = 1 / (1 + f.speedSensitivity * Math.pow(Math.max(0, speedMs) / 50, 2));
    const target = (kL - kR) * limit;
    const rate = target === 0 || Math.sign(target) !== Math.sign(this.kb.steer) || Math.abs(target) < Math.abs(this.kb.steer) ? f.steerReturn : f.steerSpeed;
    this.kb.steer = approach(this.kb.steer, target, rate, dt);
    this.kb.throttle = approach(this.kb.throttle, kT, kT > this.kb.throttle ? f.throttleRise : f.throttleFall, dt);
    this.kb.brake = approach(this.kb.brake, kB, kB > this.kb.brake ? f.brakeRise : f.brakeFall, dt);
    let steer = this.kb.steer;
    let throttle = this.kb.throttle;
    let brake = this.kb.brake;
    if (kL || kR || kT || kB) this.lastActive = KEYBOARD_INFO;

    const digital = new Map<ActionId, boolean>();
    for (const a of ACTIONS) if (a.kind !== 'analog') digital.set(a.id, this.actionValue(kc, a.id, null) >= PRESS);

    for (const p of this.pads.values()) {
      const c = this.configFor(p.info);
      const L = this.actionValue(c, 'steerLeft', p);
      const R = this.actionValue(c, 'steerRight', p);
      let s = L - R;
      if (p.info.kind === 'wheel') s = wheelSteer(s, c.wheel.hardwareDeg, c.wheel.carDeg);
      s = shapeSigned(s, c.curves.steer);
      const t = shape(this.actionValue(c, 'throttle', p), c.curves.throttle);
      const b = shape(this.actionValue(c, 'brake', p), c.curves.brake);
      if (Math.abs(s) > Math.abs(steer)) steer = s;
      throttle = Math.max(throttle, t);
      brake = Math.max(brake, b);
      let active = Math.abs(s) > 0.05 || t > 0.05 || b > 0.05;
      for (const a of ACTIONS) {
        if (a.kind === 'analog') continue;
        const on = this.actionValue(c, a.id, p) >= PRESS;
        if (on) {
          digital.set(a.id, true);
          active = true;
        }
      }
      if (active) this.lastActive = p.info;
    }

    // edges, latches
    this.edges.clear();
    for (const [a, on] of digital) {
      const was = this.prevDigital.get(a) ?? false;
      if (on && !was) this.edges.add(a);
      this.prevDigital.set(a, on);
    }
    if (this.enabled) {
      if (this.edges.has('aero')) this.latches.aero = !this.latches.aero;
      if (this.edges.has('pitLimiter')) this.latches.pitLimiter = !this.latches.pitLimiter;
    }
    const on = this.enabled;
    this.keyTaps.clear();
    this.preview = {
      throttle: clamp(throttle, 0, 1),
      brake: clamp(brake, 0, 1),
      steer: clamp(steer, -1, 1),
      shiftUp: digital.get('shiftUp') ?? false,
      shiftDown: digital.get('shiftDown') ?? false,
      aeroRequest: this.latches.aero,
      overtake: digital.get('overtake') ?? false,
      pitLimiter: this.latches.pitLimiter,
    };
    this.current = {
      throttle: on ? clamp(throttle, 0, 1) : 0,
      brake: on ? clamp(brake, 0, 1) : 0,
      steer: on ? clamp(steer, -1, 1) : 0,
      shiftUp: on && (digital.get('shiftUp') ?? false),
      shiftDown: on && (digital.get('shiftDown') ?? false),
      aeroRequest: this.latches.aero,
      overtake: on && (digital.get('overtake') ?? false),
      pitLimiter: this.latches.pitLimiter,
    };
    return this.current;
  }

  /** Did a one-shot action fire this frame? */
  pressed(a: ActionId): boolean {
    return this.edges.has(a);
  }

  /** Clear the aero latch (e.g. when the car leaves a zone or resets). */
  setLatch(which: 'aero' | 'pitLimiter', v: boolean): void {
    this.latches[which] = v;
  }

  // ---------------------------------------------------------------- rumble
  /** Drive pad rumble from car telemetry. Re-issued every ~80 ms while non-zero. */
  rumble(t: Readonly<VehicleTelemetry> | null, impactMs: number, dt: number): RumbleOutput {
    let out: RumbleOutput = { strong: 0, weak: 0 };
    const pads = [...this.pads.values()].filter((p) => p.info.rumbleSupported && p.info.kind !== 'wheel');
    if (t && pads.length) {
      const strength = Math.max(...pads.map((p) => this.configFor(p.info)).map((c) => (c.rumble.enabled ? c.rumble.strength : 0)));
      out = this.rumbleEngine.update(t, impactMs, dt, strength);
    }
    this.rumbleTimer -= dt;
    const changed = Math.abs(out.strong - this.lastRumble.strong) > 0.05 || Math.abs(out.weak - this.lastRumble.weak) > 0.05;
    const active = out.strong > 0.01 || out.weak > 0.01;
    if ((active && (this.rumbleTimer <= 0 || changed)) || (!active && changed)) {
      this.rumbleTimer = 0.08;
      for (const p of pads) {
        const c = this.configFor(p.info);
        if (!c.rumble.enabled) continue;
        p.pad.vibrationActuator?.playEffect?.('dual-rumble', { startDelay: 0, duration: 120, strongMagnitude: out.strong, weakMagnitude: out.weak })?.catch(() => {});
      }
    }
    this.lastRumble = out;
    return out;
  }

  // ---------------------------------------------------------------- bind capture
  /**
   * Start capturing the next control moved on a device. Returns a function to call each frame; it returns
   * the detected source once something moved clearly away from where it rested at the start.
   * Axes: a stick moving past half travel gives a half axis; a control that rested at one end (pedal,
   * raw trigger) and travels most of the range gives a full axis with the right direction.
   */
  beginCapture(deviceKey: string, analogTarget: boolean): (pressedKey?: string) => BindingSource | null {
    const start = this.padState(deviceKey);
    const baseAxes = start ? [...start.axes] : [];
    const baseButtons = start ? [...start.buttons] : [];
    return (pressedKey?: string) => {
      if (deviceKey === 'keyboard') {
        if (pressedKey && !RESERVED_KEYS.has(pressedKey) && pressedKey !== 'Escape') return { type: 'key', code: pressedKey };
        return null;
      }
      const st = this.padState(deviceKey);
      if (!st) return null;
      for (let i = 0; i < st.buttons.length; i++) {
        if ((st.buttons[i] ?? 0) > 0.6 && (baseButtons[i] ?? 0) < 0.3) return { type: 'button', index: i };
      }
      for (let i = 0; i < st.axes.length; i++) {
        const v = st.axes[i] ?? 0;
        const b0 = baseAxes[i] ?? 0;
        if (Math.abs(b0) > 0.8 && analogTarget) {
          // rested at an end: pedal / raw trigger → full axis
          if (Math.abs(v - b0) > 1.2) return { type: 'axisFull', index: i, invert: b0 > 0 };
        } else if (Math.abs(b0) < 0.3 && Math.abs(v) > 0.6) {
          return { type: 'axis', index: i, dir: v > 0 ? 1 : -1 };
        }
      }
      return null;
    };
  }
}

export type { DeviceKind };
