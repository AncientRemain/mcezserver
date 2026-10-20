const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = async (channel, ...args) => {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (!r.ok) {
    const e = new Error(r.error);
    e.code = r.code;
    e.url = r.url;
    throw e;
  }
  return r.data;
};

const on = (channel) => (fn) => {
  const listener = (_e, ...args) => fn(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('api', {
  invoke: call,
  pathForFile: (file) => webUtils.getPathForFile(file),
  onLog: on('server:log'),
  onStatus: on('server:status'),
  onStats: on('server:stats'),
  onPlayers: on('server:players'),
  onProgress: on('server:progress'),
  onModProgress: on('mods:progress'),
  onServersChanged: on('servers:changed'),
  onQuitting: on('app:quitting'),
  onNavigate: on('app:navigate'),
  onBackup: on('server:backup'),
  onTps: on('server:tps'),
  onEvent: on('server:event'),
  onWorldProgress: on('world:progress'),
  onSystemTheme: on('app:systemTheme'),
  onPlayitChanged: on('playit:changed'),
  onPlayitLinked: on('playit:linked'),
  onPlayitError: on('playit:error'),
  onPlayitTunnel: on('playit:tunnel'),
  onPlayitProgress: on('playit:progress'),
});
