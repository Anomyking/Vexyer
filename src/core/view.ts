import { clamp } from './math';

/** Vertical FOV actually used: widened on portrait screens so the composition keeps its width. */
export function effectiveFov(baseDeg: number, aspect: number): number {
  return aspect >= 1 ? baseDeg : clamp(baseDeg * Math.pow(1 / aspect, 0.55), baseDeg, 80);
}
