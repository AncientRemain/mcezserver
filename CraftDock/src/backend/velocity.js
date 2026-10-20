// Velocity proxy: reads/edits velocity.toml and links CraftDock servers into one network.
const fs = require('fs');
const path = require('path');
const props = require('./properties');

const tomlFile = (dir) => path.join(dir, 'velocity.toml');
const readText = (dir) => { try { return fs.readFileSync(tomlFile(dir), 'utf8'); } catch { return null; } };

function tomlString(v) { return JSON.stringify(String(v)); }
function parseValue(raw) {
  const s = raw.trim();
  if (/^".*"$/.test(s)) { try { return JSON.parse(s); } catch { return s.slice(1, -1); } }
  if (/^'.*'$/.test(s)) return s.slice(1, -1);
  if (s === 'true' || s === 'false') return s === 'true';
  if (/^-?\d+$/.test(s)) return Number(s);
  return s;
}

/** Splits the file into [{ name: null | 'servers' | ..., lines: [] }] sections. */
function sections(text) {
  const out = [{ name: null, lines: [] }];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (m) out.push({ name: m[1].trim(), lines: [line] });
    else out[out.length - 1].lines.push(line);
  }
  return out;
}

function getConfig(dir) {
  const text = readText(dir);
  if (!text) return null;
  const secs = sections(text);
  const top = {};
  for (const l of secs[0].lines) {
    const m = l.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(.+?)\s*$/);
    if (m) top[m[1]] = parseValue(m[2]);
  }
  const servers = [];
  let tryOrder = [];
  const sv = secs.find((s) => s.name === 'servers');
  if (sv) {
    const body = sv.lines.slice(1).join('\n');
    const t = body.match(/^\s*try\s*=\s*\[([\s\S]*?)\]/m);
    if (t) tryOrder = [...t[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    const stripped = body.replace(/^\s*try\s*=\s*\[[\s\S]*?\]/m, '');
    for (const m of stripped.matchAll(/^\s*"?([A-Za-z0-9_.-]+)"?\s*=\s*"([^"]+)"/gm)) servers.push({ name: m[1], address: m[2] });
  }
  const bind = String(top.bind || '0.0.0.0:25577');
  return {
    bind, port: Number(bind.split(':').pop()) || 25577, motd: top.motd || '', showMaxPlayers: top['show-max-players'] ?? 500,
    onlineMode: top['online-mode'] !== false, forwarding: String(top['player-info-forwarding-mode'] || 'NONE').toLowerCase(),
    servers, try: tryOrder,
  };
}

/** Sets top-level keys (bind, motd, online-mode, ...) keeping the rest of the file as is. */
function setTop(dir, patch) {
  const text = readText(dir);
  if (!text) throw new Error('velocity.toml was not found. Start the proxy once to create it.');
  const secs = sections(text);
  const remaining = { ...patch };
  secs[0].lines = secs[0].lines.map((l) => {
    const m = l.match(/^(\s*)([A-Za-z0-9_-]+)(\s*=\s*)(.+?)\s*$/);
    if (!m || !(m[2] in remaining)) return l;
    const v = remaining[m[2]];
    delete remaining[m[2]];
    return `${m[1]}${m[2]}${m[3]}${typeof v === 'string' ? tomlString(v) : String(v)}`;
  });
  for (const [k, v] of Object.entries(remaining)) secs[0].lines.push(`${k} = ${typeof v === 'string' ? tomlString(v) : String(v)}`);
  fs.writeFileSync(tomlFile(dir), secs.map((s) => s.lines.join('\n')).join('\n'));
}

function setPort(dir, port) {
  const cur = getConfig(dir);
  const host = cur ? cur.bind.split(':').slice(0, -1).join(':') || '0.0.0.0' : '0.0.0.0';
  setTop(dir, { bind: `${host}:${port}` });
}

/** Rewrites [servers] (and clears [forced-hosts], whose examples point at servers that no longer exist). */
function setServers(dir, list, tryOrder) {
  const text = readText(dir);
  if (!text) throw new Error('velocity.toml was not found. Start the proxy once to create it.');
  const secs = sections(text);
  const clean = (n) => String(n).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'server';
  const body = ['[servers]', '# Managed by CraftDock (Network tab)'];
  for (const s of list) body.push(`${clean(s.name)} = ${tomlString(s.address)}`);
  body.push(`try = [${(tryOrder || list.map((s) => s.name)).map((n) => tomlString(clean(n))).join(', ')}]`, '');
  let sv = secs.find((s) => s.name === 'servers');
  if (!sv) { sv = { name: 'servers', lines: [] }; secs.splice(1, 0, sv); }
  sv.lines = body;
  const fh = secs.find((s) => s.name === 'forced-hosts');
  if (fh) fh.lines = ['[forced-hosts]', ''];
  fs.writeFileSync(tomlFile(dir), secs.map((s) => s.lines.join('\n')).join('\n'));
}

function secret(dir) {
  const file = path.join(dir, 'forwarding.secret');
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return null; }
}

/** Edits `proxies.velocity` in a Paper server's config/paper-global.yml (creating the file if needed). */
function setPaperVelocity(backendDir, enabled, forwardingSecret) {
  const file = path.join(backendDir, 'config', 'paper-global.yml');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, `proxies:\n  velocity:\n    enabled: ${enabled}\n    online-mode: true\n    secret: '${forwardingSecret}'\n`);
    return;
  }
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const find = (re, from, indent) => {
    for (let i = from; i < lines.length; i++) {
      const l = lines[i];
      if (l.trim() && !l.trim().startsWith('#') && l.search(/\S/) < indent) return -1;
      if (re.test(l)) return i;
    }
    return -1;
  };
  let p = lines.findIndex((l) => /^proxies:\s*$/.test(l));
  if (p < 0) { lines.push('proxies:'); p = lines.length - 1; }
  let v = find(/^ {2}velocity:\s*$/, p + 1, 2);
  if (v < 0) { lines.splice(p + 1, 0, '  velocity:'); v = p + 1; }
  const set = (key, value) => {
    const i = find(new RegExp(`^ {4}${key}:`), v + 1, 4);
    if (i >= 0) lines[i] = `    ${key}: ${value}`;
    else lines.splice(v + 1, 0, `    ${key}: ${value}`);
  };
  set('secret', `'${forwardingSecret}'`);
  set('online-mode', 'true');
  set('enabled', String(enabled));
  fs.writeFileSync(file, lines.join('\n'));
}

/** FabricProxy-Lite config for Fabric/Quilt backends. */
function setFabricProxy(backendDir, forwardingSecret) {
  const file = path.join(backendDir, 'config', 'FabricProxy-Lite.toml');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `hackOnlineMode = true\nhackEarlySend = false\nhackMessageChain = true\ndisconnectMessage = "This server requires you to connect through the proxy."\nsecret = ${tomlString(forwardingSecret)}\n`);
}

/**
 * Prepares a backend for modern forwarding. Returns { ok, note, needsMod } — needsMod is a Modrinth slug
 * the caller should install (FabricProxy-Lite) because this module doesn't download anything.
 */
function configureBackend(backendDir, loader, forwardingSecret, enabled = true) {
  if (['paper', 'purpur', 'folia', 'leaf'].includes(loader)) {
    setPaperVelocity(backendDir, enabled, forwardingSecret);
    if (enabled) props.write(path.join(backendDir, 'server.properties'), { 'online-mode': 'false' });
    return { ok: true, note: enabled ? 'Velocity forwarding turned on in paper-global.yml' : 'Velocity forwarding turned off' };
  }
  if (loader === 'fabric' || loader === 'quilt') {
    if (enabled) {
      setFabricProxy(backendDir, forwardingSecret);
      props.write(path.join(backendDir, 'server.properties'), { 'online-mode': 'false' });
    }
    return { ok: true, note: enabled ? 'FabricProxy-Lite configured' : 'Remove FabricProxy-Lite from Mods to unlink', needsMod: enabled ? 'fabricproxy-lite' : null };
  }
  return { ok: false, note: `${loader} servers can't receive Velocity's player forwarding automatically. Players will join, but skins and UUIDs may be wrong. Paper, Purpur, Leaf, Folia and Fabric work best behind a proxy.` };
}

module.exports = { getConfig, setTop, setPort, setServers, secret, configureBackend };
