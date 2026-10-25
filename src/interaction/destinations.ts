import type { Engine } from '../core/engine';
import type { DestinationsModule } from '../scenes/destinations';

/**
 * Same pattern as the glass fragments: the rings are 3D, the interactive elements are real <button>s placed
 * over their projected position every frame (tap targets, keyboard focus, screen-reader names, static fallback).
 */
export class DestinationButtons {
  private list = document.querySelector<HTMLElement>('.dest-list');
  private items = [...document.querySelectorAll<HTMLElement>('.dest-btn')];
  private active = false;

  constructor(private mod: DestinationsModule, private onPick: (index: number) => void) {
    this.items.forEach((btn, i) => {
      btn.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') this.mod.setHover(i); });
      btn.addEventListener('pointerleave', () => this.mod.setHover(-1));
      btn.addEventListener('focus', () => this.mod.setHover(i));
      btn.addEventListener('blur', () => this.mod.setHover(-1));
      btn.addEventListener('click', () => this.onPick(i));
    });
    this.setActive(false);
  }

  private setActive(on: boolean): void {
    this.active = on;
    this.list?.toggleAttribute('inert', !on);
    this.items.forEach((b) => (b.tabIndex = on ? 0 : -1));
  }

  update(p: number, engine: Engine): void {
    const on = p >= 0.982;
    if (on !== this.active) this.setActive(on);
    if (p < 0.94) return;
    const { w, h } = engine.size;
    this.items.forEach((btn, i) => {
      const info = this.mod.project(i, engine.camera, w, h);
      const size = Math.max(84, info.r * 2.2);
      const li = btn.parentElement as HTMLElement;
      li.style.transform = `translate3d(${info.x.toFixed(1)}px, ${info.y.toFixed(1)}px, 0)`;
      btn.style.setProperty('--dw', `${size.toFixed(0)}px`);
      li.style.display = info.visible ? '' : 'none';
    });
  }
}
