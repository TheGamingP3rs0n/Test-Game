// Desktop app (Windows / macOS / Linux). Loads the built game from dist/ over a private
// app:// scheme (a stable, secure origin, so saves, the microphone and WebRTC all work),
// and runs the LAN multiplayer server in-process when you host on your Wi-Fi.
const { app, BrowserWindow, protocol, net, session, shell, ipcMain, Menu } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

let win = null;
let lan = null; // running LAN server: { port, addresses, close() }

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    backgroundColor: '#07120c',
    title: 'Scam Call Center — Kolkata Night Shift',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  // links (Groq console, GitHub releases…) open in the real browser
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.alt && input.key === 'Enter')) { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (input.key === 'F12' && !app.isPackaged) win.webContents.toggleDevTools();
  });
  win.on('closed', () => { win = null; });
  win.loadURL('app://game/index.html');
}

async function stopLan() {
  if (!lan) return;
  const l = lan;
  lan = null;
  try { await l.close(); } catch { /* already closed */ }
}

ipcMain.handle('lan:start', async (_e, opts = {}) => {
  await stopLan();
  const { startLanServer } = await import(pathToFileURL(path.join(__dirname, '..', 'server', 'mp-server.mjs')).href);
  const port = Number(opts.port) || 8787;
  try {
    lan = await startLanServer({ port, password: String(opts.password || '') });
  } catch (err) {
    if (err && err.code === 'EADDRINUSE') throw new Error(`Port ${port} is already in use. Close the other multiplayer server (or game) and try again.`);
    throw err;
  }
  return { port: lan.port, addresses: lan.addresses, password: lan.password };
});
ipcMain.handle('lan:stop', () => stopLan());
ipcMain.handle('app:fullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); return win?.isFullScreen(); });
ipcMain.handle('app:quit', () => app.quit());

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).href);
  });
  // microphone for push-to-talk / proximity voice; nothing else is granted
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(['media', 'clipboard-sanitized-write', 'fullscreen', 'pointerLock'].includes(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => ['media', 'clipboard-sanitized-write', 'fullscreen', 'pointerLock'].includes(permission));
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', async () => {
  await stopLan();
  app.quit();
});
