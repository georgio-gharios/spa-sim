/**
 * Scripted driver for headless tests and (later) the base of the AI: pure-pursuit steering on a path plus
 * curvature feed-forward, and speed tracking against a target-speed profile with a traction guard.
 */
import type { DriverInput, Vehicle } from '../physics/Vehicle';
import type { RacingLine } from './racing-line/minCurvature';

export interface DriverTuning {
  /** Multiply the target-speed profile (e.g. 0.9 for a safe lap). */
  paceScale: number;
  lookaheadMin: number;
  lookaheadPerMs: number;
  brakeGain: number;
  headingGain: number;
  lateralGain: number;
  yawRateGain: number;
  betaGain: number;
  /** Curvature feed-forward preview time (s). */
  previewS: number;
}

export const DEFAULT_TUNING: DriverTuning = {
  paceScale: 1,
  lookaheadMin: 9,
  lookaheadPerMs: 0.28,
  brakeGain: 0.35,
  headingGain: 1.3,
  lateralGain: 2.5,
  yawRateGain: 0,
  betaGain: 0.5,
  previewS: 0.25,
};

export class ScriptedDriver {
  private idx = 0;
  private throttleCut = 0;
  private brakeCmd = 0;
  private lastThrottle = 0;
  private lastBrake = 0;
  readonly tuning: DriverTuning;

  constructor(
    private readonly line: RacingLine,
    private readonly targetV: Float64Array,
    tuning: Partial<DriverTuning> = {},
  ) {
    this.tuning = { ...DEFAULT_TUNING, ...tuning };
  }

  /** Nearest line index to the car, searched locally from the last index. */
  private locate(x: number, y: number): number {
    const N = this.line.x.length;
    let best = this.idx;
    let bestD = Infinity;
    for (let k = -30; k <= 60; k++) {
      const i = (((this.idx + k) % N) + N) % N;
      const d = (this.line.x[i]! - x) ** 2 + (this.line.y[i]! - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (bestD > 400) {
      for (let i = 0; i < N; i++) {
        const d = (this.line.x[i]! - x) ** 2 + (this.line.y[i]! - y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    this.idx = best;
    return best;
  }

  reset(car: Vehicle): void {
    this.idx = 0;
    this.locate(car.x, car.y);
  }

  update(car: Vehicle): DriverInput {
    const L = this.line;
    const N = L.x.length;
    const step = L.length / N;
    const i = this.locate(car.x, car.y);
    const v = Math.max(1, car.vx);
    // ---- steering: path tracker = curvature feed-forward at a preview point + heading and lateral-error
    // feedback (Stanley-style) + yaw-rate damping + countersteer on body slip
    const look = this.tuning.lookaheadMin + this.tuning.lookaheadPerMs * v;
    const pv = (i + Math.max(1, Math.round((v * this.tuning.previewS) / step))) % N;
    const kFF = 0.5 * (L.k[pv]! + L.k[(pv + 1) % N]!);
    const a = (i - 1 + N) % N;
    const b2 = (i + 1) % N;
    const lineHeading = Math.atan2(L.y[b2]! - L.y[a]!, L.x[b2]! - L.x[a]!);
    let headErr = lineHeading - car.yaw;
    headErr = Math.atan2(Math.sin(headErr), Math.cos(headErr));
    // signed lateral error: + when the line is to the car's left
    const ex = L.x[i]! - car.x;
    const ey = L.y[i]! - car.y;
    const latErr = -ex * Math.sin(car.yaw) + ey * Math.cos(car.yaw);
    const wb = car.spec.dimensions.wheelbaseM;
    const beta = Math.atan2(car.vy, Math.max(5, car.vx));
    const yawErr = kFF * v - car.r;
    const tu = this.tuning;
    let delta =
      Math.atan(wb * kFF) + tu.headingGain * headErr + Math.atan((tu.lateralGain * latErr) / (v + 6)) + tu.yawRateGain * yawErr + tu.betaGain * beta;
    void look;
    const maxA = car.spec.steering.maxWheelAngleRad;
    // don't steer the fronts far past their peak slip angle (more lock = less grip beyond the peak)
    const tmF = car.spec.tyreModel;
    const aFront = (car.vy + car.r * car.wheels[0]!.x) / Math.max(5, car.vx);
    const lim = 1.15 * tmF.peakSlipAngleRad;
    delta = Math.max(aFront - lim, Math.min(aFront + lim, delta));
    delta = Math.max(-maxA, Math.min(maxA, delta));
    const steer = delta / maxA;
    // ---- speed: target a little ahead (reaction + brake build-up)
    const ahead = (i + Math.max(1, Math.round((v * 0.12) / step))) % N;
    const vt = this.targetV[ahead]! * this.tuning.paceScale;
    const err = vt - v;
    let throttle = 0;
    let brake = 0;
    // flat out unless over the target; over-speed beyond the deadband means braking
    if (err > -1.2) throttle = Math.min(1, Math.max(0, (err + 1.2) / 1.2));
    // traction guard (what a driver does with the right foot): back off on wheelspin or when the rear tyres
    // are already past their combined-slip peak (power oversteer)
    const tm = car.spec.tyreModel;
    const rearSigma = Math.max(
      ...[car.wheels[2]!, car.wheels[3]!].map((w) => Math.hypot(w.kappa / tm.peakSlipRatio, Math.tan(w.alpha) / Math.tan(tm.peakSlipAngleRad))),
    );
    const rearSlip = Math.max(car.wheels[2]!.kappa, car.wheels[3]!.kappa);
    const frontSigma = Math.max(
      ...[car.wheels[0]!, car.wheels[1]!].map((w) => Math.hypot(w.kappa / tm.peakSlipRatio, Math.tan(w.alpha) / Math.tan(tm.peakSlipAngleRad))),
    );
    // running out of road on the exit: ease off so the car tightens its line (keep two wheels on)
    const track = car.env.track;
    const edge = car.d >= 0 ? track.widthRight(car.s) : track.widthLeft(car.s);
    const room = edge - Math.abs(car.d);
    const outwardSpeed = (car.vx * Math.sin(car.yaw - track.sample(car.s).heading) + car.vy * Math.cos(car.yaw - track.sample(car.s).heading)) * (car.d >= 0 ? -1 : 1);
    const runningWide = room < 0.5 && outwardSpeed > 0.5;
    const over = rearSlip > 0.12 || rearSigma > 1.05 || frontSigma > 1.2 || runningWide;
    this.throttleCut = over ? Math.min(0.9, this.throttleCut + 0.04) : Math.max(0, this.throttleCut - 0.015);
    throttle *= 1 - this.throttleCut;
    // threshold braking: hold the most-loaded wheels near peak slip instead of locking
    const demand = err < -1.2 ? Math.min(1, -err * this.tuning.brakeGain) : 0;
    if (demand > 0) {
      const minSlip = Math.min(car.wheels[0]!.kappa, car.wheels[1]!.kappa, car.wheels[2]!.kappa, car.wheels[3]!.kappa);
      if (this.brakeCmd < 0.05) this.brakeCmd = Math.min(demand, 0.35);
      if (minSlip < -0.11) this.brakeCmd -= 0.035;
      else if (minSlip > -0.075) this.brakeCmd += 0.02;
      this.brakeCmd = Math.max(0, Math.min(demand, this.brakeCmd));
      brake = this.brakeCmd;
      throttle = 0;
    } else {
      this.brakeCmd = 0;
    }
    // human-like pedal rates: ~0.25 s to full throttle, ~0.1 s to full brake
    const dtStep = 1 / 500;
    throttle = Math.min(throttle, this.lastThrottle + dtStep / 0.25);
    brake = Math.min(brake, this.lastBrake + dtStep / 0.1);
    this.lastThrottle = throttle;
    this.lastBrake = brake;
    return { throttle, brake, steer, shiftUp: false, shiftDown: false, aeroRequest: false, overtake: false, pitLimiter: false };
  }

  get index(): number {
    return this.idx;
  }
}
