import { describe, expect, it } from 'vitest';
import { seeded } from '../src/core/math';
import { facetedCrystal } from '../src/effects/facets';

describe('facetedCrystal', () => {
  const g = facetedCrystal(1.5, 1, 0.5, seeded(3), { points: 22 });
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const bary = g.getAttribute('aBary');

  it('is a closed non-indexed hull with a sensible facet count', () => {
    expect(g.index).toBeNull();
    expect(pos.count % 3).toBe(0);
    expect(pos.count / 3).toBeGreaterThanOrEqual(12);
    expect(pos.count / 3).toBeLessThanOrEqual(60);
  });
  it('is flat shaded: all three vertices of a triangle share one normal', () => {
    for (let t = 0; t < pos.count; t += 3) {
      for (let k = 1; k < 3; k++) {
        expect(nor.getX(t + k)).toBeCloseTo(nor.getX(t), 5);
        expect(nor.getY(t + k)).toBeCloseTo(nor.getY(t), 5);
        expect(nor.getZ(t + k)).toBeCloseTo(nor.getZ(t), 5);
      }
    }
  });
  it('normals point outward (hull is convex around the origin)', () => {
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getX(i) * nor.getX(i) + pos.getY(i) * nor.getY(i) + pos.getZ(i) * nor.getZ(i)).toBeGreaterThan(-1e-4);
    }
  });
  it('carries one barycentric corner per vertex', () => {
    expect(bary.count).toBe(pos.count);
    for (let t = 0; t < pos.count; t += 3) {
      const sum = [0, 1, 2].map((k) => bary.getX(t + k) + bary.getY(t + k) * 2 + bary.getZ(t + k) * 4).sort();
      expect(sum).toEqual([1, 2, 4]);
    }
  });
  it('is deterministic for a seed, and stays inside its half-extents', () => {
    const h = facetedCrystal(1.5, 1, 0.5, seeded(3), { points: 22 });
    expect(Array.from(h.getAttribute('position').array)).toEqual(Array.from(pos.array));
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    expect(bb.max.x).toBeLessThanOrEqual(1.5 + 1e-6);
    expect(bb.max.y).toBeLessThanOrEqual(1 + 1e-6);
    expect(bb.max.z).toBeLessThanOrEqual(0.5 + 1e-6);
  });
  it('needle shards are long and thin', () => {
    const n = facetedCrystal(0.7, 10, 0.7, seeded(11), { points: 16, taper: 1.1, chip: 0.2 });
    n.computeBoundingBox();
    const s = new (n.boundingBox!.max.constructor as typeof import('three').Vector3)();
    n.boundingBox!.getSize(s);
    expect(s.y).toBeGreaterThan(s.x * 6);
  });

  it('bevel adds chamfer facets, keeps flat outward normals and grows extents by at most the radius', () => {
    const b = facetedCrystal(1.5, 1, 0.5, seeded(3), { points: 22, bevel: 0.07 });
    const bp = b.getAttribute('position');
    const bn = b.getAttribute('normal');
    expect(bp.count).toBeGreaterThan(pos.count * 2);
    for (let i = 0; i < bp.count; i++) {
      expect(bp.getX(i) * bn.getX(i) + bp.getY(i) * bn.getY(i) + bp.getZ(i) * bn.getZ(i)).toBeGreaterThan(-1e-4);
    }
    b.computeBoundingBox();
    expect(b.boundingBox!.max.x).toBeLessThanOrEqual(1.5 + 0.07 + 1e-6);
  });
});
