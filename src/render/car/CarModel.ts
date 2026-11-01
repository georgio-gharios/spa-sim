/**
 * Procedural 2026-style open-wheel car (generic, no team identity). Built from simple primitives so it
 * needs no external assets; detailed enough to read the car's attitude, wheel steer/spin and wing flaps.
 */
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { CarSpec } from '../../physics/spec';

export interface Livery {
  primary: number;
  secondary: number;
  accent: number;
  number: number;
}

export const DEFAULT_LIVERY: Livery = { primary: 0x1d4fd8, secondary: 0xf2f2f2, accent: 0xff6a13, number: 7 };

export class CarModel {
  readonly root = new Group();
  /** Pitch/roll applied to the sprung body only (wheels follow the road). */
  readonly body = new Group();
  readonly wheels: Object3D[] = [];
  private readonly steerPivots: Object3D[] = [];
  private readonly rearFlap: Object3D;
  private readonly frontFlap: Object3D;
  readonly cockpitAnchor = new Object3D();

  constructor(spec: CarSpec, livery: Livery = DEFAULT_LIVERY) {
    const L = spec.dimensions.wheelbaseM;
    const a = L * (1 - spec.mass.frontWeightFraction); // CG -> front axle
    const b = L * spec.mass.frontWeightFraction; // CG -> rear axle
    const tf = spec.dimensions.trackFrontM / 2;
    const tr = spec.dimensions.trackRearM / 2;
    const rf = spec.wheels.radiusFrontM;
    const rr = spec.wheels.radiusRearM;
    const paint = new MeshStandardMaterial({ color: livery.primary, roughness: 0.35, metalness: 0.4 });
    const paint2 = new MeshStandardMaterial({ color: livery.secondary, roughness: 0.4, metalness: 0.2 });
    const accent = new MeshStandardMaterial({ color: livery.accent, roughness: 0.4, metalness: 0.2 });
    const carbon = new MeshStandardMaterial({ color: 0x15171a, roughness: 0.55, metalness: 0.3 });
    const tyre = new MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
    const rim = new MeshStandardMaterial({ color: 0x9aa1a6, roughness: 0.3, metalness: 0.8 });
    const box = (w: number, h: number, d: number, m: MeshStandardMaterial, x: number, y: number, z: number, parent: Object3D = this.body) => {
      const mesh = new Mesh(new BoxGeometry(w, h, d), m);
      // three.js: x forward (car), y up, z right -> we map car-forward to +X, left to -Z
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const fz = a; // front axle x
    const rz = -b; // rear axle x
    // floor and plank
    box(L + 0.9, 0.03, 1.4, carbon, (fz + rz) / 2 - 0.1, 0.05, 0);
    // monocoque / engine cover (tapered via several boxes)
    box(1.7, 0.42, 0.62, paint, 0.6, 0.38, 0);
    box(1.4, 0.55, 0.85, paint, -0.6, 0.42, 0);
    box(1.0, 0.45, 0.5, paint, -1.6, 0.40, 0);
    box(0.5, 0.25, 0.3, paint2, -2.15, 0.35, 0);
    // nose
    box(1.3, 0.2, 0.3, paint, fz + 0.15, 0.25, 0);
    box(0.4, 0.12, 0.22, paint2, fz + 0.9, 0.2, 0);
    // sidepods
    box(1.6, 0.36, 0.42, paint, -0.4, 0.3, 0.6);
    box(1.6, 0.36, 0.42, paint, -0.4, 0.3, -0.6);
    box(0.6, 0.06, 0.44, accent, 0.2, 0.49, 0.6);
    box(0.6, 0.06, 0.44, accent, 0.2, 0.49, -0.6);
    // airbox / roll hoop
    box(0.35, 0.35, 0.3, carbon, -0.15, 0.8, 0);
    // cockpit opening + driver helmet
    box(0.8, 0.05, 0.45, carbon, 0.35, 0.61, 0);
    const helmet = new Mesh(new SphereGeometry(0.15, 16, 12), new MeshStandardMaterial({ color: 0xfbd000, roughness: 0.3 }));
    helmet.position.set(0.25, 0.72, 0);
    this.body.add(helmet);
    this.cockpitAnchor.position.set(0.22, 0.78, 0);
    this.body.add(this.cockpitAnchor);
    // halo
    const halo = new Mesh(new TorusGeometry(0.33, 0.025, 8, 24, Math.PI), carbon);
    halo.rotation.set(-Math.PI / 2, 0, -Math.PI / 2);
    halo.position.set(0.45, 0.85, 0);
    this.body.add(halo);
    box(0.04, 0.22, 0.04, carbon, 0.78, 0.74, 0);
    // front wing (main plane + active flap)
    box(0.35, 0.03, 1.75, carbon, fz + 0.75, 0.1, 0);
    box(0.3, 0.12, 0.03, paint2, fz + 0.75, 0.15, 0.88);
    box(0.3, 0.12, 0.03, paint2, fz + 0.75, 0.15, -0.88);
    this.frontFlap = new Group();
    this.frontFlap.position.set(fz + 0.62, 0.14, 0);
    box(0.22, 0.02, 1.6, accent, -0.1, 0, 0, this.frontFlap);
    this.body.add(this.frontFlap);
    // rear wing: endplates, main plane, active flap pivoting at its leading edge
    box(0.55, 0.5, 0.03, carbon, rz - 0.35, 0.82, 0.48);
    box(0.55, 0.5, 0.03, carbon, rz - 0.35, 0.82, -0.48);
    box(0.32, 0.04, 0.95, carbon, rz - 0.3, 0.86, 0);
    this.rearFlap = new Group();
    this.rearFlap.position.set(rz - 0.45, 0.96, 0);
    box(0.28, 0.03, 0.95, paint, -0.12, 0, 0, this.rearFlap);
    this.body.add(this.rearFlap);
    box(0.06, 0.4, 0.06, carbon, rz - 0.25, 0.62, 0); // pylon
    // car number panels (simple accent blocks)
    box(0.25, 0.18, 0.02, paint2, 0.3, 0.42, 0.31);
    box(0.25, 0.18, 0.02, paint2, 0.3, 0.42, -0.31);

    // wheels (not part of the sprung body)
    const mkWheel = (x: number, z: number, r: number, width: number, front: boolean) => {
      const pivot = new Group();
      pivot.position.set(x, r, z);
      const spin = new Group();
      const t = new Mesh(new CylinderGeometry(r, r, width, 24), tyre);
      t.rotation.x = Math.PI / 2;
      t.castShadow = true;
      const w = new Mesh(new CylinderGeometry(r * 0.6, r * 0.6, width + 0.01, 12), rim);
      w.rotation.x = Math.PI / 2;
      // a stripe so rotation is visible
      const stripe = new Mesh(new BoxGeometry(r * 1.1, 0.04, width + 0.02), new MeshStandardMaterial({ color: 0xffffff }));
      spin.add(t, w, stripe);
      pivot.add(spin);
      this.root.add(pivot);
      this.wheels.push(spin);
      if (front) this.steerPivots.push(pivot);
      // simple suspension arms for looks
      box(0.05, 0.03, Math.abs(z) - 0.35, carbon, x, r, z / 2 + Math.sign(z) * 0.1, this.root);
    };
    mkWheel(fz, -tf, rf, spec.wheels.widthFrontM, true); // FL (left = -Z)
    mkWheel(fz, tf, rf, spec.wheels.widthFrontM, true); // FR
    mkWheel(rz, -tr, rr, spec.wheels.widthRearM, false); // RL
    mkWheel(rz, tr, rr, spec.wheels.widthRearM, false); // RR
    this.root.add(this.body);
  }

  /**
   * Pose the car. Position = road point under the CG (three.js world), yaw from the physics,
   * pitch/roll = road attitude + body motion. Wheel angles from physics.
   */
  update(p: {
    position: Vector3;
    yaw: number;
    roadPitch: number;
    roadRoll: number;
    bodyPitch: number;
    bodyRoll: number;
    heave: number;
    steerRad: number;
    wheelAngle: number[];
    flapOpen: number;
  }): void {
    this.root.position.copy(p.position);
    // physics yaw is CCW from east; three.js rotation.y CCW seen from above with X = east, Z = -north
    this.root.rotation.set(0, 0, 0);
    this.root.rotateY(p.yaw);
    this.root.rotateZ(p.roadPitch);
    this.root.rotateX(p.roadRoll);
    this.body.position.y = -p.heave;
    this.body.rotation.set(p.bodyRoll, 0, p.bodyPitch);
    for (const pv of this.steerPivots) pv.rotation.y = p.steerRad;
    this.wheels.forEach((w, i) => {
      w.rotation.z = -(p.wheelAngle[i] ?? 0);
    });
    // active aero: flaps rotate toward flat in Straight mode
    this.rearFlap.rotation.z = 0.55 * (1 - p.flapOpen);
    this.frontFlap.rotation.z = 0.25 * (1 - p.flapOpen);
  }
}
