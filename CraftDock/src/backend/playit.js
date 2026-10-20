// playit.gg integration: links an agent to the user's playit account, manages one
// Minecraft Java tunnel per server and runs the official playit agent in the background.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { getJSON, download, UA } = require('./net');

const API = 'https://api.playit.gg';
const RELEASES = 'https://api.github.com/repos/playit-cloud/playit-agent/releases?per_page=15';

function assetNames() {
  if (process.platform === 'win32') return ['playit-windows-x86_64-signed.exe', 'playit-windows-x86_64.exe'];
  if (process.platform === 'linux') return [process.arch === 'arm64' ? 'playit-linux-aarch64' : 'playit-linux-amd64'];
  return [];
}

const FRIENDLY = {
  RequiresVerifiedAccount: 'Your playit.gg account needs a verified email before it can create tunnels. Verify it on playit.gg, then try again.',
  RequiresPlayitPremium: 'This needs playit.gg Premium.',
  AgentNotFound: 'This agent is no longer on your playit.gg account. Unlink and link again.',
  AgentVersionTooOld: 'The playit agent is out of date. Use "Update agent" and try again.',
  InvalidPortCount: 'playit.gg rejected the port settings.',
  UserRejected: 'The link request was rejected on playit.gg.',
  CodeExpired: 'The link code expired. Start the setup again.',
};

class PlayitService extends EventEmitter {
  constructor(dataDir) {
    super();
    this.dir = path.join(dataDir, 'playit');
    this.exe = path.join(this.dir, process.platform === 'win32' ? 'playit.exe' : 'playit');
    this.secretFile = path.join(this.dir, 'secret.txt');
    this.logFile = path.join(this.dir, 'agent.log');
    this.proc = null;
    this.claim = null;
    this.users = new Set(); // server ids currently needing the agent
  }

  // ---------- state ----------
  secret() {
    try { const s = fs.readFileSync(this.secretFile, 'utf8').trim(); return /^[0-9a-f]+$/i.test(s) ? s : null; } catch { return null; }
  }
  installed() { return fs.existsSync(this.exe); }
  status() {
    return {
      supported: assetNames().length > 0,
      installed: this.installed(),
      linked: !!this.secret(),
      running: !!this.proc,
      claiming: this.claim ? { url: this.claim.url, state: this.claim.state } : null,
      version: this._version(),
    };
  }
  _version() {
    try { return JSON.parse(fs.readFileSync(path.join(this.dir, 'version.json'), 'utf8')).tag; } catch { return null; }
  }

  // ---------- API ----------
  async api(route, body, auth = true) {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA };
    if (auth) {
      const s = this.secret();
      if (!s) throw new Error('playit.gg is not linked yet');
      headers.Authorization = `Agent-Key ${s}`;
    }
    const res = await fetch(API + route, { method: 'POST', headers, body: JSON.stringify(body || {}) });
    if (res.status === 429) throw new Error('playit.gg is rate limiting requests, try again in a minute');
    let json;
    try { json = await res.json(); } catch { throw new Error(`playit.gg returned HTTP ${res.status}`); }
    if (json.status === 'success') return json.data;
    const reason = typeof json.data === 'string' ? json.data : json.data && (json.data.message || json.data.type) || JSON.stringify(json.data);
    const e = new Error(FRIENDLY[reason] || `playit.gg: ${reason}`);
    e.reason = reason;
    throw e;
  }

  // ---------- agent binary ----------
  async installAgent(onProgress) {
    const names = assetNames();
    if (!names.length) throw new Error('playit.gg integration is only available on Windows and Linux');
    const releases = await getJSON(RELEASES, { headers: { Accept: 'application/vnd.github+json' } });
    const release = releases.find((r) => !r.prerelease && !r.draft && r.assets.some((a) => names.includes(a.name))) ||
      releases.find((r) => r.assets.some((a) => names.includes(a.name)));
    if (!release) throw new Error('Could not find a playit agent download');
    const asset = names.map((n) => release.assets.find((a) => a.name === n)).find(Boolean);
    const wasRunning = !!this.proc;
    if (wasRunning) await this.stopAgent();
    fs.mkdirSync(this.dir, { recursive: true });
    await download(asset.browser_download_url, this.exe, (g, t) => onProgress && onProgress(t ? g / t : null));
    if (process.platform !== 'win32') fs.chmodSync(this.exe, 0o755);
    fs.writeFileSync(path.join(this.dir, 'version.json'), JSON.stringify({ tag: release.tag_name }));
    if (wasRunning) this._spawn();
    return release.tag_name;
  }

  // ---------- account linking ----------
  /** Starts the claim flow. Returns the URL the user must open to approve this agent. */
  async startClaim() {
    if (this.claim) return { url: this.claim.url };
    const code = crypto.randomBytes(5).toString('hex');
    await this.api('/claim/setup', { code, agent_type: 'self-managed', version: 'CraftDock 2.0' }, false);
    const claim = { code, url: `https://playit.gg/claim/${code}`, state: 'WaitingForUserVisit', cancelled: false };
    this.claim = claim;
    this._pollClaim(claim);
    return { url: claim.url };
  }

  cancelClaim() {
    if (this.claim) this.claim.cancelled = true;
    this.claim = null;
    this.emit('changed');
  }

  async _pollClaim(claim) {
    const deadline = Date.now() + 15 * 60 * 1000;
    try {
      while (!claim.cancelled && Date.now() < deadline) {
        const state = await this.api('/claim/setup', { code: claim.code, agent_type: 'self-managed', version: 'CraftDock 2.0' }, false);
        if (state !== claim.state) { claim.state = state; this.emit('changed'); }
        if (state === 'UserRejected') throw new Error(FRIENDLY.UserRejected);
        if (state === 'UserAccepted') {
          const { secret_key } = await this.api('/claim/exchange', { code: claim.code }, false);
          fs.mkdirSync(this.dir, { recursive: true });
          fs.writeFileSync(this.secretFile, secret_key.trim());
          this.claim = null;
          this.emit('linked');
          this.emit('changed');
          return;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (!claim.cancelled) throw new Error(FRIENDLY.CodeExpired);
    } catch (e) {
      if (claim.cancelled) return;
      this.claim = null;
      this.emit('claim-error', e.message);
      this.emit('changed');
    }
  }

  async unlink() {
    await this.stopAgent();
    fs.rmSync(this.secretFile, { force: true });
    this.emit('changed');
  }

  async account() {
    const run = await this.api('/agents/rundata', {});
    return { agentId: run.agent_id, status: run.account_status, tunnels: run.tunnels || [] };
  }

  // ---------- tunnels ----------
  async listTunnels() {
    const r = await this.api('/tunnels/list', { tunnel_id: null, agent_id: null });
    return r.tunnels || [];
  }

  static address(t) {
    if (!t || !t.alloc || t.alloc.status !== 'allocated') return null;
    const a = t.alloc.data;
    if (t.tunnel_type === 'minecraft-java') return a.assigned_domain;
    return `${a.assigned_domain}:${a.port_start}`;
  }

  /**
   * Makes sure a tunnel exists for this server pointing at `port`. `kind` is 'java' (TCP) or 'bedrock' (UDP,
   * for Bedrock servers and Geyser). Returns { tunnelId, address }.
   */
  async ensureTunnel(serverName, port, tunnelId, kind = 'java') {
    const { agentId } = await this.account();
    let tunnels = await this.listTunnels();
    let t = tunnelId && tunnels.find((x) => x.id === tunnelId);
    if (t) {
      const origin = t.origin && t.origin.data;
      if (!origin || origin.local_port !== port || origin.agent_id !== agentId || t.active === false) {
        await this.api('/tunnels/update', { tunnel_id: t.id, local_ip: '127.0.0.1', local_port: port, agent_id: agentId, enabled: true });
      }
    } else {
      const name = `CraftDock - ${serverName}${kind === 'bedrock' ? ' (Bedrock)' : ''}`.slice(0, 60);
      const created = await this.api('/tunnels/create', {
        name, tunnel_type: kind === 'bedrock' ? 'minecraft-bedrock' : 'minecraft-java', port_type: kind === 'bedrock' ? 'udp' : 'tcp', port_count: 1,
        origin: { type: 'agent', data: { agent_id: agentId, local_ip: '127.0.0.1', local_port: port } },
        enabled: true, alloc: null, firewall_id: null, proxy_protocol: null,
      });
      tunnelId = created.id;
    }
    // New tunnels take a few seconds to get an address.
    for (let i = 0; i < 20; i++) {
      tunnels = await this.listTunnels();
      t = tunnels.find((x) => x.id === tunnelId);
      const addr = PlayitService.address(t);
      if (addr) return { tunnelId, address: addr };
      await new Promise((r) => setTimeout(r, 1500));
    }
    return { tunnelId, address: null };
  }

  async deleteTunnel(tunnelId) {
    if (tunnelId) await this.api('/tunnels/delete', { tunnel_id: tunnelId });
  }

  // ---------- agent process ----------
  acquire(serverId) {
    this.users.add(serverId);
    if (!this.proc) this._spawn();
  }
  release(serverId) {
    this.users.delete(serverId);
    if (!this.users.size) this.stopAgent();
  }

  _spawn() {
    if (this.proc || !this.installed() || !this.secret()) return;
    const args = ['--secret-path', this.secretFile, '--log-path', this.logFile];
    if (process.platform === 'win32') args.push('--socket-path', '\\\\.\\pipe\\craftdock-playit');
    else args.push('--socket-path', path.join(this.dir, 'playit.sock'));
    try { fs.writeFileSync(this.logFile, ''); } catch {}
    const p = spawn(this.exe, args, { cwd: this.dir, windowsHide: true });
    for (const s of [p.stdin, p.stdout, p.stderr]) s && s.on('error', () => {});
    p.on('error', (e) => this.emit('agent-error', e.message));
    p.on('exit', () => {
      if (this.proc === p) this.proc = null;
      this.emit('changed');
      // restart if servers still need it
      if (this.users.size && !this._stopping) setTimeout(() => this._spawn(), 5000);
    });
    this.proc = p;
    this.emit('changed');
  }

  stopAgent() {
    const p = this.proc;
    if (!p) return Promise.resolve();
    this._stopping = true;
    return new Promise((resolve) => {
      const done = () => { this._stopping = false; resolve(); };
      p.once('exit', done);
      try { p.kill(); } catch { done(); }
      setTimeout(done, 3000);
    });
  }

  logTail(lines = 40) {
    try { return fs.readFileSync(this.logFile, 'utf8').split(/\r?\n/).filter(Boolean).slice(-lines); } catch { return []; }
  }
}

module.exports = { PlayitService };
