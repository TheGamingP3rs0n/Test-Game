// The co-op "room": host-authoritative shared state (team earnings, quota, day, the
// clock-out vote) plus relaying positions, chat, DMs, shared Groq key and voice-chat
// signalling. Pure JS with no Node or DOM dependencies, so the same code runs in the
// LAN server (server/mp-server.mjs, over WebSockets) and inside a host's browser for
// online games (over PeerJS data channels).
//
// A connection is anything with send(string) and isOpen(). Call room.connect(conn) to
// get { message(raw), close() } handlers. A connection only joins once it sends
// { t:'join', name, password } with the right password (if the room has one).

const COLORS = ['#ff5c5c', '#4da3ff', '#2fd36b', '#ffd34d', '#b06bff', '#ff9f1c', '#14c4c4', '#ff6bd0'];

export function createRoom({ quota = 1500, password = '', maxPlayers = 8 } = {}) {
  const START_QUOTA = quota;
  const state = { day: 1, quota: START_QUOTA, earned: 0, phase: 'lobby', vote: null, sharedKey: '', keyOwner: null };
  const players = new Map(); // id -> { id, name, color, p, ry, mode, personal, conn }
  let nextId = 1;

  const send = (conn, msg) => { if (conn.isOpen()) conn.send(JSON.stringify(msg)); };
  const broadcast = (msg, exceptId = null) => {
    const s = JSON.stringify(msg);
    for (const p of players.values()) if (p.id !== exceptId && p.conn.isOpen()) p.conn.send(s);
  };
  const roster = () => [...players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, personal: Math.round(p.personal) }));
  const teamMsg = () => ({ t: 'team', earned: Math.round(state.earned), quota: state.quota, day: state.day, phase: state.phase, roster: roster() });
  const quotaForDay = (day) => Math.round((START_QUOTA * Math.pow(1.4, day - 1)) / 50) * 50;

  function broadcastVote() {
    if (!state.vote) return broadcast({ t: 'vote', open: false });
    broadcast({ t: 'vote', open: true, kind: state.vote.kind, yes: state.vote.yes.size, needed: state.vote.needed, total: players.size });
  }
  function openVote(kind) {
    state.vote = { kind, yes: new Set(), needed: Math.max(1, Math.ceil(players.size / 2)) };
    broadcastVote();
  }
  function resolveVoteIfReady() {
    if (!state.vote || state.vote.yes.size < state.vote.needed) return;
    const kind = state.vote.kind;
    state.vote = null;
    broadcast({ t: 'vote', open: false });
    if (kind === 'clockout') advanceDay();
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

  function admit(conn, name) {
    const id = nextId++;
    const p = { id, name: cleanName(name, id), color: COLORS[(id - 1) % COLORS.length], p: [0, 0, 0], ry: 0, mode: 'seated', personal: 0, conn };
    players.set(id, p);
    send(conn, { t: 'welcome', id, color: p.color, you: { day: state.day, quota: state.quota, earned: Math.round(state.earned), phase: state.phase }, roster: roster() });
    broadcast({ t: 'joined', id, name: p.name, color: p.color }, id);
    if (state.sharedKey) send(conn, { t: 'sharedkey', key: state.sharedKey, from: players.get(state.keyOwner)?.name || '' });
    broadcast(teamMsg());
    return p;
  }

  function handle(p, m) {
    const id = p.id;
    switch (m.t) {
      case 'join': // rename
        p.name = cleanName(m.name, id);
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
          if (state.earned < state.quota) { send(p.conn, { t: 'notice', text: 'Team quota not met yet.' }); break; }
          if (!state.vote) openVote('clockout');
          state.vote.yes.add(id);
          broadcastVote();
          resolveVoteIfReady();
        } else if (m.choice === 'cancel' && state.vote) {
          state.vote.yes.delete(id);
          if (state.vote.yes.size === 0) { state.vote = null; broadcast({ t: 'vote', open: false }); } else broadcastVote();
        }
        break;
      case 'chat':
        broadcast({ t: 'chat', id, name: p.name, text: String(m.text || '').slice(0, 200) });
        break;
      case 'sharekey': {
        const key = typeof m.key === 'string' ? m.key.trim().slice(0, 200) : '';
        if (key) { state.sharedKey = key; state.keyOwner = id; } else if (state.keyOwner === id) { state.sharedKey = ''; state.keyOwner = null; }
        for (const [pid, pl] of players) if (pid !== state.keyOwner) send(pl.conn, { t: 'sharedkey', key: state.sharedKey, from: state.sharedKey ? players.get(state.keyOwner)?.name : '' });
        break;
      }
      case 'rtc': {
        const to = players.get(Number(m.to));
        if (to && m.data) send(to.conn, { t: 'rtc', from: id, data: m.data });
        break;
      }
      case 'dm': {
        const to = players.get(Number(m.to));
        if (to) send(to.conn, { t: 'dm', from: id, name: p.name, text: String(m.text || '').slice(0, 200) });
        break;
      }
      default:
        break;
    }
  }

  function leave(p) {
    if (!players.has(p.id)) return;
    players.delete(p.id);
    const id = p.id;
    if (state.keyOwner === id) { state.sharedKey = ''; state.keyOwner = null; broadcast({ t: 'sharedkey', key: '', from: '' }); }
    if (state.vote) { state.vote.yes.delete(id); state.vote.needed = Math.max(1, Math.ceil(players.size / 2)); resolveVoteIfReady(); broadcastVote(); }
    broadcast({ t: 'left', id });
    broadcast(teamMsg());
  }

  return {
    get size() { return players.size; },
    get hasPassword() { return !!password; },
    /** Wire up one connection; returns handlers for its incoming messages and close. */
    connect(conn) {
      let player = null;
      return {
        message(raw) {
          let m;
          try { m = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return; }
          if (!m || typeof m.t !== 'string') return;
          if (!player) {
            if (m.t !== 'join') return;
            if (password && String(m.password || '') !== password) {
              send(conn, { t: 'denied', reason: 'Wrong lobby password.' });
              conn.close?.();
              return;
            }
            if (players.size >= maxPlayers) {
              send(conn, { t: 'denied', reason: 'The lobby is full.' });
              conn.close?.();
              return;
            }
            player = admit(conn, m.name);
            return;
          }
          handle(player, m);
        },
        close() { if (player) leave(player); },
      };
    },
  };
}

function cleanName(name, id) {
  return String(name || '').slice(0, 20).replace(/[<>]/g, '').trim() || `Agent ${id}`;
}

/** A short, easy-to-read join code (no 0/O/1/I). */
export function makeJoinCode(len = 6) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}
