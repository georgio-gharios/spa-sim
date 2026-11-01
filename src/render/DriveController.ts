/** Connects a DriveSession (physics) to the scene: car model pose, chase/cockpit cameras. */
import { type PerspectiveCamera, type Scene, Vector3 } from 'three';
import type { DriveSession } from '../game/DriveSession';
import type { KeyboardDriver } from '../input/KeyboardDriver';
import { CarModel } from './car/CarModel';
import type { WorldMap } from './track/geometry';

export type DriveCamera = 'chase' | 'cockpit';

export class DriveController {
  readonly model: CarModel;
  cameraMode: DriveCamera = 'chase';
  private readonly wheelAngle = [0, 0, 0, 0];
  private readonly camPos = new Vector3();
  private readonly camLook = new Vector3();
  private initialised = false;

  constructor(
    readonly session: DriveSession,
    readonly keys: KeyboardDriver,
    private readonly scene: Scene,
    private readonly wm: WorldMap,
  ) {
    this.model = new CarModel(session.spec);
    scene.add(this.model.root);
  }

  dispose(): void {
    this.scene.remove(this.model.root);
  }

  /** Handle per-frame keys, step physics by real time, pose car and camera. */
  update(dt: number, camera: PerspectiveCamera): void {
    const k = this.keys;
    if (k.consume('KeyR')) this.session.reset();
    if (k.consume('KeyH')) this.session.toggleAssists();
    if (k.consume('KeyV')) this.cameraMode = this.cameraMode === 'chase' ? 'cockpit' : 'chase';
    this.session.setInput(k.update(dt));
    this.session.advance(dt);
    this.pose(dt);
    this.follow(camera, dt);
  }

  private pose(dt: number): void {
    const car = this.session.car;
    const t = car.telemetry();
    const track = car.env.track;
    const smp = track.sample(car.s);
    const road = track.pointAt(car.s, car.d);
    const psiR = car.yaw - smp.heading;
    const rh = car.spec.aero.rideHeight;
    const heave = (rh.staticFrontM - t.rideHeightFrontM + (rh.staticRearM - t.rideHeightRearM)) / 2;
    car.wheels.forEach((w, i) => {
      this.wheelAngle[i] = (this.wheelAngle[i]! + w.omega * dt) % (Math.PI * 2);
    });
    this.model.update({
      position: new Vector3(car.x, road.z - this.wm.baseZ, -car.y),
      yaw: car.yaw,
      roadPitch: Math.atan(track.grade(car.s)) * Math.cos(psiR),
      roadRoll: smp.camber * Math.cos(psiR),
      bodyPitch: -t.pitchRad * 4,
      bodyRoll: -t.rollRad * 3,
      heave,
      steerRad: t.steer * car.spec.steering.maxWheelAngleRad,
      wheelAngle: this.wheelAngle,
      flapOpen: t.aeroBlend,
    });
  }

  private follow(camera: PerspectiveCamera, dt: number): void {
    const root = this.model.root;
    root.updateMatrixWorld(true);
    if (this.cameraMode === 'cockpit') {
      const p = new Vector3();
      this.model.cockpitAnchor.getWorldPosition(p);
      const fwd = new Vector3(1, -0.02, 0).applyQuaternion(root.quaternion);
      camera.position.copy(p);
      camera.lookAt(p.clone().add(fwd));
      camera.fov = 75;
      camera.near = 0.05;
    } else {
      const fwd = new Vector3(1, 0, 0).applyQuaternion(root.quaternion);
      fwd.y = 0;
      fwd.normalize();
      const want = root.position.clone().addScaledVector(fwd, -6.5).add(new Vector3(0, 2.1, 0));
      const look = root.position.clone().addScaledVector(fwd, 5).add(new Vector3(0, 0.8, 0));
      const s = this.initialised ? Math.min(1, dt * 8) : 1;
      this.camPos.lerp(want, s);
      this.camLook.lerp(look, Math.min(1, s * 1.5));
      if (!this.initialised) {
        this.camPos.copy(want);
        this.camLook.copy(look);
        this.initialised = true;
      }
      camera.position.copy(this.camPos);
      camera.lookAt(this.camLook);
      camera.fov = 60;
      camera.near = 0.1;
    }
    camera.updateProjectionMatrix();
  }
}
