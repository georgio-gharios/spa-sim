/**
 * Minimal keyboard driving input for the Phase 2 prototype (Phase 3 replaces it with full rebindable
 * keyboard/gamepad/wheel support). Digital keys are smoothed into analogue-feeling axes.
 */
import type { DriverInput } from '../physics/Vehicle';

export interface KeyboardFeel {
  steerSpeed: number;
  steerReturn: number;
  throttleRise: number;
  throttleFall: number;
  brakeRise: number;
  brakeFall: number;
}

export const DEFAULT_FEEL: KeyboardFeel = { steerSpeed: 2.2, steerReturn: 4.5, throttleRise: 5, throttleFall: 8, brakeRise: 7, brakeFall: 10 };

const approach = (v: number, target: number, rate: number, dt: number) =>
  v < target ? Math.min(target, v + rate * dt) : Math.max(target, v - rate * dt);

export class KeyboardDriver {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private steer = 0;
  private throttle = 0;
  private brake = 0;
  aeroLatch = false;
  pitLimiter = false;

  constructor(public feel: KeyboardFeel = DEFAULT_FEEL) {
    window.addEventListener('keydown', (e) => {
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  /** Was the key pressed since the last call (edge)? */
  consume(code: string): boolean {
    const p = this.pressed.has(code);
    this.pressed.delete(code);
    return p;
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  update(dt: number): DriverInput {
    const d = this.down;
    const left = d.has('KeyA') || d.has('ArrowLeft');
    const right = d.has('KeyD') || d.has('ArrowRight');
    const gas = d.has('KeyW') || d.has('ArrowUp');
    const brk = d.has('KeyS') || d.has('ArrowDown');
    const target = (left ? 1 : 0) - (right ? 1 : 0);
    const rate = target === 0 || Math.sign(target) !== Math.sign(this.steer) ? this.feel.steerReturn : this.feel.steerSpeed;
    this.steer = approach(this.steer, target, rate, dt);
    this.throttle = approach(this.throttle, gas ? 1 : 0, gas ? this.feel.throttleRise : this.feel.throttleFall, dt);
    this.brake = approach(this.brake, brk ? 1 : 0, brk ? this.feel.brakeRise : this.feel.brakeFall, dt);
    if (this.consume('KeyX')) this.aeroLatch = !this.aeroLatch;
    if (this.consume('KeyP')) this.pitLimiter = !this.pitLimiter;
    return {
      throttle: this.throttle,
      brake: this.brake,
      steer: this.steer,
      shiftUp: d.has('KeyE') || d.has('ShiftRight'),
      shiftDown: d.has('KeyQ') || d.has('ControlRight'),
      aeroRequest: this.aeroLatch,
      overtake: d.has('KeyO'),
      pitLimiter: this.pitLimiter,
    };
  }
}
