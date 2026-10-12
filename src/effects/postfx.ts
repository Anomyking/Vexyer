import * as THREE from 'three';

/**
 * Cheap full-screen pass: radial "speed" blur (6 taps) + vignette. Rendered at reduced resolution
 * and only while it has something to do (speed > 0), otherwise the scene renders straight to the
 * canvas with zero overhead.
 */
const vert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;
const frag = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uStrength;
  uniform float uVignette;
  uniform vec3 uCover;
  uniform float uCoverAmt;
  varying vec2 vUv;
  void main() {
    vec2 d = vUv - 0.5;
    float r = length(d);
    // Depth-ish blur: stronger toward the edges, none at the centre where the plane is.
    float amt = uStrength * smoothstep(0.08, 0.75, r);
    vec3 c = texture2D(tDiffuse, vUv).rgb;
    for (int i = 1; i <= 6; i++) {
      float s = 1.0 - amt * 0.055 * float(i);
      c += texture2D(tDiffuse, 0.5 + d * s).rgb;
    }
    c /= 7.0;
    c *= 1.0 - uVignette * smoothstep(0.35, 0.95, r);
    c = mix(c, uCover, uCoverAmt);
    gl_FragColor = vec4(c, 1.0);
  }
`;

export class PostFX {
  private target: THREE.WebGLRenderTarget | null = null;
  private quad: THREE.Mesh;
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private material: THREE.ShaderMaterial;
  enabled = true;
  private scale = 0.85;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        tDiffuse: { value: null },
        uStrength: { value: 0 },
        uVignette: { value: 0.22 },
        uCover: { value: new THREE.Color(0xf4f6fb) },
        uCoverAmt: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    // Single oversized triangle: cheaper than a quad.
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.quad = new THREE.Mesh(g, this.material);
    this.quad.frustumCulled = false;
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    const tw = Math.max(2, Math.floor(w * pixelRatio * this.scale));
    const th = Math.max(2, Math.floor(h * pixelRatio * this.scale));
    if (!this.target) {
      this.target = new THREE.WebGLRenderTarget(tw, th, { type: THREE.HalfFloatType, depthBuffer: true, samples: 0 });
    } else {
      this.target.setSize(tw, th);
    }
  }

  /** Returns true when the post pass handled the frame. */
  render(scene: THREE.Scene, camera: THREE.Camera, strength: number, cover: number): boolean {
    const needsPass = this.enabled && (strength > 0.01 || cover > 0.001);
    if (!needsPass || !this.target) return false;
    this.material.uniforms.uStrength.value = strength;
    this.material.uniforms.uCoverAmt.value = cover;
    this.material.uniforms.tDiffuse.value = this.target.texture;
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quad, this.cam);
    return true;
  }

  /** Free the render target when disabled (low tier / reduced motion). */
  release(): void {
    this.target?.dispose();
    this.target = null;
  }

  dispose(): void {
    this.release();
    this.quad.geometry.dispose();
    this.material.dispose();
  }
}
