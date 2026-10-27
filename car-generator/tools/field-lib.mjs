// Readers for the game's city files (field/<region>/<region>_<A>_<B>.jmd and _tex.jmd, "J2m Data Format 1.0").
//
// A J2m file: 128 bytes of header (UTF-16 "J2m Data Format 1.0", "j2m & raycity fighting!!"), then an index that
// is XOR-scrambled with a 64-byte key (different in every file, keyed on the absolute file position mod 64; zero
// padding is left as is), then the data in the clear. The index of a _tex.jmd ends in a list of entries
// [UTF-16 name, 00 00][ASCII extension, 00][u32 0][u32 ?][u32 size] in the same order as the DDS pictures that
// follow. The key is recovered from the index itself: the names are UTF-16 (every odd byte 0, which gives the
// odd key bytes) and each entry carries "dds" and zeros (and, in a sector's file, the sector's name), which give
// the even ones.
//
// A sector's model (.jmd, data from 768) is a chunk stream (aa 47 · u16 type · u16 version · u16 sequence ·
// payload up to the next chunk in sequence). Chunk 0x415 holds the geometry: u16 node count; per node 112 bytes:
// a 3 × 4 matrix (row-major: x axis, y axis, z axis, each with its translation), the bounding box (6 floats),
// then u32 0, u32 1, u32 material (1-based, the 0x496 chunks in order), u32 0, u8 kind, u8 flags, 6 bytes,
// u16 vertex count, u32 first vertex, u16 index count, 2 bytes, u32 first index; then u32 vertex count and
// 40-byte vertices (position, 3 floats (normal or zero), uv, light-map uv), u32 index count and u16 indices
// (triangle lists, local to the node's first vertex). Each 0x496 chunk names its pictures in "aa 27" blocks
// (u16 id, u32 length, UTF-16 name) or points back at one named before ("bb 27", u16 id): the picture, and for
// lit pieces the baked light ("..._CompleteMap"); a 'property' block follows with the surface ("sidewalk", ...).

export function ddsSize(b, p) {
  const h = b.readUInt32LE(p + 12); const w = b.readUInt32LE(p + 16); const mips = Math.max(1, b.readUInt32LE(p + 28));
  const bs = b.toString('latin1', p + 84, p + 88) === 'DXT1' ? 8 : 16; let n = 0;
  for (let m = 0; m < mips; m++) n += Math.max(1, ((Math.max(1, w >> m) + 3) >> 2)) * Math.max(1, ((Math.max(1, h >> m) + 3) >> 2)) * bs;
  return 128 + n;
}
export function ddsList(b) {
  const out = []; let p = b.indexOf('DDS ', 768, 'latin1');
  while (p !== -1) { out.push(p); p = b.indexOf('DDS ', p + ddsSize(b, p), 'latin1'); }
  return out;
}
// one mip level of a DDS: { w, h, fourcc, data } (level clamped to keep at least 4 × 4)
export function ddsMip(b, p, want) {
  const h = b.readUInt32LE(p + 12); const w = b.readUInt32LE(p + 16); const mips = Math.max(1, b.readUInt32LE(p + 28));
  const cc = b.toString('latin1', p + 84, p + 88); const bs = cc === 'DXT1' ? 8 : 16;
  if (!['DXT1', 'DXT3', 'DXT5'].includes(cc)) return null;
  let o = p + 128; let lv = 0;
  const lvl = Math.min(want, mips - 1);
  for (; lv < lvl; lv++) { const mw = Math.max(1, w >> lv); const mh = Math.max(1, h >> lv); if (mw <= 4 || mh <= 4) break; o += Math.max(1, (mw + 3) >> 2) * Math.max(1, (mh + 3) >> 2) * bs; }
  const mw = Math.max(1, w >> lv); const mh = Math.max(1, h >> lv); const len = Math.max(1, (mw + 3) >> 2) * Math.max(1, (mh + 3) >> 2) * bs;
  return { w: mw, h: mh, fourcc: cc, data: b.subarray(o, o + len) };
}

export function texIndex(b, prefix) {
  const pos = ddsList(b); if (!pos.length) return [];
  let end = pos[0]; while (end > 768 && b[end - 1] === 0) end--;
  const start = Math.max(768, end - pos.length * 90);
  const K = new Uint8Array(64);
  const most = (m) => { let best = -1; let bk = 0; for (const [k, v] of m) if (v > best) { best = v; bk = k; } return bk; };
  { const cnt = Array.from({ length: 64 }, () => new Map()); for (let p = start | 1; p < end; p += 2) { const m = cnt[p % 64]; m.set(b[p], (m.get(b[p]) || 0) + 1); } for (let k = 1; k < 64; k += 2) if (cnt[k].size) K[k] = most(cnt[k]); }
  const crib = prefix ? Buffer.from(`${prefix}_`, 'utf16le') : null;
  const want = [[1, 0], [3, 0x64], [5, 0], [7, 0], [9, 0]]; const plain = Buffer.from([0, 0, 0x64, 0x64, 0x73, 0, 0, 0, 0, 0]);
  for (let round = 0; round < 3; round++) {
    const votes = Array.from({ length: 64 }, () => new Map()); const vote = (k, v, w) => votes[k].set(v, (votes[k].get(v) || 0) + w);
    const s0 = start - (start & 1);
    if (crib) for (let o = s0; o < end - crib.length; o += 2) {
      let ok = true; for (let j = 1; j < crib.length && ok; j += 2) ok = (b[o + j] ^ K[(o + j) % 64]) === 0;
      if (ok) for (let j = 0; j < crib.length; j += 2) vote((o + j) % 64, b[o + j] ^ crib[j], 1);
    }
    for (let o = s0; o < end - 10; o += 2) {
      let ok = true; for (const [j, v] of want) if ((b[o + j] ^ K[(o + j) % 64]) !== v) { ok = false; break; }
      if (ok) for (let j = 0; j < 10; j += 2) vote((o + j) % 64, b[o + j] ^ plain[j], 2);
    }
    for (let k = 0; k < 64; k++) if (votes[k].size) K[k] = most(votes[k]);
  }
  const dec = Buffer.alloc(end - start); for (let p = start; p < end; p++) dec[p - start] = b[p] ^ K[p % 64];
  // names are ASCII, some with Hangul syllables (U+AC00–D7A3: second byte AC–D7)
  const names = []; const re = /((?:[\x20-\x7e]\x00|[\x00-\xff][\xac-\xd7]){3,})\x00\x00dds\x00/g; const s = dec.toString('latin1'); let m;
  while ((m = re.exec(s))) names.push(Buffer.from(m[1], 'latin1').toString('utf16le').toLowerCase());
  return names.length === pos.length ? names.map((n, i) => ({ name: n, pos: pos[i] })) : null;
}

// the chunk stream of a model (or any scene-style file) from a start offset
export function chunks(b, start = 0) {
  const out = []; let o = b.indexOf(Buffer.from([0xaa, 0x47]), start);
  while (o !== -1 && o + 8 <= b.length) {
    const t = b.readUInt16LE(o + 2); const s = b.readUInt16LE(o + 6); const want = (s + 1) & 0xffff; let n = o + 8;
    for (;;) { n = b.indexOf(Buffer.from([0xaa, 0x47]), n); if (n === -1 || n + 8 > b.length) { n = b.length; break; } if (b.readUInt16LE(n + 6) === want) break; n++; }
    out.push({ at: o, type: t, seq: s, len: n - o }); o = n < b.length ? n : -1;
  }
  return out;
}
// the picture names in a chunk, in order: "aa 27" blocks name a picture (u16 id, u32 length, UTF-16 name) and
// "bb 27" blocks point back at one named earlier in the file (u16 id); 'property' and other blocks left out
export function chunkNames(b, at, len, ids = new Map()) {
  const out = []; let j = at;
  while (j + 4 <= at + len) {
    if (b[j + 1] === 0x27 && (b[j] === 0xaa || b[j] === 0xbb)) {
      const id = b.readUInt16LE(j + 2);
      if (b[j] === 0xbb) { if (ids.has(id)) out.push(ids.get(id)); j += 4; continue; }
      const n = j + 8 <= at + len ? b.readUInt32LE(j + 4) : 0;
      if (n > 0 && n < 100 && j + 8 + 2 * n <= at + len) {
        const s = b.toString('utf16le', j + 8, j + 8 + 2 * n);
        if (/^[\x20-\x7e]+$/.test(s)) { if (s !== 'property') { ids.set(id, s); out.push(s); } j += 8 + 2 * n; continue; }
      }
    }
    j++;
  }
  return out;
}

export function parseSector(b) {
  const cs = chunks(b, 768);
  const ids = new Map(); const mats = cs.filter((c) => c.type === 0x496).map((c) => chunkNames(b, c.at, c.len, ids));
  const g = cs.find((c) => c.type === 0x415); if (!g) return { mats, nodes: [], verts: null, indices: null };
  const cnt = b.readUInt16LE(g.at + 8); const nodes = []; let o = g.at + 10;
  for (let i = 0; i < cnt; i++, o += 112) {
    const m = []; for (let k = 0; k < 12; k++) m.push(b.readFloatLE(o + k * 4));
    const t = o + 72;
    nodes.push({ m, mat: b.readUInt32LE(t + 8), kind: b[t + 16], flags: b[t + 17], vc: b.readUInt16LE(t + 26), vs: b.readUInt32LE(t + 28), ic: b.readUInt16LE(t + 32), is: b.readUInt32LE(t + 36) });
  }
  const nv = b.readUInt32LE(o); const vb = o + 4; const ni = b.readUInt32LE(vb + nv * 40); const ib = vb + nv * 40 + 4;
  return { mats, nodes, nv, vb, ni, ib };
}
