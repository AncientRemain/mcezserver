// Reads and writes server.properties while keeping comments and key order intact.
const fs = require('fs');

function unescape(v) {
  return v.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, c) => {
    if (c[0] === 'u' && c.length === 5) return String.fromCharCode(parseInt(c.slice(1), 16));
    return { n: '\n', t: '\t', r: '\r' }[c] ?? c;
  });
}

function escape(v) {
  return String(v)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/[^\x20-\x7e]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
}

function parse(text) {
  const lines = text.split(/\r?\n/);
  const values = {};
  for (const line of lines) {
    if (!line.trim() || /^\s*[#!]/.test(line)) continue;
    const m = line.match(/^\s*([^=:\s]+)\s*[=:]?\s*(.*)$/);
    if (m) values[m[1]] = unescape(m[2]);
  }
  return { lines, values };
}

function read(file) {
  if (!fs.existsSync(file)) return {};
  return parse(fs.readFileSync(file, 'utf8')).values;
}

/** Merges `patch` into the file; keys set to null are removed. */
function write(file, patch) {
  const { lines } = fs.existsSync(file) ? parse(fs.readFileSync(file, 'utf8')) : { lines: [] };
  const remaining = { ...patch };
  const out = [];
  for (const line of lines) {
    const m = line.match(/^\s*([^=:\s#!]+)\s*[=:]/);
    if (m && m[1] in remaining) {
      const v = remaining[m[1]];
      delete remaining[m[1]];
      if (v !== null && v !== undefined) out.push(`${m[1]}=${escape(v)}`);
    } else out.push(line);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  for (const [k, v] of Object.entries(remaining)) if (v !== null && v !== undefined) out.push(`${k}=${escape(v)}`);
  fs.writeFileSync(file, out.join('\n') + '\n', 'utf8');
}

module.exports = { read, write, parse };
