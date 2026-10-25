import * as THREE from 'three';
import { seeded } from '../core/math';
import type { AssetLoader } from '../assets/loader';

/**
 * Project preview textures.
 *  1. If `public/previews/project-N.ktx2` exists it is used (GPU-compressed, tiny VRAM).
 *  2. Otherwise a deterministic abstract UI mock is painted to a small canvas. These contain NO
 *     essential text - titles and descriptions live in the HTML overlay.
 */
export function paintPreview(index: number, hue: number, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const rand = seeded(1000 + index * 77);
  const S = w / 640;

  const bg = g.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, `hsl(${hue} 70% 14%)`);
  bg.addColorStop(1, `hsl(${(hue + 40) % 360} 75% 28%)`);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);

  // Window chrome
  g.fillStyle = 'rgba(255,255,255,0.08)';
  g.fillRect(0, 0, w, 34 * S);
  ['#ff6b6b', '#ffd166', '#6bff95'].forEach((col, i) => {
    g.fillStyle = col;
    g.beginPath();
    g.arc((20 + i * 20) * S, 17 * S, 5 * S, 0, Math.PI * 2);
    g.fill();
  });

  // Layout blocks differ per project (hero, cards, chart, list)
  const variant = index % 3;
  g.fillStyle = `hsla(${hue}, 90%, 70%, 0.9)`;
  g.fillRect(36 * S, 70 * S, 240 * S, 18 * S);
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.fillRect(36 * S, 100 * S, 180 * S, 10 * S);
  g.fillRect(36 * S, 118 * S, 140 * S, 10 * S);

  if (variant === 0) {
    for (let i = 0; i < 3; i++) {
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect((36 + i * 190) * S, 190 * S, 170 * S, 150 * S);
      g.fillStyle = `hsla(${(hue + i * 30) % 360}, 90%, 65%, 0.85)`;
      g.fillRect((50 + i * 190) * S, 204 * S, 60 * S, 60 * S);
    }
  } else if (variant === 1) {
    for (let i = 0; i < 14; i++) {
      const bh = (30 + rand() * 150) * S;
      g.fillStyle = `hsla(${(hue + i * 6) % 360}, 90%, 65%, 0.85)`;
      g.fillRect((40 + i * 40) * S, (360 * S) - bh, 26 * S, bh);
    }
  } else {
    g.strokeStyle = `hsl(${hue} 95% 70%)`;
    g.lineWidth = 4 * S;
    g.beginPath();
    for (let i = 0; i <= 20; i++) {
      const x = (36 + i * 28) * S;
      const y = (300 - Math.sin(i * 0.5 + index) * 60 - rand() * 40) * S;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  return c;
}

export async function createPreviewTexture(
  index: number,
  hue: number,
  size: number,
  assets: AssetLoader,
  maxAniso: number,
): Promise<THREE.Texture> {
  const compressed = await assets.ktx2Texture(`${import.meta.env.BASE_URL}previews/project-${index + 1}.ktx2`);
  if (compressed) return compressed;
  const w = size;
  const h = Math.round(size * 0.625); // 16:10
  const tex = new THREE.CanvasTexture(paintPreview(index, hue, w, h));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(4, maxAniso);
  return tex;
}
