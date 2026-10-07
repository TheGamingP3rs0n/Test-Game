// Host launcher: serves the built game on the LAN and runs the co-op server, so
// teammates on the same Wi-Fi can open the game and join. Run with: npm run host
import { spawn } from 'node:child_process';
import os from 'node:os';

const GAME_PORT = Number(process.env.MP_GAME_PORT) || 4173;
const MP_PORT = Number(process.env.MP_PORT) || 8787;

function lan() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) if (ni.family === 'IPv4' && !ni.internal) return ni.address;
  }
  return 'localhost';
}
const ip = lan();

const srv = spawn(process.execPath, ['server/mp-server.mjs'], { stdio: 'inherit', env: { ...process.env, MP_PORT: String(MP_PORT) } });
// vite preview bound to all interfaces so the LAN can reach it
const preview = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'preview', '--host', '--port', String(GAME_PORT)], { stdio: 'inherit' });

setTimeout(() => {
  console.log('\n  ======================================================');
  console.log('   HOSTING — share these with teammates on your Wi-Fi:');
  console.log(`     Open the game:  http://${ip}:${GAME_PORT}`);
  console.log(`     In-game "Join" address:  ${ip}`);
  console.log('   You (host): open the game, pick Multiplayer -> Host -> Connect.');
  console.log('  ======================================================\n');
}, 2500);

const stop = () => { srv.kill(); preview.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
srv.on('exit', stop);
preview.on('exit', stop);
