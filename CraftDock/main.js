const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage, Menu, Tray, Notification, nativeImage, nativeTheme } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ServerManager } = require('./src/backend/servers');
const { JavaManager } = require('./src/backend/java');
const { ModService, contentKind, recommended, MR_CATEGORIES } = require('./src/backend/mods');
const { PlayitService } = require('./src/backend/playit');
const modpacks = require('./src/backend/modpack');
const versions = require('./src/backend/versions');
const importer = require('./src/backend/importer');
const worlds = require('./src/backend/worlds');
const addons = require('./src/backend/bedrock');
const T = require('./src/backend/types');
const { UA } = require('./src/backend/net');
const { extractArchive } = require('./src/backend/archive');

app.setName('CraftDock');
if (process.env.CRAFTDOCK_DATA) app.setPath('userData', process.env.CRAFTDOCK_DATA);
// automated UI tests take screenshots, so keep painting even when the window is covered
if (process.env.CRAFTDOCK_AUTOMATE) app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
const dataDir = app.getPath('userData');
const settingsFile = path.join(dataDir, 'settings.json');
const stagingRoot = path.join(dataDir, 'import-staging');
const ICON = path.join(__dirname, 'build', 'icon.png');

// The installer launches `CraftDock.exe --quit-for-update` so a running copy can stop its
// servers cleanly before files are replaced (handled in 'second-instance' below).
const QUIT_FOR_UPDATE = process.argv.includes('--quit-for-update');
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
if (QUIT_FOR_UPDATE) {
  // nothing was running, so there is nothing to stop
  app.quit();
  process.exit(0);
}

// ---------- settings ----------
const DEFAULTS = {
  defaultMemoryMB: 4096,
  accent: 'emerald',
  theme: 'dark',
  uiScale: 100,
  consoleFontSize: 13,
  consoleWrap: true,
  consoleColors: true,
  reduceMotion: false,
  backgroundGlow: true,
  density: 'comfortable',
  dashboardView: 'grid',
  sidebarSort: 'created',
  startPage: 'dashboard',
  lastServer: '',
  defaultLoader: 'paper',
  tpsMonitor: true,
  backupDir: '',
  closeToTray: true,
  launchAtLogin: false,
  startMinimized: true,
  notifyCrash: true,
  notifyOnline: false,
  notifyPlayers: true,
  confirmStop: true,
  consoleTimestamps: true,
  compactSidebar: false,
};
function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch { return {}; }
}
function writeSettings(s) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(s, null, 2));
}
const setting = (k) => { const s = readSettings(); return k in s ? s[k] : DEFAULTS[k]; };
function curseforgeKey() {
  const s = readSettings();
  if (s.cfKeyEnc && safeStorage.isEncryptionAvailable()) {
    try { return safeStorage.decryptString(Buffer.from(s.cfKeyEnc, 'base64')); } catch { return null; }
  }
  return s.cfKey || null;
}
function publicSettings() {
  const s = readSettings();
  const out = { hasCurseforgeKey: !!curseforgeKey(), packaged: app.isPackaged };
  for (const k of Object.keys(DEFAULTS)) out[k] = k in s ? s[k] : DEFAULTS[k];
  return out;
}
const THEME_BG = { dark: ['#0b0d12', '#9aa3b2'], midnight: ['#000000', '#8a8f99'], light: ['#f4f6fa', '#4b5363'], ocean: ['#07131c', '#8fb3c9'], forest: ['#0a120d', '#98ad9f'] };
function themeColors(theme = setting('theme')) {
  const t = theme === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : theme;
  return THEME_BG[t] || THEME_BG.dark;
}

const java = new JavaManager(dataDir);
const mods = new ModService(curseforgeKey);
const servers = new ServerManager({ dataDir, java, getSettings: () => ({ ...DEFAULTS, ...readSettings() }), mods });
const playit = new PlayitService(dataDir);

let win;
let tray;
let quitting = false;
const startHidden = process.argv.includes('--hidden');

function createWindow() {
  const [bg, fg] = themeColors();
  win = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: bg,
    title: 'CraftDock',
    icon: ICON,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: bg, symbolColor: fg, height: 38 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: !process.env.CRAFTDOCK_AUTOMATE,
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor((Number(setting('uiScale')) || 100) / 100));
  win.once('ready-to-show', () => { if (!(startHidden && setting('startMinimized'))) win.show(); });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('close', (e) => {
    if (quitting || !setting('closeToTray') || process.env.CRAFTDOCK_AUTOMATE) return;
    e.preventDefault();
    win.hide();
    const s = readSettings();
    if (!s.trayHintShown) {
      notify('CraftDock is still running', 'Your servers keep running in the background. Right-click the tray icon to quit.');
      writeSettings({ ...s, trayHintShown: true });
    }
  });
  if (process.env.CRAFTDOCK_AUTOMATE) runAutomation(process.env.CRAFTDOCK_AUTOMATE);
}

function showWindow(serverId) {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (serverId) send('app:navigate', serverId);
}

// Developer aid: CRAFTDOCK_AUTOMATE=steps.json runs [{js}|{wait}|{shot}] against the window (used for testing).
function runAutomation(file) {
  win.webContents.on('console-message', (e) => console.log('[renderer]', e.message));
  win.webContents.once('did-finish-load', async () => {
    const steps = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    for (const s of steps) {
      try {
        if (s.wait) await new Promise((r) => setTimeout(r, s.wait));
        if (s.js) console.log('[auto]', JSON.stringify(await win.webContents.executeJavaScript(s.js)));
        if (s.shot) {
          win.webContents.invalidate();
          await new Promise((r) => setTimeout(r, 250));
          fs.writeFileSync(s.shot, (await win.webContents.capturePage()).toPNG());
        }
        if (s.quit) { quitting = true; app.quit(); }
      } catch (err) { console.log('[auto error]', err.message); }
    }
  });
}

const send = (channel, ...args) => { if (win && !win.isDestroyed()) win.webContents.send(channel, ...args); };

// ---------- notifications ----------
function notify(title, body, serverId) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: ICON, silent: false });
  n.on('click', () => showWindow(serverId));
  n.show();
}

// ---------- tray ----------
const STATUS_TEXT = { online: 'Online', offline: 'Offline', starting: 'Starting…', stopping: 'Stopping…', crashed: 'Crashed', installing: 'Installing…', error: 'Install failed' };
function updateTray() {
  if (!tray) return;
  let list = [];
  try { list = servers.summaries(); } catch {}
  const running = list.filter((s) => ['online', 'starting', 'stopping'].includes(s.status)).length;
  tray.setToolTip(`CraftDock · ${running} server${running === 1 ? '' : 's'} running`);
  const items = list.map((s) => {
    const isRunning = ['online', 'starting', 'stopping'].includes(s.status);
    return {
      label: `${s.name} · ${STATUS_TEXT[s.status] || s.status}${s.status === 'online' && s.players.length ? ` · ${s.players.length} online` : ''}`,
      submenu: [
        { label: 'Open', click: () => showWindow(s.id) },
        { label: 'Start', enabled: !isRunning && s.state === 'ready', click: () => servers.start(s.id).catch((e) => notify(s.name, e.message)) },
        { label: 'Restart', enabled: s.status === 'online', click: () => servers.restart(s.id) },
        { label: 'Stop', enabled: isRunning, click: () => servers.stop(s.id) },
      ],
    };
  });
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open CraftDock', click: () => showWindow() },
    { type: 'separator' },
    ...(items.length ? items : [{ label: 'No servers yet', enabled: false }]),
    { type: 'separator' },
    { label: 'Stop all servers', enabled: running > 0, click: () => servers.stopAll() },
    { label: 'Quit CraftDock', click: () => { quitting = true; app.quit(); } },
  ]));
}
function createTray() {
  const img = nativeImage.createFromPath(ICON).resize({ width: 16, height: 16, quality: 'best' });
  tray = new Tray(img);
  tray.on('click', () => showWindow());
  updateTray();
}

function applyLoginItem() {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: !!setting('launchAtLogin'), args: ['--hidden'] });
}

// ---------- server events ----------
servers.on('log', (id, lines) => send('server:log', id, lines));
servers.on('stats', (id, stats) => send('server:stats', id, stats));
servers.on('players', (id, players) => { send('server:players', id, players); updateTray(); });
servers.on('progress', (id, p) => send('server:progress', id, p));
servers.on('worldProgress', (id, p) => send('world:progress', id, p));
servers.on('changed', () => { send('servers:changed'); updateTray(); });
servers.on('backup', (id) => send('server:backup', id));
servers.on('tps', (id, tps) => send('server:tps', id, tps));
servers.on('event', (id, e) => send('server:event', id, e));
servers.on('status', (id, status) => {
  send('server:status', id, status);
  updateTray();
  let cfg;
  try { cfg = servers.load(id); } catch { return; }
  if (status === 'online' && setting('notifyOnline')) notify(cfg.name, 'Server is online and ready to join.', id);
  if (status === 'crashed' && setting('notifyCrash')) notify(`${cfg.name} crashed`, 'Open CraftDock to see what went wrong.', id);
  if (status === 'starting' && cfg.playit && cfg.playit.enabled) playitConnect(id);
  if (status === 'offline' || status === 'crashed') playit.release(id);
});
servers.on('player', (id, name, joined) => {
  if (!setting('notifyPlayers')) return;
  let cfg;
  try { cfg = servers.load(id); } catch { return; }
  notify(cfg.name, `${name} ${joined ? 'joined' : 'left'} the game`, id);
});

// ---------- playit.gg ----------
playit.on('changed', () => send('playit:changed', playit.status()));
playit.on('linked', () => send('playit:linked'));
playit.on('claim-error', (msg) => send('playit:error', msg));
playit.on('agent-error', (msg) => send('playit:error', `playit agent: ${msg}`));

async function playitConnect(id) {
  const cfg = servers.load(id);
  const log = (msg, kind = 'system') => servers._log(id, `[CraftDock] ${msg}`, kind);
  try {
    if (!playit.secret()) { log('playit.gg is turned on for this server but not set up yet. Open the Overview tab → Connect to finish setup.', 'error'); return; }
    if (!playit.installed()) { log('Downloading the playit.gg agent…'); await playit.installAgent(); }
    playit.acquire(id);
    const bedrock = T.isBedrock(cfg.loader);
    const port = servers.portOf(id, cfg);
    log('Connecting playit.gg tunnel…');
    const { tunnelId, address } = await playit.ensureTunnel(cfg.name, port, cfg.playit && cfg.playit.tunnelId, bedrock ? 'bedrock' : 'java');
    const patch = { enabled: true, tunnelId, address };
    if (bedrock && String(servers.getProperties(id).transport || 'nethernet').toLowerCase() !== 'raknet') {
      log('Heads up: playit.gg\'s free Bedrock tunnels only carry RakNet connections, and this server uses NetherNet. See Settings → Game → Connection method.', 'error');
    }
    servers.update(id, { playit: patch });
    log(address ? `Public address (playit.gg): ${address}` : 'playit.gg tunnel created; its address will appear in a moment.');
    send('playit:tunnel', id, { tunnelId, address });
  } catch (e) {
    log(`playit.gg: ${e.message}`, 'error');
    send('playit:error', e.message);
  }
}

// ---------- IPC ----------
const handle = (channel, fn) =>
  ipcMain.handle(channel, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; }
    catch (err) { return { ok: false, error: err.message || String(err), code: err.code, url: err.url }; }
  });

handle('system:info', () => ({
  totalMem: os.totalmem(), freeMem: os.freemem(), cpus: os.cpus().length, cpuModel: (os.cpus()[0] || {}).model,
  platform: process.platform, version: app.getVersion(), dataDir, hostname: os.hostname(),
}));
handle('system:publicIp', async () => {
  const r = await fetch('https://api.ipify.org?format=json', { headers: { 'User-Agent': UA } });
  return (await r.json()).ip;
});
handle('types:list', () => T.publicTypes());
handle('settings:get', () => publicSettings());
handle('settings:set', (patch) => {
  const s = readSettings();
  if ('curseforgeKey' in patch) {
    delete s.cfKey; delete s.cfKeyEnc;
    const key = String(patch.curseforgeKey || '').trim();
    if (key) {
      if (safeStorage.isEncryptionAvailable()) s.cfKeyEnc = safeStorage.encryptString(key).toString('base64');
      else s.cfKey = key;
    }
  }
  if ('backupDir' in patch && patch.backupDir && !fs.existsSync(patch.backupDir)) throw new Error('That backup folder doesn\'t exist');
  for (const k of Object.keys(DEFAULTS)) {
    if (k in patch) s[k] = typeof DEFAULTS[k] === 'number' ? Number(patch[k]) : typeof DEFAULTS[k] === 'boolean' ? !!patch[k] : String(patch[k]);
  }
  if ('uiScale' in patch) s.uiScale = Math.max(70, Math.min(150, Number(patch.uiScale) || 100));
  writeSettings(s);
  if ('launchAtLogin' in patch) applyLoginItem();
  if ('uiScale' in patch && win) win.webContents.setZoomFactor(s.uiScale / 100);
  if ('theme' in patch && win) { const [bg, fg] = themeColors(s.theme); try { win.setTitleBarOverlay({ color: bg, symbolColor: fg }); win.setBackgroundColor(bg); } catch {} }
  return publicSettings();
});
handle('settings:pickBackupDir', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose where to keep backups', properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
handle('app:titleBar', (bg, fg) => { try { win.setTitleBarOverlay({ color: bg, symbolColor: fg }); win.setBackgroundColor(bg); } catch {} });
handle('app:systemDark', () => nativeTheme.shouldUseDarkColors);
handle('app:openData', () => shell.openPath(dataDir));
handle('app:cacheInfo', async () => {
  const dirs = [path.join(path.dirname(servers.shortTmp()), 'buildtools'), stagingRoot, servers.shortTmp()];
  let bytes = 0;
  for (const d of dirs) bytes += await worlds.dirSize(d).catch(() => 0);
  return { bytes };
});
handle('app:clearCache', async () => {
  for (const d of [path.join(path.dirname(servers.shortTmp()), 'buildtools'), stagingRoot]) await fs.promises.rm(d, { recursive: true, force: true }).catch(() => {});
  return true;
});
nativeTheme.on('updated', () => { if (setting('theme') === 'system') send('app:systemTheme', nativeTheme.shouldUseDarkColors); });

handle('versions:games', (loader, snapshots) => versions.listGameVersions(loader, snapshots));
handle('versions:loaders', (loader, mc) => versions.listLoaderVersions(loader, mc));
handle('versions:latest', async () => (await versions.mojangManifest()).latest.release);

handle('servers:list', () => servers.summaries());
handle('servers:get', (id) => servers.summary(id));
handle('servers:create', (opts) => servers.create(opts));
handle('servers:reinstall', (id) => servers.reinstall(id));
handle('servers:changeVersion', (id, mc, lv, opts) => servers.changeVersion(id, mc, lv, opts || {}));
handle('servers:softwareUpdate', (id) => servers.softwareUpdate(id));
handle('servers:updateSoftware', (id) => servers.updateSoftware(id));
handle('servers:clone', (id, name) => servers.clone(id, name));
handle('servers:update', (id, patch) => servers.update(id, patch));
handle('servers:delete', async (id) => {
  const cfg = servers.load(id);
  if (cfg.playit && playit.secret()) {
    for (const t of [cfg.playit.tunnelId, cfg.playit.bedrockTunnelId]) if (t) await playit.deleteTunnel(t).catch(() => {});
  }
  return servers.remove(id);
});
handle('servers:start', (id) => servers.start(id));
handle('servers:stop', (id) => servers.stop(id));
handle('servers:restart', (id) => servers.restart(id));
handle('servers:countdown', (id, seconds, action) => { servers._countdown(id, seconds, action); });
handle('servers:kill', (id) => servers.kill(id));
handle('servers:startAll', async () => {
  let n = 0;
  for (const c of servers.list()) {
    if (c.state !== 'ready' || servers.runtime(c.id).proc) continue;
    try { await servers.start(c.id); n++; } catch (e) { servers._log(c.id, `[CraftDock] ${e.message}`, 'error'); }
  }
  return n;
});
handle('servers:stopAll', () => servers.stopAll());
handle('servers:command', (id, cmd) => servers.command(id, cmd));
handle('servers:logs', (id) => servers.logs(id));
handle('servers:clearCrash', (id) => servers.clearCrash(id));
handle('servers:events', (id) => servers.events(id));
handle('servers:clearEvents', (id) => servers.clearEvents(id));
handle('servers:playerHistory', (id) => servers.playerHistory(id));
handle('servers:tps', (id) => servers.queryTps(id));
handle('servers:testWebhook', (id, url) => servers.testWebhook(url, servers.load(id).name));
handle('servers:openFolder', (id, sub) => {
  const target = servers._safe(id, sub || '');
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
  return shell.openPath(target);
});
handle('servers:openPath', (id, abs) => {
  const rel = path.relative(servers.dir(id), path.resolve(servers.dir(id), abs));
  return shell.openPath(servers._safe(id, rel));
});
handle('servers:properties', (id) => servers.getProperties(id));
handle('servers:setProperties', (id, patch) => servers.setProperties(id, patch));
handle('servers:acceptEula', (id) => servers.acceptEula(id));
handle('servers:players', (id) => servers.playerLists(id));
handle('servers:javaInfo', (id) => servers.javaInfo(id));
handle('servers:backups', (id) => servers.backups(id));
handle('servers:createBackup', (id, opts) => servers.createBackup(id, opts || {}));
handle('servers:restoreBackup', (id, file) => servers.restoreBackup(id, file));
handle('servers:deleteBackup', (id, file) => servers.deleteBackup(id, file));
handle('servers:backupNote', (id, file, note) => servers.setBackupNote(id, file, note));
handle('servers:openBackups', (id) => { const d = servers.backupsDir(id); fs.mkdirSync(d, { recursive: true }); return shell.openPath(d); });
handle('servers:logsList', (id) => servers.listLogs(id));
handle('servers:logRead', (id, rel) => servers.readLog(id, rel));
handle('servers:shareLog', async (text) => {
  const body = new URLSearchParams({ content: String(text).slice(-9_000_000) });
  const r = await fetch('https://api.mclo.gs/1/log', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA }, body });
  const j = await r.json();
  if (!j.success) throw new Error(j.error || 'mclo.gs rejected the log');
  return j.url;
});
handle('servers:export', async (id) => {
  const cfg = servers.load(id);
  const r = await dialog.showSaveDialog(win, { title: 'Export server', defaultPath: `${cfg.name.replace(/[\\/:*?"<>|]/g, '_')}.zip`, filters: [{ name: 'Zip archive', extensions: ['zip'] }] });
  if (r.canceled || !r.filePath) return null;
  await servers.exportServer(id, r.filePath);
  shell.showItemInFolder(r.filePath);
  return r.filePath;
});
handle('servers:velocity', (id) => servers.velocityConfig(id));
handle('servers:setVelocity', (id, patch) => servers.setVelocityConfig(id, patch));
handle('servers:network', (id) => servers.network(id));
handle('servers:setNetwork', (id, members) => servers.setNetwork(id, members));
handle('servers:pickIcon', async (id) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }] });
  if (r.canceled || !r.filePaths[0]) return false;
  let img = nativeImage.createFromPath(r.filePaths[0]);
  if (img.isEmpty()) throw new Error('That image could not be read. Try a PNG or JPG.');
  const { width, height } = img.getSize();
  const side = Math.min(width, height);
  img = img.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side });
  servers.setIconPng(id, img.resize({ width: 64, height: 64, quality: 'best' }).toPNG());
  return true;
});
handle('servers:removeIcon', (id) => servers.removeIcon(id));

handle('files:list', (id, rel) => servers.listFiles(id, rel));
handle('files:read', (id, rel) => servers.readFile(id, rel));
handle('files:write', (id, rel, content) => servers.writeFile(id, rel, content));
handle('files:delete', (id, rel) => servers.deleteFile(id, rel));
handle('files:open', (id, rel) => shell.openPath(servers._safe(id, rel)));
handle('files:new', (id, rel, folder) => servers.newFile(id, rel, folder));
handle('files:rename', (id, rel, name) => servers.renameFile(id, rel, name));
handle('files:upload', (id, rel, paths) => servers.uploadFiles(id, rel, paths));
handle('files:pickUpload', async (id, rel) => {
  const r = await dialog.showOpenDialog(win, { title: 'Upload files into the server folder', properties: ['openFile', 'multiSelections'] });
  return r.canceled ? 0 : servers.uploadFiles(id, rel, r.filePaths);
});

// ---------- mods / plugins / datapacks ----------
const modCtx = (id) => ({ cfg: servers.load(id), dir: servers.dir(id) });
handle('mods:kind', (id) => contentKind(servers.load(id).loader));
handle('mods:categories', (kind) => MR_CATEGORIES[kind] || MR_CATEGORIES.mod);
handle('mods:search', (id, source, params) => {
  const { cfg } = modCtx(id);
  return mods.search(source, { ...params, loader: cfg.loader, mc: cfg.mcVersion });
});
handle('mods:project', (projectId) => mods.project(projectId));
handle('mods:versions', (id, source, projectId, kind) => mods.versions(source, projectId, modCtx(id).cfg, kind).then((l) => l.map(({ raw, ...v }) => v)));
handle('mods:install', (id, source, projectId, versionId, kind) => {
  const { cfg, dir } = modCtx(id);
  return mods.install(cfg, dir, source, projectId, versionId, (p) => send('mods:progress', id, p), kind);
});
handle('mods:list', (id, kind) => { const { cfg, dir } = modCtx(id); return mods.list(cfg, dir, kind); });
handle('mods:toggle', (id, file, enabled, kind) => { const { cfg, dir } = modCtx(id); return mods.toggle(cfg, dir, file, enabled, kind); });
handle('mods:remove', (id, file, kind) => { const { cfg, dir } = modCtx(id); return mods.remove(cfg, dir, file, kind); });
handle('mods:addFiles', (id, files, kind) => { const { cfg, dir } = modCtx(id); return mods.addFiles(cfg, dir, files, kind); });
handle('mods:pickFiles', async (id, kind) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Mods, plugins & datapacks', extensions: ['jar', 'zip'] }] });
  if (r.canceled) return [];
  const { cfg, dir } = modCtx(id);
  return mods.addFiles(cfg, dir, r.filePaths, kind);
});
handle('mods:checkUpdates', (id, kind) => { const { cfg, dir } = modCtx(id); return mods.checkUpdates(cfg, dir, kind); });
handle('mods:updateAll', (id) => { const { cfg, dir } = modCtx(id); return mods.updateAll(cfg, dir); });
handle('mods:recommended', (loader, mc) => recommended(loader, mc));
handle('mods:installPerf', (id, slugs) => { const { cfg, dir } = modCtx(id); return mods.installMany(cfg, dir, slugs); });
handle('mods:installGeyser', async (id) => {
  const { cfg, dir } = modCtx(id);
  const r = await mods.installGeyser(cfg, dir);
  servers.update(id, { geyser: { enabled: true, port: (cfg.geyser && cfg.geyser.port) || servers.freePort(19132, id) } });
  return r;
});

// ---------- Bedrock add-ons ----------
handle('addons:list', (id) => addons.listAddons(servers.dir(id)));
handle('addons:pick', async (id) => {
  const r = await dialog.showOpenDialog(win, { title: 'Add Bedrock add-ons', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Bedrock add-ons', extensions: ['mcpack', 'mcaddon', 'zip'] }] });
  if (r.canceled) return [];
  const names = [];
  for (const f of r.filePaths) names.push(...(await addons.importAddon(servers.dir(id), f, servers.shortTmp())));
  return names;
});
handle('addons:import', async (id, files) => {
  const names = [];
  for (const f of files) names.push(...(await addons.importAddon(servers.dir(id), f, servers.shortTmp())));
  return names;
});
handle('addons:toggle', (id, uuid, on) => addons.toggleAddon(servers.dir(id), uuid, on));
handle('addons:remove', (id, uuid) => addons.removeAddon(servers.dir(id), uuid));

// ---------- worlds ----------
const insideStaging = (p) => p && path.resolve(p).startsWith(stagingRoot + path.sep);
handle('worlds:list', (id) => servers.worlds(id));
handle('worlds:saves', (edition) => worlds.discoverSaves(edition));
handle('worlds:pick', async (kind) => {
  const r = kind === 'folder'
    ? await dialog.showOpenDialog(win, { title: 'Choose the world folder (the one with level.dat)', properties: ['openDirectory'] })
    : await dialog.showOpenDialog(win, { title: 'Choose a world file', properties: ['openFile'], filters: [{ name: 'Worlds', extensions: ['zip', 'mcworld'] }] });
  return r.canceled ? null : r.filePaths[0];
});
/** Accepts a world folder, .zip or .mcworld and returns { source, staging, info, warnings, error }. */
async function prepareWorld(src, loader, mcVersion) {
  const st = fs.statSync(src);
  let root = src, staging = null;
  if (st.isFile()) {
    if (!/\.(zip|mcworld)$/i.test(src)) throw new Error('Choose a world folder, a .zip or a .mcworld file');
    staging = path.join(stagingRoot, `world-${Date.now()}`);
    await extractArchive(src, staging);
    root = worlds.findWorldRoot(staging);
  } else if (!fs.existsSync(path.join(src, 'level.dat'))) {
    root = worlds.findWorldRoot(src);
  }
  const check = worlds.inspectImport(root, loader, mcVersion);
  return { source: root, staging, label: src, ...check };
}
handle('worlds:inspect', async (id, src) => { const cfg = servers.load(id); return prepareWorld(src, cfg.loader, cfg.mcVersion); });
handle('worlds:inspectFor', (loader, mcVersion, src) => prepareWorld(src, loader, mcVersion));
handle('worlds:discard', (staging) => { if (insideStaging(staging)) fs.rmSync(staging, { recursive: true, force: true }); });
handle('worlds:import', async (id, opts) => {
  try {
    return await servers.importWorld(id, opts.source, opts);
  } finally {
    if (insideStaging(opts.staging)) fs.rmSync(opts.staging, { recursive: true, force: true });
  }
});
handle('worlds:setActive', (id, name) => servers.setActiveWorld(id, name));
handle('worlds:rename', (id, from, to) => servers.renameWorld(id, from, to));
handle('worlds:delete', (id, name) => servers.deleteWorld(id, name));
handle('worlds:reset', (id, opts) => servers.resetWorld(id, opts || {}));
handle('worlds:export', async (id, name) => {
  const cfg = servers.load(id);
  const bedrock = T.isBedrock(cfg.loader);
  const r = await dialog.showSaveDialog(win, { title: 'Download world', defaultPath: `${name}.${bedrock ? 'mcworld' : 'zip'}`, filters: [bedrock ? { name: 'Bedrock world', extensions: ['mcworld'] } : { name: 'Zip archive', extensions: ['zip'] }] });
  if (r.canceled || !r.filePath) return null;
  await servers.exportWorld(id, name, r.filePath);
  shell.showItemInFolder(r.filePath);
  return r.filePath;
});
handle('worlds:toSingleplayer', (id, name) => servers.copyWorldToSingleplayer(id, name));
handle('worlds:gamerules', (id, name) => servers.gamerules(id, name));
handle('worlds:setGamerules', (id, name, patch) => servers.setGamerules(id, name, patch));

// ---------- importing existing servers ----------
handle('import:pick', async (kind) => {
  const r = kind === 'zip'
    ? await dialog.showOpenDialog(win, { title: 'Choose a server .zip', properties: ['openFile'], filters: [{ name: 'Zip archives', extensions: ['zip'] }] })
    : await dialog.showOpenDialog(win, { title: 'Choose your server folder (the one with server.properties)', properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
handle('import:analyze', async (src) => {
  const st = fs.statSync(src);
  let root = src;
  let staging = null;
  if (st.isFile()) {
    if (!/\.zip$/i.test(src)) throw new Error('Choose a .zip file or a server folder');
    staging = path.join(stagingRoot, `${Date.now()}`);
    await extractArchive(src, staging);
    root = importer.findServerRoot(staging);
  } else {
    root = importer.findServerRoot(src);
  }
  const det = importer.analyze(root);
  const size = await importer.measure(root);
  return {
    ...det,
    source: root,
    staging,
    label: src,
    size: size.bytes,
    name: det.name || path.basename(st.isFile() ? src.replace(/\.zip$/i, '') : root),
  };
});
handle('import:discard', (staging) => {
  if (insideStaging(staging)) fs.rmSync(staging, { recursive: true, force: true });
});
handle('import:run', (opts) => servers.importServer({ ...opts, cleanupSource: opts.staging || null }));

handle('modpacks:search', (params) => modpacks.searchModpacks(params));
handle('modpacks:versions', (projectId) => modpacks.modpackVersions(projectId));
handle('modpacks:create', async (opts) => {
  const t = await modpacks.modpackTarget(opts.versionId);
  return servers.create({
    ...opts,
    loader: t.loader,
    mcVersion: t.mcVersion,
    loaderVersion: null,
    modpack: { projectId: t.project.id, versionId: t.version.id, title: t.project.title, icon: t.project.icon_url, versionName: t.version.version_number, url: `https://modrinth.com/modpack/${t.project.slug}` },
  });
});

handle('playit:status', () => playit.status());
handle('playit:install', () => playit.installAgent((pct) => send('playit:progress', pct)));
handle('playit:startClaim', async () => {
  if (!playit.installed()) await playit.installAgent((pct) => send('playit:progress', pct));
  return playit.startClaim();
});
handle('playit:cancelClaim', () => playit.cancelClaim());
handle('playit:unlink', () => playit.unlink());
handle('playit:account', () => playit.account());
handle('playit:log', () => playit.logTail(60));
handle('playit:setEnabled', async (id, enabled) => {
  const cfg = servers.load(id);
  servers.update(id, { playit: { ...(cfg.playit || {}), enabled: !!enabled } });
  const running = ['online', 'starting'].includes(servers.runtime(id).status);
  if (enabled && running) await playitConnect(id);
  if (!enabled) playit.release(id);
  return servers.summary(id).playit;
});
handle('playit:deleteTunnel', async (id) => {
  const cfg = servers.load(id);
  for (const t of [cfg.playit && cfg.playit.tunnelId, cfg.playit && cfg.playit.bedrockTunnelId]) if (t) await playit.deleteTunnel(t);
  playit.release(id);
  servers.update(id, { playit: { enabled: false, tunnelId: null, address: null, bedrockTunnelId: null, bedrockAddress: null } });
});

/** SHA-1 of a resource pack download, so server.properties can tell clients when it changed. */
handle('util:sha1Url', async (url) => {
  if (!/^https:\/\//.test(String(url))) throw new Error('Use an https:// link');
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!res.ok) throw new Error(`The link answered HTTP ${res.status}`);
  const h = require('crypto').createHash('sha1');
  const reader = res.body.getReader();
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > 500 * 1048576) { try { reader.cancel(); } catch {} throw new Error('That file is over 500 MB, which is too big for a resource pack'); }
    h.update(value);
  }
  return h.digest('hex');
});

handle('shell:open', (url) => {
  if (!/^https:\/\//.test(url)) throw new Error('Only https links can be opened');
  return shell.openExternal(url);
});
handle('shell:showItem', (p) => shell.showItemInFolder(p));

// ---------- lifecycle ----------
app.on('second-instance', (_e, argv) => {
  if (argv.includes('--quit-for-update')) {
    // An update is being installed: stop every server cleanly, then exit.
    quitting = true;
    if (servers.runningIds().length) {
      showWindow();
      send('app:quitting', 'update');
    }
    servers.stopAll().then(() => playit.stopAgent()).then(() => app.exit(0));
    return;
  }
  showWindow();
});

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('app.craftdock.desktop');
  createWindow();
  createTray();
  applyLoginItem();
  // servers marked "start when CraftDock opens"
  let delay = 1500;
  for (const cfg of servers.list()) {
    if (cfg.state === 'ready' && cfg.automation && cfg.automation.autoStart) {
      setTimeout(() => servers.start(cfg.id).catch((e) => servers._log(cfg.id, `[CraftDock] Auto-start failed: ${e.message}`, 'error')), delay);
      delay += 4000;
    }
  }
});

app.on('before-quit', (e) => {
  quitting = true;
  if (!servers.runningIds().length) { playit.stopAgent(); return; }
  e.preventDefault();
  if (app._stopping) return;
  app._stopping = true;
  send('app:quitting');
  if (win && !win.isDestroyed()) win.show();
  servers.stopAll().then(() => playit.stopAgent()).then(() => app.exit(0));
});
app.on('window-all-closed', () => {
  if (!quitting && setting('closeToTray')) return;
  app.quit();
});
