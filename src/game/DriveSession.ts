/** Fixed-step physics driven by real time (decoupled from rendering), for the player car. */
import { ASSISTS_CASUAL, ASSISTS_PRO, type AssistSettings } from '../physics/modules/interfaces';
import type { CarSpec } from '../physics/spec';
import { NO_INPUT, Vehicle, type DriverInput, type VehicleEnv } from '../physics/Vehicle';

export const PHYSICS_DT = 1 / 500;

export interface LapTiming {
  current: number;
  last: number | null;
  best: number | null;
  lapsDone: number;
}

export class DriveSession {
  car: Vehicle;
  private acc = 0;
  private input: DriverInput = NO_INPUT;
  private lapStart: number | null = null;
  private lastLap = 0;
  readonly timing: LapTiming = { current: 0, last: null, best: null, lapsDone: 0 };
  assistsPreset: 'casual' | 'pro' = 'casual';

  constructor(
    readonly spec: CarSpec,
    readonly env: VehicleEnv,
    readonly startS: number,
  ) {
    this.car = this.makeCar();
  }

  private assists(): AssistSettings {
    return this.assistsPreset === 'casual' ? ASSISTS_CASUAL : ASSISTS_PRO;
  }

  private makeCar(): Vehicle {
    return new Vehicle(this.spec, this.env, {
      assists: this.assists(),
      compound: 'soft',
      fuelKg: 20,
      soc: 1,
      energyPreset: 'balanced',
      startS: this.startS,
      startSpeedMs: 0,
    });
  }

  reset(atS?: number): void {
    const s = atS ?? this.car.s;
    this.car = new Vehicle(this.spec, this.env, {
      assists: this.assists(),
      compound: this.car.compoundId,
      fuelKg: this.car.fuelKg,
      soc: this.car.modules.energyStore?.telemetry().soc ?? 1,
      energyPreset: this.car.energyPreset,
      startS: s,
      startSpeedMs: 0,
    });
    this.lapStart = null;
    this.lastLap = this.car.lap;
    this.acc = 0;
  }

  toggleAssists(): void {
    this.assistsPreset = this.assistsPreset === 'casual' ? 'pro' : 'casual';
    this.car.setAssists(this.assists());
  }

  setInput(i: DriverInput): void {
    this.input = i;
  }

  /** Advance by real elapsed time (s); runs as many fixed steps as needed (capped to avoid spirals). */
  advance(elapsed: number): number {
    this.acc += Math.min(elapsed, 0.1);
    let steps = 0;
    while (this.acc >= PHYSICS_DT && steps < 100) {
      this.car.step(PHYSICS_DT, this.input);
      this.acc -= PHYSICS_DT;
      steps++;
      if (this.car.lap !== this.lastLap) {
        this.lastLap = this.car.lap;
        if (this.lapStart !== null) {
          const t = this.car.time - this.lapStart;
          this.timing.last = t;
          if (this.timing.best === null || t < this.timing.best) this.timing.best = t;
          this.timing.lapsDone++;
        }
        this.lapStart = this.car.time;
      }
    }
    this.timing.current = this.lapStart === null ? 0 : this.car.time - this.lapStart;
    return steps;
  }

  /** Fraction of a physics step not yet simulated (for render interpolation). */
  get alpha(): number {
    return this.acc / PHYSICS_DT;
  }
}
