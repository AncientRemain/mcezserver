/* global state, call, esc, icon, toast, fail, modal, $, $$, fmtBytes, fmtNum, ago, debounce, LOADERS, loaderBadge, progressBlock, updateProgressUI, wizardHooks, refreshServers, select, serverAction, confirmDialog, contentLabel, hasBuilds, buildLabel, isBedrock, isProxy */
// Modpack wizard, change-version dialog, performance mod picker.

/** Checklist of performance mods matched to P.loader + P.mc. P.perf = list (null while loading), P.perfSel = Set of slugs. */
function perfPicker(P, { showAuto = true, installed = new Set() } = {}) {
  const kind = contentLabel(P.loader).toLowerCase();
  const list = P.perf;
  return `<label>Performance ${kind} <span class="dim" style="font-weight:500">· matched to Minecraft ${esc(P.mc)} automatically</span></label>
    ${!list ? `<div class="skeleton" style="height:120px"></div>` : !list.length ? `<div class="dim small">No recommendations for this server type.</div>` : `
    <div class="perf-list">${list.map((m) => {
      const have = installed.has(m.projectId);
      const off = !m.available || have;
      return `<label class="perf-item ${off ? 'off' : ''}">
        <input type="checkbox" data-perf="${esc(m.slug)}" ${P.perfSel.has(m.slug) && !off ? 'checked' : ''} ${off ? 'disabled' : ''} />
        ${m.icon ? `<img class="mod-icon sm" src="${esc(m.icon)}" />` : `<div class="mod-icon sm">${icon('zap', 14)}</div>`}
        <div class="grow"><div class="t">${esc(m.title)} ${m.version ? `<span class="dim small">${esc(m.version)}</span>` : ''}</div><div class="d">${esc(m.why)}</div></div>
        ${have ? `<span class="chip accent">${icon('check', 11)} Installed</span>` : !m.available ? `<span class="chip">Not out for ${esc(P.mc)} yet</span>` : ''}
      </label>`;
    }).join('')}</div>`}
    ${showAuto ? `<label class="checkbox" style="margin-top:12px"><input type="checkbox" data-perf-auto ${P.updateOnStart ? 'checked' : ''} /><span><b style="color:var(--text)">Keep ${kind} up to date automatically</b>: before every start, old versions are replaced with the newest ones made for Minecraft ${esc(P.mc)}.</span></label>` : ''}`;
}

function bindPerfPicker(el, P) {
  if (!el) return;
  $$('[data-perf]', el).forEach((c) => (c.onchange = () => { if (c.checked) P.perfSel.add(c.dataset.perf); else P.perfSel.delete(c.dataset.perf); }));
  const a = $('[data-perf-auto]', el);
  if (a) a.onchange = () => (P.updateOnStart = a.checked);
}

/** Add recommended performance mods to an existing server. */
async function openPerfModal(s, onDone) {
  const P = { loader: s.loader, mc: s.mcVersion, perf: null, perfSel: new Set() };
  const m = modal({
    title: `<div class="mod-icon sm" style="color:var(--accent)">${icon('zap', 15)}</div><div><h2>Performance ${contentLabel(s.loader).toLowerCase()}</h2><div class="dim small">${esc(LOADERS[s.loader].name)} ${esc(s.mcVersion)}</div></div>`,
    body: '<div class="field" id="pm-body"></div>',
    foot: `<div class="spacer"></div><button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-go disabled>${icon('download', 15)} Install selected</button>`,
  });
  $('[data-x]', m.el).onclick = () => m.close();
  let installed = new Set();
  try {
    const [list, have] = await Promise.all([call('mods:recommended', s.loader, s.mcVersion), call('mods:list', s.id)]);
    installed = new Set(have.map((x) => x.projectId).filter(Boolean));
    P.perf = list;
    P.perfSel = new Set(list.filter((x) => x.default && x.available && !installed.has(x.projectId)).map((x) => x.slug));
  } catch (e) { m.close(); return fail(e); }
  const body = $('#pm-body', m.el);
  body.innerHTML = perfPicker(P, { showAuto: false, installed });
  bindPerfPicker(body, P);
  const go = $('[data-go]', m.el);
  const sync = () => (go.disabled = !P.perfSel.size);
  $$('[data-perf]', body).forEach((c) => c.addEventListener('change', sync));
  sync();
  go.onclick = async () => {
    go.disabled = true;
    go.innerHTML = `${icon('restart', 15, 'spin')} Installing…`;
    try {
      const r = await call('mods:installPerf', s.id, [...P.perfSel]);
      toast(r.installed.length ? `Installed ${r.installed.join(', ')}` : 'Nothing new to install', 'success', 6000);
      m.close();
      onDone && onDone();
    } catch (e) { fail(e); go.disabled = false; }
  };
}

function openModpackWizard() {
  if ($('.modal-backdrop')) return;
  const sys = state.system;
  const maxMem = Math.max(2048, Math.floor(sys.totalMem / 1048576 / 512) * 512 - 1024);
  const usedPorts = new Set(state.servers.map((s) => s.port));
  let port = 25565; while (usedPorts.has(port)) port++;
  const P = {
    step: 'search', query: '', sort: 'relevance', hits: [], total: 0, loading: false, pack: null, versions: [], versionId: null,
    name: '', memory: Math.min(Math.max(6144, state.settings?.defaultMemoryMB || 4096), maxMem), port, eula: false, id: null,
  };
  const m = modal({ title: `<h2>New server from a modpack</h2><span class="chip"><span class="src-dot" style="background:#1bd96a"></span>Modrinth</span>`, size: 'lg', body: '<div id="mp"></div>', foot: '<div id="mp-foot" class="row" style="width:100%"></div>' });
  const body = () => $('#mp', m.el);
  const foot = () => $('#mp-foot', m.el);

  let seq = 0;
  const search = async () => {
    const my = ++seq;
    P.loading = true; draw();
    try {
      const r = await call('modpacks:search', { query: P.query, sort: P.sort, limit: 24 });
      if (my !== seq) return;
      P.hits = r.hits; P.total = r.total;
    } catch (e) { fail(e); }
    P.loading = false; draw();
  };

  const pick = async (hit) => {
    P.pack = hit; P.step = 'version'; P.versions = []; P.versionId = null; draw();
    try {
      P.versions = await call('modpacks:versions', hit.id);
      P.versionId = (P.versions.find((v) => v.type === 'release') || P.versions[0] || {}).id || null;
    } catch (e) { fail(e); }
    draw();
  };

  function draw() {
    if (!document.body.contains(m.el)) return;
    if (P.step === 'search') {
      const hadFocus = document.activeElement && document.activeElement.id === 'mp-q';
      body().innerHTML = `
        <div class="row" style="margin-bottom:14px">
          <div class="search-input">${icon('search', 16)}<input class="input" id="mp-q" placeholder="Search modpacks, e.g. Cobblemon, All the Mods, Create…" value="${esc(P.query)}" /></div>
          <select class="input" id="mp-sort" style="width:170px">${[['relevance', 'Relevance'], ['downloads', 'Most downloaded'], ['follows', 'Most followed'], ['updated', 'Recently updated']].map(([v, l]) => `<option value="${v}" ${P.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        </div>
        ${P.loading && !P.hits.length ? `<div class="mod-grid compact">${Array.from({ length: 6 }, () => '<div class="skeleton" style="height:110px"></div>').join('')}</div>`
          : `<div class="mod-grid compact">${P.hits.map((h, i) => `<div class="mod-card pickable" data-pick="${i}">
              ${h.icon ? `<img class="mod-icon lg" src="${esc(h.icon)}" loading="lazy" />` : `<div class="mod-icon lg">${icon('archive', 24)}</div>`}
              <div class="body"><div class="t">${esc(h.title)}</div><div class="by">by ${esc(h.author)}</div>
                <div class="d">${esc(h.description)}</div>
                <div class="foot"><span class="stat-i">${icon('download', 13)} ${fmtNum(h.downloads)}</span>${h.loaders.map((l) => `<span class="chip" style="font-size:11px;color:${LOADERS[l].color}">${LOADERS[l].name}</span>`).join('')}<div class="spacer"></div><span class="dim small">${esc(h.versions[h.versions.length - 1] || '')}</span></div>
              </div></div>`).join('') || '<div class="dim">No modpacks found.</div>'}</div>`}`;
      const q = $('#mp-q');
      q.oninput = debounce(() => { P.query = q.value; search(); }, 350);
      if (hadFocus || !P.query) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
      $('#mp-sort').onchange = (e) => { P.sort = e.target.value; search(); };
      $$('[data-pick]', body()).forEach((c) => (c.onclick = () => pick(P.hits[c.dataset.pick])));
      foot().innerHTML = `<span class="dim small">Only server-compatible Fabric, Forge and NeoForge packs are shown. Client-only mods are skipped automatically.</span>`;
    } else if (P.step === 'version') {
      const h = P.pack;
      body().innerHTML = `
        <div class="row" style="margin-bottom:16px">${h.icon ? `<img class="mod-icon lg" src="${esc(h.icon)}" />` : ''}<div style="flex:1"><h3 style="margin:0">${esc(h.title)}</h3><div class="dim small">${esc(h.description)}</div></div>
          <button class="btn sm ghost" data-page>${icon('external', 14)} Modrinth page</button></div>
        <div class="label-text" style="margin-bottom:8px">Pick a version</div>
        ${P.versions.length ? `<div class="card" style="padding:0;max-height:330px;overflow:auto"><div class="list">${P.versions.slice(0, 50).map((v) => `
          <label class="list-row pickable-row ${v.id === P.versionId ? 'selected' : ''}">
            <input type="radio" name="mpv" value="${esc(v.id)}" ${v.id === P.versionId ? 'checked' : ''} />
            <div class="grow"><div class="title">${esc(v.name || v.number)}</div><div class="desc">Minecraft ${esc(v.gameVersions.join(', '))} · ${ago(v.date)}</div></div>
            ${v.loaders.map((l) => `<span class="chip" style="color:${LOADERS[l].color}">${LOADERS[l].name}</span>`).join('')}
            <span class="chip ${v.type === 'release' ? 'accent' : 'warn'}">${esc(v.type)}</span>
          </label>`).join('')}</div></div>` : '<div class="skeleton" style="height:200px"></div>'}`;
      $('[data-page]', body()).onclick = () => call('shell:open', h.url);
      $$('input[name=mpv]', body()).forEach((r) => (r.onchange = () => { P.versionId = r.value; draw(); }));
      foot().innerHTML = `<button class="btn ghost" data-back>${icon('left', 15)} Back</button><div class="spacer"></div><button class="btn primary" data-next ${P.versionId ? '' : 'disabled'}>Continue ${icon('right', 15)}</button>`;
      $('[data-back]', foot()).onclick = () => { P.step = 'search'; draw(); };
      $('[data-next]', foot()).onclick = () => { if (!P.name) P.name = P.pack.title.slice(0, 48); P.step = 'details'; draw(); };
    } else if (P.step === 'details') {
      const v = P.versions.find((x) => x.id === P.versionId) || {};
      body().innerHTML = `
        <div class="row" style="margin-bottom:18px;padding:12px;border:1px solid var(--border);border-radius:12px;background:var(--bg-2)">
          ${P.pack.icon ? `<img class="mod-icon" src="${esc(P.pack.icon)}" />` : ''}<div><b>${esc(P.pack.title)} ${esc(v.number || '')}</b><div class="dim small">${(v.loaders || []).map((l) => LOADERS[l].name).join(', ')} · Minecraft ${esc((v.gameVersions || [])[0] || '')}</div></div></div>
        <div class="form-grid">
          <div class="field full"><label>Server name</label><input class="input" id="mp-name" value="${esc(P.name)}" maxlength="48" /></div>
          <div class="field full"><label>Memory (RAM) · <span id="mp-memv" style="color:var(--text)">${(P.memory / 1024).toFixed(1)} GB</span></label>
            <input type="range" id="mp-mem" min="2048" max="${maxMem}" step="512" value="${P.memory}" style="margin-top:10px" />
            <div class="hint">Modpacks usually need 6–10 GB. You have ${fmtBytes(sys.totalMem)}.</div></div>
          <div class="field"><label>Port</label><input class="input" id="mp-port" type="number" value="${P.port}" /></div>
          <div class="full"><label class="checkbox"><input type="checkbox" id="mp-eula" ${P.eula ? 'checked' : ''} /><span>I agree to the <a data-eula>Minecraft End User License Agreement</a>.</span></label></div>
        </div>`;
      $('#mp-name').oninput = (e) => (P.name = e.target.value);
      $('#mp-mem').oninput = (e) => { P.memory = Number(e.target.value); $('#mp-memv').textContent = `${(P.memory / 1024).toFixed(1)} GB`; };
      $('#mp-port').oninput = (e) => (P.port = Number(e.target.value));
      $('#mp-eula').onchange = (e) => { P.eula = e.target.checked; $('[data-create]', foot()).disabled = !P.eula; };
      $('[data-eula]', body()).onclick = (e) => { e.preventDefault(); call('shell:open', 'https://aka.ms/MinecraftEULA'); };
      foot().innerHTML = `<button class="btn ghost" data-back>${icon('left', 15)} Back</button><div class="spacer"></div><button class="btn primary" data-create ${P.eula ? '' : 'disabled'}>${icon('sparkle', 15)} Create server</button>`;
      $('[data-back]', foot()).onclick = () => { P.step = 'version'; draw(); };
      $('[data-create]', foot()).onclick = create;
    } else if (P.step === 'progress') {
      const p = state.progress[P.id] || {};
      body().innerHTML = `<div style="padding:6px 2px">
        <div class="row" style="margin-bottom:16px">${P.pack.icon ? `<img class="mod-icon lg" src="${esc(P.pack.icon)}" />` : ''}<div><h3 style="margin:0">${esc(P.name)}</h3><div class="dim small">${esc(P.pack.title)}</div></div></div>
        ${p.error ? `<div class="banner danger">${icon('alert', 18)}<div class="grow selectable" style="white-space:pre-wrap">${esc(p.error)}</div></div>`
          : p.done ? `<div class="banner info" style="background:var(--accent-soft);border-color:color-mix(in srgb,var(--accent) 30%,transparent);color:var(--text)">${icon('check', 18)}<div class="grow"><b>Modpack installed!</b> Hit Start to launch it. The first start of a modpack can take a few minutes.</div></div>`
            : progressBlock(p)}</div>`;
      const id = P.id;
      foot().innerHTML = p.done
        ? `<div class="spacer"></div><button class="btn" data-open>Open server</button><button class="btn primary" data-start>${icon('play', 15)} Start now</button>`
        : p.error ? `<div class="spacer"></div><button class="btn" data-open>Close</button>`
          : `<span class="dim small">You can close this. The install keeps going in the background.</span><div class="spacer"></div><button class="btn" data-open>Run in background</button>`;
      $('[data-open]', foot()).onclick = () => { m.close(); select(id); };
      const st = $('[data-start]', foot());
      if (st) st.onclick = () => { m.close(); select(id, 'console').then(() => serverAction(id, 'start')); };
    }
  }

  async function create() {
    if (!P.name.trim()) return toast('Give your server a name', 'error');
    try {
      P.id = await call('modpacks:create', { name: P.name.trim(), versionId: P.versionId, memoryMB: P.memory, port: P.port, eula: P.eula });
      state.progress[P.id] = { step: 'Preparing modpack…', logs: [] };
      P.step = 'progress';
      await refreshServers();
      draw();
    } catch (e) { fail(e); }
  }

  wizardHooks.current = {
    id: () => P.id,
    redraw: () => {
      if (P.step !== 'progress' || !document.body.contains(m.el)) return;
      const p = state.progress[P.id] || {};
      if (p.done || p.error || !$('#prog-step')) draw(); else updateProgressUI(p);
    },
  };
  draw();
  search();
}

async function openChangeVersion(s) {
  const V = { snapshots: false, versions: [], mc: s.mcVersion, loaderVersions: [], loaderVersion: '', filter: '', updateMods: true };
  const m = modal({
    title: `${loaderBadge(s.loader)}<div><h2>Change version</h2><div class="dim small">${esc(s.name)} · currently ${esc(LOADERS[s.loader].name)} ${esc(s.mcVersion)}</div></div>`,
    size: 'lg', body: '<div id="cv"></div>', foot: '<div id="cv-foot" class="row" style="width:100%"></div>',
  });
  const body = () => $('#cv', m.el);
  const foot = () => $('#cv-foot', m.el);
  const loadLoaders = async () => {
    V.loaderVersions = []; V.loaderVersion = '';
    if (!hasBuilds(s.loader)) return;
    try {
      V.loaderVersions = await call('versions:loaders', s.loader, V.mc);
      V.loaderVersion = (V.loaderVersions.find((v) => v.recommended) || V.loaderVersions[0] || {}).id || '';
    } catch (e) { fail(e); }
  };
  const load = async () => {
    try { V.versions = await call('versions:games', s.loader, V.snapshots); } catch (e) { fail(e); }
    await loadLoaders();
    draw();
  };
  function draw() {
    const vs = V.versions.filter((v) => !V.filter || v.id.includes(V.filter));
    const older = V.versions.findIndex((v) => v.id === V.mc) > V.versions.findIndex((v) => v.id === s.mcVersion);
    body().innerHTML = `
      <div class="banner warn">${icon('alert', 18)}<div class="grow">${isProxy(s) ? 'Your plugins and velocity.toml are kept.' : `Your world${isBedrock(s) ? ', add-ons' : `, ${contentLabel(s.loader).toLowerCase()}`} and settings are kept.`} ${isBedrock(s) || s.loader === 'vanilla' ? '' : `Make sure your ${contentLabel(s.loader).toLowerCase()} have versions for the new version (use "Check for updates").`} A backup is made first.</div></div>
      ${older && !isProxy(s) ? `<div class="banner danger">${icon('alert', 18)}<div class="grow"><b>Downgrading isn't supported by Minecraft.</b> Opening a world in an older version can corrupt it. Only do this with a backup.</div></div>` : ''}
      <div class="row" style="margin-bottom:12px">
        <div class="search-input">${icon('search', 16)}<input class="input" id="cv-f" placeholder="Filter versions…" value="${esc(V.filter)}" /></div>
        <label class="checkbox" style="align-items:center"><input type="checkbox" id="cv-snaps" ${V.snapshots ? 'checked' : ''} /> ${isBedrock(s) ? 'Preview versions' : isProxy(s) ? 'Snapshot builds' : 'Snapshots'}</label>
      </div>
      ${V.versions.length ? `<div class="version-grid" style="max-height:220px">${vs.map((v) => `<div class="ver ${v.id === V.mc ? 'active' : ''} ${v.type !== 'release' ? 'snap' : ''}" data-v="${esc(v.id)}">${esc(v.id)}${v.id === s.mcVersion ? '<div class="dim" style="font-size:10px;font-weight:500">current</div>' : ''}</div>`).join('')}</div>` : '<div class="skeleton" style="height:200px"></div>'}
      ${hasBuilds(s.loader) ? `<div class="field" style="margin-top:16px"><label>${buildLabel(s.loader)}</label>
        <select class="input" id="cv-lv" ${V.loaderVersions.length ? '' : 'disabled'}>${V.loaderVersions.length ? V.loaderVersions.map((v) => `<option value="${esc(v.id)}" ${v.id === V.loaderVersion ? 'selected' : ''}>${esc(v.label)}${v.recommended ? '  (recommended)' : ''}</option>`).join('') : '<option>Loading…</option>'}</select></div>` : ''}
      ${!isBedrock(s) ? `<label class="checkbox" style="margin-top:14px"><input type="checkbox" id="cv-upd" ${V.updateMods ? 'checked' : ''} /><span><b style="color:var(--text)">Update ${contentLabel(s.loader).toLowerCase()} for ${esc(V.mc)}</b>: old versions are deleted and replaced with versions made for ${esc(V.mc)}. Any that don't support ${esc(V.mc)} yet are turned off so the server can still start.</span></label>
      <div class="dim small" style="margin-top:8px">Leftover files from ${esc(s.mcVersion)} (old loader libraries and game jars) are cleaned up automatically.</div>` : `<div class="dim small" style="margin-top:12px">Bedrock players can only join a server running the same version as their game (or older). Your worlds, server.properties, allowlist and permissions are kept.</div>`}`;
    const cu = $('#cv-upd'); if (cu) cu.onchange = (e) => (V.updateMods = e.target.checked);
    const f = $('#cv-f');
    f.oninput = debounce(() => { V.filter = f.value.trim(); draw(); const n = $('#cv-f'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 200);
    $('#cv-snaps').onchange = (e) => { V.snapshots = e.target.checked; load(); };
    $$('[data-v]', body()).forEach((el) => (el.onclick = async () => { V.mc = el.dataset.v; draw(); await loadLoaders(); draw(); }));
    const lv = $('#cv-lv'); if (lv) lv.onchange = () => (V.loaderVersion = lv.value);
    const same = V.mc === s.mcVersion && (!hasBuilds(s.loader) || V.loaderVersion === s.loaderVersion);
    foot().innerHTML = `<div class="spacer"></div><button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-go ${!same && V.mc && (!hasBuilds(s.loader) || V.loaderVersion) ? '' : 'disabled'}>${icon('update', 15)} Back up &amp; switch to ${esc(V.mc)}</button>`;
    $('[data-x]', foot()).onclick = () => m.close();
    $('[data-go]', foot()).onclick = async (e) => {
      e.currentTarget.disabled = true;
      e.currentTarget.innerHTML = `${icon('restart', 15, 'spin')} Backing up…`;
      try {
        await call('servers:createBackup', s.id).catch((er) => { if (!/no world yet/i.test(er.message)) throw er; });
        await call('servers:changeVersion', s.id, V.mc, V.loaderVersion || null, { updateMods: V.updateMods });
        state.progress[s.id] = { step: 'Starting install…', logs: [] };
        m.close();
        toast(`Switching ${s.name} to ${V.mc}…`, 'info');
        await refreshServers();
        select(s.id);
      } catch (er) { fail(er); draw(); }
    };
  }
  draw();
  load();
}
