// A 3D car model (.glb) to a RayCity car folder, in the browser — the same recipe that made the pickup
// work in game (tools/build-car.mjs --bake, palette colors), laid out file for file like a template
// car (gtv98: no door animation):
//   1. load, map the source materials to categories (editable on the page), find wheels and the front
//   2. outer shell (voxels, gaps closed, windows solid) — tools/hull.mjs
//   3. simplify until every part file stays under the vertex cap (the game crashes at 8,000; 3,631 works)
//   4. split into part slots by the source material under each triangle; every triangle takes one flat
//      mask cell (paint = red, the rest black): the game reads the paint mask per vertex
//   5. write the template's files with the new geometry (stand-ins: 8-vertex boxes), transparent detail
//      textures, the paint mask, mesh.xml stretched to the car, icons
// RayCity space: x left, y back (front −y), z up, metres.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MeshoptSimplifier } from 'meshoptimizer';
import { buildHull } from '../tools/hull.mjs';
import { makeReference, materialAt, transferNormals } from '../tools/bake.mjs';
import { parseOM, writeOM, matchTemplateSubmeshes, omParts } from './om.js';
import { encodeSpec, decodeSpec } from './carSpec.js';
import { fitParts } from './carEdit.js';

// ---------------------------------------------------------------------------------------------
// Material categories

export const CATEGORIES = [
  ['Body_Color', 'สีรถ (ตัวถัง)'],
  ['Glass_Gray', 'กระจก'],
  ['Projector_Glass', 'ไฟหน้า'],
  ['Taillight_Glass', 'ไฟท้าย'],
  ['Lights_Auto', 'ไฟหน้า + ไฟท้าย (แยกตามตำแหน่ง)'],
  ['Turn_Signal_LED', 'ไฟเลี้ยว'],
  ['metal_chrome', 'โครเมียม / โลโก้'],
  ['metal_gray', 'โลหะ'],
  ['plastic_gray', 'พลาสติก / ยาง ขอบ'],
  ['Carbon_Fiber', 'คาร์บอน'],
  ['Interior_dark', 'ภายในห้องโดยสาร'],
  ['skip', '— ตัดทิ้ง (ไม่ใส่ในรถ) —'],
];
const CANON = [
  [/^plate$|license/i, 'skip'],
  [/logo|badge|emblem|costura|icons?$/i, 'metal_chrome'],
  [/tyre|tire|break|brake|rim|wheel|callip|caliper/i, 'skip'],
  [/window|^glass(_t|_gray)?$|windshield/i, 'Glass_Gray'],
  [/glass_light|projector|glass_fog|headl|fog/i, 'Projector_Glass'],
  [/red_glass|taillight|tail_light|brakelight|rear.?light/i, 'Taillight_Glass'],
  [/oraange|orange|amber|turn|indicator|(^|[^a-z])led/i, 'Turn_Signal_LED'],
  [/carpaint|car_paint|body_color|bodypaint|paint|body/i, 'Body_Color'],
  [/leather|seat|floor|carpet|console|ceiling|speaker|bose|stitch|screen|^st_sw|interior|dash|headliner/i, 'Interior_dark'],
  [/(^|[^a-z])lights?[a-z]?(_|\d|$)|lamp/i, 'Lights_Auto'],
  [/carbon/i, 'Carbon_Fiber'],
  [/chrome|gold|mirror/i, 'metal_chrome'],
  [/glass|window/i, 'Glass_Gray'],
  [/alum|metal|steel/i, 'metal_gray'],
  [/.*/, 'plastic_gray'],
];
export const guessCategory = (name) => CANON.find(([re]) => re.test(name))[1];
const SKIP_NODE = /^\W*(wheel|rim_root|steering|centre)|plates?(\.|_|$)/i;
const WHEEL_NODE = /wheel.*(front|rear|back|_[fr][lr]?$|_[fr]_)|^wheel_?[fr][lr]?$|(front|rear).*wheel/i;
const FRONT_NODE = /front|wheel_?f/i;

const isPaint = (m) => m === 'Body_Color' || m === 'Wing';
// Old flat mask cells (top 1/32 of the mask, 32 across), still read back from earlier builds.
const CELLS = ['Body_Color', 'Glass_Gray', 'Grille', 'Underbody', 'plastic_gray', 'metal_gray', 'metal_chrome', 'Carbon_Fiber',
  'Leather', 'Interior_dark', 'Taillight_Glass', 'Projector_Glass', 'Turn_Signal_LED', 'Wing', 'WingDark'];
// Paint mask in big zones like the game's own masks (gtv98: 79 % red): 16 full-height columns, one per
// material, paint red, the rest black. A tiny cell strip (the old layout, 32 px high) came out black
// in game (the garage could not repaint it); full-height columns survive any resize or flip.
const ZONES = ['Body_Color', 'Wing', 'Glass_Gray', 'Grille', 'Underbody', 'plastic_gray', 'metal_gray', 'metal_chrome', 'Carbon_Fiber',
  'Leather', 'Interior_dark', 'Taillight_Glass', 'Projector_Glass', 'Turn_Signal_LED', 'WingDark'];
const cellUV = (mat) => { const i = Math.max(0, ZONES.indexOf(ZONES.includes(mat) ? mat : 'plastic_gray')); return [(i + 0.5) / 16, 0.5]; };
// Material of a UV written by this tool (zone column, or the old top-row cell), else null.
export function matOfUV(u, v) {
  const z = u * 16 - 0.5;
  if (Math.abs(v - 0.5) < 1e-3 && Math.abs(z - Math.round(z)) < 1e-3) return ZONES[Math.round(z)] || null;
  if (v < 1 / 32) return CELLS[Math.floor(u * 32)] || null;
  return null;
}
// The paint mask pixels (w × h RGBA).
export function maskPixels(w, h) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const mat = ZONES[Math.floor((x / w) * 16)];
      px.set([isPaint(mat) ? 255 : 0, 0, 0, 255], (y * w + x) * 4);
    }
  }
  return px;
}

// ---------------------------------------------------------------------------------------------
// Small vector helpers

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const tick = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------------------------
// 1. Loading

let dracoParts = null; // { wrapper (text), wasm (ArrayBuffer) } from window.RC_DRACO (embedded at build time)
function dracoLoader() {
  const d = new DRACOLoader();
  d.setDecoderConfig({ type: 'wasm' });
  if (!dracoParts && window.RC_DRACO) {
    const bin = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    dracoParts = { wrapper: new TextDecoder().decode(bin(window.RC_DRACO.wrapper)), wasm: bin(window.RC_DRACO.wasm).buffer };
  }
  if (dracoParts) d._loadLibrary = (url) => Promise.resolve(url.endsWith('.wasm') ? dracoParts.wasm : dracoParts.wrapper);
  else d.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/');
  return d;
}

export const MODEL_TYPES = '.glb,.gltf,.fbx,.obj';

async function readScene(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'fbx') return new FBXLoader().parse(await file.arrayBuffer(), '');
  if (ext === 'obj') return new OBJLoader().parse(await file.text());
  const loader = new GLTFLoader();
  loader.setDRACOLoader(dracoLoader());
  return (await loader.parseAsync(ext === 'gltf' ? await file.text() : await file.arrayBuffer(), '')).scene;
}

// Reads a whole car model (.glb / .gltf / .fbx / .obj, usually with wheels, brakes, interior...) into a
// triangle soup in RayCity space, in metres, front towards −y, the bottom of the tyres at z = 0.
// The soup is split into connected pieces; the wheels (tyres, rims, brakes, calipers) are found by
// shape and position and start out removed — the game puts its own wheels on.
// Returns the model: { P, N (9 floats per triangle), M (material per triangle), C (piece per
// triangle), pieces, removed (per piece), wheels, materials: [{ name, tris, color, category }] }.
export async function loadModel(file) {
  const scene = await readScene(file);
  scene.updateMatrixWorld(true);
  const matIndex = new Map();
  const materials = [];
  const P = []; const N = []; const M = []; const skipTri = [];
  const wheelNodes = [];
  const toRC = (v) => [-v.x, v.z, v.y];
  const v = new THREE.Vector3();
  scene.traverse((o) => {
    if (WHEEL_NODE.test(o.name || '')) wheelNodes.push({ name: o.name, p: toRC(v.setFromMatrixPosition(o.matrixWorld)) });
    if (!o.isMesh || !o.geometry?.attributes.position) return;
    let skipNode = false;
    for (let n = o; n; n = n.parent) if (SKIP_NODE.test(n.name || '')) skipNode = true;
    const g = o.geometry;
    const pos = g.attributes.position;
    const nrm = g.attributes.normal;
    const nm = new THREE.Matrix3().getNormalMatrix(o.matrixWorld);
    const wp = new Float32Array(pos.count * 3); const wn = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      wp.set(toRC(v), i * 3);
      if (nrm) { v.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize(); wn.set(toRC(v), i * 3); }
    }
    const list = [].concat(o.material);
    const count = g.index ? g.index.count : pos.count;
    const I = g.index ? g.index.array : null;
    const groups = g.groups.length ? g.groups : [{ start: 0, count, materialIndex: 0 }];
    for (const gr of groups) {
      const m = list[gr.materialIndex || 0];
      const name = (m?.name || 'default').replace(/^\w+::?/, '') || 'default';
      let mi = matIndex.get(name);
      if (mi === undefined) {
        mi = materials.length;
        matIndex.set(name, mi);
        materials.push({ name, tris: 0, color: m?.color ? `#${m.color.getHexString()}` : '#888888', category: guessCategory(name) });
      }
      const end = Math.min(count, gr.start + gr.count);
      for (let t = gr.start; t + 2 < end; t += 3) {
        const ids = I ? [I[t], I[t + 1], I[t + 2]] : [t, t + 1, t + 2];
        const a = ids.map((i) => [wp[i * 3], wp[i * 3 + 1], wp[i * 3 + 2]]);
        let nv;
        if (nrm) nv = ids.map((i) => [wn[i * 3], wn[i * 3 + 1], wn[i * 3 + 2]]);
        else { const f = norm(cross(sub(a[1], a[0]), sub(a[2], a[0]))); nv = [f, f, f]; }
        P.push(...a[0], ...a[1], ...a[2]); N.push(...nv[0], ...nv[1], ...nv[2]);
        M.push(mi); skipTri.push(skipNode ? 1 : 0);
        materials[mi].tris++;
      }
    }
  });
  const nt = M.length;
  if (!nt) throw new Error('ไม่พบโมเดล 3 มิติในไฟล์นี้');
  const model = { P: new Float32Array(P), N: new Float32Array(N), M: Uint16Array.from(M), materials, name: file.name.replace(/\.[^.]+$/, '') };
  const ext = () => {
    const mn = [Infinity, Infinity, Infinity]; const mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < model.P.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], model.P[i + k]); mx[k] = Math.max(mx[k], model.P[i + k]); }
    return { mn, mx };
  };
  // Lying sideways (long along x): turn a quarter.
  let e = ext();
  if (e.mx[0] - e.mn[0] > (e.mx[1] - e.mn[1]) * 1.15) {
    const turnQ = (A) => { for (let i = 0; i < A.length; i += 3) { const x = A[i]; A[i] = -A[i + 1]; A[i + 1] = x; } };
    turnQ(model.P); turnQ(model.N);
    for (const w of wheelNodes) w.p = [-w.p[1], w.p[0], w.p[2]];
    e = ext();
  }
  // Units: centimetres, millimetres, inches... → metres (a car is 2.5–10 m long), centred on x/y.
  const len0 = e.mx[1] - e.mn[1];
  const s = [1, 0.01, 0.001, 0.0254, 0.1, 10, 100].find((k) => len0 * k >= 2.4 && len0 * k <= 12) || 4.5 / len0;
  const cx = (e.mx[0] + e.mn[0]) / 2; const cy = (e.mx[1] + e.mn[1]) / 2;
  const place = (p, z0) => [(p[0] - cx) * s, (p[1] - cy) * s, (p[2] - z0) * s];
  for (let i = 0; i < model.P.length; i += 3) model.P.set(place([model.P[i], model.P[i + 1], model.P[i + 2]], e.mn[2]), i);
  for (const w of wheelNodes) w.p = place(w.p, e.mn[2]);
  model.scale = s;

  findPieces(model);
  findWheels(model, skipTri);
  // Ground: the bottom of the wheels (else of the whole model) at z = 0.
  {
    let z0 = Infinity;
    for (let t = 0; t < nt; t++) if (model.pieces[model.C[t]].wheel) for (let j = 2; j < 9; j += 3) z0 = Math.min(z0, model.P[t * 9 + j]);
    if (z0 === Infinity) z0 = 0;
    for (let i = 2; i < model.P.length; i += 3) model.P[i] -= z0;
    for (const p of model.pieces) { p.min[2] -= z0; p.max[2] -= z0; }
    for (const w of model.wheels) w.p[2] -= z0;
  }
  // Front: front wheel nodes, else the head / tail lights, else the windows (cabin) side.
  const meanY = (pred) => { let sy = 0; let n = 0; for (let t = 0; t < nt; t++) if (pred(t)) { sy += model.P[t * 9 + 1]; n++; } return n ? sy / n : null; };
  let front = 0;
  const fw = wheelNodes.filter((w) => FRONT_NODE.test(w.name)); const rw = wheelNodes.filter((w) => !FRONT_NODE.test(w.name));
  if (fw.length && rw.length) front = Math.sign(fw.reduce((a, w) => a + w.p[1], 0) / fw.length - rw.reduce((a, w) => a + w.p[1], 0) / rw.length);
  if (!front) {
    const cat = (t) => materials[model.M[t]].category;
    const h = meanY((t) => cat(t) === 'Projector_Glass'); const tl = meanY((t) => cat(t) === 'Taillight_Glass');
    if (h !== null && tl !== null) front = Math.sign(h - tl);
  }
  if (!front) {
    const g = meanY((t) => materials[model.M[t]].category === 'Glass_Gray');
    front = g === null ? -1 : Math.sign(g) || -1;
  }
  if (front > 0) turnAround(model);
  // No material looks like paint: the biggest one that isn't glass or cut becomes the paint.
  const sorted = [...materials].sort((a, b) => b.tris - a.tris);
  if (!sorted.some((m) => m.category === 'Body_Color')) {
    const cand = sorted.find((m) => !['skip', 'Glass_Gray', 'Lights_Auto'].includes(m.category));
    if (cand) cand.category = 'Body_Color';
  }
  return model;
}

// Front ↔ back (half a turn around the vertical axis).
export function turnAround(model) {
  for (const A of [model.P, model.N]) for (let i = 0; i < A.length; i += 3) { A[i] = -A[i]; A[i + 1] = -A[i + 1]; }
  for (const p of model.pieces) {
    [p.min[0], p.max[0]] = [-p.max[0], -p.min[0]];
    [p.min[1], p.max[1]] = [-p.max[1], -p.min[1]];
  }
  for (const w of model.wheels) { w.p[0] = -w.p[0]; w.p[1] = -w.p[1]; }
}

// Connected pieces: triangles sharing a corner position (0.1 mm) belong together.
function findPieces(model) {
  const { P } = model;
  const nt = P.length / 9;
  const parent = new Int32Array(nt).map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const seen = new Map();
  for (let t = 0; t < nt; t++) {
    for (let j = 0; j < 3; j++) {
      const o = t * 9 + j * 3;
      const k = `${Math.round(P[o] * 1e4)},${Math.round(P[o + 1] * 1e4)},${Math.round(P[o + 2] * 1e4)}`;
      const u = seen.get(k);
      if (u === undefined) seen.set(k, t);
      else { const a = find(u); const b = find(t); if (a !== b) parent[a] = b; }
    }
  }
  const C = new Int32Array(nt);
  const ids = new Map();
  const pieces = [];
  for (let t = 0; t < nt; t++) {
    const r = find(t);
    let id = ids.get(r);
    if (id === undefined) { id = pieces.length; ids.set(r, id); pieces.push({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], tris: 0, wheel: false }); }
    C[t] = id;
    const p = pieces[id];
    p.tris++;
    for (let j = 0; j < 9; j++) { const k = j % 3; p.min[k] = Math.min(p.min[k], P[t * 9 + j]); p.max[k] = Math.max(p.max[k], P[t * 9 + j]); }
  }
  model.C = C;
  model.pieces = pieces;
}

// Wheels: round pieces (seen from the side) low down at the four corners, or pieces with wheel /
// tyre / rim materials or under wheel nodes; then everything inside a wheel (brake discs, calipers,
// hubs, nuts) goes with it.
function findWheels(model, skipTri) {
  const { pieces, C, M, materials } = model;
  const nt = C.length;
  let H = 0; let W = 0;
  for (const p of pieces) { H = Math.max(H, p.max[2]); W = Math.max(W, p.max[0]); }
  const zMin = Math.min(...pieces.map((p) => p.min[2]));
  H -= zMin;
  const wheelMat = materials.map((m) => /tyre|tire|rim|wheel|brake|break|callip|caliper|disc/i.test(m.name));
  const byMat = new Float32Array(pieces.length); const bySkip = new Float32Array(pieces.length);
  for (let t = 0; t < nt; t++) { if (wheelMat[M[t]]) byMat[C[t]]++; if (skipTri[t]) bySkip[C[t]]++; }
  const size = (p, k) => p.max[k] - p.min[k];
  const centre = (p) => [0, 1, 2].map((k) => (p.min[k] + p.max[k]) / 2);
  const cand = [];
  pieces.forEach((p, i) => {
    const c = centre(p);
    const dy = size(p, 1); const dz = size(p, 2); const dx = size(p, 0);
    const round = dz > H * 0.22 && Math.abs(dy - dz) < Math.max(dy, dz) * 0.18 && dx < dz * 0.75 && c[2] - zMin < H * 0.42 && Math.abs(c[0]) > W * 0.35;
    const named = (byMat[i] > p.tris * 0.5 || bySkip[i] > p.tris * 0.5) && dz < H * 0.7;
    if (round || named) cand.push(i);
  });
  // Group the candidates into wheels (same side, overlapping along the car).
  const wheels = [];
  for (const i of cand.sort((a, b) => pieces[b].tris - pieces[a].tris)) {
    const p = pieces[i]; const c = centre(p);
    let w = wheels.find((q) => Math.sign(q.c[0]) === Math.sign(c[0]) && Math.abs(q.c[1] - c[1]) < q.r && Math.abs(q.c[2] - c[2]) < q.r);
    if (!w) { w = { min: [...p.min], max: [...p.max], members: [] }; wheels.push(w); }
    for (let k = 0; k < 3; k++) { w.min[k] = Math.min(w.min[k], p.min[k]); w.max[k] = Math.max(w.max[k], p.max[k]); }
    w.c = centre(w); w.r = Math.max(w.max[1] - w.min[1], w.max[2] - w.min[2]) / 2;
    w.members.push(i);
  }
  const real = wheels.filter((w) => w.r * 2 > H * 0.2 && w.c[2] - zMin < H * 0.45 && Math.abs(w.c[0]) > W * 0.3);
  for (const w of real) {
    for (const i of w.members) pieces[i].wheel = true;
    // Inside the wheel: within its circle, from its outer face to 60 % of its radius further in.
    const inward = Math.sign(w.c[0]) > 0 ? [w.min[0] - w.r * 0.6, w.max[0] + 0.02] : [w.min[0] - 0.02, w.max[0] + w.r * 0.6];
    pieces.forEach((p, i) => {
      if (p.wheel) return;
      const inside = p.min[0] >= inward[0] && p.max[0] <= inward[1]
        && p.min[1] >= w.c[1] - w.r * 1.03 && p.max[1] <= w.c[1] + w.r * 1.03
        && p.min[2] >= w.c[2] - w.r * 1.03 && p.max[2] <= w.c[2] + w.r * 1.03;
      if (inside) { p.wheel = true; w.members.push(i); }
    });
  }
  model.wheels = real.map((w) => ({ p: w.c, r: w.r }));
  // Removed at the start: the wheels and whatever sits under steering / plate nodes.
  model.removed = Uint8Array.from(pieces, (p, i) => (p.wheel || bySkip[i] > p.tris * 0.5 ? 1 : 0));
}

// Material per triangle after the category table, with "lights" split by position (front half:
// headlights, back half: taillights).
const triCategory = (model, categories, t) => {
  const m = model.materials[model.M[t]];
  const cat = categories.get(m.name) || m.category;
  if (cat !== 'Lights_Auto') return cat;
  return model.P[t * 9 + 1] + model.P[t * 9 + 4] + model.P[t * 9 + 7] < 0 ? 'Projector_Glass' : 'Taillight_Glass';
};
export const categoryOf = triCategory;

// Triangles that go into the car: not removed (wheels...) and not in a "cut" category.
function collect(model, categories) {
  const tris = [];
  const { P, N, C, removed } = model;
  const nt = C.length;
  for (let t = 0; t < nt; t++) {
    if (removed[C[t]]) continue;
    const mat = triCategory(model, categories, t);
    if (mat === 'skip') continue;
    const o = t * 9;
    tris.push({
      a: [P[o], P[o + 1], P[o + 2]], b: [P[o + 3], P[o + 4], P[o + 5]], c: [P[o + 6], P[o + 7], P[o + 8]], mat,
      vn: [[N[o], N[o + 1], N[o + 2]], [N[o + 3], N[o + 4], N[o + 5]], [N[o + 6], N[o + 7], N[o + 8]]],
    });
  }
  if (!tris.length) throw new Error('ไม่เหลือชิ้นส่วนของตัวรถ (ถอด/ตัดทิ้งหมดแล้ว?)');
  let y0 = Infinity; let y1 = -Infinity;
  for (const t of tris) for (const p of [t.a, t.b, t.c]) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  return { tris, wheels: model.wheels.map((w) => ({ name: w.p[1] < 0 ? 'wheel_f' : 'wheel_r', p: w.p })), length: y1 - y0 };
}

// ---------------------------------------------------------------------------------------------
// 2–4. Shell, slots, colors

function metrics(tris, wheels) {
  for (const t of tris) {
    t.c0 = [0, 1, 2].map((k) => (t.a[k] + t.b[k] + t.c[k]) / 3);
    t.n = norm(cross(sub(t.b, t.a), sub(t.c, t.a)));
  }
  let body = tris.filter((t) => t.mat === 'Body_Color');
  if (!body.length) body = tris;
  const ext = (list, k, f) => list.reduce((r, t) => f(r, t.c0[k]), f === Math.min ? Infinity : -Infinity);
  const yF = ext(body, 1, Math.min); const yR = ext(body, 1, Math.max);
  const H = ext(body, 2, Math.max);
  const zs = (v) => (v * H) / 1.24;
  const ys = (v) => (v * (yR - yF)) / 4.52;
  const glass = tris.filter((t) => t.mat === 'Glass_Gray');
  const front = glass.filter((t) => t.c0[1] < (yF + yR) / 2 && t.c0[2] > zs(0.88));
  const wsBaseY = front.length ? ext(front, 1, Math.min) : yF + ys(1.6);
  const glassTop = glass.length ? ext(glass, 2, Math.max) : H;
  const box = () => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
  const headBox = box(); const tailBox = box();
  const grow = (bx, t) => { for (let k = 0; k < 3; k++) { bx.min[k] = Math.min(bx.min[k], t.c0[k]); bx.max[k] = Math.max(bx.max[k], t.c0[k]); } };
  for (const t of tris) {
    if (/projector|led/i.test(t.mat) && t.c0[1] < yF + ys(0.6)) grow(headBox, t);
    if (/taillight/i.test(t.mat) && t.c0[1] > yR - ys(0.5)) grow(tailBox, t);
  }
  const inBox = (bx, c0, pad) => [0, 1, 2].every((k) => c0[k] >= bx.min[k] - pad && c0[k] <= bx.max[k] + pad);
  const W_R = wheels.length ? wheels.reduce((s, w) => s + w.p[2], 0) / wheels.length : zs(0.36);
  const axleYs = wheels.map((w) => w.p[1]);
  const axleSpan = (y) => (axleYs.length ? y > Math.min(...axleYs) + W_R * 1.2 && y < Math.max(...axleYs) - W_R * 1.2 : y > ys(-0.75) && y < ys(1.05));
  const slotOf = (c0, n, mat) => {
    const [x, y, z] = c0;
    const ax = Math.abs(x);
    if (inBox(headBox, c0, 0.02)) return 'headlight';
    if (inBox(tailBox, c0, 0.02)) return 'rearlight';
    if (/glass/i.test(mat)) return 'body';
    if (mat === 'Body_Color' && y > wsBaseY + ys(0.25) && y < yR - ys(1.4) && z > glassTop - zs(0.14) && n[2] > 0.5) return 'roof';
    if (mat === 'Body_Color' && y > yF + ys(0.5) && y < wsBaseY - 0.03 && ax < 0.6 && z > zs(0.55) && n[2] > 0.5) return 'hood';
    if (y < yF + ys(0.5) && z < zs(0.78)) return 'frontbumper';
    if (y > yR - ys(0.42) && z < zs(0.82)) return 'rearbumper';
    if (z < zs(0.42) && ax > 0.78 && axleSpan(y)) return 'skirt';
    return 'body';
  };
  const bodyBounds = (k, f) => ext(tris.filter((t) => t.mat === 'Body_Color' || /bumper/.test(slotOf(t.c0, t.n, t.mat))), k, f);
  return { slotOf, bodyBounds, length: yR - yF };
}

// Normals smooth across edges under `crease` degrees; vertices split where needed.
function creaseNormals(P, idx, crease) {
  const nt = idx.length / 3;
  const fn = [];
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3] * 3; const b = idx[t * 3 + 1] * 3; const c = idx[t * 3 + 2] * 3;
    fn.push(cross([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]));
  }
  const faces = new Map();
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) { const v = idx[t * 3 + k]; if (!faces.has(v)) faces.set(v, []); faces.get(v).push(t); }
  const cos = Math.cos((crease * Math.PI) / 180);
  const positions = []; const normals = []; const indices = [];
  const cache = new Map();
  for (let t = 0; t < nt; t++) {
    const ft = norm(fn[t]);
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k];
      let s = [0, 0, 0];
      for (const o of faces.get(v)) { const fo = norm(fn[o]); if (fo[0] * ft[0] + fo[1] * ft[1] + fo[2] * ft[2] >= cos) s = [s[0] + fn[o][0], s[1] + fn[o][1], s[2] + fn[o][2]]; }
      const n = norm(s);
      const key = `${v}|${n.map((x) => x.toFixed(2)).join(',')}`;
      let ni = cache.get(key);
      if (ni === undefined) { ni = positions.length / 3; cache.set(key, ni); positions.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); normals.push(...n); }
      indices.push(ni);
    }
  }
  return { positions, normals, indices };
}

// Smooth normals across parts and seams: vertices at one position, normals within 60°, averaged.
function smoothNormals(parts) {
  const cos = Math.cos((60 * Math.PI) / 180);
  for (let pass = 0; pass < 2; pass++) {
    const groups = new Map();
    for (const part of parts) for (let v = 0; v < part.positions.length / 3; v++) {
      const k = `${Math.round(part.positions[v * 3] * 1e4)},${Math.round(part.positions[v * 3 + 1] * 1e4)},${Math.round(part.positions[v * 3 + 2] * 1e4)}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push([part, v]);
    }
    for (const list of groups.values()) {
      const ns = list.map(([p, v]) => [p.normals[v * 3], p.normals[v * 3 + 1], p.normals[v * 3 + 2]]);
      ns.map((n) => {
        const s = [0, 0, 0];
        for (const m of ns) if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] >= cos) { s[0] += m[0]; s[1] += m[1]; s[2] += m[2]; }
        return norm(s);
      }).forEach((n, i) => { const [p, v] = list[i]; p.normals[v * 3] = n[0]; p.normals[v * 3 + 1] = n[1]; p.normals[v * 3 + 2] = n[2]; });
    }
  }
}

// The simplified shell's points moved onto the model's own surface (the closest point within a few
// centimetres, on paint and glass where that surface faces the same way), so the voxel ripples and the shrink of
// simplification go away. Every copy of a point (parts, seams) moves the same way.
const SMOOTH_SURFACE = new Set(['Body_Color', 'Glass_Gray', 'Wing']);
function snapToSource(ref, parts, reach = 0.035) {
  const target = {};
  const moved = new Map();
  const tri = new THREE.Triangle(); const A = new THREE.Vector3(); const B = new THREE.Vector3(); const C = new THREE.Vector3();
  const q = new THREE.Vector3();
  // Average normal per position over all copies (for the facing test).
  const key = (P, v) => `${Math.round(P[v * 3] * 1e4)},${Math.round(P[v * 3 + 1] * 1e4)},${Math.round(P[v * 3 + 2] * 1e4)}`;
  const nAt = new Map();
  for (const part of parts) for (let v = 0; v < part.positions.length / 3; v++) {
    const k = key(part.positions, v);
    const s = nAt.get(k) || [0, 0, 0];
    for (let j = 0; j < 3; j++) s[j] += part.normals[v * 3 + j];
    nAt.set(k, s);
  }
  for (const part of parts) {
    const P = part.positions;
    for (let v = 0; v < P.length / 3; v++) {
      const k = key(P, v);
      let to = moved.get(k);
      if (to === undefined) {
        to = null;
        q.set(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
        const hit = ref.bvh.closestPointToPoint(q, target, 0, reach);
        if (hit && hit.distance <= reach) {
          const st = ref.tris[hit.faceIndex];
          if (!SMOOTH_SURFACE.has(st.mat)) { moved.set(k, null); continue; } // grilles, vents: keep the shell
          A.fromArray(st.a); B.fromArray(st.b); C.fromArray(st.c);
          const fn = tri.set(A, B, C).getNormal(new THREE.Vector3());
          const n = norm(nAt.get(k));
          if (Math.abs(fn.x * n[0] + fn.y * n[1] + fn.z * n[2]) > 0.5) to = [hit.point.x, hit.point.y, hit.point.z];
        }
        moved.set(k, to);
      }
      if (to) { P[v * 3] = to[0]; P[v * 3 + 1] = to[1]; P[v * 3 + 2] = to[2]; }
    }
  }
}

// Clean index list: no degenerate or duplicate triangles.
function dedupe(raw) {
  const seen = new Set();
  const idx = [];
  for (let t = 0; t < raw.length; t += 3) {
    const tri = [raw[t], raw[t + 1], raw[t + 2]];
    if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) continue;
    const key = [...tri].sort((a, b) => a - b).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    idx.push(...tri);
  }
  return idx;
}

// Material of every triangle of a shell mesh (majority of 4 samples), then paint / non-paint islands
// of one triangle cleaned up. Returns { mats, info: [{ c0, n }] }.
function shellMaterials(P, idx, ref) {
  const nt = idx.length / 3;
  const mats = new Array(nt); const info = new Array(nt);
  for (let t = 0; t < nt; t++) {
    const v = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]].map((i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
    const c0 = [0, 1, 2].map((k) => (v[0][k] + v[1][k] + v[2][k]) / 3);
    const n = norm(cross(sub(v[1], v[0]), sub(v[2], v[0])));
    const votes = new Map();
    for (const w of [[1 / 3, 1 / 3, 1 / 3], [0.6, 0.2, 0.2], [0.2, 0.6, 0.2], [0.2, 0.2, 0.6]]) {
      const q = [0, 1, 2].map((k) => v[0][k] * w[0] + v[1][k] * w[1] + v[2][k] * w[2]);
      const mm = materialAt(ref, q, n) || 'Underbody';
      votes.set(mm, (votes.get(mm) || 0) + 1);
    }
    mats[t] = [...votes].sort((a, b) => b[1] - a[1])[0][0];
    info[t] = { c0, n };
  }
  const edgeTris = new Map();
  const ek = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
  for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) { const k = ek(idx[t * 3 + e], idx[t * 3 + ((e + 1) % 3)]); if (!edgeTris.has(k)) edgeTris.set(k, []); edgeTris.get(k).push(t); }
  for (let pass = 0; pass < 2; pass++) {
    for (let t = 0; t < nt; t++) {
      const nb = [];
      for (let e = 0; e < 3; e++) for (const o of edgeTris.get(ek(idx[t * 3 + e], idx[t * 3 + ((e + 1) % 3)]))) if (o !== t) nb.push(o);
      if (nb.length < 2) continue;
      const others = nb.filter((o) => isPaint(mats[o]) !== isPaint(mats[t]));
      if (others.length === nb.length) mats[t] = mats[others[0]];
    }
  }
  return { mats, info };
}

// One file's triangles as parts, one per material, with crease normals and the material's mask cell.
function slotParts(P, idx, mats) {
  const byMat = new Map();
  for (let t = 0; t < mats.length; t++) {
    if (!byMat.has(mats[t])) byMat.set(mats[t], []);
    byMat.get(mats[t]).push(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]);
  }
  const parts = [];
  for (const [mat, list] of byMat) {
    const nm = creaseNormals(P, list, 70);
    const [u, v] = cellUV(mat);
    const uvs = new Float32Array((nm.positions.length / 3) * 2).map((_, i) => (i % 2 ? v : u));
    parts.push({ name: mat, kind: 0, ...nm, uvs });
  }
  return parts;
}
const vertsOf = (parts) => parts.reduce((s, q) => s + q.positions.length / 3, 0);
// A .0m holds at most 65,535 indices (u16 counts): about 21,000 triangles per file.
const MAX_FILE_TRIS = 21000;

// The shell split into the template's files, each file as detailed as `cap` vertices allows: the whole
// shell is simplified once (no borders: it is closed), cut into files by slot, and only the files
// still over the cap are simplified further on their own, their edges locked so neighbouring files
// still meet without gaps. When locked edges alone are too many, the whole shell starts coarser.
async function fitShell(hull, ref, m, cap, log) {
  const hullTris = hull.idx.length / 3;
  let T = Math.min(hullTris, cap * 10);
  for (let round = 0; round < 8; round++) {
    const mid = dedupe(T >= hullTris ? hull.idx : MeshoptSimplifier.simplify(hull.idx, hull.pos, 3, Math.round(T) * 3, 1, [])[0]);
    const { mats, info } = shellMaterials(hull.pos, mid, ref);
    const slots = new Map();
    for (let t = 0; t < mats.length; t++) {
      const slot = m.slotOf(info[t].c0, info[t].n, mats[t]);
      if (!slots.has(slot)) slots.set(slot, []);
      slots.get(slot).push(mid[t * 3], mid[t * 3 + 1], mid[t * 3 + 2]);
    }
    const out = {};
    let ok = true;
    for (const [slot, list] of slots) {
      let idx = list;
      let parts = slotParts(hull.pos, idx, shellMaterials(hull.pos, idx, ref).mats);
      let v = vertsOf(parts);
      const over = () => v > cap || idx.length / 3 > MAX_FILE_TRIS;
      let target = (idx.length / 3) * Math.min(1, (cap / v) * 0.95, MAX_FILE_TRIS / (idx.length / 3));
      for (let k = 0; over() && k < 10; k++) {
        const s = dedupe(MeshoptSimplifier.simplify(Uint32Array.from(list), hull.pos, 3, Math.max(3, Math.round(target) * 3), 1, ['LockBorder'])[0]);
        const p2 = slotParts(hull.pos, s, shellMaterials(hull.pos, s, ref).mats);
        const v2 = vertsOf(p2);
        if (s.length >= idx.length && k > 0) break; // locked edges: can't go lower
        idx = s; parts = p2; v = v2;
        target = (idx.length / 3) * Math.min((cap / v) * 0.95, MAX_FILE_TRIS / (idx.length / 3));
      }
      if (over()) { ok = false; log(`ลด poly: ชิ้น ${slot} ยังเกิน (${v.toLocaleString()} จุด) เริ่มใหม่หยาบลง`); break; }
      out[slot] = parts;
    }
    await tick();
    if (ok) {
      log(`ลด poly: ${Object.entries(out).map(([s, p]) => `${s} ${vertsOf(p).toLocaleString()}`).join(' · ')} จุด`);
      return out;
    }
    T *= 0.7;
  }
  throw new Error('ลด poly ให้ต่ำกว่าเพดานไม่ได้');
}

// Triangles nobody can see from outside (cabin, seats, engine, inner panels): from the middle of each
// triangle, rays in 26 directions; when every ray hits the car (windows count as solid: the game
// shows our glass opaque), the triangle is hidden. Returns the visible triangles.
export async function removeHidden(tris, log = () => {}) {
  const ref = makeReference(tris);
  const dirs = [];
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) if (x || y || z) dirs.push(new THREE.Vector3(x, y, z).normalize());
  const ray = new THREE.Ray();
  const keep = [];
  for (let i = 0; i < tris.length; i++) {
    const t = tris[i];
    const c = [0, 1, 2].map((k) => (t.a[k] + t.b[k] + t.c[k]) / 3);
    let seen = false;
    for (const d of dirs) {
      ray.origin.set(c[0] + d.x * 0.002, c[1] + d.y * 0.002, c[2] + d.z * 0.002);
      ray.direction.copy(d);
      if (!ref.bvh.raycastFirst(ray, THREE.DoubleSide)) { seen = true; break; }
    }
    if (seen) keep.push(t);
    if (i % 20000 === 19999) { log(`หาชิ้นข้างใน… ${Math.round((i / tris.length) * 100)}%`); await tick(); }
  }
  log(`ตัดชิ้นข้างในที่มองไม่เห็น: ${(tris.length - keep.length).toLocaleString()} สามเหลี่ยม (เหลือ ${keep.length.toLocaleString()})`);
  return keep;
}

// "Model's own surface" mode: the source triangles themselves (no shell), cut into the template's
// files by slot, one part per material (welded: same position, normals within 35°), each file
// reduced only as far as `cap` and the .0m format (65,535 vertices / indices) require. Material
// borders stay the model's own edges, so colours don't zigzag.
async function fitRaw(tris, m, cap, log) {
  const WELD = Math.cos((35 * Math.PI) / 180);
  const bySlot = new Map();
  for (const t of tris) {
    const slot = m.slotOf(t.c0, t.n, t.mat);
    if (!bySlot.has(slot)) bySlot.set(slot, new Map());
    const g = bySlot.get(slot);
    if (!g.has(t.mat)) g.set(t.mat, []);
    g.get(t.mat).push(t);
  }
  const out = {};
  for (const [slot, g] of bySlot) {
    const parts = [];
    for (const [mat, list] of g) {
      const P = []; const N = []; const I = [];
      const keys = new Map();
      const seen = new Set();
      for (const t of list) {
        // The model's own zero-area and doubled triangles are left out.
        const cr = cross(sub(t.b, t.a), sub(t.c, t.a));
        if (Math.hypot(cr[0], cr[1], cr[2]) < 1e-9) continue;
        const tk = [t.a, t.b, t.c].map((p) => p.map((x) => Math.round(x * 1e4)).join(',')).sort().join('|');
        if (seen.has(tk)) continue;
        seen.add(tk);
        [t.a, t.b, t.c].forEach((p, j) => {
          const n = t.vn ? norm(t.vn[j]) : t.n;
          const key = `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)},${Math.round(p[2] * 1e4)}`;
          const cands = keys.get(key) || [];
          let v = cands.find((c) => N[c * 3] * n[0] + N[c * 3 + 1] * n[1] + N[c * 3 + 2] * n[2] >= WELD);
          if (v === undefined) { v = P.length / 3; P.push(...p); N.push(...n); cands.push(v); keys.set(key, cands); }
          I.push(v);
        });
        const n0 = I.length - 3;
        if (I[n0] === I[n0 + 1] || I[n0 + 1] === I[n0 + 2] || I[n0] === I[n0 + 2]) I.length = n0;
      }
      const [u, vv] = cellUV(mat);
      parts.push({
        name: mat, kind: 0, positions: new Float32Array(P), normals: new Float32Array(N),
        uvs: new Float32Array((P.length / 3) * 2).map((_, i) => (i % 2 ? vv : u)), indices: Uint32Array.from(I),
      });
    }
    const before = parts.reduce((s, q) => s + q.positions.length / 3, 0);
    const fit = fitParts(parts, 1, cap, 64000); // room for the template's stand-in pieces
    out[slot] = fit.parts;
    log(fit.verts < before ? `${slot}: ${before.toLocaleString()} → ${fit.verts.toLocaleString()} จุด (ลดเท่าที่ต้องให้ไม่เกินเพดาน)` : `${slot}: ${before.toLocaleString()} จุด (ไม่ได้ลด)`);
    await tick();
  }
  return out;
}

const merge = (parts) => {
  const P = []; const N = []; const UV = []; const I = [];
  for (const q of parts) {
    const base = P.length / 3;
    for (const x of q.positions) P.push(x);
    for (const x of q.normals) N.push(x);
    for (const x of q.uvs) UV.push(x);
    for (const i of q.indices) I.push(base + i);
  }
  return { name: 'merged', kind: 0, positions: new Float32Array(P), normals: new Float32Array(N), uvs: new Float32Array(UV), indices: new Uint16Array(I) };
};

// ---------------------------------------------------------------------------------------------
// 5. Images (PNG via canvas, "_s" DDS in DXT3 like the game's files)

const to565 = (r, g, b) => ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
const from565 = (c) => [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31];
function dxt3(px, w, h) {
  const bw = Math.max(1, Math.ceil(w / 4)); const bh = Math.max(1, Math.ceil(h / 4));
  const out = new Uint8Array(bw * bh * 16);
  const dv = new DataView(out.buffer);
  let o = 0;
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    const blk = [];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const i = (Math.min(h - 1, by * 4 + y) * w + Math.min(w - 1, bx * 4 + x)) * 4;
      blk.push([px[i], px[i + 1], px[i + 2], px[i + 3]]);
    }
    for (let k = 0; k < 16; k += 2) out[o + k / 2] = (blk[k][3] >> 4) | ((blk[k + 1][3] >> 4) << 4);
    const lum = (c) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
    let hi = blk[0]; let lo = blk[0];
    for (const c of blk) { if (lum(c) > lum(hi)) hi = c; if (lum(c) < lum(lo)) lo = c; }
    let c0 = to565(...hi); let c1 = to565(...lo);
    if (c0 < c1) [c0, c1] = [c1, c0];
    const e0 = from565(c0); const e1 = from565(c1);
    const pal = [e0, e1, e0.map((v, k) => (2 * v + e1[k]) / 3), e0.map((v, k) => (v + 2 * e1[k]) / 3)];
    let bits = 0;
    blk.forEach((c, k) => {
      let best = 0; let bd = Infinity;
      pal.forEach((q, j) => { const d = (q[0] - c[0]) ** 2 + (q[1] - c[1]) ** 2 + (q[2] - c[2]) ** 2; if (d < bd) { bd = d; best = j; } });
      bits |= best << (2 * k);
    });
    dv.setUint16(o + 8, c0, true); dv.setUint16(o + 10, c1, true); dv.setUint32(o + 12, bits >>> 0, true);
    o += 16;
  }
  return out;
}
function halve(px, w, h) {
  const nw = Math.max(1, w >> 1); const nh = Math.max(1, h >> 1);
  const out = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    let r = 0; let g = 0; let b = 0; let a = 0; let n = 0;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const i = (Math.min(h - 1, y * 2 + dy) * w + Math.min(w - 1, x * 2 + dx)) * 4;
      const wa = px[i + 3] + 1;
      r += px[i] * wa; g += px[i + 1] * wa; b += px[i + 2] * wa; a += px[i + 3]; n += wa;
    }
    const o = (y * nw + x) * 4;
    out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / 4;
  }
  return out;
}
function dds(px, w, h, mode) {
  const hdr = new Uint8Array(128);
  const dv = new DataView(hdr.buffer);
  hdr.set([68, 68, 83, 32]); // "DDS "
  const levels = [];
  let lw = w; let lh = h;
  if (mode === 'full') {
    levels.push(dxt3(px, w, h));
    dv.setUint32(8, 0x81007, true); dv.setUint32(20, levels[0].length, true); dv.setUint32(108, 0x1000, true);
  } else {
    let level = halve(px, w, h); lw = Math.max(1, w >> 1); lh = Math.max(1, h >> 1);
    const tw = lw; const th = lh;
    for (;;) {
      levels.push(dxt3(level, lw, lh));
      if (lw === 1 && lh === 1) break;
      level = halve(level, lw, lh); lw = Math.max(1, lw >> 1); lh = Math.max(1, lh >> 1);
    }
    lw = tw; lh = th;
    dv.setUint32(8, 0x21007, true); dv.setUint32(28, levels.length, true); dv.setUint32(108, 0x401008, true);
  }
  dv.setUint32(4, 124, true); dv.setUint32(12, mode === 'full' ? h : lh, true); dv.setUint32(16, mode === 'full' ? w : lw, true);
  dv.setUint32(76, 32, true); dv.setUint32(80, 4, true); hdr.set([68, 88, 84, 51], 84); // "DXT3"
  const total = 128 + levels.reduce((s, l) => s + l.length, 0);
  const out = new Uint8Array(total);
  out.set(hdr); let p = 128;
  for (const l of levels) { out.set(l, p); p += l.length; }
  return out;
}
async function png(px, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px), w, h), 0, 0);
  return new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/png'))).arrayBuffer());
}
function pngSize(bytes, fallback) {
  if (!bytes || bytes.length < 24) return fallback;
  const dv = new DataView(bytes.buffer, bytes.byteOffset);
  return [dv.getUint32(16), dv.getUint32(20)];
}

// Icons like the original shop icons: the part's mesh, cyan, three-quarter view, 64×64.
let iconKit = null;
function renderIcon(bytes) {
  if (!iconKit) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(128, 128);
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#ffffff', '#335555', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 1.6); sun.position.set(2, 3, 2); scene.add(sun);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    const out = document.createElement('canvas'); out.width = out.height = 64;
    iconKit = { renderer, scene, camera, out, mat: new THREE.MeshStandardMaterial({ color: '#7fd0d0', roughness: 0.45, metalness: 0.1, side: THREE.DoubleSide }) };
  }
  const { renderer, scene, camera, out, mat } = iconKit;
  const om = parseOM(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const geo = new THREE.BufferGeometry();
  const p = new Float32Array(om.positions.length);
  for (let i = 0; i < p.length; i += 3) { p[i] = om.positions[i]; p[i + 1] = om.positions[i + 2]; p[i + 2] = -om.positions[i + 1]; }
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const I = [];
  for (const s of om.submeshes) for (let i = s.indexStart; i < s.indexStart + s.indexCount; i++) I.push(om.indices[i] + s.vertexStart);
  geo.setIndex(I); geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
  const box = new THREE.Box3().setFromObject(mesh);
  const c = box.getCenter(new THREE.Vector3());
  const r = Math.max(0.05, box.getSize(new THREE.Vector3()).length() / 2);
  camera.position.copy(c).add(new THREE.Vector3(1.2, 0.8, 1.6).normalize().multiplyScalar(r / Math.sin(Math.PI / 12)));
  camera.lookAt(c);
  renderer.render(scene, camera);
  scene.remove(mesh); geo.dispose();
  const g = out.getContext('2d');
  g.clearRect(0, 0, 64, 64);
  g.shadowColor = 'rgba(255,255,255,0.8)'; g.shadowBlur = 4;
  g.drawImage(renderer.domElement, 0, 0, 64, 64);
  return new Promise((res) => out.toBlob(async (b) => res(new Uint8Array(await b.arrayBuffer())), 'image/png'));
}

// ---------------------------------------------------------------------------------------------
// The whole conversion. template: { name, files: Map(rel → Uint8Array) }. Returns Map(rel → Uint8Array).

export async function convert(model, { name, template, categories = new Map(), maxVerts = 3500, voxel = 0.015, raw = false, smooth = true, hideInterior = true, log = () => {} }) {
  await MeshoptSimplifier.ready;
  log('อ่านโมเดล…');
  const src = collect(model, categories);
  if (raw && hideInterior) src.tris = await removeHidden(src.tris, log);
  log(`ตัวรถ (ถอดล้อแล้ว): ${src.tris.length.toLocaleString()} สามเหลี่ยม, ยาว ${src.length.toFixed(2)} ม., ล้อ ${src.wheels.length}`);
  await tick();
  const m = metrics(src.tris, src.wheels);
  let lod;
  if (raw) {
    log('ใช้ผิวจริงของโมเดล (ไม่สร้างผิวใหม่)…');
    await tick();
    lod = await fitRaw(src.tris, m, maxVerts, log);
  } else {
    const ref = makeReference(src.tris);
    log('สร้างเปลือกนอก (voxel)…');
    await tick();
    const hull = buildHull(src.tris, { voxel, smooth: 12 });
    log(`เปลือกนอก: ${(hull.idx.length / 3).toLocaleString()} สามเหลี่ยม`);
    await tick();
    // Every part file as detailed as the cap allows.
    lod = await fitShell(hull, ref, m, maxVerts, log);
    if (smooth) {
      log('ปรับผิวให้เนียน: วางจุดบนผิวจริงของโมเดล + ใช้เงาผิวจากโมเดลเดิม…');
      await tick();
      const all = Object.values(lod).flat();
      snapToSource(ref, all);
      transferNormals(ref, all);
    }
  }
  smoothNormals(Object.values(lod).flat());
  const bounds = [[0, 1, 2].map((k) => m.bodyBounds(k, Math.min)), [0, 1, 2].map((k) => m.bodyBounds(k, Math.max))];
  return writeCar(lod, { name, template, bounds, log });
}

// A car folder in the template's layout from finished geometry. lod: { slot ('body', 'hood', ...):
// [parts with positions, normals, uvs, indices] }; bounds: [min, max] of the body (mesh.xml).
// Returns Map(rel → Uint8Array).
export async function writeCar(lod, { name, template, bounds, log = () => {} }) {
  const tpl = template.files;
  const tplName = template.name;
  const out = new Map();
  const readTpl = (rel) => { const b = tpl.get(rel); return b ? parseOM(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) : null; };
  const tplLod = (dir, mesh, l) => {
    const pre = dir ? `${dir}/` : '';
    return readTpl(`${pre}${mesh}_${l}.0m`) || readTpl(`${pre}default_${l}.0m`)
      || readTpl([...tpl.keys()].find((r) => r.startsWith(pre) && !r.slice(pre.length).includes('/') && r.endsWith(`_${l}.0m`)));
  };
  const writeLods = (dir, mesh, tplMesh, parts) => {
    for (let l = 0; l < 3; l++) {
      const t = tplLod(dir, tplMesh, l);
      out.set(`${dir ? `${dir}/` : ''}${mesh}_${l}.0m`, writeOM(t, matchTemplateSubmeshes(t, parts)));
    }
  };
  log('เขียนไฟล์ตามแม่แบบ…');
  await tick();
  writeLods('', 'body', 'body', lod.body ? [merge(lod.body)] : []);
  const dirs = [...new Set([...tpl.keys()].filter((r) => r.includes('/')).map((r) => r.split('/')[0]))].filter((d) => !/^(dooropen|icon)$/i.test(d)).sort();
  for (const dir of dirs) {
    const listText = decodeSpec(tpl.get(`${dir}/list.xml`) || new Uint8Array());
    const variants = [...listText.matchAll(/<part\b[^>]*name='([^']*)'[^>]*mesh='([^']*)'[^>]*tex='([^']*)'/g)].map((x) => ({ name: x[1], mesh: x[2], tex: x[3] }));
    const ours = lod[dir] ? [merge(lod[dir])] : null;
    const tplHas = (mesh) => tpl.has(`${dir}/${mesh}_0.0m`);
    if (ours) {
      writeLods(dir, 'default', tplHas('default') ? 'default' : (variants[0]?.mesh || 'default'), ours);
      for (const v of variants) if (v.mesh !== 'default' && tplHas(v.mesh)) for (let l = 0; l < 3; l++) out.set(`${dir}/${v.mesh}_${l}.0m`, out.get(`${dir}/default_${l}.0m`));
    } else {
      for (const v of variants) if (tplHas(v.mesh)) writeLods(dir, v.mesh, v.mesh, []);
    }
    out.set(`${dir}/list.xml`, encodeSpec(listText.split(tplName).join(name)));
    // Transparent detail textures for every texture the list names or the template ships.
    // (One size per folder, the template's biggest texture there, like the builds that work in game.)
    const tplPngs = [...tpl.keys()].filter((r) => r.startsWith(`${dir}/`) && !r.slice(dir.length + 1).includes('/') && r.endsWith('.png'));
    const texNames = new Set([`${tplName}_${dir}_default`, ...variants.map((v) => v.tex).filter(Boolean), ...tplPngs.map((r) => r.slice(dir.length + 1, -4))]);
    const [w, h] = tplPngs.map((r) => pngSize(tpl.get(r), [128, 128])).sort((a, b) => b[0] * b[1] - a[0] * a[1])[0] || [128, 128];
    for (const t of texNames) {
      const px = new Uint8ClampedArray(w * h * 4);
      const nm = t.split(tplName).join(name);
      out.set(`${dir}/${nm}.png`, await png(px, w, h));
      out.set(`${dir}/${nm}_s.dds`, dds(px, w, h, 'full'));
    }
  }
  // Paint mask (zone columns) and the transparent body detail layer.
  {
    const [w, h] = pngSize(tpl.get(`${tplName}_base.png`), [512, 512]);
    const px = maskPixels(w, h);
    out.set(`${name}_base.png`, await png(px, w, h));
    out.set(`${name}_base_s.dds`, dds(px, w, h, 'full'));
    const [cw2, ch2] = pngSize(tpl.get(`${tplName}_color.png`), [128, 64]);
    const clear = new Uint8ClampedArray(cw2 * ch2 * 4);
    out.set(`${name}_color.png`, await png(clear, cw2, ch2));
    out.set(`${name}_color_s.dds`, dds(clear, cw2, ch2, 'half'));
  }
  // dooropen as the template; mesh.xml stretched to this car.
  for (const [rel, b] of tpl) if (rel.startsWith('dooropen/')) out.set(rel, b);
  if (tpl.has('mesh.xml')) {
    const text = decodeSpec(tpl.get('mesh.xml'));
    const vs = [...text.matchAll(/pos=(["'])([^"']+)\1/g)].map((x) => x[2].trim().split(/\s+/).map(Number));
    const mn = [0, 1, 2].map((k) => Math.min(...vs.map((v) => v[k])));
    const mx = [0, 1, 2].map((k) => Math.max(...vs.map((v) => v[k])));
    const [bmn, bmx] = bounds;
    const t2 = text.replace(/pos=(["'])([^"']+)\1/g, (_, q, v) => {
      const p = v.trim().split(/\s+/).map(Number);
      return `pos=${q}${p.map((c, k) => { const f = (c - mn[k]) / (mx[k] - mn[k] || 1); const lo = k === 2 ? bmn[2] + 0.2 : bmn[k]; return (lo + f * (bmx[k] - lo)).toFixed(10); }).join(' ')}${q}`;
    });
    out.set('mesh.xml', encodeSpec(t2));
  }
  // Shop icons, one per template icon.
  log('สร้างไอคอน…');
  await tick();
  for (const rel of [...tpl.keys()].filter((r) => r.startsWith('icon/') && r.endsWith('.png'))) {
    const key = rel.slice(5 + tplName.length + 1, -4); // "<part>_<variant>"
    const dir = key.split('_')[0];
    const variant = key.slice(dir.length + 1);
    const listText = decodeSpec(tpl.get(`${dir}/list.xml`) || new Uint8Array());
    const v = [...listText.matchAll(/<part\b[^>]*name='([^']*)'[^>]*mesh='([^']*)'/g)].find((x) => x[1] === variant);
    const meshFile = out.get(`${dir}/${v ? v[2] : 'default'}_2.0m`) || out.get(`${dir}/default_2.0m`);
    if (meshFile) out.set(`icon/${name}_${key}.png`, await renderIcon(meshFile));
  }
  const nv = (rel) => { const b = out.get(rel); return b ? parseOM(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)).positions.length / 3 : 0; };
  log(`เสร็จ: ${out.size} ไฟล์ · ตัวถัง ${nv('body_2.0m')} จุด`);
  return out;
}

// ---------------------------------------------------------------------------------------------
// "Old body" mode: a car that works in game (the template) bent into the new model's shape. Every
// file keeps its own structure (vertex and triangle counts, pieces, flags, UVs, textures) — only the
// points move: first stretched to the new car's size, then pulled onto the new car's outer surface,
// with the pulls smoothed so neighbouring points move together. All files move with the same field,
// so parts still meet the body.
export async function bendTemplate(model, { name, template, categories = new Map(), rounds = 3, log = () => {} }) {
  await MeshoptSimplifier.ready;
  const tpl = template.files;
  const tplName = template.name;
  const src = collect(model, categories);
  const outside = await removeHidden(src.tris, log);
  const ref = makeReference(outside);
  const tmn = [Infinity, Infinity, Infinity]; const tmx = [-Infinity, -Infinity, -Infinity];
  for (const t of outside) for (const p of [t.a, t.b, t.c]) for (let k = 0; k < 3; k++) { tmn[k] = Math.min(tmn[k], p[k]); tmx[k] = Math.max(tmx[k], p[k]); }
  // Template files and the stock body's size.
  const oms = new Map();
  for (const [rel, b] of tpl) if (rel.endsWith('.0m')) oms.set(rel, parseOM(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
  const smn = [Infinity, Infinity, Infinity]; const smx = [-Infinity, -Infinity, -Infinity];
  for (const [rel, om] of oms) {
    if (!/(^body|\/default)_2\.0m$/.test(rel)) continue;
    for (let i = 0; i < om.positions.length; i += 3) for (let k = 0; k < 3; k++) { smn[k] = Math.min(smn[k], om.positions[i + k]); smx[k] = Math.max(smx[k], om.positions[i + k]); }
  }
  // Stretch: x and y box to box, z from the ground (0) to the top.
  const stretch = (p) => [
    tmn[0] + ((p[0] - smn[0]) / (smx[0] - smn[0])) * (tmx[0] - tmn[0]),
    tmn[1] + ((p[1] - smn[1]) / (smx[1] - smn[1])) * (tmx[1] - tmn[1]),
    (p[2] / smx[2]) * tmx[2],
  ];
  // Every distinct point of every file (by position), its normal and neighbours.
  const key = (P, i) => `${Math.round(P[i * 3] * 1e4)},${Math.round(P[i * 3 + 1] * 1e4)},${Math.round(P[i * 3 + 2] * 1e4)}`;
  const ids = new Map(); const pos = []; const nrm = []; const nbr = [];
  const idOf = (om, i) => {
    const k = key(om.positions, i);
    let id = ids.get(k);
    if (id === undefined) { id = pos.length; ids.set(k, id); pos.push(stretch([om.positions[i * 3], om.positions[i * 3 + 1], om.positions[i * 3 + 2]])); nrm.push([0, 0, 0]); nbr.push(new Set()); }
    return id;
  };
  for (const om of oms.values()) {
    for (const s of om.submeshes) {
      for (let t = s.indexStart; t + 2 < s.indexStart + s.indexCount; t += 3) {
        const v = [0, 1, 2].map((j) => idOf(om, om.indices[t + j] + s.vertexStart));
        for (let j = 0; j < 3; j++) { nbr[v[j]].add(v[(j + 1) % 3]); nbr[v[j]].add(v[(j + 2) % 3]); }
      }
    }
    for (let i = 0; i < om.positions.length / 3; i++) { const id = idOf(om, i); for (let k = 0; k < 3; k++) nrm[id][k] += om.normals[i * 3 + k]; }
  }
  const n = pos.length;
  log(`ตัวถังเก่า (${tplName}): ${n.toLocaleString()} จุด ดัดเข้าหาผิวรถใหม่…`);
  await tick();
  const ray = new THREE.Ray();
  const target = {};
  for (let round = 0; round < rounds; round++) {
    // Pull: along the point's normal (both ways), else to the closest surface point.
    const reach = round === 0 ? 0.35 : 0.15;
    const d = new Array(n); const ok = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const p = pos[i]; const nn = norm(nrm[i]);
      let best = null;
      for (const sgn of [1, -1]) {
        ray.origin.set(p[0] + nn[0] * reach * sgn, p[1] + nn[1] * reach * sgn, p[2] + nn[2] * reach * sgn);
        ray.direction.set(-nn[0] * sgn, -nn[1] * sgn, -nn[2] * sgn);
        const hit = ref.bvh.raycastFirst(ray, THREE.DoubleSide);
        if (hit && hit.distance <= reach * 2) {
          const dist = Math.abs(hit.distance - reach);
          if (!best || dist < best.dist) best = { dist, q: [hit.point.x, hit.point.y, hit.point.z] };
        }
      }
      if (!best) {
        const c = ref.bvh.closestPointToPoint(new THREE.Vector3(...p), target, 0, reach);
        if (c && c.distance <= reach) best = { q: [c.point.x, c.point.y, c.point.z] };
      }
      d[i] = best ? sub(best.q, p) : [0, 0, 0];
      ok[i] = best ? 1 : 0;
    }
    // Smooth the pulls over the mesh; points that found nothing take their neighbours'.
    for (let it = 0; it < 6; it++) {
      const nd = d.map((v, i) => {
        let s = [0, 0, 0]; let w = 0;
        for (const j of nbr[i]) if (ok[j]) { s = [s[0] + d[j][0], s[1] + d[j][1], s[2] + d[j][2]]; w++; }
        if (!w) return v;
        const avg = s.map((x) => x / w);
        const self = ok[i] ? 0.5 : 0;
        return v.map((x, k) => x * self + avg[k] * (1 - self));
      });
      for (let i = 0; i < n; i++) { d[i] = nd[i]; if (nbr[i].size) ok[i] = ok[i] || [...nbr[i]].some((j) => ok[j]) ? 1 : 0; }
    }
    for (let i = 0; i < n; i++) pos[i] = [pos[i][0] + d[i][0], pos[i][1] + d[i][1], pos[i][2] + d[i][2]];
    log(`ดัดรอบที่ ${round + 1}/${rounds}`);
    await tick();
  }
  // Write every file of the template with the moved points (normals recomputed per piece).
  const out = new Map();
  const rename = (rel) => rel.split(tplName).join(name);
  for (const [rel, om] of oms) {
    const parts = omParts(om);
    parts.forEach((part, k) => {
      const base = om.submeshes[k].vertexStart;
      const P = part.positions;
      for (let i = 0; i < P.length / 3; i++) {
        const id = ids.get(key(om.positions, base + i));
        P[i * 3] = pos[id][0]; P[i * 3 + 1] = pos[id][1]; P[i * 3 + 2] = pos[id][2];
      }
      const N = new Float32Array(P.length);
      for (let t = 0; t < part.indices.length; t += 3) {
        const [a, b, c] = [part.indices[t], part.indices[t + 1], part.indices[t + 2]];
        const fn = cross([P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]], [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]]);
        for (const v of [a, b, c]) for (let k = 0; k < 3; k++) N[v * 3 + k] += fn[k];
      }
      for (let i = 0; i < N.length; i += 3) {
        const l = Math.hypot(N[i], N[i + 1], N[i + 2]);
        if (l > 1e-12) { N[i] /= l; N[i + 1] /= l; N[i + 2] /= l; } else { N[i] = part.normals[i]; N[i + 1] = part.normals[i + 1]; N[i + 2] = part.normals[i + 2]; }
      }
      part.normals = N;
    });
    out.set(rename(rel), writeOM(om, parts));
  }
  // Everything else as the template, renamed; list.xml names the renamed textures; mesh.xml stretched
  // and pulled like the body box.
  for (const [rel, b] of tpl) {
    if (rel.endsWith('.0m') || rel.startsWith('icon/')) continue;
    if (/list\.xml$/i.test(rel)) out.set(rename(rel), encodeSpec(decodeSpec(b).split(tplName).join(name)));
    else if (rel === 'mesh.xml') {
      const text = decodeSpec(b).replace(/pos=(["'])([^"']+)\1/g, (_, q, v) => `pos=${q}${stretch(v.trim().split(/\s+/).map(Number)).map((c) => c.toFixed(10)).join(' ')}${q}`);
      out.set(rel, encodeSpec(text));
    } else out.set(rename(rel), b);
  }
  log('สร้างไอคอน…');
  await tick();
  for (const rel of [...tpl.keys()].filter((r) => r.startsWith('icon/') && r.endsWith('.png'))) {
    const key2 = rel.slice(5 + tplName.length + 1, -4);
    const dir = key2.split('_')[0];
    const variant = key2.slice(dir.length + 1);
    const listText = decodeSpec(tpl.get(`${dir}/list.xml`) || new Uint8Array());
    const v = [...listText.matchAll(/<part\b[^>]*name='([^']*)'[^>]*mesh='([^']*)'/g)].find((x) => x[1] === variant);
    const meshFile = out.get(`${dir}/${v ? v[2] : 'default'}_2.0m`) || out.get(`${dir}/default_2.0m`);
    out.set(`icon/${name}_${key2}.png`, meshFile ? await renderIcon(meshFile) : tpl.get(rel));
  }
  log(`เสร็จ: ${out.size} ไฟล์ · โครงเดียวกับ ${tplName} ทุกไฟล์ (จำนวนจุดเท่าเดิม)`);
  return out;
}

export { omParts, creaseNormals, smoothNormals, cellUV, CELLS, ZONES, merge, dds };
