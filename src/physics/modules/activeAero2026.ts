import type { AeroModeSpec, CarSpec, RuleSetData } from '../spec';
import type { AeroCoefficients, AeroController, AeroControllerInput, AeroModeState } from './interfaces';

/**
 * 2026 active aerodynamics state machine: Corner mode (high downforce) by default, Straight mode (low drag)
 * only inside permitted zones on request; braking, lifting or leaving the zone returns to Corner mode.
 * Transitions take `transitionTimeS` and blend the coefficients linearly.
 */
export class ActiveAero2026 implements AeroController {
  readonly id = 'active-aero-2026';
  readonly active = true;
  state: AeroModeState = 'corner';
  private blend = 0;
  private readonly corner: AeroModeSpec;
  private readonly straight: AeroModeSpec;
  private readonly tTrans: number;
  private readonly onBrake: boolean;
  private readonly onLift: boolean;

  constructor(spec: CarSpec, rules: RuleSetData) {
    const c = spec.aero.modes.corner;
    const s = spec.aero.modes.straight;
    if (!c || !s) throw new Error('active-aero-2026 needs aero.modes.corner and aero.modes.straight');
    if (!rules.activeAero.allowed) throw new Error(`RuleSet ${rules.id} does not allow active aero`);
    this.corner = c;
    this.straight = s;
    this.tTrans = rules.activeAero.transitionTimeS;
    this.onBrake = rules.activeAero.autoReturnOnBrake;
    this.onLift = rules.activeAero.autoReturnOnLift;
  }

  reset(): void {
    this.state = 'corner';
    this.blend = 0;
  }

  step(inp: AeroControllerInput): AeroCoefficients {
    const mustReturn = !inp.inZone || (this.onBrake && inp.brake > 0.05) || (this.onLift && inp.throttle < 0.5);
    const wantStraight = inp.request && !mustReturn;
    const rate = inp.dt / this.tTrans;
    switch (this.state) {
      case 'corner':
        if (wantStraight) this.state = 'to-straight';
        break;
      case 'to-straight':
        if (!wantStraight) this.state = 'to-corner';
        break;
      case 'straight':
        if (!wantStraight) this.state = 'to-corner';
        break;
      case 'to-corner':
        if (wantStraight) this.state = 'to-straight';
        break;
      default:
        break;
    }
    if (this.state === 'to-straight') {
      this.blend = Math.min(1, this.blend + rate);
      if (this.blend >= 1) this.state = 'straight';
    } else if (this.state === 'to-corner') {
      this.blend = Math.max(0, this.blend - rate);
      if (this.blend <= 0) this.state = 'corner';
    }
    const b = this.blend;
    return {
      clA: this.corner.clA + (this.straight.clA - this.corner.clA) * b,
      cdA: this.corner.cdA + (this.straight.cdA - this.corner.cdA) * b,
      frontBalance: this.corner.frontBalance + (this.straight.frontBalance - this.corner.frontBalance) * b,
      state: this.state,
      blend: b,
    };
  }
}
