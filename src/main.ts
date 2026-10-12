import './style.css';
import { NAV_TARGETS } from './core/chapters';
import { Choreographer } from './core/choreographer';
import { Engine, detectWebGL } from './core/engine';
import { QualityManager, chooseTier, readDeviceInfo } from './core/quality';
import { ScrollController } from './core/scroll';
import { FragmentButtons } from './interaction/fragments';
import { PortfolioInput } from './interaction/portfolioInput';
import { AtmosphereModule } from './scenes/atmosphere';
import { GlassModule } from './scenes/glass';
import { HeroModule } from './scenes/hero';
import { LightingModule } from './scenes/lighting';
import { PlaneModule } from './scenes/plane';
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
  loader?.classList.add('is-done');
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
  html.style.setProperty('--journey', device.coarsePointer ? '1050vh' : '1250vh');

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
  [lighting, hero, portfolio, atmosphere, glass, plane].forEach((m) => choreo.add(m));
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

  // ---- per-frame hooks
  choreo.onFrame = (dt, p, now) => {
    overlays.update(p, engine.ctx.sky.cover);
    input.update(now);
    fragments.update(p, engine);
    hud?.update(dt, p);
  };

  // ---- progressive loading: critical opening scene first, everything else in the background
  engine.ctx.assets.onProgress((v) => {
    if (loaderFill) loaderFill.style.width = `${Math.round(v * 100)}%`;
  });
  await choreo.ensure('lighting');
  await choreo.ensure('hero');
  choreo.start();
  html.classList.add('gl-ready');
  if (loaderText) loaderText.textContent = 'Ready';
  window.setTimeout(() => loader?.classList.add('is-done'), 500);

  const idle = (fn: () => void): void => {
    const w = window as Window & { requestIdleCallback?: (f: () => void, o?: object) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 2500 });
    else window.setTimeout(fn, 800);
  };
  idle(async () => {
    await choreo.ensure('portfolio');
    idle(async () => {
      await choreo.ensure('atmosphere');
      await choreo.ensure('glass');
      await choreo.ensure('plane');
    });
  });

  window.addEventListener('pagehide', () => { choreo.dispose(); engine.dispose(); scroll.dispose(); input.dispose(); hud?.dispose(); });

  // Handy for debugging in the console; harmless in production.
  (window as unknown as { __aw?: unknown }).__aw = { engine, choreo, quality, scroll };
}

boot().catch((err) => {
  console.error(err);
  fallback('unexpected error');
});
