// Pulls the city out of the game folder for RayCity Drive: every race route (track/*.0m, named in
// track/track*.xml) and the traffic road network of each region (etc/traffic/road_<region>.bin).
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

const json = JSON.stringify({ tracks, roads });
const b64 = zlib.gzipSync(json, { level: 9 }).toString('base64');
fs.writeFileSync(new URL('../js/drive/rc-city.js', import.meta.url), `window.RC_CITY = '${b64}';\n`);
console.log(`${tracks.length} tracks; rc-city.js ${(b64.length / 1024).toFixed(0)} KB`);
