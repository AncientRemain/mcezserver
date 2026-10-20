/* global state, call, esc, icon, toast, fail, $, $$, fmtBytes, ago, isRunning, isProxy, server, confirmDialog, promptDialog, openAppSettings */
// Backups tab: world or full-server zips, notes, restore.

async function renderBackups(tb, s) {
  tb.innerHTML = `<div class="skeleton" style="height:160px"></div>`;
  let list;
  try { list = await call('servers:backups', s.id); } catch (e) { return fail(e); }
  if (state.tab !== 'backups' || state.selected !== s.id) return;
  const total = list.reduce((a, b) => a + b.size, 0);
  const proxy = isProxy(s);
  const custom = state.settings?.backupDir;
  tb.innerHTML = `
    <div class="row" style="margin-bottom:16px">
      <div><div class="section-title">Backups</div><div class="dim small">${proxy ? 'Zips of the proxy\'s plugins and configs.' : 'World backups are safe to make while the server is running. Full backups also include mods, plugins and configs.'}</div></div>
      <div class="spacer"></div>
      <button class="btn sm icon" title="Open backups folder" data-folder>${icon('folder', 15)}</button>
      ${!proxy ? `<button class="btn" data-full>${icon('archive', 16)} Back up everything</button>` : ''}
      <button class="btn primary" data-create>${icon('archive', 16)} ${proxy ? 'Create backup' : 'Back up world'}</button>
    </div>
    <div class="row wrap dim small" style="margin-bottom:14px;gap:14px">
      <span>${list.length} backup${list.length === 1 ? '' : 's'} · ${fmtBytes(total)}</span>
      <span>${icon('folder', 12)} ${custom ? `Saved in your backup folder (${esc(custom)})` : 'Saved inside the server folder'} · <a data-where>change</a></span>
      <span>${icon('calendar', 12)} ${s.automation.backupEveryHours ? `Automatic every ${s.automation.backupEveryHours}h, keeping ${s.automation.keepBackups}` : 'No automatic backups'} · <a data-auto>set up</a></span>
    </div>
    ${list.length ? `<div class="card" style="padding:0"><div class="list">${list.map((b, i) => `<div class="list-row">
      <div class="mod-icon">${icon('archive', 18)}</div>
      <div class="grow"><div class="title">${new Date(b.time).toLocaleString()} <span class="dim" style="font-weight:400">· ${ago(b.time)}</span></div>
        <div class="desc">${b.note ? `<span style="color:var(--text)">${esc(b.note)}</span> · ` : ''}${esc(b.file)} · ${fmtBytes(b.size)}</div></div>
      ${b.full ? '<span class="chip info">Full server</span>' : '<span class="chip">World</span>'}
      ${b.auto ? '<span class="chip">Automatic</span>' : '<span class="chip accent">Manual</span>'}
      <button class="btn xs icon ghost" title="Add a note" data-note="${i}">${icon('edit', 13)}</button>
      <button class="btn xs" data-restore="${i}">${icon('restart', 13)} Restore</button>
      <button class="btn xs icon ghost" title="Delete" data-del="${i}">${icon('trash', 14)}</button></div>`).join('')}</div></div>`
      : `<div class="empty"><div class="ic-wrap">${icon('archive', 24)}</div><h3>No backups yet</h3><div>Create one before trying new mods or big changes.</div></div>`}`;
  $('[data-folder]', tb).onclick = () => call('servers:openBackups', s.id).catch(fail);
  $('[data-where]', tb).onclick = () => openAppSettings('backups');
  $('[data-auto]', tb).onclick = () => { state.tab = 'schedule'; renderBody(); };
  const make = async (btn, full) => {
    const note = await promptDialog({ title: full ? 'Back up the whole server' : 'Back up the world', message: 'Add a note so you remember what this backup is for (optional).', placeholder: 'e.g. Before installing Create', confirm: 'Create backup' });
    if (note === null) return;
    btn.disabled = true; btn.innerHTML = `${icon('restart', 16, 'spin')} Backing up…`;
    try { await call('servers:createBackup', s.id, { full, note: note.trim() }); toast('Backup created', 'success'); } catch (er) { fail(er); }
    renderBackups(tb, server(s.id));
  };
  $('[data-create]', tb).onclick = (e) => make(e.currentTarget, proxy);
  const fb = $('[data-full]', tb); if (fb) fb.onclick = (e) => make(e.currentTarget, true);
  $$('[data-note]', tb).forEach((b) => (b.onclick = async () => {
    const bk = list[b.dataset.note];
    const n = await promptDialog({ title: 'Backup note', value: bk.note, placeholder: 'What is this backup for?' });
    if (n === null) return;
    try { await call('servers:backupNote', s.id, bk.file, n.trim()); renderBackups(tb, server(s.id)); } catch (e) { fail(e); }
  }));
  $$('[data-restore]', tb).forEach((b) => (b.onclick = async () => {
    const bk = list[b.dataset.restore];
    if (isRunning(server(s.id).status)) return toast('Stop the server before restoring a backup', 'error');
    if (!(await confirmDialog({ title: 'Restore this backup?', message: `${bk.full ? 'Everything in this backup (world, mods, plugins and configs)' : 'Your current world'} will be replaced with the backup from ${new Date(bk.time).toLocaleString()}. This can't be undone, so consider making a backup first.`, confirm: 'Restore', danger: true }))) return;
    b.disabled = true;
    try { await call('servers:restoreBackup', s.id, bk.file); toast('Backup restored', 'success'); } catch (e) { fail(e); }
    b.disabled = false;
  }));
  $$('[data-del]', tb).forEach((b) => (b.onclick = async () => {
    const bk = list[b.dataset.del];
    if (!(await confirmDialog({ title: 'Delete backup?', message: bk.file, confirm: 'Delete', danger: true }))) return;
    try { await call('servers:deleteBackup', s.id, bk.file); renderBackups(tb, server(s.id)); } catch (e) { fail(e); }
  }));
}
