/* global state, call, esc, icon, $, $$, LOADERS, isRunning, select, switchTab, tabsFor, serverAction, server, openCreateWizard, openImportWizard, openAppSettings, applyAppearance, openWorldImport, openLogsBrowser, fail */
// Ctrl+K command palette: jump to any server, tab or action by typing.

function paletteItems() {
  const items = [];
  const cur = server();
  if (cur) {
    const running = isRunning(cur.status);
    if (!['installing', 'error'].includes(cur.status)) {
      if (running) {
        items.push({ ic: 'stop', label: `Stop ${cur.name}`, hint: 'Server', run: () => serverAction(cur.id, 'stop') });
        items.push({ ic: 'restart', label: `Restart ${cur.name}`, hint: 'Server', run: () => serverAction(cur.id, 'restart') });
      } else items.push({ ic: 'play', label: `Start ${cur.name}`, hint: 'Server', run: () => serverAction(cur.id, 'start') });
      for (const [k, ic, label] of tabsFor(cur)) items.push({ ic, label: `${cur.name}: ${label}`, hint: 'Tab', run: () => switchTab(k) });
      if (cur.loader !== 'velocity') items.push({ ic: 'world', label: `Import a world into ${cur.name}`, hint: 'World', run: () => openWorldImport(cur) });
      items.push({ ic: 'file', label: `Log files of ${cur.name}`, hint: 'Logs', run: () => openLogsBrowser(cur) });
    }
  }
  for (const s of state.servers) {
    items.push({ ic: s.loader, label: s.name, hint: `${LOADERS[s.loader].name} ${s.mcVersion} · open`, run: () => select(s.id) });
    if (s.state === 'ready') items.push({ ic: isRunning(s.status) ? 'stop' : 'play', label: `${isRunning(s.status) ? 'Stop' : 'Start'} ${s.name}`, hint: 'Server', run: () => serverAction(s.id, isRunning(s.status) ? 'stop' : 'start') });
  }
  items.push(
    { ic: 'plus', label: 'New server', hint: 'Ctrl+N', run: () => openCreateWizard() },
    { ic: 'upload', label: 'Import a server', hint: 'Ctrl+I', run: () => openImportWizard() },
    { ic: 'grid', label: 'Dashboard', hint: 'Ctrl+D', run: () => select(null) },
    { ic: 'gear', label: 'Settings', hint: 'Ctrl+,', run: () => openAppSettings() },
    { ic: 'palette', label: 'Appearance settings', hint: 'Settings', run: () => openAppSettings('appearance') },
    { ic: 'archive', label: 'Backup folder settings', hint: 'Settings', run: () => openAppSettings('backups') },
    { ic: 'globe', label: 'playit.gg settings', hint: 'Settings', run: () => openAppSettings('integrations') },
    { ic: 'moon', label: 'Switch to dark theme', hint: 'Theme', run: () => setTheme('dark') },
    { ic: 'moon', label: 'Switch to midnight theme', hint: 'Theme', run: () => setTheme('midnight') },
    { ic: 'sun', label: 'Switch to light theme', hint: 'Theme', run: () => setTheme('light') },
    { ic: 'stop', label: 'Stop all servers', hint: 'All', run: () => call('servers:stopAll').catch(fail) },
    { ic: 'play', label: 'Start all servers', hint: 'All', run: () => call('servers:startAll').catch(fail) },
  );
  for (const [k, l] of Object.entries(LOADERS)) items.push({ ic: k, label: `New ${l.name} server`, hint: 'Create', run: () => openCreateWizard(k) });
  return items;
}

async function setTheme(theme) {
  state.settings = await call('settings:set', { theme });
  applyAppearance();
}

function fuzzy(q, text) {
  q = q.toLowerCase(); text = text.toLowerCase();
  if (!q) return 1;
  if (text.includes(q)) return 100 - text.indexOf(q);
  let i = 0;
  for (const ch of text) if (ch === q[i]) i++;
  return i === q.length ? 10 : 0;
}

function openPalette() {
  if ($('.palette-backdrop')) return;
  const all = paletteItems();
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop palette-backdrop';
  wrap.innerHTML = `<div class="palette"><div class="palette-input">${icon('search', 17)}<input id="pal-q" placeholder="Type a server, tab or action…" autocomplete="off" spellcheck="false" /><span class="kbd big">Esc</span></div><div class="palette-list" id="pal-list"></div></div>`;
  document.body.appendChild(wrap);
  const input = $('#pal-q', wrap);
  let shown = [], active = 0;
  const close = () => wrap.remove();
  const draw = () => {
    const q = input.value.trim();
    shown = all.map((it) => ({ it, score: fuzzy(q, `${it.label} ${it.hint}`) })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 40).map((x) => x.it);
    active = Math.min(active, Math.max(0, shown.length - 1));
    $('#pal-list', wrap).innerHTML = shown.map((it, i) => `<div class="pal-item ${i === active ? 'active' : ''}" data-i="${i}">${icon(it.ic, 16)}<span class="l">${esc(it.label)}</span><span class="h">${esc(it.hint)}</span></div>`).join('') || '<div class="dim small" style="padding:14px">Nothing found.</div>';
    $$('.pal-item', wrap).forEach((el) => {
      el.onmousemove = () => { if (active !== Number(el.dataset.i)) { active = Number(el.dataset.i); draw(); } };
      el.onclick = () => { close(); shown[el.dataset.i].run(); };
    });
    const a = $('.pal-item.active', wrap); if (a) a.scrollIntoView({ block: 'nearest' });
  };
  input.oninput = () => { active = 0; draw(); };
  input.onkeydown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(shown.length - 1, active + 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); const it = shown[active]; close(); if (it) it.run(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  };
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  draw();
  input.focus();
}
