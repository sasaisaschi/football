import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * The footballer model: a skinned body from Blender's "Human Base Meshes" (Blender Foundation, CC0 1.0) with motion
 * clips retargeted from the CMU Graphics Lab Motion Capture Database, both built by scripts/figure/build-footballer.py.
 * Loading, kit material and skeleton copies; the posing is in footballer.ts.
 */
/** Height of the model as built (m); each figure is scaled to its player's height. */
export const MODEL_HEIGHT = 1.684;
/** Kit colours of a figure, in the order of the material's colour uniform. */
export const enum Kit { Skin, Shirt, Sleeve, Shorts, Socks, Boots, Hair, Hands, Eyes, Trim }

/**
 * Standard material whose base colour is the kit: the body part comes per vertex from the model (R = (part + 0.5) / 16,
 * scripts/figure/build-footballer.py), and inside a part the shader cuts shirt, shorts, socks and boots at fixed
 * heights of the model in its rest pose, so hems are straight lines whatever the triangles are. The cuts are the same
 * heights at which the build script lets the cloth stand off the skin. Heights in model metres (y up, face towards +z).
 */
export function kitMaterial(palette: THREE.Color[]): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0 });
  mat.onBeforeCompile = shader => {
    shader.uniforms.kitColours = { value: palette };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 bodyPart;
flat varying int vPart;
varying vec3 vRest;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vPart = int(bodyPart.r * 16.0);
vRest = position;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 kitColours[10];
flat varying int vPart;
varying vec3 vRest;
int kit() {
  float y = vRest.y;
  if (vPart == 0) return y < 0.99 ? 3 : 1;                 // torso: shorts, shirt
  if (vPart == 1) return y < 1.44 ? 1 : 0;                 // neck: collar, skin
  if (vPart == 2) return (y > 1.615 || (vRest.z < -0.005 && y > 1.5)) ? 6 : 0; // head: hair, face
  if (vPart == 3) return y > 1.24 ? 1 : y > 1.215 ? 9 : 2; // upper arm: sleeve, its white cuff, then arm
  if (vPart == 4) return 2;                                // forearm (a keeper's long sleeve)
  if (vPart == 5) return 7;                                // hand (a keeper's glove)
  if (vPart == 6) return y > 0.99 ? 1 : y > 0.70 ? 3 : 0;  // thigh: (hip under the shirt), shorts, knee
  if (vPart == 7) return y < 0.115 ? 5 : y < 0.42 ? 4 : y < 0.45 ? 9 : 0; // shin: boot, sock, its band, knee
  if (vPart == 8) return 5;                                // foot: boot
  return 8;                                                // eyes
}`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( kitColours[kit()], opacity );');
  };
  mat.customProgramCacheKey = () => 'footballer-kit';
  return mat;
}
export const SKIN = ['#e3b08c', '#c58a62', '#8f5b3c', '#5a3826'];
export const HAIR = ['#1c130d', '#3b2a1e', '#0d0d0d', '#6b4a2b', '#a9814c'];
/** The loaded model: its skinned mesh and its motion clips. */
export type Model = { scene: THREE.Group; mesh: THREE.SkinnedMesh; clips: THREE.AnimationClip[] };
let model: Promise<Model> | null = null;

/** Loads the figure once (public/models/footballer.glb); a failure is an error, there is no stand-in figure. */
export function loadFootballer(url: string): Promise<Model> {
  model ??= new GLTFLoader().loadAsync(url).then(gltf => {
    let mesh: THREE.SkinnedMesh | null = null;
    gltf.scene.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh; });
    if (!mesh) throw new Error(`${url}: no skinned mesh`);
    return { scene: gltf.scene, mesh, clips: gltf.animations };
  });
  return model;
}

/** A deep copy of a bone hierarchy (names kept, without the dot that glTF loaders strip). */
export function cloneBones(b: THREE.Bone): THREE.Bone {
  const c = b.clone(false) as THREE.Bone;
  c.name = b.name.replace('.', '');
  for (const child of b.children) if ((child as THREE.Bone).isBone) c.add(cloneBones(child as THREE.Bone));
  return c;
}
