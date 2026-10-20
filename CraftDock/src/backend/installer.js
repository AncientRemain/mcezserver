// Installs server files for each server type into an instance folder.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');
const { getJSON, download } = require('./net');
const { extractArchive } = require('./archive');
const V = require('./versions');
const T = require('./types');

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

function dl(url, dest, label, progress) {
  progress({ step: label, pct: 0 });
  return download(url, dest, (got, total) => progress({ step: label, pct: total ? got / total : null, detail: mb(got) }));
}

/** Runs a Java program (an installer), streaming its output to the progress log. */
function runJava(java, args, cwd, progress, tmp, timeoutMs = 45 * 60000) {
  return new Promise((resolve, reject) => {
    const env = tmp ? { ...process.env, TMP: tmp, TEMP: tmp } : process.env;
    const p = spawn(java, args, { cwd, windowsHide: true, env });
    for (const s of [p.stdin, p.stdout, p.stderr]) s && s.on('error', () => {});
    const tail = [];
    const onData = (d) => {
      for (const line of String(d).split(/\r?\n/)) {
        if (!line.trim()) continue;
        tail.push(line);
        if (tail.length > 30) tail.shift();
        progress({ log: line });
      }
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    const timer = setTimeout(() => { try { p.kill(); } catch {} }, timeoutMs);
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`Installer exited with code ${code}:\n${tail.slice(-8).join('\n')}`));
    });
  });
}

async function fillDownload(project, mcVersion, build) {
  const b = await getJSON(`${V.FILL}/${project}/versions/${encodeURIComponent(mcVersion)}/builds/${build || 'latest'}`);
  const file = b.downloads && b.downloads['server:default'];
  if (!file) throw new Error(`${project} build has no server download`);
  return { url: file.url, build: String(b.id) };
}

/** Files a Bedrock update must never overwrite. */
const BEDROCK_KEEP = new Set(['server.properties', 'permissions.json', 'allowlist.json', 'whitelist.json', 'packetlimitconfig.json']);

async function installBedrock(dir, version, progress) {
  const url = await V.bedrockDownload(version);
  const zip = path.join(dir, '.bedrock-download.zip');
  await dl(url, zip, `Downloading Bedrock Dedicated Server ${version}`, progress);
  const staging = path.join(dir, '.bedrock-new');
  progress({ step: 'Unpacking Bedrock server', pct: null });
  await fs.promises.rm(staging, { recursive: true, force: true });
  await extractArchive(zip, staging);
  const copy = async (rel) => {
    const src = path.join(staging, rel), dest = path.join(dir, rel);
    const st = await fs.promises.stat(src);
    if (st.isDirectory()) {
      await fs.promises.mkdir(dest, { recursive: true });
      for (const n of await fs.promises.readdir(src)) await copy(path.join(rel, n));
    } else if (!(BEDROCK_KEEP.has(rel) && fs.existsSync(dest))) {
      await fs.promises.copyFile(src, dest);
    }
  };
  for (const n of await fs.promises.readdir(staging)) await copy(n);
  await fs.promises.rm(staging, { recursive: true, force: true });
  await fs.promises.rm(zip, { force: true });
  return { exe: process.platform === 'win32' ? 'bedrock_server.exe' : 'bedrock_server', loaderVersion: null };
}

/** Builds Spigot with BuildTools (in a short path: BuildTools refuses folders with special characters). */
async function installSpigot(dir, mcVersion, java, tmp, progress) {
  const work = path.join(path.dirname(tmp), 'buildtools');
  await fs.promises.mkdir(work, { recursive: true });
  if (/[^A-Za-z0-9 _\-.\\/:]/.test(work)) throw new Error(`BuildTools can't run in ${work} (special characters in the path).`);
  const bt = path.join(work, 'BuildTools.jar');
  await dl('https://hub.spigotmc.org/jenkins/job/BuildTools/lastSuccessfulBuild/artifact/target/BuildTools.jar', bt, 'Downloading BuildTools', progress);
  const out = path.join(work, 'out');
  await fs.promises.rm(out, { recursive: true, force: true });
  progress({ step: `Building Spigot ${mcVersion} with BuildTools (this takes 3–10 minutes the first time)`, pct: null });
  await runJava(java, ['-jar', bt, '--nogui', '--rev', mcVersion, '--compile', 'SPIGOT', '--final-name', 'spigot.jar', '-o', out], work, progress, tmp, 60 * 60000);
  const jar = path.join(out, 'spigot.jar');
  if (!fs.existsSync(jar)) throw new Error('BuildTools finished but spigot.jar was not created');
  await fs.promises.copyFile(jar, path.join(dir, 'spigot.jar'));
  await fs.promises.rm(out, { recursive: true, force: true });
  return { jar: 'spigot.jar', loaderVersion: null };
}

/** Velocity: writes velocity.toml from the jar's own default config, with CraftDock's port, plus a forwarding secret. */
function prepareVelocity(dir, jar, port, motd) {
  const cfg = path.join(dir, 'velocity.toml');
  if (!fs.existsSync(cfg)) {
    try {
      const e = new AdmZip(path.join(dir, jar)).getEntry('default-velocity.toml');
      if (e) {
        let text = e.getData().toString('utf8');
        text = text.replace(/^bind\s*=.*$/m, `bind = "0.0.0.0:${port}"`);
        if (motd) text = text.replace(/^motd\s*=.*$/m, `motd = ${JSON.stringify(motd)}`);
        text = text.replace(/^player-info-forwarding-mode\s*=.*$/m, 'player-info-forwarding-mode = "modern"');
        fs.writeFileSync(cfg, text);
      }
    } catch {}
  }
  const secret = path.join(dir, 'forwarding.secret');
  if (!fs.existsSync(secret)) fs.writeFileSync(secret, crypto.randomBytes(9).toString('base64url'));
}

/**
 * Downloads/installs the server software. Returns { jar } for jar-launched servers, { exe } for Bedrock;
 * Forge/NeoForge launch info is detected later from the files the installer wrote.
 */
async function installServer({ dir, loader, mcVersion, loaderVersion, java, tmp, port, motd }, progress) {
  await fs.promises.mkdir(dir, { recursive: true });
  const t = T.type(loader);
  switch (loader) {
    case 'vanilla': {
      const info = await V.mojangVersionInfo(mcVersion);
      if (!info.downloads || !info.downloads.server) throw new Error(`Mojang has no server download for ${mcVersion}`);
      await dl(info.downloads.server.url, path.join(dir, 'server.jar'), `Downloading Minecraft ${mcVersion} server`, progress);
      return { jar: 'server.jar' };
    }
    case 'paper':
    case 'folia': {
      const f = await fillDownload(t.fill, mcVersion, loaderVersion);
      await dl(f.url, path.join(dir, 'server.jar'), `Downloading ${loader === 'paper' ? 'Paper' : 'Folia'} ${mcVersion} build #${f.build}`, progress);
      return { jar: 'server.jar', loaderVersion: f.build };
    }
    case 'velocity': {
      const f = await fillDownload('velocity', mcVersion, loaderVersion);
      await dl(f.url, path.join(dir, 'velocity.jar'), `Downloading Velocity ${mcVersion} build #${f.build}`, progress);
      prepareVelocity(dir, 'velocity.jar', port || 25577, motd);
      return { jar: 'velocity.jar', loaderVersion: f.build };
    }
    case 'purpur': {
      let build = loaderVersion;
      if (!build) build = String((await getJSON(`${V.PURPUR_API}/${encodeURIComponent(mcVersion)}`)).builds.latest);
      await dl(`${V.PURPUR_API}/${encodeURIComponent(mcVersion)}/${encodeURIComponent(build)}/download`, path.join(dir, 'server.jar'), `Downloading Purpur ${mcVersion} build #${build}`, progress);
      return { jar: 'server.jar', loaderVersion: build };
    }
    case 'leaf': {
      const builds = await V.listLoaderVersions('leaf', mcVersion);
      const b = (loaderVersion && builds.find((x) => x.id === String(loaderVersion))) || builds[0];
      if (!b || !b.file) throw new Error(`No Leaf build found for ${mcVersion}`);
      await dl(`${V.LEAF_API}/versions/${encodeURIComponent(mcVersion)}/builds/${b.id}/downloads/${encodeURIComponent(b.file)}`, path.join(dir, 'server.jar'), `Downloading Leaf ${mcVersion} build #${b.id}`, progress);
      return { jar: 'server.jar', loaderVersion: b.id };
    }
    case 'mohist':
    case 'youer': {
      const build = loaderVersion || 'latest';
      const jar = `${loader}-server.jar`;
      await dl(`${V.MOHIST_API}/${t.project}/${encodeURIComponent(mcVersion)}/builds/${encodeURIComponent(build)}/download`, path.join(dir, jar), `Downloading ${loader === 'mohist' ? 'Mohist' : 'Youer'} ${mcVersion}${loaderVersion ? ` build #${loaderVersion}` : ''}`, progress);
      let id = loaderVersion;
      if (!id) { try { id = (await V.listLoaderVersions(loader, mcVersion))[0].id; } catch {} }
      return { jar, loaderVersion: id || null };
    }
    case 'spigot':
      return installSpigot(dir, mcVersion, java, tmp, progress);
    case 'sponge': {
      let v = loaderVersion;
      if (!v) {
        const list = await V.listLoaderVersions('sponge', mcVersion);
        v = (list.find((x) => x.recommended) || list[0] || {}).id;
        if (!v) throw new Error(`No SpongeVanilla build for ${mcVersion}`);
      }
      const info = await getJSON(`${V.SPONGE_API}/versions/${encodeURIComponent(v)}`);
      const asset = (info.assets || []).find((a) => a.classifier === 'universal' && a.extension === 'jar') ||
        (info.assets || []).find((a) => !a.classifier && a.extension === 'jar');
      if (!asset) throw new Error('SpongeVanilla build has no server jar');
      for (const f of fs.readdirSync(dir)) if (/^spongevanilla.*\.jar$/i.test(f)) fs.rmSync(path.join(dir, f), { force: true });
      await dl(asset.downloadUrl, path.join(dir, 'spongevanilla.jar'), `Downloading SpongeVanilla ${v}`, progress);
      return { jar: 'spongevanilla.jar', loaderVersion: v };
    }
    case 'fabric': {
      const installers = await getJSON(`${V.FABRIC_META}/versions/installer`);
      const inst = (installers.find((i) => i.stable) || installers[0]).version;
      let lv = loaderVersion;
      if (!lv) {
        const list = await V.listLoaderVersions('fabric', mcVersion);
        lv = (list.find((v) => v.recommended) || list[0]).id;
      }
      const url = `${V.FABRIC_META}/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(lv)}/${encodeURIComponent(inst)}/server/jar`;
      await dl(url, path.join(dir, 'fabric-server.jar'), `Downloading Fabric ${lv} for ${mcVersion}`, progress);
      return { jar: 'fabric-server.jar', loaderVersion: lv };
    }
    case 'quilt': {
      let lv = loaderVersion;
      if (!lv) {
        const list = await V.listLoaderVersions('quilt', mcVersion);
        lv = (list.find((v) => v.recommended) || list[0] || {}).id;
        if (!lv) throw new Error(`No Quilt loader found for ${mcVersion}`);
      }
      const installers = await getJSON(`${V.QUILT_META}/versions/installer`);
      const inst = installers.find((i) => !/beta/i.test(i.version)) || installers[0];
      const jar = path.join(tmp || dir, `quilt-installer-${inst.version}.jar`);
      await dl(inst.url, jar, 'Downloading the Quilt installer', progress);
      progress({ step: `Installing Quilt ${lv} for ${mcVersion}`, pct: null });
      for (const f of ['quilt-server-launch.jar']) fs.rmSync(path.join(dir, f), { force: true });
      await runJava(java, ['-jar', jar, 'install', 'server', mcVersion, lv, '--download-server', `--install-dir=${dir}`], tmp || dir, progress, tmp);
      fs.rmSync(jar, { force: true });
      return { jar: 'quilt-server-launch.jar', loaderVersion: lv };
    }
    case 'forge':
    case 'neoforge': {
      let lv = loaderVersion;
      if (!lv) {
        const list = await V.listLoaderVersions(loader, mcVersion);
        if (!list.length) throw new Error(`No ${loader} versions found for ${mcVersion}`);
        lv = (list.find((v) => v.recommended) || list[0]).id;
      }
      const url = loader === 'forge'
        ? `${V.FORGE_MAVEN}/${lv}/forge-${lv}-installer.jar`
        : `${V.NEOFORGE_MAVEN}/${lv}/neoforge-${lv}-installer.jar`;
      const installer = path.join(dir, `${loader}-installer.jar`);
      await dl(url, installer, `Downloading ${loader === 'forge' ? 'Forge' : 'NeoForge'} ${lv} installer`, progress);
      progress({ step: `Installing ${loader === 'forge' ? 'Forge' : 'NeoForge'} (this downloads libraries, can take a few minutes)`, pct: null });
      await runJava(java, ['-jar', installer, '--installServer'], dir, progress, tmp);
      for (const f of [installer, installer + '.log', path.join(dir, `${loader}-installer.jar.log`), path.join(dir, 'installer.log')]) {
        await fs.promises.rm(f, { force: true });
      }
      return { loaderVersion: lv };
    }
    case 'bedrock':
      return installBedrock(dir, mcVersion, progress);
    default:
      throw new Error('Unknown server type ' + loader);
  }
}

/** Splits a command line into args, honouring double quotes. */
function splitArgs(s) {
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(s))) out.push(m[1] ?? m[2]);
  return out;
}

/** Works out how to start a Java server: returns the args that follow memory/JVM flags. */
function launchArgs(cfg, dir) {
  if (cfg.loader === 'forge' || cfg.loader === 'neoforge') {
    // The installer writes run.bat / run.sh with the exact launch line; reuse it.
    const script = path.join(dir, process.platform === 'win32' ? 'run.bat' : 'run.sh');
    if (fs.existsSync(script)) {
      const line = fs.readFileSync(script, 'utf8').split(/\r?\n/).find((l) => /^\s*"?java"?\s/i.test(l));
      if (line) {
        const args = splitArgs(line).slice(1).filter((a) => a !== '@user_jvm_args.txt' && a !== '%*' && a !== '"$@"' && a !== '$@' && a !== 'nogui');
        if (args.length) return [...args, 'nogui'];
      }
    }
    const jars = fs.readdirSync(dir).filter((f) => f.endsWith('.jar') && !/installer/i.test(f));
    const pick = jars.find((f) => /shim\.jar$/i.test(f)) ||
      jars.find((f) => /^(forge|neoforge)-.*\.jar$/i.test(f)) ||
      jars.find((f) => /^minecraftforge.*\.jar$/i.test(f));
    if (!pick) throw new Error('Could not find the Forge/NeoForge server launcher. Try reinstalling the server.');
    return ['-jar', pick, 'nogui'];
  }
  if (cfg.loader === 'velocity') return ['-jar', cfg.jar || 'velocity.jar'];
  return ['-jar', cfg.jar || 'server.jar', 'nogui'];
}

module.exports = { installServer, launchArgs, splitArgs, prepareVelocity };
