// Modrinth modpacks (.mrpack): search, and unpack server-side files into a server folder.
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { getJSON, download } = require('./net');

const MR = 'https://api.modrinth.com/v2';
const SUPPORTED = ['fabric', 'forge', 'neoforge', 'quilt'];

async function searchModpacks({ query = '', offset = 0, sort = 'relevance', limit = 20 }) {
  const facets = [SUPPORTED.map((l) => `categories:${l}`), ['project_type:modpack'], ['server_side:required', 'server_side:optional']];
  const r = await getJSON(`${MR}/search?query=${encodeURIComponent(query)}&facets=${encodeURIComponent(JSON.stringify(facets))}&index=${sort}&offset=${offset}&limit=${limit}`);
  return {
    total: r.total_hits,
    hits: r.hits.map((h) => ({
      id: h.project_id, slug: h.slug, title: h.title, description: h.description, icon: h.icon_url,
      downloads: h.downloads, author: h.author, updated: h.date_modified, versions: h.versions,
      loaders: (h.categories || []).filter((c) => SUPPORTED.includes(c)), url: `https://modrinth.com/modpack/${h.slug}`,
    })),
  };
}

async function modpackVersions(projectId) {
  const list = await getJSON(`${MR}/project/${encodeURIComponent(projectId)}/version`);
  return list
    .filter((v) => v.loaders.some((l) => SUPPORTED.includes(l)))
    .map((v) => ({
      id: v.id, name: v.name, number: v.version_number, type: v.version_type, date: v.date_published,
      gameVersions: v.game_versions, loaders: v.loaders.filter((l) => SUPPORTED.includes(l)),
    }));
}

/** Loader + Minecraft version a modpack version needs (from Modrinth's metadata, before downloading). */
async function modpackTarget(versionId) {
  const v = await getJSON(`${MR}/version/${encodeURIComponent(versionId)}`);
  const loader = v.loaders.find((l) => SUPPORTED.includes(l));
  if (!loader) throw new Error('This modpack uses a loader CraftDock does not support yet (only Fabric, Quilt, Forge and NeoForge).');
  const project = await getJSON(`${MR}/project/${encodeURIComponent(v.project_id)}`);
  return { loader, mcVersion: v.game_versions[0], version: v, project };
}

function safeJoin(root, rel) {
  const p = path.resolve(root, rel);
  if (p !== root && !p.startsWith(root + path.sep)) throw new Error(`Modpack tried to write outside the server folder: ${rel}`);
  return p;
}

async function pool(items, n, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  });
  await Promise.all(workers);
}

/**
 * Downloads a modpack version into `dir`. Returns { loader, mcVersion, loaderVersion } read from the pack index.
 */
async function installModpack(dir, versionId, progress) {
  const v = await getJSON(`${MR}/version/${encodeURIComponent(versionId)}`);
  const file = v.files.find((f) => f.primary) || v.files[0];
  const packPath = path.join(dir, '.modpack.mrpack');
  progress({ step: `Downloading modpack ${v.name}`, pct: 0 });
  await download(file.url, packPath, (g, t) => progress({ step: `Downloading modpack ${v.name}`, pct: t ? g / t : null }));

  const zip = new AdmZip(packPath);
  const indexEntry = zip.getEntry('modrinth.index.json');
  if (!indexEntry) throw new Error('This file is not a valid Modrinth modpack');
  const index = JSON.parse(indexEntry.getData().toString('utf8'));
  const deps = index.dependencies || {};
  const loader = deps['neoforge'] ? 'neoforge' : deps['forge'] ? 'forge' : deps['quilt-loader'] ? 'quilt' : deps['fabric-loader'] ? 'fabric' : null;
  if (!loader) throw new Error('This modpack has no supported mod loader');
  const mcVersion = deps.minecraft;
  let loaderVersion = deps['neoforge'] || deps['forge'] || deps['quilt-loader'] || deps['fabric-loader'];
  if (loader === 'forge' && !loaderVersion.startsWith(mcVersion + '-')) loaderVersion = `${mcVersion}-${loaderVersion}`;

  const root = path.resolve(dir);
  const files = (index.files || []).filter((f) => !(f.env && f.env.server === 'unsupported'));
  let done = 0;
  progress({ step: `Downloading ${files.length} mods`, pct: 0 });
  await pool(files, 6, async (f) => {
    const dest = safeJoin(root, f.path);
    let lastErr;
    for (const url of f.downloads || []) {
      try { await download(url, dest); lastErr = null; break; } catch (e) { lastErr = e; }
    }
    if (lastErr) throw new Error(`Could not download ${path.basename(f.path)}: ${lastErr.message}`);
    done++;
    progress({ step: `Downloading mods (${done}/${files.length})`, pct: done / files.length, detail: path.basename(f.path) });
  });

  progress({ step: 'Copying modpack configs', pct: null });
  for (const prefix of ['overrides/', 'server-overrides/']) {
    for (const e of zip.getEntries()) {
      if (!e.entryName.startsWith(prefix) || e.isDirectory) continue;
      const dest = safeJoin(root, e.entryName.slice(prefix.length));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, e.getData());
    }
  }
  fs.rmSync(packPath, { force: true });
  return { loader, mcVersion, loaderVersion, name: index.name, packVersion: index.versionId, clientOnlySkipped: (index.files || []).length - files.length };
}

module.exports = { searchModpacks, modpackVersions, modpackTarget, installModpack };
