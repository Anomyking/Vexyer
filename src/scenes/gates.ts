import * as THREE from 'three';
import { GATE_PROGRESS, MODULE_RANGES, nearestGate } from '../core/chapters';
import type { SceneContext, SceneModule } from '../core/context';
import { smoothstep } from '../core/math';
import type { QualitySettings } from '../core/quality';

/** World units the gates travel toward the camera per unit of scroll progress. */
export const GATE_SPEED = 1100;
const MAX_D = 110;
const R = 7;

/** Distance ahead of the camera (negative once passed) of the gate that is crossed at progress `g`. */
export const gateDistance = (g: number, p: number): number => (g - p) * GATE_SPEED;
/** Fades gates in from the haze and out as they pass over the lens. */
export const gateAlpha = (d: number): number => smoothstep(MAX_D, MAX_D * 0.55, d) * smoothstep(-2, 5, d);

function radialTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grd.addColorStop(0, 'rgba(190,225,255,0.0)');
    grd.addColorStop(0.7, 'rgba(90,140,255,0.16)');
    grd.addColorStop(1, 'rgba(90,140,255,0.0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function numeralTexture(n: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    g.clearRect(0, 0, 128, 128);
    g.lineWidth = 5;
    g.strokeStyle = '#2f6bff';
    g.beginPath();
    g.arc(64, 64, 52, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#2f6bff';
    g.font = '600 64px ui-sans-serif, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(n), 64, 68);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Gate {
  group: THREE.Group;
  ring: THREE.Mesh;
  outer: THREE.Mesh;
  mats: THREE.MeshBasicMaterial[];
}

/**
 * Process gates: a tunnel of glowing rings in the cloud sea. They are positioned relative to the camera
 * every frame (after the camera is applied), so the camera always flies through the middle of each ring at
 * the progress listed in GATE_PROGRESS, whatever the scripted camera path does.
 */
export class GatesModule implements SceneModule {
  readonly id = 'process';
  readonly group = new THREE.Group();
  readonly range = MODULE_RANGES.process;
  private gates: Gate[] = [];
  private disposables: Array<{ dispose(): void }> = [];
  private fwd = new THREE.Vector3();
  private right = new THREE.Vector3();
  private up = new THREE.Vector3();

  async load(): Promise<void> {
    const halo = radialTexture();
    this.disposables.push(halo);
    const ringGeo = new THREE.TorusGeometry(R, 0.17, 10, 112);
    const outerGeo = new THREE.TorusGeometry(R * 1.13, 0.05, 6, 112);
    const discGeo = new THREE.CircleGeometry(R * 1.05, 48);
    this.disposables.push(ringGeo, outerGeo, discGeo);
    const base = { transparent: true, depthWrite: false, depthTest: false, toneMapped: false } as const;
    const glow = { ...base, blending: THREE.AdditiveBlending } as const;
    GATE_PROGRESS.forEach((_, i) => {
      const group = new THREE.Group();
      const m1 = new THREE.MeshBasicMaterial({ color: 0x2f6bff, ...base });
      const m2 = new THREE.MeshBasicMaterial({ color: 0x8a6bff, ...base });
      const m3 = new THREE.MeshBasicMaterial({ map: halo, ...glow });
      const num = numeralTexture(i + 1);
      const m4 = new THREE.MeshBasicMaterial({ map: num, transparent: true, depthWrite: false, depthTest: false, toneMapped: false });
      this.disposables.push(m1, m2, m3, m4, num);
      const ring = new THREE.Mesh(ringGeo, m1);
      const outer = new THREE.Mesh(outerGeo, m2);
      const disc = new THREE.Mesh(discGeo, m3);
      const label = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), m4);
      label.position.set(R + 2.8, 0, 0);
      this.disposables.push(label.geometry);
      [disc, ring, outer, label].forEach((m, k) => { m.renderOrder = 6 + k * 0.01; group.add(m); });
      group.visible = false;
      this.group.add(group);
      this.gates.push({ group, ring, outer, mats: [m1, m2, m3, m4] });
    });
  }

  build(): void {}
  update(): void {}
  setQuality(_q: QualitySettings, _ctx?: SceneContext): void {}

  /** Index of the gate currently being crossed (for the HTML step list). */
  static current = nearestGate;

  /** Called once per frame after the camera has been applied. */
  place(camera: THREE.PerspectiveCamera, p: number, time: number): void {
    if (!this.group.visible || !this.gates.length) return;
    camera.getWorldDirection(this.fwd);
    this.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const cur = nearestGate(p);
    this.gates.forEach((g, i) => {
      const d = gateDistance(GATE_PROGRESS[i], p);
      const a = gateAlpha(d);
      g.group.visible = a > 0.003;
      if (!g.group.visible) return;
      // Far gates drift off-axis (a gently curving tunnel); at d = 0 the offset is zero, so the camera threads the ring.
      const far = Math.max(0, d) / MAX_D;
      const ox = Math.sin(i * 2.1 + 0.7) * far * 9;
      const oy = Math.cos(i * 1.7 + 0.3) * far * 5;
      g.group.position.copy(camera.position).addScaledVector(this.fwd, d).addScaledVector(this.right, ox).addScaledVector(this.up, oy);
      g.group.quaternion.copy(camera.quaternion);
      const active = i === cur ? 1 : 0;
      g.ring.rotation.z = time * 0.25 * (i % 2 ? 1 : -1);
      g.outer.rotation.z = -time * 0.18 * (i % 2 ? 1 : -1);
      g.group.scale.setScalar(1 + active * 0.06 * Math.sin(time * 3));
      g.mats[0].opacity = a * (0.55 + 0.45 * active);
      g.mats[1].opacity = a * (0.35 + 0.4 * active);
      g.mats[2].opacity = a * (0.5 + 0.5 * active);
      g.mats[3].opacity = a * (0.55 + 0.45 * active);
    });
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.gates = [];
  }
}
