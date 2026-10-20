const fs = require('fs');
const path = require('path');

const UA = 'CraftDock/2.0.0 (desktop Minecraft server manager)';

async function request(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    redirect: 'follow',
    headers: { 'User-Agent': UA, ...(opts.headers || {}) },
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 200); } catch {}
    const err = new Error(`HTTP ${res.status} from ${new URL(url).host}${detail ? ': ' + detail : ''}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

async function getJSON(url, opts = {}) {
  const res = await request(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } });
  return res.json();
}

async function postJSON(url, body, opts = {}) {
  const res = await request(url, {
    method: 'POST',
    body: JSON.stringify(body),
    ...opts,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(opts.headers || {}) },
  });
  return res.json();
}

async function getText(url, opts = {}) {
  const res = await request(url, opts);
  return res.text();
}

/** Streams a URL to disk, reporting (received, total) bytes. Writes to a .part file first. */
async function download(url, dest, onProgress, headers = {}) {
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  const res = await request(url, { headers });
  const total = Number(res.headers.get('content-length')) || 0;
  const tmp = dest + '.part';
  const out = fs.createWriteStream(tmp);
  let received = 0;
  let lastReport = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (!out.write(value)) await new Promise((r) => out.once('drain', r));
      const now = Date.now();
      if (onProgress && now - lastReport > 100) { lastReport = now; onProgress(received, total); }
    }
    await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
  } catch (e) {
    out.destroy();
    await fs.promises.rm(tmp, { force: true });
    throw e;
  }
  onProgress && onProgress(received, total || received);
  await fs.promises.rm(dest, { force: true });
  await fs.promises.rename(tmp, dest);
  return dest;
}

const memo = new Map();
/** Caches a promise-returning fetch for `ttl` ms; failed fetches are not cached. */
function cached(key, ttl, fn) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.p;
  const p = fn().catch((e) => { memo.delete(key); throw e; });
  memo.set(key, { t: Date.now(), p });
  return p;
}

module.exports = { UA, request, getJSON, postJSON, getText, download, cached };
