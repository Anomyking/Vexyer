import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Previews paint to <canvas>; irrelevant here, so stub them out.
vi.mock('../src/effects/previews', () => ({
  createPreviewTexture: async () => new THREE.Texture(),
  paintPreview: () => ({}),
}));

import { Choreographer } from '../src/core/choreographer';
import { PORTFOLIO } from '../src/core/chapters';
import type { SceneContext, SceneModule } from '../src/core/context';
import { QualityManager, TIERS } from '../src/core/quality';
import { buildProceduralPack, type PackName } from '../src/assets/procedural';
import { AtmosphereModule } from '../src/scenes/atmosphere';
import { GlassModule } from '../src/scenes/glass';
import { HeroModule } from '../src/scenes/hero';
import { LightingModule } from '../src/scenes/lighting';
import { PLANE_SWAP, PlaneModule } from '../src/scenes/plane';
import { PortfolioModule, RING_X_END, RING_X_START } from '../src/scenes/portfolio';

beforeAll(() => {
  const g = globalThis as Record<string, unknown>;
  g.window = globalThis;
  // Minimal 2D-canvas stand-in (the glass labels draw text): every method is a no-op, measureText is linear.
  const ctx2d = new Proxy({} as Record<string, unknown>, {
    get: (t, k: string) => (k === 'measureText' ? (s: string) => ({ width: s.length * 10 }) : k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : k in t ? t[k] : () => {}),
    set: (t, k: string, v) => ((t[k] = v), true),
  });
  const el = () => ({ style: {}, setAttribute() {}, appendChild() {}, getAttribute: () => null, getContext: () => ctx2d });
  g.document = { addEventListener() {}, removeEventListener() {}, querySelectorAll: () => [], hidden: false, createElement: el, createElementNS: el, documentElement: el(), body: el() };
});

interface Rig {
  ctx: SceneContext;
  choreo: Choreographer;
  mods: SceneModule[];
  hero: HeroModule;
  portfolio: PortfolioModule;
  glass: GlassModule;
  plane: PlaneModule;
}

async function makeRig(aspect = 16 / 9): Promise<Rig> {
  const scene = new THREE.Scene();
  const quality = new QualityManager('high');
  const ctx = {
    renderer: { shadowMap: { enabled: false }, capabilities: { getMaxAnisotropy: () => 4 } },
    scene,
    camera: new THREE.PerspectiveCamera(),
    assets: { pack: async (n: PackName) => buildProceduralPack(n), ktx2Texture: async () => null },
    cam: { px: 0, py: 150, pz: 14, lx: 0, ly: 115, lz: 0, fov: 38, follow: 0 },
    sky: { space: 1, dusk: 0, stage: 0, speed: 0, cover: 0 },
    layout: { aspect, portrait: aspect < 0.95, workDistance: 30, screenScale: 1.35 },
    quality: () => quality.settings,
    reducedMotion: () => false,
    env: null,
    time: 0,
  } as unknown as SceneContext;

  const engine = { ctx, scene, contextLost: false } as never;
  const scroll = {} as never;
  const choreo = new Choreographer(engine, scroll, quality);
  const lighting = new LightingModule();
  const hero = new HeroModule();
  const portfolio = new PortfolioModule();
  const atmosphere = new AtmosphereModule();
  const glass = new GlassModule();
  const plane = new PlaneModule();
  const mods: SceneModule[] = [lighting, hero, portfolio, atmosphere, glass, plane];
  mods.forEach((m) => choreo.add(m));
  choreo.plane = plane;
  for (const m of mods) await choreo.ensure(m.id);
  return { ctx, choreo, mods, hero, portfolio, glass, plane };
}

/** Everything the master timeline controls, as plain numbers. */
function snapshot(r: Rig, p: number): Record<string, number> {
  r.choreo.p = p;
  r.choreo.tl.progress(p, true);
  r.mods.forEach((m) => m.update(0, p, r.ctx));
  const slabs = (r.hero as unknown as { slabs: THREE.Mesh[] }).slabs;
  const out: Record<string, number> = {};
  const nums = (prefix: string, o: object) =>
    Object.entries(o).forEach(([k, v]) => { if (typeof v === 'number') out[`${prefix}.${k}`] = v; }); // GSAP adds a private _gsap cache
  nums('cam', r.ctx.cam);
  nums('sky', r.ctx.sky);
  nums('glass', r.glass.state);
  nums('plane', r.plane.state);
  nums('pf', r.portfolio.state);
  out['ring.x'] = r.portfolio.group.position.x;
  slabs.forEach((s, i) => {
    out[`slab${i}.x`] = s.position.x;
    out[`slab${i}.y`] = s.position.y;
    out[`slab${i}.z`] = s.position.z;
    out[`slab${i}.rx`] = s.rotation.x;
  });
  return out;
}

function expectSame(a: Record<string, number>, b: Record<string, number>, label: string): void {
  expect(Object.keys(b).sort(), label).toEqual(Object.keys(a).sort());
  for (const k of Object.keys(a)) expect(b[k], `${label} ${k}`).toBeCloseTo(a[k], 5);
}

const SAMPLES = [0, 0.02, 0.07, 0.14, 0.185, 0.23, PORTFOLIO.start, 0.4, PORTFOLIO.end, 0.58, 0.62, 0.7, 0.75, 0.82, 0.87, 0.92, PLANE_SWAP - 0.001, PLANE_SWAP + 0.003, 0.96, 1];

describe('master timeline', () => {
  it('is exactly one unit long, so time == progress', async () => {
    const r = await makeRig();
    expect(r.choreo.tl.duration()).toBeCloseTo(1, 6);
  });

  it('is deterministic: forward, reverse, shuffled and repeated scrubs agree', async () => {
    const r = await makeRig();
    const forward = SAMPLES.map((p) => snapshot(r, p));
    const reverse = [...SAMPLES].reverse().map((p) => snapshot(r, p)).reverse();
    SAMPLES.forEach((p, i) => expectSame(forward[i], reverse[i], `reverse@${p}`));

    // Pseudo-random jumps, as when the user drags the scrollbar or uses the nav.
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let n = 0; n < 60; n++) {
      const i = Math.floor(rnd() * SAMPLES.length);
      expectSame(forward[i], snapshot(r, SAMPLES[i]), `jump@${SAMPLES[i]}`);
    }
  });

  it('restores identical state after a rebuild (layout change / late module load)', async () => {
    const r = await makeRig();
    for (const p of [0.05, 0.3, 0.62, 0.87, 0.97]) {
      const before = snapshot(r, p);
      r.choreo.p = p;
      r.choreo.scheduleRebuild(true);
      // Move somewhere else first to prove the rebuild itself restores state.
      snapshot(r, 0.5);
      r.choreo.p = p;
      r.choreo.scheduleRebuild(true);
      expectSame(before, snapshot(r, p), `rebuild@${p}`);
    }
  });

  it('never produces NaN/Infinity anywhere along the journey', async () => {
    const r = await makeRig();
    const planeMesh = (r.plane as unknown as { plane: THREE.Mesh }).plane;
    for (let p = 0; p <= 1.0001; p += 0.001) {
      const s = snapshot(r, Math.min(1, p));
      for (const [k, v] of Object.entries(s)) expect(Number.isFinite(v), `${k}@${p}`).toBe(true);
      expect(planeMesh.position.toArray().every(Number.isFinite)).toBe(true);
      expect(planeMesh.quaternion.toArray().every(Number.isFinite)).toBe(true);
      expect(r.plane.trail.position.toArray().every(Number.isFinite)).toBe(true);
    }
  });
});

describe('journey beats', () => {
  it('hero slabs separate with stagger, then the camera dives through the opening', async () => {
    const r = await makeRig();
    const a = snapshot(r, 0);
    const mid = snapshot(r, 0.07);
    const sep = snapshot(r, 0.14);
    const dist = (s: Record<string, number>, i: number) => Math.hypot(s[`slab${i}.x`], s[`slab${i}.z`]);
    for (let i = 0; i < 4; i++) {
      expect(dist(sep, i)).toBeGreaterThan(dist(a, i) + 8); // moved apart
      expect(sep[`slab${i}.y`]).toBeLessThan(a[`slab${i}.y`]); // depth offset: every slab sinks
    }
    // Staggered: at the same instant, different slabs are at different stages.
    const prog = [0, 1, 2, 3].map((i) => (dist(mid, i) - dist(a, i)) / (dist(sep, i) - dist(a, i)));
    expect(new Set(prog.map((x) => x.toFixed(2))).size).toBeGreaterThan(1);
    expect(snapshot(r, 0.185)['cam.py']).toBeLessThan(115); // below the slabs = through the opening
  });

  it('the ring turns and translates exactly with scroll, hitting each project on its snap point', async () => {
    const r = await makeRig();
    expect(snapshot(r, PORTFOLIO.start)['ring.x']).toBeCloseTo(RING_X_START, 5);
    expect(snapshot(r, PORTFOLIO.end)['ring.x']).toBeCloseTo(RING_X_END, 5);
    expect(snapshot(r, PORTFOLIO.end)['cam.px']).toBeCloseTo(RING_X_END, 5); // camera follows the ring
    const n = PORTFOLIO.count;
    for (let k = 0; k < n; k++) {
      const p = PORTFOLIO.start + ((PORTFOLIO.end - PORTFOLIO.start) * k) / (n - 1);
      expect(snapshot(r, p)['pf.u']).toBeCloseTo(k / (n - 1), 5);
    }
    // Held still before/after the installation.
    expect(snapshot(r, 0.1)['pf.u']).toBe(0);
    expect(snapshot(r, 0.7)['pf.u']).toBe(1);
  });

  it('the focused screen index follows u (HTML sync)', async () => {
    const r = await makeRig();
    const n = PORTFOLIO.count;
    for (let k = 0; k < n; k++) {
      const p = PORTFOLIO.start + ((PORTFOLIO.end - PORTFOLIO.start) * k) / (n - 1);
      snapshot(r, p);
      expect(r.portfolio.focusIndex).toBe(k);
    }
  });

  it('space becomes daylight inside the clouds; dusk arrives for the flight', async () => {
    const r = await makeRig();
    expect(snapshot(r, 0.3)['sky.space']).toBe(1);
    expect(snapshot(r, 0.7)['sky.space']).toBe(0);
    expect(snapshot(r, 0.7)['sky.dusk']).toBe(0);
    expect(snapshot(r, 1)['sky.dusk']).toBeGreaterThan(0.5);
  });

  it('shards arrive in order and fragments converge before the plane', async () => {
    const r = await makeRig();
    const s = snapshot(r, 0.72);
    expect(s['glass.a']).toBeGreaterThan(0.5);
    expect(s['glass.b']).toBe(0);
    expect(snapshot(r, 0.78)['glass.b']).toBeGreaterThan(0.5);
    expect(snapshot(r, 0.7)['glass.conv']).toBe(0);
    expect(snapshot(r, 0.87)['glass.conv']).toBe(1);
  });

  it('paper-plane hand-over happens under the cover, and the plane returns to normal size', async () => {
    const r = await makeRig();
    const before = snapshot(r, PLANE_SWAP - 0.0005);
    expect(before['plane.scale']).toBeGreaterThan(10); // nearly filling the frame
    expect(before['sky.cover']).toBeCloseTo(1, 3); // fully covered
    expect(before['cam.follow']).toBe(0);
    const after = snapshot(r, PLANE_SWAP + 0.003);
    expect(after['plane.scale']).toBe(1);
    expect(after['cam.follow']).toBe(1);
    expect(after['sky.cover']).toBeCloseTo(1, 3); // still covered while the cut settles
    expect(snapshot(r, 0.99)['sky.cover']).toBe(0); // cover has cleared
    expect(snapshot(r, 0.977)['sky.speed']).toBeCloseTo(1, 3); // full speed through the flight
    expect(snapshot(r, 0.995)['sky.speed']).toBeCloseTo(0.3, 3); // blur eases off so the finale rings are crisp
    expect(snapshot(r, 0.8)['cam.follow']).toBe(0);
  });

  it('the chase camera sits behind and above the plane', async () => {
    const r = await makeRig();
    snapshot(r, 0.98);
    const mesh = (r.plane as unknown as { plane: THREE.Mesh }).plane;
    const cam = r.plane.trail.position;
    expect(cam.z).toBeGreaterThan(mesh.position.z); // behind (flight is toward -z)
    expect(cam.y).toBeGreaterThan(mesh.position.y - 0.5);
  });
});

describe('paper plane mouse steering', () => {
  const settle = (r: Rig, p: number, seconds: number) => {
    for (let i = 0; i < seconds * 60; i++) {
      r.ctx.time += 1 / 60;
      r.choreo.p = p;
      r.choreo.tl.progress(p, true);
      r.plane.update(1 / 60, p, r.ctx);
    }
  };
  const planeOf = (r: Rig) => (r.plane as unknown as { plane: THREE.Mesh }).plane;
  const setPointer = (r: Rig, x: number, y: number) => Object.assign((r.plane as unknown as { pointer: { x: number; y: number } }).pointer, { x, y });

  it('flies its normal line when the pointer is centred', async () => {
    const r = await makeRig();
    settle(r, 0.98, 1);
    const base = planeOf(r).position.clone();
    setPointer(r, 0, 0);
    settle(r, 0.98, 1);
    expect(planeOf(r).position.distanceTo(base)).toBeLessThan(1e-6);
  });

  it('slides toward the pointer, to the correct side of the camera, and leans into the turn', async () => {
    const r = await makeRig();
    settle(r, 0.98, 1);
    const centre = planeOf(r).position.clone();
    const rollOf = () => new THREE.Euler().setFromQuaternion(planeOf(r).quaternion, 'ZYX').z;
    const rollCentre = rollOf();
    setPointer(r, 1, 0);
    settle(r, 0.98, 0.15); // mid-move: leaning
    const rollMoving = rollOf();
    settle(r, 0.98, 2);
    const right = planeOf(r).position.clone();
    setPointer(r, -1, 0);
    settle(r, 0.98, 2);
    const left = planeOf(r).position.clone();
    // The camera looks down -z, so screen-right is +x: the plane ends up right of centre, then left of it.
    expect(right.x).toBeGreaterThan(centre.x + 3);
    expect(left.x).toBeLessThan(centre.x - 3);
    expect(right.distanceTo(centre)).toBeLessThan(8); // stays within view of the chase camera
    expect(Math.abs(rollMoving - rollCentre)).toBeGreaterThan(0.1); // banks while moving
  });

  it('does nothing before the chase starts (the scrubbed timeline stays deterministic)', async () => {
    const r = await makeRig();
    settle(r, 0.93, 1);
    const a = planeOf(r).position.clone();
    setPointer(r, 1, 1);
    settle(r, 0.93, 1);
    expect(planeOf(r).position.distanceTo(a)).toBeLessThan(1e-6);
  });
});

describe('springs & responsive layout', () => {
  it('fragments settle on their anchors once converged, and drift back out when scrolled away', async () => {
    const r = await makeRig();
    const frags = (r.glass as unknown as { rigs: THREE.Group[] }).rigs;
    const run = (p: number, seconds: number) => {
      for (let i = 0; i < seconds * 60; i++) {
        r.ctx.time += 1 / 60;
        snapshot(r, p);
        r.glass.update(1 / 60, p, r.ctx);
      }
    };
    run(0.87, 6);
    const anchors = [[-8.5, 49.6, -26], [0, 46.4, -22], [8.5, 49.6, -26]];
    frags.forEach((f, i) => {
      expect(Math.hypot(f.position.x - anchors[i][0], f.position.y - anchors[i][1], f.position.z - anchors[i][2])).toBeLessThan(1.2);
    });
    run(0.7, 6);
    frags.forEach((f, i) => expect(f.position.distanceTo(new THREE.Vector3(...([[-46, 62, -80], [10, 70, -110], [52, 58, -75]][i] as [number, number, number])))).toBeLessThan(14));
  });

  it('portrait layout keeps the fragments on-screen (narrower spread)', async () => {
    const wide = await makeRig(16 / 9);
    const tall = await makeRig(9 / 19);
    const frags = (r: Rig) => (r.glass as unknown as { rigs: THREE.Group[] }).rigs;
    const settle = (r: Rig) => { for (let i = 0; i < 360; i++) { r.ctx.time += 1 / 60; snapshot(r, 0.87); r.glass.update(1 / 60, 0.87, r.ctx); } };
    settle(wide); settle(tall);
    expect(Math.abs(frags(tall)[2].position.x)).toBeLessThan(Math.abs(frags(wide)[2].position.x));
  });

  it('quality changes rebuild instanced content without breaking the scene', async () => {
    const r = await makeRig();
    const ring = () => (r.portfolio as unknown as { ring: THREE.InstancedMesh }).ring;
    expect(ring().count).toBe(TIERS.high.ringSegments);
    r.portfolio.setQuality({ ...TIERS.low }, r.ctx);
    expect(ring().count).toBe(TIERS.low.ringSegments);
    r.portfolio.setQuality({ ...TIERS.high }, r.ctx);
    expect(ring().count).toBe(TIERS.high.ringSegments);
  });
});
