// three.js renderer, camera and frame loop. Owns the Office, lighting rig, post
// pipeline, Player and FX, and handles cinematic camera moves (menu fly-around,
// zoom into the monitor, boss office).
import * as THREE from 'three';
import { Office } from './office.js';
import { Player } from './player.js';
import { FX } from './fx.js';
import { LightingRig } from './lighting.js';
import { RenderPipeline, QUALITY } from './render.js';
import { settings } from '../core/store.js';
import { bus } from '../core/bus.js';

class World {
  async init(canvas, onProgress) {
    this.canvas = canvas;
    this.quality = QUALITY[settings.graphics] || QUALITY.high;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // Shadows are re-rendered on a budget (static office, few moving things) and
    // never inside the reflection / AO sub-renders.
    this.renderer.shadowMap.autoUpdate = false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 140);
    this.lastTime = performance.now();
    this.mode = 'menu';
    this.cinematic = null;
    this.listeners = [];
    this.frameNo = 0;

    this.rig = new LightingRig(this.scene, this.renderer);
    this.office = new Office(this.scene, { renderer: this.renderer, rig: this.rig, quality: this.quality });
    await this.office.build(onProgress);
    this.fx = new FX(this.scene, this.camera);
    this.player = new Player(this.camera, canvas, this.office);
    this.player.sitAtDesk();
    this.menuAngle = 0;

    this.pipeline = new RenderPipeline(this.renderer, this.scene, this.camera, this.quality);
    this.pipeline.setBeams(this.rig.beams);

    window.addEventListener('resize', () => this.resize());
    this.resize();
    bus.on('settings:changed', (s, patch) => {
      if ('graphics' in patch) this.setQuality(s.graphics);
    });

    // first frames: render shadows, then bake the reflection/irradiance probe
    this.renderer.shadowMap.needsUpdate = true;
    this.pipeline.render(0.016);
    await this.rebake();
    this.renderer.setAnimationLoop(() => this.frame());
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
    this.office.update(dt);
    this.rig.update(dt);
    this.fx.update(dt);
    for (const fn of this.listeners) fn(dt);

    if (this.mode === 'menu') {
      this.menuAngle += dt * 0.05;
      const a = this.menuAngle;
      this.camera.position.set(-2.5 + Math.sin(a) * 3.2, 1.75 + Math.sin(a * 0.7) * 0.15, 3.6 + Math.cos(a) * 1.2);
      this.camera.lookAt(-3 + Math.sin(a * 0.8) * 2, 1.15, -4.5);
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
    this.pipeline.render(dt);
  }
}

export const world = new World();
