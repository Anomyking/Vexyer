import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { seeded } from '../core/math';
import { facetedCrystal } from '../effects/facets';

/**
 * Procedural stand-ins that mirror `blender/export_assets.py` one-to-one (same node names, same
 * proportions). They are used when `public/models/*.glb` has not been exported yet, so the site
 * always runs, and they keep the experience working if a GLB ever fails to download.
 *
 * Coordinates: Blender is Z-up, three.js is Y-up. Blender (x, y, z) -> three (x, z, -y).
 */

export interface ModelPart {
  name: string;
  geometry: THREE.BufferGeometry;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}
export type ModelPack = Map<string, ModelPart>;
export type PackName = 'hero' | 'portfolio' | 'sky' | 'glass' | 'plane';

const part = (name: string, geometry: THREE.BufferGeometry, position = new THREE.Vector3(), quaternion = new THREE.Quaternion()): ModelPart => ({
  name,
  geometry,
  position,
  quaternion,
});

const b2t = (x: number, y: number, z: number): [number, number, number] => [x, z, -y];

interface Level {
  z: number;
  w: number;
  d: number;
  rot: number;
}

/** Lofted block with an optional twist per level (the "modified cube" ring element). */
function loft(levels: Level[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const rings: number[][] = [];
  for (const { z, w, d, rot } of levels) {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const idx: number[] = [];
    for (const [x, y] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]] as const) {
      idx.push(positions.length / 3);
      positions.push(...b2t(x * c - y * s, x * s + y * c, z));
    }
    rings.push(idx);
  }
  const index: number[] = [];
  for (let r = 0; r < rings.length - 1; r++) {
    const a = rings[r];
    const b = rings[r + 1];
    for (let i = 0; i < 4; i++) index.push(a[i], a[(i + 1) % 4], b[(i + 1) % 4], a[i], b[(i + 1) % 4], b[i]);
  }
  const first = rings[0];
  const last = rings[rings.length - 1];
  index.push(first[0], first[2], first[1], first[0], first[3], first[2]);
  index.push(last[0], last[1], last[2], last[0], last[2], last[3]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  return flat;
}

function cloudBank(u: number, v: number): THREE.BufferGeometry {
  const row: Array<[number, number]> = [[-14.84, 1.809], [-11.707, 3.212], [-7.967, 4.151], [-0.779, 7.369], [6.872, 4.151], [10.612, 3.212], [13.744, 1.809]];
  return mergeGeometries(row.map(([x, r]) => new THREE.SphereGeometry(r, u, v).translate(x, 0, 0)))!;
}

function paperPlane(): THREE.BufferGeometry {
  const V = (x: number, y: number, z: number) => new THREE.Vector3(...b2t(x, y, z));
  const N = V(0, 3.2, 0);
  const T = V(0, -2.6, 0.2);
  const K = V(0, -2.6, -1.0);
  const L = V(-2.4, -2.6, 0.55);
  const R = V(2.4, -2.6, 0.55);
  const KF = V(0, 0.9, -0.2);
  const tri = [N, T, L, N, R, T, N, K, KF, KF, K, T, N, KF, T];
  const g = new THREE.BufferGeometry().setFromPoints(tri);
  g.computeVertexNormals();
  return g;
}

export function buildProceduralPack(name: PackName): ModelPack {
  const out: ModelPack = new Map();
  const add = (p: ModelPart) => out.set(p.name, p);
  switch (name) {
    case 'hero': {
      const sk = [[8.771, 0.613], [2.659, -6.415], [-1.927, 5.245], [-8.039, -1.783]];
      const cx = sk.reduce((a, p) => a + p[0], 0) / 4;
      const cy = sk.reduce((a, p) => a + p[1], 0) / 4;
      sk.forEach(([x, y], i) => {
        add(part(`hero_${i}`, new RoundedBoxGeometry(7.4, 0.7, 7.4, 1, 0.14), new THREE.Vector3(...b2t(x - cx, y - cy, 0)), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.746)));
      });
      break;
    }
    case 'portfolio': {
      add(part('ring_segment', loft([{ z: -1.7, w: 1.15, d: 1.5, rot: -0.22 }, { z: 0, w: 0.55, d: 0.8, rot: 0 }, { z: 1.7, w: 1.15, d: 1.5, rot: 0.22 }])));
      add(part('ring_segment_lo', loft([{ z: -1.7, w: 1.0, d: 1.3, rot: 0 }, { z: 1.7, w: 1.0, d: 1.3, rot: 0 }])));
      add(part('core_sphere', new THREE.SphereGeometry(3.4, 24, 16)));
      add(part('core_sphere_lo', new THREE.SphereGeometry(3.4, 12, 8)));
      add(part('screen_frame', new RoundedBoxGeometry(6.8, 4.4, 0.18, 1, 0.05)));
      break;
    }
    case 'sky': {
      add(part('cloud_bank', cloudBank(10, 6)));
      add(part('cloud_bank_lo', cloudBank(7, 5)));
      break;
    }
    case 'glass': {
      const r = seeded(11);
      // Angular, flat-shaded cut crystals (convex hulls). Y is the long axis for shards; fragments are
      // thin slabs facing +Z so the lettering on them reads from the front.
      add(part('shard_a', facetedCrystal(1.5, 10, 0.55, r, { points: 18, taper: 1.0, chip: 0.12, bevel: 0.05 })));
      add(part('shard_b', facetedCrystal(1.35, 9, 0.5, r, { points: 18, taper: 1.0, chip: 0.12, bevel: 0.05 })));
      add(part('frag_0', facetedCrystal(1.5, 1.0, 0.5, r, { points: 24, bevel: 0.07 })));
      add(part('frag_1', facetedCrystal(1.4, 0.95, 0.5, r, { points: 22, bevel: 0.07 })));
      add(part('frag_2', facetedCrystal(1.3, 0.9, 0.5, r, { points: 22, bevel: 0.07 })));
      add(part('frag_debris', facetedCrystal(0.9, 0.6, 0.2, r, { points: 10, chip: 0.4, bevel: 0.03 })));
      break;
    }
    case 'plane': {
      add(part('paper_plane', paperPlane()));
      break;
    }
  }
  return out;
}
