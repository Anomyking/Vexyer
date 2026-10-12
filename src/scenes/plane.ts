import * as THREE from 'three';
import { MODULE_RANGES } from '../core/chapters';
import type { SceneContext, SceneModule } from '../core/context';
import type { QualitySettings } from '../core/quality';
import { Streaks } from '../effects/streaks';

/** Path A: the paper plane crosses the viewport diagonally while scaling up into a full-screen wipe. */
const PATH_A = [[-34, 38, -78], [-14, 43, -52], [2, 47, -30], [10, 49.5, -14]].map(([x, y, z]) => new THREE.Vector3(x, y, z));
/** Path B: after the camera hand-over, the plane flies away into the dusk; the camera trails it. */
const PATH_B = [[0, 43, -30], [5, 38, -110], [-7, 31, -220], [3, 26, -330], [0, 21.7, -440]].map(([x, y, z]) => new THREE.Vector3(x, y, z));

export const PLANE_SWAP = 0.9475; // progress at which the camera hands over (hidden by the paper cover)

export interface TrailPose {
  position: THREE.Vector3;
  look: THREE.Vector3;
}

/**
 * Chapter 7 - the paper plane finale: a diagonal pass that grows into a full-screen transition,
 * a hidden camera hand-over, then a trailing third-person chase with layered speed streaks and
 * controlled banking. Everything is a pure function of timeline state, so it reverses cleanly.
 */
export class PlaneModule implements SceneModule {
  readonly id = 'plane';
  readonly group = new THREE.Group();
  readonly range = MODULE_RANGES.plane;

  readonly state = { a: 0, b: 0, scale: 1, travel: 0 };
  readonly trail: TrailPose = { position: new THREE.Vector3(), look: new THREE.Vector3() };

  private curveA = new THREE.CatmullRomCurve3(PATH_A, false, 'centripetal');
  private curveB = new THREE.CatmullRomCurve3(PATH_B, false, 'centripetal');
  private plane: THREE.Mesh | null = null;
  private material = new THREE.MeshStandardMaterial({ color: 0xf8f8f4, roughness: 0.75, metalness: 0, side: THREE.DoubleSide, flatShading: true });
  private streaks: Streaks | null = null;
  private streakGroup = new THREE.Group();
  private builtStreaks = -1;
  private pos = new THREE.Vector3();
  private tan = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();

  async load(ctx: SceneContext): Promise<void> {
    const pack = await ctx.assets.pack('plane');
    const g = pack.get('paper_plane')?.geometry;
    if (g) {
      if (ctx.env) this.material.envMap = ctx.env;
      this.plane = new THREE.Mesh(g, this.material);
      this.plane.visible = false;
      this.group.add(this.plane);
    }
    this.group.add(this.streakGroup);
    this.rebuildStreaks(ctx.quality().streaks, ctx.reducedMotion());
  }

  private rebuildStreaks(n: number, reduced: boolean): void {
    const count = reduced ? 0 : n;
    if (count === this.builtStreaks) return;
    if (this.streaks) {
      this.streakGroup.remove(this.streaks.object);
      this.streaks.dispose();
      this.streaks = null;
    }
    this.builtStreaks = count;
    if (count > 0) {
      this.streaks = new Streaks(count);
      this.streakGroup.add(this.streaks.object);
    }
  }

  build(tl: gsap.core.Timeline, ctx: SceneContext): void {
    const o = { immediateRender: true } as const;
    // Diagonal pass: accelerates toward the viewer while scaling up until it fills the frame.
    tl.fromTo(this.state, { a: 0 }, { a: 1, duration: PLANE_SWAP - 0.9, ease: 'power1.in', ...o }, 0.9);
    tl.fromTo(this.state, { scale: 1 }, { scale: 14, duration: PLANE_SWAP - 0.9, ease: 'power3.in', ...o }, 0.9);
    // Hand-over: the plane returns to normal size while the paper cover hides the cut.
    tl.fromTo(this.state, { scale: 14 }, { scale: 1, duration: 0.002, ease: 'none', ...o }, PLANE_SWAP);
    // Chase flight.
    tl.fromTo(this.state, { b: 0 }, { b: 1, duration: 1 - 0.95, ease: 'power1.out', ...o }, 0.95);
    tl.fromTo(this.state, { travel: 0 }, { travel: 900, duration: 1 - 0.95, ease: 'none', ...o }, 0.95);
    void ctx;
  }

  /** Plane transform from the current timeline state. Also fills the chase-camera pose. */
  update(_dt: number, p: number, ctx: SceneContext): void {
    if (!this.plane) return;
    const st = this.state;
    const chasing = p >= PLANE_SWAP;
    this.plane.visible = p > 0.9 - 0.002;
    const curve = chasing ? this.curveB : this.curveA;
    const t = Math.min(0.9999, Math.max(0.0001, chasing ? st.b : st.a));
    curve.getPoint(t, this.pos);
    curve.getTangent(t, this.tan);

    // Orient: the nose is local -Z, so look "backwards" from the nose along the tangent.
    this.plane.position.copy(this.pos);
    this.tmp.copy(this.pos).sub(this.tan);
    this.m.lookAt(this.tmp, this.pos, new THREE.Vector3(0, 1, 0));
    this.q.setFromRotationMatrix(this.m);
    this.plane.quaternion.copy(this.q);
    // Banking from lateral velocity + a gentle weave while chasing.
    const bank = chasing ? Math.sin(st.b * Math.PI * 3.2) * 0.38 + this.tan.x * 1.6 : this.tan.x * 0.9 - 0.25;
    this.plane.rotateZ(-bank);
    this.plane.scale.setScalar(st.scale);

    // Chase camera: sits behind/above where the plane was a moment ago (natural lag), looking ahead.
    const tb = Math.max(0.0001, st.b - 0.012);
    this.curveB.getPoint(tb, this.trail.position);
    this.curveB.getTangent(tb, this.tmp);
    const back = this.tmp.clone().multiplyScalar(-8.4);
    this.trail.position.add(back).add(new THREE.Vector3(Math.sin(st.b * 9) * 0.25, 2.3, 0));
    this.curveB.getPoint(Math.min(0.9999, st.b + 0.004), this.trail.look);
    this.trail.look.y += 0.4;

    // Speed streaks: a corridor attached to the plane, flowing toward the camera.
    if (this.streaks) {
      this.streakGroup.position.copy(this.pos);
      this.streakGroup.rotation.y = Math.atan2(-this.tan.x, -this.tan.z);
      const speed = ctx.sky.speed;
      this.streaks.set(st.travel + ctx.time * 6 * speed, chasing ? speed : 0);
    }
  }

  setQuality(q: QualitySettings, ctx: SceneContext): void {
    this.rebuildStreaks(q.streaks, ctx.reducedMotion());
  }

  dispose(): void {
    this.plane?.geometry.dispose();
    this.material.dispose();
    this.streaks?.dispose();
  }
}
