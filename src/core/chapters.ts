/**
 * Single source of truth for the journey. Every module, overlay and navigation helper reads
 * its timing from here, so the whole experience stays coherent when something is re-tuned.
 *
 * Progress `p` is normalised scroll position in [0, 1].
 */

export const CH = {
  hero: [0.0, 0.14],
  descend: [0.14, 0.23],
  work: [0.23, 0.56],
  clouds: [0.56, 0.68],
  shards: [0.68, 0.8],
  fragments: [0.8, 0.9],
  plane: [0.9, 1.0],
} as const;

/** Portfolio: project `i` is centred when progress equals snapPoint(i). */
export const PORTFOLIO = { count: 6, start: 0.265, end: 0.525 } as const;

export function snapPoints(count: number = PORTFOLIO.count): number[] {
  return Array.from({ length: count }, (_, i) => PORTFOLIO.start + ((PORTFOLIO.end - PORTFOLIO.start) * i) / Math.max(1, count - 1));
}

/** 0..1 across the portfolio (0 = first project centred, 1 = last). Clamped. */
export function portfolioU(p: number): number {
  return Math.min(1, Math.max(0, (p - PORTFOLIO.start) / (PORTFOLIO.end - PORTFOLIO.start)));
}

export function nearestProject(p: number, count: number = PORTFOLIO.count): number {
  const pts = snapPoints(count);
  let best = 0;
  for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i] - p) < Math.abs(pts[best] - p)) best = i;
  return best;
}

/** Anchor positions used by the navigation and by reduced-motion "cut" mode. */
export const NAV_TARGETS: Record<string, number> = {
  hero: 0,
  work: PORTFOLIO.start,
  process: 0.63,
  approach: 0.715,
  why: 0.715,
  studio: 0.885,
  services: 0.885,
  contact: 1,
};

/** Progress at which the camera passes through each process gate in the cloud sea. */
export const GATE_PROGRESS: readonly number[] = [0.595, 0.619, 0.643, 0.667];

export function nearestGate(p: number): number {
  let best = 0;
  for (let i = 1; i < GATE_PROGRESS.length; i++) if (Math.abs(GATE_PROGRESS[i] - p) < Math.abs(GATE_PROGRESS[best] - p)) best = i;
  return best;
}

/** Which of `count` reasons a message shows at progress `p` (thirds of its fully-visible window). */
export function reasonIndex(p: number, win: readonly [number, number, number, number], count = 3): number {
  const f = (p - win[0]) / Math.max(1e-6, win[3] - win[0]);
  return Math.min(count - 1, Math.max(0, Math.floor(f * count)));
}

/** Project types offered by the finale rings; values match the form's <option> text. */
export const DESTINATIONS = [
  { key: 'landing', label: 'Landing or personal site', type: 'Landing page' },
  { key: 'store', label: 'E-commerce store', type: 'E-commerce store' },
  { key: 'immersive', label: 'Immersive 3D site', type: 'Immersive 3D website' },
] as const;

/** Reduced-motion mode shows these stills instead of continuous camera travel. */
export const REDUCED_ANCHORS: number[] = [0, 0.14, ...snapPoints(), ...GATE_PROGRESS, 0.725, 0.785, 0.885, 0.99];

export function nearestAnchor(p: number, anchors: readonly number[] = REDUCED_ANCHORS): number {
  let best = anchors[0];
  for (const a of anchors) if (Math.abs(a - p) < Math.abs(best - p)) best = a;
  return best;
}

/** Overlay opacity windows: [fadeInStart, fullIn, fullOut, fadeOutEnd]. */
export const OVERLAY_WINDOWS: Record<string, [number, number, number, number]> = {
  hero: [-1, -0.5, 0.075, 0.125],
  work: [0.225, 0.26, 0.535, 0.565],
  dive: [0.13, 0.15, 0.2, 0.226],
  process: [0.563, 0.583, 0.668, 0.686],
  'message-a': [0.69, 0.705, 0.73, 0.742],
  'message-b': [0.748, 0.762, 0.79, 0.802],
  studio: [0.815, 0.835, 0.9, 0.92],
  contact: [0.965, 0.99, 2, 3],
};

/** Fragments can be activated once they have converged; this is the interactive window. */
export const FRAGMENT_ACTIVE: [number, number] = [0.845, 0.905];

/** Which modules need to be loaded/visible for a given progress, with margins. */
export const MODULE_RANGES = {
  hero: [0, 0.27],
  portfolio: [0.12, 0.62],
  atmosphere: [0.5, 1.0],
  fragments: [0.66, 0.93],
  plane: [0.86, 1.0],
  process: [0.5, 0.7],
  destinations: [0.93, 1.0],
} as const;
