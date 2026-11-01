/**
 * Vehicle dynamics core (headless, deterministic). Four wheels with quasi-static load transfer, combined-slip
 * tyres with temperature and wear, aero with ride-height sensitivity, gravity on grade and camber, vertical
 * compression (e.g. Eau Rouge), suspension heave for ride height, drivetrain with gearbox, LSD and engine
 * inertia, brakes blended with regenerative braking, surfaces, wetness and barriers.
 *
 * Body frame: x forward, y left, yaw CCW. World frame: x east, y north (TrackModel frame).
 * Everything era-specific lives behind the module interfaces (power unit, energy store, aero, assists).
 */
import { inLoopRange, type TrackModel } from '../track/TrackModel';
import type { Side } from '../track/types';
import { type AeroCoefficients, type AssistSettings, type Capabilities, ASSISTS_PRO } from './modules/interfaces';
import { type CarModules, createModules } from './modules/registry';
import type { CarSpec, CompoundSpec, RuleSetData, SurfacesData, SurfaceSpec, ZonesData } from './spec';
import {
  loadMu,
  temperatureFactor,
  type TyreShape,
  tyreForces,
  tyreShape,
  type TyreThermalState,
  updateThermal,
  wearFactor,
  wetFactor,
} from './tyre';

const RAD_TO_RPM = 60 / (2 * Math.PI);

export interface DriverInput {
  throttle: number;
  brake: number;
  /** -1..1, positive = steer left. */
  steer: number;
  shiftUp: boolean;
  shiftDown: boolean;
  /** Request the low-drag aero mode (held). */
  aeroRequest: boolean;
  /** Request overtake/override deployment (held). */
  overtake: boolean;
  pitLimiter: boolean;
}

export const NO_INPUT: DriverInput = {
  throttle: 0,
  brake: 0,
  steer: 0,
  shiftUp: false,
  shiftDown: false,
  aeroRequest: false,
  overtake: false,
  pitLimiter: false,
};

export interface VehicleEnv {
  track: TrackModel;
  rules: RuleSetData;
  zones: ZonesData;
  surfaces: SurfacesData;
  compounds: Record<string, CompoundSpec>;
  airDensity: number;
  gravity: number;
  ambientC: number;
  /** Track wetness 0..1 at (s, d); default dry. */
  wetness?: (s: number, d: number) => number;
}

export interface VehicleOptions {
  assists?: AssistSettings;
  compound?: string;
  fuelKg?: number;
  soc?: number;
  energyPreset?: string;
  brakeBias?: number;
  startS?: number;
  startD?: number;
  startSpeedMs?: number;
  tyreTempC?: number;
}

export type WheelSurface = 'tarmac' | 'kerb' | 'sausage' | 'grass' | 'gravel' | 'pitlane';

export interface WheelTelemetry {
  fz: number;
  slipRatio: number;
  slipAngle: number;
  omega: number;
  surface: WheelSurface;
  surfaceC: number;
  carcassC: number;
  wear: number;
  utilisation: number;
  /** Beyond the white line. */
  outside: boolean;
}

export interface VehicleTelemetry {
  t: number;
  speedMs: number;
  speedKmh: number;
  rpm: number;
  gear: number;
  throttle: number;
  brake: number;
  steer: number;
  axG: number;
  ayG: number;
  s: number;
  d: number;
  lap: number;
  lapDistance: number;
  fuelKg: number;
  massKg: number;
  soc: number;
  harvestedLapMJ: number;
  deployedLapMJ: number;
  iceKw: number;
  electricKw: number;
  derating: boolean;
  superclip: boolean;
  aeroState: string;
  aeroBlend: number;
  downforceN: number;
  dragN: number;
  rideHeightFrontM: number;
  rideHeightRearM: number;
  pitchRad: number;
  rollRad: number;
  verticalG: number;
  tcActive: boolean;
  absActive: boolean;
  overtakeActive: boolean;
  wheelsOutside: number;
  impact: number;
  wheels: WheelTelemetry[];
}

interface Wheel {
  x: number;
  y: number;
  radius: number;
  inertia: number;
  omega: number;
  alpha: number;
  fz: number;
  kappa: number;
  fxw: number;
  fyw: number;
  util: number;
  surface: WheelSurface;
  outside: boolean;
  thermal: TyreThermalState;
}

export class Vehicle {
  readonly spec: CarSpec;
  readonly modules: CarModules;
  readonly capabilities: Capabilities;
  readonly env: VehicleEnv;
  compound: CompoundSpec;
  compoundId: string;
  energyPreset: string;
  brakeBias: number;

  // pose and velocities
  x = 0;
  y = 0;
  yaw = 0;
  vx = 0;
  vy = 0;
  r = 0;
  /** Track coordinates of the CG. */
  s = 0;
  d = 0;
  lap = 0;
  time = 0;
  fuelKg: number;
  gear = 1;
  private shiftTimer = 0;
  private shiftDir: -1 | 0 | 1 = 0;
  private prevShiftUp = false;
  private prevShiftDown = false;
  private axF = 0;
  private ayF = 0;
  // suspension (front/rear axle compression and rates)
  private cF = 0;
  private cR = 0;
  private vcF = 0;
  private vcR = 0;
  private roll = 0;
  private lastLapDist = 0;
  private overtakeEligible = false;
  private overtakeThisLap = false;
  private impact = 0;

  readonly wheels: Wheel[];
  private readonly shape: TyreShape;
  private readonly a: number;
  private readonly b: number;
  private readonly tel: VehicleTelemetry;
  private aeroOut: AeroCoefficients;
  private puOut = { iceKw: 0, electricKw: 0, derating: false, superclip: false };
  private assistOut = { tcActive: false, absActive: false };
  private applied = { throttle: 0, brake: 0, steer: 0 };

  constructor(spec: CarSpec, env: VehicleEnv, opts: VehicleOptions = {}) {
    this.spec = spec;
    this.env = env;
    this.modules = createModules(spec, env.rules, opts.assists ?? ASSISTS_PRO);
    this.capabilities = this.modules.capabilities;
    this.compoundId = opts.compound ?? 'medium';
    const c = env.compounds[this.compoundId];
    if (!c) throw new Error(`Unknown compound ${this.compoundId}`);
    this.compound = c;
    this.energyPreset = opts.energyPreset ?? 'balanced';
    this.brakeBias = opts.brakeBias ?? spec.brakes.defaultBiasFront;
    this.fuelKg = Math.min(opts.fuelKg ?? 10, spec.fuel.capacityKg);
    if (this.modules.energyStore && opts.soc !== undefined) this.modules.energyStore.setSoc(opts.soc);
    this.shape = tyreShape(spec.tyreModel);
    const L = spec.dimensions.wheelbaseM;
    this.a = L * (1 - spec.mass.frontWeightFraction);
    this.b = L * spec.mass.frontWeightFraction;
    const tf = spec.dimensions.trackFrontM / 2;
    const tr = spec.dimensions.trackRearM / 2;
    const tyreT = opts.tyreTempC ?? spec.tyreModel.thermal.blanketTempC;
    const mk = (x: number, y: number, radius: number): Wheel => ({
      x,
      y,
      radius,
      inertia: spec.wheels.inertiaKgM2,
      omega: 0,
      alpha: 0,
      fz: 0,
      kappa: 0,
      fxw: 0,
      fyw: 0,
      util: 0,
      surface: 'tarmac',
      outside: false,
      thermal: { surfaceC: tyreT, carcassC: tyreT, wear: 0 },
    });
    this.wheels = [
      mk(this.a, tf, spec.wheels.radiusFrontM),
      mk(this.a, -tf, spec.wheels.radiusFrontM),
      mk(-this.b, tr, spec.wheels.radiusRearM),
      mk(-this.b, -tr, spec.wheels.radiusRearM),
    ];
    this.aeroOut = this.modules.aero.step({ dt: 0, throttle: 0, brake: 0, inZone: false, request: false });
    this.placeOnTrack(opts.startS ?? 0, opts.startD ?? 0, opts.startSpeedMs ?? 0);
    this.tel = this.emptyTelemetry();
  }

  get mass(): number {
    return this.spec.mass.minimumKg + this.fuelKg;
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vy);
  }

  /** Put the car on the track at (s, d), aligned with the track, rolling at `speed`. */
  placeOnTrack(s: number, d: number, speed: number): void {
    const p = this.env.track.pointAt(s, d);
    const smp = this.env.track.sample(s);
    this.x = p.x;
    this.y = p.y;
    this.yaw = smp.heading;
    this.vx = speed;
    this.vy = 0;
    this.r = 0;
    this.s = this.env.track.wrapS(s);
    this.d = d;
    this.lastLapDist = this.env.track.lapDistance(this.s);
    for (const w of this.wheels) {
      w.omega = speed / w.radius;
      w.alpha = 0;
    }
    if (speed > 0) {
      const G = this.overallRatio(this.gear);
      // pick a sensible gear for the speed
      for (let g = 1; g <= this.spec.drivetrain.gearRatios.length; g++) {
        this.gear = g;
        if (((speed / this.wheels[2]!.radius) * this.overallRatio(g) * RAD_TO_RPM) < this.modules.powerUnit.upshiftRpm * 0.95) break;
      }
      void G;
    }
  }

  setAssists(a: AssistSettings): void {
    this.modules.assists.settings = { ...a };
  }

  setOvertakeEligible(v: boolean): void {
    this.overtakeEligible = v;
  }

  overallRatio(g: number): number {
    if (g < 1) return 0;
    const r = this.spec.drivetrain.gearRatios[g - 1];
    return r === undefined ? 0 : r * this.spec.drivetrain.finalDrive;
  }

  private surfaceSpec(w: WheelSurface): SurfaceSpec {
    return this.env.surfaces[w];
  }

  // ------------------------------------------------------------------------------------------ step

  step(dt: number, input: DriverInput): void {
    const env = this.env;
    const track = env.track;
    const spec = this.spec;
    const pu = this.modules.powerUnit;
    const store = this.modules.energyStore;
    const g = env.gravity;
    const m = this.mass;
    this.time += dt;
    this.impact = 0;

    // ---- track position
    const proj = track.project(this.x, this.y, this.s, 40);
    this.s = proj.s;
    this.d = proj.d;
    const smp = track.sample(this.s);
    const th = smp.heading;
    const tcos = Math.cos(th);
    const tsin = Math.sin(th);
    const psiR = this.yaw - th;
    const cr = Math.cos(psiR);
    const sr = Math.sin(psiR);

    // ---- lap bookkeeping (control line) and overtake allowance
    const lapDist = track.lapDistance(this.s);
    if (lapDist < this.lastLapDist - track.length / 2) {
      this.lap++;
      this.overtakeThisLap = this.overtakeEligible && !!env.rules.overtake?.enabled;
      store?.onNewLap(this.overtakeThisLap ? env.rules.overtake!.extraEnergyMJ : 0);
    }
    this.lastLapDist = lapDist;

    // ---- assists + gear shifting
    const rearOmega = 0.5 * (this.wheels[2]!.omega + this.wheels[3]!.omega);
    const G0 = this.overallRatio(this.gear);
    const rpmNow = Math.max(pu.idleRpm, rearOmega * G0 * RAD_TO_RPM);
    const shiftEdge: -1 | 0 | 1 = input.shiftUp && !this.prevShiftUp ? 1 : input.shiftDown && !this.prevShiftDown ? -1 : 0;
    this.prevShiftUp = input.shiftUp;
    this.prevShiftDown = input.shiftDown;
    const as = this.modules.assists.process(
      { throttle: input.throttle, brake: input.brake, steer: input.steer, shift: shiftEdge },
      { speedMs: this.vx, engineRpm: rpmNow, gear: this.gear, slipRatio: this.wheels.map((w) => w.kappa), shifting: this.shiftTimer > 0 },
      pu,
      spec.drivetrain.gearRatios.length,
      (gg) => this.overallRatio(gg),
      this.wheels[2]!.radius,
    );
    this.assistOut = { tcActive: as.tcActive, absActive: as.absActive };
    let throttle = clamp01(as.throttle);
    const brake = clamp01(as.brake);
    if (input.pitLimiter) {
      const lim = env.rules.pitLaneSpeedLimitKmh.value / 3.6 - 0.3;
      throttle = Math.min(throttle, clamp01((lim - this.vx) * 0.8));
    }
    if (as.shift !== 0 && this.shiftTimer <= 0) {
      const ng = this.gear + as.shift;
      if (ng >= 1 && ng <= spec.drivetrain.gearRatios.length) {
        // refuse downshifts that would over-rev
        const newRpm = rearOmega * this.overallRatio(ng) * RAD_TO_RPM;
        if (as.shift > 0 || newRpm < pu.revLimitRpm) {
          this.gear = ng;
          this.shiftDir = as.shift;
          this.shiftTimer = as.shift > 0 ? spec.drivetrain.upshiftTimeS : spec.drivetrain.downshiftTimeS;
        }
      }
    }
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    const steerAngle = Math.max(-1, Math.min(1, as.steer)) * spec.steering.maxWheelAngleRad;
    this.applied = { throttle, brake, steer: as.steer };

    // ---- aero
    const inZone = env.zones.activeAeroZones.zones.some((z) => inLoopRange(this.s, z.s0, z.s1));
    const autoAero = this.modules.assists.settings.autoAero && throttle > 0.95;
    this.aeroOut = this.modules.aero.step({ dt, throttle, brake, inZone, request: input.aeroRequest || autoAero });
    const rh = spec.aero.rideHeight;
    const hF = Math.max(0.003, rh.staticFrontM - this.cF);
    const hR = Math.max(0.003, rh.staticRearM - this.cR);
    const hMean = 0.5 * (hF + hR);
    let rideFactor = 1 - rh.sensitivity * ((hMean - rh.optimumM) / rh.optimumM) ** 2;
    rideFactor = Math.max(0.7, Math.min(1.05, rideFactor));
    if (hMean < rh.stallBelowM) rideFactor *= 1 - rh.stallLoss;
    const v = this.vx;
    const q = 0.5 * env.airDensity * v * v;
    const downforce = q * this.aeroOut.clA * rideFactor;
    const drag = q * this.aeroOut.cdA * Math.sign(v);

    // ---- gravity in the body frame (track grade + camber), vertical curvature
    const grade = track.grade(this.s);
    const camber = smp.camber;
    const cg = 1 / Math.sqrt(1 + grade * grade);
    const gAlong = -g * grade * cg; // along the track tangent
    const gLeft = -g * Math.sin(camber); // + camber => surface falls to the right => pulls right
    const axGrav = gAlong * cr + gLeft * sr;
    const ayGrav = -gAlong * sr + gLeft * cr;
    const vAlong = this.vx * cr - this.vy * sr;
    const aVert = vAlong * vAlong * track.verticalCurvature(this.s);
    const gNormal = g * cg * Math.cos(camber) + aVert;

    // ---- wheel loads
    const L = spec.dimensions.wheelbaseM;
    const h = spec.mass.cgHeightM;
    const wf = spec.mass.frontWeightFraction;
    const W = m * Math.max(0, gNormal);
    const bal = this.aeroOut.frontBalance;
    const dLong = (m * this.axF * h) / L;
    const FzF = W * wf + downforce * bal - dLong;
    const FzR = W * (1 - wf) + downforce * (1 - bal) + dLong;
    const rsd = spec.suspension.rollStiffnessFrontFraction;
    const dLat = m * this.ayF * h;
    const dF = (dLat * rsd) / spec.dimensions.trackFrontM;
    const dR = (dLat * (1 - rsd)) / spec.dimensions.trackRearM;
    const fzs = [FzF / 2 - dF, FzF / 2 + dF, FzR / 2 - dR, FzR / 2 + dR];

    // ---- per-wheel surface, slip and forces
    const wetFn = env.wetness;
    const fam = this.env.surfaces.wet[this.compound.family];
    let wheelsOutside = 0;
    let rollingDragN = 0;
    const tm = spec.tyreModel;
    const fx: number[] = [0, 0, 0, 0];
    const fy: number[] = [0, 0, 0, 0];
    const dFdw: number[] = [0, 0, 0, 0];
    const vLongs: number[] = [0, 0, 0, 0];
    const vLats: number[] = [0, 0, 0, 0];
    const muFzs: number[] = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i]!;
      w.fz = Math.max(0, fzs[i]!);
      // wheel track coordinates (local linearisation around the CG projection)
      const wxW = Math.cos(this.yaw) * w.x - Math.sin(this.yaw) * w.y;
      const wyW = Math.sin(this.yaw) * w.x + Math.cos(this.yaw) * w.y;
      const ws = this.s + wxW * tcos + wyW * tsin;
      const wd = this.d + wxW * tsin - wyW * tcos;
      const si = track.surfaceAt(ws, wd);
      const ws2: WheelSurface =
        si.surface === 'kerb' ? (si.kerb?.type === 'sausage' ? 'sausage' : 'kerb') : si.surface === 'wall' ? 'grass' : si.surface === 'pitlane' ? 'pitlane' : si.surface;
      w.surface = this.onPitLaneSurface(ws, wd) ?? ws2;
      w.outside = si.outside && w.surface !== 'pitlane';
      if (w.outside) wheelsOutside++;
      const surf = this.surfaceSpec(w.surface);
      // wheel-frame velocities
      const vwx = this.vx - this.r * w.y;
      const vwy = this.vy + this.r * w.x;
      const delta = i < 2 ? steerAngle : 0;
      const cd = Math.cos(delta);
      const sd = Math.sin(delta);
      const vLong = vwx * cd + vwy * sd;
      const vLat = -vwx * sd + vwy * cd;
      vLongs[i] = vLong;
      vLats[i] = vLat;
      const aTarget = Math.atan2(vLat, Math.max(Math.abs(vLong), 0.5));
      const relax = Math.min(1, ((Math.abs(vLong) + 2) / tm.relaxationLengthM) * dt);
      w.alpha += (aTarget - w.alpha) * relax;
      const denom = Math.max(Math.abs(vLong), 3);
      w.kappa = (w.omega * w.radius - vLong) / denom;
      const tEff = 0.6 * w.thermal.surfaceC + 0.4 * w.thermal.carcassC;
      const wet = wetFn ? wetFn(ws, wd) : 0;
      // wider tyres carry load with less degressive grip: scale the reference load by width
      const widthScale = (i < 2 ? spec.wheels.widthFrontM : spec.wheels.widthRearM) / spec.wheels.widthFrontM;
      const mu =
        loadMu(tm, this.compound.mu, w.fz / widthScale) * temperatureFactor(this.compound, tEff) * wearFactor(tm, w.thermal.wear) * surf.grip * wetFactor(fam, wet);
      const muFz = mu * w.fz;
      muFzs[i] = muFz;
      const f = tyreForces(tm, this.shape, w.kappa, w.alpha, muFz);
      // local slope dFx/dκ for the implicit wheel-spin update
      const eps = 0.002;
      const fp = tyreForces(tm, this.shape, w.kappa + eps, w.alpha, muFz).fx;
      const fmn = tyreForces(tm, this.shape, w.kappa - eps, w.alpha, muFz).fx;
      dFdw[i] = Math.max(0, (fp - fmn) / (2 * eps)) * (w.radius / denom);
      w.fxw = f.fx;
      w.fyw = f.fy;
      w.util = f.utilisation;
      fx[i] = f.fx * cd - f.fy * sd;
      fy[i] = f.fx * sd + f.fy * cd;
      // rolling resistance and gravel drag act on the body via the contact patch
      const rr = surf.rollingResistance * w.fz + surf.dragPerSpeed * Math.abs(vLong) * (w.fz / 1000);
      rollingDragN += rr * Math.sign(vLong) * (Math.abs(vLong) > 0.2 ? 1 : Math.abs(vLong) / 0.2);
    }

    // ---- drivetrain and power unit
    const G = this.overallRatio(this.gear);
    const engaged = G > 0;
    const rpm = engaged ? Math.max(pu.idleRpm, rearOmega * G * RAD_TO_RPM) : pu.idleRpm;
    const overtakeActive = input.overtake && this.overtakeThisLap;
    const out = pu.step(
      { dt, throttle, brake, engineRpm: rpm, speedMs: Math.max(0, this.vx), engaged, overtakeActive, energyPreset: this.energyPreset },
      store,
    );
    this.puOut = { iceKw: out.iceKw, electricKw: out.electricKw, derating: out.derating, superclip: out.superclip };
    let shiftFactor = 1;
    if (this.shiftTimer > 0) shiftFactor = this.shiftDir > 0 ? spec.drivetrain.upshiftTorqueFactor : 0.6;
    const axleTorque = engaged ? out.crankTorqueNm * G * spec.drivetrain.efficiency * shiftFactor : 0;
    const dif = spec.drivetrain.differential;
    const wl = this.wheels[2]!;
    const wr = this.wheels[3]!;
    const lockCap = dif.preloadNm + (axleTorque >= 0 ? dif.powerRamp : dif.coastRamp) * Math.abs(axleTorque);
    const lock = Math.max(-lockCap, Math.min(lockCap, 800 * (wl.omega - wr.omega)));
    const drive = [0, 0, axleTorque / 2 - lock, axleTorque / 2 + lock];
    const engInertia = engaged ? (spec.drivetrain.engineInertiaKgM2 * G * G) / 2 : 0;

    // brakes (bias, ABS) and regen blending at the rear axle
    const b0 = spec.brakes.defaultBiasFront;
    const tbF = brake * spec.brakes.maxTorqueFrontNm * Math.min(1, this.brakeBias / b0) * as.absScale[0];
    let tbR = brake * spec.brakes.maxTorqueRearNm * Math.min(1, (1 - this.brakeBias) / (1 - b0)) * as.absScale[1];
    let regenAxle = 0;
    if (out.regenPowerW > 0 && brake > 0.05) {
      regenAxle = Math.min(out.regenPowerW / Math.max(Math.abs(rearOmega), 20), 2 * tbR);
      tbR = Math.max(0, tbR - regenAxle / 2);
    }
    pu.settleRegen(regenAxle, rearOmega, dt, store);
    const brakeT = [tbF, tbF, tbR + regenAxle / 2, tbR + regenAxle / 2];

    // ---- wheel spin (linearised implicit Euler) and brakes (friction torque never reverses the wheel)
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i]!;
      const I = w.inertia + (i >= 2 ? engInertia : 0);
      const denomI = I + dt * w.radius * dFdw[i]!;
      const tNet = drive[i]! - w.fxw * w.radius;
      let om = w.omega + (dt * tNet) / denomI;
      const dBrake = (dt * brakeT[i]!) / denomI;
      if (Math.abs(om) <= dBrake) om = 0;
      else om -= Math.sign(om) * dBrake;
      w.omega = om;
    }

    // ---- body dynamics
    let Fx = -drag - rollingDragN;
    let Fy = 0;
    let Mz = 0;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i]!;
      Fx += fx[i]!;
      Fy += fy[i]!;
      Mz += w.x * fy[i]! - w.y * fx[i]!;
    }
    const axBody = Fx / m;
    const ayBody = Fy / m;
    let dvx = axBody + axGrav + this.r * this.vy;
    let dvy = ayBody + ayGrav - this.r * this.vx;
    const dr = Mz / spec.mass.yawInertiaKgM2;
    // very low speed: no creeping or spinning on the spot
    if (this.speed < 0.3 && throttle < 0.05) {
      dvx = -this.vx / Math.max(dt, 0.02);
      dvy = -this.vy / Math.max(dt, 0.02);
    }
    this.vx += dvx * dt;
    this.vy += dvy * dt;
    this.r += dr * dt;
    if (this.speed < 0.3 && throttle < 0.05) this.r *= 0.5;
    this.yaw += this.r * dt;
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    this.x += (this.vx * cy - this.vy * sy) * dt;
    this.y += (this.vx * sy + this.vy * cy) * dt;
    // filtered inertial accelerations for next step's load transfer (~15 ms)
    const k = Math.min(1, dt / 0.015);
    this.axF += (axBody - this.axF) * k;
    this.ayF += (ayBody - this.ayF) * k;

    // ---- suspension heave (ride height), roll
    const sus = spec.suspension;
    const mF = (spec.mass.minimumKg * wf) / 2;
    const mR = (spec.mass.minimumKg * (1 - wf)) / 2;
    const staticF = spec.mass.minimumKg * g * wf;
    const staticR = spec.mass.minimumKg * g * (1 - wf);
    const tgtF = Math.min(sus.maxTravelM, (FzF - staticF) / (2 * sus.wheelRateFrontNPerM));
    const tgtR = Math.min(sus.maxTravelM, (FzR - staticR) / (2 * sus.wheelRateRearNPerM));
    const wnF = Math.sqrt(sus.wheelRateFrontNPerM / mF);
    const wnR = Math.sqrt(sus.wheelRateRearNPerM / mR);
    this.vcF += (wnF * wnF * (tgtF - this.cF) - 2 * sus.dampingRatio * wnF * this.vcF) * dt;
    this.vcR += (wnR * wnR * (tgtR - this.cR) - 2 * sus.dampingRatio * wnR * this.vcR) * dt;
    this.cF += this.vcF * dt;
    this.cR += this.vcR * dt;
    const kRoll = (sus.wheelRateFrontNPerM * spec.dimensions.trackFrontM ** 2 + sus.wheelRateRearNPerM * spec.dimensions.trackRearM ** 2) / 2;
    this.roll += ((-(m * this.ayF * h) / kRoll) - this.roll) * Math.min(1, dt / 0.05);

    // ---- tyre temperature and wear, fuel
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i]!;
      const vSlip = Math.hypot(w.omega * w.radius - vLongs[i]!, vLats[i]!);
      const slideP = Math.hypot(w.fxw, w.fyw) * vSlip;
      updateThermal(w.thermal, tm, this.compound, slideP, w.fz, Math.abs(this.vx), env.ambientC, dt);
    }
    this.fuelKg = Math.max(0, this.fuelKg - out.fuelKgPerS * dt);

    // ---- barriers
    this.collideBarriers();

    this.fillTelemetry(downforce, drag, hF, hR, gNormal, wheelsOutside, overtakeActive);
    void muFzs;
  }

  /** Pit-lane surface lookup (a car on the pit lane is not "outside" and not on grass). */
  private onPitLaneSurface(ws: number, wd: number): WheelSurface | null {
    // cheap reject: the pit lane never overlaps the racing surface
    if (Math.abs(wd) < 4) return null;
    const p = this.env.track.pointAt(ws, wd);
    return this.env.track.pitLaneAt(p.x, p.y) ? 'pitlane' : null;
  }

  private collideBarriers(): void {
    const track = this.env.track;
    const pr = track.project(this.x, this.y, this.s, 40);
    const side: Side = pr.d < 0 ? 'left' : 'right';
    const lim = track.barrierOffset(side, pr.s);
    const type = track.barrierAt(side, pr.s);
    if (type === 'none' || Math.abs(pr.d) <= lim - 0.9) return;
    if (track.pitLaneAt(this.x, this.y)) return;
    // push back inside and reflect the velocity component normal to the barrier
    const smp = track.sample(pr.s);
    const nx = Math.sin(smp.heading) * (side === 'right' ? 1 : -1); // outward normal (world)
    const ny = -Math.cos(smp.heading) * (side === 'right' ? 1 : -1);
    const pen = Math.abs(pr.d) - (lim - 0.9);
    this.x -= nx * pen;
    this.y -= ny * pen;
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const vwx = this.vx * cy - this.vy * sy;
    const vwy = this.vx * sy + this.vy * cy;
    const vn = vwx * nx + vwy * ny;
    if (vn > 0) {
      this.impact = Math.max(this.impact, vn);
      const rest = 0.25;
      const tx = vwx - vn * nx;
      const ty = vwy - vn * ny;
      const fr = 0.75; // scrub along the barrier
      const nvx = tx * fr - rest * vn * nx;
      const nvy = ty * fr - rest * vn * ny;
      this.vx = nvx * cy + nvy * sy;
      this.vy = -nvx * sy + nvy * cy;
      this.r *= 0.5;
      for (const w of this.wheels) w.omega = (this.vx / w.radius) * 0.9 + w.omega * 0.1;
    }
  }

  // ------------------------------------------------------------------------------------------ telemetry

  private emptyTelemetry(): VehicleTelemetry {
    return {
      t: 0,
      speedMs: 0,
      speedKmh: 0,
      rpm: 0,
      gear: 1,
      throttle: 0,
      brake: 0,
      steer: 0,
      axG: 0,
      ayG: 0,
      s: this.s,
      d: this.d,
      lap: 0,
      lapDistance: 0,
      fuelKg: this.fuelKg,
      massKg: this.mass,
      soc: 0,
      harvestedLapMJ: 0,
      deployedLapMJ: 0,
      iceKw: 0,
      electricKw: 0,
      derating: false,
      superclip: false,
      aeroState: 'corner',
      aeroBlend: 0,
      downforceN: 0,
      dragN: 0,
      rideHeightFrontM: this.spec.aero.rideHeight.staticFrontM,
      rideHeightRearM: this.spec.aero.rideHeight.staticRearM,
      pitchRad: 0,
      rollRad: 0,
      verticalG: 1,
      tcActive: false,
      absActive: false,
      overtakeActive: false,
      wheelsOutside: 0,
      impact: 0,
      wheels: this.wheels.map((w) => ({
        fz: 0,
        slipRatio: 0,
        slipAngle: 0,
        omega: 0,
        surface: 'tarmac',
        surfaceC: w.thermal.surfaceC,
        carcassC: w.thermal.carcassC,
        wear: 0,
        utilisation: 0,
        outside: false,
      })),
    };
  }

  private fillTelemetry(df: number, drag: number, hF: number, hR: number, gN: number, outside: number, ot: boolean): void {
    const t = this.tel;
    const es = this.modules.energyStore?.telemetry();
    t.t = this.time;
    t.speedMs = this.vx;
    t.speedKmh = this.vx * 3.6;
    const G = this.overallRatio(this.gear);
    t.rpm = Math.max(this.modules.powerUnit.idleRpm, 0.5 * (this.wheels[2]!.omega + this.wheels[3]!.omega) * G * RAD_TO_RPM);
    t.gear = this.gear;
    t.throttle = this.applied.throttle;
    t.brake = this.applied.brake;
    t.steer = this.applied.steer;
    t.axG = this.axF / this.env.gravity;
    t.ayG = this.ayF / this.env.gravity;
    t.s = this.s;
    t.d = this.d;
    t.lap = this.lap;
    t.lapDistance = this.env.track.lapDistance(this.s);
    t.fuelKg = this.fuelKg;
    t.massKg = this.mass;
    t.soc = es?.soc ?? 0;
    t.harvestedLapMJ = es?.harvestedLapMJ ?? 0;
    t.deployedLapMJ = es?.deployedLapMJ ?? 0;
    t.iceKw = this.puOut.iceKw;
    t.electricKw = this.puOut.electricKw;
    t.derating = this.puOut.derating;
    t.superclip = this.puOut.superclip;
    t.aeroState = this.aeroOut.state;
    t.aeroBlend = this.aeroOut.blend;
    t.downforceN = df;
    t.dragN = drag;
    t.rideHeightFrontM = hF;
    t.rideHeightRearM = hR;
    t.pitchRad = (this.cF - this.cR) / this.spec.dimensions.wheelbaseM;
    t.rollRad = this.roll;
    t.verticalG = gN / this.env.gravity;
    t.tcActive = this.assistOut.tcActive;
    t.absActive = this.assistOut.absActive;
    t.overtakeActive = ot;
    t.wheelsOutside = outside;
    t.impact = this.impact;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i]!;
      const o = t.wheels[i]!;
      o.fz = w.fz;
      o.slipRatio = w.kappa;
      o.slipAngle = w.alpha;
      o.omega = w.omega;
      o.surface = w.surface;
      o.surfaceC = w.thermal.surfaceC;
      o.carcassC = w.thermal.carcassC;
      o.wear = w.thermal.wear;
      o.utilisation = w.util;
      o.outside = w.outside;
    }
  }

  telemetry(): Readonly<VehicleTelemetry> {
    return this.tel;
  }

  /** Full mutable state snapshot (for replays/determinism tests). */
  snapshot(): number[] {
    const out = [this.x, this.y, this.yaw, this.vx, this.vy, this.r, this.s, this.fuelKg, this.gear, this.cF, this.cR];
    for (const w of this.wheels) out.push(w.omega, w.alpha, w.thermal.surfaceC, w.thermal.carcassC, w.thermal.wear);
    out.push(this.modules.energyStore?.telemetry().socMJ ?? 0);
    return out;
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
