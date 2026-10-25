import * as THREE from 'three';
import type { QualitySettings } from '../core/quality';
import type { SceneContext, SceneModule } from '../core/context';
import { lerp } from '../core/math';

/**
 * Global lighting. Intensities are derived each frame from the atmosphere state (space -> day ->
 * dusk), so they stay correct no matter how the user scrubs the timeline.
 * Shadows are deliberately restrained: one small shadow map, only over the opening scene.
 */
export class LightingModule implements SceneModule {
  readonly id = 'lighting';
  readonly group = new THREE.Group();
  readonly range = [0, 1] as const;
  private hemi = new THREE.HemisphereLight(0xbcd7ff, 0x1a2036, 0.4);
  private sun = new THREE.DirectionalLight(0xffffff, 2.2);
  private rim = new THREE.DirectionalLight(0x7cc4ff, 0.9);
  private night = new THREE.Color(0x9db7ff);
  private day = new THREE.Color(0xfff4e0);
  private dusk = new THREE.Color(0xffb27a);

  constructor() {
    this.sun.position.set(18, 150, 26);
    this.sun.target.position.set(0, 115, 0);
    this.rim.position.set(-30, 60, -40);
    this.group.add(this.hemi, this.sun, this.sun.target, this.rim);
    const s = this.sun.shadow;
    // Wide enough for the screen-filling hero slabs (they are ~30 units across on desktop).
    s.camera.left = -38; s.camera.right = 38; s.camera.top = 38; s.camera.bottom = -38;
    s.camera.near = 1; s.camera.far = 120;
    s.bias = -0.0006;
    s.normalBias = 0.04;
  }

  async load(): Promise<void> {}
  build(): void {}

  update(_dt: number, _p: number, ctx: SceneContext): void {
    const { space, dusk } = ctx.sky;
    this.hemi.intensity = lerp(0.95, 0.45, space);
    this.sun.intensity = lerp(2.4, 2.0, space);
    this.sun.color.copy(this.day).lerp(this.night, space).lerp(this.dusk, dusk);
    this.rim.intensity = lerp(0.35, 0.9, space);
  }

  setQuality(q: QualitySettings, ctx: SceneContext): void {
    ctx.renderer.shadowMap.enabled = q.shadows;
    this.sun.castShadow = q.shadows;
    if (q.shadows && this.sun.shadow.mapSize.x !== q.shadowMapSize) {
      this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  dispose(): void {
    this.sun.shadow.map?.dispose();
  }
}
