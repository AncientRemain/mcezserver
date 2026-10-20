/* global state, call, esc, icon, toast, fail, $, $$, fmtBytes, ACCENTS, THEMES, LOADERS, accentColors, applyAppearance, renderPlayitSettings, renderSidebar, mcFormat */
// App-wide settings page.

const SETTINGS_SECTIONS = [
  ['general', 'gear', 'General'],
  ['appearance', 'palette', 'Appearance'],
  ['notifications', 'bell', 'Notifications'],
  ['integrations', 'globe', 'Integrations'],
  ['backups', 'archive', 'Backups'],
  ['defaults', 'sliders', 'New servers'],
  ['shortcuts', 'command', 'Keyboard shortcuts'],
  ['about', 'disk', 'Storage & about'],
];

function renderAppSettings(main) {
  const st = state.settings;
  const sys = state.system;
  const toggle = (key, title, sub, disabled) => `<div class="toggle-row"><div class="t"><b>${title}</b><span>${sub}</span></div>
    <label class="switch"><input type="checkbox" data-set="${key}" ${st[key] ? 'checked' : ''} ${disabled ? 'disabled' : ''}/><span></span></label></div>`;
  const select = (key, title, sub, options) => `<div class="toggle-row"><div class="t"><b>${title}</b><span>${sub}</span></div>
    <select class="input" data-sel="${key}" style="width:200px">${options.map(([v, l]) => `<option value="${v}" ${String(st[key]) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
  const maxMem = Math.max(2048, Math.floor(sys.totalMem / 1048576 / 512) * 512 - 1024);
  const customAccent = !ACCENTS[st.accent] ? st.accent : '';
  main.innerHTML = `<div class="page">
    <div class="page-header"><div><h1>Settings</h1><div class="subtitle">Changes are saved automatically.</div></div></div>
    <div class="settings-page">
      <nav class="settings-nav">${SETTINGS_SECTIONS.map(([k, ic, l]) => `<a data-jump="${k}">${icon(ic, 15)} ${l}</a>`).join('')}</nav>
      <div class="settings-layout">
        <div class="card" id="sec-general">
          <div class="section-title">General</div><div class="section-sub">How CraftDock behaves on your computer.</div>
          ${toggle('closeToTray', 'Keep running in the system tray', 'Closing the window hides CraftDock to the tray so your servers keep running. Quit from the tray icon.')}
          ${toggle('launchAtLogin', 'Launch at Windows startup', st.packaged ? 'Start CraftDock automatically when you sign in to Windows.' : 'Available in the installed app (not when running from source).', !st.packaged)}
          ${toggle('startMinimized', 'Start minimized to tray', 'When launched at startup, stay in the tray instead of opening the window.')}
          ${select('startPage', 'When CraftDock opens, show', 'Pick up where you left off, or start on the dashboard.', [['dashboard', 'The dashboard'], ['last', 'The last server I had open']])}
          ${toggle('confirmStop', 'Confirm before stopping with players online', 'Asks first if someone is still playing.')}
          ${toggle('tpsMonitor', 'Measure TPS on the Overview', 'Asks the server for its tick rate every 10 seconds while you look at the Overview. The answers are hidden from the console.')}
        </div>

        <div class="card" id="sec-appearance">
          <div class="section-title">Appearance</div><div class="section-sub">Make it yours.</div>
          <div class="label-text" style="margin-bottom:10px">Theme</div>
          <div class="themes">${THEMES.map(([k, l, bg, panel]) => `<button class="theme-card ${st.theme === k ? 'active' : ''}" data-theme-pick="${k}">
            <span class="tc-prev" style="${bg ? `background:${bg}` : 'background:linear-gradient(135deg,#0b0d12 50%,#f4f6fa 50%)'}">${bg ? `<i style="background:${panel}"></i><i style="background:${panel}"></i>` : ''}</span><span>${l}</span></button>`).join('')}</div>
          <div class="label-text" style="margin:18px 0 10px">Accent color</div>
          <div class="swatches">${Object.entries(ACCENTS).map(([k, [c]]) => `<button class="swatch ${st.accent === k ? 'active' : ''}" data-accent="${k}" style="--c:${c}" title="${k}"></button>`).join('')}
            <label class="swatch custom ${customAccent ? 'active' : ''}" title="Pick any color" style="--c:${customAccent || '#ffffff'}">${icon('palette', 16)}<input type="color" id="accent-custom" value="${esc(customAccent || accentColors(st.accent)[0])}" /></label></div>
          <div class="field" style="margin-top:18px"><label>Interface size · <span id="ui-v" style="color:var(--text)">${st.uiScale}%</span></label>
            <input type="range" id="ui-scale" min="70" max="150" step="5" value="${st.uiScale}" style="margin-top:10px" />
            <div class="hint">Makes everything bigger or smaller. Ctrl+0 on a laptop? Use this instead.</div></div>
          ${select('density', 'Layout density', 'Compact fits more on screen.', [['comfortable', 'Comfortable'], ['compact', 'Compact']])}
          ${select('dashboardView', 'Dashboard style', 'How servers are shown on the dashboard.', [['grid', 'Cards'], ['list', 'List']])}
          ${toggle('compactSidebar', 'Slim sidebar', 'Hide server details in the sidebar for more room.')}
          ${toggle('backgroundGlow', 'Background glow', 'Soft colored light behind the dashboard and cards.')}
          ${toggle('reduceMotion', 'Reduce motion', 'Turn off animations.')}
          <div class="label-text" style="margin:18px 0 10px">Console</div>
          <div class="field"><label>Text size · <span id="cf-v" style="color:var(--text)">${st.consoleFontSize}px</span></label><input type="range" id="console-size" min="10" max="20" step="1" value="${st.consoleFontSize}" style="margin-top:10px" /></div>
          <div class="console" id="console-sample" style="margin-top:12px;height:auto"></div>
          ${toggle('consoleColors', 'Colors', 'Show Minecraft and log colors in the console.')}
          ${toggle('consoleWrap', 'Wrap long lines', 'Off scrolls sideways instead.')}
          ${toggle('consoleTimestamps', 'Timestamps on CraftDock messages', 'Adds the time to console lines that don\'t already have one.')}
        </div>

        <div class="card" id="sec-notifications">
          <div class="section-title">Notifications</div><div class="section-sub">Windows notifications, even when CraftDock is in the tray. For Discord alerts, open a server → Settings → Discord notifications.</div>
          ${toggle('notifyCrash', 'Server crashed', 'Get notified right away if a server crashes.')}
          ${toggle('notifyOnline', 'Server is ready', 'When a server finishes starting and players can join.')}
          ${toggle('notifyPlayers', 'Players join or leave', 'See who hops on and off.')}
        </div>

        <div class="card" id="sec-integrations">
          <div class="section-title">Integrations</div><div class="section-sub">Connect outside services.</div>
          <div id="playit-settings" class="integration"></div>
          <div class="integration">
            <div class="row" style="margin-bottom:12px">
              <span class="playit-mark lg" style="--pm:#f16436">${icon('puzzle', 18)}</span>
              <div style="flex:1"><b>CurseForge</b><div class="dim small">Search and install CurseForge mods. CurseForge requires a free API key from <a data-cf>console.curseforge.com</a> (sign in → API keys). Stored encrypted on this computer.</div></div>
              ${st.hasCurseforgeKey ? `<span class="chip accent">${icon('check', 12)} Key saved</span>` : `<span class="chip">No key</span>`}
            </div>
            <div class="row">
              <input class="input mono" id="cf-key" type="password" placeholder="${st.hasCurseforgeKey ? '•••••••••••••••• (paste a new key to replace)' : 'Paste your CurseForge API key'}" />
              <button class="btn primary" data-cf-save>Save key</button>
              ${st.hasCurseforgeKey ? `<button class="btn ghost" data-cf-clear>${icon('trash', 14)}</button>` : ''}
            </div>
          </div>
        </div>

        <div class="card" id="sec-backups">
          <div class="section-title">Backups</div><div class="section-sub">Where backups are saved. A different drive (or a synced folder like OneDrive) keeps them safe if something happens to this one.</div>
          <div class="row"><div class="address" style="flex:1;margin:0"><div style="flex:1;min-width:0"><div class="lbl">Backup folder</div><div class="val selectable">${esc(st.backupDir || 'Inside each server folder (default)')}</div></div></div>
            <button class="btn sm" data-bk-pick>${icon('folder', 14)} Choose…</button>${st.backupDir ? `<button class="btn sm ghost" data-bk-reset>Use default</button>` : ''}</div>
          <div class="dim small" style="margin-top:8px">New backups go to the new place. Existing backups stay where they are.</div>
        </div>

        <div class="card" id="sec-defaults">
          <div class="section-title">New servers</div><div class="section-sub">Used when you create a new server.</div>
          ${select('defaultLoader', 'Server type picked first', 'Pre-selected in the New server window.', Object.entries(LOADERS).map(([k, l]) => [k, l.name]))}
          <div class="field" style="margin-top:12px"><label>Default RAM · <span id="dm-v" style="color:var(--text)">${(st.defaultMemoryMB / 1024).toFixed(1)} GB</span></label>
            <input type="range" id="dm" min="1024" max="${maxMem}" step="512" value="${Math.min(st.defaultMemoryMB, maxMem)}" style="margin-top:10px" />
            <div class="hint">Your PC has ${fmtBytes(sys.totalMem)}. 4 GB suits most servers, 6–10 GB for big modpacks.</div></div>
        </div>

        <div class="card" id="sec-shortcuts">
          <div class="section-title">Keyboard shortcuts</div><div class="section-sub">Get around faster.</div>
          <div class="kv shortcuts">${[
            ['Ctrl + K', 'Command palette: jump to anything'], ['Ctrl + N', 'New server'], ['Ctrl + I', 'Import a server'], ['Ctrl + D', 'Dashboard'], ['Ctrl + ,', 'Settings'],
            ['Ctrl + 1 … 9', 'Switch server tabs'], ['Ctrl + Shift + ↑ / ↓', 'Previous / next server'], ['Ctrl + F', 'Search the console'], ['Ctrl + S', 'Save settings or file'],
            ['↑ / ↓ in console', 'Command history'], ['Tab in console', 'Complete commands & player names'], ['Right-click a server', 'Quick menu'], ['Esc', 'Close dialog'],
          ].map(([k, v]) => `<div class="k"><span class="kbd big">${k}</span></div><div class="v" style="text-align:left">${v}</div>`).join('')}</div>
        </div>

        <div class="card" id="sec-about">
          <div class="section-title">Storage &amp; about</div>
          <div class="section-sub">Servers, Java runtimes, backups and the playit agent live in <span class="mono selectable">${esc(sys.dataDir)}</span></div>
          <div class="row wrap"><button class="btn sm" data-open-data>${icon('folder', 14)} Open data folder</button><button class="btn sm" data-cache>${icon('trash', 14)} Clear download caches <span class="dim" id="cache-size"></span></button></div>
          <div class="dim small" style="margin-top:14px">CraftDock ${esc(sys.version)} · ${esc(sys.cpuModel || '')} · ${sys.cpus} threads · ${fmtBytes(sys.totalMem)} RAM</div>
        </div>
      </div>
    </div>
  </div>`;

  const save = async (patch, msg) => {
    try { state.settings = await call('settings:set', patch); applyAppearance(); if (msg) toast(msg, 'success', 1500); } catch (e) { fail(e); }
  };
  const sample = $('#console-sample', main);
  const SAMPLE = '§a[12:00:01 INFO]§r: Done (3.2s)! For help, type "help"\n§e[12:00:05 WARN]§r: Can\'t keep up! Is the server overloaded?\n§b<Steve>§r hello world';
  const drawSample = () => { sample.innerHTML = SAMPLE.split('\n').map((l) => `<div>${state.settings.consoleColors !== false ? mcFormat(l) : esc(l.replace(/§./g, ''))}</div>`).join(''); };
  drawSample();
  $$('[data-set]', main).forEach((el) => (el.onchange = async () => { await save({ [el.dataset.set]: el.checked }, 'Saved'); drawSample(); if (el.dataset.set === 'compactSidebar') renderSidebar(); }));
  $$('[data-sel]', main).forEach((el) => (el.onchange = () => save({ [el.dataset.sel]: el.value }, 'Saved')));
  $$('[data-theme-pick]', main).forEach((b) => (b.onclick = async () => {
    $$('[data-theme-pick]', main).forEach((x) => x.classList.toggle('active', x === b));
    await save({ theme: b.dataset.themePick });
  }));
  $$('[data-accent]', main).forEach((b) => (b.onclick = async () => {
    $$('.swatch', main).forEach((x) => x.classList.toggle('active', x === b));
    await save({ accent: b.dataset.accent });
  }));
  const ac = $('#accent-custom', main);
  ac.oninput = () => { document.documentElement.style.setProperty('--accent', ac.value); };
  ac.onchange = async () => { $$('.swatch', main).forEach((x) => x.classList.toggle('active', x.classList.contains('custom'))); ac.parentElement.style.setProperty('--c', ac.value); await save({ accent: ac.value }); };
  const ui = $('#ui-scale', main);
  ui.oninput = () => ($('#ui-v', main).textContent = `${ui.value}%`);
  ui.onchange = () => save({ uiScale: Number(ui.value) });
  const cs = $('#console-size', main);
  cs.oninput = () => { $('#cf-v', main).textContent = `${cs.value}px`; document.documentElement.style.setProperty('--console-size', `${cs.value}px`); };
  cs.onchange = () => save({ consoleFontSize: Number(cs.value) });
  $('#dm', main).oninput = (e) => ($('#dm-v', main).textContent = `${(e.target.value / 1024).toFixed(1)} GB`);
  $('#dm', main).onchange = (e) => save({ defaultMemoryMB: Number(e.target.value) }, 'Saved');
  $('[data-cf]', main).onclick = () => call('shell:open', 'https://console.curseforge.com/');
  $('[data-cf-save]', main).onclick = async () => {
    const key = $('#cf-key', main).value.trim();
    if (!key) return toast('Paste a key first', 'error');
    await save({ curseforgeKey: key }, 'CurseForge key saved');
    state.mods.hits = [];
    renderAppSettings(main);
  };
  const clr = $('[data-cf-clear]', main);
  if (clr) clr.onclick = async () => { await save({ curseforgeKey: '' }, 'CurseForge key removed'); renderAppSettings(main); };
  $('[data-bk-pick]', main).onclick = async () => {
    const d = await call('settings:pickBackupDir').catch(fail);
    if (d) { await save({ backupDir: d }, 'Backup folder saved'); renderAppSettings(main); }
  };
  const bkr = $('[data-bk-reset]', main);
  if (bkr) bkr.onclick = async () => { await save({ backupDir: '' }, 'Backups are saved in each server folder again'); renderAppSettings(main); };
  $('[data-open-data]', main).onclick = () => call('app:openData');
  call('app:cacheInfo').then((c) => { const el = $('#cache-size', main); if (el) el.textContent = `(${fmtBytes(c.bytes)})`; }).catch(() => {});
  $('[data-cache]', main).onclick = async () => { try { await call('app:clearCache'); toast('Caches cleared', 'success'); const el = $('#cache-size', main); if (el) el.textContent = '(0 B)'; } catch (e) { fail(e); } };
  $$('[data-jump]', main).forEach((a) => (a.onclick = () => $(`#sec-${a.dataset.jump}`, main).scrollIntoView({ behavior: 'smooth', block: 'start' })));
  renderPlayitSettings($('#playit-settings', main));
  if (state.settingsSection) { const t = $(`#sec-${state.settingsSection}`, main); if (t) t.scrollIntoView({ block: 'start' }); state.settingsSection = null; }
}
