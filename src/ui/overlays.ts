import { NAV_TARGETS, OVERLAY_WINDOWS, PORTFOLIO, nearestProject } from '../core/chapters';
import { window4 } from '../core/math';

/**
 * Drives the semantic HTML overlays from progress. All content stays real DOM (readable,
 * indexable, focusable); this class only toggles opacity/visibility classes and CSS variables.
 */
export class Overlays {
  private chapters = new Map<string, HTMLElement>();
  private messages = new Map<string, HTMLElement>();
  private projects: HTMLElement[];
  private index = document.getElementById('work-index');
  private total = document.getElementById('work-total');
  private fill = document.getElementById('progress-fill');
  private cover = document.getElementById('cover');
  private navLinks = [...document.querySelectorAll<HTMLAnchorElement>('.site-header nav a[data-goto]')];
  private lastCurrent = -1;
  private lastNav = '';

  constructor() {
    document.querySelectorAll<HTMLElement>('[data-chapter]').forEach((el) => this.chapters.set(el.dataset.chapter!, el));
    document.querySelectorAll<HTMLElement>('[data-message]').forEach((el) => this.messages.set(el.dataset.message!, el));
    this.projects = [...document.querySelectorAll<HTMLElement>('[data-project]')];
    if (this.total) this.total.textContent = String(this.projects.length || PORTFOLIO.count);
  }

  private set(el: HTMLElement, o: number): void {
    el.style.setProperty('--o', o.toFixed(3));
    el.classList.toggle('is-visible', o > 0.01);
    el.classList.toggle('is-active', o > 0.55);
  }

  update(p: number, cover: number): void {
    const w = (k: string) => {
      const [a, b, c, d] = OVERLAY_WINDOWS[k];
      return window4(p, a, b, c, d);
    };

    this.set(this.chapters.get('hero')!, w('hero'));
    this.set(this.chapters.get('work')!, w('work'));
    this.set(this.chapters.get('studio')!, w('studio'));
    this.set(this.chapters.get('contact')!, w('contact'));

    const a = w('message-a');
    const b = w('message-b');
    const approach = this.chapters.get('approach');
    if (approach) {
      // The chapter wrapper stays fully opaque; each message fades on its own window.
      this.set(approach, Math.max(a, b) > 0.01 ? 1 : 0);
    }
    const ma = this.messages.get('a');
    const mb = this.messages.get('b');
    if (ma) this.set(ma, a);
    if (mb) this.set(mb, b);

    // Portfolio text follows the project nearest to the viewer.
    const current = nearestProject(p, this.projects.length || PORTFOLIO.count);
    if (current !== this.lastCurrent) {
      this.lastCurrent = current;
      this.projects.forEach((el, i) => {
        el.classList.toggle('is-current', i === current);
        if (i === current) el.setAttribute('aria-current', 'true');
        else el.removeAttribute('aria-current');
      });
      if (this.index) this.index.textContent = String(current + 1);
    }

    // Navigation highlight
    const key = p < 0.2 ? 'hero' : p < 0.6 ? 'work' : p < 0.8 ? 'approach' : p < 0.95 ? 'studio' : 'contact';
    if (key !== this.lastNav) {
      this.lastNav = key;
      for (const l of this.navLinks) {
        if (l.dataset.goto === key) l.setAttribute('aria-current', 'true');
        else l.removeAttribute('aria-current');
      }
    }

    if (this.fill) this.fill.style.transform = `scaleY(${p.toFixed(4)})`;
    if (this.cover) this.cover.style.opacity = cover.toFixed(3);
  }

  static navTargets = NAV_TARGETS;
}
