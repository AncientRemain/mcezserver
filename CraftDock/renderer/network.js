/* global state, call, esc, icon, toast, fail, $, $$, LOADERS, loaderBadge, statusPill, server, select, refreshServers, openCreateWizard */
// Velocity: pick which CraftDock servers are part of the network.

async function renderNetwork(tb, s) {
  tb.innerHTML = '<div class="skeleton" style="height:220px"></div>';
  let net;
  try { net = await call('servers:network', s.id); } catch (e) { return fail(e); }
  if (state.tab !== 'network' || state.selected !== s.id) return;
  const order = [...net.members];
  const sel = new Set(net.members);
  const draw = () => {
    const members = order.filter((id) => sel.has(id));
    tb.innerHTML = `
      <div class="row" style="margin-bottom:16px">
        <div><div class="section-title">Network</div><div class="dim small">Players join the proxy on port ${s.port} and are sent to the first server below. Switch servers in game with <span class="mono">/server name</span>.</div></div>
        <div class="spacer"></div>
        <button class="btn sm" data-new-backend>${icon('plus', 14)} New server for the network</button>
      </div>
      <div class="banner info">${icon('info', 18)}<div class="grow">CraftDock turns on Velocity's secure "modern" forwarding and sets up each server (Paper, Purpur, Leaf and Folia via paper-global.yml; Fabric and Quilt get FabricProxy-Lite). Linked servers switch to offline mode, so <b>only share the proxy's address</b>, not theirs. Restart everything after saving.</div></div>
      ${net.candidates.length ? `<div class="card" style="padding:0"><div class="list">${[...members.map((id) => net.candidates.find((c) => c.id === id)).filter(Boolean), ...net.candidates.filter((c) => !sel.has(c.id))].map((c) => {
        const on = sel.has(c.id);
        const idx = members.indexOf(c.id);
        return `<div class="list-row ${on ? '' : 'disabled'}">
          <label class="switch"><input type="checkbox" data-pick="${esc(c.id)}" ${on ? 'checked' : ''} ${c.proxiedBy && c.proxiedBy !== s.id ? 'disabled' : ''} /><span></span></label>
          ${loaderBadge(c.loader)}
          <div class="grow"><div class="title">${esc(c.name)} ${idx === 0 ? '<span class="chip accent" style="font-size:11px">Players start here</span>' : ''}</div>
            <div class="desc">${esc(LOADERS[c.loader].name)} ${esc(c.mcVersion)} · 127.0.0.1:${c.port}${c.proxiedBy && c.proxiedBy !== s.id ? ' · already in another network' : ''}${!c.forwarding ? ' · no automatic forwarding for this type' : ''}</div></div>
          ${statusPill(c.status)}
          ${on && idx > 0 ? `<button class="btn xs" data-first="${esc(c.id)}" title="Send players here first">${icon('update', 13)} Make default</button>` : ''}
          <button class="btn xs icon ghost" data-open="${esc(c.id)}" title="Open">${icon('right', 14)}</button>
        </div>`;
      }).join('')}</div></div>` : `<div class="empty"><div class="ic-wrap">${icon('network', 24)}</div><h3>No servers to link yet</h3><div>Create a Paper or Fabric server first (for example a lobby and a survival world), then link them here.</div></div>`}
      <div class="row" style="margin-top:16px"><span class="dim small">${members.length} server${members.length === 1 ? '' : 's'} in the network</span><div class="spacer"></div><button class="btn primary" data-save>${icon('check', 15)} Save network</button></div>`;
    $$('[data-pick]', tb).forEach((c) => (c.onchange = () => { if (c.checked) { sel.add(c.dataset.pick); if (!order.includes(c.dataset.pick)) order.push(c.dataset.pick); } else sel.delete(c.dataset.pick); draw(); }));
    $$('[data-first]', tb).forEach((b) => (b.onclick = () => { const id = b.dataset.first; order.splice(order.indexOf(id), 1); order.unshift(id); draw(); }));
    $$('[data-open]', tb).forEach((b) => (b.onclick = () => select(b.dataset.open)));
    $('[data-new-backend]', tb).onclick = () => openCreateWizard('paper');
    $('[data-save]', tb).onclick = async (e) => {
      e.currentTarget.disabled = true;
      try {
        const r = await call('servers:setNetwork', s.id, order.filter((id) => sel.has(id)));
        r.notes.forEach((n) => toast(n, /can't|couldn't/.test(n) ? 'error' : 'info', 7000));
        toast(r.restart.length ? 'Network saved. Restart the proxy and its servers to apply.' : 'Network saved', 'success', 6000);
        await refreshServers();
        renderNetwork(tb, server(s.id));
      } catch (er) { fail(er); e.currentTarget.disabled = false; }
    };
  };
  draw();
}
