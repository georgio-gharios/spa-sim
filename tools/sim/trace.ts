/** Debug trace: `npx tsx tools/sim/trace.ts <startS> <seconds> <startKmh-ish m/s> <printEverySteps>` */
import { readFileSync } from 'node:fs';
import { CAR_2026, makeEnv, COMPOUNDS } from '../../src/physics/data';
import { racingLineFor } from '../../src/sim/lapRunner';
import { computeSpeedProfile } from '../../src/ai/racing-line/speedProfile';
import { ScriptedDriver } from '../../src/ai/ScriptedDriver';
import { Vehicle } from '../../src/physics/Vehicle';
import { ASSISTS_CASUAL } from '../../src/physics/modules/interfaces';
import { TrackModel } from '../../src/track/TrackModel';
const data = JSON.parse(readFileSync('/home/user/spa-sim/data/track/spa-2026.json', 'utf8'));
const bin = readFileSync('/home/user/spa-sim/data/track/terrain.bin');
const track = new TrackModel(data, new Float32Array(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength)));
const env = makeEnv(track);
const line = racingLineFor(track);
const prof = computeSpeedProfile(track, line, CAR_2026, { airDensity: 1.165, gravity: 9.81, compound: COMPOUNDS.soft!, lowDragZones: env.zones.activeAeroZones.zones, fuelKg: 5, gripUse: 0.93 });
const startS = Number(process.argv[2] ?? (track.controlLineS - 900));
const car = new Vehicle(CAR_2026, env, { assists: { ...ASSISTS_CASUAL, tractionControl: 0, abs: false, steeringAssist: false }, compound: 'soft', fuelKg: 5, soc: 1, energyPreset: 'quali', startS, startSpeedMs: Number(process.argv[4] ?? 50), tyreTempC: 93 });
const drv = new ScriptedDriver(line, prof.vMax); drv.reset(car);
const dt = 1 / 500;
for (let k = 0; k < 500 * Number(process.argv[3] ?? 20); k++) {
  const inp = drv.update(car); car.step(dt, inp);
  if (k % Number(process.argv[5] ?? 250) === 0) { const t = car.telemetry();
    console.log(`t${t.t.toFixed(1)} s${t.s.toFixed(0)} d${t.d.toFixed(1)} v${t.speedKmh.toFixed(0)} tgt${(prof.vMax[drv.index]!*3.6).toFixed(0)} g${t.gear} rpm${t.rpm.toFixed(0)} th${inp.throttle.toFixed(2)} br${inp.brake.toFixed(2)} st${inp.steer.toFixed(2)} vy${car.vy.toFixed(1)} r${car.r.toFixed(2)} soc${t.soc.toFixed(2)} eKw${t.electricKw.toFixed(0)} ice${t.iceKw.toFixed(0)} aero${t.aeroBlend.toFixed(1)} out${t.wheelsOutside} k${t.wheels.map(w=>w.slipRatio.toFixed(2)).join(',')} a${t.wheels.map(w=>w.slipAngle.toFixed(2)).join(',')}`); }
}
