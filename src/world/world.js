// three.js renderer, camera and frame loop. Owns the Office, lighting rig, post
// pipeline, Player and FX, and handles cinematic camera moves (menu fly-around,
// zoom into the monitor, boss office).
import * as THREE from 'three';
import { Office } from './office.js';
import { Player } from './player.js';
import { FX } from './fx.js';
import { LightingRig } from './lighting.js';
import { RenderPipeline, QUALITY } from './render.js';
import { RemotePlayers } from './remotePlayers.js';
import { net } from '../net/net.js';
import { settings } from '../core/store.js';
import { bus } from '../core/bus.js';

class World {
  /**
   * onProgress(fraction 0..1, label). Loading is split into small steps with a frame
   * yield between them, and shaders are compiled in parallel (KHR_parallel_shader_compile)
   * instead of all at once on the first frame — that first-frame compile was what froze
   * the whole browser for several seconds.
   */
  async init(canvas, onProgress = () => {}) {
    this.canvas = canvas;
    this.quality = QUALITY[settings.graphics] || QUALITY.high;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.72;
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // Shadows are re-rendered on a budget (static office, few moving things) and
    // never inside the reflection / AO sub-renders.
    this.renderer.shadowMap.autoUpdate = false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(settings.fov || 78, window.innerWidth / window.innerHeight, 0.05, 140);
    this.lastTime = performance.now();
    this.mode = 'menu';
    this.cinematic = null;
    this.listeners = [];
    this.frameNo = 0;

    this.rig = new LightingRig(this.scene, this.renderer);
    // A neutral environment of the same size as the baked one, set before anything is
    // compiled, so swapping in the real bake later doesn't recompile every material.
    this.scene.environment = this.rig.placeholderEnvironment();
    this.office = new Office(this.scene, { renderer: this.renderer, rig: this.rig, quality: this.quality });
    await this.office.build((p) => onProgress(p * 0.75, `Loading the office… ${Math.round(p * 100)}%`));
    this.fx = new FX(this.scene, this.camera);
    this.remotePlayers = new RemotePlayers(this.scene);
    this.player = new Player(this.camera, canvas, this.office);
    this.player.sitAtDesk();
    this.menuAngle = 0;

    this.pipeline = new RenderPipeline(this.renderer, this.scene, this.camera, this.quality);
    this.pipeline.setBeams(this.rig.beams);

    window.addEventListener('resize', () => this.resize());
    this.resize();
    bus.on('settings:changed', (s, patch) => {
      if ('graphics' in patch) this.setQuality(s.graphics);
      if ('fov' in patch) this.setFov(s.fov);
      this.frozenFrames = 0; // re-render once if a setting changes while paused
    });

    onProgress(0.78, 'Warming up shaders…');
    await nextFrame();
    this.updateMenuCamera(0);
    await this.precompile();
    onProgress(0.9, 'Lighting the office…');
    await nextFrame();
    // first frame: shadows + post-processing passes
    this.renderer.shadowMap.needsUpdate = true;
    this.pipeline.render(0.016);
    await nextFrame();
    onProgress(0.95, 'Baking reflections…');
    await this.rebake();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** Compile every material for the render-target path the composer actually uses. */
  async precompile() {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    try {
      r.setRenderTarget(this.pipeline.composer.renderTarget1);
      await r.compileAsync(this.scene, this.camera);
    } catch (err) {
      console.warn('Async shader compile unavailable', err);
    } finally {
      r.setRenderTarget(prev);
    }
  }

  setFov(fov) {
    this.camera.fov = Math.max(50, Math.min(110, Number(fov) || 78));
    this.camera.updateProjectionMatrix();
  }

  async rebake() {
    this.renderer.shadowMap.needsUpdate = true;
    await this.rig.bake(new THREE.Vector3(-2, 1.5, 0.5), [this.office.reflector].filter(Boolean));
  }

  setQuality(name) {
    this.quality = QUALITY[name] || QUALITY.high;
    this.rig.sun.shadow.mapSize.set(this.quality.shadowSize, this.quality.shadowSize);
    this.rig.sun.shadow.map?.dispose();
    this.rig.sun.shadow.map = null;
    if (this.office.reflector) this.office.reflector.visible = this.quality.reflections;
    this.pipeline.setQuality(name);
    this.resize();
    this.renderer.shadowMap.needsUpdate = true;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.pipeline?.setSize(w, h);
  }

  onUpdate(fn) {
    this.listeners.push(fn);
    return () => (this.listeners = this.listeners.filter((f) => f !== fn));
  }

  /** The NPC (coworker / boss / cop / cow / remote player) the camera is pointed at,
   *  within a forgiving forward cone — used to aim the Scamazon physical tools. */
  aimNpc(maxDist = 3.8) {
    const from = this.camera.position;
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) return null;
    dir.normalize();
    const peers = [...this.remotePlayers.peers.values()].map((p) => p.npc).filter(Boolean);
    const list = [...this.office.npcs, ...peers];
    const p = new THREE.Vector3();
    let best = null;
    let bestDist = Infinity;
    for (const npc of list) {
      if (!npc?.root) continue;
      npc.root.getWorldPosition(p);
      const to = p.sub(from);
      to.y = 0;
      const dist = to.length();
      if (dist < 0.35 || dist > maxDist) continue;
      to.normalize();
      if (to.dot(dir) > 0.8 && dist < bestDist) { bestDist = dist; best = npc; }
    }
    return best;
  }

  /**
   * 'menu'     slow fly-around behind the main menu
   * 'play'     first-person control
   * 'computer' camera parked at the monitor while the OS UI is open
   * 'review'   boss office camera
   * 'frozen'   keep the current camera (paused)
   */
  setMode(mode) {
    this.mode = mode;
    this.player.setEnabled(mode === 'play');
    if (mode === 'computer') this.flyTo(this.office.monitorView.pos, this.office.monitorView.target, 0.45);
    if (mode === 'review') this.flyTo(this.office.bossReviewCam.pos, this.office.bossReviewCam.target, 1.2);
    if (mode === 'play') this.cinematic = null;
  }

  /** Slow drift behind the main menu, from the back of the room over the call floor. */
  updateMenuCamera(dt) {
    this.menuAngle += dt * 0.045;
    const a = this.menuAngle;
    this.camera.position.set(-3.2 + Math.sin(a) * 2.6, 2.05 + Math.sin(a * 0.7) * 0.12, 5.1 + Math.cos(a * 1.3) * 0.25);
    this.camera.lookAt(-3.4 + Math.sin(a * 0.8) * 2.2, 1.2, -4.5);
  }

  flyTo(pos, target, seconds = 0.8) {
    const fromPos = this.camera.position.clone();
    const fromQuat = this.camera.quaternion.clone();
    const m = new THREE.Matrix4().lookAt(pos, target, new THREE.Vector3(0, 1, 0));
    const toQuat = new THREE.Quaternion().setFromRotationMatrix(m);
    this.cinematic = { fromPos, fromQuat, toPos: pos.clone(), toQuat, t: 0, dur: seconds };
  }

  frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.frameNo++;
    for (const fn of this.listeners) fn(dt);
    // Paused: the world stands still and we stop re-rendering it (the last frame stays
    // on screen behind the pause menu — and the GPU gets a rest).
    if (this.mode === 'frozen') {
      this.frozenFrames = (this.frozenFrames || 0) + 1;
      if (this.frozenFrames > 2) return;
    } else this.frozenFrames = 0;
    const simDt = this.mode === 'frozen' ? 0 : dt;
    this.office.update(simDt);
    this.rig.update(simDt);
    this.fx.update(simDt);
    this.remotePlayers.update(dt);
    if (net.active) net.move(this.player.pos, this.player.yaw, this.player.mode);

    if (this.mode === 'menu') {
      this.updateMenuCamera(dt);
    } else if (this.mode === 'play') {
      this.player.update(dt);
    } else if (this.cinematic) {
      const c = this.cinematic;
      c.t = Math.min(1, c.t + dt / c.dur);
      const e = c.t < 0.5 ? 2 * c.t * c.t : 1 - Math.pow(-2 * c.t + 2, 2) / 2;
      this.camera.position.lerpVectors(c.fromPos, c.toPos, e);
      this.camera.quaternion.slerpQuaternions(c.fromQuat, c.toQuat, e);
    }
    this.fx.applyShake(this.camera);
    // shadows: every frame on Ultra, every 3rd frame otherwise (characters move slowly)
    if (this.quality.shadows && (this.quality.shadowSize >= 4096 || this.frameNo % 3 === 0)) this.renderer.shadowMap.needsUpdate = true;
    this.pipeline.render(simDt);
  }
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

export const world = new World();
