import * as THREE from 'three';

/**
 * Cheap, good-looking glass: a single-pass shader (no transmission render target, no refraction
 * buffer). It fakes the look with Fresnel, a procedural sky reflection, a refracted-ray tint,
 * edge glow and slow facet shimmer. `simple` drops the refraction term for weak devices.
 */
const vert = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vP;
  #ifdef USE_INSTANCING_COLOR
  #endif
  void main() {
    vec4 lp = vec4(position, 1.0);
    vec3 nrm = normal;
    #ifdef USE_INSTANCING
      lp = instanceMatrix * lp;
      nrm = mat3(instanceMatrix) * nrm;
    #endif
    vec4 wp = modelMatrix * lp;
    vP = wp.xyz;
    vN = normalize(mat3(modelMatrix) * nrm);
    vV = cameraPosition - wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const frag = /* glsl */ `
  uniform vec3 uTint;
  uniform vec3 uEdge;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uFresnel;
  uniform float uSeed;
  uniform float uGlow;
  uniform float uSpace;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vP;

  vec3 skyColor(vec3 d) {
    float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 day = mix(vec3(0.86, 0.94, 1.0), vec3(0.22, 0.5, 0.98), pow(h, 0.7));
    vec3 night = mix(vec3(0.05, 0.08, 0.18), vec3(0.01, 0.015, 0.04), h);
    vec3 c = mix(day, night, uSpace);
    float sun = pow(max(dot(d, normalize(vec3(0.4, 0.55, -0.7))), 0.0), 48.0);
    return c + vec3(1.0, 0.95, 0.85) * sun * 1.4;
  }

  void main() {
    vec3 n = normalize(vN);
    if (!gl_FrontFacing) n = -n;
    vec3 v = normalize(vV);
    float ndv = clamp(dot(n, v), 0.0, 1.0);
    float f = pow(1.0 - ndv, uFresnel);

    vec3 refl = skyColor(reflect(-v, n));
    #ifdef SIMPLE_GLASS
      vec3 body = uTint * (0.55 + 0.45 * skyColor(n).b);
    #else
      vec3 body = skyColor(refract(-v, n, 0.8)) * uTint;
    #endif

    // Slow facet shimmer: bands slide across the surface as it rotates.
    float band = sin(dot(vP, vec3(0.31, 0.77, 0.52)) * 1.6 + uTime * 0.5 + uSeed);
    float shimmer = smoothstep(0.82, 1.0, band) * 0.35;

    vec3 col = mix(body, refl, clamp(f * 0.95 + 0.08, 0.0, 1.0));
    col += uEdge * (pow(f, 2.5) * 1.3 + shimmer) * (0.6 + uGlow);
    col += uTint * uGlow * 0.35;

    float a = clamp(uOpacity * (0.22 + 0.78 * f + shimmer * 0.5 + uGlow * 0.2), 0.0, 1.0);
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface GlassOptions {
  tint?: THREE.ColorRepresentation;
  edge?: THREE.ColorRepresentation;
  opacity?: number;
  fresnel?: number;
  seed?: number;
  simple?: boolean;
}

export function createGlassMaterial(o: GlassOptions = {}): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      uTint: { value: new THREE.Color(o.tint ?? 0xa9d8ff) },
      uEdge: { value: new THREE.Color(o.edge ?? 0xdff3ff) },
      uTime: { value: 0 },
      uOpacity: { value: o.opacity ?? 0.9 },
      uFresnel: { value: o.fresnel ?? 2.4 },
      uSeed: { value: o.seed ?? 0 },
      uGlow: { value: 0 },
      uSpace: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    defines: o.simple ? { SIMPLE_GLASS: '' } : {},
  });
  return m;
}

export function setGlassSimple(m: THREE.ShaderMaterial, simple: boolean): void {
  const had = 'SIMPLE_GLASS' in (m.defines ?? {});
  if (simple === had) return;
  m.defines = simple ? { SIMPLE_GLASS: '' } : {};
  m.needsUpdate = true;
}
