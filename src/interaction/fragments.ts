import type { Engine } from '../core/engine';
import { FRAGMENT_ACTIVE } from '../core/chapters';
import type { GlassModule } from '../scenes/glass';
import type { PanelController } from '../ui/panel';

/**
 * The glass fragments are 3D, but the *interactive* elements are real <button>s positioned over
 * their projected screen position every frame. That gives us tap targets, keyboard focus, hover,
 * screen-reader names and a working fallback in one mechanism - no raycasting needed.
 */
export class FragmentButtons {
  private list = document.querySelector<HTMLElement>('.fragment-list')!;
  private items = [...document.querySelectorAll<HTMLElement>('.fragment-btn')];
  private active = false;

  constructor(private glass: GlassModule, private panel: PanelController) {
    this.items.forEach((btn, i) => {
      const hover = (on: boolean) => this.glass.setHover(on ? i : -1);
      btn.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') hover(true); });
      btn.addEventListener('pointerleave', () => hover(false));
      btn.addEventListener('focus', () => hover(true));
      btn.addEventListener('blur', () => hover(false));
      btn.addEventListener('click', () => this.panel.open(i, btn));
    });
    // State is preserved: opened fragments keep a subtle glow; closing returns to the same frame.
    this.panel.onOpen = (i) => this.glass.markVisited(i);
    this.setActive(false);
  }

  private setActive(on: boolean): void {
    this.active = on;
    this.list.toggleAttribute('inert', !on);
    this.items.forEach((b) => (b.tabIndex = on ? 0 : -1));
  }

  update(p: number, engine: Engine): void {
    const on = p >= FRAGMENT_ACTIVE[0] && p <= FRAGMENT_ACTIVE[1] && this.glass.state.conv > 0.9;
    if (on !== this.active) this.setActive(on);
    if (p < 0.8 || p > 0.93) return;
    const { w, h } = engine.size;
    this.items.forEach((btn, i) => {
      const info = this.glass.project(i, engine.camera, w, h);
      const size = Math.max(88, info.r * 2.3);
      const li = btn.parentElement as HTMLElement;
      li.style.transform = `translate3d(${info.x.toFixed(1)}px, ${info.y.toFixed(1)}px, 0)`;
      btn.style.setProperty('--fw', `${size.toFixed(0)}px`);
      btn.style.setProperty('--fh', `${size.toFixed(0)}px`);
      li.style.display = info.visible ? '' : 'none';
    });
  }
}
