// Mod / plugin / datapack browsing and installation from Modrinth and CurseForge.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { getJSON, postJSON, download } = require('./net');
const props = require('./properties');
const T = require('./types');

const MR = 'https://api.modrinth.com/v2';
const CF = 'https://api.curseforge.com/v1';
const GEYSER_API = 'https://download.geysermc.org/v2/projects';
const MANIFEST = 'craftdock-mods.json';

// Server-side performance mods offered when creating a server ([slug, on by default, why, kind]).
const FABRIC_PERF = [
  ['fabric-api', true, 'Needed by almost every Fabric mod'],
  ['lithium', true, 'Faster mobs, redstone and physics. No gameplay changes'],
  ['ferrite-core', true, 'Uses a lot less RAM'],
  ['krypton', true, 'Leaner, faster networking'],
  ['modernfix', true, 'Faster startup and lower memory use'],
  ['noisium', true, 'Faster world generation'],
  ['spark', true, 'Lag profiler: run /spark to see what is slow'],
  ['c2me-fabric', false, 'Multithreaded chunk loading (advanced, can clash with some mods)'],
  ['servercore', false, 'Dynamic view distance and entity limits for big servers'],
  ['chunky', false, 'Pre-generate the world so exploring never lags'],
];
const PLUGIN_PERF = [['chunky', true, 'Pre-generate the world so exploring never lags']];
const PERF = {
  fabric: FABRIC_PERF,
  quilt: FABRIC_PERF,
  neoforge: [
    ['lithium', true, 'Faster mobs, redstone and physics. No gameplay changes'],
    ['ferrite-core', true, 'Uses a lot less RAM'],
    ['modernfix', true, 'Faster startup and lower memory use'],
    ['noisium', true, 'Faster world generation'],
    ['spark', true, 'Lag profiler: run /spark to see what is slow'],
    ['servercore', false, 'Dynamic view distance and entity limits for big servers'],
    ['chunky', false, 'Pre-generate the world so exploring never lags'],
  ],
  forge: [
    ['ferrite-core', true, 'Uses a lot less RAM'],
    ['modernfix', true, 'Faster startup and lower memory use'],
    ['noisium', true, 'Faster world generation'],
    ['spark', true, 'Lag profiler: run /spark to see what is slow'],
    ['servercore', false, 'Dynamic view distance and entity limits for big servers'],
    ['chunky', false, 'Pre-generate the world so exploring never lags'],
  ],
  paper: [['chunky', true, 'Pre-generate the world so exploring never lags (Paper already includes spark)']],
  purpur: [['chunky', true, 'Pre-generate the world so exploring never lags (Purpur already includes spark)']],
  leaf: [['chunky', true, 'Pre-generate the world so exploring never lags (Leaf already includes spark)']],
  folia: [['chunky', true, 'Pre-generate the world so exploring never lags']],
  spigot: [...PLUGIN_PERF, ['spark', true, 'Lag profiler: run /spark to see what is slow']],
  mohist: [['ferrite-core', true, 'Uses a lot less RAM', 'mod'], ['spark', true, 'Lag profiler: run /spark to see what is slow', 'mod'], ['chunky', false, 'Pre-generate the world so exploring never lags', 'plugin']],
  youer: [['ferrite-core', true, 'Uses a lot less RAM', 'mod'], ['spark', true, 'Lag profiler: run /spark to see what is slow', 'mod'], ['chunky', false, 'Pre-generate the world so exploring never lags', 'plugin']],
  vanilla: [],
};

/** The content kinds a server type supports ('mod' | 'plugin' | 'datapack' | 'addon'), first is the main one. */
const contentKinds = (loader) => T.contentKinds(loader);
const DATAPACK = { kind: 'datapack', dir: 'datapacks', mr: ['datapack'], cf: { classId: 6945 } };
/** Content definition for a kind; datapacks work on every Java game server, not just Vanilla. */
function defFor(loader, kind) {
  if (kind === 'datapack' && T.isJavaGame(loader)) return DATAPACK;
  return T.contentDef(loader, kind);
}
const contentKind = (loader) => contentKinds(loader)[0] || 'mod';
const mrLoaders = (loader, kind) => (defFor(loader, kind) || { mr: [] }).mr;

/** Performance mods for a loader + Minecraft version, with whether each has a compatible version. */
async function recommended(loader, mc) {
  const list = PERF[loader] || [];
  if (!list.length) return [];
  const slugs = [...new Set(list.map(([s]) => s))];
  const projects = await getJSON(`${MR}/projects?ids=${encodeURIComponent(JSON.stringify(slugs))}`);
  const bySlug = Object.fromEntries(projects.map((p) => [p.slug, p]));
  return Promise.all(list.map(async ([slug, on, why, kind]) => {
    const p = bySlug[slug] || {};
    let version = null;
    try {
      const vs = await modrinthVersions(slug, loader, mc, kind);
      version = (vs.find((v) => v.type === 'release') || vs[0] || null);
    } catch {}
    return { slug, kind: kind || contentKind(loader), projectId: p.id || slug, title: p.title || slug, icon: p.icon_url || null, why, default: on, available: !!version, versionId: version ? version.id : null, version: version ? version.number : null };
  }));
}

function levelName(dir) {
  return props.read(path.join(dir, 'server.properties'))['level-name'] || 'world';
}

function contentDir(cfg, dir, kind) {
  const def = defFor(cfg.loader, kind);
  if (!def || !def.dir) throw new Error('This server type has no add-on folder');
  if (def.kind === 'datapack') return path.join(dir, levelName(dir), 'datapacks');
  return path.join(dir, def.dir);
}

function readManifest(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8')); } catch { return {}; }
}
function writeManifest(dir, m) {
  fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify(m, null, 2));
}

function sha1(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

// ---------- reading metadata from jar files that were added by hand ----------
const metaCache = new Map();
function tomlValue(text, key) {
  const m = text.match(new RegExp(`^\\s*${key}\\s*=\\s*(?:"""([\\s\\S]*?)"""|"([^"]*)"|'([^']*)')`, 'm'));
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}
function yamlValue(text, key) {
  const m = text.match(new RegExp(`^${key}\\s*:\\s*['"]?([^'"\\r\\n]+)`, 'm'));
  return m ? m[1].trim() : null;
}
function iconData(zip, p) {
  if (!p) return null;
  const e = zip.getEntry(String(p).replace(/^\//, ''));
  if (!e || e.header.size > 300000) return null;
  return 'data:image/png;base64,' + e.getData().toString('base64');
}
function readJarMeta(file) {
  const st = fs.statSync(file);
  if (st.isDirectory()) return {};
  const key = `${file}|${st.size}|${st.mtimeMs}`;
  if (metaCache.has(key)) return metaCache.get(key);
  let meta = {};
  try {
    const zip = new AdmZip(file);
    const text = (name) => { const e = zip.getEntry(name); return e ? e.getData().toString('utf8') : null; };
    let t;
    if ((t = text('fabric.mod.json'))) {
      const j = JSON.parse(t.replace(/^ï»¿/, ''));
      meta = { title: j.name || j.id, version: j.version, icon: iconData(zip, typeof j.icon === 'string' ? j.icon : j.icon && Object.values(j.icon).pop()) };
    } else if ((t = text('quilt.mod.json'))) {
      const j = JSON.parse(t).quilt_loader || {};
      meta = { title: (j.metadata && j.metadata.name) || j.id, version: j.version };
    } else if ((t = text('META-INF/neoforge.mods.toml') || text('META-INF/mods.toml'))) {
      let version = tomlValue(t, 'version');
      if (!version || version.includes('${')) {
        const mf = text('META-INF/MANIFEST.MF') || '';
        const m = mf.match(/Implementation-Version:\s*(\S+)/);
        version = m ? m[1] : null;
      }
      meta = { title: tomlValue(t, 'displayName') || tomlValue(t, 'modId'), version, icon: iconData(zip, tomlValue(t, 'logoFile')) };
    } else if ((t = text('paper-plugin.yml') || text('plugin.yml'))) {
      meta = { title: yamlValue(t, 'name'), version: yamlValue(t, 'version') };
    } else if ((t = text('velocity-plugin.json'))) {
      const j = JSON.parse(t);
      meta = { title: j.name || j.id, version: j.version };
    } else if ((t = text('META-INF/sponge_plugins.json'))) {
      const j = JSON.parse(t);
      const p = (j.plugins || [])[0] || {};
      meta = { title: p.name || p.id, version: p.version };
    } else if ((t = text('pack.mcmeta'))) {
      meta = { title: null, icon: iconData(zip, 'pack.png') };
    }
  } catch {}
  metaCache.set(key, meta);
  return meta;
}

// ---------- Modrinth ----------
function mrHit(h) {
  return {
    source: 'modrinth', id: h.project_id, slug: h.slug, title: h.title, description: h.description,
    icon: h.icon_url || null, downloads: h.downloads, follows: h.follows, author: h.author,
    updated: h.date_modified, categories: h.display_categories || h.categories || [],
    serverSide: h.server_side, clientSide: h.client_side, gallery: (h.gallery || []).slice(0, 4),
    url: `https://modrinth.com/${h.project_type}/${h.slug}`,
  };
}

const MR_CATEGORIES = {
  mod: ['adventure', 'decoration', 'economy', 'equipment', 'food', 'game-mechanics', 'library', 'magic', 'management', 'minigame', 'mobs', 'optimization', 'social', 'storage', 'technology', 'transportation', 'utility', 'worldgen'],
  plugin: ['adventure', 'economy', 'game-mechanics', 'library', 'management', 'minigame', 'mobs', 'optimization', 'social', 'transportation', 'utility', 'worldgen'],
  datapack: ['adventure', 'decoration', 'equipment', 'food', 'game-mechanics', 'magic', 'mobs', 'optimization', 'storage', 'technology', 'utility', 'worldgen'],
};

async function searchModrinth({ query = '', loader, mc, kind, category, offset = 0, sort = 'relevance', limit = 20 }) {
  const k = kind || contentKind(loader);
  const projectType = k === 'datapack' ? 'datapack' : k === 'plugin' ? 'plugin' : 'mod';
  const facets = [mrLoaders(loader, k).map((l) => `categories:${l}`), [`project_type:${projectType}`]];
  if (!T.isProxy(loader)) facets.push([`versions:${mc}`]);
  if (projectType === 'mod') facets.push(['server_side:required', 'server_side:optional']);
  if (category) facets.push([`categories:${category}`]);
  const url = `${MR}/search?query=${encodeURIComponent(query)}&facets=${encodeURIComponent(JSON.stringify(facets))}` +
    `&index=${sort}&offset=${offset}&limit=${limit}`;
  const r = await getJSON(url);
  return { total: r.total_hits, hits: r.hits.map(mrHit) };
}

async function modrinthVersions(projectId, loader, mc, kind) {
  const loaders = mrLoaders(loader, kind);
  let url = `${MR}/project/${encodeURIComponent(projectId)}/version?loaders=${encodeURIComponent(JSON.stringify(loaders))}`;
  if (!T.isProxy(loader)) url += `&game_versions=${encodeURIComponent(JSON.stringify([mc]))}`;
  const list = await getJSON(url);
  return list.map((v) => ({
    id: v.id, name: v.name, number: v.version_number, type: v.version_type, date: v.date_published,
    downloads: v.downloads, changelog: (v.changelog || '').slice(0, 4000), raw: v,
  }));
}

async function modrinthProject(id) {
  const p = await getJSON(`${MR}/project/${encodeURIComponent(id)}`);
  return {
    id: p.id, slug: p.slug, title: p.title, description: p.description, body: (p.body || '').slice(0, 20000),
    icon: p.icon_url, downloads: p.downloads, followers: p.followers, categories: p.categories,
    gallery: (p.gallery || []).map((g) => ({ url: g.url, title: g.title })).slice(0, 8),
    links: { source: p.source_url, issues: p.issues_url, wiki: p.wiki_url, discord: p.discord_url },
    license: p.license && p.license.id, updated: p.updated, serverSide: p.server_side, clientSide: p.client_side,
    url: `https://modrinth.com/${p.project_type}/${p.slug}`,
  };
}

// ---------- CurseForge ----------
function cfHeaders(key) {
  if (!key) {
    const e = new Error('CurseForge needs a free API key. Add one in Settings â†’ CurseForge.');
    e.code = 'NO_CF_KEY';
    throw e;
  }
  return { 'x-api-key': key };
}
function cfDef(loader, kind) {
  const def = defFor(loader, kind);
  if (!def || !def.cf) {
    const e = new Error(`CurseForge doesn't have ${def ? def.kind + 's' : 'content'} for this server type. Use Modrinth instead.`);
    e.code = 'CF_UNSUPPORTED';
    throw e;
  }
  return def;
}

async function searchCurseForge({ query = '', loader, mc, kind, offset = 0, sort = 'relevance', limit = 20, key }) {
  const def = cfDef(loader, kind);
  const sortField = { relevance: 1, downloads: 6, updated: 3, newest: 3, follows: 2 }[sort] || 2;
  const p = new URLSearchParams({
    gameId: '432', classId: String(def.cf.classId), searchFilter: query, sortField: String(query ? 2 : sortField),
    sortOrder: 'desc', pageSize: String(limit), index: String(Math.min(offset, 9980)),
  });
  if (def.kind !== 'plugin') p.set('gameVersion', mc);
  if (def.cf.loader) p.set('modLoaderType', String(def.cf.loader));
  const r = await getJSON(`${CF}/mods/search?${p}`, { headers: cfHeaders(key) });
  return {
    total: Math.min(r.pagination ? r.pagination.totalCount : r.data.length, 10000),
    hits: r.data.map((m) => ({
      source: 'curseforge', id: String(m.id), slug: m.slug, title: m.name, description: m.summary,
      icon: (m.logo && (m.logo.thumbnailUrl || m.logo.url)) || null, downloads: m.downloadCount,
      author: m.authors && m.authors[0] && m.authors[0].name, updated: m.dateModified,
      categories: (m.categories || []).map((c) => c.name).slice(0, 3),
      url: (m.links && m.links.websiteUrl) || `https://www.curseforge.com/minecraft/search?search=${encodeURIComponent(m.name)}`,
    })),
  };
}

async function curseforgeFiles(modId, loader, mc, key, kind) {
  const def = cfDef(loader, kind);
  const headers = cfHeaders(key);
  const base = `${CF}/mods/${encodeURIComponent(modId)}/files?pageSize=50`;
  const loaderQ = def.cf.loader ? `&modLoaderType=${def.cf.loader}` : '';
  let r = await getJSON(`${base}&gameVersion=${encodeURIComponent(mc)}${loaderQ}`, { headers });
  let files = r.data;
  if (!files.length && def.kind !== 'mod') {
    r = await getJSON(base, { headers });
    files = r.data;
  }
  return files
    .sort((a, b) => new Date(b.fileDate) - new Date(a.fileDate))
    .map((f) => ({
      id: String(f.id), name: f.displayName, number: f.fileName, type: ['', 'release', 'beta', 'alpha'][f.releaseType] || 'release',
      date: f.fileDate, downloads: f.downloadCount, raw: f,
    }));
}

// ---------- install / manage ----------
class ModService {
  constructor(getKey) {
    this.getKey = getKey;
  }

  async search(source, params) {
    return source === 'curseforge'
      ? searchCurseForge({ ...params, key: this.getKey() })
      : searchModrinth(params);
  }

  async versions(source, projectId, cfg, kind) {
    return source === 'curseforge'
      ? curseforgeFiles(projectId, cfg.loader, cfg.mcVersion, this.getKey(), kind)
      : modrinthVersions(projectId, cfg.loader, cfg.mcVersion, kind);
  }

  project(id) {
    return modrinthProject(id);
  }

  /** Installs a project (and its required dependencies). Returns { installed: [titles], warnings: [] }. */
  async install(cfg, dir, source, projectId, versionId, onProgress, kind) {
    const result = { installed: [], warnings: [] };
    const visited = new Set();
    const k = (defFor(cfg.loader, kind) || {}).kind;
    const target = contentDir(cfg, dir, k);
    await fs.promises.mkdir(target, { recursive: true });
    const manifest = readManifest(dir);
    const has = (pid) => Object.values(manifest).some((m) => m.projectId === pid);

    const removeOld = (pid, keepFile) => {
      for (const [file, m] of Object.entries(manifest)) {
        if (m.projectId === pid && file !== keepFile && (m.kind || contentKind(cfg.loader)) === k) {
          for (const f of [file, file + '.disabled']) fs.rmSync(path.join(target, f), { force: true });
          delete manifest[file];
        }
      }
    };

    const installMr = async (pid, vid, isDep) => {
      if (visited.has(pid)) return;
      visited.add(pid);
      const project = await getJSON(`${MR}/project/${encodeURIComponent(pid)}`);
      let version;
      if (vid) version = await getJSON(`${MR}/version/${encodeURIComponent(vid)}`);
      else {
        const list = await modrinthVersions(pid, cfg.loader, cfg.mcVersion, k);
        const pick = list.find((v) => v.type === 'release') || list[0];
        if (!pick) throw new Error(`${project.title} has no version for ${cfg.loader} ${cfg.mcVersion}`);
        version = pick.raw;
      }
      const file = version.files.find((f) => f.primary) || version.files[0];
      onProgress && onProgress({ step: `Downloading ${project.title}`, pct: 0 });
      await download(file.url, path.join(target, file.filename), (g, t) => onProgress && onProgress({ step: `Downloading ${project.title}`, pct: t ? g / t : null }));
      removeOld(project.id, file.filename);
      manifest[file.filename] = { source: 'modrinth', kind: k, projectId: project.id, versionId: version.id, version: version.version_number, title: project.title, icon: project.icon_url || null, url: `https://modrinth.com/${project.project_type}/${project.slug}` };
      result.installed.push(project.title + (isDep ? ' (dependency)' : ''));
      for (const dep of version.dependencies || []) {
        if (dep.dependency_type !== 'required' || !dep.project_id || has(dep.project_id)) continue;
        try { await installMr(dep.project_id, null, true); }
        catch (e) { result.warnings.push(`Dependency could not be installed: ${e.message}`); }
      }
    };

    const installCf = async (mid, fid, isDep) => {
      if (visited.has(mid)) return;
      visited.add(mid);
      const key = this.getKey();
      const mod = (await getJSON(`${CF}/mods/${encodeURIComponent(mid)}`, { headers: cfHeaders(key) })).data;
      let file;
      if (fid) file = (await getJSON(`${CF}/mods/${mid}/files/${fid}`, { headers: cfHeaders(key) })).data;
      else {
        const list = await curseforgeFiles(mid, cfg.loader, cfg.mcVersion, key, k);
        const pick = list.find((f) => f.type === 'release') || list[0];
        if (!pick) throw new Error(`${mod.name} has no file for ${cfg.loader} ${cfg.mcVersion}`);
        file = pick.raw;
      }
      if (!file.downloadUrl) {
        const e = new Error(`The author of "${mod.name}" doesn't allow downloads from other apps. Download it on CurseForge, then drag the file into this list.`);
        e.url = mod.links && mod.links.websiteUrl;
        throw e;
      }
      onProgress && onProgress({ step: `Downloading ${mod.name}`, pct: 0 });
      await download(file.downloadUrl, path.join(target, file.fileName), (g, t) => onProgress && onProgress({ step: `Downloading ${mod.name}`, pct: t ? g / t : null }));
      removeOld(String(mid), file.fileName);
      manifest[file.fileName] = { source: 'curseforge', kind: k, projectId: String(mid), versionId: String(file.id), version: file.displayName, title: mod.name, icon: mod.logo && mod.logo.thumbnailUrl, url: mod.links && mod.links.websiteUrl };
      result.installed.push(mod.name + (isDep ? ' (dependency)' : ''));
      for (const dep of file.dependencies || []) {
        if (dep.relationType !== 3 || has(String(dep.modId))) continue;
        try { await installCf(String(dep.modId), null, true); }
        catch (e) { result.warnings.push(`Dependency could not be installed: ${e.message}`); }
      }
    };

    try {
      if (source === 'curseforge') await installCf(String(projectId), versionId, false);
      else await installMr(projectId, versionId, false);
    } finally {
      writeManifest(dir, manifest);
    }
    return result;
  }

  /** Downloads a file from a direct URL (used for Geyser/Floodgate builds that aren't on Modrinth). */
  async installUrl(cfg, dir, url, fileName, meta, kind) {
    const k = (defFor(cfg.loader, kind) || {}).kind;
    const target = contentDir(cfg, dir, k);
    await download(url, path.join(target, fileName));
    const manifest = readManifest(dir);
    manifest[fileName] = { source: 'direct', kind: k, ...meta };
    writeManifest(dir, manifest);
  }

  list(cfg, dir, kind) {
    const def = defFor(cfg.loader, kind);
    if (!def || !def.dir) return [];
    const target = contentDir(cfg, dir, def.kind);
    if (!fs.existsSync(target)) return [];
    const manifest = readManifest(dir);
    const datapack = def.kind === 'datapack';
    return fs.readdirSync(target, { withFileTypes: true })
      .filter((e) => (e.isFile() && /\.(jar|zip)(\.disabled)?$/i.test(e.name)) || (datapack && e.isDirectory() && e.name !== 'bukkit' && fs.existsSync(path.join(target, e.name, 'pack.mcmeta'))))
      .map((e) => {
        const f = e.name;
        const full = path.join(target, f);
        const enabled = !f.endsWith('.disabled');
        const base = enabled ? f : f.slice(0, -'.disabled'.length);
        const st = fs.statSync(full);
        const m = manifest[base] || {};
        const meta = m.title ? {} : readJarMeta(full);
        return {
          file: base, kind: def.kind, enabled, size: e.isDirectory() ? 0 : st.size, mtime: st.mtimeMs, folder: e.isDirectory(),
          title: m.title || meta.title || base.replace(/\.(jar|zip)$/i, ''),
          version: m.version || meta.version || '', icon: m.icon || meta.icon || null,
          source: m.source === 'direct' ? 'local' : m.source || 'local', projectId: m.projectId || null, url: m.url || null,
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  toggle(cfg, dir, file, enabled, kind) {
    const target = contentDir(cfg, dir, kind);
    const on = path.join(target, path.basename(file));
    const off = on + '.disabled';
    if (enabled && fs.existsSync(off)) fs.renameSync(off, on);
    if (!enabled && fs.existsSync(on)) fs.renameSync(on, off);
  }

  remove(cfg, dir, file, kind) {
    const target = contentDir(cfg, dir, kind);
    for (const f of [file, file + '.disabled']) fs.rmSync(path.join(target, path.basename(f)), { recursive: true, force: true });
    const manifest = readManifest(dir);
    delete manifest[file];
    writeManifest(dir, manifest);
  }

  addFiles(cfg, dir, files, kind) {
    const target = contentDir(cfg, dir, kind);
    fs.mkdirSync(target, { recursive: true });
    const added = [];
    for (const f of files) {
      if (!/\.(jar|zip)$/i.test(f)) continue;
      fs.copyFileSync(f, path.join(target, path.basename(f)));
      added.push(path.basename(f));
    }
    return added;
  }

  /** Identifies installed files on Modrinth by hash and reports newer compatible versions (all content kinds). */
  async checkUpdates(cfg, dir, kind) {
    const kinds = kind ? [kind] : contentKinds(cfg.loader).filter((k) => k !== 'addon');
    const updates = [];
    for (const k of kinds) {
      const def = defFor(cfg.loader, k);
      if (!def || !def.dir || !def.mr.length) continue;
      const target = contentDir(cfg, dir, k);
      if (!fs.existsSync(target)) continue;
      const files = fs.readdirSync(target).filter((f) => /\.(jar|zip)$/i.test(f) && fs.statSync(path.join(target, f)).isFile());
      const byHash = {};
      for (const f of files) byHash[await sha1(path.join(target, f))] = f;
      const hashes = Object.keys(byHash);
      if (!hashes.length) continue;
      const updateBody = { hashes, algorithm: 'sha1', loaders: def.mr };
      if (!T.isProxy(cfg.loader)) updateBody.game_versions = [cfg.mcVersion];
      const [current, latest] = await Promise.all([
        postJSON(`${MR}/version_files`, { hashes, algorithm: 'sha1' }),
        postJSON(`${MR}/version_files/update`, updateBody),
      ]);
      const ids = [...new Set(Object.values(current).map((v) => v.project_id))];
      const projects = ids.length ? await getJSON(`${MR}/projects?ids=${encodeURIComponent(JSON.stringify(ids))}`) : [];
      const pmap = Object.fromEntries(projects.map((p) => [p.id, p]));
      const manifest = readManifest(dir);
      for (const [hash, file] of Object.entries(byHash)) {
        const cur = current[hash];
        if (!cur) continue;
        const p = pmap[cur.project_id] || {};
        if (!manifest[file] || manifest[file].source !== 'curseforge') {
          manifest[file] = { source: 'modrinth', kind: k, projectId: cur.project_id, versionId: cur.id, version: cur.version_number, title: p.title || file, icon: p.icon_url || null, url: p.slug ? `https://modrinth.com/${p.project_type}/${p.slug}` : null };
        }
        const next = latest[hash];
        // Same Minecraft version: only move forward in time. If the installed file isn't made for this
        // Minecraft version (e.g. after a version change), any compatible version is the right one,
        // even if it was published earlier.
        const curFits = T.isProxy(cfg.loader) || (cur.game_versions || []).includes(cfg.mcVersion);
        if (next && next.id !== cur.id && (!curFits || new Date(next.date_published) > new Date(cur.date_published))) {
          updates.push({ file, kind: k, title: p.title || file, icon: p.icon_url || null, from: cur.version_number, to: next.version_number, projectId: cur.project_id, versionId: next.id });
        }
      }
      writeManifest(dir, manifest);
    }
    return updates;
  }

  /** Installs a list of performance mods, skipping ones already installed or unavailable. */
  async installMany(cfg, dir, slugs, log) {
    const result = { installed: [], skipped: [] };
    const have = new Set(contentKinds(cfg.loader).flatMap((k) => this.list(cfg, dir, k)).map((m) => m.projectId).filter(Boolean));
    const recs = await recommended(cfg.loader, cfg.mcVersion);
    for (const slug of slugs) {
      const r = recs.find((x) => x.slug === slug);
      if (!r) continue;
      if (have.has(r.projectId)) { result.skipped.push(`${r.title} (already installed)`); continue; }
      if (!r.available) { result.skipped.push(`${r.title} (no version for ${cfg.mcVersion} yet)`); log && log(`${r.title} has no version for ${cfg.mcVersion} yet, skipped`); continue; }
      try {
        log && log(`Installing ${r.title} ${r.version}`);
        const res = await this.install(cfg, dir, 'modrinth', r.projectId, r.versionId, null, r.kind);
        result.installed.push(...res.installed);
        // dependencies pulled in by this mod count as installed too
        contentKinds(cfg.loader).flatMap((k) => this.list(cfg, dir, k)).forEach((m) => m.projectId && have.add(m.projectId));
      } catch (e) {
        result.skipped.push(`${r.title} (${e.message})`);
        log && log(`Could not install ${r.title}: ${e.message}`);
      }
    }
    return result;
  }

  /**
   * Updates every Modrinth-identified mod/plugin to the newest version for the server's current
   * Minecraft version (old jars are deleted). With `disableIncompatible`, mods that have no version
   * for this Minecraft version are turned off so the server can still start.
   */
  async updateAll(cfg, dir, { disableIncompatible = false, log } = {}) {
    const out = { updated: [], disabled: [], failed: [] };
    const updates = await this.checkUpdates(cfg, dir);
    for (const u of updates) {
      try {
        await this.install(cfg, dir, 'modrinth', u.projectId, u.versionId, null, u.kind);
        out.updated.push(`${u.title} ${u.from} â†’ ${u.to}`);
        log && log(`Updated ${u.title} ${u.from} â†’ ${u.to}`);
      } catch (e) {
        out.failed.push(`${u.title}: ${e.message}`);
        log && log(`Could not update ${u.title}: ${e.message}`);
      }
    }
    if (disableIncompatible && !T.isProxy(cfg.loader)) {
      for (const k of contentKinds(cfg.loader).filter((x) => x === 'mod' || x === 'plugin')) {
        const target = contentDir(cfg, dir, k);
        const files = fs.existsSync(target) ? fs.readdirSync(target).filter((f) => /\.jar$/i.test(f)) : [];
        const byHash = {};
        for (const f of files) byHash[await sha1(path.join(target, f))] = f;
        const hashes = Object.keys(byHash);
        if (!hashes.length) continue;
        const current = await postJSON(`${MR}/version_files`, { hashes, algorithm: 'sha1' });
        const manifest = readManifest(dir);
        for (const [hash, v] of Object.entries(current)) {
          if (v.game_versions.includes(cfg.mcVersion)) continue;
          const file = byHash[hash];
          const title = (manifest[file] && manifest[file].title) || file;
          this.toggle(cfg, dir, file, false, k);
          out.disabled.push(title);
          log && log(`${title} has no version for ${cfg.mcVersion} yet, so it was turned off (turn it back on in the ${k === 'plugin' ? 'Plugins' : 'Mods'} tab)`);
        }
      }
    }
    return out;
  }

  /**
   * Bedrock cross-play: installs Geyser (+ Floodgate so Bedrock players don't need a Java account).
   * Returns { installed: [], warnings: [] }.
   */
  async installGeyser(cfg, dir, log) {
    const out = { installed: [], warnings: [] };
    const fam = T.type(cfg.loader).family;
    const platform = cfg.loader === 'velocity' ? 'velocity' : fam === 'bukkit' ? 'spigot' : ['fabric', 'quilt'].includes(cfg.loader) ? 'fabric' : cfg.loader === 'neoforge' ? 'neoforge' : null;
    if (!platform) throw new Error(`Geyser doesn't run on ${cfg.loader} servers. Use Paper, Fabric, NeoForge or a Velocity proxy.`);
    const kind = platform === 'spigot' || platform === 'velocity' ? 'plugin' : 'mod';
    if (kind === 'mod') {
      // the Fabric/NeoForge builds of Geyser only run on the newest Minecraft release
      const newest = (await getJSON('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')).latest.release;
      if (cfg.mcVersion !== newest) throw new Error(`Geyser for ${platform === 'fabric' ? 'Fabric' : 'NeoForge'} only works on Minecraft ${newest}. For cross-play on ${cfg.mcVersion}, use a Paper server or put a Velocity proxy in front.`);
    }
    if (platform === 'spigot' || platform === 'velocity') {
      for (const [project, file, title] of [['geyser', `Geyser-${platform === 'spigot' ? 'Spigot' : 'Velocity'}.jar`, 'Geyser'], ['floodgate', `floodgate-${platform}.jar`, 'Floodgate']]) {
        log && log(`Downloading ${title}`);
        try {
          await this.installUrl(cfg, dir, `${GEYSER_API}/${project}/versions/latest/builds/latest/downloads/${platform}`, file, { title, url: `https://geysermc.org/download`, version: 'latest' }, kind);
          out.installed.push(title);
        } catch (e) { out.warnings.push(`${title}: ${e.message}`); }
      }
      // Geyser always speaks the newest Java protocol; older servers need ViaVersion to understand it
      try {
        const newest = (await getJSON('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')).latest.release;
        if (platform === 'velocity' || cfg.mcVersion !== newest) {
          let url = `${MR}/project/viaversion/version?loaders=${encodeURIComponent(JSON.stringify(platform === 'velocity' ? ['velocity'] : ['paper', 'spigot', 'bukkit']))}`;
          if (platform !== 'velocity') url += `&game_versions=${encodeURIComponent(JSON.stringify([cfg.mcVersion]))}`;
          const vs = await getJSON(url);
          const v = vs.find((x) => x.version_type === 'release') || vs[0];
          if (v) {
            log && log('Installing ViaVersion (lets Geyser talk to this Minecraft version)');
            await this.install(cfg, dir, 'modrinth', v.project_id, v.id, null, kind);
            out.installed.push('ViaVersion');
          }
        }
      } catch (e) { out.warnings.push(`ViaVersion: ${e.message}`); }
    } else {
      for (const slug of ['geyser', 'floodgate']) {
        try {
          const r = await this.install(cfg, dir, 'modrinth', slug, null, null, kind);
          out.installed.push(...r.installed);
          out.warnings.push(...r.warnings);
        } catch (e) { out.warnings.push(`${slug}: ${e.message}`); }
      }
    }
    return out;
  }
}

module.exports = { ModService, contentKind, contentKinds, contentDir, recommended, readJarMeta, MR_CATEGORIES };
