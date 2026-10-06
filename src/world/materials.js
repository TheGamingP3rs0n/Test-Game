// Kenney models ship with flat, fully-rough materials. This gives them believable
// surfaces (varnished wood, brushed metal, see-through glass, glowing bulbs) so they
// react properly to the baked reflection probe, rect-area lights and bloom.
import * as THREE from 'three';

const RULES = [
  [/glass/i, { roughness: 0.04, metalness: 0, opacity: 0.18, transparent: true, depthWrite: false, envMapIntensity: 1.6, castShadow: false }],
  [/^lamp/i, { roughness: 0.4, emissive: 0xffd889, emissiveIntensity: 0.55 }],
  [/metalLight/i, { roughness: 0.35, metalness: 0.45, envMapIntensity: 0.9 }],
  [/metalDark/i, { roughness: 0.42, metalness: 0.5, envMapIntensity: 0.8 }],
  [/metalMedium/i, { roughness: 0.4, metalness: 0.55, envMapIntensity: 0.85 }],
  [/metal/i, { roughness: 0.32, metalness: 0.6, envMapIntensity: 0.9 }],
  [/wood/i, { roughness: 0.48, metalness: 0, envMapIntensity: 0.7 }],
  [/carpet|fabric|cloth|cushion/i, { roughness: 0.95, metalness: 0, envMapIntensity: 0.3 }],
  [/plant|leaf|leaves|green/i, { roughness: 0.65, envMapIntensity: 0.5 }],
  [/_defaultMat|white|plaster/i, { roughness: 0.75, envMapIntensity: 0.5 }],
  [/colormap|texture/i, { roughness: 0.7, envMapIntensity: 0.55 }],
];

export function polishMaterial(mat) {
  if (!mat || mat.userData.polished) return mat;
  mat.userData.polished = true;
  const name = mat.name || (mat.map ? 'colormap' : '');
  const rule = RULES.find(([re]) => re.test(name))?.[1] || { roughness: 0.68, envMapIntensity: 0.55 };
  const { castShadow, emissive, ...props } = rule;
  for (const [k, v] of Object.entries(props)) if (k in mat) mat[k] = v;
  if (emissive !== undefined && mat.emissive) mat.emissive.set(emissive);
  if (castShadow === false) mat.userData.noShadow = true;
  if (mat.map) mat.map.anisotropy = 8;
  mat.needsUpdate = true;
  return mat;
}

export function polishObject(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach(polishMaterial);
    o.castShadow = !mats.some((m) => m.userData.noShadow);
    o.receiveShadow = true;
  });
}

/** Shared materials for the props built in code. */
export const M = {
  plastic: (color, rough = 0.45) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, envMapIntensity: 0.8 }),
  metal: (color, rough = 0.3) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.75, envMapIntensity: 1 }),
  matte: (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, envMapIntensity: 0.3 }),
  glow: (color, intensity = 2) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.5 }),
  glass: (color = 0xcfe9ff, opacity = 0.16) => new THREE.MeshPhysicalMaterial({ color, transparent: true, opacity, roughness: 0.03, metalness: 0, envMapIntensity: 1.6, depthWrite: false }),
};
