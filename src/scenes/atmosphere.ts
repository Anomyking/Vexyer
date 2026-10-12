import * as THREE from 'three';
import { MODULE_RANGES } from '../core/chapters';
import type { SceneContext, SceneModule } from '../core/context';
import type { QualitySettings } from '../core/quality';
import { createCloudMaterial } from '../effects/clouds';
import { seeded } from '../core/math';

/**
 * Chapter 3/6 - clouds. A "sea" the camera dives through after the portfolio (its four centre
 * banks reproduce the sketch's rows) plus a second set along the final flight corridor. All
 * instances share one geometry and one material: a single draw call.
 */
export class AtmosphereModule implements SceneModule {
  readonly id = 'atmosphere';
  readonly group = new THREE.Group();
  readonly range = MODULE_RANGES.atmosphere;
  private material = createCloudMaterial();
  private mesh: THREE.InstancedMesh | null = null;
  private pack: Awaited<ReturnType<SceneContext['assets']['pack']>> | null = null;
  private builtCount = -1;
  private builtLow = false;

  async load(ctx: SceneContext): Promise<void> {
    this.pack = await ctx.assets.pack('sky');
    this.rebuild(ctx.quality());
  }

  private rebuild(q: QualitySettings): void {
    const geo = this.pack?.get(q.lowPolyMeshes ? 'cloud_bank_lo' : 'cloud_bank')?.geometry;
    if (!geo) return;
    if (this.mesh && this.builtCount === q.cloudBanks && this.builtLow === q.lowPolyMeshes) return;
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.dispose();
    }
    const n = q.cloudBanks;
    const mesh = new THREE.InstancedMesh(geo, this.material, n);
    const rand = seeded(5);
    const m = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const e = new THREE.Euler();
    // Layer A: cloud sea around the sketch height (y ~ 89.7). The first four match the sketch rows.
    const seaCount = Math.ceil(n * 0.6);
    const sketchZ = [14.5, 4, -5.9, -16.3];
    for (let i = 0; i < n; i++) {
      let pos: THREE.Vector3;
      let scale: THREE.Vector3;
      if (i < seaCount) {
        pos = i < 4 ? new THREE.Vector3(0, 89.7, sketchZ[i]) : new THREE.Vector3((rand() * 2 - 1) * 70, 80 + rand() * 14, 22 - rand() * 80);
        const s = i < 4 ? 1 : 0.8 + rand() * 0.9;
        scale = new THREE.Vector3(s, s * 0.5, s);
      } else {
        // Layer B: along the flight corridor (z from -40 down to -440, y 14..40).
        const t = (i - seaCount) / Math.max(1, n - seaCount - 1);
        const side = i % 2 ? 1 : -1;
        pos = new THREE.Vector3(side * (22 + rand() * 50), 14 + rand() * 26, -40 - t * 400);
        const s = 1.1 + rand() * 1.1;
        scale = new THREE.Vector3(s, s * 0.45, s);
      }
      e.set(0, rand() * Math.PI, 0);
      quat.setFromEuler(e);
      m.compose(pos, quat, scale);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    this.mesh = mesh;
    this.group.add(mesh);
    this.builtCount = n;
    this.builtLow = q.lowPolyMeshes;
  }

  build(): void {}

  update(_dt: number, _p: number, ctx: SceneContext): void {
    const u = this.material.uniforms;
    u.uTime.value = ctx.time;
    u.uSpeed.value = ctx.sky.speed;
    // Clouds take on the dusk colour for the final flight.
    (u.uLit.value as THREE.Color).setRGB(1, 0.99 - ctx.sky.dusk * 0.22, 0.98 - ctx.sky.dusk * 0.4);
    (u.uShade.value as THREE.Color).setRGB(0.55 + ctx.sky.dusk * 0.3, 0.66 - ctx.sky.dusk * 0.12, 0.84 - ctx.sky.dusk * 0.2);
  }

  setQuality(q: QualitySettings): void {
    this.rebuild(q);
  }

  dispose(): void {
    this.mesh?.dispose();
    this.material.dispose();
  }
}
