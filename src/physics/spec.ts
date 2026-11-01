/**
 * CarSpec: the data format that fully describes a car (JSON + these types). The physics core reads only
 * this plus the module implementations named in `modules`; adding an era is a new JSON file + modules.
 */

export interface AeroModeSpec {
  clA: number;
  cdA: number;
  /** Fraction of downforce on the front axle. */
  frontBalance: number;
}

export interface TyreThermalSpec {
  surfaceHeatCapacityJPerK: number;
  carcassHeatCapacityJPerK: number;
  slidingHeatFraction: number;
  rollingHeatCoef: number;
  surfaceToCarcassWPerK: number;
  surfaceCoolingWPerK: number;
  surfaceCoolingPerSpeed: number;
  carcassCoolingWPerK: number;
  blanketTempC: number;
}

export interface TyreModelSpec {
  peakSlipRatio: number;
  peakSlipAngleRad: number;
  shapeC: number;
  curvatureE: number;
  loadSensitivity: number;
  referenceLoadN: number;
  relaxationLengthM: number;
  longitudinalGripScale: number;
  lateralGripScale: number;
  thermal: TyreThermalSpec;
  wear: { perJoule: number; gripLossAtFullWear: number };
}

export interface IceSpec {
  rpm: number[];
  kw: number[];
  idleRpm: number;
  revLimitRpm: number;
  upshiftRpm: number;
  downshiftRpm: number;
  thermalEfficiency: number;
  engineBrakeNmAtMaxRpm: number;
}

export interface EnergyPreset {
  /** Below this speed the MGU-K does not deploy (saves energy out of slow corners). */
  deployMinSpeedKmh: number;
  /** Above this speed at full throttle the MGU-K harvests ("superclipping"). */
  superclipFromKmh: number;
  superclipKw: number;
  liftHarvestKw: number;
  /** Fraction of the SoC window kept in reserve. */
  socFloor: number;
}

export interface CarSpec {
  id: string;
  name: string;
  era: string;
  ruleSet: string;
  modules: {
    powerUnit: string;
    energyStore: string | null;
    aeroController: string;
    assists: string;
  };
  mass: { minimumKg: number; frontWeightFraction: number; cgHeightM: number; yawInertiaKgM2: number };
  fuel: { capacityKg: number; lhvMJPerKg: number; energyFlowLimitMJPerH: number };
  dimensions: { wheelbaseM: number; trackFrontM: number; trackRearM: number; overallWidthM: number; lengthM: number };
  wheels: { radiusFrontM: number; radiusRearM: number; widthFrontM: number; widthRearM: number; inertiaKgM2: number };
  tyreModel: TyreModelSpec;
  aero: {
    modes: Record<string, AeroModeSpec>;
    rideHeight: { staticFrontM: number; staticRearM: number; optimumM: number; sensitivity: number; stallBelowM: number; stallLoss: number };
  };
  suspension: {
    wheelRateFrontNPerM: number;
    wheelRateRearNPerM: number;
    dampingRatio: number;
    rollStiffnessFrontFraction: number;
    maxTravelM: number;
  };
  steering: { maxWheelAngleRad: number };
  brakes: { maxTorqueFrontNm: number; maxTorqueRearNm: number; defaultBiasFront: number };
  drivetrain: {
    gearRatios: number[];
    finalDrive: number;
    upshiftTimeS: number;
    downshiftTimeS: number;
    /** Fraction of drive torque available during an upshift (seamless shift ≈ 0.3–0.5, sequential = 0). */
    upshiftTorqueFactor: number;
    efficiency: number;
    engineInertiaKgM2: number;
    differential: { preloadNm: number; powerRamp: number; coastRamp: number };
  };
  rollingResistance: number;
  powerUnitParams: {
    ice: IceSpec;
    mguk?: { maxKw: number; efficiency: number };
    energyPresets?: Record<string, EnergyPreset>;
  };
}

export interface CompoundSpec {
  family: 'slick' | 'intermediate' | 'wet';
  mu: number;
  tempOptC: number;
  tempWidthC: number;
  warmup: number;
  wearRate: number;
  color: string;
}

export interface SurfaceSpec {
  grip: number;
  rollingResistance: number;
  dragPerSpeed: number;
  bumpAmplitude: number;
}

export interface SurfacesData {
  tarmac: SurfaceSpec;
  kerb: SurfaceSpec;
  sausage: SurfaceSpec;
  grass: SurfaceSpec;
  gravel: SurfaceSpec;
  pitlane: SurfaceSpec;
  wet: { slick: number[]; intermediate: number[]; wet: number[] };
}

export interface RuleSetData {
  id: string;
  era: string;
  activeAero: { allowed: boolean; transitionTimeS: number; autoReturnOnBrake: boolean; autoReturnOnLift: boolean };
  energy?: { esSocWindowMJ: number; harvestPerLapMJ: number; mgukMaxKw: number; mgukTaper: { fullUntilKmh: number; zeroAtKmh: number } };
  overtake?: { enabled: boolean; gapS: number; extraEnergyMJ: number; mgukTaper: { fullUntilKmh: number; zeroAtKmh: number } };
  drs: { allowed: boolean };
  pitLaneSpeedLimitKmh: { value: number };
}

export interface ZonesData {
  activeAeroZones: { zones: Array<{ name: string; s0: number; s1: number }> };
  overtakeDetection: { s: number };
}
