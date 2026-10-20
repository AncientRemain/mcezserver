/* global state, call, esc, icon, toast, fail, $, $$, fmtBytes, LOADERS, MC_COLORS, mcFormat, isRunning, isBedrock, isProxy, isJavaGame, hasBuilds, buildLabel, contentLabel, serverAvatar, server, refreshServers, renderHeader, openChangeVersion, duplicateServer, exportServer, deleteServer, confirmDialog, GEYSER_OK, switchTab */
// Server Settings tab.

const JAVA_FIELDS = [
  ['server-port', 'Server port', 'number', 'Default is 25565'],
  ['gamemode', 'Default game mode', ['survival', 'creative', 'adventure', 'spectator']],
  ['difficulty', 'Difficulty', ['peaceful', 'easy', 'normal', 'hard']],
  ['view-distance', 'View distance (chunks)', 'number', 'Lower = better performance'],
  ['simulation-distance', 'Simulation distance (chunks)', 'number', 'How far away crops grow and mobs move'],
  ['spawn-protection', 'Spawn protection radius', 'number', '0 lets everyone build at spawn'],
  ['player-idle-timeout', 'Kick idle players after (minutes)', 'number', '0 = never'],
  ['level-seed', 'World seed', 'text', 'Only used when a new world is generated'],
];
const JAVA_TOGGLES = [
  ['pvp', 'PvP', 'Players can damage each other'],
  ['online-mode', 'Online mode', 'Only allow players with a real Minecraft account (recommended)'],
  ['white-list', 'Whitelist', 'Only whitelisted players can join'],
  ['allow-flight', 'Allow flight', 'Prevents kicks for flying (needed by some mods)'],
  ['hardcore', 'Hardcore', 'One life. Players are set to spectator on death'],
  ['enable-command-block', 'Command blocks', 'Allow command blocks to run'],
  ['allow-nether', 'Nether', 'Allow travel to the Nether'],
  ['force-gamemode', 'Force game mode', 'Players are put in the default game mode when they join'],
  ['generate-structures', 'Generate structures', 'Villages, temples etc. in new chunks'],
  ['hide-online-players', 'Hide player list', 'Don\'t show who is online in the server list'],
];
const BEDROCK_FIELDS = [
  ['server-port', 'Server port', 'number', 'Default is 19132 (TCP + UDP)'],
  ['gamemode', 'Default game mode', ['survival', 'creative', 'adventure']],
  ['difficulty', 'Difficulty', ['peaceful', 'easy', 'normal', 'hard']],
  ['max-players', 'Max players', 'number'],
  ['view-distance', 'View distance (chunks)', 'number'],
  ['tick-distance', 'Simulation distance (4–12)', 'number'],
  ['player-idle-timeout', 'Kick idle players after (minutes)', 'number', '0 = never'],
  ['default-player-permission-level', 'New players are', ['visitor', 'member', 'operator']],
  ['level-seed', 'World seed', 'text', 'Only used when a new world is generated'],
  ['transport', 'Connection method', ['nethernet', 'raknet'], 'NetherNet is what Bedrock 26.60+ (Oct 27, 2026) uses. RakNet is the older method, the only one playit.gg free tunnels carry.'],
];
const BEDROCK_TOGGLES = [
  ['allow-cheats', 'Cheats', 'Allow commands like /give and /tp'],
  ['online-mode', 'Xbox account required', 'Players must sign in with a Microsoft account'],
  ['allow-list', 'Allowlist', 'Only allowlisted players can join'],
  ['force-gamemode', 'Force game mode', 'Players are put in the default game mode'],
  ['texturepack-required', 'Require resource packs', 'Players must download the world\'s resource packs'],
  ['enable-lan-visibility', 'Show on LAN', 'Devices on the same Wi-Fi see it under Friends'],
];

async function renderSettings(tb, s) {
  tb.innerHTML = `<div class="skeleton" style="height:300px"></div>`;
  const proxy = isProxy(s), bedrock = isBedrock(s), java = isJavaGame(s);
  let p = {}, javaInfo = {}, vel = null, sw = null;
  try {
    [p, javaInfo, vel] = await Promise.all([proxy ? {} : call('servers:properties', s.id), call('servers:javaInfo', s.id), proxy ? call('servers:velocity', s.id) : null]);
  } catch (e) { return fail(e); }
  if (state.tab !== 'settings' || state.selected !== s.id) return;
  const sys = state.system;
  const maxMem = Math.max(2048, Math.floor(sys.totalMem / 1048576 / 512) * 512 - 1024);
  const running = isRunning(s.status);
  const props = { ...p };
  const motdLines = String(props.motd ?? s.name).split('\n');
  const fields = bedrock ? BEDROCK_FIELDS : JAVA_FIELDS;
  const toggles = bedrock ? BEDROCK_TOGGLES : JAVA_TOGGLES;
  const field = ([k, label, type, hint]) => `<div class="field"><label>${label}</label>
    ${Array.isArray(type) ? `<select class="input" data-prop="${k}">${type.map((o) => `<option ${String(props[k] || '') === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`
      : `<input class="input" data-prop="${k}" type="${type}" value="${esc(props[k] ?? '')}" />`}
    ${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
  const toggle = ([k, label, hint]) => `<div class="toggle-row"><div class="t"><b>${label}</b><span>${hint}</span></div>
    <label class="switch"><input type="checkbox" data-prop="${k}" ${String(props[k]) === 'true' ? 'checked' : ''}/><span></span></label></div>`;
  const wh = s.webhook || { url: '', events: {} };

  tb.innerHTML = `<div class="settings-layout">
    ${running ? `<div class="banner info">${icon('info', 18)}<div class="grow">Most changes apply the next time the server starts.</div></div>` : ''}
    ${!s.eulaAccepted && !proxy ? `<div class="banner warn">${icon('alert', 18)}<div class="grow">The Minecraft EULA hasn't been accepted for this server, so it won't start. <a data-eula-read>Read the EULA</a></div><button class="btn sm warn" data-eula>I agree to the EULA</button></div>` : ''}

    <div class="card">
      <div class="section-title">General</div><div class="section-sub">Name, icon, notes and resources.</div>
      ${!proxy ? `<div class="row" style="margin-bottom:16px">
        ${serverAvatar(s, 'lg')}
        <div style="flex:1"><b>Server icon</b><div class="dim small">${bedrock ? 'Shown in CraftDock (Bedrock servers don\'t show icons in the game).' : 'Shown in the Minecraft multiplayer list. Any image works, it\'s cropped to a square and resized to 64×64.'}</div></div>
        <button class="btn sm" data-icon-pick>${icon('upload', 14)} ${s.icon ? 'Change' : 'Upload'} icon</button>
        ${s.icon ? `<button class="btn sm ghost" data-icon-rm>${icon('trash', 14)}</button>` : ''}
      </div>` : ''}
      <div class="form-grid">
        <div class="field"><label>Server name (in CraftDock)</label><input class="input" data-cfg="name" value="${esc(s.name)}" maxlength="48" /></div>
        ${!bedrock ? `<div class="field"><label>Memory (RAM) · <span id="mem-val" style="color:var(--text)">${(s.memoryMB / 1024).toFixed(1)} GB</span></label>
          <input type="range" min="${proxy ? 512 : 1024}" max="${maxMem}" step="512" value="${Math.min(s.memoryMB, maxMem)}" data-cfg="memoryMB" style="margin-top:12px" />
          <div class="hint">Your PC has ${fmtBytes(sys.totalMem)}. ${proxy ? 'Proxies need 512 MB–1 GB.' : 'Modpacks usually need 6–10 GB.'}</div></div>` : '<div></div>'}
        <div class="field full"><label>Notes</label><textarea class="input plain" data-cfg="notes" rows="2" placeholder="Anything to remember about this server (shown on the Overview)">${esc(s.notes || '')}</textarea></div>
      </div>
      <div class="toggle-row"><div class="t"><b>Pin to top</b><span>Keep this server at the top of the sidebar and dashboard.</span></div><label class="switch"><input type="checkbox" data-cfg="pinned" ${s.pinned ? 'checked' : ''}/><span></span></label></div>
    </div>

    ${proxy && vel ? `<div class="card">
      <div class="section-title">Proxy</div><div class="section-sub">From velocity.toml. Servers in the network are set up in the Network tab.</div>
      <div class="form-grid">
        <div class="field"><label>Port</label><input class="input" type="number" data-vel="port" value="${vel.port}" /></div>
        <div class="field"><label>Max players shown</label><input class="input" type="number" data-vel="showMaxPlayers" value="${vel.showMaxPlayers}" /></div>
        <div class="field full"><label>Message in the server list</label><input class="input mono" data-vel="motd" value="${esc(vel.motd)}" /><div class="hint">Velocity uses MiniMessage, e.g. &lt;green&gt;Welcome!&lt;/green&gt; or &lt;#09add3&gt;Hello</div></div>
        <div class="field"><label>Player info forwarding</label><select class="input" data-vel="forwarding">${[['modern', 'Modern (Paper, Fabric)'], ['legacy', 'Legacy (BungeeCord style)'], ['bungeeguard', 'BungeeGuard'], ['none', 'None']].map(([v, l]) => `<option value="${v}" ${vel.forwarding === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      <div class="toggle-row"><div class="t"><b>Online mode</b><span>Check that players own Minecraft (recommended)</span></div><label class="switch"><input type="checkbox" data-vel="onlineMode" ${vel.onlineMode ? 'checked' : ''}/><span></span></label></div>
    </div>` : ''}

    ${java ? `<div class="card">
      <div class="section-title">Server list</div><div class="section-sub">How your server looks in the Minecraft multiplayer list.</div>
      <div class="motd-tools">${Object.entries(MC_COLORS).map(([c, col]) => `<button class="mc-swatch" style="background:${col}" data-code="${c}" title="§${c}"></button>`).join('')}
        <span class="sep"></span>${[['l', '<b>B</b>', 'Bold'], ['o', '<i>I</i>', 'Italic'], ['n', '<u>U</u>', 'Underline'], ['m', '<s>S</s>', 'Strikethrough'], ['r', '⟲', 'Reset']].map(([c, l, t]) => `<button class="btn xs" data-code="${c}" title="${t}">${l}</button>`).join('')}</div>
      <div class="form-grid">
        <div class="field full"><label>Line 1</label><input class="input mono motd-line" id="motd1" value="${esc(motdLines[0] || '')}" maxlength="120" /></div>
        <div class="field full"><label>Line 2</label><input class="input mono motd-line" id="motd2" value="${esc(motdLines[1] || '')}" maxlength="120" /></div>
      </div>
      <div class="mc-entry" style="margin-top:12px" id="motd-preview"></div>
      <div class="form-grid" style="margin-top:14px">${field(['max-players', 'Max players', 'number'])}</div>
    </div>` : ''}
    ${bedrock ? `<div class="card"><div class="section-title">Server list</div><div class="section-sub">The name players see in the Servers and Friends tabs.</div>
      <div class="field"><label>Server name</label><input class="input" data-prop="server-name" value="${esc(props['server-name'] || '')}" /></div></div>` : ''}

    ${!proxy ? `<div class="card">
      <div class="section-title">Game</div><div class="section-sub">Common options from server.properties. Worlds and game rules are in the Worlds tab.</div>
      <div class="form-grid" style="margin-bottom:8px">${fields.map(field).join('')}</div>
      ${toggles.filter(([k]) => k in props || ['pvp', 'online-mode', 'white-list', 'allow-flight', 'hardcore', 'enable-command-block'].includes(k) || bedrock).map(toggle).join('')}
    </div>` : ''}

    ${java ? `<div class="card">
      <div class="section-title">Resource pack</div><div class="section-sub">Send a resource pack to players when they join.</div>
      <div class="form-grid">
        <div class="field full"><label>Download link</label><input class="input mono" data-prop="resource-pack" value="${esc(props['resource-pack'] || '')}" placeholder="https://… (a direct link to a .zip)" /></div>
        <div class="field full"><label>SHA-1 (helps players cache it)</label><div class="row" style="gap:6px"><input class="input mono" data-prop="resource-pack-sha1" value="${esc(props['resource-pack-sha1'] || '')}" /><button class="btn sm" data-sha1>${icon('wand', 14)} Work it out</button></div></div>
        <div class="field full"><label>Message shown to players</label><input class="input" data-prop="resource-pack-prompt" value="${esc(props['resource-pack-prompt'] || '')}" placeholder="Optional" /></div>
      </div>
      ${toggle(['require-resource-pack', 'Required', 'Players who decline are disconnected'])}
    </div>` : ''}

    ${GEYSER_OK(s.loader, s.mcVersion) ? `<div class="card">
      <div class="section-title">Bedrock cross-play</div><div class="section-sub">Let phone, tablet and console players join with Geyser + Floodgate (no Java account needed).</div>
      ${s.geyser && s.geyser.enabled ? `<div class="row"><span class="chip accent">${icon('check', 12)} Installed</span><div class="field" style="flex:0 0 220px"><label>Bedrock port (UDP)</label><input class="input" type="number" id="gey-port" value="${s.geyser.port || 19132}" /></div><button class="btn sm" data-gey-save style="align-self:flex-end">Save port</button><div class="spacer"></div><button class="btn sm ghost" data-gey-mods>Manage in ${contentLabel(s.loader)}</button></div>
        <div class="dim small" style="margin-top:8px">Bedrock players join with your address and this port (open it for both TCP and UDP if you port forward). Their names start with a dot (e.g. .Steve). CraftDock sets Geyser up for NetherNet, Bedrock's new connection method.</div>`
      : `<div class="row"><button class="btn primary" data-gey-install>${icon('download', 15)} Turn on cross-play</button><span class="dim small">Downloads Geyser and Floodgate${!/^26\./.test(s.mcVersion) ? ' (plus ViaVersion for this version)' : ''}. Restart the server afterwards.</span></div>`}
    </div>` : ''}

    <div class="card">
      <div class="section-title">Performance${bedrock ? '' : ' &amp; Java'}</div><div class="section-sub">${javaInfo.path ? `Using Java ${esc(javaInfo.version || s.javaFeature)} · <span class="mono small selectable">${esc(javaInfo.path)}</span>` : bedrock ? 'Bedrock servers run natively (no Java).' : esc(javaInfo.error || '')}</div>
      ${!bedrock ? `<div class="toggle-row"><div class="t"><b>Optimized JVM flags</b><span>${proxy ? 'Velocity\'s recommended G1GC flags.' : 'Aikar\'s G1GC flags. Smoother tick times on most servers.'}</span></div><label class="switch"><input type="checkbox" data-cfg="optimizedFlags" ${s.optimizedFlags ? 'checked' : ''}/><span></span></label></div>` : ''}
      <div class="toggle-row"><div class="t"><b>Auto-restart on crash</b><span>Restart up to 3 times within 10 minutes if the server crashes.</span></div><label class="switch"><input type="checkbox" data-cfg="autoRestart" ${s.autoRestart ? 'checked' : ''}/><span></span></label></div>
      <div class="form-grid" style="margin-top:12px">
        ${!bedrock ? `<div class="field"><label>Java version</label><select class="input" data-cfg="javaOverride"><option value="">Automatic (Java ${esc(s.javaFeature || '?')})</option>${[8, 11, 17, 21, 25].map((v) => `<option value="${v}" ${Number(s.javaOverride) === v ? 'selected' : ''}>Java ${v}</option>`).join('')}</select><div class="hint">Only change this if a mod or plugin needs a specific Java.</div></div>` : ''}
        <div class="field"><label>CPU priority</label><select class="input" data-cfg="priority">${[['low', 'Below normal'], ['normal', 'Normal'], ['above', 'Above normal'], ['high', 'High']].map(([v, l]) => `<option value="${v}" ${(s.priority || 'normal') === v ? 'selected' : ''}>${l}</option>`).join('')}</select><div class="hint">Higher gives the server more CPU when your PC is busy.</div></div>
        ${!bedrock ? `<div class="field full"><label>Extra JVM arguments</label><input class="input mono" data-cfg="jvmArgs" value="${esc(s.jvmArgs || '')}" placeholder="-Dfile.encoding=UTF-8" /></div>
        <div class="field full"><label>Extra server arguments</label><input class="input mono" data-cfg="serverArgs" value="${esc(s.serverArgs || '')}" placeholder="Added after nogui, e.g. --forceUpgrade" /></div>
        <div class="field full"><label>Custom Java path (optional)</label><input class="input mono" data-cfg="javaPath" value="${esc(s.javaPath || '')}" placeholder="Leave empty to use the Java CraftDock downloads automatically" /></div>` : ''}
      </div>
    </div>

    <div class="card">
      <div class="section-title">${icon('discord', 16)} Discord notifications</div><div class="section-sub">Post to a Discord channel when things happen. In Discord: Channel settings → Integrations → Webhooks → New Webhook → Copy URL.</div>
      <div class="row" style="gap:8px"><input class="input mono" id="wh-url" type="password" value="${esc(wh.url)}" placeholder="https://discord.com/api/webhooks/…" /><button class="btn sm" data-wh-show title="Show">${icon('search', 14)}</button><button class="btn sm" data-wh-test>${icon('send', 14)} Test</button></div>
      <div class="chips-toggle" style="margin-top:12px">${[['online', 'Server online'], ['offline', 'Server stopped'], ['crash', 'Crashes'], ['join', 'Player joins'], ['leave', 'Player leaves'], ['backup', 'Backups']].map(([k, l]) => `<label class="chip-check"><input type="checkbox" data-wh-ev="${k}" ${wh.events[k] ? 'checked' : ''} /><span>${l}</span></label>`).join('')}</div>
      <div class="row" style="margin-top:12px"><div class="spacer"></div>${wh.url ? `<button class="btn sm ghost" data-wh-clear>${icon('trash', 14)} Remove</button>` : ''}<button class="btn sm primary" data-wh-save>${icon('check', 14)} Save notifications</button></div>
    </div>

    <div class="card">
      <div class="section-title">Version &amp; tools</div><div class="section-sub">Currently ${esc(LOADERS[s.loader].name)} ${esc(s.mcVersion)}${s.loaderVersion && hasBuilds(s.loader) ? ` · ${esc(s.loaderVersion)}` : ''}.</div>
      <div id="sw-update" class="sw-update"></div>
      <div class="row wrap">
        <button class="btn" data-change-version ${running ? 'disabled' : ''}>${icon('update', 15)} Change version</button>
        <button class="btn" data-check-sw>${icon('search', 15)} Check for a newer build</button>
        <button class="btn" data-clone ${running ? 'disabled' : ''}>${icon('copy', 15)} Duplicate</button>
        <button class="btn" data-export>${icon('download', 15)} Export as .zip</button>
        <button class="btn" data-open-folder>${icon('folder', 15)} Open folder</button>
      </div>
      ${running ? `<div class="dim small" style="margin-top:8px">Stop the server to change its version or duplicate it.</div>` : ''}
    </div>
    ${!proxy ? `<div class="card">
      <div class="section-title">All properties</div><div class="section-sub">Every key in server.properties. <a data-raw-toggle>Show</a></div>
      <div id="raw-props" style="display:none"><div class="form-grid">${Object.keys(props).sort().map((k) => `<div class="field"><label class="mono small">${esc(k)}</label><input class="input mono" data-prop="${esc(k)}" value="${esc(props[k])}" /></div>`).join('')}</div></div>
    </div>` : ''}
    <div class="card" style="border-color:color-mix(in srgb, var(--danger) 25%, var(--border))">
      <div class="section-title">Danger zone</div><div class="section-sub">These actions can't be undone.</div>
      <div class="row wrap"><button class="btn" data-reinstall ${running ? 'disabled' : ''}>${icon('download', 15)} Reinstall server files</button><button class="btn danger" data-delete ${running ? 'disabled' : ''}>${icon('trash', 15)} Delete server</button></div>
    </div>
    <div class="save-bar"><span class="dim small" id="dirty-note" style="align-self:center"></span><button class="btn primary" id="save-btn" disabled>${icon('check', 16)} Save changes</button></div>
  </div>`;

  const cfgPatch = {}, propPatch = {}, velPatch = {};
  const markDirty = () => {
    const n = Object.keys(cfgPatch).length + Object.keys(propPatch).length + Object.keys(velPatch).length;
    $('#save-btn').disabled = !n;
    $('#dirty-note').textContent = n ? `${n} unsaved change${n > 1 ? 's' : ''}` : '';
  };
  $$('[data-cfg]', tb).forEach((el) => {
    el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', () => {
      const k = el.dataset.cfg;
      cfgPatch[k] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.tagName === 'TEXTAREA' ? el.value : el.value.trim();
      if (k === 'memoryMB') $('#mem-val').textContent = `${(el.value / 1024).toFixed(1)} GB`;
      markDirty();
    });
  });
  $$('[data-prop]', tb).forEach((el) => {
    el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', () => {
      const k = el.dataset.prop;
      const v = el.type === 'checkbox' ? String(el.checked) : el.value;
      propPatch[k] = v;
      $$(`[data-prop="${CSS.escape(k)}"]`, tb).forEach((o) => { if (o !== el) { if (o.type === 'checkbox') o.checked = v === 'true'; else o.value = v; } });
      markDirty();
    });
  });
  $$('[data-vel]', tb).forEach((el) => {
    el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', () => {
      velPatch[el.dataset.vel] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
      markDirty();
    });
  });

  // MOTD editor
  if (java) {
    let lastFocus = $('#motd1', tb);
    const preview = () => {
      const text = `${$('#motd1', tb).value}${$('#motd2', tb).value ? '\n' + $('#motd2', tb).value : ''}`;
      propPatch.motd = text;
      markDirty();
      $('#motd-preview', tb).innerHTML = `<div class="mc-icon">${s.icon ? `<img src="${s.icon}" />` : `<div class="mc-noicon">${icon(s.loader, 26)}</div>`}</div>
        <div class="mc-text"><div class="mc-name">${esc(s.name)}</div><div class="mc-motd">${text.split('\n').slice(0, 2).map(mcFormat).join('<br>')}</div></div>
        <div class="mc-right"><span>0/${esc(propPatch['max-players'] || props['max-players'] || 20)}</span><span class="mc-bars on"><i></i><i></i><i></i><i></i><i></i></span></div>`;
    };
    $$('.motd-line', tb).forEach((el) => { el.onfocus = () => (lastFocus = el); el.oninput = preview; });
    $$('[data-code]', tb).forEach((b) => (b.onmousedown = (e) => {
      e.preventDefault();
      const el = lastFocus;
      const at = el.selectionStart ?? el.value.length;
      el.setRangeText(`§${b.dataset.code}`, at, el.selectionEnd ?? at, 'end');
      el.focus();
      preview();
    }));
    preview();
    delete propPatch.motd;
    markDirty();
  }

  const sha = $('[data-sha1]', tb);
  if (sha) sha.onclick = async () => {
    const url = $('[data-prop="resource-pack"]', tb).value.trim();
    if (!/^https:\/\//.test(url)) return toast('Enter an https:// link to the resource pack first', 'error');
    sha.disabled = true; sha.innerHTML = `${icon('restart', 14, 'spin')} Downloading…`;
    try {
      const h = await call('util:sha1Url', url);
      const inp = $('[data-prop="resource-pack-sha1"]', tb);
      inp.value = h; inp.dispatchEvent(new Event('input'));
      toast('SHA-1 filled in', 'success', 1500);
    } catch (e) { fail(e); }
    sha.disabled = false; sha.innerHTML = `${icon('wand', 14)} Work it out`;
  };

  // Geyser
  const gi = $('[data-gey-install]', tb);
  if (gi) gi.onclick = async () => {
    gi.disabled = true; gi.innerHTML = `${icon('restart', 15, 'spin')} Installing…`;
    try { const r = await call('mods:installGeyser', s.id); toast(`Installed ${r.installed.join(', ')}. Restart the server to turn it on.`, 'success', 7000); r.warnings.forEach((w) => toast(w, 'error', 8000)); await refreshServers(); renderSettings(tb, server(s.id)); } catch (e) { fail(e); gi.disabled = false; }
  };
  const gs = $('[data-gey-save]', tb);
  if (gs) gs.onclick = async () => { try { await call('servers:update', s.id, { geyser: { port: Number($('#gey-port', tb).value) || 19132 } }); await refreshServers(); toast('Bedrock port saved. Restart to apply.', 'success'); } catch (e) { fail(e); } };
  const gm = $('[data-gey-mods]', tb); if (gm) gm.onclick = () => switchTab('mods');

  // Discord
  const whUrl = $('#wh-url', tb);
  $('[data-wh-show]', tb).onclick = () => { whUrl.type = whUrl.type === 'password' ? 'text' : 'password'; };
  $('[data-wh-test]', tb).onclick = async () => {
    try { await call('servers:testWebhook', s.id, whUrl.value.trim()); toast('Test message sent to Discord', 'success'); } catch (e) { fail(e); }
  };
  const whEvents = () => Object.fromEntries($$('[data-wh-ev]', tb).map((c) => [c.dataset.whEv, c.checked]));
  $('[data-wh-save]', tb).onclick = async () => {
    try { await call('servers:update', s.id, { webhook: { url: whUrl.value.trim(), events: whEvents() } }); await refreshServers(); toast('Discord notifications saved', 'success'); renderSettings(tb, server(s.id)); } catch (e) { fail(e); }
  };
  const whc = $('[data-wh-clear]', tb);
  if (whc) whc.onclick = async () => { await call('servers:update', s.id, { webhook: { url: '' } }); await refreshServers(); renderSettings(tb, server(s.id)); };

  // software updates
  const checkSw = async (quiet) => {
    const box = $('#sw-update', tb);
    if (!box) return;
    try {
      sw = await call('servers:softwareUpdate', s.id);
      if (!box.isConnected) return;
      box.innerHTML = sw.available ? `<div class="banner info">${icon('update', 18)}<div class="grow">A newer ${isBedrock(s) ? 'Bedrock server' : buildLabel(s.loader).toLowerCase()} is available: <b>${esc(sw.latestLabel || sw.latest)}</b> (you have ${esc(sw.current || '?')}).</div><button class="btn sm primary" data-sw-go ${running ? 'disabled' : ''}>${running ? 'Stop to update' : 'Update now'}</button></div>`
        : quiet ? '' : `<div class="dim small" style="margin-bottom:10px">${icon('check', 12)} You have the newest ${isBedrock(s) ? 'version' : 'build'}.</div>`;
      const go = $('[data-sw-go]', box);
      if (go) go.onclick = async () => { go.disabled = true; try { await call('servers:createBackup', s.id).catch(() => {}); await call('servers:updateSoftware', s.id); state.progress[s.id] = { step: 'Updating…', logs: [] }; await refreshServers(); renderHeader(); switchTab('overview'); } catch (e) { fail(e); go.disabled = false; } };
    } catch (e) { if (!quiet) fail(e); }
  };
  $('[data-check-sw]', tb).onclick = () => checkSw(false);
  if (hasBuilds(s.loader) || bedrock) checkSw(true);

  $('#save-btn').onclick = async () => {
    try {
      if ('javaOverride' in cfgPatch) cfgPatch.javaOverride = cfgPatch.javaOverride ? Number(cfgPatch.javaOverride) : null;
      if (Object.keys(cfgPatch).length) await call('servers:update', s.id, cfgPatch);
      if (Object.keys(propPatch).length) await call('servers:setProperties', s.id, propPatch);
      if (Object.keys(velPatch).length) await call('servers:setVelocity', s.id, velPatch);
      toast('Settings saved', 'success');
      await refreshServers();
      renderHeader();
      renderSettings(tb, server(s.id));
    } catch (e) { fail(e); }
  };
  const ip = $('[data-icon-pick]', tb);
  if (ip) ip.onclick = async () => {
    try { if (await call('servers:pickIcon', s.id)) { await refreshServers(); renderHeader(); renderSettings(tb, server(s.id)); toast('Server icon updated', 'success'); } } catch (e) { fail(e); }
  };
  const irm = $('[data-icon-rm]', tb);
  if (irm) irm.onclick = async () => { await call('servers:removeIcon', s.id); await refreshServers(); renderHeader(); renderSettings(tb, server(s.id)); };
  $('[data-open-folder]', tb).onclick = () => call('servers:openFolder', s.id).catch(fail);
  $('[data-change-version]', tb).onclick = () => openChangeVersion(s);
  $('[data-clone]', tb).onclick = () => duplicateServer(s);
  $('[data-export]', tb).onclick = () => exportServer(s);
  const rt = $('[data-raw-toggle]', tb);
  if (rt) rt.onclick = (e) => { const r = $('#raw-props'); const show = r.style.display === 'none'; r.style.display = show ? '' : 'none'; e.target.textContent = show ? 'Hide' : 'Show'; };
  const eb = $('[data-eula]', tb);
  if (eb) eb.onclick = async () => { await call('servers:acceptEula', s.id); await refreshServers(); renderSettings(tb, server(s.id)); };
  const er = $('[data-eula-read]', tb); if (er) er.onclick = () => call('shell:open', 'https://aka.ms/MinecraftEULA');
  $('[data-delete]', tb).onclick = () => deleteServer(s);
  $('[data-reinstall]', tb).onclick = async () => {
    if (!(await confirmDialog({ title: 'Reinstall server files?', message: 'Downloads the server software again. Your world, mods and settings are kept.', confirm: 'Reinstall' }))) return;
    call('servers:reinstall', s.id).catch(fail);
  };
}
