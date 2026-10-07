// First-person controller. You start seated at your desk; WASD stands you up and lets
// you walk the floor (to fix breakers, fight fires, shred evidence...). E / click
// interacts, C crouches (hide under your desk during raids and air strikes).
import * as THREE from 'three';
import { settings } from '../core/store.js';
import { typingInField, clamp } from '../core/util.js';
import { bus } from '../core/bus.js';

const EYE = { seated: 1.18, standing: 1.62, crouch: 0.62 };

export class Player {
  constructor(camera, canvas, office) {
    this.camera = camera;
    this.canvas = canvas;
    this.office = office;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = -0.08;
    this.mode = 'seated';
    this.eye = EYE.seated;
    this.enabled = false; // false while menus / computer UI are open
    this.keys = new Set();
    this.target = null;
    this.raycaster = new THREE.Raycaster();
    this.holding = null; // 'extinguisher' | 'headset' | null
    this.dragging = false;
    this.locked = false;
    this.hidden = false;
    this.bindInput();
  }

  bindInput() {
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.canvas;
      // Lost the lock without us asking = the browser ate an Esc press (it always
      // releases the mouse on Esc). The game treats that as "pause".
      const intentional = this.releasing;
      this.releasing = false;
      bus.emit('player:lock', this.locked, { lost: was && !this.locked && !intentional });
    });
    document.addEventListener('pointerlockerror', () => {
      this.releasing = false;
      bus.emit('player:lock', false, { error: true });
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.locked || this.dragging) {
        // Chrome occasionally reports a huge jump right after pointer lock — ignore it
        if (Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) return;
        const s = 0.0022 * settings.mouseSensitivity;
        this.yaw -= e.movementX * s;
        this.pitch = clamp(this.pitch - e.movementY * s, -1.35, 1.35);
        if (this.mode === 'seated') this.yaw = clamp(this.yaw, this.seatYaw - 1.9, this.seatYaw + 1.9);
      }
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (e.button === 0 && !this.locked) {
        this.requestLock();
        if (!this.locked) this.dragging = true; // fallback when pointer lock is unavailable
      } else if (e.button === 0 && this.locked) {
        this.interact();
      }
    });
    document.addEventListener('mouseup', () => (this.dragging = false));
    document.addEventListener('keydown', (e) => {
      if (typingInField()) return;
      this.keys.add(e.code);
      if (!this.enabled) return;
      if (e.code === 'KeyE') this.interact();
      if (e.code === 'KeyC') this.toggleCrouch();
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  requestLock() {
    if (document.pointerLockElement === this.canvas) return;
    try {
      // unadjustedMovement = raw mouse input (no OS acceleration) where supported
      const p = this.canvas.requestPointerLock?.({ unadjustedMovement: true });
      p?.catch?.(() => {
        try {
          this.canvas.requestPointerLock?.()?.catch?.(() => {});
        } catch {
          /* drag-to-look fallback */
        }
      });
    } catch {
      /* not supported (e.g. headless) — drag-to-look fallback */
    }
  }

  releaseLock() {
    if (document.pointerLockElement) {
      this.releasing = true;
      document.exitPointerLock();
    }
  }

  setEnabled(on) {
    this.enabled = on;
    this.keys.clear();
    if (!on) {
      this.releaseLock();
      this.setTarget(null);
    }
  }

  sitAtDesk() {
    const seat = this.office.playerSeat;
    this.pos.copy(seat.pos);
    this.seatYaw = seat.yaw;
    this.yaw = seat.yaw;
    this.pitch = -0.12;
    this.mode = 'seated';
    this.hidden = false;
    bus.emit('player:mode', this.mode);
  }

  standUp() {
    if (this.mode === 'standing') return;
    if (this.mode === 'seated') this.pos.z += 0.35;
    this.mode = 'standing';
    this.hidden = false;
    bus.emit('player:mode', this.mode);
  }

  toggleCrouch() {
    if (this.mode === 'crouch') {
      this.mode = 'standing';
      this.hidden = false;
    } else {
      if (this.mode === 'seated') this.pos.z += 0.2;
      this.mode = 'crouch';
      const desk = this.office.playerSeat.pos;
      this.hidden = Math.hypot(this.pos.x - desk.x, this.pos.z - (desk.z - 0.6)) < 1.4;
    }
    bus.emit('player:mode', this.mode);
    bus.emit('player:hidden', this.hidden);
  }

  distanceTo(obj) {
    const p = new THREE.Vector3();
    obj.getWorldPosition(p);
    return Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
  }

  interact() {
    if (!this.enabled) return;
    if (this.target) bus.emit('interact', this.target.id, this.target);
    else if (this.holding === 'extinguisher') bus.emit('interact', 'spray');
  }

  setTarget(t) {
    if (t === this.target) return;
    if (this.target) this.office.highlight(this.target, false);
    this.target = t;
    if (t) this.office.highlight(t, true);
    bus.emit('player:target', t);
  }

  collide(next) {
    const r = 0.28;
    for (const c of this.office.colliders) {
      if (next.x + r > c.minX && next.x - r < c.maxX && next.z + r > c.minZ && next.z - r < c.maxZ) return true;
    }
    return false;
  }

  update(dt) {
    if (this.enabled) {
      const move = new THREE.Vector3();
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) move.z -= 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) move.z += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) move.x -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) move.x += 1;
      if (move.lengthSq() > 0) {
        if (this.mode === 'seated') this.standUp();
        move.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
        const speed = (this.mode === 'crouch' ? 1.4 : this.keys.has('ShiftLeft') ? 5 : 3) * dt;
        const nx = this.pos.clone().add(new THREE.Vector3(move.x * speed, 0, 0));
        if (!this.collide(nx)) this.pos.x = nx.x;
        const nz = this.pos.clone().add(new THREE.Vector3(0, 0, move.z * speed));
        if (!this.collide(nz)) this.pos.z = nz.z;
        if (this.mode === 'crouch') {
          const desk = this.office.playerSeat.pos;
          const h = Math.hypot(this.pos.x - desk.x, this.pos.z - (desk.z - 0.6)) < 1.4;
          if (h !== this.hidden) {
            this.hidden = h;
            bus.emit('player:hidden', h);
          }
        }
      }
    }
    const wantEye = EYE[this.mode];
    this.eye += (wantEye - this.eye) * Math.min(1, dt * 8);
    this.camera.position.set(this.pos.x, this.eye, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

    if (this.enabled) this.updateTarget();
  }

  updateTarget() {
    this.raycaster.setFromCamera({ x: 0, y: 0 }, this.camera);
    this.raycaster.far = 3.2;
    const objects = this.office.interactables.filter((i) => i.enabled && !i.hidden).map((i) => i.object);
    const hits = this.raycaster.intersectObjects(objects, true);
    let found = null;
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.interactable) o = o.parent;
      const entry = o?.userData.interactable;
      if (entry && entry.enabled && h.distance <= (entry.radius || 2.2) + 0.6) {
        found = entry;
        break;
      }
    }
    this.setTarget(found);
  }
}
