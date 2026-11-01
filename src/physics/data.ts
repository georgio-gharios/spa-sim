/** Static game data bundled with the build (and importable in Node tests). */
import car2026 from '../../data/cars/car2026.json';
import env from '../../data/physics/environment.json';
import surfaces from '../../data/physics/surfaces.json';
import rules2026 from '../../data/rules/2026.json';
import zones from '../../data/track/zones.json';
import compounds from '../../data/tyres/compounds-2026.json';
import type { TrackModel } from '../track/TrackModel';
import type { CarSpec, CompoundSpec, RuleSetData, SurfacesData, ZonesData } from './spec';
import type { VehicleEnv } from './Vehicle';

export const CAR_2026 = car2026 as unknown as CarSpec;
export const RULES_2026 = rules2026 as unknown as RuleSetData;
export const SURFACES = surfaces as unknown as SurfacesData;
export const ZONES = zones as unknown as ZonesData;
export const COMPOUNDS = compounds.compounds as unknown as Record<string, CompoundSpec>;
export const ENVIRONMENT = env;

/** RuleSet registry by id: a car's spec names its RuleSet. */
const RULESETS: Record<string, RuleSetData> = { '2026': RULES_2026 };

export function registerRuleSet(r: RuleSetData): void {
  RULESETS[r.id] = r;
}

export function ruleSetFor(spec: CarSpec): RuleSetData {
  const r = RULESETS[spec.ruleSet];
  if (!r) throw new Error(`No RuleSet "${spec.ruleSet}" registered for car ${spec.id}`);
  return r;
}

export function makeEnv(track: TrackModel, spec: CarSpec = CAR_2026): VehicleEnv {
  return {
    track,
    rules: ruleSetFor(spec),
    zones: ZONES,
    surfaces: SURFACES,
    compounds: COMPOUNDS,
    airDensity: env.airDensity.value,
    gravity: env.gravity.value,
    ambientC: env.ambientTempC.value,
  };
}
