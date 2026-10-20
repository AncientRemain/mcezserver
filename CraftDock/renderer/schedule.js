/* global state, call, esc, icon, toast, fail, modal, $, $$, ago, isProxy, isBedrock, hasBuilds, contentLabel, server, refreshServers, confirmDialog */
// Schedule tab: automation switches, custom scheduled tasks and startup commands.

const TASK_ACTIONS = {
  command: ['terminal', 'Run commands'],
  broadcast: ['send', 'Send a chat message'],
  restart: ['restart', 'Restart the server'],
  stop: ['stop', 'Stop the server'],
  start: ['play', 'Start the server'],
  backup: ['archive', 'Make a backup'],
};
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function scheduleText(t) {
  const sc = t.schedule || {};
  if (sc.type === 'daily') {
    const days = (sc.days || []).length && sc.days.length < 7 ? sc.days.slice().sort().map((d) => DAYS[d]).join(', ') : 'Every day';
    return `${days} at ${sc.time}`;
  }
  const m = Number(sc.minutes) || 60;
  return m % 60 === 0 ? `Every ${m / 60 === 1 ? 'hour' : `${m / 60} hours`}` : `Every ${m} minutes`;
}
const TEMPLATES = [
  { name: 'Nightly restart', action: 'restart', value: '60', schedule: { type: 'daily', time: '04:00', days: [] } },
  { name: 'Discord reminder', action: 'broadcast', value: 'Join our Discord! (edit this message)', schedule: { type: 'interval', minutes: 30 } },
  { name: 'Save the world', action: 'command', value: 'save-all', schedule: { type: 'interval', minutes: 15 } },
  { name: 'Morning start', action: 'start', value: '', schedule: { type: 'daily', time: '15:00', days: [] } },
  { name: 'Bedtime stop', action: 'stop', value: '300', schedule: { type: 'daily', time: '23:00', days: [] } },
  { name: 'Clear the weather', action: 'command', value: 'weather clear', schedule: { type: 'interval', minutes: 60 } },
];

async function renderSchedule(tb, s) {
  const a = s.automation || {};
  const tasks = s.tasks || [];
  const proxy = isProxy(s);
  const canSoftware = hasBuilds(s.loader) || isBedrock(s);
  const sw = (key, on, title, sub) => `<div class="toggle-row"><div class="t"><b>${title}</b><span>${sub}</span></div><label class="switch"><input type="checkbox" data-auto="${key}" ${on ? 'checked' : ''}/><span></span></label></div>`;
  tb.innerHTML = `<div class="settings-layout">
    <div class="card">
      <div class="section-title">Automation</div><div class="section-sub">Let CraftDock look after this server for you. Changes save right away.</div>
      ${sw('autoStart', a.autoStart, 'Start when CraftDock opens', 'Pair it with "Launch at Windows startup" in Settings to run this server 24/7.')}
      ${!isBedrock(s) && s.loader !== 'vanilla' && !s.modpack ? sw('updateOnStart', a.updateOnStart, `Keep ${contentLabel(s.loader).toLowerCase()} up to date`, `Before every start, old versions are replaced with the newest ones for ${s.mcVersion} (Modrinth).`) : ''}
      ${canSoftware && !s.modpack ? sw('updateServerOnStart', a.updateServerOnStart, isBedrock(s) ? 'Update Bedrock automatically' : 'Keep the server build up to date', isBedrock(s) ? 'Before every start, install the newest Bedrock server so updated phones and consoles can still join.' : `Before every start, install the newest ${LOADERS[s.loader].name} build for ${s.mcVersion} (bug and security fixes).`) : ''}
      <div class="form-grid" style="margin-top:14px">
        <div class="field"><label>Restart every</label>
          <select class="input" data-auto="restartEveryHours">${[[0, 'Never'], [2, '2 hours'], [4, '4 hours'], [6, '6 hours'], [8, '8 hours'], [12, '12 hours'], [24, '24 hours']].map(([v, l]) => `<option value="${v}" ${Number(a.restartEveryHours) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <div class="hint">Counted from when the server started. Players are warned 5 min, 1 min and 10 s before.</div></div>
        <div class="field"><label>Automatic backups</label>
          <select class="input" data-auto="backupEveryHours">${[[0, 'Off'], [1, 'Every hour'], [2, 'Every 2 hours'], [3, 'Every 3 hours'], [6, 'Every 6 hours'], [12, 'Every 12 hours'], [24, 'Once a day']].map(([v, l]) => `<option value="${v}" ${Number(a.backupEveryHours) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <div class="hint">Only while the server is running.</div></div>
        <div class="field"><label>Keep automatic backups</label><input class="input" type="number" min="1" max="100" data-auto="keepBackups" value="${a.keepBackups}" />
          <div class="hint">Older automatic backups are deleted. Manual backups are never deleted.</div></div>
        ${!proxy ? `<div class="field"><label>Automatic backups include</label><select class="input" data-auto="backupFull"><option value="0" ${!a.backupFull ? 'selected' : ''}>The world</option><option value="1" ${a.backupFull ? 'selected' : ''}>Everything (world, mods, plugins, configs)</option></select></div>` : ''}
      </div>
    </div>

    <div class="card">
      <div class="row" style="margin-bottom:4px"><div class="section-title" style="margin:0">Scheduled tasks</div><div class="spacer"></div>
        <button class="btn sm" data-templates>${icon('sparkle', 14)} Ideas</button><button class="btn sm primary" data-add>${icon('plus', 14)} Add task</button></div>
      <div class="section-sub">Run commands, send messages, restart, stop, start or back up on a timer. Times use this PC's clock.</div>
      ${tasks.length ? `<div class="list tasks">${tasks.map((t, i) => {
        const [ic, label] = TASK_ACTIONS[t.action] || TASK_ACTIONS.command;
        return `<div class="list-row ${t.enabled === false ? 'disabled' : ''}">
          <div class="mod-icon sm">${icon(ic, 15)}</div>
          <div class="grow"><div class="title">${esc(t.name || label)}</div><div class="desc">${esc(scheduleText(t))} · ${esc(label)}${t.value && ['command', 'broadcast'].includes(t.action) ? `: <span class="mono">${esc(t.value.split('\n')[0].slice(0, 60))}</span>` : ''}${t.lastRun ? ` · last ran ${ago(t.lastRun)}` : ''}</div></div>
          <label class="switch"><input type="checkbox" data-en="${i}" ${t.enabled !== false ? 'checked' : ''}/><span></span></label>
          <button class="btn xs icon ghost" data-edit="${i}" title="Edit">${icon('edit', 13)}</button>
          <button class="btn xs icon ghost" data-del="${i}" title="Delete">${icon('trash', 13)}</button></div>`;
      }).join('')}</div>` : `<div class="dim small">No tasks yet. Try "Ideas" for common ones like a nightly restart.</div>`}
    </div>

    ${!proxy ? `<div class="card">
      <div class="section-title">Startup commands</div><div class="section-sub">Run every time the server comes online, one per line (no slash needed).</div>
      <textarea class="input" id="startup" rows="4" placeholder="e.g.&#10;gamerule keepInventory true&#10;say Server restarted!">${esc((s.startupCommands || []).join('\n'))}</textarea>
      <div class="row" style="margin-top:10px"><div class="spacer"></div><button class="btn sm primary" data-save-startup>${icon('check', 14)} Save startup commands</button></div>
    </div>` : ''}
  </div>`;

  const saveAuto = async (patch) => {
    try { await call('servers:update', s.id, { automation: patch }); await refreshServers(); toast('Saved', 'success', 1200); } catch (e) { fail(e); }
  };
  $$('[data-auto]', tb).forEach((el) => (el.onchange = () => {
    const k = el.dataset.auto;
    saveAuto({ [k]: el.type === 'checkbox' ? el.checked : k === 'backupFull' ? el.value === '1' : Number(el.value) });
  }));
  const saveTasks = async (list) => {
    try { await call('servers:update', s.id, { tasks: list }); await refreshServers(); renderSchedule(tb, server(s.id)); } catch (e) { fail(e); }
  };
  $$('[data-en]', tb).forEach((c) => (c.onchange = () => saveTasks(tasks.map((t, i) => (i === Number(c.dataset.en) ? { ...t, enabled: c.checked } : t)))));
  $$('[data-del]', tb).forEach((b) => (b.onclick = async () => {
    const t = tasks[b.dataset.del];
    if (!(await confirmDialog({ title: 'Delete task?', message: t.name || TASK_ACTIONS[t.action][1], confirm: 'Delete', danger: true }))) return;
    saveTasks(tasks.filter((_, i) => i !== Number(b.dataset.del)));
  }));
  $$('[data-edit]', tb).forEach((b) => (b.onclick = () => openTaskEditor(s, tasks[b.dataset.edit], (t) => saveTasks(tasks.map((x, i) => (i === Number(b.dataset.edit) ? t : x))))));
  $('[data-add]', tb).onclick = () => openTaskEditor(s, null, (t) => saveTasks([...tasks, t]));
  $('[data-templates]', tb).onclick = () => {
    const m = modal({
      title: `<div class="mod-icon sm">${icon('sparkle', 15)}</div><h2>Task ideas</h2>`,
      body: `<div class="list">${TEMPLATES.filter((t) => !(proxy && ['broadcast'].includes(t.action))).map((t, i) => `<div class="list-row pickable-row" data-t="${i}"><div class="mod-icon sm">${icon(TASK_ACTIONS[t.action][0], 15)}</div><div class="grow"><div class="title">${esc(t.name)}</div><div class="desc">${esc(scheduleText(t))} · ${esc(TASK_ACTIONS[t.action][1])}${t.value && t.action !== 'restart' && t.action !== 'stop' ? `: ${esc(t.value)}` : ''}</div></div>${icon('right', 15)}</div>`).join('')}</div>`,
    });
    $$('[data-t]', m.el).forEach((r) => (r.onclick = () => { m.close(); openTaskEditor(s, { ...TEMPLATES[r.dataset.t] }, (t) => saveTasks([...tasks, t])); }));
  };
  const sv = $('[data-save-startup]', tb);
  if (sv) sv.onclick = async () => {
    try { await call('servers:update', s.id, { startupCommands: $('#startup', tb).value }); await refreshServers(); toast('Startup commands saved', 'success', 1500); } catch (e) { fail(e); }
  };
}

function openTaskEditor(s, task, onSave) {
  const T = task ? JSON.parse(JSON.stringify(task)) : { name: '', action: 'command', value: '', schedule: { type: 'interval', minutes: 60 }, enabled: true };
  if (!T.schedule) T.schedule = { type: 'interval', minutes: 60 };
  const m = modal({
    title: `<div class="mod-icon sm">${icon('calendar', 15)}</div><h2>${task && task.id ? 'Edit task' : 'New task'}</h2>`,
    body: '<div id="te"></div>',
    foot: `<div class="spacer"></div><button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-ok>${icon('check', 15)} Save task</button>`,
  });
  const draw = () => {
    const sc = T.schedule;
    const intervalUnit = sc.type === 'interval' && sc.minutes % 60 === 0 && sc.minutes >= 60 ? 'hours' : 'minutes';
    $('#te', m.el).innerHTML = `<div class="form-grid">
      <div class="field full"><label>Name (optional)</label><input class="input" id="te-name" value="${esc(T.name)}" placeholder="${esc(TASK_ACTIONS[T.action][1])}" /></div>
      <div class="field full"><label>What should happen?</label><div class="action-grid">${Object.entries(TASK_ACTIONS).filter(([k]) => !(isProxy(s) && k === 'broadcast')).map(([k, [ic, l]]) => `<button class="action-opt ${T.action === k ? 'active' : ''}" data-act="${k}">${icon(ic, 16)}<span>${l}</span></button>`).join('')}</div></div>
      ${T.action === 'command' ? `<div class="field full"><label>Commands (one per line)</label><textarea class="input" id="te-val" rows="3" placeholder="save-all">${esc(T.value)}</textarea></div>` : ''}
      ${T.action === 'broadcast' ? `<div class="field full"><label>Message</label><input class="input" id="te-val" value="${esc(T.value)}" placeholder="Remember to vote for the server!" /><div class="hint">Shown in chat as [Server] message. Color codes like §a work.</div></div>` : ''}
      ${T.action === 'restart' || T.action === 'stop' ? `<div class="field full"><label>Warn players first</label><select class="input" id="te-val">${[[0, 'No warning'], [10, '10 seconds'], [30, '30 seconds'], [60, '1 minute'], [120, '2 minutes'], [300, '5 minutes']].map(([v, l]) => `<option value="${v}" ${String(T.value || 60) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` : ''}
      <div class="field full"><label>When?</label>
        <div class="segmented"><button class="${sc.type === 'interval' ? 'active' : ''}" data-st="interval" ${T.action === 'start' ? 'disabled' : ''}>Repeat every…</button><button class="${sc.type === 'daily' ? 'active' : ''}" data-st="daily">At a time of day</button></div>
        ${sc.type === 'interval' ? `<div class="row" style="margin-top:10px"><span class="dim">Every</span><input class="input" type="number" id="te-n" min="1" value="${intervalUnit === 'hours' ? sc.minutes / 60 : sc.minutes}" style="width:90px" /><select class="input" id="te-unit" style="width:130px"><option value="minutes" ${intervalUnit === 'minutes' ? 'selected' : ''}>minutes</option><option value="hours" ${intervalUnit === 'hours' ? 'selected' : ''}>hours</option></select><span class="dim small">while the server is online</span></div>`
          : `<div class="row" style="margin-top:10px"><span class="dim">At</span><input class="input" type="time" id="te-time" value="${esc(sc.time || '04:00')}" style="width:130px" /></div>
            <div class="days">${DAYS.map((d, i) => `<button class="day ${(sc.days || []).includes(i) ? 'active' : ''}" data-day="${i}">${d}</button>`).join('')}</div>
            <div class="hint">${(sc.days || []).length ? 'Only on the highlighted days.' : 'Every day. Click days to limit it.'}</div>`}
      </div>
    </div>`;
    $('#te-name', m.el).oninput = (e) => (T.name = e.target.value);
    $$('[data-act]', m.el).forEach((b) => (b.onclick = () => {
      T.action = b.dataset.act;
      T.value = T.action === 'restart' || T.action === 'stop' ? '60' : '';
      if (T.action === 'start') T.schedule = { type: 'daily', time: T.schedule.time || '15:00', days: T.schedule.days || [] };
      draw();
    }));
    const v = $('#te-val', m.el); if (v) v.oninput = v.onchange = () => (T.value = v.value);
    $$('[data-st]', m.el).forEach((b) => (b.onclick = () => { T.schedule = b.dataset.st === 'daily' ? { type: 'daily', time: '04:00', days: [] } : { type: 'interval', minutes: 60 }; draw(); }));
    const n = $('#te-n', m.el), u = $('#te-unit', m.el);
    if (n) { const upd = () => (T.schedule.minutes = Math.max(1, Number(n.value) || 1) * (u.value === 'hours' ? 60 : 1)); n.oninput = upd; u.onchange = upd; }
    const tm = $('#te-time', m.el); if (tm) tm.onchange = () => (T.schedule.time = tm.value);
    $$('[data-day]', m.el).forEach((b) => (b.onclick = () => {
      const d = Number(b.dataset.day);
      const set = new Set(T.schedule.days || []);
      if (set.has(d)) set.delete(d); else set.add(d);
      T.schedule.days = [...set];
      draw();
    }));
  };
  draw();
  $('[data-x]', m.el).onclick = () => m.close();
  $('[data-ok]', m.el).onclick = () => {
    if ((T.action === 'command' || T.action === 'broadcast') && !String(T.value).trim()) return toast(T.action === 'command' ? 'Enter at least one command' : 'Enter a message', 'error');
    m.close();
    onSave(T);
  };
}
