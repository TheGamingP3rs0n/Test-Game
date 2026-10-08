import { settings } from '../core/store.js';
// Visual effects: fire, smoke, extinguisher spray, falling dust, police light bars,
// camera shake.
import * as THREE from 'three';
import { fireTexture, smokeTexture } from './textures.js';

const fireTex = fireTexture();
const smokeTex = smokeTexture();

class ParticleSystem {
  constructor(scene, { texture, blending = THREE.AdditiveBlending, max = 120 }) {
    this.scene = scene;
    this.texture = texture;
    this.blending = blending;
    this.particles = [];
    this.max = max;
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  spawn({ pos, vel, life = 1, size = 0.5, grow = 0.5, color = 0xffffff, opacity = 1 }) {
    if (this.particles.length >= this.max) {
      const old = this.particles.shift();
      this.group.remove(old.sprite);
      old.sprite.material.dispose();
    }
    const mat = new THREE.SpriteMaterial({ map: this.texture, blending: this.blending, transparent: true, depthWrite: false, color, opacity });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(pos);
    sprite.scale.setScalar(size);
    this.group.add(sprite);
    this.particles.push({ sprite, vel: vel.clone(), life, maxLife: life, size, grow, opacity });
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.group.remove(p.sprite);
        p.sprite.material.dispose();
        this.particles.splice(i, 1);
        continue;
      }
      p.sprite.position.addScaledVector(p.vel, dt);
      const t = 1 - p.life / p.maxLife;
      p.sprite.scale.setScalar(p.size + p.grow * t);
      p.sprite.material.opacity = p.opacity * (1 - t);
    }
  }

  clear() {
    for (const p of this.particles) {
      this.group.remove(p.sprite);
      p.sprite.material.dispose();
    }
    this.particles = [];
  }
}

export class FX {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.fire = new ParticleSystem(scene, { texture: fireTex, max: 260 });
    this.smoke = new ParticleSystem(scene, { texture: smokeTex, blending: THREE.NormalBlending, max: 160 });
    this.spray = new ParticleSystem(scene, { texture: smokeTex, blending: THREE.NormalBlending, max: 120 });
    this.dust = new ParticleSystem(scene, { texture: smokeTex, blending: THREE.NormalBlending, max: 160 });
    this.fires = []; // { pos, intensity, light }
    this.shake = 0;
    this.flashers = []; // { light, phase, colors }
    this.time = 0;
  }

  addFire(pos) {
    const light = new THREE.PointLight(0xff7a20, 3, 6, 1.5);
    light.position.copy(pos).add(new THREE.Vector3(0, 0.6, 0));
    this.scene.add(light);
    const f = { pos: pos.clone(), intensity: 1, light };
    this.fires.push(f);
    return f;
  }

  /** Reduce fires near a point (extinguisher). Returns true if all fires are out. */
  extinguishNear(pos, amount) {
    for (const f of this.fires) {
      if (f.pos.distanceTo(pos) < 1.8) f.intensity -= amount;
    }
    for (const f of this.fires.filter((x) => x.intensity <= 0)) this.scene.remove(f.light);
    this.fires = this.fires.filter((f) => f.intensity > 0);
    return this.fires.length === 0;
  }

  clearFires() {
    for (const f of this.fires) this.scene.remove(f.light);
    this.fires = [];
    this.fire.clear();
  }

  sprayFrom(origin, dir) {
    for (let i = 0; i < 3; i++) {
      const v = dir.clone().multiplyScalar(4 + Math.random() * 2).add(new THREE.Vector3((Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.8));
      this.spray.spawn({ pos: origin, vel: v, life: 0.6, size: 0.15, grow: 0.8, color: 0xf4f8ff, opacity: 0.8 });
    }
  }

  dustBurst(center, radius = 6) {
    for (let i = 0; i < 60; i++) {
      const p = center.clone().add(new THREE.Vector3((Math.random() - 0.5) * radius * 2, 2.4, (Math.random() - 0.5) * radius * 2));
      this.dust.spawn({ pos: p, vel: new THREE.Vector3((Math.random() - 0.5) * 0.3, -0.6 - Math.random(), (Math.random() - 0.5) * 0.3), life: 2.5 + Math.random() * 2, size: 0.25, grow: 0.6, color: 0xcbbfa5, opacity: 0.6 });
    }
  }

  addFlasher(light, colors = [0xff2020, 0x2040ff], speed = 6) {
    const f = { light, colors: colors.map((c) => new THREE.Color(c)), speed, phase: Math.random() * 6 };
    this.flashers.push(f);
    return f;
  }

  removeFlasher(light) {
    this.flashers = this.flashers.filter((f) => f.light !== light);
  }

  addShake(amount) {
    this.shake = Math.max(this.shake, amount);
  }

  update(dt) {
    this.time += dt;
    for (const f of this.fires) {
      const n = Math.ceil(4 * f.intensity);
      for (let i = 0; i < n; i++) {
        const p = f.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.9 * f.intensity, 0.05, (Math.random() - 0.5) * 0.9 * f.intensity));
        this.fire.spawn({ pos: p, vel: new THREE.Vector3((Math.random() - 0.5) * 0.3, 1 + Math.random() * 1.2, (Math.random() - 0.5) * 0.3), life: 0.5 + Math.random() * 0.5, size: 0.35 * f.intensity + 0.1, grow: -0.2, color: 0xffffff });
      }
      if (Math.random() < 0.3) this.smoke.spawn({ pos: f.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), vel: new THREE.Vector3((Math.random() - 0.5) * 0.2, 0.5, (Math.random() - 0.5) * 0.2), life: 3, size: 0.6, grow: 1.6, color: 0x333333, opacity: 0.5 });
      f.light.intensity = 2 + Math.random() * 2 * f.intensity;
    }
    this.fire.update(dt);
    this.smoke.update(dt);
    this.spray.update(dt);
    this.dust.update(dt);
    for (const f of this.flashers) {
      const t = (this.time * f.speed + f.phase) % f.colors.length;
      f.light.color.copy(f.colors[Math.floor(t)]);
      f.light.intensity = 2 + Math.sin(this.time * f.speed * 3) * 1.5;
    }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 1.5);
    }
  }

  /** Apply camera shake after the player sets the camera transform. */
  applyShake(camera) {
    if (this.shake <= 0 || settings.cameraShake === false || settings.reduceMotion) return;
    const s = this.shake * 0.08;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
    camera.rotation.z += (Math.random() - 0.5) * s * 0.5;
  }
}
