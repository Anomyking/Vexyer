import { PORTFOLIO, snapPoints } from '../core/chapters';
import type { ScrollController } from '../core/scroll';
import { MagneticSnap } from './snap';

/**
 * Wires the magnetic snap logic to the real world: scroll events, pointer/touch state, keyboard,
 * on-screen arrows and horizontal swipes.
 *
 * - Free zones: before the first and after the last project nothing is intercepted, so the user is
 *   never trapped in the installation (the release condition lives in MagneticSnap).
 * - Any user input (wheel / touch / key) immediately cancels a running settle animation.
 */
export class PortfolioInput {
  readonly snap: MagneticSnap;
  private disposers: Array<() => void> = [];
  private points: number[];
  private settling = false;

  constructor(private scroll: ScrollController, count: number = PORTFOLIO.count) {
    this.points = snapPoints(count);
    this.snap = new MagneticSnap({ points: this.points });
    this.bind();
  }

  private on<K extends keyof WindowEventMap>(t: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions): void {
    window.addEventListener(t, fn as EventListener, opts);
    this.disposers.push(() => window.removeEventListener(t, fn as EventListener, opts));
  }

  private bind(): void {
    // Progress samples feed the velocity estimator.
    this.disposers.push(this.scroll.onScroll((p) => this.snap.feed(p, performance.now())));

    const interrupt = () => {
      if (this.settling || this.scroll.isProgrammatic) {
        this.scroll.cancelProgrammatic();
        this.settling = false;
      }
    };
    this.on('wheel', interrupt, { passive: true });
    this.on('touchstart', () => { interrupt(); this.snap.setPointerDown(true, performance.now()); }, { passive: true });
    this.on('touchend', () => this.snap.setPointerDown(false, performance.now()), { passive: true });
    this.on('touchcancel', () => this.snap.setPointerDown(false, performance.now()), { passive: true });
    this.on('pointerdown', (e) => { if (e.pointerType === 'mouse') this.snap.setPointerDown(true, performance.now()); });
    this.on('pointerup', (e) => { if (e.pointerType === 'mouse') this.snap.setPointerDown(false, performance.now()); });

    // Keyboard: arrows step between projects while the installation is on screen.
    this.on('keydown', (e) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (document.getElementById('panel')?.hidden === false) return;
      if (!this.inInstallation(this.scroll.target)) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); this.step(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); this.step(-1); }
      else if (e.key === 'Home' || e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown' || e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === ' ') interrupt();
    });

    // Horizontal swipe = next/previous project. Vertical drags remain native scrolling.
    let sx = 0, sy = 0, st = 0;
    this.on('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; st = performance.now(); });
    this.on('pointerup', (e) => {
      if (e.pointerType === 'mouse') return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      if (performance.now() - st > 700 || Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
      if (!this.inInstallation(this.scroll.target)) return;
      this.step(dx < 0 ? 1 : -1);
    });

    document.getElementById('work-next')?.addEventListener('click', () => this.step(1));
    document.getElementById('work-prev')?.addEventListener('click', () => this.step(-1));
  }

  /** Is the installation on screen (generous margin so arrows work as it fades in/out)? */
  inInstallation(p: number): boolean {
    return p >= PORTFOLIO.start - 0.03 && p <= PORTFOLIO.end + 0.03;
  }

  /** Move to the next/previous project; past either end, hand control back to the page. */
  step(delta: 1 | -1): void {
    const p = this.scroll.target;
    const i = this.snap.nearestIndex(p);
    const j = i + delta;
    if (j < 0) return this.goto(0.2); // leave upwards, back toward the opening
    if (j >= this.points.length) return this.goto(PORTFOLIO.end + 0.075); // leave downwards into the clouds
    this.goto(this.points[j]);
  }

  private goto(p: number): void {
    this.settling = true;
    this.snap.suppress(performance.now() + 900);
    this.scroll.scrollToProgress(p, {
      duration: 0.75,
      ease: 'power3.out',
      onComplete: () => {
        this.settling = false;
        this.snap.suppress(performance.now() + 120);
      },
    });
  }

  /** Call every frame. */
  update(now: number): void {
    if (this.scroll.locked || this.scroll.reduced || this.scroll.isProgrammatic) return;
    const target = this.snap.poll(now);
    if (target !== null) this.goto(target);
  }

  dispose(): void {
    this.disposers.forEach((d) => d());
    this.disposers = [];
  }
}
