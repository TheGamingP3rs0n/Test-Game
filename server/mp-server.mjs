// Scam Call Center — LAN co-op server (host-authoritative).
//
// One player hosts: this process runs on their machine and everyone on the same
// Wi-Fi opens the host's address in a browser. The server owns the shared state
// (team earnings, quota, day, the clock-out vote) and relays each player's position
// and name so everyone sees each other's avatars and nametags. The actual phone
// calls stay local to each player; the money they make pools into the team total.
//
// Run:  node server/mp-server.mjs            (or: npm run mp)
// Env:  MP_PORT (default 8787), MP_QUOTA (starting team quota, default 1500)
import { WebSocketServer } from 'ws';
import os from 'node:os';

const PORT = Number(process.env.MP_PORT) || 8787;
const START_QUOTA = Number(process.env.MP_QUOTA) || 1500;

const COLORS = ['#ff5c5c', '#4da3ff', '#2fd36b', '#ffd34d', '#b06bff', '#ff9f1c', '#14c4c4', '#ff6bd0'];

const state = {
  day: 1,
  quota: START_QUOTA,
  earned: 0,
  phase: 'lobby', // lobby | playing | review
  vote: null, // { kind:'clockout', yes:Set, needed }
};
const players = new Map(); // id -> { id, name, color, p:[x,y,z], ry, mode, ready, personal, ws }
let nextId = 1;

const wss = new WebSocketServer({ port: PORT });

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}
function broadcast(msg, exceptId = null) {
  const s = JSON.stringify(msg);
  for (const p of players.values()) if (p.id !== exceptId && p.ws.readyState === p.ws.OPEN) p.ws.send(s);
}

function roster() {
  return [...players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, personal: Math.round(p.personal) }));
}
function teamMsg() {
  return { t: 'team', earned: Math.round(state.earned), quota: state.quota, day: state.day, phase: state.phase, roster: roster() };
}

function quotaForDay(day) {
  return Math.round((START_QUOTA * Math.pow(1.4, day - 1)) / 50) * 50;
}

function openVote(kind) {
  const needed = Math.max(1, Math.ceil(players.size / 2));
  state.vote = { kind, yes: new Set(), needed };
  broadcastVote();
}
function broadcastVote() {
  if (!state.vote) return broadcast({ t: 'vote', open: false });
  broadcast({ t: 'vote', open: true, kind: state.vote.kind, yes: state.vote.yes.size, needed: state.vote.needed, total: players.size });
}
function resolveVoteIfReady() {
  if (!state.vote) return;
  if (state.vote.yes.size >= state.vote.needed) {
    const kind = state.vote.kind;
    state.vote = null;
    broadcast({ t: 'vote', open: false });
    if (kind === 'clockout') advanceDay();
    else if (kind === 'continue') { /* just dismiss */ }
  }
}

function advanceDay() {
  state.day += 1;
  state.quota = quotaForDay(state.day);
  state.earned = 0;
  state.phase = 'playing';
  for (const p of players.values()) p.personal = 0;
  broadcast({ t: 'advance', day: state.day, quota: state.quota });
  broadcast(teamMsg());
}

function startShift() {
  if (state.phase === 'playing') return;
  state.phase = 'playing';
  state.earned = 0;
  for (const p of players.values()) p.personal = 0;
  broadcast({ t: 'start', day: state.day, quota: state.quota });
  broadcast(teamMsg());
}

wss.on('connection', (ws) => {
  const id = nextId++;
  const color = COLORS[(id - 1) % COLORS.length];
  const p = { id, name: `Agent ${id}`, color, p: [0, 0, 0], ry: 0, mode: 'seated', ready: false, personal: 0, ws };
  players.set(id, p);

  send(ws, { t: 'welcome', id, color, you: { day: state.day, quota: state.quota, earned: Math.round(state.earned), phase: state.phase }, roster: roster() });
  broadcast({ t: 'joined', id, name: p.name, color }, id);
  broadcast(teamMsg());

  ws.on('message', (data) => {
    let m;
    try { m = JSON.parse(data); } catch { return; }
    switch (m.t) {
      case 'join': // set display name
        p.name = String(m.name || p.name).slice(0, 20).replace(/[<>]/g, '') || `Agent ${id}`;
        broadcast({ t: 'rename', id, name: p.name });
        broadcast(teamMsg());
        break;
      case 'move':
        if (Array.isArray(m.p) && m.p.length === 3) { p.p = m.p.map(Number); p.ry = Number(m.ry) || 0; p.mode = m.mode || 'standing'; }
        broadcast({ t: 'move', id, p: p.p, ry: p.ry, mode: p.mode }, id);
        break;
      case 'earn': {
        const amt = Math.round(Number(m.amount) || 0);
        if (amt !== 0) { state.earned = Math.max(0, state.earned + amt); p.personal = Math.max(0, p.personal + amt); broadcast(teamMsg()); }
        break;
      }
      case 'start':
        startShift();
        break;
      case 'vote':
        if (m.choice === 'clockout') {
          if (state.earned < state.quota) { send(ws, { t: 'notice', text: 'Team quota not met yet.' }); break; }
          if (!state.vote) openVote('clockout');
          state.vote.yes.add(id);
          broadcastVote();
          resolveVoteIfReady();
        } else if (m.choice === 'cancel' && state.vote) {
          state.vote.yes.delete(id);
          if (state.vote.yes.size === 0) { state.vote = null; broadcast({ t: 'vote', open: false }); }
          else broadcastVote();
        }
        break;
      case 'chat':
        broadcast({ t: 'chat', id, name: p.name, text: String(m.text || '').slice(0, 200) });
        break;
      default:
        break;
    }
  });

  ws.on('close', () => {
    players.delete(id);
    if (state.vote) { state.vote.yes.delete(id); state.vote.needed = Math.max(1, Math.ceil(players.size / 2)); resolveVoteIfReady(); broadcastVote(); }
    broadcast({ t: 'left', id });
    broadcast(teamMsg());
  });
  ws.on('error', () => {});
});

const addrs = lanAddresses();
console.log('');
console.log('  ======================================================');
console.log('   SCAM CALL CENTER — multiplayer server is running');
console.log('  ======================================================');
console.log(`   Port: ${PORT}`);
if (addrs.length) {
  console.log('   Tell teammates on the same Wi-Fi to pick "Join" and enter:');
  for (const a of addrs) console.log(`      ${a}:${PORT}`);
} else {
  console.log('   No LAN address found — check your network connection.');
}
console.log('   (You, the host, can just use "Host" in the game.)');
console.log('  ======================================================\n');
