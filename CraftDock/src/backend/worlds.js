// Worlds: list the worlds in a server, import singleplayer worlds, export them back, game rules, reset.
const fs = require('fs');
const os = require('os');
const path = require('path');
const props = require('./properties');
const NBT = require('./nbt');
const T = require('./types');
const { copyTree } = require('./importer');
const { createZip } = require('./archive');
const { compareVersions } = require('./versions');

const exists = (...p) => fs.existsSync(path.join(...p));
const listDir = (p) => { try { return fs.readdirSync(p, { withFileTypes: true }); } catch { return []; } };

async function dirSize(dir) {
  let total = 0;
  for (const e of await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else { try { total += (await fs.promises.stat(p)).size; } catch {} }
  }
  return total;
}

function safeName(name) {
  const n = String(name || 'world').replace(/[^A-Za-z0-9 _\-.()]/g, '_').replace(/^[ .]+|[ .]+$/g, '').slice(0, 60);
  return n || 'world';
}
function uniqueName(parent, name) {
  let n = name, i = 2;
  while (fs.existsSync(path.join(parent, n))) n = `${name} (${i++})`;
  return n;
}

const levelProp = (dir) => props.read(path.join(dir, 'server.properties'))['level-name'] || (fs.existsSync(path.join(dir, 'worlds')) ? 'Bedrock level' : 'world');
const isBedrockWorld = (p) => exists(p, 'db') && exists(p, 'level.dat');
const isJavaWorld = (p) => exists(p, 'level.dat') && !exists(p, 'db');

function iconOf(folder, file) {
  try {
    const p = path.join(folder, file);
    const st = fs.statSync(p);
    if (st.size > 400000) return null;
    return `data:image/${/\.jpe?g$/i.test(file) ? 'jpeg' : 'png'};base64,` + fs.readFileSync(p).toString('base64');
  } catch { return null; }
}

/** Reads what we can from a world folder without loading the world. */
function worldInfo(folder) {
  const info = { edition: isBedrockWorld(folder) ? 'bedrock' : 'java', folder: path.basename(folder) };
  try {
    const dat = NBT.readLevelDat(fs.readFileSync(path.join(folder, 'level.dat')));
    if (dat.edition === 'bedrock') {
      const v = NBT.val(dat.tag, 'lastOpenedWithVersion');
      info.levelName = NBT.val(dat.tag, 'LevelName');
      info.version = v && v.items ? v.items.slice(0, 4).join('.') : null;
      info.gameType = ['survival', 'creative', 'adventure', 'spectator'][NBT.val(dat.tag, 'GameType')] || null;
      info.seed = NBT.val(dat.tag, 'RandomSeed') != null ? String(NBT.val(dat.tag, 'RandomSeed')) : null;
      const lp = NBT.val(dat.tag, 'LastPlayed');
      info.lastPlayed = lp != null ? Number(lp) * 1000 : null;
      info.difficulty = ['peaceful', 'easy', 'normal', 'hard'][NBT.val(dat.tag, 'Difficulty')] || null;
    } else {
      const d = NBT.get(dat.tag, 'Data');
      info.levelName = NBT.val(d, 'LevelName');
      info.version = NBT.val(d, 'Version', 'Name') || null;
      info.dataVersion = NBT.val(d, 'DataVersion') || NBT.val(d, 'Version', 'Id') || null;
      info.gameType = ['survival', 'creative', 'adventure', 'spectator'][NBT.val(d, 'GameType')] || null;
      // 26.x moved hardcore/difficulty into difficulty_settings and the seed into data/minecraft/world_gen_settings.dat
      info.hardcore = !!(NBT.val(d, 'hardcore') ?? NBT.val(d, 'difficulty_settings', 'hardcore'));
      let seed = NBT.val(d, 'WorldGenSettings', 'seed') ?? NBT.val(d, 'RandomSeed');
      if (seed == null) {
        try { seed = NBT.val(NBT.readLevelDat(fs.readFileSync(path.join(folder, 'data', 'minecraft', 'world_gen_settings.dat'))).tag, 'data', 'seed'); } catch {}
      }
      info.seed = seed != null ? String(seed) : null;
      const lp = NBT.val(d, 'LastPlayed');
      info.lastPlayed = lp != null ? Number(lp) : null;
      const diff = NBT.val(d, 'Difficulty') ?? NBT.val(d, 'difficulty_settings', 'difficulty');
      info.difficulty = typeof diff === 'string' ? diff.replace(/^minecraft:/, '') : ['peaceful', 'easy', 'normal', 'hard'][diff] || null;
    }
  } catch (e) { info.error = 'Could not read level.dat'; }
  if (!info.levelName) { try { info.levelName = fs.readFileSync(path.join(folder, 'levelname.txt'), 'utf8').trim(); } catch {} }
  info.icon = iconOf(folder, 'icon.png') || iconOf(folder, 'world_icon.jpeg');
  return info;
}

/** World folders (relative to the server dir) that belong to world `name` (Bukkit keeps Nether/End next to it). */
function worldFolders(dir, loader, name) {
  if (T.isBedrock(loader)) return [path.join('worlds', name)].filter((f) => fs.existsSync(path.join(dir, f)));
  return [name, `${name}_nether`, `${name}_the_end`].filter((f) => fs.existsSync(path.join(dir, f)));
}

async function listWorlds(dir, loader, { sizes = true } = {}) {
  const active = levelProp(dir);
  const out = [];
  if (T.isBedrock(loader)) {
    for (const e of listDir(path.join(dir, 'worlds'))) {
      if (!e.isDirectory()) continue;
      const folder = path.join(dir, 'worlds', e.name);
      if (!exists(folder, 'level.dat')) continue;
      const info = worldInfo(folder);
      out.push({ ...info, name: e.name, active: e.name === active, size: sizes ? await dirSize(folder) : null, mtime: fs.statSync(folder).mtimeMs, dims: null });
    }
  } else {
    const names = listDir(dir).filter((e) => e.isDirectory() && exists(dir, e.name, 'level.dat')).map((e) => e.name);
    const set = new Set(names);
    for (const n of names) {
      const m = n.match(/^(.*)_(nether|the_end)$/);
      if (m && set.has(m[1])) continue; // Bukkit dimension folder of another world
      const folder = path.join(dir, n);
      const info = worldInfo(folder);
      let size = null;
      if (sizes) { size = 0; for (const f of worldFolders(dir, loader, n)) size += await dirSize(path.join(dir, f)); }
      out.push({
        ...info, name: n, active: n === active, size, mtime: fs.statSync(folder).mtimeMs,
        dims: {
          nether: exists(folder, 'DIM-1') || set.has(`${n}_nether`) || exists(folder, 'dimensions', 'minecraft', 'the_nether'),
          end: exists(folder, 'DIM1') || set.has(`${n}_the_end`) || exists(folder, 'dimensions', 'minecraft', 'the_end'),
        },
        datapacks: listDir(path.join(folder, 'datapacks')).filter((d) => !d.name.startsWith('.') && d.name !== 'bukkit').length, // 'bukkit' is Paper's built-in pack
      });
    }
  }
  // the active world may not exist yet (created on first start)
  if (!out.some((w) => w.active)) out.unshift({ name: active, active: true, missing: true, levelName: active, size: 0 });
  return out.sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name));
}

/** Finds the folder that holds level.dat inside an extracted zip (descending into wrapper folders). */
function findWorldRoot(dir) {
  let cur = dir;
  for (let i = 0; i < 4; i++) {
    if (exists(cur, 'level.dat')) return cur;
    const dirs = listDir(cur).filter((e) => e.isDirectory() && !e.name.startsWith('__MACOSX'));
    const withLevel = dirs.filter((d) => exists(cur, d.name, 'level.dat') || exists(cur, d.name, 'db'));
    if (withLevel.length >= 1) {
      // prefer the overworld over Bukkit dimension folders
      const main = withLevel.find((d) => !/_(nether|the_end)$/.test(d.name)) || withLevel[0];
      return path.join(cur, main.name);
    }
    if (dirs.length !== 1) break;
    cur = path.join(cur, dirs[0].name);
  }
  return null;
}

/** Checks a world before importing it. Returns { info, warnings, error }. */
function inspectImport(src, loader, mcVersion) {
  const out = { info: null, warnings: [], error: null };
  if (!src || !exists(src, 'level.dat')) { out.error = 'No world found. Pick the world folder (the one with level.dat in it), or a .zip of it.'; return out; }
  const info = worldInfo(src);
  out.info = info;
  if (T.isBedrock(loader) && info.edition !== 'bedrock') out.error = 'This is a Java Edition world. Bedrock servers can only use Bedrock worlds (.mcworld).';
  else if (!T.isBedrock(loader) && info.edition === 'bedrock') out.error = 'This is a Bedrock world. It only works on a Bedrock server.';
  if (out.error) return out;
  if (info.version && mcVersion && info.edition === 'java' && /^\d/.test(info.version) && /^\d/.test(mcVersion)) {
    const c = compareVersions(info.version, mcVersion);
    if (c > 0) out.warnings.push(`This world was last played on Minecraft ${info.version}, which is newer than this server (${mcVersion}). Opening it on an older version can break it. Change the server version first, or import a backup.`);
    else if (c < 0) out.warnings.push(`This world is from Minecraft ${info.version}. It will be upgraded to ${mcVersion} the first time the server starts (you can't go back afterwards, so keep the original).`);
  }
  const parent = path.dirname(src), base = path.basename(src);
  if (fs.existsSync(path.join(parent, `${base}_nether`)) || fs.existsSync(path.join(parent, `${base}_the_end`))) out.siblings = true;
  return out;
}

/**
 * Copies a world into a server. mode 'replace' swaps out the active world, 'add' keeps both.
 * Singleplayer and Bukkit layouts are converted as needed. Returns the world's folder name.
 */
async function importWorld(dir, loader, src, { mode = 'add', name, activate = true, onProgress } = {}) {
  const bedrock = T.isBedrock(loader);
  const parent = bedrock ? path.join(dir, 'worlds') : dir;
  fs.mkdirSync(parent, { recursive: true });
  const active = levelProp(dir);
  let target;
  if (mode === 'replace') {
    target = active;
    for (const f of worldFolders(dir, loader, active)) await fs.promises.rm(path.join(dir, f), { recursive: true, force: true });
  } else {
    target = uniqueName(parent, safeName(name || worldInfo(src).levelName || path.basename(src)));
  }
  const skip = (p) => path.basename(p) === 'session.lock';
  await copyTree(src, path.join(parent, target), onProgress, skip);

  if (!bedrock) {
    const srcParent = path.dirname(src), base = path.basename(src);
    const nether = path.join(srcParent, `${base}_nether`), end = path.join(srcParent, `${base}_the_end`);
    if (T.isBukkit(loader)) {
      // Bukkit server: keep (or let the server create) separate dimension folders
      if (fs.existsSync(nether)) await copyTree(nether, path.join(dir, `${target}_nether`), null, skip);
      if (fs.existsSync(end)) await copyTree(end, path.join(dir, `${target}_the_end`), null, skip);
    } else {
      // Mojang layout: Bukkit dimension folders go inside the world as DIM-1 / DIM1
      if (fs.existsSync(path.join(nether, 'DIM-1')) && !exists(parent, target, 'DIM-1')) await copyTree(path.join(nether, 'DIM-1'), path.join(dir, target, 'DIM-1'), null, skip);
      if (fs.existsSync(path.join(end, 'DIM1')) && !exists(parent, target, 'DIM1')) await copyTree(path.join(end, 'DIM1'), path.join(dir, target, 'DIM1'), null, skip);
    }
  } else {
    try { fs.writeFileSync(path.join(parent, target, 'levelname.txt'), target); } catch {}
  }
  if (activate) props.write(path.join(dir, 'server.properties'), { 'level-name': target });
  return target;
}

/** Copies a world into `destParent/<name>` in singleplayer (Mojang) layout. Returns the new folder. */
async function copyAsSingleplayer(dir, loader, name, destParent, onProgress) {
  const skip = (p) => path.basename(p) === 'session.lock';
  const dest = path.join(destParent, uniqueName(destParent, safeName(name)));
  await copyTree(path.join(dir, name), dest, onProgress, skip);
  if (T.isBukkit(loader)) {
    if (exists(dir, `${name}_nether`, 'DIM-1') && !fs.existsSync(path.join(dest, 'DIM-1'))) await copyTree(path.join(dir, `${name}_nether`, 'DIM-1'), path.join(dest, 'DIM-1'), null, skip);
    if (exists(dir, `${name}_the_end`, 'DIM1') && !fs.existsSync(path.join(dest, 'DIM1'))) await copyTree(path.join(dir, `${name}_the_end`, 'DIM1'), path.join(dest, 'DIM1'), null, skip);
  }
  return dest;
}

/** Zips a world so it can be opened in singleplayer (.zip for Java, .mcworld for Bedrock). */
async function exportWorld(dir, loader, name, outFile, tmpDir) {
  if (T.isBedrock(loader)) {
    const folder = path.join(dir, 'worlds', name);
    await createZip(outFile, folder, fs.readdirSync(folder));
    return outFile;
  }
  if (!T.isBukkit(loader)) {
    await createZip(outFile, dir, [name], ['session.lock']);
    return outFile;
  }
  const staging = path.join(tmpDir, `world-export-${Date.now()}`);
  try {
    const folder = await copyAsSingleplayer(dir, loader, name, staging);
    await createZip(outFile, staging, [path.basename(folder)]);
  } finally {
    await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
  return outFile;
}

async function deleteWorld(dir, loader, name) {
  for (const f of worldFolders(dir, loader, name)) await fs.promises.rm(path.join(dir, f), { recursive: true, force: true, maxRetries: 3 });
}

/** Renames a world's folders and its in-game name; keeps it active if it was. */
async function renameWorld(dir, loader, from, to) {
  const bedrock = T.isBedrock(loader);
  const parent = bedrock ? path.join(dir, 'worlds') : dir;
  const name = safeName(to);
  if (name === from) return name;
  if (fs.existsSync(path.join(parent, name))) throw new Error(`There is already a world called "${name}"`);
  await fs.promises.rename(path.join(parent, from), path.join(parent, name));
  if (!bedrock) {
    for (const suf of ['_nether', '_the_end']) {
      if (exists(dir, from + suf)) await fs.promises.rename(path.join(dir, from + suf), path.join(dir, name + suf));
    }
  }
  try {
    const file = path.join(parent, name, 'level.dat');
    const dat = NBT.readLevelDat(fs.readFileSync(file));
    const holder = dat.edition === 'bedrock' ? dat.tag : NBT.get(dat.tag, 'Data');
    const t = holder && holder.value.get('LevelName');
    if (t) { t.value = name; fs.writeFileSync(file, NBT.writeLevelDat(dat)); }
    if (bedrock) fs.writeFileSync(path.join(parent, name, 'levelname.txt'), name);
  } catch {}
  if (levelProp(dir) === from) props.write(path.join(dir, 'server.properties'), { 'level-name': name });
  return name;
}

// ---------- game rules ----------
const BEDROCK_RULES = ['commandblockoutput', 'commandblocksenabled', 'dodaylightcycle', 'doentitydrops', 'dofiretick', 'doimmediaterespawn', 'doinsomnia', 'domobloot', 'domobspawning', 'dotiledrops', 'doweathercycle', 'drowningdamage', 'falldamage', 'firedamage', 'freezedamage', 'functioncommandlimit', 'keepinventory', 'locatorbar', 'maxcommandchainlength', 'mobgriefing', 'naturalregeneration', 'playerssleepingpercentage', 'projectilesbreakblocks', 'pvp', 'randomtickspeed', 'recipesunlock', 'respawnblocksexplode', 'sendcommandfeedback', 'showbordereffect', 'showcoordinates', 'showdaysplayed', 'showdeathmessages', 'showrecipemessages', 'showtags', 'spawnradius', 'tntexplodes', 'tntexplosiondropdecay'];

function rulesHolder(dat) {
  if (dat.edition === 'bedrock') return dat.tag;
  const d = NBT.get(dat.tag, 'Data');
  if (!d) return null;
  for (const k of ['GameRules', 'game_rules', 'gamerules']) {
    const t = d.value.get(k);
    if (t && t.type === NBT.TAG.COMPOUND) return t;
  }
  return null;
}

function ruleValue(t) {
  if (t.type === NBT.TAG.STRING) return t.value;
  if (t.type === NBT.TAG.BYTE) return t.value ? 'true' : 'false';
  return String(t.value);
}

/**
 * Where a world keeps its game rules: level.dat (Data.GameRules) up to 1.21, data/minecraft/game_rules.dat
 * from 26.x on, top-level keys of level.dat on Bedrock. Returns { file, dat, holder } or null.
 */
function rulesSource(folder) {
  const lvl = path.join(folder, 'level.dat');
  if (!fs.existsSync(lvl)) return null;
  const buf = fs.readFileSync(lvl);
  const dat = NBT.readLevelDat(buf);
  const holder = rulesHolder(dat);
  if (holder) return { file: lvl, buf, dat, holder };
  const gr = path.join(folder, 'data', 'minecraft', 'game_rules.dat');
  if (fs.existsSync(gr)) {
    const gbuf = fs.readFileSync(gr);
    const gdat = NBT.readLevelDat(gbuf);
    const h = NBT.get(gdat.tag, 'data');
    if (h && h.type === NBT.TAG.COMPOUND) return { file: gr, buf: gbuf, dat: gdat, holder: h };
  }
  return { file: lvl, buf, dat, holder: null };
}

/** Game rules stored in a world: [{ key, value, kind: 'bool' | 'int' }]. */
function readGamerules(dir, loader, name) {
  const folder = T.isBedrock(loader) ? path.join(dir, 'worlds', name) : path.join(dir, name);
  const src = rulesSource(folder);
  if (!src) return null;
  const { dat, holder } = src;
  if (!holder) return [];
  const out = [];
  for (const [key, t] of holder.value) {
    if (dat.edition === 'bedrock' && !BEDROCK_RULES.includes(key.toLowerCase())) continue;
    if (![NBT.TAG.STRING, NBT.TAG.BYTE, NBT.TAG.INT].includes(t.type)) continue;
    const value = ruleValue(t);
    const kind = value === 'true' || value === 'false' ? 'bool' : /^-?\d+$/.test(value) ? 'int' : null;
    if (kind) out.push({ key, value, kind });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/** Writes game rules into the world files (only while the server is stopped). */
function writeGamerules(dir, loader, name, patch) {
  const folder = T.isBedrock(loader) ? path.join(dir, 'worlds', name) : path.join(dir, name);
  const src = rulesSource(folder);
  if (!src || !src.holder) throw new Error('This world has no game rules saved yet. Start the server once first.');
  const { file, buf, dat, holder } = src;
  for (const [key, v] of Object.entries(patch)) {
    const t = holder.value.get(key);
    if (!t) continue;
    const s = String(v);
    if (t.type === NBT.TAG.STRING) t.value = s;
    else if (t.type === NBT.TAG.BYTE) t.value = s === 'true' || s === '1' ? 1 : 0;
    else if (t.type === NBT.TAG.INT) t.value = parseInt(s, 10) || 0;
  }
  fs.writeFileSync(file + '.craftdock-bak', buf);
  fs.writeFileSync(file, NBT.writeLevelDat(dat));
}

// ---------- singleplayer saves on this PC ----------
function javaSaveRoots() {
  const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const home = os.homedir();
  const roots = [{ launcher: 'Minecraft Launcher', dir: path.join(appdata, '.minecraft', 'saves') }];
  const instances = (base, sub, launcher) => {
    for (const e of listDir(base)) {
      if (!e.isDirectory()) continue;
      for (const s of sub) { const d = path.join(base, e.name, ...s); if (fs.existsSync(d)) { roots.push({ launcher: `${launcher}: ${e.name}`, dir: d }); break; } }
    }
  };
  instances(path.join(appdata, 'PrismLauncher', 'instances'), [['.minecraft', 'saves'], ['minecraft', 'saves']], 'Prism');
  instances(path.join(appdata, 'PolyMC', 'instances'), [['.minecraft', 'saves'], ['minecraft', 'saves']], 'PolyMC');
  instances(path.join(appdata, 'ModrinthApp', 'profiles'), [['saves']], 'Modrinth App');
  instances(path.join(appdata, 'com.modrinth.theseus', 'profiles'), [['saves']], 'Modrinth App');
  instances(path.join(home, 'curseforge', 'minecraft', 'Instances'), [['saves']], 'CurseForge');
  instances(path.join(appdata, 'ATLauncher', 'instances'), [['saves']], 'ATLauncher');
  instances(path.join(appdata, 'gdlauncher_carbon', 'data', 'instances'), [['instance', 'saves']], 'GDLauncher');
  instances(path.join(appdata, 'gdlauncher_next', 'instances'), [['saves']], 'GDLauncher');
  if (process.platform === 'darwin') roots.push({ launcher: 'Minecraft Launcher', dir: path.join(home, 'Library', 'Application Support', 'minecraft', 'saves') });
  if (process.platform === 'linux') roots.push({ launcher: 'Minecraft Launcher', dir: path.join(home, '.minecraft', 'saves') });
  return roots.filter((r) => fs.existsSync(r.dir));
}

function bedrockSaveRoots() {
  const appdata = process.env.APPDATA || '';
  const local = process.env.LOCALAPPDATA || '';
  const roots = [];
  const users = path.join(appdata, 'Minecraft Bedrock', 'Users');
  for (const e of listDir(users)) {
    const d = path.join(users, e.name, 'games', 'com.mojang', 'minecraftWorlds');
    if (fs.existsSync(d)) roots.push({ launcher: 'Minecraft for Windows', dir: d });
  }
  const uwp = path.join(local, 'Packages', 'Microsoft.MinecraftUWP_8wekyb3d8bbwe', 'LocalState', 'games', 'com.mojang', 'minecraftWorlds');
  if (fs.existsSync(uwp)) roots.push({ launcher: 'Minecraft for Windows (old)', dir: uwp });
  return roots;
}

/** Singleplayer worlds found on this computer, newest first. */
function discoverSaves(edition = 'java') {
  const roots = edition === 'bedrock' ? bedrockSaveRoots() : javaSaveRoots();
  const out = [];
  for (const r of roots) {
    for (const e of listDir(r.dir)) {
      if (!e.isDirectory()) continue;
      const folder = path.join(r.dir, e.name);
      if (!exists(folder, 'level.dat')) continue;
      const info = worldInfo(folder);
      let mtime = 0;
      try { mtime = fs.statSync(path.join(folder, 'level.dat')).mtimeMs; } catch {}
      out.push({ ...info, path: folder, launcher: r.launcher, lastPlayed: info.lastPlayed || mtime });
    }
  }
  return out.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0)).slice(0, 200);
}

/** Where "Copy to singleplayer" puts worlds. */
function singleplayerDir(edition = 'java') {
  const r = edition === 'bedrock' ? bedrockSaveRoots()[0] : javaSaveRoots()[0];
  return r ? r.dir : null;
}

module.exports = {
  listWorlds, worldInfo, worldFolders, findWorldRoot, inspectImport, importWorld, exportWorld, copyAsSingleplayer,
  deleteWorld, renameWorld, readGamerules, writeGamerules, discoverSaves, singleplayerDir, safeName, dirSize,
};
