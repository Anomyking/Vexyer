import './style.css';
import { DESTINATIONS, GATE_PROGRESS, NAV_TARGETS } from './core/chapters';
import { Choreographer } from './core/choreographer';
import { Engine, detectWebGL } from './core/engine';
import { QualityManager, chooseTier, readDeviceInfo } from './core/quality';
import { ScrollController } from './core/scroll';
import { CONTACT_EMAIL, buildMailto, validateBrief } from './core/contact';
import { LoopController } from './core/loop';
import { FragmentButtons } from './interaction/fragments';
import { PortfolioInput } from './interaction/portfolioInput';
import { AtmosphereModule } from './scenes/atmosphere';
import { GlassModule } from './scenes/glass';
import { HeroModule } from './scenes/hero';
import { LightingModule } from './scenes/lighting';
import { PlaneModule } from './scenes/plane';
import { GatesModule } from './scenes/gates';
import { DestinationsModule } from './scenes/destinations';
import { DestinationButtons } from './interaction/destinations';
import { PortfolioModule } from './scenes/portfolio';
import { Hud } from './ui/hud';
import { Overlays } from './ui/overlays';
import { PanelController } from './ui/panel';

const html = document.documentElement;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

// ---------------------------------------------------------------- always-on (works without WebGL)
const year = $('year');
if (year) year.textContent = String(new Date().getFullYear());
const panel = new PanelController();
const loader = $('loader');
const loaderFill = $('loader-fill');
const loaderText = $('loader-text');
const loaderPct = $('loader-pct');

/** Unveil the page: reveal content, wipe the loading screen away, then remove it from the DOM. */
let finished = false;
function finishLoading(): void {
  if (finished) return;
  finished = true;
  html.classList.remove('is-loading');
  loader?.classList.add('is-done');
  loader?.setAttribute('aria-busy', 'false');
  window.setTimeout(() => loader?.remove(), 1800);
}
function setProgress(frac: number, text?: string): void {
  const pct = Math.round(Math.min(1, Math.max(0, frac)) * 100);
  if (loaderFill) loaderFill.style.width = `${pct}%`;
  if (loaderPct) loaderPct.textContent = String(pct);
  if (text && loaderText) loaderText.textContent = text;
}
// Never trap anyone behind the loader.
window.setTimeout(finishLoading, 25000);

// ---- scroll reveals for the content below the journey (content stays visible if IntersectionObserver is missing)
const reveals = [...document.querySelectorAll<HTMLElement>('.reveal')];
if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  html.classList.add('js-reveal');
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  reveals.forEach((el) => io.observe(el));
}

// ---- project brief -> mailto
const form = $('brief-form') as HTMLFormElement | null;
const status = $('form-status');
form?.addEventListener('submit', (e) => {
  e.preventDefault();
  const v = (n: string) => (form.elements.namedItem(n) as HTMLInputElement | null)?.value ?? '';
  const fields = { name: v('name'), email: v('email'), type: v('type'), budget: v('budget'), message: v('message') };
  const errors = validateBrief(fields);
  form.querySelectorAll('.field').forEach((f) => f.classList.remove('has-error'));
  const first = Object.keys(errors)[0];
  if (first) {
    for (const k of Object.keys(errors)) (form.elements.namedItem(k) as HTMLElement | null)?.closest('.field')?.classList.add('has-error');
    if (status) { status.textContent = Object.values(errors)[0] ?? ''; status.classList.add('is-error'); }
    (form.elements.namedItem(first) as HTMLElement | null)?.focus();
    return;
  }
  status?.classList.remove('is-error');
  if (status) status.textContent = `Opening your email app… if nothing happens, write to ${CONTACT_EMAIL} directly.`;
  window.location.href = buildMailto(fields);
});
$('copy-email')?.addEventListener('click', async (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  try { await navigator.clipboard.writeText(CONTACT_EMAIL); btn.textContent = 'Copied ✓'; }
  catch { btn.textContent = CONTACT_EMAIL; }
  window.setTimeout(() => { btn.textContent = 'Copy address'; }, 2200);
});

$('loop-btn')?.addEventListener('click', () => {
  if (!html.classList.contains('gl-on')) window.scrollTo({ top: 0, behavior: 'smooth' });
});

// Static-mode fragment buttons are hidden by CSS; the panel remains usable via any trigger.
document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((a) => {
  a.addEventListener('click', (e) => {
    // In 3D mode the data-goto handler below takes over; here we only keep static anchors working.
    if (html.classList.contains('gl-on')) return;
    const id = a.getAttribute('href')!.slice(1);
    const el = id ? document.getElementById(id) : null;
    if (el) {
      e.preventDefault();
      el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
  });
});

function fallback(reason: string): void {
  html.classList.remove('gl-on');
  html.classList.add('no-gl');
  finishLoading();
  console.info(`[aetherworks] Using static layout: ${reason}`);
}

// ---------------------------------------------------------------------------- 3D bootstrap
async function boot(): Promise<void> {
  const gl = detectWebGL();
  if (!gl.ok) return fallback('WebGL unavailable');

  const canvas = $('gl') as HTMLCanvasElement | null;
  const spacer = $('scroll-space');
  if (!canvas || !spacer) return fallback('missing DOM');

  html.classList.remove('no-gl');
  html.classList.add('gl-on');

  const device = readDeviceInfo(gl.gpu);
  const quality = new QualityManager(chooseTier(device));
  const url = new URL(location.href);
  const forced = url.searchParams.get('quality');
  if (forced === 'high' || forced === 'medium' || forced === 'low') quality.setTier(forced, 'url');

  // Longer journey on desktop; slightly shorter on touch so fingers don't travel forever.
  html.style.setProperty('--journey', device.coarsePointer ? '880vh' : '1000vh');

  // ---- reduced motion (system setting + manual toggle, persisted)
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  let stored: string | null = null;
  try { stored = localStorage.getItem('aw-reduced-motion'); } catch { /* storage blocked */ }
  let reduced = stored === null ? mq.matches : stored === '1';

  let engine: Engine;
  try {
    engine = new Engine(canvas, quality, () => reduced);
  } catch (err) {
    console.warn(err);
    return fallback('renderer failed to initialise');
  }

  const scroll = new ScrollController(spacer);
  scroll.reduced = reduced;
  quality.setReducedMotion(reduced);
  scroll.init();

  const choreo = new Choreographer(engine, scroll, quality);
  const lighting = new LightingModule();
  const hero = new HeroModule();
  const portfolio = new PortfolioModule();
  const atmosphere = new AtmosphereModule();
  const glass = new GlassModule();
  const plane = new PlaneModule();
  const gates = new GatesModule();
  const destinations = new DestinationsModule();
  [lighting, hero, portfolio, atmosphere, gates, glass, plane, destinations].forEach((m) => choreo.add(m));
  choreo.plane = plane;
  engine.onResize = () => { portfolio.onResize(engine.ctx); choreo.scheduleRebuild(); };

  const overlays = new Overlays();
  const input = new PortfolioInput(scroll);
  const fragments = new FragmentButtons(glass, panel);
  panel.attachScroll(scroll);
  const hud = url.searchParams.has('debug') ? new Hud(engine, quality) : null;
  overlays.update(0, 0);

  const toggle = $('motion-toggle') as HTMLButtonElement | null;
  const applyReduced = (on: boolean, persist: boolean) => {
    reduced = on;
    html.classList.toggle('reduced-motion', on);
    scroll.setReduced(on);
    quality.setReducedMotion(on);
    choreo.applyQuality(quality.settings);
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(on));
      const vis = toggle.querySelector('[aria-hidden]');
      if (vis) vis.textContent = on ? 'Motion: reduced' : 'Motion: on';
    }
    if (persist) { try { localStorage.setItem('aw-reduced-motion', on ? '1' : '0'); } catch { /* ignore */ } }
  };
  applyReduced(reduced, false);
  toggle?.addEventListener('click', () => applyReduced(!reduced, true));
  mq.addEventListener?.('change', (e) => { if (stored === null) applyReduced(e.matches, false); });

  // ---- navigation: cinematic travel to a chapter (instant in reduced motion)
  document.querySelectorAll<HTMLAnchorElement>('[data-goto]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const key = a.dataset.goto ?? 'hero';
      const target = NAV_TARGETS[key] ?? 0;
      input.snap.suppress(performance.now() + 2600);
      scroll.scrollToProgress(target, { duration: 2.2, ease: 'power3.inOut' });
      history.replaceState(null, '', `#${key}`);
    });
  });

  // ---- content below the journey: smooth travel, nav highlight, and the infinite loop
  const afterSections = [...document.querySelectorAll<HTMLElement>('#after [id]')].filter((el) => el.hasAttribute('data-after'));
  document.querySelectorAll<HTMLElement>('[data-scrollto]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const el = document.getElementById(a.dataset.scrollto ?? '');
      if (!el) return;
      e.preventDefault();
      input.snap.suppress(performance.now() + 3600);
      const y = el.getBoundingClientRect().top + window.scrollY - 8;
      const dist = Math.abs(y - window.scrollY) / window.innerHeight;
      scroll.scrollToY(y, { duration: Math.min(3.2, 0.9 + dist * 0.12), ease: 'power3.inOut' });
      history.replaceState(null, '', `#${el.id}`);
    });
  });
  const loop = new LoopController(
    { jumpToTop: () => { input.snap.suppress(performance.now() + 1200); scroll.jumpToTop(); }, blocked: () => panel.isOpen || scroll.locked },
    () => reduced,
  );
  $('loop-btn')?.addEventListener('click', () => void loop.loop());
  const journeyEnd = () => scroll.maxScroll();
  const updateAfter = () => {
    const y = window.scrollY;
    choreo.occluded = y > journeyEnd() + window.innerHeight * 1.05;
    document.querySelector('.site-header')?.classList.toggle('is-solid', y > journeyEnd() + window.innerHeight * 0.5);
    let cur = '';
    if (y > journeyEnd() + window.innerHeight * 0.3) {
      for (const el of afterSections) if (el.getBoundingClientRect().top < window.innerHeight * 0.45) cur = el.id;
    }
    overlays.after = cur === 'why' ? 'services' : cur;
  };
  window.addEventListener('scroll', updateAfter, { passive: true });
  window.addEventListener('resize', updateAfter);
  updateAfter();

  // ---- process steps (fly to a gate), reasons (pin), destinations (prefill the form)
  const goToElement = (el: HTMLElement) => {
    input.snap.suppress(performance.now() + 3600);
    const y = el.getBoundingClientRect().top + window.scrollY - 8;
    const dist = Math.abs(y - window.scrollY) / window.innerHeight;
    scroll.scrollToY(y, { duration: Math.min(3.2, 0.9 + dist * 0.12), ease: 'power3.inOut' });
  };
  document.querySelectorAll<HTMLElement>('[data-step-goto]').forEach((b) => {
    b.addEventListener('click', () => {
      input.snap.suppress(performance.now() + 2200);
      scroll.scrollToProgress(GATE_PROGRESS[Number(b.dataset.stepGoto)] ?? GATE_PROGRESS[0], { duration: 1.6, ease: 'power3.inOut' });
    });
  });
  document.querySelectorAll<HTMLElement>('[data-message] .dot').forEach((d) => {
    d.addEventListener('click', () => {
      const key = (d.closest('[data-message]') as HTMLElement).dataset.message as 'a' | 'b';
      overlays.pinReason(key, Number(d.dataset.dot));
    });
  });
  const destButtons = new DestinationButtons(destinations, (i) => {
    const select = $('f-type') as HTMLSelectElement | null;
    if (select) select.value = DESTINATIONS[i].type;
    const formSection = $('contact-form');
    if (formSection) goToElement(formSection);
    if (status) status.textContent = `Project type set to “${DESTINATIONS[i].type}”.`;
    window.setTimeout(() => ($('f-message') as HTMLElement | null)?.focus({ preventScroll: true }), 2600);
  });

  // ---- per-frame hooks
  choreo.onFrame = (dt, p, now) => {
    overlays.update(p, engine.ctx.sky.cover);
    input.update(now);
    fragments.update(p, engine);
    gates.place(engine.camera, p, engine.ctx.time);
    destinations.place(engine.camera, p, engine.ctx.time, dt);
    destButtons.update(p, engine);
    hud?.update(dt, p);
  };

  // ---- load everything behind the loading screen, then unveil. Order: critical opening scene first so it
  // is already rendering when the screen lifts, then the rest in parallel.
  const t0 = performance.now();
  const modules = ['lighting', 'hero', 'portfolio', 'atmosphere', 'process', 'glass', 'plane', 'destinations'];
  let done = 0;
  const step = (label: string) => { done++; setProgress(done / (modules.length + 1), label); };
  await choreo.ensure('lighting'); step('Lighting the scene…');
  await choreo.ensure('hero'); step('Building the opening…');
  choreo.start();
  await Promise.all([
    choreo.ensure('portfolio').then(() => step('Assembling the work…')),
    choreo.ensure('atmosphere').then(() => step('Gathering clouds…')),
    choreo.ensure('process').then(() => step('Opening the gates…')),
    choreo.ensure('glass').then(() => step('Cutting the crystals…')),
    choreo.ensure('plane').then(() => step('Folding the paper plane…')),
    choreo.ensure('destinations').then(() => step('Setting the destinations…')),
  ]);
  // Fonts and the page itself (stylesheets, images) too, so nothing pops in after the reveal.
  setProgress(modules.length / (modules.length + 1), 'Almost there…');
  await Promise.all([
    document.fonts?.ready ?? Promise.resolve(),
    document.readyState === 'complete' ? Promise.resolve() : new Promise<void>((r) => window.addEventListener('load', () => r(), { once: true })),
  ]);
  // Let two frames render with the final state, and never flash the loader for less than a moment.
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  await new Promise<void>((r) => window.setTimeout(r, Math.max(0, 800 - (performance.now() - t0))));
  setProgress(1, 'Ready');
  html.classList.add('gl-ready');
  await new Promise<void>((r) => window.setTimeout(r, 350));
  finishLoading();

  window.addEventListener('pagehide', () => { choreo.dispose(); engine.dispose(); scroll.dispose(); input.dispose(); hud?.dispose(); loop.dispose(); });

  // Handy for debugging in the console; harmless in production.
  (window as unknown as { __aw?: unknown }).__aw = { engine, choreo, quality, scroll };
}

boot().catch((err) => {
  console.error(err);
  fallback('unexpected error');
});
