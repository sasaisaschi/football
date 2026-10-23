import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/**
 * Daylight of the client's reference picture: a high afternoon sun behind the far stand (its shadows fall towards the
 * camera, to the lower right of the picture), a pale blue sky, haze over the far stands, and image-based light so
 * fabric, skin and the white goal frame are shaded softly instead of by one hard lamp.
 */
export function createDaylight(scene: THREE.Scene, renderer: THREE.WebGLRenderer): { sun: THREE.DirectionalLight } {
  scene.background = skyTexture();
  scene.fog = new THREE.Fog('#b9c9d8', 150, 420);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xdde8f5, 0x5b6b2c, 0.7));
  // The sun casts the player and ball shadows; the scene moves its shadow area with play (scene-view.ts).
  const sun = new THREE.DirectionalLight(0xfff0d8, 3.1);
  sun.position.set(-45, 70, -40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 50, bottom: -50, near: 10, far: 240 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  return { sun };
}

/** A vertical gradient from deep blue overhead to a pale horizon, as an equirectangular background. */
function skyTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#5f8fc4');
  grad.addColorStop(0.45, '#a9c4de');
  grad.addColorStop(0.5, '#cfdbe6');
  grad.addColorStop(1, '#cfdbe6');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
