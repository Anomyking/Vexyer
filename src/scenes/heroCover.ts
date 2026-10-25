import * as THREE from 'three';
import { effectiveFov } from '../core/view';
import { HERO_CAM, HERO_FOV, HERO_Y } from './heroLayout';

/**
 * Layout for the opening: four overlapping slabs that together cover the *entire* first frame,
 * whatever the screen shape. Pure function of the aspect ratio, so the timeline stays a pure
 * function of scroll progress (tests/heroCover.test.ts projects a real camera through the result).
 *
 * How it works
 *  1. Cast the viewport border from the real hero camera (same pose and FOV the engine uses) onto
 *     the slab plane. That gives the footprint the slabs have to hide.
 *  2. Express the footprint in the slabs' own (yawed) frame and take its bounding rectangle.
 *  3. Split that rectangle into a 2x2 grid of slabs that overlap each other by `OVERLAP`, each one
 *     lifted to a different height so the overlaps read as stacked layers.
 *  4. Work out how far each slab must slide (along its own axes) to leave a clear opening for the
 *     camera dive. The scroll timeline animates exactly that distance.
 */

/** World height of the hero group. Slabs live at local y = 0. */
export const HERO_GROUP_Y = 115;
/** The slabs' shared yaw (the angle from the original Blender sketch). */
export const HERO_YAW = 0.746;
/** How much bigger than the visible area the covered region is (parallax, camera drift, safety). */
export const COVER_MARGIN = 1.14;
/** Fraction of a slab's width/depth that it shares with its neighbour. */
export const OVERLAP = 0.42;
/** Half-size (in the slab frame) of the opening the camera dives through, with a safety margin. */
export const HOLE_HALF = 15;
/** Slab quadrant (sign along slab-x, sign along slab-z) per slab index. */
export const QUADRANTS: ReadonlyArray<readonly [number, number]> = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
/**
 * Resting height of each slab. Neighbours are always at least SLAB_GAP apart, which is more than a
 * slab is thick (0.7), so overlapping slabs are stacked layers that can never cut into each other.
 */
export const LIFTS: readonly number[] = [0, 3.2, 1.6, 4.8];
/** Every slab sinks by the same amount, in lock-step, so the gaps between layers never change. */
export const SLAB_DROP = 6;
/** Small yaw twist while opening (radians). Yaw keeps slabs parallel, so it cannot cause clipping. */
export const SLAB_TWIST = 0.05;

export interface HeroSlabPlan {
  /** Full size of the slab's footprint in its own frame. */
  width: number;
  depth: number;
  /** Resting position (group-local, world axes). */
  x: number;
  y: number;
  z: number;
  /** How far the slab slides to open the hole, in world x/z. */
  openX: number;
  openZ: number;
}

export interface HeroCoverPlan {
  yaw: number;
  slabs: HeroSlabPlan[];
  /** Bounding rectangle (slab frame) that the four slabs cover. */
  bounds: { a0: number; a1: number; b0: number; b1: number };
}

/** Where the viewport border lands on the slab plane, in group-local world x/z. */
export function heroFootprint(aspect: number, margin = COVER_MARGIN): THREE.Vector2[] {
  const c = { px: 0, py: HERO_CAM.py, pz: HERO_CAM.pz, lx: 0, ly: HERO_Y, lz: 0, fov: HERO_FOV };
  const cam = new THREE.PerspectiveCamera(effectiveFov(c.fov, aspect), aspect, 0.1, 2000);
  cam.position.set(c.px, c.py, c.pz);
  cam.lookAt(c.lx, c.ly, c.lz);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();

  const planeY = HERO_GROUP_Y;
  const FAR = 700; // rays that never reach the plane (very tall screens) are capped here
  const pts: THREE.Vector2[] = [];
  const ndc = [-1, -0.5, 0, 0.5, 1];
  for (const nx of ndc) {
    for (const ny of ndc) {
      if (Math.abs(nx) < 1 && Math.abs(ny) < 1) continue; // border only
      const dir = new THREE.Vector3(nx * margin, ny * margin, 0.5).unproject(cam).sub(cam.position).normalize();
      const t = dir.y < -1e-3 ? Math.min(FAR, (planeY - cam.position.y) / dir.y) : FAR;
      pts.push(new THREE.Vector2(cam.position.x + dir.x * t, cam.position.z + dir.z * t));
    }
  }
  return pts;
}

export function planHeroCover(aspect: number): HeroCoverPlan {
  const yaw = HERO_YAW;
  const ax = new THREE.Vector2(Math.cos(yaw), -Math.sin(yaw)); // slab-local x in world (x, z)
  const az = new THREE.Vector2(Math.sin(yaw), Math.cos(yaw)); // slab-local z in world (x, z)

  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const p of heroFootprint(aspect)) {
    const a = p.dot(ax);
    const b = p.dot(az);
    a0 = Math.min(a0, a); a1 = Math.max(a1, a);
    b0 = Math.min(b0, b); b1 = Math.max(b1, b);
  }

  // 2x2 grid whose union is exactly the bounds: 2W - overlap*W = total.
  const totalA = a1 - a0;
  const totalB = b1 - b0;
  const W = totalA / (2 - OVERLAP);
  const D = totalB / (2 - OVERLAP);
  const ca = (a0 + a1) / 2;
  const cb = (b0 + b1) / 2;
  const offA = (totalA - W) / 2;
  const offB = (totalB - D) / 2;

  const slabs = QUADRANTS.map(([qa, qb], i): HeroSlabPlan => {
    const sa = ca + qa * offA; // slab centre in the slab frame
    const sb = cb + qb * offB;
    // Inner edge must end up beyond +-HOLE_HALF (on the slab's own side of the origin).
    const innerA = qa * (sa - qa * (W / 2)); // signed distance of the inner edge from the origin
    const innerB = qb * (sb - qb * (D / 2));
    const moveA = Math.max(0, HOLE_HALF - innerA);
    const moveB = Math.max(0, HOLE_HALF - innerB);
    const mA = qa * moveA;
    const mB = qb * moveB;
    return {
      width: W,
      depth: D,
      x: ax.x * sa + az.x * sb,
      y: LIFTS[i],
      z: ax.y * sa + az.y * sb,
      openX: ax.x * mA + az.x * mB,
      openZ: ax.y * mA + az.y * mB,
    };
  });

  return { yaw, slabs, bounds: { a0, a1, b0, b1 } };
}
