// Builds a RayCity car folder (same layout as an original car) from a realistic glTF/GLB model.
//
//   node tools/build-car.mjs <model.glb> <template-car-folder> <out-dir> [--name rc_car] [--spec template.xml] [--keep-logos]
//
// - Splits the model into the game's tunable parts (body, hood, roof, bumpers, lights, skirt) by region
//   and material, adds procedural rear wings for the spoiler slot.
// - Simplifies every part to three LODs with meshoptimizer, budgets close to the original cars.
// - Bakes material colors into palette textures (PNG + DXT3 "_s" DDS, sizes like the template's).
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
import { ShapeUtils, Vector2 } from 'three';
import { parseOM, writeOM, matchTemplateSubmeshes } from '../js/om.js';
import { unwrapParts, makeReference, bakeAtlas, materialAt, transferNormals } from './bake.mjs';
import { buildHull } from './hull.mjs';
import { readSpec, writeSpec, encodeSpec, decodeSpec } from '../js/carSpec.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : d; };
const NAME = opt('--name', 'rc_car');
const SPEC = opt('--spec', '');
const LOCK = opt('--lock', '0') === '1';
const SCALE = Number(opt('--budget', '1'));
const flag = (f) => args.includes(f) && Boolean(args.splice(args.indexOf(f), 1));
// --raw: as close to the source as the format allows. Nothing added (hole fills, wheel wells, underbody,
// gear lever), nothing removed but the wheels, source normals and double-sided flags kept; only
// simplification, spread over every part file so the most detail fits.
const RAW = flag('--raw');
// --bake: low-poly parts with a baked detail texture (tools/bake.mjs). Badges and small details come
// from the source model through the texture, so the meshes can be as light as the game's own cars.
const BAKE = flag('--bake') && !RAW;
const ATLAS = Number(opt('--atlas', '1024'));
const SAME_LODS = BAKE && opt('--same-lods', '1') === '1';
const KEEP_LOGOS = flag('--keep-logos') || RAW || BAKE;
// --max-verts N: hard cap of vertices per .0m file (the game's own files stay under ~2,000).
const MAX_VERTS = Math.min(65000, Number(opt('--max-verts', BAKE ? '2000' : '65000')));
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

// Source materials are mapped to a few canonical categories, so any model works:
//   paint, glass, head(light lens), tail(light), indicator, chrome, metal, trim (plastic/rubber),
//   carbon, interior; logos/badges/plates and wheels/tires/brakes are skipped.
// The canonical names below are what the rest of the builder works with.
const CANON = [
  [/^plate$|license/i, RAW ? 'plastic_gray' : null], // the game draws its own number plate
  [/logo|badge|emblem|costura|icons?$/i, KEEP_LOGOS ? 'metal_chrome' : null],
  [/tyre|tire|break|brake|rim|wheel/i, null],
  [/window|^glass(_t|_gray)?$|windshield/i, 'Glass_Gray'],
  [/glass_light|projector|glass_fog|headl|fog/i, 'Projector_Glass'],
  [/red_glass|taillight|tail_light|brakelight|rear.?light/i, 'Taillight_Glass'],
  [/oraange|orange|amber|turn|indicator|led/i, 'Turn_Signal_LED'],
  [/carpaint|car_paint|body_color|bodypaint|paint/i, 'Body_Color'],
  [/leather|seat|floor|carpet|console|ceiling|speaker|bose|stitch|screen|^st_sw|interior|dash|headliner/i, 'Interior_dark'],
  [/carbon/i, 'Carbon_Fiber'],
  [/chrome|gold|mirror/i, 'metal_chrome'],
  [/alum|metal|steel/i, 'metal_gray'],
  [/.*/, 'plastic_gray'],
];
const canon = (name) => CANON.find(([re]) => re.test(name))[1];

// Meshes we never export: wheels (shared in game) and badges. Inner panels (floor, dash, door cards)
// are kept: without them the car is see-through in game.
const SKIP_NODE = RAW ? /^(wheel|rim_root)/i
  : KEEP_LOGOS ? /^(wheel|rim_root|steering|centre)|plates?(\.|_|$)/i
  : /^(wheel|rim_root|steering|blue|yellow_trim|centre)|logo|badge|emblem|plates?(\.|_|$)/i;
const wheelCenters = [];
let steeringPos = null; // used to place the gear lever
const worldPos = (node) => { const m = node.getWorldMatrix(); return [-m[12], m[14], m[13]]; };
doc.getRoot().getDefaultScene().traverse((node) => {
  if (/^wheel_?[fr][lr]?$|^wheel_[fr]/i.test(node.getName())) wheelCenters.push({ name: node.getName(), p: worldPos(node) });
  if (/^steering_wheel$/i.test(node.getName())) steeringPos = worldPos(node);
});
// Front of the car must be −Y: if the front wheels sit at +Y, turn the model around.
const frontW = wheelCenters.filter((w) => /^wheel_?f/i.test(w.name));
const rearW = wheelCenters.filter((w) => /^wheel_?r/i.test(w.name));
const FLIP = frontW.length && rearW.length
  && frontW.reduce((s, w) => s + w.p[1], 0) / frontW.length > rearW.reduce((s, w) => s + w.p[1], 0) / rearW.length;
const orient = (p) => (FLIP ? [-p[0], -p[1], p[2]] : p);
for (const w of wheelCenters) w.p = orient(w.p);
if (steeringPos) steeringPos = orient(steeringPos);
console.log(`wheels: ${wheelCenters.length}${FLIP ? ' (model turned around: front was +Y)' : ''}`);

// Source material looks for baking: base color factor and decoded base color texture.
const srcMats = new Map();
for (const m of doc.getRoot().listMaterials()) {
  const rec = { factor: m.getBaseColorFactor(), alphaMode: m.getAlphaMode(), tex: null };
  const t = BAKE && m.getBaseColorTexture();
  if (t && t.getImage()) {
    try {
      const { data, info } = await sharp(Buffer.from(t.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      rec.tex = { w: info.width, h: info.height, data };
    } catch { /* unreadable image: factor only */ }
  }
  srcMats.set(m, rec);
}
const DEFAULT_MAT = { factor: [0.5, 0.5, 0.5, 1], alphaMode: 'OPAQUE', tex: null };
const DETAIL = /logo|badge|emblem|costura|icons?$/i;

const tris = []; // { a, b, c (float3 arrays), mat (canonical), inner }
const skipped = new Map();
doc.getRoot().getDefaultScene().traverse((node) => {
  let detailNode = false;
  for (let n = node; n; n = n.getParentNode()) {
    if (SKIP_NODE.test(n.getName())) return;
    if (/logo|badge|emblem/i.test(n.getName())) detailNode = true;
  }
  const mesh = node.getMesh();
  if (!mesh) return;
  const m = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    const srcMat = prim.getMaterial()?.getName() || 'default';
    const mat = canon(srcMat);
    if (!mat) { skipped.set(srcMat, (skipped.get(srcMat) || 0) + 1); continue; }
    const inner = mat === 'Interior_dark';
    const ds = Boolean(prim.getMaterial()?.getDoubleSided());
    const nrmAttr = prim.getAttribute('NORMAL');
    const uvAttr = BAKE ? prim.getAttribute('TEXCOORD_0') : null;
    const src = srcMats.get(prim.getMaterial()) || DEFAULT_MAT;
    const detail = BAKE && (detailNode || DETAIL.test(srcMat));
    const pos = prim.getAttribute('POSITION');
    const idx = prim.getIndices();
    const v = [];
    const P = [];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v);
      const x = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12];
      const y = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13];
      const z = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
      P.push(orient([-x, z, y]));
    }
    const NR = [];
    if (nrmAttr) {
      for (let i = 0; i < nrmAttr.getCount(); i++) {
        nrmAttr.getElement(i, v);
        const x = m[0] * v[0] + m[4] * v[1] + m[8] * v[2];
        const y = m[1] * v[0] + m[5] * v[1] + m[9] * v[2];
        const z = m[2] * v[0] + m[6] * v[1] + m[10] * v[2];
        const l = Math.hypot(x, y, z) || 1;
        NR.push(orient([-x / l, z / l, y / l]));
      }
    }
    const I = idx ? idx.getArray() : P.map((_, i) => i);
    for (let t = 0; t + 2 < I.length; t += 3) {
      const tri = { a: P[I[t]], b: P[I[t + 1]], c: P[I[t + 2]], mat, inner, ds };
      if (NR.length) tri.vn = [NR[I[t]], NR[I[t + 1]], NR[I[t + 2]]];
      if (BAKE) {
        tri.src = src;
        tri.detail = detail;
        if (uvAttr) tri.uv = [I[t], I[t + 1], I[t + 2]].map((i) => uvAttr.getElement(i, []));
      }
      tris.push(tri);
    }
  }
});
if (skipped.size) console.log(`skipped materials: ${[...skipped.keys()].join(', ')}`);
console.log(`source: ${tris.length} triangles`);
// Bake reference: the whole source as loaded (badges, interior...); the low-poly car leaves the
// small details out, they come back through the texture.
const REF = BAKE ? tris.map((t) => ({ a: t.a, b: t.b, c: t.c, mat: t.mat, src: t.src, uv: t.uv, vn: t.vn })) : null;
if (BAKE) for (let i = tris.length - 1; i >= 0; i--) if (tris[i].detail) tris.splice(i, 1);

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
// Everything below was tuned on a 4.5 m long, 1.24 m tall supercar: heights scale with the car's
// height (zs), lengths with its length (ys), so SUVs and pickups split the same way.
const H = ext(bodyTris, 2, Math.max);
const zs = (v) => (v * H) / 1.24;
const ys = (v) => (v * (yR - yF)) / 4.52;
const W_R = wheelCenters.length ? wheelCenters.reduce((s, w) => s + w.p[2], 0) / wheelCenters.length : zs(0.36); // wheel radius ≈ axle height
const glass = tris.filter((t) => t.mat === 'Glass_Gray');
// Windshield base: front-most glass above the headlight covers.
const wsBaseY = ext(glass.filter((t) => t.c0[1] < (yF + yR) / 2 && t.c0[2] > zs(0.88)), 1, Math.min);
const glassTop = ext(glass, 2, Math.max);
const rearDeckZ = ext(bodyTris.filter((t) => t.c0[1] > yR - ys(0.5) && t.c0[1] < yR - ys(0.2)), 2, Math.max);
console.log(`length ${(yR - yF).toFixed(2)} m, height ${H.toFixed(2)} m, windshield base y ${wsBaseY.toFixed(2)}, roof ${glassTop.toFixed(2)}, deck ${rearDeckZ.toFixed(2)}`);

// Outward direction at a point: gradient of an ellipsoid around the car (so the roof faces up,
// the sides sideways and the nose forward).
const CENTER = [0, (yF + yR) / 2, zs(0.55)];
const RADII = [1.0, (yR - yF) / 2, zs(0.6)];
const outwardDot = (t) => [0, 1, 2].reduce((s, k) => s + t.n[k] * ((t.c0[k] - CENTER[k]) / (RADII[k] * RADII[k])), 0);

const isLight = (t) => /projector|led|taillight/i.test(t.mat);
const headBox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
const tailBox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
const grow = (bx, t) => { for (let k = 0; k < 3; k++) { bx.min[k] = Math.min(bx.min[k], t.c0[k]); bx.max[k] = Math.max(bx.max[k], t.c0[k]); } };
const inBox = (bx, t, pad) => [0, 1, 2].every((k) => t.c0[k] >= bx.min[k] - pad && t.c0[k] <= bx.max[k] + pad);
for (const t of tris) {
  if (/projector|led/i.test(t.mat) && t.c0[1] < yF + ys(0.6)) grow(headBox, t);
  if (/taillight/i.test(t.mat) && t.c0[1] > yR - ys(0.5)) grow(tailBox, t);
}

// Between the wheels (for side skirts).
const axleYs = wheelCenters.map((w) => w.p[1]);
const axleSpan = (y) => (axleYs.length
  ? y > Math.min(...axleYs) + W_R * 1.2 && y < Math.max(...axleYs) - W_R * 1.2
  : y > ys(-0.75) && y < ys(1.05));

function slotOf(t) {
  const [x, y, z] = t.c0;
  const ax = Math.abs(x);
  if (/projector|led/i.test(t.mat) && y < yF + ys(0.6)) return 'headlight';
  if (/taillight/i.test(t.mat) && y > yR - ys(0.5)) return 'rearlight';
  if (/chrome|metal|plastic/i.test(t.mat) && inBox(headBox, t, 0.03)) return 'headlight';
  if (/chrome|metal|plastic/i.test(t.mat) && inBox(tailBox, t, 0.03)) return 'rearlight';
  if (isLight(t)) return 'body';
  if (/glass/i.test(t.mat)) return 'body';
  if (t.mat === 'Body_Color' && y > wsBaseY + ys(0.25) && y < yR - ys(1.4) && z > glassTop - zs(0.14) && t.n[2] > 0.5) return 'roof';
  if (t.mat === 'Body_Color' && y > yF + ys(0.5) && y < wsBaseY - 0.03 && ax < 0.6 && z > zs(0.55) && t.n[2] > 0.5) return 'hood';
  if (y < yF + ys(0.5) && z < zs(0.78)) return 'frontbumper';
  if (y > yR - ys(0.42) && z < zs(0.82)) return 'rearbumper';
  if (z < zs(0.42) && ax > 0.78 && axleSpan(y)) return 'skirt';
  return 'body';
}
if (!RAW) // (--raw keeps everything)
// Inner panels: keep only what closes visible holes — the cabin tub (floor, dash, door cards)
// and the underbody. Engine bay and bumper internals would poke through the skin.
{
  const before = tris.length;
  const keepInner = (t) => {
    const [x, y, z] = t.c0;
    if (y > wsBaseY - ys(0.25) && y < yR - ys(1.3) && Math.abs(x) < 0.85 && z < zs(1.15)) return true;
    // Wheel-arch liners come from the generated wheel wells below: the source liners sit right under
    // the fender skin and poke through it once simplified.
    return z < zs(0.22);
  };
  for (let i = tris.length - 1; i >= 0; i--) if (tris[i].inner && !keepInner(tris[i])) tris.splice(i, 1);
  console.log(`inner panels: kept ${tris.filter((t) => t.inner).length}, dropped ${before - tris.length} (wheels at ${wheelCenters.map((w) => w.p.map((v) => v.toFixed(2)).join(',')).join(' / ')})`);
}

// Remove badges/lettering: small separate pieces near the centerline at the nose or tail.
if (!RAW) {
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
  if (KEEP_LOGOS) boxes.clear();
  for (const [r, bx] of boxes) {
    const size = Math.max(...[0, 1, 2].map((k) => bx.max[k] - bx.min[k]));
    const cx = (bx.min[0] + bx.max[0]) / 2;
    const cy = (bx.min[1] + bx.max[1]) / 2;
    if (size < 0.14 && Math.abs(cx) < 0.2 && (cy < yF + 0.35 || cy > yR - 0.35)) badge.add(r);
    // Lettering stuck on the sides (model names on doors/fenders): very thin, short, on the flanks.
    const thin = Math.min(...[0, 1, 2].map((k) => bx.max[k] - bx.min[k]));
    const cz = (bx.min[2] + bx.max[2]) / 2;
    if (thin < 0.015 && size < 0.4 && Math.abs(cx) > 0.75 && cz > zs(0.3) && cz < zs(0.8)) badge.add(r);
  }
  const before = tris.length;
  for (let i = tris.length - 1; i >= 0; i--) if (tris[i].comp && badge.has(tris[i].comp)) tris.splice(i, 1);
  console.log(`badges removed: ${badge.size} pieces, ${before - tris.length} triangles`);
}

// Pieces whose faces point both into and out of the car (curved lamp surrounds, lips, fins) get
// drawn from both sides; for the rest one outward-facing side is enough.
if (RAW) for (const t of tris) t.twoSided = t.ds; // the source's own double-sided flags
else {
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
  // Closed pieces (mirror caps, light housings...) face every way, so the ellipsoid test can't tell;
  // their signed volume can: positive = wound outward. Those get one side, flipped if needed.
  const vol = new Map();
  const bb = new Map();
  for (const t of tris) {
    const c = cross(t.b, t.c);
    const v = (t.a[0] * c[0] + t.a[1] * c[1] + t.a[2] * c[2]) / 6;
    vol.set(t.piece, (vol.get(t.piece) || 0) + v);
    const b = bb.get(t.piece) || [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const p of [t.a, t.b, t.c]) for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], p[k]); b[k + 3] = Math.max(b[k + 3], p[k]); }
    bb.set(t.piece, b);
  }
  const closedSign = (piece) => {
    const b = bb.get(piece);
    const box = (b[3] - b[0]) * (b[4] - b[1]) * (b[5] - b[2]);
    const v = vol.get(piece) || 0;
    return box > 1e-9 && Math.abs(v) > 0.15 * box ? Math.sign(v) : 0;
  };
  let n = 0;
  for (const t of tris) {
    const [sum, abs] = score.get(t.piece);
    const ambiguous = Math.abs(sum) < 0.6 * abs;
    const closed = ambiguous ? closedSign(t.piece) : 0;
    if (closed < 0) { const a = t.b; t.b = t.c; t.c = a; t.n = t.n.map((x) => -x); } // inward-wound solid
    t.twoSided = !t.inner && ambiguous && closed === 0;
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
if (!RAW) {
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
    if (wheelCenters.some(({ p: w }) => Math.abs(c[0]) > zs(0.45) && Math.hypot(c[1] - w[1], c[2] - w[2]) < W_R * 2.1)) continue;
    if (c[2] > zs(0.8) && c[1] > wsBaseY - 0.1 && c[1] < yR - ys(1.0) && Math.abs(c[0]) < 0.9) continue; // cabin opening
    if (span[1] > 1.6) continue;
    // Opening facing: Newell normal of the loop. Top-facing loops are panel seams on the hood/deck;
    // filling those leaves dark patches on the paint, so only front/rear/side/bottom openings get panels.
    const nl = [0, 0, 0];
    for (let k = 0; k < L.length; k++) {
      const p = L[k]; const q = L[(k + 1) % L.length];
      nl[0] += (p[1] - q[1]) * (p[2] + q[2]); nl[1] += (p[2] - q[2]) * (p[0] + q[0]); nl[2] += (p[0] - q[0]) * (p[1] + q[1]);
    }
    const nn = norm(nl);
    if (Math.abs(nn[2]) > 0.6 && c[2] > zs(0.45)) continue;
    if (process.env.NOFILL) continue;
    // Triangulate the opening along its own outline (ear clipping in the loop's plane), so concave
    // holes don't get fan triangles across the surrounding bars; sink it 1 cm into the car.
    const ax = Math.abs(nn[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = norm(cross(nn, ax));
    const w2 = cross(nn, u);
    const pts2 = L.map((p) => new Vector2(p[0] * u[0] + p[1] * u[1] + p[2] * u[2], p[0] * w2[0] + p[1] * w2[1] + p[2] * w2[2]));
    let faces2;
    try { faces2 = ShapeUtils.triangulateShape(pts2, []); } catch { continue; }
    const o = [0, 1, 2].map((k) => (c[k] - CENTER[k]) / (RADII[k] * RADII[k]));
    const ol = Math.hypot(...o) || 1;
    const S = L.map((p) => [0, 1, 2].map((k) => p[k] - (o[k] / ol) * 0.01));
    for (const [i0, i1, i2] of faces2) added.push(mkTri(S[i0], S[i1], S[i2], 'Grille', { twoSided: true }));
    filled++;
  }
  console.log(`openings closed: ${filled}`);
}

// Wheel wells: a closed half-drum over each wheel (open to the outside and the road), so nothing
// shows through around the game's wheels.
{
  const seg = 14;
  for (const { p: w } of wheelCenters) {
    const side = Math.sign(w[0]);
    const r = W_R * 1.17;
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
  const low = tris.filter((t) => !t.inner && t.c0[2] < zs(0.4));
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
  const tunnel = tris.filter((t) => t.inner && Math.abs(t.c0[0]) < 0.12 && Math.abs(t.c0[1] - y) < 0.12 && t.c0[2] < zs(0.85));
  const z = tunnel.length ? ext(tunnel, 2, Math.max) : zs(0.55);
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
if (!RAW) tris.push(...added);

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

// --bake: the far LODs (0/1) use flat cells in the atlas's top row, colored like the detail layer
// (paint transparent so it shows the player's color; the rest opaque).
const STRIP_COLORS = {
  Body_Color: [0, 0, 0, 0], Wing: [0, 0, 0, 0], Glass_Gray: [5, 5, 7, 255], Grille: [12, 12, 12, 255],
  Underbody: [8, 8, 8, 255], plastic_gray: [22, 22, 24, 255], metal_gray: [120, 122, 126, 255],
  metal_chrome: [185, 188, 194, 255], Carbon_Fiber: [34, 34, 36, 255], Leather: [20, 20, 20, 255],
  Interior_dark: [18, 18, 18, 255], Taillight_Glass: [190, 16, 20, 255], Projector_Glass: [225, 230, 238, 255],
  Turn_Signal_LED: [255, 160, 40, 255], WingDark: [20, 20, 20, 255],
};
const STRIP_CELL = 8;
const STRIP = {
  keys: Object.keys(STRIP_COLORS),
  colors: STRIP_COLORS,
  uv: (k) => {
    const i = Math.max(0, Object.keys(STRIP_COLORS).indexOf(k));
    return [(i + 0.5) / 32, 0.5 / 32]; // top 1/32 of any texture, 32 cells across

  },
};
const BODY_PAL = BAKE ? STRIP : MASK;
function paintStrip(px, w, h) {
  const cw = Math.max(1, Math.floor(w / 32)); const ch = Math.max(1, Math.floor(h / 32));
  STRIP.keys.forEach((k, i) => {
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) px.set(STRIP_COLORS[k], (y * w + i * cw + x) * 4);
  });
}

// Textures are written like the original cars': PNG at the template's size, "_s" DDS at half size
// in DXT3 with a full mip chain (the game's own files are all DXT3 + mips).
function palettePixels(pal, w, h) {
  const px = Buffer.alloc(w * h * 4);
  const keyAt = pal.keys;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = Math.floor((y * 8) / h) * 8 + Math.floor((x * 8) / w);
    const [r, g, b] = i < keyAt.length ? pal.colors[keyAt[i]] : [0, 0, 0];
    const o = (y * w + x) * 4;
    px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
  }
  return px;
}

const to565 = (r, g, b) => ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
const from565 = (c) => [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31];

// DXT3 block compression of an RGBA image (w, h multiples of 4, or smaller mips padded).
function dxt3(px, w, h) {
  const bw = Math.max(1, Math.ceil(w / 4));
  const bh = Math.max(1, Math.ceil(h / 4));
  const out = Buffer.alloc(bw * bh * 16);
  let o = 0;
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    const blk = [];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const sx = Math.min(w - 1, bx * 4 + x);
      const sy = Math.min(h - 1, by * 4 + y);
      const i = (sy * w + sx) * 4;
      blk.push([px[i], px[i + 1], px[i + 2], px[i + 3]]);
    }
    for (let k = 0; k < 16; k += 2) out[o + k / 2] = (blk[k][3] >> 4) | ((blk[k + 1][3] >> 4) << 4);
    const lum = (c) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
    let hi = blk[0];
    let lo = blk[0];
    for (const c of blk) { if (lum(c) > lum(hi)) hi = c; if (lum(c) < lum(lo)) lo = c; }
    let c0 = to565(...hi);
    let c1 = to565(...lo);
    if (c0 < c1) [c0, c1] = [c1, c0];
    const e0 = from565(c0);
    const e1 = from565(c1);
    const pal = [e0, e1, e0.map((v, k) => (2 * v + e1[k]) / 3), e0.map((v, k) => (v + 2 * e1[k]) / 3)];
    let bits = 0;
    blk.forEach((c, k) => {
      let best = 0;
      let bd = Infinity;
      pal.forEach((q, j) => { const d = (q[0] - c[0]) ** 2 + (q[1] - c[1]) ** 2 + (q[2] - c[2]) ** 2; if (d < bd) { bd = d; best = j; } });
      bits |= best << (2 * k);
    });
    out.writeUInt16LE(c0, o + 8);
    out.writeUInt16LE(c1, o + 10);
    out.writeUInt32LE(bits >>> 0, o + 12);
    o += 16;
  }
  return out;
}

function ddsDXT3(pal, w, h) {
  const levels = [];
  for (let lw = w, lh = h; ; lw = Math.max(1, lw >> 1), lh = Math.max(1, lh >> 1)) {
    levels.push(dxt3(palettePixels(pal, lw, lh), lw, lh));
    if (lw === 1 && lh === 1) break;
  }
  const hdr = Buffer.alloc(128);
  hdr.write('DDS ', 0, 'ascii');
  const u32 = (o, v) => hdr.writeUInt32LE(v >>> 0, o);
  u32(4, 124); u32(8, 0x21007); u32(12, h); u32(16, w); u32(28, levels.length);
  u32(76, 32); u32(80, 0x4); hdr.write('DXT3', 84, 'ascii');
  u32(108, 0x401008);
  return Buffer.concat([hdr, ...levels]);
}

// Texture size of the template's file (PNG header), else the fallback.
function pngSize(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  const b = fs.readFileSync(file);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

// 2×2 box filter (alpha-weighted color) for mip levels.
function halve(px, w, h) {
  const nw = Math.max(1, w >> 1); const nh = Math.max(1, h >> 1);
  const out = Buffer.alloc(nw * nh * 4);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    let r = 0; let g = 0; let b = 0; let a = 0; let n = 0;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const sx = Math.min(w - 1, x * 2 + dx); const sy = Math.min(h - 1, y * 2 + dy);
      const i = (sy * w + sx) * 4;
      const wa = px[i + 3] + 1;
      r += px[i] * wa; g += px[i + 1] * wa; b += px[i + 2] * wa; a += px[i + 3]; n += wa;
    }
    const o = (y * nw + x) * 4;
    out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / 4;
  }
  return out;
}

// Any RGBA image as PNG (w × h) + "_s" DXT3 DDS at half size with mips, like the game's files.
// mode 'half': "_s" at half size with mips (escarabajo; gtv98's color_s). 'full': same size as the PNG,
// one level (gtv98's base and part textures: flags 0x81007, linear size, caps 0x1000).
async function writeImage(px, w, h, file, mode = 'half') {
  await sharp(Buffer.from(px), { raw: { width: w, height: h, channels: 4 } }).png().toFile(file + '.png');
  if (mode === 'full') {
    const hdr = Buffer.alloc(128);
    hdr.write('DDS ', 0, 'ascii');
    const u32 = (o, v) => hdr.writeUInt32LE(v >>> 0, o);
    const data = dxt3(Buffer.from(px), w, h);
    u32(4, 124); u32(8, 0x81007); u32(12, h); u32(16, w); u32(20, data.length);
    u32(76, 32); u32(80, 0x4); hdr.write('DXT3', 84, 'ascii'); u32(108, 0x1000);
    fs.writeFileSync(file + '_s.dds', Buffer.concat([hdr, data]));
    return;
  }
  let lw = Math.max(1, w >> 1); let lh = Math.max(1, h >> 1);
  let level = halve(px, w, h);
  const levels = [];
  for (;;) {
    levels.push(dxt3(level, lw, lh));
    if (lw === 1 && lh === 1) break;
    level = halve(level, lw, lh);
    lw = Math.max(1, lw >> 1); lh = Math.max(1, lh >> 1);
  }
  const hdr = Buffer.alloc(128);
  hdr.write('DDS ', 0, 'ascii');
  const u32 = (o, v) => hdr.writeUInt32LE(v >>> 0, o);
  u32(4, 124); u32(8, 0x21007); u32(12, Math.max(1, h >> 1)); u32(16, Math.max(1, w >> 1)); u32(28, levels.length);
  u32(76, 32); u32(80, 0x4); hdr.write('DXT3', 84, 'ascii');
  u32(108, 0x401008);
  fs.writeFileSync(file + '_s.dds', Buffer.concat([hdr, ...levels]));
}

async function writeTexture(pal, file, [w, h] = [64, 64]) {
  await sharp(palettePixels(pal, w, h), { raw: { width: w, height: h, channels: 4 } }).png().toFile(file + '.png');
  fs.writeFileSync(file + '_s.dds', ddsDXT3(pal, Math.max(1, w >> 1), Math.max(1, h >> 1)));
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
  const vn = []; // authored normals per welded vertex (distinct directions)
  for (const t of list) {
    const ids = [t.a, t.b, t.c].map((p, k3) => {
      const k = key(p);
      let i = map.get(k);
      if (i === undefined) { i = pos.length / 3; map.set(k, i); pos.push(p[0], p[1], p[2]); }
      if (t.vn) {
        const n = t.vn[k3];
        const list2 = vn[i] || (vn[i] = []);
        if (!list2.some((m) => m[0] * n[0] + m[1] * n[1] + m[2] * n[2] > 0.995)) list2.push(n);
      }
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
    if (!RAW && score.get(find(ids[0])) < 0) idx.push(ids[0], ids[2], ids[1]);
    else idx.push(...ids);
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx), vn };
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
function clusterSimplify(pos, idx, targetTris, coarse = false) {
  let best = idx;
  // Capped so panels can't drift through the skin; under a --max-verts cap coarser cells are allowed.
  for (const cell of [0.01, 0.015, 0.02, 0.025, 0.03, ...(coarse ? [0.04, 0.05, 0.065, 0.08] : [])]) {
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
  const dropped = RAW && lod === 2 && attempt === 0 ? welded.idx
    : dropSmallPieces(pos, welded.idx, LOD_MIN_PIECE[lod] * (1 + Math.min(attempt, 4)) * (RAW ? 0.5 : 1));
  const idx = dropped.length ? dropped : welded.idx; // a part made only of small pieces keeps them
  const err = interior ? LOD_ERR_INTERIOR[lod] * (1 + attempt) : LOD_ERR[lod];
  // After a few tries at .0m size limits, let borders collapse too (small cracks beat a failed build).
  const lock = (err === null && attempt < 3) || LOCK;
  // Under a --max-verts cap, later attempts drop the error limit so the triangle target decides.
  const errFree = MAX_VERTS < 65000 && attempt >= 3 ? 1 : err === null ? 0.004 * attempt : err;
  let out = idx.length / 3 <= targetTris ? idx
    : MeshoptSimplifier.simplify(idx, pos, 3, Math.max(3, targetTris * 3), lock ? 1 : errFree, lock ? ['LockBorder'] : [])[0];
  if (interior && out.length / 3 > targetTris) out = clusterSimplify(pos, out, Math.round(targetTris / (1 + attempt)), MAX_VERTS < 65000 && attempt >= 3);
  if (!interior && !twoSided) return { pos, idx: out, ref: idx, vn: welded.vn };
  // Interior and ambiguous pieces are seen from any side: add the back faces after simplifying.
  const both = new Uint32Array(out.length * 2);
  both.set(out);
  for (let t = 0; t < out.length; t += 3) both.set([out[t], out[t + 2], out[t + 1]], out.length + t);
  return { pos, idx: both, ref: idx, vn: welded.vn };
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

function withNormals(pos, idx, crease = 45, refIdx = null, authored = null) {
  const ref = authored ? null : refIdx ? sourceNormals(pos, refIdx) : null;
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
      if (authored && authored[v]) {
        // The source's own normal at this vertex that best matches this face.
        let best = -2;
        for (const m of authored[v]) {
          const d = m[0] * ft[0] + m[1] * ft[1] + m[2] * ft[2];
          if (d > best) { best = d; n = m; }
        }
        if (best < 0) n = null;
      }
      if (!n && ref && ref.has(v)) {
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
  let last = null;
  for (let attempt = 0; ; attempt++) {
    const parts = buildSlotOnce(list, budget, pal, lod, attempt);
    if (!parts.length && last) return last; // never shrink a part away completely
    const nv = parts.reduce((s, q) => s + q.positions.length / 3, 0);
    const ni = parts.reduce((s, q) => s + q.indices.length, 0);
    if (process.env.DEBUG) console.log(`  lod${lod} attempt ${attempt}: ${nv} verts`);
    if ((nv <= MAX_VERTS && ni <= 65000) || attempt >= 24) return parts;
    if (nv <= 65000 && ni <= 65000) last = parts;
  }
}

function buildSlotOnce(list, budgetIn, pal, lod, attempt) {
  // Once borders are allowed to collapse (attempt ≥ 3), aim just under the .0m limit instead of the
  // small LOD budget, so LOD 2 stays the most detailed.
  const budget = RAW ? budgetIn * 0.82 ** attempt // raw budgets start at the limit: shrink until it fits
    : MAX_VERTS < 65000 ? budgetIn * 0.85 ** attempt // under a vertex cap: only ever shrink
    : attempt >= 3 ? Math.max(budgetIn, (19000 * 0.85 ** (attempt - 3)) / SCALE) : budgetIn;
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
    const { pos, idx, ref, vn } = simplifyGroup(group, target, lod, !RAW && INTERIOR.test(mat), attempt, twoSided);
    if (process.env.DEBUG) console.log(`    lod${lod} ${mat.padEnd(16)} src ${group.length} target ${target} got ${idx.length / 3}`);
    if (idx.length < 3) continue;
    const g = withNormals(pos, idx, 45, ref, RAW ? vn : null);
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

const BUDGET = RAW ? { // fill each file close to the .0m limit (~21k triangles)
  body: [7000, 13000, 19500], frontbumper: [2500, 6000, 12000], rearbumper: [2500, 6000, 12000],
  headlight: [2000, 5000, 12000], rearlight: [2000, 5000, 12000], hood: [1000, 3000, 8000],
  roof: [1500, 4000, 10000], skirt: [1000, 3000, 8000],
} : { // [LOD0, LOD1, LOD2] triangles, roughly 2–3× the original car (LOD2 total ≈ 7k)
  body: [500, 1400, 2800], frontbumper: [180, 500, 1100], rearbumper: [180, 500, 1100],
  headlight: [40, 300, 700], rearlight: [60, 220, 500], hood: [40, 130, 300], roof: [100, 250, 500],
  skirt: [60, 140, 300],
};
const SLOT_DIRS = BAKE // --bake follows the template's own part folders (gtv98 also has grill)
  ? fs.readdirSync(TPL, { withFileTypes: true }).filter((e) => e.isDirectory() && !/^(dooropen|icon)$/i.test(e.name)).map((e) => e.name).sort()
  : ['frontbumper', 'headlight', 'hood', 'mainspoiler', 'rearbumper', 'rearlight', 'roof', 'skirt'];
const tplName = path.basename(path.resolve(TPL));
fs.mkdirSync(OUT, { recursive: true });
const readOM = (f) => { const b = fs.readFileSync(f); return parseOM(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); };
const xmlUtf16 = (text) => Buffer.from(encodeSpec(text));
const readXml = (f) => decodeSpec(fs.readFileSync(f));
const report = [];

// --bake: the car is rebuilt as one watertight outer shell (tools/hull.mjs), simplified to each LOD's
// triangle count, then split into the part slots by the source material under each triangle.
const HULL_TRIS = [Number(opt('--hull-lod0', '1200')), Number(opt('--hull-lod1', '2800')), Number(opt('--hull-tris', '6000'))];
const REFM = BAKE ? makeReference(REF) : null;
const hullSlots = {};
if (BAKE) {
  const t0 = Date.now();
  const hull = buildHull(REF, { voxel: Number(opt('--voxel', '0.015')) });
  console.log(`shell: ${hull.idx.length / 3} triangles (${hull.grid.join('×')} voxels, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  // Everything is drawn as plain textured submeshes (kind 0): lamps, glass and trim are in the baked
  // texture; per-triangle lamp/glass kinds would follow the coarse triangles and look jagged.
  const buildLod = (target) => {
    const idx = MeshoptSimplifier.simplify(hull.idx, hull.pos, 3, Math.round(target) * 3, 1, [])[0];
    const P = hull.pos;
    const groups = new Map(); // slot → mat → [indices]
    for (let t = 0; t < idx.length; t += 3) {
      const v = [idx[t], idx[t + 1], idx[t + 2]].map((i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
      const c0 = [0, 1, 2].map((k) => (v[0][k] + v[1][k] + v[2][k]) / 3);
      const n = norm(cross(sub(v[1], v[0]), sub(v[2], v[0])));
      const mat = materialAt(REFM, c0, n) || 'Underbody';
      const slot = slotOf({ c0, n, mat });
      if (!groups.has(slot)) groups.set(slot, new Map());
      const g = groups.get(slot);
      if (!g.has(mat)) g.set(mat, []);
      g.get(mat).push(idx[t], idx[t + 1], idx[t + 2]);
    }
    const out = {};
    for (const [slot, g] of groups) {
      out[slot] = [];
      for (const [mat, list] of g) {
        const nm = withNormals(P, new Uint32Array(list), 70);
        const [u, v] = STRIP.uv(STRIP_COLORS[mat] ? mat : 'plastic_gray');
        out[slot].push({ name: mat, kind: 0, ...nm, uvs: new Float32Array((nm.positions.length / 3) * 2).map((_, i) => (i % 2 ? v : u)) });
      }
    }
    return out;
  };
  // Each LOD shrinks until every part file stays under --max-verts (UV seams add ~20 % later).
  for (let l = 0; l < 3; l++) {
    let target = HULL_TRIS[l];
    let res;
    for (let k = 0; k < 8; k++) {
      res = buildLod(target);
      const worst = Math.max(...Object.values(res).map((ps) => ps.reduce((s2, q) => s2 + q.positions.length / 3, 0)));
      if (worst * 1.2 <= MAX_VERTS) break;
      target *= Math.max(0.5, (MAX_VERTS / (worst * 1.2)) * 0.95);
    }
    for (const [slot, ps] of Object.entries(res)) (hullSlots[slot] ||= [[], [], []])[l] = ps;
  }
  for (const [slot, byLod] of Object.entries(hullSlots)) console.log(`  shell ${slot.padEnd(12)} LOD0/1/2 ${byLod.map((ps) => ps.reduce((s2, q) => s2 + q.indices.length / 3, 0)).join(' / ')} tris`);
}
const slotParts = (dir, budgetList, pal) => (BAKE ? (hullSlots[dir] || [[], [], []])
  : [0, 1, 2].map((l) => buildSlot(slots[dir] || [], budgetList[l], pal, l)));

const pending = []; // --bake: written after the atlas is baked
function writeLods(dir, mesh, tplMesh, partsByLod) {
  if (BAKE && !pending.done) { pending.push([dir, mesh, tplMesh, partsByLod]); return; }
  for (let l = 0; l < 3; l++) {
    // The template's file for this LOD; templates may name meshes they don't ship (gtv98's skirt).
    let tf = path.join(TPL, dir, `${tplMesh}_${l}.0m`);
    if (!fs.existsSync(tf)) tf = path.join(TPL, dir, fs.readdirSync(path.join(TPL, dir)).find((f) => f.endsWith(`_${l}.0m`)));
    const tpl = readOM(tf);
    const bytes = writeOM(tpl, matchTemplateSubmeshes(tpl, partsByLod[l]));
    fs.writeFileSync(path.join(OUT, dir, `${mesh}_${l}.0m`), bytes);
  }
  const tri = partsByLod.map((ps) => ps.reduce((s, q) => s + q.indices.length / 3, 0));
  report.push(`${(dir || 'body').padEnd(12)} ${mesh.padEnd(10)} LOD0/1/2 ${tri.join(' / ')} tris`);
}

// Body
writeLods('', 'body', 'body', slotParts('body', BUDGET.body, BODY_PAL));
if (BAKE) {
  // Paint mask: all paint (the detail layer covers what isn't).
  const [bw, bh] = pngSize(path.join(TPL, `${tplName}_base.png`), [512, 512]);
  const red = Buffer.alloc(bw * bh * 4);
  for (let i = 0; i < red.length; i += 4) { red[i] = 255; red[i + 3] = 255; }
  await writeImage(red, bw, bh, path.join(OUT, `${NAME}_base`), 'full');
} else {
  await writeTexture(MASK, path.join(OUT, `${NAME}_base`), pngSize(path.join(TPL, `${tplName}_base.png`), [512, 512]));
  await writeTexture(MASK, path.join(OUT, `${NAME}_color`), pngSize(path.join(TPL, `${tplName}_color.png`), [128, 64]));
}

for (const dir of SLOT_DIRS) {
  fs.mkdirSync(path.join(OUT, dir), { recursive: true });
  const list = readXml(path.join(TPL, dir, 'list.xml'));
  const variants = [...list.matchAll(/<part\b[^>]*name='([^']*)'[^>]*mesh='([^']*)'[^>]*>/g)].map((m) => ({ name: m[1], mesh: m[2] }));
  const tplMesh = fs.existsSync(path.join(TPL, dir, 'default_0.0m')) ? 'default' : variants[0].mesh;
  const isLightSlot = dir === 'headlight' || dir === 'rearlight';
  // Every part folder gets <car>_<dir>.png/_s.dds, named in list.xml wherever the template names a
  // texture (the template leaves some defaults empty, e.g. hood and roof; those stay empty).
  const tex = BAKE ? `${NAME}_${dir}_default` : `${NAME}_${dir}`;
  const pal = BAKE ? STRIP : isLightSlot ? LIGHT : MASK;
  if (!BAKE) await writeTexture(pal, path.join(OUT, dir, tex), pngSize(path.join(TPL, dir, `${tplName}_${dir}.png`), [64, 64]));
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
      // Same-named template variant when there is one: its header and moving pieces match (h11000 animates).
      const vTpl = fs.existsSync(path.join(TPL, dir, `${v.mesh}_0.0m`)) ? v.mesh : tplMesh;
      writeLods(dir, v.mesh, vTpl, [0, 1, 2].map(() => buildSlot(src, 400, BAKE ? STRIP : MASK)));
    }
    meshFor = (v) => v.mesh;
  } else {
    const byLod = slotParts(dir, BUDGET[dir] || BUDGET.hood, pal);
    if (!byLod[2].length && BAKE) {
      // A template part our car has nothing for (gtv98's grill): same files, hidden 1 mm stand-ins.
      for (const v of variants) writeLods(dir, v.mesh, v.mesh, [[], [], []]);
      meshFor = (v) => v.mesh;
    } else {
      if (!byLod[2].length) { console.warn(`! no triangles for ${dir}`); continue; }
      writeLods(dir, 'default', tplMesh, byLod);
      meshFor = () => 'default'; // every shop variant shows the stock part
    }
  }
  // list.xml: keep the template's ids and names so tuning items still resolve.
  const out = list.replace(/<part\b([^>]*)\/>/g, (all, attrs) => {
    const name = /name='([^']*)'/.exec(attrs)?.[1];
    if (!name) return all;
    const v = variants.find((x) => x.name === name);
    let a = attrs;
    if (/mesh='/.test(a)) a = a.replace(/mesh='[^']*'/, `mesh='${meshFor(v)}'`);
    // (--bake: every variant, the detail layer is in the part texture)
    if (BAKE ? /tex='/.test(a) : /tex='[^']+'/.test(a)) a = a.replace(/tex='[^']*'/, `tex='${tex}'`);
    return `<part${a}/>`;
  });
  fs.writeFileSync(path.join(OUT, dir, 'list.xml'), xmlUtf16(out));
}

// --bake: like gtv98, every part folder gets its own texture (sized like the template's), each part
// file is one submesh, and every LOD uses the detailed mesh. The body's detail layer is <car>_color.
if (BAKE) {
  const tplPng = (dir) => {
    const d = path.join(TPL, dir);
    const own = path.join(d, `${tplName}_${dir}_default.png`);
    if (fs.existsSync(own)) return pngSize(own, [128, 128]);
    const any = fs.readdirSync(d).find((f) => f.endsWith('.png'));
    return any ? pngSize(path.join(d, any), [128, 128]) : [128, 128];
  };
  const merge = (parts) => {
    const P = []; const N = []; const UV = []; const I = [];
    for (const q of parts) {
      const base = P.length / 3;
      P.push(...q.positions); N.push(...q.normals); UV.push(...q.uvs);
      for (const i of q.indices) I.push(base + i);
    }
    return { name: 'merged', kind: 0, positions: new Float32Array(P), normals: new Float32Array(N), uvs: new Float32Array(UV), indices: new Uint16Array(I) };
  };
  const t0 = Date.now();
  const dirs = [...new Set(pending.map(([dir]) => dir))];
  for (const dir of dirs) {
    const jobs = pending.filter(([d]) => d === dir);
    // Template sizes, but at least 256 (the original cars use 256 too): our detail is in the texture.
    let [w, h] = dir === '' ? [ATLAS, ATLAS] : dir === 'mainspoiler' ? [64, 64] : tplPng(dir);
    if (dir !== '' && dir !== 'mainspoiler') { while (w < 256) w *= 2; while (h < 256 && h < w) h *= 2; }
    const parts = dir === 'mainspoiler' ? [] : jobs.flatMap(([, , , byLod]) => byLod[2]);
    let px = new Uint8ClampedArray(w * h * 4);
    if (parts.length) {
      transferNormals(REFM, parts);
      const ppm = unwrapParts(parts, w, Math.ceil(h / 32) + 2, h);
      px = bakeAtlas(REFM, parts, w, { height: h });
      console.log(`  ${(dir || 'body').padEnd(12)} texture ${w}×${h}: ${(1000 / ppm).toFixed(1)} mm per texel`);
      for (const job of jobs) job[3][2] = [merge(job[3][2])];
    }
    paintStrip(px, w, h);
    if (dir === '') await writeImage(px, w, h, path.join(OUT, `${NAME}_color`), 'half');
    else await writeImage(px, w, h, path.join(OUT, dir, `${NAME}_${dir}_default`), 'full');
    if (SAME_LODS) for (const job of jobs) if (dir !== 'mainspoiler') job[3] = [job[3][2], job[3][2], job[3][2]];
  }
  console.log(`baked in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  pending.done = true;
  for (const job of pending) writeLods(...job);
  for (const [dir, mesh, , byLod] of pending) {
    const nv = byLod.map((ps) => ps.reduce((s2, q) => s2 + q.positions.length / 3, 0));
    report.push(`${(dir || 'body').padEnd(12)} ${mesh.padEnd(10)} verts LOD0/1/2 ${nv.join(' / ')}`);
  }
}

// --bake: mirror the template's part folders file for file — its list.xml (names only changed), a mesh
// file for every variant it names (the stock part, or what the template ships), and a texture for every
// texture it names or ships (our part texture).
if (BAKE) {
  for (const dir of SLOT_DIRS) {
    const od = path.join(OUT, dir);
    if (!fs.existsSync(od)) continue;
    const list = readXml(path.join(TPL, dir, 'list.xml'));
    const mine = `${NAME}_${dir}_default`;
    const variants = [...list.matchAll(/<part\b[^>]*name='([^']*)'[^>]*mesh='([^']*)'[^>]*tex='([^']*)'/g)].map((m) => ({ mesh: m[2], tex: m[3] }));
    const stock = fs.existsSync(path.join(od, 'default_2.0m')) ? 'default' : variants.find((v) => fs.existsSync(path.join(od, `${v.mesh}_2.0m`)))?.mesh;
    const tplFiles = fs.readdirSync(path.join(TPL, dir));
    for (const v of variants) {
      for (let l = 0; l < 3; l++) {
        const f = path.join(od, `${v.mesh}_${l}.0m`);
        if (!fs.existsSync(f) && stock && tplFiles.includes(`${v.mesh}_${l}.0m`)) fs.copyFileSync(path.join(od, `${stock}_${l}.0m`), f);
      }
    }
    const texNames = new Set([...variants.map((v) => v.tex), ...tplFiles.filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4))]);
    for (const t of texNames) {
      if (!t) continue;
      const name = t.split(tplName).join(NAME);
      for (const ext of ['.png', '_s.dds']) {
        const f = path.join(od, name + ext);
        if (!fs.existsSync(f) && fs.existsSync(path.join(od, mine + ext))) fs.copyFileSync(path.join(od, mine + ext), f);
      }
    }
    fs.writeFileSync(path.join(od, 'list.xml'), xmlUtf16(list.split(tplName).join(NAME)));
  }
}

// dooropen: same door timing as the template
fs.mkdirSync(path.join(OUT, 'dooropen'), { recursive: true });
for (const f of fs.readdirSync(path.join(TPL, 'dooropen'))) fs.copyFileSync(path.join(TPL, 'dooropen', f), path.join(OUT, 'dooropen', f));

// mesh.xml: the template's 14-vertex collision hull, stretched to this car's bounds.
{
  const text = readXml(path.join(TPL, 'mesh.xml'));
  // (escarabajo writes pos="..", gtv98 pos='..')
  const vs = [...text.matchAll(/pos=(["'])([^"']+)\1/g)].map((m) => m[2].trim().split(/\s+/).map(Number));
  const mn = [0, 1, 2].map((k) => Math.min(...vs.map((v) => v[k])));
  const mx = [0, 1, 2].map((k) => Math.max(...vs.map((v) => v[k])));
  const body = slots.body.concat(slots.frontbumper || [], slots.rearbumper || []);
  const bmn = [0, 1, 2].map((k) => ext(body, k, Math.min));
  const bmx = [0, 1, 2].map((k) => ext(body, k, Math.max));
  // The game hull sits ~0.2 m above the body's bottom; keep that gap.
  const out = text.replace(/pos=(["'])([^"']+)\1/g, (_, q, s) => {
    const v = s.split(/\s+/).map(Number);
    const r = v.map((c, k) => {
      const f = (c - mn[k]) / (mx[k] - mn[k] || 1);
      const lo = k === 2 ? bmn[2] + 0.2 : bmn[k];
      return (lo + f * (bmx[k] - lo)).toFixed(10);
    });
    return `pos=${q}${r.join(' ')}${q}`;
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
