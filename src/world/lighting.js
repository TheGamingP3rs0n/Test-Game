// Lighting rig for the office:
//  • Golden-hour sun through the north windows (shadow-mapped, striped by the blinds)
//  • Fluorescent ceiling fixtures as soft RectAreaLights + glowing diffusers
//  • Warm accent lights (boss desk lamp, shrine diya) and the quota TV's green spill
//  • A baked reflection/irradiance probe: the office is rendered into a cube map once
//    (and again when the power changes). That cube map becomes the scene's environment
//    (glossy reflections of the actual room) and a spherical-harmonics LightProbe
//    (bounce light tinted by the room's colors).
//  • Dust motes that only sparkle inside the sunbeams.
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { LightProbeGenerator } from 'three/addons/lights/LightProbeGenerator.js';

export const SUN_DIR = new THREE.Vector3(0.32, -0.6, 1).normalize(); // direction light travels

export class LightingRig {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.panels = [];
    this.accents = [];
    this.beams = [];
    this.powered = true;
    this.time = 0;
    RectAreaLightUniformsLib.init();
  }

  build({ panels, room, quality }) {
    const s = this.scene;
    this.hemi = new THREE.HemisphereLight(0xf4f2ee, 0xc9c4ba, 0.3);
    s.add(this.hemi);
    this.probe = new THREE.LightProbe();
    this.probe.intensity = 1.0;
    s.add(this.probe);

    // Sun
    this.sun = new THREE.DirectionalLight(0xffc387, 2.6);
    const target = new THREE.Vector3(-1, 0, -1);
    this.sun.position.copy(target).addScaledVector(SUN_DIR, -30);
    this.sun.target.position.copy(target);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
    Object.assign(this.sun.shadow.camera, { left: -14, right: 14, top: 12, bottom: -12, near: 5, far: 60 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.025;
    this.sun.shadow.radius = 3;
    s.add(this.sun, this.sun.target);

    // Fluorescent fixtures
    for (const p of panels) {
      const l = new THREE.RectAreaLight(0xfff7ee, p.intensity ?? 9, p.w, p.d);
      l.position.set(p.x, room.height - 0.02, p.z);
      l.lookAt(p.x, 0, p.z);
      l.userData.base = l.intensity;
      s.add(l);
      this.panels.push(l);
    }

    // Emergency light (power failure)
    this.emergency = new THREE.PointLight(0xff2a1a, 0, 16, 1.3);
    this.emergency.position.set(-2, room.height - 0.3, 0.5);
    s.add(this.emergency);
  }

  addAccent(light, { flicker = 0 } = {}) {
    light.userData.base = light.intensity;
    light.userData.flicker = flicker;
    this.scene.add(light);
    this.accents.push(light);
    return light;
  }

  /** Window beams: rects on the window plane → unit-cube matrices for the shaft pass + dust. */
  setWindows(rects, room) {
    this.beams = rects.map((r) => {
      const L = (r.maxY + 0.2) / -SUN_DIR.y;
      const W = new THREE.Vector3(r.maxX - r.minX, 0, 0);
      const H = new THREE.Vector3(0, r.maxY - r.minY, 0);
      const D = SUN_DIR.clone().multiplyScalar(L);
      const m = new THREE.Matrix4().makeBasis(W, H, D);
      m.setPosition(r.minX, r.minY, r.z);
      return m;
    });
    this.buildDust(room);
    return this.beams;
  }

  buildDust(room) {
    const N = 900;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = room.minX + Math.random() * (room.maxX - room.minX);
      pos[i * 3 + 1] = 0.1 + Math.random() * (room.height - 0.2);
      pos[i * 3 + 2] = room.minZ + Math.random() * 7.5;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const inv = this.beams.map((m) => m.clone().invert());
    while (inv.length < 12) inv.push(new THREE.Matrix4().makeScale(0, 0, 0));
    this.dustMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uBeams: { value: inv }, uCount: { value: this.beams.length }, uPower: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float seed;
        uniform float uTime; uniform mat4 uBeams[12]; uniform int uCount;
        varying float vLit; varying float vSeed;
        void main() {
          vec3 p = position;
          p.x += sin(uTime * 0.13 + seed * 40.0) * 0.35;
          p.y += sin(uTime * 0.09 + seed * 17.0) * 0.25 + mod(uTime * 0.015 * (0.3 + seed), 0.6) - 0.3;
          p.z += cos(uTime * 0.11 + seed * 23.0) * 0.35;
          float lit = 0.0;
          for (int i = 0; i < 12; i++) {
            if (i >= uCount) break;
            vec3 l = (uBeams[i] * vec4(p, 1.0)).xyz;
            float inside = step(0.0, l.x) * step(l.x, 1.0) * step(0.0, l.y) * step(l.y, 1.0) * step(0.0, l.z) * step(l.z, 1.0);
            lit = max(lit, inside * (1.0 - l.z));
          }
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float dist = -mv.z;
          vLit = lit * smoothstep(0.6, 2.2, dist); vSeed = seed;
          gl_PointSize = clamp((0.8 + seed * 1.6) * (160.0 / dist), 1.0, 5.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uPower;
        varying float vLit; varying float vSeed;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.0, length(c));
          float twinkle = 0.6 + 0.4 * sin(uTime * (1.0 + vSeed * 3.0) + vSeed * 50.0);
          float alpha = a * (vLit * 0.75 * twinkle + 0.02 * uPower);
          if (alpha < 0.003) discard;
          gl_FragColor = vec4(vec3(1.0, 0.88, 0.66) * (1.0 + vLit * 0.8), alpha);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.dust = new THREE.Points(geo, this.dustMat);
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
  }

  /**
   * Bake the reflection + irradiance probe from the middle of the room.
   * `hide` = objects to hide while capturing (e.g. the floor reflector).
   */
  async bake(center = new THREE.Vector3(-2, 1.5, 0.5), hide = []) {
    const r = this.renderer;
    const cubeRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType });
    const cam = new THREE.CubeCamera(0.1, 60, cubeRT);
    cam.position.copy(center);
    const prevEnv = this.scene.environment;
    this.scene.environment = null;
    const vis = hide.map((o) => o.visible);
    hide.forEach((o) => (o.visible = false));
    if (this.dust) this.dust.visible = false;
    const prevProbe = this.probe.intensity;
    this.probe.intensity = 0;
    cam.update(r, this.scene);
    hide.forEach((o, i) => (o.visible = vis[i]));
    if (this.dust) this.dust.visible = true;
    this.probe.intensity = prevProbe;
    try {
      const probe = await LightProbeGenerator.fromCubeRenderTarget(r, cubeRT);
      // the room is very beige: partially desaturate the bounce light so it doesn't go orange
      for (const c of probe.sh.coefficients) {
        const lum = c.x * 0.3 + c.y * 0.59 + c.z * 0.11;
        c.lerp(new THREE.Vector3(lum, lum, lum), 0.4);
      }
      this.probe.copy(probe);
      this.probe.intensity = this.powered ? 0.75 : 0.5;
    } catch (err) {
      console.warn('Light probe bake failed (using hemisphere light only)', err);
      this.hemi.intensity = 0.5;
    }
    const pmrem = new THREE.PMREMGenerator(r);
    const env = pmrem.fromCubemap(cubeRT.texture);
    this.envRT?.dispose();
    this.envRT = env;
    this.scene.environment = env.texture;
    this.scene.environmentIntensity = this.powered ? 0.6 : 0.35;
    pmrem.dispose();
    cubeRT.dispose();
    if (prevEnv && prevEnv !== env.texture) prevEnv.dispose?.();
  }

  setPower(on) {
    this.powered = on;
    for (const p of this.panels) p.intensity = on ? p.userData.base : 0;
    for (const a of this.accents) if (!a.userData.keepOnOutage) a.intensity = on ? a.userData.base : 0;
    this.emergency.intensity = on ? 0 : 5;
    this.hemi.intensity = on ? 0.3 : 0.05;
    if (this.dustMat) this.dustMat.uniforms.uPower.value = on ? 1 : 0.3;
  }

  update(dt) {
    this.time += dt;
    if (this.dustMat) this.dustMat.uniforms.uTime.value = this.time;
    for (const a of this.accents) {
      if (a.userData.flicker && a.intensity > 0) a.intensity = a.userData.base * (1 - a.userData.flicker * 0.5 + Math.random() * a.userData.flicker);
    }
    if (!this.powered) this.emergency.intensity = 4 + Math.sin(this.time * 6) * 2.5;
  }
}
