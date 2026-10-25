import * as THREE from 'three';
import { MODULE_RANGES } from '../core/chapters';
import type { SceneContext, SceneModule } from '../core/context';
import type { QualitySettings } from '../core/quality';
import { seeded } from '../core/math';
import { HERO_Y, LAYER_STEP, SLAB_THICK_SCALE, planHeroSlabs } from './heroLayout';

export { HERO_Y };

/** Top layer is the lightest, each layer below is a little deeper: overlaps read as stacked cards. */
const LAYER_COLORS = [0x2a3552, 0x1d263f, 0x131a2d, 0x0b101d];

/**
 * Chapter 1 - the opening. Four large slabs, stacked and overlapping, cover the entire screen;
 * on scroll they peel away top layer first, each toward its own corner, revealing the glowing
 * opening and the stars behind them before the camera dives through.
 *
 * Slab size and position come from `planHeroSlabs(aspect)` (camera-frustum based), so the cover
 * is exact on every viewport and is recomputed when the window changes shape (build() reruns).
 */
export class HeroModule implements SceneModule {
  readonly id = 'hero';
  readonly group = new THREE.Group();
  readonly range = MODULE_RANGES.hero;
  private slabs: THREE.Mesh[] = [];
  private baseWidth: number[] = [];
  private materials = LAYER_COLORS.map(
    (c) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.62, roughness: 0.32, envMapIntensity: 1.25 }),
  );
  private portal!: THREE.Mesh;
  private portalMat!: THREE.ShaderMaterial;
  private stars: THREE.Points | null = null;
  private starMat = new THREE.PointsMaterial({ color: 0xcfe0ff, size: 1.6, sizeAttenuation: false, transparent: true, depthWrite: false });

  constructor() {
    this.group.position.set(0, HERO_Y, 0);
  }

  async load(ctx: SceneContext): Promise<void> {
    const pack = await ctx.assets.pack('hero');
    for (let i = 0; i < 4; i++) {
      const part = pack.get(`hero_${i}`);
      if (!part) continue;
      const mat = this.materials[i];
      if (ctx.env) mat.envMap = ctx.env;
      // The Blender part only supplies the slab's cross-section (bevelled box); pose and size are
      // computed in build() so they always match the camera.
      const geometry = part.geometry;
      geometry.computeBoundingBox();
      const bb = geometry.boundingBox!;
      this.baseWidth.push(Math.max(1e-3, bb.max.x - bb.min.x));
      const m = new THREE.Mesh(geometry, mat);
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
      this.slabs.push(m);
    }

    // Glowing opening under the slabs: the thing the camera dives into.
    this.portalMat = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 }, uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `
        varying vec2 vUv; uniform float uOpacity; uniform float uTime;
        void main(){
          vec2 d = vUv - 0.5; float r = length(d) * 2.0;
          float core = smoothstep(1.0, 0.0, r);
          float ring = smoothstep(0.06, 0.0, abs(r - 0.55 - 0.03 * sin(uTime))) * 0.8;
          vec3 c = mix(vec3(0.15,0.4,1.0), vec3(0.75,0.6,1.0), r) * (core * core * 1.6 + ring);
          gl_FragColor = vec4(c, (core * 0.9 + ring) * uOpacity);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.portal = new THREE.Mesh(new THREE.CircleGeometry(15, 48), this.portalMat);
    this.portal.rotation.x = -Math.PI / 2;
    this.portal.position.y = -3.2;
    this.group.add(this.portal);
    this.buildStars(ctx.quality().stars);
  }

  private buildStars(count: number): void {
    if (this.stars) {
      this.group.remove(this.stars);
      this.stars.geometry.dispose();
      this.stars = null;
    }
    if (count <= 0) return;
    const rand = seeded(42);
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const u = rand() * 2 - 1;
      const a = rand() * Math.PI * 2;
      const r = 260 + rand() * 40;
      const s = Math.sqrt(1 - u * u);
      pos.set([Math.cos(a) * s * r, u * r * 0.8, Math.sin(a) * s * r], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, this.starMat);
    this.stars.frustumCulled = false;
    this.group.add(this.stars);
  }

  build(tl: gsap.core.Timeline, ctx: SceneContext): void {
    const plans = planHeroSlabs(ctx.layout.aspect, this.slabs.length);
    this.slabs.forEach((slab, i) => {
      const p = plans[i];
      const s = p.size / this.baseWidth[i];
      slab.scale.set(s, SLAB_THICK_SCALE, s);
      slab.position.set(p.x, p.y, p.z);
      slab.rotation.set(0, p.yaw, 0);

      // Peel order = stacking order: the top slab leaves first, the bottom one last.
      const start = 0.012 + i * 0.012;
      const dur = 0.096;
      const common = { duration: dur, ease: 'power2.inOut', immediateRender: true } as const;
      tl.fromTo(slab.position, { x: p.x, z: p.z }, { x: p.x + p.dirX * p.travel, z: p.z + p.dirZ * p.travel, ...common }, start);
      // Depth offsets: every slab sinks by a different amount as it slides away.
      tl.fromTo(slab.position, { y: p.y }, { y: p.y - p.drop, ...common }, start + 0.008);
      tl.fromTo(slab.rotation, { x: 0, y: p.yaw, z: 0 }, { x: p.tilt, y: p.yaw + p.spin, z: -p.tilt * 0.7, ...common }, start);
    });
    void LAYER_STEP;

    // Portal glow rises as the first slabs part, then fades once the camera has passed through.
    const o = this.portalMat.uniforms.uOpacity;
    tl.fromTo(o, { value: 0 }, { value: 1, duration: 0.07, ease: 'power2.out', immediateRender: true }, 0.045);
    tl.fromTo(o, { value: 1 }, { value: 0, duration: 0.07, ease: 'power1.in', immediateRender: true }, 0.19);
  }

  update(_dt: number, _p: number, ctx: SceneContext): void {
    if (this.portalMat) this.portalMat.uniforms.uTime.value = ctx.time;
    this.starMat.opacity = Math.max(0, ctx.sky.space * 0.9);
    if (this.stars) this.stars.visible = ctx.sky.space > 0.02;
  }

  setQuality(q: QualitySettings): void {
    this.buildStars(q.stars);
    this.slabs.forEach((s) => (s.castShadow = s.receiveShadow = q.shadows));
  }

  dispose(): void {
    this.slabs.forEach((s) => s.geometry.dispose());
    this.materials.forEach((m) => m.dispose());
    this.starMat.dispose();
    this.stars?.geometry.dispose();
    this.portal?.geometry.dispose();
    this.portalMat?.dispose();
  }
}
