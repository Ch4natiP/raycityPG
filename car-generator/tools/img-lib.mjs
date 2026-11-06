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

// RGBA written back into a DDS of the same kind: `like` is the original file (its 128-byte header kept: size, DXT1 /
// DXT3 / DXT5, mip count), every mip level made from the picture by halving (alpha averaged; DXT1 keeps it as
// 1-bit: under 128 transparent). Block endpoints: the two colours of the block farthest apart.
export function ddsLike(like, w, h, rgba) {
  const cc = like.toString('latin1', 84, 88); const mips = Math.max(1, like.readUInt32LE(28)); const bs = cc === 'DXT1' ? 8 : 16;
  const parts = [like.subarray(0, 128)]; let cur = Buffer.from(rgba); let cw = w; let ch = h;
  for (let lv = 0; lv < mips; lv++) {
    parts.push(encodeDXT(cc, cur, cw, ch, bs));
    if (cw === 1 && ch === 1) { for (let k = lv + 1; k < mips; k++) parts.push(encodeDXT(cc, cur, 1, 1, bs)); break; }
    const nw = Math.max(1, cw >> 1); const nh = Math.max(1, ch >> 1); const nx = Buffer.alloc(nw * nh * 4);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) for (let k = 0; k < 4; k++) {
      let s = 0; let n = 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const X = Math.min(cw - 1, x * 2 + dx); const Y = Math.min(ch - 1, y * 2 + dy); s += cur[(Y * cw + X) * 4 + k]; n++; }
      nx[(y * nw + x) * 4 + k] = s / n;
    }
    cur = nx; cw = nw; ch = nh;
  }
  return Buffer.concat(parts);
}
// a DDS made with ddsLike where only a rectangle of the picture changed (x, y, w, h at full size): every block outside
// it, on every mip level, taken back from the original bit for bit (halving maps a level's pixel onto 2 × 2 of the
// level above, so the change stays inside the rectangle scaled down)
export function ddsKeep(like, made, r) {
  const out = Buffer.from(made); const bs = like.toString('latin1', 84, 88) === 'DXT1' ? 8 : 16;
  let w = like.readUInt32LE(16); let h = like.readUInt32LE(12); const mips = Math.max(1, like.readUInt32LE(28)); let o = 128;
  for (let lv = 0; lv < mips; lv++) {
    const bw = Math.max(1, (w + 3) >> 2); const bh = Math.max(1, (h + 3) >> 2); const f = 4 * 2 ** lv;
    const x0 = Math.floor(r.x / f); const x1 = Math.ceil((r.x + r.w) / f); const y0 = Math.floor(r.y / f); const y1 = Math.ceil((r.y + r.h) / f);
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      if (bx >= x0 && bx < x1 && by >= y0 && by < y1) continue;
      const p = o + (by * bw + bx) * bs; like.copy(out, p, p, p + bs);
    }
    o += bw * bh * bs; w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
  }
  return out;
}
function encodeDXT(cc, px, w, h, bs) {
  const bw = Math.max(1, (w + 3) >> 2); const bh = Math.max(1, (h + 3) >> 2); const out = Buffer.alloc(bw * bh * bs); let o = 0;
  const to565 = (c) => ((Math.round(c[0]) >> 3) << 11) | ((Math.round(c[1]) >> 2) << 5) | (Math.round(c[2]) >> 3);
  const from565 = (c) => [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31];
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++, o += bs) {
    const blk = [];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const i = (Math.min(h - 1, by * 4 + y) * w + Math.min(w - 1, bx * 4 + x)) * 4; blk.push([px[i], px[i + 1], px[i + 2], px[i + 3]]); }
    const cut = cc === 'DXT1' && blk.some((c) => c[3] < 128); // DXT1's 3-colour mode: index 3 transparent
    const lum = (c) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
    const solid = blk.filter((c) => !cut || c[3] >= 128); let hi = solid[0] || blk[0]; let lo = hi; let far = -1;
    // endpoints: the two colours of the block farthest apart (a blue / white / yellow sign keeps its colours), brighter first
    for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i]; const c = solid[j]; const d = (a[0] - c[0]) ** 2 + (a[1] - c[1]) ** 2 + (a[2] - c[2]) ** 2;
      if (d > far) { far = d; [hi, lo] = lum(a) >= lum(c) ? [a, c] : [c, a]; }
    }
    let c0 = to565(hi); let c1 = to565(lo);
    if (cut ? c0 > c1 : c0 < c1) [c0, c1] = [c1, c0];
    if (!cut && c0 === c1) { if (c0 < 0xffff) c0++; else c1--; }
    const e0 = from565(c0); const e1 = from565(c1);
    const pal = cut ? [e0, e1, e0.map((v, k) => (v + e1[k]) / 2)] : [e0, e1, e0.map((v, k) => (2 * v + e1[k]) / 3), e0.map((v, k) => (v + 2 * e1[k]) / 3)];
    let bits = 0;
    blk.forEach((c, i) => {
      let k = 0;
      if (cut && c[3] < 128) k = 3;
      else { let bd = Infinity; pal.forEach((p, j) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; k = j; } }); }
      bits |= k << (2 * i);
    });
    const co = bs === 16 ? o + 8 : o;
    out.writeUInt16LE(c0, co); out.writeUInt16LE(c1, co + 2); out.writeUInt32LE(bits >>> 0, co + 4);
    if (cc === 'DXT3') for (let i = 0; i < 16; i += 2) out[o + i / 2] = (blk[i][3] >> 4) | ((blk[i + 1][3] >> 4) << 4);
    if (cc === 'DXT5') {
      let a0 = 0; let a1 = 255; for (const c of blk) { a0 = Math.max(a0, c[3]); a1 = Math.min(a1, c[3]); }
      if (a0 === a1) { a0 = Math.min(255, a0 + 1); if (a0 === a1) a1 = a0 - 1; }
      out[o] = a0; out[o + 1] = a1; let ab = 0n;
      blk.forEach((c, i) => {
        // a0 > a1: 8 steps from a0 (index 0) to a1 (index 1)
        const t = (a0 - c[3]) / (a0 - a1); const s = Math.max(0, Math.min(7, Math.round(t * 7))); const k = s === 0 ? 0 : s === 7 ? 1 : s + 1;
        ab |= BigInt(k) << BigInt(3 * i);
      });
      for (let i = 0; i < 6; i++) out[o + 2 + i] = Number((ab >> BigInt(8 * i)) & 0xffn);
    }
  }
  return out;
}
