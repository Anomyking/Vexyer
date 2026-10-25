import * as THREE from 'three';
import { MODULE_RANGES } from '../core/chapters';
import type { SceneContext, SceneModule } from '../core/context';
import type { QualitySettings } from '../core/quality';
import { createCloudMaterial, setCloudOctaves } from '../effects/clouds';
import { sunDirection } from '../effects/skydome';
import { layoutClouds } from './cloudLayout';
import { seeded } from '../core/math';

/** Sky chapter fly-through: close cloud puffs rush past the camera between these progress values. */
const STREAM = { from: 0.62, to: 0.815, travel: 150 };
interface Streamer { x: number; y: number; z0: number; size: number }

/**
 * Chapter 3/6 - clouds. The sea the camera dives through after the portfolio, a distant cloud
 * deck under the horizon, framing banks, and banks along the paper plane's flight path. All puffs
 * share one quad and one material: a single draw call. Layout lives in cloudLayout.ts (pure).
 */
export class AtmosphereModule implements SceneModule {
  readonly id = 'atmosphere';
  readonly group = new THREE.Group();
  readonly range = MODULE_RANGES.atmosphere;
  private material = createCloudMaterial();
  private geometry = new THREE.PlaneGeometry(1, 1);
  private mesh: THREE.InstancedMesh | null = null;
  private builtBanks = -1;
  private streamMesh: THREE.InstancedMesh | null = null;
  private streamers: Streamer[] = [];
  private streamM = new THREE.Matrix4();
  private sun = new THREE.Vector3();

  async load(ctx: SceneContext): Promise<void> {
    this.rebuild(ctx.quality());
  }

  private rebuild(q: QualitySettings): void {
    setCloudOctaves(this.material, q.cloudOctaves);
    if (this.mesh && this.builtBanks === q.cloudBanks) return;
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.dispose();
      this.mesh.geometry.deleteAttribute('aData');
    }
    const puffs = layoutClouds(q.cloudBanks);
    // Own geometry per mesh so the per-instance attribute is not shared with a stale mesh.
    const geo = this.geometry.clone();
    const data = new Float32Array(puffs.length * 4);
    const mesh = new THREE.InstancedMesh(geo, this.material, Math.max(1, puffs.length));
    const m = new THREE.Matrix4();
    puffs.forEach((p, i) => {
      m.makeTranslation(p.x, p.y, p.z);
      mesh.setMatrixAt(i, m);
      data.set([p.size, p.seed, p.tone, p.stretch], i * 4);
    });
    geo.setAttribute('aData', new THREE.InstancedBufferAttribute(data, 4));
    mesh.count = puffs.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.renderOrder = 1; // behind the glass, which renders at 5
    this.mesh = mesh;
    this.group.add(mesh);
    this.builtBanks = q.cloudBanks;
    this.buildStreamers(q.cloudBanks);
  }

  private buildStreamers(banks: number): void {
    if (this.streamMesh) {
      this.group.remove(this.streamMesh);
      this.streamMesh.dispose();
      this.streamMesh.geometry.dispose();
      this.streamMesh = null;
    }
    const n = banks <= 0 ? 0 : banks < 8 ? 8 : 18;
    if (!n) return;
    const r = seeded(77);
    this.streamers = Array.from({ length: n }, (_, i) => {
      const side = i % 2 ? 1 : -1;
      const low = i % 3 === 0;
      return {
        // Keep the middle of the frame clear for the blades and text: streamers pass low and to the sides.
        x: side * (low ? 12 + r() * 20 : 26 + r() * 14),
        y: low ? 38 + r() * 12 : 60 + r() * 16,
        z0: -170 + (i / n) * 120 + r() * 12,
        size: 10 + r() * 12,
      };
    });
    const geo = this.geometry.clone();
    const data = new Float32Array(n * 4);
    this.streamers.forEach((st, i) => data.set([st.size, r() * 100, 0.45 + r() * 0.55, 1.35], i * 4));
    geo.setAttribute('aData', new THREE.InstancedBufferAttribute(data, 4));
    const mesh = new THREE.InstancedMesh(geo, this.material, n);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    mesh.visible = false;
    this.streamMesh = mesh;
    this.group.add(mesh);
  }

  build(): void {}

  update(_dt: number, p: number, ctx: SceneContext): void {
    if (this.streamMesh) {
      const u = (p - STREAM.from) / (STREAM.to - STREAM.from);
      const on = u > 0 && u < 1 && !ctx.reducedMotion();
      this.streamMesh.visible = on;
      if (on) {
        this.streamers.forEach((st, i) => {
          this.streamM.makeTranslation(st.x, st.y, st.z0 + u * STREAM.travel);
          this.streamMesh!.setMatrixAt(i, this.streamM);
        });
        this.streamMesh.instanceMatrix.needsUpdate = true;
      }
    }
    const u = this.material.uniforms;
    u.uTime.value = ctx.time;
    (u.uSun.value as THREE.Vector3).copy(sunDirection(ctx.sky.dusk, this.sun));
    const d = ctx.sky.dusk;
    u.uOpacity.value = 0.96 * (1 - ctx.sky.stage); // clouds vanish into the dark stage
    // Sun-lit side, shaded side and distance haze all warm up for the dusk flight.
    (u.uLit.value as THREE.Color).setRGB(1.0, 0.99 - d * 0.24, 0.97 - d * 0.42);
    (u.uShade.value as THREE.Color).setRGB(0.58 + d * 0.26, 0.68 - d * 0.2, 0.84 - d * 0.3);
    (u.uHaze.value as THREE.Color).setRGB(0.74 + d * 0.26, 0.85 - d * 0.23, 0.97 - d * 0.55);
  }

  setQuality(q: QualitySettings): void {
    this.rebuild(q);
  }

  dispose(): void {
    this.mesh?.dispose();
    this.mesh?.geometry.dispose();
    this.streamMesh?.dispose();
    this.streamMesh?.geometry.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
