import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HERO_CAM, HERO_FOV, HERO_Y, SLAB_THICK_SCALE, planHeroSlabs, type SlabPlan } from '../src/scenes/heroLayout';
import { effectiveFov } from '../src/core/view';

const ASPECTS: Array<[string, number]> = [['21:9', 21 / 9], ['16:9', 16 / 9], ['16:10', 1.6], ['4:3', 4 / 3], ['square', 1], ['tablet portrait', 3 / 4], ['phone 9:19', 9 / 19], ['phone 9:16', 9 / 16]];

/** The real hero camera pose for a given aspect. */
function heroCamera(aspect: number): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(effectiveFov(HERO_FOV, aspect), aspect, 0.5, 900);
  cam.position.set(0, HERO_CAM.py, HERO_CAM.pz);
  cam.lookAt(0, HERO_Y, 0);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

/** Does any slab's top face cover the point seen at NDC (u, v)? progress 0 = start pose, 1 = exit pose. */
function covered(cam: THREE.PerspectiveCamera, plans: SlabPlan[], u: number, v: number, t: number): number[] {
  const origin = cam.position.clone();
  const dir = new THREE.Vector3(u, v, 0.5).unproject(cam).sub(origin).normalize();
  const hits: number[] = [];
  plans.forEach((p, i) => {
    const cx = p.x + p.dirX * p.travel * t;
    const cz = p.z + p.dirZ * p.travel * t;
    const cy = HERO_Y + p.y - p.drop * t;
    const topY = cy + (0.35 * SLAB_THICK_SCALE); // slab geometry is 0.7 tall before the Y stretch
    const k = (topY - origin.y) / dir.y;
    if (k <= 0) return;
    const dx = origin.x + dir.x * k - cx;
    const dz = origin.z + dir.z * k - cz;
    const yaw = p.yaw + p.spin * t;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const lx = c * dx - s * dz;
    const lz = s * dx + c * dz;
    if (Math.abs(lx) <= p.size / 2 && Math.abs(lz) <= p.size / 2) hits.push(i);
  });
  return hits;
}

describe('hero slabs', () => {
  for (const [name, aspect] of ASPECTS) {
    it(`cover every pixel of the screen at the start (${name})`, () => {
      const cam = heroCamera(aspect);
      const plans = planHeroSlabs(aspect);
      let gaps = 0, total = 0;
      for (let iy = 0; iy <= 40; iy++) {
        for (let ix = 0; ix <= 40; ix++) {
          total++;
          if (!covered(cam, plans, (ix / 40) * 2 - 1, (iy / 40) * 2 - 1, 0).length) gaps++;
        }
      }
      expect(gaps, `${gaps}/${total} uncovered screen points`).toBe(0);
    });

    it(`overlap each other and are stacked at different heights (${name})`, () => {
      const cam = heroCamera(aspect);
      const plans = planHeroSlabs(aspect);
      // Some screen points must be covered by 2+ slabs (that's the artistic overlap)...
      let multi = 0, total = 0;
      for (let iy = 0; iy <= 20; iy++) for (let ix = 0; ix <= 20; ix++) {
        total++;
        if (covered(cam, plans, (ix / 20) * 2 - 1, (iy / 20) * 2 - 1, 0).length >= 2) multi++;
      }
      expect(multi / total).toBeGreaterThan(0.35);
      // ...and the centre of the screen is where all four meet.
      expect(covered(cam, plans, 0, 0, 0).length).toBeGreaterThanOrEqual(3);
      expect(new Set(plans.map((p) => p.y)).size).toBe(plans.length);
    });

    it(`are completely off screen after the reveal (${name})`, () => {
      const cam = heroCamera(aspect);
      const plans = planHeroSlabs(aspect);
      let blocked = 0;
      for (let iy = 0; iy <= 30; iy++) for (let ix = 0; ix <= 30; ix++) {
        if (covered(cam, plans, (ix / 30) * 2 - 1, (iy / 30) * 2 - 1, 1).length) blocked++;
      }
      expect(blocked).toBe(0);
    });

    it(`the opening grows in stages: the top layer leaves first (${name})`, () => {
      const plans = planHeroSlabs(aspect);
      // Mirrors the timeline: slab i starts at 0.012 + i * 0.012 for 0.096.
      const t = (i: number, p: number) => Math.min(1, Math.max(0, (p - (0.012 + i * 0.012)) / 0.096));
      const p = 0.07;
      const progress = plans.map((_, i) => t(i, p));
      for (let i = 1; i < progress.length; i++) expect(progress[i]).toBeLessThanOrEqual(progress[i - 1]);
      expect(progress[0]).toBeGreaterThan(progress[progress.length - 1]);
    });
  }

  it('slabs move toward four different corners', () => {
    const dirs = planHeroSlabs(16 / 9).map((p) => `${Math.sign(p.dirX)},${Math.sign(p.dirZ)}`);
    expect(new Set(dirs).size).toBe(4);
  });
});
