// Client side of LAN co-op. Connects to the host's WebSocket server, sends our name,
// position and earnings, and emits what the server broadcasts (other players, team
// quota, votes) back through the game bus. Single-player is unaffected when unused.
import { bus } from '../core/bus.js';

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
    this.ws = null;
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

  connect(url, name) {
    this.disconnect();
    this.url = url;
    this.name = name;
    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        return reject(err);
      }
      this.ws = ws;
      const to = setTimeout(() => {
        if (!this.connected) {
          try { ws.close(); } catch { /* noop */ }
          reject(new Error('Could not reach the host. Check the address and that the server is running on the same Wi-Fi.'));
        }
      }, 6000);
      ws.onopen = () => {
        clearTimeout(to);
        this.connected = true;
        this.send({ t: 'join', name });
        bus.emit('net:open');
        resolve();
      };
      ws.onmessage = (e) => this.onMessage(e.data);
      ws.onclose = () => {
        clearTimeout(to);
        const was = this.connected;
        this.connected = false;
        this.ws = null;
        if (was) bus.emit('net:close');
      };
      ws.onerror = () => {
        if (!this.connected) {
          clearTimeout(to);
          reject(new Error('Connection failed. Is the host server running?'));
        }
      };
    });
  }

  disconnect() {
    if (this.ws) {
      try { this.ws.close(); } catch { /* noop */ }
    }
    this.ws = null;
    this.connected = false;
    this.players.clear();
    this.vote = null;
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
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

  onMessage(data) {
    let m;
    try { m = JSON.parse(data); } catch { return; }
    switch (m.t) {
      case 'welcome':
        this.id = m.id;
        this.color = m.color;
        this.team = { ...this.team, ...m.you };
        this.players.clear();
        for (const r of m.roster) if (r.id !== this.id) this.players.set(r.id, r);
        bus.emit('net:roster', this.rosterList());
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
