/* global state, api, call, esc, icon, toast, fail, modal, $, $$, fmtBytes, ago, confirmDialog, promptDialog, isRunning */
// Files tab: browse the server folder and edit config files in place.

const TEXT_EXT = /\.(properties|json|json5|jsonc|toml|ya?ml|txt|cfg|conf|config|ini|log|mcmeta|snbt|js|md|csv|xml|sh|bat|cmd|list|secret)$/i;
const QUICK_FILES = [
  ['server.properties', 'Server properties'],
  ['velocity.toml', 'Velocity config'],
  ['config', 'Configs'],
  ['plugins', 'Plugins'],
  ['mods', 'Mods'],
  ['bukkit.yml', 'bukkit.yml'],
  ['spigot.yml', 'spigot.yml'],
  ['purpur.yml', 'purpur.yml'],
  ['ops.json', 'Operators'],
  ['whitelist.json', 'Whitelist'],
  ['permissions.json', 'Permissions'],
  ['allowlist.json', 'Allowlist'],
  ['logs/latest.log', 'Latest log'],
];

async function renderFiles(tb, s) {
  const rel = state.files.path || '';
  let entries;
  try { entries = await call('files:list', s.id, rel); } catch (e) {
    if (rel) { state.files.path = ''; return renderFiles(tb, s); }
    return fail(e);
  }
  if (state.tab !== 'files' || state.selected !== s.id) return;
  const parts = rel ? rel.split('/') : [];
  const fileIcon = (e) => e.dir ? 'folder' : /\.jar$/i.test(e.name) ? 'puzzle' : /\.zip$/i.test(e.name) ? 'archive' : /\.(png|jpg)$/i.test(e.name) ? 'sparkle' : 'info';
  tb.innerHTML = `
    <div class="row wrap" style="margin-bottom:14px">
      <div class="crumbs">
        <a data-crumb="">${icon('folder', 14)} ${esc(s.name)}</a>
        ${parts.map((p, i) => `<span class="dim">/</span><a data-crumb="${esc(parts.slice(0, i + 1).join('/'))}">${esc(p)}</a>`).join('')}
      </div>
      <div class="spacer"></div>
      <div class="search-input mini">${icon('search', 13)}<input class="input" id="file-q" placeholder="Filter…" /></div>
      <button class="btn sm" data-new-file title="New file">${icon('file', 14)} New file</button>
      <button class="btn sm" data-new-folder title="New folder">${icon('folder', 14)} New folder</button>
      <button class="btn sm" data-upload>${icon('upload', 14)} Upload</button>
      <button class="btn sm" data-open-here>${icon('external', 14)} Open in Explorer</button>
    </div>
    ${!rel ? `<div class="quick" style="margin-bottom:14px">${QUICK_FILES.filter(([p]) => entries.some((e) => e.name === p.split('/')[0])).map(([p, l]) => `<button class="btn xs" data-quick-file="${esc(p)}">${esc(l)}</button>`).join('')}</div>` : ''}
    <div class="card" style="padding:0"><div class="list" id="file-list">
      ${rel ? `<div class="list-row file-row" data-up><div class="mod-icon sm">${icon('left', 15)}</div><div class="grow"><div class="title">..</div></div></div>` : ''}
      ${entries.map((e, i) => `<div class="list-row file-row" data-i="${i}" data-name="${esc(e.name.toLowerCase())}">
        <div class="mod-icon sm ${e.dir ? 'is-dir' : ''}">${icon(fileIcon(e), 15)}</div>
        <div class="grow"><div class="title">${esc(e.name)}</div></div>
        <span class="dim small" style="width:90px;text-align:right">${e.dir ? '' : fmtBytes(e.size)}</span>
        <span class="dim small" style="width:90px;text-align:right">${e.mtime ? ago(e.mtime) : ''}</span>
        <div class="row-actions">
          ${!e.dir && TEXT_EXT.test(e.name) && !(rel === '' && e.name === 'craftdock.json') ? `<button class="btn xs ghost" data-edit="${i}">Edit</button>` : ''}
          <button class="btn xs icon ghost" title="Open" data-ext="${i}">${icon('external', 13)}</button>
          ${e.name !== 'craftdock.json' ? `<button class="btn xs icon ghost" title="Rename" data-ren="${i}">${icon('edit', 13)}</button><button class="btn xs icon ghost" title="Delete" data-del="${i}">${icon('trash', 13)}</button>` : ''}
        </div>
      </div>`).join('') || `<div class="empty small">This folder is empty.</div>`}
    </div></div>`;
  const join = (name) => (rel ? `${rel}/${name}` : name);
  const go = (p) => { state.files.path = p; renderFiles(tb, s); };
  $$('[data-crumb]', tb).forEach((a) => (a.onclick = () => go(a.dataset.crumb)));
  const up = $('[data-up]', tb); if (up) up.onclick = () => go(parts.slice(0, -1).join('/'));
  $('[data-open-here]', tb).onclick = () => call('files:open', s.id, rel).catch(fail);
  $$('[data-quick-file]', tb).forEach((b) => (b.onclick = async () => {
    const p = b.dataset.quickFile;
    if (/\.\w+$/.test(p)) openFileEditor(s, p).catch(fail);
    else go(p);
  }));
  $$('.file-row[data-i]', tb).forEach((row) => (row.ondblclick = row.onclick = (ev) => {
    if (ev.target.closest('button')) return;
    const e = entries[row.dataset.i];
    if (e.dir) go(join(e.name));
    else if (TEXT_EXT.test(e.name) && ev.type === 'dblclick') openFileEditor(s, join(e.name)).catch(fail);
  }));
  $$('[data-edit]', tb).forEach((b) => (b.onclick = () => openFileEditor(s, join(entries[b.dataset.edit].name)).catch(fail)));
  $$('[data-ext]', tb).forEach((b) => (b.onclick = () => call('files:open', s.id, join(entries[b.dataset.ext].name)).catch(fail)));
  $$('[data-del]', tb).forEach((b) => (b.onclick = async () => {
    const e = entries[b.dataset.del];
    if (!(await confirmDialog({ title: `Delete ${e.name}?`, message: e.dir ? 'This folder and everything in it will be permanently deleted.' : 'This file will be permanently deleted.', confirm: 'Delete', danger: true }))) return;
    try { await call('files:delete', s.id, join(e.name)); toast(`Deleted ${e.name}`, 'success'); renderFiles(tb, s); } catch (er) { fail(er); }
  }));
  $$('[data-ren]', tb).forEach((b) => (b.onclick = async () => {
    const e = entries[b.dataset.ren];
    const n = await promptDialog({ title: `Rename ${e.name}`, value: e.name });
    if (!n || n === e.name) return;
    try { await call('files:rename', s.id, join(e.name), n.trim()); renderFiles(tb, s); } catch (er) { fail(er); }
  }));
  const mk = async (folder) => {
    const n = await promptDialog({ title: folder ? 'New folder' : 'New file', placeholder: folder ? 'Folder name' : 'e.g. notes.txt' });
    if (!n || !n.trim()) return;
    try { await call('files:new', s.id, join(n.trim()), folder); renderFiles(tb, s); if (!folder && TEXT_EXT.test(n)) openFileEditor(s, join(n.trim())).catch(fail); } catch (er) { fail(er); }
  };
  $('[data-new-file]', tb).onclick = () => mk(false);
  $('[data-new-folder]', tb).onclick = () => mk(true);
  $('[data-upload]', tb).onclick = async () => { try { const n = await call('files:pickUpload', s.id, rel); if (n) { toast(`Uploaded ${n} file${n === 1 ? '' : 's'}`, 'success'); renderFiles(tb, s); } } catch (er) { fail(er); } };
  const list = $('#file-list', tb);
  list.ondragover = (ev) => { ev.preventDefault(); list.classList.add('drop-over'); };
  list.ondragleave = () => list.classList.remove('drop-over');
  list.ondrop = async (ev) => {
    ev.preventDefault(); ev.stopPropagation(); list.classList.remove('drop-over');
    const paths = [...ev.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
    if (!paths.length) return;
    try { const n = await call('files:upload', s.id, rel, paths); toast(`Copied ${n} item${n === 1 ? '' : 's'} into ${rel || 'the server folder'}`, 'success'); renderFiles(tb, s); } catch (er) { fail(er); }
  };
  $('#file-q').oninput = (ev) => {
    const q = ev.target.value.toLowerCase();
    $$('.file-row[data-name]', tb).forEach((r) => (r.style.display = r.dataset.name.includes(q) ? '' : 'none'));
  };
}

async function openFileEditor(s, rel) {
  const content = await call('files:read', s.id, rel);
  let dirty = false;
  const m = modal({
    title: `<div class="mod-icon sm">${icon('info', 15)}</div><div style="min-width:0"><h2 class="mono" style="font-size:15px">${esc(rel)}</h2><div class="dim small">${isRunning(s.status) ? 'The server is running. Many configs are only read at startup, so restart after saving.' : 'Ctrl+S to save'}</div></div>`,
    size: 'lg',
    body: `<textarea class="input code-editor" id="fe-text" spellcheck="false">${esc(content)}</textarea>`,
    foot: `<span class="dim small" id="fe-state">No changes</span><div class="spacer"></div><button class="btn ghost" data-fe-close>Close</button><button class="btn primary" data-fe-save disabled>${icon('check', 15)} Save</button>`,
  });
  const ta = $('#fe-text', m.el);
  const save = async () => {
    if (!dirty) return;
    if (/\.json$/i.test(rel)) { try { JSON.parse(ta.value); } catch (e) { return toast(`This JSON isn't valid: ${e.message}`, 'error', 6000); } }
    try {
      await call('files:write', s.id, rel, ta.value);
      dirty = false;
      $('[data-fe-save]', m.el).disabled = true;
      $('#fe-state', m.el).textContent = 'Saved';
      toast(`Saved ${rel}`, 'success', 1600);
    } catch (e) { fail(e); }
  };
  ta.oninput = () => { dirty = true; $('[data-fe-save]', m.el).disabled = false; $('#fe-state', m.el).textContent = 'Unsaved changes'; };
  ta.onkeydown = (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); e.stopPropagation(); save(); }
    if (e.key === 'Tab') { e.preventDefault(); const p = ta.selectionStart; ta.setRangeText('  ', p, ta.selectionEnd, 'end'); ta.oninput(); }
  };
  $('[data-fe-save]', m.el).onclick = save;
  $('[data-fe-close]', m.el).onclick = async () => {
    if (dirty && !(await confirmDialog({ title: 'Discard changes?', message: 'You have unsaved changes in this file.', confirm: 'Discard', danger: true }))) return;
    m.close();
  };
  ta.focus();
}
