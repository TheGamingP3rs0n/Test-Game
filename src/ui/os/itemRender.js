// Renders the stylized Scamazon item models (itemModels.js) to small product-shot PNGs
// using a single offscreen WebGL renderer. Results are cached per id, so each model is
// only rendered once. Falls back to null if WebGL isn't available (caller shows an icon).
import * as THREE from 'three';
import { buildItemModel, hasItemModel } from './itemModels.js';

const SIZE = 256;
const cache = new Map();
let renderer = null;
let scene = null;
let camera = null;
let failed = false;

function ensure() {
  if (renderer || failed) return !failed;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(SIZE, SIZE);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    const key = new THREE.DirectionalLight(0xffffff, 2.6); key.position.set(3, 5, 4); scene.add(key);
    const fill = new THREE.DirectionalLight(0xcfe0ff, 0.9); fill.position.set(-4, 1.5, 2.5); scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 1.6); rim.position.set(-1, 3.5, -5); scene.add(rim);
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  } catch (err) {
    console.warn('item renderer unavailable', err);
    failed = true;
    renderer = null;
  }
  return !failed;
}

function disposeModel(model) {
  model.traverse((o) => {
    o.geometry?.dispose?.();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
  });
}

/** Data-URL of a product shot for `id` (cached), or null if we can't render it. */
export function renderItemThumb(id) {
  if (cache.has(id)) return cache.get(id);
  if (!hasItemModel(id) || !ensure()) { cache.set(id, null); return null; }
  try {
    const model = buildItemModel(id);
    model.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    scene.add(model);
    const bbox = new THREE.Box3().setFromObject(model);
    const center = bbox.getCenter(new THREE.Vector3());
    const size = bbox.getSize(new THREE.Vector3());
    model.position.sub(center); // center at origin
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const dist = maxDim * 2.1;
    camera.position.set(dist * 0.72, dist * 0.52, dist * 0.95);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    scene.remove(model);
    disposeModel(model);
    cache.set(id, url);
    return url;
  } catch (err) {
    console.warn('item render failed', id, err);
    cache.set(id, null);
    return null;
  }
}

/** Free the offscreen renderer once a batch of thumbnails is done (optional). */
export function releaseItemRenderer() {
  if (renderer) { try { renderer.dispose(); renderer.forceContextLoss?.(); } catch { /* noop */ } }
  renderer = null; scene = null; camera = null;
}
