import { Color, DirectionalLight, Fog, HemisphereLight, MathUtils, Object3D, Scene, Vector3, type WebGLRenderer } from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export type WeatherPreset = 'sunny' | 'overcast';

/** Sun + sky + fog rig. The shadow camera follows a target point (usually the camera). */
export class LightingRig {
  readonly sun = new DirectionalLight(0xffffff, 3);
  readonly hemi = new HemisphereLight(0xbfd8ff, 0x4a5a3a, 0.8);
  readonly sky = new Sky();
  private readonly sunDir = new Vector3();
  private preset: WeatherPreset = 'sunny';
  private shadowDistance = 150;

  constructor(private readonly scene: Scene, private readonly renderer: WebGLRenderer) {
    this.sky.scale.setScalar(20000);
    scene.add(this.sky, this.hemi, this.sun, this.sun.target);
    // Spa, summer afternoon: sun in the south-west, ~38 deg high
    this.setSun(225, 38);
  }

  setSun(azimuthDeg: number, elevationDeg: number): void {
    // azimuth clockwise from north; three: north = -Z, east = +X
    const phi = MathUtils.degToRad(90 - elevationDeg);
    const theta = MathUtils.degToRad(azimuthDeg);
    this.sunDir.set(Math.sin(phi) * Math.sin(theta), Math.cos(phi), -Math.sin(phi) * Math.cos(theta));
    this.sky.material.uniforms.sunPosition!.value.copy(this.sunDir);
  }

  configureShadows(enabled: boolean, mapSize: number, distance: number): void {
    this.renderer.shadowMap.enabled = enabled;
    this.sun.castShadow = enabled;
    this.shadowDistance = distance;
    const cam = this.sun.shadow.camera;
    cam.left = -distance;
    cam.right = distance;
    cam.top = distance;
    cam.bottom = -distance;
    cam.near = 1;
    cam.far = 2000;
    this.sun.shadow.mapSize.set(mapSize, mapSize);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    cam.updateProjectionMatrix();
  }

  setWeather(preset: WeatherPreset, drawDistance: number): void {
    this.preset = preset;
    const u = this.sky.material.uniforms;
    if (preset === 'sunny') {
      u.turbidity!.value = 4;
      u.rayleigh!.value = 1.4;
      u.mieCoefficient!.value = 0.004;
      u.mieDirectionalG!.value = 0.8;
      this.sky.visible = true;
      this.sun.intensity = 3.2;
      this.sun.color.set(0xfff3e0);
      this.hemi.intensity = 0.9;
      this.hemi.color.set(0xbfd8ff);
      this.scene.background = null;
      this.scene.fog = new Fog(0xc4d4e4, drawDistance * 0.35, drawDistance);
      this.renderer.toneMappingExposure = 0.55;
    } else {
      this.sky.visible = false;
      const grey = new Color(0xa9b0b6);
      this.scene.background = grey;
      this.scene.fog = new Fog(grey, 120, Math.min(1400, drawDistance));
      this.sun.intensity = 0.55;
      this.sun.color.set(0xdfe6ee);
      this.hemi.intensity = 2.2;
      this.hemi.color.set(0xd5dde6);
      this.renderer.toneMappingExposure = 0.85;
    }
  }

  get weather(): WeatherPreset {
    return this.preset;
  }

  /** Keep the shadow frustum centred near the viewer. */
  follow(target: Object3D | Vector3): void {
    const p = target instanceof Vector3 ? target : target.position;
    this.sun.target.position.copy(p);
    this.sun.position.copy(p).addScaledVector(this.sunDir, 800);
    // texel snapping reduces shadow shimmering while moving
    const texel = (2 * this.shadowDistance) / this.sun.shadow.mapSize.x;
    this.sun.target.position.x = Math.round(this.sun.target.position.x / texel) * texel;
    this.sun.target.position.z = Math.round(this.sun.target.position.z / texel) * texel;
    this.sun.position.x = this.sun.target.position.x + this.sunDir.x * 800;
    this.sun.position.z = this.sun.target.position.z + this.sunDir.z * 800;
    this.sun.target.updateMatrixWorld();
  }
}
