import type { Engine } from '../core/engine';
import type { QualityManager } from '../core/quality';

/** Opt-in debug HUD (`?debug`): frame time, tier, draw calls, GPU object counts and JS heap. */
export class Hud {
  private el = document.createElement('pre');
  private frames = 0;
  private acc = 0;
  private fps = 0;

  constructor(private engine: Engine, private quality: QualityManager) {
    Object.assign(this.el.style, {
      position: 'fixed', left: '8px', bottom: '8px', zIndex: '99', margin: '0', padding: '6px 8px',
      font: '11px/1.35 ui-monospace, monospace', color: '#9fe8ff', background: 'rgba(0,0,0,.6)', borderRadius: '6px', pointerEvents: 'none',
    } as CSSStyleDeclaration);
    document.body.appendChild(this.el);
  }

  update(dt: number, p: number): void {
    this.frames++;
    this.acc += dt;
    if (this.acc < 0.5) return;
    this.fps = this.frames / this.acc;
    this.frames = 0;
    this.acc = 0;
    const s = this.engine.stats();
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    this.el.textContent =
      `fps ${this.fps.toFixed(0)}  avg ${this.quality.avgMs.toFixed(1)}ms\n` +
      `tier ${this.quality.tier}  res x${this.quality.scale.toFixed(2)}\n` +
      `p ${p.toFixed(3)}  calls ${s.calls}  tris ${s.triangles}\n` +
      `geo ${s.geometries}  tex ${s.textures}` +
      (mem ? `\nheap ${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB` : '');
  }

  dispose(): void {
    this.el.remove();
  }
}
