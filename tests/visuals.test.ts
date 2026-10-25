import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { softenNormals } from '../src/effects/normals';
import { BANK_ROW, PUFFS_PER_BANK, layoutClouds } from '../src/scenes/cloudLayout';

describe('softenNormals', () => {
  const box = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  it('keeps vertex count and yields unit normals', () => {
    const g = softenNormals(box, 0.8);
    expect(g.getAttribute('position').count).toBe(box.getAttribute('position').count);
    const n = g.getAttribute('normal');
    for (let i = 0; i < n.count; i++) {
      expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 4);
    }
  });
  it('amount 0 keeps flat normals, higher amount bends them toward the corner', () => {
    const flat = softenNormals(box, 0).getAttribute('normal');
    const soft = softenNormals(box, 1).getAttribute('normal');
    const maxAxis = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, i: number) =>
      Math.max(Math.abs(a.getX(i)), Math.abs(a.getY(i)), Math.abs(a.getZ(i)));
    expect(maxAxis(flat, 0)).toBeCloseTo(1, 4);
    expect(maxAxis(soft, 0)).toBeLessThan(0.9);
  });
  it('does not mutate the source', () => {
    const before = box.getAttribute('normal').getX(0);
    softenNormals(box, 1);
    expect(box.getAttribute('normal').getX(0)).toBe(before);
  });
});

describe('layoutClouds', () => {
  it('is deterministic and sized by bank count', () => {
    const a = layoutClouds(10);
    expect(a).toEqual(layoutClouds(10));
    expect(a.length).toBe(10 * PUFFS_PER_BANK);
    expect(layoutClouds(0)).toEqual([]);
  });
  it('puts the four sketch rows first and keeps values finite', () => {
    const p = layoutClouds(8);
    expect(p.slice(0, 4 * PUFFS_PER_BANK).every((q) => q.zone === 'sketch')).toBe(true);
    expect(p.every((q) => [q.x, q.y, q.z, q.size].every(Number.isFinite) && q.size > 0)).toBe(true);
    expect(BANK_ROW.length).toBe(7);
  });
});
