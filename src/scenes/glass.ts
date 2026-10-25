import * as THREE from 'three';
import { MODULE_RANGES } from '../core/chapters';
import type { SceneContext, SceneModule } from '../core/context';
import type { QualitySettings } from '../core/quality';
import { createGlassMaterial, setGlassEdgeOnly, setGlassSimple } from '../effects/glass';
import { buildStageEnvironment } from '../effects/stageEnv';
import { FLOOR_Y, StageFloor } from '../effects/stageFloor';
import { GlassLabel, type LabelContent } from '../effects/glassLabel';
import { sunDirection } from '../effects/skydome';
import { buildProceduralPack } from '../assets/procedural';
import { Spring, easeOutCubic, seeded, lerp } from '../core/math';

// Paths are authored for the camera looking up into the open sky (cameraRig keys 0.68-0.8): each blade
// enters from the far upper corner, sweeps across the middle of the frame and passes close to the lens.
const SHARD_A = [[78, 88, -95], [40, 82, -62], [18, 75, -40], [7, 70, -26], [1, 65, -12], [-5, 60, 2]];
const SHARD_B = [[-78, 82, -98], [-40, 77, -66], [-18, 71, -42], [-7, 66, -28], [-1, 61, -14], [5, 57, 0]];
const FRAG_START = [[-46, 62, -80], [10, 70, -110], [52, 58, -75]];
const FRAG_TINTS = [0x9fe8ff, 0xc8b6ff, 0xffd2b0];
/** World scale of the long glass blades that sweep past the camera in the sky chapter. */
const SHARD_SCALE = 1.7;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** Fragment size per crystal (big, varied slabs like the reference; text needs the room). */
const FRAG_SCALES = [2.65, 2.4, 2.15];
/** Text plane width as a multiple of the crystal scale (about two thirds of the crystal's width). */
const LABEL_WIDTH_K = 2.0;
/** How far the text plane sits in front of the crystal's centre, as a multiple of the crystal scale. */
const LABEL_LIFT_K = 0.36;
/** Resting orientation of each slab once settled (x tilt, y yaw, z roll in radians): angled, but facing us. */
const REST = [[-0.16, 0.4, 0.12], [-0.1, -0.32, -0.15], [-0.2, -0.44, 0.1]];
/** Per-fragment resting tilt (radians, about the view axis) so the text feels laid on the crystal. */
const LABEL_TILT = [-0.07, 0.05, 0.09];

/** Placeholder copy drawn on the glass. Edit here, or call `GlassModule.setLabel(i, content)` at runtime. */
export const FRAGMENT_LABELS: LabelContent[] = [
  { title: 'Sites that convert', body: 'Landing pages and personal sites built to win clients.', meta: '01 · Landing & personal' },
  { title: 'Stores that sell', body: 'E-commerce with fast, friction-free checkout.', meta: '02 · E-commerce' },
  { title: 'Worlds worth scrolling', body: 'Immersive 3D stories people remember and share.', meta: '03 · Immersive 3D' },
];

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
  /** One rig per fragment: it moves with the springs; the crystal tumbles inside it, the label does not. */
  private rigs: THREE.Group[] = [];
  private frags: THREE.Mesh[] = [];
  /** Real transmissive bodies (high tier), one per fragment, mirroring the shader mesh's transform. */
  private bodies: THREE.Mesh[] = [];
  private physMats: THREE.MeshPhysicalMaterial[] = [];
  private stageEnv: THREE.Texture | null = null;
  private physicalOn = false;
  /** Faint internal fracture plates (children of each crystal), so the body is not a clean solid. */
  private plateGeo = new THREE.CircleGeometry(1, 5);
  private plateMat = new THREE.ShaderMaterial({
    uniforms: { uAmt: { value: 0.5 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      varying vec2 vUv; uniform float uAmt;
      void main(){
        float r = length(vUv - 0.5) * 2.0;
        float a = (0.012 + 0.2 * smoothstep(0.6, 1.0, r)) * (1.0 - smoothstep(0.96, 1.0, r)) * uAmt;
        gl_FragColor = vec4(vec3(1.0, 0.6, 0.55) * a, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  /** Mirrored copies under the floor (reflections), and the floor itself. */
  private mirrors: THREE.Mesh[] = [];
  private mirMats: THREE.ShaderMaterial[] = [];
  private floor = new StageFloor();
  private labels: GlassLabel[] = [];
  private fragMats: THREE.ShaderMaterial[] = [];
  private springs: Spring[][] = [];
  private shardMats: THREE.ShaderMaterial[] = [];
  private debris: THREE.InstancedMesh | null = null;
  private debrisMat = createGlassMaterial({ tint: 0xbfe6ff, base: 0.22, fresnel: 2.4, seed: 3 });
  private debrisPos: THREE.Vector3[] = [];
  private debrisSeed: Array<{ phase: number; radius: number; speed: number; anchor: number; start: THREE.Vector3 }> = [];
  private fallback: ReturnType<typeof buildProceduralPack> | null = null;
  private sun = new THREE.Vector3();
  private hover = -1;
  private visited = new Set<number>();
  private hoverAmt = [0, 0, 0];
  private anchors = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private tmp = new THREE.Vector3();
  private spin = [new THREE.Euler(), new THREE.Euler(0.8, 1.6, 0), new THREE.Euler(1.7, 0.4, 0)];
  private tq = new THREE.Quaternion();
  private rq = new THREE.Quaternion();
  private labelQ = new THREE.Quaternion();
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private builtDebris = -1;

  /**
   * Glass is always the angular procedural crystal (see effects/facets.ts): flat facets are the look,
   * and the old exported low-poly/blobby meshes would fight it.
   */
  private glassGeometry(name: string): THREE.BufferGeometry | null {
    this.fallback ??= buildProceduralPack('glass');
    return this.fallback.get(name)?.geometry ?? null;
  }

  async load(ctx: SceneContext): Promise<void> {
    const simple = ctx.quality().simpleGlass;
    const sa = this.glassGeometry('shard_a');
    const sb = this.glassGeometry('shard_b');
    if (sa && sb) {
      const matA = createGlassMaterial({ tint: 0x2f86ff, edge: 0xffffff, seed: 1, simple, base: 0.5, fresnel: 2.0, glow: 0.6 });
      const matB = createGlassMaterial({ tint: 0x6f5bff, edge: 0xffffff, seed: 4, simple, base: 0.5, fresnel: 2.0, glow: 0.6 });
      this.shardMats.push(matA, matB);
      this.shardA = new THREE.Mesh(sa, matA);
      this.shardB = new THREE.Mesh(sb, matB);
      this.shardA.visible = this.shardB.visible = false;
      this.shardA.scale.setScalar(SHARD_SCALE);
      this.shardB.scale.setScalar(SHARD_SCALE);
      this.shardA.renderOrder = this.shardB.renderOrder = 5; // after the clouds (1)
      this.group.add(this.shardA, this.shardB);
    }
    for (let i = 0; i < 3; i++) {
      const g = this.glassGeometry(`frag_${i}`);
      if (!g) continue;
      const mat = createGlassMaterial({ tint: FRAG_TINTS[i], seed: i * 2.1, simple, base: 0.2, fresnel: 2.6 });
      const mesh = new THREE.Mesh(g, mat);
      mesh.renderOrder = 5;
      mesh.scale.setScalar(FRAG_SCALES[i]);
      const rig = new THREE.Group();
      rig.add(mesh);
      const label = new GlassLabel(FRAGMENT_LABELS[i], FRAG_SCALES[i] * LABEL_WIDTH_K, ctx.quality().labelTexture, ctx.renderer.capabilities.getMaxAnisotropy());
      rig.add(label.mesh);
      const phys = new THREE.MeshPhysicalMaterial({
        color: 0xffd9d9,
        metalness: 0,
        roughness: 0.03,
        transmission: 1,
        thickness: 1.3,            // local units; scaled by the crystal's scale
        ior: 1.6,
        dispersion: 0.6,           // chromatic fringing on facet edges
        attenuationColor: new THREE.Color(1.0, 0.16, 0.14),
        attenuationDistance: 2.6,  // thick parts go deeper red
        specularIntensity: 1,
        clearcoat: 1,
        clearcoatRoughness: 0.02,
        envMapIntensity: 1.9,
        emissive: new THREE.Color(0.9, 0.08, 0.08),
        emissiveIntensity: 0,
        side: THREE.DoubleSide,
      });
      // Inner fractures: a few thin translucent plates at random angles inside the crystal.
      const pr = seeded(300 + i);
      for (let k = 0; k < 4; k++) {
        const plate = new THREE.Mesh(this.plateGeo, this.plateMat);
        plate.position.set((pr() - 0.5) * 1.6, (pr() - 0.5) * 1.0, (pr() - 0.5) * 0.4);
        plate.rotation.set((pr() - 0.5) * 1.6, (pr() - 0.5) * 1.6, pr() * 3);
        const ps = 0.35 + pr() * 0.5;
        plate.scale.set(ps * (0.7 + pr() * 0.6), ps, 1);
        plate.renderOrder = 5;
        mesh.add(plate);
      }
      // Reflection in the floor: a mirrored, dimmer copy (see the mirror maths in update()).
      const mirMat = createGlassMaterial({ tint: FRAG_TINTS[i], seed: i * 2.1, simple, base: 0.25, fresnel: 2.6, opacity: 0.3 });
      mirMat.uniforms.uMirror.value = 1;
      mirMat.uniforms.uFloorY.value = FLOOR_Y;
      const mirror = new THREE.Mesh(g, mirMat);
      mirror.renderOrder = 3;
      mirror.visible = false;
      mirror.frustumCulled = false;
      this.group.add(mirror);
      this.mirrors.push(mirror);
      this.mirMats.push(mirMat);
      const body = new THREE.Mesh(g, phys);
      body.renderOrder = 4;
      body.visible = false;
      rig.add(body);
      this.bodies.push(body);
      this.physMats.push(phys);
      this.group.add(rig);
      this.rigs.push(rig);
      this.labels.push(label);
      this.frags.push(mesh);
      this.fragMats.push(mat);
      this.springs.push([new Spring(FRAG_START[i][0], 38, 7.5), new Spring(FRAG_START[i][1], 38, 7.5), new Spring(FRAG_START[i][2], 38, 7.5)]);
      rig.position.set(...(FRAG_START[i] as [number, number, number]));
    }
    this.group.add(this.floor.mesh);
    this.buildDebris(ctx.quality().debris);
    this.applyPhysical(ctx.quality(), ctx);
  }

  /**
   * Real glass on the high tier: a transmissive body (refracts whatever is behind it - the stage
   * dome - with thickness-based red absorption and dispersion), lit by a baked studio environment.
   * The shader mesh stays on top in edge-only mode for sharp facet lines. Any failure falls back to
   * the shader-only look.
   */
  private applyPhysical(q: QualitySettings, ctx: SceneContext): void {
    let on = q.physicalGlass;
    if (on && !this.stageEnv) {
      try {
        this.stageEnv = buildStageEnvironment(ctx.renderer);
        this.physMats.forEach((m) => { m.envMap = this.stageEnv; m.needsUpdate = true; });
      } catch {
        on = false; // e.g. no float render targets: keep the cheap look
      }
    }
    this.physicalOn = on;
    const r = ctx.renderer as THREE.WebGLRenderer & { transmissionResolutionScale?: number };
    if (on && 'transmissionResolutionScale' in r) r.transmissionResolutionScale = 0.6;
    this.fragMats.forEach((m) => setGlassEdgeOnly(m, on));
    this.bodies.forEach((b) => (b.visible = on));
  }

  private buildDebris(n: number): void {
    if (n === this.builtDebris) return;
    const g = this.glassGeometry('frag_debris');
    if (!g) return;
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
    this.debris.renderOrder = 5;
    this.debrisPos = [];
    this.debrisSeed = [];
    for (let i = 0; i < n; i++) {
      const start = new THREE.Vector3((rand() * 2 - 1) * 70, 55 + rand() * 25, -30 - rand() * 90);
      this.debrisPos.push(start.clone());
      this.debrisSeed.push({ phase: rand() * Math.PI * 2, radius: 2.8 + rand() * 4.2, speed: 0.4 + rand() * 0.9, anchor: i % 3, start });
    }
    this.group.add(this.debris);
  }

  /** Dynamic text update: redraws the canvas and re-uploads the texture. */
  setLabel(i: number, content: LabelContent): void {
    this.labels[i]?.set(content);
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
    this.q.setFromUnitVectors(Y_AXIS, dir); // the shard's long axis is local Y (matches the Blender export)
    const rollQ = new THREE.Quaternion().setFromAxisAngle(dir, roll);
    mesh.quaternion.copy(rollQ.multiply(this.q));
  }

  update(dt: number, _p: number, ctx: SceneContext): void {
    const time = ctx.time;
    const st = this.state;
    sunDirection(ctx.sky.dusk, this.sun);
    this.floor.update(ctx.sky.stage);
    this.plateMat.uniforms.uAmt.value = 0.4 + 0.6 * ctx.sky.stage;
    for (const m of [...this.shardMats, ...this.fragMats, ...this.mirMats, this.debrisMat]) {
      m.uniforms.uTime.value = time;
      m.uniforms.uSpace.value = ctx.sky.space;
      m.uniforms.uStage.value = ctx.sky.stage;
      (m.uniforms.uSun.value as THREE.Vector3).copy(this.sun);
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
      const rig = this.rigs[i];
      rig.position.set(sp[0].value, sp[1].value, sp[2].value);
      const hoverT = this.hover === i ? 1 : 0;
      this.hoverAmt[i] += (hoverT - this.hoverAmt[i]) * Math.min(1, dt * 9);
      f.scale.setScalar(FRAG_SCALES[i] * (1 + this.hoverAmt[i] * 0.14));
      // Tumbles while flying in, then eases onto its resting angle (slerp) with a slow sway, so the
      // faces catch the light and the text stays readable.
      const kk = k * k * (3 - 2 * k);
      const spin = this.spin[i];
      spin.x += dt * (0.35 + i * 0.12) * (1 + this.hoverAmt[i] * 2) * (1 - kk);
      spin.y += dt * (0.5 - i * 0.1) * (1 - kk);
      this.tq.setFromEuler(spin);
      this.e.set(REST[i][0] + Math.sin(time * 0.5 + i * 2) * 0.05, REST[i][1] + Math.cos(time * 0.42 + i) * 0.07 + this.hoverAmt[i] * 0.12, REST[i][2]);
      this.rq.setFromEuler(this.e);
      f.quaternion.copy(this.tq).slerp(this.rq, kk);
      if (this.physicalOn) {
        const b = this.bodies[i];
        b.scale.copy(f.scale);
        b.quaternion.copy(f.quaternion);
        this.physMats[i].emissiveIntensity = this.hoverAmt[i] * 0.5 + (this.visited.has(i) ? 0.12 : 0);
      }

      // Label: faces the camera (rig has no rotation and the glass group sits at the origin), with a
      // fixed tilt and a very slow sway; lifted slightly toward the camera so it reads as on the front face.
      const label = this.labels[i];
      const lm = label.mesh;
      this.tmp.copy(ctx.camera.position).sub(rig.position).normalize();
      lm.position.copy(this.tmp).multiplyScalar(LABEL_LIFT_K * FRAG_SCALES[i]);
      this.q.copy(ctx.camera.quaternion);
      this.e.set(Math.sin(time * 0.35 + i) * 0.03, Math.cos(time * 0.3 + i * 1.7) * 0.04, LABEL_TILT[i]);
      this.labelQ.setFromEuler(this.e);
      lm.quaternion.copy(this.q).multiply(this.labelQ);
      lm.scale.setScalar(1 + this.hoverAmt[i] * 0.06);
      const reveal = Math.min(1, Math.max(0, (conv - 0.55) / 0.4));
      label.material.opacity = reveal * reveal * (3 - 2 * reveal);
      lm.visible = label.material.opacity > 0.002;
      const glow = this.hoverAmt[i] * 0.7 + (this.visited.has(i) ? 0.25 : 0);
      this.fragMats[i].uniforms.uGlow.value = glow;
      f.visible = conv > 0.001; // the crystals belong to the studio chapter: never visible in the sky
      if (this.physicalOn) this.bodies[i].visible = f.visible;
      // Mirror across the floor plane y = FLOOR_Y: position flips about it, the rotation is conjugated by
      // the reflection (-x, y, -z, w) and Y scale goes negative.
      const mir = this.mirrors[i];
      mir.visible = f.visible && ctx.sky.stage > 0.05;
      if (mir.visible) {
        mir.position.set(rig.position.x, 2 * FLOOR_Y - rig.position.y, rig.position.z);
        mir.quaternion.set(-f.quaternion.x, f.quaternion.y, -f.quaternion.z, f.quaternion.w);
        mir.scale.set(f.scale.x, -f.scale.y, f.scale.z);
      }
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
    const f = this.rigs[i];
    if (!f) return { x: 0, y: 0, r: 0, visible: false };
    const p = this.tmp.copy(f.position).project(camera);
    // Radius: project a point offset by the fragment's world radius along camera right.
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(1.6 * FRAG_SCALES[i]);
    const edge = f.position.clone().add(right).project(camera);
    const x = (p.x * 0.5 + 0.5) * width;
    const y = (-p.y * 0.5 + 0.5) * height;
    const r = Math.abs((edge.x - p.x) * 0.5 * width);
    return { x, y, r, visible: p.z < 1 && p.z > -1 };
  }

  setQuality(q: QualitySettings, ctx?: SceneContext): void {
    if (ctx) this.applyPhysical(q, ctx);
    this.shardMats.concat(this.fragMats, this.mirMats, this.debrisMat).forEach((m) => setGlassSimple(m, q.simpleGlass));
    this.labels.forEach((l) => l.resize(q.labelTexture));
    this.buildDebris(q.debris);
  }

  dispose(): void {
    this.debris?.dispose();
    this.labels.forEach((l) => l.dispose());
    this.physMats.forEach((m) => m.dispose());
    this.mirMats.forEach((m) => m.dispose());
    this.plateGeo.dispose();
    this.plateMat.dispose();
    this.floor.dispose();
    this.stageEnv?.dispose();
    [...this.shardMats, ...this.fragMats, this.debrisMat].forEach((m) => m.dispose());
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !(m as unknown as THREE.InstancedMesh).isInstancedMesh) m.geometry.dispose();
    });
  }
}
