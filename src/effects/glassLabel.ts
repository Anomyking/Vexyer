import * as THREE from 'three';

/**
 * Typography that sits on a glass fragment.
 *
 * A canvas is drawn with serif text on a transparent background and shown through a
 * MeshBasicMaterial on a plane. The plane is a *child of the fragment's rig group*, so it follows
 * the fragment's position (springs, hover, convergence) exactly, but it does not inherit the
 * crystal's tumbling - that would make the words spin out of view. Instead it faces the camera
 * with a small fixed tilt and a very slow sway, which keeps it readable and still feels attached.
 *
 * The 3D text is decorative (`aria-hidden` by nature, it is a texture). The real, accessible text
 * for each fragment stays in the HTML (`.fragment-btn` and the panel copy).
 */
export interface LabelContent {
  title: string;
  body?: string;
  /** Small caption, drawn with a hairline rule, e.g. "01 · DISCOVER". */
  meta?: string;
}

export const LABEL_ASPECT = 4 / 3; // canvas width / height; the plane uses the same ratio, so nothing stretches

const SERIF = "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, 'Times New Roman', serif";

/** Greedy word wrap using real glyph metrics. */
export function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (line && ctx.measureText(test).width > maxWidth) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

export class GlassLabel {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private content: LabelContent;
  private width: number;

  /**
   * @param worldWidth width of the plane in world units
   * @param pixelWidth canvas width in pixels (the quality tier picks this)
   */
  constructor(content: LabelContent, worldWidth: number, pixelWidth: number, maxAnisotropy = 4) {
    this.content = content;
    this.width = pixelWidth;
    this.canvas.width = pixelWidth;
    this.canvas.height = Math.round(pixelWidth / LABEL_ASPECT);
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = Math.min(8, maxAnisotropy);
    this.texture.generateMipmaps = true;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
      depthWrite: false, // never writes depth, so it cannot punch holes in glass or clouds behind it
      depthTest: false, // the transmissive crystal writes depth; the text must never be cut by its faces
      toneMapped: false, // keeps white text pure white
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(worldWidth, worldWidth / LABEL_ASPECT), this.material);
    this.mesh.renderOrder = 6; // after the glass (5) so text is always on top of its own crystal
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.draw();
    // If a web font is added later through CSS, redraw once it has loaded.
    void document.fonts?.ready.then(() => this.draw());
  }

  /** Dynamic update: redraw and re-upload. */
  set(content: LabelContent): void {
    this.content = content;
    this.draw();
  }

  /** Change texture resolution (quality tier change). */
  resize(pixelWidth: number): void {
    if (pixelWidth === this.width) return;
    this.width = pixelWidth;
    this.canvas.width = pixelWidth;
    this.canvas.height = Math.round(pixelWidth / LABEL_ASPECT);
    this.texture.dispose(); // new size needs a new GPU allocation
    this.draw();
  }

  private draw(): void {
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    const u = W / 1024; // everything is laid out in a 1024-wide design space
    const { title, body, meta } = this.content;
    ctx.clearRect(0, 0, W, H);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    const padX = 96 * u;
    const maxW = W - padX * 2;

    // Title: shrink until it fits in at most two lines.
    let titlePx = 124 * u;
    let tLines: string[] = [];
    for (; titlePx > 52 * u; titlePx -= 4 * u) {
      ctx.font = `500 ${titlePx}px ${SERIF}`;
      tLines = wrapLines(ctx, title, maxW);
      if (tLines.length <= 2) break;
    }
    const bodyPx = 52 * u;
    ctx.font = `400 ${bodyPx}px ${SERIF}`;
    const bLines = body ? wrapLines(ctx, body, maxW * 0.92).slice(0, 3) : [];
    const metaPx = 36 * u;

    const tLead = titlePx * 1.04, bLead = bodyPx * 1.3;
    const blockH = tLines.length * tLead + (bLines.length ? 26 * u + bLines.length * bLead : 0) + (meta ? 54 * u + metaPx : 0);
    let y = (H - blockH) / 2 + titlePx * 0.82; // centred, first baseline

    // Soft scrim so white type stays readable on a bright sky (very low alpha, no visible edge).
    // Elliptical, fading to zero before the canvas edge (a circle sized to the width would be cut off
    // top and bottom and show as a hard-edged rectangle).
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(W / H, 1);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, H * 0.5);
    g.addColorStop(0, 'rgba(20, 0, 6, 0.26)');
    g.addColorStop(0.6, 'rgba(20, 0, 6, 0.10)');
    g.addColorStop(1, 'rgba(20, 0, 6, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(-H / 2, -H / 2, H, H);
    ctx.restore();

    const paint = (text: string, x: number, yy: number, font: string, alpha: number, spacing = '0px') => {
      ctx.font = font;
      (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = spacing;
      // pass 1: dark contact shadow; pass 2: white with a faint glow
      ctx.shadowColor = 'rgba(24, 0, 6, 0.6)';
      ctx.shadowBlur = 16 * u;
      ctx.shadowOffsetY = 3 * u;
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.fillText(text, x, yy);
      ctx.shadowColor = 'rgba(255, 255, 255, 0.35)';
      ctx.shadowBlur = 22 * u;
      ctx.shadowOffsetY = 0;
      ctx.fillText(text, x, yy);
      ctx.shadowBlur = 0;
    };

    for (const l of tLines) {
      paint(l, padX, y, `500 ${titlePx}px ${SERIF}`, 1, `${-0.01 * titlePx}px`);
      y += tLead;
    }
    if (bLines.length) {
      y += 26 * u - titlePx * 0.82 + bodyPx * 0.82;
      for (const l of bLines) {
        paint(l, padX, y, `400 ${bodyPx}px ${SERIF}`, 0.9);
        y += bLead;
      }
    }
    if (meta) {
      y += 54 * u - bodyPx * 0.3;
      ctx.shadowColor = 'rgba(24,0,6,0.5)';
      ctx.shadowBlur = 8 * u;
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fillRect(padX, y - metaPx * 0.35, 64 * u, 2 * u); // hairline rule
      ctx.shadowBlur = 0;
      paint(meta.toUpperCase(), padX + 84 * u, y, `500 ${metaPx}px ${SERIF}`, 0.85, `${0.18 * metaPx}px`);
    }
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0px';
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}
