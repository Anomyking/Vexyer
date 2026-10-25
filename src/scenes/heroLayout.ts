import { effectiveFov } from '../core/view';

/**
 * Pure layout for the opening: four big slabs, stacked at different heights and overlapping, that
 * together cover the whole screen on ANY viewport shape, then peel away (top layer first) toward
 * their own corners to reveal the opening behind them.
 *
 * Sizing comes from the camera frustum, never from magic numbers, so it holds for 21:9 desktops,
 * 4:3 tablets and tall phones alike. tests/hero.test.ts fires rays across the screen to prove it.
 */

export const HERO_Y = 115; // world height of the hero group
export const HERO_CAM = { py: 150, pz: 3 } as const; // near top-down, a hint of perspective
export const HERO_FOV = 38;
export const LAYER_STEP = 1.8; // vertical gap between stacked slabs
export const SLAB_THICK_SCALE = 1.8; // slab geometry is stretched in Y so layer edges read

/** Which screen quadrant each slab starts in: [x sign, z sign] (z < 0 is the top of the screen). */
const QUAD: Array<[number, number]> = [[-1, -1], [1, 1], [1, -1], [-1, 1]];
/** Each slab sits at its own small angle: the overlap reads as hand-placed, not gridded. */
const YAW = [0.09, -0.13, 0.17, -0.07];
/** Half-edge = COVER * distance from quadrant centre to the screen corner (inscribed-disc cover). */
const COVER = 1.22;

export interface SlabPlan {
  /** Start pose (relative to the hero group). */
  x: number; y: number; z: number; yaw: number;
  /** Full edge length of the square. */
  size: number;
  /** Exit: unit direction on the ground plane, distance, spin, drop and tilt. */
  dirX: number; dirZ: number; travel: number; spin: number; drop: number; tilt: number;
}

export function planHeroSlabs(aspect: number, count = 4): SlabPlan[] {
  const fov = (effectiveFov(HERO_FOV, aspect) * Math.PI) / 180;
  const plans: SlabPlan[] = [];
  for (let i = 0; i < count; i++) {
    const y = (count - 1 - i) * LAYER_STEP; // slab 0 is the top layer
    const h = HERO_CAM.py - (HERO_Y + y); // camera height above this slab's plane
    const H = 2 * Math.tan(fov / 2) * h;
    const W = H * aspect;
    const d = Math.hypot(W / 4, H / 4); // quadrant centre -> screen corner
    const half = d * COVER;
    const [sx, sz] = QUAD[i % 4];
    const cx = (sx * W) / 4;
    const cz = (sz * H) / 4;
    const len = Math.hypot(cx, cz) || 1;
    // Clear the whole screen: end centre must be >= screen half-diagonal + slab circumradius away.
    const travel = 2 * d + half * Math.SQRT2 - d + 1;
    plans.push({
      x: cx, y, z: cz, yaw: YAW[i % YAW.length], size: half * 2,
      dirX: cx / len, dirZ: cz / len, travel,
      spin: (i % 2 ? -1 : 1) * (0.28 + i * 0.07),
      drop: 0.8 + i * 0.9,
      tilt: (i % 2 ? 1 : -1) * 0.05,
    });
  }
  return plans;
}
