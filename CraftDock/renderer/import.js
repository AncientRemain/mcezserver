/* global state, call, api, esc, icon, toast, fail, modal, $, $$, fmtBytes, LOADERS, loaderBadge, progressBlock, updateProgressUI, wizardHooks, refreshServers, select, serverAction, hasBuilds, buildLabel, versionLabel, contentLabel, typeInfo */
// Import an existing server from a folder or .zip.

function openImportWizard(initialPath) {
  if ($('.modal-backdrop')) return;
  const sys = state.system;
  const maxMem = Math.max(2048, Math.floor(sys.totalMem / 1048576 / 512) * 512 - 1024);
  const I = { step: 'pick', det: null, games: [], loaders: [], name: '', loader: null, mc: null, lv: '', memory: 4096, eula: false, id: null, imported: false };
  const m = modal({
    title: `<div class="mod-icon sm" style="color:var(--accent)">${icon('upload', 15)}</div><div><h2>Import a server</h2><div class="dim small">Bring in a server from another host, PC or launcher</div></div>`,
    size: 'lg', body: '<div id="im"></div>', foot: '<div id="im-foot" class="row" style="width:100%"></div>',
    onClose: () => { if (!I.imported && I.det && I.det.staging) call('import:discard', I.det.staging).catch(() => {}); },
  });
  const body = () => $('#im', m.el);
  const foot = () => $('#im-foot', m.el);

  async function analyze(p) {
    I.step = 'analyzing'; draw();
    try {
      const det = await call('import:analyze', p);
      I.det = det;
      I.name = det.name;
      I.loader = det.loader;
      I.mc = det.mcVersion;
      I.eula = det.eula;
      const n = det.mods + det.plugins;
      I.memory = Math.min(maxMem, det.memoryMB || (n > 120 ? 8192 : n > 40 ? 6144 : n > 0 ? 5120 : 4096));
      I.step = 'review';
      draw();
      await loadVersions();
    } catch (e) { I.step = 'pick'; draw(); fail(e); }
  }

  async function loadVersions() {
    try {
      I.games = await call('versions:games', I.loader, true);
      if (!I.mc || !I.games.some((g) => g.id === I.mc)) {
        if (I.mc) I.games.unshift({ id: I.mc, type: 'unknown' });
        else I.mc = (I.games.find((g) => g.type === 'release') || {}).id;
      }
    } catch (e) { fail(e); }
    await loadLoaders();
  }
  async function loadLoaders() {
    I.loaders = [];
    if (!hasBuilds(I.loader) || !I.mc) { I.lv = ''; draw(); return; }
    draw();
    try {
      I.loaders = await call('versions:loaders', I.loader, I.mc);
      const detected = I.det.loader === I.loader && I.det.mcVersion === I.mc && I.det.loaderVersion;
      I.lv = (detected && I.loaders.some((v) => v.id === detected) ? detected : (I.loaders.find((v) => v.recommended) || I.loaders[0] || {}).id) || '';
    } catch { I.loaders = []; }
    draw();
  }

  function draw() {
    if (!document.body.contains(m.el)) return;
    if (I.step === 'pick' || I.step === 'analyzing') {
      body().innerHTML = I.step === 'analyzing'
        ? `<div class="center-col" style="padding:40px"><div class="pulse-ring">${icon('search', 26)}</div><h3 style="margin:14px 0 4px">Looking at your server…</h3><div class="muted">Working out the server type, version, mods and world.</div></div>`
        : `<div class="grid g-2">
            <div class="loader-opt" style="--lc:var(--accent)" data-pick="folder"><div class="row"><div class="loader-badge" style="--lc:#fbbf24">${icon('folder', 18)}</div><div class="n">Server folder</div></div>
              <div class="d">The folder with <span class="mono">server.properties</span>, your world and mods. Works with servers from other hosts, launchers or a previous setup.</div></div>
            <div class="loader-opt" style="--lc:var(--accent)" data-pick="zip"><div class="row"><div class="loader-badge" style="--lc:#60a5fa">${icon('archive', 18)}</div><div class="n">.zip file</div></div>
              <div class="d">A zipped server, like a backup downloaded from a hosting company (Aternos, Apex, Shockbyte, etc.).</div></div>
          </div>
          <div class="dropzone" id="im-drop" style="margin-top:14px;padding:26px">${icon('upload', 16)} …or drag a server folder or .zip here</div>
          <div class="dim small" style="margin-top:14px">${icon('info', 12)} CraftDock copies the server. Your original files are never changed or moved.</div>`;
      foot().innerHTML = I.step === 'pick' ? `<div class="spacer"></div><button class="btn ghost" data-x>Cancel</button>` : '';
      const x = $('[data-x]', foot()); if (x) x.onclick = () => m.close();
      $$('[data-pick]', body()).forEach((c) => (c.onclick = async () => { const p = await call('import:pick', c.dataset.pick).catch(fail); if (p) analyze(p); }));
      const drop = $('#im-drop');
      if (drop) {
        drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
        drop.ondragleave = () => drop.classList.remove('over');
        drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; const p = f && api.pathForFile(f); if (p) analyze(p); };
      }
      return;
    }
    if (I.step === 'review') {
      const d = I.det;
      const kind = contentLabel(I.loader).toLowerCase();
      const count = d.plugins + d.mods;
      body().innerHTML = `
        ${!d.looksLikeServer ? `<div class="banner warn">${icon('alert', 18)}<div class="grow">This doesn't look like a Minecraft server folder (no server.properties, world or server jar found). You can still import it, but double-check you picked the right folder.</div></div>` : ''}
        ${d.notes.map((n) => `<div class="banner info">${icon('info', 18)}<div class="grow">${esc(n)}</div></div>`).join('')}
        <div class="row" style="padding:14px;border:1px solid var(--border);border-radius:12px;background:var(--bg-2);margin-bottom:18px">
          ${loaderBadge(d.loader, 'lg')}
          <div style="flex:1;min-width:0">
            <div style="font-weight:650;font-size:15px">Detected: ${esc(LOADERS[d.loader].name)} ${esc(d.mcVersion || '(unknown version)')}${d.loaderVersion && hasBuilds(d.loader) ? ` <span class="dim">· ${esc(d.loaderVersion)}</span>` : ''}</div>
            <div class="dim small" style="margin-top:2px">${d.from.length ? `Found from ${esc(d.from.join(', '))}` : 'Best guess, please check below'} · ${fmtBytes(d.size)}</div>
            <div class="row wrap" style="margin-top:8px;gap:6px">
              ${d.world ? `<span class="chip accent">${icon('globe', 11)} World "${esc(d.world)}"</span>` : `<span class="chip">No world yet</span>`}
              ${d.mods ? `<span class="chip">${icon('puzzle', 11)} ${d.mods} mod${d.mods === 1 ? '' : 's'}</span>` : ''}
              ${d.plugins ? `<span class="chip">${icon('puzzle', 11)} ${d.plugins} plugin${d.plugins === 1 ? '' : 's'}</span>` : ''}
              ${d.port ? `<span class="chip mono">:${d.port}</span>` : ''}
              ${d.eula ? `<span class="chip">EULA accepted</span>` : ''}
            </div>
          </div>
        </div>
        <div class="form-grid">
          <div class="field full"><label>Server name</label><input class="input" id="im-name" value="${esc(I.name)}" maxlength="48" /></div>
          <div class="field"><label>Server type</label><select class="input" id="im-loader">${Object.entries(LOADERS).map(([k, l]) => `<option value="${k}" ${k === I.loader ? 'selected' : ''}>${l.name}${k === d.loader ? '  (detected)' : ''}</option>`).join('')}</select></div>
          <div class="field"><label>${versionLabel(I.loader)}</label><select class="input" id="im-mc" ${I.games.length ? '' : 'disabled'}>${I.games.length ? I.games.filter((g) => g.type === 'release' || g.id === I.mc).map((g) => `<option ${g.id === I.mc ? 'selected' : ''}>${esc(g.id)}</option>`).join('') : `<option>${esc(I.mc || 'Loading…')}</option>`}</select>
            ${I.loader === 'bedrock' ? `<div class="hint">Mojang only offers the newest Bedrock server${d.worldVersion ? ` (your world was last opened with ${esc(d.worldVersion)})` : ''}.</div>` : ''}</div>
          ${hasBuilds(I.loader) ? `<div class="field full"><label>${buildLabel(I.loader)}</label>
            <select class="input" id="im-lv" ${I.loaders.length ? '' : 'disabled'}>${I.loaders.length ? I.loaders.map((v) => `<option value="${esc(v.id)}" ${v.id === I.lv ? 'selected' : ''}>${esc(v.label)}${v.id === d.loaderVersion ? '  (what it used before)' : v.recommended ? '  (recommended)' : ''}</option>`).join('') : '<option>Loading…</option>'}</select>
            ${['paper', 'purpur', 'folia', 'leaf'].includes(I.loader) ? `<div class="hint">CraftDock installs this build. Newer builds of the same Minecraft version are safe.</div>` : ''}</div>` : ''}
          ${I.loader !== 'bedrock' ? `<div class="field full"><label>Memory (RAM) · <span id="im-memv" style="color:var(--text)">${(I.memory / 1024).toFixed(1)} GB</span></label>
            <input type="range" id="im-mem" min="${I.loader === 'velocity' ? 512 : 1024}" max="${maxMem}" step="512" value="${I.memory}" style="margin-top:10px" />
            <div class="hint">${count ? `This server has ${count} add-on${count === 1 ? '' : 's'} (${kind}). ` : ''}You have ${fmtBytes(sys.totalMem)} total.</div></div>` : ''}
          ${typeInfo(I.loader).eula !== false ? `<div class="full"><label class="checkbox"><input type="checkbox" id="im-eula" ${I.eula ? 'checked' : ''} /><span>I agree to the <a data-eula>Minecraft End User License Agreement</a>.</span></label></div>` : ''}
        </div>
        <div class="dim small" style="margin-top:12px">${icon('info', 12)} CraftDock copies this server (${fmtBytes(d.size)}) and sets up the right Java and launch files. The original stays exactly as it is.</div>`;
      $('#im-name').oninput = (e) => (I.name = e.target.value);
      $('#im-loader').onchange = async (e) => { I.loader = e.target.value; I.games = []; draw(); await loadVersions(); };
      const mcSel = $('#im-mc'); if (mcSel) mcSel.onchange = (e) => { I.mc = e.target.value; loadLoaders(); };
      const lv = $('#im-lv'); if (lv) lv.onchange = (e) => (I.lv = e.target.value);
      const imm = $('#im-mem'); if (imm) imm.oninput = (e) => { I.memory = Number(e.target.value); $('#im-memv').textContent = `${(I.memory / 1024).toFixed(1)} GB`; };
      const ime = $('#im-eula'); if (ime) ime.onchange = (e) => { I.eula = e.target.checked; draw(); };
      const iel = $('[data-eula]', body()); if (iel) iel.onclick = (e) => { e.preventDefault(); call('shell:open', 'https://aka.ms/MinecraftEULA'); };
      const ready = I.mc && (I.eula || typeInfo(I.loader).eula === false) && (!hasBuilds(I.loader) || I.lv);
      foot().innerHTML = `<button class="btn ghost" data-back>${icon('left', 15)} Choose another</button><div class="spacer"></div><button class="btn primary" data-go ${ready ? '' : 'disabled'}>${icon('upload', 15)} Import server</button>`;
      $('[data-back]', foot()).onclick = () => { if (I.det.staging) call('import:discard', I.det.staging).catch(() => {}); I.det = null; I.step = 'pick'; draw(); };
      $('[data-go]', foot()).onclick = run;
      return;
    }
    // progress
    const p = state.progress[I.id] || {};
    body().innerHTML = `<div style="padding:6px 2px">
      <div class="row" style="margin-bottom:16px">${loaderBadge(I.loader, 'lg')}<div><h3 style="margin:0">${esc(I.name)}</h3><div class="dim small">${esc(LOADERS[I.loader].name)} ${esc(I.mc)}</div></div></div>
      ${p.error ? `<div class="banner danger">${icon('alert', 18)}<div class="grow selectable" style="white-space:pre-wrap">${esc(p.error)}</div></div>`
        : p.done ? `<div class="banner info" style="background:var(--accent-soft);border-color:color-mix(in srgb,var(--accent) 30%,transparent);color:var(--text)">${icon('check', 18)}<div class="grow"><b>Imported!</b> Your world, ${contentLabel(I.loader).toLowerCase()} and settings are all here. Hit Start to run it.</div></div>`
          : progressBlock(p)}</div>`;
    const id = I.id;
    foot().innerHTML = p.done
      ? `<div class="spacer"></div><button class="btn" data-open>Open server</button><button class="btn primary" data-start>${icon('play', 15)} Start now</button>`
      : p.error ? `<div class="spacer"></div><button class="btn" data-open>Close</button>`
        : `<span class="dim small">You can close this. The import keeps going in the background.</span><div class="spacer"></div><button class="btn" data-open>Run in background</button>`;
    $('[data-open]', foot()).onclick = () => { m.close(); select(id); };
    const st = $('[data-start]', foot());
    if (st) st.onclick = () => { m.close(); select(id, 'console').then(() => serverAction(id, 'start')); };
  }

  async function run() {
    if (!I.name.trim()) return toast('Give the server a name', 'error');
    try {
      I.id = await call('import:run', {
        source: I.det.source, staging: I.det.staging, label: I.det.label, name: I.name.trim(), loader: I.loader,
        mcVersion: I.mc, loaderVersion: I.lv || null, memoryMB: I.memory, eula: I.eula, port: I.det.port,
      });
      I.imported = true;
      state.progress[I.id] = { step: 'Copying server files', logs: [] };
      I.step = 'progress';
      await refreshServers();
      draw();
    } catch (e) { fail(e); }
  }

  wizardHooks.current = {
    id: () => I.id,
    redraw: () => {
      if (I.step !== 'progress' || !document.body.contains(m.el)) return;
      const p = state.progress[I.id] || {};
      if (p.done || p.error || !$('#prog-step')) draw(); else updateProgressUI(p);
    },
  };
  draw();
  if (initialPath) analyze(initialPath);
}
