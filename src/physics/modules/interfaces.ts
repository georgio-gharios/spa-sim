/**
 * Pluggable car systems. The physics core only talks to these interfaces; each era provides its own
 * implementations and a CarSpec names them. Capabilities tell the HUD, radio and garage what exists.
 */
import type { CarSpec, RuleSetData } from '../spec';

export interface Capabilities {
  hybrid: boolean;
  activeAero: boolean;
  overtakeMode: boolean;
  drs: boolean;
}

// ---------------------------------------------------------------------------------------------- energy store

export interface EnergyStoreTelemetry {
  /** State of charge as a fraction of the usable window (0..1). */
  soc: number;
  socMJ: number;
  windowMJ: number;
  harvestedLapMJ: number;
  deployedLapMJ: number;
  harvestLimitLapMJ: number;
  deployLimitLapMJ: number;
}

export interface EnergyStore {
  readonly id: string;
  /** Energy (J) that can still be deployed now (SoC and per-lap limits), before efficiency losses. */
  deployableJ(): number;
  /** Energy (J) that can still be harvested now (SoC headroom and per-lap limits). */
  harvestableJ(): number;
  /** Draw energy from the store (J). Returns what was actually drawn. */
  deploy(j: number): number;
  /** Put energy into the store (J). Returns what was actually stored. */
  harvest(j: number): number;
  /** Called when the car crosses the control line; extraMJ = overtake allowance for the new lap. */
  onNewLap(extraMJ: number): void;
  setSoc(fraction: number): void;
  telemetry(): EnergyStoreTelemetry;
}

// ---------------------------------------------------------------------------------------------- power unit

export interface PowerUnitInput {
  dt: number;
  throttle: number;
  brake: number;
  engineRpm: number;
  speedMs: number;
  /** Drive path engaged (not neutral, clutch closed). */
  engaged: boolean;
  /** Driver has requested overtake / override deployment and it is allowed this lap. */
  overtakeActive: boolean;
  /** Energy management preset id (e.g. "quali", "balanced", "harvest"). */
  energyPreset: string;
}

export interface PowerUnitOutput {
  /** Total torque at the crankshaft (ICE + crank-mounted electrical machines), Nm. */
  crankTorqueNm: number;
  /** Regenerative braking power available at the rear axle (W, >= 0); the core blends it with friction brakes. */
  regenPowerW: number;
  fuelKgPerS: number;
  iceKw: number;
  /** + deploy, - harvest. */
  electricKw: number;
  /** Driver wanted electrical deployment but the store/limits could not supply it ("derating"/"clipping"). */
  derating: boolean;
  /** Harvesting at full throttle ("superclipping"). */
  superclip: boolean;
}

export interface PowerUnit {
  readonly id: string;
  readonly hybrid: boolean;
  readonly idleRpm: number;
  readonly revLimitRpm: number;
  readonly upshiftRpm: number;
  readonly downshiftRpm: number;
  step(input: PowerUnitInput, store: EnergyStore | null): PowerUnitOutput;
  /**
   * Called by the core after it knows the actual rear-axle speed, to account for regen energy:
   * axleTorqueNm actually applied by the MGU-K, axleOmega in rad/s.
   */
  settleRegen(axleTorqueNm: number, axleOmega: number, dt: number, store: EnergyStore | null): void;
  maxIcePowerKw(): number;
}

// ---------------------------------------------------------------------------------------------- aero

export type AeroModeState = 'corner' | 'to-straight' | 'straight' | 'to-corner' | 'fixed';

export interface AeroControllerInput {
  dt: number;
  throttle: number;
  brake: number;
  /** Car is inside a zone where the low-drag mode is permitted. */
  inZone: boolean;
  /** Driver/auto request for the low-drag mode. */
  request: boolean;
}

export interface AeroCoefficients {
  clA: number;
  cdA: number;
  frontBalance: number;
  state: AeroModeState;
  /** 0 = fully high-downforce, 1 = fully low-drag. */
  blend: number;
}

export interface AeroController {
  readonly id: string;
  readonly active: boolean;
  step(input: AeroControllerInput): AeroCoefficients;
  reset(): void;
}

// ---------------------------------------------------------------------------------------------- assists

export interface AssistSettings {
  tractionControl: 0 | 1 | 2 | 3;
  abs: boolean;
  autoGears: boolean;
  autoClutch: boolean;
  steeringAssist: boolean;
  autoAero: boolean;
  /** Visual only (renderer/HUD). */
  brakingLine: boolean;
  racingLine: 'full' | 'braking' | 'off';
}

export const ASSISTS_PRO: AssistSettings = {
  tractionControl: 0,
  abs: false,
  autoGears: false,
  autoClutch: true,
  steeringAssist: false,
  autoAero: false,
  brakingLine: false,
  racingLine: 'off',
};

export const ASSISTS_CASUAL: AssistSettings = {
  tractionControl: 2,
  abs: true,
  autoGears: true,
  autoClutch: true,
  steeringAssist: true,
  autoAero: true,
  brakingLine: true,
  racingLine: 'full',
};

export interface AssistFeedback {
  speedMs: number;
  engineRpm: number;
  gear: number;
  /** Slip ratio per wheel FL, FR, RL, RR. */
  slipRatio: readonly number[];
  shifting: boolean;
}

export interface AssistOutput {
  throttle: number;
  brake: number;
  /** Per-axle brake scale from ABS (front, rear). */
  absScale: [number, number];
  steer: number;
  shift: -1 | 0 | 1;
  tcActive: boolean;
  absActive: boolean;
}

export interface AssistSuite {
  readonly id: string;
  settings: AssistSettings;
  process(
    raw: { throttle: number; brake: number; steer: number; shift: -1 | 0 | 1 },
    fb: AssistFeedback,
    pu: PowerUnit,
    gearCount: number,
    gearRatioAt: (g: number) => number,
    wheelRadius: number,
  ): AssistOutput;
}

// ---------------------------------------------------------------------------------------------- registry types

export type PowerUnitFactory = (spec: CarSpec, rules: RuleSetData) => PowerUnit;
export type EnergyStoreFactory = (spec: CarSpec, rules: RuleSetData) => EnergyStore;
export type AeroControllerFactory = (spec: CarSpec, rules: RuleSetData) => AeroController;
export type AssistSuiteFactory = (spec: CarSpec, rules: RuleSetData, settings: AssistSettings) => AssistSuite;
