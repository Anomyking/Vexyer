import type * as THREE from 'three';
import type { AssetLoader } from '../assets/loader';
import type { QualitySettings } from './quality';

/** Tweened camera description. GSAP animates these numbers; the engine applies them each frame. */
export interface CameraProxy {
  px: number; py: number; pz: number;
  lx: number; ly: number; lz: number;
  fov: number;
  /** 0 = scripted camera, 1 = trailing chase camera behind the paper plane. */
  follow: number;
}

/** Global atmosphere state, tweened by the master timeline. */
export interface SkyProxy {
  /** 1 = deep space/night, 0 = daylight sky. */
  space: number;
  /** 0..1 warm horizon for the final flight. */
  dusk: number;
  /** Streak / blur intensity for the speed section. */
  speed: number;
  /** White "paper" cover used to hide the camera hand-over. */
  cover: number;
}

export interface Layout {
  aspect: number;
  portrait: boolean;
  /** Camera distance used while viewing the portfolio ring. */
  workDistance: number;
  /** Scale applied to the floating project screens. */
  screenScale: number;
}

export interface SceneContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  assets: AssetLoader;
  cam: CameraProxy;
  sky: SkyProxy;
  layout: Layout;
  quality: () => QualitySettings;
  reducedMotion: () => boolean;
  /** Shared PMREM environment for reflective materials. */
  env: THREE.Texture | null;
  /** Seconds since start (wall clock, only for subtle idle shimmer). */
  time: number;
}

/** Every chapter implements this; the choreographer is the only thing that calls it. */
export interface SceneModule {
  readonly id: string;
  readonly group: THREE.Group;
  /** Progress window in which this module must be loaded and rendered. */
  readonly range: readonly [number, number];
  /** Pack names to load (progressively). */
  load(ctx: SceneContext): Promise<void>;
  /** Add this module's tweens to the master timeline (time domain == progress, 0..1). */
  build(tl: gsap.core.Timeline, ctx: SceneContext): void;
  /** Per-frame work that is a pure function of (progress, dt) - springs, shimmer, instancing. */
  update(dt: number, p: number, ctx: SceneContext): void;
  setQuality(q: QualitySettings, ctx: SceneContext): void;
  dispose(): void;
}

export type Timeline = gsap.core.Timeline;
