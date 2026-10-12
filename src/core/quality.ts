/**
 * Adaptive quality: a static tier chosen from device capability, then a runtime governor that
 * steps down (and carefully back up) based on *measured* frame time.
 */

export type Tier = 'high' | 'medium' | 'low';

export interface QualitySettings {
  tier: Tier;
  /** Upper bound for renderer pixel ratio. */
  pixelRatioCap: number;
  /** Instances of the portfolio ring. */
  ringSegments: number;
  /** Cloud bank instances (sky layer + flight corridor). */
  cloudBanks: number;
  /** Speed-streak line count. */
  streaks: number;
  /** Stars in the opening scene. */
  stars: number;
  /** Small glass debris pieces. */
  debris: number;
  shadows: boolean;
  shadowMapSize: number;
  /** Use simplified single-sample glass shader. */
  simpleGlass: boolean;
  /** Radial-blur / vignette post pass. */
  postFX: boolean;
  /** Use *_lo meshes from the GLBs. */
  lowPolyMeshes: boolean;
  antialias: boolean;
  /** Texture size for generated project previews. */
  previewSize: number;
}

export const TIERS: Record<Tier, QualitySettings> = {
  high: { tier: 'high', pixelRatioCap: 2, ringSegments: 72, cloudBanks: 22, streaks: 700, stars: 2600, debris: 36, shadows: true, shadowMapSize: 1024, simpleGlass: false, postFX: true, lowPolyMeshes: false, antialias: true, previewSize: 1024 },
  medium: { tier: 'medium', pixelRatioCap: 1.5, ringSegments: 56, cloudBanks: 14, streaks: 380, stars: 1200, debris: 20, shadows: false, shadowMapSize: 512, simpleGlass: false, postFX: true, lowPolyMeshes: false, antialias: true, previewSize: 512 },
  low: { tier: 'low', pixelRatioCap: 1, ringSegments: 36, cloudBanks: 8, streaks: 160, stars: 450, debris: 8, shadows: false, shadowMapSize: 256, simpleGlass: true, postFX: false, lowPolyMeshes: true, antialias: false, previewSize: 256 },
};

const ORDER: Tier[] = ['high', 'medium', 'low'];

export interface DeviceInfo {
  coarsePointer: boolean;
  memoryGB: number;
  cores: number;
  gpu: string;
  saveData: boolean;
  reducedMotion: boolean;
}

const WEAK_GPU = /(mali-4|mali-t[0-7]|adreno \(tm\) [1-4]\d\d|adreno 3|powervr|swiftshader|llvmpipe|software|intel\(r\) hd graphics [1-4]\d{3}\b)/i;

/** Pure function so it can be unit-tested. */
export function chooseTier(d: DeviceInfo): Tier {
  if (d.saveData || WEAK_GPU.test(d.gpu)) return 'low';
  if (d.coarsePointer) {
    if (d.memoryGB <= 3 || d.cores <= 4) return 'low';
    return 'medium';
  }
  if (d.cores >= 8 && d.memoryGB >= 8) return 'high';
  if (d.cores <= 2 || d.memoryGB <= 2) return 'low';
  return 'medium';
}

export function readDeviceInfo(gpu = ''): DeviceInfo {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return {
    coarsePointer: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
    memoryGB: nav.deviceMemory ?? 4,
    cores: nav.hardwareConcurrency ?? 4,
    gpu,
    saveData: !!nav.connection?.saveData,
    reducedMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
}

export type QualityListener = (q: QualitySettings, reason: string) => void;

/**
 * Runtime governor. Feed it frame times; it decides if the tier should change.
 * Hysteresis: two consecutive slow windows to step down, ten fast seconds to step up, and never
 * above a ceiling that is lowered every time a step-down happens (prevents oscillation).
 */
export class QualityManager {
  settings: QualitySettings;
  private ceiling: number;
  private listeners = new Set<QualityListener>();
  private acc = 0;
  private frames = 0;
  private slowWindows = 0;
  private fastWindows = 0;
  private warmup = 2.5; // seconds to ignore (shader compile, first uploads)
  private cooldown = 0;
  /** Last measured average frame time in ms (for the HUD). */
  avgMs = 16.7;
  /** Optional pixel-ratio multiplier applied on top of the tier (0.5..1) for fine-grained relief. */
  scale = 1;

  private reduced = false;

  constructor(initial: Tier) {
    this.settings = { ...TIERS[initial] };
    this.ceiling = ORDER.indexOf(initial);
  }

  private compute(t: Tier): QualitySettings {
    return this.reduced ? QualityManager.applyReducedMotion({ ...TIERS[t] }) : { ...TIERS[t] };
  }

  /** Reduced motion trims particle/post load on top of whatever tier is active. */
  setReducedMotion(on: boolean): void {
    if (on === this.reduced) return;
    this.reduced = on;
    this.settings = this.compute(this.settings.tier);
    this.listeners.forEach((l) => l(this.settings, 'reduced-motion'));
  }

  get tier(): Tier {
    return this.settings.tier;
  }

  onChange(fn: QualityListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setTier(t: Tier, reason: string): void {
    if (t === this.settings.tier) return;
    this.settings = this.compute(t);
    this.scale = 1;
    this.listeners.forEach((l) => l(this.settings, reason));
  }

  /** Target frame time for the current tier: lower tiers aim for 30 fps. */
  get targetMs(): number {
    return this.settings.tier === 'low' ? 33.3 : 16.7;
  }

  /** Call every frame with dt in seconds. */
  sample(dt: number): void {
    if (dt <= 0 || dt > 0.25) return; // ignore tab switches / hitches
    if (this.warmup > 0) {
      this.warmup -= dt;
      return;
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.acc += dt;
    this.frames++;
    if (this.acc < 1) return;

    const avg = (this.acc / this.frames) * 1000;
    this.avgMs = avg;
    this.acc = 0;
    this.frames = 0;
    this.evaluate(avg);
  }

  /** Exposed for tests. */
  evaluate(avgMs: number): void {
    const target = this.targetMs;
    if (avgMs > target * 1.4) {
      this.slowWindows++;
      this.fastWindows = 0;
      if (this.slowWindows >= 2 && this.cooldown === 0) {
        this.slowWindows = 0;
        this.stepDown();
      }
    } else if (avgMs < target * 0.7) {
      this.fastWindows++;
      this.slowWindows = 0;
      if (this.fastWindows >= 10 && this.cooldown === 0) {
        this.fastWindows = 0;
        this.stepUp();
      }
    } else {
      this.slowWindows = 0;
      this.fastWindows = 0;
    }
  }

  private stepDown(): void {
    this.cooldown = 4;
    if (this.scale > 0.75) {
      // First, cheap relief: render at lower resolution before changing visual content.
      this.scale = Math.max(0.7, this.scale - 0.15);
      this.listeners.forEach((l) => l(this.settings, 'resolution'));
      return;
    }
    const i = ORDER.indexOf(this.settings.tier);
    if (i < ORDER.length - 1) {
      this.ceiling = Math.max(this.ceiling, i + 1); // never climb back above where we failed
      this.setTier(ORDER[i + 1], 'perf');
    }
  }

  private stepUp(): void {
    this.cooldown = 12;
    if (this.scale < 1) {
      this.scale = Math.min(1, this.scale + 0.15);
      this.listeners.forEach((l) => l(this.settings, 'resolution'));
      return;
    }
    const i = ORDER.indexOf(this.settings.tier);
    // Only recover to tiers at or above the ceiling we have proven acceptable.
    if (i > 0 && i - 1 >= this.ceiling) this.setTier(ORDER[i - 1], 'headroom');
  }

  /** Reduced motion lowers particle load regardless of tier. */
  static applyReducedMotion(q: QualitySettings): QualitySettings {
    return { ...q, streaks: 0, debris: Math.min(q.debris, 6), postFX: false, stars: Math.min(q.stars, 400) };
  }
}
