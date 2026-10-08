// Client side of co-op (LAN over WebSockets, or online via PeerJS join codes). Sends our name,
// position and earnings, and emits what the server broadcasts (other players, team
// quota, votes) back through the game bus. Single-player is unaffected when unused.
import { bus } from '../core/bus.js';
import { session } from '../core/store.js';
import { createRoom, makeJoinCode } from './room.js';

const PEER_PREFIX = 'scamcallcenter-kolkata-';

/** Transports all look the same to Net: send(str), isOpen(), close(), and on* callbacks. */
function wsTransport(url) {
  const t = {};
  let ws;
  try { ws = new WebSocket(url); } catch (err) { setTimeout(() => t.onerror?.(err), 0); return Object.assign(t, { send() {}, isOpen: () => false, close() {} }); }
  ws.onopen = () => t.onopen?.();
  ws.onmessage = (e) => t.onmessage?.(e.data);
  ws.onclose = () => t.onclose?.();
  ws.onerror = () => t.onerror?.(new Error('Connection failed. Is the host server running?'));
  return Object.assign(t, { send: (s) => ws.send(s), isOpen: () => ws.readyState === WebSocket.OPEN, close: () => ws.close() });
}

async function peerGuestTransport(code) {
  const { Peer } = await import('peerjs');
  const t = { conn: null };
  const peer = new Peer(undefined, { debug: 0 });
  peer.on('open', () => {
    const c = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'raw' });
    c.on('open', () => { t.conn = c; t.onopen?.(); });
    c.on('data', (d) => t.onmessage?.(typeof d === 'string' ? d : new TextDecoder().decode(d)));
    c.on('close', () => t.onclose?.());
    c.on('error', (e) => t.onerror?.(e));
  });
  peer.on('error', (e) => t.onerror?.(e.type === 'peer-unavailable' ? new Error(`No game is hosting with code ${code}. Check it and try again.`) : new Error(`Online connection failed (${e.type || e.message}).`)));
  return Object.assign(t, { send: (s) => t.conn?.send(s), isOpen: () => !!t.conn?.open, close: () => { try { peer.destroy(); } catch { /* noop */ } } });
}

/** The host's own client talks to the in-page room directly. */
function localTransport(room) {
  const t = { open: true };
  const conn = { send: (s) => setTimeout(() => t.onmessage?.(s), 0), isOpen: () => t.open, close: () => { if (t.open) { t.open = false; t.onclose?.(); } } };
  const h = room.connect(conn);
  setTimeout(() => t.onopen?.(), 0);
  return Object.assign(t, { send: (s) => h.message(s), isOpen: () => t.open, close: () => { if (t.open) { t.open = false; h.close(); t.onclose?.(); } } });
}

const DEFAULT_PORT = 8787;

/** Normalize "192.168.1.5", "192.168.1.5:8787" or a full ws:// URL into a ws URL. */
export function toWsUrl(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  if (/^wss?:\/\//i.test(s)) return s;
  if (!/:\d+$/.test(s)) s += `:${DEFAULT_PORT}`;
  return `ws://${s}`;
}

class Net {
  constructor() {
    this.transport = null;
    this.mode = null; // 'lan' | 'online'
    this.code = '';
    this.hosting = null;
    this.hasPassword = false;
    this.id = null;
    this.color = null;
    this.name = '';
    this.url = '';
    this.connected = false;
    this.players = new Map(); // id -> { id, name, color, personal }
    this.team = { earned: 0, quota: 1500, day: 1, phase: 'lobby' };
    this.vote = null;
    this._lastMove = 0;
  }

  get active() {
    return this.connected;
  }
  get peerCount() {
    return this.players.size;
  }

  /** LAN: connect to a host's WebSocket server. Resolves once the host admits us. */
  connect(url, name, password = '') {
    this.disconnect();
    this.url = url;
    this.mode = 'lan';
    return this._attach(wsTransport(url), name, password);
  }

  /** Online: join a game hosted in someone's browser, by its join code. */
  async joinOnline(code, name, password = '') {
    this.disconnect();
    this.mode = 'online';
    this.code = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (this.code.length < 4) throw new Error('Enter the join code the host gave you.');
    return this._attach(await peerGuestTransport(this.code), name, password);
  }

  /** Online: host a game in this browser. Resolves to the join code to share. */
  async hostOnline(name, password = '') {
    this.disconnect();
    this.mode = 'online';
    const { Peer } = await import('peerjs');
    const room = createRoom({ password });
    let peer = null;
    let code = '';
    for (let attempt = 0; attempt < 4 && !peer; attempt++) {
      code = makeJoinCode();
      peer = await new Promise((resolve, reject) => {
        const pr = new Peer(PEER_PREFIX + code, { debug: 0 });
        const to = setTimeout(() => { pr.destroy(); reject(new Error('Could not reach the matchmaking server. Check your internet connection.')); }, 12000);
        pr.on('open', () => { clearTimeout(to); resolve(pr); });
        pr.on('error', (e) => { clearTimeout(to); pr.destroy(); if (e.type === 'unavailable-id') resolve(null); else reject(new Error(`Online hosting failed (${e.type || e.message}).`)); });
      });
    }
    if (!peer) throw new Error('Could not get a join code — try again.');
    peer.on('connection', (c) => {
      const conn = { send: (str) => c.send(str), isOpen: () => c.open, close: () => setTimeout(() => c.close(), 50) };
      let h = null;
      c.on('open', () => { h = room.connect(conn); });
      c.on('data', (d) => h?.message(typeof d === 'string' ? d : JSON.stringify(d)));
      c.on('close', () => h?.close());
      c.on('error', () => h?.close());
    });
    peer.on('disconnected', () => { try { peer.reconnect(); } catch { /* noop */ } });
    this.hosting = { peer, room };
    this.code = code;
    this.hasPassword = !!password;
    await this._attach(localTransport(room), name, password);
    return code;
  }

  _attach(transport, name, password) {
    this.transport = transport;
    this.name = name;
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(to);
        if (err) { this.disconnect(); reject(err); } else resolve();
      };
      const to = setTimeout(() => done(new Error(this.mode === 'online' ? 'Could not reach that game. Check the code — and that the host is still in the lobby.' : 'Could not reach the host. Check the address and that the server is running on the same Wi-Fi.')), 15000);
      this._welcomed = () => { this.connected = true; bus.emit('net:open'); done(); };
      this._denied = (reason) => done(new Error(reason || 'The host refused the connection.'));
      transport.onopen = () => this.sendRaw({ t: 'join', name, password });
      transport.onmessage = (data) => this.onMessage(data);
      transport.onerror = (err) => done(err instanceof Error ? err : new Error(String(err?.message || err || 'Connection failed.')));
      transport.onclose = () => {
        const was = this.connected;
        this.connected = false;
        this.transport = null;
        if (!settled) done(new Error('The host closed the connection.'));
        else if (was) bus.emit('net:close');
      };
    });
  }

  disconnect() {
    const t = this.transport;
    this.transport = null;
    this.connected = false;
    if (t) { try { t.close(); } catch { /* noop */ } }
    if (this.hosting) { try { this.hosting.peer.destroy(); } catch { /* noop */ } this.hosting = null; }
    this.players.clear();
    this.vote = null;
    session.sharedKey = '';
    session.sharedBy = '';
  }

  get isHost() {
    return !!this.hosting;
  }

  sendRaw(msg) {
    if (this.transport?.isOpen()) this.transport.send(JSON.stringify(msg));
  }

  send(msg) {
    if (this.connected) this.sendRaw(msg);
  }

  /** Throttled position update (called each frame). */
  move(p, ry, mode) {
    const now = performance.now();
    if (now - this._lastMove < 60) return; // ~16/s
    this._lastMove = now;
    this.send({ t: 'move', p: [round(p.x), round(p.y), round(p.z)], ry: round(ry), mode });
  }

  earn(amount) {
    if (this.connected && amount) this.send({ t: 'earn', amount });
  }
  startShift() {
    this.send({ t: 'start' });
  }
  voteClockOut() {
    this.send({ t: 'vote', choice: 'clockout' });
  }
  cancelVote() {
    this.send({ t: 'vote', choice: 'cancel' });
  }
  chat(text) {
    this.send({ t: 'chat', text });
  }
  dm(to, text) {
    this.send({ t: 'dm', to, text });
  }
  rtc(to, data) {
    this.send({ t: 'rtc', to, data });
  }
  /** Offer (or withdraw, with '') your Groq key to teammates who have none. */
  shareKey(key) {
    this.send({ t: 'sharekey', key: key || '' });
  }

  onMessage(data) {
    let m;
    try { m = JSON.parse(data); } catch { return; }
    switch (m.t) {
      case 'denied':
        this._denied?.(m.reason);
        break;
      case 'welcome':
        this.id = m.id;
        this.color = m.color;
        this.team = { ...this.team, ...m.you };
        this.players.clear();
        for (const r of m.roster) if (r.id !== this.id) this.players.set(r.id, r);
        bus.emit('net:roster', this.rosterList());
        this._welcomed?.();
        this._welcomed = null;
        break;
      case 'joined':
        if (m.id !== this.id) {
          this.players.set(m.id, { id: m.id, name: m.name, color: m.color, personal: 0 });
          bus.emit('net:joined', m);
          bus.emit('net:roster', this.rosterList());
        }
        break;
      case 'rename': {
        const pl = this.players.get(m.id);
        if (pl) { pl.name = m.name; bus.emit('net:rename', m); bus.emit('net:roster', this.rosterList()); }
        break;
      }
      case 'left':
        this.players.delete(m.id);
        bus.emit('net:left', m.id);
        bus.emit('net:roster', this.rosterList());
        break;
      case 'move':
        if (m.id !== this.id) bus.emit('net:move', m);
        break;
      case 'team':
        this.team = { earned: m.earned, quota: m.quota, day: m.day, phase: m.phase };
        for (const r of m.roster || []) {
          if (r.id === this.id) continue;
          const pl = this.players.get(r.id) || {};
          this.players.set(r.id, { ...pl, ...r });
        }
        bus.emit('net:team', this.team);
        bus.emit('net:roster', this.rosterList());
        break;
      case 'vote':
        this.vote = m.open ? { kind: m.kind, yes: m.yes, needed: m.needed, total: m.total } : null;
        bus.emit('net:vote', this.vote);
        break;
      case 'start':
        bus.emit('net:start', m);
        break;
      case 'advance':
        bus.emit('net:advance', m);
        break;
      case 'chat':
        bus.emit('net:chat', m);
        break;
      case 'dm':
        bus.emit('net:dm', m);
        break;
      case 'rtc':
        bus.emit('net:rtc', m);
        break;
      case 'sharedkey':
        session.sharedKey = m.key || '';
        session.sharedBy = m.from || '';
        bus.emit('net:sharedkey', { from: m.from, on: !!m.key });
        break;
      case 'notice':
        bus.emit('net:notice', m.text);
        break;
      default:
        break;
    }
  }

  rosterList() {
    return [{ id: this.id, name: this.name, color: this.color, personal: 0, you: true }, ...this.players.values()];
  }
}

const round = (n) => Math.round(Number(n) * 100) / 100;

export const net = new Net();
