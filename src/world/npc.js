// Animated characters (coworkers, the boss, police, the office cow) built on Kenney's
// Mini Characters / Cube Pets, which ship with idle/walk/sit/emote animations.
import * as THREE from 'three';
import { instance } from './assets.js';
import { textSprite } from './textures.js';

export class NPC {
  static async create(kind, name, opts = {}) {
    const npc = new NPC();
    await npc.init(kind, name, opts);
    return npc;
  }

  async init(kind, name, { scale } = {}) {
    this.root = new THREE.Group();
    this.model = await instance(kind, name, { scale });
    this.root.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.clips = Object.fromEntries((this.model.userData.animations || []).map((c) => [c.name, c]));
    this.current = null;
    this.path = [];
    this.speed = 1.4;
    this.bubble = null;
    this.bubbleTimer = 0;
    this.onArrive = null;
    this.head = this.model.getObjectByName('head');
    this.time = Math.random() * 10;
    this.play('idle');
  }

  play(name, { loop = true, fade = 0.25, timeScale = 1, then = null } = {}) {
    const clip = this.clips[name];
    if (!clip) return;
    const action = this.mixer.clipAction(clip);
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    action.timeScale = timeScale;
    if (this.current && this.current !== action) this.current.crossFadeTo(action, fade, false);
    action.play();
    this.current = action;
    this.currentName = name;
    if (!loop && then) {
      const onFinish = (e) => {
        if (e.action === action) {
          this.mixer.removeEventListener('finished', onFinish);
          this.play(then);
        }
      };
      this.mixer.addEventListener('finished', onFinish);
    }
  }

  /** Walk along waypoints [[x,z], ...]. */
  walk(points, { speed = 1.4, anim = 'walk', onArrive = null } = {}) {
    this.path = points.map(([x, z]) => new THREE.Vector3(x, this.root.position.y, z));
    this.speed = speed;
    this.onArrive = onArrive;
    if (this.path.length) this.play(anim);
  }

  lookAtXZ(x, z) {
    this.root.rotation.y = Math.atan2(x - this.root.position.x, z - this.root.position.z);
  }

  say(text, seconds = 4) {
    this.clearBubble();
    this.bubble = textSprite(text);
    this.bubble.position.set(0, 2.05, 0);
    this.root.add(this.bubble);
    this.bubbleTimer = seconds;
  }

  clearBubble() {
    if (this.bubble) {
      this.root.remove(this.bubble);
      this.bubble.material.map.dispose();
      this.bubble.material.dispose();
      this.bubble = null;
    }
  }

  update(dt) {
    this.time += dt;
    this.mixer.update(dt);
    if (this.path.length) {
      const target = this.path[0];
      const pos = this.root.position;
      const dx = target.x - pos.x;
      const dz = target.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.08) {
        this.path.shift();
        if (!this.path.length) {
          this.play('idle');
          const cb = this.onArrive;
          this.onArrive = null;
          cb?.(this);
        }
      } else {
        const step = Math.min(dist, this.speed * dt);
        pos.x += (dx / dist) * step;
        pos.z += (dz / dist) * step;
        const want = Math.atan2(dx, dz);
        let diff = want - this.root.rotation.y;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        this.root.rotation.y += diff * Math.min(1, dt * 10);
      }
    }
    if (this.bubble) {
      this.bubbleTimer -= dt;
      if (this.bubbleTimer <= 0) this.clearBubble();
    }
  }
}
