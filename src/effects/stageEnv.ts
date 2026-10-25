import * as THREE from 'three';

/**
 * A tiny studio for the glass to reflect and refract: a dark crimson room, tall bright strip lights at
 * different angles, a soft box overhead and a glossy dark floor. It is baked once with PMREM, so at
 * runtime it costs a single texture. Real glass looks real mostly because of what it mirrors; flat
 * ambient light gives flat glass, and crisp strip lights give crisp bands on every facet.
 */
export function buildStageEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(60, 40, 60), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 0.004, 0.012), side: THREE.BackSide }));
  scene.add(room);

  const light = (w: number, h: number, x: number, y: number, z: number, power: number, c = new THREE.Color(1.0, 0.22, 0.16)) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(power), side: THREE.DoubleSide, toneMapped: false }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    scene.add(m);
  };
  // Tall strips (the "curtain" of beams), a hard white key from camera-left, soft overhead box.
  light(2.2, 34, -26, 2, -14, 7);
  light(1.4, 34, -10, 2, -28, 11);
  light(3.0, 34, 8, 2, -27, 8);
  light(1.2, 34, 25, 2, -12, 10);
  light(0.6, 30, -27, 0, 12, 2.5, new THREE.Color(1, 0.7, 0.66));
  light(1.6, 30, 26, 0, 14, 6);
  light(26, 10, 0, 19, -4, 3.5, new THREE.Color(1, 0.4, 0.34));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.03, 0.0, 0.006) }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -12;
  scene.add(floor);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(scene, 0.015).texture;
  pmrem.dispose();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  });
  return tex;
}
