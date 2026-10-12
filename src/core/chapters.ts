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
  approach: 0.7,
  studio: 0.885,
  contact: 1,
};

/** Reduced-motion mode shows these stills instead of continuous camera travel. */
export const REDUCED_ANCHORS: number[] = [0, 0.14, ...snapPoints(), 0.62, 0.725, 0.785, 0.885, 0.99];

export function nearestAnchor(p: number, anchors: readonly number[] = REDUCED_ANCHORS): number {
  let best = anchors[0];
  for (const a of anchors) if (Math.abs(a - p) < Math.abs(best - p)) best = a;
  return best;
}

/** Overlay opacity windows: [fadeInStart, fullIn, fullOut, fadeOutEnd]. */
export const OVERLAY_WINDOWS: Record<string, [number, number, number, number]> = {
  hero: [-1, -0.5, 0.075, 0.125],
  work: [0.225, 0.26, 0.535, 0.565],
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
} as const;
