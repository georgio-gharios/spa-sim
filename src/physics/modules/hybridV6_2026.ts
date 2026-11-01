import type { CarSpec, EnergyPreset, RuleSetData } from '../spec';
import { IceModel, RPM_TO_RAD } from './ice';
import type { EnergyStore, PowerUnit, PowerUnitInput, PowerUnitOutput } from './interfaces';

/**
 * 2026 power unit: ~400 kW turbo V6 (no MGU-H) + 350 kW crank-coupled MGU-K with a speed taper,
 * deploy/harvest strategy from an energy preset, superclipping at full throttle, brake-by-wire regen.
 */
export class HybridV6_2026 implements PowerUnit {
  readonly id = 'hybrid-v6-2026';
  readonly hybrid = true;
  private readonly ice: IceModel;
  private readonly mgukMaxW: number;
  private readonly eff: number;
  private readonly presets: Record<string, EnergyPreset>;
  private readonly taper: { fullUntilKmh: number; zeroAtKmh: number };
  private readonly overtakeTaper: { fullUntilKmh: number; zeroAtKmh: number } | null;

  constructor(spec: CarSpec, rules: RuleSetData) {
    const p = spec.powerUnitParams;
    if (!p.mguk || !p.energyPresets) throw new Error('hybrid-v6-2026 needs mguk and energyPresets');
    if (!rules.energy) throw new Error('hybrid-v6-2026 needs a RuleSet energy block');
    this.ice = new IceModel(p.ice, spec.fuel.lhvMJPerKg);
    this.mgukMaxW = Math.min(p.mguk.maxKw, rules.energy.mgukMaxKw) * 1000;
    this.eff = p.mguk.efficiency;
    this.presets = p.energyPresets;
    this.taper = rules.energy.mgukTaper;
    this.overtakeTaper = rules.overtake?.enabled ? rules.overtake.mgukTaper : null;
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

  /** Regulation taper: maximum electrical deployment (W) at a given speed. */
  deployLimitW(speedKmh: number, overtake: boolean): number {
    const t = overtake && this.overtakeTaper ? this.overtakeTaper : this.taper;
    if (speedKmh <= t.fullUntilKmh) return this.mgukMaxW;
    if (speedKmh >= t.zeroAtKmh) return 0;
    return (this.mgukMaxW * (t.zeroAtKmh - speedKmh)) / (t.zeroAtKmh - t.fullUntilKmh);
  }

  step(inp: PowerUnitInput, store: EnergyStore | null): PowerUnitOutput {
    const preset = this.presets[inp.energyPreset] ?? this.presets.balanced ?? Object.values(this.presets)[0]!;
    const kmh = inp.speedMs * 3.6;
    const omega = Math.max(inp.engineRpm, 1000) * RPM_TO_RAD;
    const iceTorque = this.ice.torqueNm(inp.engineRpm, inp.throttle);
    const iceKw = Math.max(0, (iceTorque * omega) / 1000);
    let electricW = 0;
    let derating = false;
    let superclip = false;
    let regenPowerW = 0;
    const socFloorJ = preset.socFloor * (store ? store.telemetry().windowMJ * 1e6 : 0);

    if (store && inp.engaged) {
      const full = inp.throttle > 0.7;
      if (full && kmh >= preset.superclipFromKmh && !inp.overtakeActive) {
        // superclipping: the MGU-K harvests while the driver is flat out (end of long straights)
        const want = Math.min(preset.superclipKw * 1000, this.mgukMaxW);
        const got = store.harvest(want * this.eff * inp.dt);
        electricW = -got / (this.eff * inp.dt);
        superclip = got > 0;
      } else if (full && kmh >= preset.deployMinSpeedKmh) {
        const ramp = Math.min(1, (inp.throttle - 0.7) / 0.25);
        const want = this.deployLimitW(kmh, inp.overtakeActive) * ramp;
        const available = Math.max(0, Math.min(store.deployableJ(), store.telemetry().socMJ * 1e6 - socFloorJ));
        const need = (want * inp.dt) / this.eff;
        const got = store.deploy(Math.min(need, available));
        electricW = (got * this.eff) / inp.dt;
        derating = want > 1000 && electricW < want * 0.98;
      } else if (inp.throttle < 0.05 && inp.brake < 0.05 && kmh > 80) {
        // lift-and-coast harvesting through the crank
        const want = Math.min(preset.liftHarvestKw * 1000, this.mgukMaxW);
        const got = store.harvest(want * this.eff * inp.dt);
        electricW = -got / (this.eff * inp.dt);
      }
      if (inp.brake > 0.05 && kmh > 30) {
        // brake-by-wire regen at the rear axle; energy is settled after the core applies the torque
        regenPowerW = Math.min(this.mgukMaxW, store.harvestableJ() / inp.dt / this.eff) * Math.min(1, inp.brake / 0.3);
      }
    }
    const crankTorqueNm = iceTorque + (inp.engaged ? electricW / omega : 0);
    return {
      crankTorqueNm,
      regenPowerW,
      fuelKgPerS: inp.throttle > 0.02 ? this.ice.fuelKgPerS(iceKw) : this.ice.fuelKgPerS(0),
      iceKw,
      electricKw: electricW / 1000,
      derating,
      superclip,
    };
  }

  settleRegen(axleTorqueNm: number, axleOmega: number, dt: number, store: EnergyStore | null): void {
    if (!store || axleTorqueNm <= 0) return;
    store.harvest(axleTorqueNm * Math.abs(axleOmega) * this.eff * dt);
  }
}
