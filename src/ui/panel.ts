import type { ScrollController } from '../core/scroll';

/**
 * Accessible modal for the glass fragments: role=dialog, aria-modal, labelled, focus trap, Esc and
 * backdrop to close, focus returns to the opener, and the page scroll position is frozen while open
 * so closing returns the user to exactly the same scene state.
 */
export class PanelController {
  private root = document.getElementById('panel') as HTMLElement;
  private card = this.root.querySelector<HTMLElement>('.panel-card')!;
  private body = document.getElementById('panel-body')!;
  private closeBtn = document.getElementById('panel-close') as HTMLButtonElement;
  private opener: HTMLElement | null = null;
  private openIndex = -1;
  private scroll: ScrollController | null = null;
  onOpen: ((index: number) => void) | null = null;
  onClose: ((index: number) => void) | null = null;

  constructor() {
    this.closeBtn.addEventListener('click', () => this.close());
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
    this.root.addEventListener('keydown', (e) => this.onKey(e));
  }

  attachScroll(s: ScrollController): void {
    this.scroll = s;
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(index: number, opener: HTMLElement | null): void {
    const src = document.querySelector<HTMLElement>(`[data-fragment-copy="${index}"]`);
    if (!src) return;
    this.opener = opener;
    this.openIndex = index;
    // Clone so the original copy stays in the DOM (SEO, no-JS, no-WebGL).
    this.body.replaceChildren(...[...src.childNodes].map((n) => n.cloneNode(true)));
    const title = this.body.querySelector('h3');
    if (title) title.id = 'panel-title';
    this.root.hidden = false;
    this.scroll?.lock();
    requestAnimationFrame(() => {
      this.root.classList.add('is-open');
      this.closeBtn.focus({ preventScroll: true });
    });
    this.onOpen?.(index);
  }

  close(): void {
    if (!this.isOpen) return;
    this.root.classList.remove('is-open');
    const idx = this.openIndex;
    const finish = () => {
      this.root.hidden = true;
      this.scroll?.unlock();
      this.opener?.focus({ preventScroll: true });
      this.opener = null;
      this.openIndex = -1;
      this.onClose?.(idx);
    };
    // Match the CSS transition, but never get stuck if transitions are disabled.
    window.setTimeout(finish, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220);
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.stopPropagation();
      this.close();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusables = [...this.card.querySelectorAll<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])')].filter((el) => !el.hasAttribute('disabled'));
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}
