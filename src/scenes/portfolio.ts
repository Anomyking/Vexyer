import * as THREE from 'three';
import { MODULE_RANGES, PORTFOLIO } from '../core/chapters';
import type { SceneContext, SceneModule } from '../core/context';
import type { QualitySettings } from '../core/quality';
import { createPreviewTexture } from '../effects/previews';
import { clamp, easeOutCubic } from '../core/math';

export const RING_Y = 98;
export const RING_X_START = 6;
export const RING_X_END = -6;
const RING_RADIUS = 10.4;
const SCREEN_RADIUS = 15.5;
const SCREEN_W = 6.4;
const SCREEN_H = 4.0;

/** Wrap an angle to [-PI, PI]. */
const wrapAngle = (a: number): number => {
  const t = (a + Math.PI) % (Math.PI * 2);
  return (t < 0 ? t + Math.PI * 2 : t) - Math.PI;
};

interface ScreenItem {
  holder: THREE.Group; // positioned on the circle, faces outward
  mesh: THREE.Mesh;
  frame: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  angle: number;
}

/**
 * Chapter 2 - the portfolio installation: a central sphere, a ring of twisted block segments
 * (one InstancedMesh, one draw call) and floating project screens. Scroll progress drives the
 * ring's rotation and horizontal translation; the snapping system settles each project in focus.
 */
export class PortfolioModule implements SceneModule {
  readonly id = 'portfolio';
  readonly group = new THREE.Group();
  readonly range = MODULE_RANGES.portfolio;

  /** Tweened by the master timeline: u = 0..1 across the portfolio; enter = 0..1 entrance. */
  readonly state = { u: 0, enter: 0 };

  private ringMat = new THREE.MeshStandardMaterial({ color: 0xc9ced9, metalness: 0.9, roughness: 0.3, envMapIntensity: 1.3 });
  private coreMat = new THREE.MeshStandardMaterial({ color: 0x2d6bff, metalness: 0.25, roughness: 0.18, emissive: 0x0a2a8a, emissiveIntensity: 0.9, envMapIntensity: 1.4 });
  private frameMat = new THREE.MeshStandardMaterial({ color: 0x0b0f18, metalness: 0.8, roughness: 0.4 });

  private ring: THREE.InstancedMesh | null = null;
  private ringPivot = new THREE.Group();
  private screensPivot = new THREE.Group();
  private core: THREE.Mesh | null = null;
  private screens: ScreenItem[] = [];
  private pack: Awaited<ReturnType<SceneContext['assets']['pack']>> | null = null;
  private previewSize = 0;
  private hues: number[] = [];
  private textures: THREE.Texture[] = [];
  private builtSegments = 0;
  private builtLow = false;
  /** Index of the project currently closest to the viewer (for HTML sync). */
  focusIndex = 0;

  constructor(private count: number = PORTFOLIO.count) {
    this.group.position.set(RING_X_START, RING_Y, 0);
    this.group.add(this.ringPivot, this.screensPivot);
    this.group.scale.setScalar(0.01);
  }

  async load(ctx: SceneContext): Promise<void> {
    this.pack = await ctx.assets.pack('portfolio');
    this.hues = [...document.querySelectorAll<HTMLElement>('[data-project]')].map((el) => Number(el.dataset.hue ?? 210));
    this.count = Math.max(1, this.hues.length || this.count);
    if (ctx.env) {
      this.ringMat.envMap = ctx.env;
      this.coreMat.envMap = ctx.env;
    }
    this.buildCore(ctx.quality());
    this.buildRing(ctx.quality());
    await this.buildScreens(ctx);
  }

  private buildCore(q: QualitySettings): void {
    const geo = this.pack?.get(q.lowPolyMeshes ? 'core_sphere_lo' : 'core_sphere')?.geometry;
    if (!geo) return;
    if (!this.core) {
      this.core = new THREE.Mesh(geo, this.coreMat);
      this.group.add(this.core);
    } else this.core.geometry = geo;
  }

  private buildRing(q: QualitySettings): void {
    const geo = this.pack?.get(q.lowPolyMeshes ? 'ring_segment_lo' : 'ring_segment')?.geometry;
    if (!geo) return;
    if (this.ring && this.builtSegments === q.ringSegments && this.builtLow === q.lowPolyMeshes) return;
    if (this.ring) {
      this.ringPivot.remove(this.ring);
      this.ring.dispose();
    }
    const n = q.ringSegments;
    const mesh = new THREE.InstancedMesh(geo, this.ringMat, n);
    const m = new THREE.Matrix4();
    const qt = new THREE.Quaternion();
    const e = new THREE.Euler();
    const widen = Math.max(1, 72 / n) * 0.96; // keep the ring closed with fewer segments
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      e.set(0, Math.PI / 2 - a, 0);
      qt.setFromEuler(e);
      // Rhythm: alternate heights so the ring reads as a modified, hand-built structure.
      const h = 0.8 + 0.55 * Math.abs(Math.sin(i * 0.9)) + (i % 8 === 0 ? 0.5 : 0);
      m.compose(new THREE.Vector3(Math.cos(a) * RING_RADIUS, 0, Math.sin(a) * RING_RADIUS), qt, new THREE.Vector3(widen, h, 1));
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    this.ring = mesh;
    this.ringPivot.add(mesh);
    this.builtSegments = n;
    this.builtLow = q.lowPolyMeshes;
  }

  private async buildScreens(ctx: SceneContext): Promise<void> {
    const frameGeo = this.pack?.get('screen_frame')?.geometry;
    if (!frameGeo) return;
    const q = ctx.quality();
    this.previewSize = q.previewSize;
    const aniso = ctx.renderer.capabilities.getMaxAnisotropy();
    const planeGeo = new THREE.PlaneGeometry(SCREEN_W, SCREEN_H);
    const textures = await Promise.all(Array.from({ length: this.count }, (_, i) => createPreviewTexture(i, this.hues[i] ?? 210, q.previewSize, ctx.assets, aniso)));
    this.textures = textures;
    for (let i = 0; i < this.count; i++) {
      const a = Math.PI / 2 + (i * Math.PI * 2) / this.count;
      const holder = new THREE.Group();
      holder.position.set(Math.cos(a) * SCREEN_RADIUS, 1.4, Math.sin(a) * SCREEN_RADIUS);
      holder.rotation.y = Math.PI / 2 - a;
      const material = new THREE.MeshBasicMaterial({ map: textures[i], toneMapped: false });
      const mesh = new THREE.Mesh(planeGeo, material);
      mesh.position.z = 0.11;
      const frame = new THREE.Mesh(frameGeo, this.frameMat);
      holder.add(frame, mesh);
      this.screensPivot.add(holder);
      this.screens.push({ holder, mesh, frame, material, angle: a });
    }
    this.applyLayout(ctx);
  }

  private applyLayout(ctx: SceneContext): void {
    const s = ctx.layout.screenScale;
    this.screens.forEach((it) => it.holder.scale.setScalar(s));
  }

  build(tl: gsap.core.Timeline, ctx: SceneContext): void {
    const { start, end } = PORTFOLIO;
    this.applyLayout(ctx);
    // Entrance while the camera descends past the hero (scale/enter), then hold.
    tl.fromTo(this.state, { enter: 0 }, { enter: 1, duration: 0.09, ease: 'power3.out', immediateRender: true }, 0.145);
    // Horizontal translation and rotation progress across the installation, linear so that the
    // magnetic snap points land exactly on project centres.
    tl.fromTo(this.group.position, { x: RING_X_START }, { x: RING_X_END, duration: end - start, ease: 'none', immediateRender: true }, start);
    tl.fromTo(this.state, { u: 0 }, { u: 1, duration: end - start, ease: 'none', immediateRender: true }, start);
  }

  update(_dt: number, _p: number, ctx: SceneContext): void {
    const t = ctx.time;
    const enter = easeOutCubic(this.state.enter);
    this.group.scale.setScalar(Math.max(0.001, 0.35 + enter * 0.65));
    this.ringPivot.visible = this.screensPivot.visible = this.state.enter > 0.001;
    if (this.core) this.core.scale.setScalar(1 + Math.sin(t * 1.3) * 0.03);

    const n = this.count;
    const delta = (Math.PI * 2) / n;
    const psi = this.state.u * (n - 1) * delta; // radians the installation has turned
    this.screensPivot.rotation.y = psi;
    this.ringPivot.rotation.y = -psi * 0.5 + t * 0.05;

    let best = 0;
    let bestD = Infinity;
    this.screens.forEach((it, i) => {
      // Angular distance of this screen from the front position after the turn.
      const d = Math.abs(wrapAngle(it.angle - psi - Math.PI / 2));
      if (d < bestD) { bestD = d; best = i; }
      const focus = clamp(1 - d / (delta * 0.9));
      const s = ctx.layout.screenScale * (1 + 0.1 * focus);
      it.holder.scale.setScalar(s);
      it.holder.position.y = 1.4 + Math.sin(t * 0.9 + i * 1.7) * 0.18;
      const b = 0.38 + 0.62 * focus;
      it.material.color.setRGB(b, b, b);
    });
    this.focusIndex = best;
  }

  setQuality(q: QualitySettings, ctx: SceneContext): void {
    if (!this.pack) return;
    this.buildCore(q);
    this.buildRing(q);
    if (q.previewSize !== this.previewSize && this.screens.length) {
      // Regenerate smaller/larger previews and free the old textures.
      const aniso = ctx.renderer.capabilities.getMaxAnisotropy();
      this.previewSize = q.previewSize;
      Promise.all(this.screens.map((_, i) => createPreviewTexture(i, this.hues[i] ?? 210, q.previewSize, ctx.assets, aniso))).then((tex) => {
        this.textures.forEach((t) => t.dispose());
        this.textures = tex;
        this.screens.forEach((s, i) => { s.material.map = tex[i]; s.material.needsUpdate = true; });
      });
    }
  }

  onResize(ctx: SceneContext): void {
    this.applyLayout(ctx);
  }

  dispose(): void {
    this.ring?.dispose();
    this.core?.geometry.dispose();
    this.screens.forEach((s) => { s.material.dispose(); s.mesh.geometry.dispose(); s.frame.geometry.dispose(); });
    this.textures.forEach((t) => t.dispose());
    this.ringMat.dispose();
    this.coreMat.dispose();
    this.frameMat.dispose();
  }
}
