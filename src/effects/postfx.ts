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
  uniform sampler2D tBloom;
  uniform float uBloom;
  uniform float uEncode;
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
    if (uBloom > 0.001) c += texture2D(tBloom, vUv).rgb * uBloom;
    gl_FragColor = vec4(c, 1.0);
    // The studio (bloom) pass tone maps and encodes the linear HDR target like a direct render. The speed /
    // cover pass for the final flight deliberately does not: that is its original look, which is kept.
    if (uEncode > 0.5) {
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  }
`;

const brightFrag = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uThreshold;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tDiffuse, vUv).rgb;
    float l = max(c.r, max(c.g, c.b));
    gl_FragColor = vec4(c * smoothstep(uThreshold, uThreshold + 0.5, l), 1.0);
  }
`;

const blurFrag = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uDir; // texel step * radius
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tDiffuse, vUv).rgb * 0.2270270270;
    c += (texture2D(tDiffuse, vUv + uDir * 1.3846153846).rgb + texture2D(tDiffuse, vUv - uDir * 1.3846153846).rgb) * 0.3162162162;
    c += (texture2D(tDiffuse, vUv + uDir * 3.2307692308).rgb + texture2D(tDiffuse, vUv - uDir * 3.2307692308).rgb) * 0.0702702703;
    gl_FragColor = vec4(c, 1.0);
  }
`;

export class PostFX {
  private target: THREE.WebGLRenderTarget | null = null;
  private quad: THREE.Mesh;
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private material: THREE.ShaderMaterial;
  enabled = true;
  /**
   * MSAA samples for the scene target. The canvas's own antialiasing does not apply when the scene is
   * drawn into a render target (bloom, speed blur), which is where the crystals' and the plane's jagged
   * edges came from. 0 disables it.
   */
  samples = 4;
  private scale = 0.85;
  private bloomA: THREE.WebGLRenderTarget | null = null;
  private bloomB: THREE.WebGLRenderTarget | null = null;
  private brightMat: THREE.ShaderMaterial;
  private blurMat: THREE.ShaderMaterial;
  private last = { w: 1, h: 1, pr: 1 };

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
        tBloom: { value: null },
        uBloom: { value: 0 },
        uEncode: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.brightMat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: brightFrag, uniforms: { tDiffuse: { value: null }, uThreshold: { value: 1.05 } }, depthTest: false, depthWrite: false });
    this.blurMat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: blurFrag, uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() } }, depthTest: false, depthWrite: false });
    // Single oversized triangle: cheaper than a quad.
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.quad = new THREE.Mesh(g, this.material);
    this.quad.frustumCulled = false;
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    this.last = { w, h, pr: pixelRatio };
    const tw = Math.max(2, Math.floor(w * pixelRatio * this.scale));
    const th = Math.max(2, Math.floor(h * pixelRatio * this.scale));
    const bw = Math.max(2, tw >> 2), bh = Math.max(2, th >> 2);
    if (this.target && this.target.samples !== this.samples) {
      this.target.dispose(); // sample count is fixed at allocation
      this.target = null;
    }
    if (!this.target) {
      this.target = new THREE.WebGLRenderTarget(tw, th, { type: THREE.HalfFloatType, depthBuffer: true, samples: this.samples });
    } else {
      this.target.setSize(tw, th);
    }
    if (!this.bloomA) {
      const o = { type: THREE.HalfFloatType, depthBuffer: false, samples: 0 } as const;
      this.bloomA = new THREE.WebGLRenderTarget(bw, bh, o);
      this.bloomB = new THREE.WebGLRenderTarget(bw, bh, o);
    } else {
      this.bloomA.setSize(bw, bh);
      this.bloomB!.setSize(bw, bh);
    }
  }

  private pass(mat: THREE.ShaderMaterial, to: THREE.WebGLRenderTarget | null): void {
    this.quad.material = mat;
    this.renderer.setRenderTarget(to);
    this.renderer.render(this.quad, this.cam);
  }

  /**
   * Returns true when the post pass handled the frame. `bloom` (0..1) adds a glow around very bright
   * pixels (facet edges, light beams); the speed blur and the cover work as before.
   */
  render(scene: THREE.Scene, camera: THREE.Camera, strength: number, cover: number, bloom = 0): boolean {
    const needsPass = this.enabled && (strength > 0.01 || cover > 0.001 || bloom > 0.01);
    if (!needsPass || !this.target) return false;
    // Bloom alone keeps the text crisp (full resolution); the speed blur can afford the cheaper target.
    const want = strength > 0.01 || cover > 0.001 ? 0.85 : 1;
    if (want !== this.scale) {
      this.scale = want;
      this.setSize(this.last.w, this.last.h, this.last.pr);
    }
    const u = this.material.uniforms;
    u.uStrength.value = strength;
    u.uCoverAmt.value = cover;
    u.tDiffuse.value = this.target.texture;
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);

    const useBloom = bloom > 0.01 && this.bloomA && this.bloomB;
    if (useBloom) {
      const A = this.bloomA!, B = this.bloomB!;
      this.brightMat.uniforms.tDiffuse.value = this.target.texture;
      this.pass(this.brightMat, A);
      for (let i = 0; i < 2; i++) {
        const r = 1 + i * 1.6;
        this.blurMat.uniforms.uDir.value.set((r / A.width), 0);
        this.blurMat.uniforms.tDiffuse.value = A.texture;
        this.pass(this.blurMat, B);
        this.blurMat.uniforms.uDir.value.set(0, r / A.height);
        this.blurMat.uniforms.tDiffuse.value = B.texture;
        this.pass(this.blurMat, A);
      }
      u.tBloom.value = A.texture;
    }
    u.uBloom.value = useBloom ? bloom : 0;
    u.uEncode.value = useBloom ? 1 : 0;
    this.pass(this.material, null);
    return true;
  }

  /** Free the render target when disabled (low tier / reduced motion). */
  release(): void {
    this.target?.dispose();
    this.target = null;
    this.bloomA?.dispose();
    this.bloomB?.dispose();
    this.bloomA = this.bloomB = null;
  }

  dispose(): void {
    this.release();
    this.quad.geometry.dispose();
    this.material.dispose();
    this.brightMat.dispose();
    this.blurMat.dispose();
  }
}
