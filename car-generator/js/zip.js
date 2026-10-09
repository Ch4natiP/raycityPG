// Minimal .zip writer for downloading a whole car folder from the page.
// Files are deflated with the browser's CompressionStream when it has one, else stored.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflate(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const out = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
    return new Uint8Array(out);
  } catch {
    return null;
  }
}

// files: [{ path: 'car/hood/list.xml', data: Uint8Array }] → Blob (application/zip)
export async function makeZip(files) {
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.path);
    const crc = crc32(f.data);
    const packed = await deflate(f.data);
    const useDeflate = packed && packed.length < f.data.length;
    const body = useDeflate ? packed : f.data;
    const header = (sig, extra) => {
      const h = new DataView(new ArrayBuffer(extra));
      h.setUint32(0, sig, true);
      return h;
    };
    const local = header(0x04034b50, 30);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, useDeflate ? 8 : 0, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(local.buffer, name, body);
    const cen = header(0x02014b50, 46);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, useDeflate ? 8 : 0, true);
    cen.setUint16(12, time, true);
    cen.setUint16(14, date, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, body.length, true);
    cen.setUint32(24, f.data.length, true);
    cen.setUint16(28, name.length, true);
    cen.setUint32(42, offset, true);
    central.push(cen.buffer, name);
    offset += 30 + name.length + body.length;
  }
  const cenSize = central.reduce((s, c) => s + c.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cenSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, end.buffer], { type: 'application/zip' });
}

// .zip reader: [{ path, data: Uint8Array }] (stored or deflated entries; folders skipped).
export async function readZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('ไฟล์ .zip เสีย (ไม่เจอสารบัญ)');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true); const extraLen = dv.getUint16(p + 30, true); const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const path = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen)).replace(/\\/g, '/');
    p += 46 + nameLen + extraLen + commentLen;
    if (path.endsWith('/')) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + csize);
    let data;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    else continue; // other compression methods: not supported
    out.push({ path, data });
  }
  return out;
}
