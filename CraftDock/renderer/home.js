/* global state, call, esc, icon, toast, fail, $, $$, fmtBytes, LOADERS, CATEGORIES, statusPill, serverAvatar, isRunning, select, serverAction, serverMenu, sortedServers, openCreateWizard, openImportWizard, head, tpsColor, isJavaGame, confirmDialog */
// Dashboard: every server at a glance.

const home = { query: '', filter: 'all' };

function renderHome(main) {
  const list = state.servers;
  const running = list.filter((s) => isRunning(s.status));
  const players = running.reduce((a, s) => a + ((state.stats[s.id] && state.stats[s.id].players) || (s.players || []).length || 0), 0);
  const mem = running.reduce((a, s) => a + ((state.stats[s.id] && state.stats[s.id].mem) || 0), 0);
  const view = state.settings?.dashboardView || 'grid';
  const q = home.query.toLowerCase();
  const shown = sortedServers(list).filter((s) =>
    (home.filter === 'all' || (home.filter === 'running' ? isRunning(s.status) : LOADERS[s.loader]?.cat === home.filter)) &&
    (!q || s.name.toLowerCase().includes(q) || s.mcVersion.includes(q) || (LOADERS[s.loader]?.name || '').toLowerCase().includes(q)));
  const cats = [...new Set(list.map((s) => LOADERS[s.loader]?.cat))];
  const focused = document.activeElement && document.activeElement.id === 'home-q';

  main.innerHTML = `<div class="page">
    ${list.length ? `
    <div class="page-header">
      <div><h1>Your servers</h1><div class="subtitle">${list.length} server${list.length > 1 ? 's' : ''} · ${running.length} running · Ctrl+K to jump anywhere</div></div>
      <div class="spacer"></div>
      <button class="btn" data-import-home>${icon('upload', 16)} Import</button>
      <button class="btn primary" data-new>${icon('plus', 16)} New server</button>
    </div>
    <div class="grid g-4 summary" style="margin-bottom:18px">
      ${tile('grid', '#60a5fa', 'Servers', list.length, `${list.filter((s) => s.state === 'ready').length} ready to start`)}
      ${tile('activity', '#34d399', 'Running', running.length, running.length ? running.map((s) => s.name).slice(0, 2).join(', ') + (running.length > 2 ? '…' : '') : 'Nothing running')}
      ${tile('users', '#fbbf24', 'Players online', players, players ? 'across all servers' : 'Nobody online')}
      ${tile('memory', '#a78bfa', 'RAM in use', fmtBytes(mem), `of ${fmtBytes(state.system?.totalMem || 0)} on this PC`)}
    </div>
    <div class="row wrap" style="margin-bottom:14px;gap:8px">
      <div class="search-input" style="max-width:320px">${icon('search', 16)}<input class="input" id="home-q" placeholder="Search servers…" value="${esc(home.query)}" /></div>
      <div class="segmented sm">${[['all', 'All'], ['running', 'Running'], ...CATEGORIES.filter(([k]) => cats.includes(k)).map(([k, l]) => [k, l.replace('Vanilla & plugins', 'Plugins').replace('Mod loaders', 'Modded').replace('Network proxy', 'Proxy').replace('Bedrock Edition', 'Bedrock')])].map(([k, l]) => `<button class="${home.filter === k ? 'active' : ''}" data-filter="${k}">${l}</button>`).join('')}</div>
      <div class="spacer"></div>
      <button class="btn sm" data-start-all ${list.some((s) => s.state === 'ready' && !isRunning(s.status)) ? '' : 'disabled'}>${icon('play', 13)} Start all</button>
      <button class="btn sm danger" data-stop-all ${running.length ? '' : 'disabled'}>${icon('stop', 12)} Stop all</button>
      <div class="segmented sm"><button class="${view === 'grid' ? 'active' : ''}" data-view="grid" title="Cards">${icon('grid', 13)}</button><button class="${view === 'list' ? 'active' : ''}" data-view="list" title="List">${icon('list', 13)}</button></div>
    </div>
    ${shown.length ? (view === 'list'
      ? `<div class="card" style="padding:0"><div class="list server-table">${shown.map(homeRow).join('')}</div></div>`
      : `<div class="grid g-3" id="home-grid">${shown.map((s) => homeCard(s)).join('')}<div class="card new-card" data-new><div>${icon('plus', 26)}<div style="margin-top:8px;font-weight:600">New server</div></div></div></div>`)
      : `<div class="empty"><div class="ic-wrap">${icon('search', 24)}</div><h3>No servers match</h3><div>Try another search or filter.</div></div>`}
    <div class="dim small" style="margin-top:16px">Tip: drag a server folder or .zip anywhere onto this page to import it. Right-click a server for more options.</div>`
    : `
    <div class="hero">
      <h1>Host your own Minecraft server</h1>
      <p>Pick from 15 server types (Vanilla, Paper, Purpur, Fabric, Forge, NeoForge, Quilt, Bedrock, Velocity and more), choose a version, and CraftDock handles Java, installers and the EULA. Then add mods and plugins from Modrinth or CurseForge.</p>
      <div class="row" style="gap:10px"><button class="btn primary lg" data-new>${icon('plus', 17)} Create server</button><button class="btn lg" data-import-home>${icon('upload', 17)} Import server</button></div>
      <div class="dim small" style="margin-top:12px">Tip: drag a server folder or .zip anywhere onto this page to import it.</div>
      <div class="cubes">${['vanilla', 'paper', 'fabric', 'forge', 'neoforge', 'bedrock', 'purpur', 'quilt', 'velocity'].map((l) => `<i style="color:${LOADERS[l].color}">${icon(l, 20)}</i>`).join('')}</div>
    </div>
    <div class="grid g-3">${[
      ['sparkle', '#34d399', 'Every server type', 'Java and Bedrock, plugins, mods or both, plus Velocity networks. Any version, including snapshots. The right Java is downloaded for you.'],
      ['world', '#f472b6', 'Bring your worlds', 'Import a singleplayer world from your launcher in a couple of clicks, or download a server world to play offline.'],
      ['activity', '#fbbf24', 'Live stats & automation', 'Watch CPU, RAM, TPS and players live. Schedule restarts, backups and messages, and get Discord alerts.'],
    ].map(([ic, c, t, d]) => `<div class="card"><div class="mod-icon" style="color:${c};background:${c}1a;border-color:${c}33;margin-bottom:14px">${icon(ic, 19)}</div><div style="font-weight:650;margin-bottom:4px">${t}</div><div class="muted small">${d}</div></div>`).join('')}</div>`}
  </div>`;
  $$('[data-new]', main).forEach((b) => (b.onclick = () => openCreateWizard()));
  $$('[data-import-home]', main).forEach((b) => (b.onclick = () => openImportWizard()));
  const hq = $('#home-q', main);
  if (hq) {
    hq.oninput = () => { home.query = hq.value; renderHome(main); };
    if (focused) { hq.focus(); hq.setSelectionRange(hq.value.length, hq.value.length); }
  }
  $$('[data-filter]', main).forEach((b) => (b.onclick = () => { home.filter = b.dataset.filter; renderHome(main); }));
  $$('[data-view]', main).forEach((b) => (b.onclick = async () => { state.settings = await call('settings:set', { dashboardView: b.dataset.view }); renderHome(main); }));
  const sa = $('[data-start-all]', main);
  if (sa) sa.onclick = async () => { sa.disabled = true; try { const n = await call('servers:startAll'); toast(`Starting ${n} server${n === 1 ? '' : 's'}`, 'success'); } catch (e) { fail(e); } };
  const so = $('[data-stop-all]', main);
  if (so) so.onclick = async () => {
    const online = running.reduce((a, s) => a + (s.players || []).length, 0);
    if (online && state.settings?.confirmStop && !(await confirmDialog({ title: 'Stop all servers?', message: `${online} player${online > 1 ? 's are' : ' is'} online. They will be disconnected.`, confirm: 'Stop all', danger: true }))) return;
    so.disabled = true;
    call('servers:stopAll').catch(fail);
    toast('Stopping all servers…', 'info');
  };
  bindHomeCards(main);
}

const tile = (ic, c, label, value, foot) => `<div class="card stat" style="--glow:${c}33"><div class="label">${icon(ic, 14)} ${label}</div><div class="value">${esc(String(value))}</div><div class="foot">${esc(foot)}</div></div>`;

function playerStack(s) {
  const p = s.players || [];
  if (!p.length) return '';
  return `<span class="heads" title="${esc(p.join(', '))}">${p.slice(0, 4).map((n) => head(n, 20)).join('')}${p.length > 4 ? `<span class="more">+${p.length - 4}</span>` : ''}</span>`;
}

function homeCard(s) {
  const st = state.stats[s.id] || {};
  const running = isRunning(s.status);
  const tps = st.tps;
  return `<div class="card server-card" data-card="${esc(s.id)}">
    <div class="top">${serverAvatar(s, 'md')}<div style="flex:1;min-width:0"><div class="nm">${s.pinned ? `<span class="pin-star">${icon('star', 12)}</span>` : ''}${esc(s.name)}</div><div class="dim small">${s.modpack ? 'Modpack · ' : ''}${esc(LOADERS[s.loader].name)} ${esc(s.mcVersion)}${s.playit?.enabled ? ` · <span style="color:var(--accent)">${icon('globe', 11)} public</span>` : ''}</div></div>${statusPill(s.status)}
      <button class="btn xs icon ghost" data-menu title="More">${icon('more', 15)}</button></div>
    <div class="mini">
      <div><b>${running && st.cpu != null ? st.cpu.toFixed(0) + '%' : '—'}</b><span>CPU</span></div>
      <div><b>${running && st.mem ? (st.mem / 1073741824).toFixed(1) + 'G' : '—'}</b><span>RAM</span></div>
      <div><b>${running ? (st.players ?? 0) : '—'}</b><span>Players</span></div>
      ${isJavaGame(s) ? `<div><b style="color:${running && tps != null ? tpsColor(tps) : 'inherit'}">${running && tps != null ? tps.toFixed(1) : '—'}</b><span>TPS</span></div>` : ''}
    </div>
    <div class="row">
      ${['installing', 'error'].includes(s.status) ? `<span class="dim small">${s.status === 'error' ? 'Install failed. Open to retry.' : 'Installing…'}</span>`
        : running ? `<button class="btn sm danger" data-q="stop">${icon('stop', 13)} Stop</button>` : `<button class="btn sm primary" data-q="start">${icon('play', 13)} Start</button>`}
      ${playerStack(s)}
      <div class="spacer"></div><span class="dim small mono">${s.loader === 'bedrock' ? 'port ' : ':'}${s.port}</span>
    </div></div>`;
}

function homeRow(s) {
  const st = state.stats[s.id] || {};
  const running = isRunning(s.status);
  return `<div class="list-row server-row" data-card="${esc(s.id)}">
    ${serverAvatar(s, 'md')}
    <div class="grow"><div class="title">${s.pinned ? `<span class="pin-star">${icon('star', 11)}</span>` : ''}${esc(s.name)}</div><div class="desc">${esc(LOADERS[s.loader].name)} ${esc(s.mcVersion)} · port ${s.port}</div></div>
    ${playerStack(s)}
    <span class="cell">${running && st.cpu != null ? st.cpu.toFixed(0) + '%' : '—'}<small>CPU</small></span>
    <span class="cell">${running && st.mem ? (st.mem / 1073741824).toFixed(1) + ' GB' : '—'}<small>RAM</small></span>
    <span class="cell">${running ? st.players ?? 0 : '—'}<small>Players</small></span>
    ${statusPill(s.status)}
    ${['installing', 'error'].includes(s.status) ? '<span style="width:76px"></span>' : running ? `<button class="btn xs danger" data-q="stop">${icon('stop', 12)} Stop</button>` : `<button class="btn xs primary" data-q="start">${icon('play', 12)} Start</button>`}
    <button class="btn xs icon ghost" data-menu title="More">${icon('more', 15)}</button>
  </div>`;
}

function bindHomeCards(root) {
  $$('[data-card]', root).forEach((c) => {
    c.onclick = (e) => { if (!e.target.closest('[data-q],[data-menu]')) select(c.dataset.card); };
    c.oncontextmenu = (e) => { e.preventDefault(); serverMenu(state.servers.find((s) => s.id === c.dataset.card), e.target.closest('[data-card]')); };
    const q = $('[data-q]', c);
    if (q) q.onclick = () => serverAction(c.dataset.card, q.dataset.q);
    const mb = $('[data-menu]', c);
    if (mb) mb.onclick = (e) => { e.stopPropagation(); serverMenu(state.servers.find((s) => s.id === c.dataset.card), mb); };
  });
}

function refreshHomeCard(id) {
  const el = $(`[data-card="${CSS.escape(id)}"]`);
  const s = state.servers.find((x) => x.id === id);
  if (!el || !s) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = el.classList.contains('server-row') ? homeRow(s) : homeCard(s);
  const fresh = tmp.firstElementChild;
  el.replaceWith(fresh);
  bindHomeCards(fresh.parentElement);
}
