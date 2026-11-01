import type { AeroModeSpec, CarSpec } from '../spec';
import type { AeroCoefficients, AeroController } from './interfaces';

/** Fixed wings: one aero configuration, no movable devices. */
export class FixedAero implements AeroController {
  readonly id = 'fixed-aero';
  readonly active = false;
  private readonly mode: AeroModeSpec;

  constructor(spec: CarSpec) {
    const m = spec.aero.modes.fixed ?? Object.values(spec.aero.modes)[0];
    if (!m) throw new Error('fixed-aero needs one aero mode');
    this.mode = m;
  }

  reset(): void {}

  step(): AeroCoefficients {
    return { ...this.mode, state: 'fixed', blend: 0 };
  }
}
