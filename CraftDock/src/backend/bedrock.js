// Bedrock add-ons: .mcpack / .mcaddon behavior and resource packs, turned on per world.
const fs = require('fs');
const path = require('path');
const props = require('./properties');
const { extractArchive } = require('./archive');
const { copyTree } = require('./importer');

const MANIFEST = 'craftdock-addons.json';
const listDir = (p) => { try { return fs.readdirSync(p, { withFileTypes: true }); } catch { return []; } };

function readJson(file, fallback) {
  try {
    // Bedrock manifests sometimes contain comments
    const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/^\s*\/\/.*$/gm, '');
    return JSON.parse(text);
  } catch { return fallback; }
}
const writeJson = (file, v) => fs.writeFileSync(file, JSON.stringify(v, null, 2));

const levelName = (dir) => props.read(path.join(dir, 'server.properties'))['level-name'] || 'Bedrock level';
const worldDir = (dir) => path.join(dir, 'worlds', levelName(dir));

function packKind(manifest) {
  const mods = (manifest && manifest.modules) || [];
  return mods.some((m) => m.type === 'resources') ? 'resource' : 'behavior';
}

/** Finds every pack (folder with manifest.json) under `root`, unpacking nested .mcpack files. */
async function findPacks(root, depth = 0) {
  const found = [];
  if (fs.existsSync(path.join(root, 'manifest.json'))) return [root];
  if (depth > 3) return found;
  for (const e of listDir(root)) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) found.push(...(await findPacks(p, depth + 1)));
    else if (/\.(mcpack|zip)$/i.test(e.name)) {
      const out = p + '.unpacked';
      await extractArchive(p, out);
      found.push(...(await findPacks(out, depth + 1)));
    }
  }
  return found;
}

function readAddonManifest(dir) { return readJson(path.join(dir, MANIFEST), {}); }

function worldPackList(dir, kind) {
  return readJson(path.join(worldDir(dir), `world_${kind}_packs.json`), []);
}
function setWorldPack(dir, kind, uuid, version, enabled) {
  const wd = worldDir(dir);
  fs.mkdirSync(wd, { recursive: true });
  const file = path.join(wd, `world_${kind}_packs.json`);
  let list = readJson(file, []).filter((p) => p.pack_id !== uuid);
  if (enabled) list = [{ pack_id: uuid, version }, ...list];
  writeJson(file, list);
}

/** Imports an .mcpack/.mcaddon/.zip and turns its packs on for the active world. Returns the pack names. */
async function importAddon(dir, file, tmpDir) {
  const staging = path.join(tmpDir, `addon-${Date.now()}`);
  try {
    await extractArchive(file, staging);
    const packs = await findPacks(staging);
    if (!packs.length) throw new Error('No Bedrock packs found in this file (there is no manifest.json).');
    const m = readAddonManifest(dir);
    const names = [];
    for (const p of packs) {
      const manifest = readJson(path.join(p, 'manifest.json'), null);
      const h = manifest && manifest.header;
      if (!h || !h.uuid) continue;
      const kind = packKind(manifest);
      const folderName = `${String(h.name || 'pack').replace(/§./g, '').replace(/[^A-Za-z0-9 _\-.]/g, '_').trim().slice(0, 40) || 'pack'}_${h.uuid.slice(0, 8)}`;
      const rel = path.join(`${kind}_packs`, folderName);
      await fs.promises.rm(path.join(dir, rel), { recursive: true, force: true });
      await copyTree(p, path.join(dir, rel));
      m[h.uuid] = { uuid: h.uuid, name: String(h.name || folderName).replace(/§./g, ''), description: String(h.description || '').replace(/§./g, ''), version: h.version || [1, 0, 0], kind, folder: rel.split(path.sep).join('/'), added: Date.now() };
      setWorldPack(dir, kind, h.uuid, h.version || [1, 0, 0], true);
      names.push(m[h.uuid].name);
    }
    fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify(m, null, 2));
    return names;
  } finally {
    await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

function listAddons(dir) {
  const m = readAddonManifest(dir);
  const enabled = new Set([...worldPackList(dir, 'behavior'), ...worldPackList(dir, 'resource')].map((p) => p.pack_id));
  return Object.values(m).filter((a) => fs.existsSync(path.join(dir, a.folder))).map((a) => {
    let icon = null;
    try { icon = 'data:image/png;base64,' + fs.readFileSync(path.join(dir, a.folder, 'pack_icon.png')).toString('base64'); } catch {}
    return { ...a, enabled: enabled.has(a.uuid), icon, versionText: Array.isArray(a.version) ? a.version.join('.') : String(a.version) };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function toggleAddon(dir, uuid, on) {
  const a = readAddonManifest(dir)[uuid];
  if (!a) throw new Error('Add-on not found');
  setWorldPack(dir, a.kind, uuid, a.version, on);
}

function removeAddon(dir, uuid) {
  const m = readAddonManifest(dir);
  const a = m[uuid];
  if (!a) return;
  setWorldPack(dir, a.kind, uuid, a.version, false);
  fs.rmSync(path.join(dir, a.folder), { recursive: true, force: true });
  delete m[uuid];
  fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify(m, null, 2));
}

module.exports = { importAddon, listAddons, toggleAddon, removeAddon };
