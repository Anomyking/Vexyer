import * as THREE from 'three';

/**
 * Cut glass, still cheap: one pass, no transmission buffer.
 *
 *  - Flat facets: every triangle has its own normal, so each one reflects and refracts a different
 *    part of the environment. That is what reads as "angular glass".
 *  - Sharp lit edges: barycentric coordinates give a crisp, screen-space-constant line along every
 *    facet boundary. Double-sided, so back edges show through the body and give it depth.
 *  - Fresnel (Schlick) for the body opacity, faked refraction with slight dispersion.
 *  - Sun/stage glints: very tight highlights that flash from facet to facet as the crystal moves.
 *  - `uStage` swaps the environment from daylight sky to the dark crimson stage with light beams.
 * `simple` drops dispersion for weak GPUs.
 */
const vert = /* glsl */ `
  attribute vec3 aBary;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vB;
  varying float vWY;
  void main() {
    vec4 lp = vec4(position, 1.0);
    vec3 nrm = normal;
    #ifdef USE_INSTANCING
      lp = instanceMatrix * lp;
      nrm = mat3(instanceMatrix) * nrm;
    #endif
    vec4 wp = modelMatrix * lp;
    vB = aBary;
    vWY = wp.y;
    vN = normalize(mat3(modelMatrix) * nrm);
    vV = cameraPosition - wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const frag = /* glsl */ `
  uniform vec3 uTint;
  uniform vec3 uEdge;
  uniform vec3 uSun;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uBase;
  uniform float uFresnel;
  uniform float uSeed;
  uniform float uGlow;
  uniform float uSpace;
  uniform float uStage;
  uniform float uMirror;
  uniform float uFloorY;
  varying float vWY;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vB;

  vec3 skyColor(vec3 d) {
    float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 day = mix(vec3(0.80, 0.90, 1.0), vec3(0.16, 0.42, 0.92), pow(h, 0.8));
    vec3 night = mix(vec3(0.05, 0.08, 0.18), vec3(0.01, 0.015, 0.04), h);
    vec3 c = mix(day, night, uSpace);
    float sun = pow(max(dot(d, normalize(uSun)), 0.0), 40.0);
    return c + vec3(1.0, 0.95, 0.85) * sun * 1.2;
  }

  // Dark crimson room with tall light beams: bright where a facet mirrors a beam, deep red elsewhere.
  vec3 stageColor(vec3 d) {
    float az = atan(d.x, -d.z);
    float beams = pow(0.5 + 0.5 * cos(az * 2.0 + 0.7 + uSeed * 0.3), 5.0) * 1.0
                + pow(0.5 + 0.5 * cos(az * 3.0 - 1.3 + uSeed), 12.0) * 1.1;
    float mid = 1.0 - abs(d.y);
    float top = smoothstep(0.15, 1.0, d.y);
    vec3 base = vec3(0.30, 0.012, 0.03) * (0.35 + 0.65 * mid);
    vec3 hot = vec3(1.0, 0.13, 0.10) * beams * (0.5 + 0.5 * mid);
    return base + hot + vec3(1.0, 0.5, 0.45) * top * 0.5;
  }

  vec3 envColor(vec3 d) { return mix(skyColor(d), stageColor(d), uStage); }

  void main() {
    vec3 n = normalize(vN);
    bool front = gl_FrontFacing;
    if (uMirror > 0.5) front = !front; // mirrored copy has reversed winding
    if (!front) n = -n;
    vec3 v = normalize(vV);
    float ndv = clamp(dot(n, v), 0.0, 1.0);
    float f = pow(1.0 - ndv, uFresnel);
    float F = 0.04 + 0.96 * f;                      // Schlick

    vec3 R = reflect(-v, n);
    vec3 refl = envColor(R);
    vec3 T = refract(-v, n, 0.7);
    #ifdef SIMPLE_GLASS
      vec3 refr = envColor(T);
    #else
      vec3 refr = vec3(envColor(normalize(T + vec3(0.04, 0.0, 0.0))).r,
                       envColor(T).g,
                       envColor(normalize(T - vec3(0.04, 0.0, 0.0))).b);
    #endif
    vec3 tint = mix(uTint, vec3(1.0, 0.42, 0.42), uStage);
    vec3 edgeCol = mix(uEdge, vec3(1.0, 0.80, 0.74), uStage);
    vec3 body = refr * mix(vec3(1.0), tint, 0.6) + tint * 0.05;
    body *= 1.0 - 0.28 * (1.0 - uStage); // daylight glass reads as a deeper, clearer blade against bright sky

    vec3 L = normalize(uSun);
    float glint = pow(max(dot(R, L), 0.0), 120.0) * 2.0 * (1.0 - uStage);
    // On the stage the "lights" are the beams, so facets flash wherever the reflection hits one.
    float flash = smoothstep(0.55, 1.0, max(max(stageColor(R).r - 0.6, 0.0), 0.0)) * uStage;

    // Sharp edges: width follows the screen-space derivative, so lines stay ~1.3px at any distance.
    vec3 fw = fwidth(vB);
    vec3 e3 = smoothstep(vec3(0.0), fw * 1.1, vB);
    float edge = 1.0 - min(min(e3.x, e3.y), e3.z);
    // Very small facets (bevels) would turn into a bright mesh of lines: fade the line out as they shrink.
    edge *= 1.0 - smoothstep(0.3, 0.75, max(max(fw.x, fw.y), fw.z));
    float rim = pow(f, 4.0);

    // Each facet gets its own brightness from a fixed key light (flat normals), so the body reads as cut
    // solid glass; on the stage the body is also filled with deep red so it is not just an outline.
    float facetL = pow(max(dot(n, normalize(vec3(0.45, 0.8, 0.55))), 0.0), 1.4);
    body += tint * facetL * (0.12 + 0.3 * uStage);
    body = mix(body, tint * vec3(0.8, 0.05, 0.07) * (0.35 + 0.9 * facetL), uStage * 0.8);
    vec3 col = mix(body, refl, F);
    col += vec3(1.0, 0.98, 0.94) * glint + vec3(1.0, 0.85, 0.8) * flash * 0.8;
    col += edgeCol * edge * (0.16 + 0.8 * f + 0.4 * uGlow) + edgeCol * rim * 0.2;
    col += tint * uGlow * 0.25;

    float side = front ? 1.0 : 0.6;
    float a = uOpacity * side * (uBase + uStage * 0.3 + 0.5 * F + 0.2 * rim) + edge * (0.2 + 0.5 * f) * side + glint * 0.5 + flash * 0.3 + uGlow * 0.16;
    #ifdef EDGE_ONLY
      // Overlay on top of a real transmissive body: draw only the sharp facet edges, glints and flashes.
      a = edge * (0.3 + 0.6 * f) * side + glint * 0.5 + flash * 0.3 + uGlow * 0.1;
      col = edgeCol * (0.85 + 0.6 * f) + vec3(1.0, 0.98, 0.94) * glint + vec3(1.0, 0.85, 0.8) * flash * 0.8;
    #endif
    col *= mix(1.0, 0.5, uMirror);
    a *= mix(1.0, exp(-abs(vWY - uFloorY) * 0.45), uMirror); // reflections fade with distance from the floor
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface GlassOptions {
  tint?: THREE.ColorRepresentation;
  edge?: THREE.ColorRepresentation;
  opacity?: number;
  /** Opacity when looking straight through (0 = invisible, 0.2 = visibly tinted). */
  base?: number;
  fresnel?: number;
  seed?: number;
  /** Constant inner glow (edges and body), useful against bright skies. */
  glow?: number;
  simple?: boolean;
}

export function createGlassMaterial(o: GlassOptions = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      uTint: { value: new THREE.Color(o.tint ?? 0xa9d8ff) },
      uEdge: { value: new THREE.Color(o.edge ?? 0xdff3ff) },
      uSun: { value: new THREE.Vector3(0.42, 0.44, -0.9).normalize() },
      uTime: { value: 0 },
      uOpacity: { value: o.opacity ?? 1 },
      uBase: { value: o.base ?? 0.1 },
      uFresnel: { value: o.fresnel ?? 3 },
      uSeed: { value: o.seed ?? 0 },
      uGlow: { value: o.glow ?? 0 },
      uSpace: { value: 0 },
      uStage: { value: 0 },
      uMirror: { value: 0 },
      uFloorY: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    // The edge overlay shares the physical body's geometry; pull it slightly toward the camera so the two
    // never z-fight (that showed up as shimmering stripes).
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    defines: o.simple ? { SIMPLE_GLASS: '' } : {},
  });
}

function setDefine(m: THREE.ShaderMaterial, name: string, on: boolean): void {
  const had = name in (m.defines ?? {});
  if (on === had) return;
  const d: Record<string, string> = { ...(m.defines as Record<string, string> | undefined) };
  if (on) d[name] = '';
  else delete d[name];
  m.defines = d;
  m.needsUpdate = true;
}

export function setGlassSimple(m: THREE.ShaderMaterial, simple: boolean): void {
  setDefine(m, 'SIMPLE_GLASS', simple);
}

/** Edge-only mode: the material draws just the lit facet edges (used over a real transmissive body). */
export function setGlassEdgeOnly(m: THREE.ShaderMaterial, on: boolean): void {
  setDefine(m, 'EDGE_ONLY', on);
}
