import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { AssetLoader } from '../assets/loader';
import { PostFX } from '../effects/postfx';
import { SkyDome } from '../effects/skydome';
import type { CameraProxy, Layout, SceneContext, SkyProxy } from './context';
import { QualityManager } from './quality';
import { clamp, effectiveFov } from './math';
import type { TrailPose } from '../scenes/plane';

const SCREEN_RADIUS = 15.5;

export function detectWebGL(): { ok: boolean; gpu: string } {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return { ok: false, gpu: '' };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { ok: true, gpu };
  } catch {
    return { ok: false, gpu: '' };
  }
}

/** Owns the renderer, camera, size/pixel-ratio management and context-loss recovery. */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.5, 900);
  readonly ctx: SceneContext;
  readonly post: PostFX;
  readonly skyDome = new SkyDome();
  contextLost = false;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private lastFov = -1;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private ro: ResizeObserver;
  onResize: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement, private quality: QualityManager, reducedMotion: () => boolean) {
    const q = quality.settings;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: q.antialias,
      alpha: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(0x04060c, 1);

    this.scene.add(this.skyDome.mesh);
    this.post = new PostFX(this.renderer);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
    pmrem.dispose();

    const cam: CameraProxy = { px: 0, py: 150, pz: 14, lx: 0, ly: 115, lz: 0, fov: 38, follow: 0 };
    const sky: SkyProxy = { space: 1, dusk: 0, speed: 0, cover: 0 };
    const layout: Layout = { aspect: 1, portrait: false, workDistance: 30, screenScale: 1.35 };

    this.ctx = {
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      assets: new AssetLoader(this.renderer),
      cam,
      sky,
      layout,
      quality: () => this.quality.settings,
      reducedMotion,
      env: this.envTarget.texture,
      time: 0,
    };

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      document.documentElement.classList.add('gl-lost');
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      document.documentElement.classList.remove('gl-lost');
      this.resize(true);
    });

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(document.documentElement);
    this.resize(true);
    quality.onChange(() => this.resize(true));
  }

  /** Effective vertical FOV: widen on portrait screens so the composition keeps its width. */
  private effectiveFov(base: number): number {
    return effectiveFov(base, this.width / this.height);
  }

  resize(force = false): void {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const q = this.quality.settings;
    const pr = Math.min(window.devicePixelRatio || 1, q.pixelRatioCap) * this.quality.scale;
    if (!force && w === this.width && h === this.height && Math.abs(pr - this.pixelRatio) < 0.01) return;
    this.width = w;
    this.height = h;
    this.pixelRatio = pr;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.lastFov = -1;
    this.post.enabled = q.postFX;
    if (q.postFX) this.post.setSize(w, h, pr);
    else this.post.release();

    const L = this.ctx.layout;
    const wasPortrait = L.portrait;
    const prevAspect = L.aspect;
    L.aspect = w / h;
    L.portrait = L.aspect < 0.95;
    L.screenScale = L.portrait ? 1.05 : 1.35;
    const fov = this.effectiveFov(40);
    const vwPerUnit = 2 * Math.tan((fov * Math.PI) / 360) * L.aspect;
    const frac = L.portrait ? 0.82 : 0.46;
    L.workDistance = clamp(SCREEN_RADIUS + (6.4 * L.screenScale) / (frac * vwPerUnit), 24, 64);
    // The hero slabs are sized from the aspect, so any real change in screen shape rebuilds the timeline.
    if (wasPortrait !== L.portrait || force || Math.abs(L.aspect - prevAspect) > 0.02) this.onResize?.();
  }

  /** Apply the tweened camera proxy (optionally blended toward the chase pose) to the camera. */
  applyCamera(trail: TrailPose | null): void {
    const c = this.ctx.cam;
    const cam = this.camera;
    let px = c.px, py = c.py, pz = c.pz, lx = c.lx, ly = c.ly, lz = c.lz;
    if (trail && c.follow > 0) {
      const f = c.follow;
      px += (trail.position.x - px) * f; py += (trail.position.y - py) * f; pz += (trail.position.z - pz) * f;
      lx += (trail.look.x - lx) * f; ly += (trail.look.y - ly) * f; lz += (trail.look.z - lz) * f;
    }
    cam.position.set(px, py, pz);
    cam.lookAt(lx, ly, lz);
    const fov = this.effectiveFov(c.fov);
    if (Math.abs(fov - this.lastFov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
      this.lastFov = fov;
    }
    this.skyDome.update(cam, this.ctx.sky.space, this.ctx.sky.dusk);
  }

  render(): void {
    if (this.contextLost) return;
    const s = this.ctx.sky;
    // Speed blur only while flying; scene goes straight to canvas otherwise.
    const handled = this.post.render(this.scene, this.camera, s.speed * 0.9, 0);
    if (!handled) this.renderer.render(this.scene, this.camera);
  }

  get size(): { w: number; h: number } {
    return { w: this.width, h: this.height };
  }

  /** Renderer stats for the HUD / memory monitoring. */
  stats(): { calls: number; triangles: number; geometries: number; textures: number } {
    const i = this.renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures };
  }

  dispose(): void {
    this.ro.disconnect();
    this.post.dispose();
    this.skyDome.dispose();
    this.ctx.assets.dispose();
    this.envTarget?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
