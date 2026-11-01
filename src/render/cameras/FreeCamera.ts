import { Euler, type PerspectiveCamera, Vector3 } from 'three';

/** Simple fly camera: WASD/QE to move, mouse drag (or pointer lock) to look, Shift = fast, Ctrl = slow. */
export class FreeCamera {
  enabled = true;
  speed = 30;
  private readonly keys = new Set<string>();
  private readonly euler = new Euler(0, 0, 0, 'YXZ');
  private dragging = false;

  constructor(private readonly camera: PerspectiveCamera, private readonly dom: HTMLElement) {
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('mousedown', () => (this.dragging = true));
    window.addEventListener('mouseup', () => (this.dragging = false));
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled || (!this.dragging && document.pointerLockElement !== dom)) return;
      this.euler.setFromQuaternion(this.camera.quaternion);
      this.euler.y -= e.movementX * 0.0025;
      this.euler.x = Math.max(-1.5, Math.min(1.5, this.euler.x - e.movementY * 0.0025));
      this.camera.quaternion.setFromEuler(this.euler);
    });
    dom.addEventListener('wheel', (e) => {
      this.speed = Math.max(2, Math.min(400, this.speed * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
    });
  }

  update(dt: number): void {
    if (!this.enabled) return;
    const v = new Vector3();
    if (this.keys.has('KeyW')) v.z -= 1;
    if (this.keys.has('KeyS')) v.z += 1;
    if (this.keys.has('KeyA')) v.x -= 1;
    if (this.keys.has('KeyD')) v.x += 1;
    if (this.keys.has('KeyE')) v.y += 1;
    if (this.keys.has('KeyQ')) v.y -= 1;
    if (v.lengthSq() === 0) return;
    let sp = this.speed;
    if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) sp *= 4;
    if (this.keys.has('ControlLeft')) sp *= 0.25;
    v.normalize().multiplyScalar(sp * dt).applyQuaternion(this.camera.quaternion);
    this.camera.position.add(v);
  }
}
