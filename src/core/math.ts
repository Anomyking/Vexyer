/** Small, dependency-free math helpers used across the experience. */

export const clamp = (v: number, a = 0, b = 1): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const inverseLerp = (a: number, b: number, v: number): number => (a === b ? 0 : (v - a) / (b - a));
export const remap = (v: number, a: number, b: number, c: number, d: number): number => lerp(c, d, clamp(inverseLerp(a, b, v)));

/** Normalised position of `p` inside [a, b], clamped to 0..1. */
export const range = (p: number, a: number, b: number): number => clamp(inverseLerp(a, b, p));

export const smoothstep = (a: number, b: number, v: number): number => {
  const t = range(v, a, b);
  return t * t * (3 - 2 * t);
};

export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
export const easeOutBack = (t: number, s = 1.4): number => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);

/**
 * Frame-rate independent damping. `lambda` is the responsiveness (higher = snappier).
 * Equivalent to an exponential approach: x += (target - x) * (1 - e^(-lambda * dt)).
 */
export const damp = (current: number, target: number, lambda: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

/** Trapezoid window: 0 -> 1 across [a,b], hold, 1 -> 0 across [c,d]. */
export const window4 = (p: number, a: number, b: number, c: number, d: number): number =>
  smoothstep(a, b, p) * (1 - smoothstep(c, d, p));

/** Mulberry32 seeded RNG so procedural layouts are identical on every load. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Critically-damped-ish spring for one scalar. Semi-implicit Euler with sub-stepping so large
 * frame times (tab switches, GC pauses) cannot explode the simulation.
 */
export class Spring {
  value: number;
  velocity = 0;
  constructor(initial = 0, public stiffness = 55, public damping = 9) {
    this.value = initial;
  }
  update(target: number, dt: number): number {
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = Math.min(dt, 0.1) / steps;
    for (let i = 0; i < steps; i++) {
      const a = this.stiffness * (target - this.value) - this.damping * this.velocity;
      this.velocity += a * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }
  reset(v: number): void {
    this.value = v;
    this.velocity = 0;
  }
}
