/**
 * Infinite scroll: once the visitor reaches the bottom and keeps pushing, the page returns to the top.
 * `OverscrollAccumulator` is the pure part (testable): it collects "push" past the end and says when the
 * intent is deliberate (enough accumulated within a short window), so a stray flick never teleports anyone.
 */
export class OverscrollAccumulator {
  private total = 0;
  private last = 0;
  constructor(private threshold = 420, private window = 900) {}

  /** Add a push (in px-equivalents). Returns true when the loop should fire. */
  push(amount: number, now: number): boolean {
    if (now - this.last > this.window) this.total = 0;
    this.last = now;
    this.total += Math.max(0, amount);
    if (this.total >= this.threshold) {
      this.total = 0;
      return true;
    }
    return false;
  }

  reset(): void {
    this.total = 0;
  }
}

export function atBottom(scrollY: number, innerHeight: number, scrollHeight: number, slack = 3): boolean {
  return scrollY + innerHeight >= scrollHeight - slack;
}

export interface LoopHooks {
  /** Instantly jump everything (page scroll + damped progress) to the top. */
  jumpToTop: () => void;
  /** True while a modal or programmatic travel should block looping. */
  blocked: () => boolean;
}

/** Wires wheel / touch / keyboard overscroll at the bottom of the page to a veil-covered jump to the top. */
export class LoopController {
  private acc = new OverscrollAccumulator();
  private veil = document.getElementById('loop-veil');
  private busy = false;
  private touchY = 0;
  private disposers: Array<() => void> = [];

  constructor(private hooks: LoopHooks, private reduced: () => boolean) {
    this.on('wheel', (e) => { if (e.deltaY > 0) this.consider(e.deltaY); }, { passive: true });
    this.on('touchstart', (e) => { this.touchY = e.touches[0]?.clientY ?? 0; }, { passive: true });
    this.on('touchmove', (e) => {
      const y = e.touches[0]?.clientY ?? this.touchY;
      const dy = this.touchY - y; // swipe up = scroll down
      this.touchY = y;
      if (dy > 0) this.consider(dy * 3);
    }, { passive: true });
    this.on('keydown', (e) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ' || e.key === 'End') this.consider(e.key === 'ArrowDown' ? 140 : 420);
    });
  }

  private on<K extends keyof WindowEventMap>(t: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions): void {
    window.addEventListener(t, fn as EventListener, opts);
    this.disposers.push(() => window.removeEventListener(t, fn as EventListener, opts));
  }

  private consider(amount: number): void {
    if (this.busy || this.hooks.blocked()) return;
    const el = document.documentElement;
    if (!atBottom(window.scrollY, window.innerHeight, el.scrollHeight)) { this.acc.reset(); return; }
    if (this.acc.push(amount, performance.now())) void this.loop();
  }

  /** Veil in, jump to the top, veil out. Also used by the footer button. */
  async loop(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const veil = this.veil;
    const quick = this.reduced();
    const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, quick ? 0 : ms));
    if (veil) { veil.classList.add('is-on'); }
    await wait(520);
    this.hooks.jumpToTop();
    await wait(120);
    if (veil) veil.classList.remove('is-on');
    await wait(620);
    this.acc.reset();
    this.busy = false;
  }

  dispose(): void {
    this.disposers.forEach((d) => d());
    this.disposers = [];
  }
}
