/**
 * Rumble cues from car telemetry: kerbs, lock-ups, wheelspin, rough runoff and impacts.
 * Output is two motor magnitudes 0..1 (W3C 'dual-rumble': strong = low-frequency, weak = high-frequency).
 * Pure function of telemetry plus a little state for pulses (unit-testable).
 */
import type { VehicleTelemetry } from '../physics/Vehicle';

export interface RumbleOutput {
  strong: number;
  weak: number;
}

export interface RumbleCues {
  kerb: number;
  lockup: number;
  wheelspin: number;
  rough: number;
  impact: number;
}

/** Individual cue strengths 0..1 (exported for tests and the menu's live meter). */
export function rumbleCues(t: Readonly<VehicleTelemetry>, impactMs: number): RumbleCues {
  const v = Math.abs(t.speedMs);
  const speedK = Math.min(1, v / 30);
  let kerb = 0;
  let rough = 0;
  for (const w of t.wheels) {
    if (w.surface === 'kerb') kerb += 0.3;
    else if (w.surface === 'sausage') kerb += 0.6;
    else if (w.surface === 'grass' || w.surface === 'gravel') rough += 0.25;
  }
  kerb = Math.min(1, kerb) * speedK;
  rough = Math.min(1, rough) * speedK;
  let lockup = 0;
  let wheelspin = 0;
  if (v > 4) {
    for (const w of t.wheels) {
      if (t.brake > 0.05 && w.slipRatio < -0.12) lockup = Math.max(lockup, Math.min(1, (-w.slipRatio - 0.12) / 0.25 + 0.3));
    }
  }
  if (t.throttle > 0.1) {
    for (let i = 2; i < t.wheels.length; i++) {
      const k = t.wheels[i]!.slipRatio;
      if (k > 0.15) wheelspin = Math.max(wheelspin, Math.min(1, (k - 0.15) / 0.35 + 0.25));
    }
  }
  // impacts: a short full-strength kick scaled by the closing speed (m/s)
  const impact = Math.min(1, impactMs / 8);
  return { kerb, lockup, wheelspin, rough, impact };
}

export class RumbleEngine {
  private phase = 0;
  private impactHold = 0;
  private impactLevel = 0;

  /** Advance by dt; `impactMs` is the largest barrier closing speed since the last call. */
  update(t: Readonly<VehicleTelemetry>, impactMs: number, dt: number, strength: number): RumbleOutput {
    const c = rumbleCues(t, impactMs);
    if (c.impact > 0) {
      this.impactLevel = Math.max(this.impactLevel, c.impact);
      this.impactHold = 0.25;
    }
    this.impactHold = Math.max(0, this.impactHold - dt);
    if (this.impactHold === 0) this.impactLevel = 0;
    // kerbs: pulsed at the kerb-stripe frequency (≈ 1 m stripes)
    this.phase = (this.phase + dt * Math.max(4, Math.abs(t.speedMs) / 2)) % 1;
    const kerbPulse = c.kerb * (this.phase < 0.5 ? 1 : 0.35);
    const strong = Math.max(kerbPulse * 0.7, c.rough * 0.5, c.wheelspin * 0.8, this.impactLevel);
    const weak = Math.max(kerbPulse, c.lockup * 0.9, c.rough * 0.4, c.wheelspin * 0.3, this.impactLevel * 0.6);
    return { strong: Math.min(1, strong * strength), weak: Math.min(1, weak * strength) };
  }
}
