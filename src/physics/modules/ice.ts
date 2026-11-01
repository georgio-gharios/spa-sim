import type { IceSpec } from '../spec';

const RPM_TO_RAD = (2 * Math.PI) / 60;

/** Shared internal-combustion engine model: power curve, torque, engine braking, fuel use. */
export class IceModel {
  constructor(readonly spec: IceSpec, readonly lhvMJPerKg: number) {
    if (spec.rpm.length !== spec.kw.length || spec.rpm.length < 2) throw new Error('ICE curve: rpm/kw length mismatch');
  }

  powerKw(rpm: number): number {
    const { rpm: r, kw } = this.spec;
    if (rpm <= r[0]!) return kw[0]! * Math.max(0, rpm / r[0]!);
    for (let i = 1; i < r.length; i++) {
      if (rpm <= r[i]!) {
        const f = (rpm - r[i - 1]!) / (r[i]! - r[i - 1]!);
        return kw[i - 1]! + (kw[i]! - kw[i - 1]!) * f;
      }
    }
    return kw[kw.length - 1]!;
  }

  maxPowerKw(): number {
    return Math.max(...this.spec.kw);
  }

  /** Crank torque for a throttle position (0..1); negative = engine braking. */
  torqueNm(rpm: number, throttle: number): number {
    if (rpm >= this.spec.revLimitRpm) return -this.engineBrakeNm(rpm);
    const omega = Math.max(rpm, 500) * RPM_TO_RAD;
    const full = (this.powerKw(rpm) * 1000) / omega;
    const brake = this.engineBrakeNm(rpm) * (1 - Math.min(1, throttle / 0.08));
    return full * throttle - brake;
  }

  engineBrakeNm(rpm: number): number {
    return this.spec.engineBrakeNmAtMaxRpm * Math.min(1, Math.max(0, rpm - this.spec.idleRpm) / (this.spec.revLimitRpm - this.spec.idleRpm));
  }

  /** Fuel mass flow (kg/s) for a delivered shaft power (kW). */
  fuelKgPerS(shaftKw: number): number {
    const idleKw = 8;
    return ((Math.max(0, shaftKw) + idleKw) * 1000) / this.spec.thermalEfficiency / (this.lhvMJPerKg * 1e6);
  }
}

export { RPM_TO_RAD };
