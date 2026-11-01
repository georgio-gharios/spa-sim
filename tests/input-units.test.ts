import { describe, expect, it } from 'vitest';
import { InputConfigStore, STORAGE_KEY, type StorageLike } from '../src/input/bindings';
import { clampCurve, fullAxis, halfAxis, radialDeadzone, shape, shapeSigned, wheelSteer } from '../src/input/curves';
import { buttonGlyph, identify, parseIds, remapToStandard } from '../src/input/devices';
import { InputManager } from '../src/input/InputManager';
import { rumbleCues, RumbleEngine } from '../src/input/rumble';
import type { VehicleTelemetry, WheelTelemetry } from '../src/physics/Vehicle';
import { ds4RawPad, dualSensePad, g29Wheel, MockPad, xboxPad } from './helpers/mockPads';

class MemStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

describe('deadzone / linearity / saturation maths', () => {
  const c = { deadzone: 0.1, saturation: 0.9, linearity: 1 };
  it('zero inside the deadzone, full at saturation, linear in between', () => {
    expect(shape(0, c)).toBe(0);
    expect(shape(0.1, c)).toBe(0);
    expect(shape(0.05, c)).toBe(0);
    expect(shape(0.9, c)).toBe(1);
    expect(shape(1, c)).toBe(1);
    expect(shape(0.5, c)).toBeCloseTo(0.5, 12); // (0.5 − 0.1) / 0.8
    expect(shape(0.3, c)).toBeCloseTo(0.25, 12);
  });
  it('is continuous at both edges and monotonic', () => {
    expect(shape(0.1 + 1e-9, c)).toBeLessThan(1e-6);
    expect(shape(0.9 - 1e-9, c)).toBeGreaterThan(1 - 1e-6);
    let prev = -1;
    for (let x = 0; x <= 1.0001; x += 0.001) {
      const y = shape(x, { deadzone: 0.07, saturation: 0.93, linearity: 1.7 });
      expect(y).toBeGreaterThanOrEqual(prev);
      prev = y;
    }
  });
  it('linearity bends the curve but keeps the end points', () => {
    const soft = { deadzone: 0, saturation: 1, linearity: 2 };
    const hard = { deadzone: 0, saturation: 1, linearity: 0.5 };
    expect(shape(0.5, soft)).toBeCloseTo(0.25, 12);
    expect(shape(0.25, hard)).toBeCloseTo(0.5, 12);
    expect(shape(1, soft)).toBe(1);
    expect(shape(0, hard)).toBe(0);
  });
  it('signed shaping is symmetric; inputs outside −1..1 are clamped', () => {
    expect(shapeSigned(-0.5, c)).toBeCloseTo(-shapeSigned(0.5, c), 12);
    expect(shapeSigned(-3, c)).toBe(-1);
    expect(shape(2, c)).toBe(1);
  });
  it('clampCurve keeps saturation above the deadzone', () => {
    const k = clampCurve({ deadzone: 0.95, saturation: 0.2, linearity: 99 });
    expect(k.deadzone).toBe(0.9);
    expect(k.saturation).toBeGreaterThan(k.deadzone);
    expect(k.linearity).toBe(5);
  });
  it('radial deadzone keeps direction and reaches the rim', () => {
    const [x, y] = radialDeadzone(0.05, 0.05, c);
    expect([x, y]).toEqual([0, 0]);
    const [x2, y2] = radialDeadzone(0.6, 0.8, c); // r = 1
    expect(Math.hypot(x2, y2)).toBeCloseTo(1, 12);
    expect(x2 / y2).toBeCloseTo(0.75, 12);
  });
  it('axis helpers', () => {
    expect(fullAxis(-1, false)).toBe(0);
    expect(fullAxis(1, false)).toBe(1);
    expect(fullAxis(1, true)).toBe(0); // pedal at rest
    expect(fullAxis(-1, true)).toBe(1);
    expect(halfAxis(-0.4, -1)).toBeCloseTo(0.4);
    expect(halfAxis(-0.4, 1)).toBe(0);
  });
  it('wheel rotation: 1:1 when the wheel and car rotation match, scaled otherwise', () => {
    expect(wheelSteer(0.5, 360, 360)).toBeCloseTo(0.5);
    // 900° wheel, 360° car: full car lock at 180° of wheel = 0.4 of the axis
    expect(wheelSteer(0.4, 900, 360)).toBeCloseTo(1);
    expect(wheelSteer(0.2, 900, 360)).toBeCloseTo(0.5);
    expect(wheelSteer(0.9, 900, 360)).toBe(1);
  });
});

describe('device identification and glyphs', () => {
  it('parses Chrome and Firefox id formats', () => {
    expect(parseIds('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)')).toEqual({ vendor: '054c', product: '0ce6' });
    expect(parseIds('54c-5c4-Wireless Controller')).toEqual({ vendor: '054c', product: '05c4' });
    expect(parseIds('xinput')).toEqual({ vendor: null, product: null });
  });
  it('classifies pads and wheels', () => {
    expect(identify('Xbox 360 Controller (XInput STANDARD GAMEPAD)', 'standard').kind).toBe('xbox');
    expect(identify('xinput', 'standard').kind).toBe('xbox');
    expect(identify('045e-0b13-Xbox Wireless Controller', 'standard').kind).toBe('xbox');
    expect(identify('054c-0ce6-DualSense Wireless Controller', 'standard').kind).toBe('dualsense');
    expect(identify('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)', 'standard').kind).toBe('dualshock4');
    expect(identify('Logitech G29 Driving Force Racing Wheel (Vendor: 046d Product: c24f)', '').kind).toBe('wheel');
    expect(identify('046d-c262-Logitech G920 Driving Force Racing Wheel', '').kind).toBe('wheel');
    expect(identify('0eb7-0e04-FANATEC Podium Wheel Base DD1', '').kind).toBe('wheel');
    expect(identify('Generic USB Joystick (Vendor: 0079 Product: 0006)', '').kind).toBe('gamepad');
  });
  it('remaps the raw Sony layout only when the browser did not', () => {
    expect(identify('054c-05c4-Wireless Controller', '').remap).toBe('sony-hid');
    expect(identify('054c-05c4-Wireless Controller', 'standard').remap).toBeNull();
    const raw = { buttons: Array(14).fill(0) as number[], axes: [0.1, 0.2, 0.3, -1, 1, 0.4, 0, 0, 0, -1] };
    raw.buttons[1] = 1; // ✕
    const r = remapToStandard('sony-hid', raw.buttons, raw.axes);
    expect(r.buttons[0]).toBe(1); // ✕ → standard south
    expect(r.buttons[6]).toBe(0); // L2 at rest
    expect(r.buttons[7]).toBe(1); // R2 fully pressed
    expect(r.buttons[12]).toBe(1); // hat −1 = up
    expect(r.axes).toEqual([0.1, 0.2, 0.3, 0.4]);
  });
  it('shows the right glyphs per controller', () => {
    expect(buttonGlyph('dualsense', true, 0)).toBe('✕');
    expect(buttonGlyph('dualshock4', true, 8)).toBe('Share');
    expect(buttonGlyph('dualsense', true, 8)).toBe('Create');
    expect(buttonGlyph('xbox', true, 7)).toBe('RT');
    expect(buttonGlyph('wheel', false, 4)).toBe('Button 5');
  });
});

describe('bindings, persistence and hot-plugging', () => {
  it('rebinding persists across a reload and can be reset', () => {
    const storage = new MemStorage();
    const a = new InputConfigStore(storage);
    a.bind('keyboard', 'keyboard', true, 'throttle', { type: 'key', code: 'KeyI' }, true);
    a.update('keyboard', 'keyboard', true, (c) => (c.keyboard.steerSpeed = 3.3));
    expect(storage.getItem(STORAGE_KEY)).toContain('KeyI');
    // "reload"
    const b = new InputConfigStore(storage);
    const kb = b.get('keyboard', 'keyboard');
    expect(kb.bindings.throttle).toEqual([{ type: 'key', code: 'KeyI' }]);
    expect(kb.keyboard.steerSpeed).toBe(3.3);
    b.reset('keyboard');
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    expect(new InputConfigStore(storage).get('keyboard', 'keyboard').bindings.throttle.map((s) => (s.type === 'key' ? s.code : ''))).toEqual(['KeyW', 'ArrowUp']);
  });
  it('a control moves to the new action instead of driving two actions', () => {
    const s = new InputConfigStore(null);
    const displaced = s.bind('pad:x', 'xbox', true, 'overtake', { type: 'button', index: 7 });
    expect(displaced).toBe('throttle');
    expect(s.get('pad:x', 'xbox').bindings.throttle).toEqual([]);
  });
  it('binding a pedal replaces the previous pedal axis on that action', () => {
    const s = new InputConfigStore(null);
    s.bind('pad:w', 'wheel', false, 'brake', { type: 'axisFull', index: 1, invert: true });
    expect(s.get('pad:w', 'wheel', false).bindings.brake).toEqual([{ type: 'axisFull', index: 1, invert: true }]);
  });
  it('survives corrupt or partial stored settings', () => {
    const storage = new MemStorage();
    storage.setItem(STORAGE_KEY, '{not json');
    expect(new InputConfigStore(storage).get('keyboard', 'keyboard').bindings.brake.length).toBe(2);
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, devices: { keyboard: { kind: 'keyboard', bindings: { brake: [{ type: 'key', code: 'KeyK' }, { bogus: 1 }] } } } }));
    const c = new InputConfigStore(storage).get('keyboard', 'keyboard');
    expect(c.bindings.brake).toEqual([{ type: 'key', code: 'KeyK' }]);
    expect(c.bindings.throttle.length).toBe(2);
    expect(c.curves.steer.saturation).toBe(1);
  });
  it('per-device configs are independent', () => {
    const s = new InputConfigStore(null);
    s.update('pad:a', 'xbox', true, (c) => (c.curves.steer.deadzone = 0.2));
    expect(s.get('pad:b', 'xbox').curves.steer.deadzone).toBe(0.08);
  });
  it('hot-plugging: pads appear and disappear at any time, and inputs release on disconnect', () => {
    const pads: (MockPad | null)[] = [];
    const mgr = new InputManager(new InputConfigStore(null), () => pads);
    const events: string[] = [];
    mgr.onEvent = (e) => events.push(`${e.type}:${e.device.kind}`);
    mgr.update(0.01);
    const x = xboxPad(0);
    pads[0] = x;
    x.press(7, 1);
    expect(mgr.update(0.01).throttle).toBe(1);
    const w = g29Wheel(1);
    pads[1] = w;
    mgr.update(0.01);
    x.connected = false;
    expect(mgr.update(0.01).throttle).toBe(0);
    pads[0] = dualSensePad(0);
    mgr.update(0.01);
    expect(events).toEqual(['connected:xbox', 'connected:wheel', 'disconnected:xbox', 'connected:dualsense']);
    expect(mgr.devices().map((d) => d.kind)).toEqual(['keyboard', 'wheel', 'dualsense']);
  });
  it('a wheel whose pedal axes still read 0 (never moved) does not apply half throttle', () => {
    const w = new MockPad('Logitech G29 Driving Force Racing Wheel (Vendor: 046d Product: c24f)', 0, '', 6, 25);
    const mgr = new InputManager(new InputConfigStore(null), () => [w]);
    expect(mgr.update(0.01).throttle).toBe(0);
    w.axes[2] = 0.999;
    expect(mgr.update(0.01).throttle).toBe(0);
    w.axes[2] = -1;
    expect(mgr.update(0.01).throttle).toBe(1);
  });
  it('toggles latch on press, one-shot actions fire once', () => {
    const p = xboxPad();
    const mgr = new InputManager(new InputConfigStore(null), () => [p]);
    p.press(3);
    expect(mgr.update(0.01).aeroRequest).toBe(true);
    expect(mgr.update(0.01).aeroRequest).toBe(true);
    p.press(3, 0);
    mgr.update(0.01);
    p.press(3);
    expect(mgr.update(0.01).aeroRequest).toBe(false);
    p.press(8);
    mgr.update(0.01);
    expect(mgr.pressed('reset')).toBe(true);
    mgr.update(0.01);
    expect(mgr.pressed('reset')).toBe(false);
  });
  it('bind capture: buttons, stick halves and pedals (full axis with direction)', () => {
    const w = g29Wheel();
    w.axes[0] = 0.01;
    const mgr = new InputManager(new InputConfigStore(null), () => [w]);
    mgr.poll();
    const key = `pad:${w.id}`;
    let cap = mgr.beginCapture(key, true);
    expect(cap()).toBeNull();
    w.axes[1] = -1; // clutch pedal pressed
    mgr.poll();
    expect(cap()).toEqual({ type: 'axisFull', index: 1, invert: true });
    w.axes[1] = 1;
    mgr.poll();
    cap = mgr.beginCapture(key, false);
    w.press(4);
    mgr.poll();
    expect(cap()).toEqual({ type: 'button', index: 4 });
    const ds = ds4RawPad();
    const m2 = new InputManager(new InputConfigStore(null), () => [ds]);
    m2.poll();
    const c2 = m2.beginCapture(`pad:${ds.id}`, true);
    ds.axes[2] = 0.9; // right stick right
    m2.poll();
    expect(c2()).toEqual({ type: 'axis', index: 2, dir: 1 });
    const kc = m2.beginCapture('keyboard', false);
    expect(kc('KeyF')).toBeNull(); // reserved
    expect(kc('KeyK')).toEqual({ type: 'key', code: 'KeyK' });
  });
  it('keyboard smoothing and speed-sensitive steering', () => {
    const mgr = new InputManager(new InputConfigStore(null));
    mgr.keyDown('KeyA');
    let s = 0;
    for (let i = 0; i < 10; i++) s = mgr.update(0.05, 0).steer;
    expect(s).toBeCloseTo(1); // 2.2/s → full lock within 0.5 s
    for (let i = 0; i < 40; i++) s = mgr.update(0.05, 80).steer;
    expect(s).toBeLessThan(0.65); // 0.3 sensitivity at 80 m/s
    mgr.keyUp('KeyA');
    for (let i = 0; i < 4; i++) s = mgr.update(0.05, 0).steer;
    expect(s).toBe(0);
  });
});

describe('rumble', () => {
  const wheel = (o: Partial<WheelTelemetry> = {}): WheelTelemetry => ({ fz: 3000, slipRatio: 0, slipAngle: 0, omega: 0, surface: 'tarmac', surfaceC: 90, carcassC: 90, wear: 0, utilisation: 0, outside: false, ...o });
  const tel = (o: Partial<VehicleTelemetry>, wheels: WheelTelemetry[]): VehicleTelemetry => ({ speedMs: 50, throttle: 0, brake: 0, impact: 0, wheels, ...o }) as VehicleTelemetry;
  it('kerbs, lock-ups, wheelspin and impacts each produce a cue; clean driving none', () => {
    expect(rumbleCues(tel({}, [wheel(), wheel(), wheel(), wheel()]), 0)).toEqual({ kerb: 0, lockup: 0, wheelspin: 0, rough: 0, impact: 0 });
    expect(rumbleCues(tel({}, [wheel({ surface: 'kerb' }), wheel(), wheel({ surface: 'kerb' }), wheel()]), 0).kerb).toBeGreaterThan(0.5);
    expect(rumbleCues(tel({ brake: 1 }, [wheel({ slipRatio: -0.4 }), wheel(), wheel(), wheel()]), 0).lockup).toBeGreaterThan(0.9);
    expect(rumbleCues(tel({ throttle: 1, speedMs: 15 }, [wheel(), wheel(), wheel({ slipRatio: 0.5 }), wheel({ slipRatio: 0.4 })]), 0).wheelspin).toBeGreaterThan(0.9);
    expect(rumbleCues(tel({}, [wheel(), wheel(), wheel(), wheel()]), 10).impact).toBe(1);
  });
  it('the manager sends dual-rumble effects to pads that support them, scaled by the strength setting', () => {
    const p = xboxPad();
    const mgr = new InputManager(new InputConfigStore(null), () => [p]);
    mgr.poll();
    mgr.config.update(`pad:${p.id}`, 'xbox', true, (c) => (c.rumble.strength = 0.5));
    const t = tel({ brake: 1 }, [wheel({ slipRatio: -0.5 }), wheel(), wheel(), wheel()]);
    const out = mgr.rumble(t, 0, 1 / 60);
    expect(out.weak).toBeCloseTo(0.45, 2);
    expect(p.rumbleLog.length).toBe(1);
    // stopping sends a zero effect once
    mgr.rumble(tel({}, [wheel(), wheel(), wheel(), wheel()]), 0, 1 / 60);
    expect(p.rumbleLog.at(-1)).toEqual({ strong: 0, weak: 0 });
    const e = new RumbleEngine();
    expect(e.update(t, 0, 0.01, 0).weak).toBe(0);
  });
});

describe('keyboard taps', () => {
  it('a key pressed and released between two frames still fires its action once', () => {
    const mgr = new InputManager(new InputConfigStore(null));
    mgr.update(0.016);
    mgr.keyDown('KeyV');
    mgr.keyUp('KeyV');
    mgr.update(0.016);
    expect(mgr.pressed('camera')).toBe(true);
    mgr.update(0.016);
    expect(mgr.pressed('camera')).toBe(false);
  });
});
