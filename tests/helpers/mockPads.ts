/**
 * Mock Gamepad API devices with the real layouts of each controller, plus "virtual hands" that turn a
 * desired DriverInput into raw device state (the way a player moves sticks, triggers, pedals and keys).
 */
import type { GamepadLike, InputManager } from '../../src/input/InputManager';
import type { AxisCurve } from '../../src/input/curves';
import type { DriverInput } from '../../src/physics/Vehicle';

export class MockPad implements GamepadLike {
  connected = true;
  axes: number[];
  buttons: { value: number; pressed: boolean }[];
  rumbleLog: { strong: number; weak: number }[] = [];
  vibrationActuator = {
    playEffect: (_type: string, p: Record<string, number>) => {
      this.rumbleLog.push({ strong: p.strongMagnitude ?? 0, weak: p.weakMagnitude ?? 0 });
      return Promise.resolve('complete');
    },
  };

  constructor(
    readonly id: string,
    readonly index: number,
    readonly mapping: string,
    nAxes: number,
    nButtons: number,
    restAxes: Record<number, number> = {},
  ) {
    this.axes = Array.from({ length: nAxes }, (_, i) => restAxes[i] ?? 0);
    this.buttons = Array.from({ length: nButtons }, () => ({ value: 0, pressed: false }));
  }

  press(i: number, v = 1): void {
    this.buttons[i] = { value: v, pressed: v > 0.5 };
  }
}

/** Chrome, XInput: standard mapping. */
export const xboxPad = (index = 0) => new MockPad('Xbox 360 Controller (XInput STANDARD GAMEPAD)', index, 'standard', 4, 17);
/** Chrome, DualSense over USB: standard mapping (18 buttons incl. touchpad). */
export const dualSensePad = (index = 0) => new MockPad('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)', index, 'standard', 4, 18);
/** Firefox, DualShock 4 without remapping: raw Sony HID layout (triggers on axes 3/4 resting at −1, hat on axis 9). */
export const ds4RawPad = (index = 0) => new MockPad('054c-05c4-Wireless Controller', index, '', 10, 14, { 3: -1, 4: -1, 9: 3.2857 });
/** Chrome, Logitech G29: wheel on axis 0, throttle axis 2, brake axis 5 (pedals rest at +1). */
export const g29Wheel = (index = 0) => new MockPad('Logitech G29 Driving Force Racing Wheel (Vendor: 046d Product: c24f)', index, '', 6, 25, { 1: 1, 2: 1, 5: 1 });

/** Inverse of curves.shape(): the stick travel needed for a wanted output. */
export function inverseShape(y: number, c: AxisCurve): number {
  if (y <= 0) return 0;
  if (y >= 1) return c.saturation;
  return c.deadzone + Math.pow(y, 1 / c.linearity) * (c.saturation - c.deadzone);
}

export type Hand = (want: DriverInput, mgr: InputManager) => void;

/** Standard-mapping pad: left stick X steers, RT/R2 (button 7) throttle, LT/L2 (button 6) brake. */
export function standardPadHand(pad: MockPad): Hand {
  return (w, mgr) => {
    const c = mgr.configFor(mgr.device(`pad:${pad.id}`)!).curves;
    pad.axes[0] = -Math.sign(w.steer) * inverseShape(Math.abs(w.steer), c.steer);
    pad.press(7, inverseShape(w.throttle, c.throttle));
    pad.press(6, inverseShape(w.brake, c.brake));
    pad.press(0, w.shiftUp ? 1 : 0);
    pad.press(2, w.shiftDown ? 1 : 0);
  };
}

/** Raw DS4 (Firefox): triggers are axes 3/4 over −1..1. */
export function ds4RawHand(pad: MockPad): Hand {
  return (w, mgr) => {
    const c = mgr.configFor(mgr.device(`pad:${pad.id}`)!).curves;
    pad.axes[0] = -Math.sign(w.steer) * inverseShape(Math.abs(w.steer), c.steer);
    pad.axes[4] = inverseShape(w.throttle, c.throttle) * 2 - 1;
    pad.axes[3] = inverseShape(w.brake, c.brake) * 2 - 1;
  };
}

/** Wheel: steering angle through the rotation setting, pedals from rest (+1) towards −1. */
export function wheelHand(pad: MockPad): Hand {
  return (w, mgr) => {
    const cfg = mgr.configFor(mgr.device(`pad:${pad.id}`)!);
    pad.axes[0] = (-w.steer * cfg.wheel.carDeg) / cfg.wheel.hardwareDeg;
    pad.axes[2] = 1 - 2 * inverseShape(w.throttle, cfg.curves.throttle);
    pad.axes[5] = 1 - 2 * inverseShape(w.brake, cfg.curves.brake);
  };
}

/**
 * Keyboard: a player tapping keys. Hold a key while the smoothed value is short of the target; the
 * manager's smoothing turns the pulses into a usable analogue value (like a real keyboard driver feathering).
 */
export function keyboardHand(): Hand {
  return (w, mgr) => {
    const cur = mgr.current;
    const set = (code: string, on: boolean) => (on ? mgr.keyDown(code) : mgr.keyUp(code));
    set('KeyA', w.steer > cur.steer + 0.01);
    set('KeyD', w.steer < cur.steer - 0.01);
    set('KeyW', w.throttle > 0.98 || w.throttle > cur.throttle);
    set('KeyS', w.brake > 0.02 && (w.brake > 0.98 || w.brake > cur.brake));
  };
}
