// Rewrite a car folder's PAINT UVs with a per-triangle box projection so no triangle spans the gap
// between UV islands (the cause of the "black triangle" patches when a UV-less model is fitted to the
// game). Each paint triangle is projected onto the plane of its own dominant axis and its 3 corners get
// fresh vertices in that plane, scaled into the body's bounding box — every triangle self-contained, all
// landing on the solid-red paint mask. Glass (kind 1) and lamp (kind 3/4) submeshes are left untouched.
//   node tools/boxuv.mjs <car-folder>   (edits the .0m files in place)
import fs from 'node:fs'; import path from 'node:path';
import sharp from 'sharp';
import { parseOM, writeOM, omParts } from '../js/om.js';

const DIR = process.argv[2];
if (!DIR) { console.error('usage: node tools/boxuv.mjs <car-folder>'); process.exit(1); }

// body bounding box (from body_2.0m paint), so every file shares one scale -> panels line up
function bodyBounds() {
  const b = fs.readFileSync(path.join(DIR, 'body_2.0m'));
  const om = parseOM(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const s of om.submeshes) { if (s.flags[0] !== 0) continue; for (let i = s.vertexStart; i < s.vertexStart + s.vertexCount; i++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], om.positions[i * 3 + k]); hi[k] = Math.max(hi[k], om.positions[i * 3 + k]); } }
  return { lo, hi };
}
const { lo, hi } = bodyBounds();
const span = [0, 1, 2].map((k) => Math.max(1e-3, hi[k] - lo[k]));
// the two axes to keep when the dominant axis is a
const OTHER = [[1, 2], [0, 2], [0, 1]];

function boxUV(part) {
  const P = part.positions, I = part.indices, N = part.normals;
  const rp = [], rn = [], ru = [], ri = [];
  for (let t = 0; t + 2 < I.length; t += 3) {
    const v = [I[t], I[t + 1], I[t + 2]];
    const p = v.map((x) => [P[x * 3], P[x * 3 + 1], P[x * 3 + 2]]);
    const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
    const e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    const nrm = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const a = Math.abs(nrm[0]) >= Math.abs(nrm[1]) && Math.abs(nrm[0]) >= Math.abs(nrm[2]) ? 0 : Math.abs(nrm[1]) >= Math.abs(nrm[2]) ? 1 : 2;
    const [cu, cv] = OTHER[a];
    // six signed-axis bins (+X,-X,+Y,-Y,+Z,-Z) in a 3x2 grid of non-overlapping cells, so opposite
    // panels (left/right doors, front/rear) never share a cell and no piece's paint spills onto another
    const k = a * 2 + (nrm[a] >= 0 ? 0 : 1);
    const col = k % 3, row = (k / 3) | 0, m = 0.015;
    const cu0 = col / 3, cv0 = row / 2;
    const base = rp.length / 3;
    for (let j = 0; j < 3; j++) {
      rp.push(p[j][0], p[j][1], p[j][2]);
      rn.push(N[v[j] * 3], N[v[j] * 3 + 1], N[v[j] * 3 + 2]);
      const fu = (p[j][cu] - lo[cu]) / span[cu], fv = (p[j][cv] - lo[cv]) / span[cv];
      ru.push(cu0 + (m + fu * (1 - 2 * m)) / 3, cv0 + (m + fv * (1 - 2 * m)) / 2);
    }
    ri.push(base, base + 1, base + 2);
  }
  return { positions: new Float32Array(rp), normals: new Float32Array(rn), uvs: new Float32Array(ru), indices: ri, flags: part.flags.slice() };
}

let files = 0, maxV = 0;
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) { walk(f); continue; }
    if (!/\.0m$/.test(e.name)) continue;
    const buf = fs.readFileSync(f);
    let om; try { om = parseOM(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)); } catch { continue; }
    const parts = omParts(om).map((p) => (p.flags[0] === 0 && p.positions.length / 3 > 8 ? boxUV(p) : p));
    const total = parts.reduce((s, p) => s + p.positions.length / 3, 0);
    maxV = Math.max(maxV, total);
    if (total > 65000) { console.log(`  skip ${path.relative(DIR, f)} (${total} verts > 65000)`); continue; }
    fs.writeFileSync(f, Buffer.from(writeOM(om, parts.map((p) => ({ ...p, kind: p.flags[0] })))));
    files++;
  }
})(DIR);
console.log(`box-unwrapped paint UVs in ${files} .0m files (max ${maxV} verts/file)`);

// Paint the whole base mask solid red (removing the black spot the ⚡ step leaves for lamp backings), so
// no paint triangle can ever sample a non-red texel, and clear the colour detail layer to transparent.
const baseName = fs.readdirSync(DIR).find((n) => /_base\.png$/.test(n));
if (baseName) {
  const name = baseName.replace(/_base\.png$/, '');
  const { width: W, height: H } = await sharp(path.join(DIR, baseName)).metadata();
  const px = Buffer.alloc(W * H * 4); for (let i = 0; i < W * H; i++) { px[i * 4] = 255; px[i * 4 + 3] = 255; }
  await sharp(px, { raw: { width: W, height: H, channels: 4 } }).png().toFile(path.join(DIR, baseName));
  // solid-red DXT3 (flags 0x81007, one level) — what the game actually reads
  const bw = Math.ceil(W / 4), bh = Math.ceil(H / 4), data = Buffer.alloc(bw * bh * 16);
  for (let o = 0; o < data.length; o += 16) { for (let a = 0; a < 8; a++) data[o + a] = 0xFF; data.writeUInt16LE(0xF800, o + 8); data.writeUInt16LE(0xF800, o + 10); }
  const hdr = Buffer.alloc(128); hdr.write('DDS ', 0, 'ascii'); const u = (off, v) => hdr.writeUInt32LE(v >>> 0, off);
  u(4, 124); u(8, 0x81007); u(12, H); u(16, W); u(20, data.length); u(76, 32); u(80, 0x4); hdr.write('DXT3', 84, 'ascii'); u(108, 0x1000);
  fs.writeFileSync(path.join(DIR, `${name}_base_s.dds`), Buffer.concat([hdr, data]));
  const cf = path.join(DIR, `${name}_color.png`);
  if (fs.existsSync(cf)) { const { width: cw, height: ch } = await sharp(cf).metadata(); await sharp(Buffer.alloc(cw * ch * 4), { raw: { width: cw, height: ch, channels: 4 } }).png().toFile(cf); }
  console.log(`paint mask -> solid red ${W}x${H} (black spot removed), colour layer cleared`);
}
