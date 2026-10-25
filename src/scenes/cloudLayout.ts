import { seeded } from '../core/math';

/**
 * Pure cloud layout. A "bank" is the sketch's row of seven graduated spheres (small - big - small)
 * plus a few rounded tops, rendered as soft camera-facing puffs. Banks are placed in four zones:
 *   sketch   - the four rows from the sketch, where the camera dives through after the portfolio
 *   horizon  - huge distant banks that form the cloud deck just under the horizon
 *   scatter  - mid-distance banks framing the screen edges (never in front of the glass fragments)
 *   corridor - banks along the paper plane's flight path
 */
export interface Puff {
  x: number; y: number; z: number;
  /** Full quad width in world units. */
  size: number;
  seed: number;
  /** 0..1 brightness variation. */
  tone: number;
  /** Width / height of the quad (clouds are wider than tall). */
  stretch: number;
  zone: 'sketch' | 'horizon' | 'scatter' | 'corridor';
}

/** [x offset, radius] of the sketch's seven spheres. */
export const BANK_ROW: ReadonlyArray<readonly [number, number]> = [
  [-14.84, 1.809], [-11.707, 3.212], [-7.967, 4.151], [-0.779, 7.369], [6.872, 4.151], [10.612, 3.212], [13.744, 1.809],
];
const SKETCH_Z = [14.5, 4, -5.9, -16.3];
export const PUFFS_PER_BANK = BANK_ROW.length + 3;

export function layoutClouds(banks: number): Puff[] {
  const rand = seeded(5);
  const out: Puff[] = [];
  const bank = (bx: number, by: number, bz: number, scale: number, yaw: number, zone: Puff['zone']) => {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (const [ox, r] of BANK_ROW) {
      const lx = ox * scale * 0.8;
      out.push({
        x: bx + lx * c, y: by + r * scale * 0.22 + rand() * 0.25 * scale, z: bz - lx * s,
        size: r * scale * 2.6 * (0.85 + rand() * 0.3), seed: rand() * 100, tone: rand(), stretch: 1.3, zone,
      });
    }
    for (let k = 0; k < 3; k++) {
      const lx = (rand() * 2 - 1) * 5 * scale;
      out.push({
        x: bx + lx * c, y: by + (3 + rand() * 2.8) * scale, z: bz - lx * s,
        size: (3.2 + rand() * 2.4) * scale * 2.3, seed: rand() * 100, tone: 0.55 + rand() * 0.45, stretch: 1.0, zone,
      });
    }
  };

  const n = Math.max(0, Math.floor(banks));
  const nSketch = Math.min(4, n);
  for (let i = 0; i < nSketch; i++) bank(0, 89.7, SKETCH_Z[i], 1, 0, 'sketch');

  const rest = n - nSketch;
  const nHorizon = Math.ceil(rest * 0.36);
  const nScatter = Math.ceil(rest * 0.3);
  const nCorridor = Math.max(0, rest - nHorizon - nScatter);

  for (let i = 0; i < nHorizon; i++) {
    const t = nHorizon > 1 ? i / (nHorizon - 1) : 0.5;
    const az = (t * 2 - 1) * 0.95 + (rand() - 0.5) * 0.15; // radians either side of straight ahead
    const dist = 250 + rand() * 170;
    bank(Math.sin(az) * dist, 18 + rand() * 24, -Math.cos(az) * dist, 5 + rand() * 3, (rand() - 0.5) * 0.6, 'horizon');
  }
  for (let i = 0; i < nScatter; i++) {
    const side = i % 2 ? 1 : -1;
    const dist = 60 + rand() * 110;
    bank(side * (28 + rand() * 60), 36 + rand() * 34, -(26 + dist), 1.3 + rand() * 1.1, (rand() - 0.5) * 0.8, 'scatter');
  }
  for (let i = 0; i < nCorridor; i++) {
    const t = nCorridor > 1 ? i / (nCorridor - 1) : 0.5;
    const side = i % 2 ? 1 : -1;
    const planeY = 43 - t * 21; // follows the paper plane's descent
    bank(side * (22 + rand() * 48), planeY - 10 - rand() * 16, -60 - t * 380, 1.3 + rand() * 1.0, (rand() - 0.5) * 0.7, 'corridor');
  }
  return out;
}
