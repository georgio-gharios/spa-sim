/** Headless hot-lap runner: drives a car with the scripted driver at a fixed physics step. */
import { computeRacingLine, type RacingLine } from '../ai/racing-line/minCurvature';
import { computeSpeedProfile } from '../ai/racing-line/speedProfile';
import { ScriptedDriver, type DriverTuning } from '../ai/ScriptedDriver';
import { ASSISTS_CASUAL, type AssistSettings } from '../physics/modules/interfaces';
import type { CarSpec } from '../physics/spec';
import { Vehicle, type VehicleEnv } from '../physics/Vehicle';
import type { TrackModel } from '../track/TrackModel';

export const PHYSICS_HZ = 500;

export interface LapSample {
  t: number;
  lapDistance: number;
  speedKmh: number;
  gear: number;
  throttle: number;
  brake: number;
  soc: number;
  electricKw: number;
  iceKw: number;
  derating: boolean;
  superclip: boolean;
  aeroBlend: number;
  rideHeightFrontM: number;
  verticalG: number;
  ayG: number;
  d: number;
  wheelsOutside: number;
  tyreC: number;
}

export interface LapResult {
  lapTime: number | null;
  samples: LapSample[];
  maxSpeedKmh: number;
  maxWheelsOutside: number;
  /** Seconds with all four wheels beyond the white lines. */
  timeFullyOutside: number;
  impacts: number;
  sectorTimes: number[];
  fuelUsedKg: number;
  profileLapTime: number;
}

export interface LapOptions {
  compound?: string;
  fuelKg?: number;
  energyPreset?: string;
  assists?: AssistSettings;
  tuning?: Partial<DriverTuning>;
  gripUse?: number;
  line?: RacingLine;
  /** Follow the centerline instead of a racing line. */
  centerline?: boolean;
  maxTime?: number;
}

const lineCache = new WeakMap<TrackModel, RacingLine>();

export function racingLineFor(track: TrackModel): RacingLine {
  let l = lineCache.get(track);
  if (!l) lineCache.set(track, (l = computeRacingLine(track)));
  return l;
}

export function centerLine(track: TrackModel): RacingLine {
  return computeRacingLine(track, { iterations: 0, margin: 99 });
}

/** One out-lap segment from before the Bus Stop, then one timed flying lap from control line to control line. */
export function runHotLap(spec: CarSpec, env: VehicleEnv, opts: LapOptions = {}): LapResult {
  const track = env.track;
  const line = opts.line ?? (opts.centerline ? centerLine(track) : racingLineFor(track));
  const compound = env.compounds[opts.compound ?? 'soft']!;
  const fuelKg = opts.fuelKg ?? 5;
  const isHybrid = spec.modules.energyStore !== null;
  const profile = computeSpeedProfile(track, line, spec, {
    airDensity: env.airDensity,
    gravity: env.gravity,
    compound,
    lowDragZones: spec.aero.modes.straight ? env.zones.activeAeroZones.zones : [],
    fuelKg,
    gripUse: opts.gripUse ?? 0.93,
    electricW: isHybrid ? (v) => (v * 3.6 < 290 ? 350e3 : Math.max(0, (350e3 * (345 - v * 3.6)) / 55)) : undefined,
  });
  const startS = track.wrapS(track.controlLineS - 2400);
  const car = new Vehicle(spec, env, {
    assists: opts.assists ?? { ...ASSISTS_CASUAL, tractionControl: 0, abs: false, steeringAssist: false },
    compound: opts.compound ?? 'soft',
    fuelKg,
    soc: 1,
    // out-lap: harvest to start the push lap with a full store; switch to the push preset at the line
    energyPreset: 'harvest',
    startS,
    startD: 0,
    startSpeedMs: 50,
    tyreTempC: compound.tempOptC - 5,
  });
  const driver = new ScriptedDriver(line, profile.vMax, opts.tuning);
  driver.reset(car);
  const dt = 1 / PHYSICS_HZ;
  const samples: LapSample[] = [];
  let lapStart: number | null = null;
  let lapTime: number | null = null;
  let maxV = 0;
  let maxOut = 0;
  let fullOut = 0;
  let impacts = 0;
  let fuel0 = 0;
  let lastLap = car.lap;
  const sectorTimes: number[] = [];
  let sectorIdx = 0;
  const bounds = track.sectorBoundaries.map((b) => track.lapDistance(b));
  const maxTime = opts.maxTime ?? 220;
  let nextSampleAt = 0;
  for (let step = 0; car.time < maxTime; step++) {
    const input = driver.update(car);
    car.step(dt, input);
    const t = car.telemetry();
    if (car.lap !== lastLap) {
      lastLap = car.lap;
      if (lapStart === null) {
        lapStart = car.time;
        car.energyPreset = opts.energyPreset ?? 'quali';
        fuel0 = car.fuelKg;
        sectorIdx = 0;
      } else {
        lapTime = car.time - lapStart;
        sectorTimes.push(lapTime - sectorTimes.reduce((a, b) => a + b, 0));
        break;
      }
    }
    if (lapStart !== null) {
      if (sectorIdx < bounds.length && t.lapDistance >= bounds[sectorIdx]!) {
        sectorTimes.push(car.time - lapStart - sectorTimes.reduce((a, b) => a + b, 0));
        sectorIdx++;
      }
      maxV = Math.max(maxV, t.speedKmh);
      maxOut = Math.max(maxOut, t.wheelsOutside);
      if (t.wheelsOutside === 4) fullOut += dt;
      if (t.impact > 1) impacts++;
      if (t.lapDistance >= nextSampleAt || t.lapDistance < nextSampleAt - 3000) {
        nextSampleAt = t.lapDistance + 10;
        samples.push({
          t: car.time - lapStart,
          lapDistance: t.lapDistance,
          speedKmh: t.speedKmh,
          gear: t.gear,
          throttle: t.throttle,
          brake: t.brake,
          soc: t.soc,
          electricKw: t.electricKw,
          iceKw: t.iceKw,
          derating: t.derating,
          superclip: t.superclip,
          aeroBlend: t.aeroBlend,
          rideHeightFrontM: t.rideHeightFrontM,
          verticalG: t.verticalG,
          ayG: t.ayG,
          d: t.d,
          wheelsOutside: t.wheelsOutside,
          tyreC: t.wheels.reduce((a, w) => a + w.surfaceC, 0) / 4,
        });
      }
    }
  }
  return {
    lapTime,
    samples,
    maxSpeedKmh: maxV,
    maxWheelsOutside: maxOut,
    timeFullyOutside: fullOut,
    impacts,
    sectorTimes,
    fuelUsedKg: fuel0 - car.fuelKg,
    profileLapTime: profile.lapTime,
  };
}
