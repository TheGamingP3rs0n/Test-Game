// GLB loading with caching + cloning. Every 3D model is a CC0 asset from Kenney
// (kenney.nl): Furniture Kit, Mini Characters, Car Kit, Cube Pets and Food Kit.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { polishObject } from './materials.js';

const loader = new GLTFLoader();
const cache = new Map();
export const loadStats = { total: 0, loaded: 0, failed: [] };

export const SCALE = { furniture: 2, character: 2.3 };

export const CHARACTERS = {
  boss: 'character-male-b', // bald + bearded
  police: 'character-male-c',
  suit: 'character-male-d',
  granny: 'character-female-c',
  coworkers: ['character-male-a', 'character-female-b', 'character-male-e', 'character-female-d', 'character-male-f', 'character-female-f', 'character-female-a', 'character-female-e'],
};

export function modelUrl(kind, name) {
  return `/models/${kind}/${name}.glb`;
}

export function loadGLTF(url) {
  if (!cache.has(url)) {
    loadStats.total++;
    cache.set(
      url,
      new Promise((resolve) => {
        loader.load(
          url,
          (gltf) => {
            loadStats.loaded++;
            polishObject(gltf.scene);
            resolve(gltf);
          },
          undefined,
          (err) => {
            console.warn('Model failed to load', url, err);
            loadStats.loaded++;
            loadStats.failed.push(url);
            resolve(null);
          },
        );
      }),
    );
  }
  return cache.get(url);
}

function placeholder() {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshStandardMaterial({ color: 0xff00ff }));
  const g = new THREE.Group();
  g.add(m);
  return g;
}

/** Clone a model. Skinned meshes get a proper skeleton clone. */
export async function instance(kind, name, { scale } = {}) {
  const gltf = await loadGLTF(modelUrl(kind, name));
  if (!gltf) return placeholder();
  const hasSkin = gltf.scene.getObjectByProperty('type', 'SkinnedMesh');
  const obj = hasSkin ? skeletonClone(gltf.scene) : gltf.scene.clone(true);
  obj.userData.animations = gltf.animations;
  const s = scale ?? (kind === 'furniture' ? SCALE.furniture : kind === 'characters' ? SCALE.character : 1);
  obj.scale.setScalar(s);
  return obj;
}

export async function preload(list, onProgress) {
  let done = 0;
  await Promise.all(
    list.map(([kind, name]) =>
      loadGLTF(modelUrl(kind, name)).then(() => {
        done++;
        onProgress?.(done / list.length);
      }),
    ),
  );
}
