/* global state, server, call, esc, icon, toast, fail, modal, $, $$, isRunning, refreshServers, renderHeader, renderSidebar, addressRow, confirmDialog */
// playit.gg: public address toggle per server + guided account linking.

const CLAIM_TEXT = {
  WaitingForUserVisit: 'Waiting for you to open the link…',
  WaitingForUser: 'Almost there! Click "Accept" / "Add agent" on the playit.gg page.',
  UserAccepted: 'Approved! Finishing up…',
};

function renderPlayitConnect(el, s) {
  if (!el || !s) return;
  const P = state.playit || {};
  const pl = s.playit || {};
  const running = isRunning(s.status);
  let body;
  if (!P.supported) body = `<div class="dim small">playit.gg tunnels are available on Windows and Linux.</div>`;
  else if (!pl.enabled) {
    body = `<div class="dim small">Let friends join from anywhere, with no router setup or port forwarding. Free with a playit.gg account.</div>`;
  } else if (!P.linked) {
    body = `<div class="banner warn" style="margin:0">${icon('alert', 16)}<div class="grow small">playit.gg isn't linked yet.</div><button class="btn xs warn" data-playit-setup>Finish setup</button></div>`;
  } else if (pl.address) {
    const bed = s.loader === 'bedrock';
    const [host, port] = bed ? [pl.address.replace(/:\d+$/, ''), (pl.address.match(/:(\d+)$/) || [])[1]] : [pl.address, null];
    body = `${bed ? `${addressRow('Public address · share this', host)}${port ? addressRow('Port', port) : ''}` : addressRow('Public address · share this', pl.address)}
      <div class="dim small">${running ? (P.running ? 'Tunnel is running. Friends can join with the address above.' : 'Starting the tunnel…') : 'The tunnel opens automatically when you start the server.'}</div>`;
  } else {
    body = `<div class="dim small">${running ? `${icon('restart', 12, 'spin')} Creating your tunnel… the address appears here in a moment.` : 'Your public address is created the first time you start this server.'}</div>`;
  }
  el.innerHTML = `<div class="playit-box">
      <div class="row" style="margin-bottom:8px">
        <span class="playit-mark">${icon('globe', 14)}</span>
        <div style="flex:1"><b>Public address</b> <span class="dim small">via playit.gg</span></div>
        <label class="switch" title="${pl.enabled ? 'Turn off' : 'Turn on'} playit.gg"><input type="checkbox" data-playit-toggle ${pl.enabled ? 'checked' : ''} ${P.supported ? '' : 'disabled'} /><span></span></label>
      </div>
      ${body}
      ${s.loader === 'bedrock' || (s.geyser && s.geyser.enabled) ? `<div class="dim small" style="margin-top:8px">${icon('info', 12)} Bedrock note: since Bedrock's switch to NetherNet, playit.gg's free tunnels ${s.loader === 'bedrock' ? 'only work if Settings → Connection method is RakNet (supported until Bedrock 26.60 on Oct 27, 2026). After that you need a playit.gg Premium TCP+UDP tunnel, or port forwarding.' : 'carry Java players only. Bedrock players need port forwarding (TCP + UDP) or a playit.gg Premium TCP+UDP tunnel.'} <a data-ext="https://playit.gg/support/minecraft-bedrock-nethernet/">Why?</a></div>` : ''}
    </div>
    ${!pl.enabled ? `<div class="dim small" style="margin-top:8px">Or forward ${s.loader === 'bedrock' ? 'TCP and UDP' : 'TCP'} port <b>${s.port}</b> on your router${s.geyser && s.geyser.enabled ? ` (and TCP + UDP ${s.geyser.port} for Bedrock players)` : ''}.</div>` : ''}`;
  $$('[data-ext]', el).forEach((a) => (a.onclick = (e) => { e.preventDefault(); call('shell:open', a.dataset.ext); }));
  $$('[data-copy]', el).forEach((b) => (b.onclick = () => { navigator.clipboard.writeText(b.dataset.copy); toast('Copied ' + b.dataset.copy, 'success', 1800); }));
  const setup = $('[data-playit-setup]', el);
  if (setup) setup.onclick = () => openPlayitSetup(s.id);
  $('[data-playit-toggle]', el).onchange = async (e) => {
    const on = e.target.checked;
    if (on && !(state.playit && state.playit.linked)) {
      e.target.checked = false;
      return openPlayitSetup(s.id);
    }
    try {
      await call('playit:setEnabled', s.id, on);
      await refreshServers();
      renderHeader();
      renderPlayitConnect(el, server(s.id));
      toast(on ? 'playit.gg turned on' + (running ? '. Connecting…' : '. The tunnel opens when the server starts.') : 'playit.gg turned off for this server', 'success');
    } catch (err) { e.target.checked = !on; fail(err); }
  };
}

let playitModal = null;
async function openPlayitSetup(serverId) {
  if (playitModal) return;
  let step = 'intro';
  let url = null;
  let pct = null;
  const m = modal({
    title: `<span class="playit-mark lg">${icon('globe', 18)}</span><div><h2>Set up playit.gg</h2><div class="dim small">Free public address for your server, no port forwarding</div></div>`,
    body: '<div id="pg-body"></div>',
    foot: '<div id="pg-foot" class="row" style="width:100%"></div>',
    onClose: () => { if (step === 'waiting') call('playit:cancelClaim').catch(() => {}); playitModal = null; offProg(); },
  });
  const offProg = api.onPlayitProgress((p) => { pct = p; if (step === 'installing') draw(); });
  const body = () => $('#pg-body', m.el);
  const foot = () => $('#pg-foot', m.el);

  const draw = () => {
    if (!document.body.contains(m.el)) return;
    const P = state.playit || {};
    if (step !== 'done' && P.linked) step = 'done';
    if (step === 'intro') {
      body().innerHTML = `
        <div class="steps-list">
          <div class="st"><b>1</b><div><div class="t">CraftDock downloads the official playit.gg agent</div><div class="dim small">A small (5 MB) program from playit.gg's GitHub that keeps the tunnel open.</div></div></div>
          <div class="st"><b>2</b><div><div class="t">You approve CraftDock on playit.gg</div><div class="dim small">Your browser opens. Sign in or create a free playit.gg account, then click Accept.</div></div></div>
          <div class="st"><b>3</b><div><div class="t">You get a public address</div><div class="dim small">Something like <span class="mono">word-word.gl.joinmc.link</span>. It stays the same, and friends just paste it into Minecraft.</div></div></div>
        </div>
        <div class="dim small" style="margin-top:14px">playit.gg is a third-party service. CraftDock only stores the agent key it gives you, on this computer.</div>`;
      foot().innerHTML = `<div class="spacer"></div><button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-go>${icon('external', 15)} Continue in browser</button>`;
      $('[data-x]', foot()).onclick = () => m.close();
      $('[data-go]', foot()).onclick = start;
    } else if (step === 'installing') {
      body().innerHTML = `<div class="row" style="margin-bottom:10px"><span style="flex:1">Downloading the playit.gg agent…</span><span class="dim small">${pct != null ? Math.round(pct * 100) + '%' : ''}</span></div>
        <div class="progress ${pct == null ? 'indeterminate' : ''}"><i style="width:${Math.round((pct || 0) * 100)}%"></i></div>`;
      foot().innerHTML = '';
    } else if (step === 'waiting') {
      const st = (P.claiming && P.claiming.state) || 'WaitingForUserVisit';
      body().innerHTML = `<div class="center-col">
          <div class="pulse-ring">${icon('globe', 26)}</div>
          <h3 style="margin:14px 0 4px">Approve CraftDock on playit.gg</h3>
          <div class="muted">${esc(CLAIM_TEXT[st] || 'Waiting…')}</div>
          <div class="address" style="margin-top:16px;width:100%"><div style="flex:1"><div class="lbl">Approval link</div><div class="val selectable" style="font-size:12px">${esc(url || '')}</div></div>
            <button class="btn sm ghost icon" title="Copy" data-copy-url>${icon('copy', 15)}</button></div>
          <div class="dim small">Browser didn't open? Click "Open link again" below.</div>
        </div>`;
      foot().innerHTML = `<button class="btn ghost" data-x>Cancel</button><div class="spacer"></div><button class="btn" data-open>${icon('external', 15)} Open link again</button>`;
      $('[data-x]', foot()).onclick = () => m.close();
      $('[data-open]', foot()).onclick = () => call('shell:open', url);
      $('[data-copy-url]', body()).onclick = () => { navigator.clipboard.writeText(url); toast('Link copied', 'success', 1500); };
    } else if (step === 'done') {
      body().innerHTML = `<div class="center-col">
          <div class="pulse-ring ok">${icon('check', 28)}</div>
          <h3 style="margin:14px 0 4px">playit.gg is linked</h3>
          <div class="muted">${serverId ? 'Public address is now on for this server. Start the server and your address appears in the Connect card.' : 'Turn on "Public address" in any server\'s Connect card.'}</div>
        </div>`;
      foot().innerHTML = `<div class="spacer"></div><button class="btn primary" data-x>Done</button>`;
      $('[data-x]', foot()).onclick = () => m.close();
    }
  };

  async function start() {
    try {
      if (!(state.playit && state.playit.installed)) { step = 'installing'; draw(); }
      const r = await call('playit:startClaim');
      url = r.url;
      step = 'waiting';
      state.playit = await call('playit:status');
      draw();
      call('shell:open', url).catch(() => {});
    } catch (e) { step = 'intro'; draw(); fail(e); }
  }

  playitModal = {
    redraw: async () => {
      const wasLinked = step === 'done';
      draw();
      if (!wasLinked && step === 'done' && serverId) {
        try { await call('playit:setEnabled', serverId, true); await refreshServers(); renderHeader(); renderSidebar(); } catch (e) { fail(e); }
      }
    },
  };
  draw();
}

function playitStateChanged() {
  call('playit:status').then((st) => {
    state.playit = st;
    if (playitModal) playitModal.redraw();
    if (state.page === 'settings' && $('#playit-settings')) renderPlayitSettings($('#playit-settings'));
    if (state.selected && state.tab === 'overview') renderPlayitConnect($('#playit-connect'), server());
  }).catch(() => {});
}

async function renderPlayitSettings(el) {
  const P = state.playit || {};
  el.innerHTML = `
    <div class="row" style="margin-bottom:14px">
      <span class="playit-mark lg">${icon('globe', 18)}</span>
      <div style="flex:1"><b>playit.gg</b><div class="dim small">Free tunnels so friends can join without port forwarding.</div></div>
      ${P.linked ? `<span class="chip accent">${icon('check', 12)} Linked</span>` : `<span class="chip">Not linked</span>`}
    </div>
    <div class="kv" style="margin-bottom:14px">
      <div class="k">Agent</div><div class="v">${P.installed ? `Installed${P.version ? ` · ${esc(P.version)}` : ''}` : 'Not downloaded yet'}</div>
      <div class="k">Agent status</div><div class="v">${P.running ? '<span style="color:var(--accent)">Running</span>' : 'Stopped (starts with a server that has playit on)'}</div>
      <div class="k">Account</div><div class="v" id="pg-acct">${P.linked ? 'Checking…' : '—'}</div>
    </div>
    <div class="row wrap">
      ${P.linked
        ? `<button class="btn sm" data-pg-dash>${icon('external', 14)} Open playit.gg dashboard</button>
           <button class="btn sm" data-pg-log>${icon('terminal', 14)} Agent log</button>
           <button class="btn sm" data-pg-update>${icon('download', 14)} ${P.installed ? 'Update agent' : 'Download agent'}</button>
           <button class="btn sm danger" data-pg-unlink>${icon('x', 14)} Unlink</button>`
        : `<button class="btn sm primary" data-pg-link>${icon('globe', 14)} Link playit.gg account</button>`}
    </div>`;
  const b = (sel, fn) => { const x = $(sel, el); if (x) x.onclick = fn; };
  b('[data-pg-link]', () => openPlayitSetup(null));
  b('[data-pg-dash]', () => call('shell:open', 'https://playit.gg/account/tunnels'));
  b('[data-pg-update]', async (e) => {
    e.currentTarget.disabled = true;
    try { const v = await call('playit:install'); toast(`playit agent ${v} installed`, 'success'); } catch (er) { fail(er); }
    playitStateChanged();
  });
  b('[data-pg-unlink]', async () => {
    if (!(await confirmDialog({ title: 'Unlink playit.gg?', message: 'CraftDock forgets its playit.gg agent key and stops all tunnels. Your tunnels stay on your playit.gg account (you can delete them on the website).', confirm: 'Unlink', danger: true }))) return;
    try { await call('playit:unlink'); toast('playit.gg unlinked', 'success'); } catch (e) { fail(e); }
    playitStateChanged();
  });
  b('[data-pg-log]', async () => {
    const lines = await call('playit:log').catch(() => []);
    modal({ title: '<h2>playit.gg agent log</h2>', size: 'lg', body: `<div class="console" style="height:420px">${lines.length ? lines.map(esc).join('\n') : 'The agent has not run yet.'}</div>` });
  });
  if (P.linked) {
    try {
      const a = await call('playit:account');
      const acct = $('#pg-acct', el);
      if (acct) acct.innerHTML = `${esc({ ready: 'Ready', guest: 'Guest account', 'email-not-verified': 'Email not verified' }[a.status] || a.status)} · ${a.tunnels.length} tunnel${a.tunnels.length === 1 ? '' : 's'}`;
    } catch (e) {
      const acct = $('#pg-acct', el);
      if (acct) acct.innerHTML = `<span style="color:var(--danger)">${esc(e.message)}</span>`;
    }
  }
}
