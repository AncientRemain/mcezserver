/* global state, call, esc, icon, toast, fail, modal, $, $$, fmtBytes, debounce, LOADERS, CATEGORIES, loaderBadge, progressBlock, updateProgressUI, wizardHooks, refreshServers, select, serverAction, perfPicker, bindPerfPicker, openModpackWizard, openImportWizard, worldSourcePicker, worldSummary, hasBuilds, buildLabel, versionLabel, contentLabel, typeInfo */
// New server wizard: type → version → world → finish.

const PRESETS = [
  { id: 'survival', icon: 'pickaxe', name: 'Survival', desc: 'The classic game', gm: 'survival', diff: 'normal' },
  { id: 'smp', icon: 'users', name: 'Friends SMP', desc: 'Keep inventory, no PvP', gm: 'survival', diff: 'normal', pvp: false, rules: { keepInventory: true } },
  { id: 'creative', icon: 'brush', name: 'Creative', desc: 'Unlimited blocks, flying', gm: 'creative', diff: 'peaceful' },
  { id: 'flat', icon: 'flat', name: 'Superflat build', desc: 'Flat world, always day', gm: 'creative', diff: 'peaceful', levelType: 'flat', structures: false, rules: { doMobSpawning: false, doWeatherCycle: false, doDaylightCycle: false } },
  { id: 'hardcore', icon: 'skull', name: 'Hardcore', desc: 'One life, hard mode', gm: 'survival', diff: 'hard', hardcore: true },
  { id: 'amplified', icon: 'mountain', name: 'Amplified', desc: 'Giant mountains', gm: 'survival', diff: 'normal', levelType: 'amplified' },
  { id: 'peaceful', icon: 'heart', name: 'Peaceful', desc: 'No hostile mobs', gm: 'survival', diff: 'peaceful' },
  { id: 'custom', icon: 'sliders', name: 'Custom', desc: 'Pick everything yourself' },
];
/** Geyser runs on plugin servers and proxies of any version, but its Fabric/NeoForge builds only on the newest release. */
const GEYSER_OK = (loader, mc) => ['paper', 'purpur', 'folia', 'leaf', 'spigot', 'velocity'].includes(loader) || (['fabric', 'quilt', 'neoforge'].includes(loader) && (!mc || !state.latestMc || mc === state.latestMc));
/** Minecraft 26.x renamed its game rules (keepInventory → minecraft:keep_inventory, doDaylightCycle → advance_time, …). */
const NEW_RULE_NAMES = { keepInventory: 'keep_inventory', doMobSpawning: 'spawn_mobs', doWeatherCycle: 'advance_weather', doDaylightCycle: 'advance_time', doImmediateRespawn: 'immediate_respawn', naturalRegeneration: 'natural_health_regeneration', doInsomnia: 'spawn_phantoms', mobGriefing: 'mob_griefing' };
const usesNewRuleNames = (mc) => /^(2[6-9]|[3-9]\d)\./.test(mc || '') || /^(2[6-9])w\d/.test(mc || '');
function gameruleCmd(name, value, mc) {
  if (usesNewRuleNames(mc)) return `gamerule minecraft:${NEW_RULE_NAMES[name] || name.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())} ${value}`;
  return `gamerule ${name} ${value}`;
}

async function openCreateWizard(preselect) {
  const sys = state.system;
  const maxMem = Math.max(2048, Math.floor(sys.totalMem / 1048576 / 512) * 512 - 1024);
  const W = {
    step: 1, loader: preselect || state.settings?.defaultLoader || 'paper', mc: null, snapshots: false, versions: [], loaderVersions: [], loaderVersion: '', filter: '',
    name: '', memory: Math.min(state.settings?.defaultMemoryMB || 4096, maxMem), port: 25565, eula: false,
    preset: 'survival', gamemode: 'survival', difficulty: 'normal', levelType: 'normal', seed: '', structures: true, hardcore: false, cheats: false,
    worldMode: 'new', world: null,
    maxPlayers: 20, whitelist: false, pvp: true, onlineMode: true, motd: '',
    geyser: false, autoStart: false, autoRestart: true, dailyRestart: false, backups: true,
    creating: false, id: null,
    perf: null, perfFor: null, perfSel: new Set(), updateOnStart: true,
  };
  if (!LOADERS[W.loader]) W.loader = 'paper';
  if ($('.modal-backdrop')) return;
  const usedPorts = new Set(state.servers.map((s) => s.port));
  const pickPort = () => {
    let p = W.loader === 'bedrock' ? 19132 : W.loader === 'velocity' ? 25577 : 25565;
    while (usedPorts.has(p) || (W.loader === 'bedrock' && usedPorts.has(p + 1))) p += W.loader === 'bedrock' ? 2 : 1;
    W.port = p;
  };
  pickPort();
  const steps = () => (W.loader === 'velocity' ? ['Type', 'Version', 'Finish'] : ['Type', 'Version', 'World', 'Finish']);
  const finishStep = () => steps().length;
  const m = modal({ title: `<h2>New server</h2><div class="stepper" id="stepper"></div>`, size: 'xl', body: '<div id="wz"></div>', foot: '<div id="wz-foot" class="row" style="width:100%"></div>', onClose: () => { if (W.world && W.world.staging && !W.creating) call('worlds:discard', W.world.staging).catch(() => {}); } });
  const stepper = () => {
    $('#stepper', m.el).innerHTML = steps().map((t, i) => `${i ? '<span class="line"></span>' : ''}<span class="s ${W.step === i + 1 ? 'active' : W.step > i + 1 ? 'done' : ''}"><b>${W.step > i + 1 ? '✓' : i + 1}</b>${t}</span>`).join('');
  };
  const body = () => $('#wz', m.el);
  const foot = () => $('#wz-foot', m.el);
  const bedrock = () => W.loader === 'bedrock';
  const proxy = () => W.loader === 'velocity';

  const loadPerf = async () => {
    if (!W.mc) return;
    const key = `${W.loader}|${W.mc}`;
    if (W.perfFor === key) return;
    W.perf = null;
    W.perfFor = key;
    try {
      const list = await call('mods:recommended', W.loader, W.mc);
      if (W.perfFor !== key) return;
      W.perf = list;
      W.perfSel = new Set(list.filter((x) => x.default && x.available).map((x) => x.slug));
    } catch { W.perf = []; }
    const el = $('#w-perf');
    if (el && W.step === finishStep()) { el.innerHTML = perfPicker(W); bindPerfPicker(el, W); }
  };
  const loadVersions = async () => {
    W.versions = [];
    drawStep();
    try {
      W.versions = await call('versions:games', W.loader, W.snapshots);
      if (!W.mc || !W.versions.some((v) => v.id === W.mc)) W.mc = (W.versions.find((v) => v.type === 'release') || W.versions[0])?.id;
      await loadLoaderVersions();
    } catch (e) { fail(e); }
    drawStep();
  };
  const loadLoaderVersions = async () => {
    W.loaderVersions = [];
    W.loaderVersion = '';
    if (!hasBuilds(W.loader) || !W.mc) return;
    try {
      W.loaderVersions = await call('versions:loaders', W.loader, W.mc);
      W.loaderVersion = (W.loaderVersions.find((v) => v.recommended) || W.loaderVersions[0])?.id || '';
    } catch (e) { fail(e); }
  };
  const applyPreset = (id) => {
    const p = PRESETS.find((x) => x.id === id);
    W.preset = id;
    if (!p || id === 'custom') return;
    W.gamemode = p.gm; W.difficulty = p.diff; W.levelType = p.levelType || 'normal'; W.structures = p.structures !== false; W.hardcore = !!p.hardcore; W.pvp = p.pvp !== false;
  };

  function drawStep() {
    stepper();
    if (W.creating) return drawProgress();
    if (W.step === 1) return drawType();
    if (W.step === 2) return drawVersion();
    if (W.step === 3 && !proxy()) return drawWorld();
    return drawFinish();
  }

  function drawType() {
    const card = (k) => {
      const l = LOADERS[k];
      return `<div class="loader-opt ${W.loader === k ? 'active' : ''}" style="--lc:${l.color}" data-l="${k}">
        <div class="row">${loaderBadge(k)}<div class="n">${l.name}</div>${l.tag ? `<span class="chip ${l.tag === 'Recommended' ? 'accent' : ''}" style="margin-left:auto;font-size:11px">${l.tag}</span>` : ''}</div>
        <div class="d">${l.desc}</div><div class="k">${icon('puzzle', 12)} ${contentLabel(k)}</div>
      </div>`;
    };
    body().innerHTML = `
      <div class="grid g-2" style="margin-bottom:18px">
        <div class="loader-opt modpack-opt" style="--lc:#f472b6" data-modpack><div class="row"><div class="loader-badge" style="--lc:#f472b6">${icon('archive', 18)}</div><div class="n">Start from a modpack</div></div><div class="d">Install a whole Modrinth modpack (Fabric, Quilt, Forge or NeoForge). Every mod set up for you.</div></div>
        <div class="loader-opt modpack-opt" style="--lc:#38bdf8" data-import-opt><div class="row"><div class="loader-badge" style="--lc:#38bdf8">${icon('upload', 18)}</div><div class="n">Import an existing server</div></div><div class="d">Bring in a server folder or .zip from another host, PC or launcher. Type and version are detected.</div></div>
      </div>
      ${CATEGORIES.map(([cat, title, desc]) => `<div class="cat-head"><b>${title}</b><span>${desc}</span></div>
        <div class="loader-grid">${Object.keys(LOADERS).filter((k) => LOADERS[k].cat === cat).map(card).join('')}</div>`).join('')}`;
    $('[data-modpack]', body()).onclick = () => { m.close(); openModpackWizard(); };
    $('[data-import-opt]', body()).onclick = () => { m.close(); openImportWizard(); };
    $$('[data-l]', body()).forEach((el) => (el.onclick = () => { W.loader = el.dataset.l; W.mc = null; W.world = null; W.worldMode = 'new'; pickPort(); W.memory = Math.min(W.loader === 'velocity' ? 1024 : ['forge', 'neoforge', 'mohist', 'youer'].includes(W.loader) ? 6144 : state.settings?.defaultMemoryMB || 4096, maxMem); drawStep(); }));
    $$('[data-l]', body()).forEach((el) => (el.ondblclick = () => { W.loader = el.dataset.l; W.step = 2; loadVersions(); }));
    foot().innerHTML = `<span class="dim small">Not sure? <b>Paper</b> is fast and supports plugins. Pick <b>Fabric</b> or <b>NeoForge</b> for mods, <b>Bedrock</b> for phones and consoles.</span><div class="spacer"></div><button class="btn primary" data-next>Continue ${icon('right', 15)}</button>`;
    $('[data-next]', foot()).onclick = () => { W.step = 2; loadVersions(); };
  }

  function drawVersion() {
    const vs = W.versions.filter((v) => !W.filter || v.id.includes(W.filter));
    const notes = {
      spigot: 'Spigot is compiled on your PC with BuildTools the first time (3–10 minutes, about 1 GB of downloads).',
      folia: 'Folia only runs plugins made for Folia, and some vanilla features (like the /tick command) behave differently.',
      bedrock: 'Mojang only offers the newest Bedrock server. Players must be on the same version (their game updates automatically).',
      velocity: 'Velocity versions are proxy versions, not Minecraft versions. One proxy supports all modern Minecraft clients.',
      mohist: 'Hybrid servers run most Forge mods and Bukkit plugins together, but not every combination works.',
      youer: 'Hybrid servers run most NeoForge mods and Bukkit plugins together, but not every combination works.',
    };
    body().innerHTML = `
      ${notes[W.loader] ? `<div class="banner info">${icon('info', 18)}<div class="grow">${notes[W.loader]}</div></div>` : ''}
      <div class="row" style="margin-bottom:14px">
        <div class="search-input">${icon('search', 16)}<input class="input" id="vf" placeholder="Filter versions…" value="${esc(W.filter)}" /></div>
        <label class="checkbox" style="align-items:center"><input type="checkbox" id="snaps" ${W.snapshots ? 'checked' : ''} /> ${bedrock() ? 'Show preview' : proxy() ? 'Show snapshot builds' : 'Show snapshots &amp; pre-releases'}</label>
      </div>
      <div class="label-text" style="margin-bottom:8px">${versionLabel(W.loader)} ${W.mc ? `· <span style="color:var(--text)">${esc(W.mc)}</span>` : ''}</div>
      ${W.versions.length ? `<div class="version-grid">${vs.map((v) => `<div class="ver ${v.id === W.mc ? 'active' : ''} ${v.type !== 'release' ? 'snap' : ''}" data-v="${esc(v.id)}">${esc(v.label || v.id)}</div>`).join('') || '<div class="dim">No match</div>'}</div>`
        : `<div class="skeleton" style="height:200px"></div>`}
      ${hasBuilds(W.loader) ? `<div class="field" style="margin-top:18px"><label>${buildLabel(W.loader)}</label>
        <select class="input" id="lv" ${W.loaderVersions.length ? '' : 'disabled'}>${W.loaderVersions.length ? W.loaderVersions.map((v) => `<option value="${esc(v.id)}" ${v.id === W.loaderVersion ? 'selected' : ''}>${esc(v.label)}${v.recommended ? '  (recommended)' : ''}</option>`).join('') : `<option>${W.mc ? 'Loading…' : '—'}</option>`}</select></div>` : ''}`;
    const vf = $('#vf');
    vf.oninput = debounce(() => { W.filter = vf.value.trim(); drawStep(); const n = $('#vf'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 200);
    $('#snaps').onchange = (e) => { W.snapshots = e.target.checked; loadVersions(); };
    $$('[data-v]', body()).forEach((el) => (el.onclick = async () => { W.mc = el.dataset.v; drawStep(); await loadLoaderVersions(); drawStep(); }));
    const lv = $('#lv'); if (lv) lv.onchange = () => (W.loaderVersion = lv.value);
    const okNext = W.mc && (!hasBuilds(W.loader) || W.loaderVersion);
    foot().innerHTML = `<button class="btn ghost" data-back>${icon('left', 15)} Back</button><div class="spacer"></div><button class="btn primary" data-next ${okNext ? '' : 'disabled'}>Continue ${icon('right', 15)}</button>`;
    $('[data-back]', foot()).onclick = () => { W.step = 1; drawStep(); };
    $('[data-next]', foot()).onclick = () => { if (!W.name) W.name = `${LOADERS[W.loader].name} ${W.mc}`; W.step = 3; drawStep(); if (proxy()) loadPerf(); };
  }

  function drawWorld() {
    const java = !bedrock();
    body().innerHTML = `
      <div class="segmented" style="margin-bottom:16px"><button class="${W.worldMode === 'new' ? 'active' : ''}" data-wm="new">${icon('sparkle', 14)} New world</button><button class="${W.worldMode === 'existing' ? 'active' : ''}" data-wm="existing">${icon('upload', 14)} Use a world I already have</button></div>
      ${W.worldMode === 'new' ? `
        <div class="label-text" style="margin-bottom:8px">Quick start</div>
        <div class="presets">${PRESETS.filter((p) => java || !['flat', 'amplified'].includes(p.id)).map((p) => `<div class="preset ${W.preset === p.id ? 'active' : ''}" data-preset="${p.id}">${icon(p.icon, 20)}<b>${p.name}</b><span>${p.desc}</span></div>`).join('')}</div>
        <div class="form-grid" style="margin-top:18px">
          <div class="field"><label>Game mode</label><select class="input" id="w-gm">${['survival', 'creative', 'adventure', ...(java ? ['spectator'] : [])].map((g) => `<option ${W.gamemode === g ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
          <div class="field"><label>Difficulty</label><select class="input" id="w-df">${['peaceful', 'easy', 'normal', 'hard'].map((g) => `<option ${W.difficulty === g ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
          ${java ? `<div class="field"><label>World type</label><select class="input" id="w-lt">${[['normal', 'Normal'], ['flat', 'Superflat'], ['large_biomes', 'Large biomes'], ['amplified', 'Amplified']].map(([v, l]) => `<option value="${v}" ${W.levelType === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` : ''}
          <div class="field"><label>Seed (optional)</label><div class="row" style="gap:6px"><input class="input" id="w-seed" placeholder="Random" value="${esc(W.seed)}" /><button class="btn icon" title="Random seed" data-dice>${icon('dice', 15)}</button></div></div>
          ${java ? `<label class="checkbox"><input type="checkbox" id="w-st" ${W.structures ? 'checked' : ''} /><span>Generate structures (villages, temples…)</span></label>
          <label class="checkbox"><input type="checkbox" id="w-hc" ${W.hardcore ? 'checked' : ''} /><span>Hardcore (one life)</span></label>` : `<label class="checkbox"><input type="checkbox" id="w-ch" ${W.cheats ? 'checked' : ''} /><span>Allow cheats (commands for everyone)</span></label>`}
        </div>` : `
        <div id="w-world">${W.world ? '' : ''}</div>`}`;
    $$('[data-wm]', body()).forEach((b) => (b.onclick = () => { W.worldMode = b.dataset.wm; drawStep(); }));
    if (W.worldMode === 'new') {
      $$('[data-preset]', body()).forEach((p) => (p.onclick = () => { applyPreset(p.dataset.preset); drawStep(); }));
      const set = (id, fn) => { const el = $(id); if (el) el.onchange = el.oninput = () => { fn(el); W.preset = 'custom'; $$('[data-preset]', body()).forEach((x) => x.classList.toggle('active', x.dataset.preset === 'custom')); }; };
      set('#w-gm', (el) => (W.gamemode = el.value));
      set('#w-df', (el) => (W.difficulty = el.value));
      set('#w-lt', (el) => (W.levelType = el.value));
      set('#w-st', (el) => (W.structures = el.checked));
      set('#w-hc', (el) => (W.hardcore = el.checked));
      set('#w-ch', (el) => (W.cheats = el.checked));
      const seed = $('#w-seed'); seed.oninput = () => (W.seed = seed.value);
      $('[data-dice]', body()).onclick = () => { W.seed = String(Math.floor(Math.random() * 2 ** 53) * (Math.random() < 0.5 ? -1 : 1)); seed.value = W.seed; };
    } else {
      const el = $('#w-world');
      if (W.world) {
        el.innerHTML = `${(W.world.warnings || []).map((w) => `<div class="banner warn">${icon('alert', 18)}<div class="grow">${esc(w)}</div></div>`).join('')}
          ${W.world.error ? `<div class="banner danger">${icon('alert', 18)}<div class="grow">${esc(W.world.error)}</div></div>` : ''}
          ${worldSummary(W.world.info)}
          <div class="row" style="margin-top:12px"><button class="btn sm" data-change-world>${icon('restart', 14)} Pick a different world</button><span class="dim small">The world is copied into the server after it's installed. Your original isn't changed.</span></div>`;
        $('[data-change-world]', el).onclick = () => { if (W.world.staging) call('worlds:discard', W.world.staging).catch(() => {}); W.world = null; drawStep(); };
      } else {
        worldSourcePicker(el, {
          edition: bedrock() ? 'bedrock' : 'java',
          onPick: async (p, label) => {
            el.innerHTML = `<div class="center-col" style="padding:30px"><div class="pulse-ring">${icon('world', 24)}</div><div class="muted" style="margin-top:10px">Reading the world…</div></div>`;
            try { W.world = await call('worlds:inspectFor', W.loader, W.mc, p); W.world.label = label; if (W.world.info && W.world.info.levelName && W.name === `${LOADERS[W.loader].name} ${W.mc}`) W.name = W.world.info.levelName.slice(0, 48); } catch (e) { fail(e); W.world = null; }
            drawStep();
          },
        });
      }
    }
    const okNext = W.worldMode === 'new' || (W.world && !W.world.error);
    foot().innerHTML = `<button class="btn ghost" data-back>${icon('left', 15)} Back</button><div class="spacer"></div><button class="btn primary" data-next ${okNext ? '' : 'disabled'}>Continue ${icon('right', 15)}</button>`;
    $('[data-back]', foot()).onclick = () => { W.step = 2; drawStep(); };
    $('[data-next]', foot()).onclick = () => { W.step = 4; drawStep(); loadPerf(); };
  }

  function drawFinish() {
    const java = !bedrock() && !proxy();
    const showPerf = !bedrock() && !proxy() && W.loader !== 'vanilla' && W.loader !== 'sponge';
    body().innerHTML = `
      <div class="row" style="margin-bottom:18px;padding:12px;border:1px solid var(--border);border-radius:12px;background:var(--bg-2)">${loaderBadge(W.loader)}<div style="flex:1"><b>${LOADERS[W.loader].name} ${esc(W.mc)}</b><div class="dim small">${!hasBuilds(W.loader) ? (bedrock() ? 'Official Bedrock server' : 'Official build') : esc(W.loaderVersions.find((v) => v.id === W.loaderVersion)?.label || W.loaderVersion)}${!proxy() ? ` · ${W.worldMode === 'existing' && W.world ? `world: ${esc(W.world.info?.levelName || 'imported')}` : `${esc(PRESETS.find((p) => p.id === W.preset)?.name || 'Custom')} world`}` : ''}</div></div></div>
      <div class="form-grid">
        <div class="field full"><label>Server name</label><input class="input" id="w-name" value="${esc(W.name)}" maxlength="48" /></div>
        ${!bedrock() ? `<div class="field full"><label>Memory (RAM) · <span id="w-memv" style="color:var(--text)">${(W.memory / 1024).toFixed(1)} GB</span></label>
          <input type="range" id="w-mem" min="${proxy() ? 512 : 1024}" max="${maxMem}" step="512" value="${W.memory}" style="margin-top:10px" />
          <div class="hint">${proxy() ? 'A proxy needs very little: 512 MB–1 GB is plenty.' : ['forge', 'neoforge', 'mohist', 'youer'].includes(W.loader) ? 'Modded servers usually want 6–10 GB.' : 'A few friends on Vanilla/Paper run fine on 2–4 GB.'} You have ${fmtBytes(sys.totalMem)} total.</div></div>` : ''}
        <div class="field"><label>Port</label><input class="input" id="w-port" type="number" value="${W.port}" /></div>
        <div class="field"><label>${bedrock() ? 'Server name in the list' : 'Message in the server list (MOTD)'}</label><input class="input" id="w-motd" placeholder="${esc(W.name || 'A Minecraft Server')}" value="${esc(W.motd)}" /></div>
        ${!proxy() ? `<div class="field"><label>Max players</label><input class="input" id="w-maxp" type="number" min="1" max="1000" value="${W.maxPlayers}" /></div>` : ''}
      </div>
      ${!proxy() ? `<div class="label-text" style="margin:18px 0 6px">Players</div>
      <div class="opts">
        ${opt('w-wl', W.whitelist, bedrock() ? 'Allowlist' : 'Whitelist', 'Only players you add can join. Add them in the Players tab.')}
        ${java ? opt('w-pvp', W.pvp, 'PvP', 'Players can hurt each other') : ''}
        ${opt('w-om', W.onlineMode, bedrock() ? 'Xbox account required' : 'Online mode', bedrock() ? 'Players must sign in with a Microsoft account (recommended)' : 'Only players with a real Minecraft account (recommended). Turn off only for LAN parties.')}
      </div>` : ''}
      ${GEYSER_OK(W.loader, W.mc) ? `<div class="label-text" style="margin:18px 0 6px">Cross-play</div><div class="opts">${opt('w-gey', W.geyser, 'Let Bedrock players join (Geyser)', `Phone, tablet, Xbox, PlayStation and Switch players can join this Java server. Installs Geyser + Floodgate.${state.latestMc && W.mc !== state.latestMc ? ` Works best on Minecraft ${state.latestMc}: on older versions Geyser may not be able to accept Bedrock's new NetherNet connections.` : ''}`)}</div>` : ''}
      <div class="label-text" style="margin:18px 0 6px">Automation</div>
      <div class="opts">
        ${opt('w-auto', W.autoStart, 'Start with CraftDock', 'Starts this server whenever CraftDock opens')}
        ${opt('w-ar', W.autoRestart, 'Restart if it crashes', 'Up to 3 times in 10 minutes')}
        ${!proxy() ? opt('w-bk', W.backups, 'Back up every 6 hours', 'Keeps the 5 newest automatic backups') : ''}
        ${opt('w-dr', W.dailyRestart, 'Restart every night at 4 AM', 'With a 1 minute warning in chat')}
      </div>
      ${showPerf ? `<div class="field full" id="w-perf" style="margin-top:18px">${perfPicker(W)}</div>` : ''}
      ${typeInfo(W.loader).eula !== false ? `<div style="margin-top:16px"><label class="checkbox"><input type="checkbox" id="w-eula" ${W.eula ? 'checked' : ''} /><span>I agree to the <a data-eula>Minecraft End User License Agreement</a>${bedrock() ? ' and <a data-privacy>Privacy Policy</a>' : ''}. Minecraft servers can't run without accepting it.</span></label></div>` : ''}`;
    const nm = $('#w-name'); nm.oninput = () => (W.name = nm.value);
    const mem = $('#w-mem'); if (mem) mem.oninput = () => { W.memory = Number(mem.value); $('#w-memv').textContent = `${(W.memory / 1024).toFixed(1)} GB`; };
    $('#w-port').oninput = (e) => (W.port = Number(e.target.value));
    $('#w-motd').oninput = (e) => (W.motd = e.target.value);
    const mp = $('#w-maxp'); if (mp) mp.oninput = () => (W.maxPlayers = Number(mp.value) || 20);
    const bindOpt = (id, k) => { const el = $('#' + id); if (el) el.onchange = () => (W[k] = el.checked); };
    bindOpt('w-wl', 'whitelist'); bindOpt('w-pvp', 'pvp'); bindOpt('w-om', 'onlineMode'); bindOpt('w-gey', 'geyser');
    bindOpt('w-auto', 'autoStart'); bindOpt('w-ar', 'autoRestart'); bindOpt('w-bk', 'backups'); bindOpt('w-dr', 'dailyRestart');
    bindPerfPicker($('#w-perf'), W);
    const needEula = typeInfo(W.loader).eula !== false;
    const eu = $('#w-eula'); if (eu) eu.onchange = (e) => { W.eula = e.target.checked; $('[data-create]', foot()).disabled = !W.eula; };
    const el = $('[data-eula]', body()); if (el) el.onclick = (e) => { e.preventDefault(); call('shell:open', 'https://aka.ms/MinecraftEULA'); };
    const pp = $('[data-privacy]', body()); if (pp) pp.onclick = (e) => { e.preventDefault(); call('shell:open', 'https://go.microsoft.com/fwlink/?LinkId=521839'); };
    foot().innerHTML = `<button class="btn ghost" data-back>${icon('left', 15)} Back</button><div class="spacer"></div><button class="btn primary" data-create ${W.eula || !needEula ? '' : 'disabled'}>${icon('sparkle', 15)} Create server</button>`;
    $('[data-back]', foot()).onclick = () => { W.step = proxy() ? 2 : 3; drawStep(); };
    $('[data-create]', foot()).onclick = create;
  }
  const opt = (id, on, title, sub) => `<label class="opt"><input type="checkbox" id="${id}" ${on ? 'checked' : ''} /><div><b>${title}</b><span>${sub}</span></div></label>`;

  async function create() {
    if (!W.name.trim()) return toast('Give your server a name', 'error');
    if (!(W.port > 0 && W.port < 65536)) return toast('Port must be between 1 and 65535', 'error');
    W.creating = true;
    const p = PRESETS.find((x) => x.id === W.preset);
    const pending = [];
    if (W.worldMode === 'new' && p && p.rules) {
      for (const [k, v] of Object.entries(p.rules)) pending.push(W.loader === 'bedrock' ? `gamerule ${k.toLowerCase()} ${v}` : gameruleCmd(k, v, W.mc));
    }
    try {
      W.id = await call('servers:create', {
        name: W.name.trim(), loader: W.loader, mcVersion: W.mc, loaderVersion: W.loaderVersion || null,
        memoryMB: W.memory, port: W.port, eula: W.eula || typeInfo(W.loader).eula === false,
        gamemode: W.gamemode, difficulty: W.difficulty, seed: W.seed.trim(), levelType: W.levelType, structures: W.structures, hardcore: W.hardcore, cheats: W.cheats,
        maxPlayers: W.maxPlayers, whitelist: W.whitelist, pvp: W.pvp, onlineMode: W.onlineMode, motd: W.motd.trim() || undefined,
        perfMods: [...(W.perfSel || [])], updateOnStart: W.updateOnStart && !['vanilla', 'bedrock'].includes(W.loader),
        geyser: W.geyser && GEYSER_OK(W.loader, W.mc), autoStart: W.autoStart, autoRestart: W.autoRestart, backupEveryHours: W.backups && !proxy() ? 6 : 0,
        pendingCommands: pending,
        importWorld: W.worldMode === 'existing' && W.world && !W.world.error ? { source: W.world.source, staging: W.world.staging, label: W.world.label } : null,
      });
      if (W.dailyRestart) await call('servers:update', W.id, { tasks: [{ name: 'Nightly restart', action: 'restart', value: '60', schedule: { type: 'daily', time: '04:00', days: [] } }] }).catch(() => {});
      state.progress[W.id] = { step: 'Starting install…', logs: [] };
      await refreshServers();
      drawStep();
    } catch (e) { W.creating = false; fail(e); drawStep(); }
  }

  function drawProgress() {
    const p = state.progress[W.id] || {};
    body().innerHTML = `<div style="padding:10px 4px">
      <div class="row" style="margin-bottom:18px">${loaderBadge(W.loader, 'lg')}<div><h2 style="margin:0;font:650 18px var(--font-display)">${esc(W.name)}</h2><div class="dim small">${LOADERS[W.loader].name} ${esc(W.mc)}</div></div></div>
      ${p.error ? `<div class="banner danger">${icon('alert', 18)}<div class="grow selectable" style="white-space:pre-wrap">${esc(p.error)}</div></div>` : p.done ? `<div class="banner success">${icon('check', 18)}<div class="grow"><b>Your server is ready!</b> Hit Start to launch it.${W.geyser ? ' Bedrock players can join once it is online (see Overview → Connect).' : ''}</div></div>` : ''}
      ${p.done || p.error ? '' : progressBlock(p)}
    </div>`;
    foot().innerHTML = p.done
      ? `<div class="spacer"></div><button class="btn" data-open>Open server</button><button class="btn primary" data-start>${icon('play', 15)} Start now</button>`
      : p.error ? `<div class="spacer"></div><button class="btn" data-open>Close</button>`
        : `<span class="dim small">You can close this window. The install keeps going in the background.</span><div class="spacer"></div><button class="btn" data-open>Run in background</button>`;
    const id = W.id;
    $('[data-open]', foot()).onclick = () => { m.close(); select(id); };
    const st = $('[data-start]', foot());
    if (st) st.onclick = () => { m.close(); select(id, 'console').then(() => serverAction(id, 'start')); };
  }
  wizardHooks.current = { id: () => W.id, redraw: () => { if (W.creating && document.body.contains(m.el)) { const p = state.progress[W.id] || {}; if (p.done || p.error || !$('#prog-step')) drawProgress(); else updateProgressUI(p); } } };
  if (preselect) { W.step = 2; loadVersions(); } else drawStep();
}
