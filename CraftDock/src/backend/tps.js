// Ticks per second: which console command reports it for each server type, and how to read the answer.
const T = require('./types');
const { compareVersions } = require('./versions');

/** True for Minecraft 1.20.3+ (and year-based / snapshot ids), which have the vanilla `tick query` command. */
function hasTickQuery(mc) {
  if (!mc) return false;
  if (!/^1\./.test(mc)) return true;
  return compareVersions(mc.replace(/-.*$/, ''), '1.20.3') >= 0;
}

/** The commands to send, or null when this server type can't report TPS. */
function tpsCommands(cfg) {
  const t = T.type(cfg.loader);
  if (t.proxy || t.bedrock) return null;
  if (t.tps === 'bukkit') return cfg.loader === 'spigot' || cfg.loader === 'folia' || t.hybrid ? ['tps'] : ['tps', 'mspt'];
  if (hasTickQuery(cfg.mcVersion)) return ['tick query'];
  if (cfg.loader === 'forge') return ['forge tps'];
  if (cfg.loader === 'neoforge') return ['neoforge tps'];
  return null;
}

const ANSI = /\x1b\[[0-9;]*[A-Za-z]|§./g;

// Lines that belong to a TPS answer (hidden from the console while CraftDock is asking).
const ANSWER = [
  /TPS from last/i, /Server tick times/i, /[\d.]+\/[\d.]+\/[\d.]+,\s*[\d.]+\/[\d.]+\/[\d.]+/, /The game is running normally|The game is (?:frozen|sprinting|stepping)|Game is running/i,
  /Target tick rate/i, /Average time per tick/i, /Percentiles:?/i, /Mean tick time/i, /Mean TPS/i, /Overall\s*:/i,
  /^\s*(?:Dim|minecraft:|\S+:\S+)\s.*(?:tick time|TPS)/i, /Current Server TPS/i, /Server Health Report/i,
  /^\s*-\s.*(?:regions?:|Utilisation|Load rate|Region TPS|Online Players|Gen rate)/i, /Highest \d+ utilisation regions/i,
];
const isAnswerLine = (line) => { const l = line.replace(ANSI, ''); return ANSWER.some((re) => re.test(l)); };

/** Reads { tps, mspt } from the captured answer lines. */
function parseTps(lines) {
  const text = lines.map((l) => l.replace(ANSI, '')).join('\n');
  let tps = null, mspt = null, m;
  // Paper: "TPS from last 1m, 5m, 15m: 20.0, ..."; Purpur adds a 5s column first
  if ((m = text.match(/TPS from last [^:\n]+:\s*\*?([\d.]+)/i))) tps = parseFloat(m[1]);
  // Paper `mspt`: "Server tick times (avg/min/max) from last 5s, 10s, 1m:" then "◴ 1.2/0.8/3.5, ..." on the next line
  const ti = text.search(/Server tick times/i);
  if (ti >= 0 && (m = text.slice(ti).split('\n').slice(1).join('\n').match(/(\d+(?:\.\d+)?)\/\d+(?:\.\d+)?\/\d+(?:\.\d+)?/))) mspt = parseFloat(m[1]);
  if ((m = text.match(/Average time per tick:\s*([\d.]+)\s*ms/i))) mspt = parseFloat(m[1]);
  if ((m = text.match(/Target tick rate:\s*([\d.]+)/i)) && mspt != null) tps = Math.min(parseFloat(m[1]), 1000 / Math.max(mspt, 0.0001));
  else if (mspt != null && tps == null) tps = Math.min(20, 1000 / Math.max(mspt, 0.0001));
  if ((m = text.match(/Overall\s*:\s*Mean tick time:\s*([\d.]+)\s*ms\.\s*Mean TPS:\s*([\d.]+)/i))) { mspt = parseFloat(m[1]); tps = parseFloat(m[2]); }
  if ((m = text.match(/Overall\s*:\s*([\d.]+)\s*TPS\s*\(([\d.]+)\s*ms/i))) { tps = parseFloat(m[1]); mspt = parseFloat(m[2]); }
  if (tps == null && (m = text.match(/TPS[^\d\n]{0,12}([\d.]+)/i))) tps = parseFloat(m[1]);
  if (tps != null && !Number.isFinite(tps)) tps = null;
  return { tps: tps != null ? Math.round(tps * 100) / 100 : null, mspt: mspt != null ? Math.round(mspt * 100) / 100 : null };
}

module.exports = { tpsCommands, isAnswerLine, parseTps, hasTickQuery };
