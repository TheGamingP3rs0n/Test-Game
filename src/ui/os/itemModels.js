// Tiny stylized 3D props for the Scamazon catalogue, built from primitives (Kenney-ish
// low-poly cartoon look). itemRender.js renders each one to a cached product-shot image.
// All parody props — the "weapons" are deliberately blocky and toy-like.
import * as THREE from 'three';

const mat = (color, { rough = 0.6, metal = 0.0, emissive = 0x000000, ei = 0 } = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive, emissiveIntensity: ei });
const box = (w, h, d, m, pos = [0, 0, 0], rot = [0, 0, 0]) => {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(...pos); o.rotation.set(...rot); return o;
};
const cyl = (rt, rb, h, m, pos = [0, 0, 0], rot = [0, 0, 0], seg = 20) => {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m); o.position.set(...pos); o.rotation.set(...rot); return o;
};
const sph = (r, m, pos = [0, 0, 0]) => { const o = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 16), m); o.position.set(...pos); return o; };
const cone = (r, h, m, pos = [0, 0, 0], rot = [0, 0, 0], seg = 20) => { const o = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), m); o.position.set(...pos); o.rotation.set(...rot); return o; };
const torus = (r, t, m, pos = [0, 0, 0], rot = [0, 0, 0], arc = Math.PI * 2) => { const o = new THREE.Mesh(new THREE.TorusGeometry(r, t, 12, 28, arc), m); o.position.set(...pos); o.rotation.set(...rot); return o; };
const G = (...kids) => { const g = new THREE.Group(); for (const k of kids) if (k) g.add(k); return g; };

const steel = () => mat(0x2b2f33, { metal: 0.5, rough: 0.3 });
const chrome = () => mat(0xc2c8cd, { metal: 0.85, rough: 0.2 });
const glassMat = () => new THREE.MeshPhysicalMaterial({ color: 0xbcd6e6, transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0 });

const MODELS = {
  // ---- scam tools / upgrades ----
  leads: () => {
    const g = G(); const paper = mat(0xf2e9cf);
    for (let i = 0; i < 6; i++) g.add(box(0.95, 0.06, 0.68, paper, [(Math.random() - 0.5) * 0.05, 0.03 + i * 0.07, (Math.random() - 0.5) * 0.05], [0, (Math.random() - 0.5) * 0.15, 0]));
    g.add(box(0.06, 0.46, 0.7, mat(0xc0392b), [0.05, 0.22, 0]));
    return g;
  },
  accent: () => { const b = mat(0x24262a, { rough: 0.35 }); return G(box(0.95, 0.14, 0.16, b, [0, 0.28, 0], [0, 0, 0.14]), cyl(0.15, 0.15, 0.16, b, [-0.46, 0.2, 0], [Math.PI / 2, 0, 0]), cyl(0.15, 0.15, 0.16, b, [0.46, 0.2, 0], [Math.PI / 2, 0, 0]), box(0.08, 0.08, 0.3, mat(0x2b6cff, { emissive: 0x11306b, ei: 0.4 }), [0, 0.28, 0])); },
  whodat: () => { const g = G(torus(0.34, 0.07, chrome(), [0, 0.1, 0], [0.5, 0, 0]), new THREE.Mesh(new THREE.CircleGeometry(0.3, 28), glassMat())); g.children[1].position.set(0, 0.1, 0.01); g.children[1].rotation.x = 0.5; g.add(cyl(0.05, 0.06, 0.5, mat(0x5a3a1a), [0.3, -0.28, -0.14], [0.5, 0, -0.75])); return g; },
  bribe: () => { const g = G(); const cash = mat(0x2f8f4e); for (let i = 0; i < 5; i++) g.add(box(0.85, 0.1, 0.42, cash, [0, 0.05 + i * 0.12, 0])); g.add(box(0.2, 0.64, 0.44, mat(0xf2e2a6), [0, 0.3, 0])); g.add(sph(0.08, mat(0xf5c542, { metal: 0.6 }), [0, 0.68, 0])); return g; },
  // ---- business apps ----
  vpn: () => { const body = mat(0xf5b400, { metal: 0.3, rough: 0.35 }); return G(box(0.5, 0.42, 0.26, body, [0, -0.05, 0]), torus(0.2, 0.06, chrome(), [0, 0.22, 0], [0, 0, 0], Math.PI), cyl(0.05, 0.05, 0.14, mat(0x222), [0, -0.05, 0.14], [Math.PI / 2, 0, 0])); },
  antivirus: () => { const sh = mat(0x2b6cff, { rough: 0.4 }); const chk = mat(0xffffff); const g = G(box(0.6, 0.5, 0.12, sh, [0, 0.12, 0]), cone(0.42, 0.42, sh, [0, -0.25, 0], [0, Math.PI / 4, 0], 4), box(0.12, 0.1, 0.14, chk, [-0.1, 0.1, 0.02], [0, 0, -0.7]), box(0.26, 0.1, 0.14, chk, [0.08, 0.16, 0.02], [0, 0, 0.7])); return g; },
  shredder: () => { const g = G(box(0.95, 0.5, 0.55, mat(0x3a3f44, { rough: 0.5 }), [0, 0, 0]), box(0.95, 0.18, 0.55, mat(0x555b61, { rough: 0.5 }), [0, 0.3, 0]), box(0.72, 0.04, 0.09, mat(0x111), [0, 0.4, 0])); const strip = mat(0xf2e9cf); for (let i = 0; i < 5; i++) g.add(box(0.07, 0.34, 0.02, strip, [-0.28 + i * 0.14, 0.6, 0], [0, 0, (Math.random() - 0.5) * 0.5])); return g; },
  ganesha: () => { const gold = mat(0xffcf5a, { metal: 0.9, rough: 0.25, emissive: 0x3a2a00, ei: 0.25 }); return G(cyl(0.42, 0.48, 0.16, gold, [0, -0.32, 0]), sph(0.32, gold, [0, 0.0, 0]), sph(0.23, gold, [0, 0.33, 0]), cyl(0.05, 0.05, 0.26, gold, [0, 0.27, 0.2], [0.9, 0, 0]), cone(0.1, 0.18, gold, [0, 0.55, 0])); },
  chai: () => { const cup = mat(0xece6da); const g = G(cyl(0.3, 0.23, 0.32, cup, [0, 0.02, 0]), cyl(0.42, 0.42, 0.04, cup, [0, -0.16, 0]), torus(0.12, 0.03, cup, [0.33, 0.04, 0], [0, Math.PI / 2, 0]), cyl(0.27, 0.27, 0.02, mat(0x7a4a22), [0, 0.16, 0])); return g; },
  headset: () => { const b = mat(0x222, { rough: 0.4 }); return G(torus(0.4, 0.05, b, [0, 0.12, 0], [Math.PI, 0, 0], Math.PI), box(0.2, 0.28, 0.16, b, [-0.4, -0.02, 0]), box(0.2, 0.28, 0.16, b, [0.4, -0.02, 0]), cyl(0.02, 0.02, 0.45, b, [0.4, -0.12, 0.27], [0.6, 0, 0]), sph(0.06, mat(0x2b6cff, { emissive: 0x11306b, ei: 0.5 }), [0.4, -0.32, 0.46])); },
  // ---- physical goods (blocky parody weapons) ----
  mace: () => { const can = mat(0x9b4dff, { metal: 0.3, rough: 0.35 }); return G(cyl(0.22, 0.22, 0.7, can, [0, 0, 0]), cyl(0.1, 0.1, 0.16, mat(0x222), [0, 0.43, 0]), box(0.14, 0.07, 0.14, mat(0xffcf5a), [0, 0.52, 0.06]), cyl(0.2, 0.2, 0.08, mat(0xffffff), [0, 0.1, 0])); },
  sniper: () => { const b = steel(); const g = G(box(1.4, 0.13, 0.15, b, [0, 0, 0]), cyl(0.045, 0.045, 0.6, b, [0.82, 0.03, 0], [0, 0, Math.PI / 2]), box(0.32, 0.32, 0.12, b, [-0.52, -0.2, 0], [0, 0, -0.3]), cyl(0.08, 0.08, 0.42, b, [0.1, 0.2, 0], [0, 0, Math.PI / 2]), sph(0.07, mat(0x9fd4ff, { emissive: 0x16304a, ei: 0.5 }), [0.3, 0.2, 0]), box(0.5, 0.1, 0.03, b, [0.2, -0.1, 0])); return g; },
  shotgun: () => { const wood = mat(0x4a3524, { rough: 0.6 }); const m = steel(); return G(box(1.0, 0.13, 0.15, m, [0.1, 0.05, 0]), cyl(0.05, 0.05, 0.9, m, [0.35, 0.12, 0.045], [0, 0, Math.PI / 2]), cyl(0.05, 0.05, 0.9, m, [0.35, 0.12, -0.045], [0, 0, Math.PI / 2]), box(0.42, 0.28, 0.12, wood, [-0.52, -0.05, 0], [0, 0, -0.3]), box(0.3, 0.12, 0.11, wood, [0.1, -0.03, 0])); },
  shield: () => { const sh = steel(); const g = G(box(0.72, 1.02, 0.07, sh, [0, 0, 0]), box(0.5, 0.82, 0.08, glassMat(), [0, 0.06, 0.02]), box(0.44, 0.09, 0.1, mat(0xf5b400), [0, -0.32, 0.04])); g.rotation.y = 0.35; return g; },
  taser: () => { const yellow = mat(0xf5b400, { rough: 0.4 }); const dark = mat(0x222); return G(box(0.26, 0.42, 0.18, dark, [0, -0.12, 0], [0, 0, 0.12]), box(0.32, 0.22, 0.2, yellow, [0.02, 0.16, 0]), cyl(0.02, 0.02, 0.22, chrome(), [-0.05, 0.34, 0]), cyl(0.02, 0.02, 0.22, chrome(), [0.09, 0.34, 0]), sph(0.05, mat(0x66ccff, { emissive: 0x2266ff, ei: 1.1 }), [0.02, 0.46, 0])); },
  baton: () => { const b = mat(0x222, { rough: 0.4 }); return G(cyl(0.05, 0.075, 1.0, b, [0, 0, 0], [0, 0, 0.32]), cyl(0.065, 0.065, 0.22, mat(0x3a3a3a), [-0.16, -0.47, 0], [0, 0, 0.32]), sph(0.06, b, [0.3, 0.46, 0])); },
  traq: () => { const grn = mat(0x2fab5e, { rough: 0.4 }); const dark = mat(0x222); return G(box(0.6, 0.14, 0.13, grn, [0.1, 0.1, 0]), box(0.16, 0.32, 0.12, dark, [-0.16, -0.08, 0], [0, 0, 0.2]), cyl(0.032, 0.032, 0.32, chrome(), [0.46, 0.1, 0], [0, 0, Math.PI / 2]), cyl(0.016, 0.016, 0.2, mat(0xff6b6b), [0.58, 0.1, 0], [0, 0, Math.PI / 2]), cone(0.03, 0.08, mat(0xff6b6b), [0.7, 0.1, 0], [0, 0, -Math.PI / 2])); },
  ak: () => { const m = steel(); const wood = mat(0x6b4a2a, { rough: 0.6 }); return G(box(1.1, 0.12, 0.12, m, [0, 0, 0]), cyl(0.04, 0.04, 0.5, m, [0.68, 0.04, 0], [0, 0, Math.PI / 2]), box(0.34, 0.32, 0.1, m, [-0.12, -0.24, 0], [0, 0, 0.12]), box(0.42, 0.14, 0.1, wood, [-0.56, 0.02, 0]), box(0.22, 0.13, 0.1, wood, [0.22, 0.08, 0]), box(0.28, 0.32, 0.1, m, [0.12, -0.26, 0], [0, 0, -0.3])); },
  javelin: () => { const tube = mat(0x3a5a3a, { rough: 0.6 }); return G(cyl(0.18, 0.18, 1.3, tube, [0, 0, 0], [0, 0, Math.PI / 2]), cyl(0.2, 0.2, 0.1, mat(0x222), [-0.66, 0, 0], [0, 0, Math.PI / 2]), cyl(0.21, 0.21, 0.08, mat(0x222), [0.66, 0, 0], [0, 0, Math.PI / 2]), box(0.32, 0.1, 0.1, mat(0x222), [0.05, -0.22, 0]), sph(0.06, mat(0x66ccff, { emissive: 0x2266ff, ei: 0.7 }), [-0.3, 0.1, 0.12])); },
  // ---- games & software (novelty) ----
  'nov-airstrike-self': () => { const b = mat(0xb3261e, { rough: 0.4 }); const g = G(cyl(0.24, 0.24, 0.9, b, [0, 0, 0]), cone(0.24, 0.36, b, [0, 0.63, 0]), cyl(0.1, 0.1, 0.1, mat(0xffcf5a), [0, -0.5, 0])); const fin = mat(0x222); for (let i = 0; i < 4; i++) { const f = box(0.04, 0.26, 0.22, fin, [0, -0.42, 0]); const h = new THREE.Group(); h.add(f); f.position.set(0.16, -0.42, 0); h.rotation.y = i * Math.PI / 2; g.add(h); } return g; },
  'nov-cookie': () => { const c = mat(0xc9924e, { rough: 0.85 }); const g = G(cyl(0.52, 0.52, 0.15, c, [0, 0, 0])); const chip = mat(0x4a2a12); for (let i = 0; i < 8; i++) { const a = Math.random() * 6.28, r = Math.random() * 0.36; g.add(sph(0.055, chip, [Math.cos(a) * r, 0.09, Math.sin(a) * r])); } return g; },
  'nov-nitro': () => { const bx = mat(0x5865f2, { rough: 0.4 }); const rib = mat(0xffcf5a); return G(box(0.7, 0.58, 0.7, bx, [0, 0, 0]), box(0.14, 0.6, 0.72, rib), box(0.72, 0.6, 0.14, rib), box(0.22, 0.22, 0.22, rib, [0, 0.38, 0]), torus(0.12, 0.04, rib, [-0.1, 0.46, 0], [0, 0, 0.3])); },
};

/** Build a fresh THREE.Group for an item id, or null if we have no model for it. */
export function buildItemModel(id) {
  const make = MODELS[id];
  return make ? make() : null;
}

export function hasItemModel(id) {
  return !!MODELS[id];
}
