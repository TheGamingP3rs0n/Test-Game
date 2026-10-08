// Proximity voice chat for co-op. Hold B to talk to teammates near you: audio goes
// peer-to-peer over WebRTC (signalled through the LAN server), is positioned in 3D at
// the speaker's avatar, fades with distance, and is muffled through walls — a little
// through the boss's glass office, a lot from the break room or the restrooms.
// The microphone is only opened while you hold the key (and released shortly after).
import { bus } from '../core/bus.js';
import { settings } from '../core/store.js';
import { audioCtx, gameBus, sfx } from '../core/audio.js';
import { typingInField } from '../core/util.js';
import { net } from './net.js';

const ICE = { iceServers: [] }; // LAN: host candidates are enough
const RELEASE_AFTER_MS = 8000; // keep the mic warm briefly after you let go, then close it

/** Which room a world position is in (for muffling). */
export function roomAt(p) {
  if (!p) return 'main';
  if (p.x > 9.05) return 'stairs';
  if (p.z > 8.5) return p.x >= 2.5 ? 'break' : p.x <= -2.5 ? 'restroom' : 'hall';
  if (p.z > 6.05) return 'hall';
  if (p.x > 3.4 && p.z < -1.6) return 'boss';
  return 'main';
}

// low-pass cutoff (Hz) when the listener and speaker are in different rooms
const WALL = { boss: 2600, hall: 1500, stairs: 1100, break: 650, restroom: 520, main: 1500 };
function cutoffFor(a, b) {
  if (a === b) return 20000;
  // the more enclosed of the two rooms decides how muffled it sounds
  return Math.min(WALL[a] ?? 1500, WALL[b] ?? 1500);
}

class Voice {
  constructor() {
    this.peers = new Map(); // id -> { pc, sender, nodes, audioEl }
    this.stream = null;
    this.talking = false;
    this.releaseTimer = null;
    this.world = null;
    this.started = false;
  }

  init(world) {
    if (this.started) return;
    this.started = true;
    this.world = world;
    bus.on('net:roster', (list) => this.sync(list));
    bus.on('net:left', (id) => this.drop(id));
    bus.on('net:close', () => this.dropAll());
    bus.on('net:rtc', (m) => this.onSignal(m.from, m.data));
    document.addEventListener('keydown', (e) => {
      if (e.code !== (settings.voiceKey || 'KeyB') || e.repeat || typingInField()) return;
      if (!net.active || settings.proxVoice === false) return;
      this.start();
    });
    document.addEventListener('keyup', (e) => {
      if (e.code === (settings.voiceKey || 'KeyB')) this.stop();
    });
    window.addEventListener('blur', () => this.stop());
  }

  // ------------------------------------------------------------ peers
  sync(list) {
    if (!net.active || settings.proxVoice === false) return;
    const ids = new Set(list.filter((r) => !r.you).map((r) => r.id));
    for (const id of ids) if (!this.peers.has(id) && net.id != null && net.id < id) this.connect(id, true);
    for (const id of [...this.peers.keys()]) if (!ids.has(id)) this.drop(id);
  }

  makePeer(id) {
    const pc = new RTCPeerConnection(ICE);
    const tr = pc.addTransceiver('audio', { direction: 'sendrecv' });
    const peer = { pc, sender: tr.sender, nodes: null, audioEl: null };
    this.peers.set(id, peer);
    pc.onicecandidate = (e) => e.candidate && net.rtc(id, { ice: e.candidate.toJSON() });
    pc.ontrack = (e) => this.attachRemote(id, e.streams[0] || new MediaStream([e.track]));
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) this.drop(id); };
    if (this.stream && this.talking) peer.sender.replaceTrack(this.stream.getAudioTracks()[0]).catch(() => {});
    return peer;
  }

  async connect(id) {
    const peer = this.makePeer(id);
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    net.rtc(id, { sdp: peer.pc.localDescription.toJSON() });
  }

  async onSignal(from, data) {
    if (settings.proxVoice === false) return;
    let peer = this.peers.get(from);
    try {
      if (data.sdp) {
        if (data.sdp.type === 'offer') {
          if (!peer) peer = this.makePeer(from);
          await peer.pc.setRemoteDescription(data.sdp);
          const answer = await peer.pc.createAnswer();
          await peer.pc.setLocalDescription(answer);
          net.rtc(from, { sdp: peer.pc.localDescription.toJSON() });
        } else if (peer) {
          await peer.pc.setRemoteDescription(data.sdp);
        }
      } else if (data.ice && peer) {
        await peer.pc.addIceCandidate(data.ice);
      }
    } catch (err) {
      console.warn('voice signalling failed', err);
    }
  }

  attachRemote(id, stream) {
    const peer = this.peers.get(id);
    if (!peer || peer.nodes) return;
    // Chrome only feeds a remote WebRTC stream into Web Audio if it's also attached to a media element
    peer.audioEl = new Audio();
    peer.audioEl.muted = true;
    peer.audioEl.srcObject = stream;
    peer.audioEl.play().catch(() => {});
    const ctx = audioCtx();
    const src = ctx.createMediaStreamSource(stream);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 20000;
    const panner = ctx.createPanner();
    Object.assign(panner, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1.6, maxDistance: 30, rolloffFactor: 1.3 });
    const gain = ctx.createGain();
    gain.gain.value = 1;
    src.connect(filter).connect(panner).connect(gain).connect(gameBus('master'));
    peer.nodes = { src, filter, panner, gain };
  }

  drop(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    try { peer.pc.close(); } catch { /* noop */ }
    if (peer.nodes) { try { peer.nodes.gain.disconnect(); } catch { /* noop */ } }
    if (peer.audioEl) peer.audioEl.srcObject = null;
  }

  dropAll() {
    for (const id of [...this.peers.keys()]) this.drop(id);
    this.stop(true);
  }

  // ------------------------------------------------------------ talking
  async start() {
    if (this.talking) return;
    this.talking = true;
    clearTimeout(this.releaseTimer);
    try {
      if (!this.stream) this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (err) {
      this.talking = false;
      bus.emit('toast', { kind: 'warn', icon: 'mic-off', title: 'Voice chat', text: `Microphone unavailable: ${err.message}` });
      return;
    }
    if (!this.talking) return; // released while the permission prompt was up
    const track = this.stream.getAudioTracks()[0];
    track.enabled = true;
    for (const p of this.peers.values()) p.sender.replaceTrack(track).catch(() => {});
    sfx('micOn');
    bus.emit('voice:talking', true);
  }

  stop(now = false) {
    if (!this.talking && !now) return;
    this.talking = false;
    for (const p of this.peers.values()) p.sender.replaceTrack(null).catch(() => {});
    if (this.stream) this.stream.getAudioTracks().forEach((t) => (t.enabled = false));
    bus.emit('voice:talking', false);
    clearTimeout(this.releaseTimer);
    const close = () => { this.stream?.getTracks().forEach((t) => t.stop()); this.stream = null; };
    if (now) close();
    else this.releaseTimer = setTimeout(() => { if (!this.talking) close(); }, RELEASE_AFTER_MS);
  }

  // ------------------------------------------------------------ per frame: position + muffling
  update() {
    if (!this.peers.size || !this.world) return;
    const ctx = audioCtx();
    const cam = this.world.camera;
    const L = ctx.listener;
    const fwd = { x: -Math.sin(this.world.player.yaw), z: -Math.cos(this.world.player.yaw) };
    if (L.positionX) {
      L.positionX.value = cam.position.x; L.positionY.value = cam.position.y; L.positionZ.value = cam.position.z;
      L.forwardX.value = fwd.x; L.forwardY.value = 0; L.forwardZ.value = fwd.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else {
      L.setPosition(cam.position.x, cam.position.y, cam.position.z);
      L.setOrientation(fwd.x, 0, fwd.z, 0, 1, 0);
    }
    const myRoom = roomAt(this.world.player.pos);
    for (const [id, peer] of this.peers) {
      if (!peer.nodes) continue;
      const remote = this.world.remotePlayers.peers.get(id)?.npc?.root.position;
      if (!remote) continue;
      const pn = peer.nodes.panner;
      if (pn.positionX) { pn.positionX.value = remote.x; pn.positionY.value = 1.5; pn.positionZ.value = remote.z; }
      else pn.setPosition(remote.x, 1.5, remote.z);
      const target = cutoffFor(myRoom, roomAt(remote));
      peer.nodes.filter.frequency.setTargetAtTime(target, ctx.currentTime, 0.15);
      peer.nodes.gain.gain.setTargetAtTime((settings.voiceVolume ?? 1) * (target < 20000 ? 0.75 : 1), ctx.currentTime, 0.15);
    }
  }
}

export const voice = new Voice();
