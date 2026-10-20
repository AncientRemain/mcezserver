/* global state, api, call, esc, icon, toast, fail, modal, $, $$, fmtBytes, fmtNum, ago, debounce, LOADERS, SOURCES, KIND_NAME, kindsOf, isRunning, isBedrock, isProxy, isJavaGame, confirmDialog, openPerfModal, openAppSettings, server */
// Mods / plugins / datapacks (Modrinth + CurseForge) and Bedrock add-ons.

/** Content kinds shown for a server: its own kinds, plus datapacks on every Java game server. */
function tabKinds(s) {
  const k = kindsOf(s.loader).filter((x) => x !== 'addon' || isBedrock(s));
  if (isJavaGame(s) && !k.includes('datapack')) k.push('datapack');
  return k;
}
const kname = (k, plural = true) => (KIND_NAME[k] || KIND_NAME.mod)[plural ? 1 : 0];

function renderMods(tb, s) {
  if (isBedrock(s)) return renderAddons(tb, s);
  const M = state.mods;
  const kinds = tabKinds(s);
  if (!M.kind || !kinds.includes(M.kind)) M.kind = kinds[0];
  const kind = M.kind;
  tb.innerHTML = `
    <div class="row wrap" style="margin-bottom:18px">
      ${kinds.length > 1 ? `<div class="segmented">${kinds.map((k) => `<button class="${k === kind ? 'active' : ''}" data-kind="${k}">${icon(k === 'datapack' ? 'layers' : 'puzzle', 14)} ${kname(k)}</button>`).join('')}</div>` : ''}
      <div class="segmented">
        <button class="${M.sub === 'installed' ? 'active' : ''}" data-sub="installed">Installed <span class="dim" id="inst-count"></span></button>
        <button class="${M.sub === 'browse' ? 'active' : ''}" data-sub="browse">${icon('search', 14)} Browse</button>
      </div>
      <div class="spacer"></div>
      <div id="mods-tools" class="row"></div>
    </div>
    <div id="mods-body"></div>`;
  $$('[data-kind]', tb).forEach((b) => (b.onclick = () => { M.kind = b.dataset.kind; M.hits = []; M.installed = []; M.updates = null; M.offset = 0; M.category = ''; renderMods(tb, s); }));
  $$('[data-sub]', tb).forEach((b) => (b.onclick = () => { M.sub = b.dataset.sub; renderMods(tb, s); }));
  if (M.sub === 'installed') renderInstalled(s, kind);
  else renderBrowse(s, kind);
}

async function renderInstalled(s, kind) {
  const M = state.mods;
  const label = kname(kind);
  const tools = $('#mods-tools');
  const canPerf = kind !== 'datapack' && !isProxy(s) && !['vanilla', 'sponge'].includes(s.loader) && !s.modpack;
  tools.innerHTML = `
    ${canPerf ? `<button class="btn sm" data-perf-open>${icon('zap', 15)} Performance</button>` : ''}
    <button class="btn sm" data-upd>${icon('update', 15)} Check for updates</button>
    <button class="btn sm" data-add>${icon('upload', 15)} Add files</button>
    <button class="btn sm icon" title="Open folder" data-folder>${icon('folder', 15)}</button>`;
  $('[data-add]', tools).onclick = async () => {
    try { const added = await call('mods:pickFiles', s.id, kind); if (added.length) { toast(`Added ${added.length} file(s)`, 'success'); renderInstalled(s, kind); } } catch (e) { fail(e); }
  };
  $('[data-folder]', tools).onclick = () => call('servers:openFolder', s.id, kind === 'datapack' ? `${s.levelName || 'world'}/datapacks` : kind === 'plugin' && s.loader !== 'sponge' ? 'plugins' : 'mods').catch(fail);
  const po = $('[data-perf-open]', tools);
  if (po) po.onclick = () => openPerfModal(s, () => renderInstalled(s, kind));
  $('[data-upd]', tools).onclick = async (ev) => {
    const b = ev.currentTarget;
    b.disabled = true; b.innerHTML = `${icon('restart', 15, 'spin')} Checking…`;
    try {
      M.updates = await call('mods:checkUpdates', s.id, kind);
      toast(M.updates.length ? `${M.updates.length} update(s) available` : `All ${label.toLowerCase()} are up to date`, M.updates.length ? 'info' : 'success');
    } catch (e) { fail(e); }
    renderInstalled(s, kind);
  };

  const body = $('#mods-body');
  if (!M.installed.length) body.innerHTML = `<div class="skeleton" style="height:120px"></div>`;
  try { M.installed = await call('mods:list', s.id, kind); } catch (e) { fail(e); M.installed = []; }
  if (state.selected !== s.id || state.tab !== 'mods' || M.sub !== 'installed' || M.kind !== kind) return;
  const ic = $('#inst-count'); if (ic) ic.textContent = M.installed.length ? `(${M.installed.length})` : '';
  const updates = (M.updates || []).filter((u) => !u.kind || u.kind === kind);
  const running = isRunning(s.status);
  const q = (M.filter || '').toLowerCase();
  const shown = M.installed.filter((m) => !q || m.title.toLowerCase().includes(q) || m.file.toLowerCase().includes(q));

  body.innerHTML = `
    ${running ? `<div class="banner info">${icon('info', 18)}<div class="grow">Changes take effect after you restart the server${kind === 'datapack' ? ' (or run /reload)' : ''}.</div></div>` : ''}
    ${kind === 'datapack' ? `<div class="dim small" style="margin-bottom:12px">${icon('world', 12)} Datapacks for the active world, <b>${esc(s.levelName || 'world')}</b>.</div>` : ''}
    ${s.lastVersionChange && s.lastVersionChange.disabled.length && Date.now() - s.lastVersionChange.at < 7 * 86400000 ? `<div class="banner warn">${icon('alert', 18)}<div class="grow">
      After switching to ${esc(s.mcVersion)}, these were turned off because they don't have a version for it yet: <b>${s.lastVersionChange.disabled.map(esc).join(', ')}</b>. Check back later with "Check for updates", or turn them on below if you know they work.</div></div>` : ''}
    ${s.automation?.updateOnStart && kind !== 'datapack' ? `<div class="dim small" style="margin-bottom:12px">${icon('update', 12)} Auto-update is on: ${label.toLowerCase()} are updated to their newest versions before each start.</div>` : ''}
    ${updates.length ? `<div class="card" style="margin-bottom:16px;border-color:color-mix(in srgb, var(--accent) 35%, transparent)">
      <div class="card-title">${icon('update', 16)} ${updates.length} update${updates.length > 1 ? 's' : ''} available<span class="right"><button class="btn sm primary" data-upd-all>Update all</button></span></div>
      <div class="list">${updates.map((u, i) => `<div class="list-row" style="padding:8px 0">
        ${u.icon ? `<img class="mod-icon" style="width:32px;height:32px" src="${esc(u.icon)}" />` : `<div class="mod-icon" style="width:32px;height:32px">${icon('puzzle', 15)}</div>`}
        <div class="grow"><div class="title">${esc(u.title)}</div><div class="desc">${esc(u.from)} → <span style="color:var(--accent)">${esc(u.to)}</span></div></div>
        <button class="btn xs" data-upd-one="${i}">Update</button></div>`).join('')}</div></div>` : ''}
    <div class="row" style="margin-bottom:12px;gap:10px">
      ${M.installed.length > 8 ? `<div class="search-input" style="max-width:300px">${icon('search', 15)}<input class="input" id="inst-q" placeholder="Filter installed…" value="${esc(M.filter || '')}" /></div>` : ''}
      <div class="dropzone grow-1" id="drop">${icon('upload', 16)} Drag &amp; drop .jar${kind === 'datapack' ? ' / .zip' : ''} files here</div>
    </div>
    ${shown.length ? `<div class="card" style="padding:0"><div class="list">${shown.map((m) => {
      const i = M.installed.indexOf(m);
      return `<div class="list-row ${m.enabled ? '' : 'disabled'}">
        ${m.icon ? `<img class="mod-icon" src="${esc(m.icon)}" loading="lazy" />` : `<div class="mod-icon">${icon(kind === 'datapack' ? 'layers' : 'puzzle', 18)}</div>`}
        <div class="grow"><div class="title">${esc(m.title)}</div><div class="desc">${esc(m.version || m.file)}${m.size ? ` · ${fmtBytes(m.size)}` : m.folder ? ' · folder' : ''}</div></div>
        ${m.source !== 'local' ? `<span class="chip"><span class="src-dot" style="background:${SOURCES[m.source]?.color}"></span>${SOURCES[m.source]?.name}</span>` : `<span class="chip">Manual</span>`}
        ${m.url ? `<button class="btn xs icon ghost" title="Open page" data-url="${esc(m.url)}">${icon('external', 14)}</button>` : ''}
        ${m.folder ? '' : `<label class="switch" title="${m.enabled ? 'Disable' : 'Enable'}"><input type="checkbox" data-toggle="${i}" ${m.enabled ? 'checked' : ''}/><span></span></label>`}
        <button class="btn xs icon ghost" title="Remove" data-rm="${i}">${icon('trash', 14)}</button>
      </div>`; }).join('')}</div></div>`
      : M.installed.length ? '<div class="dim">Nothing matches.</div>' : `<div class="empty"><div class="ic-wrap">${icon('puzzle', 24)}</div><h3>No ${label.toLowerCase()} installed</h3><div>Browse Modrinth${kind === 'datapack' || kind === 'mod' || ['paper', 'purpur', 'leaf', 'spigot', 'mohist', 'youer'].includes(s.loader) ? ' or CurseForge' : ''} to add some.</div><div style="margin-top:16px"><button class="btn primary" data-go-browse>${icon('search', 15)} Browse ${label.toLowerCase()}</button></div></div>`}`;

  const iq = $('#inst-q'); if (iq) iq.oninput = debounce(() => { M.filter = iq.value; renderInstalled(s, kind); setTimeout(() => { const n = $('#inst-q'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }); }, 200);
  const gb = $('[data-go-browse]', body); if (gb) gb.onclick = () => { M.sub = 'browse'; renderMods($('#tab-body'), s); };
  $$('[data-url]', body).forEach((b) => (b.onclick = () => call('shell:open', b.dataset.url).catch(fail)));
  $$('[data-toggle]', body).forEach((c) => (c.onchange = async () => {
    const m = M.installed[c.dataset.toggle];
    try { await call('mods:toggle', s.id, m.file, c.checked, kind); renderInstalled(s, kind); } catch (e) { fail(e); }
  }));
  $$('[data-rm]', body).forEach((b) => (b.onclick = async () => {
    const m = M.installed[b.dataset.rm];
    if (!(await confirmDialog({ title: `Remove ${m.title}?`, message: `This deletes ${m.file} from the server.`, confirm: 'Remove', danger: true }))) return;
    try { await call('mods:remove', s.id, m.file, kind); toast(`Removed ${m.title}`, 'success'); renderInstalled(s, kind); } catch (e) { fail(e); }
  }));
  const doUpdate = async (list) => {
    for (const u of list) {
      try { await call('mods:install', s.id, 'modrinth', u.projectId, u.versionId, u.kind || kind); } catch (e) { fail(e); }
    }
    M.updates = (M.updates || []).filter((u) => !list.includes(u));
    toast(`Updated ${list.length} ${list.length > 1 ? label.toLowerCase() : kname(kind, false).toLowerCase()}`, 'success');
    renderInstalled(s, kind);
  };
  const ua = $('[data-upd-all]', body); if (ua) ua.onclick = (e) => { e.currentTarget.disabled = true; doUpdate([...updates]); };
  $$('[data-upd-one]', body).forEach((b) => (b.onclick = () => { b.disabled = true; doUpdate([updates[b.dataset.updOne]]); }));

  const drop = $('#drop');
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = async (e) => {
    e.preventDefault(); drop.classList.remove('over');
    const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
    try { const added = await call('mods:addFiles', s.id, paths, kind); toast(added.length ? `Added ${added.length} file(s)` : 'Only .jar or .zip files can be added', added.length ? 'success' : 'error'); renderInstalled(s, kind); } catch (er) { fail(er); }
  };
}

function cfAllowed(s, kind) {
  if (kind === 'datapack' || kind === 'mod') return true;
  return ['paper', 'purpur', 'leaf', 'spigot', 'mohist', 'youer'].includes(s.loader);
}

async function renderBrowse(s, kind) {
  const M = state.mods;
  const label = kname(kind);
  if (!cfAllowed(s, kind)) M.source = 'modrinth';
  const tools = $('#mods-tools');
  tools.innerHTML = `<div class="segmented">${Object.entries(SOURCES).map(([k, v]) => `<button class="${M.source === k ? 'active' : ''}" data-src="${k}" ${k === 'curseforge' && !cfAllowed(s, kind) ? 'disabled title="Not available for this server type"' : ''}><span class="src-dot" style="background:${v.color}"></span>${v.name}</button>`).join('')}</div>`;
  $$('[data-src]', tools).forEach((b) => (b.onclick = () => { M.source = b.dataset.src; M.hits = []; M.offset = 0; renderBrowse(s, kind); }));
  const body = $('#mods-body');
  let cats = [];
  if (M.source === 'modrinth') { try { cats = await call('mods:categories', kind); } catch {} }
  body.innerHTML = `
    <div class="row" style="margin-bottom:16px">
      <div class="search-input">${icon('search', 16)}<input class="input" id="mod-q" placeholder="Search ${label.toLowerCase()} for ${esc(LOADERS[s.loader].name)} ${esc(s.mcVersion)}…" value="${esc(M.query)}" /></div>
      ${cats.length ? `<select class="input" id="mod-cat" style="width:170px"><option value="">All categories</option>${cats.map((c) => `<option value="${c}" ${M.category === c ? 'selected' : ''}>${c.replace(/-/g, ' ').replace(/^./, (x) => x.toUpperCase())}</option>`).join('')}</select>` : ''}
      <select class="input" id="mod-sort" style="width:170px">
        ${[['relevance', 'Relevance'], ['downloads', 'Most downloaded'], ['follows', 'Most followed'], ['updated', 'Recently updated'], ['newest', 'Newest']].map(([v, l]) => `<option value="${v}" ${M.sort === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    <div id="mod-results"></div>`;
  const q = $('#mod-q');
  const run = () => { M.query = q.value; M.offset = 0; M.hits = []; doSearch(s, kind); };
  q.oninput = debounce(run, 350);
  $('#mod-sort').onchange = (e) => { M.sort = e.target.value; run(); };
  const mc = $('#mod-cat'); if (mc) mc.onchange = (e) => { M.category = e.target.value; run(); };
  q.focus();
  if (M.hits.length) drawResults(s, kind); else doSearch(s, kind);
}

let searchSeq = 0;
async function doSearch(s, kind, append = false) {
  const M = state.mods;
  const res = $('#mod-results');
  const seq = ++searchSeq;
  if (!append && res) res.innerHTML = `<div class="mod-grid">${Array.from({ length: 6 }, () => `<div class="skeleton" style="height:120px"></div>`).join('')}</div>`;
  try {
    const r = await call('mods:search', s.id, M.source, { query: M.query, sort: M.sort, offset: M.offset, limit: 20, kind, category: M.source === 'modrinth' ? M.category : '' });
    if (seq !== searchSeq) return;
    M.total = r.total;
    M.hits = append ? [...M.hits, ...r.hits] : r.hits;
    drawResults(s, kind);
  } catch (e) {
    if (seq !== searchSeq || !$('#mod-results')) return;
    if (e.code === 'NO_CF_KEY' || /NO_CF_KEY|API key/.test(e.message)) {
      $('#mod-results').innerHTML = `<div class="empty"><div class="ic-wrap">${icon('key', 24)}</div><h3>CurseForge needs an API key</h3>
        <div style="max-width:460px;margin:0 auto">CurseForge only lets apps search their site with a key. It's free: sign in at console.curseforge.com, create an API key, and paste it in App settings.</div>
        <div class="row" style="justify-content:center;margin-top:16px"><button class="btn" data-cf-site>${icon('external', 15)} Get a key</button><button class="btn primary" data-cf-set>${icon('gear', 15)} Open App settings</button></div></div>`;
      $('[data-cf-site]').onclick = () => call('shell:open', 'https://console.curseforge.com/');
      $('[data-cf-set]').onclick = () => openAppSettings('integrations');
    } else {
      $('#mod-results').innerHTML = `<div class="banner danger">${icon('alert', 18)}<div class="grow">${esc(e.message)}</div></div>`;
    }
  }
}

function drawResults(s, kind) {
  const M = state.mods;
  const res = $('#mod-results');
  if (!res) return;
  if (!M.hits.length) {
    res.innerHTML = `<div class="empty"><div class="ic-wrap">${icon('search', 24)}</div><h3>No results</h3><div>Nothing on ${SOURCES[M.source].name} matches for ${esc(LOADERS[s.loader].name)} ${esc(s.mcVersion)}.</div></div>`;
    return;
  }
  const installedIds = new Set(M.installed.map((m) => m.projectId).filter(Boolean));
  res.innerHTML = `<div class="dim small" style="margin-bottom:10px">${fmtNum(M.total)} results on ${SOURCES[M.source].name}</div>
    <div class="mod-grid">${M.hits.map((h, i) => {
      const inst = installedIds.has(h.id);
      const busy = M.busy.has(h.id);
      const clientOnly = h.serverSide === 'unsupported';
      return `<div class="mod-card">
        ${h.icon ? `<img class="mod-icon lg" src="${esc(h.icon)}" loading="lazy" />` : `<div class="mod-icon lg">${icon('puzzle', 24)}</div>`}
        <div class="body">
          <div class="t" title="${esc(h.title)}"><a data-details="${i}">${esc(h.title)}</a></div>
          <div class="by">by ${esc(h.author || 'unknown')}</div>
          <div class="d" title="${esc(h.description)}">${esc(h.description)}</div>
          <div class="foot">
            <span class="stat-i">${icon('download', 13)} ${fmtNum(h.downloads)}</span>
            ${h.updated ? `<span class="stat-i">${icon('clock', 13)} ${ago(h.updated)}</span>` : ''}
            ${h.clientSide === 'unsupported' ? `<span class="chip info" style="font-size:11px">Server-only</span>` : ''}
            ${clientOnly ? `<span class="chip warn" style="font-size:11px">Client-only</span>` : ''}
            <div class="spacer"></div>
            <button class="btn xs ghost" data-details="${i}">Details</button>
            <button class="btn xs ${inst ? '' : 'primary'}" data-install="${i}" ${busy ? 'disabled' : ''}>${busy ? `${icon('restart', 13, 'spin')} Installing` : inst ? `${icon('check', 13)} Installed` : `${icon('download', 13)} Install`}</button>
          </div>
        </div></div>`;
    }).join('')}</div>
    ${M.hits.length < M.total ? `<div style="text-align:center;margin-top:18px"><button class="btn" id="more">Load more</button></div>` : ''}`;
  $$('[data-install]', res).forEach((b) => (b.onclick = () => installMod(s, M.hits[b.dataset.install], null, kind)));
  $$('[data-details]', res).forEach((b) => (b.onclick = () => openProject(s, M.hits[b.dataset.details], kind)));
  const more = $('#more');
  if (more) more.onclick = () => { more.disabled = true; M.offset = M.hits.length; doSearch(s, kind, true); };
}

async function installMod(s, hit, versionId, kind) {
  const M = state.mods;
  M.busy.add(hit.id);
  if (M.sub === 'browse') drawResults(s, kind);
  try {
    const r = await call('mods:install', s.id, hit.source, hit.id, versionId, kind);
    toast(`Installed ${r.installed.join(', ')}`, 'success');
    r.warnings.forEach((w) => toast(w, 'error', 8000));
    M.installed = await call('mods:list', s.id, kind);
  } catch (e) {
    fail(e);
    if (e.url) call('shell:open', e.url).catch(() => {});
  }
  M.busy.delete(hit.id);
  if (state.selected === s.id && state.tab === 'mods' && M.sub === 'browse') drawResults(s, kind);
}

// ---------- tiny, safe markdown for project descriptions ----------
function mdInline(t) {
  return t
    .replace(/!\[([^\]]*)\]\((https:\/\/[^)\s]+)[^)]*\)/g, (_, a, u) => `<img src="${u}" alt="${a}" loading="lazy" />`)
    .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)[^)]*\)/g, (_, txt, u) => `<a data-ext="${u}">${txt}</a>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/__([^_]+)__/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>').replace(/(^|[\s(])_([^_\s][^_]*)_/g, '$1<i>$2</i>');
}
function renderMarkdown(md) {
  let s = String(md || '');
  s = s.replace(/<img[^>]*?src=["'](https:[^"']+)["'][^>]*>/gi, (_, src) => `\n![](${src})\n`);
  s = s.replace(/<a[^>]*?href=["'](https:[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => `[${inner.replace(/<[^>]+>/g, '').trim() || href}](${href})`);
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?(p|div|center|details|summary|table|tr|tbody|thead)[^>]*>/gi, '\n');
  s = s.replace(/<h(\d)[^>]*>/gi, '\n### ').replace(/<li[^>]*>/gi, '\n- ').replace(/<hr[^>]*>/gi, '\n---\n');
  s = s.replace(/<[^>]+>/g, '');
  s = esc(s).replace(/&amp;(#?\w+);/g, '&$1;');
  const out = [];
  let inList = false, inCode = false;
  for (const line of s.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) { out.push(inCode ? '</pre>' : '<pre class="md-code">'); inCode = !inCode; continue; }
    if (inCode) { out.push(line + '\n'); continue; }
    const li = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.*)$/);
    if (li) { if (!inList) { out.push('<ul>'); inList = true; } out.push(`<li>${mdInline(li[1])}</li>`); continue; }
    if (inList) { out.push('</ul>'); inList = false; }
    const h = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (h) { if (h[2].trim()) out.push(`<h4>${mdInline(h[2])}</h4>`); continue; }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push('<hr />'); continue; }
    if (/^\s*&gt;/.test(line)) {
      const inner = line.replace(/^\s*(&gt;\s?)+/, '');
      const hq = inner.match(/^#{1,6}\s+(.*)$/);
      if (inner.trim()) out.push(`<blockquote>${hq ? `<b>${mdInline(hq[1])}</b>` : mdInline(inner)}</blockquote>`);
      continue;
    }
    if (line.trim()) out.push(`<p>${mdInline(line)}</p>`);
  }
  if (inList) out.push('</ul>');
  if (inCode) out.push('</pre>');
  return out.join('');
}

async function openProject(s, hit, kind) {
  const m = modal({
    title: `${hit.icon ? `<img class="mod-icon" src="${esc(hit.icon)}" />` : `<div class="mod-icon">${icon('puzzle', 18)}</div>`}<div style="min-width:0"><h2>${esc(hit.title)}</h2><div class="dim small">by ${esc(hit.author || 'unknown')} · ${fmtNum(hit.downloads)} downloads · ${SOURCES[hit.source].name}</div></div>`,
    size: 'xl', body: '<div class="skeleton" style="height:320px"></div>',
    foot: `<button class="btn ghost" data-page>${icon('external', 14)} Open on ${SOURCES[hit.source].name}</button><div class="spacer"></div><button class="btn primary" data-inst>${icon('download', 15)} Install newest</button>`,
  });
  $('[data-page]', m.el).onclick = () => call('shell:open', hit.url).catch(fail);
  $('[data-inst]', m.el).onclick = () => { m.close(); installMod(s, hit, null, kind); };
  let project = null, versions = [];
  try {
    [project, versions] = await Promise.all([hit.source === 'modrinth' ? call('mods:project', hit.id) : Promise.resolve(null), call('mods:versions', s.id, hit.source, hit.id, kind)]);
  } catch (e) { $('.modal-body', m.el).innerHTML = `<div class="banner danger">${icon('alert', 18)}<div class="grow">${esc(e.message)}</div></div>`; return; }
  const body = $('.modal-body', m.el);
  body.innerHTML = `<div class="project">
    <div class="project-main">
      ${project && project.gallery.length ? `<div class="gallery">${project.gallery.map((g) => `<img src="${esc(g.url)}" title="${esc(g.title || '')}" loading="lazy" />`).join('')}</div>` : ''}
      <div class="md">${project ? renderMarkdown(project.body) : `<p>${esc(hit.description)}</p>`}</div>
    </div>
    <div class="project-side">
      ${project ? `<div class="kv small">
        <div class="k">Server</div><div class="v">${esc(project.serverSide || '—')}</div>
        <div class="k">Client</div><div class="v">${esc(project.clientSide || '—')}</div>
        ${project.license ? `<div class="k">License</div><div class="v">${esc(project.license)}</div>` : ''}
        <div class="k">Updated</div><div class="v">${ago(project.updated)}</div>
      </div>
      <div class="row wrap" style="gap:6px;margin:10px 0">${(project.categories || []).map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div>
      <div class="row wrap" style="gap:6px;margin-bottom:12px">${Object.entries(project.links).filter(([, u]) => u && /^https:/.test(u)).map(([k, u]) => `<button class="btn xs" data-ext="${esc(u)}">${icon('external', 12)} ${k}</button>`).join('')}</div>` : ''}
      <div class="label-text" style="margin-bottom:6px">Versions for ${esc(s.mcVersion)}</div>
      ${versions.length ? `<div class="vers">${versions.slice(0, 40).map((v, i) => `<div class="ver-row">
        <div class="row"><div class="grow" style="min-width:0"><div class="t">${esc(v.name || v.number)}</div><div class="d">${esc(v.number)} · ${ago(v.date)}</div></div>
          <span class="chip ${v.type === 'release' ? 'accent' : v.type === 'beta' ? 'warn' : 'danger'}">${esc(v.type)}</span>
          <button class="btn xs primary" data-v="${i}">${icon('download', 12)}</button></div>
        ${v.changelog ? `<details><summary>Changelog</summary><div class="md small">${renderMarkdown(v.changelog)}</div></details>` : ''}
      </div>`).join('')}</div>` : `<div class="dim small">No versions for ${esc(LOADERS[s.loader].name)} ${esc(s.mcVersion)}.</div>`}
    </div></div>`;
  if (!versions.length) $('[data-inst]', m.el).disabled = true;
  $$('[data-ext]', m.el).forEach((a) => (a.onclick = (e) => { e.preventDefault(); call('shell:open', a.dataset.ext).catch(fail); }));
  $$('[data-v]', body).forEach((b) => (b.onclick = () => { m.close(); installMod(s, hit, versions[b.dataset.v].id, kind); }));
}

// ---------- Bedrock add-ons ----------
async function renderAddons(tb, s) {
  tb.innerHTML = `
    <div class="row" style="margin-bottom:16px">
      <div><div class="section-title">Add-ons</div><div class="dim small">Behavior and resource packs (.mcpack / .mcaddon) for the active world, <b>${esc(s.levelName || 'Bedrock level')}</b>.</div></div>
      <div class="spacer"></div>
      <button class="btn sm" data-find>${icon('external', 14)} Find add-ons</button>
      <button class="btn sm icon" title="Open folder" data-folder>${icon('folder', 15)}</button>
      <button class="btn primary" data-add>${icon('upload', 15)} Add add-ons</button>
    </div>
    <div id="addons"><div class="skeleton" style="height:120px"></div></div>`;
  $('[data-find]', tb).onclick = () => call('shell:open', 'https://www.curseforge.com/minecraft-bedrock/addons');
  $('[data-folder]', tb).onclick = () => call('servers:openFolder', s.id, 'behavior_packs').catch(fail);
  const add = async (fn) => {
    try { const names = await fn(); if (names.length) toast(`Added ${names.join(', ')}`, 'success'); renderAddons(tb, server(s.id)); } catch (e) { fail(e); }
  };
  $('[data-add]', tb).onclick = () => add(() => call('addons:pick', s.id));
  let list;
  try { list = await call('addons:list', s.id); } catch (e) { return fail(e); }
  if (state.tab !== 'mods' || state.selected !== s.id) return;
  const el = $('#addons');
  el.innerHTML = `
    ${isRunning(s.status) ? `<div class="banner info">${icon('info', 18)}<div class="grow">Add-on changes take effect after a restart.</div></div>` : ''}
    <div class="dropzone" id="addon-drop" style="margin-bottom:14px">${icon('upload', 16)} Drag .mcpack or .mcaddon files here</div>
    ${list.length ? `<div class="card" style="padding:0"><div class="list">${list.map((a, i) => `<div class="list-row ${a.enabled ? '' : 'disabled'}">
      ${a.icon ? `<img class="mod-icon" src="${a.icon}" />` : `<div class="mod-icon">${icon('layers', 18)}</div>`}
      <div class="grow"><div class="title">${esc(a.name)}</div><div class="desc">${esc(a.description || '')}${a.description ? ' · ' : ''}v${esc(a.versionText)}</div></div>
      <span class="chip ${a.kind === 'resource' ? 'info' : 'accent'}">${a.kind === 'resource' ? 'Resource pack' : 'Behavior pack'}</span>
      <label class="switch" title="${a.enabled ? 'Turn off' : 'Turn on'}"><input type="checkbox" data-t="${i}" ${a.enabled ? 'checked' : ''} /><span></span></label>
      <button class="btn xs icon ghost" data-rm="${i}" title="Remove">${icon('trash', 14)}</button></div>`).join('')}</div></div>
      <div class="dim small" style="margin-top:10px">${icon('info', 12)} Some add-ons need "experimental features" turned on in the world. If one doesn't work, open the world in Minecraft once and enable them there.</div>`
      : `<div class="empty"><div class="ic-wrap">${icon('layers', 24)}</div><h3>No add-ons yet</h3><div>Download .mcpack or .mcaddon files and drop them here.</div></div>`}`;
  $$('[data-t]', el).forEach((c) => (c.onchange = async () => { try { await call('addons:toggle', s.id, list[c.dataset.t].uuid, c.checked); renderAddons(tb, server(s.id)); } catch (e) { fail(e); } }));
  $$('[data-rm]', el).forEach((b) => (b.onclick = async () => {
    const a = list[b.dataset.rm];
    if (!(await confirmDialog({ title: `Remove ${a.name}?`, message: 'The pack is deleted from the server and turned off in the world.', confirm: 'Remove', danger: true }))) return;
    try { await call('addons:remove', s.id, a.uuid); renderAddons(tb, server(s.id)); } catch (e) { fail(e); }
  }));
  const drop = $('#addon-drop', el);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter((p) => p && /\.(mcpack|mcaddon|zip)$/i.test(p)); if (paths.length) add(() => call('addons:import', s.id, paths)); else toast('Only .mcpack, .mcaddon or .zip files', 'error'); };
}
