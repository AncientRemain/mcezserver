// Minimal Minecraft Server List Ping, used to read live player counts from any server type.
const net = require('net');

function varint(n) {
  const bytes = [];
  n >>>= 0;
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    bytes.push(b);
  } while (n);
  return Buffer.from(bytes);
}

function readVarint(buf, offset) {
  let value = 0;
  let size = 0;
  for (;;) {
    if (offset + size >= buf.length) return null;
    const b = buf[offset + size];
    value |= (b & 0x7f) << (7 * size);
    size++;
    if (!(b & 0x80)) return { value, size };
    if (size > 5) throw new Error('VarInt too big');
  }
}

function packet(id, payload) {
  const body = Buffer.concat([varint(id), payload]);
  return Buffer.concat([varint(body.length), body]);
}

function mcString(s) {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([varint(b.length), b]);
}

function ping(host = '127.0.0.1', port = 25565, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    let buf = Buffer.alloc(0);
    const t0 = Date.now();
    const done = (err, val) => {
      socket.destroy();
      clearTimeout(timer);
      err ? reject(err) : resolve(val);
    };
    const timer = setTimeout(() => done(new Error('timeout')), timeout);
    socket.on('error', (e) => done(e));
    socket.on('connect', () => {
      const portBuf = Buffer.alloc(2);
      portBuf.writeUInt16BE(port);
      socket.write(packet(0, Buffer.concat([varint(767), mcString(host), portBuf, varint(1)])));
      socket.write(packet(0, Buffer.alloc(0)));
    });
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      try {
        const len = readVarint(buf, 0);
        if (!len || buf.length < len.size + len.value) return;
        let off = len.size;
        const id = readVarint(buf, off); off += id.size;
        const slen = readVarint(buf, off); off += slen.size;
        const json = JSON.parse(buf.slice(off, off + slen.value).toString('utf8'));
        json.latency = Date.now() - t0;
        done(null, json);
      } catch (e) {
        done(e);
      }
    });
  });
}

/** Turns a chat component (or legacy string) MOTD into plain text. */
function flattenText(c) {
  if (c == null) return '';
  if (typeof c === 'string') return c.replace(/§./g, '');
  let s = c.text || '';
  if (Array.isArray(c.extra)) s += c.extra.map(flattenText).join('');
  return s.replace(/§./g, '');
}

module.exports = { ping, flattenText };
