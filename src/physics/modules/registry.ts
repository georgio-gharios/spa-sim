/**
 * Module registry: CarSpec files name their systems by id; adding an era = registering new factories here
 * (or from a plugin module) plus a CarSpec JSON. The physics core never imports concrete modules.
 */
import type { CarSpec, RuleSetData } from '../spec';
import { ActiveAero2026 } from './activeAero2026';
import { EnergyStore2026 } from './energyStore2026';
import { FixedAero } from './fixedAero';
import { HybridV6_2026 } from './hybridV6_2026';
import type {
  AeroController,
  AeroControllerFactory,
  AssistSettings,
  AssistSuite,
  AssistSuiteFactory,
  Capabilities,
  EnergyStore,
  EnergyStoreFactory,
  PowerUnit,
  PowerUnitFactory,
} from './interfaces';
import { NaEngine } from './naEngine';
import { StandardAssists } from './standardAssists';

const powerUnits = new Map<string, PowerUnitFactory>();
const energyStores = new Map<string, EnergyStoreFactory>();
const aeroControllers = new Map<string, AeroControllerFactory>();
const assistSuites = new Map<string, AssistSuiteFactory>();

export function registerPowerUnit(id: string, f: PowerUnitFactory): void {
  powerUnits.set(id, f);
}
export function registerEnergyStore(id: string, f: EnergyStoreFactory): void {
  energyStores.set(id, f);
}
export function registerAeroController(id: string, f: AeroControllerFactory): void {
  aeroControllers.set(id, f);
}
export function registerAssistSuite(id: string, f: AssistSuiteFactory): void {
  assistSuites.set(id, f);
}

registerPowerUnit('hybrid-v6-2026', (s, r) => new HybridV6_2026(s, r));
registerPowerUnit('na-engine', (s) => new NaEngine(s));
registerEnergyStore('es-2026', (s, r) => new EnergyStore2026(s, r));
registerAeroController('active-aero-2026', (s, r) => new ActiveAero2026(s, r));
registerAeroController('fixed-aero', (s) => new FixedAero(s));
registerAssistSuite('standard-assists', (_s, _r, settings) => new StandardAssists({ ...settings }));

export interface CarModules {
  powerUnit: PowerUnit;
  energyStore: EnergyStore | null;
  aero: AeroController;
  assists: AssistSuite;
  capabilities: Capabilities;
}

function need<T>(m: Map<string, T>, id: string, kind: string): T {
  const f = m.get(id);
  if (!f) throw new Error(`Unknown ${kind} module "${id}". Registered: ${[...m.keys()].join(', ')}`);
  return f;
}

export function createModules(spec: CarSpec, rules: RuleSetData, assists: AssistSettings): CarModules {
  if (spec.ruleSet !== rules.id) throw new Error(`Car ${spec.id} expects RuleSet ${spec.ruleSet}, got ${rules.id}`);
  const powerUnit = need(powerUnits, spec.modules.powerUnit, 'power unit')(spec, rules);
  const energyStore = spec.modules.energyStore ? need(energyStores, spec.modules.energyStore, 'energy store')(spec, rules) : null;
  if (powerUnit.hybrid && !energyStore) throw new Error(`Car ${spec.id}: hybrid power unit without an energy store`);
  const aero = need(aeroControllers, spec.modules.aeroController, 'aero controller')(spec, rules);
  const suite = need(assistSuites, spec.modules.assists, 'assist suite')(spec, rules, assists);
  const capabilities: Capabilities = {
    hybrid: powerUnit.hybrid,
    activeAero: aero.active,
    overtakeMode: powerUnit.hybrid && !!rules.overtake?.enabled,
    drs: rules.drs.allowed,
  };
  return { powerUnit, energyStore, aero, assists: suite, capabilities };
}
