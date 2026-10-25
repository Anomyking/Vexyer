import * as THREE from 'three';

/**
 * Sun direction shared by the sky, the clouds and the glass so highlights agree everywhere.
 * Daytime sun sits ahead-left of the flight direction (-z); at dusk it drops toward the horizon.
 */
export function sunDirection(dusk: number, out = new THREE.Vector3()): THREE.Vector3 {
  const elev = 0.44 - dusk * 0.38;
  return out.set(0.42, elev, -0.9).normalize();
}

/**
 * One draw call, three layers:
 *   1. Atmosphere: zenith -> mid -> hazy horizon, Mie-style sun glow, warm horizon at dusk.
 *   2. Cirrus/cumulus layer: fbm noise projected on a plane overhead (perspective-correct, so clouds
 *      shrink toward the horizon), lit from the sun side, drifting slowly.
 *   3. Deep space for the opening, blended by `uSpace`.
 * Output is dithered, which removes the 8-bit banding a smooth sky gradient otherwise shows.
 */
const vert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // always at the far plane
  }
`;

const frag = /* glsl */ `
  uniform float uSpace;
  uniform float uDusk;
  uniform float uStage;
  uniform float uTime;
  uniform vec3 uSun;
  varying vec3 vDir;

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
    for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = m * p; a *= 0.5; }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);
    float e = d.y;
    vec3 S = normalize(uSun);
    float mu = dot(d, S);

    // ---- atmosphere ---------------------------------------------------------------
    vec3 zenith  = mix(vec3(0.045, 0.205, 0.62), vec3(0.06, 0.08, 0.30), uDusk);
    vec3 mid     = mix(vec3(0.20, 0.47, 0.88),  vec3(0.36, 0.30, 0.56), uDusk);
    vec3 horizon = mix(vec3(0.74, 0.85, 0.97),  vec3(1.00, 0.62, 0.42), uDusk);
    float t = clamp(e, 0.0, 1.0);
    vec3 sky = mix(horizon, mid, smoothstep(0.0, 0.22, t));
    sky = mix(sky, zenith, smoothstep(0.15, 0.9, t));
    // Below the horizon is a bright haze (we are above a cloud deck), not dark.
    sky = mix(sky, horizon * vec3(0.97, 0.98, 1.0), smoothstep(0.0, -0.05, e));

    // Sun: soft Mie glow + a tight bright core; warmer and wider near the horizon at dusk.
    float g1 = pow(max(mu, 0.0), 5.0);
    float g2 = pow(max(mu, 0.0), 60.0);
    vec3 sunCol = mix(vec3(1.0, 0.93, 0.78), vec3(1.0, 0.55, 0.3), uDusk);
    sky += sunCol * (g1 * (0.14 + 0.2 * uDusk) + g2 * 0.55);
    sky += vec3(1.0, 0.97, 0.9) * smoothstep(0.9975, 0.9999, mu) * 2.2;

    // ---- cloud layer ----------------------------------------------------------------
    if (e < -0.004) {
      // Cloud deck below us: same noise, projected on a plane under the camera, fading into haze.
      vec2 uv = d.xz / (0.22 - e) * 1.6 + vec2(uTime * 0.005, 0.0) + 17.0;
      float dens = fbm(uv);
      float cover = smoothstep(0.38, 0.72, dens);
      float toSun = fbm(uv + normalize(S.xz + vec2(1e-4)) * 0.1);
      float lit = clamp(0.7 + (dens - toSun) * -2.6, 0.0, 1.0);
      vec3 deckLit = mix(vec3(1.0, 0.99, 0.97), vec3(1.0, 0.75, 0.58), uDusk);
      vec3 deckShade = mix(vec3(0.55, 0.66, 0.84), vec3(0.45, 0.36, 0.52), uDusk);
      vec3 deckBase = mix(vec3(0.50, 0.66, 0.90), vec3(0.38, 0.34, 0.56), uDusk); // sky seen through gaps
      vec3 deck = mix(deckBase, mix(deckShade, deckLit, lit), cover);
      sky = mix(sky, deck, smoothstep(0.0, 0.16, -e));
    }
    if (e > 0.004) {
      vec2 uv = d.xz / (e + 0.2) * 1.15 + vec2(uTime * 0.006, uTime * 0.0025);
      float dens = fbm(uv);
      float cover = smoothstep(0.47, 0.76, dens);
      // Light: sample a little toward the sun; thinner toward the sun = brighter edge.
      vec2 sd = normalize(S.xz + vec2(1e-4)) * 0.11;
      float toSun = fbm(uv + sd);
      float lit = clamp(0.62 + (dens - toSun) * -3.4, 0.0, 1.0);
      lit = mix(lit, 1.0, pow(max(mu, 0.0), 3.0) * 0.4);
      vec3 cLit = mix(vec3(1.0, 0.985, 0.96), vec3(1.0, 0.74, 0.55), uDusk);
      vec3 cShade = mix(vec3(0.60, 0.69, 0.84), vec3(0.50, 0.38, 0.52), uDusk);
      vec3 cc = mix(cShade, cLit, lit);
      float fade = smoothstep(0.0, 0.10, e);              // melt into the haze at the horizon
      sky = mix(sky, cc, cover * fade * 0.92);
    }

    // ---- crimson stage (studio chapter) ------------------------------------------------
    if (uStage > 0.001) {
      float az = atan(d.x, -d.z);
      float breath = 0.92 + 0.08 * sin(uTime * 0.7 + az * 3.0);
      float curtain = 0.55 * pow(0.5 + 0.5 * cos(az * 9.0 + 0.8), 4.0) + 0.45 * pow(0.5 + 0.5 * cos(az * 5.0 - 1.7), 5.0);
      float vert = smoothstep(-0.25, 0.1, e) * (1.0 - smoothstep(0.1, 0.8, e));
      vec3 st = vec3(0.05, 0.0, 0.008);
      st += vec3(0.78, 0.0, 0.012) * curtain * (0.18 + 0.82 * vert) * breath;
      st += vec3(0.85, 0.01, 0.02) * exp(-pow(az * 2.4, 2.0)) * 0.12 * (1.0 - smoothstep(0.0, 0.7, abs(e)));
      // Glossy floor: darker, with the beams mirrored and a bright horizon line.
      float fl = smoothstep(-0.02, -0.16, e);
      vec3 floorC = vec3(0.03, 0.0, 0.006) + vec3(0.55, 0.0, 0.01) * curtain * 0.4 * (1.0 - 0.5 * fl);
      st = mix(st, floorC, fl);
      st += vec3(0.9, 0.03, 0.03) * exp(-pow((e + 0.03) * 70.0, 2.0)) * 0.22;
      st *= 1.0 - 0.45 * smoothstep(0.35, 1.0, length(vec2(az * 0.9, e * 1.4)));   // vignette
      sky = mix(sky, st, uStage);
    }

    // ---- deep space (opening) -------------------------------------------------------
    float h = clamp(e * 0.5 + 0.5, 0.0, 1.0);
    vec3 space = mix(vec3(0.02, 0.035, 0.09), vec3(0.004, 0.007, 0.02), h);
    vec3 col = mix(sky, space, uSpace);

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    // Triangular-ish dither, applied after tone mapping so it removes the visible banding.
    gl_FragColor.rgb += (hash21(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) * (1.5 / 255.0);
  }
`;

export class SkyDome {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private sun = new THREE.Vector3();

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { uSpace: { value: 1 }, uDusk: { value: 0 }, uStage: { value: 0 }, uTime: { value: 0 }, uSun: { value: new THREE.Vector3(0.4, 0.4, -0.9) } },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
  }

  update(camera: THREE.PerspectiveCamera, space: number, dusk: number, time = 0, stage = 0): void {
    this.mesh.position.copy(camera.position);
    this.mesh.scale.setScalar(camera.far * 0.5);
    const u = this.material.uniforms;
    u.uSpace.value = space;
    u.uDusk.value = dusk;
    u.uStage.value = stage;
    u.uTime.value = time;
    (u.uSun.value as THREE.Vector3).copy(sunDirection(dusk, this.sun));
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
