// Downloads and manages Eclipse Temurin Java runtimes so each server gets the Java it needs.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { getJSON, download } = require('./net');
const { extractArchive } = require('./archive');

const isWin = process.platform === 'win32';

/** Maps Mojang's required Java to a Temurin feature release that exists. */
function javaFeatureFor(required) {
  if (required <= 8) return 8;
  if (required <= 17) return 17; // covers Minecraft 1.17's Java 16 requirement
  if (required <= 21) return 21;
  if (required <= 25) return 25;
  return required;
}

function findJavaExe(dir, depth = 0) {
  const exe = isWin ? 'java.exe' : 'java';
  const direct = path.join(dir, 'bin', exe);
  if (fs.existsSync(direct)) return direct;
  if (depth > 3 || !fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const found = findJavaExe(path.join(dir, entry.name), depth + 1);
    if (found) return found;
  }
  return null;
}

class JavaManager {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'runtimes');
    this.pending = new Map();
  }

  installed() {
    if (!fs.existsSync(this.dir)) return [];
    return fs.readdirSync(this.dir)
      .filter((n) => /^java-\d+$/.test(n))
      .map((n) => ({ feature: Number(n.slice(5)), path: findJavaExe(path.join(this.dir, n)) }))
      .filter((j) => j.path);
  }

  /**
   * Returns the path to a java executable for `feature`, downloading it on first use.
   * `kind` 'jdk' gets a full JDK (needed to compile, e.g. Spigot's BuildTools); servers run fine on the JRE.
   */
  ensure(feature, onProgress, kind = 'jre') {
    const key = `${kind}-${feature}`;
    const target = path.join(this.dir, kind === 'jdk' ? `jdk-${feature}` : `java-${feature}`);
    const existing = findJavaExe(target);
    if (existing && (kind !== 'jdk' || fs.existsSync(path.join(path.dirname(existing), isWin ? 'javac.exe' : 'javac')))) return Promise.resolve(existing);
    if (this.pending.has(key)) return this.pending.get(key);
    const p = this._install(feature, target, onProgress, kind === 'jdk' ? ['jdk'] : ['jre', 'jdk']).finally(() => this.pending.delete(key));
    this.pending.set(key, p);
    return p;
  }

  async _install(feature, target, onProgress, imageTypes = ['jre', 'jdk']) {
    const os = isWin ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
    let pkg = null;
    for (const imageType of imageTypes) {
      try {
        const assets = await getJSON(
          `https://api.adoptium.net/v3/assets/latest/${feature}/hotspot?architecture=${arch}&image_type=${imageType}&os=${os}&vendor=eclipse`
        );
        if (assets.length) { pkg = assets[0].binary.package; break; }
      } catch {}
    }
    if (!pkg) throw new Error(`Could not find a Java ${feature} download for this computer`);

    const archive = path.join(this.dir, pkg.name);
    onProgress && onProgress({ step: `Downloading Java ${feature}`, pct: 0 });
    await download(pkg.link, archive, (got, total) =>
      onProgress && onProgress({ step: `Downloading Java ${feature}`, pct: total ? got / total : 0, detail: `${(got / 1048576).toFixed(1)} MB` }));
    onProgress && onProgress({ step: `Unpacking Java ${feature}`, pct: null });
    const staging = target + '.tmp';
    await fs.promises.rm(staging, { recursive: true, force: true });
    await fs.promises.mkdir(staging, { recursive: true });
    await extractArchive(archive, staging);
    await fs.promises.rm(archive, { force: true });
    await fs.promises.rm(target, { recursive: true, force: true });
    await fs.promises.rename(staging, target);
    const exe = findJavaExe(target);
    if (!exe) throw new Error(`Java ${feature} was downloaded but no java executable was found inside`);
    return exe;
  }
}

/** Runs `java -version` and returns the reported version string. */
function probeJava(javaPath) {
  return new Promise((resolve) => {
    let out = '';
    const p = spawn(javaPath, ['-version'], { windowsHide: true });
    for (const s of [p.stdin, p.stdout, p.stderr]) s && s.on('error', () => {});
    p.stderr.on('data', (d) => (out += d));
    p.stdout.on('data', (d) => (out += d));
    p.on('error', () => resolve(null));
    p.on('close', () => {
      const m = out.match(/version "([^"]+)"/);
      resolve(m ? m[1] : null);
    });
  });
}

module.exports = { JavaManager, javaFeatureFor, findJavaExe, probeJava };
