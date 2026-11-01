import type { CarSpec } from '../spec';
import { IceModel, RPM_TO_RAD } from './ice';
import type { PowerUnit, PowerUnitInput, PowerUnitOutput } from './interfaces';

/** Naturally aspirated engine with no hybrid system (used by the test-only car). */
export class NaEngine implements PowerUnit {
  readonly id = 'na-engine';
  readonly hybrid = false;
  private readonly ice: IceModel;

  constructor(spec: CarSpec) {
    this.ice = new IceModel(spec.powerUnitParams.ice, spec.fuel.lhvMJPerKg);
  }

  get idleRpm(): number {
    return this.ice.spec.idleRpm;
  }
  get revLimitRpm(): number {
    return this.ice.spec.revLimitRpm;
  }
  get upshiftRpm(): number {
    return this.ice.spec.upshiftRpm;
  }
  get downshiftRpm(): number {
    return this.ice.spec.downshiftRpm;
  }
  maxIcePowerKw(): number {
    return this.ice.maxPowerKw();
  }

  step(inp: PowerUnitInput): PowerUnitOutput {
    const t = this.ice.torqueNm(inp.engineRpm, inp.throttle);
    const kw = Math.max(0, (t * Math.max(inp.engineRpm, 1000) * RPM_TO_RAD) / 1000);
    return { crankTorqueNm: t, regenPowerW: 0, fuelKgPerS: this.ice.fuelKgPerS(kw), iceKw: kw, electricKw: 0, derating: false, superclip: false };
  }

  settleRegen(): void {}
}
