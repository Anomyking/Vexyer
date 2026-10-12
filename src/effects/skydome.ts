import * as THREE from 'three';

/** Gradient sky that blends deep space -> daylight -> dusk from two scalars. One draw call. */
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
  varying vec3 vDir;
  void main() {
    float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 spaceTop = vec3(0.004, 0.007, 0.02);
    vec3 spaceBot = vec3(0.02, 0.035, 0.09);
    vec3 dayTop = vec3(0.1, 0.36, 0.9);
    vec3 dayBot = vec3(0.72, 0.87, 1.0);
    vec3 duskTop = vec3(0.16, 0.2, 0.52);
    vec3 duskBot = vec3(1.0, 0.62, 0.42);
    vec3 top = mix(mix(dayTop, duskTop, uDusk), spaceTop, uSpace);
    vec3 bot = mix(mix(dayBot, duskBot, uDusk), spaceBot, uSpace);
    vec3 c = mix(bot, top, pow(h, 0.65));
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class SkyDome {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { uSpace: { value: 1 }, uDusk: { value: 0 } },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
  }

  update(camera: THREE.PerspectiveCamera, space: number, dusk: number): void {
    this.mesh.position.copy(camera.position);
    this.mesh.scale.setScalar(camera.far * 0.5);
    this.material.uniforms.uSpace.value = space;
    this.material.uniforms.uDusk.value = dusk;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
