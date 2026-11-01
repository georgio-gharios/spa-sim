/** Browser wiring for the InputManager: keyboard events, Gamepad API polling and hot-plug events. */
import { InputConfigStore, type StorageLike } from './bindings';
import { type GamepadLike, InputManager } from './InputManager';

function storage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function createBrowserInput(): InputManager {
  const getPads = (): readonly (GamepadLike | null)[] => {
    try {
      return navigator.getGamepads ? (navigator.getGamepads() as unknown as (GamepadLike | null)[]) : [];
    } catch {
      return []; // blocked by a permissions policy
    }
  };
  const mgr = new InputManager(new InputConfigStore(storage()), getPads);
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    mgr.keyDown(e.code);
    if (mgr.isBoundKey(e.code) && !(e.target instanceof HTMLInputElement)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => mgr.keyUp(e.code));
  window.addEventListener('blur', () => mgr.releaseAll());
  // Chrome only updates gamepads when polled; the events make hot-plugging immediate in Firefox
  window.addEventListener('gamepadconnected', () => mgr.poll());
  window.addEventListener('gamepaddisconnected', () => mgr.poll());
  return mgr;
}
