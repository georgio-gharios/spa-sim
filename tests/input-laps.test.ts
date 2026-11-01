/**
 * Acceptance: each device type can complete a lap. A scripted driver decides what it wants each frame;
 * a "virtual hand" moves the mock device's raw controls; the InputManager reads them through the
 * device's real layout, bindings and curves; the result drives the game's own DriveSession at 500 Hz.
 */
import { describe, expect, it } from 'vitest';
import { DriveSession } from '../src/game/DriveSession';
import { InputConfigStore } from '../src/input/bindings';
import { InputManager } from '../src/input/InputManager';
import { CAR_2026, makeEnv } from '../src/physics/data';
import { ASSISTS_CASUAL } from '../src/physics/modules/interfaces';
import { scriptedDriverFor } from '../src/sim/lapRunner';
import { ds4RawHand, ds4RawPad, dualSensePad, type Hand, keyboardHand, type MockPad, standardPadHand, wheelHand, xboxPad, g29Wheel } from './helpers/mockPads';
import { loadTrackNode } from './helpers/track';

const track = loadTrackNode();
const env = makeEnv(track);
const FRAME = 1 / 120;

function driveLap(pad: MockPad | null, hand: Hand, kind: string) {
  const mgr = new InputManager(new InputConfigStore(null), () => (pad ? [pad] : []));
  const session = new DriveSession(CAR_2026, env, track.wrapS(track.controlLineS - 400));
  // no steering assist / TC / ABS: the input path alone must do the work (auto gears, as in the headless laps)
  session.car.setAssists({ ...ASSISTS_CASUAL, tractionControl: 0, abs: false, steeringAssist: false });
  const { driver } = scriptedDriverFor(CAR_2026, env, { centerline: true, tuning: { paceScale: 0.85 } });
  driver.reset(session.car);
  mgr.poll();
  if (pad) expect(mgr.devices().map((d) => d.kind)).toContain(kind);
  let maxOut = 0;
  let fullyOut = 0;
  let impacts = 0;
  let speedSum = 0;
  let frames = 0;
  while (session.timing.lapsDone < 1 && session.car.time < 260) {
    const want = driver.update(session.car);
    hand(want, mgr);
    const input = mgr.update(FRAME, session.car.vx);
    session.setInput({ ...input, shiftUp: false, shiftDown: false });
    session.advance(FRAME);
    const t = session.car.telemetry();
    if (session.timing.current > 0) {
      maxOut = Math.max(maxOut, t.wheelsOutside);
      if (t.wheelsOutside === 4) fullyOut += FRAME;
      if (session.takeImpact() > 1) impacts++;
      speedSum += Math.abs(input.steer);
      frames++;
    }
  }
  if (pad) expect(mgr.lastActive.kind).toBe(kind);
  return { lap: session.timing.last, maxOut, fullyOut, impacts, meanAbsSteer: speedSum / Math.max(1, frames) };
}

describe('each device type completes a lap through the input pipeline', () => {
  const cases: [string, () => { pad: MockPad | null; hand: Hand }][] = [
    ['keyboard', () => ({ pad: null, hand: keyboardHand() })],
    ['xbox', () => { const p = xboxPad(); return { pad: p, hand: standardPadHand(p) }; }],
    ['dualsense', () => { const p = dualSensePad(); return { pad: p, hand: standardPadHand(p) }; }],
    ['dualshock4', () => { const p = ds4RawPad(); return { pad: p, hand: ds4RawHand(p) }; }],
    ['wheel', () => { const p = g29Wheel(); return { pad: p, hand: wheelHand(p) }; }],
  ];
  for (const [kind, make] of cases) {
    it(`${kind}`, () => {
      const { pad, hand } = make();
      const r = driveLap(pad, hand, kind);
      expect(r.lap, `${kind} lap`).not.toBeNull();
      expect(r.lap!).toBeLessThan(130);
      expect(r.fullyOut).toBe(0);
      expect(r.impacts).toBe(0);
      expect(r.maxOut).toBeLessThanOrEqual(2);
      console.info(`[input lap] ${kind}: ${r.lap!.toFixed(3)} s, max wheels over ${r.maxOut}`);
    });
  }
});
