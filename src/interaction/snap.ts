/**
 * Magnetic snapping for the portfolio ring.
 *
 * Pure logic (no DOM, no timers) so behaviour is deterministic and unit-testable:
 *   - `feed(p, nowMs)` is called with every scroll progress sample.
 *   - `poll(nowMs)` is called every frame and returns a target progress to settle on, or null.
 *
 * Velocity-aware: a quick flick projects the landing point forward so the ring "throws" to the next
 * project, while a slow drag settles on the nearest one.
 *
 * Release condition: snapping only applies while progress is *inside* [first, last] snap points.
 * Before the first or after the last project the user is in free-scroll territory and is never
 * pulled back, so they cannot get trapped in the installation.
 */

export interface SnapOptions {
  points: number[];
  /** Progress/second below which the scroll is considered "settled". */
  settleVelocity: number;
  /** How long velocity must stay low before snapping (ms). */
  settleDelayMs: number;
  /** How far (as a fraction of point spacing) a flick may project beyond the current position. */
  flickProjection: number;
}

export const DEFAULT_SNAP: Omit<SnapOptions, 'points'> = {
  settleVelocity: 0.012,
  settleDelayMs: 140,
  flickProjection: 0.9,
};

export class MagneticSnap {
  private opts: SnapOptions;
  private lastP = 0;
  private lastT = 0;
  private velocity = 0; // signed progress/sec, low-pass filtered
  private peakVelocity = 0; // signed velocity of the most recent fast movement
  private slowSince: number | null = null;
  private pointerDown = false;
  private suppressedUntil = 0;
  private armed = false;

  constructor(opts: Partial<SnapOptions> & { points: number[] }) {
    this.opts = { ...DEFAULT_SNAP, ...opts };
  }

  get points(): number[] {
    return this.opts.points;
  }

  setPoints(points: number[]): void {
    this.opts.points = points;
  }

  /** While a finger/mouse is held on the page we never snap (it would fight the user). */
  setPointerDown(down: boolean, nowMs: number): void {
    this.pointerDown = down;
    if (!down) this.slowSince = nowMs;
  }

  /** Temporarily disable (e.g. while a programmatic scroll is running). */
  suppress(untilMs: number): void {
    this.suppressedUntil = Math.max(this.suppressedUntil, untilMs);
    this.slowSince = null;
    this.armed = false;
  }

  /** Is `p` in the magnetic zone? Boundaries are inclusive so a settled ring stays settled. */
  inZone(p: number): boolean {
    const pts = this.opts.points;
    return p >= pts[0] - 1e-6 && p <= pts[pts.length - 1] + 1e-6;
  }

  feed(p: number, nowMs: number): void {
    const dt = (nowMs - this.lastT) / 1000;
    if (dt > 0 && dt < 0.5) {
      const inst = (p - this.lastP) / dt;
      this.velocity += (inst - this.velocity) * 0.35;
    } else {
      this.velocity = 0;
    }
    const moved = Math.abs(p - this.lastP) > 1e-6;
    this.lastP = p;
    this.lastT = nowMs;

    if (moved) {
      this.armed = true;
      this.slowSince = null;
    }
    if (Math.abs(this.velocity) > this.opts.settleVelocity) this.peakVelocity = this.velocity;
  }

  /** Returns a settle target, or null when nothing should happen. Call once per frame. */
  poll(nowMs: number): number | null {
    if (nowMs < this.suppressedUntil || this.pointerDown || !this.armed) return null;

    // Decay the velocity estimate when no scroll events arrive (feed isn't called when idle).
    if (nowMs - this.lastT > 60) this.velocity *= 0.5;

    if (Math.abs(this.velocity) > this.opts.settleVelocity) {
      this.slowSince = null;
      return null;
    }
    if (this.slowSince === null) this.slowSince = nowMs;
    if (nowMs - this.slowSince < this.opts.settleDelayMs) return null;

    this.armed = false;
    const v = this.peakVelocity;
    this.peakVelocity = 0;
    return this.target(this.lastP, v);
  }

  /** Where should we land if released at `p` having recently moved at `v`? Null in free-scroll zones. */
  target(p: number, v: number): number | null {
    const pts = this.opts.points;
    if (!this.inZone(p)) return null; // release condition: outside the installation, never snap
    const spacing = (pts[pts.length - 1] - pts[0]) / Math.max(1, pts.length - 1);
    // Project the landing point by the throw velocity (clamped so one flick moves ~1 project).
    const throwDist = Math.max(-1, Math.min(1, v / 0.25)) * spacing * this.opts.flickProjection;
    const projected = Math.min(pts[pts.length - 1], Math.max(pts[0], p + throwDist));
    let best = pts[0];
    for (const q of pts) if (Math.abs(q - projected) < Math.abs(best - projected)) best = q;
    return Math.abs(best - p) < 1e-5 ? null : best;
  }

  /** Index of the point nearest to p. */
  nearestIndex(p: number): number {
    const pts = this.opts.points;
    let bi = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i] - p) < Math.abs(pts[bi] - p)) bi = i;
    return bi;
  }
}
