// Builds the call-center floor out of Kenney's CC0 furniture models plus props the
// furniture kit doesn't have (breaker box, shredder, router, desk phone, blinds...).
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { instance, preload, CHARACTERS } from './assets.js';
import { NPC } from './npc.js';
import { M } from './materials.js';
import { SUN_DIR } from './lighting.js';
import {
  posterTexture, quotaBoardTexture, drawQuotaBoard, screenTexture, drawScreen, skyTexture, buildingTexture,
  signTexture, canvasTexture, terrazzoMaps, dropCeilingTexture, clockTexture, drawClock, founderPortraitTexture, exitSignTexture,
} from './textures.js';
import { pick } from '../core/util.js';

export const ROOM = { minX: -9, maxX: 9, minZ: -6, maxZ: 6, height: 2.9 };
const ROW_Z = [-3.2, -0.4, 2.4];
const DESK_X = [-6.8, -5.2, -3.6, -2.0, -0.4];
export const PLAYER_DESK = { x: -2.0, z: 2.4 };

const FURNITURE = [
  'desk', 'chairDesk', 'computerScreen', 'computerKeyboard', 'computerMouse', 'wall', 'wallWindow', 'wallDoorway',
  'ceilingFan', 'kitchenCabinet', 'kitchenCoffeeMachine', 'kitchenMicrowave', 'kitchenFridge', 'pottedPlant', 'plantSmall1',
  'plantSmall2', 'plantSmall3', 'bookcaseClosedWide', 'bookcaseOpen', 'books', 'deskCorner', 'loungeChair', 'loungeSofa', 'sideTable',
  'trashcan', 'cardboardBoxClosed', 'cardboardBoxOpen', 'coatRackStanding', 'laptop', 'radio', 'table',
  'rugRectangle', 'tableCoffee', 'lampRoundFloor', 'speakerSmall',
];

/**
 * Wrap a model in a pivot so (x, z) is its footprint centre, y=0 its bottom, and
 * rotY spins it around that centre. Kenney models have corner origins.
 */
function pivot(model, { x = 0, y = 0, z = 0, rotY = 0 } = {}) {
  const g = new THREE.Group();
  const box = new THREE.Box3().setFromObject(model);
  const c = box.getCenter(new THREE.Vector3());
  model.position.sub(new THREE.Vector3(c.x, box.min.y, c.z));
  g.add(model);
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  g.userData.size = box.getSize(new THREE.Vector3());
  return g;
}

function box(w, h, d, material, pos, parent, { cast = true } = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(...pos);
  m.castShadow = cast;
  m.receiveShadow = true;
  parent?.add(m);
  return m;
}

export class Office {
  constructor(scene, { renderer, rig, quality }) {
    this.scene = scene;
    this.renderer = renderer;
    this.rig = rig;
    this.quality = quality;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.interactables = [];
    this.colliders = [];
    this.coworkers = [];
    this.police = [];
    this.fans = [];
    this.coworkerScreens = [];
    this.npcs = [];
    this.windowRects = [];
    this.powered = true;
    this.time = 0;
    this.lastClockMinute = -1;
  }

  async build(onProgress) {
    await preload([
      ...FURNITURE.map((n) => ['furniture', n]),
      ...[CHARACTERS.boss, CHARACTERS.police, ...CHARACTERS.coworkers].map((n) => ['characters', n]),
      ['vehicles', 'police'], ['vehicles', 'taxi'], ['vehicles', 'van'], ['animals', 'animal-cow'], ['food', 'cup-tea'], ['food', 'pizza-box'], ['food', 'mug'],
    ], onProgress);

    this.buildShell();
    this.buildOutside();
    await this.buildWalls();
    this.buildLights();
    await this.buildDesks();
    await this.buildKitchen();
    await this.buildBossOffice();
    await this.buildProps();
    await this.buildDecor();
    await this.buildCharacters();
  }

  // ---------------------------------------------------------------- structure
  buildShell() {
    const w = ROOM.maxX - ROOM.minX;
    const d = ROOM.maxZ - ROOM.minZ;
    // polished terrazzo floor (+ planar reflections on High/Ultra)
    const maps = terrazzoMaps([w / 2.4, d / 2.4]);
    this.floorMat = new THREE.MeshStandardMaterial({ ...maps, roughness: 1, metalness: 0, envMapIntensity: 0.6, normalScale: new THREE.Vector2(0.8, 0.8) });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.root.add(floor);
    this.floor = floor;
    if (this.quality.reflections) this.addFloorReflections(w, d);

    const ceilTex = dropCeilingTexture([w / 2.4, d / 2.4]);
    // a little self-illumination stands in for light bouncing off the desks onto the tiles
    this.ceilMat = new THREE.MeshStandardMaterial({ map: ceilTex, emissiveMap: ceilTex, emissive: 0x3a352c, roughness: 0.95, envMapIntensity: 0.3 });
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), this.ceilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = ROOM.height;
    ceil.receiveShadow = true;
    this.root.add(ceil);

    this.colliders.push(
      { minX: -99, maxX: ROOM.minX + 0.15, minZ: -99, maxZ: 99 },
      { minX: ROOM.maxX - 0.15, maxX: 99, minZ: -99, maxZ: 99 },
      { minX: -99, maxX: 99, minZ: -99, maxZ: ROOM.minZ + 0.15 },
      { minX: -99, maxX: 99, minZ: ROOM.maxZ - 0.15, maxZ: 99 },
    );
  }

  /** A blurred, fresnel-weighted planar reflection blended into the floor shader. */
  addFloorReflections(w, d) {
    const pr = this.renderer.getPixelRatio();
    const reflector = new Reflector(new THREE.PlaneGeometry(w, d), {
      textureWidth: Math.floor(window.innerWidth * pr * 0.5),
      textureHeight: Math.floor(window.innerHeight * pr * 0.5),
      clipBias: 0.003,
    });
    reflector.rotation.x = -Math.PI / 2;
    reflector.position.y = -0.001;
    reflector.material.colorWrite = false;
    reflector.material.depthWrite = false;
    reflector.renderOrder = -100;
    const baseBefore = reflector.onBeforeRender;
    reflector.onBeforeRender = function (renderer, scene, camera) {
      if (scene.overrideMaterial) return; // skip during the AO normal pass
      baseBefore.call(this, renderer, scene, camera);
    };
    this.root.add(reflector);
    this.reflector = reflector;
    const tex = reflector.getRenderTarget().texture;
    const texMatrix = reflector.material.uniforms.textureMatrix;
    this.floorMat.onBeforeCompile = (shader) => {
      shader.uniforms.tReflect = { value: tex };
      shader.uniforms.uTexMatrix = texMatrix;
      shader.uniforms.uReflectStrength = { value: 0.55 };
      shader.vertexShader = 'uniform mat4 uTexMatrix;\nvarying vec4 vReflCoord;\n' + shader.vertexShader.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n  vReflCoord = uTexMatrix * modelMatrix * vec4(transformed, 1.0);',
      );
      shader.fragmentShader = 'uniform sampler2D tReflect;\nuniform float uReflectStrength;\nvarying vec4 vReflCoord;\n' + shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        /* glsl */ `{
          vec2 ruv = vReflCoord.xy / vReflCoord.w + normal.xy * 0.012;
          vec2 px = vec2(0.0016, 0.0024) * (0.6 + roughnessFactor * 3.0);
          vec3 refl = texture2D(tReflect, ruv).rgb * 0.28
            + texture2D(tReflect, ruv + vec2(px.x, 0.0)).rgb * 0.12 + texture2D(tReflect, ruv - vec2(px.x, 0.0)).rgb * 0.12
            + texture2D(tReflect, ruv + vec2(0.0, px.y)).rgb * 0.12 + texture2D(tReflect, ruv - vec2(0.0, px.y)).rgb * 0.12
            + texture2D(tReflect, ruv + px * 2.0).rgb * 0.06 + texture2D(tReflect, ruv - px * 2.0).rgb * 0.06
            + texture2D(tReflect, ruv + vec2(px.x, -px.y) * 2.0).rgb * 0.06 + texture2D(tReflect, ruv + vec2(-px.x, px.y) * 2.0).rgb * 0.06;
          vec3 V = normalize(vViewPosition);
          float NdV = clamp(dot(normal, V), 0.0, 1.0);
          float fres = 0.18 + 0.82 * pow(1.0 - NdV, 4.0);
          float gloss = clamp(1.0 - roughnessFactor * 1.15, 0.0, 1.0);
          outgoingLight += refl * uReflectStrength * fres * gloss;
        }
        #include <opaque_fragment>`,
      );
    };
    this.floorMat.needsUpdate = true;
  }

  buildOutside() {
    this.scene.background = skyTexture();
    this.scene.fog = new THREE.Fog(0xf2b981, 28, 70);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 40), M.matte(0x5f5a52));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -3.2, -26);
    ground.receiveShadow = true;
    this.root.add(ground);
    const sidewalk = new THREE.Mesh(new THREE.PlaneGeometry(90, 2.8), M.matte(0x9d978a));
    sidewalk.rotation.x = -Math.PI / 2;
    sidewalk.position.set(0, -3.15, -7.6);
    this.root.add(sidewalk);
    for (let x = -40; x < 40; x += 4) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 0.15), M.matte(0xf2e9c9));
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, -3.19, -12);
      this.root.add(m);
    }
    for (let i = 0; i < 11; i++) {
      const h = 9 + Math.random() * 16;
      const w = 5 + Math.random() * 4;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 6), new THREE.MeshStandardMaterial({ map: buildingTexture(i), roughness: 0.9, envMapIntensity: 0.2 }));
      b.position.set(-38 + i * 7.6, h / 2 - 3.2, -21 - Math.random() * 3);
      b.castShadow = true;
      b.receiveShadow = true;
      this.root.add(b);
    }
    // overhead power-line tangle across the street
    const cableMat = M.matte(0x1a1a1a);
    for (let i = 0; i < 6; i++) {
      const pts = [];
      const y = 0.6 + i * 0.25;
      for (let t = 0; t <= 20; t++) {
        const x = -40 + t * 4;
        pts.push(new THREE.Vector3(x, y - Math.sin((t / 20) * Math.PI * 4) * 0.4, -9.5 - i * 0.12));
      }
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 0.015, 4), cableMat);
      this.root.add(tube);
    }
    // our building's outer shell
    box(18.2, 0.5, 12.1, M.matte(0x8a7f6c), [0, ROOM.height + 0.25, 0], this.root);
    box(20, 3.2, 14, M.matte(0x8a7f6c), [0, -1.61, 0], this.root, { cast: false });
  }

  async buildWalls() {
    const plaster = new THREE.MeshStandardMaterial({ color: 0xe7dcc0, roughness: 0.8, envMapIntensity: 0.4 });
    const paint = new THREE.MeshStandardMaterial({ color: 0x4f7f6f, roughness: 0.55, envMapIntensity: 0.6 });
    const rail = new THREE.MeshStandardMaterial({ color: 0x6e4f33, roughness: 0.45, envMapIntensity: 0.7 });
    const segs = [];
    for (let x = ROOM.minX; x < ROOM.maxX; x += 2) segs.push({ x: x + 1, z: ROOM.minZ, rot: 0, kind: 'wallWindow' });
    for (let x = ROOM.minX; x < ROOM.maxX; x += 2) segs.push({ x: x + 1, z: ROOM.maxZ, rot: Math.PI, kind: 'wall' });
    for (let z = ROOM.minZ; z < ROOM.maxZ; z += 2) segs.push({ x: ROOM.minX, z: z + 1, rot: Math.PI / 2, kind: 'wall' });
    for (let z = ROOM.minZ; z < ROOM.maxZ; z += 2) segs.push({ x: ROOM.maxX, z: z + 1, rot: -Math.PI / 2, kind: Math.abs(z + 1 - 3) < 0.1 ? 'wallDoorway' : 'wall' });
    for (const s of segs) {
      const m = await instance('furniture', s.kind);
      // every wall piece gets the warm plaster instead of Kenney's flat white
      m.traverse((o) => {
        if (!o.isMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const swapped = mats.map((mt) => (/_defaultMat/i.test(mt.name) ? plaster : mt));
        o.material = Array.isArray(o.material) ? swapped : swapped[0];
      });
      const p = pivot(m, { x: s.x, z: s.z, rotY: s.rot });
      p.scale.y = ROOM.height / (p.userData.size.y || ROOM.height);
      this.root.add(p);
      if (s.kind === 'wallWindow') {
        p.updateMatrixWorld(true);
        const win = m.getObjectByName('window');
        if (win) {
          const b = new THREE.Box3().setFromObject(win);
          this.windowRects.push({ minX: b.min.x + 0.07, maxX: b.max.x - 0.07, minY: b.min.y + 0.07, maxY: b.max.y - 0.07, z: (b.min.z + b.max.z) / 2 });
        }
      } else if (s.kind === 'wall') {
        // two-tone paint: dado band + wooden chair rail (very government-office)
        const g = new THREE.Group();
        box(2.0, 1.05, 0.02, paint, [0, 0.525, 0.045], g, { cast: false });
        box(2.0, 0.05, 0.035, rail, [0, 1.07, 0.05], g, { cast: false });
        g.position.set(s.x, 0, s.z);
        g.rotation.y = s.rot; // local +z points into the room
        this.root.add(g);
      }
    }
    // window blinds: half lowered, slats tilted → striped sunbeams
    const slatMat = new THREE.MeshStandardMaterial({ color: 0xe9e1cf, roughness: 0.5, envMapIntensity: 0.6, side: THREE.DoubleSide });
    const slats = [];
    for (const r of this.windowRects) {
      const top = r.maxY;
      const bottom = r.maxY - (r.maxY - r.minY) * 0.48;
      for (let y = top - 0.02; y > bottom; y -= 0.055) slats.push({ x: (r.minX + r.maxX) / 2, y, z: r.z + 0.09, w: r.maxX - r.minX + 0.12 });
      box(r.maxX - r.minX + 0.16, 0.05, 0.08, slatMat, [(r.minX + r.maxX) / 2, top + 0.04, r.z + 0.09], this.root);
      box(r.maxX - r.minX + 0.12, 0.025, 0.05, slatMat, [(r.minX + r.maxX) / 2, bottom - 0.01, r.z + 0.09], this.root);
    }
    const slatGeo = new THREE.BoxGeometry(1, 0.006, 0.05);
    const inst = new THREE.InstancedMesh(slatGeo, slatMat, slats.length);
    const mtx = new THREE.Matrix4();
    slats.forEach((s, i) => {
      mtx.compose(new THREE.Vector3(s.x, s.y, s.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.65, 0, 0)), new THREE.Vector3(s.w, 1, 1));
      inst.setMatrixAt(i, mtx);
    });
    inst.castShadow = true;
    inst.receiveShadow = true;
    this.root.add(inst);
    this.blinds = inst;
  }

  buildLights() {
    // fixture housings + glowing diffusers; the actual light comes from RectAreaLights
    this.diffuserMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3dc, emissiveIntensity: 1.6, roughness: 0.4 });
    const frameMat = M.metal(0xd6d3cc, 0.35);
    const fixtures = [];
    for (const x of [-5.6, -1.6]) for (const z of [-3.0, -0.2, 2.6]) fixtures.push({ x, z, w: 2.4, d: 0.6, intensity: 3.2 });
    fixtures.push({ x: 2.2, z: -3.4, w: 1.2, d: 0.6, intensity: 3 }, { x: 2.2, z: 2.4, w: 1.2, d: 0.6, intensity: 3 }, { x: 6.6, z: 2.6, w: 1.2, d: 0.6, intensity: 2.6 });
    for (const f of fixtures) {
      box(f.w + 0.08, 0.06, f.d + 0.08, frameMat, [f.x, ROOM.height - 0.03, f.z], this.root, { cast: false });
      const diff = new THREE.Mesh(new THREE.PlaneGeometry(f.w, f.d), this.diffuserMat);
      diff.rotation.x = Math.PI / 2;
      diff.position.set(f.x, ROOM.height - 0.065, f.z);
      this.root.add(diff);
    }
    this.rig.build({ panels: fixtures, room: ROOM, quality: this.quality });
    this.rig.setWindows(this.windowRects, ROOM);

    // warm accents
    const lamp = new THREE.PointLight(0xffa860, 2.2, 6, 1.6);
    lamp.position.set(7.0, 1.35, -4.9);
    this.rig.addAccent(lamp);
    const tvGlow = new THREE.RectAreaLight(0x58e08a, 2.2, 2.3, 1.2);
    tvGlow.position.set(-3.6, 1.95, -5.5);
    tvGlow.lookAt(-3.6, 1.4, 0);
    this.rig.addAccent(tvGlow);
    this.tvGlow = tvGlow;
  }

  async buildDesks() {
    const partitionMat = new THREE.MeshStandardMaterial({ color: 0x35604f, roughness: 0.95, envMapIntensity: 0.2 });
    const trimMat = M.metal(0xa8adb0, 0.35);
    const cableMat = M.plastic(0x161616, 0.6);
    let coworkerSlot = 0;
    this.seats = [];
    for (const z of ROW_Z) {
      for (const x of DESK_X) {
        const isPlayer = x === PLAYER_DESK.x && z === PLAYER_DESK.z;
        this.root.add(pivot(await instance('furniture', 'desk'), { x, z, rotY: 0 }));
        this.root.add(pivot(await instance('furniture', 'computerScreen'), { x, y: 0.76, z: z - 0.12, rotY: 0 }));
        this.root.add(pivot(await instance('furniture', 'computerKeyboard'), { x, y: 0.76, z: z + 0.16, rotY: 0 }));
        this.root.add(pivot(await instance('furniture', 'computerMouse'), { x: x + 0.38, y: 0.76, z: z + 0.16, rotY: 0 }));
        const chair = pivot(await instance('furniture', 'chairDesk'), { x: x + (Math.random() - 0.5) * 0.12, z: z + 0.78, rotY: Math.PI + (Math.random() - 0.5) * 0.3 });
        this.root.add(chair);
        // fabric cubicle partition with aluminium trim
        box(1.5, 0.5, 0.045, partitionMat, [x, 1.01, z - 0.42], this.root);
        box(1.52, 0.025, 0.06, trimMat, [x, 1.27, z - 0.42], this.root);
        // cable from the monitor down behind the desk
        const cable = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
          new THREE.Vector3(x + 0.05, 0.9, z - 0.2), new THREE.Vector3(x + 0.1, 0.78, z - 0.36), new THREE.Vector3(x + 0.2, 0.3, z - 0.38), new THREE.Vector3(x + 0.3, 0.01, z - 0.3),
        ]), 16, 0.008, 5), cableMat);
        this.root.add(cable);
        const tex = screenTexture(isPlayer ? 'desktop' : 'coworker');
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.42), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
        screen.position.set(x, 0.76 + 0.33, z - 0.07);
        this.root.add(screen);
        this.colliders.push({ minX: x - 0.75, maxX: x + 0.75, minZ: z - 0.45, maxZ: z + 0.4 });
        if (isPlayer) {
          this.playerScreen = tex;
          this.playerScreenMesh = screen;
          this.playerSeat = { pos: new THREE.Vector3(x, 0, z + 0.85), yaw: 0 };
          this.monitorView = { pos: new THREE.Vector3(x, 1.12, z + 0.42), target: new THREE.Vector3(x, 1.08, z - 0.07) };
          this.playerChair = chair;
          await this.buildPlayerDeskExtras(x, z);
          this.register({ id: 'computer', object: screen, label: 'Use computer', radius: 2.2 });
          this.register({ id: 'phone', object: this.deskPhone, label: 'Answer phone', radius: 2.2 });
        } else {
          this.coworkerScreens.push(tex);
          this.seats.push({ x, z: z + 0.85, slot: coworkerSlot++ });
          await this.deskClutter(x, z);
        }
      }
    }
  }

  async deskClutter(x, z) {
    const r = Math.random();
    if (r < 0.35) this.root.add(pivot(await instance('food', 'mug', { scale: 0.42 }), { x: x + 0.55, y: 0.76, z: z + 0.05, rotY: Math.random() * 6 }));
    else if (r < 0.6) this.root.add(pivot(await instance('food', 'cup-tea', { scale: 0.42 }), { x: x - 0.55, y: 0.76, z: z + 0.1 }));
    if (Math.random() < 0.5) {
      const paper = M.matte(0xf4f1e8);
      const n = 2 + Math.floor(Math.random() * 6);
      for (let i = 0; i < n; i++) box(0.21, 0.004, 0.29, paper, [x - 0.5 + (Math.random() - 0.5) * 0.04, 0.762 + i * 0.005, z - 0.05 + (Math.random() - 0.5) * 0.04], this.root, { cast: i === n - 1 });
    }
    if (Math.random() < 0.3) this.root.add(pivot(await instance('furniture', pick(['plantSmall1', 'plantSmall2', 'plantSmall3']), { scale: 1.6 }), { x: x + 0.6, y: 0.76, z: z - 0.25 }));
  }

  async buildPlayerDeskExtras(x, z) {
    const phone = new THREE.Group();
    box(0.24, 0.07, 0.2, M.plastic(0x1e1e1e), [0, 0.035, 0], phone);
    const handset = box(0.24, 0.05, 0.06, M.plastic(0x262626), [0, 0.1, -0.05], phone);
    this.handset = handset;
    box(0.1, 0.01, 0.08, M.plastic(0x8a8a8a), [0.04, 0.075, 0.05], phone, { cast: false });
    this.phoneLed = new THREE.Mesh(new THREE.SphereGeometry(0.012), new THREE.MeshStandardMaterial({ color: 0x113311, emissive: 0x000000, emissiveIntensity: 3 }));
    this.phoneLed.position.set(-0.09, 0.08, 0.07);
    phone.add(this.phoneLed);
    phone.position.set(x - 0.5, 0.76, z + 0.05);
    phone.rotation.y = 0.3;
    this.root.add(phone);
    this.deskPhone = phone;
    const headset = new THREE.Group();
    headset.add(new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.012, 8, 20, Math.PI), M.plastic(0x111111)));
    box(0.04, 0.06, 0.06, M.plastic(0x222222), [-0.08, 0, 0], headset);
    box(0.04, 0.06, 0.06, M.plastic(0x222222), [0.08, 0, 0], headset);
    headset.position.set(x + 0.42, 0.95, z - 0.12);
    this.root.add(headset);
    this.headset = headset;
    const notes = ['PASSWORD:\nchai123', 'NEVER SAY\n"SCAM"', 'Your name\nis STEVE', 'QUOTA\nQUOTA\nQUOTA'];
    const spots = [[-0.33, 1.3], [0.33, 1.3], [-0.35, 0.93], [0.36, 1.12]];
    notes.forEach((t, i) => {
      const tex = canvasTexture(128, 128, (ctx) => {
        ctx.fillStyle = ['#fff475', '#ffb3c7', '#b5f5a8', '#9ed8ff'][i];
        ctx.fillRect(0, 0, 128, 128);
        ctx.fillStyle = '#222';
        ctx.font = 'bold 22px "Permanent Marker", "Comic Sans MS", cursive';
        ctx.textAlign = 'center';
        t.split('\n').forEach((line, j) => ctx.fillText(line, 64, 45 + j * 28));
      });
      const n = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.08), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
      n.position.set(x + spots[i][0], spots[i][1], z - 0.058);
      n.rotation.z = (Math.random() - 0.5) * 0.3;
      this.root.add(n);
    });
    this.root.add(pivot(await instance('food', 'cup-tea', { scale: 0.45 }), { x: x + 0.62, y: 0.76, z: z + 0.1 }));
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.07), new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.15, map: canvasTexture(256, 64, (ctx) => {
      ctx.fillStyle = '#c9a227';
      ctx.fillRect(0, 0, 256, 64);
      ctx.fillStyle = '#1a1a1a';
      ctx.font = 'bold 30px Inter, Arial';
      ctx.textAlign = 'center';
      ctx.fillText('"STEVE"', 128, 42);
    }) }));
    plate.position.set(x - 0.2, 0.8, z + 0.36);
    plate.rotation.x = -0.6;
    this.root.add(plate);
  }

  async buildKitchen() {
    const x = ROOM.minX + 0.48;
    for (const z of [2.6, 3.5, 4.4]) this.root.add(pivot(await instance('furniture', 'kitchenCabinet'), { x, z, rotY: Math.PI / 2 }));
    this.root.add(pivot(await instance('furniture', 'kitchenCoffeeMachine'), { x: x - 0.1, y: 0.9, z: 2.6, rotY: Math.PI / 2 }));
    this.root.add(pivot(await instance('furniture', 'kitchenMicrowave'), { x: x - 0.05, y: 0.9, z: 3.6, rotY: Math.PI / 2 }));
    this.root.add(pivot(await instance('food', 'pizza-box', { scale: 0.8 }), { x, y: 0.9, z: 4.4, rotY: 0.4 }));
    this.root.add(pivot(await instance('furniture', 'kitchenFridge'), { x, z: 5.3, rotY: Math.PI / 2 }));
    this.colliders.push({ minX: ROOM.minX, maxX: ROOM.minX + 1.0, minZ: 2.1, maxZ: 5.8 });
    const ext = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.5, 20), new THREE.MeshStandardMaterial({ color: 0xd81e1e, roughness: 0.25, metalness: 0.2, envMapIntensity: 1 }));
    body.position.y = 0.25;
    body.castShadow = true;
    ext.add(body);
    box(0.06, 0.08, 0.12, M.plastic(0x222222), [0, 0.54, 0.03], ext);
    const hose = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.3), M.plastic(0x111111));
    hose.position.set(0.06, 0.4, 0.08);
    hose.rotation.z = 0.5;
    ext.add(hose);
    ext.position.set(ROOM.minX + 0.3, 0, 1.4);
    this.root.add(ext);
    this.extinguisher = ext;
    this.extinguisherHome = ext.position.clone();
    this.register({ id: 'extinguisher', object: ext, label: 'Grab fire extinguisher', radius: 2 });
  }

  async buildBossOffice() {
    const glass = M.glass(0xcfe9ff, 0.14);
    const frame = M.metal(0x4a4d50, 0.35);
    box(0.04, ROOM.height, 4.4, glass, [3.4, ROOM.height / 2, -3.8], this.root, { cast: false });
    box(1.2, ROOM.height, 0.04, glass, [4.0, ROOM.height / 2, -1.6], this.root, { cast: false });
    box(3.2, ROOM.height, 0.04, glass, [7.4, ROOM.height / 2, -1.6], this.root, { cast: false });
    for (const [px, pz] of [[3.4, -1.6], [4.6, -1.6], [5.8, -1.6], [3.4, -6]]) box(0.07, ROOM.height, 0.07, frame, [px, ROOM.height / 2, pz], this.root);
    box(0.07, 0.07, 4.4, frame, [3.4, ROOM.height - 0.035, -3.8], this.root, { cast: false });
    box(5.6, 0.07, 0.07, frame, [6.2, ROOM.height - 0.035, -1.6], this.root, { cast: false });
    // frosted band so you can tell the glass is there
    const frost = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, roughness: 0.9 });
    box(0.045, 0.12, 4.4, frost, [3.4, 1.35, -3.8], this.root, { cast: false });
    box(1.2, 0.12, 0.045, frost, [4.0, 1.35, -1.6], this.root, { cast: false });
    box(3.2, 0.12, 0.045, frost, [7.4, 1.35, -1.6], this.root, { cast: false });
    this.colliders.push({ minX: 3.3, maxX: 3.5, minZ: -6, maxZ: -1.55 }, { minX: 3.3, maxX: 4.6, minZ: -1.7, maxZ: -1.5 }, { minX: 5.8, maxX: 9, minZ: -1.7, maxZ: -1.5 });
    const label = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.28), new THREE.MeshStandardMaterial({ roughness: 0.4, map: canvasTexture(256, 64, (ctx) => {
      ctx.fillStyle = '#7a1010';
      ctx.fillRect(0, 0, 256, 64);
      ctx.fillStyle = '#ffd34d';
      ctx.font = 'bold 26px "Bungee", Impact';
      ctx.textAlign = 'center';
      ctx.fillText('MR. CHATTERJEE', 128, 30);
      ctx.font = 'bold 16px Inter, Arial';
      ctx.fillText('KNOCK & DIE', 128, 54);
    }) }));
    label.position.set(5.2, 2.3, -1.56);
    this.root.add(label);

    this.root.add(pivot(await instance('furniture', 'deskCorner'), { x: 7.6, z: -4.6, rotY: Math.PI }));
    this.root.add(pivot(await instance('furniture', 'chairDesk'), { x: 7.9, z: -5.3, rotY: 0 }));
    this.root.add(pivot(await instance('furniture', 'laptop'), { x: 7.4, y: 0.76, z: -4.3, rotY: Math.PI }));
    this.root.add(pivot(await instance('furniture', 'lampRoundFloor', { scale: 1.6 }), { x: 6.85, y: 0.76, z: -4.95 }));
    this.root.add(pivot(await instance('furniture', 'loungeChair'), { x: 5.2, z: -4.8, rotY: Math.PI / 2 }));
    this.root.add(pivot(await instance('furniture', 'bookcaseOpen'), { x: 8.7, z: -2.6, rotY: -Math.PI / 2 }));
    this.root.add(pivot(await instance('furniture', 'pottedPlant'), { x: 3.9, z: -5.5 }));
    this.root.add(pivot(await instance('furniture', 'rugRectangle'), { x: 6.3, z: -3.6, rotY: 0 }));
    this.colliders.push({ minX: 6.6, maxX: 8.6, minZ: -5.6, maxZ: -3.6 });
    const tank = new THREE.Group();
    box(1.1, 0.5, 0.45, M.plastic(0x3a2a1a, 0.5), [0, 0.25, 0], tank);
    box(1.0, 0.55, 0.38, new THREE.MeshPhysicalMaterial({ color: 0x4fb3ff, transparent: true, opacity: 0.4, roughness: 0.05, envMapIntensity: 1.5, emissive: 0x0a3050, emissiveIntensity: 0.6 }), [0, 0.78, 0], tank, { cast: false });
    this.koi = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 8), new THREE.MeshStandardMaterial({ color: 0xff7b1a, emissive: 0x401800 }));
    this.koi.rotation.z = Math.PI / 2;
    this.koi.position.set(0, 0.8, 0);
    tank.add(this.koi);
    const tankLight = new THREE.PointLight(0x5ab8ff, 0.8, 2.2, 2);
    tankLight.position.set(0, 1.1, 0);
    tank.add(tankLight);
    tank.position.set(8.55, 0, -4.2);
    tank.rotation.y = Math.PI / 2;
    this.root.add(tank);
    this.bossSpot = new THREE.Vector3(7.0, 0, -3.4);
    // framed so the boss stands in the middle third, between the two review panels
    this.bossReviewCam = { pos: new THREE.Vector3(5.75, 1.3, -1.85), target: new THREE.Vector3(7.0, 0.95, -3.4) };
    this.register({ id: 'bossdoor', object: label, label: 'Knock on boss door', radius: 2.5 });
  }

  async buildProps() {
    // quota TV hanging at the front of the floor
    this.boardTex = quotaBoardTexture();
    box(2.5, 1.45, 0.08, M.plastic(0x0d0d0d, 0.3), [-3.6, 1.95, -5.62], this.root, { cast: false });
    const tv = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.35), new THREE.MeshBasicMaterial({ map: this.boardTex, toneMapped: false }));
    tv.position.set(-3.6, 1.95, -5.575);
    this.root.add(tv);
    this.boardMesh = tv;
    for (const dx of [-0.9, 0.9]) {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, ROOM.height - 2.67), M.metal(0x333333));
      rod.position.set(-3.6 + dx, (ROOM.height + 2.67) / 2, -5.62);
      this.root.add(rod);
    }

    // breaker box
    const bb = new THREE.Group();
    box(0.12, 0.7, 0.5, M.metal(0x8d9399, 0.4), [0, 0, 0], bb);
    this.breakerLevers = [];
    for (let i = 0; i < 3; i++) {
      const lever = box(0.08, 0.1, 0.06, new THREE.MeshStandardMaterial({ color: 0x1db954, emissive: 0x1db954, emissiveIntensity: 0.4 }), [0.07, 0.18 - i * 0.18, 0], bb);
      this.breakerLevers.push(lever);
    }
    const warn = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.12), new THREE.MeshStandardMaterial({ map: canvasTexture(128, 48, (ctx) => {
      ctx.fillStyle = '#ffd400';
      ctx.fillRect(0, 0, 128, 48);
      ctx.fillStyle = '#000';
      ctx.font = 'bold 18px Inter, Arial';
      ctx.textAlign = 'center';
      ctx.fillText('⚡ BREAKERS', 64, 31);
    }) }));
    warn.position.set(0.07, 0.45, 0);
    warn.rotation.y = Math.PI / 2;
    bb.add(warn);
    bb.position.set(ROOM.minX + 0.08, 1.35, -3.0);
    this.root.add(bb);
    this.breakerBox = bb;
    this.register({ id: 'breaker', object: bb, label: 'Breaker box', radius: 2.2 });

    // router
    this.root.add(pivot(await instance('furniture', 'sideTable'), { x: ROOM.minX + 0.35, z: -0.6, rotY: Math.PI / 2 }));
    const router = new THREE.Group();
    box(0.3, 0.06, 0.2, M.plastic(0x1b1b1b), [0, 0.03, 0], router);
    for (const dx of [-0.11, 0.11]) {
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.22), M.plastic(0x1b1b1b));
      ant.position.set(dx, 0.17, -0.08);
      router.add(ant);
    }
    this.routerLeds = [];
    for (let i = 0; i < 4; i++) {
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.01), new THREE.MeshStandardMaterial({ color: 0x22ff55, emissive: 0x22ff55, emissiveIntensity: 4 }));
      led.position.set(-0.09 + i * 0.06, 0.05, 0.101);
      router.add(led);
      this.routerLeds.push(led);
    }
    router.position.set(ROOM.minX + 0.35, 0.76, -0.6);
    router.rotation.y = Math.PI / 2;
    this.root.add(router);
    this.router = router;
    this.register({ id: 'router', object: router, label: 'Wi-Fi router', radius: 2 });

    // shredder
    const sh = new THREE.Group();
    box(0.5, 0.7, 0.4, M.plastic(0x2d2d2d, 0.4), [0, 0.35, 0], sh);
    box(0.52, 0.06, 0.42, M.plastic(0x111111, 0.3), [0, 0.73, 0], sh);
    box(0.3, 0.01, 0.02, M.plastic(0x000000), [0, 0.765, 0], sh);
    this.shredPaper = box(0.28, 0.12, 0.2, M.matte(0xf2f2f2), [0, 0.86, 0.05], sh);
    sh.position.set(2.6, 0, -1.2);
    this.root.add(sh);
    this.shredder = sh;
    this.colliders.push({ minX: 2.3, maxX: 2.9, minZ: -1.45, maxZ: -0.95 });
    this.register({ id: 'shredder', object: sh, label: 'Shredder', radius: 2 });

    // supply cabinet
    const cab = pivot(await instance('furniture', 'bookcaseClosedWide'), { x: 1.6, z: ROOM.maxZ - 0.3, rotY: Math.PI });
    this.root.add(cab);
    const supLabel = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.2), new THREE.MeshStandardMaterial({ map: canvasTexture(256, 56, (ctx) => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 256, 56);
      ctx.fillStyle = '#c00';
      ctx.font = 'bold 26px Inter, Arial';
      ctx.textAlign = 'center';
      ctx.fillText('SUPPLIES 🎧', 128, 38);
    }) }));
    supLabel.position.set(1.6, 1.75, ROOM.maxZ - 0.52);
    supLabel.rotation.y = Math.PI;
    this.root.add(supLabel);
    this.colliders.push({ minX: 0.8, maxX: 2.4, minZ: ROOM.maxZ - 0.6, maxZ: ROOM.maxZ });
    this.register({ id: 'supplies', object: cab, label: 'Supply cabinet', radius: 2.2 });

    // water cooler
    const wc = new THREE.Group();
    box(0.34, 0.9, 0.34, M.plastic(0xeeeeee, 0.35), [0, 0.45, 0], wc);
    const jug = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.4, 20), new THREE.MeshPhysicalMaterial({ color: 0x6ec6ff, transparent: true, opacity: 0.5, roughness: 0.05, envMapIntensity: 1.5 }));
    jug.position.y = 1.1;
    wc.add(jug);
    wc.position.set(2.4, 0, -5.5);
    this.root.add(wc);

    // printer
    this.root.add(pivot(await instance('furniture', 'table'), { x: 1.9, z: 1.0, rotY: Math.PI / 2 }));
    box(0.55, 0.3, 0.45, M.plastic(0xd8d8d8, 0.4), [1.9, 0.82, 1.0], this.root);
    box(0.4, 0.02, 0.3, M.matte(0xffffff), [1.9, 0.98, 1.0], this.root);
    this.colliders.push({ minX: 1.4, maxX: 2.4, minZ: 0.1, maxZ: 1.9 });

    // lounge corner
    this.root.add(pivot(await instance('furniture', 'loungeSofa'), { x: 7.3, z: 5.4, rotY: Math.PI }));
    this.root.add(pivot(await instance('furniture', 'tableCoffee'), { x: 7.3, z: 4.4 }));
    this.root.add(pivot(await instance('furniture', 'coatRackStanding'), { x: 8.5, z: 1.9 }));
    this.colliders.push({ minX: 6.2, maxX: 8.4, minZ: 3.9, maxZ: 6 });

    for (const [x, z] of [[-8.5, -5.5], [2.9, 5.5], [8.5, -0.9], [-8.5, 5.7]]) this.root.add(pivot(await instance('furniture', 'pottedPlant'), { x, z }));
    for (const [x, z] of [[0.6, -2.6], [-7.8, 0.6], [0.6, 3.6]]) this.root.add(pivot(await instance('furniture', 'trashcan'), { x, z }));
    for (const [x, z, r] of [[4.2, 5.4, 0.3], [4.7, 5.6, -0.2], [4.4, 4.9, 0.8]]) this.root.add(pivot(await instance('furniture', pick(['cardboardBoxClosed', 'cardboardBoxOpen'])), { x, z, rotY: r }));
    this.colliders.push({ minX: 3.9, maxX: 5.0, minZ: 4.6, maxZ: 6 });

    // ceiling fans on downrods
    const rodMat = M.metal(0xe8e8e0, 0.3);
    for (const [x, z] of [[-7.0, -1.6], [-3.6, -1.6], [-0.2, -1.6], [-7.0, 1.2], [-3.6, 1.2], [-0.2, 1.2], [5.2, -3.3]]) {
      const y = ROOM.height - 0.62;
      const fan = pivot(await instance('furniture', 'ceilingFan', { scale: 2.6 }), { x, y, z });
      this.root.add(fan);
      this.fans.push(fan);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.3, 8), rodMat);
      rod.position.set(x, ROOM.height - 0.15, z);
      this.root.add(rod);
    }

    // posters
    const posters = [
      { title: 'SMILE AND DIAL', sub: 'They can hear your smile', emoji: '😁', bg: '#1f9d4c' },
      { title: 'QUOTA IS LIFE', sub: '— Mr. Chatterjee', emoji: '💰', bg: '#b3261e' },
      { title: 'GIFT CARDS ARE FOREVER', sub: 'Google Play • iTunes • Steam', emoji: '🎁', bg: '#2a4d9b' },
      { title: 'NEVER SAY "SCAM"', sub: 'Say "service"', emoji: '🤫', bg: '#6a1b9a' },
      { title: 'EMPLOYEE OF THE MONTH', sub: 'Rajesh (the koi fish)', emoji: '🐟', bg: '#c77700' },
    ];
    const spots = [
      { x: -2.5, y: 1.65, z: ROOM.maxZ - 0.06, r: Math.PI },
      { x: -6.0, y: 1.65, z: ROOM.maxZ - 0.06, r: Math.PI },
      { x: ROOM.minX + 0.06, y: 1.65, z: -5.0, r: Math.PI / 2 },
      { x: ROOM.minX + 0.06, y: 1.65, z: -1.6, r: Math.PI / 2 },
      { x: 3.43, y: 1.65, z: -3.0, r: -Math.PI / 2 },
    ];
    posters.forEach((p, i) => {
      const s = spots[i];
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 1.0), new THREE.MeshStandardMaterial({ map: posterTexture(p), roughness: 0.35, envMapIntensity: 0.6 }));
      m.position.set(s.x, s.y, s.z);
      m.rotation.y = s.r;
      this.root.add(m);
    });

    this.shameTex = canvasTexture(512, 360, (ctx, w, h) => this.drawShame(ctx, w, h, []));
    const shame = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.2), new THREE.MeshStandardMaterial({ map: this.shameTex, roughness: 0.85 }));
    shame.position.set(ROOM.minX + 0.06, 1.75, 0.75);
    shame.rotation.y = Math.PI / 2;
    this.root.add(shame);

    // vehicles outside
    this.root.add(pivot(await instance('vehicles', 'taxi', { scale: 1.25 }), { x: -6, y: -3.2, z: -10.5, rotY: Math.PI / 2 }));
    this.root.add(pivot(await instance('vehicles', 'van', { scale: 1.25 }), { x: 6, y: -3.2, z: -13.5, rotY: -Math.PI / 2 }));
    this.policeCar = pivot(await instance('vehicles', 'police', { scale: 1.25 }), { x: -30, y: -3.2, z: -10.5, rotY: Math.PI / 2 });
    this.policeCar.visible = false;
    this.root.add(this.policeCar);
    this.policeLight = new THREE.PointLight(0xff0000, 0, 22, 1.2);
    this.policeLight.position.set(0, 2.2, 0);
    this.policeCar.add(this.policeLight);
  }

  async buildDecor() {
    // company sign on the west wall
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.58), new THREE.MeshStandardMaterial({ map: signTexture('GLOBAL SOLUTIONS', 'PVT. LTD. • "Totally Legit Tech Support"'), roughness: 0.35, emissive: 0xffffff, emissiveIntensity: 0.12, emissiveMap: null }));
    sign.material.emissiveMap = sign.material.map;
    sign.position.set(ROOM.minX + 0.06, 2.45, -3.3);
    sign.rotation.y = Math.PI / 2;
    this.root.add(sign);

    // glowing EXIT sign over the door
    const exit = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.19), new THREE.MeshStandardMaterial({ map: exitSignTexture(), emissiveMap: exitSignTexture(), emissive: 0xffffff, emissiveIntensity: 1.8 }));
    exit.position.set(ROOM.maxX - 0.08, 2.62, 3);
    exit.rotation.y = -Math.PI / 2;
    this.root.add(exit);
    const exitGlow = new THREE.PointLight(0x2bff7a, 0.5, 2.5, 2);
    exitGlow.position.set(ROOM.maxX - 0.4, 2.55, 3);
    this.rig.addAccent(exitGlow).userData.keepOnOutage = true;

    // wall clock (shows the in-game time)
    this.clockTex = clockTexture();
    const clock = new THREE.Mesh(new THREE.CircleGeometry(0.24, 40), new THREE.MeshStandardMaterial({ map: this.clockTex, roughness: 0.25, envMapIntensity: 0.8 }));
    clock.position.set(ROOM.minX + 0.07, 2.42, 1.95);
    clock.rotation.y = Math.PI / 2;
    this.root.add(clock);

    // split AC unit (decorative — it has never worked)
    const ac = new THREE.Group();
    box(1.0, 0.3, 0.22, M.plastic(0xf3f3ef, 0.35), [0, 0, 0], ac);
    box(0.94, 0.03, 0.02, M.plastic(0xcfcfcf), [0, -0.1, 0.11], ac);
    ac.position.set(-4.2, ROOM.height - 0.35, ROOM.maxZ - 0.13);
    this.root.add(ac);

    // founder's portrait with a marigold garland and an electric diya
    const portrait = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.62), new THREE.MeshStandardMaterial({ map: founderPortraitTexture(), roughness: 0.3, envMapIntensity: 0.7 }));
    portrait.position.set(ROOM.maxX - 0.07, 1.85, 0.4);
    portrait.rotation.y = -Math.PI / 2;
    this.root.add(portrait);
    const garlandMat = new THREE.MeshStandardMaterial({ color: 0xff9a1a, roughness: 0.8, emissive: 0x3a1800 });
    const garlandMat2 = new THREE.MeshStandardMaterial({ color: 0xffd23a, roughness: 0.8, emissive: 0x2a2000 });
    const flowerGeo = new THREE.IcosahedronGeometry(0.028, 0);
    const garland = new THREE.InstancedMesh(flowerGeo, garlandMat, 30);
    const garland2 = new THREE.InstancedMesh(flowerGeo, garlandMat2, 30);
    const tmp = new THREE.Matrix4();
    for (let i = 0; i < 60; i++) {
      const t = i / 59;
      const a = Math.PI * t;
      const zz = 0.4 - Math.cos(a) * 0.26;
      const yy = 2.15 - Math.sin(a) * 0.5;
      tmp.makeTranslation(ROOM.maxX - 0.1, yy, zz);
      (i % 2 ? garland2 : garland).setMatrixAt(Math.floor(i / 2), tmp);
    }
    this.root.add(garland, garland2);
    box(0.18, 0.025, 0.6, M.plastic(0x5a3a1e, 0.5), [ROOM.maxX - 0.1, 1.42, 0.4], this.root);
    const diya = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xa0522d, roughness: 0.7 }));
    diya.rotation.x = Math.PI;
    diya.position.set(ROOM.maxX - 0.12, 1.47, 0.4);
    this.root.add(diya);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.04, 8), new THREE.MeshStandardMaterial({ color: 0xffc04d, emissive: 0xff8a1a, emissiveIntensity: 6 }));
    flame.position.set(ROOM.maxX - 0.12, 1.5, 0.4);
    this.root.add(flame);
    this.diyaFlame = flame;
    const diyaLight = new THREE.PointLight(0xff8a2a, 0.9, 2.2, 2);
    diyaLight.position.set(ROOM.maxX - 0.25, 1.55, 0.4);
    this.rig.addAccent(diyaLight, { flicker: 0.35 }).userData.keepOnOutage = true;

    // stacks of files tied with red string on the bookcase & floor (bureaucracy!)
    const fileMat = M.matte(0xd9c9a0);
    const tape = M.matte(0xb3261e);
    for (const [x, z, n] of [[4.0, -5.6, 5], [8.6, -5.6, 7], [0.5, 5.6, 4]]) {
      for (let i = 0; i < n; i++) {
        box(0.32, 0.05, 0.24, fileMat, [x + (Math.random() - 0.5) * 0.04, 0.025 + i * 0.05, z + (Math.random() - 0.5) * 0.04], this.root);
      }
      box(0.02, n * 0.05 + 0.01, 0.25, tape, [x, (n * 0.05) / 2, z], this.root, { cast: false });
    }
    // extension board with a cable spaghetti under the front desks
    const spaghetti = M.plastic(0x101010, 0.6);
    for (let i = 0; i < 8; i++) {
      const pts = [];
      for (let k = 0; k < 6; k++) pts.push(new THREE.Vector3(-7 + i * 0.9 + Math.sin(k * 1.7 + i) * 0.3, 0.012, -3.75 + k * 0.08 + Math.cos(k + i) * 0.05));
      this.root.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 0.009, 4), spaghetti));
    }
  }

  drawShame(ctx, w, h, items) {
    ctx.fillStyle = '#b48a5a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#7b2d1e';
    ctx.fillRect(0, 0, w, 54);
    ctx.fillStyle = '#ffe14d';
    ctx.font = 'bold 34px "Bungee", Impact';
    ctx.textAlign = 'center';
    ctx.fillText('WALL OF SHAME', w / 2, 40);
    const list = items.length ? items.slice(-5) : ['(empty... for now)'];
    list.forEach((t, i) => {
      const y = 70 + i * 56;
      ctx.fillStyle = ['#fff475', '#ffffff', '#ffd1dc', '#c8f7c5', '#cde7ff'][i % 5];
      ctx.save();
      ctx.translate(20 + (i % 2) * 10, y);
      ctx.rotate((i % 2 ? 1 : -1) * 0.012);
      ctx.fillRect(0, 0, w - 50, 48);
      ctx.fillStyle = '#222';
      ctx.font = '16px "Permanent Marker", cursive';
      ctx.textAlign = 'left';
      ctx.fillText(String(t).slice(0, 52), 10, 30);
      ctx.restore();
    });
  }

  setShame(items) {
    this.shameTex.userData.redraw((ctx, w, h) => this.drawShame(ctx, w, h, items));
  }

  async buildCharacters() {
    const names = [...CHARACTERS.coworkers];
    const seatOrder = [0, 2, 3, 5, 6, 8, 10, 12, 13].map((i) => this.seats[i]).filter(Boolean);
    const lines = ['Hello sir, I am calling from Windoze.', "Please do the needful ma'am.", 'Your computer is having virus!', 'Google Play card sir, Google Play!', 'Yes yes, I am Kevin from Texas.', 'Sir do not hang up sir!', 'Madam please open the black window.'];
    for (let i = 0; i < Math.min(8, seatOrder.length); i++) {
      const seat = seatOrder[i];
      const npc = await NPC.create('characters', names[i % names.length]);
      npc.root.position.set(seat.x, 0.32, seat.z - 0.08);
      npc.root.rotation.y = Math.PI;
      npc.play('sit');
      npc.seat = seat;
      npc.lines = lines;
      npc.chatter = 3 + Math.random() * 10;
      this.root.add(npc.root);
      this.coworkers.push(npc);
      this.npcs.push(npc);
    }
    this.boss = await NPC.create('characters', CHARACTERS.boss);
    this.boss.root.position.copy(this.bossSpot);
    this.boss.root.rotation.y = Math.PI * 0.85;
    this.root.add(this.boss.root);
    this.npcs.push(this.boss);
  }

  // ------------------------------------------------------------------ helpers
  register(it) {
    const entry = { enabled: true, ...it };
    entry.object.traverse((o) => {
      o.userData.interactable = entry;
      if (o.isMesh && o.material && !Array.isArray(o.material)) {
        o.material = o.material.clone();
        if ('emissive' in o.material) {
          o.userData.baseEmissive = o.material.emissive.clone();
          o.userData.baseEmissiveIntensity = o.material.emissiveIntensity;
        }
      }
    });
    this.interactables.push(entry);
    return entry;
  }

  getInteractable(id) {
    return this.interactables.find((i) => i.id === id);
  }

  highlight(entry, on) {
    if (!entry) return;
    entry.object.traverse((o) => {
      if (o.isMesh && o.material && 'emissive' in o.material && o.userData.baseEmissive) {
        if (on) {
          o.material.emissive.setRGB(0.35, 0.3, 0.08);
          o.material.emissiveIntensity = 1;
        } else {
          o.material.emissive.copy(o.userData.baseEmissive);
          o.material.emissiveIntensity = o.userData.baseEmissiveIntensity;
        }
      }
    });
  }

  updateBoard(state) {
    this.boardTex.userData.redraw((ctx, w, h) => drawQuotaBoard(ctx, w, h, state));
  }

  setClock(minutes) {
    const m = Math.floor(minutes);
    if (m === this.lastClockMinute) return;
    this.lastClockMinute = m;
    this.clockTex.userData.redraw((ctx, w, h) => drawClock(ctx, w, h, m));
  }

  setPlayerScreen(opts) {
    this.playerScreen.userData.redraw((ctx, w, h) => drawScreen(ctx, w, h, opts));
  }

  setPower(on) {
    this.powered = on;
    this.rig.setPower(on);
    this.diffuserMat.emissiveIntensity = on ? 1.6 : 0;
    this.ceilMat.emissiveIntensity = on ? 1 : 0.08;
    this.boardMesh.visible = on;
    for (const tex of this.coworkerScreens) tex.userData.redraw((ctx, w, h) => drawScreen(ctx, w, h, { kind: on ? 'coworker' : 'off' }));
    if (!on) this.setPlayerScreen({ kind: 'off' });
    for (const l of this.breakerLevers) {
      l.material.color.set(on ? 0x1db954 : 0xd32f2f);
      l.material.emissive.set(on ? 0x1db954 : 0xd32f2f);
    }
  }

  setRouter(ok) {
    for (const led of this.routerLeds) {
      led.material.color.set(ok ? 0x22ff55 : 0xff2222);
      led.material.emissive.set(ok ? 0x22ff55 : 0xff2222);
    }
  }

  setPhoneRinging(on) {
    this.phoneRinging = on;
    if (!on) this.phoneLed.material.emissive.set(0x000000);
  }

  async spawnPolice(count = 3) {
    this.policeCar.visible = true;
    this.policeCar.position.x = -30;
    this.policeCarTarget = -1;
    this.policeLight.intensity = 6;
    const officers = [];
    for (let i = 0; i < count; i++) {
      const cop = await NPC.create('characters', CHARACTERS.police);
      cop.root.position.set(ROOM.maxX + 1.2 + i * 0.8, 0, 3);
      this.root.add(cop.root);
      this.npcs.push(cop);
      officers.push(cop);
      const tx = -1 - i * 2.4;
      setTimeout(() => cop.walk([[ROOM.maxX - 0.8, 3], [2, 3.6 - i * 0.6], [tx, 4.6 - i * 0.2]], { speed: 3.2, anim: 'sprint', onArrive: (n) => n.lookAtXZ(-2, 2) }), 600 + i * 500);
    }
    this.police.push(...officers);
    return officers;
  }

  clearPolice() {
    for (const cop of this.police) {
      cop.walk([[2, 3.4], [ROOM.maxX + 1.5, 3]], {
        speed: 2.4,
        onArrive: (n) => {
          this.root.remove(n.root);
          this.npcs = this.npcs.filter((x) => x !== n);
        },
      });
    }
    this.police = [];
    this.policeLight.intensity = 0;
    this.policeCarTarget = 40;
  }

  async spawnCow() {
    const cow = await NPC.create('animals', 'animal-cow', { scale: 0.95 });
    cow.root.position.set(ROOM.maxX + 1.5, 0, 3);
    this.root.add(cow.root);
    this.npcs.push(cow);
    cow.walk([[ROOM.maxX - 1, 3], [1.0, 3.6], [-0.9, 4.5]], { speed: 1.1, onArrive: (n) => n.play('eat') });
    this.cow = cow;
    const entry = this.register({ id: 'cow', object: cow.root, label: 'Shoo the cow', radius: 2.4 });
    return { cow, entry };
  }

  removeCow() {
    const cow = this.cow;
    if (!cow) return;
    this.interactables = this.interactables.filter((i) => i.id !== 'cow');
    cow.walk([[1.5, 3.4], [ROOM.maxX + 2, 3]], {
      speed: 2.5,
      anim: 'run',
      onArrive: (n) => {
        this.root.remove(n.root);
        this.npcs = this.npcs.filter((x) => x !== n);
      },
    });
    this.cow = null;
  }

  // ------------------------------------------------------------------ per-frame
  update(dt) {
    this.time += dt;
    const fanSpeed = this.powered ? 6 : 0.3;
    for (const f of this.fans) f.rotation.y += dt * fanSpeed;
    for (const n of this.npcs) n.update(dt);
    for (const c of this.coworkers) {
      c.chatter -= dt;
      if (c.chatter <= 0 && this.powered) {
        c.chatter = 8 + Math.random() * 18;
        if (Math.random() < 0.55) c.say(pick(c.lines), 3.5);
      }
      if (c.head) c.head.rotation.y = Math.sin(this.time * 0.7 + c.seat.slot) * 0.25;
    }
    if (this.koi) {
      this.koi.position.x = Math.sin(this.time * 0.6) * 0.38;
      this.koi.rotation.y = Math.cos(this.time * 0.6) > 0 ? 0 : Math.PI;
    }
    if (this.diyaFlame) this.diyaFlame.scale.y = 0.85 + Math.random() * 0.35;
    if (this.phoneRinging) {
      const on = Math.floor(this.time * 4) % 2 === 0;
      this.phoneLed.material.emissive.set(on ? 0x33ff66 : 0x000000);
      this.handset.position.y = 0.1 + (on ? 0.006 : 0);
    }
    if (this.policeCar.visible && this.policeCarTarget !== undefined) {
      const px = this.policeCar.position.x;
      const target = this.policeCarTarget;
      this.policeCar.position.x += Math.sign(target - px) * Math.min(Math.abs(target - px), dt * 14);
      if (target > 30 && px > 29) this.policeCar.visible = false;
    }
  }
}

export { SUN_DIR };
