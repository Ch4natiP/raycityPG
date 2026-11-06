// RayCity PG road signs for the game's city (Seoul, kr). The boards over the roads are blank grey in the game: all of
// them (≈530, in 299 sectors, and the Road_Milestone props of common/xref.jmd) show one square of road_common_01@
// (u 0.625–0.75, v 0.125–0.25). That square becomes the server's own board (PG badge, RAYCITY, PG SERVER, white on
// blue), and the four direction signs that carry Seoul place names (<sector>_…_milestone_….dds) point to the
// server's places instead (PG TOWN, PG GARAGE, PG RACING, PG SHOP, PG GAS, PG STATION). Pictures keep their names,
// sizes, DXT kind, mip levels and cut-outs (alpha); in road_common_01@ every block outside the square stays bit for bit.
//   node tools/signs-city.mjs <out folder> <picture.dds>...          road_common_01@.dds (512 or 1024) / *_milestone_*.dds
//   node tools/signs-city.mjs --turn <out folder> <file.jmd>...      kr_A_B.jmd (sector) or xref.jmd: board faces that show
//                                                                    the square the other way round get their uv turned
// Most boards show the square turned: the board's right runs up the picture (v falling), its top to the picture's
// right (u rising). The rest (≈15 % of board sides, in 89 sectors, and the xref props) have it turned, mirrored or
// upside down; --turn maps their uv so that every board shows the square the same way and the letters read right.
// Drawing: headless Chromium (playwright-core; CHROME=<path> for its executable), Inter for the letters.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dds, ddsLike, ddsKeep } from './img-lib.mjs';
import { parseSector } from './field-lib.mjs';

// the square, and the part of it the boards show (a few px of margin past it take the board's edge colour)
export const SQUARE = { u: [0.625, 0.75], v: [0.125, 0.25] };
export const SHOWN = { u: [0.627, 0.745], v: [0.126, 0.248] };
const S = 8; // drawn at 8 × the picture's pixels, boxed down

// the drawings, in the page: board(ctx, W, H) and sign(ctx, W, H, kind)
const PAGE = String.raw`<!doctype html><meta charset="utf-8"><canvas id="c"></canvas><script>
const BLUE = ['#1459c8', '#0a3482'], YEL = '#ffc400', NAVY = '#0b2558', WHITE = '#ffffff';
const FONT = (w, s) => w + ' ' + s + 'px Inter, "DejaVu Sans", sans-serif';
function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function text(c, s, x, y, size, weight, maxW, color, align) {
  c.font = FONT(weight, size); c.fillStyle = color; c.textAlign = align || 'center'; c.textBaseline = 'middle';
  const w = c.measureText(s).width; c.save(); c.translate(x, y); if (w > maxW) c.scale(maxW / w, 1); c.fillText(s, 0, 0); c.restore();
}
function ground(c, W, H) {
  const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, BLUE[0]); g.addColorStop(1, BLUE[1]); c.fillStyle = g; c.fillRect(0, 0, W, H);
  const k = Math.min(W, H); c.lineWidth = k * 0.03; c.strokeStyle = WHITE; rr(c, k * 0.035, k * 0.035, W - k * 0.07, H - k * 0.07, k * 0.06); c.stroke();
}
function badge(c, x, y, s) { c.fillStyle = YEL; rr(c, x, y, s, s, s * 0.14); c.fill(); text(c, 'PG', x + s / 2, y + s * 0.53, s * 0.66, 900, s * 0.88, NAVY); }
function arrow(c, pts, w, head) {
  c.strokeStyle = WHITE; c.fillStyle = WHITE; c.lineWidth = w; c.lineJoin = 'round'; c.lineCap = 'butt';
  const [ax, ay] = pts[pts.length - 2], [bx, by] = pts[pts.length - 1]; const L = Math.hypot(bx - ax, by - ay); const ux = (bx - ax) / L, uy = (by - ay) / L;
  const ex = bx - ux * head, ey = by - uy * head; c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1, -1)) c.lineTo(p[0], p[1]); c.lineTo(ex, ey); c.stroke();
  c.beginPath(); c.moveTo(bx, by); c.lineTo(ex - uy * head * 0.8, ey + ux * head * 0.8); c.lineTo(ex + uy * head * 0.8, ey - ux * head * 0.8); c.closePath(); c.fill();
}
// the board over the road: drawn on 1000 × 500 (the boards run 1.3 to 4 times wider than tall, 2 for most)
function board(c, W, H) {
  c.save(); c.scale(W / 1000, H / 500); ground(c, 1000, 500);
  badge(c, 62, 70, 360);
  text(c, 'RAYCITY', 705, 190, 150, 900, 500, WHITE);
  c.fillStyle = WHITE; c.fillRect(478, 280, 454, 12);
  text(c, 'PG SERVER', 705, 372, 104, 900, 470, YEL);
  c.restore();
}
// the direction signs, each on the layout of the one it replaces
function sign(c, W, H, kind) {
  if (kind === 'junction') { // 256 × 128: ahead, left and right, 300 m
    c.save(); c.scale(W / 1024, H / 512); ground(c, 1024, 512); badge(c, 44, 40, 116);
    text(c, 'PG TOWN', 540, 96, 96, 900, 560, WHITE);
    arrow(c, [[512, 478], [512, 168]], 46, 74); arrow(c, [[512, 330], [292, 330]], 46, 74); arrow(c, [[512, 330], [732, 330]], 46, 74);
    text(c, 'PG GARAGE', 160, 236, 70, 900, 250, WHITE); text(c, 'PG RACING', 864, 236, 70, 900, 250, WHITE);
    text(c, '300m', 560, 440, 64, 800, 200, WHITE, 'left'); c.restore();
  } else if (kind === 'distances') { // 128 × 128: two places, how far
    c.save(); c.scale(W / 512, H / 512); ground(c, 512, 512); badge(c, 40, 40, 92);
    text(c, 'PG SHOP', 40, 200, 88, 900, 300, WHITE, 'left'); text(c, '3km', 474, 200, 76, 800, 120, WHITE, 'right');
    c.fillStyle = WHITE; c.fillRect(36, 268, 440, 10);
    text(c, 'PG GAS', 40, 370, 88, 900, 300, WHITE, 'left'); text(c, '2km', 474, 370, 76, 800, 120, WHITE, 'right'); c.restore();
  } else if (kind === 'exit') { // 128 × 128: ahead, and the way off to the right, 500 m
    c.save(); c.scale(W / 512, H / 512); ground(c, 512, 512);
    text(c, 'PG RACING', 40, 100, 80, 900, 430, WHITE, 'left');
    text(c, 'PG', 40, 250, 76, 900, 250, WHITE, 'left'); text(c, 'GARAGE', 40, 330, 76, 900, 250, WHITE, 'left');
    arrow(c, [[392, 476], [392, 176]], 38, 60); arrow(c, [[392, 440], [462, 370], [462, 272]], 30, 50);
    text(c, '500m', 40, 432, 60, 800, 220, WHITE, 'left'); c.restore();
  } else if (kind === 'station') { // 128 × 64: ahead, and the turn left, 200 m
    c.save(); c.scale(W / 512, H / 256); ground(c, 512, 256);
    text(c, 'PG STATION', 36, 74, 66, 900, 440, WHITE, 'left');
    arrow(c, [[96, 228], [96, 168], [40, 168]], 26, 40); text(c, '200m', 126, 190, 48, 800, 100, WHITE, 'left');
    text(c, 'PG TOWN', 476, 186, 62, 900, 200, WHITE, 'right'); c.restore();
  }
}
window.draw = async (what, W, H, kind) => {
  await document.fonts.load(FONT(900, 40)); await document.fonts.load(FONT(800, 40));
  const cv = document.getElementById('c'); cv.width = W; cv.height = H; const c = cv.getContext('2d'); c.clearRect(0, 0, W, H);
  if (what === 'board') board(c, W, H); else sign(c, W, H, kind);
  const d = c.getImageData(0, 0, W, H).data; let s = ''; for (let i = 0; i < d.length; i += 32768) s += String.fromCharCode.apply(null, d.subarray(i, i + 32768)); return btoa(s);
};
</script>`;

// the Seoul direction signs and what each becomes
const KINDS = [[/milestone_t1/i, 'junction'], [/milestone_t2/i, 'distances'], [/milestone_kb/i, 'exit'], [/milestone/i, 'station']];

async function painter() {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const page = await browser.newPage(); await page.setContent(PAGE);
  return { draw: async (what, W, H, kind) => Buffer.from(await page.evaluate(([a, b, c, d]) => window.draw(a, b, c, d), [what, W, H, kind]), 'base64'), close: () => browser.close() };
}
// box average of an S × S block of a drawing (W wide) around (x, y)
function boxAt(D, W, H, x, y, k) {
  let s = 0; let n = 0; const x0 = Math.max(0, Math.min(W - S, Math.round(x - S / 2))); const y0 = Math.max(0, Math.min(H - S, Math.round(y - S / 2)));
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { s += D[((y0 + j) * W + x0 + i) * 4 + k]; n++; }
  return s / n;
}
// the board into its square of road_common_01@: texel (u, v) shows the drawing at right = (v₁ − v) / (v₁ − v₀),
// down = (u₁ − u) / (u₁ − u₀); past the shown part, the drawing's edge
export async function paintBoard(raw, pen) {
  const { w, h, data } = dds(raw); const out = Buffer.from(data);
  const Wd = Math.round((SHOWN.v[1] - SHOWN.v[0]) * h * S); const Hd = Math.round((SHOWN.u[1] - SHOWN.u[0]) * w * S); const D = await pen.draw('board', Wd, Hd);
  const r = { x: Math.round(SQUARE.u[0] * w), y: Math.round(SQUARE.v[0] * h), w: Math.round((SQUARE.u[1] - SQUARE.u[0]) * w), h: Math.round((SQUARE.v[1] - SQUARE.v[0]) * h) };
  for (let ty = r.y; ty < r.y + r.h; ty++) for (let tx = r.x; tx < r.x + r.w; tx++) {
    const u = (tx + 0.5) / w; const v = (ty + 0.5) / h;
    const dx = Math.max(0, Math.min(1, (SHOWN.v[1] - v) / (SHOWN.v[1] - SHOWN.v[0]))) * Wd; const dy = Math.max(0, Math.min(1, (SHOWN.u[1] - u) / (SHOWN.u[1] - SHOWN.u[0]))) * Hd;
    const q = (ty * w + tx) * 4; for (let k = 0; k < 3; k++) out[q + k] = boxAt(D, Wd, Hd, dx, dy, k); out[q + 3] = 255;
  }
  return ddsKeep(raw, ddsLike(raw, w, h, out), r);
}
// a direction sign, upright on its board; the cut-out (alpha) kept
export async function paintSign(raw, kind, pen) {
  const { w, h, data } = dds(raw); const D = await pen.draw('sign', w * S, h * S, kind); const out = Buffer.from(data);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const q = (y * w + x) * 4; for (let k = 0; k < 3; k++) out[q + k] = boxAt(D, w * S, h * S, x * S + S / 2, y * S + S / 2, k); }
  return ddsLike(raw, w, h, out);
}

// --turn: a triangle of a board face (standing, covering most of the square); how the square lies on it, seen from
// in front: which picture axis runs right, which up. tri = [[x, y, z, u, v] × 3]
export function lie(tri) {
  const [a, c, d] = tri; const e = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]; const f = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
  const n = [e[1] * f[2] - e[2] * f[1], e[2] * f[0] - e[0] * f[2], e[0] * f[1] - e[1] * f[0]]; const L = Math.hypot(...n);
  if (!L || Math.abs(n[2] / L) > 0.2) return null;
  const us = tri.map((p) => p[3]); const vs = tri.map((p) => p[4]); const du = Math.max(...us) - Math.min(...us); const dv = Math.max(...vs) - Math.min(...vs);
  const cu = ((us.reduce((s, x) => s + x, 0) / 3) % 1 + 1) % 1; const cv = ((vs.reduce((s, x) => s + x, 0) / 3) % 1 + 1) % 1;
  if (du < 0.08 || dv < 0.08 || cu < SQUARE.u[0] || cu > SQUARE.u[1] || cv < SQUARE.v[0] || cv > SQUARE.v[1]) return null;
  const r = [-n[1], n[0]]; const rl = Math.hypot(...r); const e2 = [(e[0] * r[0] + e[1] * r[1]) / rl, e[2]]; const f2 = [(f[0] * r[0] + f[1] * r[1]) / rl, f[2]];
  const det = e2[0] * f2[1] - e2[1] * f2[0]; if (Math.abs(det) < 1e-9) return null;
  const t1 = [c[3] - a[3], c[4] - a[4]]; const t2 = [d[3] - a[3], d[4] - a[4]];
  const dr = [(f2[1] * t1[0] - e2[1] * t2[0]) / det, (f2[1] * t1[1] - e2[1] * t2[1]) / det]; const dz = [(-f2[0] * t1[0] + e2[0] * t2[0]) / det, (-f2[0] * t1[1] + e2[0] * t2[1]) / det];
  const right = Math.abs(dr[0]) > Math.abs(dr[1]) ? ['u', Math.sign(dr[0])] : ['v', Math.sign(dr[1])];
  const up = right[0] === 'u' ? ['v', Math.sign(dz[1])] : ['u', Math.sign(dz[0])];
  return { right, up, ok: right[0] === 'v' && right[1] < 0 && up[1] > 0 };
}
// new uv for the corners of one board side (verts: [[u, v]]) so it shows the square as most boards do
export function turnUV(verts, how) {
  const u0 = Math.min(...verts.map((p) => p[0])); const u1 = Math.max(...verts.map((p) => p[0])); const v0 = Math.min(...verts.map((p) => p[1])); const v1 = Math.max(...verts.map((p) => p[1]));
  return verts.map(([u, v]) => {
    const s = (u - u0) / (u1 - u0); const t = (v - v0) / (v1 - v0); const along = (ax) => (ax[0] === 'u' ? s : t);
    const xr = how.right[1] > 0 ? along(how.right) : 1 - along(how.right); const yu = how.up[1] > 0 ? along(how.up) : 1 - along(how.up);
    return [u0 + yu * (u1 - u0), v0 + (1 - xr) * (v1 - v0)];
  });
}
// the triangles of a list turned as one side: groups joined by shared corners; a group whose corners are shared with
// a triangle left as it is gets nothing (counted)
function sides(tris, keepIdx) {
  const seen = new Set(); const out = []; let blocked = 0;
  for (let i = 0; i < tris.length; i++) {
    if (seen.has(i)) continue; const g = [i]; seen.add(i); const idx = new Set(tris[i].idx);
    for (let grew = true; grew;) { grew = false; for (let j = 0; j < tris.length; j++) if (!seen.has(j) && tris[j].idx.some((x) => idx.has(x))) { seen.add(j); g.push(j); tris[j].idx.forEach((x) => idx.add(x)); grew = true; } }
    if ([...idx].some((x) => keepIdx.has(x))) { blocked += g.length; continue; }
    out.push({ how: tris[g[0]].how, idx: [...idx] });
  }
  return { out, blocked };
}
// a sector (kr_A_B.jmd, its .0m stored as it is from byte 768): uv floats of turned board faces written in place
export function turnSector(b) {
  const sec = parseSector(b); const tex = sec.mats.map((ns) => (ns.find((n) => !/_completemap$/i.test(n)) || '').toLowerCase()); let turned = 0; let blocked = 0;
  for (const nd of sec.nodes) {
    if (!nd.vc || !nd.ic || tex[nd.mat - 1] !== 'road_common_01@') continue; const M = nd.m;
    const at = (k) => sec.vb + (nd.vs + k) * 40;
    const P = (k) => { const o = at(k); const x = b.readFloatLE(o), y = b.readFloatLE(o + 4), z = b.readFloatLE(o + 8); return [M[0] * x + M[1] * y + M[2] * z + M[3], M[4] * x + M[5] * y + M[6] * z + M[7], M[8] * x + M[9] * y + M[10] * z + M[11], b.readFloatLE(o + 24), b.readFloatLE(o + 28)]; };
    const bad = []; const keep = new Set();
    for (let k = 0; k + 2 < nd.ic; k += 3) {
      const idx = [0, 1, 2].map((j) => b.readUInt16LE(sec.ib + (nd.is + k + j) * 2)); if (idx.some((x) => x >= nd.vc)) continue;
      const how = lie(idx.map(P)); if (how && !how.ok) bad.push({ idx, how }); else idx.forEach((x) => keep.add(x));
    }
    const { out, blocked: bl } = sides(bad, keep); blocked += bl;
    for (const s of out) { const uv = turnUV(s.idx.map((x) => P(x).slice(3)), s.how); s.idx.forEach((x, i) => { b.writeFloatLE(uv[i][0], at(x) + 24); b.writeFloatLE(uv[i][1], at(x) + 28); }); turned += s.idx.length; }
  }
  return { turned, blocked };
}
// xref.jmd (its j2m_xref.0m stored as it is): the props' meshes (aa 27 blocks: u16 id, u16 n, u8 1, n positions,
// u8 normals?, [n normals], u8 colours?, [n colours], u8 uv sets, u8, n uvs × sets, u16 ni, indices)
export function turnXref(b) {
  let turned = 0; let blocked = 0; let j = b.indexOf(Buffer.from([0xaa, 0x27]));
  while (j !== -1) {
    let next = j + 2;
    try {
      const n = b.readUInt16LE(j + 4);
      if (b[j + 6] === 1 && n >= 3 && j + 7 + 12 * n < b.length) {
        const pos = j + 7; let o = pos + 12 * n; o += b[o] === 1 ? 1 + 12 * n : 1; o += b[o] === 1 ? 1 + 4 * n : 1;
        const sets = b[o]; o += 2; const uvAt = o; o += 8 * n * Math.max(1, sets); const ni = b.readUInt16LE(o);
        const I = []; for (let i = 0; i < ni; i++) I.push(b.readUInt16LE(o + 2 + 2 * i));
        if (sets >= 1 && ni && ni % 3 === 0 && Math.max(...I) < n) {
          const P = (k) => [b.readFloatLE(pos + 12 * k), b.readFloatLE(pos + 12 * k + 4), b.readFloatLE(pos + 12 * k + 8), b.readFloatLE(uvAt + 8 * k), b.readFloatLE(uvAt + 8 * k + 4)];
          const bad = []; const keep = new Set();
          for (let k = 0; k < ni; k += 3) { const idx = I.slice(k, k + 3); const how = lie(idx.map(P)); if (how && !how.ok) bad.push({ idx, how }); else idx.forEach((x) => keep.add(x)); }
          const { out, blocked: bl } = sides(bad, keep); blocked += bl;
          for (const s of out) { const uv = turnUV(s.idx.map((x) => P(x).slice(3)), s.how); s.idx.forEach((x, i) => { b.writeFloatLE(uv[i][0], uvAt + 8 * x); b.writeFloatLE(uv[i][1], uvAt + 8 * x + 4); }); turned += s.idx.length; }
          next = o + 2 + 2 * ni;
        }
      }
    } catch { /* not a mesh block */ }
    j = b.indexOf(Buffer.from([0xaa, 0x27]), next);
  }
  return { turned, blocked };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2); const turn = args[0] === '--turn'; if (turn) args.shift();
  const [outDir, ...inputs] = args;
  if (!outDir || !inputs.length) { console.error('usage: node tools/signs-city.mjs [--turn] <out folder> <file>...'); process.exit(1); }
  fs.mkdirSync(outDir, { recursive: true });
  if (turn) {
    let files = 0;
    for (const f of inputs) {
      const b = Buffer.from(fs.readFileSync(f)); const r = /xref/i.test(path.basename(f)) ? turnXref(b) : turnSector(b);
      if (r.turned) { fs.writeFileSync(path.join(outDir, path.basename(f)), b); files++; }
      if (r.turned || r.blocked) console.log(`${path.basename(f)}: ${r.turned} board corners turned${r.blocked ? `, ${r.blocked} faces left (corners shared)` : ''}`);
    }
    console.log(`${files} files with boards turned`);
  } else {
    const pen = await painter();
    try {
      for (const f of inputs) {
        const raw = fs.readFileSync(f); const name = path.basename(f); let made = null;
        if (/^road_common_01@\.dds$/i.test(name)) made = await paintBoard(raw, pen);
        else { const k = KINDS.find(([rx]) => rx.test(name)); if (k) made = await paintSign(raw, k[1], pen); }
        if (!made) { console.log(`${name}: not a sign picture, left out`); continue; }
        fs.writeFileSync(path.join(outDir, name), made); console.log(`${name}: PG`);
      }
    } finally { await pen.close(); }
  }
}
