import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { clamp, damp } from './math';
import { nearestAnchor } from './chapters';

gsap.registerPlugin(ScrollTrigger);

/**
 * Owns the relationship between the native page scroll and the journey progress.
 *
 *   native scroll  --ScrollTrigger-->  `target`  --damping-->  `smooth`  (what the scene renders)
 *
 * Native scrolling is kept (touch inertia, keyboard, scrollbar, accessibility tools all keep
 * working); we only *damp* what the 3D scene shows so motion feels weighty.
 */
export class ScrollController {
  /** Raw normalised scroll position. */
  target = 0;
  /** Damped value used for rendering. */
  smooth = 0;
  /** Progress units per second (from ScrollTrigger). */
  velocity = 0;
  /** In reduced-motion mode progress snaps between "stills" with a short ease. */
  reduced = false;
  /** Locked while a modal is open. */
  locked = false;

  private trigger: ScrollTrigger | null = null;
  private lockY = 0;
  private reducedTween: gsap.core.Tween | null = null;
  private reducedProxy = { v: 0 };
  private reducedAnchor = -1;
  private programmatic: gsap.core.Tween | null = null;
  private listeners = new Set<(p: number) => void>();

  constructor(private spacer: HTMLElement) {}

  init(): void {
    this.trigger?.kill();
    this.trigger = ScrollTrigger.create({
      trigger: this.spacer,
      start: 'top top',
      end: 'bottom bottom',
      onUpdate: (self) => {
        if (this.locked) return;
        this.target = self.progress;
        this.velocity = self.getVelocity() / Math.max(1, this.maxScroll());
        this.listeners.forEach((l) => l(this.target));
      },
      onRefresh: (self) => {
        this.target = self.progress;
      },
    });
    this.target = this.trigger.progress;
    this.smooth = this.reduced ? nearestAnchor(this.target) : this.target;
    this.reducedProxy.v = this.smooth;
  }

  onScroll(fn: (p: number) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  maxScroll(): number {
    return Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  }

  refresh(): void {
    ScrollTrigger.refresh();
  }

  /** Advance the damped value. Called once per frame by the choreographer. */
  update(dt: number): number {
    if (this.reduced) {
      const anchor = nearestAnchor(this.target);
      if (anchor !== this.reducedAnchor) {
        this.reducedAnchor = anchor;
        this.reducedTween?.kill();
        // Short, simple move between stills instead of long continuous camera travel.
        this.reducedTween = gsap.to(this.reducedProxy, { v: anchor, duration: 0.7, ease: 'power2.inOut' });
      }
      this.smooth = this.reducedProxy.v;
    } else {
      // Slightly snappier when far away so the scene never feels disconnected from the scrollbar.
      const gap = Math.abs(this.target - this.smooth);
      const lambda = 5 + clamp(gap * 60, 0, 9);
      this.smooth = damp(this.smooth, this.target, lambda, dt);
      if (gap < 1e-5) this.smooth = this.target;
    }
    return this.smooth;
  }

  setReduced(on: boolean): void {
    this.reduced = on;
    this.reducedTween?.kill();
    this.reducedAnchor = -1;
    this.reducedProxy.v = this.smooth;
  }

  /** Scroll the page so that journey progress becomes `p`. */
  scrollToProgress(p: number, opts: { duration?: number; ease?: string; onComplete?: () => void } = {}): void {
    const y = clamp(p) * this.maxScroll();
    this.programmatic?.kill();
    const dur = this.reduced ? 0 : (opts.duration ?? 1.1);
    if (dur === 0) {
      window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior });
      opts.onComplete?.();
      return;
    }
    const proxy = { y: window.scrollY };
    this.programmatic = gsap.to(proxy, {
      y,
      duration: dur,
      ease: opts.ease ?? 'power3.inOut',
      onUpdate: () => window.scrollTo(0, proxy.y),
      onComplete: () => opts.onComplete?.(),
    });
  }

  /** Cancel programmatic scrolling when the user takes over. */
  cancelProgrammatic(): void {
    this.programmatic?.kill();
    this.programmatic = null;
  }

  get isProgrammatic(): boolean {
    return !!this.programmatic && this.programmatic.isActive();
  }

  /** Freeze the page (modal open) without losing the scroll position. */
  lock(): void {
    if (this.locked) return;
    this.locked = true;
    this.lockY = window.scrollY;
    this.cancelProgrammatic();
    document.documentElement.style.overflow = 'hidden';
  }

  unlock(): void {
    if (!this.locked) return;
    document.documentElement.style.overflow = '';
    window.scrollTo({ top: this.lockY, behavior: 'instant' as ScrollBehavior });
    this.locked = false;
    this.trigger?.update();
  }

  dispose(): void {
    this.trigger?.kill();
    this.reducedTween?.kill();
    this.programmatic?.kill();
    this.listeners.clear();
  }
}
