import { describe, expect, it } from 'vitest';
import { MagneticSnap } from '../src/interaction/snap';
import { QualityManager, TIERS, chooseTier, type DeviceInfo } from '../src/core/quality';
import { CH, MODULE_RANGES, OVERLAY_WINDOWS, PORTFOLIO, REDUCED_ANCHORS, nearestAnchor, nearestProject, portfolioU, snapPoints } from '../src/core/chapters';
import { Spring, damp, seeded, smoothstep, window4 } from '../src/core/math';

describe('math', () => {
  it('damp converges and is frame-rate independent', () => {
    let a = 0, b = 0;
    for (let i = 0; i < 60; i++) a = damp(a, 1, 6, 1 / 60);
    for (let i = 0; i < 30; i++) b = damp(b, 1, 6, 1 / 30);
    expect(a).toBeCloseTo(b, 6);
    expect(a).toBeGreaterThan(0.99);
  });
  it('spring settles on target, even after a huge dt', () => {
    const s = new Spring(0, 55, 9);
    s.update(10, 5); // pathological frame time must not explode
    for (let i = 0; i < 300; i++) s.update(10, 1 / 60);
    expect(s.value).toBeCloseTo(10, 2);
    expect(Number.isFinite(s.velocity)).toBe(true);
  });
  it('seeded rng is deterministic', () => {
    const a = seeded(9), b = seeded(9);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it('window4 is a clean trapezoid', () => {
    expect(window4(0.1, 0.2, 0.3, 0.6, 0.7)).toBe(0);
    expect(window4(0.45, 0.2, 0.3, 0.6, 0.7)).toBe(1);
    expect(window4(0.9, 0.2, 0.3, 0.6, 0.7)).toBe(0);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 6);
  });
});

describe('chapters', () => {
  it('chapter ranges are contiguous and cover 0..1', () => {
    const r = Object.values(CH);
    expect(r[0][0]).toBe(0);
    for (let i = 1; i < r.length; i++) expect(r[i][0]).toBeCloseTo(r[i - 1][1], 9);
    expect(r[r.length - 1][1]).toBe(1);
  });
  it('snap points are evenly spaced inside the portfolio window', () => {
    const pts = snapPoints();
    expect(pts).toHaveLength(PORTFOLIO.count);
    expect(pts[0]).toBeCloseTo(PORTFOLIO.start, 9);
    expect(pts[pts.length - 1]).toBeCloseTo(PORTFOLIO.end, 9);
    pts.forEach((p, i) => expect(nearestProject(p)).toBe(i));
    expect(portfolioU(pts[2])).toBeCloseTo(2 / (PORTFOLIO.count - 1), 9);
    expect(portfolioU(0)).toBe(0);
    expect(portfolioU(1)).toBe(1);
  });
  it('overlay windows are ordered and module ranges are valid', () => {
    for (const [k, [a, b, c, d]] of Object.entries(OVERLAY_WINDOWS)) {
      expect(a, k).toBeLessThan(b);
      expect(b, k).toBeLessThanOrEqual(c);
      expect(c, k).toBeLessThan(d);
    }
    for (const [k, [a, b]] of Object.entries(MODULE_RANGES)) {
      expect(a, k).toBeGreaterThanOrEqual(0);
      expect(b, k).toBeLessThanOrEqual(1);
      expect(a, k).toBeLessThan(b);
    }
  });
  it('reduced-motion anchors are sorted and nearestAnchor is stable', () => {
    const sorted = [...REDUCED_ANCHORS].sort((a, b) => a - b);
    expect(REDUCED_ANCHORS).toEqual(sorted);
    REDUCED_ANCHORS.forEach((a) => expect(nearestAnchor(a)).toBe(a));
  });
});

describe('magnetic snap', () => {
  const mk = () => new MagneticSnap({ points: [0.1, 0.2, 0.3] });

  it('settles on the nearest project when released slowly', () => {
    const s = mk();
    expect(s.target(0.13, 0)).toBeCloseTo(0.1, 9);
    expect(s.target(0.18, 0)).toBeCloseTo(0.2, 9);
  });
  it('a flick throws the ring toward the next project', () => {
    const s = mk();
    expect(s.target(0.12, 0.5)).toBeCloseTo(0.2, 9);
    expect(s.target(0.28, -0.5)).toBeCloseTo(0.2, 9);
  });
  it('never traps: no snapping before the first or after the last project (release condition)', () => {
    const s = mk();
    expect(s.target(0.05, 0)).toBeNull();
    expect(s.target(0.05, 0.4)).toBeNull();
    expect(s.target(0.31, 0)).toBeNull();
    expect(s.target(0.35, -0.4)).toBeNull();
    // Settled exactly on an end point: stays put, so scrolling on is never pulled back.
    expect(s.target(0.3, 0)).toBeNull();
    expect(s.target(0.1, 0)).toBeNull();
  });
  it('waits for the scroll to settle, and never fights a held finger', () => {
    const s = mk();
    let t = 1000;
    // user drags slowly from 0.140 to 0.142 then stops: nearest project is 0.1
    for (let i = 0; i <= 10; i++) { s.feed(0.14 + i * 0.0002, t); t += 16; }
    expect(s.poll(t)).toBeNull(); // not settled yet
    s.setPointerDown(true, t);
    expect(s.poll(t + 1000)).toBeNull(); // finger still down
    s.setPointerDown(false, t + 1000);
    expect(s.poll(t + 1000)).toBeNull(); // delay restarts on release
    expect(s.poll(t + 1000 + 200)).toBeCloseTo(0.1, 9);
  });
  it('programmatic suppression blocks snapping', () => {
    const s = mk();
    s.feed(0.14, 0); s.feed(0.16, 16);
    s.suppress(5000);
    expect(s.poll(1000)).toBeNull();
  });
});

describe('quality', () => {
  const base: DeviceInfo = { coarsePointer: false, memoryGB: 8, cores: 8, gpu: 'NVIDIA', saveData: false, reducedMotion: false };
  it('picks sensible tiers', () => {
    expect(chooseTier(base)).toBe('high');
    expect(chooseTier({ ...base, coarsePointer: true, cores: 8, memoryGB: 6 })).toBe('medium');
    expect(chooseTier({ ...base, coarsePointer: true, cores: 4, memoryGB: 2 })).toBe('low');
    expect(chooseTier({ ...base, gpu: 'Mali-T720' })).toBe('low');
    expect(chooseTier({ ...base, saveData: true })).toBe('low');
    expect(chooseTier({ ...base, cores: 4, memoryGB: 4 })).toBe('medium');
    expect(chooseTier({ ...base, cores: 6, memoryGB: 8 })).toBe('high');
  });
  it('tiers are monotonic in cost', () => {
    const keys = ['ringSegments', 'cloudBanks', 'streaks', 'stars', 'debris', 'pixelRatioCap', 'previewSize'] as const;
    for (const k of keys) {
      expect(TIERS.high[k]).toBeGreaterThan(TIERS.medium[k]);
      expect(TIERS.medium[k]).toBeGreaterThan(TIERS.low[k]);
    }
  });
  it('governor lowers resolution first, then the tier, and does not oscillate', () => {
    const q = new QualityManager('high');
    const changes: string[] = [];
    q.onChange((s, why) => changes.push(`${s.tier}:${why}`));
    const slow = (n: number) => { for (let i = 0; i < n; i++) { (q as unknown as { cooldown: number }).cooldown = 0; q.evaluate(40); } };
    slow(2);
    expect(q.scale).toBeLessThan(1);
    expect(q.tier).toBe('high');
    for (let i = 0; i < 12; i++) slow(2);
    expect(q.tier).not.toBe('high');
    const tier = q.tier;
    const fast = () => { (q as unknown as { cooldown: number }).cooldown = 0; q.evaluate(5); };
    for (let i = 0; i < 40; i++) fast();
    // May regain resolution, but must never climb back above the tier we proved too heavy.
    expect(q.tier).toBe(tier);
    expect(q.scale).toBeGreaterThan(0.9);
  });
  it('ignores hitches and warm-up', () => {
    const q = new QualityManager('medium');
    for (let i = 0; i < 400; i++) q.sample(0.5); // tab-switch sized frames are discarded
    expect(q.tier).toBe('medium');
    expect(q.scale).toBe(1);
  });
  it('reduced motion trims particles', () => {
    const q = new QualityManager('high');
    q.setReducedMotion(true);
    expect(q.settings.streaks).toBe(0);
    expect(q.settings.postFX).toBe(false);
    q.setReducedMotion(false);
    expect(q.settings.streaks).toBe(TIERS.high.streaks);
  });
});
