import type { CarSpec, RuleSetData } from '../spec';
import type { EnergyStore, EnergyStoreTelemetry } from './interfaces';

const MJ = 1e6;

/** 2026 energy store: usable SoC window plus per-lap harvest and deploy limits from the RuleSet. */
export class EnergyStore2026 implements EnergyStore {
  readonly id = 'es-2026';
  private readonly windowJ: number;
  private socJ: number;
  private harvestedLapJ = 0;
  private deployedLapJ = 0;
  private harvestLimitJ: number;
  private deployLimitJ: number;
  private readonly baseLimitJ: number;

  constructor(_spec: CarSpec, rules: RuleSetData) {
    if (!rules.energy) throw new Error('es-2026 needs a RuleSet with an energy block');
    this.windowJ = rules.energy.esSocWindowMJ * MJ;
    this.baseLimitJ = rules.energy.harvestPerLapMJ * MJ;
    this.harvestLimitJ = this.baseLimitJ;
    this.deployLimitJ = this.baseLimitJ;
    this.socJ = this.windowJ;
  }

  deployableJ(): number {
    return Math.max(0, Math.min(this.socJ, this.deployLimitJ - this.deployedLapJ));
  }

  harvestableJ(): number {
    return Math.max(0, Math.min(this.windowJ - this.socJ, this.harvestLimitJ - this.harvestedLapJ));
  }

  deploy(j: number): number {
    const d = Math.max(0, Math.min(j, this.deployableJ()));
    this.socJ -= d;
    this.deployedLapJ += d;
    return d;
  }

  harvest(j: number): number {
    const h = Math.max(0, Math.min(j, this.harvestableJ()));
    this.socJ += h;
    this.harvestedLapJ += h;
    return h;
  }

  onNewLap(extraMJ: number): void {
    this.harvestedLapJ = 0;
    this.deployedLapJ = 0;
    this.harvestLimitJ = this.baseLimitJ + extraMJ * MJ;
    this.deployLimitJ = this.baseLimitJ + extraMJ * MJ;
  }

  setSoc(fraction: number): void {
    this.socJ = Math.max(0, Math.min(1, fraction)) * this.windowJ;
  }

  telemetry(): EnergyStoreTelemetry {
    return {
      soc: this.socJ / this.windowJ,
      socMJ: this.socJ / MJ,
      windowMJ: this.windowJ / MJ,
      harvestedLapMJ: this.harvestedLapJ / MJ,
      deployedLapMJ: this.deployedLapJ / MJ,
      harvestLimitLapMJ: this.harvestLimitJ / MJ,
      deployLimitLapMJ: this.deployLimitJ / MJ,
    };
  }
}
