/** Human-readable labels for bindings (keys, glyphs, axes) on a given device. */
import { ACTIONS, type ActionId, type BindingSource } from './actions';
import { axisGlyph, buttonGlyph, glyphColour, keyGlyph } from './devices';
import type { DeviceInfo, InputManager } from './InputManager';

export function sourceLabel(src: BindingSource, d: DeviceInfo): string {
  switch (src.type) {
    case 'key':
      return keyGlyph(src.code);
    case 'button':
      return buttonGlyph(d.kind, d.standard, src.index);
    case 'axis':
      return axisGlyph(d.kind, d.standard, src.index, src.dir);
    case 'axisFull':
      return `${axisGlyph(d.kind, d.standard, src.index, 0)}${src.invert ? ' (pedal)' : ''}`;
  }
}

export function sourceColour(src: BindingSource, d: DeviceInfo): string | null {
  return src.type === 'button' ? glyphColour(d.kind, d.standard, src.index) : null;
}

/** "W / ↑" style summary of an action's bindings on a device. */
export function actionKeys(mgr: InputManager, d: DeviceInfo, a: ActionId): string {
  const list = mgr.configFor(d).bindings[a];
  return list.length ? list.map((s) => sourceLabel(s, d)).join(' / ') : '—';
}

/** One-line controls hint for the HUD, for the device the player is using. */
export function controlsHint(mgr: InputManager, caps: { activeAero: boolean; overtakeMode: boolean }): string {
  const d = mgr.lastActive;
  const k = (a: ActionId) => actionKeys(mgr, d, a);
  const parts = [
    `${k('throttle')} throttle`,
    `${k('brake')} brake`,
    `${k('steerLeft')}/${k('steerRight')} steer`,
    `${k('shiftUp')}/${k('shiftDown')} gears`,
  ];
  if (caps.activeAero) parts.push(`${k('aero')} straight mode`);
  if (caps.overtakeMode) parts.push(`${k('overtake')} overtake`);
  parts.push(`${k('pitLimiter')} pit limiter`, `${k('reset')} reset`, `${k('assists')} assists`, `${k('camera')} camera`);
  parts.push(d.kind === 'keyboard' ? 'Esc controls' : `${k('menu')} controls`);
  return `${d.name}: ${parts.join(' · ')}`;
}

export const ACTION_LABELS: Record<ActionId, string> = Object.fromEntries(ACTIONS.map((a) => [a.id, a.label])) as Record<ActionId, string>;
