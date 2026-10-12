import * as THREE from 'three';
import { MODULE_RANGES } from '../core/chapters';
import type { SceneContext, SceneModule } from '../core/context';
import type { QualitySettings } from '../core/quality';
import { createGlassMaterial, setGlassSimple } from '../effects/glass';
import { Spring, easeOutCubic, seeded, lerp } from '../core/math';

const SHARD_A = [[70, 64, -90], [34, 60, -52], [15, 57.5, -30], [9, 56, -23], [4, 53, -2], [-4, 52, 14]];
const SHARD_B = [[-70, 56, -95], [-34, 53, -58], [-15, 50.8, -34], [-9, 49.8, -26], [-4, 47.6, -4], [4, 46.5, 14]];
const FRAG_START = [[-46, 62, -80], [10, 70, -110], [52, 58, -75]];
const FRAG_TINTS = [0x9fe8ff, 0xc8b6ff, 0xffd2b0];

export interface FragmentScreenInfo {
  x: number;
  y: number;
  /** Projected radius in CSS pixels. */
  r: number;
  visible: boolean;
}

/**
 * Chapters 4 & 5 - two elongated glass shards fly in along spline paths (synchronised with HTML
 * messages), then three glass fragments and a cloud of debris converge with damped springs into
 * three interactive anchors. The shards' and fragments' *targets* come from the timeline; the
 * springs only add secondary motion, so reversing the scroll reverses the scene.
 */
export class GlassModule implements SceneModule {
  readonly id = 'glass';
  readonly group = new THREE.Group();
  readonly range = MODULE_RANGES.fragments;

  readonly state = { a: 0, b: 0, conv: 0 };
  private curveA = new THREE.CatmullRomCurve3(SHARD_A.map(([x, y, z]) => new THREE.Vector3(x, y, z)), false, 'centripetal');
  private curveB = new THREE.CatmullRomCurve3(SHARD_B.map(([x, y, z]) => new THREE.Vector3(x, y, z)), false, 'centripetal');
  private shardA!: THREE.Mesh;
  private shardB!: THREE.Mesh;
  private frags: THREE.Mesh[] = [];
  private fragMats: THREE.ShaderMaterial[] = [];
  private springs: Spring[][] = [];
  private shardMats: THREE.ShaderMaterial[] = [];
  private debris: THREE.InstancedMesh | null = null;
  private debrisMat = createGlassMaterial({ tint: 0xbfe6ff, opacity: 0.75, seed: 3 });
  private debrisPos: THREE.Vector3[] = [];
  private debrisSeed: Array<{ phase: number; radius: number; speed: number; anchor: number; start: THREE.Vector3 }> = [];
  private pack: Awaited<ReturnType<SceneContext['assets']['pack']>> | null = null;
  private hover = -1;
  private visited = new Set<number>();
  private hoverAmt = [0, 0, 0];
  private anchors = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private tmp = new THREE.Vector3();
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private builtDebris = -1;

  async load(ctx: SceneContext): Promise<void> {
    this.pack = await ctx.assets.pack('glass');
    const simple = ctx.quality().simpleGlass;
    const sa = this.pack.get('shard_a')?.geometry;
    const sb = this.pack.get('shard_b')?.geometry;
    if (sa && sb) {
      const matA = createGlassMaterial({ tint: 0xa9e0ff, edge: 0xe4f6ff, seed: 1, simple, fresnel: 2.2 });
      const matB = createGlassMaterial({ tint: 0xc9b8ff, edge: 0xf0eaff, seed: 4, simple, fresnel: 2.2 });
      this.shardMats.push(matA, matB);
      this.shardA = new THREE.Mesh(sa, matA);
      this.shardB = new THREE.Mesh(sb, matB);
      this.shardA.visible = this.shardB.visible = false;
      this.group.add(this.shardA, this.shardB);
    }
    for (let i = 0; i < 3; i++) {
      const g = this.pack.get(`frag_${i}`)?.geometry;
      if (!g) continue;
      const mat = createGlassMaterial({ tint: FRAG_TINTS[i], seed: i * 2.1, simple, opacity: 0.95 });
      const mesh = new THREE.Mesh(g, mat);
      mesh.scale.setScalar(1.55);
      this.group.add(mesh);
      this.frags.push(mesh);
      this.fragMats.push(mat);
      this.springs.push([new Spring(FRAG_START[i][0], 38, 7.5), new Spring(FRAG_START[i][1], 38, 7.5), new Spring(FRAG_START[i][2], 38, 7.5)]);
      mesh.position.set(...(FRAG_START[i] as [number, number, number]));
    }
    this.buildDebris(ctx.quality().debris);
  }

  private buildDebris(n: number): void {
    const g = this.pack?.get('frag_debris')?.geometry;
    if (!g || n === this.builtDebris) return;
    if (this.debris) {
      this.group.remove(this.debris);
      this.debris.dispose();
      this.debris = null;
    }
    this.builtDebris = n;
    if (n <= 0) return;
    const rand = seeded(23);
    this.debris = new THREE.InstancedMesh(g, this.debrisMat, n);
    this.debris.frustumCulled = false;
    this.debrisPos = [];
    this.debrisSeed = [];
    for (let i = 0; i < n; i++) {
      const start = new THREE.Vector3((rand() * 2 - 1) * 70, 55 + rand() * 25, -30 - rand() * 90);
      this.debrisPos.push(start.clone());
      this.debrisSeed.push({ phase: rand() * Math.PI * 2, radius: 2.8 + rand() * 4.2, speed: 0.4 + rand() * 0.9, anchor: i % 3, start });
    }
    this.group.add(this.debris);
  }

  setHover(i: number): void {
    this.hover = i;
  }
  markVisited(i: number): void {
    this.visited.add(i);
  }
  isVisited(i: number): boolean {
    return this.visited.has(i);
  }

  build(tl: gsap.core.Timeline): void {
    const o = { immediateRender: true } as const;
    tl.fromTo(this.state, { a: 0 }, { a: 1, duration: 0.062, ease: 'power2.inOut', ...o }, 0.684);
    tl.fromTo(this.state, { b: 0 }, { b: 1, duration: 0.062, ease: 'power2.inOut', ...o }, 0.742);
    tl.fromTo(this.state, { conv: 0 }, { conv: 1, duration: 0.07, ease: 'power2.out', ...o }, 0.795);
  }

  /** Where a shard is at path parameter t (reduced motion shortens the path to a simple slide). */
  private placeShard(mesh: THREE.Mesh, curve: THREE.CatmullRomCurve3, t: number, side: 1 | -1, roll: number): void {
    mesh.visible = t > 0.001 && t < 0.999;
    if (!mesh.visible) return;
    curve.getPoint(t, mesh.position);
    // Long axis lies on a screen diagonal (mirrored per side), slowly rolling about itself.
    const dir = this.tmp.set(0.78 * side, 0.62, -0.12).normalize();
    this.q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    const rollQ = new THREE.Quaternion().setFromAxisAngle(dir, roll);
    mesh.quaternion.copy(rollQ.multiply(this.q));
  }

  update(dt: number, _p: number, ctx: SceneContext): void {
    const time = ctx.time;
    const st = this.state;
    for (const m of [...this.shardMats, ...this.fragMats, this.debrisMat]) {
      m.uniforms.uTime.value = time;
      m.uniforms.uSpace.value = ctx.sky.space;
    }
    if (this.shardA) {
      this.placeShard(this.shardA, this.curveA, st.a, 1, st.a * Math.PI * 1.4 + time * 0.1);
      this.placeShard(this.shardB, this.curveB, st.b, -1, -st.b * Math.PI * 1.4 - time * 0.1);
    }

    // Anchor layout depends on aspect so fragments stay on-screen in portrait.
    const spread = Math.min(1, Math.max(0.42, ctx.layout.aspect / 1.6));
    this.anchors[0].set(-8.5 * spread, 49.6, -26);
    this.anchors[1].set(0, 46.4, -22);
    this.anchors[2].set(8.5 * spread, 49.6, -26);

    const conv = ctx.reducedMotion() ? Math.round(st.conv) : st.conv;
    const k = easeOutCubic(conv);
    this.frags.forEach((f, i) => {
      const sw = (1 - k) * 9;
      const target = this.tmp.set(
        lerp(FRAG_START[i][0], this.anchors[i].x, k) + Math.cos(time * 1.6 + i * 2.1) * sw,
        lerp(FRAG_START[i][1], this.anchors[i].y, k) + Math.sin(time * 1.2 + i) * (0.35 * k) + Math.sin(time * 1.9 + i) * sw * 0.5,
        lerp(FRAG_START[i][2], this.anchors[i].z, k) + Math.sin(time * 1.6 + i * 2.1) * sw,
      );
      const sp = this.springs[i];
      // Springs add overshoot/settle; reduced motion places the fragment directly.
      if (ctx.reducedMotion()) { sp[0].reset(target.x); sp[1].reset(target.y); sp[2].reset(target.z); }
      else { sp[0].update(target.x, dt); sp[1].update(target.y, dt); sp[2].update(target.z, dt); }
      f.position.set(sp[0].value, sp[1].value, sp[2].value);
      const hoverT = this.hover === i ? 1 : 0;
      this.hoverAmt[i] += (hoverT - this.hoverAmt[i]) * Math.min(1, dt * 9);
      f.scale.setScalar(1.55 * (1 + this.hoverAmt[i] * 0.14));
      f.rotation.x += dt * (0.35 + i * 0.12) * (1 + this.hoverAmt[i] * 2);
      f.rotation.y += dt * (0.5 - i * 0.1);
      const glow = this.hoverAmt[i] * 0.7 + (this.visited.has(i) ? 0.25 : 0);
      this.fragMats[i].uniforms.uGlow.value = glow;
      f.visible = conv > 0.001 || st.a > 0.9;
    });

    if (this.debris) {
      const lam = 1 - Math.exp(-3.2 * dt);
      for (let i = 0; i < this.debrisSeed.length; i++) {
        const s = this.debrisSeed[i];
        const a = time * s.speed + s.phase;
        const c = this.anchors[s.anchor];
        const tx = lerp(s.start.x, c.x + Math.cos(a) * s.radius, k);
        const ty = lerp(s.start.y, c.y + Math.sin(a * 1.3) * s.radius * 0.6, k);
        const tz = lerp(s.start.z, c.z + Math.sin(a) * s.radius * 0.7, k);
        const p = this.debrisPos[i];
        p.x += (tx - p.x) * lam;
        p.y += (ty - p.y) * lam;
        p.z += (tz - p.z) * lam;
        this.e.set(a, a * 0.7, 0);
        this.q.setFromEuler(this.e);
        this.m4.compose(p, this.q, this.tmp.setScalar(0.9 + (i % 5) * 0.18));
        this.debris.setMatrixAt(i, this.m4);
      }
      this.debris.instanceMatrix.needsUpdate = true;
      this.debris.visible = conv > 0.001;
    }
  }

  /** Screen-space centre/radius of fragment `i`, used to position the accessible HTML buttons. */
  project(i: number, camera: THREE.PerspectiveCamera, width: number, height: number): FragmentScreenInfo {
    const f = this.frags[i];
    if (!f) return { x: 0, y: 0, r: 0, visible: false };
    const p = this.tmp.copy(f.position).project(camera);
    // Radius: project a point offset by the fragment's world radius along camera right.
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(3.1);
    const edge = f.position.clone().add(right).project(camera);
    const x = (p.x * 0.5 + 0.5) * width;
    const y = (-p.y * 0.5 + 0.5) * height;
    const r = Math.abs((edge.x - p.x) * 0.5 * width);
    return { x, y, r, visible: p.z < 1 && p.z > -1 };
  }

  setQuality(q: QualitySettings): void {
    this.shardMats.concat(this.fragMats, this.debrisMat).forEach((m) => setGlassSimple(m, q.simpleGlass));
    this.buildDebris(q.debris);
  }

  dispose(): void {
    this.debris?.dispose();
    [...this.shardMats, ...this.fragMats, this.debrisMat].forEach((m) => m.dispose());
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !(m as unknown as THREE.InstancedMesh).isInstancedMesh) m.geometry.dispose();
    });
  }
}
