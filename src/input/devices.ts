/**
 * Device identification, button glyphs and raw-layout remapping.
 *
 * Browsers expose pads through the Gamepad API. With `mapping === 'standard'` button/axis indices follow
 * the W3C standard layout (0 = bottom face button … 16 = home); Chrome and Firefox remap DualShock 4,
 * DualSense and XInput pads to it. Some drivers/browsers deliver a raw HID layout instead
 * (`mapping === ''`), which we remap for the known Sony layout and otherwise pass through (the player
 * then binds by moving the control). Wheels are never "standard": their axes are bound per model.
 *
 * Gamepad.id formats:  Chrome  "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)"
 *                      Firefox "054c-0ce6-DualSense Wireless Controller"   (Windows XInput: "xinput")
 */

export type DeviceKind = 'keyboard' | 'xbox' | 'dualshock4' | 'dualsense' | 'gamepad' | 'wheel';

export interface DeviceIdentity {
  kind: DeviceKind;
  vendor: string | null;
  product: string | null;
  /** Human name for menus. */
  name: string;
  /** True when indices follow the W3C standard layout (natively or after our remap). */
  standard: boolean;
  /** Known raw layout we remap to standard. */
  remap: RawLayout | null;
}

export type RawLayout = 'sony-hid';

const SONY = '054c';
const MICROSOFT = '045e';
const LOGITECH = '046d';
const THRUSTMASTER = '044f';
const FANATEC = '0eb7';

const DS4_PRODUCTS = new Set(['05c4', '09cc', '0ba0']);
// other Sony pads fall back to the DS4 layout
const DUALSENSE_PRODUCTS = new Set(['0ce6', '0df2']);
/** Logitech wheels: G25, G27, Driving Force GT, G29 (PS and PC modes), G920, G923 (PS / Xbox). */
const LOGITECH_WHEELS = new Set(['c299', 'c29b', 'c29a', 'c24f', 'c260', 'c262', 'c266', 'c267', 'c26d', 'c26e']);
/** Thrustmaster wheel bases (T150, T300RS variants, TX, TS-XW, T248, T-GT, TMX). */
const THRUSTMASTER_WHEELS = new Set(['b65d', 'b677', 'b66e', 'b66d', 'b66f', 'b669', 'b664', 'b692', 'b696', 'b69a', 'b67f', 'b689']);

/** Extract USB vendor/product ids from a Gamepad.id in Chrome or Firefox format. */
export function parseIds(id: string): { vendor: string | null; product: string | null } {
  const chrome = /Vendor:\s*([0-9a-f]{4})\s+Product:\s*([0-9a-f]{4})/i.exec(id);
  if (chrome) return { vendor: chrome[1]!.toLowerCase(), product: chrome[2]!.toLowerCase() };
  const ff = /^([0-9a-f]{1,4})-([0-9a-f]{1,4})-/i.exec(id);
  if (ff) return { vendor: ff[1]!.toLowerCase().padStart(4, '0'), product: ff[2]!.toLowerCase().padStart(4, '0') };
  return { vendor: null, product: null };
}

/** Classify a pad from its id string and mapping. */
export function identify(id: string, mapping: string): DeviceIdentity {
  const { vendor, product } = parseIds(id);
  const lower = id.toLowerCase();
  const standard = mapping === 'standard';
  let kind: DeviceKind = 'gamepad';
  if (
    (vendor === LOGITECH && product && LOGITECH_WHEELS.has(product)) ||
    (vendor === THRUSTMASTER && product && THRUSTMASTER_WHEELS.has(product)) ||
    vendor === FANATEC ||
    /\bwheel\b|racing wheel|driving force/.test(lower)
  ) {
    kind = 'wheel';
  } else if (vendor === SONY) {
    kind = product && DUALSENSE_PRODUCTS.has(product) ? 'dualsense' : product && DS4_PRODUCTS.has(product) ? 'dualshock4' : /dualsense/.test(lower) ? 'dualsense' : 'dualshock4';
  } else if (vendor === MICROSOFT || /xbox|xinput|x-box/.test(lower)) {
    kind = 'xbox';
  } else if (/dualsense/.test(lower)) {
    kind = 'dualsense';
  } else if (/dualshock|^wireless controller/.test(lower)) {
    kind = 'dualshock4';
  }
  const remap: RawLayout | null = !standard && (kind === 'dualshock4' || kind === 'dualsense') ? 'sony-hid' : null;
  return { kind, vendor, product, name: prettyName(id, kind), standard: kind !== 'wheel' && (standard || remap !== null), remap };
}

function prettyName(id: string, kind: DeviceKind): string {
  const base: Record<DeviceKind, string> = {
    keyboard: 'Keyboard',
    xbox: 'Xbox controller',
    dualshock4: 'DualShock 4',
    dualsense: 'DualSense',
    gamepad: 'Gamepad',
    wheel: 'Steering wheel',
  };
  // strip "(... Vendor: ...)" and "054c-0ce6-" decorations
  const clean = id
    .replace(/\(.*?Vendor:.*?\)/i, '')
    .replace(/^[0-9a-f]{1,4}-[0-9a-f]{1,4}-/i, '')
    .trim();
  if (kind === 'wheel' || kind === 'gamepad') return clean || base[kind];
  return base[kind];
}

/**
 * Raw Sony HID layout (DirectInput order, used when a browser does not remap the pad):
 *   buttons 0 □, 1 ✕, 2 ○, 3 △, 4 L1, 5 R1, 6 L2, 7 R2, 8 Share/Create, 9 Options, 10 L3, 11 R3, 12 PS, 13 touchpad
 *   axes 0 LX, 1 LY, 2 RX, 3 L2 (−1 rest), 4 R2 (−1 rest), 5 RY, 9 d-pad hat (−1 up … clockwise in 1/7 steps, >1 = centred)
 * Best knowledge; listed in docs/MANUAL_TESTS.md for verification on hardware.
 */
export function remapToStandard(layout: RawLayout, buttons: readonly number[], axes: readonly number[]): { buttons: number[]; axes: number[] } {
  void layout;
  const b = (i: number) => buttons[i] ?? 0;
  const a = (i: number) => axes[i] ?? 0;
  const trig = (v: number) => (v + 1) / 2;
  const hat = axes[9];
  // hat: −1 = up, then clockwise in steps of 2/7; values > 1 mean centred
  let up = 0;
  let down = 0;
  let left = 0;
  let right = 0;
  if (hat !== undefined && hat >= -1.01 && hat <= 1.01) {
    const dir = Math.round(((hat + 1) * 7) / 2); // 0 = N, 1 = NE, … 7 = NW
    up = dir === 7 || dir === 0 || dir === 1 ? 1 : 0;
    right = dir >= 1 && dir <= 3 ? 1 : 0;
    down = dir >= 3 && dir <= 5 ? 1 : 0;
    left = dir >= 5 && dir <= 7 ? 1 : 0;
  }
  const l2 = Math.max(b(6), axes.length > 3 ? trig(a(3)) : 0);
  const r2 = Math.max(b(7), axes.length > 4 ? trig(a(4)) : 0);
  return {
    buttons: [b(1), b(2), b(0), b(3), b(4), b(5), l2, r2, b(8), b(9), b(10), b(11), up, down, left, right, b(12), b(13)],
    axes: [a(0), a(1), a(2), a(5)],
  };
}

const STANDARD_COMMON = ['', '', '', '', '', '', '', '', '', '', '', '', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', '', ''];

const GLYPHS: Partial<Record<DeviceKind, string[]>> = {
  xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', ...STANDARD_COMMON.slice(12, 16), 'Xbox', 'Share'],
  dualshock4: ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Share', 'Options', 'L3', 'R3', ...STANDARD_COMMON.slice(12, 16), 'PS', 'Touchpad'],
  dualsense: ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Create', 'Options', 'L3', 'R3', ...STANDARD_COMMON.slice(12, 16), 'PS', 'Touchpad'],
  gamepad: ['South', 'East', 'West', 'North', 'L bumper', 'R bumper', 'L trigger', 'R trigger', 'Select', 'Start', 'L stick', 'R stick', ...STANDARD_COMMON.slice(12, 16), 'Home', 'Extra'],
};

const STICK_AXES = ['Left stick', 'Left stick', 'Right stick', 'Right stick'];

/** Label for a button. */
export function buttonGlyph(kind: DeviceKind, standard: boolean, index: number): string {
  if (standard) {
    const g = GLYPHS[kind === 'wheel' || kind === 'keyboard' ? 'gamepad' : kind]?.[index];
    if (g) return g;
  }
  return `Button ${index + 1}`;
}

/** Label for an axis (half or full). */
export function axisGlyph(kind: DeviceKind, standard: boolean, index: number, dir: 1 | -1 | 0): string {
  if (standard && index < 4) {
    const dirName = index % 2 === 0 ? (dir < 0 ? ' ←' : dir > 0 ? ' →' : ' ↔') : dir < 0 ? ' ↑' : dir > 0 ? ' ↓' : ' ↕';
    return `${STICK_AXES[index]}${dirName}`;
  }
  return `Axis ${index + 1}${dir < 0 ? ' −' : dir > 0 ? ' +' : ''}`;
}

/** Accent colour of PlayStation face buttons (for the UI). */
export function glyphColour(kind: DeviceKind, standard: boolean, index: number): string | null {
  if (!standard) return null;
  if (kind === 'dualshock4' || kind === 'dualsense') return ['#7fb2ff', '#ff6b6b', '#e88cff', '#45d6a0'][index] ?? null;
  if (kind === 'xbox') return ['#5dc95d', '#e8423a', '#3d8bff', '#f2c230'][index] ?? null;
  return null;
}

/** Human-readable key name from a KeyboardEvent.code. */
export function keyGlyph(code: string): string {
  const named: Record<string, string> = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Space: 'Space',
    ShiftLeft: 'L Shift',
    ShiftRight: 'R Shift',
    ControlLeft: 'L Ctrl',
    ControlRight: 'R Ctrl',
    AltLeft: 'L Alt',
    AltRight: 'R Alt',
    Escape: 'Esc',
    Backspace: 'Backspace',
    Tab: 'Tab',
    Enter: 'Enter',
  };
  if (named[code]) return named[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}
