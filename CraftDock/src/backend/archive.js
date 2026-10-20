// Zip / tar helpers. Uses the system `tar` (built into Windows 10+) so big archives don't block the app.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');

const TAR = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    let err = '';
    const p = spawn(cmd, args, { cwd, windowsHide: true });
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `${cmd} exited with ${code}`))));
  });
}

async function extractArchive(file, dest) {
  await fs.promises.mkdir(dest, { recursive: true });
  try {
    await run(TAR, ['-xf', file, '-C', dest]);
  } catch (e) {
    if (!/\.(zip|mcpack|mcaddon|mcworld|mrpack|jar)$/i.test(file)) throw e;
    new AdmZip(file).extractAllTo(dest, true);
  }
}

/** Zips `entries` (names relative to `cwd`) into `outFile`, skipping `exclude` file names (e.g. locked files). */
async function createZip(outFile, cwd, entries, exclude = []) {
  await fs.promises.mkdir(path.dirname(outFile), { recursive: true });
  if (process.platform === 'win32') {
    try {
      await run(TAR, ['-a', '-cf', outFile, ...exclude.flatMap((x) => ['--exclude', x]), ...entries], cwd);
      return;
    } catch {
      await fs.promises.rm(outFile, { force: true });
    }
  }
  const zip = new AdmZip();
  const add = (rel) => {
    const full = path.join(cwd, rel);
    const st = fs.statSync(full);
    if (st.isDirectory()) { for (const n of fs.readdirSync(full)) add(path.join(rel, n)); return; }
    if (exclude.includes(path.basename(rel))) return;
    try { zip.addFile(rel.split(path.sep).join('/'), fs.readFileSync(full)); } catch {} // skip files locked by the server
  };
  entries.forEach(add);
  await new Promise((resolve, reject) => zip.writeZip(outFile, (err) => (err ? reject(err) : resolve())));
}

module.exports = { extractArchive, createZip };
