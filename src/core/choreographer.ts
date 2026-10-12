import gsap from 'gsap';
import type { SceneContext, SceneModule } from './context';
import type { Engine } from './engine';
import type { QualityManager, QualitySettings } from './quality';
import type { ScrollController } from './scroll';
import { buildCameraRig } from './cameraRig';
import type { PlaneModule } from '../scenes/plane';

interface Entry {
  mod: SceneModule;
  loaded: boolean;
  loading: Promise<void> | null;
}

/**
 * The centralized animation controller.
 *
 *   scroll  ->  damped progress p  ->  master GSAP timeline (camera, objects, atmosphere)
 *                                  ->  module.update(dt, p)  (springs, shimmer, instancing)
 *                                  ->  overlays / interaction hooks
 *
 * The timeline is *scrubbed*, never played, so every visual state is a pure function of p. That is
 * what makes the experience reversible, interruptible and restorable without glitches.
 */
export class Choreographer {
  tl!: gsap.core.Timeline;
  private built = false;
  readonly entries: Entry[] = [];
  private raf = 0;
  private last = 0;
  private running = false;
  private time = 0;
  /** Current damped progress (also exposed for UI). */
  p = 0;
  plane: PlaneModule | null = null;
  onFrame: ((dt: number, p: number, now: number) => void) | null = null;
  onLoaded: ((id: string) => void) | null = null;
  private rebuildTimer = 0;
  private visibilityHandler = () => this.onVisibility();

  constructor(
    private engine: Engine,
    private scroll: ScrollController,
    private quality: QualityManager,
  ) {
    this.buildTimeline();
    this.quality.onChange((q) => this.entries.forEach((e) => e.loaded && e.mod.setQuality(q, this.ctx)));
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  private get ctx(): SceneContext {
    return this.engine.ctx;
  }

  add(mod: SceneModule): void {
    this.entries.push({ mod, loaded: false, loading: null });
    this.engine.scene.add(mod.group);
    mod.group.visible = false;
  }

  /** Load a module once (progressive loading). Resolves when its geometry is in the scene. */
  ensure(id: string): Promise<void> {
    const e = this.entries.find((x) => x.mod.id === id);
    if (!e) return Promise.resolve();
    if (e.loaded) return Promise.resolve();
    if (!e.loading) {
      e.loading = e.mod.load(this.ctx).then(() => {
        e.loaded = true;
        e.mod.setQuality(this.quality.settings, this.ctx);
        this.scheduleRebuild(true);
        this.onLoaded?.(id);
      });
    }
    return e.loading;
  }

  /** Rebuild the master timeline (after loads, or when the layout changes). Preserves progress. */
  scheduleRebuild(immediate = false): void {
    window.clearTimeout(this.rebuildTimer);
    if (immediate) this.buildTimeline();
    else this.rebuildTimer = window.setTimeout(() => this.buildTimeline(), 120);
  }

  private buildTimeline(): void {
    const keep = this.built ? this.p : 0;
    if (this.built) this.tl.kill();
    this.built = true;
    this.tl = gsap.timeline({ paused: true, defaults: { overwrite: false } });
    buildCameraRig(this.tl, this.ctx);
    this.entries.forEach((e) => e.loaded && e.mod.build(this.tl, this.ctx));
    // Force every tween to initialise, sweep forward then back, and land on the current progress.
    // Every tween is a fromTo with immediateRender: true so its explicit start values are applied
    // on creation. (With immediateRender: false GSAP captured whatever value the target held at
    // first render, so a rebuild mid-scroll left stale state behind. tests/choreography.test.ts
    // guards this.)
    this.tl.progress(1, true).progress(0, true).progress(keep, true);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private onVisibility(): void {
    if (document.hidden) {
      // Pause rendering entirely while the tab is hidden.
      cancelAnimationFrame(this.raf);
      this.running = false;
    } else {
      this.start();
    }
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (this.engine.contextLost) return;

    this.time += dt;
    this.ctx.time = this.time;
    this.quality.sample(dt);

    const p = this.scroll.update(dt);
    this.p = p;
    this.tl.progress(p, true);

    // On-demand loading: pull modules in a little before they are needed.
    for (const e of this.entries) {
      if (!e.loaded && !e.loading && p >= e.mod.range[0] - 0.18) void this.ensure(e.mod.id);
    }

    for (const e of this.entries) {
      const [a, b] = e.mod.range;
      const on = e.loaded && p >= a - 0.03 && p <= b + 0.03;
      e.mod.group.visible = on;
      if (on) e.mod.update(dt, p, this.ctx);
    }

    this.engine.applyCamera(this.plane && this.plane.group.visible ? this.plane.trail : null);
    this.onFrame?.(dt, p, now);
    this.engine.render();
  };

  /** Re-apply quality to all loaded modules (e.g. after reduced-motion changes). */
  applyQuality(q: QualitySettings): void {
    this.entries.forEach((e) => e.loaded && e.mod.setQuality(q, this.ctx));
  }

  dispose(): void {
    this.stop();
    window.clearTimeout(this.rebuildTimer);
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    this.tl.kill();
    this.entries.forEach((e) => {
      this.engine.scene.remove(e.mod.group);
      e.mod.dispose();
    });
  }
}
