// Version discovery for every supported server type.
const { getJSON, getText, cached } = require('./net');
const T = require('./types');

const HOUR = 60 * 60 * 1000;
const MOJANG_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const FILL = 'https://fill.papermc.io/v3/projects';
const PAPER_API = `${FILL}/paper`;
const PURPUR_API = 'https://api.purpurmc.org/v2/purpur';
const LEAF_API = 'https://api.leafmc.one/v2/projects/leaf';
const MOHIST_API = 'https://api.mohistmc.com/project';
const SPONGE_API = 'https://dl-api.spongepowered.org/v2/groups/org.spongepowered/artifacts/spongevanilla';
const FABRIC_META = 'https://meta.fabricmc.net/v2';
const QUILT_META = 'https://meta.quiltmc.org/v3';
const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge';
const NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases/net/neoforged/neoforge';
const SPIGOT_VERSIONS = 'https://hub.spigotmc.org/versions/';
const BEDROCK_LINKS = 'https://net-secondary.web.minecraft-services.net/api/v1.0/download/links';

const LOADERS = T.IDS;

const mojangManifest = () => cached('mojang', HOUR, () => getJSON(MOJANG_MANIFEST));

async function mojangOrder() {
  const m = await mojangManifest();
  const order = new Map();
  m.versions.forEach((v, i) => order.set(v.id, { i, type: v.type }));
  return order;
}

async function mojangVersionInfo(mc) {
  const m = await mojangManifest();
  const entry = m.versions.find((v) => v.id === mc);
  if (!entry) throw new Error(`Minecraft ${mc} was not found in Mojang's version list`);
  return cached('mojang:' + mc, HOUR * 24, () => getJSON(entry.url));
}

/** Java major version Mojang says this Minecraft version needs. */
async function requiredJava(mc) {
  try {
    const info = await mojangVersionInfo(mc);
    return (info.javaVersion && info.javaVersion.majorVersion) || 8;
  } catch {
    return 21;
  }
}

/** Java major version a server needs (null for Bedrock, which isn't Java). */
async function requiredJavaFor(loader, mc) {
  const t = T.type(loader);
  if (t.bedrock) return null;
  if (t.fill) {
    try {
      const v = await cached(`fill:${t.fill}:${mc}`, HOUR * 6, () => getJSON(`${FILL}/${t.fill}/versions/${encodeURIComponent(mc)}`));
      const min = v.version && v.version.java && v.version.java.version && v.version.java.version.minimum;
      if (min) return Math.max(min, t.proxy ? 0 : await requiredJava(mc));
    } catch {}
    if (t.proxy) return 21;
  }
  return requiredJava(mc);
}

function xmlVersions(xml) {
  return [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
}

function compareNumeric(a, b) {
  const pa = String(a).split(/[.\-+]/).map((x) => parseInt(x, 10));
  const pb = String(b).split(/[.\-+]/).map((x) => parseInt(x, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = Number.isNaN(pa[i]) ? -1 : pa[i] ?? -1;
    const y = Number.isNaN(pb[i]) ? -1 : pb[i] ?? -1;
    if (x !== y) return x - y;
  }
  return 0;
}

const forgeVersions = () => cached('forge', HOUR, async () => xmlVersions(await getText(`${FORGE_MAVEN}/maven-metadata.xml`)));
const forgePromos = () => cached('forge:promos', HOUR, () =>
  getJSON('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json').then((j) => j.promos || {}).catch(() => ({})));
const neoforgeVersions = () => cached('neoforge', HOUR, async () => xmlVersions(await getText(`${NEOFORGE_MAVEN}/maven-metadata.xml`)));
const bedrockLinks = () => cached('bedrock', HOUR, async () => {
  const r = await getJSON(BEDROCK_LINKS);
  const links = (r.result && r.result.links) || [];
  const os = process.platform === 'win32' ? 'Windows' : 'Linux';
  const pick = (type) => {
    const l = links.find((x) => x.downloadType === type);
    const m = l && l.downloadUrl.match(/bedrock-server-([\d.]+)\.zip/);
    return m ? { id: m[1], url: l.downloadUrl } : null;
  };
  return { release: pick(`serverBedrock${os}`), preview: pick(`serverBedrockPreview${os}`) };
});

/** NeoForge encodes the Minecraft version in its own: 21.1.77 -> 1.21.1, 26.3.0.86 -> 26.3 */
function neoforgeToMc(v) {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?(-beta)?$/);
  if (!m) return null;
  const [, a, b, c, d] = m;
  if (d !== undefined) return c === '0' ? `${a}.${b}` : `${a}.${b}.${c}`; // year-based Minecraft (26.x+)
  if (Number(a) >= 25) return null;
  return b === '0' ? `1.${a}` : `1.${a}.${b}`;
}

function isReleaseId(id) {
  return /^\d+(\.\d+)+$/.test(id);
}

/** Bedrock download URL for a version id (the newest release/preview, or an older release by number). */
async function bedrockDownload(version) {
  const l = await bedrockLinks();
  if (l.release && l.release.id === version) return l.release.url;
  if (l.preview && l.preview.id === version) return l.preview.url;
  const os = process.platform === 'win32' ? 'bin-win' : 'bin-linux';
  return `https://www.minecraft.net/bedrockdedicatedserver/${os}/bedrock-server-${version}.zip`;
}

/** Minecraft versions available for a server type, newest first. */
async function listGameVersions(loader, snapshots = false) {
  const t = T.type(loader);
  if (t.bedrock) {
    const l = await bedrockLinks();
    const out = [];
    if (l.release) out.push({ id: l.release.id, type: 'release', label: `${l.release.id} (latest)` });
    if (snapshots && l.preview) out.push({ id: l.preview.id, type: 'snapshot', label: `${l.preview.id} (preview)` });
    return out;
  }
  if (t.proxy) {
    const p = await cached(`fill:${t.fill}`, HOUR, () => getJSON(`${FILL}/${t.fill}`));
    return Object.values(p.versions).flat()
      .sort((a, b) => compareNumeric(b, a) || (a.includes('SNAPSHOT') ? 1 : -1))
      .map((id) => ({ id, type: /SNAPSHOT/i.test(id) ? 'snapshot' : 'release' }))
      .filter((v) => snapshots || v.type === 'release');
  }

  const order = await mojangOrder();
  const keep = (id, type) => snapshots || type === 'release';
  const sortByMojang = (ids) =>
    [...new Set(ids)].sort((a, b) => (order.get(a)?.i ?? 1e9) - (order.get(b)?.i ?? 1e9));
  const typeOf = (id) => order.get(id)?.type || (isReleaseId(id) ? 'release' : 'snapshot');

  let ids = [];
  switch (t.versions) {
    case 'mojang': {
      const m = await mojangManifest();
      ids = m.versions.filter((v) => v.type === 'release' || v.type === 'snapshot').map((v) => v.id);
      break;
    }
    case 'fill': {
      const p = await cached(`fill:${t.fill}`, HOUR, () => getJSON(`${FILL}/${t.fill}`));
      ids = Object.values(p.versions).flat();
      break;
    }
    case 'purpur': {
      const p = await cached('purpur', HOUR, () => getJSON(PURPUR_API));
      ids = p.versions || [];
      break;
    }
    case 'leaf': {
      const p = await cached('leaf', HOUR, () => getJSON(LEAF_API));
      ids = p.versions || [];
      break;
    }
    case 'mohist': {
      // some listed versions have no downloadable builds; only offer the ones that do
      ids = await cached(`mohist:${t.project}`, HOUR, async () => {
        const p = await getJSON(`${MOHIST_API}/${t.project}/versions`);
        const ok = await Promise.all(p.map((v) => getJSON(`${MOHIST_API}/${t.project}/${encodeURIComponent(v.name)}/builds`).then((b) => Array.isArray(b) && b.length > 0).catch(() => false)));
        return p.map((v) => v.name).filter((_, i) => ok[i]);
      });
      break;
    }
    case 'spigot': {
      const html = await cached('spigot', HOUR, () => getText(SPIGOT_VERSIONS));
      ids = [...html.matchAll(/href="(\d+\.\d+(?:\.\d+)?)\.json"/g)].map((m) => m[1]).filter((id) => order.has(id));
      break;
    }
    case 'sponge': {
      const p = await cached('sponge', HOUR, () => getJSON(SPONGE_API));
      ids = ((p.tags && p.tags.minecraft) || []).filter((id) => order.has(id));
      break;
    }
    case 'fabric': {
      const g = await cached('fabric:game', HOUR, () => getJSON(`${FABRIC_META}/versions/game`));
      ids = g.map((v) => v.version).filter((id) => order.has(id));
      break;
    }
    case 'quilt': {
      const g = await cached('quilt:game', HOUR, () => getJSON(`${QUILT_META}/versions/game`));
      ids = g.map((v) => v.version).filter((id) => order.has(id));
      break;
    }
    case 'forge': {
      ids = (await forgeVersions()).map((v) => v.split('-')[0]).filter((id) => order.has(id));
      break;
    }
    case 'neoforge': {
      ids = (await neoforgeVersions()).map(neoforgeToMc).filter((id) => id && order.has(id));
      break;
    }
    default:
      throw new Error('Unknown server type ' + loader);
  }
  ids = sortByMojang(ids);
  return ids.map((id) => ({ id, type: typeOf(id) })).filter((v) => keep(v.id, v.type));
}

/** Loader/build versions for a Minecraft version, newest first. `recommended` marks the default pick. */
async function listLoaderVersions(loader, mc) {
  const t = T.type(loader);
  if (!t.builds) return [];
  switch (t.versions) {
    case 'fill': {
      const builds = await getJSON(`${FILL}/${t.fill}/versions/${encodeURIComponent(mc)}/builds`);
      const list = (Array.isArray(builds) ? builds : builds.builds || [])
        .slice()
        .sort((a, b) => b.id - a.id)
        .slice(0, 30)
        .map((b) => ({ id: String(b.id), label: `Build #${b.id}${b.channel && b.channel !== 'STABLE' ? ' · ' + b.channel.toLowerCase() : ''}`, channel: b.channel }));
      const stable = list.find((b) => b.channel === 'STABLE') || list[0];
      if (stable) stable.recommended = true;
      return list;
    }
    case 'purpur': {
      const v = await getJSON(`${PURPUR_API}/${encodeURIComponent(mc)}`);
      const all = ((v.builds && v.builds.all) || []).slice().sort((a, b) => Number(b) - Number(a)).slice(0, 30);
      const out = all.map((b) => ({ id: String(b), label: `Build #${b}` }));
      if (out[0]) out[0].recommended = true;
      return out;
    }
    case 'leaf': {
      const v = await getJSON(`${LEAF_API}/versions/${encodeURIComponent(mc)}/builds`);
      const out = (v.builds || []).slice().sort((a, b) => b.build - a.build).slice(0, 30)
        .map((b) => ({ id: String(b.build), label: `Build #${b.build}`, file: b.downloads && b.downloads.primary && b.downloads.primary.name }));
      if (out[0]) out[0].recommended = true;
      return out;
    }
    case 'mohist': {
      const list = await getJSON(`${MOHIST_API}/${t.project}/${encodeURIComponent(mc)}/builds`);
      const out = list.slice().sort((a, b) => b.id - a.id).slice(0, 30).map((b) => {
        const l = b.loader || {};
        const base = t.hybrid === 'neoforge' ? l.neoforge_version : l.forge_version;
        return { id: String(b.id), label: `Build #${b.id}${base ? ` · ${t.hybrid === 'neoforge' ? 'NeoForge' : 'Forge'} ${base}` : ''}` };
      });
      if (out[0]) out[0].recommended = true;
      return out;
    }
    case 'sponge': {
      const r = await getJSON(`${SPONGE_API}/versions?tags=${encodeURIComponent(`minecraft:${mc}`)}&limit=25`);
      const out = Object.entries(r.artifacts || {}).map(([id, a]) => ({ id, label: id.replace(`${mc}-`, '') + (a.recommended ? '' : ' · RC'), stable: !!a.recommended }))
        .sort((a, b) => compareNumeric(b.id.replace(/-RC/i, '.'), a.id.replace(/-RC/i, '.')));
      (out.find((v) => v.stable) || out[0] || {}).recommended = true;
      return out;
    }
    case 'fabric': {
      const list = await getJSON(`${FABRIC_META}/versions/loader/${encodeURIComponent(mc)}`);
      const out = list.slice(0, 30).map((e) => ({ id: e.loader.version, label: e.loader.version + (e.loader.stable ? '' : ' · beta'), stable: e.loader.stable }));
      (out.find((v) => v.stable) || out[0] || {}).recommended = true;
      return out;
    }
    case 'quilt': {
      const list = await getJSON(`${QUILT_META}/versions/loader/${encodeURIComponent(mc)}`);
      const out = [...new Set(list.map((e) => e.loader.version))]
        .sort((a, b) => compareNumeric(b, a) || (/beta|pre|rc/i.test(a) ? 1 : -1))
        .slice(0, 30)
        .map((v) => ({ id: v, label: v + (/beta|pre|rc/i.test(v) ? ' · beta' : ''), stable: !/beta|pre|rc/i.test(v) }));
      (out.find((v) => v.stable) || out[0] || {}).recommended = true;
      return out;
    }
    case 'forge': {
      const [all, promos] = await Promise.all([forgeVersions(), forgePromos()]);
      const rec = promos[`${mc}-recommended`];
      const latest = promos[`${mc}-latest`];
      const out = all
        .filter((v) => v.startsWith(mc + '-'))
        .map((full) => ({ full, short: full.slice(mc.length + 1) }))
        .sort((a, b) => compareNumeric(b.short, a.short))
        .map(({ full, short }) => {
          const core = short.split('-')[0];
          const tag = core === rec ? ' · recommended' : core === latest ? ' · latest' : '';
          return { id: full, label: short + tag, recommended: core === rec };
        });
      if (!out.some((v) => v.recommended) && out[0]) out[0].recommended = true;
      return out;
    }
    case 'neoforge': {
      const out = (await neoforgeVersions())
        .filter((v) => neoforgeToMc(v) === mc)
        .sort((a, b) => compareNumeric(b, a))
        .map((v) => ({ id: v, label: v + (v.includes('beta') ? ' · beta' : ''), beta: v.includes('beta') }));
      (out.find((v) => !v.beta) || out[0] || {}).recommended = true;
      return out;
    }
    default:
      return [];
  }
}

module.exports = {
  LOADERS,
  neoforgeToMc,
  compareVersions: compareNumeric,
  FILL,
  PAPER_API,
  PURPUR_API,
  LEAF_API,
  MOHIST_API,
  SPONGE_API,
  FABRIC_META,
  QUILT_META,
  FORGE_MAVEN,
  NEOFORGE_MAVEN,
  mojangVersionInfo,
  mojangManifest,
  requiredJava,
  requiredJavaFor,
  bedrockDownload,
  listGameVersions,
  listLoaderVersions,
};
