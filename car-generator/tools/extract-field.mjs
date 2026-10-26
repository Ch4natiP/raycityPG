// The game's real city for RayCity Drive: every sector of a region (field/<region>/<region>_<A>_<B>.jmd and its
// _tex.jmd, see tools/field-lib.mjs) as a small file the page streams in as the car comes near.
//   node tools/extract-field.mjs "<field folder>" kr [out folder, default ./city] [mip level, default 2]
// Writes <out>/<region>/index.json (the sectors), lib.bin (the shared pictures the region uses, from the
// common_* folders) and one <A>_<B>.bin per sector, all gzip:
//   'RCS1', u32 JSON length, JSON { A, B, x0, y0, mats: [{ tex, light, cut }], meshes: [{ mat, nv, ni, wide }],
//   pics: [{ name, w, h, fmt, at, len }] }, then per mesh: i16 x, y, z (metres × 50 from the sector's corner),
//   f16 u, v, u16 light u, v (× 65535), indices (u32 if wide, else u16); then the pictures (DXT blocks of one
//   mip level: the game's pictures at 1/4 size by default).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { texIndex, parseSector, ddsList, ddsMip } from './field-lib.mjs';

const [field, region, outArg, mipArg] = process.argv.slice(2);
if (!field || !region) { console.error('usage: node tools/extract-field.mjs <field folder> <region> [out] [mip]'); process.exit(1); }
const out = path.join(outArg || 'city', region); fs.mkdirSync(out, { recursive: true });
const MIP = mipArg ? +mipArg : 2;
const S = 50; // position units per metre

const f16 = (() => { const f = new Float32Array(1); const u = new Uint32Array(f.buffer); return (v) => {
  f[0] = v; const x = u[0]; const s = (x >>> 16) & 0x8000; let e = ((x >>> 23) & 0xff) - 127 + 15; let m = x & 0x7fffff;
  if (e <= 0) return s; if (e >= 31) return s | 0x7c00; return s | (e << 10) | (m >> 13);
}; })();

// --- the shared pictures: loose .dds in common_* folders and the J2m tex.jmd there
const lib = new Map(); // name → { file, pos }
for (const c of fs.readdirSync(field).filter((x) => x.startsWith('common')).sort()) {
  for (const f of fs.readdirSync(path.join(field, c))) {
    const p = path.join(field, c, f);
    if (/\.dds$/i.test(f)) { const n = f.slice(0, -4).toLowerCase(); if (!lib.has(n)) lib.set(n, { file: p, pos: 0 }); }
    else if (f === 'tex.jmd') {
      const b = fs.readFileSync(p); if (!b.toString('utf16le', 0, 6).startsWith('J2m')) continue; // (NEKO ones stay closed)
      const idx = texIndex(b, null); if (!idx) { console.warn(`names not read: ${p}`); continue; }
      for (const e of idx) if (!lib.has(e.name)) lib.set(e.name, { file: p, pos: e.pos });
    }
  }
}
console.log(`shared pictures: ${lib.size}`);
const fileCache = new Map(); const readCached = (f) => { if (!fileCache.has(f)) { if (fileCache.size > 8) fileCache.clear(); fileCache.set(f, fs.readFileSync(f)); } return fileCache.get(f); };

const dir = path.join(field, region); const used = new Set(); const sectors = []; let missingPics = 0; let total = 0;
for (const f of fs.readdirSync(dir).sort()) {
  const m = new RegExp(`^${region}_(\\d{4})_(\\d{4})\\.jmd$`, 'i').exec(f); if (!m) continue;
  const A = +m[1]; const B = +m[2]; const x0 = (A - 1000) * 512; const y0 = (B - 1000) * 512;
  const b = fs.readFileSync(path.join(dir, f)); const sec = parseSector(b);
  if (!sec.nodes.length) continue;
  // the sector's own pictures
  const own = new Map(); const tf = path.join(dir, f.replace(/\.jmd$/i, '_tex.jmd'));
  let tb = null;
  if (fs.existsSync(tf)) {
    tb = fs.readFileSync(tf); let idx = texIndex(tb, `${region}_${m[1]}_${m[2]}`);
    if (!idx) { // few names: the sector's own picture names, sorted, when as many as the pictures
      const pos = ddsList(tb); const names = [...new Set(sec.mats.flat().map((n) => n.toLowerCase()).filter((n) => n.startsWith(`${region}_${m[1]}_${m[2]}_`)))].sort();
      if (names.length === pos.length) idx = names.map((n, i) => ({ name: n, pos: pos[i] }));
    }
    if (idx) for (const e of idx) own.set(e.name, e.pos);
  }
  // materials: picture, baked light, cut-out (names with @ or $ use alpha)
  const mats = sec.mats.map((names) => {
    const ln = names.map((n) => n.toLowerCase()); const light = ln.find((n) => n.endsWith('_completemap')) || null; const tex = ln.find((n) => !n.endsWith('_completemap')) || null;
    return { tex, light, cut: !!tex && /[@$]/.test(tex) };
  });
  // nodes merged per material, positions to the sector's frame
  const groups = new Map();
  for (const nd of sec.nodes) { if (!nd.vc || !nd.ic) continue; const k = nd.mat; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(nd); }
  const meshes = []; const blobs = [];
  for (const [mat, list] of groups) {
    let nv = 0; let ni = 0; for (const nd of list) { nv += nd.vc; ni += nd.ic; }
    const wide = nv > 65535; const P = Buffer.alloc(nv * 6); const U = Buffer.alloc(nv * 8); const I = Buffer.alloc(ni * (wide ? 4 : 2));
    let v = 0; let ii = 0;
    const cl = (x) => Math.max(-32767, Math.min(32767, Math.round(x)));
    for (const nd of list) {
      const M = nd.m;
      for (let k = 0; k < nd.vc; k++, v++) {
        const o = sec.vb + (nd.vs + k) * 40; const x = b.readFloatLE(o); const y = b.readFloatLE(o + 4); const z = b.readFloatLE(o + 8);
        const wx = M[0] * x + M[1] * y + M[2] * z + M[3]; const wy = M[4] * x + M[5] * y + M[6] * z + M[7]; const wz = M[8] * x + M[9] * y + M[10] * z + M[11];
        P.writeInt16LE(cl((wx - x0) * S), v * 6); P.writeInt16LE(cl((wy - y0) * S), v * 6 + 2); P.writeInt16LE(cl(wz * S), v * 6 + 4);
        U.writeUInt16LE(f16(b.readFloatLE(o + 24)), v * 8); U.writeUInt16LE(f16(b.readFloatLE(o + 28)), v * 8 + 2);
        U.writeUInt16LE(Math.max(0, Math.min(65535, Math.round(b.readFloatLE(o + 32) * 65535))), v * 8 + 4); U.writeUInt16LE(Math.max(0, Math.min(65535, Math.round(b.readFloatLE(o + 36) * 65535))), v * 8 + 6);
      }
      const base = v - nd.vc;
      for (let k = 0; k < nd.ic; k++, ii++) { const idx = b.readUInt16LE(sec.ib + (nd.is + k) * 2) + base; if (wide) I.writeUInt32LE(idx, ii * 4); else I.writeUInt16LE(idx, ii * 2); }
    }
    meshes.push({ mat: mat - 1, nv, ni, wide }); blobs.push(P, U, I);
  }
  // pictures: own ones here, shared ones to lib.bin
  const pics = []; let at = blobs.reduce((a, x) => a + x.length, 0); const want = new Set(mats.flatMap((x) => [x.tex, x.light]).filter(Boolean));
  for (const n of want) {
    if (own.has(n)) { const mp = ddsMip(tb, own.get(n), MIP); if (!mp) continue; pics.push({ name: n, w: mp.w, h: mp.h, fmt: mp.fourcc, at, len: mp.data.length }); blobs.push(mp.data); at += mp.data.length; }
    else if (lib.has(n)) used.add(n); else missingPics++;
  }
  const json = Buffer.from(JSON.stringify({ A, B, x0, y0, mats, meshes, pics })); const hd = Buffer.alloc(8); hd.write('RCS1', 0, 'latin1'); hd.writeUInt32LE(json.length, 4);
  const gz = zlib.gzipSync(Buffer.concat([hd, json, ...blobs]), { level: 9 });
  fs.writeFileSync(path.join(out, `${A}_${B}.bin`), gz); total += gz.length;
  sectors.push({ A, B, bytes: gz.length, own: own.size });
  if (sectors.length % 50 === 0) console.log(`${sectors.length} sectors, ${(total / 1048576).toFixed(0)} MB`);
}
// the shared pictures this region uses
{
  const pics = []; const blobs = []; let at = 0;
  for (const n of [...used].sort()) {
    const e = lib.get(n); const b = readCached(e.file); const pos = e.pos || 0; if (b.toString('latin1', pos, pos + 4) !== 'DDS ') continue;
    const mp = ddsMip(b, pos, MIP); if (!mp) continue; pics.push({ name: n, w: mp.w, h: mp.h, fmt: mp.fourcc, at, len: mp.data.length }); blobs.push(mp.data); at += mp.data.length;
  }
  const json = Buffer.from(JSON.stringify({ pics })); const hd = Buffer.alloc(8); hd.write('RCL1', 0, 'latin1'); hd.writeUInt32LE(json.length, 4);
  const gz = zlib.gzipSync(Buffer.concat([hd, json, ...blobs]), { level: 9 }); fs.writeFileSync(path.join(out, 'lib.bin'), gz); total += gz.length;
  console.log(`lib.bin: ${pics.length} pictures, ${(gz.length / 1048576).toFixed(1)} MB`);
}
fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify({ region, sectors: sectors.map((s) => [s.A, s.B]) }));
console.log(`${region}: ${sectors.length} sectors, ${(total / 1048576).toFixed(0)} MB; pictures not found ${missingPics}`);
