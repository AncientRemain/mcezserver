// Every server type CraftDock can run, and the facts the rest of the backend needs about it.
//
// family decides how the server behaves:
//   vanilla / fabric / forge / neoforge / sponge  - Mojang world layout (Nether + End inside the world folder)
//   bukkit                                       - Bukkit layout (world_nether / world_the_end next to the world)
//   proxy                                        - Velocity: no world, configured through velocity.toml
//   bedrock                                      - Bedrock Dedicated Server: native exe, no Java
//
// content lists what can be added from Modrinth / CurseForge:
//   kind   mod | plugin | datapack | addon
//   mr     Modrinth loader tags that are compatible
//   cf     CurseForge { classId, loader } (null = not on CurseForge)

const C = {
  datapack: { kind: 'datapack', dir: 'datapacks', mr: ['datapack'], cf: { classId: 6945 } },
  bukkitPlugins: (mr) => ({ kind: 'plugin', dir: 'plugins', mr, cf: { classId: 5 } }),
  mods: (mr, cfLoader) => ({ kind: 'mod', dir: 'mods', mr, cf: cfLoader ? { classId: 6, loader: cfLoader } : null }),
};

const TYPES = {
  vanilla: { family: 'vanilla', content: [C.datapack], versions: 'mojang', tps: 'vanilla' },
  paper: { family: 'bukkit', content: [C.bukkitPlugins(['paper', 'spigot', 'bukkit'])], versions: 'fill', fill: 'paper', builds: true, tps: 'bukkit' },
  purpur: { family: 'bukkit', content: [C.bukkitPlugins(['purpur', 'paper', 'spigot', 'bukkit'])], versions: 'purpur', builds: true, tps: 'bukkit' },
  folia: { family: 'bukkit', content: [{ kind: 'plugin', dir: 'plugins', mr: ['folia'], cf: null }], versions: 'fill', fill: 'folia', builds: true, tps: 'bukkit' },
  leaf: { family: 'bukkit', content: [C.bukkitPlugins(['paper', 'spigot', 'bukkit'])], versions: 'leaf', builds: true, tps: 'bukkit' },
  spigot: { family: 'bukkit', content: [C.bukkitPlugins(['spigot', 'bukkit'])], versions: 'spigot', builds: false, tps: 'bukkit' },
  sponge: { family: 'sponge', content: [{ kind: 'plugin', dir: 'mods', mr: ['sponge'], cf: null }], versions: 'sponge', builds: true, tps: 'vanilla' },
  fabric: { family: 'fabric', content: [C.mods(['fabric'], 4)], versions: 'fabric', builds: true, tps: 'vanilla' },
  quilt: { family: 'fabric', content: [C.mods(['quilt', 'fabric'], 5)], versions: 'quilt', builds: true, tps: 'vanilla' },
  forge: { family: 'forge', content: [C.mods(['forge'], 1)], versions: 'forge', builds: true, tps: 'forge' },
  neoforge: { family: 'neoforge', content: [C.mods(['neoforge'], 6)], versions: 'neoforge', builds: true, tps: 'vanilla' },
  mohist: { family: 'bukkit', hybrid: 'forge', content: [C.mods(['forge'], 1), C.bukkitPlugins(['spigot', 'bukkit', 'paper'])], versions: 'mohist', project: 'mohist', builds: true, tps: 'bukkit' },
  youer: { family: 'bukkit', hybrid: 'neoforge', content: [C.mods(['neoforge'], 6), C.bukkitPlugins(['spigot', 'bukkit', 'paper'])], versions: 'mohist', project: 'youer', builds: true, tps: 'bukkit' },
  velocity: { family: 'proxy', content: [{ kind: 'plugin', dir: 'plugins', mr: ['velocity'], cf: null }], versions: 'fill', fill: 'velocity', builds: true, proxy: true, eula: false },
  bedrock: { family: 'bedrock', content: [{ kind: 'addon', dir: null, mr: [], cf: null }], versions: 'bedrock', builds: false, bedrock: true },
};

const IDS = Object.keys(TYPES);

function type(id) {
  const t = TYPES[id];
  if (!t) throw new Error(`Unknown server type ${id}`);
  return { id, eula: true, ...t };
}

const isBukkit = (id) => TYPES[id] && TYPES[id].family === 'bukkit';
const isProxy = (id) => !!(TYPES[id] && TYPES[id].proxy);
const isBedrock = (id) => !!(TYPES[id] && TYPES[id].bedrock);
const isJavaGame = (id) => !isProxy(id) && !isBedrock(id);
/** The mod loader whose mods this type runs (forge for Mohist, etc.), or null. */
function modLoader(id) {
  const t = TYPES[id];
  if (!t) return null;
  if (t.hybrid) return t.hybrid;
  if (['fabric', 'quilt', 'forge', 'neoforge'].includes(id)) return id;
  return null;
}
/** Content kinds a server type supports, in display order. */
const contentKinds = (id) => (TYPES[id] ? TYPES[id].content.map((c) => c.kind) : []);
function contentDef(id, kind) {
  const list = TYPES[id] ? TYPES[id].content : [];
  return (kind && list.find((c) => c.kind === kind)) || list[0] || null;
}

/** Summary sent to the UI. */
function publicTypes() {
  return IDS.map((id) => {
    const t = type(id);
    return { id, family: t.family, builds: !!t.builds, content: contentKinds(id), proxy: !!t.proxy, bedrock: !!t.bedrock, hybrid: t.hybrid || null, eula: t.eula !== false };
  });
}

module.exports = { TYPES, IDS, type, isBukkit, isProxy, isBedrock, isJavaGame, modLoader, contentKinds, contentDef, publicTypes };
