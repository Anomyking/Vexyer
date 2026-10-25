import * as THREE from 'three';
import { sunDirection } from './skydome';

/**
 * Soft cumulus puffs as camera-facing quads (one InstancedMesh, one draw call).
 *
 * Why billboards instead of low-poly spheres: a sphere's silhouette is a visible polygon and its
 * shading is a smooth ramp, which reads as a "blob". Here the shape comes from noise in the
 * fragment shader, the edge is always soft, and the lighting is sampled *toward the sun* - the
 * side of a puff that faces the light is bright, the thick interior and underside are shaded.
 * A near-camera fade stops puffs popping when the camera travels through them.
 */
const vert = /* glsl */ `
  attribute vec4 aData; // x = full size, y = seed, z = tone, w = stretch (width/height)
  uniform vec3 uSun;
  varying vec2 vUv;
  varying float vSeed;
  varying float vTone;
  varying float vFade;
  varying vec2 vSunScreen;
  varying float vDepthFog;
  void main() {
    vec3 center = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    float size = aData.x;
    vec3 wp = center + (right * position.x * aData.w + up * position.y) * size;
    vUv = position.xy * 2.0;
    vSeed = aData.y;
    vTone = aData.z;
    float dist = length(cameraPosition - center);
    vFade = smoothstep(size * 0.18, size * 0.85, dist);
    vDepthFog = smoothstep(120.0, 520.0, dist);
    vSunScreen = vec2(dot(uSun, right), dot(uSun, up));
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }
`;

const frag = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  uniform vec3 uLit;
  uniform vec3 uShade;
  uniform vec3 uHaze;
  varying vec2 vUv;
  varying float vSeed;
  varying float vTone;
  varying float vFade;
  varying vec2 vSunScreen;
  varying float vDepthFog;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < CLOUD_OCTAVES; i++) { v += a * vnoise(p); p = m * p; a *= 0.5; }
    return v;
  }
  // Puff density: round falloff broken up by noise.
  float density(vec2 uv, vec2 p) {
    float r = length(uv);
    float n = fbm(p);
    return 1.0 - smoothstep(0.18, 1.0, r + (n - 0.5) * 0.7);
  }

  void main() {
    vec2 uv = vUv;
    float r = length(uv);
    if (r > 1.0) discard;
    vec2 p = uv * 1.6 + vec2(vSeed * 3.7, vSeed * 1.9) + vec2(uTime * 0.008, 0.0);

    float d = density(uv, p);
    // Thickness toward the light: sample the same puff shifted toward the sun.
    vec2 so = vSunScreen * 0.28;
    float dl = density(uv + so, p + so * 1.6);
    // Thinner toward the sun than here = sunlit edge; thicker = shadowed. Difference-based, so the
    // dense interior stays a smooth mid-tone instead of going dark (which read as holes).
    float light = clamp(0.66 + (d - dl) * 1.7, 0.0, 1.0);
    light *= mix(0.80, 1.0, smoothstep(-0.9, 0.55, uv.y));   // slightly darker undersides
    light = mix(light, 1.0, (1.0 - d) * 0.4);                 // silver lining on thin edges

    vec3 col = mix(uShade, uLit, light * (0.82 + 0.18 * vTone));
    col = mix(col, uHaze, vDepthFog * 0.75);                  // distant clouds melt into haze

    float a = smoothstep(0.0, 0.55, d) * (1.0 - smoothstep(0.82, 1.0, r));
    gl_FragColor = vec4(col, a * uOpacity * vFade);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createCloudMaterial(octaves = 4): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    defines: { CLOUD_OCTAVES: octaves },
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0.96 },
      uSun: { value: sunDirection(0) },
      uLit: { value: new THREE.Color(1.0, 0.99, 0.97) },
      uShade: { value: new THREE.Color(0.58, 0.68, 0.84) },
      uHaze: { value: new THREE.Color(0.74, 0.85, 0.97) },
    },
    transparent: true,
    depthWrite: false,
  });
}

export function setCloudOctaves(m: THREE.ShaderMaterial, octaves: number): void {
  if (m.defines?.CLOUD_OCTAVES === octaves) return;
  m.defines = { ...m.defines, CLOUD_OCTAVES: octaves };
  m.needsUpdate = true;
}
