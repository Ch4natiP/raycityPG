// Pulls the city out of the game folder for RayCity Drive: every race route (track/*.0m, named in
// track/track*.xml) and the traffic road network of each region (etc/traffic/road_<region>.bin).
// Also the look of the game (minimap tiles, the sunset sky and fog: see "the game's look" below).
// Writes js/drive/rc-city.js (window.RC_CITY = base64 gzip JSON). Usage:
//   node tools/extract-city.mjs "<game folder (the one holding track/ and etc/)>"
//
// Route .0m (not the car format): u32 magic, u32, u32 id, u32, utf-16 region (4 bytes), u32 n, then n start-grid
// slots of 12 floats (position, three axis vectors), the start line (centre, left, right: 9 floats), u32 m and
// m path points of 20 bytes (x, y, z, two u32). Coordinates in metres, RayCity axes (x, y, z up).
// road_*.bin: polylines, each after an 0x47aa mark: 8 more bytes, u32 point count, then x, y, z floats.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const game = process.argv[2];
if (!game || !fs.existsSync(path.join(game, 'track'))) { console.error('usage: node tools/extract-city.mjs <game folder>'); process.exit(1); }

const dm = (v) => Math.round(v * 10); // decimetres
// Douglas-Peucker on [x, y, z] points, tolerance in metres (xy only)
function simplify(p, tol) {
  if (p.length < 3) return p;
  const keep = new Uint8Array(p.length); keep[0] = keep[p.length - 1] = 1;
  const stack = [[0, p.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let best = 0; let bi = -1;
    const ax = p[a][0]; const ay = p[a][1]; const dx = p[b][0] - ax; const dy = p[b][1] - ay; const l2 = dx * dx + dy * dy || 1;
    for (let i = a + 1; i < b; i++) {
      const t = Math.max(0, Math.min(1, ((p[i][0] - ax) * dx + (p[i][1] - ay) * dy) / l2));
      const ex = ax + dx * t - p[i][0]; const ey = ay + dy * t - p[i][1]; const d = ex * ex + ey * ey;
      if (d > best) { best = d; bi = i; }
    }
    if (bi >= 0 && best > tol * tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return p.filter((_, i) => keep[i]);
}
// flat delta-coded decimetres: [x0, y0, z0, dx, dy, dz, ...]
function pack(p) {
  const out = []; let px = 0; let py = 0; let pz = 0;
  for (const q of p) { const x = dm(q[0]); const y = dm(q[1]); const z = dm(q[2]); out.push(x - px, y - py, z - pz); px = x; py = y; pz = z; }
  return out;
}

// --- track list
const info = new Map();
for (const f of fs.readdirSync(path.join(game, 'track'))) {
  if (!/^track.*\.xml$/i.test(f) || /trackinfo/i.test(f)) continue;
  const t = fs.readFileSync(path.join(game, 'track', f)).toString('utf16le').replace(/^﻿/, '');
  for (const m of t.matchAll(/<track\s([^>]*)>/g)) {
    const a = Object.fromEntries([...m[1].matchAll(/(\w+)\s*=\s*(['"])(.*?)\2/g)].map((x) => [x[1], x[3]]));
    if (a.filename) info.set(a.filename.toLowerCase(), a);
  }
}

// --- routes
const tracks = [];
for (const f of fs.readdirSync(path.join(game, 'track')).sort()) {
  if (!/\.0m$/i.test(f)) continue;
  const b = fs.readFileSync(path.join(game, 'track', f)); const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    const ns = v.getUint32(20, true); let o = 24;
    const grid = []; for (let i = 0; i < ns; i++, o += 48) grid.push([0, 1, 2].map((k) => v.getFloat32(o + k * 4, true)));
    const line = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => v.getFloat32(o + k * 4, true)); o += 36;
    const n = v.getUint32(o, true); o += 4; if (n < 2 || o + n * 20 > b.length) throw new Error('points');
    const pts = []; for (let i = 0; i < n; i++, o += 20) pts.push([0, 1, 2].map((k) => v.getFloat32(o + k * 4, true)));
    const key = f.replace(/\.0m$/i, '').toLowerCase(); const a = info.get(key) || {};
    tracks.push({
      file: key, name: a.name || key, region: a.region || (key.startsWith('[') ? 'n1' : 'kr'), loop: a.loop === '1', laps: +a.lapcnt || 0,
      hidden: a.hidden === '1', length: Math.round(+a.length || 0),
      grid: pack(grid.slice(0, 2)), line: line.map(dm), path: pack(simplify(pts, 0.3)),
    });
  } catch (e) { console.warn(`skip ${f}: ${e.message}`); }
}

// --- road networks
const roads = {};
const tdir = path.join(game, 'etc', 'traffic');
for (const f of fs.existsSync(tdir) ? fs.readdirSync(tdir) : []) {
  const m = /^road_(\w+)\.bin$/i.exec(f); if (!m) continue;
  const b = fs.readFileSync(path.join(tdir, f)); const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  // the region's race routes, 1.5 km around: stray bytes that look like a polyline land far outside
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const t of tracks.filter((t) => t.region === m[1].toLowerCase())) {
    let x = 0; let y = 0; for (let i = 0; i < t.path.length; i += 3) { x += t.path[i] / 10; y += t.path[i + 1] / 10; box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y); }
  }
  const inBox = (q) => !Number.isFinite(box[0]) || (q[0] > box[0] - 1500 && q[1] > box[1] - 1500 && q[0] < box[2] + 1500 && q[1] < box[3] + 1500);
  const lines = []; let at = b.indexOf(Buffer.from([0xaa, 0x47]), 10); let kept = 0;
  while (at !== -1 && at < b.length - 14) {
    const n = v.getUint32(at + 10, true); let ok = n > 1 && n < 5000 && at + 14 + 12 * n <= b.length; let pts;
    if (ok) {
      pts = []; for (let i = 0; i < n && ok; i++) { const q = [0, 1, 2].map((k) => v.getFloat32(at + 14 + 12 * i + k * 4, true)); ok = Math.abs(q[0]) < 20000 && Math.abs(q[1]) < 20000 && q[2] > -100 && q[2] < 500 && inBox(q); pts.push(q); }
      // a real road: heights −100…500 m, no jumps longer than 150 m
      for (let i = 1; ok && i < pts.length; i++) ok = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) < 150;
    }
    if (ok) { const s = simplify(pts, 0.8); kept += s.length; lines.push(pack(s)); at = b.indexOf(Buffer.from([0xaa, 0x47]), at + 14 + 12 * n); } else at = b.indexOf(Buffer.from([0xaa, 0x47]), at + 2);
  }
  roads[m[1].toLowerCase()] = lines;
  console.log(`roads ${m[1]}: ${lines.length} lines, ${kept} points`);
}

// --- the game's look: minimap tiles (ui/minimap/<region>/<region>_<A>_<B>_mm.dds, 256 px over 1024 m from
// x = (A − 1000) × 512, y = (B − 1000) × 512) as classes (0 none, 1 block, 2 lane, 3 road; ×85 grey PNG),
// the sunset sky (etc/skydome/sunset/cm_sky09.dds, halved) and the sunset fog (etc/env/sunset.xml)
function dds(b) {
  const h = b.readUInt32LE(12); const w = b.readUInt32LE(16); const cc = b.toString('latin1', 84, 88);
  const bs = cc === 'DXT1' ? 8 : 16; const out = Buffer.alloc(w * h * 4); let o = 128;
  const c565 = (c) => [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31];
  for (let by = 0; by < h; by += 4) for (let bx = 0; bx < w; bx += 4, o += bs) {
    const cb = o + (bs === 16 ? 8 : 0); const a = b.readUInt16LE(cb); const c = b.readUInt16LE(cb + 2);
    const p0 = c565(a); const p1 = c565(c); const pal = [p0, p1];
    if (a > c || bs === 16) { pal.push(p0.map((v, i) => (2 * v + p1[i]) / 3), p0.map((v, i) => (v + 2 * p1[i]) / 3)); } else { pal.push(p0.map((v, i) => (v + p1[i]) / 2), [0, 0, 0]); }
    const bits = b.readUInt32LE(cb + 4);
    for (let i = 0; i < 16; i++) {
      const x = bx + (i & 3); const y = by + (i >> 2); if (x >= w || y >= h) continue; const q = (y * w + x) * 4; const k = (bits >> (2 * i)) & 3;
      out[q] = pal[k][0]; out[q + 1] = pal[k][1]; out[q + 2] = pal[k][2];
      out[q + 3] = bs === 16 ? ((b[o + (i >> 1)] >> ((i & 1) * 4)) & 15) * 17 : (a <= c && k === 3 ? 0 : 255);
    }
  }
  return { w, h, data: out };
}
function png(w, h, ch, data) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * ch + 1) * h); for (let y = 0; y < h; y++) data.copy(raw, y * (w * ch + 1) + 1, y * w * ch, (y + 1) * w * ch);
  const hd = Buffer.alloc(13); hd.writeUInt32BE(w, 0); hd.writeUInt32BE(h, 4); hd[8] = 8; hd[9] = { 1: 0, 3: 2, 4: 6 }[ch];
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', hd), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const look = { tiles: {}, sky: null, fog: null };
for (const region of ['kr', 'n1']) {
  const dir = path.join(game, 'ui', 'minimap', region); if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    const m = /_(\d{4})_(\d{4})_mm\.dds$/i.exec(f); if (!m) continue;
    const { w, h, data } = dds(fs.readFileSync(path.join(dir, f)));
    let same = true; for (let i = 4; i < data.length && same; i += 4) same = data[i] === data[0] && data[i + 1] === data[1] && data[i + 2] === data[2];
    if (same) continue; // an empty tile (outside the city)
    const g = Buffer.alloc(w * h);
    for (let i = 0; i < w * h; i++) {
      const r = data[i * 4]; const gg = data[i * 4 + 1]; const bl = data[i * 4 + 2]; const L = (r + gg + bl) / 3;
      g[i] = 85 * (L < 165 ? 2 : r - bl < 35 && L > 200 ? 3 : 1);
    }
    look.tiles[`${region}_${m[1]}_${m[2]}`] = png(w, h, 1, g).toString('base64');
  }
}
{
  const f = path.join(game, 'etc', 'skydome', 'sunset', 'cm_sky09.dds');
  if (fs.existsSync(f)) {
    const { w, h, data } = dds(fs.readFileSync(f)); const W = w / 2; const H = h / 2; const o = Buffer.alloc(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let k = 0; k < 3; k++) {
      let s = 0; for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) s += data[((2 * y + dy) * w + 2 * x + dx) * 4 + k]; o[(y * W + x) * 3 + k] = s / 4;
    }
    look.sky = png(W, H, 3, o).toString('base64');
  }
  const e = path.join(game, 'etc', 'env', 'sunset.xml');
  if (fs.existsSync(e)) {
    const t = fs.readFileSync(e).toString('utf16le');
    const c = /<FogColor>\s*([\d\s]+)<\/FogColor>/.exec(t); const r = /<FogRange>\s*([\d.\s]+)<\/FogRange>/.exec(t);
    if (c) look.fog = { color: c[1].trim().split(/\s+/).slice(1).map(Number), range: r ? r[1].trim().split(/\s+/).map(Number) : [300, 800] };
  }
}
console.log(`look: ${Object.keys(look.tiles).length} minimap tiles, sky ${look.sky ? 'yes' : 'no'}, fog ${JSON.stringify(look.fog)}`);

const json = JSON.stringify({ tracks, roads, look });
const b64 = zlib.gzipSync(json, { level: 9 }).toString('base64');
fs.writeFileSync(new URL('../js/drive/rc-city.js', import.meta.url), `window.RC_CITY = '${b64}';\n`);
console.log(`${tracks.length} tracks; rc-city.js ${(b64.length / 1024).toFixed(0)} KB`);
