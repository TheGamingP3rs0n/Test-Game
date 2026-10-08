// Scam Call Center — LAN co-op server (host-authoritative).
//
// One player hosts: this process runs on their machine and everyone on the same
// Wi-Fi joins the host's address from the game's Multiplayer menu. The shared room
// logic lives in src/net/room.js (the same code runs in the browser for online games).
//
// Run:  node server/mp-server.mjs            (or: npm run mp)
// Env:  MP_PORT (default 8787), MP_QUOTA (starting team quota, default 1500),
//       MP_PASSWORD (optional lobby password)
// The desktop app imports startLanServer() and runs it in-process.
import { WebSocketServer } from 'ws';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRoom } from '../src/net/room.js';

export function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
  }
  return out;
}

/** Start the LAN server. Resolves to { port, addresses, close() }. */
export function startLanServer({ port = 8787, quota = 1500, password = '' } = {}) {
  return new Promise((resolve, reject) => {
    const room = createRoom({ quota, password });
    const wss = new WebSocketServer({ port });
    wss.on('error', reject);
    wss.on('listening', () => resolve({ port, addresses: lanAddresses(), password: !!password, close: () => new Promise((r) => wss.close(() => r())) }));
    wss.on('connection', (ws) => {
      const conn = { send: (s) => ws.send(s), isOpen: () => ws.readyState === ws.OPEN, close: () => ws.close() };
      const h = room.connect(conn);
      ws.on('message', (data) => h.message(String(data)));
      ws.on('close', () => h.close());
      ws.on('error', () => {});
    });
  });
}

// Run directly from the command line / launchers
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const PORT = Number(process.env.MP_PORT) || 8787;
  const srv = await startLanServer({ port: PORT, quota: Number(process.env.MP_QUOTA) || 1500, password: process.env.MP_PASSWORD || '' });
  console.log('');
  console.log('  ======================================================');
  console.log('   SCAM CALL CENTER — multiplayer server is running');
  console.log('  ======================================================');
  console.log(`   Port: ${srv.port}${srv.password ? '   (password protected)' : ''}`);
  if (srv.addresses.length) {
    console.log('   Tell teammates on the same Wi-Fi to pick "Join" and enter:');
    for (const a of srv.addresses) console.log(`      ${a}:${srv.port}`);
  } else {
    console.log('   No LAN address found — check your network connection.');
  }
  console.log('   (You, the host, can just use "Host" in the game.)');
  console.log('  ======================================================\n');
}
