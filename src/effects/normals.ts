import * as THREE from 'three';

/**
 * Blend flat (per-face) and smooth (per-position averaged) normals. 0 = faceted, 1 = fully smooth.
 * Works on any geometry, including GLBs that were exported flat-shaded, so a low-poly crystal stops
 * reading as a gem with visible planes without changing its silhouette.
 */
export function softenNormals(src: THREE.BufferGeometry, amount = 0.7): THREE.BufferGeometry {
  const g = src.index ? src.toNonIndexed() : src.clone();
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const count = pos.count;
  const key = (i: number) => `${Math.round(pos.getX(i) * 1e3)},${Math.round(pos.getY(i) * 1e3)},${Math.round(pos.getZ(i) * 1e3)}`;
  const keys: string[] = new Array(count);
  const accum = new Map<string, THREE.Vector3>();
  const face = new Float32Array(count * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const n = new THREE.Vector3();

  for (let i = 0; i < count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    n.subVectors(c, b).cross(a.clone().sub(b)); // area-weighted face normal
    for (let k = 0; k < 3; k++) {
      const kk = key(i + k);
      keys[i + k] = kk;
      const acc = accum.get(kk);
      if (acc) acc.add(n);
      else accum.set(kk, n.clone());
      face[(i + k) * 3] = n.x;
      face[(i + k) * 3 + 1] = n.y;
      face[(i + k) * 3 + 2] = n.z;
    }
  }

  const out = new Float32Array(count * 3);
  const f = new THREE.Vector3(), s = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    f.set(face[i * 3], face[i * 3 + 1], face[i * 3 + 2]).normalize();
    s.copy(accum.get(keys[i])!).normalize();
    n.copy(f).lerp(s, amount);
    if (n.lengthSq() < 1e-12) n.copy(f);
    n.normalize();
    out.set([n.x, n.y, n.z], i * 3);
  }
  g.setAttribute('normal', new THREE.BufferAttribute(out, 3));
  return g;
}
