import * as THREE from 'three';

/** World height of the studio floor (just under the lowest fragment). */
export const FLOOR_Y = 43.4;

/**
 * A huge, dark, glossy-looking floor for the crimson stage. It is mostly transparent far away (so the
 * dome's light beams and horizon line show) and darker near the camera, and it mirrors the beams'
 * vertical streaks. The crystals' reflections (mirrored copies in glass.ts) show through it.
 */
const vert = /* glsl */ `
  varying vec3 vW;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const frag = /* glsl */ `
  uniform float uStage;
  varying vec3 vW;
  void main() {
    vec3 dir = vW - cameraPosition;
    float d = length(dir);
    dir /= d;
    float az = atan(dir.x, -dir.z);
    float curtain = 0.55 * pow(0.5 + 0.5 * cos(az * 9.0 + 0.8), 4.0) + 0.45 * pow(0.5 + 0.5 * cos(az * 5.0 - 1.7), 5.0);
    float near = 1.0 - smoothstep(18.0, 200.0, d);
    vec3 col = vec3(0.025, 0.0, 0.006) + vec3(0.7, 0.0, 0.012) * curtain * (0.12 + 0.55 * (1.0 - near));
    float a = uStage * (0.30 + 0.5 * near) * (1.0 - smoothstep(300.0, 900.0, d));
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class StageFloor {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { uStage: { value: 0 } },
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = FLOOR_Y;
    this.mesh.renderOrder = 2; // after the clouds and the dome, before the glass and its reflections
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  update(stage: number): void {
    this.material.uniforms.uStage.value = stage;
    this.mesh.visible = stage > 0.01;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
