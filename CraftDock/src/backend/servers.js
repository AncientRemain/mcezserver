// Owns server instances on disk and their running processes.
const fs = require('fs');
const os = require('os');
const net = require('net');
const zlib = require('zlib');
const dgram = require('dgram');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const AdmZip = require('adm-zip');

const V = require('./versions');
const T = require('./types');
const props = require('./properties');
const { installServer, launchArgs, splitArgs } = require('./installer');
const { javaFeatureFor, probeJava } = require('./java');
const { ProcessMonitor } = require('./monitor');
const { ping, flattenText } = require('./ping');
const { createZip, extractArchive } = require('./archive');
const { installModpack } = require('./modpack');
const { copyTree } = require('./importer');
const W = require('./worlds');
const VEL = require('./velocity');
const TPS = require('./tps');
const hook = require('./webhook');

const CONFIG = 'craftdock.json';
const MAX_LOG = 2500;
const HISTORY = 180;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const OPTIMIZED_FLAGS = [
  '-XX:+IgnoreUnrecognizedVMOptions', '-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled', '-XX:MaxGCPauseMillis=200',
  '-XX:+UnlockExperimentalVMOptions', '-XX:+DisableExplicitGC', '-XX:G1NewSizePercent=30', '-XX:G1MaxNewSizePercent=40',
  '-XX:G1HeapRegionSize=8M', '-XX:G1ReservePercent=20', '-XX:G1HeapWastePercent=5', '-XX:G1MixedGCCountTarget=4',
  '-XX:InitiatingHeapOccupancyPercent=15', '-XX:G1MixedGCLiveThresholdPercent=90', '-XX:SurvivorRatio=32',
  '-XX:+PerfDisableSharedMem', '-XX:MaxTenuringThreshold=1',
];
// Velocity's own recommended flags
const PROXY_FLAGS = ['-XX:+IgnoreUnrecognizedVMOptions', '-XX:+UseG1GC', '-XX:G1HeapRegionSize=4M', '-XX:+UnlockExperimentalVMOptions', '-XX:+ParallelRefProcEnabled', '-XX:+AlwaysPreTouch', '-XX:MaxInlineLevel=15'];

const PRIORITY = { low: 'PRIORITY_BELOW_NORMAL', normal: 'PRIORITY_NORMAL', above: 'PRIORITY_ABOVE_NORMAL', high: 'PRIORITY_HIGH' };
const WEBHOOK_DEFAULTS = { online: true, offline: true, crash: true, join: true, leave: false, backup: false };
const TOP_SKIP_FULL = new Set(['backups', 'logs', 'crash-reports', 'cache', 'libraries', 'versions', '.fabric', '.quilt', 'debug', '.bedrock-new', '.bedrock-download.zip']);

function portFreeTcp(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '0.0.0.0');
  });
}
function portFreeUdp(port) {
  return new Promise((resolve) => {
    const s = dgram.createSocket('udp4');
    s.once('error', () => { try { s.close(); } catch {} resolve(false); });
    s.bind(port, '0.0.0.0', () => s.close(() => resolve(true)));
  });
}

async function dirSize(dir) {
  let total = 0;
  let entries;
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else { try { total += (await fs.promises.stat(p)).size; } catch {} }
  }
  return total;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return fallback; }
}
function readJsonList(file) {
  const j = readJson(file, []);
  return Array.isArray(j) ? j : [];
}

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address)) return i.address;
    }
  }
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) return i.address;
  }
  return null;
}

const slug = (name, fallback) => String(name || fallback).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || fallback;
const stamp = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
};

function cleanTasks(list) {
  if (!Array.isArray(list)) return [];
  const actions = ['command', 'broadcast', 'restart', 'stop', 'start', 'backup'];
  return list.slice(0, 50).map((t) => ({
    id: /^[a-z0-9]{4,16}$/.test(t.id) ? t.id : crypto.randomBytes(4).toString('hex'),
    name: String(t.name || '').slice(0, 60),
    action: actions.includes(t.action) ? t.action : 'command',
    value: String(t.value || '').slice(0, 500),
    enabled: t.enabled !== false,
    schedule: t.schedule && t.schedule.type === 'daily'
      ? { type: 'daily', time: /^\d{1,2}:\d{2}$/.test(t.schedule.time) ? t.schedule.time : '04:00', days: Array.isArray(t.schedule.days) ? t.schedule.days.filter((d) => d >= 0 && d <= 6) : [] }
      : { type: 'interval', minutes: Math.max(1, Math.min(10080, Number(t.schedule && t.schedule.minutes) || 60)) },
    lastRun: Number(t.lastRun) || 0,
  }));
}

class ServerManager extends EventEmitter {
  constructor({ dataDir, java, getSettings, mods }) {
    super();
    this.dataDir = dataDir;
    this.root = path.join(dataDir, 'servers');
    fs.mkdirSync(this.root, { recursive: true });
    this.pidFile = path.join(dataDir, 'running.json');
    this.java = java;
    this.mods = mods || null;
    this.getSettings = getSettings || (() => ({}));
    this.rt = new Map();
    this.logQueue = new Map();
    setInterval(() => this._flushLogs(), 120);
    setInterval(() => this._tick(), 2000);
    setInterval(() => this._diskTick(), 30000);
    setTimeout(() => this._diskTick(), 1500);
    setInterval(() => this._automationTick(), 10000);
    // installs interrupted by closing the app are marked as failed so they can be retried
    for (const cfg of this.list()) {
      if (cfg.state === 'installing') this._save({ ...cfg, state: 'error', installError: 'Installation was interrupted.' });
    }
    this.orphans = this._reapOrphans();
    setTimeout(() => this._cleanTmp(), 8000);
  }

  /** Java and the mod installers leave files in CraftDock's temp folder; remove anything older than a day. */
  async _cleanTmp() {
    const tmp = this.shortTmp();
    if (tmp === os.tmpdir()) return; // never sweep the system temp folder
    const cutoff = Date.now() - 24 * 3600000;
    for (const name of await fs.promises.readdir(tmp).catch(() => [])) {
      const p = path.join(tmp, name);
      try {
        const st = await fs.promises.stat(p);
        if (st.mtimeMs < cutoff) await fs.promises.rm(p, { recursive: true, force: true });
      } catch {} // in use by a running server
    }
  }

  // ---------- crash-safe process tracking ----------
  _writePids() {
    const map = {};
    for (const [id, r] of this.rt) if (r.proc && r.proc.pid) map[id] = r.proc.pid;
    try { fs.writeFileSync(this.pidFile, JSON.stringify(map)); } catch {}
  }

  /**
   * If CraftDock was force-closed (e.g. by Task Manager), its servers keep running with no way
   * to control them. On startup, find those leftover processes and stop them so ports are free again.
   */
  async _reapOrphans() {
    let map;
    try { map = JSON.parse(fs.readFileSync(this.pidFile, 'utf8')); } catch { return []; }
    const found = [];
    for (const [id, pid] of Object.entries(map)) {
      try { process.kill(pid, 0); } catch { continue; } // not running
      const cmd = await new Promise((resolve) => {
        if (process.platform !== 'win32') return resolve('');
        let out = '';
        const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}"; $p.CommandLine; $p.ExecutablePath`], { windowsHide: true });
        p.stdout.on('data', (d) => (out += d));
        p.on('error', () => resolve(''));
        p.on('close', () => resolve(out));
      });
      let dir;
      try { dir = this.dir(id); } catch { continue; }
      // only touch processes CraftDock itself launched: Java with our tmpdir flag, or this server's bedrock_server.exe
      const javaOurs = /java/i.test(cmd) && cmd.includes('jdk.net.unixdomain.tmpdir');
      const bedrockOurs = /bedrock_server/i.test(cmd) && cmd.toLowerCase().includes(dir.toLowerCase());
      if (!dir || !(javaOurs || bedrockOurs)) continue;
      try {
        if (process.platform === 'win32') spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true });
        else process.kill(pid, 'SIGTERM');
        found.push(id);
        this._log(id, '[CraftDock] This server was still running after CraftDock was force-closed. The leftover process was stopped (changes since the last autosave may be lost).', 'error');
      } catch {}
    }
    try { fs.writeFileSync(this.pidFile, '{}'); } catch {}
    return found;
  }

  // ---------- storage ----------
  dir(id) {
    if (!/^[a-z0-9-]+$/.test(id)) throw new Error('Bad server id');
    return path.join(this.root, id);
  }
  load(id) {
    return JSON.parse(fs.readFileSync(path.join(this.dir(id), CONFIG), 'utf8').replace(/^﻿/, ''));
  }
  _save(cfg) {
    fs.mkdirSync(this.dir(cfg.id), { recursive: true });
    fs.writeFileSync(path.join(this.dir(cfg.id), CONFIG), JSON.stringify(cfg, null, 2));
    return cfg;
  }
  _patch(id, patch) {
    return this._save({ ...this.load(id), ...patch });
  }
  list() {
    return fs.readdirSync(this.root)
      .filter((n) => fs.existsSync(path.join(this.root, n, CONFIG)))
      .map((n) => { try { return this.load(n); } catch { return null; } })
      .filter(Boolean)
      .sort((a, b) => a.createdAt - b.createdAt);
  }
  runtime(id) {
    if (!this.rt.has(id)) {
      this.rt.set(id, { status: 'offline', logs: [], players: new Set(), history: [], stats: null, restarts: [], sessions: new Map(), tpsHistory: [] });
    }
    return this.rt.get(id);
  }

  /** The port players connect to (velocity.toml for proxies, server.properties otherwise). */
  portOf(id, cfg = this.load(id)) {
    const dir = this.dir(id);
    if (T.isProxy(cfg.loader)) {
      const v = VEL.getConfig(dir);
      return v ? v.port : Number(cfg.port) || 25577;
    }
    return Number(props.read(path.join(dir, 'server.properties'))['server-port'] || cfg.port || (T.isBedrock(cfg.loader) ? 19132 : 25565));
  }
  setPort(id, port) {
    const cfg = this.load(id);
    const dir = this.dir(id);
    if (T.isProxy(cfg.loader)) { try { VEL.setPort(dir, port); } catch {} }
    else if (T.isBedrock(cfg.loader)) props.write(path.join(dir, 'server.properties'), { 'server-port': port, 'server-portv6': port + 1 });
    else props.write(path.join(dir, 'server.properties'), { 'server-port': port });
    this._save({ ...cfg, port: Number(port) });
  }
  usedPorts(exceptId) {
    const used = new Set();
    for (const c of this.list()) {
      if (c.id === exceptId) continue;
      const p = this.portOf(c.id, c);
      used.add(p);
      if (T.isBedrock(c.loader)) used.add(p + 1);
      if (c.geyser && c.geyser.port) used.add(Number(c.geyser.port));
    }
    return used;
  }
  freePort(start, exceptId) {
    const used = this.usedPorts(exceptId);
    let p = Number(start) || 25565;
    while (used.has(p)) p++;
    return p;
  }

  summary(id) {
    const cfg = this.load(id);
    const r = this.runtime(id);
    const dir = this.dir(id);
    const p = props.read(path.join(dir, 'server.properties'));
    const vel = T.isProxy(cfg.loader) ? VEL.getConfig(dir) : null;
    return {
      ...cfg,
      status: cfg.state === 'installing' ? 'installing' : cfg.state === 'error' ? 'error' : r.status,
      startedAt: r.startedAt || null,
      stats: r.stats,
      history: r.history,
      players: [...r.players],
      port: this.portOf(id, cfg),
      motd: vel ? String(vel.motd || '') : T.isBedrock(cfg.loader) ? p['server-name'] || '' : p.motd || '',
      maxPlayers: Number(vel ? vel.showMaxPlayers : p['max-players'] || 20),
      levelName: vel ? null : p['level-name'] || (T.isBedrock(cfg.loader) ? 'Bedrock level' : 'world'),
      whitelist: String(T.isBedrock(cfg.loader) ? p['allow-list'] : p['white-list']) === 'true',
      lan: lanAddress(),
      dir,
      worldSize: r.worldSize || 0,
      icon: this.icon(id),
      automation: { autoStart: false, restartEveryHours: 0, backupEveryHours: 0, keepBackups: 5, updateOnStart: false, updateServerOnStart: false, ...(cfg.automation || {}) },
      playit: cfg.playit || { enabled: false },
      crash: r.crash || null,
      peakPlayers: r.peakPlayers || 0,
      tasks: cfg.tasks || [],
      webhook: cfg.webhook ? { url: cfg.webhook.url || '', events: { ...WEBHOOK_DEFAULTS, ...(cfg.webhook.events || {}) } } : { url: '', events: { ...WEBHOOK_DEFAULTS } },
      tps: r.tps || null,
      tpsHistory: r.tpsHistory || [],
      network: cfg.network || null,
      proxiedBy: cfg.proxiedBy || null,
    };
  }

  icon(id) {
    try { return 'data:image/png;base64,' + fs.readFileSync(path.join(this.dir(id), 'server-icon.png')).toString('base64'); } catch { return null; }
  }
  setIconPng(id, png) {
    fs.writeFileSync(path.join(this.dir(id), 'server-icon.png'), png);
    this.emit('changed');
  }
  removeIcon(id) {
    fs.rmSync(path.join(this.dir(id), 'server-icon.png'), { force: true });
    this.emit('changed');
  }
  summaries() {
    return this.list().map((c) => this.summary(c.id));
  }

  update(id, patch) {
    const allowed = ['name', 'memoryMB', 'jvmArgs', 'optimizedFlags', 'autoRestart', 'javaPath', 'color', 'notes', 'pinned', 'serverArgs', 'group'];
    const cfg = this.load(id);
    for (const k of allowed) if (k in patch) cfg[k] = patch[k];
    if ('javaOverride' in patch) cfg.javaOverride = [8, 11, 17, 21, 25].includes(Number(patch.javaOverride)) ? Number(patch.javaOverride) : null;
    if ('priority' in patch) cfg.priority = PRIORITY[patch.priority] ? patch.priority : 'normal';
    if ('quickCommands' in patch) cfg.quickCommands = (Array.isArray(patch.quickCommands) ? patch.quickCommands : []).slice(0, 24).map((q) => ({ label: String(q.label || q.command || '').slice(0, 30), command: String(q.command || '').replace(/[\r\n]/g, '').slice(0, 300) })).filter((q) => q.command);
    if ('startupCommands' in patch) cfg.startupCommands = (Array.isArray(patch.startupCommands) ? patch.startupCommands : String(patch.startupCommands || '').split(/\r?\n/)).map((s) => String(s).trim().replace(/^\//, '')).filter(Boolean).slice(0, 40);
    if ('tasks' in patch) {
      const old = new Map((cfg.tasks || []).map((t) => [t.id, t]));
      cfg.tasks = cleanTasks(patch.tasks).map((t) => ({ ...t, lastRun: (old.get(t.id) || {}).lastRun || t.lastRun || 0 }));
    }
    if ('webhook' in patch) {
      const w = patch.webhook || {};
      const url = String(w.url || '').trim();
      if (url && !hook.isValid(url)) throw new Error('That is not a Discord webhook URL. In Discord: Server Settings → Integrations → Webhooks → Copy Webhook URL.');
      cfg.webhook = { url, events: { ...WEBHOOK_DEFAULTS, ...(cfg.webhook && cfg.webhook.events), ...(w.events || {}) } };
    }
    if ('geyser' in patch) cfg.geyser = { ...(cfg.geyser || {}), ...patch.geyser };
    if (patch.automation) {
      const a = patch.automation;
      cfg.automation = {
        ...(cfg.automation || {}),
        ...('autoStart' in a ? { autoStart: !!a.autoStart } : {}),
        ...('restartEveryHours' in a ? { restartEveryHours: Math.max(0, Number(a.restartEveryHours) || 0) } : {}),
        ...('backupEveryHours' in a ? { backupEveryHours: Math.max(0, Number(a.backupEveryHours) || 0) } : {}),
        ...('keepBackups' in a ? { keepBackups: Math.max(1, Math.min(100, Number(a.keepBackups) || 5)) } : {}),
        ...('updateOnStart' in a ? { updateOnStart: !!a.updateOnStart } : {}),
        ...('updateServerOnStart' in a ? { updateServerOnStart: !!a.updateServerOnStart } : {}),
        ...('backupFull' in a ? { backupFull: !!a.backupFull } : {}),
      };
    }
    if (patch.playit) cfg.playit = { ...(cfg.playit || {}), ...patch.playit };
    this._save(cfg);
    this.emit('changed');
    return this.summary(id);
  }

  // ---------- activity log, player history, webhooks ----------
  _event(id, type, text) {
    const file = path.join(this.dir(id), 'events.json');
    const list = readJsonList(file);
    const e = { t: Date.now(), type, text };
    list.push(e);
    try { fs.writeFileSync(file, JSON.stringify(list.slice(-300))); } catch {}
    this.emit('event', id, e);
  }
  events(id) {
    return readJsonList(path.join(this.dir(id), 'events.json')).reverse();
  }
  clearEvents(id) {
    fs.rmSync(path.join(this.dir(id), 'events.json'), { force: true });
  }

  _history(id, fn) {
    const file = path.join(this.dir(id), 'players.json');
    const h = readJson(file, {});
    fn(h);
    try { fs.writeFileSync(file, JSON.stringify(h)); } catch {}
  }
  playerHistory(id) {
    const h = readJson(path.join(this.dir(id), 'players.json'), {});
    const r = this.runtime(id);
    const now = Date.now();
    return Object.entries(h).map(([name, p]) => {
      const live = r.sessions.get(name);
      return { name, ...p, online: !!live, playtime: (p.playtime || 0) + (live ? now - live : 0) };
    }).sort((a, b) => (b.online - a.online) || (b.last || 0) - (a.last || 0));
  }

  _webhook(id, event, title, text) {
    let cfg;
    try { cfg = this.load(id); } catch { return; }
    const w = cfg.webhook;
    if (!w || !w.url) return;
    const events = { ...WEBHOOK_DEFAULTS, ...(w.events || {}) };
    if (!events[event]) return;
    hook.send(w.url, { event, title, text, server: cfg.name }).catch(() => {});
  }
  testWebhook(url, name) {
    return hook.send(url, { event: 'test', title: 'CraftDock is connected', text: `Notifications for **${name || 'your server'}** will show up here.`, server: name }, true);
  }

  _playerJoined(id, name, extra = {}) {
    const r = this.runtime(id);
    if (r.players.has(name)) return;
    r.players.add(name);
    r.sessions.set(name, Date.now());
    r.peakPlayers = Math.max(r.peakPlayers || 0, r.players.size);
    this._history(id, (h) => {
      const p = h[name] || { first: Date.now(), joins: 0, playtime: 0 };
      p.last = Date.now(); p.joins = (p.joins || 0) + 1;
      if (extra.uuid) p.uuid = extra.uuid;
      if (extra.xuid) p.xuid = extra.xuid;
      h[name] = p;
    });
    this.emit('players', id, [...r.players]);
    this.emit('player', id, name, true);
    this._event(id, 'join', `${name} joined`);
    this._webhook(id, 'join', `${name} joined`, `${r.players.size} player${r.players.size === 1 ? '' : 's'} online`);
  }
  _playerLeft(id, name, quiet = false) {
    const r = this.runtime(id);
    if (!r.players.has(name)) return;
    r.players.delete(name);
    const since = r.sessions.get(name);
    r.sessions.delete(name);
    this._history(id, (h) => {
      const p = h[name] || { first: Date.now(), joins: 1, playtime: 0 };
      p.last = Date.now();
      if (since) p.playtime = (p.playtime || 0) + (Date.now() - since);
      h[name] = p;
    });
    this.emit('players', id, [...r.players]);
    if (quiet) return;
    this.emit('player', id, name, false);
    this._event(id, 'leave', `${name} left`);
    this._webhook(id, 'leave', `${name} left`, `${r.players.size} player${r.players.size === 1 ? '' : 's'} online`);
  }

  // ---------- create / install ----------
  async create(opts) {
    const id = `${slug(opts.name, 'server')}-${crypto.randomBytes(3).toString('hex')}`;
    const t = T.type(opts.loader);
    const cfg = this._save({
      id,
      name: String(opts.name || 'My Server').slice(0, 48),
      loader: opts.loader,
      mcVersion: opts.mcVersion,
      loaderVersion: opts.loaderVersion || null,
      memoryMB: Number(opts.memoryMB) || (t.proxy ? 1024 : 4096),
      port: Number(opts.port) || (t.bedrock ? 19132 : t.proxy ? 25577 : 25565),
      eulaAccepted: !!opts.eula,
      optimizedFlags: true,
      autoRestart: !!opts.autoRestart,
      jvmArgs: '',
      color: opts.color || null,
      createdAt: Date.now(),
      state: 'installing',
      modpack: opts.modpack || null,
      automation: { autoStart: !!opts.autoStart, restartEveryHours: Number(opts.restartEveryHours) || 0, backupEveryHours: Number(opts.backupEveryHours) || 0, keepBackups: 5, updateOnStart: !!opts.updateOnStart, updateServerOnStart: t.bedrock },
      playit: { enabled: false },
      pendingCommands: Array.isArray(opts.pendingCommands) ? opts.pendingCommands.slice(0, 40) : [],
      startupCommands: [],
      geyser: opts.geyser ? { enabled: true } : null,
      priority: 'normal',
    });
    this.emit('changed');
    this._event(id, 'install', `Created as ${opts.loader} ${opts.mcVersion}`);
    this._install(cfg, { ...opts, fresh: true }).catch(() => {});
    return id;
  }

  /**
   * Imports an existing server folder (copied, the original is never changed), then installs
   * the right launch files and Java for the detected type/version.
   */
  async importServer(opts) {
    if (!opts.source || !fs.existsSync(opts.source)) throw new Error('That folder no longer exists');
    if (!opts.loader || !opts.mcVersion) throw new Error('Pick the server type and Minecraft version');
    const id = `${slug(opts.name, 'imported')}-${crypto.randomBytes(3).toString('hex')}`;
    const used = this.usedPorts();
    const t = T.type(opts.loader);
    let port = Number(opts.port) || (t.bedrock ? 19132 : t.proxy ? 25577 : 25565);
    const portChanged = used.has(port);
    while (used.has(port)) port++;
    const cfg = this._save({
      id,
      name: String(opts.name || 'Imported server').slice(0, 48),
      loader: opts.loader,
      mcVersion: opts.mcVersion,
      loaderVersion: t.fill || opts.loader === 'purpur' || opts.loader === 'leaf' ? null : opts.loaderVersion || null,
      memoryMB: Number(opts.memoryMB) || 4096,
      port,
      eulaAccepted: !!opts.eula,
      optimizedFlags: true,
      autoRestart: false,
      jvmArgs: '',
      createdAt: Date.now(),
      state: 'installing',
      initialized: true,
      imported: { from: opts.label || opts.source, at: Date.now() },
      automation: { autoStart: false, restartEveryHours: 0, backupEveryHours: 0, keepBackups: 5, updateOnStart: false, updateServerOnStart: t.bedrock },
      playit: { enabled: false },
    });
    this.emit('changed');
    (async () => {
      const dir = this.dir(id);
      const progress = (p) => this.emit('progress', id, p);
      const mb = (n) => `${(n / 1048576).toFixed(0)} MB`;
      try {
        progress({ step: 'Copying server files', pct: 0 });
        const root = path.resolve(opts.source);
        await copyTree(root, dir,
          (done, total) => progress({ step: 'Copying server files', pct: total ? done / total : null, detail: `${mb(done)} of ${mb(total)}` }),
          (p) => path.basename(p) === 'session.lock' || (path.dirname(p) === root && ['craftdock.json', 'running.json', 'events.json'].includes(path.basename(p))));
        this._save({ ...this.load(id) }); // copied files never replace CraftDock's own config
        if (portChanged) {
          this.setPort(id, port);
          progress({ log: `Port ${opts.port} is used by another CraftDock server, so this one now uses ${port}.` });
        }
        if (opts.cleanupSource) await fs.promises.rm(opts.cleanupSource, { recursive: true, force: true }).catch(() => {});
      } catch (e) {
        this._save({ ...this.load(id), state: 'error', installError: e.message });
        progress({ error: e.message });
        this.emit('changed');
        return;
      }
      this._event(id, 'install', `Imported from ${opts.label || opts.source}`);
      await this._install(this.load(id), { imported: true });
    })();
    return id;
  }

  /** Switches a server to another Minecraft / loader version, keeping its world, mods and settings. */
  async changeVersion(id, mcVersion, loaderVersion, { updateMods = true } = {}) {
    const cfg = this.load(id);
    if (this.runtime(id).proc) throw new Error('Stop the server first');
    if (!mcVersion) throw new Error('Pick a version');
    const previous = { loader: cfg.loader, mcVersion: cfg.mcVersion, loaderVersion: cfg.loaderVersion };
    this._save({ ...cfg, mcVersion, loaderVersion: loaderVersion || null, javaFeature: null, state: 'installing', installError: null });
    this.emit('changed');
    this._event(id, 'update', `Switching ${cfg.mcVersion} → ${mcVersion}`);
    this._install(this.load(id), { previous, updateMods }).catch(() => {});
  }

  /** Is there newer server software (build / Bedrock release) for this server's version? */
  async softwareUpdate(id) {
    const cfg = this.load(id);
    const t = T.type(cfg.loader);
    if (t.bedrock) {
      const list = await V.listGameVersions('bedrock', false);
      const latest = list[0] && list[0].id;
      return { current: cfg.mcVersion, latest, available: !!latest && latest !== cfg.mcVersion && V.compareVersions(latest, cfg.mcVersion) > 0, mcVersion: latest, loaderVersion: null };
    }
    if (!t.builds || cfg.modpack) return { available: false };
    const builds = await V.listLoaderVersions(cfg.loader, cfg.mcVersion);
    const rec = builds.find((b) => b.recommended) || builds[0];
    if (!rec) return { available: false };
    const newer = cfg.loaderVersion && /^\d+$/.test(rec.id) && /^\d+$/.test(String(cfg.loaderVersion)) ? Number(rec.id) > Number(cfg.loaderVersion) : rec.id !== cfg.loaderVersion && V.compareVersions(rec.id, String(cfg.loaderVersion || '0')) > 0;
    return { current: cfg.loaderVersion, latest: rec.id, latestLabel: rec.label, available: !!cfg.loaderVersion && newer, mcVersion: cfg.mcVersion, loaderVersion: rec.id };
  }
  async updateSoftware(id) {
    const u = await this.softwareUpdate(id);
    if (!u.available) throw new Error('This server already has the newest build');
    await this.changeVersion(id, u.mcVersion, u.loaderVersion, { updateMods: false });
    return u;
  }

  /** Deletes files left behind by the previous Minecraft / loader version after a version change. */
  _cleanupOldVersion(dir, prev, cfg, log) {
    const rm = (rel) => {
      const p = path.join(dir, rel);
      if (fs.existsSync(p)) { fs.rmSync(p, { recursive: true, force: true }); log(`Removed old ${rel}`); }
    };
    if (prev.loaderVersion && prev.loaderVersion !== cfg.loaderVersion) {
      if (cfg.loader === 'forge') {
        rm(`libraries/net/minecraftforge/forge/${prev.loaderVersion}`);
        for (const f of fs.readdirSync(dir)) if (f.startsWith(`forge-${prev.loaderVersion}`) && f.endsWith('.jar')) rm(f);
      }
      if (cfg.loader === 'neoforge') rm(`libraries/net/neoforged/neoforge/${prev.loaderVersion}`);
      if (cfg.loader === 'quilt') rm(`libraries/org/quiltmc/quilt-loader/${prev.loaderVersion}`);
    }
    if (prev.mcVersion !== cfg.mcVersion && T.isJavaGame(cfg.loader)) {
      rm(`versions/${prev.mcVersion}`);
      if (['paper', 'purpur', 'folia', 'leaf'].includes(cfg.loader)) rm(`cache/mojang_${prev.mcVersion}.jar`);
      if (cfg.loader === 'fabric') { rm('server.jar'); rm('.fabric'); } // Fabric re-downloads the matching vanilla jar
      if (cfg.loader === 'forge' || cfg.loader === 'neoforge') rm(`libraries/net/minecraft/server/${prev.mcVersion}`);
      if (cfg.loader === 'quilt') rm(`libraries/net/fabricmc/intermediary/${prev.mcVersion}`);
    }
  }

  /** Copies a server (world, mods, configs; not backups or logs) into a new server. */
  async clone(id, name) {
    const cfg = this.load(id);
    if (this.runtime(id).proc) throw new Error('Stop the server before duplicating it');
    const port = this.freePort(T.isBedrock(cfg.loader) ? 19132 : T.isProxy(cfg.loader) ? 25577 : 25565);
    const newName = String(name || `${cfg.name} (copy)`).slice(0, 48);
    const newId = `${slug(newName, 'server')}-${crypto.randomBytes(3).toString('hex')}`;
    const src = this.dir(id);
    const skipTop = new Set(['backups', 'logs', 'crash-reports', CONFIG, 'events.json', 'players.json']);
    await fs.promises.cp(src, this.dir(newId), {
      recursive: true,
      filter: (p) => {
        const n = path.basename(p);
        if (n === 'session.lock') return false;
        return !(path.dirname(p) === src && skipTop.has(n));
      },
    });
    this._save({ ...cfg, id: newId, name: newName, port, createdAt: Date.now(), playit: { enabled: false }, automation: { ...(cfg.automation || {}), autoStart: false }, network: null, proxiedBy: null, pinned: false });
    this.setPort(newId, port);
    this.emit('changed');
    this._event(newId, 'install', `Duplicated from ${cfg.name}`);
    return newId;
  }

  // ---------- files ----------
  _safe(id, rel = '') {
    const root = this.dir(id);
    const p = path.resolve(root, rel);
    if (p !== root && !p.startsWith(root + path.sep)) throw new Error('That path is outside the server folder');
    return p;
  }
  listFiles(id, rel = '') {
    const p = this._safe(id, rel);
    return fs.readdirSync(p, { withFileTypes: true }).map((e) => {
      let st = null;
      try { st = fs.statSync(path.join(p, e.name)); } catch {}
      return { name: e.name, dir: e.isDirectory(), size: st ? st.size : 0, mtime: st ? st.mtimeMs : 0 };
    }).sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
  }
  readFile(id, rel) {
    const p = this._safe(id, rel);
    const st = fs.statSync(p);
    if (st.size > 2 * 1048576) throw new Error('This file is too large to edit here (over 2 MB). Open the folder instead.');
    const buf = fs.readFileSync(p);
    if (buf.includes(0)) throw new Error('This looks like a binary file and can\'t be edited as text.');
    return buf.toString('utf8');
  }
  writeFile(id, rel, content) {
    const p = this._safe(id, rel);
    fs.writeFileSync(p, content, 'utf8');
  }
  deleteFile(id, rel) {
    if (!rel) throw new Error('Refusing to delete the server folder');
    const p = this._safe(id, rel);
    if (path.basename(p) === CONFIG) throw new Error('This file is managed by CraftDock');
    fs.rmSync(p, { recursive: true, force: true });
  }
  newFile(id, rel, folder) {
    const p = this._safe(id, rel);
    if (fs.existsSync(p)) throw new Error('Something with that name already exists');
    if (folder) fs.mkdirSync(p, { recursive: true });
    else { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, ''); }
  }
  renameFile(id, rel, newName) {
    if (!rel) throw new Error('Pick a file');
    const p = this._safe(id, rel);
    if (path.basename(p) === CONFIG) throw new Error('This file is managed by CraftDock');
    const n = String(newName || '').trim();
    if (!n || /[\\/:*?"<>|]/.test(n)) throw new Error('That name has characters Windows doesn\'t allow');
    const dest = this._safe(id, path.join(path.dirname(rel), n));
    if (fs.existsSync(dest)) throw new Error('Something with that name already exists');
    fs.renameSync(p, dest);
  }
  uploadFiles(id, rel, files) {
    const target = this._safe(id, rel);
    fs.mkdirSync(target, { recursive: true });
    let n = 0;
    for (const f of files) {
      const st = fs.statSync(f);
      if (st.isDirectory()) fs.cpSync(f, path.join(target, path.basename(f)), { recursive: true });
      else fs.copyFileSync(f, path.join(target, path.basename(f)));
      n++;
    }
    return n;
  }

  async reinstall(id) {
    const cfg = this.load(id);
    if (this.runtime(id).proc) throw new Error('Stop the server first');
    this._save({ ...cfg, state: 'installing', installError: null });
    this.emit('changed');
    this._install(this.load(id), {}).catch(() => {});
  }

  _defaultProps(cfg, opts) {
    const mcModern = !/^1\.(\d|1[0-8])(\.|$)/.test(cfg.mcVersion || '');
    const levelTypes = mcModern
      ? { normal: 'minecraft:normal', flat: 'minecraft:flat', large_biomes: 'minecraft:large_biomes', amplified: 'minecraft:amplified' }
      : { normal: 'default', flat: 'flat', large_biomes: 'largeBiomes', amplified: 'amplified' };
    const out = {
      'server-port': cfg.port,
      motd: opts.motd || cfg.name,
      'max-players': opts.maxPlayers || 20,
      difficulty: opts.difficulty || 'normal',
      gamemode: opts.gamemode || 'survival',
      'online-mode': opts.onlineMode === false ? 'false' : 'true',
    };
    if (opts.seed) out['level-seed'] = opts.seed;
    if (opts.levelType && levelTypes[opts.levelType] && opts.levelType !== 'normal') out['level-type'] = levelTypes[opts.levelType];
    if (opts.structures === false) out['generate-structures'] = 'false';
    if (opts.hardcore) out.hardcore = 'true';
    if (opts.pvp === false) out.pvp = 'false';
    if (opts.whitelist) { out['white-list'] = 'true'; out['enforce-whitelist'] = 'true'; }
    if (opts.viewDistance) out['view-distance'] = opts.viewDistance;
    if (opts.simulationDistance) out['simulation-distance'] = opts.simulationDistance;
    if (opts.spawnProtection != null && opts.spawnProtection !== '') out['spawn-protection'] = opts.spawnProtection;
    if (opts.allowFlight) out['allow-flight'] = 'true';
    if (opts.commandBlocks) out['enable-command-block'] = 'true';
    return out;
  }

  _bedrockProps(cfg, opts) {
    const out = {
      'server-name': opts.motd || cfg.name,
      'server-port': cfg.port,
      'server-portv6': cfg.port + 1,
      gamemode: opts.gamemode || 'survival',
      difficulty: opts.difficulty || 'normal',
      'max-players': opts.maxPlayers || 10,
      'allow-list': opts.whitelist ? 'true' : 'false',
      'online-mode': opts.onlineMode === false ? 'false' : 'true',
      'allow-cheats': opts.cheats ? 'true' : 'false',
    };
    if (opts.seed) out['level-seed'] = opts.seed;
    if (opts.viewDistance) out['view-distance'] = opts.viewDistance;
    return out;
  }

  async _install(cfg, opts) {
    const dir = this.dir(cfg.id);
    const progress = (p) => this.emit('progress', cfg.id, p);
    const log = (line) => progress({ log: line });
    const t = T.type(cfg.loader);
    try {
      progress({ step: t.bedrock ? 'Preparing' : 'Checking Java requirements', pct: null });
      if (opts.modpack && opts.modpack.versionId) {
        fs.mkdirSync(dir, { recursive: true });
        const pack = await installModpack(dir, opts.modpack.versionId, progress);
        const fresh = this.load(cfg.id);
        cfg = this._save({ ...fresh, loader: pack.loader, mcVersion: pack.mcVersion, loaderVersion: pack.loaderVersion, modpack: { ...(fresh.modpack || {}), packVersion: pack.packVersion } });
        this.emit('changed');
      }
      let feature = null, java = null;
      if (!t.bedrock) {
        feature = cfg.javaOverride || javaFeatureFor(await V.requiredJavaFor(cfg.loader, cfg.mcVersion));
        java = cfg.javaPath || (await this.java.ensure(feature, progress));
      }
      // BuildTools compiles Spigot, which needs a full JDK
      const installJava = cfg.loader === 'spigot' ? await this.java.ensure(feature, progress, 'jdk') : java;
      const res = await installServer({ dir, loader: cfg.loader, mcVersion: cfg.mcVersion, loaderVersion: cfg.loaderVersion, java: installJava, tmp: this.shortTmp(), port: cfg.port, motd: opts.motd || cfg.name }, progress);
      progress({ step: 'Writing configuration', pct: null });
      if (cfg.eulaAccepted && t.eula !== false && !t.bedrock) {
        fs.writeFileSync(path.join(dir, 'eula.txt'), `# Accepted in CraftDock by the user (https://aka.ms/MinecraftEULA)\neula=true\n`);
      }
      const propsFile = path.join(dir, 'server.properties');
      if (t.bedrock) {
        if (!cfg.initialized) props.write(propsFile, this._bedrockProps(cfg, opts));
      } else if (!t.proxy && !fs.existsSync(propsFile)) {
        props.write(propsFile, this._defaultProps(cfg, opts));
      }
      const fresh = this.load(cfg.id);
      cfg = this._save({ ...fresh, initialized: true, javaFeature: feature, jar: res.jar || null, exe: res.exe || null, loaderVersion: res.loaderVersion || fresh.loaderVersion });

      if (opts.previous) {
        progress({ step: 'Cleaning up the old version', pct: null });
        try { this._cleanupOldVersion(dir, opts.previous, cfg, log); } catch (e) { log(`Cleanup skipped: ${e.message}`); }
        if (opts.updateMods && this.mods && !t.bedrock) {
          progress({ step: `Updating add-ons for ${cfg.mcVersion}`, pct: null });
          try {
            const r = await this.mods.updateAll(cfg, dir, { disableIncompatible: true, log });
            log(`${r.updated.length} updated, ${r.disabled.length} turned off (no version for ${cfg.mcVersion} yet)`);
            cfg = this._save({ ...this.load(cfg.id), lastVersionChange: { updated: r.updated, disabled: r.disabled, failed: r.failed, at: Date.now() } });
          } catch (e) { log(`Could not update mods: ${e.message}`); }
        }
        this._event(cfg.id, 'update', `Now on ${cfg.mcVersion}${cfg.loaderVersion ? ` (${cfg.loaderVersion})` : ''}`);
      }

      if (opts.perfMods && opts.perfMods.length && this.mods && !cfg.modpack) {
        progress({ step: 'Installing performance mods', pct: null });
        try {
          const r = await this.mods.installMany(cfg, dir, opts.perfMods, log);
          log(`Installed: ${r.installed.join(', ') || 'none'}`);
        } catch (e) { log(`Could not install performance mods: ${e.message}`); }
      }

      if (opts.geyser && this.mods) {
        progress({ step: 'Installing Geyser for Bedrock cross-play', pct: null });
        try {
          const r = await this.mods.installGeyser(cfg, dir, log);
          log(`Cross-play: ${r.installed.join(', ') || 'nothing installed'}`);
          r.warnings.forEach(log);
          this._patch(cfg.id, { geyser: { enabled: true, port: this.freePort(19132) } });
        } catch (e) { log(`Could not install Geyser: ${e.message}`); }
      }

      if (opts.importWorld && opts.importWorld.source) {
        progress({ step: 'Copying your world', pct: 0 });
        try {
          const name = await W.importWorld(dir, cfg.loader, opts.importWorld.source, {
            mode: 'replace', activate: true,
            onProgress: (d, tot) => progress({ step: 'Copying your world', pct: tot ? d / tot : null }),
          });
          log(`World "${name}" imported`);
          this._event(cfg.id, 'world', `World imported from ${opts.importWorld.label || opts.importWorld.source}`);
        } catch (e) { log(`Could not import the world: ${e.message}`); }
        if (opts.importWorld.staging) await fs.promises.rm(opts.importWorld.staging, { recursive: true, force: true }).catch(() => {});
      }

      this._save({ ...this.load(cfg.id), state: 'ready', installError: null });
      progress({ done: true, step: 'Server is ready' });
    } catch (e) {
      const fresh = this.load(cfg.id);
      this._save({ ...fresh, state: 'error', installError: e.message });
      progress({ error: e.message });
    }
    this.emit('changed');
  }

  async remove(id) {
    const r = this.runtime(id);
    if (r.proc) throw new Error('Stop the server before deleting it');
    const cfg = this.load(id);
    // unlink from a proxy network
    for (const c of this.list()) {
      if (c.network && (c.network.members || []).includes(id)) this._save({ ...c, network: { ...c.network, members: c.network.members.filter((m) => m !== id) } });
    }
    // (backups kept in a custom backup folder are left alone on purpose)
    await fs.promises.rm(this.dir(id), { recursive: true, force: true, maxRetries: 3 });
    if (cfg.proxiedBy) { try { const p = this.load(cfg.proxiedBy); this._save({ ...p, network: { members: ((p.network || {}).members || []).filter((m) => m !== id) } }); } catch {} }
    this.rt.delete(id);
    this.emit('changed');
  }

  // ---------- process control ----------
  _setStatus(id, status) {
    const r = this.runtime(id);
    if (r.status === status) return;
    r.status = status;
    this.emit('status', id, status);
    if (status === 'online') {
      r.onlineAt = Date.now();
      let cfg;
      try { cfg = this.load(id); } catch { return; }
      this._event(id, 'online', 'Server is online');
      this._webhook(id, 'online', `${cfg.name} is online`, `Join at port ${this.portOf(id, cfg)}${cfg.playit && cfg.playit.address ? ` · ${cfg.playit.address}` : ''}`);
      // Geyser writes its config on the first start; switch it to NetherNet right away
      if (cfg.geyser && cfg.geyser.enabled) {
        try {
          if (this._syncGeyserPort(this.dir(id), cfg.geyser.port || 19132)) {
            const r = this.runtime(id);
            if (!r.players.size) {
              this._log(id, '[CraftDock] Geyser was set up for Bedrock\'s new NetherNet connections. Restarting once to turn it on…', 'system');
              setTimeout(() => { if (r.proc && !r.players.size) this.restart(id); }, 4000);
            } else {
              this._log(id, '[CraftDock] Geyser was set up for Bedrock\'s new NetherNet connections. Restart the server once so Bedrock players can join.', 'system');
            }
          }
        } catch {}
      }
      const cmds = [...(cfg.pendingCommands || []), ...(cfg.startupCommands || [])];
      if (cmds.length) {
        setTimeout(() => {
          for (const c of cmds) { try { this.command(id, c); } catch {} }
          if ((cfg.pendingCommands || []).length) this._patch(id, { pendingCommands: [] });
        }, 2500);
      }
    }
  }

  _log(id, line, kind) {
    const r = this.runtime(id);
    const entry = { t: Date.now(), line, kind };
    r.logs.push(entry);
    if (r.logs.length > MAX_LOG) r.logs.splice(0, r.logs.length - MAX_LOG);
    if (!this.logQueue.has(id)) this.logQueue.set(id, []);
    this.logQueue.get(id).push(entry);
  }
  _flushLogs() {
    for (const [id, lines] of this.logQueue) if (lines.length) this.emit('log', id, lines.splice(0));
  }
  logs(id) {
    return this.runtime(id).logs;
  }

  /**
   * A temp folder Java can safely put Unix-domain sockets in. Paths with apostrophes, 8.3 short names (~),
   * non-ASCII characters or too many characters make Java's NIO pipes fail ("Unable to establish loopback connection").
   */
  shortTmp() {
    if (this._tmp) return this._tmp;
    const candidates = [];
    if (process.platform === 'win32') candidates.push(path.join(process.env.ProgramData || 'C:\\ProgramData', 'CraftDock', 'tmp'));
    candidates.push(os.tmpdir(), path.join(path.dirname(this.root), 'tmp'));
    if (process.platform === 'win32') candidates.push(path.join(process.env.SystemDrive || 'C:', 'CraftDockTmp'));
    const ok = candidates
      .filter((d) => /^([A-Za-z]:)?[A-Za-z0-9 _\-.\\/]+$/.test(d) && d.length < 70)
      .find((d) => { try { fs.mkdirSync(d, { recursive: true }); fs.accessSync(d, fs.constants.W_OK); return true; } catch { return false; } });
    this._tmp = ok || os.tmpdir();
    return this._tmp;
  }

  async javaFor(cfg) {
    const feature = cfg.javaOverride || cfg.javaFeature || javaFeatureFor(await V.requiredJavaFor(cfg.loader, cfg.mcVersion));
    return cfg.javaPath || this.java.ensure(feature, (p) => this.emit('progress', cfg.id, p));
  }

  /**
   * Points Geyser's Bedrock listener at the port CraftDock picked and switches it to NetherNet, the only
   * transport Bedrock 26.60+ clients use (its config only exists after the first start). Returns true if it changed anything.
   */
  _syncGeyserPort(dir, port, loader) {
    let changed = false;
    // Before Geyser's first start there is no config yet: a minimal one is enough, Geyser fills in the rest
    if (loader) {
      const fam = T.isBukkit(loader) ? 'plugins/Geyser-Spigot' : loader === 'velocity' ? 'plugins/Geyser-Velocity' : ['fabric', 'quilt'].includes(loader) ? 'config/Geyser-Fabric' : loader === 'neoforge' ? 'config/Geyser-NeoForge' : null;
      const f = fam && path.join(dir, fam, 'config.yml');
      if (f && !fs.existsSync(f)) {
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, `bedrock:\n  port: ${port}\n  transport: nethernet\n`);
        return false;
      }
    }
    for (const rel of ['plugins/Geyser-Spigot/config.yml', 'plugins/Geyser-Velocity/config.yml', 'config/Geyser-Fabric/config.yml', 'config/Geyser-NeoForge/config.yml', 'config/geyser/config.yml']) {
      const f = path.join(dir, rel);
      if (!fs.existsSync(f)) continue;
      const before = fs.readFileSync(f, 'utf8');
      const lines = before.split(/\r?\n/);
      const b = lines.findIndex((l) => /^bedrock:\s*$/.test(l));
      if (b < 0) continue;
      let end = b + 1;
      while (end < lines.length && (/^\s/.test(lines[end]) || !lines[end].trim())) end++;
      let portLine = -1, transportLine = -1, indent = '  ';
      for (let i = b + 1; i < end; i++) {
        const m = lines[i].match(/^(\s+)(port|transport):/);
        if (!m || m[1].length > 4) continue;
        indent = m[1];
        if (m[2] === 'port') portLine = i; else transportLine = i;
      }
      if (portLine >= 0) lines[portLine] = lines[portLine].replace(/port:\s*\d+/, `port: ${port}`);
      if (transportLine >= 0) lines[transportLine] = `${indent}transport: nethernet`;
      else lines.splice(portLine >= 0 ? portLine + 1 : b + 1, 0, `${indent}transport: nethernet`);
      const after = lines.join('\n');
      if (after !== before.replace(/\r\n/g, '\n')) { fs.writeFileSync(f, after); changed = true; }
    }
    return changed;
  }

  async start(id) {
    let cfg = this.load(id);
    const r = this.runtime(id);
    if (r.proc || r.preparing) return;
    if (cfg.state !== 'ready') throw new Error('This server is not installed yet');
    const t = T.type(cfg.loader);
    const dir = this.dir(id);
    const port = this.portOf(id, cfg);
    if (t.bedrock) {
      // NetherNet (the default since 1.26) listens on TCP for connection setup; RakNet uses UDP
      const raknet = String(props.read(path.join(dir, 'server.properties')).transport || 'nethernet').toLowerCase() === 'raknet';
      if (!(await portFreeUdp(port)) || (!raknet && !(await portFreeTcp(port)))) throw new Error(`Port ${port} is already in use. Stop the other server or change the port in Settings.`);
    } else if (!(await portFreeTcp(port))) throw new Error(`Port ${port} is already in use. Stop the other server or change the port in Settings.`);
    if (cfg.geyser && cfg.geyser.enabled && cfg.geyser.port && !(await portFreeTcp(cfg.geyser.port) && await portFreeUdp(cfg.geyser.port))) {
      this._log(id, `[CraftDock] Port ${cfg.geyser.port} for Bedrock players (Geyser) is in use, so Bedrock players won't be able to join. Pick another Bedrock port in Settings → Bedrock cross-play.`, 'error');
    }
    if (cfg.eulaAccepted && t.eula !== false && !t.bedrock && !fs.existsSync(path.join(dir, 'eula.txt'))) fs.writeFileSync(path.join(dir, 'eula.txt'), 'eula=true\n');

    this._setStatus(id, 'starting');
    r.preparing = true;
    try {
      if (cfg.automation && cfg.automation.updateServerOnStart) {
        try {
          const u = await Promise.race([this.softwareUpdate(id), sleep(15000).then(() => ({ available: false }))]);
          if (u.available) {
            this._log(id, `[CraftDock] Updating server software ${u.current || ''} → ${u.latest} before starting…`, 'system');
            const prev = { loader: cfg.loader, mcVersion: cfg.mcVersion, loaderVersion: cfg.loaderVersion };
            this._patch(id, { mcVersion: u.mcVersion, loaderVersion: u.loaderVersion || null });
            await this._install(this.load(id), { previous: prev });
            cfg = this.load(id);
            if (cfg.state !== 'ready') {
              // downloads go to temporary files first, so the old version is still intact
              const why = cfg.installError || 'The update failed';
              cfg = this._patch(id, { ...prev, state: 'ready', installError: null });
              this.emit('changed');
              throw new Error(why);
            }
            this._log(id, `[CraftDock] Updated to ${u.latest}`, 'system');
          }
        } catch (e) { this._log(id, `[CraftDock] Server update skipped: ${e.message}`, 'error'); }
      }
      if (cfg.automation && cfg.automation.updateOnStart && this.mods && !cfg.modpack && !t.bedrock) {
        this._log(id, '[CraftDock] Checking for mod/plugin updates before starting…', 'system');
        try {
          const res = await Promise.race([
            this.mods.updateAll(cfg, dir, { log: (l) => this._log(id, `[CraftDock] ${l}`, 'system') }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('took too long')), 120000)),
          ]);
          this._log(id, `[CraftDock] ${res.updated.length ? `${res.updated.length} updated` : 'Everything is up to date'}`, 'system');
        } catch (e) {
          this._log(id, `[CraftDock] Update check skipped: ${e.message}`, 'error');
        }
      }
    } finally {
      r.preparing = false;
    }

    let exe, args;
    const tmp = this.shortTmp();
    try {
      if (t.bedrock) {
        exe = path.join(dir, cfg.exe || (process.platform === 'win32' ? 'bedrock_server.exe' : 'bedrock_server'));
        if (!fs.existsSync(exe)) throw new Error('bedrock_server.exe is missing. Use "Reinstall server files" in Settings.');
        args = [];
      } else {
        exe = await this.javaFor(cfg);
        const mem = Math.max(512, Number(cfg.memoryMB) || 2048);
        if (cfg.geyser && cfg.geyser.enabled && cfg.geyser.port) { try { this._syncGeyserPort(dir, cfg.geyser.port, cfg.loader); } catch {} }
        args = [
          `-Xms${Math.min(mem, 1024)}M`, `-Xmx${mem}M`,
          // Java's internal pipes use Unix sockets in the temp dir, which fail if that path is long or unusual.
          `-Djdk.net.unixdomain.tmpdir=${tmp}`,
          // output is read as UTF-8, so player names and chat in any language show correctly
          '-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8', '-Dstderr.encoding=UTF-8',
          ...(cfg.optimizedFlags ? (t.proxy ? PROXY_FLAGS : OPTIMIZED_FLAGS) : []),
          ...splitArgs(cfg.jvmArgs || ''),
          ...launchArgs(cfg, dir),
          ...splitArgs(cfg.serverArgs || ''),
        ];
      }
    } catch (e) {
      this._setStatus(id, 'offline');
      throw e;
    }
    this._log(id, t.bedrock ? `[CraftDock] Starting ${cfg.name} (Bedrock ${cfg.mcVersion})` : `[CraftDock] Starting ${cfg.name} with Java at ${exe}`, 'system');
    const env = { ...process.env, TMP: tmp, TEMP: tmp };
    if (t.bedrock && process.platform !== 'win32') env.LD_LIBRARY_PATH = dir;
    const proc = spawn(exe, args, { cwd: dir, windowsHide: true, env });
    for (const s of [proc.stdin, proc.stdout, proc.stderr]) s && s.on('error', () => {});
    r.proc = proc;
    r.kind = t.bedrock ? 'bedrock' : t.proxy ? 'proxy' : 'java';
    this._writePids();
    r.startedAt = Date.now();
    r.onlineAt = null;
    r.stopRequested = false;
    r.players = new Set();
    r.sessions = new Map();
    r.history = [];
    r.stats = null;
    r.procStats = null;
    r.crash = null;
    r.peakPlayers = 0;
    r.restartWarned = {};
    r.tps = null;
    r.tpsHistory = [];
    r.tpsUnsupported = false;
    r.ping = null;
    this._event(id, 'start', 'Starting');

    const splitter = (kind) => {
      let buf = '';
      return (d) => {
        buf += d;
        const parts = buf.split(/\r?\n/);
        buf = parts.pop();
        for (const line of parts) if (line.length) this._handleLine(id, line, kind);
      };
    };
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', splitter('out'));
    proc.stderr.on('data', splitter('err'));
    proc.on('error', (e) => {
      this._log(id, `[CraftDock] Failed to start: ${e.message}`, 'error');
      if (!proc.pid) this._onExit(id, -1);
    });
    proc.on('exit', (code) => this._onExit(id, code));
    if (proc.pid) {
      r.monitor = new ProcessMonitor(proc.pid, (s) => (r.procStats = s));
      const pr = os.constants.priority[PRIORITY[cfg.priority] || 'PRIORITY_NORMAL'];
      if (cfg.priority && cfg.priority !== 'normal') { try { os.setPriority(proc.pid, pr); } catch (e) { this._log(id, `[CraftDock] Could not set process priority: ${e.message}`, 'error'); } }
    }
  }

  _handleLine(id, line, kind) {
    const r = this.runtime(id);
    // answers to CraftDock's own TPS question are kept out of the console
    if (r.tpsQuery && Date.now() < r.tpsQuery.until && TPS.isAnswerLine(line)) { r.tpsQuery.lines.push(line); return; }
    this._log(id, line, kind);
    if (r.kind === 'bedrock' ? /\bServer started\./.test(line) : /Done \([\d.,]+s\)!/.test(line)) this._setStatus(id, 'online');
    if (/This crash report has been saved to|Encountered an unexpected exception|Failed to start the minecraft server/i.test(line)) r.crashDetected = true;
    let m;
    if ((m = line.match(/: (?:\[[^\]]*\] )?([A-Za-z0-9_.]{1,16}) joined the game/))) this._playerJoined(id, m[1]);
    else if ((m = line.match(/: (?:\[[^\]]*\] )?([A-Za-z0-9_.]{1,16}) left the game/))) this._playerLeft(id, m[1]);
    else if ((m = line.match(/Player connected: ([^,]+), xuid: ?(\d*)/))) this._playerJoined(id, m[1].trim(), { xuid: m[2] || null });
    else if ((m = line.match(/Player disconnected: ([^,]+), xuid/))) this._playerLeft(id, m[1].trim());
    else if ((m = line.match(/\[connected player\] ([A-Za-z0-9_.]{1,17}) \([^)]*\) has connected/))) this._playerJoined(id, m[1]);
    else if ((m = line.match(/\[connected player\] ([A-Za-z0-9_.]{1,17}) \([^)]*\) has disconnected/))) this._playerLeft(id, m[1]);
    if ((m = line.match(/UUID of player ([A-Za-z0-9_.]{1,17}) is ([0-9a-f-]{36})/i))) {
      const [, name, uuid] = m;
      this._history(id, (h) => { h[name] = { ...(h[name] || { first: Date.now(), joins: 0, playtime: 0 }), uuid }; });
    }
    if ((m = line.match(/crash report has been saved to:?\s*(.+\.txt)/i))) r.crashReport = m[1].trim();
    if (/Stopping (the )?server|Server stop requested/i.test(line) && r.status !== 'offline') this._setStatus(id, 'stopping');
    if (/You need to agree to the EULA/i.test(line)) this._log(id, '[CraftDock] The Minecraft EULA has not been accepted. Accept it in Settings → General.', 'error');
    if (/FAILED TO BIND TO PORT|Network port occupied|Address already in use/i.test(line)) this._log(id, '[CraftDock] The port is in use. Change "Server port" in Settings.', 'error');
    if (/Built-in signaling could not start/i.test(line)) this._log(id, '[CraftDock] Geyser couldn\'t start Bedrock\'s NetherNet connection service. If the port is free, this Minecraft version is too old for it: cross-play works on the newest Minecraft version (Settings → Change version).', 'error');
  }

  _onExit(id, code) {
    const r = this.runtime(id);
    if (!r.proc) return;
    if (r.monitor) r.monitor.stop();
    clearTimeout(r.killTimer);
    const crashed = r.crashDetected || (!r.stopRequested && code !== 0);
    r.crashDetected = false;
    this._log(id, `[CraftDock] Server process exited with code ${code}${crashed ? ' (crashed)' : ''}`, crashed ? 'error' : 'system');
    for (const name of [...r.players]) this._playerLeft(id, name, true);
    if (crashed) r.crash = this._diagnose(id, r);
    r.crashReport = null;
    r.proc = null;
    this._writePids();
    r.monitor = null;
    r.startedAt = null;
    r.players = new Set();
    r.stats = null;
    r.tpsQuery = null;
    this._setStatus(id, crashed ? 'crashed' : 'offline');
    this.emit('players', id, []);
    let cfg;
    try { cfg = this.load(id); } catch { return; }
    this._event(id, crashed ? 'crash' : 'stop', crashed ? `Crashed (exit code ${code})` : 'Stopped');
    if (crashed) this._webhook(id, 'crash', `${cfg.name} crashed`, (r.crash && r.crash.hints[0]) || `Exit code ${code}`);
    else this._webhook(id, 'offline', `${cfg.name} stopped`, r.restartAfterStop ? 'Restarting…' : 'The server is offline.');
    if (r.restartAfterStop) {
      r.restartAfterStop = false;
      setTimeout(() => this.start(id).catch((e) => this._log(id, `[CraftDock] ${e.message}`, 'error')), 1000);
    } else if (crashed && cfg.autoRestart) {
      const now = Date.now();
      r.restarts = r.restarts.filter((t) => now - t < 10 * 60 * 1000);
      if (r.restarts.length < 3) {
        r.restarts.push(now);
        this._log(id, '[CraftDock] Auto-restarting in 5 seconds...', 'system');
        setTimeout(() => this.start(id).catch((e) => this._log(id, `[CraftDock] ${e.message}`, 'error')), 5000);
      } else {
        this._log(id, '[CraftDock] Crashed 3 times in 10 minutes, auto-restart paused.', 'error');
      }
    }
  }

  /** Looks at the output of a crashed run and explains the most likely cause. */
  _diagnose(id, r) {
    const since = r.startedAt || 0;
    const lines = r.logs.filter((e) => e.t >= since).map((e) => e.line);
    const text = lines.join('\n');
    const hints = [];
    const add = (re, msg) => { if (re.test(text) && !hints.includes(msg)) hints.push(msg); };
    add(/OutOfMemoryError|Java heap space/i, 'The server ran out of memory. Give it more RAM in Settings → General.');
    add(/Could not create the Java Virtual Machine|Error occurred during initialization of VM|Invalid (?:initial|maximum) heap size|Could not reserve enough space|Unrecognized (?:VM )?option/i, 'Java refused to start with these settings. Check the RAM amount and any "Extra JVM arguments" in Settings → Performance & Java.');
    add(/UnsupportedClassVersionError|compiled by a more recent version of the Java Runtime/i, 'A mod or plugin needs a newer Java version than this server uses. Check that it was made for this Minecraft version, or pick a newer Java in Settings → Performance & Java.');
    add(/FAILED TO BIND TO PORT|Address already in use|Network port occupied/i, 'The port is already in use by another program or server. Change the port in Settings → Game.');
    add(/Missing or unsupported mandatory dependencies|requires .+ (?:mod|version)|depends on|Incompatible mods? found|could not find required mod|Mod resolution failed/i, 'A mod is missing a dependency or has the wrong version. The error lines below name the mod. Install the missing mod or remove the one that needs it.');
    add(/DuplicateModsFoundException|Found duplicate mods|Duplicate mods? (?:found|detected)/i, 'The same mod is installed twice. Remove one of the copies in the Mods tab.');
    add(/net\/minecraft\/client|Attempted to load class .*client|Dist\.CLIENT|EnvType\.CLIENT|client-only/i, 'A client-only mod is installed on the server (e.g. a minimap or shader mod). Remove it from the Mods tab.');
    add(/MixinApplyError|Mixin apply.* failed|MixinTransformerError/i, 'Two mods conflict with each other (mixin error). The lines below usually name the mods. Try removing recently added mods.');
    add(/agree to the EULA/i, 'The Minecraft EULA has not been accepted. Accept it in Settings → General.');
    add(/Unable to establish loopback connection/i, 'Java couldn\'t open its internal network pipe. Restart CraftDock and try again.');
    add(/Failed to load (?:level|world)|Exception reading .*level\.dat|Corrupt/i, 'The world may be corrupted. Restore a backup from the Backups tab.');
    add(/Ambiguous plugin name|Could not load 'plugins/i, 'A plugin failed to load. The lines below name it. Check it was made for this server type and version.');
    add(/Forced host .* references|Velocity.*config.*invalid/i, 'velocity.toml has an error. Check the Network tab or the file in the Files tab.');
    const errorLines = lines.filter((l) => /\b(ERROR|FATAL|SEVERE)\b|Exception|Error:|Caused by|^Error\b|^Could not|^Invalid /.test(l) && !/^\s+at /.test(l)).slice(-8);
    return { time: Date.now(), hints, errorLines, report: r.crashReport || null };
  }

  clearCrash(id) {
    this.runtime(id).crash = null;
  }

  command(id, cmd, { silent = false } = {}) {
    const r = this.runtime(id);
    if (!r.proc) throw new Error('Server is not running');
    const c = String(cmd).replace(/^\//, '').replace(/[\r\n]/g, '');
    if (!silent) this._log(id, `> ${c}`, 'input');
    r.proc.stdin.write(c + '\n');
  }

  stop(id) {
    const r = this.runtime(id);
    if (!r.proc) return;
    r.stopRequested = true;
    this._setStatus(id, 'stopping');
    let cfg = {};
    try { cfg = this.load(id); } catch {}
    try { r.proc.stdin.write(T.isProxy(cfg.loader) ? 'shutdown\n' : 'stop\n'); } catch {}
    clearTimeout(r.killTimer);
    r.killTimer = setTimeout(() => this.kill(id), 60000);
  }

  restart(id) {
    const r = this.runtime(id);
    if (!r.proc) return this.start(id);
    r.restartAfterStop = true;
    this.stop(id);
  }

  /** Warns players in chat, then restarts or stops. */
  async _countdown(id, seconds, action) {
    const r = this.runtime(id);
    if (!r.proc || r.countingDown) return;
    r.countingDown = true;
    let cfg = {};
    try { cfg = this.load(id); } catch {}
    const say = (msg) => { if (!T.isProxy(cfg.loader)) { try { this.command(id, `say ${msg}`); } catch {} } };
    try {
      let left = Math.max(0, Number(seconds) || 0);
      const marks = [300, 120, 60, 30, 10, 5];
      if (left && r.players.size) say(`Server ${action === 'stop' ? 'stopping' : 'restarting'} in ${left >= 60 ? `${Math.round(left / 60)} minute${left >= 120 ? 's' : ''}` : `${left} seconds`}.`);
      while (left > 0 && r.proc) {
        await sleep(1000);
        left--;
        if (marks.includes(left) && r.players.size) say(`Server ${action === 'stop' ? 'stopping' : 'restarting'} in ${left >= 60 ? `${left / 60} minute${left >= 120 ? 's' : ''}` : `${left} seconds`}.`);
      }
      if (!r.proc) return;
      if (action === 'stop') this.stop(id); else this.restart(id);
    } finally { r.countingDown = false; }
  }

  kill(id) {
    const r = this.runtime(id);
    if (!r.proc) return;
    r.stopRequested = true;
    this._log(id, '[CraftDock] Force-killing server process', 'error');
    try { r.proc.kill('SIGKILL'); } catch {}
  }

  runningIds() {
    return [...this.rt.entries()].filter(([, r]) => r.proc).map(([id]) => id);
  }

  /** Stops every running server; resolves when all have exited (or after timeout). */
  stopAll(timeoutMs = 45000) {
    const ids = this.runningIds();
    if (!ids.length) return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => { if (!this.runningIds().length) { clearInterval(iv); clearTimeout(to); resolve(); } };
      const iv = setInterval(check, 300);
      const to = setTimeout(() => { for (const id of this.runningIds()) this.kill(id); setTimeout(resolve, 1500); clearInterval(iv); }, timeoutMs);
      ids.forEach((id) => this.stop(id));
    });
  }

  // ---------- TPS ----------
  /** Asks the server for its tick rate (answer lines are hidden from the console). */
  async queryTps(id) {
    const r = this.runtime(id);
    if (!r.proc || r.status !== 'online') return null;
    if (r.tpsUnsupported) return { unsupported: true };
    const cfg = this.load(id);
    const cmds = TPS.tpsCommands(cfg);
    if (!cmds) return { unsupported: true };
    if (r.tpsQuery) return r.tps || null;
    r.tpsQuery = { until: Date.now() + 2500, lines: [] };
    try {
      for (const c of cmds) this.command(id, c, { silent: true });
      await sleep(1600);
      const res = TPS.parseTps(r.tpsQuery ? r.tpsQuery.lines : []);
      if (res.tps == null && res.mspt == null) {
        r.tpsMisses = (r.tpsMisses || 0) + 1;
        if (r.tpsMisses >= 3) r.tpsUnsupported = true;
        return r.tps || null;
      }
      r.tpsMisses = 0;
      r.tps = { ...res, t: Date.now() };
      r.tpsHistory.push(r.tps);
      if (r.tpsHistory.length > 120) r.tpsHistory.shift();
      this.emit('tps', id, r.tps);
      return r.tps;
    } finally {
      setTimeout(() => { r.tpsQuery = null; }, 900);
    }
  }

  // ---------- stats ----------
  async _tick() {
    this._tickCount = (this._tickCount || 0) + 1;
    for (const [id, r] of this.rt) {
      if (!r.proc) continue;
      let cfg;
      try { cfg = this.load(id); } catch { continue; }
      const bedrock = T.isBedrock(cfg.loader);
      if (r.status === 'online' && !bedrock && this._tickCount % 2 === 0) {
        const port = this.portOf(id, cfg);
        ping('127.0.0.1', port, 2500).then((res) => {
          r.ping = {
            online: res.players ? res.players.online : 0,
            max: res.players ? res.players.max : 0,
            sample: (res.players && res.players.sample || []).map((p) => p.name),
            motd: flattenText(res.description),
            version: res.version && res.version.name,
            latency: res.latency,
          };
        }).catch(() => {});
      }
      const ps = r.procStats || { cpu: 0, mem: 0 };
      const players = r.ping && !bedrock ? Math.max(r.ping.online, r.players.size) : r.players.size;
      const maxPlayers = r.ping && !bedrock ? r.ping.max : Number(props.read(path.join(this.dir(id), 'server.properties'))['max-players']) || null;
      r.stats = {
        cpu: ps.cpu, mem: ps.mem, memMax: bedrock ? null : (cfg.memoryMB || 0) * 1048576,
        players, maxPlayers, latency: r.ping ? r.ping.latency : null,
        uptime: r.startedAt ? Date.now() - r.startedAt : 0,
        status: r.status, tps: r.tps ? r.tps.tps : null, mspt: r.tps ? r.tps.mspt : null,
      };
      r.history.push({ t: Date.now(), cpu: ps.cpu, mem: ps.mem, players });
      if (r.history.length > HISTORY) r.history.shift();
      this.emit('stats', id, r.stats);
    }
  }

  /** Scheduled restarts (with in-game countdown), automatic backups and custom scheduled tasks. */
  async _automationTick() {
    const now = Date.now();
    for (const [id, r] of this.rt) {
      if (!r.proc || r.status !== 'online') continue;
      let cfg;
      try { cfg = this.load(id); } catch { continue; }
      const a = cfg.automation || {};
      if (a.restartEveryHours > 0 && r.startedAt) {
        const due = r.startedAt + a.restartEveryHours * 3600000;
        const left = due - now;
        r.restartWarned = r.restartWarned || {};
        for (const [ms, label] of [[300000, '5 minutes'], [60000, '1 minute'], [10000, '10 seconds']]) {
          if (left <= ms && left > 0 && !r.restartWarned[ms]) {
            r.restartWarned[ms] = true;
            if (!T.isProxy(cfg.loader)) { try { this.command(id, `say Scheduled restart in ${label}.`); } catch {} }
          }
        }
        if (left <= 0 && !r.restartAfterStop) {
          this._log(id, '[CraftDock] Scheduled restart', 'system');
          this._event(id, 'restart', 'Scheduled restart');
          this.restart(id);
          continue;
        }
      }
      if (a.backupEveryHours > 0 && !r.backingUp) {
        const last = cfg.lastAutoBackup || 0;
        if (now - last >= a.backupEveryHours * 3600000 && r.startedAt && now - r.startedAt > 60000) {
          r.backingUp = true;
          this.createBackup(id, { auto: true, full: !!a.backupFull })
            .then(() => {
              this._patch(id, { lastAutoBackup: Date.now() });
              this._pruneAutoBackups(id, a.keepBackups || 5);
              this._log(id, '[CraftDock] Automatic backup created', 'system');
              this.emit('backup', id);
            })
            .catch((e) => this._log(id, `[CraftDock] Automatic backup failed: ${e.message}`, 'error'))
            .finally(() => { r.backingUp = false; });
        }
      }
    }
    this._runTasks(now);
  }

  _taskDue(t, r, now) {
    const s = t.schedule || {};
    if (s.type === 'daily') {
      const [h, m] = String(s.time || '04:00').split(':').map(Number);
      const d = new Date(now);
      const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h || 0, m || 0, 0).getTime();
      if (now < at || now - at > 5 * 60000 || (t.lastRun || 0) >= at) return false;
      if (Array.isArray(s.days) && s.days.length && !s.days.includes(d.getDay())) return false;
      return t.action === 'start' ? !r.proc : !!r.proc && r.status === 'online';
    }
    if (!r.proc || r.status !== 'online' || t.action === 'start') return false;
    const base = Math.max(t.lastRun || 0, r.onlineAt || now);
    return now - base >= Math.max(1, Number(s.minutes) || 60) * 60000;
  }

  _runTasks(now) {
    for (const cfg of this.list()) {
      const tasks = (cfg.tasks || []).filter((t) => t.enabled !== false);
      if (!tasks.length || cfg.state !== 'ready') continue;
      const r = this.runtime(cfg.id);
      const ran = [];
      for (const t of tasks) {
        if (!this._taskDue(t, r, now)) continue;
        ran.push(t.id);
        this._runTask(cfg, t).catch((e) => this._log(cfg.id, `[CraftDock] Task "${t.name || t.action}" failed: ${e.message}`, 'error'));
      }
      if (ran.length) {
        const fresh = this.load(cfg.id);
        this._save({ ...fresh, tasks: (fresh.tasks || []).map((t) => (ran.includes(t.id) ? { ...t, lastRun: now } : t)) });
      }
    }
  }

  async _runTask(cfg, t) {
    const id = cfg.id;
    const label = t.name || t.action;
    this._log(id, `[CraftDock] Running scheduled task: ${label}`, 'system');
    this._event(id, 'task', `Task: ${label}`);
    switch (t.action) {
      case 'command':
        for (const c of t.value.split(/\r?\n|;\s*/).map((x) => x.trim()).filter(Boolean)) this.command(id, c);
        break;
      case 'broadcast':
        if (T.isProxy(cfg.loader)) throw new Error('Velocity has no broadcast command');
        this.command(id, `say ${t.value}`);
        break;
      case 'restart': return this._countdown(id, Number(t.value) || 60, 'restart');
      case 'stop': return this._countdown(id, Number(t.value) || 60, 'stop');
      case 'start': return this.start(id);
      case 'backup': {
        await this.createBackup(id, { auto: true, full: (cfg.automation || {}).backupFull });
        this._pruneAutoBackups(id, (cfg.automation || {}).keepBackups || 5);
        this.emit('backup', id);
        break;
      }
      default:
    }
    return undefined;
  }

  _pruneAutoBackups(id, keep) {
    const auto = this.backups(id).filter((b) => b.auto);
    for (const b of auto.slice(keep)) this.deleteBackup(id, b.file);
  }

  async _diskTick() {
    for (const cfg of this.list()) {
      const r = this.runtime(cfg.id);
      r.worldSize = await this.worldSize(cfg.id);
    }
  }

  worldFolders(id) {
    const cfg = this.load(id);
    if (T.isProxy(cfg.loader)) return [];
    const dir = this.dir(id);
    const p = props.read(path.join(dir, 'server.properties'));
    const level = p['level-name'] || (T.isBedrock(cfg.loader) ? 'Bedrock level' : 'world');
    return W.worldFolders(dir, cfg.loader, level);
  }

  async worldSize(id) {
    let total = 0;
    for (const f of this.worldFolders(id)) total += await dirSize(path.join(this.dir(id), f));
    return total;
  }

  // ---------- worlds ----------
  worlds(id) {
    const cfg = this.load(id);
    if (T.isProxy(cfg.loader)) return [];
    return W.listWorlds(this.dir(id), cfg.loader);
  }
  _requireStopped(id, what) {
    if (this.runtime(id).proc) throw new Error(`Stop the server before ${what}`);
  }
  inspectWorld(id, src) {
    const cfg = this.load(id);
    return W.inspectImport(src, cfg.loader, cfg.mcVersion);
  }
  async importWorld(id, src, { mode = 'add', name, activate = true, backup = true, label } = {}) {
    const cfg = this.load(id);
    if (mode === 'replace' || activate) this._requireStopped(id, 'changing its world');
    const check = W.inspectImport(src, cfg.loader, cfg.mcVersion);
    if (check.error) throw new Error(check.error);
    if (mode === 'replace' && backup && this.worldFolders(id).length) {
      this.emit('worldProgress', id, { step: 'Backing up the current world', pct: null });
      await this.createBackup(id, { note: 'Before importing a world' });
    }
    const target = await W.importWorld(this.dir(id), cfg.loader, src, {
      mode, name, activate,
      onProgress: (d, t) => this.emit('worldProgress', id, { step: 'Copying world', pct: t ? d / t : null }),
    });
    this._event(id, 'world', `World "${target}" imported${label ? ` from ${label}` : ''}`);
    this.emit('changed');
    return { name: target, warnings: check.warnings };
  }
  setActiveWorld(id, name) {
    const cfg = this.load(id);
    const dir = this.dir(id);
    const parent = T.isBedrock(cfg.loader) ? path.join(dir, 'worlds') : dir;
    if (!fs.existsSync(path.join(parent, name))) throw new Error('World not found');
    props.write(path.join(dir, 'server.properties'), { 'level-name': name });
    this._event(id, 'world', `Active world is now "${name}"`);
    this.emit('changed');
  }
  async renameWorld(id, from, to) {
    const cfg = this.load(id);
    if (this.runtime(id).proc && this.summary(id).levelName === from) throw new Error('Stop the server before renaming the world it is using');
    const n = await W.renameWorld(this.dir(id), cfg.loader, from, to);
    this.emit('changed');
    return n;
  }
  async deleteWorld(id, name) {
    const cfg = this.load(id);
    if (this.runtime(id).proc && this.summary(id).levelName === name) throw new Error('Stop the server before deleting the world it is using');
    await W.deleteWorld(this.dir(id), cfg.loader, name);
    this._event(id, 'world', `World "${name}" deleted`);
    this.emit('changed');
  }
  /** Deletes the active world so a fresh one is generated on next start (optionally with a new seed / type). */
  async resetWorld(id, { seed, levelType, backup = true } = {}) {
    const cfg = this.load(id);
    this._requireStopped(id, 'resetting the world');
    if (backup && this.worldFolders(id).length) await this.createBackup(id, { note: 'Before resetting the world' });
    const level = this.summary(id).levelName;
    await W.deleteWorld(this.dir(id), cfg.loader, level);
    const patch = {};
    if (seed !== undefined) patch['level-seed'] = seed || '';
    if (levelType && !T.isBedrock(cfg.loader)) patch['level-type'] = levelType;
    if (Object.keys(patch).length) props.write(path.join(this.dir(id), 'server.properties'), patch);
    this._event(id, 'world', 'World reset (a new one is generated on next start)');
    this.emit('changed');
  }
  async exportWorld(id, name, outFile) {
    const cfg = this.load(id);
    if (this.runtime(id).proc && this.summary(id).levelName === name) {
      try { this.command(id, T.isBedrock(cfg.loader) ? 'save hold' : 'save-all flush'); } catch {}
      await sleep(3000);
    }
    try {
      return await W.exportWorld(this.dir(id), cfg.loader, name, outFile, this.shortTmp());
    } finally {
      if (T.isBedrock(cfg.loader) && this.runtime(id).proc) { try { this.command(id, 'save resume'); } catch {} }
    }
  }
  async copyWorldToSingleplayer(id, name) {
    const cfg = this.load(id);
    const dest = W.singleplayerDir(T.isBedrock(cfg.loader) ? 'bedrock' : 'java');
    if (!dest) throw new Error('Couldn\'t find your Minecraft saves folder. Use "Download as .zip" instead.');
    if (T.isBedrock(cfg.loader)) {
      const folder = path.join(dest, W.safeName(name) + '-' + crypto.randomBytes(2).toString('hex'));
      await copyTree(path.join(this.dir(id), 'worlds', name), folder);
      return folder;
    }
    return W.copyAsSingleplayer(this.dir(id), cfg.loader, name, dest);
  }
  gamerules(id, name) {
    const cfg = this.load(id);
    return W.readGamerules(this.dir(id), cfg.loader, name || this.summary(id).levelName);
  }
  setGamerules(id, name, patch) {
    const cfg = this.load(id);
    const s = this.summary(id);
    const world = name || s.levelName;
    const r = this.runtime(id);
    if (r.proc && world === s.levelName) {
      if (r.status !== 'online') throw new Error('Wait until the server is online');
      for (const [k, v] of Object.entries(patch)) this.command(id, `gamerule ${k} ${v}`);
      return 'live';
    }
    W.writeGamerules(this.dir(id), cfg.loader, world, patch);
    return 'saved';
  }

  // ---------- properties ----------
  getProperties(id) {
    return props.read(path.join(this.dir(id), 'server.properties'));
  }
  setProperties(id, patch) {
    const cfg = this.load(id);
    const p = { ...patch };
    if ('server-port' in p) {
      const port = Number(p['server-port']);
      delete p['server-port'];
      this.setPort(id, port);
    }
    if (Object.keys(p).length) props.write(path.join(this.dir(id), 'server.properties'), p);
    if (T.isBedrock(cfg.loader) && 'server-name' in p) { /* shown as MOTD */ }
    this.emit('changed');
    return this.getProperties(id);
  }
  acceptEula(id) {
    const cfg = this.load(id);
    this._save({ ...cfg, eulaAccepted: true });
    if (!T.isBedrock(cfg.loader)) fs.writeFileSync(path.join(this.dir(id), 'eula.txt'), `# Accepted in CraftDock by the user (https://aka.ms/MinecraftEULA)\neula=true\n`);
  }

  // ---------- velocity ----------
  velocityConfig(id) {
    return VEL.getConfig(this.dir(id));
  }
  setVelocityConfig(id, patch) {
    const dir = this.dir(id);
    const p = {};
    if ('motd' in patch) p.motd = String(patch.motd);
    if ('showMaxPlayers' in patch) p['show-max-players'] = Math.max(0, Number(patch.showMaxPlayers) || 0);
    if ('onlineMode' in patch) p['online-mode'] = !!patch.onlineMode;
    if ('forwarding' in patch) p['player-info-forwarding-mode'] = String(patch.forwarding).toUpperCase();
    if (Object.keys(p).length) VEL.setTop(dir, p);
    if ('port' in patch) this.setPort(id, Number(patch.port));
    this.emit('changed');
    return VEL.getConfig(dir);
  }
  network(id) {
    const cfg = this.load(id);
    if (!T.isProxy(cfg.loader)) throw new Error('Only Velocity proxies have a network');
    const members = (cfg.network && cfg.network.members) || [];
    const candidates = this.list().filter((c) => c.id !== id && T.isJavaGame(c.loader)).map((c) => ({
      id: c.id, name: c.name, loader: c.loader, mcVersion: c.mcVersion, port: this.portOf(c.id, c), status: this.summary(c.id).status,
      linked: members.includes(c.id), proxiedBy: c.proxiedBy || null,
      forwarding: ['paper', 'purpur', 'folia', 'leaf', 'fabric', 'quilt'].includes(c.loader),
    }));
    return { config: VEL.getConfig(this.dir(id)), members, candidates };
  }
  async setNetwork(id, memberIds, log = () => {}) {
    const cfg = this.load(id);
    if (!T.isProxy(cfg.loader)) throw new Error('Only Velocity proxies have a network');
    const dir = this.dir(id);
    const secret = VEL.secret(dir);
    const before = new Set((cfg.network && cfg.network.members) || []);
    const after = memberIds.filter((m) => { try { this.load(m); return true; } catch { return false; } });
    const notes = [];
    const taken = new Set();
    const list = after.map((m) => {
      const c = this.load(m);
      const base = String(c.name).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'server';
      let name = base, i = 2;
      while (taken.has(name)) name = `${base}-${i++}`;
      taken.add(name);
      return { name, address: `127.0.0.1:${this.portOf(m, c)}` };
    });
    VEL.setServers(dir, list, list.map((s) => s.name));
    VEL.setTop(dir, { 'player-info-forwarding-mode': 'MODERN' });
    for (const m of after) {
      const c = this.load(m);
      const res = VEL.configureBackend(this.dir(m), c.loader, secret, true);
      notes.push(`${c.name}: ${res.note}`);
      if (res.needsMod && this.mods) {
        try { await this.mods.install(c, this.dir(m), 'modrinth', res.needsMod, null); notes.push(`${c.name}: installed FabricProxy-Lite`); }
        catch (e) { notes.push(`${c.name}: couldn't install FabricProxy-Lite (${e.message})`); }
      }
      this._save({ ...this.load(m), proxiedBy: id });
    }
    for (const m of before) {
      if (after.includes(m)) continue;
      try {
        const c = this.load(m);
        VEL.configureBackend(this.dir(m), c.loader, secret, false);
        this._save({ ...c, proxiedBy: null });
        notes.push(`${c.name}: removed from the network (turn "Online mode" back on in its Settings if players will join it directly)`);
      } catch {}
    }
    this._save({ ...this.load(id), network: { members: after } });
    notes.forEach(log);
    this.emit('changed');
    return { notes, restart: [id, ...after].filter((m) => this.runtime(m).proc) };
  }

  // ---------- players ----------
  playerLists(id) {
    const cfg = this.load(id);
    const dir = this.dir(id);
    const r = this.runtime(id);
    const online = new Set([...r.players, ...((r.ping && r.ping.sample) || [])]);
    if (T.isBedrock(cfg.loader)) {
      const perms = readJsonList(path.join(dir, 'permissions.json'));
      const hist = readJson(path.join(dir, 'players.json'), {});
      const byXuid = Object.fromEntries(Object.entries(hist).filter(([, p]) => p.xuid).map(([n, p]) => [p.xuid, n]));
      return {
        online: [...online],
        ops: perms.filter((p) => p.permission === 'operator').map((p) => byXuid[p.xuid] || p.xuid),
        whitelist: readJsonList(path.join(dir, 'allowlist.json')).map((p) => p.name),
        banned: [], bannedIps: [], bedrock: true,
      };
    }
    return {
      online: [...online],
      ops: readJsonList(path.join(dir, 'ops.json')).map((p) => p.name),
      whitelist: readJsonList(path.join(dir, 'whitelist.json')).map((p) => p.name),
      banned: readJsonList(path.join(dir, 'banned-players.json')).map((p) => ({ name: p.name, reason: p.reason, created: p.created })),
      bannedIps: readJsonList(path.join(dir, 'banned-ips.json')).map((p) => ({ ip: p.ip, reason: p.reason })),
    };
  }

  // ---------- backups ----------
  backupsDir(id, cfg) {
    const custom = this.getSettings().backupDir;
    if (custom && fs.existsSync(custom)) return path.join(custom, id);
    return path.join(this.dir(id), 'backups');
  }
  _notesFile(id) { return path.join(this.backupsDir(id), 'notes.json'); }
  backups(id) {
    const d = this.backupsDir(id);
    if (!fs.existsSync(d)) return [];
    const notes = readJson(this._notesFile(id), {});
    return fs.readdirSync(d).filter((f) => f.endsWith('.zip')).map((f) => {
      const st = fs.statSync(path.join(d, f));
      return { file: f, size: st.size, time: st.mtimeMs, auto: f.startsWith('auto-'), full: /(^|-)full-/.test(f), note: notes[f] || '' };
    }).sort((a, b) => b.time - a.time);
  }
  setBackupNote(id, file, note) {
    const notes = readJson(this._notesFile(id), {});
    if (note) notes[path.basename(file)] = String(note).slice(0, 200); else delete notes[path.basename(file)];
    fs.writeFileSync(this._notesFile(id), JSON.stringify(notes, null, 2));
  }
  /** Zips the world (or the whole server with `full`). Safe while running: saving is paused during the copy. */
  async createBackup(id, { auto = false, full = false, note = '' } = {}) {
    const cfg = this.load(id);
    const dir = this.dir(id);
    const bedrock = T.isBedrock(cfg.loader);
    if (T.isProxy(cfg.loader)) full = true;
    let entries;
    if (full) {
      const skipJars = new Set();
      entries = fs.readdirSync(dir).filter((n) => !TOP_SKIP_FULL.has(n) && !skipJars.has(n) && !/\.part$/.test(n));
    } else {
      entries = this.worldFolders(id);
      if (!entries.length) throw new Error('There is no world yet. Start the server once to create it.');
    }
    const r = this.runtime(id);
    const running = !!r.proc && r.status === 'online' && !T.isProxy(cfg.loader);
    if (running) {
      if (bedrock) this.command(id, 'save hold');
      else { this.command(id, 'save-off'); this.command(id, 'save-all flush'); }
      await sleep(bedrock ? 3000 : 4000);
    }
    const file = path.join(this.backupsDir(id), `${auto ? 'auto-' : 'backup-'}${full ? 'full-' : ''}${stamp()}.zip`);
    try {
      await createZip(file, dir, entries, ['session.lock']);
    } finally {
      if (running && r.proc) this.command(id, bedrock ? 'save resume' : 'save-on');
    }
    if (note) this.setBackupNote(id, file, note);
    this._event(id, 'backup', `${auto ? 'Automatic' : 'Manual'} ${full ? 'full-server ' : ''}backup created`);
    this._webhook(id, 'backup', `${cfg.name} backed up`, path.basename(file));
    return path.basename(file);
  }
  async restoreBackup(id, file) {
    if (this.runtime(id).proc) throw new Error('Stop the server before restoring a backup');
    const zip = path.join(this.backupsDir(id), path.basename(file));
    if (!fs.existsSync(zip)) throw new Error('Backup not found');
    const dir = this.dir(id);
    // remove whatever the backup will put back (top-level entries in the zip), then unpack
    let tops = [];
    try { tops = [...new Set(new AdmZip(zip).getEntries().map((e) => e.entryName.split('/')[0]).filter(Boolean))]; } catch {}
    if (!tops.length) tops = this.worldFolders(id);
    for (const f of tops) {
      if ([CONFIG, 'backups'].includes(f)) continue;
      await fs.promises.rm(path.join(dir, f), { recursive: true, force: true });
    }
    await extractArchive(zip, dir);
    this._event(id, 'backup', `Restored ${path.basename(file)}`);
  }
  deleteBackup(id, file) {
    fs.rmSync(path.join(this.backupsDir(id), path.basename(file)), { force: true });
    try { this.setBackupNote(id, file, ''); } catch {}
  }

  // ---------- logs ----------
  listLogs(id) {
    const dir = this.dir(id);
    const out = [];
    const add = (sub, kind, re) => {
      for (const e of fs.existsSync(path.join(dir, sub)) ? fs.readdirSync(path.join(dir, sub), { withFileTypes: true }) : []) {
        if (!e.isFile() || !re.test(e.name)) continue;
        const st = fs.statSync(path.join(dir, sub, e.name));
        out.push({ rel: `${sub}/${e.name}`, name: e.name, kind, size: st.size, mtime: st.mtimeMs });
      }
    };
    add('logs', 'log', /\.(log|log\.gz|txt)$/i);
    add('crash-reports', 'crash', /\.txt$/i);
    return out.sort((a, b) => b.mtime - a.mtime);
  }
  readLog(id, rel) {
    const p = this._safe(id, rel);
    let buf = fs.readFileSync(p);
    if (/\.gz$/i.test(p)) buf = zlib.gunzipSync(buf);
    const max = 3 * 1048576;
    const text = buf.subarray(Math.max(0, buf.length - max)).toString('utf8');
    return { text, truncated: buf.length > max };
  }

  // ---------- export ----------
  async exportServer(id, outFile) {
    const dir = this.dir(id);
    const r = this.runtime(id);
    const cfg = this.load(id);
    const running = !!r.proc && r.status === 'online' && T.isJavaGame(cfg.loader);
    if (running) { this.command(id, 'save-all flush'); await sleep(3000); }
    const entries = fs.readdirSync(dir).filter((n) => !['backups', 'logs', 'crash-reports', 'cache', '.bedrock-new', 'events.json'].includes(n) && !/\.part$/.test(n));
    await createZip(outFile, dir, entries, ['session.lock']);
    return outFile;
  }

  async javaInfo(id) {
    const cfg = this.load(id);
    if (T.isBedrock(cfg.loader)) return { bedrock: true };
    try {
      const java = await this.javaFor(cfg);
      return { path: java, version: await probeJava(java), feature: cfg.javaOverride || cfg.javaFeature || null, override: cfg.javaOverride || null };
    } catch (e) {
      return { error: e.message };
    }
  }
}

module.exports = { ServerManager };
