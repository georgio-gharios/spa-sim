import { type PerspectiveCamera, Vector3 } from 'three';
import type { TrackModel } from '../../track/TrackModel';
import type { WorldMap } from '../track/geometry';

/** Follows the centerline at a fixed height and speed: used for the lap fly-around and the benchmark. */
export class FlyAround {
  s = 0;
  speed = 60; // m/s
  height = 4.5;
  back = 18;
  lookAhead = 30;
  lateral = 0;

  constructor(private readonly track: TrackModel, private readonly wm: WorldMap, private readonly camera: PerspectiveCamera) {}

  place(s: number): void {
    this.s = this.track.wrapS(s);
    const eye = this.track.pointAt(this.s - this.back, this.lateral);
    const at = this.track.pointAt(this.s + this.lookAhead, this.lateral);
    this.camera.position.set(eye.x, eye.z - this.wm.baseZ + this.height, -eye.y);
    this.camera.lookAt(new Vector3(at.x, at.z - this.wm.baseZ + 1.5, -at.y));
  }

  update(dt: number): void {
    this.place(this.s + this.speed * dt);
  }
}
