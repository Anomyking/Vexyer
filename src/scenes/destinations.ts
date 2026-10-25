import * as THREE from 'three';
import { DESTINATIONS, MODULE_RANGES } from '../core/chapters';
import type { SceneModule } from '../core/context';
import { clamp, lerp, smoothstep } from '../core/math';
import type { QualitySettings } from '../core/quality';

const COLORS = [0x2f6bff, 0xff7a1a, 0x8a3dff];

export interface RingScreen { x: number; y: number; r: number; visible: boolean }

/**
 * Finale destinations: three gyroscope rings (landing page, store, immersive site) that hover in front of the
 * chase camera. They are camera-relative (positioned after the camera is applied), so the layout is stable
 * whatever the plane does, and the HTML buttons that make them interactive can be projected onto them.
 */
export class DestinationsModule implements SceneModule {
  readonly id = 'destinations';
  readonly group = new THREE.Group();
  readonly range = MODULE_RANGES.destinations;
  private rigs: THREE.Group[] = [];
  private spinners: THREE.Mesh[] = [];
  private mats: THREE.MeshBasicMaterial[][] = [];
  private hover = -1;
  private hoverAmt = [0, 0, 0];
  private disposables: Array<{ dispose(): void }> = [];
  private fwd = new THREE.Vector3();
  private right = new THREE.Vector3();
  private up = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private radius = 1;

  async load(): Promise<void> {
    const ringGeo = new THREE.TorusGeometry(1, 0.07, 10, 96);
    const innerGeo = new THREE.TorusGeometry(0.78, 0.028, 8, 80);
    const discGeo = new THREE.CircleGeometry(0.96, 40);
    this.disposables.push(ringGeo, innerGeo, discGeo);
    const base = { transparent: true, depthWrite: false, depthTest: false, toneMapped: false } as const;
    const glow = { ...base, blending: THREE.AdditiveBlending } as const;
    DESTINATIONS.forEach((_, i) => {
      const rig = new THREE.Group();
      const c = new THREE.Color(COLORS[i]);
      const m1 = new THREE.MeshBasicMaterial({ color: c, ...base });
      const m2 = new THREE.MeshBasicMaterial({ color: 0xffffff, ...glow });
      const m3 = new THREE.MeshBasicMaterial({ color: c, ...glow, opacity: 0.1 });
      this.disposables.push(m1, m2, m3);
      const ring = new THREE.Mesh(ringGeo, m1);
      const inner = new THREE.Mesh(innerGeo, m2);
      const disc = new THREE.Mesh(discGeo, m3);
      [disc, ring, inner].forEach((m, k) => { m.renderOrder = 8 + k * 0.01; rig.add(m); });
      rig.visible = false;
      this.group.add(rig);
      this.rigs.push(rig);
      this.spinners.push(inner);
      this.mats.push([m1, m2, m3]);
    });
  }

  build(): void {}
  update(): void {}
  setQuality(_q: QualitySettings): void {}

  setHover(i: number): void { this.hover = i; }

  /** Called once per frame after the camera has been applied. */
  place(camera: THREE.PerspectiveCamera, p: number, time: number, dt: number): void {
    if (!this.group.visible || !this.rigs.length) return;
    const u = clamp((p - 0.95) / 0.05);
    const e = u * u * (3 - 2 * u);
    const D = lerp(80, 36, e);
    const halfH = D * Math.tan((camera.fov * Math.PI) / 360);
    const halfW = halfH * camera.aspect;
    this.radius = camera.aspect < 0.9 ? Math.min(halfH * 0.1, halfW * 0.2) : Math.min(halfH * 0.2, halfW * 0.23);
    camera.getWorldDirection(this.fwd);
    this.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const alpha = smoothstep(0.955, 0.978, p);
    this.rigs.forEach((rig, i) => {
      rig.visible = alpha > 0.003;
      this.hoverAmt[i] += ((this.hover === i ? 1 : 0) - this.hoverAmt[i]) * Math.min(1, dt * 9);
      const h = this.hoverAmt[i];
      const portrait = camera.aspect < 0.9;
      // Landscape: a row below the plane. Portrait: a column, with the labels to the right of each ring.
      const ox = portrait ? 0 : (i - 1) * Math.min(halfW * 0.56, halfH * 1.05);
      const oy = portrait ? -halfH * (0.14 + i * 0.27) : -halfH * 0.34;
      rig.position.copy(camera.position)
        .addScaledVector(this.fwd, D)
        .addScaledVector(this.right, ox - (portrait ? halfW * 0.4 : 0))
        .addScaledVector(this.up, oy + Math.sin(time * 1.3 + i * 2) * halfH * 0.012);
      rig.quaternion.copy(camera.quaternion);
      rig.scale.setScalar(this.radius * (1 + h * 0.16));
      this.spinners[i].rotation.set(time * 0.9 + i, time * 0.7, 0);
      this.mats[i][0].opacity = alpha * (0.7 + 0.3 * h);
      this.mats[i][1].opacity = alpha * (0.45 + 0.5 * h);
      this.mats[i][2].opacity = alpha * (0.1 + 0.22 * h);
    });
  }

  /** Screen-space centre and radius of ring `i`, for positioning its HTML button. */
  project(i: number, camera: THREE.PerspectiveCamera, width: number, height: number): RingScreen {
    const rig = this.rigs[i];
    if (!rig || !rig.visible) return { x: 0, y: 0, r: 0, visible: false };
    const c = this.tmp.copy(rig.position).project(camera);
    const edgeW = rig.position.clone().addScaledVector(this.right, this.radius).project(camera);
    return {
      x: (c.x * 0.5 + 0.5) * width,
      y: (-c.y * 0.5 + 0.5) * height,
      r: Math.abs((edgeW.x - c.x) * 0.5 * width),
      visible: c.z < 1 && c.z > -1,
    };
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.rigs = [];
  }
}
