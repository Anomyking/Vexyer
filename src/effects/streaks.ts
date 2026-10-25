import * as THREE from 'three';
import { seeded } from '../core/math';

/**
 * Speed lines as a single LineSegments draw call. Streak positions are a *pure function* of a
 * scalar `uTravel` (so scrolling back reverses the motion exactly) plus a tiny time term for life.
 * Layers (near/far) get different speeds and lengths for parallax.
 */
const vert = /* glsl */ `
  attribute vec3 aBase;
  attribute vec3 aParams;   // x speed multiplier, y length, z alpha
  attribute float aEnd;     // 0 = head, 1 = tail
  uniform float uTravel;
  uniform float uDepth;
  uniform float uSpeed;
  varying float vAlpha;
  void main() {
    float span = uDepth;
    float z = mod(aBase.z + uTravel * aParams.x, span) - span * 0.5;
    // Streaks stretch with speed; tail trails behind (towards +z, i.e. towards the chase camera).
    vec3 p = vec3(aBase.x, aBase.y, z + aEnd * aParams.y * (0.35 + uSpeed));
    // Fade at both ends of the corridor so nothing pops.
    float edge = smoothstep(0.0, 0.12, abs(z) / (span * 0.5) * -1.0 + 1.0);
    vAlpha = aParams.z * (1.0 - aEnd) * edge * uSpeed;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0);
  }
`;
const frag = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(uColor, vAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class Streaks {
  readonly object: THREE.LineSegments;
  private material: THREE.ShaderMaterial;

  constructor(count: number, depth = 220) {
    const rand = seeded(7);
    const base = new Float32Array(count * 2 * 3);
    const params = new Float32Array(count * 2 * 3);
    const end = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      // Ring-shaped corridor around the flight line so the centre stays clear for the plane.
      const a = rand() * Math.PI * 2;
      const r = 2.2 + Math.pow(rand(), 0.7) * 16;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r * 0.7;
      const z = rand() * depth;
      const layer = rand();
      const speed = 0.7 + layer * 1.6;
      const len = 2 + layer * 9;
      const alpha = 0.18 + layer * 0.5;
      for (let k = 0; k < 2; k++) {
        const o = (i * 2 + k) * 3;
        base.set([x, y, z], o);
        params.set([speed, len, alpha], o);
        end[i * 2 + k] = k;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 2 * 3), 3));
    g.setAttribute('aBase', new THREE.BufferAttribute(base, 3));
    g.setAttribute('aParams', new THREE.BufferAttribute(params, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        uTravel: { value: 0 },
        uDepth: { value: depth },
        uSpeed: { value: 0 },
        uColor: { value: new THREE.Color(0xeaf4ff) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.object = new THREE.LineSegments(g, this.material);
    this.object.frustumCulled = false; // positions are computed in the shader
    this.object.visible = false;
  }

  set(travel: number, speed: number): void {
    this.material.uniforms.uTravel.value = travel;
    this.material.uniforms.uSpeed.value = speed;
    this.object.visible = speed > 0.01;
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.material.dispose();
  }
}
