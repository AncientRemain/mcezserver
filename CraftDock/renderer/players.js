/* global state, call, esc, icon, toast, fail, $, $$, ago, fmtDur, isRunning, isBedrock, isProxy, server, renderBody, head, promptDialog, refreshServers */
// Players tab: who's online, everyone who ever joined, operators, whitelist and bans.

const playersUi = { q: '', sort: 'last' };

async function renderPlayers(tb, s) {
  const running = isRunning(s.status) && s.status !== 'stopping';
  tb.innerHTML = `<div class="skeleton" style="height:200px"></div>`;
  let lists, hist;
  try { [lists, hist] = await Promise.all([call('servers:players', s.id), call('servers:playerHistory', s.id)]); } catch (e) { return fail(e); }
  if (state.tab !== 'players' || state.selected !== s.id) return;
  const bedrock = isBedrock(s), proxy = isProxy(s);
  const wlCmd = bedrock ? 'allowlist' : 'whitelist';
  const wlName = bedrock ? 'Allowlist' : 'Whitelist';
  const exec = async (cmd, msg) => {
    try { await call('servers:command', s.id, cmd); toast(msg || `Sent: ${cmd}`, 'success', 1800); setTimeout(() => state.tab === 'players' && state.selected === s.id && renderPlayers(tb, server(s.id)), 1200); } catch (e) { fail(e); }
  };
  const listCard = (title, ic, items, action, label) => `<div class="card"><div class="card-title">${icon(ic, 16)} ${title}<span class="right">${items.length}</span></div>
    ${items.length ? `<div class="grid" style="gap:8px">${items.map((n) => `<div class="player">${head(n)}<span class="n">${esc(n)}</span>${running && action ? `<button class="btn xs ghost" data-cmd="${esc(action)} ${esc(n)}">${label}</button>` : ''}</div>`).join('')}</div>` : `<div class="dim small">Nobody yet.</div>`}</div>`;

  const q = playersUi.q.toLowerCase();
  const sorted = [...hist].filter((p) => !q || p.name.toLowerCase().includes(q)).sort((a, b) => {
    if (playersUi.sort === 'time') return (b.playtime || 0) - (a.playtime || 0);
    if (playersUi.sort === 'name') return a.name.localeCompare(b.name);
    if (playersUi.sort === 'first') return (a.first || 0) - (b.first || 0);
    return (b.online - a.online) || (b.last || 0) - (a.last || 0);
  });

  tb.innerHTML = `
    ${!running ? `<div class="banner warn">${icon('info', 18)}<div class="grow">Start the server to op, kick, ban or ${wlName.toLowerCase()} players. The lists below are read from the server files.</div></div>` : ''}
    ${!proxy ? `<div class="card" style="margin-bottom:16px">
      <div class="card-title">${icon('users', 16)} Manage a player</div>
      <div class="row wrap">
        <input class="input" id="pname" placeholder="${bedrock ? 'Gamertag' : 'Player name'}" style="max-width:240px" ${running ? '' : 'disabled'} />
        <button class="btn sm" data-pc="op" ${running ? '' : 'disabled'}>${icon('shield', 14)} Make operator</button>
        <button class="btn sm" data-pc="${wlCmd} add" ${running ? '' : 'disabled'}>${icon('check', 14)} Add to ${wlName.toLowerCase()}</button>
        <button class="btn sm" data-pc="kick" data-reason ${running ? '' : 'disabled'}>${icon('kick', 14)} Kick</button>
        ${!bedrock ? `<button class="btn sm danger" data-pc="ban" data-reason ${running ? '' : 'disabled'}>${icon('ban', 14)} Ban</button><button class="btn sm" data-pc="pardon" ${running ? '' : 'disabled'}>${icon('heart', 14)} Unban</button>` : ''}
      </div>
      <div class="toggle-row" style="margin-top:12px;padding-bottom:0">
        <div class="t"><b>${wlName}</b><span>Only players on the ${wlName.toLowerCase()} can join${s.whitelist ? '. Make sure you add yourself!' : ''}</span></div>
        <label class="switch"><input type="checkbox" id="wl-on" ${s.whitelist ? 'checked' : ''} /><span></span></label>
      </div>
    </div>` : `<div class="banner info">${icon('network', 18)}<div class="grow">Players connect to the proxy and are sent on to your servers. Manage operators, whitelists and bans on each server in the network.</div></div>`}
    <div class="grid g-2">
      <div class="card"><div class="card-title">${icon('activity', 16)} Online now<span class="right">${lists.online.length}</span></div>
        ${lists.online.length ? `<div class="grid" style="gap:8px">${lists.online.map((n) => `<div class="player">${head(n)}<span class="n">${esc(n)}</span>
          ${!proxy ? `<button class="btn xs ghost" data-tell="${esc(n)}" title="Send a private message">${icon('send', 13)}</button>
          <button class="btn xs ghost" data-cmd="op ${esc(n)}" title="Make operator">${icon('shield', 13)}</button>
          <button class="btn xs ghost" data-cmd="gamemode creative ${esc(n)}">Creative</button>
          <button class="btn xs ghost" data-cmd="gamemode survival ${esc(n)}">Survival</button>
          <button class="btn xs ghost" data-kick="${esc(n)}" title="Kick">${icon('kick', 13)}</button>` : ''}</div>`).join('')}</div>` : `<div class="dim small">${running ? 'Nobody is online.' : 'Server is offline.'}</div>`}
      </div>
      ${!proxy ? listCard('Operators', 'shield', lists.ops, 'deop', 'Remove op') : ''}
      ${!proxy ? listCard(wlName, 'check', lists.whitelist, `${wlCmd} remove`, 'Remove') : ''}
      ${!proxy && !bedrock ? `<div class="card"><div class="card-title">${icon('ban', 16)} Banned<span class="right">${lists.banned.length + lists.bannedIps.length}</span></div>
        ${lists.banned.length || lists.bannedIps.length ? `<div class="grid" style="gap:8px">
          ${lists.banned.map((b) => `<div class="player">${head(b.name)}<div class="n" style="min-width:0"><div>${esc(b.name)}</div>${b.reason ? `<div class="dim small" style="font-weight:400">${esc(b.reason)}</div>` : ''}</div>${running ? `<button class="btn xs ghost" data-cmd="pardon ${esc(b.name)}">Unban</button>` : ''}</div>`).join('')}
          ${lists.bannedIps.map((b) => `<div class="player"><div class="mod-icon sm">${icon('globe', 14)}</div><div class="n"><div class="mono">${esc(b.ip)}</div>${b.reason ? `<div class="dim small" style="font-weight:400">${esc(b.reason)}</div>` : ''}</div>${running ? `<button class="btn xs ghost" data-cmd="pardon-ip ${esc(b.ip)}">Unban</button>` : ''}</div>`).join('')}
        </div>` : `<div class="dim small">Nobody is banned.</div>`}</div>` : ''}
    </div>
    <div class="card" style="margin-top:16px;padding:0">
      <div class="row" style="padding:14px 16px 10px">
        <div class="card-title" style="margin:0">${icon('history', 16)} Everyone who has played<span class="dim small" style="font-weight:500;margin-left:6px">${hist.length}</span></div>
        <div class="spacer"></div>
        ${hist.length > 5 ? `<div class="search-input mini">${icon('search', 13)}<input class="input" id="ph-q" placeholder="Find a player…" value="${esc(playersUi.q)}" /></div>` : ''}
        <select class="input" id="ph-sort" style="width:160px;height:30px">${[['last', 'Last seen'], ['time', 'Most playtime'], ['first', 'First joined'], ['name', 'Name']].map(([k, l]) => `<option value="${k}" ${playersUi.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </div>
      ${sorted.length ? `<div class="list">${sorted.slice(0, 300).map((p) => `<div class="list-row">
        ${head(p.name)}
        <div class="grow"><div class="title">${esc(p.name)} ${p.online ? '<span class="chip accent" style="font-size:11px">online</span>' : ''}</div><div class="desc">${p.uuid ? `<span class="mono">${esc(p.uuid)}</span>` : p.xuid ? `XUID ${esc(p.xuid)}` : ''}</div></div>
        <span class="cell">${fmtDur(p.playtime || 0)}<small>Playtime</small></span>
        <span class="cell">${p.joins || 0}<small>Joins</small></span>
        <span class="cell" title="${p.first ? new Date(p.first).toLocaleString() : ''}">${ago(p.first)}<small>First joined</small></span>
        <span class="cell" title="${p.last ? new Date(p.last).toLocaleString() : ''}">${p.online ? 'now' : ago(p.last)}<small>Last seen</small></span>
      </div>`).join('')}</div>` : `<div class="dim small" style="padding:0 16px 16px">${hist.length ? 'Nobody matches.' : 'Players appear here after they join for the first time.'}</div>`}
    </div>`;

  $$('[data-cmd]', tb).forEach((b) => (b.onclick = () => exec(b.dataset.cmd)));
  $$('[data-tell]', tb).forEach((b) => (b.onclick = async () => {
    const msg = await promptDialog({ title: `Message ${b.dataset.tell}`, placeholder: 'Your message', confirm: 'Send' });
    if (msg && msg.trim()) exec(`tell ${b.dataset.tell} ${msg.trim()}`, 'Message sent');
  }));
  $$('[data-kick]', tb).forEach((b) => (b.onclick = async () => {
    const r = await promptDialog({ title: `Kick ${b.dataset.kick}?`, message: 'Optional: tell them why.', placeholder: 'Reason (optional)', confirm: 'Kick' });
    if (r !== null) exec(`kick ${b.dataset.kick}${r.trim() ? ' ' + r.trim() : ''}`);
  }));
  $$('[data-pc]', tb).forEach((b) => (b.onclick = async () => {
    const n = $('#pname').value.trim();
    if (!(bedrock ? /^[A-Za-z0-9 _]{1,16}$/ : /^[A-Za-z0-9_]{1,16}$/).test(n)) return toast(`Enter a valid ${bedrock ? 'gamertag' : 'Minecraft username'}`, 'error');
    const target = bedrock && /\s/.test(n) ? `"${n}"` : n;
    let extra = '';
    if (b.hasAttribute('data-reason')) {
      const r = await promptDialog({ title: `${b.dataset.pc === 'ban' ? 'Ban' : 'Kick'} ${n}?`, message: 'Optional: tell them why.', placeholder: 'Reason (optional)', confirm: b.dataset.pc === 'ban' ? 'Ban' : 'Kick' });
      if (r === null) return;
      extra = r.trim() ? ` ${r.trim()}` : '';
    }
    exec(`${b.dataset.pc} ${target}${extra}`);
  }));
  const wl = $('#wl-on');
  if (wl) wl.onchange = async () => {
    try {
      await call('servers:setProperties', s.id, { [bedrock ? 'allow-list' : 'white-list']: String(wl.checked), ...(bedrock ? {} : { 'enforce-whitelist': String(wl.checked) }) });
      if (running) await call('servers:command', s.id, `${wlCmd} ${wl.checked ? 'on' : 'off'}`);
      toast(`${wlName} ${wl.checked ? 'on' : 'off'}`, 'success', 1500);
      await refreshServers();
    } catch (e) { fail(e); }
  };
  const pq = $('#ph-q'); if (pq) pq.oninput = () => { playersUi.q = pq.value; renderPlayers(tb, s).then(() => { const n = $('#ph-q'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }); };
  $('#ph-sort').onchange = (e) => { playersUi.sort = e.target.value; renderPlayers(tb, s); };
}
