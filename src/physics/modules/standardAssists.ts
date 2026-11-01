import type { AssistFeedback, AssistOutput, AssistSettings, AssistSuite, PowerUnit } from './interfaces';

const RAD_PER_RPM = (2 * Math.PI) / 60;

/** Driving aids: traction control, ABS, automatic gears and clutch, steering assist. Pure functions of state. */
export class StandardAssists implements AssistSuite {
  readonly id = 'standard-assists';
  private tcCut = 0;
  private absF = 1;
  private absR = 1;
  private shiftCooldown = 0;

  constructor(public settings: AssistSettings) {}

  process(
    raw: { throttle: number; brake: number; steer: number; shift: -1 | 0 | 1 },
    fb: AssistFeedback,
    pu: PowerUnit,
    gearCount: number,
    gearRatioAt: (g: number) => number,
    wheelRadius: number,
  ): AssistOutput {
    const s = this.settings;
    let throttle = raw.throttle;
    let tcActive = false;
    if (s.tractionControl > 0) {
      const target = [0, 0.14, 0.1, 0.07][s.tractionControl]!;
      const rearSlip = Math.max(fb.slipRatio[2] ?? 0, fb.slipRatio[3] ?? 0);
      const excess = rearSlip - target;
      this.tcCut = excess > 0 ? Math.min(0.9, this.tcCut + excess * 2.5) : Math.max(0, this.tcCut - 0.02);
      tcActive = this.tcCut > 0.01 && throttle > 0.05;
      throttle *= 1 - this.tcCut;
    }
    let absActive = false;
    if (s.abs) {
      const lock = 0.13;
      const f = Math.min(fb.slipRatio[0] ?? 0, fb.slipRatio[1] ?? 0);
      const r = Math.min(fb.slipRatio[2] ?? 0, fb.slipRatio[3] ?? 0);
      this.absF = f < -lock ? Math.max(0.3, this.absF - 0.08) : Math.min(1, this.absF + 0.04);
      this.absR = r < -lock ? Math.max(0.3, this.absR - 0.08) : Math.min(1, this.absR + 0.04);
      absActive = raw.brake > 0.05 && (this.absF < 1 || this.absR < 1);
    } else {
      this.absF = 1;
      this.absR = 1;
    }
    let steer = raw.steer;
    if (s.steeringAssist) {
      // reduce lock at speed to keep the fronts near their peak slip angle
      const k = 1 / (1 + Math.max(0, fb.speedMs - 20) / 35);
      steer *= k;
    }
    let shift: -1 | 0 | 1 = raw.shift;
    this.shiftCooldown = Math.max(0, this.shiftCooldown - 1);
    if (s.autoGears && !fb.shifting && this.shiftCooldown === 0) {
      shift = 0;
      const g = fb.gear;
      if (g >= 1 && g < gearCount && fb.engineRpm >= pu.upshiftRpm) shift = 1;
      else if (g > 1) {
        const lowerRpm = (fb.speedMs / wheelRadius) * gearRatioAt(g - 1) / RAD_PER_RPM;
        if (fb.engineRpm < pu.downshiftRpm && lowerRpm < pu.upshiftRpm - 400) shift = -1;
      } else if (g === 0) shift = 1;
      if (shift !== 0) this.shiftCooldown = 40;
    }
    return { throttle, brake: raw.brake, absScale: [this.absF, this.absR], steer, shift, tcActive, absActive };
  }
}
