// Pictures in the game folder, for the extract-*.mjs tools: DDS (DXT1/3/5) and TGA (true colour, plain or RLE)
// read to RGBA, and RGBA / RGB / grey written back out as PNG.
import zlib from 'node:zlib';

export function dds(b) {
  const h = b.readUInt32LE(12); const w = b.readUInt32LE(16); const cc = b.toString('latin1', 84, 88);
  const bs = cc === 'DXT1' ? 8 : 16; const out = Buffer.alloc(w * h * 4); let o = 128; const dxt5 = cc === 'DXT5';
  const c565 = (c) => [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31];
  for (let by = 0; by < h; by += 4) for (let bx = 0; bx < w; bx += 4, o += bs) {
    const cb = o + (bs === 16 ? 8 : 0); const a = b.readUInt16LE(cb); const c = b.readUInt16LE(cb + 2);
    const p0 = c565(a); const p1 = c565(c); const pal = [p0, p1];
    if (a > c || bs === 16) { pal.push(p0.map((v, i) => (2 * v + p1[i]) / 3), p0.map((v, i) => (v + 2 * p1[i]) / 3)); } else { pal.push(p0.map((v, i) => (v + p1[i]) / 2), [0, 0, 0]); }
    const bits = b.readUInt32LE(cb + 4);
    for (let i = 0; i < 16; i++) {
      const x = bx + (i & 3); const y = by + (i >> 2); if (x >= w || y >= h) continue; const q = (y * w + x) * 4; const k = (bits >> (2 * i)) & 3;
      out[q] = pal[k][0]; out[q + 1] = pal[k][1]; out[q + 2] = pal[k][2];
      if (dxt5) {
        const a0 = b[o]; const a1 = b[o + 1]; const bitsA = b.readUIntLE(o + 2, 6); const ka = Math.floor(bitsA / 2 ** (3 * i)) & 7;
        const al = ka === 0 ? a0 : ka === 1 ? a1 : a0 > a1 ? ((8 - ka) * a0 + (ka - 1) * a1) / 7 : ka === 6 ? 0 : ka === 7 ? 255 : ((6 - ka) * a0 + (ka - 1) * a1) / 5;
        out[q + 3] = al;
      } else out[q + 3] = bs === 16 ? ((b[o + (i >> 1)] >> ((i & 1) * 4)) & 15) * 17 : (a <= c && k === 3 ? 0 : 255);
    }
  }
  return { w, h, data: out };
}
export function png(w, h, ch, data) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  // every row Paeth-filtered (type 4): far smaller for pictures than unfiltered rows
  const raw = Buffer.alloc((w * ch + 1) * h); const rs = w * ch;
  const paeth = (a, b, c) => { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < h; y++) {
    raw[y * (rs + 1)] = 4;
    for (let x = 0; x < rs; x++) {
      const i = y * rs + x; const a = x >= ch ? data[i - ch] : 0; const b = y ? data[i - rs] : 0; const c = x >= ch && y ? data[i - rs - ch] : 0;
      raw[y * (rs + 1) + 1 + x] = (data[i] - paeth(a, b, c)) & 255;
    }
  }
  const hd = Buffer.alloc(13); hd.writeUInt32BE(w, 0); hd.writeUInt32BE(h, 4); hd[8] = 8; hd[9] = { 1: 0, 3: 2, 4: 6 }[ch];
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', hd), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// TGA: types 2 / 3 (plain true colour / grey) and 10 / 11 (run-length), 8 / 24 / 32 bits; rows from the bottom
// unless bit 5 of the descriptor says top
export function tga(b) {
  const id = b[0]; const type = b[2]; const w = b.readUInt16LE(12); const h = b.readUInt16LE(14); const bpp = b[16]; const top = b[17] & 32;
  const cmap = b[1] ? b.readUInt16LE(5) * Math.ceil(b[7] / 8) : 0; let o = 18 + id + cmap; const px = bpp / 8;
  if (![2, 3, 10, 11].includes(type) || ![1, 3, 4].includes(px)) throw new Error(`tga type ${type}, ${bpp} bits`);
  const src = Buffer.alloc(w * h * px);
  if (type < 9) b.copy(src, 0, o, o + src.length);
  else for (let n = 0; n < w * h;) {
    const c = b[o++]; const k = (c & 127) + 1;
    if (c & 128) { for (let i = 0; i < k; i++) b.copy(src, (n + i) * px, o, o + px); o += px; } else { b.copy(src, n * px, o, o + k * px); o += k * px; }
    n += k;
  }
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (y * w + x) * px; const q = ((top ? y : h - 1 - y) * w + x) * 4;
    if (px === 1) { out[q] = out[q + 1] = out[q + 2] = src[s]; out[q + 3] = 255; } else { out[q] = src[s + 2]; out[q + 1] = src[s + 1]; out[q + 2] = src[s]; out[q + 3] = px === 4 ? src[s + 3] : 255; }
  }
  return { w, h, data: out };
}
