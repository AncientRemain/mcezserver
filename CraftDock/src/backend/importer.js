// Importing existing servers: work out what a server folder is (type, Minecraft + loader version),
// and copy it into CraftDock with progress.
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const props = require('./properties');
const { neoforgeToMc, compareVersions } = require('./versions');

const exists = (...p) => fs.existsSync(path.join(...p));
const listDir = (p) => { try { return fs.readdirSync(p, { withFileTypes: true }); } catch { return []; } };
const subdirs = (p) => listDir(p).filter((e) => e.isDirectory()).map((e) => e.name);

function zipText(file, entry) {
  try {
    const e = new AdmZip(file).getEntry(entry);
    return e ? e.getData().toString('utf8') : null;
  } catch { return null; }
}

function newest(list) {
  return [...list].sort(compareVersions).pop() || null;
}

/** Reads a jar's manifest: main class plus every Implementation-Title/Version pair (bundled jars list several). */
function manifestInfo(file) {
  const out = { main: null, titles: [] };
  const text = zipText(file, 'META-INF/MANIFEST.MF');
  if (!text) return out;
  const unfolded = text.replace(/\r?\n /g, '');
  out.main = (unfolded.match(/^Main-Class:\s*(\S+)/m) || [])[1] || null;
  // the main section and each "Name:" section can carry their own title/version, in any order
  for (const section of unfolded.split(/\r?\n\s*\r?\n/)) {
    const t = section.match(/^Implementation-Title:\s*(.+)$/m);
    const v = section.match(/^Implementation-Version:\s*(.+)$/m);
    if (t && v) out.titles.push({ title: t[1].trim(), version: v[1].trim() });
  }
  return out;
}

/** Paper and its forks unpack versions/<mc>/<fork>-<mc>.jar (or list it in the launcher's versions.list). */
function paperclipFork(root, jars) {
  for (const mc of subdirs(path.join(root, 'versions'))) {
    for (const e of listDir(path.join(root, 'versions', mc))) {
      const m = e.name.match(/^([a-z]+)-(\d[\w.\-]*?)\.jar$/i);
      // vanilla's own bundler unpacks versions/<mc>/server-<mc>.jar, which says nothing about plugins
      if (m && m[1].toLowerCase() !== 'server') return { fork: m[1].toLowerCase(), mc, from: `versions/${mc}/${e.name}` };
    }
  }
  for (const j of jars) {
    const list = zipText(path.join(root, j), 'META-INF/versions.list');
    const m = list && list.match(/\t([a-z]+)-(\d[\w.\-]*?)\t/i);
    if (m) return { fork: m[1].toLowerCase(), mc: m[2], from: j };
  }
  return null;
}

/** If an extracted zip contains a single wrapper folder, the server is inside it. */
function findServerRoot(dir) {
  let cur = dir;
  for (let i = 0; i < 3; i++) {
    const entries = listDir(cur).filter((e) => !e.name.startsWith('__MACOSX'));
    const looksLikeServer = entries.some((e) => /^(server\.properties|eula\.txt|mods|plugins|world|worlds|libraries|velocity\.toml|bedrock_server(\.exe)?)$/i.test(e.name) || /\.jar$/i.test(e.name));
    if (looksLikeServer) return cur;
    const dirs = entries.filter((e) => e.isDirectory());
    if (dirs.length !== 1) return cur;
    cur = path.join(cur, dirs[0].name);
  }
  return cur;
}

/** Inspects a server folder. Never modifies it. */
function analyze(root) {
  const det = { loader: null, mcVersion: null, loaderVersion: null, notes: [], from: [] };
  const files = listDir(root).map((e) => e.name);
  const jars = files.filter((f) => /\.jar$/i.test(f));
  const p = props.read(path.join(root, 'server.properties'));

  // A server CraftDock already manages (e.g. copied from another PC)
  if (exists(root, 'craftdock.json')) {
    try {
      const c = JSON.parse(fs.readFileSync(path.join(root, 'craftdock.json'), 'utf8').replace(/^﻿/, ''));
      Object.assign(det, { loader: c.loader, mcVersion: c.mcVersion, loaderVersion: c.loaderVersion, memoryMB: c.memoryMB, name: c.name });
      det.from.push('CraftDock settings file');
    } catch {}
  }

  // Bedrock Dedicated Server
  if (!det.loader && (files.includes('bedrock_server.exe') || files.includes('bedrock_server') || (exists(root, 'worlds') && exists(root, 'permissions.json')))) {
    det.loader = 'bedrock';
    det.from.push('bedrock_server');
    const level = p['level-name'] || 'Bedrock level';
    try {
      const NBT = require('./nbt');
      const dat = NBT.readLevelDat(fs.readFileSync(path.join(root, 'worlds', level, 'level.dat')));
      const v = NBT.val(dat.tag, 'lastOpenedWithVersion');
      if (v && v.items) det.worldVersion = v.items.slice(0, 4).join('.');
    } catch {}
    det.notes.push('CraftDock installs the newest Bedrock server and keeps your worlds, settings, allowlist and permissions.');
  }
  // What each jar says about itself (title/version from its manifest), for jars with plain names like server.jar
  const manifests = jars.map((j) => ({ jar: j, ...manifestInfo(path.join(root, j)) }));
  const byTitle = (re) => manifests.find((m) => m.titles.some((t) => re.test(t.title)));

  // Velocity proxy
  const velJar = byTitle(/^Velocity$/i);
  if (!det.loader && (files.includes('velocity.toml') || velJar || jars.some((j) => /^velocity/i.test(j)))) {
    det.loader = 'velocity';
    const vj = jars.find((j) => /^velocity/i.test(j));
    const m = vj && vj.match(/^velocity-(\d+\.\d+\.\d+(?:-SNAPSHOT)?)(?:-(\d+))?\.jar$/i);
    if (m) { det.mcVersion = m[1]; det.loaderVersion = m[2] || null; det.from.push(vj); }
    else if (velJar) { det.mcVersion = velJar.titles.find((t) => /^Velocity$/i.test(t.title)).version; det.from.push(velJar.jar); }
    try {
      const t = fs.readFileSync(path.join(root, 'velocity.toml'), 'utf8').match(/^bind\s*=\s*"[^"]*:(\d+)"/m);
      if (t) det.port = Number(t[1]);
    } catch {}
  }
  // Forge/NeoForge + plugin hybrids
  if (!det.loader) {
    const hm = byTitle(/^(Mohist|Youer)$/i);
    const hj = jars.find((j) => /^(mohist|youer)-/i.test(j));
    if (hm) {
      const t = hm.titles.find((x) => /^(Mohist|Youer)$/i.test(x.title));
      det.loader = t.title.toLowerCase();
      det.mcVersion = (String(t.version).match(/^(\d+(?:\.\d+)+)/) || [])[1] || null;
      det.from.push(hm.jar);
    } else if (hj) {
      const m = hj.match(/^(mohist|youer)-(\d+(?:\.\d+)+)?/i);
      det.loader = m[1].toLowerCase();
      det.mcVersion = m[2] || null;
      det.from.push(hj);
    } else if (exists(root, 'mohist-config')) det.loader = 'mohist';
    else if (exists(root, 'youer-config')) det.loader = 'youer';
  }
  // SpongeVanilla
  if (!det.loader) {
    const sm = byTitle(/^SpongeVanilla$/i);
    const sj = jars.find((j) => /^spongevanilla-/i.test(j));
    if (sm || sj) {
      det.loader = 'sponge';
      const m = sj && sj.match(/^spongevanilla-(\d+(?:\.\d+)+)-([\w.\-]+?)(?:-universal)?\.jar$/i);
      const v = sm && sm.titles.find((x) => /^SpongeVanilla$/i.test(x.title)).version;
      if (m) { det.mcVersion = m[1]; det.loaderVersion = `${m[1]}-${m[2]}`; det.from.push(sj); }
      else if (v && /^\d/.test(v)) { det.mcVersion = v.split('-')[0]; det.loaderVersion = v; det.from.push(sm.jar); }
    }
  }
  // NeoForge
  if (!det.loader) {
    const nf = subdirs(path.join(root, 'libraries/net/neoforged/neoforge'));
    if (nf.length) {
      det.loader = 'neoforge';
      det.loaderVersion = newest(nf);
      det.mcVersion = neoforgeToMc(det.loaderVersion);
      det.from.push('NeoForge libraries');
    } else if (subdirs(path.join(root, 'libraries/net/neoforged/forge')).length) {
      det.notes.push('This is an early NeoForge 1.20.1 server. It is imported as Forge 1.20.1, which runs the same mods.');
      det.loader = 'forge';
      det.mcVersion = '1.20.1';
    }
  }
  // Forge (modern: libraries folder; old: forge-*.jar in the root)
  if (!det.loader) {
    const fg = subdirs(path.join(root, 'libraries/net/minecraftforge/forge'));
    const oldJar = jars.find((j) => /^forge-(\d[\w.]*)-([\d.]+)(?:-[\w.]+)?(?:-universal|-shim)?\.jar$/i.test(j));
    if (fg.length) {
      det.loader = 'forge';
      det.loaderVersion = newest(fg);
      det.mcVersion = det.loaderVersion.split('-')[0];
      det.from.push('Forge libraries');
    } else if (oldJar) {
      const m = oldJar.match(/^forge-(\d[\w.]*?)-([\d.]+)/i);
      det.loader = 'forge';
      det.mcVersion = m[1];
      det.loaderVersion = `${m[1]}-${m[2]}`;
      det.from.push(oldJar);
    }
  }
  // Quilt
  if (!det.loader && (exists(root, '.quilt') || jars.some((j) => /quilt-server/i.test(j)) || subdirs(path.join(root, 'libraries/org/quiltmc/quilt-loader')).length)) {
    det.loader = 'quilt';
    const ql = subdirs(path.join(root, 'libraries/org/quiltmc/quilt-loader'));
    if (ql.length) { det.loaderVersion = newest(ql); det.from.push('Quilt libraries'); }
    const inter = subdirs(path.join(root, 'libraries/net/fabricmc/intermediary'));
    if (inter.length) det.mcVersion = newest(inter);
    if (!det.mcVersion && files.includes('server.jar')) {
      const vjson = zipText(path.join(root, 'server.jar'), 'version.json');
      if (vjson) { try { det.mcVersion = JSON.parse(vjson).id; } catch {} }
    }
  }
  // Fabric
  if (!det.loader) {
    const launcher = jars.find((j) => /fabric-server(-launch|-mc)?/i.test(j));
    if (launcher || exists(root, '.fabric') || exists(root, 'fabric-server-launcher.properties')) {
      det.loader = 'fabric';
      const info = launcher && zipText(path.join(root, launcher), 'install.properties');
      if (info) {
        det.mcVersion = (info.match(/game-version=(\S+)/) || [])[1] || null;
        det.loaderVersion = (info.match(/fabric-loader-version=(\S+)/) || [])[1] || null;
        det.from.push(launcher);
      }
      const fl = subdirs(path.join(root, 'libraries/net/fabricmc/fabric-loader'));
      if (!det.loaderVersion && fl.length) det.loaderVersion = newest(fl);
      if (!det.mcVersion) {
        const fabricServer = subdirs(path.join(root, '.fabric/server'));
        const m = listDir(path.join(root, '.fabric/server')).map((e) => e.name.match(/^(\d[\w.\-]*?)-server\.jar$/)).find(Boolean);
        if (m) det.mcVersion = m[1];
        else if (fabricServer.length) det.mcVersion = newest(fabricServer);
      }
    }
  }
  // Paper / Purpur / Folia / Leaf / Spigot / Bukkit
  if (!det.loader) {
    const pj = jars.find((j) => /^(paper|purpur|folia|leaf|pufferfish|spigot|craftbukkit|gale|airplane)[-_]?/i.test(j));
    const clip = paperclipFork(root, jars);
    const leafJar = manifests.find((m) => /leaper/i.test(m.main || ''));
    if (pj || clip || leafJar || exists(root, 'plugins') || exists(root, 'bukkit.yml') || exists(root, 'config/paper-global.yml') || exists(root, 'purpur.yml') || exists(root, 'leaf-global.yml')) {
      const KNOWN = { paper: 'paper', purpur: 'purpur', folia: 'folia', leaf: 'leaf', spigot: 'spigot', craftbukkit: 'spigot' };
      const fork = (clip && KNOWN[clip.fork] && clip.fork) || (leafJar && 'leaf') || (pj ? pj.split(/[-_.]/)[0].toLowerCase() : null);
      det.loader = KNOWN[fork] ||
        (exists(root, 'purpur.yml') ? 'purpur' : exists(root, 'config/leaf-global.yml') ? 'leaf' : !exists(root, 'config/paper-global.yml') && exists(root, 'spigot.yml') && !exists(root, 'paper.yml') ? 'spigot' : 'paper');
      if (clip && /^\d/.test(clip.mc) && !(pj && /-\d/.test(pj))) { det.mcVersion = clip.mc; det.from.push(clip.from); }
      if (fork && !pj && !KNOWN[fork]) det.notes.push(`This server used ${fork}. It will run on Paper, which loads the same plugins.`);
      if (pj) {
        const m = pj.match(/-(\d+\.\d+(?:\.\d+)?)(?:-(\d+))?\.jar$/i);
        if (m) { det.mcVersion = m[1]; det.loaderVersion = m[2] || null; det.from.push(pj); }
        if (fork && !['paper', 'purpur', 'folia', 'leaf', 'spigot', 'craftbukkit'].includes(fork)) det.notes.push(`This server used ${pj.split(/[-_.]/)[0]}. It will run on Paper, which loads the same plugins.`);
        if (fork === 'craftbukkit') det.notes.push('CraftBukkit servers are imported as Spigot, which runs the same plugins.');
      }
      if (!det.mcVersion) {
        const v = subdirs(path.join(root, 'versions')).filter((x) => /^\d/.test(x));
        if (v.length) { det.mcVersion = newest(v); det.from.push('versions folder'); }
      }
      if (!det.mcVersion) {
        const cache = listDir(path.join(root, 'cache')).map((e) => e.name.match(/^mojang_(.+)\.jar$/)).find(Boolean);
        if (cache) det.mcVersion = cache[1];
      }
    }
  }
  // Vanilla
  if (!det.loader) {
    const vj = jars.find((j) => /^(server|minecraft_server.*|minecraft-server.*)\.jar$/i.test(j)) || jars[0];
    if (vj) {
      det.loader = 'vanilla';
      const vjson = zipText(path.join(root, vj), 'version.json');
      if (vjson) { try { det.mcVersion = JSON.parse(vjson).id; det.from.push(vj); } catch {} }
      const m = !det.mcVersion && vj.match(/minecraft_server\.(.+)\.jar$/i);
      if (m) det.mcVersion = m[1];
    }
  }

  // Last resort for the Minecraft version: the server's own log
  if (!det.mcVersion) {
    for (const log of ['logs/latest.log', 'server.log']) {
      try {
        const text = fs.readFileSync(path.join(root, log), 'utf8');
        const m = text.match(/Starting minecraft server version (\S+)/i);
        if (m) { det.mcVersion = m[1]; det.from.push(log); break; }
      } catch {}
    }
  }

  const level = p['level-name'] || (det.loader === 'bedrock' ? 'Bedrock level' : 'world');
  const countFiles = (d, re) => listDir(path.join(root, d)).filter((e) => e.isFile() && re.test(e.name)).length;
  det.world = (det.loader === 'bedrock' ? exists(root, 'worlds', level) : exists(root, level)) ? level : null;
  det.mods = countFiles('mods', /\.jar$/i);
  det.plugins = countFiles('plugins', /\.jar$/i);
  det.port = Number(p['server-port']) || det.port || null;
  det.motd = p.motd || null;
  det.eula = (() => { try { return /eula\s*=\s*true/i.test(fs.readFileSync(path.join(root, 'eula.txt'), 'utf8')); } catch { return false; } })();
  det.looksLikeServer = !!(det.loader || files.includes('server.properties') || det.world);
  if (!det.loader && det.mods) { det.loader = 'fabric'; det.notes.push('Couldn\'t tell which mod loader this uses. Please check the server type below.'); }
  if (!det.loader) det.loader = 'vanilla';
  return det;
}

/** Total size and file count of a folder (for progress). */
async function measure(dir) {
  let bytes = 0, count = 0;
  const walk = async (d) => {
    for (const e of await fs.promises.readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) { count++; try { bytes += (await fs.promises.stat(p)).size; } catch {} }
    }
  };
  await walk(dir);
  return { bytes, count };
}

/** Copies a folder tree, reporting bytes copied. Skips lock files and the server's backups of other tools. */
async function copyTree(src, dest, onProgress, skip = () => false) {
  const total = await measure(src);
  let done = 0, last = 0;
  const walk = async (s, d) => {
    await fs.promises.mkdir(d, { recursive: true });
    for (const e of await fs.promises.readdir(s, { withFileTypes: true })) {
      const sp = path.join(s, e.name), dp = path.join(d, e.name);
      if (skip(sp, e)) continue;
      if (e.isDirectory()) await walk(sp, dp);
      else if (e.isFile()) {
        try { await fs.promises.copyFile(sp, dp); } catch (err) {
          if (e.name === 'session.lock') continue;
          throw new Error(`Couldn't copy ${path.relative(src, sp)}: ${err.message}. If the server is still running, stop it first.`);
        }
        try { done += (await fs.promises.stat(dp)).size; } catch {}
        if (onProgress && Date.now() - last > 150) { last = Date.now(); onProgress(done, total.bytes); }
      }
    }
  };
  await walk(src, dest);
  onProgress && onProgress(total.bytes, total.bytes);
}

module.exports = { analyze, findServerRoot, copyTree, measure };
