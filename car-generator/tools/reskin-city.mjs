// New, modern skins for the game's city buildings, the shapes left as they are: roads, collisions, the NPCs' and
// traffic's places all stay. A sector's buildings take their walls from strip atlases (<sector>_<n>_MD<k>!.dds,
// opaque; <sector>_<n>_MD<k>.dds, the see-through glass layer over them): columns side by side across the
// picture, each repeated up the wall (v wraps). From the sector's model every wall's column and its size in metres
// are known, so each column is drawn again at its real scale: glass curtain walls, aluminium panels with ribbon
// windows, dark fins, warm louvres, picked by what the old column looked like (green stays green). Buildings under
// pitched roofs (the palaces, gates, old houses: sloped roof faces lit with the buildings) keep their walls. Pictures keep
// their names, sizes, DXT kind and mip levels; the baked light (_CompleteMap) still shades them.
//   node tools/reskin-city.mjs <sector .0m> <its pictures folder (.dds)> <out folder>
// Writes the changed .dds into <out> (the rest unchanged): pack <out> over the sector's _tex.jmd files.
import fs from 'node:fs';
import path from 'node:path';
import { parseSector } from './field-lib.mjs';
import { dds, ddsLike } from './img-lib.mjs';

const [model, texDir, outDir] = process.argv.slice(2);
if (!model || !texDir || !outDir) { console.error('usage: node tools/reskin-city.mjs <sector .0m> <pictures folder> <out folder>'); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });

const b = fs.readFileSync(model); const s = parseSector(b, 0);
const files = new Map(fs.readdirSync(texDir).filter((f) => /\.dds$/i.test(f)).map((f) => [f.slice(0, -4).toLowerCase(), path.join(texDir, f)]));
const seed = path.basename(model);

// every triangle of the buildings' atlases: world corners and uvs
const atlases = new Map(); // name → { tris: [[P0, P1, P2, uv0, uv1, uv2]] }
for (const nd of s.nodes) {
  if (!nd.vc || !nd.ic) continue;
  const tex = ((s.mats[nd.mat - 1] || []).find((n) => !/_completemap$/i.test(n)) || '').toLowerCase();
  if (!/_md\d+!?$/.test(tex) || !files.has(tex)) continue;
  let a = atlases.get(tex); if (!a) atlases.set(tex, (a = { tris: [] }));
  const M = nd.m; const V = (k) => { const o = s.vb + (nd.vs + k) * 40; const x = b.readFloatLE(o); const y = b.readFloatLE(o + 4); const z = b.readFloatLE(o + 8); return { p: [M[0] * x + M[1] * y + M[2] * z + M[3], M[4] * x + M[5] * y + M[6] * z + M[7], M[8] * x + M[9] * y + M[10] * z + M[11]], uv: [b.readFloatLE(o + 24), b.readFloatLE(o + 28)] }; };
  for (let k = 0; k < nd.ic; k += 3) a.tris.push([0, 1, 2].map((j) => V(b.readUInt16LE(s.ib + (nd.is + k + j) * 2))));
}

// pitched roofs: the buildings' sloped faces (normal 18–63° from up), as a 1.5 m grid of the ground they cover,
// grown by a cell — walls standing under them are left as they are
const CELL = 1.5; const roofs = new Set();
for (const nd of s.nodes) {
  if (!nd.vc || !nd.ic) continue;
  const names = (s.mats[nd.mat - 1] || []).map((n) => n.toLowerCase()); if (!names.some((n) => n.endsWith('_buildings_completemap'))) continue;
  const M = nd.m; const P = (k) => { const o = s.vb + (nd.vs + k) * 40; const x = b.readFloatLE(o); const y = b.readFloatLE(o + 4); const z = b.readFloatLE(o + 8); return [M[0] * x + M[1] * y + M[2] * z + M[3], M[4] * x + M[5] * y + M[6] * z + M[7], M[8] * x + M[9] * y + M[10] * z + M[11]]; };
  for (let k = 0; k < nd.ic; k += 3) {
    const [A, B, C] = [0, 1, 2].map((j) => P(b.readUInt16LE(s.ib + (nd.is + k + j) * 2)));
    const e1 = B.map((v, i) => v - A[i]); const e2 = C.map((v, i) => v - A[i]);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; const l = Math.hypot(...n); if (l < 1e-6) continue;
    const nz = Math.abs(n[2]) / l; if (nz < 0.45 || nz > 0.95) continue;
    const x0 = Math.floor(Math.min(A[0], B[0], C[0]) / CELL) - 1; const x1 = Math.floor(Math.max(A[0], B[0], C[0]) / CELL) + 1;
    const y0 = Math.floor(Math.min(A[1], B[1], C[1]) / CELL) - 1; const y1 = Math.floor(Math.max(A[1], B[1], C[1]) / CELL) + 1;
    if ((x1 - x0) * (y1 - y0) > 4000) continue; // (a huge sloped sheet is terrain, not a roof)
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) roofs.add(`${x},${y}`);
  }
}
const underRoof = (p) => roofs.has(`${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)}`);

const hash = (str) => { let h = 2166136261; for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const median = (a) => { if (!a.length) return null; const q = [...a].sort((x, y) => x - y); return q[q.length >> 1]; };
const mix = (a, c, t) => a.map((v, i) => v + (c[i] - v) * t);
const GLASS = [[38, 72, 104], [34, 82, 92], [52, 58, 68], [70, 58, 46], [40, 60, 88]];
const LIGHT = [[226, 229, 232], [214, 218, 222], [232, 228, 220], [205, 211, 216]];

// the new face of one column: (X, Y) metres along / up the wall within its tile, the column / floor sizes
function paint(style, X, Y, colM, P, h) {
  const yf = ((Y % P) + P) % P; const floorTop = P - 0.32;
  const glass = (base, x, y) => {
    const t = Math.max(0, Math.min(1, (y - 0.35) / (P - 0.7))); // sky reflected higher up each pane
    let c = mix(mix(base, [150, 180, 205], 0.35), base, t);
    c = c.map((v) => v * (1 + 0.07 * Math.sin((x * 0.8 + y * 1.3) * 2.2)));
    const M = colM / Math.max(1, Math.round(colM / 1.5)); const dx = ((x % M) + M) % M;
    if (dx < 0.05 || dx > M - 0.05) c = [184, 190, 198];
    return c;
  };
  if (style === 'glass') {
    if (yf < 0.32) return (h & 1) ? [78, 84, 92] : [168, 174, 182]; // floor slab band
    return glass(GLASS[h % GLASS.length], X, yf);
  }
  if (style === 'light') {
    if (yf > 1.0 && yf < 2.45) return glass(GLASS[(h >>> 3) % GLASS.length], X, yf - 1.0 + 0.35);
    const base = LIGHT[h % LIGHT.length]; const jx = ((X % 1.2) + 1.2) % 1.2; const jy = ((Y % 0.9) + 0.9) % 0.9;
    if (jx < 0.025 || jy < 0.025) return base.map((v) => v * 0.78);
    return base.map((v) => v * (0.97 + 0.03 * Math.sin(X * 3.1 + Y * 1.7)));
  }
  if (style === 'dark') {
    if (yf > 0.9 && yf < 2.5) return glass([66, 56, 44], X, yf - 0.9 + 0.35);
    const fx = ((X % 0.6) + 0.6) % 0.6; return fx < 0.09 ? [104, 110, 118] : [58, 63, 70];
  }
  // warm louvres over ribbon glass
  if (yf > 1.05 && yf < 2.35 && (h & 2)) return glass(GLASS[1], X, yf - 1.05 + 0.35);
  const sx = ((X % 0.3) + 0.3) % 0.3; return sx < 0.19 ? ((h & 4) ? [176, 108, 64] : [150, 112, 78]) : [92, 60, 40];
}

let changed = 0;
for (const [name, a] of atlases) {
  const raw = fs.readFileSync(files.get(name)); const { w, h, data } = dds(raw); const out = Buffer.from(data);
  const opaque = name.endsWith('!'); let touched = 0;
  // columns: the pixel spans the triangles use across the picture (a triangle over most of it is no column)
  const spans = []; const sizes = [];
  for (const t of a.tris) {
    const us = t.map((v) => v.uv[0] * w); const u0 = Math.min(...us); const u1 = Math.max(...us);
    if (u1 - u0 > w * 0.6 || u1 - u0 < 0.5) continue;
    spans.push([Math.max(0, Math.floor(u0 + 0.25)), Math.min(w, Math.ceil(u1 - 0.25))]);
    // metres per u and per v along the triangle's edges (across: horizontal; up: vertical edges)
    const mu = []; const mv = []; let up = 0;
    for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) {
      const A = t[i]; const B = t[j]; const du = Math.abs(B.uv[0] - A.uv[0]); const dv = B.uv[1] - A.uv[1];
      const dh = Math.hypot(B.p[0] - A.p[0], B.p[1] - A.p[1]); const dz = B.p[2] - A.p[2];
      if (du > 1e-3 && Math.abs(dz) < 0.1 * dh) mu.push(dh / du);
      if (Math.abs(dv) > 1e-3 && dh < 0.1 * Math.abs(dz)) { mv.push(Math.abs(dz / dv)); up += Math.sign(dz) * Math.sign(dv); }
    }
    // a wall (standing) or a roof / floor (lying): by the face's normal, weighed by its area
    const e1 = t[1].p.map((v, k) => v - t[0].p[k]); const e2 = t[2].p.map((v, k) => v - t[0].p[k]);
    const nrm = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; const area = Math.hypot(...nrm) / 2;
    const mid = [0, 1, 2].map((k) => (t[0].p[k] + t[1].p[k] + t[2].p[k]) / 3);
    sizes.push({ c: (u0 + u1) / 2, mu: median(mu), mv: median(mv), up, area, wall: area > 0 && Math.abs(nrm[2]) / (2 * area) < 0.3, old: underRoof(mid) });
  }
  spans.sort((p, q) => p[0] - q[0]);
  const cols = [];
  for (const sp of spans) { const c = cols[cols.length - 1]; if (c && sp[0] < c[1] - 1) c[1] = Math.max(c[1], sp[1]); else cols.push([...sp]); }
  for (const [x0, x1] of cols) {
    if (x1 - x0 < 2) continue;
    const mine = sizes.filter((q) => q.c >= x0 && q.c <= x1);
    // only columns on walls: roofs, floors and steps keep theirs
    const all = mine.reduce((t, q) => t + q.area, 0); const walls = mine.reduce((t, q) => t + (q.wall ? q.area : 0), 0);
    if (!all || walls < all * 0.6) continue;
    // walls under pitched roofs (old buildings) keep theirs; a column they share with modern walls too (one
    // picture for both: the old ones come first)
    if (mine.reduce((t, q) => t + (q.wall && q.old ? q.area : 0), 0) > walls * 0.12) continue;
    if (!opaque) {
      // the glass layer over the walls: tinted like the new glass, its see-through kept
      for (let y = 0; y < h; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * 4; const L = (out[i] * 0.3 + out[i + 1] * 0.59 + out[i + 2] * 0.11) / 255; out[i] = 70 + 110 * L; out[i + 1] = 100 + 110 * L; out[i + 2] = 130 + 110 * L; }
      touched++; continue;
    }
    const mu = median(mine.map((q) => q.mu).filter(Boolean)) || w * 0.03; const mv = median(mine.map((q) => q.mv).filter(Boolean)) || 3.5;
    const up = mine.reduce((t, q) => t + q.up, 0) <= 0; // v falling as the wall rises: the picture's top is up
    const colM = ((x1 - x0) / w) * mu; const tileM = mv; const floors = Math.max(1, Math.round(tileM / 3.6)); const P = tileM / floors;
    // what the old column was: green (planting) stays; brick red → warm; light → panels; dark or busy → glass
    let r = 0; let g = 0; let bl = 0; let n = 0; let L2 = 0;
    for (let y = 0; y < h; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * 4; if (data[i + 3] < 128) continue; r += data[i]; g += data[i + 1]; bl += data[i + 2]; const L = data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11; L2 += L * L; n++; }
    // cut-out columns (railings, fences, ivy: holes in the picture) keep theirs
    if (!n || n < (x1 - x0) * h * 0.95) continue; r /= n; g /= n; bl /= n; const L = r * 0.3 + g * 0.59 + bl * 0.11; const sd = Math.sqrt(Math.max(0, L2 / n - L * L));
    if (g > r + 12 && g > bl + 12) continue;
    const hh = hash(`${seed}|${name}|${x0}`);
    const style = r > g + 28 && r > bl + 28 ? 'warm' : sd > 38 || L < 95 ? 'glass' : L > 165 ? ((hh & 3) ? 'light' : 'glass') : ((hh & 1) ? 'dark' : 'light');
    for (let y = 0; y < h; y++) for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4; if (data[i + 3] < 128) continue;
      const X = ((x - x0 + 0.5) / (x1 - x0)) * colM; const Y = ((up ? h - 1 - y : y) + 0.5) / h * tileM;
      const c = paint(style, X, Y, colM, P, hh); out[i] = Math.max(0, Math.min(255, c[0])); out[i + 1] = Math.max(0, Math.min(255, c[1])); out[i + 2] = Math.max(0, Math.min(255, c[2]));
    }
    touched++;
  }
  if (process.env.RESKIN_DEBUG) (globalThis.dbg ||= []).push({ name, w, cols: cols.map(([x0, x1]) => [x0, x1]), tris: a.tris.map((t) => [t.map((v) => v.p), t.map((v) => v.uv[0] * w)]) });
  if (!touched) continue; // (nothing of it on a modern wall: the picture stays as it is)
  fs.writeFileSync(path.join(outDir, path.basename(files.get(name))), ddsLike(raw, w, h, out)); changed++;
}
if (process.env.RESKIN_DEBUG) fs.writeFileSync(process.env.RESKIN_DEBUG, JSON.stringify({ roofs: [...roofs], atlases: globalThis.dbg || [] }));
console.log(`${path.basename(model)}: ${changed} pictures redrawn (${[...atlases.keys()].join(', ')})`);
