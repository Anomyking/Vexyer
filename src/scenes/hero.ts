import * as THREE from 'three';
import { MODULE_RANGES } from '../core/chapters';
import type { SceneContext, SceneModule } from '../core/context';
import type { QualitySettings } from '../core/quality';
import { seeded } from '../core/math';
import { HERO_GROUP_Y, planHeroCover } from './heroCover';

export const HERO_Y = HERO_GROUP_Y;

/**
 * Chapter 1 - the opening. Four big slabs (from the Blender sketch) are scaled so that, overlapping
 * and stacked at different heights, they cover the entire first frame (see heroCover.ts). Scrolling
 * slides them apart with staggered timing, depth offsets and easing, revealing a glowing opening
 * that the camera then travels down through. A starfield sells the "above the clouds" scale.
 */
export class HeroModule implements SceneModule {
  readonly id = 'hero';
  readonly group = new THREE.Group();
  readonly range = MODULE_RANGES.hero;
  private slabs: THREE.Mesh[] = [];
  /** Unit footprint (x, z) of each slab's geometry, so scaling can target exact world sizes. */
  private unit: THREE.Vector2[] = [];
  private material = new THREE.MeshStandardMaterial({ color: 0x151a26, metalness: 0.7, roughness: 0.32, envMapIntensity: 1.1 });
  private edgeMaterial = new THREE.MeshBasicMaterial({ color: 0x7cc4ff, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending });
  private portal!: THREE.Mesh;
  private portalMat!: THREE.ShaderMaterial;
  private stars: THREE.Points | null = null;
  private starMat = new THREE.PointsMaterial({ color: 0xcfe0ff, size: 1.6, sizeAttenuation: false, transparent: true, depthWrite: false });

  constructor() {
    this.group.position.set(0, HERO_Y, 0);
  }

  async load(ctx: SceneContext): Promise<void> {
    const pack = await ctx.assets.pack('hero');
    ctx.env && (this.material.envMap = ctx.env);
    for (let i = 0; i < 4; i++) {
      const part = pack.get(`hero_${i}`);
      if (!part) continue;
      const m = new THREE.Mesh(part.geometry, this.material);
      m.position.copy(part.position);
      m.quaternion.copy(part.quaternion);
      m.castShadow = m.receiveShadow = true;
      part.geometry.computeBoundingBox();
      const size = part.geometry.boundingBox!.getSize(new THREE.Vector3());
      this.unit.push(new THREE.Vector2(Math.max(0.01, size.x), Math.max(0.01, size.z)));
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
    this.portal = new THREE.Mesh(new THREE.CircleGeometry(9, 48), this.portalMat);
    this.portal.rotation.x = -Math.PI / 2;
    this.portal.position.y = -2.4;
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
      // Points on a big shell, biased to the upper hemisphere so they sit "behind" the structure.
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
    // Size and place the slabs for the current screen shape (rebuilt whenever the aspect changes).
    const plan = planHeroCover(ctx.layout.aspect);
    this.slabs.forEach((slab, i) => {
      const sp = plan.slabs[i];
      slab.scale.set(sp.width / this.unit[i].x, 1, sp.depth / this.unit[i].y);
      const start = 0.015 + i * 0.012; // staggered
      const dur = 0.115 - i * 0.006;
      const common = { duration: dur, ease: 'power3.inOut', immediateRender: true } as const;
      tl.fromTo(slab.position, { x: sp.x, z: sp.z }, { x: sp.x + sp.openX, z: sp.z + sp.openZ, ...common }, start);
      // Depth offsets: each slab drops by a different amount so they read as separate masses.
      tl.fromTo(slab.position, { y: sp.y }, { y: sp.y - (1.5 + i * 1.6), ...common, ease: 'power2.inOut' }, start + 0.008);
      tl.fromTo(slab.rotation, { x: 0, z: 0 }, { x: (i % 2 ? 1 : -1) * 0.11, z: (i < 2 ? 1 : -1) * 0.09, ...common }, start);
    });
    // Portal glow rises as the slabs part, then fades once the camera has passed through.
    const o = this.portalMat.uniforms.uOpacity;
    tl.fromTo(o, { value: 0 }, { value: 1, duration: 0.07, ease: 'power2.out', immediateRender: true }, 0.05);
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
    this.material.dispose();
    this.edgeMaterial.dispose();
    this.starMat.dispose();
    this.stars?.geometry.dispose();
    this.portal?.geometry.dispose();
    this.portalMat?.dispose();
  }
}
