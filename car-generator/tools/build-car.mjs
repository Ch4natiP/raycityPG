// Builds a RayCity car folder (same layout as an original car) from a realistic glTF/GLB model.
//
//   node tools/build-car.mjs <model.glb> <template-car-folder> <out-dir> [--name rc_car] [--spec template.xml]
//
// - Splits the model into the game's tunable parts (body, hood, roof, bumpers, lights, skirt) by region
//   and material, adds procedural rear wings for the spoiler slot.
// - Simplifies every part to three LODs with meshoptimizer, budgets close to the original cars.
// - Bakes material colors into small palette textures (PNG + uncompressed DDS "_s" copy).
// - Writes .0m files using the template car's files of the same slot/LOD as header templates,
//   list.xml files with the template's variant names, mesh.xml (collision hull), dooropen and the spec XML.
// Wheels are skipped: RayCity uses shared wheels.
import fs from 'fs';
import path from 'path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { parseOM, writeOM } from '../js/om.js';
import { readSpec, writeSpec, encodeSpec, decodeSpec } from '../js/carSpec.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : d; };
const NAME = opt('--name', 'rc_car');
const SPEC = opt('--spec', '');
const LOCK = opt('--lock', '0') === '1';
const SCALE = Number(opt('--budget', '1'));
const [SRC, TPL, OUT] = args;
if (!SRC || !TPL || !OUT) {
  console.error('usage: node tools/build-car.mjs <model.glb> <template-car-folder> <out-dir> [--name rc_car] [--spec x.xml]');
  process.exit(1);
}

// ---------------------------------------------------------------------------------------------
// 1. Load triangles in RayCity space (x left, y back, z up). The source is glTF: Y up, front −Z.

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });
const doc = await io.read(SRC);

// Meshes we never export: wheels (shared in game) and badges. Inner panels (floor, dash, door cards,
// wheel-arch liners, underbody) are kept: without them the car is see-through in game.
const SKIP_NODE = /^(wheel|steering|blue|yellow_trim|centre)/i;
const tris = []; // { a, b, c (float3 arrays), mat, inner }
const wheelCenters = [];
let steeringPos = null; // used to place the gear lever
doc.getRoot().getDefaultScene().traverse((node) => {
  if (/^wheel_/i.test(node.getName())) {
    const m = node.getWorldMatrix();
    wheelCenters.push([-m[12], m[14], m[13]]);
  }
  if (/^steering_wheel$/i.test(node.getName())) {
    const m = node.getWorldMatrix();
    steeringPos = [-m[12], m[14], m[13]];
  }
  for (let n = node; n; n = n.getParentNode()) if (SKIP_NODE.test(n.getName())) return;
  const inner = /^interior_(light|dark)/i.test(node.getName());
  const mesh = node.getMesh();
  if (!mesh) return;
  const m = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    const idx = prim.getIndices();
    const mat = prim.getMaterial()?.getName() || 'default';
    const v = [];
    const P = [];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v);
      const x = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12];
      const y = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13];
      const z = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
      P.push([-x, z, y]);
    }
    const I = idx ? idx.getArray() : P.map((_, i) => i);
    for (let t = 0; t + 2 < I.length; t += 3) tris.push({ a: P[I[t]], b: P[I[t + 1]], c: P[I[t + 2]], mat, inner });
  }
});
console.log(`source: ${tris.length} triangles`);

// ---------------------------------------------------------------------------------------------
// 2. Measure the car and split into RayCity part slots.

const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
const norm = (p) => { const l = Math.hypot(...p) || 1; return [p[0] / l, p[1] / l, p[2] / l]; };
for (const t of tris) {
  t.c0 = [0, 1, 2].map((k) => (t.a[k] + t.b[k] + t.c[k]) / 3);
  t.n = norm(cross(sub(t.b, t.a), sub(t.c, t.a)));
}
const bodyTris = tris.filter((t) => t.mat === 'Body_Color');
const ext = (list, k, f) => list.reduce((r, t) => f(r, t.c0[k]), f === Math.min ? Infinity : -Infinity);
const yF = ext(bodyTris, 1, Math.min);
const yR = ext(bodyTris, 1, Math.max);
const glass = tris.filter((t) => /glass/i.test(t.mat) && !/light|projector/i.test(t.mat));
// Windshield base: front-most glass above the headlight covers.
const wsBaseY = ext(glass.filter((t) => t.c0[1] < 0 && t.c0[2] > 0.88), 1, Math.min);
const glassTop = ext(glass, 2, Math.max);
const rearDeckZ = ext(bodyTris.filter((t) => t.c0[1] > yR - 0.5 && t.c0[1] < yR - 0.2), 2, Math.max);
console.log(`length ${(yR - yF).toFixed(2)} m, windshield base y ${wsBaseY.toFixed(2)}, roof ${glassTop.toFixed(2)}, deck ${rearDeckZ.toFixed(2)}`);

// Outward direction at a point: gradient of an ellipsoid around the car (so the roof faces up,
// the sides sideways and the nose forward).
const CENTER = [0, (yF + yR) / 2, 0.55];
const RADII = [1.0, (yR - yF) / 2, 0.6];
const outwardDot = (t) => [0, 1, 2].reduce((s, k) => s + t.n[k] * ((t.c0[k] - CENTER[k]) / (RADII[k] * RADII[k])), 0);

const isLight = (t) => /projector|led|taillight/i.test(t.mat);
const headBox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
const tailBox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
const grow = (bx, t) => { for (let k = 0; k < 3; k++) { bx.min[k] = Math.min(bx.min[k], t.c0[k]); bx.max[k] = Math.max(bx.max[k], t.c0[k]); } };
const inBox = (bx, t, pad) => [0, 1, 2].every((k) => t.c0[k] >= bx.min[k] - pad && t.c0[k] <= bx.max[k] + pad);
for (const t of tris) {
  if (/projector|led/i.test(t.mat) && t.c0[1] < yF + 0.6) grow(headBox, t);
  if (/taillight/i.test(t.mat) && t.c0[1] > yR - 0.5) grow(tailBox, t);
}

function slotOf(t) {
  const [x, y, z] = t.c0;
  const ax = Math.abs(x);
  if (/projector|led/i.test(t.mat) && y < yF + 0.6) return 'headlight';
  if (/taillight/i.test(t.mat) && y > yR - 0.5) return 'rearlight';
  if (/chrome|metal|plastic/i.test(t.mat) && inBox(headBox, t, 0.03)) return 'headlight';
  if (/chrome|metal|plastic/i.test(t.mat) && inBox(tailBox, t, 0.03)) return 'rearlight';
  if (isLight(t)) return 'body';
  if (/glass/i.test(t.mat)) return 'body';
  if (t.mat === 'Body_Color' && y > wsBaseY + 0.25 && y < yR - 1.4 && z > glassTop - 0.14 && t.n[2] > 0.5) return 'roof';
  if (t.mat === 'Body_Color' && y > yF + 0.5 && y < wsBaseY - 0.03 && ax < 0.6 && z > 0.55 && t.n[2] > 0.5) return 'hood';
  if (y < yF + 0.5 && z < 0.78) return 'frontbumper';
  if (y > yR - 0.42 && z < 0.82) return 'rearbumper';
  if (z < 0.42 && ax > 0.78 && y > -0.75 && y < 1.05) return 'skirt';
  return 'body';
}
// Inner panels: keep only what closes visible holes — the cabin tub (floor, dash, door cards)
// and the underbody. Engine bay and bumper internals would poke through the skin.
{
  const before = tris.length;
  const keepInner = (t) => {
    const [x, y, z] = t.c0;
    if (y > wsBaseY - 0.25 && y < yR - 1.3 && Math.abs(x) < 0.85 && z < 1.15) return true;
    // Wheel-arch liners come from the generated wheel wells below: the source liners sit right under
    // the fender skin and poke through it once simplified.
    return z < 0.22;
  };
  for (let i = tris.length - 1; i >= 0; i--) if (tris[i].inner && !keepInner(tris[i])) tris.splice(i, 1);
  console.log(`inner panels: kept ${tris.filter((t) => t.inner).length}, dropped ${before - tris.length} (wheels at ${wheelCenters.map((w) => w.map((v) => v.toFixed(2)).join(',')).join(' / ')})`);
}

// Remove badges/lettering: small separate pieces near the centerline at the nose or tail.
{
  const key = (p) => `${Math.round(p[0] * 2000)},${Math.round(p[1] * 2000)},${Math.round(p[2] * 2000)}`;
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const t of tris) {
    if (!/chrome|metal|plastic/i.test(t.mat)) continue;
    const ks = [t.a, t.b, t.c].map((p) => `${t.mat}|${key(p)}`);
    for (const k of ks) if (!parent.has(k)) parent.set(k, k);
    union(ks[0], ks[1]); union(ks[1], ks[2]);
    t.comp = ks[0];
  }
  const boxes = new Map();
  for (const t of tris) {
    if (!t.comp) continue;
    const r = find(t.comp);
    t.comp = r;
    const bx = boxes.get(r) || { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (const p of [t.a, t.b, t.c]) for (let k = 0; k < 3; k++) { bx.min[k] = Math.min(bx.min[k], p[k]); bx.max[k] = Math.max(bx.max[k], p[k]); }
    boxes.set(r, bx);
  }
  const badge = new Set();
  for (const [r, bx] of boxes) {
    const size = Math.max(...[0, 1, 2].map((k) => bx.max[k] - bx.min[k]));
    const cx = (bx.min[0] + bx.max[0]) / 2;
    const cy = (bx.min[1] + bx.max[1]) / 2;
    if (size < 0.14 && Math.abs(cx) < 0.2 && (cy < yF + 0.35 || cy > yR - 0.35)) badge.add(r);
  }
  const before = tris.length;
  for (let i = tris.length - 1; i >= 0; i--) if (tris[i].comp && badge.has(tris[i].comp)) tris.splice(i, 1);
  console.log(`badges removed: ${badge.size} pieces, ${before - tris.length} triangles`);
}

// Pieces whose faces point both into and out of the car (curved lamp surrounds, lips, fins) get
// drawn from both sides; for the rest one outward-facing side is enough.
{
  const key = (p) => `${Math.round(p[0] * 2000)},${Math.round(p[1] * 2000)},${Math.round(p[2] * 2000)}`;
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const t of tris) {
    const ks = [t.a, t.b, t.c].map((p) => `${t.mat}|${key(p)}`);
    for (const k of ks) if (!parent.has(k)) parent.set(k, k);
    parent.set(find(ks[0]), find(ks[1]));
    parent.set(find(ks[2]), find(ks[1]));
    t.piece = ks[0];
  }
  // Opposite-winding duplicates (the double-sided source layers) count once, by their outward copy.
  const best = new Map();
  for (const t of tris) {
    t.piece = find(t.piece);
    const area = Math.hypot(...cross(sub(t.b, t.a), sub(t.c, t.a)));
    const d = outwardDot(t) * area;
    const tk = `${t.mat}|${[t.a, t.b, t.c].map(key).sort().join('|')}`;
    const prev = best.get(tk);
    if (!prev || d > prev.d) best.set(tk, { d, piece: t.piece });
  }
  const score = new Map();
  for (const { d, piece } of best.values()) {
    const sc = score.get(piece) || [0, 0];
    sc[0] += d; sc[1] += Math.abs(d);
    score.set(piece, sc);
  }
  let n = 0;
  for (const t of tris) {
    const [sum, abs] = score.get(t.piece);
    t.twoSided = !t.inner && Math.abs(sum) < 0.6 * abs;
    if (t.twoSided) n++;
  }
  console.log(`two-sided pieces: ${n} triangles`);
}

// ---------------------------------------------------------------------------------------------
// 2b. Close what the game would show as holes, add the underbody and a gear lever.

const mkTri = (a, b, c, mat, extra = {}) => {
  const t = { a, b, c, mat, ...extra };
  t.c0 = [0, 1, 2].map((k) => (a[k] + b[k] + c[k]) / 3);
  t.n = norm(cross(sub(b, a), sub(c, a)));
  return t;
};
const added = [];

// Openings (grille holes, intakes, panel gaps): boundary loops of the outer skin, filled with a
// slightly recessed dark carbon/mesh panel. Wheel arches and the cabin opening stay open.
{
  const key = (p) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)},${Math.round(p[2] * 1000)}`;
  const pts = new Map();
  const id = (p) => { const k = key(p); if (!pts.has(k)) pts.set(k, { i: pts.size, p }); return pts.get(k).i; };
  const P = [];
  const seen = new Set();
  const faces = [];
  for (const t of tris) {
    if (t.inner) continue;
    const ids = [t.a, t.b, t.c].map(id);
    if (new Set(ids).size < 3) continue;
    const tk = [...ids].sort((a, b) => a - b).join(',');
    if (seen.has(tk)) continue; // double-sided copies
    seen.add(tk);
    faces.push(ids);
  }
  for (const { i, p } of pts.values()) P[i] = p;
  const edges = new Map();
  for (const f of faces) for (let k = 0; k < 3; k++) {
    const a = f[k]; const b = f[(k + 1) % 3];
    const ek = a < b ? `${a},${b}` : `${b},${a}`;
    const e = edges.get(ek) || { n: 0, a, b };
    e.n++;
    edges.set(ek, e);
  }
  const next = new Map();
  for (const e of edges.values()) if (e.n === 1) next.set(e.a, e.b);
  const used = new Set();
  let filled = 0;
  for (const start of next.keys()) {
    if (used.has(start)) continue;
    const loop = [];
    let v = start;
    while (v !== undefined && !used.has(v) && loop.length < 5000) { used.add(v); loop.push(v); v = next.get(v); }
    if (v !== start || loop.length < 3) continue;
    const L = loop.map((i) => P[i]);
    let per = 0;
    for (let k = 0; k < L.length; k++) per += Math.hypot(...sub(L[(k + 1) % L.length], L[k]));
    const c = [0, 1, 2].map((k) => L.reduce((s, p) => s + p[k], 0) / L.length);
    const span = [0, 1, 2].map((k) => Math.max(...L.map((p) => p[k])) - Math.min(...L.map((p) => p[k])));
    if (per < 0.08 || per > 4) continue;
    if (wheelCenters.some((w) => Math.abs(c[0]) > 0.45 && Math.hypot(c[1] - w[1], c[2] - w[2]) < 0.75)) continue;
    if (c[2] > 0.8 && c[1] > wsBaseY - 0.1 && c[1] < yR - 1.0 && Math.abs(c[0]) < 0.9) continue; // cabin opening
    if (span[1] > 1.6) continue;
    // Opening facing: Newell normal of the loop. Top-facing loops are panel seams on the hood/deck;
    // filling those leaves dark patches on the paint, so only front/rear/side/bottom openings get panels.
    const nl = [0, 0, 0];
    for (let k = 0; k < L.length; k++) {
      const p = L[k]; const q = L[(k + 1) % L.length];
      nl[0] += (p[1] - q[1]) * (p[2] + q[2]); nl[1] += (p[2] - q[2]) * (p[0] + q[0]); nl[2] += (p[0] - q[0]) * (p[1] + q[1]);
    }
    const nn = norm(nl);
    if (Math.abs(nn[2]) > 0.6 && c[2] > 0.45) continue;
    // Recess the panel 2.5 cm into the car.
    const o = [0, 1, 2].map((k) => (c[k] - CENTER[k]) / (RADII[k] * RADII[k]));
    const ol = Math.hypot(...o) || 1;
    const mid = [0, 1, 2].map((k) => c[k] - (o[k] / ol) * 0.025);
    if (process.env.NOFILL) continue;
    for (let k = 0; k < L.length; k++) added.push(mkTri(mid, L[(k + 1) % L.length], L[k], 'Grille', { twoSided: true }));
    filled++;
  }
  console.log(`openings closed: ${filled}`);
}

// Wheel wells: a closed half-drum over each wheel (open to the outside and the road), so nothing
// shows through around the game's wheels.
{
  const seg = 14;
  for (const w of wheelCenters) {
    const side = Math.sign(w[0]);
    const r = 0.42;
    const xOut = w[0] + side * 0.12;
    const xIn = w[0] - side * 0.3;
    const arc = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI; // 0 = front, π = back, over the top
      arc.push([w[1] - Math.cos(a) * r, w[2] + Math.sin(a) * r]);
    }
    for (let i = 0; i < seg; i++) {
      const [y0, z0] = arc[i]; const [y1, z1] = arc[i + 1];
      const a = [xIn, y0, z0]; const b = [xOut, y0, z0]; const c = [xOut, y1, z1]; const d = [xIn, y1, z1];
      added.push(mkTri(a, b, c, 'Underbody', { twoSided: true, inner: true }), mkTri(a, c, d, 'Underbody', { twoSided: true, inner: true }));
      added.push(mkTri([xIn, w[1], w[2] - 0.05], [xIn, y0, z0], [xIn, y1, z1], 'Underbody', { twoSided: true, inner: true }));
    }
  }
  console.log(`wheel wells closed: ${wheelCenters.length}`);
}

// Underbody: a flat panel under the car, inside the outline of the low body.
{
  const low = tris.filter((t) => !t.inner && t.c0[2] < 0.4);
  const xy = low.flatMap((t) => [t.a, t.b, t.c]).map((p) => [p[0] * 0.97, p[1] * 0.98]);
  xy.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const crossZ = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = []; const upper = [];
  for (const p of xy) { while (lower.length > 1 && crossZ(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (const p of [...xy].reverse()) { while (upper.length > 1 && crossZ(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  const z = Math.min(...low.map((t) => t.c0[2])) + 0.03;
  const c = [hull.reduce((s, p) => s + p[0], 0) / hull.length, hull.reduce((s, p) => s + p[1], 0) / hull.length, z];
  for (let k = 0; k < hull.length; k++) {
    const a = [...hull[k], z]; const b = [...hull[(k + 1) % hull.length], z];
    added.push(mkTri(c, b, a, 'Underbody', { twoSided: true }));
  }
  console.log(`underbody: ${hull.length}-sided panel at z ${z.toFixed(2)}`);
}

// Gear lever on the center tunnel between the seats.
{
  // Between the seats: a little behind the steering wheel.
  const y = steeringPos ? steeringPos[1] + 0.42 : (yF + yR) / 2 - 0.3;
  const tunnel = tris.filter((t) => t.inner && Math.abs(t.c0[0]) < 0.12 && Math.abs(t.c0[1] - y) < 0.12 && t.c0[2] < 0.85);
  const z = tunnel.length ? ext(tunnel, 2, Math.max) : 0.55;
  const box = (cx, cy, cz, sx, sy, sz, mat) => {
    const v = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]
      .map(([a, b, d]) => [cx + (a * sx) / 2, cy + (b * sy) / 2, cz + (d * sz) / 2]);
    for (const [a, b, d, e] of [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3]]) {
      added.push(mkTri(v[a], v[b], v[d], mat, { inner: true }), mkTri(v[a], v[d], v[e], mat, { inner: true }));
    }
  };
  box(0, y, z + 0.015, 0.16, 0.26, 0.03, 'Carbon_Fiber'); // console plate
  box(0, y + 0.03, z + 0.035, 0.07, 0.12, 0.012, 'metal_chrome'); // shift gate
  box(0, y + 0.03, z + 0.1, 0.014, 0.014, 0.13, 'metal_chrome'); // lever
  box(0, y + 0.03, z + 0.18, 0.045, 0.045, 0.045, 'Leather'); // knob
  console.log(`gear lever at y ${y.toFixed(2)}, z ${z.toFixed(2)}`);
}
tris.push(...added);

const slots = {};
for (const t of tris) (slots[slotOf(t)] ||= []).push(t);
for (const [k, v] of Object.entries(slots)) console.log(`  ${k.padEnd(12)} ${v.length} tris`);
if (process.env.DUMP_OBJ) {
  // Debug: raw slot triangles as OBJ (three.js axes) to check the split before simplification.
  let s = '';
  let n = 1;
  for (const [k, v] of Object.entries(slots)) {
    s += `o ${k}\n`;
    for (const t of v) {
      for (const p of [t.a, t.b, t.c]) s += `v ${p[0]} ${p[2]} ${-p[1]}\n`;
      s += `f ${n} ${n + 1} ${n + 2}\n`;
      n += 3;
    }
  }
  fs.writeFileSync(process.env.DUMP_OBJ, s);
}

// ---------------------------------------------------------------------------------------------
// 3. Palettes. Paint parts share the body "mask" palette (red = paint in game), lights get real colors.

// Body-mask palette. The game tints mask colors by the player's paint (red channel = paint), so
// anything that must stay dark (grilles, carbon, tires, underbody, interior) is pure black here;
// chrome keeps a little value so it reads as metal.
const MASK_COLORS = {
  Body_Color: [255, 0, 0], Wing: [255, 0, 0], Glass_Gray: [0, 0, 0], Grille: [0, 0, 0], Underbody: [0, 0, 0],
  Tires: [0, 0, 0], plastic_gray: [0, 0, 0], metal_gray: [28, 28, 28], metal_chrome: [56, 56, 56], Carbon_Fiber: [0, 0, 0],
  Leather: [0, 0, 0], Leather_red: [0, 0, 0], Carpet: [0, 0, 0], Interior_dark: [0, 0, 0], Interior_light: [0, 0, 0],
  Taillight_Glass: [0, 0, 0], Projector_Glass: [0, 0, 0], Turn_Signal_LED: [0, 0, 0], WingDark: [0, 0, 0],
};
const LIGHT_COLORS = {
  Projector_Glass: [232, 238, 244], Turn_Signal_LED: [255, 168, 40], metal_chrome: [205, 208, 214],
  metal_gray: [150, 152, 158], plastic_gray: [40, 40, 44], Taillight_Glass: [205, 18, 22],
};
function palette(colors) {
  const keys = Object.keys(colors);
  const cell = (k) => { const i = Math.max(0, keys.indexOf(k)); return [i % 8, Math.floor(i / 8)]; };
  return { keys, colors, uv: (k) => { const [cx, cy] = cell(k); return [(cx + 0.5) / 8, (cy + 0.5) / 8]; } };
}
const MASK = palette(MASK_COLORS);
const LIGHT = palette(LIGHT_COLORS);

async function writeTexture(pal, file) {
  const px = Buffer.alloc(64 * 64 * 4);
  pal.keys.forEach((k, i) => {
    const [r, g, b] = pal.colors[k];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const o = (((Math.floor(i / 8) * 8 + y) * 64) + (i % 8) * 8 + x) * 4;
      px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
    }
  });
  await sharp(px, { raw: { width: 64, height: 64, channels: 4 } }).png().toFile(file + '.png');
  // "_s" copy: half size, uncompressed 32-bit DDS (B8G8R8A8).
  const half = await sharp(px, { raw: { width: 64, height: 64, channels: 4 } }).resize(32, 32, { kernel: 'nearest' }).raw().toBuffer();
  const hdr = Buffer.alloc(128);
  hdr.write('DDS ', 0, 'ascii');
  const u32 = (o, v) => hdr.writeUInt32LE(v >>> 0, o);
  u32(4, 124); u32(8, 0x1 | 0x2 | 0x4 | 0x1000 | 0x8); u32(12, 32); u32(16, 32); u32(20, 32 * 4);
  u32(76, 32); u32(80, 0x41); u32(88, 32); u32(92, 0x00ff0000); u32(96, 0x0000ff00); u32(100, 0x000000ff); u32(104, 0xff000000);
  u32(108, 0x1000);
  const bgra = Buffer.from(half);
  for (let i = 0; i < bgra.length; i += 4) { const r = bgra[i]; bgra[i] = bgra[i + 2]; bgra[i + 2] = r; }
  fs.writeFileSync(file + '_s.dds', Buffer.concat([hdr, bgra]));
}

// ---------------------------------------------------------------------------------------------
// 4. Simplification per material group, normals with crease splitting.

await MeshoptSimplifier.ready;


function weld(list) {
  const map = new Map();
  const pos = [];
  const idx = [];
  const key = (p) => `${Math.round(p[0] * 2000)},${Math.round(p[1] * 2000)},${Math.round(p[2] * 2000)}`;
  // The source is modeled double-sided: every panel exists twice with opposite winding. Keep only the
  // copy facing away from the car center, otherwise the two layers simplify differently and leave holes.
  const seen = new Map();
  for (const t of list) {
    const ids = [t.a, t.b, t.c].map((p) => {
      const k = key(p);
      let i = map.get(k);
      if (i === undefined) { i = pos.length / 3; map.set(k, i); pos.push(p[0], p[1], p[2]); }
      return i;
    });
    if (ids[0] === ids[1] || ids[1] === ids[2] || ids[0] === ids[2]) continue;
    const tk = [...ids].sort((x, y) => x - y).join(',');
    const out = outwardDot(t) * Math.hypot(...cross(sub(t.b, t.a), sub(t.c, t.a)));
    const prev = seen.get(tk);
    if (!prev || out > prev.out) seen.set(tk, { ids, out });
  }
  // The game draws one side only. Flip whole connected pieces (keeping their winding consistent)
  // when most of their area faces into the car.
  const parent = new Int32Array(pos.length / 3).map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (const { ids } of seen.values()) { parent[find(ids[0])] = find(ids[1]); parent[find(ids[2])] = find(ids[1]); }
  const score = new Map();
  for (const { ids, out } of seen.values()) { const r = find(ids[0]); score.set(r, (score.get(r) || 0) + out); }
  for (const { ids } of seen.values()) {
    if (score.get(find(ids[0])) < 0) idx.push(ids[0], ids[2], ids[1]);
    else idx.push(...ids);
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}

// lod 2: open edges (panel seams) locked so nothing tears; lods 1/0: free collapse within an error
// bound (relative to the part size), small cracks are acceptable at distance.
// Error bounds per LOD (null = locked borders). Interior materials are seen through tinted glass only.
const LOD_ERR = [null, null, null];
const LOD_ERR_INTERIOR = [0.1, 0.05, 0.025]; // undefined = dropped
const INTERIOR = /leather|carpet|carbon|interior/i;
const LOD_MIN_PIECE = [0.2, 0.05, 0.015]; // drop separate pieces smaller than this (m) per LOD

// Removes connected pieces whose bounding box is smaller than `minSize` (bolts, LEDs, stitching...).
function dropSmallPieces(pos, idx, minSize) {
  const parent = new Int32Array(pos.length / 3).map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let t = 0; t < idx.length; t += 3) {
    const a = find(idx[t]); const b = find(idx[t + 1]); const c = find(idx[t + 2]);
    parent[a] = b; parent[find(c)] = find(b);
  }
  const box = new Map();
  for (let v = 0; v < pos.length / 3; v++) {
    const r = find(v);
    const bx = box.get(r) || [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let k = 0; k < 3; k++) { bx[k] = Math.min(bx[k], pos[v * 3 + k]); bx[k + 3] = Math.max(bx[k + 3], pos[v * 3 + k]); }
    box.set(r, bx);
  }
  const keep = (v) => { const bx = box.get(find(v)); return Math.max(bx[3] - bx[0], bx[4] - bx[1], bx[5] - bx[2]) >= minSize; };
  const out = [];
  for (let t = 0; t < idx.length; t += 3) if (keep(idx[t])) out.push(idx[t], idx[t + 1], idx[t + 2]);
  return new Uint32Array(out);
}

// Vertex clustering: snap vertices to a grid, drop collapsed triangles. Coarse but reaches any target,
// used for inner panels where tiny pieces stop edge-collapse simplification.
function clusterSimplify(pos, idx, targetTris) {
  let best = idx;
  for (const cell of [0.01, 0.015, 0.02, 0.025, 0.03]) { // capped so panels can't drift through the skin
    const map = new Map();
    const remap = new Uint32Array(pos.length / 3);
    for (let v = 0; v < pos.length / 3; v++) {
      const k = `${Math.round(pos[v * 3] / cell)},${Math.round(pos[v * 3 + 1] / cell)},${Math.round(pos[v * 3 + 2] / cell)}`;
      let r = map.get(k);
      if (r === undefined) { r = v; map.set(k, v); }
      remap[v] = r;
    }
    const seen = new Set();
    const out = [];
    for (let t = 0; t < idx.length; t += 3) {
      const a = remap[idx[t]]; const b = remap[idx[t + 1]]; const c = remap[idx[t + 2]];
      if (a === b || b === c || a === c) continue;
      const key = [a, b, c].sort((x, y) => x - y).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(a, b, c);
    }
    best = new Uint32Array(out);
    if (best.length / 3 <= targetTris) break;
  }
  return best;
}

function simplifyGroup(list, targetTris, lod, interior = false, attempt = 0, twoSided = false) {
  if (interior && LOD_ERR_INTERIOR[lod] === undefined) return { pos: new Float32Array(), idx: new Uint32Array() };
  const welded = weld(list);
  const pos = welded.pos;
  const idx = dropSmallPieces(pos, welded.idx, LOD_MIN_PIECE[lod] * (1 + attempt));
  const err = interior ? LOD_ERR_INTERIOR[lod] * (1 + attempt) : LOD_ERR[lod];
  const lock = err === null || LOCK;
  let out = idx.length / 3 <= targetTris ? idx
    : MeshoptSimplifier.simplify(idx, pos, 3, Math.max(3, targetTris * 3), lock ? 1 : err, lock ? ['LockBorder'] : [])[0];
  if (interior && out.length / 3 > targetTris) out = clusterSimplify(pos, out, Math.round(targetTris / (1 + attempt)));
  if (!interior && !twoSided) return { pos, idx: out, ref: idx };
  // Interior and ambiguous pieces are seen from any side: add the back faces after simplifying.
  const both = new Uint32Array(out.length * 2);
  both.set(out);
  for (let t = 0; t < out.length; t += 3) both.set([out[t], out[t + 2], out[t + 1]], out.length + t);
  return { pos, idx: both, ref: idx };
}

// Smooth normals, but split vertices where faces meet at more than `crease` degrees.
// Normals from the detailed source surface: for every vertex, the source faces around it are grouped
// into smoothing groups (split at hard edges); each corner of the simplified mesh takes the group
// closest to its face. The low-poly mesh then shades like the original instead of showing facets.
function sourceNormals(pos, refIdx, crease = 50) {
  const groups = new Map(); // vertex -> [{ n: [x,y,z] (area-weighted sum) }]
  const cos = Math.cos((crease * Math.PI) / 180);
  for (let t = 0; t < refIdx.length; t += 3) {
    const a = refIdx[t] * 3; const b = refIdx[t + 1] * 3; const c = refIdx[t + 2] * 3;
    const n = cross([pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]],
      [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]]);
    const u = norm(n);
    for (let k = 0; k < 3; k++) {
      const v = refIdx[t + k];
      let list = groups.get(v);
      if (!list) groups.set(v, (list = []));
      const g = list.find((x) => { const m = norm(x); return m[0] * u[0] + m[1] * u[1] + m[2] * u[2] >= cos; });
      if (g) { g[0] += n[0]; g[1] += n[1]; g[2] += n[2]; } else list.push([...n]);
    }
  }
  return groups;
}

function withNormals(pos, idx, crease = 45, refIdx = null) {
  const ref = refIdx ? sourceNormals(pos, refIdx) : null;
  const refCos = Math.cos((30 * Math.PI) / 180);
  const nt = idx.length / 3;
  const fn = new Float32Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3] * 3; const b = idx[t * 3 + 1] * 3; const c = idx[t * 3 + 2] * 3;
    const n = cross([pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]],
      [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]]);
    fn.set(n, t * 3); // area weighted
  }
  const faces = new Map();
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
    const v = idx[t * 3 + k];
    if (!faces.has(v)) faces.set(v, []);
    faces.get(v).push(t);
  }
  const cos = Math.cos((crease * Math.PI) / 180);
  const P = [];
  const N = [];
  const I = new Array(idx.length);
  const fnUnit = (t) => norm([fn[t * 3], fn[t * 3 + 1], fn[t * 3 + 2]]);
  const cache = new Map();
  for (let t = 0; t < nt; t++) {
    const ft = fnUnit(t);
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k];
      let n = null;
      if (ref && ref.has(v)) {
        let best = -2;
        for (const g of ref.get(v)) {
          const m = norm(g);
          const d = m[0] * ft[0] + m[1] * ft[1] + m[2] * ft[2];
          if (d > best) { best = d; n = m; }
        }
        if (best < refCos) n = null;
      }
      if (!n) {
        const group = faces.get(v).filter((o) => { const fo = fnUnit(o); return fo[0] * ft[0] + fo[1] * ft[1] + fo[2] * ft[2] >= cos; });
        let s = [0, 0, 0];
        for (const o of group) s = [s[0] + fn[o * 3], s[1] + fn[o * 3 + 1], s[2] + fn[o * 3 + 2]];
        n = norm(s);
      }
      const key = `${v}|${n.map((x) => x.toFixed(2)).join(',')}`;
      let ni = cache.get(key);
      if (ni === undefined) {
        ni = P.length / 3;
        cache.set(key, ni);
        P.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
        N.push(...n);
      }
      I[t * 3 + k] = ni;
    }
  }
  return { positions: P, normals: N, indices: I };
}

// Simplify a slot's triangles to `budget` and return .0m parts (one submesh per material).
// .0m files hold u16 counts: retry with coarser settings until the slot fits.
function buildSlot(list, budget, pal, lod = 2) {
  for (let attempt = 0; ; attempt++) {
    const parts = buildSlotOnce(list, budget, pal, lod, attempt);
    const nv = parts.reduce((s, q) => s + q.positions.length / 3, 0);
    const ni = parts.reduce((s, q) => s + q.indices.length, 0);
    if ((nv <= 65000 && ni <= 65000) || attempt >= 8) return parts;
  }
}

function buildSlotOnce(list, budget, pal, lod, attempt) {
  const byMat = new Map();
  for (const t of list) {
    const k = t.twoSided ? `${t.mat}|2s` : t.mat;
    if (!byMat.has(k)) byMat.set(k, []);
    byMat.get(k).push(t);
  }
  const total = list.length;
  const parts = [];
  for (const [key, group] of byMat) {
    const mat = key.replace(/\|2s$/, '');
    const twoSided = key.endsWith('|2s');
    const target = Math.max(4, Math.round((budget * SCALE * group.length) / total));
    const { pos, idx, ref } = simplifyGroup(group, target, lod, INTERIOR.test(mat), attempt, twoSided);
    if (process.env.DEBUG) console.log(`    lod${lod} ${mat.padEnd(16)} src ${group.length} target ${target} got ${idx.length / 3}`);
    if (idx.length < 3) continue;
    const g = withNormals(pos, idx, 45, ref);
    const [u, v] = pal.uv(pal.colors[mat] ? mat : pal.keys[0]);
    // Submesh kind (flags[0]) tells the game to draw glass and lamps as such.
    const kind = /^Glass/i.test(mat) ? 1 : /projector/i.test(mat) ? 2 : /taillight/i.test(mat) ? 3 : /led/i.test(mat) ? 4 : 0;
    parts.push({ name: mat, kind, ...g, uvs: g.positions.flatMap((_, i) => (i % 3 === 0 ? [u, v] : [])) });
  }
  return parts;
}

// Procedural rear wings for the spoiler slot (the source car has none). Returns triangles.
function boxTris(cx, cy, cz, sx, sy, sz, mat, tilt = 0) {
  const out = [];
  const c = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]].map(([a, b, d]) => {
    let y = (b * sy) / 2;
    let z = (d * sz) / 2;
    const yy = y * Math.cos(tilt) - z * Math.sin(tilt);
    const zz = y * Math.sin(tilt) + z * Math.cos(tilt);
    y = yy; z = zz;
    return [cx + (a * sx) / 2, cy + y, cz + z];
  });
  for (const [a, b, d, e] of [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3]]) {
    out.push({ a: c[a], b: c[b], c: c[d], mat }, { a: c[a], b: c[d], c: c[e], mat });
  }
  return out;
}
function wing(kind) {
  const y = yR - 0.32;
  const span = { lip: 1.5, wing: 1.65, gt: 1.85, twin: 1.75 }[kind];
  const h = { lip: 0.03, wing: 0.16, gt: 0.3, twin: 0.22 }[kind];
  const out = [];
  if (kind === 'lip') return boxTris(0, y + 0.12, rearDeckZ + 0.03, span, 0.12, 0.03, 'Wing', -0.3);
  out.push(...boxTris(0, y, rearDeckZ + h, span, 0.26, 0.03, kind === 'gt' ? 'WingDark' : 'Wing', 0.12));
  if (kind === 'twin') out.push(...boxTris(0, y - 0.2, rearDeckZ + h - 0.08, span * 0.9, 0.12, 0.02, 'WingDark', 0.1));
  for (const s of [1, -1]) {
    out.push(...boxTris(s * span * 0.3, y, rearDeckZ + h / 2, 0.03, 0.08, h, 'WingDark'));
    out.push(...boxTris(s * span / 2, y, rearDeckZ + h + 0.02, 0.012, 0.3, 0.13, 'WingDark'));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// 5. Write the folder.

const BUDGET = { // [LOD0, LOD1, LOD2] triangles, roughly 2–3× the original car (LOD2 total ≈ 7k)
  body: [500, 1400, 2800], frontbumper: [180, 500, 1100], rearbumper: [180, 500, 1100],
  headlight: [40, 300, 700], rearlight: [60, 220, 500], hood: [40, 130, 300], roof: [100, 250, 500],
  skirt: [60, 140, 300],
};
const SLOT_DIRS = ['frontbumper', 'headlight', 'hood', 'mainspoiler', 'rearbumper', 'rearlight', 'roof', 'skirt'];
const tplName = path.basename(path.resolve(TPL));
fs.mkdirSync(OUT, { recursive: true });
const readOM = (f) => { const b = fs.readFileSync(f); return parseOM(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); };
const xmlUtf16 = (text) => Buffer.from(encodeSpec(text));
const readXml = (f) => decodeSpec(fs.readFileSync(f));
const report = [];

function writeLods(dir, mesh, tplMesh, partsByLod) {
  for (let l = 0; l < 3; l++) {
    const tpl = readOM(path.join(TPL, dir, `${tplMesh}_${l}.0m`));
    const bytes = writeOM(tpl, partsByLod[l]);
    fs.writeFileSync(path.join(OUT, dir, `${mesh}_${l}.0m`), bytes);
  }
  const tri = partsByLod.map((ps) => ps.reduce((s, q) => s + q.indices.length / 3, 0));
  report.push(`${(dir || 'body').padEnd(12)} ${mesh.padEnd(10)} LOD0/1/2 ${tri.join(' / ')} tris`);
}

// Body
writeLods('', 'body', 'body', [0, 1, 2].map((l) => buildSlot(slots.body, BUDGET.body[l], MASK, l)));
await writeTexture(MASK, path.join(OUT, `${NAME}_base`));
await writeTexture(MASK, path.join(OUT, `${NAME}_color`));

for (const dir of SLOT_DIRS) {
  fs.mkdirSync(path.join(OUT, dir), { recursive: true });
  const list = readXml(path.join(TPL, dir, 'list.xml'));
  const variants = [...list.matchAll(/<part\b[^>]*name='([^']*)'[^>]*mesh='([^']*)'[^>]*>/g)].map((m) => ({ name: m[1], mesh: m[2] }));
  const tplMesh = fs.existsSync(path.join(TPL, dir, 'default_0.0m')) ? 'default' : variants[0].mesh;
  const isLightSlot = dir === 'headlight' || dir === 'rearlight';
  const tex = isLightSlot ? `${NAME}_${dir}` : '';
  let meshFor;
  if (dir === 'mainspoiler') {
    const kinds = { pty_h300: 'lip', m10010: 'wing', h11000: 'gt', rbrc_001: 'twin', rbrc_002: 'wing' };
    for (const v of variants) {
      const kind = kinds[v.name] || 'wing';
      const src = wing(kind);
      for (const t of src) {
        t.c0 = [0, 1, 2].map((k) => (t.a[k] + t.b[k] + t.c[k]) / 3);
        t.n = norm(cross(sub(t.b, t.a), sub(t.c, t.a)));
      }
      writeLods(dir, v.mesh, tplMesh, [0, 1, 2].map(() => buildSlot(src, 400, MASK)));
    }
    meshFor = (v) => v.mesh;
  } else {
    const src = slots[dir] || [];
    if (!src.length) { console.warn(`! no triangles for ${dir}`); continue; }
    const pal = isLightSlot ? LIGHT : MASK;
    writeLods(dir, 'default', tplMesh, [0, 1, 2].map((l) => buildSlot(src, BUDGET[dir][l], pal, l)));
    if (isLightSlot) await writeTexture(LIGHT, path.join(OUT, dir, tex));
    meshFor = () => 'default'; // every shop variant shows the stock part
  }
  // list.xml: keep the template's ids and names so tuning items still resolve.
  const out = list.replace(/<part\b([^>]*)\/>/g, (all, attrs) => {
    const name = /name='([^']*)'/.exec(attrs)?.[1];
    if (!name) return all;
    const v = variants.find((x) => x.name === name);
    let a = attrs;
    if (/mesh='/.test(a)) a = a.replace(/mesh='[^']*'/, `mesh='${meshFor(v)}'`);
    if (/tex='/.test(a)) a = a.replace(/tex='[^']*'/, `tex='${tex}'`);
    return `<part${a}/>`;
  });
  fs.writeFileSync(path.join(OUT, dir, 'list.xml'), xmlUtf16(out));
}

// dooropen: same door timing as the template
fs.mkdirSync(path.join(OUT, 'dooropen'), { recursive: true });
for (const f of fs.readdirSync(path.join(TPL, 'dooropen'))) fs.copyFileSync(path.join(TPL, 'dooropen', f), path.join(OUT, 'dooropen', f));

// mesh.xml: the template's 14-vertex collision hull, stretched to this car's bounds.
{
  const text = readXml(path.join(TPL, 'mesh.xml'));
  const vs = [...text.matchAll(/pos="([^"]+)"/g)].map((m) => m[1].split(/\s+/).map(Number));
  const mn = [0, 1, 2].map((k) => Math.min(...vs.map((v) => v[k])));
  const mx = [0, 1, 2].map((k) => Math.max(...vs.map((v) => v[k])));
  const body = slots.body.concat(slots.frontbumper || [], slots.rearbumper || []);
  const bmn = [0, 1, 2].map((k) => ext(body, k, Math.min));
  const bmx = [0, 1, 2].map((k) => ext(body, k, Math.max));
  // The game hull sits ~0.2 m above the body's bottom; keep that gap.
  const out = text.replace(/pos="([^"]+)"/g, (_, s) => {
    const v = s.split(/\s+/).map(Number);
    const r = v.map((c, k) => {
      const f = (c - mn[k]) / (mx[k] - mn[k] || 1);
      const lo = k === 2 ? bmn[2] + 0.2 : bmn[k];
      return (lo + f * (bmx[k] - lo)).toFixed(10);
    });
    return `pos="${r.join(' ')}"`;
  });
  fs.writeFileSync(path.join(OUT, 'mesh.xml'), xmlUtf16(out));
}

// Spec: template spec with values for a mid-engine V8 supercar.
{
  const specFile = SPEC || path.join(TPL, `${tplName}.xml`);
  if (fs.existsSync(specFile)) {
    const text = readXml(specFile);
    const v = readSpec(text);
    Object.assign(v, { BD_Mass: '1380', BD_Offset: '0 0.1 0.45', EG_Torque: '105', EG_Drag: '0.36', MS_TractionRadius: '0.27' });
    fs.writeFileSync(path.join(OUT, `${NAME}.xml`), xmlUtf16(writeSpec(text, v)));
  } else {
    console.warn(`! spec template not found (${specFile}), skipped ${NAME}.xml`);
  }
}

console.log(report.join('\n'));
console.log(`done → ${OUT}`);
