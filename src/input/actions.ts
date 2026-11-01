/**
 * Input actions: what the player can do, independent of the device. Bindings map device sources
 * (keys, buttons, axes) onto these; the InputManager turns them into a DriverInput plus UI events.
 */

export type ActionId =
  | 'throttle'
  | 'brake'
  | 'steerLeft'
  | 'steerRight'
  | 'shiftUp'
  | 'shiftDown'
  | 'aero'
  | 'overtake'
  | 'pitLimiter'
  | 'reset'
  | 'assists'
  | 'camera'
  | 'menu';

export type ActionKind =
  /** Analogue 0..1 (pedals, half of the steering). */
  | 'analog'
  /** Digital, active while held. */
  | 'hold'
  /** Digital, flips a latch on each press. */
  | 'toggle'
  /** Digital, fires once per press (UI / session events). */
  | 'press';

export interface ActionInfo {
  id: ActionId;
  label: string;
  kind: ActionKind;
  group: 'driving' | 'car' | 'session';
}

export const ACTIONS: readonly ActionInfo[] = [
  { id: 'throttle', label: 'Throttle', kind: 'analog', group: 'driving' },
  { id: 'brake', label: 'Brake', kind: 'analog', group: 'driving' },
  { id: 'steerLeft', label: 'Steer left', kind: 'analog', group: 'driving' },
  { id: 'steerRight', label: 'Steer right', kind: 'analog', group: 'driving' },
  { id: 'shiftUp', label: 'Shift up', kind: 'hold', group: 'driving' },
  { id: 'shiftDown', label: 'Shift down', kind: 'hold', group: 'driving' },
  { id: 'aero', label: 'Straight-line aero mode', kind: 'toggle', group: 'car' },
  { id: 'overtake', label: 'Overtake / override', kind: 'hold', group: 'car' },
  { id: 'pitLimiter', label: 'Pit limiter', kind: 'toggle', group: 'car' },
  { id: 'reset', label: 'Reset car', kind: 'press', group: 'session' },
  { id: 'assists', label: 'Assists Casual/Pro', kind: 'press', group: 'session' },
  { id: 'camera', label: 'Change camera', kind: 'press', group: 'session' },
  { id: 'menu', label: 'Pause / controls menu', kind: 'press', group: 'session' },
];

export const ACTION_IDS: readonly ActionId[] = ACTIONS.map((a) => a.id);

export function actionInfo(id: ActionId): ActionInfo {
  return ACTIONS.find((a) => a.id === id)!;
}

/** A physical input on a device. */
export type BindingSource =
  | { type: 'key'; code: string }
  /** Gamepad button; its analogue value is used when it has one (standard-mapping triggers). */
  | { type: 'button'; index: number }
  /** One half of an axis: dir −1 reads the negative half, +1 the positive half, both as 0..1. */
  | { type: 'axis'; index: number; dir: 1 | -1 }
  /** A whole axis as 0..1: −1 → 0, +1 → 1 (or reversed with invert; pedals usually rest at +1). */
  | { type: 'axisFull'; index: number; invert: boolean };

export function sameSource(a: BindingSource, b: BindingSource): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'key':
      return a.code === (b as typeof a).code;
    case 'button':
      return a.index === (b as typeof a).index;
    case 'axis':
      return a.index === (b as typeof a).index && a.dir === (b as typeof a).dir;
    case 'axisFull':
      return a.index === (b as typeof a).index;
  }
}

/** Keys the app keeps for itself (view modes in the track viewer); they cannot be bound. */
export const RESERVED_KEYS: ReadonlySet<string> = new Set(['KeyF', 'KeyC', 'KeyG', 'Enter', 'F5', 'F11', 'F12']);
