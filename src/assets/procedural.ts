import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { seeded } from '../core/math';

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

function crystal(sx: number, sy: number, sz: number, jitter: number, rand: () => number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 0);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  // Jitter per unique vertex position so faces stay watertight.
  const seen = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let k = seen.get(key);
    if (k === undefined) {
      k = 1 + (rand() * 2 - 1) * jitter;
      seen.set(key, k);
    }
    pos.setXYZ(i, pos.getX(i) * k * sx, pos.getY(i) * k * sz, pos.getZ(i) * k * sy);
  }
  g.computeVertexNormals();
  return g;
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
      add(part('shard_a', crystal(0.55, 0.55, 10, 0.12, r)));
      add(part('shard_b', crystal(0.5, 0.5, 9, 0.12, r)));
      add(part('frag_0', crystal(1.5, 1.2, 1.9, 0.22, r)));
      add(part('frag_1', crystal(1.2, 1.9, 1.3, 0.22, r)));
      add(part('frag_2', crystal(1.7, 1.3, 1.1, 0.22, r)));
      add(part('frag_debris', crystal(0.4, 0.3, 0.5, 0.25, r)));
      break;
    }
    case 'plane': {
      add(part('paper_plane', paperPlane()));
      break;
    }
  }
  return out;
}
