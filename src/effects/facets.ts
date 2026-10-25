import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';

export interface FacetOptions {
  /** Points on the hull before it is built; more points = more facets (roughly 2n - 4 triangles). */
  points?: number;
  /** Pinch both ends of the long (Y) axis toward a point: 0 none, 1 needle. */
  taper?: number;
  /** 0..1 radius randomness per point; higher is more irregular and more chipped. */
  chip?: number;
  /**
   * Bevel radius (local units). The hull is built from every point grown by a tiny icosahedron
   * (a Minkowski sum), so every edge and corner gets small chamfer facets that catch the light.
   */
  bevel?: number;
}

/**
 * Angular, flat-shaded crystal: the convex hull of points scattered on an ellipsoid with random radii.
 * Every triangle is a real flat facet (flat normals), so each one catches the light on its own, which
 * is what makes glass look cut instead of blobby. `rx, ry, rz` are half-extents; Y is the long axis.
 *
 * The geometry is non-indexed and carries `aBary` (a barycentric corner per vertex) so the glass
 * shader can draw sharp lit edges along every facet boundary.
 */
export function facetedCrystal(rx: number, ry: number, rz: number, rand: () => number, o: FacetOptions = {}): THREE.BufferGeometry {
  const n = Math.max(8, Math.floor(o.points ?? 20));
  const chip = o.chip ?? 0.34;
  const taper = o.taper ?? 0;
  const golden = Math.PI * (3 - Math.sqrt(5));
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * golden + rand() * 0.9;
    const m = 1 - chip * rand(); // chipped: some points sit well inside the ellipsoid
    const pinch = taper > 0 ? Math.pow(Math.max(0.02, 1 - Math.pow(Math.abs(y), 2.4)), taper) : 1;
    pts.push(new THREE.Vector3(Math.cos(th) * r * rx * m * pinch, y * ry * (0.9 + 0.1 * m), Math.sin(th) * r * rz * m * pinch));
  }
  let hullPts = pts;
  if (o.bevel && o.bevel > 0) {
    const ico = new THREE.IcosahedronGeometry(1, 0).getAttribute('position');
    const dirs = new Map<string, THREE.Vector3>();
    for (let i = 0; i < ico.count; i++) {
      const d = new THREE.Vector3().fromBufferAttribute(ico, i).normalize();
      dirs.set(`${d.x.toFixed(3)},${d.y.toFixed(3)},${d.z.toFixed(3)}`, d);
    }
    hullPts = [];
    for (const p of pts) for (const d of dirs.values()) hullPts.push(p.clone().addScaledVector(d, o.bevel));
  }
  const hull = new ConvexGeometry(hullPts);
  const g = hull.index ? hull.toNonIndexed() : hull;
  g.computeVertexNormals(); // non-indexed => one normal per triangle (flat)
  const count = g.getAttribute('position').count;
  const bary = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) bary[i * 3 + (i % 3)] = 1;
  g.setAttribute('aBary', new THREE.BufferAttribute(bary, 3));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
