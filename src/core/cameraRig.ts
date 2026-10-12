import { PORTFOLIO } from './chapters';
import type { SceneContext, Timeline } from './context';
import { RING_X_END, RING_X_START } from '../scenes/portfolio';
import { PLANE_SWAP } from '../scenes/plane';

type V3 = [number, number, number];
interface Key { t: number; p: V3; l: V3; fov: number; ease?: string }

/**
 * The camera choreography + atmosphere as keyframes on the master timeline. Everything here is a
 * `fromTo` with `immediateRender: true`, so any scrub position (forward, reverse, jump) yields
 * exactly the same state: the timeline is the single source of truth.
 */
export function buildCameraRig(tl: Timeline, ctx: SceneContext): void {
  const { cam, sky } = ctx;
  const wd = ctx.layout.workDistance;
  const { start, end } = PORTFOLIO;

  const keys: Key[] = [
    { t: 0.0, p: [0, 150, 14], l: [0, 115, 0], fov: 38 },
    { t: 0.14, p: [0, 132, 8], l: [0, 112, 0], fov: 38, ease: 'power2.inOut' },
    { t: 0.185, p: [0, 111, 5], l: [0, 100, 0], fov: 40, ease: 'power2.in' }, // through the opening
    { t: 0.23, p: [RING_X_START, 99.4, wd], l: [RING_X_START, 98.4, 0], fov: 40, ease: 'power3.out' },
    { t: start, p: [RING_X_START, 99.4, wd], l: [RING_X_START, 98.4, 0], fov: 40, ease: 'none' },
    { t: end, p: [RING_X_END, 99.4, wd], l: [RING_X_END, 98.4, 0], fov: 40, ease: 'none' }, // follows the ring's translation
    { t: 0.56, p: [RING_X_END, 99.4, wd], l: [RING_X_END, 98.4, 0], fov: 40, ease: 'none' },
    { t: 0.6, p: [0, 88, 24], l: [0, 82, -8], fov: 42, ease: 'power2.inOut' }, // into the cloud sea
    { t: 0.68, p: [0, 62, 16], l: [0, 60, -30], fov: 42, ease: 'power2.inOut' }, // out into open sky
    { t: 0.74, p: [0, 57, 6], l: [0, 55, -40], fov: 42, ease: 'power1.inOut' },
    { t: 0.8, p: [0, 50, 2], l: [0, 49, -40], fov: 42, ease: 'power1.inOut' },
    { t: 0.865, p: [0, 47, 2], l: [0, 48, -40], fov: 42, ease: 'power1.inOut' },
    { t: 0.9475, p: [0, 46, 2], l: [0, 46.5, -40], fov: 42, ease: 'power1.inOut' },
  ];

  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    const dur = b.t - a.t;
    if (dur <= 0) continue;
    tl.fromTo(
      cam,
      { px: a.p[0], py: a.p[1], pz: a.p[2], lx: a.l[0], ly: a.l[1], lz: a.l[2], fov: a.fov },
      { px: b.p[0], py: b.p[1], pz: b.p[2], lx: b.l[0], ly: b.l[1], lz: b.l[2], fov: b.fov, duration: dur, ease: b.ease ?? 'power1.inOut', immediateRender: true },
      a.t,
    );
  }

  // Atmosphere: space -> daylight while diving through the clouds; dusk for the final flight.
  const o = { immediateRender: true } as const;
  tl.fromTo(sky, { space: 1 }, { space: 0, duration: 0.09, ease: 'power1.inOut', ...o }, 0.55);
  tl.fromTo(sky, { dusk: 0 }, { dusk: 0.8, duration: 0.1, ease: 'power1.inOut', ...o }, 0.9);

  // Chase camera hand-over, hidden behind the paper cover.
  tl.fromTo(cam, { follow: 0 }, { follow: 1, duration: 0.002, ease: 'none', ...o }, PLANE_SWAP);
  tl.fromTo(cam, { fov: 42 }, { fov: 58, duration: 0.03, ease: 'power2.out', ...o }, PLANE_SWAP + 0.002);
  tl.fromTo(sky, { speed: 0 }, { speed: 1, duration: 0.025, ease: 'power2.out', ...o }, 0.952);

  // Paper cover: a white wipe that peaks exactly when the camera swaps.
  tl.fromTo(sky, { cover: 0 }, { cover: 1, duration: 0.019, ease: 'power2.in', ...o }, 0.926);
  tl.fromTo(sky, { cover: 1 }, { cover: 0, duration: 0.024, ease: 'power2.out', ...o }, 0.953);

  // Pad so the timeline is exactly one unit long: time == progress.
  tl.set({}, {}, 1);
}
