// The small bridge the game sees as window.desktopApp (desktop builds only).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApp', {
  platform: process.platform,
  /** Start the LAN multiplayer server inside the app. Resolves to { port, addresses, password }. */
  startLanHost: (opts) => ipcRenderer.invoke('lan:start', opts),
  stopLanHost: () => ipcRenderer.invoke('lan:stop'),
  toggleFullscreen: () => ipcRenderer.invoke('app:fullscreen'),
  quit: () => ipcRenderer.invoke('app:quit'),
});
