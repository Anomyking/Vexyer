import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { buildProceduralPack, type ModelPack, type PackName } from './procedural';

export type { ModelPack, PackName } from './procedural';

export interface LoadStats {
  gltf: PackName[];
  procedural: PackName[];
}

/**
 * Progressive asset loader.
 *  - GLBs are Meshopt-compressed and loaded per "pack" on demand.
 *  - If a GLB is missing/corrupt, the identical procedural pack is used instead.
 *  - Optional KTX2/Basis textures are supported for project previews.
 */
export class AssetLoader {
  readonly stats: LoadStats = { gltf: [], procedural: [] };
  private base = import.meta.env.BASE_URL;
  private gltf = new GLTFLoader();
  private ktx2: KTX2Loader | null = null;
  private cache = new Map<PackName, Promise<ModelPack>>();
  private progress = new Map<PackName, number>();
  private listeners = new Set<(p: number) => void>();

  constructor(private renderer: THREE.WebGLRenderer) {
    this.gltf.setMeshoptDecoder(MeshoptDecoder);
  }

  onProgress(fn: (p: number) => void): void {
    this.listeners.add(fn);
  }

  /** Load (once) and return a model pack. Never rejects. */
  pack(name: PackName): Promise<ModelPack> {
    let p = this.cache.get(name);
    if (!p) {
      p = this.loadPack(name);
      this.cache.set(name, p);
    }
    return p;
  }

  private emit(name: PackName, v: number): void {
    this.progress.set(name, v);
    const total = [...this.progress.values()].reduce((a, b) => a + b, 0) / Math.max(1, this.progress.size);
    this.listeners.forEach((l) => l(total));
  }

  private async loadPack(name: PackName): Promise<ModelPack> {
    this.emit(name, 0);
    try {
      const gltf = await this.gltf.loadAsync(`${this.base}models/${name}.glb`, (e) => {
        if (e.lengthComputable) this.emit(name, e.loaded / e.total);
      });
      const pack: ModelPack = new Map();
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        m.matrixWorld.decompose(position, quaternion, scale);
        const geometry = m.geometry.clone();
        if (scale.x !== 1 || scale.y !== 1 || scale.z !== 1) geometry.scale(scale.x, scale.y, scale.z);
        pack.set(m.name, { name: m.name, geometry, position, quaternion });
        m.geometry.dispose();
      });
      if (pack.size === 0) throw new Error(`empty glTF: ${name}`);
      this.stats.gltf.push(name);
      this.emit(name, 1);
      return pack;
    } catch {
      // Missing or invalid file (a dev server may even answer 200 with index.html): use fallback.
      this.stats.procedural.push(name);
      this.emit(name, 1);
      return buildProceduralPack(name);
    }
  }

  /** Try a KTX2 texture; resolve null when unavailable so callers can fall back. */
  async ktx2Texture(url: string): Promise<THREE.Texture | null> {
    try {
      if (!this.ktx2) {
        this.ktx2 = new KTX2Loader().setTranscoderPath(`${this.base}libs/basis/`).detectSupport(this.renderer);
      }
      const tex = await this.ktx2.loadAsync(url);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    } catch {
      return null;
    }
  }

  dispose(): void {
    this.ktx2?.dispose();
    this.cache.clear();
    this.listeners.clear();
  }
}
