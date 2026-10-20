/* global state, api, call, esc, icon, toast, fail, modal, $, $$, fmtBytes, ago, debounce, LOADERS, isRunning, isBedrock, isBukkit, server, refreshServers, renderBody, confirmDialog, promptDialog, switchTab, progressBlock, updateProgressUI */
// Worlds tab: every world in the server, importing singleplayer worlds, game rules, reset, download.

const GAMERULE_INFO = {
  keepinventory: ['Keep inventory', 'Players keep their items when they die'],
  dodaylightcycle: ['Day/night cycle', 'Time passes. Turn off to freeze the time of day'],
  doweathercycle: ['Weather changes', 'Rain and thunder come and go'],
  domobspawning: ['Mobs spawn', 'Animals and monsters spawn naturally'],
  mobgriefing: ['Mob griefing', 'Creepers, endermen and ghasts can change blocks'],
  dofiretick: ['Fire spreads', 'Fire spreads and burns out blocks'],
  naturalregeneration: ['Natural healing', 'Health regenerates when players are full'],
  doimmediaterespawn: ['Instant respawn', 'Skip the death screen'],
  showcoordinates: ['Show coordinates', 'Shows your position on screen'],
  showdeathmessages: ['Death messages', 'Announce deaths in chat'],
  announceadvancements: ['Announce advancements', 'Show advancements in chat'],
  commandblockoutput: ['Command block output', 'Command blocks report to chat'],
  sendcommandfeedback: ['Command feedback', 'Show the result of commands in chat'],
  doinsomnia: ['Phantoms', 'Phantoms appear when players don\'t sleep'],
  dopatrolspawning: ['Pillager patrols', 'Pillager patrols spawn'],
  dotraderspawning: ['Wandering traders', 'Wandering traders spawn'],
  dowardenspawning: ['Wardens', 'Wardens can be summoned'],
  disableraids: ['No raids', 'Turns off raids'],
  doentitydrops: ['Entity drops', 'Minecarts, item frames etc. drop items'],
  dotiledrops: ['Block drops', 'Broken blocks drop items'],
  domobloot: ['Mob loot', 'Mobs drop items when killed'],
  falldamage: ['Fall damage', 'Falling hurts'],
  firedamage: ['Fire damage', 'Fire and lava hurt'],
  drowningdamage: ['Drowning damage', 'Running out of air hurts'],
  freezedamage: ['Freeze damage', 'Powder snow hurts'],
  playerssleepingpercentage: ['Sleep percentage', '% of players that must sleep to skip the night'],
  randomtickspeed: ['Random tick speed', 'How fast crops grow and leaves decay (default 3)'],
  spawnradius: ['Spawn radius', 'How far from spawn new players appear'],
  maxentitycramming: ['Entity cramming', 'Max mobs in one block before they take damage'],
  forgivedeadplayers: ['Forgive dead players', 'Angry neutral mobs calm down when their target dies'],
  universalanger: ['Universal anger', 'Angry neutral mobs attack everyone nearby'],
  spectatorsgeneratechunks: ['Spectators load chunks', 'Spectators generate new terrain'],
  tntexplodes: ['TNT explodes', 'TNT can be detonated'],
  pvp: ['PvP', 'Players can hurt each other'],
  locatorbar: ['Locator bar', 'Shows where other players are'],
  recipesunlock: ['Unlock recipes', 'Recipes unlock as players progress'],
  respawnblocksexplode: ['Respawn blocks explode', 'Beds/anchors explode in the wrong dimension'],
  projectilesbreakblocks: ['Projectiles break blocks', 'Arrows etc. can break some blocks'],
  showdaysplayed: ['Show days played', 'Shows how many days have passed'],
  // Minecraft 26.x names
  advancetime: ['Day/night cycle', 'Time passes. Turn off to freeze the time of day'],
  advanceweather: ['Weather changes', 'Rain and thunder come and go'],
  spawnmobs: ['Mobs spawn', 'Animals and monsters spawn naturally'],
  spawnmonsters: ['Monsters spawn', 'Hostile mobs spawn naturally'],
  firespreadradiusaroundplayer: ['Fire spread radius', 'How far from players fire can spread (0 = never)'],
  naturalhealthregeneration: ['Natural healing', 'Health regenerates when players are full'],
  immediaterespawn: ['Instant respawn', 'Skip the death screen'],
  showadvancementmessages: ['Announce advancements', 'Show advancements in chat'],
  spawnphantoms: ['Phantoms', 'Phantoms appear when players don\'t sleep'],
  spawnpatrols: ['Pillager patrols', 'Pillager patrols spawn'],
  spawnwanderingtraders: ['Wandering traders', 'Wandering traders spawn'],
  spawnwardens: ['Wardens', 'Wardens can be summoned'],
  raids: ['Raids', 'Pillager raids can happen'],
  entitydrops: ['Entity drops', 'Minecarts, item frames etc. drop items'],
  blockdrops: ['Block drops', 'Broken blocks drop items'],
  mobdrops: ['Mob loot', 'Mobs drop items when killed'],
  respawnradius: ['Spawn radius', 'How far from spawn new players appear'],
  limitedcrafting: ['Limited crafting', 'Only unlocked recipes can be crafted'],
  spreadvines: ['Vines spread', 'Vines grow to nearby blocks'],
  projectilescanbreakblocks: ['Projectiles break blocks', 'Arrows etc. can break some blocks'],
  commandblockswork: ['Command blocks', 'Command blocks can run'],
  spawnerblockswork: ['Spawners work', 'Monster spawners spawn mobs'],
  allowenteringnetherusingportals: ['Nether portals', 'Players can travel to the Nether'],
  elytramovementcheck: ['Elytra speed check', 'Kicks players who fly too fast'],
  playermovementcheck: ['Movement check', 'Kicks players who move impossibly fast'],
  globalsoundevents: ['Global sounds', 'Boss and portal sounds are heard everywhere'],
  logadmincommands: ['Log admin commands', 'Admin commands are logged'],
  reduceddebuginfo: ['Reduced debug info', 'Hide coordinates in the F3 screen'],
  disableelytramovementcheck: ['No elytra speed check', 'Lets fast elytra flight through'],
  blockexplosiondropdecay: ['Explosion block decay', 'Some blocks blown up by blocks are lost'],
  mobexplosiondropdecay: ['Mob explosion decay', 'Some blocks blown up by mobs are lost'],
  tntexplosiondropdecay: ['TNT explosion decay', 'Some blocks blown up by TNT are lost'],
  watersourceconversion: ['Infinite water', 'Two water sources make a new one'],
  lavasourceconversion: ['Infinite lava', 'Two lava sources make a new one'],
  dovinesspread: ['Vines spread', 'Vines grow to nearby blocks'],
  enderpearlsvanishondeath: ['Pearls vanish on death', 'Thrown ender pearls disappear when the thrower dies'],
  dolimitedcrafting: ['Limited crafting', 'Only unlocked recipes can be crafted'],
};
const ruleKey = (k) => String(k).toLowerCase().replace(/^minecraft:/, '').replace(/_/g, '');
const ruleInfo = (k) => GAMERULE_INFO[ruleKey(k)] || [String(k).replace(/^minecraft:/, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()), ''];

async function renderWorlds(tb, s) {
  tb.innerHTML = '<div class="skeleton" style="height:220px"></div>';
  let list;
  try { list = await call('worlds:list', s.id); } catch (e) { return fail(e); }
  if (state.tab !== 'worlds' || state.selected !== s.id) return;
  const running = isRunning(s.status);
  const active = list.find((w) => w.active);
  const others = list.filter((w) => !w.active);
  const ext = isBedrock(s) ? '.mcworld' : '.zip';
  tb.innerHTML = `
    <div class="row" style="margin-bottom:16px">
      <div><div class="section-title">Worlds</div><div class="dim small">${isBedrock(s) ? 'Bedrock worlds in the worlds folder.' : 'Each world folder in this server.'} The active world is the one the server loads.</div></div>
      <div class="spacer"></div>
      <button class="btn sm icon" title="Open folder" data-folder>${icon('folder', 15)}</button>
      <button class="btn primary" data-import-world>${icon('upload', 16)} Import a world</button>
    </div>
    ${running ? `<div class="banner info">${icon('info', 18)}<div class="grow">The server is running. Stop it to switch, replace, rename or reset the active world.</div></div>` : ''}
    ${active ? worldHero(s, active, running) : ''}
    ${others.length ? `<div class="label-text" style="margin:18px 0 8px">Other worlds</div>
      <div class="card" style="padding:0"><div class="list">${others.map((w, i) => `<div class="list-row">
        ${w.icon ? `<img class="mod-icon world-icon" src="${w.icon}" />` : `<div class="mod-icon">${icon('world', 18)}</div>`}
        <div class="grow"><div class="title">${esc(w.name)}${w.levelName && w.levelName !== w.name ? ` <span class="dim">· ${esc(w.levelName)}</span>` : ''}</div><div class="desc">${[w.version && `Minecraft ${w.version}`, w.gameType && w.gameType[0].toUpperCase() + w.gameType.slice(1), w.hardcore && 'Hardcore', w.size != null && fmtBytes(w.size), w.mtime && `changed ${ago(w.mtime)}`].filter(Boolean).map(esc).join(' · ')}</div></div>
        <button class="btn xs" data-activate="${i}" ${running ? 'disabled' : ''}>${icon('check', 13)} Use this world</button>
        <button class="btn xs icon ghost" title="Download as ${ext}" data-dl-o="${i}">${icon('download', 14)}</button>
        <button class="btn xs icon ghost" title="Rename" data-rn-o="${i}">${icon('edit', 14)}</button>
        <button class="btn xs icon ghost" title="Delete" data-del-o="${i}">${icon('trash', 14)}</button>
      </div>`).join('')}</div></div>` : ''}
    <div class="dropzone" id="world-drop" style="margin-top:16px">${icon('upload', 16)} Drag a world folder, .zip${isBedrock(s) ? ' or .mcworld' : ''} here to import it</div>`;
  $('[data-folder]', tb).onclick = () => call('servers:openFolder', s.id, isBedrock(s) ? 'worlds' : '').catch(fail);
  $('[data-import-world]', tb).onclick = () => openWorldImport(s);
  if (active) bindWorldHero(tb, s, active, running);
  $$('[data-activate]', tb).forEach((b) => (b.onclick = async () => {
    const w = others[b.dataset.activate];
    try { await call('worlds:setActive', s.id, w.name); toast(`"${w.name}" is now the active world`, 'success'); await refreshServers(); renderWorlds(tb, server(s.id)); } catch (e) { fail(e); }
  }));
  $$('[data-dl-o]', tb).forEach((b) => (b.onclick = () => downloadWorld(s, others[b.dataset.dlO].name)));
  $$('[data-rn-o]', tb).forEach((b) => (b.onclick = () => renameWorld(s, others[b.dataset.rnO].name, tb)));
  $$('[data-del-o]', tb).forEach((b) => (b.onclick = async () => {
    const w = others[b.dataset.delO];
    if (!(await confirmDialog({ title: `Delete "${w.name}"?`, message: `This permanently deletes this world${w.size ? ` (${fmtBytes(w.size)})` : ''}. Make a backup first if you might want it back.`, confirm: 'Delete world', danger: true }))) return;
    try { await call('worlds:delete', s.id, w.name); toast('World deleted', 'success'); renderWorlds(tb, server(s.id)); } catch (e) { fail(e); }
  }));
  const drop = $('#world-drop', tb);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; const p = f && api.pathForFile(f); if (p) openWorldImport(s, p); };
}

function worldHero(s, w, running) {
  const ext = isBedrock(s) ? '.mcworld' : '.zip';
  return `<div class="card world-hero">
    <div class="row" style="align-items:flex-start;gap:16px">
      ${w.icon ? `<img class="world-thumb" src="${w.icon}" />` : `<div class="world-thumb ph">${icon('world', 30)}</div>`}
      <div style="flex:1;min-width:0">
        <div class="row" style="gap:8px"><h3 style="margin:0;font:650 18px var(--font-display)">${esc(w.name)}</h3><span class="chip accent">${icon('check', 11)} Active</span>${w.hardcore ? '<span class="chip danger">Hardcore</span>' : ''}</div>
        ${w.missing ? `<div class="dim" style="margin-top:6px">This world hasn't been created yet. It's generated the first time the server starts.</div>` : `
        <div class="world-facts">
          ${w.version ? `<div><span>Version</span><b>${esc(w.version)}</b></div>` : ''}
          ${w.gameType ? `<div><span>Game mode</span><b>${esc(w.gameType)}</b></div>` : ''}
          ${w.difficulty ? `<div><span>Difficulty</span><b>${esc(w.difficulty)}</b></div>` : ''}
          <div><span>Size</span><b>${fmtBytes(w.size || 0)}</b></div>
          ${w.seed ? `<div title="Click to copy"><span>Seed</span><b class="mono selectable" data-copy-seed="${esc(w.seed)}" style="cursor:pointer">${esc(w.seed)}</b></div>` : ''}
          ${w.dims ? `<div><span>Dimensions</span><b>Overworld${w.dims.nether ? ', Nether' : ''}${w.dims.end ? ', End' : ''}</b></div>` : ''}
          ${w.datapacks != null ? `<div><span>Datapacks</span><b>${w.datapacks}</b></div>` : ''}
        </div>`}
      </div>
    </div>
    <div class="row wrap" style="margin-top:16px;gap:8px">
      <button class="btn sm" data-rules ${w.missing ? 'disabled' : ''}>${icon('sliders', 14)} Game rules</button>
      ${!isBedrock(s) ? `<button class="btn sm" data-datapacks>${icon('puzzle', 14)} Datapacks</button>` : ''}
      <button class="btn sm" data-dl ${w.missing ? 'disabled' : ''}>${icon('download', 14)} Download ${ext}</button>
      <button class="btn sm" data-sp ${w.missing ? 'disabled' : ''}>${icon('pickaxe', 14)} Copy to my singleplayer worlds</button>
      <button class="btn sm" data-rn ${running || w.missing ? 'disabled' : ''}>${icon('edit', 14)} Rename</button>
      <div class="spacer"></div>
      <button class="btn sm danger" data-reset ${running ? 'disabled' : ''}>${icon('restart', 14)} Reset world</button>
    </div>
  </div>`;
}

function bindWorldHero(tb, s, w, running) {
  const b = (sel, fn) => { const el = $(sel, tb); if (el) el.onclick = fn; };
  b('[data-copy-seed]', () => { navigator.clipboard.writeText(w.seed); toast('Seed copied', 'success', 1500); });
  b('[data-rules]', () => openGamerules(s, w.name));
  b('[data-datapacks]', () => { state.mods.kind = 'datapack'; state.mods.sub = 'installed'; state.mods.installed = []; switchTab('mods'); });
  b('[data-dl]', () => downloadWorld(s, w.name));
  b('[data-sp]', async () => {
    try { const f = await call('worlds:toSingleplayer', s.id, w.name); toast(`Copied! Open Minecraft → Singleplayer to play it.\n${f}`, 'success', 8000); } catch (e) { fail(e); }
  });
  b('[data-rn]', () => renameWorld(s, w.name, tb));
  b('[data-reset]', () => openResetWorld(s, tb));
  void running;
}

async function downloadWorld(s, name) {
  toast('Packing the world…', 'info', 2500);
  try { const f = await call('worlds:export', s.id, name); if (f) toast(`Saved ${f}`, 'success', 6000); } catch (e) { fail(e); }
}

async function renameWorld(s, name, tb) {
  const to = await promptDialog({ title: 'Rename world', message: 'The folder and the name shown in Minecraft both change.', value: name });
  if (!to || to.trim() === name) return;
  try { await call('worlds:rename', s.id, name, to.trim()); toast('World renamed', 'success'); await refreshServers(); renderWorlds(tb, server(s.id)); } catch (e) { fail(e); }
}

function openResetWorld(s, tb) {
  const java = !isBedrock(s);
  const m = modal({
    title: `<div class="mod-icon sm" style="color:var(--danger)">${icon('restart', 15)}</div><div><h2>Reset world</h2><div class="dim small">${esc(s.name)}</div></div>`,
    body: `<div class="banner warn">${icon('alert', 18)}<div class="grow">The current world is deleted and a brand new one is generated the next time the server starts.</div></div>
      <div class="form-grid">
        <div class="field full"><label>Seed</label>
          <div class="segmented" id="rw-seedmode"><button class="active" data-sm="random">Random</button><button data-sm="keep">Keep current</button><button data-sm="custom">Custom</button></div>
          <input class="input" id="rw-seed" placeholder="Type a seed" style="margin-top:8px;display:none" /></div>
        ${java ? `<div class="field full"><label>World type</label><select class="input" id="rw-type"><option value="">Keep current</option><option value="minecraft:normal">Normal</option><option value="minecraft:flat">Superflat</option><option value="minecraft:large_biomes">Large biomes</option><option value="minecraft:amplified">Amplified</option></select></div>` : ''}
        <label class="checkbox full"><input type="checkbox" id="rw-backup" checked /><span>Back up the current world first (recommended)</span></label>
      </div>`,
    foot: `<div class="spacer"></div><button class="btn ghost" data-x>Cancel</button><button class="btn danger" data-go>${icon('restart', 15)} Reset world</button>`,
  });
  let mode = 'random';
  $$('[data-sm]', m.el).forEach((b) => (b.onclick = () => { mode = b.dataset.sm; $$('[data-sm]', m.el).forEach((x) => x.classList.toggle('active', x === b)); $('#rw-seed', m.el).style.display = mode === 'custom' ? '' : 'none'; }));
  $('[data-x]', m.el).onclick = () => m.close();
  $('[data-go]', m.el).onclick = async (e) => {
    e.currentTarget.disabled = true;
    const opts = { backup: $('#rw-backup', m.el).checked };
    if (mode === 'random') opts.seed = '';
    if (mode === 'custom') opts.seed = $('#rw-seed', m.el).value.trim();
    const lt = $('#rw-type', m.el);
    if (lt && lt.value) opts.levelType = lt.value;
    try { await call('worlds:reset', s.id, opts); m.close(); toast('World reset. Start the server to generate the new world.', 'success', 6000); renderWorlds(tb, server(s.id)); } catch (er) { fail(er); e.currentTarget.disabled = false; }
  };
}

async function openGamerules(s, world) {
  const m = modal({
    title: `<div class="mod-icon sm">${icon('sliders', 15)}</div><div><h2>Game rules</h2><div class="dim small">${esc(world)} · ${isRunning(s.status) ? 'changes apply right away' : 'saved into the world file'}</div></div>`,
    size: 'lg', body: '<div class="skeleton" style="height:260px"></div>',
    foot: `<span class="dim small" id="gr-state"></span><div class="spacer"></div><button class="btn ghost" data-x>Close</button><button class="btn primary" data-save disabled>${icon('check', 15)} Save</button>`,
  });
  $('[data-x]', m.el).onclick = () => m.close();
  let rules;
  try { rules = await call('worlds:gamerules', s.id, world); } catch (e) { m.close(); return fail(e); }
  const body = $('.modal-body', m.el);
  if (!rules || !rules.length) { body.innerHTML = `<div class="empty"><h3>No game rules yet</h3><div>Start the server once so the world (and its rules) are created.</div></div>`; return; }
  if (isRunning(s.status) && s.status !== 'online') { body.innerHTML = '<div class="empty"><h3>The server is starting</h3><div>Wait until it is online, then try again.</div></div>'; return; }
  const patch = {};
  const sorted = [...rules].sort((a, b) => (!!GAMERULE_INFO[ruleKey(b.key)] - !!GAMERULE_INFO[ruleKey(a.key)]) || ruleInfo(a.key)[0].localeCompare(ruleInfo(b.key)[0]));
  body.innerHTML = `<div class="search-input" style="margin-bottom:12px">${icon('search', 16)}<input class="input" id="gr-q" placeholder="Search game rules…" /></div>
    <div class="rules">${sorted.map((r) => { const [t, d] = ruleInfo(r.key); return `<div class="toggle-row rule" data-name="${esc((t + ' ' + r.key).toLowerCase())}">
      <div class="t"><b>${esc(t)}</b><span>${esc(d)}${d ? ' · ' : ''}<span class="mono">${esc(r.key)}</span></span></div>
      ${r.kind === 'bool' ? `<label class="switch"><input type="checkbox" data-rule="${esc(r.key)}" ${r.value === 'true' ? 'checked' : ''} /><span></span></label>`
        : `<input class="input" type="number" data-rule="${esc(r.key)}" value="${esc(r.value)}" style="width:110px" />`}
    </div>`; }).join('')}</div>`;
  const save = $('[data-save]', m.el);
  $$('[data-rule]', body).forEach((el) => (el.oninput = el.onchange = () => {
    patch[el.dataset.rule] = el.type === 'checkbox' ? String(el.checked) : el.value;
    save.disabled = false;
    $('#gr-state', m.el).textContent = `${Object.keys(patch).length} change${Object.keys(patch).length > 1 ? 's' : ''}`;
  }));
  $('#gr-q', body).oninput = (e) => { const q = e.target.value.toLowerCase(); $$('.rule', body).forEach((r) => (r.style.display = r.dataset.name.includes(q) ? '' : 'none')); };
  save.onclick = async () => {
    try {
      const how = await call('worlds:setGamerules', s.id, world, patch);
      toast(how === 'live' ? 'Game rules changed on the running server' : 'Game rules saved. They apply next time the server starts.', 'success');
      m.close();
    } catch (e) { fail(e); }
  };
}

/** World source picker: singleplayer saves on this PC, a folder, or a .zip/.mcworld. Calls onPick(path, label). */
function worldSourcePicker(el, { edition = 'java', onPick }) {
  const S = { q: '', saves: null };
  const draw = () => {
    const list = (S.saves || []).filter((w) => !S.q || `${w.folder} ${w.levelName} ${w.launcher}`.toLowerCase().includes(S.q.toLowerCase()));
    const focused = document.activeElement && document.activeElement.id === 'ws-q';
    el.innerHTML = `
      <div class="grid g-2" style="margin-bottom:14px">
        <div class="loader-opt" style="--lc:var(--accent)" data-pick="folder"><div class="row"><div class="loader-badge" style="--lc:#fbbf24">${icon('folder', 18)}</div><div class="n">World folder</div></div><div class="d">The folder with level.dat in it (e.g. from .minecraft/saves).</div></div>
        <div class="loader-opt" style="--lc:var(--accent)" data-pick="zip"><div class="row"><div class="loader-badge" style="--lc:#60a5fa">${icon('archive', 18)}</div><div class="n">${edition === 'bedrock' ? '.mcworld or .zip' : '.zip file'}</div></div><div class="d">A downloaded world or a backup from a host.</div></div>
      </div>
      <div class="row" style="margin-bottom:8px"><div class="label-text" style="flex:1">${edition === 'bedrock' ? 'Bedrock worlds on this PC' : 'Singleplayer worlds on this PC'}</div>
        ${S.saves && S.saves.length > 6 ? `<div class="search-input mini">${icon('search', 13)}<input class="input" id="ws-q" placeholder="Find…" value="${esc(S.q)}" /></div>` : ''}</div>
      ${S.saves == null ? '<div class="skeleton" style="height:160px"></div>' : list.length ? `<div class="saves">${list.map((w, i) => `<div class="save" data-save="${i}">
          ${w.icon ? `<img src="${w.icon}" />` : `<div class="ph">${icon('world', 20)}</div>`}
          <div class="grow"><div class="t">${esc(w.levelName || w.folder)}</div><div class="d">${[w.version, w.gameType && w.gameType[0].toUpperCase() + w.gameType.slice(1), w.hardcore && 'Hardcore', w.lastPlayed && `played ${ago(w.lastPlayed)}`].filter(Boolean).map(esc).join(' · ')}</div><div class="d dim">${esc(w.launcher)}</div></div>
        </div>`).join('')}</div>` : `<div class="dim small" style="padding:6px 0 4px">No ${edition === 'bedrock' ? 'Bedrock' : 'singleplayer'} worlds found in the usual places. Use a folder or file instead.</div>`}
      <div class="dropzone" data-drop style="margin-top:12px">${icon('upload', 16)} …or drag a world folder or file here</div>`;
    $$('[data-pick]', el).forEach((c) => (c.onclick = async () => { const p = await call('worlds:pick', c.dataset.pick).catch(fail); if (p) onPick(p, p); }));
    $$('[data-save]', el).forEach((c) => (c.onclick = () => { const w = list[c.dataset.save]; onPick(w.path, `${w.levelName || w.folder} (${w.launcher})`); }));
    const q = $('#ws-q', el);
    if (q) { q.oninput = () => { S.q = q.value; draw(); }; if (focused) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
    const drop = $('[data-drop]', el);
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; const p = f && api.pathForFile(f); if (p) onPick(p, p); };
  };
  draw();
  call('worlds:saves', edition).then((l) => { S.saves = l; if (document.body.contains(el)) draw(); }).catch(() => { S.saves = []; draw(); });
}

function worldSummary(info) {
  if (!info) return '';
  return `<div class="row" style="padding:12px;border:1px solid var(--border);border-radius:12px;background:var(--bg-2)">
    ${info.icon ? `<img class="world-thumb sm" src="${info.icon}" />` : `<div class="world-thumb sm ph">${icon('world', 22)}</div>`}
    <div style="flex:1;min-width:0"><div style="font-weight:650">${esc(info.levelName || info.folder)}</div>
      <div class="dim small">${[info.version && `Minecraft ${info.version}`, info.gameType, info.hardcore && 'hardcore', info.difficulty].filter(Boolean).map(esc).join(' · ')}</div></div></div>`;
}

function openWorldImport(s, initialPath) {
  const I = { step: 'pick', prep: null, mode: 'add', name: '', activate: true, backup: true };
  const running = isRunning(s.status);
  const m = modal({
    title: `<div class="mod-icon sm" style="color:var(--accent)">${icon('world', 15)}</div><div><h2>Import a world</h2><div class="dim small">into ${esc(s.name)} (${esc(LOADERS[s.loader].name)} ${esc(s.mcVersion)})</div></div>`,
    size: 'lg', body: '<div id="wi"></div>', foot: '<div id="wi-foot" class="row" style="width:100%"></div>',
    onClose: () => { if (I.prep && I.prep.staging && I.step !== 'done') call('worlds:discard', I.prep.staging).catch(() => {}); },
  });
  const body = () => $('#wi', m.el);
  const foot = () => $('#wi-foot', m.el);
  const pick = async (p, label) => {
    I.step = 'inspect'; draw();
    try {
      I.prep = await call('worlds:inspect', s.id, p);
      I.prep.label = label || p;
      I.name = (I.prep.info && (I.prep.info.levelName || I.prep.info.folder)) || 'Imported world';
      I.step = 'review';
    } catch (e) { fail(e); I.step = 'pick'; }
    draw();
  };
  function draw() {
    if (!document.body.contains(m.el)) return;
    if (I.step === 'pick') {
      worldSourcePicker(body(), { edition: isBedrock(s) ? 'bedrock' : 'java', onPick: pick });
      foot().innerHTML = `<span class="dim small">${icon('info', 12)} Worlds are copied. The original is never changed.</span><div class="spacer"></div><button class="btn ghost" data-x>Cancel</button>`;
      $('[data-x]', foot()).onclick = () => m.close();
      return;
    }
    if (I.step === 'inspect' || I.step === 'working') {
      const p = I.progress || {};
      body().innerHTML = I.step === 'inspect'
        ? `<div class="center-col" style="padding:40px"><div class="pulse-ring">${icon('world', 26)}</div><h3 style="margin:14px 0 4px">Reading the world…</h3></div>`
        : `<div style="padding:10px 2px">${progressBlock({ step: p.step || 'Importing…', pct: p.pct, logs: [] })}</div>`;
      foot().innerHTML = '';
      return;
    }
    if (I.step === 'review') {
      const P = I.prep;
      body().innerHTML = `
        ${P.error ? `<div class="banner danger">${icon('alert', 18)}<div class="grow">${esc(P.error)}</div></div>` : ''}
        ${(P.warnings || []).map((w) => `<div class="banner warn">${icon('alert', 18)}<div class="grow">${esc(w)}</div></div>`).join('')}
        ${worldSummary(P.info)}
        ${P.error ? '' : `
        <div class="label-text" style="margin:18px 0 8px">How should it be added?</div>
        <div class="grid g-2">
          <label class="loader-opt ${I.mode === 'replace' ? 'active' : ''}" style="--lc:var(--accent)"><div class="row"><input type="radio" name="wm" value="replace" ${I.mode === 'replace' ? 'checked' : ''} /><div class="n">Replace the current world</div></div><div class="d">"${esc(s.levelName)}" is swapped for this one${I.backup ? ' (it is backed up first)' : ''}.</div></label>
          <label class="loader-opt ${I.mode === 'add' ? 'active' : ''}" style="--lc:var(--accent)"><div class="row"><input type="radio" name="wm" value="add" ${I.mode === 'add' ? 'checked' : ''} /><div class="n">Add as another world</div></div><div class="d">Keep the current world too. Switch between them in the Worlds tab.</div></label>
        </div>
        <div class="form-grid" style="margin-top:14px">
          ${I.mode === 'add' ? `<div class="field full"><label>World name</label><input class="input" id="wi-name" value="${esc(I.name)}" /></div>
          <label class="checkbox full"><input type="checkbox" id="wi-act" ${I.activate ? 'checked' : ''} ${running ? 'disabled' : ''} /><span>Make it the active world${running ? ' (stop the server first)' : ''}</span></label>` : `<label class="checkbox full"><input type="checkbox" id="wi-bk" ${I.backup ? 'checked' : ''} /><span>Back up the current world first (recommended)</span></label>`}
        </div>
        ${isBukkit(s) && !isBedrock(s) ? `<div class="dim small" style="margin-top:12px">${icon('info', 12)} ${esc(LOADERS[s.loader].name)} keeps the Nether and End in separate folders; the server splits them out automatically on first start.</div>` : ''}`}`;
      $$('input[name=wm]', body()).forEach((r) => (r.onchange = () => { I.mode = r.value; draw(); }));
      const nm = $('#wi-name'); if (nm) nm.oninput = () => (I.name = nm.value);
      const ac = $('#wi-act'); if (ac) ac.onchange = () => (I.activate = ac.checked);
      const bk = $('#wi-bk'); if (bk) bk.onchange = () => { I.backup = bk.checked; };
      const blocked = P.error || (running && (I.mode === 'replace' || I.activate));
      foot().innerHTML = `<button class="btn ghost" data-back>${icon('left', 15)} Choose another</button><div class="spacer"></div>${running && !P.error && (I.mode === 'replace' || I.activate) ? '<span class="dim small">Stop the server first</span>' : ''}<button class="btn primary" data-go ${blocked ? 'disabled' : ''}>${icon('upload', 15)} Import world</button>`;
      $('[data-back]', foot()).onclick = () => { if (I.prep && I.prep.staging) call('worlds:discard', I.prep.staging).catch(() => {}); I.prep = null; I.step = 'pick'; draw(); };
      $('[data-go]', foot()).onclick = run;
      return;
    }
    if (I.step === 'done') {
      body().innerHTML = `<div class="center-col" style="padding:30px"><div class="pulse-ring ok">${icon('check', 26)}</div><h3 style="margin:14px 0 4px">World imported!</h3>
        <div class="muted">"${esc(I.result.name)}" is ${I.mode === 'replace' || I.activate ? 'now the active world. Start the server to play on it.' : 'ready. Make it active from the Worlds tab.'}</div>
        ${(I.result.warnings || []).map((w) => `<div class="banner warn" style="margin-top:14px;text-align:left">${icon('alert', 18)}<div class="grow">${esc(w)}</div></div>`).join('')}</div>`;
      foot().innerHTML = `<div class="spacer"></div><button class="btn" data-x>Close</button>${!isRunning(server(s.id)?.status) && (I.mode === 'replace' || I.activate) ? `<button class="btn primary" data-start>${icon('play', 15)} Start server</button>` : ''}`;
      $('[data-x]', foot()).onclick = () => m.close();
      const st = $('[data-start]', foot()); if (st) st.onclick = () => { m.close(); call('servers:start', s.id).catch(fail); switchTab('console'); };
    }
  }
  async function run() {
    I.step = 'working'; I.progress = { step: 'Starting…' }; draw();
    try {
      I.result = await call('worlds:import', s.id, { source: I.prep.source, staging: I.prep.staging, mode: I.mode, name: I.name.trim(), activate: I.mode === 'replace' || I.activate, backup: I.backup, label: I.prep.label });
      I.step = 'done';
      await refreshServers();
      if (state.selected === s.id && state.tab === 'worlds') renderBody();
    } catch (e) { fail(e); I.step = 'review'; }
    draw();
  }
  worldImportHook.current = { id: s.id, update: (p) => { I.progress = p; if (I.step === 'working') { if ($('#prog-step', m.el)) updateProgressUI({ ...p, logs: [] }); else draw(); } } };
  draw();
  if (initialPath) pick(initialPath, initialPath);
}
const worldImportHook = { current: null };
api.onWorldProgress((id, p) => { if (worldImportHook.current && worldImportHook.current.id === id) worldImportHook.current.update(p); });
