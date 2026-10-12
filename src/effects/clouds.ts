import * as THREE from 'three';

/**
 * Lightweight "volumetric" clouds: instanced puffs with a soft-edged shader (Fresnel falloff +
 * cheap value-noise erosion + sun-side lighting). No ray marching, no render targets. A near-camera
 * fade stops puffs popping when the camera travels through them.
 */
const vert = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vL;
  varying float vDist;
  void main() {
    vec4 lp = vec4(position, 1.0);
    vec3 nrm = normal;
    #ifdef USE_INSTANCING
      lp = instanceMatrix * lp;
      nrm = mat3(instanceMatrix) * nrm;
    #endif
    vec4 wp = modelMatrix * lp;
    vL = position;
    vN = normalize(mat3(modelMatrix) * nrm);
    vV = cameraPosition - wp.xyz;
    vDist = length(vV);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const frag = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  uniform vec3 uSun;
  uniform vec3 uLit;
  uniform vec3 uShade;
  uniform float uSpeed;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vL;
  varying float vDist;

  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vnoise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }

  void main() {
    vec3 n = normalize(vN);
    vec3 v = normalize(vV);
    float ndv = clamp(dot(n, v), 0.0, 1.0);

    vec3 q = vL * 0.22 + vec3(uTime * 0.02 + uSpeed * 0.0, uTime * 0.01, 0.0);
    float nz = vnoise(q) * 0.6 + vnoise(q * 2.1) * 0.3 + vnoise(q * 4.3) * 0.1;

    float body = pow(ndv, 0.75);                 // dense in the middle, soft at the rim
    float a = smoothstep(0.12, 0.85, body * (0.55 + nz * 0.9));
    a *= smoothstep(3.0, 16.0, vDist);            // fade when the camera is inside a puff

    float lit = clamp(dot(n, normalize(uSun)) * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = mix(uShade, uLit, lit * (0.7 + 0.3 * nz));
    col += vec3(1.0, 0.96, 0.9) * pow(1.0 - ndv, 3.0) * 0.18; // silver lining

    gl_FragColor = vec4(col, a * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createCloudMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uSun: { value: new THREE.Vector3(0.4, 0.8, 0.5) },
      uLit: { value: new THREE.Color(1.0, 0.99, 0.98) },
      uShade: { value: new THREE.Color(0.55, 0.66, 0.84) },
      uSpeed: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
  });
}
