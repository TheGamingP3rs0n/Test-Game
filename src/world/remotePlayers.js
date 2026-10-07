// Renders other players in co-op: a Kenney character per peer with a floating nametag,
// their position smoothed toward the latest network update. Driven by net:* bus events.
import * as THREE from 'three';
import { NPC } from './npc.js';
import { CHARACTERS } from './assets.js';
import { textSprite } from './textures.js';
import { bus } from '../core/bus.js';

const BODIES = [...CHARACTERS.coworkers];

export class RemotePlayers {
  constructor(scene) {
    this.scene = scene;
    this.peers = new Map(); // id -> { npc, tag, target, ry, mode, lastMove }
    this.bind();
  }

  bind() {
    bus.on('net:joined', (m) => this.add(m.id, m.name, m.color));
    bus.on('net:roster', (list) => this.sync(list));
    bus.on('net:move', (m) => this.move(m.id, m.p, m.ry, m.mode));
    bus.on('net:rename', (m) => this.setName(m.id, m.name));
    bus.on('net:left', (id) => this.remove(id));
    bus.on('net:close', () => this.clear());
  }

  /** Add any peers in the roster we don't have yet (and drop stale ones). */
  sync(list) {
    const ids = new Set();
    for (const r of list) {
      if (r.you) continue;
      ids.add(r.id);
      if (!this.peers.has(r.id)) this.add(r.id, r.name, r.color);
      else this.setName(r.id, r.name);
    }
    for (const id of [...this.peers.keys()]) if (!ids.has(id)) this.remove(id);
  }

  async add(id, name, color) {
    if (this.peers.has(id) || id == null) return;
    const slot = { npc: null, tag: null, target: new THREE.Vector3(2, 0, 4), ry: Math.PI, mode: 'standing', moving: 0 };
    this.peers.set(id, slot); // reserve synchronously so we don't double-add
    const npc = await NPC.create('characters', BODIES[(id - 1 + BODIES.length) % BODIES.length]);
    if (!this.peers.has(id)) return; // left while loading
    npc.root.position.set(2 + id * 0.6, 0, 4);
    npc.play('idle');
    this.scene.add(npc.root);
    const tag = textSprite(name || `Agent ${id}`, { bg: color || '#1f9d4c', fg: '#fff', font: 'bold 34px Inter, Arial' });
    tag.position.set(0, 2.1, 0);
    npc.root.add(tag);
    npc.label = name || `Agent ${id}`;
    slot.npc = npc;
    slot.tag = tag;
    slot.color = color;
    slot.name = name;
  }

  setName(id, name) {
    const s = this.peers.get(id);
    if (!s || s.name === name) return;
    s.name = name;
    if (s.npc) s.npc.label = name;
    if (s.npc && s.tag) {
      s.npc.root.remove(s.tag);
      s.tag.material.map?.dispose();
      s.tag.material.dispose();
      s.tag = textSprite(name || `Agent ${id}`, { bg: s.color || '#1f9d4c', fg: '#fff', font: 'bold 34px Inter, Arial' });
      s.tag.position.set(0, 2.1, 0);
      s.npc.root.add(s.tag);
    }
  }

  move(id, p, ry, mode) {
    const s = this.peers.get(id);
    if (!s) return;
    s.target.set(p[0], p[1], p[2]);
    s.ry = ry;
    s.mode = mode;
    s.moving = 0.4; // seconds to treat as "walking"
  }

  remove(id) {
    const s = this.peers.get(id);
    if (!s) return;
    this.peers.delete(id);
    if (s.npc) {
      this.scene.remove(s.npc.root);
      s.tag?.material.map?.dispose();
      s.tag?.material.dispose();
    }
  }

  clear() {
    for (const id of [...this.peers.keys()]) this.remove(id);
  }

  update(dt) {
    for (const s of this.peers.values()) {
      if (!s.npc) continue;
      const pos = s.npc.root.position;
      const prev = pos.clone();
      pos.lerp(s.target, Math.min(1, dt * 9));
      // face travel/network yaw, animate walk vs idle
      const moved = prev.distanceTo(pos);
      s.moving = Math.max(0, s.moving - dt);
      const want = s.mode === 'crouch' ? 'idle' : (moved > 0.004 || s.moving > 0) ? 'walk' : (s.mode === 'seated' ? 'sit' : 'idle');
      if (s.npc.currentName !== want && s.npc.clips[want]) s.npc.play(want);
      let diff = s.ry - s.npc.root.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      s.npc.root.rotation.y += diff * Math.min(1, dt * 10);
      s.npc.mixer.update(dt);
    }
  }
}
