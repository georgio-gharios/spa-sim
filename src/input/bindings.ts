/**
 * Per-device binding profiles: defaults per device kind, rebinding, and persistence (localStorage).
 * Only devices the player changed are stored; everything else comes from the defaults.
 */
import { ACTION_IDS, type ActionId, type BindingSource, sameSource } from './actions';
import { type AxisCurve, clampCurve } from './curves';
import type { DeviceKind } from './devices';

export interface KeyboardFeel {
  /** Steering build-up and return rates (full lock per second). */
  steerSpeed: number;
  steerReturn: number;
  throttleRise: number;
  throttleFall: number;
  brakeRise: number;
  brakeFall: number;
  /** 0..1: how much the available steering lock shrinks with speed (0 = none). */
  speedSensitivity: number;
}

export interface WheelSettings {
  /** Lock-to-lock rotation set in the wheel's own driver (degrees). */
  hardwareDeg: number;
  /** Lock-to-lock rotation of the car's steering wheel (degrees). */
  carDeg: number;
}

export interface RumbleSettings {
  enabled: boolean;
  /** 0..1 */
  strength: number;
}

export interface DeviceConfig {
  kind: DeviceKind;
  bindings: Record<ActionId, BindingSource[]>;
  curves: { steer: AxisCurve; throttle: AxisCurve; brake: AxisCurve };
  keyboard: KeyboardFeel;
  wheel: WheelSettings;
  rumble: RumbleSettings;
}

export const DEFAULT_KEYBOARD_FEEL: KeyboardFeel = {
  steerSpeed: 2.2,
  steerReturn: 4.5,
  throttleRise: 5,
  throttleFall: 8,
  brakeRise: 7,
  brakeFall: 10,
  speedSensitivity: 0.3,
};

export const DEFAULT_WHEEL: WheelSettings = { hardwareDeg: 900, carDeg: 360 };

const key = (code: string): BindingSource => ({ type: 'key', code });
const btn = (index: number): BindingSource => ({ type: 'button', index });
const half = (index: number, dir: 1 | -1): BindingSource => ({ type: 'axis', index, dir });
const full = (index: number, invert: boolean): BindingSource => ({ type: 'axisFull', index, invert });

function emptyBindings(): Record<ActionId, BindingSource[]> {
  return Object.fromEntries(ACTION_IDS.map((a) => [a, []])) as unknown as Record<ActionId, BindingSource[]>;
}

function bindingsFrom(partial: Partial<Record<ActionId, BindingSource[]>>): Record<ActionId, BindingSource[]> {
  return { ...emptyBindings(), ...partial };
}

const KEYBOARD_BINDINGS = (): Record<ActionId, BindingSource[]> =>
  bindingsFrom({
    throttle: [key('KeyW'), key('ArrowUp')],
    brake: [key('KeyS'), key('ArrowDown')],
    steerLeft: [key('KeyA'), key('ArrowLeft')],
    steerRight: [key('KeyD'), key('ArrowRight')],
    shiftUp: [key('KeyE'), key('ShiftRight')],
    shiftDown: [key('KeyQ'), key('ControlRight')],
    aero: [key('KeyX')],
    overtake: [key('KeyO')],
    pitLimiter: [key('KeyP')],
    reset: [key('KeyR')],
    assists: [key('KeyH')],
    camera: [key('KeyV')],
    // Esc always opens the menu (hard-wired); add another key here if wanted
    menu: [],
  });

/** W3C standard layout (Xbox, DualShock 4, DualSense, other standard pads). */
const STANDARD_PAD_BINDINGS = (): Record<ActionId, BindingSource[]> =>
  bindingsFrom({
    throttle: [btn(7)], // RT / R2
    brake: [btn(6)], // LT / L2
    steerLeft: [half(0, -1)],
    steerRight: [half(0, 1)],
    shiftUp: [btn(0)], // A / ✕
    shiftDown: [btn(2)], // X / □
    aero: [btn(3)], // Y / △
    overtake: [btn(1)], // B / ○
    pitLimiter: [btn(15)], // d-pad →
    reset: [btn(8)], // View / Share / Create
    assists: [btn(14)], // d-pad ←
    camera: [btn(5)], // RB / R1
    menu: [btn(9)], // Menu / Options
  });

/** Unknown raw-layout pad: a sensible guess; the player rebinds by moving each control. */
const RAW_PAD_BINDINGS = (): Record<ActionId, BindingSource[]> =>
  bindingsFrom({
    throttle: [half(1, -1)],
    brake: [half(1, 1)],
    steerLeft: [half(0, -1)],
    steerRight: [half(0, 1)],
    shiftUp: [btn(0)],
    shiftDown: [btn(1)],
    aero: [btn(3)],
    overtake: [btn(2)],
    menu: [btn(9)],
  });

/**
 * Wheels (non-standard). Defaults follow the common Logitech G29/G923 DirectInput layout in Chromium on
 * Windows: axis 0 wheel, axis 2 throttle, axis 5 brake (pedals rest at +1), paddles buttons 4/5.
 * Best knowledge: other bases differ, so the menu offers "press the pedal to bind".
 */
const WHEEL_BINDINGS = (): Record<ActionId, BindingSource[]> =>
  bindingsFrom({
    throttle: [full(2, true)],
    brake: [full(5, true)],
    steerLeft: [half(0, -1)],
    steerRight: [half(0, 1)],
    shiftUp: [btn(4)],
    shiftDown: [btn(5)],
    aero: [btn(0)],
    overtake: [btn(1)],
    pitLimiter: [btn(2)],
    reset: [btn(8)],
    camera: [btn(3)],
    menu: [btn(9)],
  });

export function defaultConfig(kind: DeviceKind, standard = true): DeviceConfig {
  const pad = kind !== 'keyboard' && kind !== 'wheel';
  return {
    kind,
    bindings: kind === 'keyboard' ? KEYBOARD_BINDINGS() : kind === 'wheel' ? WHEEL_BINDINGS() : standard ? STANDARD_PAD_BINDINGS() : RAW_PAD_BINDINGS(),
    curves:
      kind === 'wheel'
        ? { steer: { deadzone: 0, saturation: 1, linearity: 1 }, throttle: { deadzone: 0.02, saturation: 0.98, linearity: 1 }, brake: { deadzone: 0.02, saturation: 0.9, linearity: 1 } }
        : pad
          ? { steer: { deadzone: 0.08, saturation: 0.95, linearity: 1.5 }, throttle: { deadzone: 0.03, saturation: 0.97, linearity: 1 }, brake: { deadzone: 0.03, saturation: 0.95, linearity: 1 } }
          : { steer: { deadzone: 0, saturation: 1, linearity: 1 }, throttle: { deadzone: 0, saturation: 1, linearity: 1 }, brake: { deadzone: 0, saturation: 1, linearity: 1 } },
    keyboard: { ...DEFAULT_KEYBOARD_FEEL },
    wheel: { ...DEFAULT_WHEEL },
    rumble: { enabled: pad, strength: 1 },
  };
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const STORAGE_KEY = 'spa2026.input.v1';

interface StoredConfig {
  version: 1;
  devices: Record<string, DeviceConfig>;
}

/** Holds per-device configs (keyed by "keyboard" or "pad:<Gamepad.id>") and persists the changed ones. */
export class InputConfigStore {
  private readonly custom = new Map<string, DeviceConfig>();
  private readonly cache = new Map<string, DeviceConfig>();

  constructor(private readonly storage: StorageLike | null) {
    this.load();
  }

  private load(): void {
    if (!this.storage) return;
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(STORAGE_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as StoredConfig;
      if (parsed.version !== 1 || typeof parsed.devices !== 'object') return;
      for (const [k, cfg] of Object.entries(parsed.devices)) this.custom.set(k, sanitize(cfg));
    } catch {
      // corrupt settings: fall back to defaults rather than failing to start
    }
  }

  private save(): void {
    if (!this.storage) return;
    const out: StoredConfig = { version: 1, devices: Object.fromEntries(this.custom) };
    try {
      if (this.custom.size === 0) this.storage.removeItem(STORAGE_KEY);
      else this.storage.setItem(STORAGE_KEY, JSON.stringify(out));
    } catch {
      // storage full or blocked (private mode): settings still apply for this session
    }
  }

  /** Config for a device (custom if changed, else defaults for its kind). The returned object is live. */
  get(deviceKey: string, kind: DeviceKind, standard = true): DeviceConfig {
    const c = this.custom.get(deviceKey);
    if (c) return c;
    let d = this.cache.get(deviceKey);
    if (!d || d.kind !== kind) this.cache.set(deviceKey, (d = defaultConfig(kind, standard)));
    return d;
  }

  isCustom(deviceKey: string): boolean {
    return this.custom.has(deviceKey);
  }

  /** Apply a change to a device's config and persist it. */
  update(deviceKey: string, kind: DeviceKind, standard: boolean, change: (c: DeviceConfig) => void): DeviceConfig {
    const c = structuredCloneConfig(this.get(deviceKey, kind, standard));
    change(c);
    c.curves.steer = clampCurve(c.curves.steer);
    c.curves.throttle = clampCurve(c.curves.throttle);
    c.curves.brake = clampCurve(c.curves.brake);
    this.custom.set(deviceKey, c);
    this.cache.delete(deviceKey);
    this.save();
    return c;
  }

  /**
   * Bind a source to an action. The source is removed from any other action on the same device first
   * (one control = one action). Returns the action it was taken from, if any.
   */
  bind(deviceKey: string, kind: DeviceKind, standard: boolean, action: ActionId, src: BindingSource, replace = false): ActionId | null {
    let displaced: ActionId | null = null;
    this.update(deviceKey, kind, standard, (c) => {
      for (const a of ACTION_IDS) {
        if (a === action) continue;
        const before = c.bindings[a].length;
        c.bindings[a] = c.bindings[a].filter((b) => !sameSource(b, src));
        if (c.bindings[a].length !== before) displaced = a;
      }
      // a pedal replaces any other pedal axis on the action (two pedals on one action never makes sense)
      const list = replace ? [] : c.bindings[action].filter((b) => !sameSource(b, src) && !(src.type === 'axisFull' && b.type === 'axisFull'));
      c.bindings[action] = [...list, src];
    });
    return displaced;
  }

  unbind(deviceKey: string, kind: DeviceKind, standard: boolean, action: ActionId, index: number): void {
    this.update(deviceKey, kind, standard, (c) => {
      c.bindings[action] = c.bindings[action].filter((_, i) => i !== index);
    });
  }

  /** Back to the defaults for this device. */
  reset(deviceKey: string): void {
    this.custom.delete(deviceKey);
    this.cache.delete(deviceKey);
    this.save();
  }

  resetAll(): void {
    this.custom.clear();
    this.cache.clear();
    this.save();
  }
}

function structuredCloneConfig(c: DeviceConfig): DeviceConfig {
  return JSON.parse(JSON.stringify(c)) as DeviceConfig;
}

/** Fill any fields missing from older/partial stored configs with the defaults for the kind. */
function sanitize(c: Partial<DeviceConfig>): DeviceConfig {
  const kind = c.kind ?? 'gamepad';
  const d = defaultConfig(kind);
  const bindings = d.bindings;
  for (const a of ACTION_IDS) {
    const list = c.bindings?.[a];
    if (Array.isArray(list)) bindings[a] = list.filter(validSource);
  }
  return {
    kind,
    bindings,
    curves: {
      steer: clampCurve({ ...d.curves.steer, ...c.curves?.steer }),
      throttle: clampCurve({ ...d.curves.throttle, ...c.curves?.throttle }),
      brake: clampCurve({ ...d.curves.brake, ...c.curves?.brake }),
    },
    keyboard: { ...d.keyboard, ...c.keyboard },
    wheel: { ...d.wheel, ...c.wheel },
    rumble: { ...d.rumble, ...c.rumble },
  };
}

function validSource(s: unknown): s is BindingSource {
  if (!s || typeof s !== 'object') return false;
  const o = s as Record<string, unknown>;
  switch (o.type) {
    case 'key':
      return typeof o.code === 'string';
    case 'button':
      return typeof o.index === 'number';
    case 'axis':
      return typeof o.index === 'number' && (o.dir === 1 || o.dir === -1);
    case 'axisFull':
      return typeof o.index === 'number' && typeof o.invert === 'boolean';
    default:
      return false;
  }
}
