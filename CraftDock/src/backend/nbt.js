// Minimal NBT reader/writer for level.dat (Java: big-endian + gzip, Bedrock: little-endian with an 8-byte header).
// Tags are { type, value }; compounds hold a Map of name -> tag so key order survives a round trip.
const zlib = require('zlib');

const TAG = { END: 0, BYTE: 1, SHORT: 2, INT: 3, LONG: 4, FLOAT: 5, DOUBLE: 6, BYTE_ARRAY: 7, STRING: 8, LIST: 9, COMPOUND: 10, INT_ARRAY: 11, LONG_ARRAY: 12 };

class Reader {
  constructor(buf, le) { this.b = buf; this.o = 0; this.le = le; }
  u8() { return this.b.readUInt8(this.o++); }
  i8() { return this.b.readInt8(this.o++); }
  i16() { const v = this.le ? this.b.readInt16LE(this.o) : this.b.readInt16BE(this.o); this.o += 2; return v; }
  u16() { const v = this.le ? this.b.readUInt16LE(this.o) : this.b.readUInt16BE(this.o); this.o += 2; return v; }
  i32() { const v = this.le ? this.b.readInt32LE(this.o) : this.b.readInt32BE(this.o); this.o += 4; return v; }
  i64() { const v = this.le ? this.b.readBigInt64LE(this.o) : this.b.readBigInt64BE(this.o); this.o += 8; return v; }
  f32() { const v = this.le ? this.b.readFloatLE(this.o) : this.b.readFloatBE(this.o); this.o += 4; return v; }
  f64() { const v = this.le ? this.b.readDoubleLE(this.o) : this.b.readDoubleBE(this.o); this.o += 8; return v; }
  str() { const n = this.u16(); const s = this.b.toString('utf8', this.o, this.o + n); this.o += n; return s; }
  payload(type) {
    switch (type) {
      case TAG.BYTE: return this.i8();
      case TAG.SHORT: return this.i16();
      case TAG.INT: return this.i32();
      case TAG.LONG: return this.i64();
      case TAG.FLOAT: return this.f32();
      case TAG.DOUBLE: return this.f64();
      case TAG.BYTE_ARRAY: { const n = this.i32(); const v = Buffer.from(this.b.subarray(this.o, this.o + n)); this.o += n; return v; }
      case TAG.STRING: return this.str();
      case TAG.LIST: {
        const of = this.u8(); const n = this.i32(); const items = [];
        for (let i = 0; i < n; i++) items.push(this.payload(of));
        return { of, items };
      }
      case TAG.COMPOUND: {
        const m = new Map();
        for (;;) {
          const t = this.u8();
          if (t === TAG.END) break;
          const name = this.str();
          m.set(name, { type: t, value: this.payload(t) });
        }
        return m;
      }
      case TAG.INT_ARRAY: { const n = this.i32(); const a = []; for (let i = 0; i < n; i++) a.push(this.i32()); return a; }
      case TAG.LONG_ARRAY: { const n = this.i32(); const a = []; for (let i = 0; i < n; i++) a.push(this.i64()); return a; }
      default: throw new Error(`Bad NBT tag type ${type}`);
    }
  }
  root() {
    const t = this.u8();
    if (t !== TAG.COMPOUND) throw new Error('NBT root is not a compound');
    const name = this.str();
    return { name, tag: { type: t, value: this.payload(t) } };
  }
}

class Writer {
  constructor(le) { this.parts = []; this.le = le; }
  push(size, fn) { const b = Buffer.alloc(size); fn(b); this.parts.push(b); }
  u8(v) { this.push(1, (b) => b.writeUInt8(v)); }
  i8(v) { this.push(1, (b) => b.writeInt8(v)); }
  i16(v) { this.push(2, (b) => (this.le ? b.writeInt16LE(v) : b.writeInt16BE(v))); }
  u16(v) { this.push(2, (b) => (this.le ? b.writeUInt16LE(v) : b.writeUInt16BE(v))); }
  i32(v) { this.push(4, (b) => (this.le ? b.writeInt32LE(v) : b.writeInt32BE(v))); }
  i64(v) { this.push(8, (b) => (this.le ? b.writeBigInt64LE(BigInt(v)) : b.writeBigInt64BE(BigInt(v)))); }
  f32(v) { this.push(4, (b) => (this.le ? b.writeFloatLE(v) : b.writeFloatBE(v))); }
  f64(v) { this.push(8, (b) => (this.le ? b.writeDoubleLE(v) : b.writeDoubleBE(v))); }
  str(s) { const b = Buffer.from(String(s), 'utf8'); this.u16(b.length); this.parts.push(b); }
  payload(type, v) {
    switch (type) {
      case TAG.BYTE: return this.i8(v);
      case TAG.SHORT: return this.i16(v);
      case TAG.INT: return this.i32(v);
      case TAG.LONG: return this.i64(v);
      case TAG.FLOAT: return this.f32(v);
      case TAG.DOUBLE: return this.f64(v);
      case TAG.BYTE_ARRAY: this.i32(v.length); this.parts.push(Buffer.from(v)); return undefined;
      case TAG.STRING: return this.str(v);
      case TAG.LIST: this.u8(v.items.length ? v.of : (v.of || TAG.END)); this.i32(v.items.length); v.items.forEach((x) => this.payload(v.of, x)); return undefined;
      case TAG.COMPOUND:
        for (const [name, t] of v) { this.u8(t.type); this.str(name); this.payload(t.type, t.value); }
        return this.u8(TAG.END);
      case TAG.INT_ARRAY: this.i32(v.length); v.forEach((x) => this.i32(x)); return undefined;
      case TAG.LONG_ARRAY: this.i32(v.length); v.forEach((x) => this.i64(x)); return undefined;
      default: throw new Error(`Bad NBT tag type ${type}`);
    }
  }
  buffer() { return Buffer.concat(this.parts); }
}

/** Reads a Java level.dat (gzip) or Bedrock level.dat (8-byte header, little-endian). */
function readLevelDat(buf) {
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    const r = new Reader(zlib.gunzipSync(buf), false).root();
    return { edition: 'java', ...r };
  }
  // Bedrock: int32 storage version, int32 length, then the NBT
  const bedrock = buf.length > 8 && buf.readInt32LE(4) === buf.length - 8;
  if (!bedrock) return { edition: 'java', ...new Reader(buf, false).root() };
  const header = buf.readInt32LE(0);
  const r = new Reader(buf.subarray(8), true).root();
  return { edition: 'bedrock', header, ...r };
}

function writeLevelDat(dat) {
  if (dat.edition === 'bedrock') {
    const w = new Writer(true);
    w.u8(TAG.COMPOUND); w.str(dat.name); w.payload(TAG.COMPOUND, dat.tag.value);
    const body = w.buffer();
    const head = Buffer.alloc(8);
    head.writeInt32LE(dat.header || 10, 0);
    head.writeInt32LE(body.length, 4);
    return Buffer.concat([head, body]);
  }
  const w = new Writer(false);
  w.u8(TAG.COMPOUND); w.str(dat.name); w.payload(TAG.COMPOUND, dat.tag.value);
  return zlib.gzipSync(w.buffer());
}

/** Follows a path of compound keys, e.g. get(root, 'Data', 'Version', 'Name'). Returns the tag or undefined. */
function get(tag, ...keys) {
  let cur = tag;
  for (const k of keys) {
    if (!cur || cur.type !== TAG.COMPOUND) return undefined;
    cur = cur.value.get(k);
  }
  return cur;
}
const val = (tag, ...keys) => { const t = get(tag, ...keys); return t ? t.value : undefined; };

module.exports = { TAG, readLevelDat, writeLevelDat, get, val };
