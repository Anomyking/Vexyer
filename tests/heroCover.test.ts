import gsap from 'gsap';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HERO_CAMERA } from '../src/core/chapters';
import { effectiveFov } from '../src/core/math';
import { QualityManager } from '../src/core/quality';
import type { SceneContext } from '../src/core/context';
import { buildProceduralPack, type PackName } from '../src/assets/procedural';
import { HeroModule } from '../src/scenes/hero';
import { HERO_GROUP_Y, HOLE_HALF, OVERLAP, planHeroCover } from '../src/scenes/heroCover';

// Phones (tall) through ultrawide.
const ASPECTS = [9 / 19, 9 / 16, 0.75, 1, 4 / 3, 16 / 10, 16 / 9, 21 / 9, 32 / 9];

async function makeHero(aspect: number) {
  const quality = new QualityManager('high');
  const ctx = {
    assets: { pack: async (n: PackName) => buildProceduralPack(n) },
    layout: { aspect, portrait: aspect < 0.95, workDistance: 30, screenScale: 1.35 },
    quality: () => quality.settings,
    env: null,
    time: 0,
    sky: { space: 1, dusk: 0, speed: 0, cover: 0 },
  } as unknown as SceneContext;
  const hero = new HeroModule();
  await hero.load(ctx);
  const tl = gsap.timeline({ paused: true });
  hero.build(tl, ctx);
  tl.set({}, {}, 1); // same padding as the camera rig: time == scroll progress
  tl.progress(1, true).progress(0, true);
  const at = (p: number) => {
    tl.progress(p, true);
    hero.group.updateMatrixWorld(true);
  };
  at(0);
  const slabs = (hero as unknown as { slabs: THREE.Mesh[] }).slabs;
  return { hero, ctx, tl, at, slabs };
}

function heroCamera(aspect: number): THREE.PerspectiveCamera {
  const c = HERO_CAMERA;
  const cam = new THREE.PerspectiveCamera(effectiveFov(c.fov, aspect), aspect, 0.1, 2000);
  cam.position.set(c.px, c.py, c.pz);
  cam.lookAt(c.lx, c.ly, c.lz);
  cam.updateMatrixWorld(true);
  return cam;
}

describe('hero: slabs cover the whole screen', () => {
  for (const aspect of ASPECTS) {
    it(`no gap anywhere in the first frame at aspect ${aspect.toFixed(2)}`, async () => {
      const { slabs } = await makeHero(aspect);
      const cam = heroCamera(aspect);
      const ray = new THREE.Raycaster();
      const N = 36;
      let misses = 0;
      let multi = 0;
      for (let i = 0; i <= N; i++) {
        for (let j = 0; j <= N; j++) {
          ray.setFromCamera(new THREE.Vector2((i / N) * 2 - 1, (j / N) * 2 - 1), cam);
          const hits = ray.intersectObjects(slabs, false);
          if (hits.length === 0) misses++;
          if (new Set(hits.map((h) => h.object)).size >= 2) multi++;
        }
      }
      expect(misses, 'screen points that see past the slabs').toBe(0);
      expect(multi, 'screen points where slabs overlap').toBeGreaterThan(0);
    });
  }

  it('is also covered while the camera drifts toward its p=0.02 pose (slabs have barely moved)', async () => {
    const { slabs, at } = await makeHero(16 / 9);
    at(0.02);
    const cam = heroCamera(16 / 9);
    cam.position.lerp(new THREE.Vector3(0, 148.6, 13.6), 1);
    cam.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    for (let i = 0; i <= 24; i++) {
      for (let j = 0; j <= 24; j++) {
        ray.setFromCamera(new THREE.Vector2((i / 24) * 2 - 1, (j / 24) * 2 - 1), cam);
        expect(ray.intersectObjects(slabs, false).length).toBeGreaterThan(0);
      }
    }
  });
});

describe('hero: plan', () => {
  it('slabs overlap their neighbours by the configured fraction and sit at distinct heights', () => {
    for (const a of ASPECTS) {
      const plan = planHeroCover(a);
      const { a0, a1, b0, b1 } = plan.bounds;
      const W = plan.slabs[0].width;
      const D = plan.slabs[0].depth;
      expect(W * (2 - OVERLAP)).toBeCloseTo(a1 - a0, 6);
      expect(D * (2 - OVERLAP)).toBeCloseTo(b1 - b0, 6);
      expect(W * OVERLAP).toBeGreaterThan(1);
      expect(new Set(plan.slabs.map((s) => s.y)).size).toBe(4);
      for (const s of plan.slabs) {
        expect(Number.isFinite(s.x + s.z + s.openX + s.openZ + s.width + s.depth)).toBe(true);
      }
    }
  });
});

describe('hero: the reveal', () => {
  for (const aspect of [9 / 19, 16 / 9, 21 / 9]) {
    it(`parts to a clear opening for the camera dive at aspect ${aspect.toFixed(2)}`, async () => {
      const { slabs, at } = await makeHero(aspect);
      at(0.15);
      const ray = new THREE.Raycaster();
      const down = new THREE.Vector3(0, -1, 0);
      // Vertical lines through the whole opening (and along the camera's dive path) must hit nothing.
      for (let x = -HOLE_HALF + 3; x <= HOLE_HALF - 3; x += 3) {
        for (let z = -HOLE_HALF + 3; z <= HOLE_HALF - 3; z += 3) {
          if (Math.hypot(x, z) > HOLE_HALF - 3) continue;
          ray.set(new THREE.Vector3(x, HERO_GROUP_Y + 60, z), down);
          expect(ray.intersectObjects(slabs, false).length, `(${x}, ${z})`).toBe(0);
        }
      }
    });
  }

  it('starts closed and opens monotonically with scroll', async () => {
    const { slabs, at } = await makeHero(16 / 9);
    const spread = (p: number) => {
      at(p);
      return slabs.reduce((s, m) => s + Math.hypot(m.position.x, m.position.z), 0);
    };
    let prev = spread(0);
    for (const p of [0.03, 0.06, 0.09, 0.12, 0.15]) {
      const cur = spread(p);
      expect(cur).toBeGreaterThanOrEqual(prev - 1e-6);
      prev = cur;
    }
    expect(spread(0.15)).toBeGreaterThan(spread(0) + 40);
  });
});

describe('hero: slabs never clip into each other', () => {
  /** Sample the whole volume of `a` and report any point that lies inside `b` (box shrunk by `eps`, so a visible gap is required). */
  function penetration(a: THREE.Mesh, b: THREE.Mesh): number {
    const boxA = a.geometry.boundingBox!;
    const boxB = b.geometry.boundingBox!;
    const inv = b.matrixWorld.clone().invert();
    const eps = 0.05;
    const pt = new THREE.Vector3();
    let inside = 0;
    const n = 14;
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n; j++) {
        for (const ky of [0, 0.5, 1]) {
          pt.set(
            boxA.min.x + (boxA.max.x - boxA.min.x) * (i / n),
            boxA.min.y + (boxA.max.y - boxA.min.y) * ky,
            boxA.min.z + (boxA.max.z - boxA.min.z) * (j / n),
          ).applyMatrix4(a.matrixWorld).applyMatrix4(inv);
          if (
            pt.x > boxB.min.x - eps && pt.x < boxB.max.x + eps &&
            pt.y > boxB.min.y - eps && pt.y < boxB.max.y + eps &&
            pt.z > boxB.min.z - eps && pt.z < boxB.max.z + eps
          ) inside++;
        }
      }
    }
    return inside;
  }

  for (const aspect of [9 / 19, 16 / 9, 21 / 9]) {
    it(`no slab intersects another at any scroll position, aspect ${aspect.toFixed(2)}`, async () => {
      const { slabs, at } = await makeHero(aspect);
      for (let p = 0; p <= 0.2001; p += 0.005) {
        at(p);
        for (let i = 0; i < slabs.length; i++) {
          for (let j = 0; j < slabs.length; j++) {
            if (i === j) continue;
            expect(penetration(slabs[i], slabs[j]), `slab ${i} inside slab ${j} at p=${p.toFixed(3)}`).toBe(0);
          }
        }
      }
    });
  }

  it('layers keep a visible gap (thicker than a slab) at rest', async () => {
    const { slabs, at } = await makeHero(16 / 9);
    at(0);
    const ys = slabs.map((s) => s.position.y).sort((a, b) => a - b);
    const thickness = slabs[0].geometry.boundingBox!.getSize(new THREE.Vector3()).y;
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThan(thickness + 0.3);
  });
});
