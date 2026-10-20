/* global icon, api */
const call = (ch, ...a) => api.invoke(ch, ...a);

// ---------- helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtBytes = (b) => {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / 1024 ** i).toFixed(i >= 3 ? 2 : i ? 1 : 0)} ${u[i]}`;
};
const fmtNum = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n ?? 0));
const fmtDur = (ms) => {
  if (!ms) return '—';
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
};
const ago = (t) => {
  if (!t) return 'never';
  const s = (Date.now() - new Date(t).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  if (s < 86400 * 365) return `${Math.floor(s / 86400 / 30)}mo ago`;
  return `${Math.floor(s / 86400 / 365)}y ago`;
};
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const pad2 = (n) => String(n).padStart(2, '0');

// ---------- server types ----------
const LOADERS = {
  vanilla: { name: 'Vanilla', color: '#4ade80', cat: 'plugins', desc: 'The official Mojang server. Supports datapacks.' },
  paper: { name: 'Paper', color: '#60a5fa', cat: 'plugins', desc: 'Fast, optimized server with Bukkit & Spigot plugins. The best default.', tag: 'Recommended' },
  purpur: { name: 'Purpur', color: '#c084fc', cat: 'plugins', desc: 'Paper with hundreds of extra gameplay options to tweak.' },
  folia: { name: 'Folia', color: '#2dd4bf', cat: 'plugins', desc: 'Paper split across CPU cores for huge servers. Needs Folia plugins.', tag: 'Advanced' },
  leaf: { name: 'Leaf', color: '#86efac', cat: 'plugins', desc: 'A very fast Paper fork focused on performance.' },
  spigot: { name: 'Spigot', color: '#f59e0b', cat: 'plugins', desc: 'The classic plugin server. Built from source with BuildTools.' },
  sponge: { name: 'Sponge', color: '#facc15', cat: 'plugins', desc: 'SpongeVanilla with the Sponge plugin API.' },
  fabric: { name: 'Fabric', color: '#e2c08d', cat: 'mods', desc: 'Lightweight mod loader, great for performance & QoL mods.' },
  quilt: { name: 'Quilt', color: '#a78bfa', cat: 'mods', desc: 'Fabric-compatible mod loader. Runs most Fabric mods too.' },
  forge: { name: 'Forge', color: '#8b9cf7', cat: 'mods', desc: 'The classic mod loader with the biggest library of mods.' },
  neoforge: { name: 'NeoForge', color: '#fb923c', cat: 'mods', desc: 'Modern Forge successor used by most new modpacks.' },
  mohist: { name: 'Mohist', color: '#f472b6', cat: 'hybrid', desc: 'Forge mods and Bukkit plugins on the same server.' },
  youer: { name: 'Youer', color: '#fb7185', cat: 'hybrid', desc: 'NeoForge mods and Bukkit plugins on the same server.' },
  velocity: { name: 'Velocity', color: '#38bdf8', cat: 'proxy', desc: 'A proxy that links several servers into one network (lobby, survival, minigames…).' },
  bedrock: { name: 'Bedrock', color: '#22c55e', cat: 'bedrock', desc: 'Official Bedrock Dedicated Server for phones, consoles and Windows.' },
};
const CATEGORIES = [
  ['plugins', 'Vanilla & plugins', 'Plugins add commands, minigames and protection. Players join with a normal Minecraft client.'],
  ['mods', 'Mod loaders', 'Mods can add new blocks, mobs and dimensions. Players usually need the same mods installed.'],
  ['hybrid', 'Mods + plugins', 'Run mods and Bukkit plugins together.'],
  ['proxy', 'Network proxy', 'Connect several servers so players can hop between them.'],
  ['bedrock', 'Bedrock Edition', 'For Minecraft on phones, tablets, Xbox, PlayStation, Switch and Windows.'],
];
const KIND_NAME = { mod: ['Mod', 'Mods'], plugin: ['Plugin', 'Plugins'], datapack: ['Datapack', 'Datapacks'], addon: ['Add-on', 'Add-ons'] };
const typeInfo = (loader) => (state.types && state.types.find((t) => t.id === loader)) || { id: loader, content: ['mod'], builds: true };
const kindsOf = (loader) => typeInfo(loader).content || ['mod'];
const isBedrock = (s) => (s.loader || s) === 'bedrock';
const isProxy = (s) => (s.loader || s) === 'velocity';
const isJavaGame = (s) => !isBedrock(s) && !isProxy(s);
const isBukkit = (s) => typeInfo(s.loader || s).family === 'bukkit';
const hasBuilds = (loader) => typeInfo(loader).builds;
/** Label for the add-ons tab: "Mods", "Plugins", "Mods & Plugins", "Datapacks", "Add-ons". */
function contentLabel(loader) {
  const k = kindsOf(loader).filter((x) => x !== 'datapack' || loader === 'vanilla');
  return k.map((x) => KIND_NAME[x][1]).join(' & ') || 'Mods';
}
const buildLabel = (loader) => ({ paper: 'Paper build', purpur: 'Purpur build', folia: 'Folia build', leaf: 'Leaf build', velocity: 'Velocity build', mohist: 'Mohist build', youer: 'Youer build', sponge: 'SpongeVanilla build' }[loader] || `${LOADERS[loader]?.name || loader} version`);
const versionLabel = (loader) => (loader === 'velocity' ? 'Velocity version' : loader === 'bedrock' ? 'Bedrock version' : 'Minecraft version');

const SOURCES = {
  modrinth: { name: 'Modrinth', color: '#1bd96a' },
  curseforge: { name: 'CurseForge', color: '#f16436' },
};
const STATUS_LABEL = { online: 'Online', offline: 'Offline', starting: 'Starting', stopping: 'Stopping', crashed: 'Crashed', installing: 'Installing', error: 'Install failed' };

function loaderBadge(loader, size = '', status) {
  const l = LOADERS[loader] || LOADERS.vanilla;
  return `<div class="loader-badge ${size}" style="--lc:${l.color}">${icon(loader, size === 'lg' ? 26 : size === 'md' ? 20 : 18)}${status ? `<span class="dot ${status}"></span>` : ''}</div>`;
}
const statusPill = (s) => `<span class="status-pill"><span class="dot ${s}"></span>${STATUS_LABEL[s] || s}</span>`;
const isRunning = (s) => ['online', 'starting', 'stopping'].includes(s);

// ---------- Minecraft formatting (§ codes and ANSI colors) ----------
const MC_COLORS = { 0: '#3b3f47', 1: '#3d5afe', 2: '#22c55e', 3: '#22d3ee', 4: '#ef4444', 5: '#c026d3', 6: '#f59e0b', 7: '#b4bccb', 8: '#6b7280', 9: '#7c8cff', a: '#4ade80', b: '#67e8f9', c: '#f87171', d: '#f0abfc', e: '#fde047', f: '#f8fafc' };
const ANSI_COLORS = ['#3b3f47', '#f87171', '#4ade80', '#fde047', '#7c8cff', '#f0abfc', '#67e8f9', '#d4d9e2'];
const ANSI_BRIGHT = ['#6b7280', '#fca5a5', '#86efac', '#fef08a', '#a5b4fc', '#f5d0fe', '#a5f3fc', '#ffffff'];
/** Turns text with § codes / ANSI escapes into safe HTML spans. */
function mcFormat(text) {
  let color = null, bold = false, italic = false, under = false, strike = false;
  let out = '';
  let buf = '';
  const flush = () => {
    if (!buf) return;
    const st = [];
    if (color) st.push(`color:${color}`);
    if (bold) st.push('font-weight:700');
    if (italic) st.push('font-style:italic');
    if (under || strike) st.push(`text-decoration:${under ? 'underline ' : ''}${strike ? 'line-through' : ''}`);
    out += st.length ? `<span style="${st.join(';')}">${esc(buf)}</span>` : esc(buf);
    buf = '';
  };
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '§' && i + 1 < s.length) {
      const c = s[i + 1].toLowerCase();
      flush();
      if (c === 'x' && /^(§[0-9a-f]){6}$/i.test(s.slice(i + 2, i + 14))) { color = '#' + s.slice(i + 2, i + 14).replace(/§/g, ''); i += 13; continue; }
      if (MC_COLORS[c]) { color = MC_COLORS[c]; bold = italic = under = strike = false; }
      else if (c === 'l') bold = true;
      else if (c === 'o') italic = true;
      else if (c === 'n') under = true;
      else if (c === 'm') strike = true;
      else if (c === 'r') { color = null; bold = italic = under = strike = false; }
      i++;
      continue;
    }
    if (ch === '\x1b' && s[i + 1] === '[') {
      const m = s.slice(i).match(/^\x1b\[([0-9;]*)([A-Za-z])/);
      if (m) {
        flush();
        if (m[2] === 'm') {
          const codes = m[1].split(';').map(Number);
          for (let k = 0; k < codes.length; k++) {
            const n = codes[k];
            if (n === 0 || Number.isNaN(n)) { color = null; bold = italic = under = strike = false; }
            else if (n === 1) bold = true;
            else if (n === 3) italic = true;
            else if (n === 4) under = true;
            else if (n === 9) strike = true;
            else if (n === 22) bold = false;
            else if (n === 39) color = null;
            else if (n >= 30 && n <= 37) color = ANSI_COLORS[n - 30];
            else if (n >= 90 && n <= 97) color = ANSI_BRIGHT[n - 90];
            else if (n === 38 && codes[k + 1] === 2) { color = `rgb(${codes[k + 2]},${codes[k + 3]},${codes[k + 4]})`; k += 4; }
            else if (n === 38 && codes[k + 1] === 5) { const v = codes[k + 2]; color = v < 8 ? ANSI_COLORS[v] : v < 16 ? ANSI_BRIGHT[v - 8] : null; k += 2; }
          }
        }
        i += m[0].length - 1;
        continue;
      }
    }
    buf += ch;
  }
  flush();
  return out;
}
const stripCodes = (t) => String(t || '').replace(/§[0-9a-fk-orx]/gi, '').replace(ANSI, '');

// ---------- toasts / dialogs / menus ----------
function toast(msg, type = 'info', ms = 4200) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${icon(type === 'success' ? 'check' : type === 'error' ? 'alert' : 'info', 17)}<div class="msg">${esc(msg)}</div>`;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, ms);
}
const fail = (e) => toast(e.message || String(e), 'error', 6500);

function modal({ title, body, foot = '', size = '', onClose }) {
  const root = $('#modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal ${size}"><div class="modal-head">${title}<div class="spacer"></div><button class="btn ghost icon sm" data-close>${icon('x', 18)}</button></div><div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div>`;
  const close = () => { wrap.remove(); onClose && onClose(); };
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  $('[data-close]', wrap).onclick = close;
  root.appendChild(wrap);
  return { el: wrap, close };
}

function confirmDialog({ title, message, confirm = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title: `<h2>${esc(title)}</h2>`, size: 'sm',
      body: `<div class="muted" style="white-space:pre-wrap">${esc(message)}</div>`,
      foot: `<button class="btn ghost" data-no>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(confirm)}</button>`,
      onClose: () => { if (!done) resolve(false); },
    });
    $('[data-no]', m.el).onclick = () => m.close();
    $('[data-yes]', m.el).onclick = () => { done = true; m.close(); resolve(true); };
  });
}

function promptDialog({ title, message = '', value = '', placeholder = '', confirm = 'Save', multiline = false }) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title: `<h2>${esc(title)}</h2>`, size: 'sm',
      body: `${message ? `<div class="muted" style="margin-bottom:10px">${esc(message)}</div>` : ''}${multiline ? `<textarea class="input" id="pd-in" rows="5" placeholder="${esc(placeholder)}">${esc(value)}</textarea>` : `<input class="input" id="pd-in" value="${esc(value)}" placeholder="${esc(placeholder)}" />`}`,
      foot: `<button class="btn ghost" data-no>Cancel</button><button class="btn primary" data-yes>${esc(confirm)}</button>`,
      onClose: () => { if (!done) resolve(null); },
    });
    const input = $('#pd-in', m.el);
    input.focus();
    input.select && input.select();
    const ok = () => { done = true; const v = input.value; m.close(); resolve(v); };
    $('[data-no]', m.el).onclick = () => m.close();
    $('[data-yes]', m.el).onclick = ok;
    input.onkeydown = (e) => { if (e.key === 'Enter' && !multiline) { e.preventDefault(); ok(); } };
  });
}

/** Small dropdown menu anchored to an element. items: [{ label, icon, action, danger, disabled } | '-'] */
function openMenu(anchor, items) {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  const el = document.createElement('div');
  el.className = 'menu';
  el.innerHTML = items.map((it, i) => (it === '-' ? '<div class="menu-sep"></div>' : `<button class="menu-item ${it.danger ? 'danger' : ''}" data-mi="${i}" ${it.disabled ? 'disabled' : ''}>${it.icon ? icon(it.icon, 15) : ''}<span>${esc(it.label)}</span></button>`)).join('');
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  el.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
  el.style.top = `${r.bottom + h + 6 > window.innerHeight ? r.top - h - 6 : r.bottom + 6}px`;
  const close = () => { el.remove(); document.removeEventListener('mousedown', outside, true); };
  const outside = (e) => { if (!el.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener('mousedown', outside, true));
  $$('[data-mi]', el).forEach((b) => (b.onclick = () => { close(); items[b.dataset.mi].action(); }));
}

// ---------- state ----------
const state = {
  servers: [],
  types: [],
  selected: null,
  tab: 'overview',
  system: null,
  settings: null,
  logs: {},
  stats: {},
  history: {},
  tps: {},
  events: {},
  progress: {},
  page: null, // 'settings' when the app settings page is open
  playit: null,
  mods: { sub: 'installed', kind: null, source: 'modrinth', query: '', sort: 'relevance', category: '', hits: [], total: 0, offset: 0, installed: [], updates: null, busy: new Set() },
  consoleFilter: { text: '', level: 'all' },
  files: { path: '' },
  sideQuery: '',
};

// ---------- appearance ----------
const ACCENTS = {
  emerald: ['#34d399', '#10b981', '52, 211, 153'],
  sky: ['#38bdf8', '#0ea5e9', '56, 189, 248'],
  violet: ['#a78bfa', '#8b5cf6', '167, 139, 250'],
  amber: ['#fbbf24', '#f59e0b', '251, 191, 36'],
  rose: ['#fb7185', '#f43f5e', '251, 113, 133'],
  lime: ['#a3e635', '#84cc16', '163, 230, 53'],
  orange: ['#fb923c', '#f97316', '251, 146, 60'],
  pink: ['#f472b6', '#ec4899', '244, 114, 182'],
  teal: ['#2dd4bf', '#14b8a6', '45, 212, 191'],
  indigo: ['#818cf8', '#6366f1', '129, 140, 248'],
};
const THEMES = [
  ['dark', 'Dark', '#0b0d12', '#141821'],
  ['midnight', 'Midnight', '#000000', '#0c0d10'],
  ['ocean', 'Ocean', '#07131c', '#0d1e2b'],
  ['forest', 'Forest', '#0a120d', '#122017'],
  ['light', 'Light', '#f4f6fa', '#ffffff'],
  ['system', 'Match Windows', null, null],
];
function hexToRgb(hex) {
  const m = String(hex).match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function accentColors(name) {
  if (ACCENTS[name]) return ACCENTS[name];
  const rgb = hexToRgb(name);
  if (!rgb) return ACCENTS.emerald;
  const darker = '#' + rgb.map((v) => Math.round(v * 0.82).toString(16).padStart(2, '0')).join('');
  return [`#${String(name).replace('#', '')}`, darker, rgb.join(', ')];
}
function applyAccent(name) {
  const [a, b, rgb] = accentColors(name);
  const r = document.documentElement.style;
  r.setProperty('--accent', a);
  r.setProperty('--accent-2', b);
  r.setProperty('--accent-soft', `rgba(${rgb}, 0.12)`);
  r.setProperty('--accent-glow', `rgba(${rgb}, 0.28)`);
  const [R, G, B] = rgb.split(',').map(Number);
  // readable text on accent buttons
  r.setProperty('--on-accent', (R * 299 + G * 587 + B * 114) / 1000 > 150 ? '#06130d' : '#ffffff');
}
let systemDark = true;
function resolvedTheme() {
  const t = state.settings?.theme || 'dark';
  return t === 'system' ? (systemDark ? 'dark' : 'light') : t;
}
function applyAppearance() {
  const s = state.settings || {};
  const html = document.documentElement;
  const theme = resolvedTheme();
  html.dataset.theme = theme;
  html.dataset.density = s.density || 'comfortable';
  html.classList.toggle('reduce-motion', !!s.reduceMotion);
  html.classList.toggle('no-glow', s.backgroundGlow === false);
  html.classList.toggle('compact-sidebar', !!s.compactSidebar);
  html.style.setProperty('--console-size', `${s.consoleFontSize || 13}px`);
  html.style.setProperty('--console-wrap', s.consoleWrap === false ? 'pre' : 'pre-wrap');
  applyAccent(s.accent);
  const t = THEMES.find((x) => x[0] === theme) || THEMES[0];
  call('app:titleBar', t[2], theme === 'light' ? '#4b5363' : '#9aa3b2').catch(() => {});
}
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function serverAvatar(s, size = '') {
  if (!s.icon) return loaderBadge(s.loader, size, size ? undefined : s.status);
  return `<div class="loader-badge ${size} has-icon" style="--lc:${LOADERS[s.loader]?.color}"><img src="${s.icon}" alt="" />${size ? '' : `<span class="dot ${s.status}"></span>`}</div>`;
}
const server = (id = state.selected) => state.servers.find((s) => s.id === id);

async function refreshServers() {
  state.servers = await call('servers:list');
  for (const s of state.servers) {
    if (!state.history[s.id]) state.history[s.id] = s.history || [];
    if (s.stats) state.stats[s.id] = s.stats;
    if (s.tpsHistory && s.tpsHistory.length && !state.tps[s.id]) state.tps[s.id] = s.tpsHistory;
  }
  if (state.selected && !server()) { state.selected = null; }
  renderSidebar();
}

const STATUS_ORDER = { online: 0, starting: 1, stopping: 2, crashed: 3, offline: 4, installing: 5, error: 6 };
function sortedServers(list = state.servers) {
  const sort = state.settings?.sidebarSort || 'created';
  const arr = [...list];
  if (sort === 'name') arr.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'status') arr.sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || a.name.localeCompare(b.name));
  else if (sort === 'type') arr.sort((a, b) => a.loader.localeCompare(b.loader) || a.name.localeCompare(b.name));
  return arr.sort((a, b) => (!!b.pinned - !!a.pinned));
}

// ---------- sidebar ----------
function renderSidebar() {
  const sys = state.system;
  const running = state.servers.filter((s) => isRunning(s.status));
  const usedByServers = running.reduce((a, s) => a + (state.stats[s.id]?.mem || 0), 0);
  const q = state.sideQuery.toLowerCase();
  const list = sortedServers().filter((s) => !q || s.name.toLowerCase().includes(q) || (LOADERS[s.loader]?.name || '').toLowerCase().includes(q) || s.mcVersion.includes(q));
  const focused = document.activeElement && document.activeElement.id === 'side-q';
  $('#sidebar').innerHTML = `
    <div class="nav-item ${!state.selected && !state.page ? 'active' : ''}" data-nav="home">${icon('grid', 17)}<span>Dashboard</span><span class="kbd">Ctrl D</span></div>
    <div class="row" style="margin:8px 0 4px;gap:6px">
      <button class="btn primary" style="flex:1" data-new>${icon('plus', 16)} <span class="lbl">New server</span></button>
      <button class="btn icon" title="Import an existing server (Ctrl+I)" data-import>${icon('upload', 16)}</button>
    </div>
    <div class="side-section"><span>Servers</span><span class="row" style="gap:4px">${state.servers.length > 4 ? '' : ''}<button class="btn xs icon ghost" title="Sort servers" data-sort>${icon('list', 13)}</button>${state.servers.length}</span></div>
    ${state.servers.length > 5 ? `<div class="side-search">${icon('search', 13)}<input id="side-q" placeholder="Find a server…" value="${esc(state.sideQuery)}" /></div>` : ''}
    <div class="server-list">
      ${list.map((s) => `
        <div class="nav-item server-item ${state.selected === s.id ? 'active' : ''}" data-server="${esc(s.id)}" title="${esc(s.name)}">
          ${serverAvatar(s)}
          <div class="meta"><div class="name">${s.pinned ? `<span class="pin-star">${icon('star', 11)}</span>` : ''}${esc(s.name)}</div><div class="sub">${s.modpack ? 'Modpack · ' : ''}${esc(LOADERS[s.loader]?.name)} ${esc(s.mcVersion)} · ${s.status === 'online' && (s.players || []).length ? `${s.players.length} online` : esc(STATUS_LABEL[s.status] || s.status)}</div></div>
          ${s.playit?.enabled ? `<span title="playit.gg public address on" style="color:var(--accent)">${icon('globe', 13)}</span>` : ''}
        </div>`).join('') || `<div class="side-empty">${state.servers.length ? 'No servers match.' : 'No servers yet. Create one to get started.'}</div>`}
    </div>
    <div class="side-footer">
      ${sys ? `<div class="sys-meter">
        <div class="row"><span>Servers using</span><span>${fmtBytes(usedByServers)} / ${fmtBytes(sys.totalMem)}</span></div>
        <div class="progress" style="height:5px"><i style="width:${Math.min(100, (usedByServers / sys.totalMem) * 100)}%"></i></div>
        <div class="row" style="margin-top:7px"><span>${running.length} running</span><span>${sys.cpus} CPU threads</span></div>
      </div>` : ''}
      <div class="row" style="gap:4px">
        <div class="nav-item ${state.page === 'settings' ? 'active' : ''}" data-settings style="flex:1">${icon('gear', 17)}<span>Settings</span><span class="kbd">Ctrl ,</span></div>
        <button class="btn icon ghost" title="Command palette (Ctrl+K)" data-palette>${icon('command', 16)}</button>
      </div>
    </div>`;
  $('[data-nav=home]').onclick = () => select(null);
  $('[data-new]').onclick = () => openCreateWizard();
  $('[data-import]').onclick = () => openImportWizard();
  $('[data-settings]').onclick = openAppSettings;
  $('[data-palette]').onclick = () => openPalette();
  $('[data-sort]').onclick = (e) => openMenu(e.currentTarget, [['created', 'Oldest first'], ['name', 'Name'], ['status', 'Running first'], ['type', 'Server type']].map(([k, l]) => ({
    label: `${(state.settings?.sidebarSort || 'created') === k ? '✓ ' : ''}${l}`,
    action: async () => { state.settings = await call('settings:set', { sidebarSort: k }); renderSidebar(); },
  })));
  const sq = $('#side-q');
  if (sq) {
    sq.oninput = () => { state.sideQuery = sq.value; renderSidebar(); };
    if (focused) { sq.focus(); sq.setSelectionRange(sq.value.length, sq.value.length); }
  }
  $$('[data-server]').forEach((el) => {
    el.onclick = () => select(el.dataset.server);
    el.oncontextmenu = (e) => { e.preventDefault(); serverMenu(server(el.dataset.server), el); };
  });
}

/** Right-click / ⋯ menu for a server. */
function serverMenu(s, anchor) {
  if (!s) return;
  const running = isRunning(s.status);
  const ready = !['installing', 'error'].includes(s.status);
  openMenu(anchor, [
    { label: 'Open', icon: 'right', action: () => select(s.id) },
    ...(ready ? [running ? { label: 'Stop', icon: 'stop', action: () => serverAction(s.id, 'stop') } : { label: 'Start', icon: 'play', action: () => serverAction(s.id, 'start') }] : []),
    { label: s.pinned ? 'Unpin from top' : 'Pin to top', icon: 'star', action: async () => { await call('servers:update', s.id, { pinned: !s.pinned }); await refreshServers(); if (!state.selected && !state.page) renderMain(); } },
    { label: 'Rename', icon: 'edit', action: async () => { const n = await promptDialog({ title: 'Rename server', value: s.name }); if (n && n.trim()) { await call('servers:update', s.id, { name: n.trim().slice(0, 48) }); await refreshServers(); renderMain(); } } },
    '-',
    { label: 'Open folder', icon: 'folder', action: () => call('servers:openFolder', s.id) },
    { label: 'Duplicate', icon: 'copy', disabled: running || !ready, action: () => duplicateServer(s) },
    { label: 'Export as .zip', icon: 'download', disabled: !ready, action: () => exportServer(s) },
    '-',
    { label: 'Delete', icon: 'trash', danger: true, disabled: running, action: () => deleteServer(s) },
  ]);
}

async function duplicateServer(s) {
  const name = `${s.name} (copy)`;
  if (!(await confirmDialog({ title: 'Duplicate server?', message: `Creates "${name}" with a copy of this server's world, ${contentLabel(s.loader).toLowerCase()} and settings (backups and logs aren't copied). It gets its own port.`, confirm: 'Duplicate' }))) return;
  try { const id = await call('servers:clone', s.id, name); toast(`Created ${name}`, 'success'); await refreshServers(); select(id); } catch (e) { fail(e); }
}
async function exportServer(s) {
  toast('Packing the server… big worlds can take a minute.', 'info', 3000);
  try { const f = await call('servers:export', s.id); if (f) toast(`Exported to ${f}`, 'success', 6000); } catch (e) { fail(e); }
}

async function select(id, tab = 'overview') {
  state.selected = id;
  state.page = null;
  state.tab = tab;
  state.files = { path: '' };
  state.consoleFilter = { text: '', level: 'all' };
  state.mods = { ...state.mods, sub: 'installed', kind: null, hits: [], installed: [], updates: null, offset: 0, query: '', category: '' };
  if (id && !state.logs[id]) {
    try { state.logs[id] = await call('servers:logs', id); } catch { state.logs[id] = []; }
  }
  if (id) call('settings:set', { lastServer: id }).then((s) => (state.settings = s)).catch(() => {});
  renderSidebar();
  renderMain();
}

// ---------- main ----------
function renderMain() {
  const main = $('#main');
  main.scrollTop = 0;
  if (state.page === 'settings') return renderAppSettings(main);
  if (!state.selected) return renderHome(main);
  const s = server();
  if (!s) return renderHome(main);
  main.innerHTML = `<div class="page">
    <div class="page-header" id="srv-header"></div>
    <div id="srv-body"></div>
  </div>`;
  renderHeader();
  renderBody();
}

function addressFor(s) {
  if (s.playit?.enabled && s.playit.address) return s.playit.address;
  return isBedrock(s) ? `${s.lan || 'localhost'}:${s.port}` : `localhost${s.port === 25565 ? '' : ':' + s.port}`;
}

function renderHeader() {
  const s = server();
  const el = $('#srv-header');
  if (!s || !el) return;
  const l = LOADERS[s.loader];
  const running = isRunning(s.status);
  const ready = !['installing', 'error'].includes(s.status);
  const build = s.loaderVersion && hasBuilds(s.loader) ? (/^\d+$/.test(s.loaderVersion) ? `build ${s.loaderVersion}` : s.loaderVersion.replace(s.mcVersion + '-', '')) : '';
  el.innerHTML = `
    ${serverAvatar(s, 'lg')}
    <div style="min-width:0">
      <h1>${s.pinned ? `<span class="pin-star big">${icon('star', 15)}</span>` : ''}${esc(s.name)}</h1>
      <div class="subtitle">${statusPill(s.status)}<span>${s.modpack ? `${esc(s.modpack.title)} · ` : ''}${esc(l.name)} ${esc(s.mcVersion)}${build ? ` · <span class="dim">${esc(build)}</span>` : ''}</span>
        <span class="dim">·</span><span class="mono small selectable">${isBedrock(s) ? `port ${s.port}` : `localhost:${s.port}`}</span>
        ${s.playit?.enabled && s.playit.address ? `<span class="dim">·</span><span class="chip accent mono" style="cursor:pointer" title="Copy public address" data-copy-addr="${esc(s.playit.address)}">${icon('globe', 12)} ${esc(s.playit.address)}</span>` : ''}
        ${s.proxiedBy && server(s.proxiedBy) ? `<span class="dim">·</span><span class="chip" title="Players join through this proxy">${icon('network', 12)} via ${esc(server(s.proxiedBy).name)}</span>` : ''}</div>
    </div>
    <div class="spacer"></div>
    <button class="btn icon" title="More" data-more>${icon('more', 17)}</button>
    <button class="btn icon" title="Open server folder" data-act="folder">${icon('folder', 17)}</button>
    ${ready ? (running ? `
      <button class="btn" data-act="restart" ${s.status !== 'online' ? 'disabled' : ''}>${icon('restart', 16)} Restart</button>
      ${s.status === 'stopping' ? `<button class="btn danger" data-act="kill">${icon('zap', 16)} Force stop</button>` : `<button class="btn danger" data-act="stop">${icon('stop', 15)} Stop</button>`}
    ` : `<button class="btn primary lg" data-act="start">${icon('play', 16)} Start server</button>`) : ''}`;
  $$('[data-act]', el).forEach((b) => (b.onclick = () => serverAction(s.id, b.dataset.act)));
  $('[data-more]', el).onclick = (e) => {
    const r = isRunning(s.status);
    openMenu(e.currentTarget, [
      { label: 'Copy join address', icon: 'copy', action: () => { navigator.clipboard.writeText(addressFor(s)); toast(`Copied ${addressFor(s)}`, 'success', 1800); } },
      ...(r && s.status === 'online' ? [
        { label: 'Restart in 1 minute (warn players)', icon: 'clock', action: () => call('servers:countdown', s.id, 60, 'restart').then(() => toast('Players were warned. Restarting in 60 seconds.', 'info')) },
        { label: 'Stop in 1 minute (warn players)', icon: 'clock', action: () => call('servers:countdown', s.id, 60, 'stop').then(() => toast('Players were warned. Stopping in 60 seconds.', 'info')) },
      ] : []),
      { label: s.pinned ? 'Unpin from top' : 'Pin to top', icon: 'star', action: async () => { await call('servers:update', s.id, { pinned: !s.pinned }); await refreshServers(); renderHeader(); } },
      '-',
      { label: 'Duplicate server', icon: 'copy', disabled: r || !ready, action: () => duplicateServer(s) },
      { label: 'Export as .zip', icon: 'download', disabled: !ready, action: () => exportServer(s) },
      { label: 'Log files', icon: 'file', action: () => openLogsBrowser(s) },
      '-',
      { label: 'Delete server', icon: 'trash', danger: true, disabled: r, action: () => deleteServer(s) },
    ]);
  };
  const ca = $('[data-copy-addr]', el);
  if (ca) ca.onclick = () => { navigator.clipboard.writeText(ca.dataset.copyAddr); toast('Copied ' + ca.dataset.copyAddr, 'success', 1800); };
}

async function serverAction(id, act) {
  try {
    if (act === 'folder') return call('servers:openFolder', id);
    if (act === 'kill' && !(await confirmDialog({ title: 'Force stop?', message: 'This kills the server process immediately. Unsaved world changes may be lost.', confirm: 'Force stop', danger: true }))) return;
    const s = server(id);
    const online = s && (s.players || []).length;
    if ((act === 'stop' || act === 'restart') && online && state.settings?.confirmStop &&
      !(await confirmDialog({ title: `${act === 'stop' ? 'Stop' : 'Restart'} ${s.name}?`, message: `${online} player${online > 1 ? 's are' : ' is'} online: ${s.players.join(', ')}. They will be disconnected.`, confirm: act === 'stop' ? 'Stop anyway' : 'Restart anyway', danger: true }))) return;
    await call(`servers:${act}`, id);
    if (act === 'start' && state.selected === id && state.tab !== 'console' && state.tab !== 'overview') switchTab('console');
  } catch (e) { fail(e); }
}

function tabsFor(s) {
  const tabs = [['overview', 'activity', 'Overview'], ['console', 'terminal', 'Console'], ['mods', isBedrock(s) ? 'layers' : 'puzzle', contentLabel(s.loader)]];
  if (isProxy(s)) tabs.push(['network', 'network', 'Network']);
  else tabs.push(['worlds', 'world', 'Worlds']);
  tabs.push(['players', 'users', 'Players'], ['files', 'folder', 'Files'], ['backups', 'archive', 'Backups'], ['schedule', 'calendar', 'Schedule'], ['settings', 'sliders', 'Settings']);
  return tabs;
}

const TAB_RENDER = () => ({ overview: renderOverview, console: renderConsole, mods: renderMods, worlds: renderWorlds, network: renderNetwork, players: renderPlayers, files: renderFiles, backups: renderBackups, schedule: renderSchedule, settings: renderSettings });

function renderBody() {
  const s = server();
  const body = $('#srv-body');
  if (!body || !s) return;
  if (s.status === 'installing' || s.status === 'error') return renderInstallState(body, s);
  const tabs = tabsFor(s);
  if (!tabs.some((t) => t[0] === state.tab)) state.tab = 'overview';
  body.innerHTML = `<div class="tabs">${tabs.map(([k, ic, label], i) => `<div class="tab ${state.tab === k ? 'active' : ''}" data-tab="${k}" title="Ctrl+${i + 1}">${icon(ic, 16)}<span>${label}</span></div>`).join('')}</div><div id="tab-body"></div>`;
  $$('[data-tab]', body).forEach((t) => (t.onclick = () => switchTab(t.dataset.tab)));
  const tb = $('#tab-body');
  TAB_RENDER()[state.tab](tb, s);
}

function switchTab(tab) {
  state.tab = tab;
  renderBody();
}

// ---------- install state ----------
function renderInstallState(body, s) {
  const p = state.progress[s.id] || {};
  if (s.status === 'error') {
    body.innerHTML = `<div class="card" style="max-width:720px">
      <div class="banner danger">${icon('alert', 18)}<div class="grow"><b>Installation failed</b><div class="selectable" style="white-space:pre-wrap;margin-top:4px">${esc(s.installError || 'Unknown error')}</div></div></div>
      <div class="row"><button class="btn primary" data-retry>${icon('restart', 16)} Retry install</button><button class="btn danger" data-del>${icon('trash', 16)} Delete server</button></div>
    </div>`;
    $('[data-retry]', body).onclick = () => call('servers:reinstall', s.id).catch(fail);
    $('[data-del]', body).onclick = () => deleteServer(s);
    return;
  }
  body.innerHTML = `<div class="card" style="max-width:720px">
    <div class="card-title">${icon('download', 16)} Installing ${esc(LOADERS[s.loader].name)} ${esc(s.mcVersion)}</div>
    ${progressBlock(p)}
  </div>`;
}

function progressBlock(p) {
  const pct = p.pct == null ? null : Math.round(p.pct * 100);
  return `<div class="row" style="margin-bottom:10px"><span id="prog-step" style="flex:1">${esc(p.step || 'Preparing…')}</span><span class="muted small" id="prog-detail">${esc(p.detail || '')}${pct != null ? ` · ${pct}%` : ''}</span></div>
    <div class="progress ${pct == null ? 'indeterminate' : ''}" id="prog-bar"><i style="width:${pct || 0}%"></i></div>
    <div class="console install-log" id="prog-log">${(p.logs || []).map((l) => esc(l)).join('\n')}</div>`;
}

function updateProgressUI(p) {
  const step = $('#prog-step');
  if (!step) return;
  step.textContent = p.step || 'Working…';
  const pct = p.pct == null ? null : Math.round(p.pct * 100);
  $('#prog-detail').textContent = `${p.detail || ''}${pct != null ? ` · ${pct}%` : ''}`;
  const bar = $('#prog-bar');
  bar.classList.toggle('indeterminate', pct == null);
  $('i', bar).style.width = `${pct || 0}%`;
  const log = $('#prog-log');
  log.textContent = (p.logs || []).join('\n');
  log.scrollTop = log.scrollHeight;
}

// ---------- overview ----------
const EVENT_ICON = { start: ['play', '#fbbf24'], online: ['check', '#34d399'], stop: ['stop', '#8d96a7'], crash: ['alert', '#f87171'], join: ['users', '#60a5fa'], leave: ['kick', '#a78bfa'], backup: ['archive', '#fbbf24'], restart: ['restart', '#38bdf8'], task: ['calendar', '#2dd4bf'], install: ['download', '#34d399'], update: ['update', '#34d399'], world: ['world', '#f472b6'] };
const tpsSupported = (s) => isJavaGame(s) && state.settings?.tpsMonitor !== false;

function renderOverview(tb, s) {
  const st = state.stats[s.id] || {};
  const showTps = tpsSupported(s);
  tb.innerHTML = `
    ${crashBanner(s)}
    ${s.proxiedBy ? `<div class="banner info">${icon('network', 18)}<div class="grow">This server is part of the <b>${esc(server(s.proxiedBy)?.name || 'proxy')}</b> network. Players join through the proxy, not directly.</div></div>` : ''}
    <div class="grid g-stats" style="margin-bottom:16px">
      ${statCard('status', 'activity', 'Status', '#34d399')}
      ${statCard('cpu', 'cpu', 'CPU', '#60a5fa')}
      ${statCard('mem', 'memory', 'Memory', '#a78bfa')}
      ${statCard('players', 'users', 'Players', '#fbbf24')}
      ${showTps ? statCard('tps', 'gauge', 'TPS', '#2dd4bf') : ''}
      ${!isProxy(s) ? statCard('world', 'disk', 'World size', '#f472b6') : ''}
    </div>
    <div class="grid g-main">
      <div class="grid" style="align-content:start">
        <div class="grid g-2">
          ${chartCard('cpu', 'CPU usage')}
          ${chartCard('mem', 'Memory usage')}
        </div>
        <div class="grid ${showTps ? 'g-2' : ''}">
          ${chartCard('players', 'Players online')}
          ${showTps ? chartCard('tps', 'Ticks per second') : ''}
        </div>
        <div class="card">
          <div class="card-title">${icon('terminal', 16)} Live console<span class="right"><a data-open-console>Open console →</a></span></div>
          <div class="console" id="mini-console" style="height:180px"></div>
        </div>
      </div>
      <div class="grid" style="align-content:start">
        <div class="card">
          <div class="card-title">${icon('globe', 16)} Connect</div>
          <div id="connect-box">${connectBox(s)}</div>
          <div id="playit-connect"></div>
        </div>
        ${!isProxy(s) ? `<div class="card"><div class="card-title">${icon('list', 16)} Server list preview</div>${motdPreview(s)}</div>` : ''}
        <div class="card" id="players-card"></div>
        <div class="card">
          <div class="card-title">${icon('history', 16)} Activity<span class="right"><a data-all-events>See all</a></span></div>
          <div id="activity" class="activity"><div class="skeleton" style="height:80px"></div></div>
        </div>
        <div class="card">
          <div class="card-title">${icon('info', 16)} Server info</div>
          <div class="kv">
            ${s.modpack ? `<div class="k">Modpack</div><div class="v"><a data-pack-url="${esc(s.modpack.url || '')}">${esc(s.modpack.title)} ${esc(s.modpack.versionName || '')}</a></div>` : ''}
            <div class="k">Type</div><div class="v">${esc(LOADERS[s.loader].name)}</div>
            <div class="k">${versionLabel(s.loader).replace(' version', '')}</div><div class="v">${esc(s.mcVersion)}</div>
            ${hasBuilds(s.loader) ? `<div class="k">${buildLabel(s.loader).replace(/ (build|version)$/, '')} ${/build/.test(buildLabel(s.loader)) ? 'build' : 'version'}</div><div class="v">${esc(s.loaderVersion || '—')}</div>` : ''}
            ${!isBedrock(s) ? `<div class="k">Allocated RAM</div><div class="v">${fmtBytes(s.memoryMB * 1048576)}</div>
            <div class="k">Java</div><div class="v" id="java-info">${s.javaOverride ? `Java ${s.javaOverride} (manual)` : s.javaFeature ? `Java ${s.javaFeature}` : '—'}</div>` : ''}
            ${!isProxy(s) ? `<div class="k">World</div><div class="v">${esc(s.levelName || '—')}</div>` : ''}
            <div class="k">Max players</div><div class="v">${s.maxPlayers}</div>
            ${s.imported ? `<div class="k">Imported</div><div class="v" title="${esc(s.imported.from)}">${ago(s.imported.at)}</div>` : ''}
            <div class="k">Created</div><div class="v">${new Date(s.createdAt).toLocaleDateString()}</div>
          </div>
          ${s.notes ? `<div class="notes selectable">${esc(s.notes)}</div>` : ''}
        </div>
      </div>
    </div>`;
  bindCopy(tb);
  $('[data-open-console]', tb).onclick = () => switchTab('console');
  $('[data-all-events]', tb).onclick = () => openEvents(s);
  const pu = $('[data-pack-url]', tb);
  if (pu && pu.dataset.packUrl) pu.onclick = () => call('shell:open', pu.dataset.packUrl).catch(fail);
  bindCrashBanner(tb, s);
  bindConnect(tb, s);
  const mc = $('#mini-console');
  (state.logs[s.id] || []).slice(-60).forEach((e) => mc.appendChild(logLine(e)));
  mc.scrollTop = mc.scrollHeight;
  updateStatsUI(s.id, st);
  renderPlayersCard(s);
  renderPlayitConnect($('#playit-connect'), s);
  loadActivity(s);
  if (showTps && s.status === 'online') pollTps(s.id);
}

function bindCopy(root) {
  $$('[data-copy]', root).forEach((b) => (b.onclick = () => { navigator.clipboard.writeText(b.dataset.copy); toast('Copied ' + b.dataset.copy, 'success', 1800); }));
}

function connectBox(s) {
  if (isBedrock(s)) {
    return `${addressRow('Same Wi-Fi / LAN · server address', s.lan || '—')}
      ${addressRow('Port', String(s.port))}
      <div class="dim small" style="margin:4px 0 8px">In Minecraft: Play → Servers → Add Server, then enter the address and port. Devices on the same Wi-Fi may also see it under Friends → LAN Games.</div>
      <details class="hint-box"><summary>Playing on this PC and the server doesn't show up?</summary>
        <div class="dim small" style="margin-top:6px">Older versions of Minecraft for Windows can't connect to servers on the same PC. Use your LAN address above, or run this once in an admin PowerShell window:</div>
        ${addressRow('Admin PowerShell', 'CheckNetIsolation.exe LoopbackExempt -a -n="Microsoft.MinecraftUWP_8wekyb3d8bbwe"')}
      </details>`;
  }
  const g = s.geyser && s.geyser.enabled && s.geyser.port;
  return `${addressRow('This computer', `localhost${s.port === 25565 ? '' : ':' + s.port}`)}
    ${s.lan ? addressRow('Same Wi-Fi / LAN', `${s.lan}${s.port === 25565 ? '' : ':' + s.port}`) : ''}
    ${g ? addressRow('Bedrock players (Geyser) · LAN address and port', `${s.lan || 'localhost'} port ${s.geyser.port}`) : ''}
    <div class="row" style="margin:2px 0 6px"><button class="btn xs ghost" data-public-ip>${icon('globe', 13)} Show my public IP</button><span class="dim small" id="pub-ip"></span></div>`;
}
function bindConnect(root, s) {
  bindCopy(root);
  const b = $('[data-public-ip]', root);
  if (b) b.onclick = async () => {
    b.disabled = true;
    try {
      const ip = await call('system:publicIp');
      $('#pub-ip', root).innerHTML = `<span class="mono selectable">${esc(ip)}:${s.port}</span> · only works for friends if port ${s.port} is forwarded on your router. playit.gg below needs no setup.`;
    } catch (e) { fail(e); b.disabled = false; }
  };
}

function motdPreview(s) {
  const motd = isBedrock(s) ? esc(s.motd || s.name) : mcFormat(String(s.motd || 'A Minecraft Server').replace(/<[^>]+>/g, ''));
  const lines = motd.split(/\n|\\n/);
  const st = state.stats[s.id] || {};
  return `<div class="mc-entry">
    <div class="mc-icon">${s.icon ? `<img src="${s.icon}" />` : `<div class="mc-noicon">${icon(s.loader, 26)}</div>`}</div>
    <div class="mc-text"><div class="mc-name">${esc(s.name)}</div><div class="mc-motd">${lines.slice(0, 2).join('<br>')}</div></div>
    <div class="mc-right"><span>${isRunning(s.status) ? st.players ?? 0 : 0}/${s.maxPlayers}</span><span class="mc-bars ${s.status === 'online' ? 'on' : ''}"><i></i><i></i><i></i><i></i><i></i></span></div>
  </div>
  <div class="dim small" style="margin-top:8px">Change the message and icon in Settings.</div>`;
}

async function loadActivity(s) {
  try { state.events[s.id] = await call('servers:events', s.id); } catch { state.events[s.id] = []; }
  drawActivity(s);
}
function eventRow(e) {
  const [ic, c] = EVENT_ICON[e.type] || ['info', '#8d96a7'];
  return `<div class="ev"><span class="ev-ic" style="color:${c};background:${c}1a">${icon(ic, 13)}</span><span class="ev-t">${esc(e.text)}</span><span class="ev-time" title="${new Date(e.t).toLocaleString()}">${ago(e.t)}</span></div>`;
}
function drawActivity(s) {
  const el = $('#activity');
  if (!el || state.selected !== s.id) return;
  const list = (state.events[s.id] || []).slice(0, 7);
  el.innerHTML = list.length ? list.map(eventRow).join('') : '<div class="dim small">Nothing yet. Starts, stops, players and backups show up here.</div>';
}
function openEvents(s) {
  const list = state.events[s.id] || [];
  const m = modal({
    title: `<div class="mod-icon sm">${icon('history', 15)}</div><div><h2>Activity</h2><div class="dim small">${esc(s.name)} · last ${list.length} events</div></div>`,
    body: `<div class="activity big">${list.map(eventRow).join('') || '<div class="dim">No activity yet.</div>'}</div>`,
    foot: `<button class="btn ghost" data-clear-ev>${icon('trash', 14)} Clear</button><div class="spacer"></div><button class="btn" data-x>Close</button>`,
  });
  $('[data-x]', m.el).onclick = () => m.close();
  $('[data-clear-ev]', m.el).onclick = async () => { await call('servers:clearEvents', s.id); state.events[s.id] = []; m.close(); drawActivity(s); };
}

let tpsTimer = null;
function pollTps(id) {
  clearTimeout(tpsTimer);
  const tick = async () => {
    const s = server(id);
    if (!s || state.selected !== id || state.tab !== 'overview' || s.status !== 'online' || state.page) return;
    try { await call('servers:tps', id); } catch {}
    tpsTimer = setTimeout(tick, 10000);
  };
  tpsTimer = setTimeout(tick, 1500);
}

// ---------- crash helper ----------
function crashBanner(s) {
  if (s.status !== 'crashed' || !s.crash) return '';
  const c = s.crash;
  return `<div class="banner danger crash-banner">${icon('alert', 20)}<div class="grow">
      <b style="font-size:14px">${esc(s.name)} crashed</b>
      ${c.hints.length ? `<ul class="hints">${c.hints.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : `<div style="margin-top:4px">No known cause was detected. The error lines below usually explain what happened.</div>`}
      ${c.errorLines.length ? `<pre class="crash-lines selectable">${c.errorLines.map(esc).join('\n')}</pre>` : ''}
      <div class="row wrap" style="margin-top:10px">
        ${c.report ? `<button class="btn sm" data-crash-report>${icon('external', 14)} Open crash report</button>` : ''}
        <button class="btn sm" data-crash-console>${icon('terminal', 14)} View full console</button>
        <button class="btn sm" data-crash-logs>${icon('share', 14)} Share log for help</button>
        <button class="btn sm primary" data-crash-start>${icon('play', 14)} Try again</button>
        <button class="btn sm ghost" data-crash-dismiss>Dismiss</button>
      </div></div></div>`;
}
function bindCrashBanner(root, s) {
  const b = (sel, fn) => { const el = $(sel, root); if (el) el.onclick = fn; };
  b('[data-crash-report]', () => call('servers:openPath', s.id, s.crash.report).catch(fail));
  b('[data-crash-console]', () => switchTab('console'));
  b('[data-crash-logs]', () => shareText((state.logs[s.id] || []).filter((e) => e.t >= (s.crash?.time || 0) - 3600000).map((e) => e.line).join('\n'), `${s.name} crash log`));
  b('[data-crash-start]', () => serverAction(s.id, 'start'));
  b('[data-crash-dismiss]', async () => { await call('servers:clearCrash', s.id); s.crash = null; $('.crash-banner', root)?.remove(); });
}

const statCard = (key, ic, label, glow) => `<div class="card stat" style="--glow:${glow}33"><div class="label">${icon(ic, 14)} ${label}</div><div class="value" id="st-${key}">—</div><div class="bar" ${key === 'status' || key === 'world' ? 'style="visibility:hidden"' : ''}><i id="stb-${key}" style="background:${glow}"></i></div><div class="foot" id="stf-${key}"></div></div>`;
const chartCard = (key, title) => `<div class="card chart-card"><div class="chart-head"><span class="title">${title}</span><span class="now" id="cn-${key}">—</span></div><canvas class="chart" id="ch-${key}"></canvas></div>`;
const addressRow = (label, val) => `<div class="address"><div style="flex:1;min-width:0"><div class="lbl">${label}</div><div class="val selectable">${esc(val)}</div></div><button class="btn sm icon ghost" title="Copy" data-copy="${esc(val)}">${icon('copy', 15)}</button></div>`;
const head = (name, size = 32) => `<img class="head" src="https://mc-heads.net/avatar/${encodeURIComponent(name)}/${size}" alt="" loading="lazy" />`;

function renderPlayersCard(s) {
  const el = $('#players-card');
  if (!el) return;
  const players = s.players || [];
  el.innerHTML = `<div class="card-title">${icon('users', 16)} Online now<span class="right">${players.length}${s.maxPlayers ? ` / ${s.maxPlayers}` : ''}</span></div>
    ${players.length ? `<div class="grid" style="gap:8px">${players.map((p) => `<div class="player">${head(p)}<span class="n">${esc(p)}</span></div>`).join('')}</div>`
      : `<div class="dim small">${isRunning(s.status) ? 'Nobody is online right now.' : 'Start the server to see who is playing.'}</div>`}`;
}

const tpsColor = (t) => (t == null ? 'var(--dim)' : t >= 19 ? '#34d399' : t >= 15 ? '#fbbf24' : '#f87171');

function updateStatsUI(id, st) {
  if (id !== state.selected || state.tab !== 'overview') return;
  const s = server(id);
  if (!s || !$('#st-status')) return;
  const running = isRunning(s.status);
  const set = (k, v, foot, pct) => {
    const el = $('#st-' + k); if (el) el.innerHTML = v;
    const f = $('#stf-' + k); if (f && foot != null) f.textContent = foot;
    const b = $('#stb-' + k); if (b && pct != null) b.style.width = Math.max(0, Math.min(100, pct)) + '%';
  };
  set('status', STATUS_LABEL[s.status], running && st.uptime ? `Uptime ${fmtDur(st.uptime)}` : s.status === 'crashed' ? 'Check the console for details' : 'Not running');
  if (running && st.mem != null) {
    set('cpu', `${(st.cpu || 0).toFixed(1)}<small>%</small>`, `of ${state.system?.cpus || '?'} threads`, st.cpu);
    const memGB = st.mem / 1073741824;
    set('mem', `${memGB.toFixed(2)}<small>GB</small>`, st.memMax ? `of ${fmtBytes(st.memMax)} allocated` : 'in use', st.memMax ? (st.mem / st.memMax) * 100 : Math.min(100, (st.mem / (state.system?.totalMem || 1)) * 100 * 4));
    set('players', `${st.players ?? 0}<small>/ ${st.maxPlayers ?? s.maxPlayers}</small>`, st.latency != null ? `Ping ${st.latency} ms` : s.status === 'online' ? 'Online' : 'Waiting for server…', ((st.players || 0) / (st.maxPlayers || s.maxPlayers || 20)) * 100);
  } else {
    set('cpu', '—', 'Offline', 0);
    set('mem', '—', isBedrock(s) ? 'Offline' : `${fmtBytes(s.memoryMB * 1048576)} allocated`, 0);
    set('players', `0<small>/ ${s.maxPlayers}</small>`, 'Offline', 0);
  }
  const th = state.tps[id] || [];
  const lastTps = th[th.length - 1];
  if ($('#st-tps')) {
    if (running && lastTps && lastTps.tps != null) {
      set('tps', `<span style="color:${tpsColor(lastTps.tps)}">${lastTps.tps.toFixed(1)}</span>`, lastTps.mspt != null ? `${lastTps.mspt.toFixed(1)} ms per tick · 20 is perfect` : '20 is perfect', (lastTps.tps / 20) * 100);
      const b = $('#stb-tps'); if (b) b.style.background = tpsColor(lastTps.tps);
    } else set('tps', '—', running ? (s.status === 'online' ? 'Measuring…' : 'Waiting for server…') : 'Offline', 0);
  }
  set('world', s.worldSize ? fmtBytes(s.worldSize).replace(/ (\w+)$/, '<small>$1</small>') : '—', s.worldSize ? (isBedrock(s) ? s.levelName : 'Overworld, Nether & End') : 'Created on first start');

  const h = state.history[id] || [];
  const memMax = st.memMax || (isBedrock(s) ? Math.max(1073741824, ...h.map((p) => p.mem * 1.3)) : (s.memoryMB || 1024) * 1048576);
  drawChart($('#ch-cpu'), h.map((p) => p.cpu), { color: '#60a5fa', max: Math.max(25, ...h.map((p) => p.cpu * 1.2)), fmt: (v) => v.toFixed(0) + '%' });
  drawChart($('#ch-mem'), h.map((p) => p.mem), { color: '#a78bfa', max: memMax, fmt: (v) => (v / 1073741824).toFixed(1) + ' GB' });
  drawChart($('#ch-players'), h.map((p) => p.players), { color: '#fbbf24', max: Math.max(4, ...h.map((p) => p.players + 1)), fmt: (v) => Math.round(v), step: true });
  if ($('#ch-tps')) drawChart($('#ch-tps'), th.map((p) => p.tps || 0), { color: '#2dd4bf', max: 20, fmt: (v) => v.toFixed(0), points: 60, span: '10 min ago' });
  const last = h[h.length - 1];
  const cn = (k, v) => { const e = $('#cn-' + k); if (e) e.innerHTML = v; };
  cn('cpu', running && last ? `${last.cpu.toFixed(1)}<small> %</small>` : '—');
  cn('mem', running && last ? `${(last.mem / 1073741824).toFixed(2)}<small> GB</small>` : '—');
  cn('players', running && last ? `${last.players}` : '—');
  cn('tps', running && lastTps && lastTps.tps != null ? `${lastTps.tps.toFixed(1)}` : '—');
}

function drawChart(canvas, values, { color, max = 100, fmt = String, step = false, points = 180, span = '6 min ago' }) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const padL = 0, padR = 0, padT = 8, padB = 18;
  const ch = h - padT - padB;
  const grid = cssVar('--chart-grid') || 'rgba(255,255,255,0.05)';
  const label = cssVar('--chart-label') || '#5f6879';
  ctx.font = '11px "Segoe UI", sans-serif';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 3; i++) {
    const y = padT + (ch * i) / 3;
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.setLineDash(i === 3 ? [] : [3, 4]);
    ctx.beginPath(); ctx.moveTo(padL, Math.round(y) + 0.5); ctx.lineTo(w - padR, Math.round(y) + 0.5); ctx.stroke();
    if (i < 3) { ctx.fillStyle = label; ctx.fillText(fmt(max * (1 - i / 3)), padL + 2, y + 9); }
  }
  ctx.setLineDash([]);
  ctx.fillStyle = label;
  ctx.fillText(span, padL + 2, h - 7);
  const nowW = ctx.measureText('now').width;
  ctx.fillText('now', w - padR - nowW - 2, h - 7);
  if (values.length < 2) return;
  const N = points;
  const vals = values.slice(-N);
  const dx = (w - padL - padR) / (N - 1);
  const x0 = w - padR - (vals.length - 1) * dx;
  const yOf = (v) => padT + ch - (Math.min(v, max) / max) * ch;
  ctx.beginPath();
  vals.forEach((v, i) => {
    const x = x0 + i * dx, y = yOf(v);
    if (i === 0) ctx.moveTo(x, y);
    else if (step) { ctx.lineTo(x, yOf(vals[i - 1])); ctx.lineTo(x, y); }
    else ctx.lineTo(x, y);
  });
  const grad = ctx.createLinearGradient(0, padT, 0, padT + ch);
  grad.addColorStop(0, color + '55');
  grad.addColorStop(1, color + '00');
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.lineTo(x0 + (vals.length - 1) * dx, padT + ch);
  ctx.lineTo(x0, padT + ch);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  const lx = x0 + (vals.length - 1) * dx, ly = yOf(vals[vals.length - 1]);
  ctx.beginPath(); ctx.arc(lx - 1, ly, 3.5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
  ctx.beginPath(); ctx.arc(lx - 1, ly, 7, 0, Math.PI * 2); ctx.fillStyle = color + '33'; ctx.fill();
}

// ---------- console ----------
function classify(e) {
  if (e.kind === 'system') return 'l-system';
  if (e.kind === 'input') return 'l-input';
  if (e.kind === 'error') return 'l-error';
  const l = e.line;
  if (/\b(ERROR|FATAL|SEVERE)\b|Exception|^\s+at /.test(l)) return 'l-error';
  if (/\bWARN(ING)?\b/.test(l)) return 'l-warn';
  if (e.kind === 'err') return 'l-dim';
  return '';
}
function logLine(e) {
  const d = document.createElement('div');
  const c = classify(e);
  if (c) d.className = c;
  let text = e.line;
  if (state.settings?.consoleTimestamps && !/^\[?(\d{4}-\d{2}-\d{2} )?\d{2}:\d{2}:\d{2}/.test(stripCodes(text))) {
    const t = new Date(e.t);
    text = `[${pad2(t.getHours())}:${pad2(t.getMinutes())}:${pad2(t.getSeconds())}] ${text}`;
  }
  if (state.settings?.consoleColors !== false && /§|\x1b\[/.test(text)) d.innerHTML = mcFormat(text);
  else d.textContent = text.replace(ANSI, '');
  return d;
}
function logMatches(e) {
  const f = state.consoleFilter;
  if (f.text && !e.line.toLowerCase().includes(f.text.toLowerCase())) return false;
  if (f.level === 'all') return true;
  const c = classify(e);
  if (f.level === 'error') return c === 'l-error';
  if (f.level === 'warn') return c === 'l-error' || c === 'l-warn';
  if (f.level === 'chat') return /<[A-Za-z0-9_.]{1,17}> |joined the game|left the game|\[Server\]|\[Not Secure\]|Player (?:dis)?connected/.test(e.line);
  return true;
}

const JAVA_COMMANDS = ['list', 'say ', 'tell ', 'op ', 'deop ', 'kick ', 'ban ', 'ban-ip ', 'pardon ', 'whitelist add ', 'whitelist remove ', 'whitelist on', 'whitelist off', 'gamemode survival ', 'gamemode creative ', 'gamemode adventure ', 'gamemode spectator ', 'tp ', 'give ', 'effect give ', 'time set day', 'time set night', 'time set noon', 'weather clear', 'weather rain', 'weather thunder', 'difficulty ', 'gamerule ', 'save-all', 'seed', 'tps', 'mspt', 'plugins', 'version', 'worldborder set ', 'xp add ', 'kill ', 'setworldspawn', 'spawnpoint ', 'stop'];
const BEDROCK_COMMANDS = ['list', 'say ', 'tell ', 'op ', 'deop ', 'kick ', 'allowlist add ', 'allowlist remove ', 'allowlist on', 'allowlist off', 'gamemode survival ', 'gamemode creative ', 'gamerule ', 'time set day', 'time set night', 'weather clear', 'weather rain', 'difficulty ', 'tp ', 'give ', 'save hold', 'save resume', 'reload', 'stop'];
const VELOCITY_COMMANDS = ['velocity info', 'velocity plugins', 'velocity dump', 'velocity reload', 'glist', 'glist all', 'send ', 'server ', 'shutdown'];
const commandsFor = (s) => (isBedrock(s) ? BEDROCK_COMMANDS : isProxy(s) ? VELOCITY_COMMANDS : JAVA_COMMANDS);
function defaultQuick(s) {
  if (isBedrock(s)) return [['list', 'Players'], ['time set day', 'Day'], ['weather clear', 'Clear weather'], ['gamerule keepinventory true', 'Keep inventory']];
  if (isProxy(s)) return [['glist all', 'Players'], ['velocity info', 'Info'], ['velocity plugins', 'Plugins'], ['velocity reload', 'Reload config']];
  if (isBukkit(s)) return [['list', 'Players'], ['tps', 'TPS'], ['save-all', 'Save world'], ['time set day', 'Day'], ['weather clear', 'Clear weather'], ['plugins', 'Plugins']];
  return [['list', 'Players'], ['save-all', 'Save world'], ['time set day', 'Day'], ['weather clear', 'Clear weather'], ['difficulty', 'Difficulty'], ['seed', 'Seed']];
}
const quickFor = (s) => (s.quickCommands && s.quickCommands.length ? s.quickCommands.map((q) => [q.command, q.label || q.command]) : defaultQuick(s));

const cmdHistory = [];
function renderConsole(tb, s) {
  const running = isRunning(s.status);
  const f = state.consoleFilter;
  const quick = quickFor(s);
  const COMMANDS = commandsFor(s);
  tb.innerHTML = `
    ${crashBanner(s)}
    <div class="quick">${quick.map(([c, l]) => `<button class="btn xs" data-quick="${esc(c)}" title="${esc(c)}" ${running ? '' : 'disabled'}>${esc(l)}</button>`).join('')}
      <button class="btn xs icon ghost" title="Edit these buttons" data-edit-quick>${icon('edit', 12)}</button>
      <div class="spacer"></div>
      <div class="search-input mini">${icon('search', 13)}<input class="input" id="log-q" placeholder="Search log…" value="${esc(f.text)}" /></div>
      <div class="segmented sm">${[['all', 'All'], ['warn', 'Warnings'], ['error', 'Errors'], ['chat', 'Chat']].map(([k, l]) => `<button class="${f.level === k ? 'active' : ''}" data-level="${k}">${l}</button>`).join('')}</div>
      <button class="btn xs icon ghost" title="Copy visible log" data-copylog>${icon('copy', 13)}</button>
      <button class="btn xs icon ghost" title="Share log (mclo.gs)" data-sharelog>${icon('share', 13)}</button>
      <button class="btn xs icon ghost" title="Log files" data-logs>${icon('file', 13)}</button>
      <button class="btn xs ghost" data-clear>${icon('trash', 13)} Clear</button></div>
    <div class="console-wrap">
      <div class="console" id="console"></div>
      <div class="cmd-bar">
        <div class="cmd-input"><span class="dim mono">&gt;</span><input id="cmd" list="cmd-list" placeholder="${running ? 'Type a command, e.g. op YourName  (↑ for history, Tab to complete)' : 'Start the server to send commands'}" ${running ? '' : 'disabled'} autocomplete="off" spellcheck="false" /></div>
        <datalist id="cmd-list">${COMMANDS.map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist>
        <button class="btn primary" id="cmd-send" ${running ? '' : 'disabled'}>${icon('send', 15)} Send</button>
      </div>
    </div>`;
  bindCrashBanner(tb, s);
  const con = $('#console');
  const fill = () => {
    con.innerHTML = '';
    const frag = document.createDocumentFragment();
    const lines = (state.logs[s.id] || []).filter(logMatches);
    lines.forEach((e) => frag.appendChild(logLine(e)));
    if (!lines.length) {
      const d = document.createElement('div'); d.className = 'l-dim';
      d.textContent = (state.logs[s.id] || []).length ? 'No lines match this filter.' : 'Server output will appear here.';
      frag.appendChild(d);
    }
    con.appendChild(frag);
    con.scrollTop = con.scrollHeight;
  };
  fill();
  $('#log-q').oninput = debounce((e) => { f.text = e.target.value; fill(); }, 150);
  $$('[data-level]', tb).forEach((b) => (b.onclick = () => { f.level = b.dataset.level; $$('[data-level]', tb).forEach((x) => x.classList.toggle('active', x === b)); fill(); }));
  $('[data-copylog]', tb).onclick = () => { navigator.clipboard.writeText([...con.childNodes].map((n) => n.textContent).join('\n')); toast('Log copied', 'success', 1500); };
  $('[data-sharelog]', tb).onclick = () => shareText([...con.childNodes].map((n) => n.textContent).join('\n'), `${s.name} console`);
  $('[data-logs]', tb).onclick = () => openLogsBrowser(s);
  $('[data-edit-quick]', tb).onclick = () => editQuickCommands(s);
  const input = $('#cmd');
  let hi = -1;
  const send = (cmd) => {
    if (!cmd.trim()) return;
    cmdHistory.unshift(cmd); if (cmdHistory.length > 50) cmdHistory.pop();
    hi = -1;
    call('servers:command', s.id, cmd).catch(fail);
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { send(input.value); input.value = ''; }
    else if (e.key === 'ArrowUp') { hi = Math.min(cmdHistory.length - 1, hi + 1); if (cmdHistory[hi]) input.value = cmdHistory[hi]; e.preventDefault(); }
    else if (e.key === 'ArrowDown') { hi = Math.max(-1, hi - 1); input.value = hi >= 0 ? cmdHistory[hi] : ''; e.preventDefault(); }
    else if (e.key === 'Tab') {
      e.preventDefault();
      const v = input.value;
      const parts = v.split(' ');
      const last = parts[parts.length - 1].toLowerCase();
      if (parts.length === 1) {
        const m = COMMANDS.find((c) => c.startsWith(last));
        if (m) input.value = m;
      } else {
        const names = [...new Set([...(server(s.id)?.players || []), ...cmdHistory.flatMap((c) => c.split(' ').slice(1))])];
        const m = names.find((n) => n.toLowerCase().startsWith(last) && n.toLowerCase() !== last);
        if (m) { parts[parts.length - 1] = m; input.value = parts.join(' ') + ' '; }
      }
    }
  };
  $('#cmd-send').onclick = () => { send(input.value); input.value = ''; input.focus(); };
  $$('[data-quick]', tb).forEach((b) => (b.onclick = () => b.dataset.quick.split(/;\s*/).filter((c) => c.trim()).forEach(send)));
  $('[data-clear]', tb).onclick = () => { con.innerHTML = ''; };
  if (running) input.focus();
}

function editQuickCommands(s) {
  const rows = quickFor(s).map(([command, label]) => ({ command, label }));
  const m = modal({
    title: `<div class="mod-icon sm">${icon('edit', 15)}</div><div><h2>Quick command buttons</h2><div class="dim small">Shown above the console of ${esc(s.name)}</div></div>`,
    body: '<div id="qc"></div>',
    foot: `<button class="btn ghost" data-reset>Reset to defaults</button><div class="spacer"></div><button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-save>${icon('check', 15)} Save</button>`,
  });
  const draw = () => {
    $('#qc', m.el).innerHTML = `<div class="qc-list">${rows.map((r, i) => `<div class="row qc-row">
        <input class="input" data-l="${i}" placeholder="Button label" value="${esc(r.label)}" style="max-width:180px" />
        <input class="input mono" data-c="${i}" placeholder="Command, e.g. time set day" value="${esc(r.command)}" />
        <button class="btn sm icon ghost" data-up="${i}" title="Move up" ${i ? '' : 'disabled'}>${icon('update', 14)}</button>
        <button class="btn sm icon ghost" data-rm="${i}" title="Remove">${icon('trash', 14)}</button></div>`).join('')}</div>
      <button class="btn sm" data-add style="margin-top:10px">${icon('plus', 14)} Add button</button>
      <div class="dim small" style="margin-top:10px">Tip: use several commands in one button by separating them with a semicolon, e.g. <span class="mono">time set day; weather clear</span>.</div>`;
    $$('[data-l]', m.el).forEach((x) => (x.oninput = () => (rows[x.dataset.l].label = x.value)));
    $$('[data-c]', m.el).forEach((x) => (x.oninput = () => (rows[x.dataset.c].command = x.value)));
    $$('[data-rm]', m.el).forEach((x) => (x.onclick = () => { rows.splice(x.dataset.rm, 1); draw(); }));
    $$('[data-up]', m.el).forEach((x) => (x.onclick = () => { const i = Number(x.dataset.up); [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; draw(); }));
    $('[data-add]', m.el).onclick = () => { rows.push({ label: '', command: '' }); draw(); $$('[data-l]', m.el).pop().focus(); };
  };
  draw();
  $('[data-x]', m.el).onclick = () => m.close();
  $('[data-reset]', m.el).onclick = async () => { await call('servers:update', s.id, { quickCommands: [] }); await refreshServers(); m.close(); renderBody(); };
  $('[data-save]', m.el).onclick = async () => {
    try { await call('servers:update', s.id, { quickCommands: rows.filter((r) => r.command.trim()) }); await refreshServers(); m.close(); renderBody(); toast('Buttons saved', 'success', 1500); } catch (e) { fail(e); }
  };
}

function appendLogs(id, lines) {
  const arr = (state.logs[id] = state.logs[id] || []);
  arr.push(...lines);
  if (arr.length > 2500) arr.splice(0, arr.length - 2500);
  if (id !== state.selected) return;
  for (const sel of ['#console', '#mini-console']) {
    const con = $(sel);
    if (!con) continue;
    const atBottom = con.scrollHeight - con.scrollTop - con.clientHeight < 40;
    const shown = sel === '#console' ? lines.filter(logMatches) : lines;
    if (!shown.length) continue;
    if (con.firstChild && con.firstChild.className === 'l-dim' && con.childNodes.length === 1) con.innerHTML = '';
    const frag = document.createDocumentFragment();
    shown.forEach((e) => frag.appendChild(logLine(e)));
    con.appendChild(frag);
    const max = sel === '#console' ? 2500 : 80;
    while (con.childNodes.length > max) con.removeChild(con.firstChild);
    if (atBottom) con.scrollTop = con.scrollHeight;
  }
}

/** Uploads text to mclo.gs (after asking) and copies the link. */
async function shareText(text, what) {
  if (!text.trim()) return toast('There is nothing to share yet', 'error');
  if (!(await confirmDialog({ title: 'Share this log?', message: `${what} will be uploaded to mclo.gs, a free log-sharing site for Minecraft, so you can send the link to someone who helps you. Anyone with the link can read it (mclo.gs hides IP addresses automatically).`, confirm: 'Upload & copy link' }))) return;
  try {
    const url = await call('servers:shareLog', text);
    navigator.clipboard.writeText(url);
    toast(`Link copied: ${url}`, 'success', 8000);
  } catch (e) { fail(e); }
}

async function openLogsBrowser(s) {
  const m = modal({
    title: `<div class="mod-icon sm">${icon('file', 15)}</div><div><h2>Log files</h2><div class="dim small">${esc(s.name)}</div></div>`,
    size: 'xl', body: '<div class="logs-browser"><div class="logs-list" id="ll"><div class="skeleton" style="height:200px"></div></div><div class="logs-view"><div class="row" id="lv-bar" style="margin-bottom:8px"></div><div class="console" id="lv" style="height:min(60vh,560px)"><div class="l-dim">Pick a log on the left.</div></div></div></div>',
  });
  let list;
  try { list = await call('servers:logsList', s.id); } catch (e) { m.close(); return fail(e); }
  const ll = $('#ll', m.el);
  if (!list.length) { ll.innerHTML = '<div class="dim small" style="padding:10px">No log files yet.</div>'; return; }
  ll.innerHTML = list.map((f, i) => `<div class="log-item" data-i="${i}"><span class="chip ${f.kind === 'crash' ? 'danger' : ''}">${f.kind === 'crash' ? 'Crash' : 'Log'}</span><div class="grow"><div class="t">${esc(f.name)}</div><div class="d">${ago(f.mtime)} · ${fmtBytes(f.size)}</div></div></div>`).join('');
  const open = async (i) => {
    $$('.log-item', ll).forEach((x) => x.classList.toggle('active', Number(x.dataset.i) === i));
    const f = list[i];
    const view = $('#lv', m.el);
    view.innerHTML = '<div class="l-dim">Loading…</div>';
    try {
      const r = await call('servers:logRead', s.id, f.rel);
      view.innerHTML = '';
      const frag = document.createDocumentFragment();
      r.text.split(/\r?\n/).slice(-6000).forEach((line) => frag.appendChild(logLine({ line, t: Date.now(), kind: 'out' })));
      view.appendChild(frag);
      view.scrollTop = view.scrollHeight;
      $('#lv-bar', m.el).innerHTML = `<b class="mono small">${esc(f.rel)}</b>${r.truncated ? '<span class="chip warn">showing the last 3 MB</span>' : ''}<div class="spacer"></div>
        <button class="btn xs" data-copy-log>${icon('copy', 13)} Copy</button><button class="btn xs" data-share-log>${icon('share', 13)} Share</button><button class="btn xs ghost" data-open-log>${icon('external', 13)} Open</button>`;
      $('[data-copy-log]', m.el).onclick = () => { navigator.clipboard.writeText(r.text); toast('Copied', 'success', 1200); };
      $('[data-share-log]', m.el).onclick = () => shareText(r.text, f.name);
      $('[data-open-log]', m.el).onclick = () => call('files:open', s.id, f.rel);
    } catch (e) { view.innerHTML = `<div class="l-error">${esc(e.message)}</div>`; }
  };
  $$('.log-item', ll).forEach((x) => (x.onclick = () => open(Number(x.dataset.i))));
  open(0);
}

async function deleteServer(s) {
  if (!(await confirmDialog({ title: `Delete ${s.name}?`, message: 'This permanently deletes the server, its world, mods and backups from your computer.', confirm: 'Delete forever', danger: true }))) return;
  try { await call('servers:delete', s.id); toast(`Deleted ${s.name}`, 'success'); state.selected = null; await refreshServers(); renderMain(); } catch (e) { fail(e); }
}

const wizardHooks = { current: null };

// ---------- app settings ----------
function openAppSettings(section) {
  state.page = 'settings';
  state.selected = null;
  state.settingsSection = typeof section === 'string' ? section : null;
  renderSidebar();
  renderMain();
}

// ---------- live events ----------
api.onServersChanged(async () => {
  const prev = server();
  const prevStatus = prev && prev.status;
  await refreshServers();
  const cur = server();
  if (state.page) return;
  if (!state.selected) return renderHome($('#main'));
  if (cur && prevStatus !== cur.status) { renderHeader(); renderBody(); }
  else if (cur) {
    renderHeader();
    if (state.tab === 'overview') { renderPlayitConnect($('#playit-connect'), cur); const cb = $('#connect-box'); if (cb) { cb.innerHTML = connectBox(cur); bindConnect(cb, cur); } }
  }
});

api.onStatus((id, status) => {
  const s = server(id);
  if (!s) return;
  const prev = s.status;
  s.status = status;
  if (!isRunning(status)) { delete state.stats[id]; s.players = []; }
  if (status === 'starting') { state.history[id] = []; state.tps[id] = []; s.crash = null; }
  renderSidebar();
  if (status === 'online' && prev === 'starting') toast(`${s.name} is online`, 'success');
  if (state.page) return;
  if (!state.selected) return refreshHomeCard(id);
  if (id !== state.selected) return;
  renderHeader();
  if (status === 'crashed') {
    // fetch the crash diagnosis and show it
    call('servers:get', id).then((full) => { Object.assign(s, { crash: full.crash }); if (['overview', 'console'].includes(state.tab)) renderBody(); }).catch(() => {});
    return;
  }
  if (state.tab === 'console') {
    const running = isRunning(status);
    const input = $('#cmd');
    if (input && input.disabled === running) renderBody();
  } else if (state.tab === 'overview') {
    updateStatsUI(id, state.stats[id] || {}); renderPlayersCard(s); renderPlayitConnect($('#playit-connect'), s);
    if (status === 'online' && tpsSupported(s)) pollTps(id);
  }
});

api.onStats((id, stats) => {
  state.stats[id] = stats;
  const h = (state.history[id] = state.history[id] || []);
  h.push({ t: Date.now(), cpu: stats.cpu, mem: stats.mem, players: stats.players });
  if (h.length > 180) h.shift();
  if (state.page) return;
  if (!state.selected) return refreshHomeCard(id);
  updateStatsUI(id, stats);
  if (Math.random() < 0.25) renderSidebar();
});

api.onTps((id, tps) => {
  const h = (state.tps[id] = state.tps[id] || []);
  h.push(tps);
  if (h.length > 120) h.shift();
  if (state.selected === id && state.tab === 'overview') updateStatsUI(id, state.stats[id] || {});
});

api.onEvent((id, e) => {
  const list = (state.events[id] = state.events[id] || []);
  list.unshift(e);
  if (state.selected === id && state.tab === 'overview') drawActivity(server(id));
});

api.onPlayers((id, players) => {
  const s = server(id);
  if (!s) return;
  s.players = players;
  if (id === state.selected && state.tab === 'overview') renderPlayersCard(s);
  if (id === state.selected && state.tab === 'players') renderBody();
});

api.onLog((id, lines) => appendLogs(id, lines));

api.onProgress((id, p) => {
  const cur = (state.progress[id] = state.progress[id] || { logs: [] });
  if (p.log) { cur.logs = [...(cur.logs || []), p.log].slice(-200); }
  else Object.assign(cur, p);
  if (p.error) cur.error = p.error;
  if (wizardHooks.current && wizardHooks.current.id() === id) wizardHooks.current.redraw();
  if (id === state.selected && server(id)?.status === 'installing') updateProgressUI(cur);
  if (p.done) { refreshServers().then(() => { if (id === state.selected) { renderHeader(); renderBody(); } }); }
});

api.onModProgress(() => {});
api.onQuitting((why) => toast(why === 'update' ? 'Installing a CraftDock update: saving worlds and stopping your servers safely…' : 'Stopping servers before closing…', 'info', 120000));
api.onNavigate((id) => { if (server(id)) select(id); });
api.onBackup((id) => { if (id === state.selected && state.tab === 'backups') renderBody(); });
api.onPlayitChanged((st) => { state.playit = st; playitStateChanged(); });
api.onPlayitLinked(() => { toast('playit.gg account linked!', 'success'); playitStateChanged(); });
api.onPlayitError((msg) => toast(msg, 'error', 8000));
api.onPlayitTunnel(async () => { await refreshServers(); if (state.selected && state.tab === 'overview') renderPlayitConnect($('#playit-connect'), server()); renderHeader(); });
api.onSystemTheme((dark) => { systemDark = dark; applyAppearance(); if (state.selected && state.tab === 'overview') updateStatsUI(state.selected, state.stats[state.selected] || {}); });

window.addEventListener('resize', debounce(() => { if (state.selected && state.tab === 'overview') updateStatsUI(state.selected, state.stats[state.selected] || {}); }, 100));
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  // dropping a server folder or .zip on the dashboard starts an import
  if (state.selected || state.page || $('.modal-backdrop')) return;
  const f = e.dataTransfer && e.dataTransfer.files[0];
  const p = f && api.pathForFile(f);
  if (p) openImportWizard(p);
});

// ---------- keyboard shortcuts ----------
document.addEventListener('keydown', (e) => {
  if (!e.ctrlKey || e.altKey) return;
  const inModal = !!$('.modal-backdrop');
  const k = e.key.toLowerCase();
  if (k === 'k') { e.preventDefault(); if (!inModal) openPalette(); }
  else if (k === 'n' && !inModal) { e.preventDefault(); openCreateWizard(); }
  else if (k === 'i' && !inModal) { e.preventDefault(); openImportWizard(); }
  else if (k === ',' && !inModal) { e.preventDefault(); openAppSettings(); }
  else if (k === 'd' && !inModal) { e.preventDefault(); select(null); }
  else if (k === 'f' && state.selected && state.tab === 'console') { e.preventDefault(); $('#log-q')?.focus(); }
  else if (k === 's' && $('#save-btn') && !$('#save-btn').disabled) { e.preventDefault(); $('#save-btn').click(); }
  else if (/^[1-9]$/.test(k) && state.selected && !inModal && server() && !['installing', 'error'].includes(server().status)) {
    e.preventDefault();
    const t = tabsFor(server())[Number(k) - 1];
    if (t) switchTab(t[0]);
  } else if ((k === 'arrowdown' || k === 'arrowup') && e.shiftKey && state.servers.length) {
    e.preventDefault();
    const list = sortedServers();
    const i = list.findIndex((s) => s.id === state.selected);
    const next = list[(i + (k === 'arrowdown' ? 1 : -1) + list.length) % list.length];
    select(next.id, state.tab);
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const menu = $('.menu');
    if (menu) return menu.remove();
    const close = [...$$('.modal-backdrop [data-close]')].pop();
    if (close) close.click();
  }
});

// ---------- boot ----------
window.addEventListener('DOMContentLoaded', async () => {
  [state.system, state.settings, state.playit, state.types, systemDark] = await Promise.all([call('system:info'), call('settings:get'), call('playit:status'), call('types:list'), call('app:systemDark')]);
  applyAppearance();
  call('versions:latest').then((v) => (state.latestMc = v)).catch(() => {});
  await refreshServers();
  if (state.settings.startPage === 'last' && state.settings.lastServer && server(state.settings.lastServer)) await select(state.settings.lastServer);
  else renderMain();
  setInterval(async () => {
    // keep uptime/world size fresh on the overview
    if (state.selected && state.tab === 'overview') {
      try {
        const s = await call('servers:get', state.selected);
        const local = server(s.id);
        if (local) { local.worldSize = s.worldSize; local.players = s.players; }
      } catch {}
    }
  }, 15000);
});
