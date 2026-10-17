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
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { MeshoptSimplifier } from 'meshoptimizer';
import { MeshBVH } from 'three-mesh-bvh';
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
// (Column 9 was 'Leather', never produced from models: now the paint on colour 2.)
const ZONES = ['Body_Color', 'Wing', 'Glass_Gray', 'Grille', 'Underbody', 'plastic_gray', 'metal_gray', 'metal_chrome', 'Carbon_Fiber',
  'Lower_Paint', 'Interior_dark', 'Taillight_Glass', 'Projector_Glass', 'Turn_Signal_LED', 'WingDark', 'Hood_Paint'];
const cellUV = (mat) => { const i = Math.max(0, ZONES.indexOf(ZONES.includes(mat) ? mat : 'plastic_gray')); return [(i + 0.5) / 16, 0.5]; };
// Material of a UV written by this tool: its zone column (any height), or the old top-row cell.
export function matOfUV(u, v) {
  if (v < 1 / 32) return CELLS[Math.floor(u * 32)] || null;
  return ZONES[Math.floor(u * 16)] || null;
}
// UVs inside a material's zone column, spread like a box projection of the car (top / side / front by
// the normal), so no triangle has all three corners on one texel. The game builds its shading from
// the UV spread: flat, zero-area UVs (every corner the same point) came out black or see-through
// grey in the garage and could not be painted.
export function zoneUVs(mat, P, N) {
  const z = Math.max(0, ZONES.indexOf(ZONES.includes(mat) ? mat : 'plastic_gray'));
  const n = P.length / 3;
  const uv = new Float32Array(n * 2);
  const c = (v) => Math.min(1, Math.max(0, v));
  for (let i = 0; i < n; i++) {
    const x = P[i * 3]; const y = P[i * 3 + 1]; const h = P[i * 3 + 2];
    const ax = Math.abs(N[i * 3]); const ay = Math.abs(N[i * 3 + 1]); const az = Math.abs(N[i * 3 + 2]);
    const [a, b] = az >= ax && az >= ay ? [(x + 1.5) / 3, (y + 5) / 10] : ax >= ay ? [(y + 5) / 10, (h + 0.5) / 3] : [(x + 1.5) / 3, (h + 0.5) / 3];
    uv[i * 2] = (z + 0.08 + 0.84 * c(a)) / 16;
    // Only the middle of the texture (v 0.42-0.70): everything that took v below ~0.33 came out black
    // in game whatever the mask said there (pack 48: one straight line around the car at 0.45 m, the
    // nose of the hood), and so did v above ~0.74 (pack 49: the rear deck).
    // Pack 49: v 0.52-0.70 white, the rear deck at 0.75-0.81 black → the middle band only.
    uv[i * 2 + 1] = 0.42 + 0.28 * c(b);
  }
  return uv;
}
// The paint mask pixels (w × h RGBA).
// paintAll: every zone takes the garage colour except glass, lamps and the cabin (the car repainted
// whole in game); otherwise only the model's own paint.
const NOT_PAINT = new Set(['Glass_Gray', 'Projector_Glass', 'Taillight_Glass', 'Turn_Signal_LED', 'Interior_dark']);
// slots: the garage's three colours like gtv98's mask — colour 1 (red) body and glass, colour 2 (green)
// the lower band, colour 3 (blue) the hood; where each goes comes from the template's own mask.
const SLOT1 = new Set(['Body_Color', 'Wing', 'Glass_Gray']);
export function maskPixels(w, h, paintAll = false, slots = false) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const mat = ZONES[Math.floor((x / w) * 16)];
      if (slots) {
        // Like Escarabajo: colour 1 the body, colour 2 the lower band, colour 3 the hood; trim, vents,
        // grilles, chrome stay black (no garage colour).
        const c = mat === 'Hood_Paint' ? [0, 0, 255] : mat === 'Lower_Paint' ? [0, 255, 0] : SLOT1.has(mat) ? [255, 0, 0] : [0, 0, 0];
        px.set([...c, 255], (y * w + x) * 4);
        continue;
      }
      // Glass sits on red like gtv98's windows (its glass UVs: mask red); on black it came out fully
      // clear in game (pack 48).
      const paint = mat === 'Glass_Gray' || (paintAll ? !NOT_PAINT.has(mat) : isPaint(mat));
      px.set([paint ? 255 : 0, 0, 0, 255], (y * w + x) * 4);
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

// Pictures given with a model: the colour texture is the most colourful one (normal maps are blue-violet,
// AO / shadow maps grey).
async function pickColourImage(images) {
  let best = null; let bestScore = -1;
  for (const f of images) {
    try {
      const bmp = await createImageBitmap(f);
      const c = document.createElement('canvas'); c.width = 48; c.height = 48;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(bmp, 0, 0, 48, 48);
      const d = g.getImageData(0, 0, 48, 48).data;
      let sat = 0; let nrm = 0; let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 20) continue;
        const r = d[i]; const gg = d[i + 1]; const b = d[i + 2];
        const mx = Math.max(r, gg, b); const mn = Math.min(r, gg, b);
        sat += mx ? (mx - mn) / mx : 0; n++;
        if (b > 200 && Math.abs(r - 128) < 40 && Math.abs(gg - 128) < 40) nrm++;
      }
      const score = n && nrm < n * 0.5 ? sat / n : -1;
      if (score > bestScore) { bestScore = score; best = f; }
    } catch { /* not an image the browser reads */ }
  }
  return best;
}

// input: one File, or several (the model with its .mtl / .bin / pictures, any names, no folders needed).
async function readScene(input) {
  const files = [].concat(input);
  const main = files.find((f) => /\.(glb|gltf|fbx|obj)$/i.test(f.name));
  if (!main) throw new Error('ไม่เจอไฟล์โมเดล (.glb .gltf .fbx .obj)');
  const ext = main.name.split('.').pop().toLowerCase();
  const byName = new Map(files.map((f) => [f.name.toLowerCase(), f]));
  const urls = new Map();
  const manager = new THREE.LoadingManager();
  // A texture path inside the model (C:\\work\\tex\\body.png, textures/body.png) → the picture given with it.
  manager.setURLModifier((url) => {
    const base = decodeURIComponent(url.split(/[?#]/)[0]).split(/[\\/]/).pop().toLowerCase();
    const f = byName.get(base);
    if (!f) return url;
    if (!urls.has(f)) urls.set(f, URL.createObjectURL(f));
    return urls.get(f);
  });
  let pending = 0; let wake = null;
  manager.onStart = () => {};
  const itemStart = manager.itemStart.bind(manager); const itemEnd = manager.itemEnd.bind(manager); const itemError = manager.itemError.bind(manager);
  manager.itemStart = (u) => { pending++; itemStart(u); };
  manager.itemEnd = (u) => { pending--; itemEnd(u); if (!pending && wake) wake(); };
  manager.itemError = (u) => { itemError(u); };
  let scene;
  if (ext === 'fbx') scene = new FBXLoader(manager).parse(await main.arrayBuffer(), '');
  else if (ext === 'obj') {
    const loader = new OBJLoader(manager);
    const mtl = files.find((f) => /\.mtl$/i.test(f.name));
    if (mtl) {
      const mats = new MTLLoader(manager).parse(await mtl.text(), '');
      mats.preload();
      loader.setMaterials(mats);
    }
    scene = loader.parse(await main.text());
  } else {
    const loader = new GLTFLoader(manager);
    loader.setDRACOLoader(dracoLoader());
    scene = (await loader.parseAsync(ext === 'gltf' ? await main.text() : await main.arrayBuffer(), '')).scene;
  }
  if (pending) await Promise.race([new Promise((r) => { wake = r; }), new Promise((r) => setTimeout(r, 20000))]);
  // No texture reached the model (an .obj without .mtl, a model whose paths point elsewhere) but a
  // picture came with it: the colour picture on every material.
  const images = files.filter((f) => /\.(png|jpe?g|webp|bmp|gif|tga)$/i.test(f.name) || /^image\//.test(f.type));
  let hasMap = false;
  scene.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) if (m?.map?.image) hasMap = true; });
  if (!hasMap && images.length) {
    const pick = await pickColourImage(images);
    if (pick) {
      const img = await createImageBitmap(pick, { imageOrientation: 'flipY' });
      const tex = new THREE.Texture(img);
      tex.flipY = false; // flipped while decoding (ImageBitmap)
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      tex.userData.flipped = true;
      scene.traverse((o) => {
        if (!o.isMesh) return;
        for (const m of [].concat(o.material)) if (m) { m.map = tex; if (m.color) m.color.set('#ffffff'); m.needsUpdate = true; }
      });
    }
  }
  return scene;
}

// Colour of a texture under a uv (for telling glass / tyres apart on scans with one material).
const texReaders = new WeakMap();
function texSampler(tex) {
  if (!tex?.image) return null;
  if (texReaders.has(tex)) return texReaders.get(tex);
  let fn = null;
  try {
    const im = tex.image;
    const w0 = im.width || im.videoWidth; const h0 = im.height || im.videoHeight;
    const k = Math.min(1, 1024 / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * k)); const h = Math.max(1, Math.round(h0 * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(im, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    // Rows as stored: flipY textures (OBJ / FBX) have v = 0 at the bottom row; a bitmap flipped while
    // decoding has it at the top already (like glTF's).
    const flip = tex.flipY && !tex.userData?.flipped;
    fn = (u, v) => {
      u -= Math.floor(u); v -= Math.floor(v);
      const x = Math.min(w - 1, Math.floor(u * w)); const y = Math.min(h - 1, Math.floor((flip ? 1 - v : v) * h));
      const i = (y * w + x) * 4;
      return [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255];
    };
  } catch { fn = null; }
  texReaders.set(tex, fn);
  return fn;
}

// Reads a whole car model (.glb / .gltf / .fbx / .obj, usually with wheels, brakes, interior...) into a
// triangle soup in RayCity space, in metres, front towards −y, the bottom of the tyres at z = 0.
// The soup is split into connected pieces; the wheels (tyres, rims, brakes, calipers) are found by
// shape and position and start out removed — the game puts its own wheels on.
// Returns the model: { P, N (9 floats per triangle), M (material per triangle), C (piece per
// triangle), pieces, removed (per piece), wheels, materials: [{ name, tris, color, category }] }.
export async function loadModel(input) {
  const files = [].concat(input);
  const file = files.find((f) => /\.(glb|gltf|fbx|obj)$/i.test(f.name)) || files[0];
  const scene = await readScene(files);
  scene.updateMatrixWorld(true);
  const matIndex = new Map();
  const materials = [];
  const P = []; const N = []; const M = []; const skipTri = [];
  const TC = []; let texTris = 0; // colour under each corner (texture × material colour)
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
      const sample = g.attributes.uv ? texSampler(m?.map) : null;
      const base = m?.color ? [m.color.r, m.color.g, m.color.b] : [0.55, 0.55, 0.55];
      const uvA = g.attributes.uv;
      const end = Math.min(count, gr.start + gr.count);
      for (let t = gr.start; t + 2 < end; t += 3) {
        const ids = I ? [I[t], I[t + 1], I[t + 2]] : [t, t + 1, t + 2];
        const a = ids.map((i) => [wp[i * 3], wp[i * 3 + 1], wp[i * 3 + 2]]);
        let nv;
        if (nrm) nv = ids.map((i) => [wn[i * 3], wn[i * 3 + 1], wn[i * 3 + 2]]);
        else { const f = norm(cross(sub(a[1], a[0]), sub(a[2], a[0]))); nv = [f, f, f]; }
        P.push(...a[0], ...a[1], ...a[2]); N.push(...nv[0], ...nv[1], ...nv[2]);
        M.push(mi); skipTri.push(skipNode ? 1 : 0);
        for (const i of ids) {
          if (sample) { const c = sample(uvA.getX(i), uvA.getY(i)); TC.push(c[0] * base[0], c[1] * base[1], c[2] * base[2]); } else TC.push(...base);
        }
        if (sample) texTris++;
        materials[mi].tris++;
      }
    }
  });
  const nt = M.length;
  if (!nt) throw new Error('ไม่พบโมเดล 3 มิติในไฟล์นี้');
  const model = { P: new Float32Array(P), N: new Float32Array(N), M: Uint16Array.from(M), materials, name: file.name.replace(/\.[^.]+$/, '') };
  model.TC = new Float32Array(TC);
  model.textured = texTris > nt * 0.5;
  // A scan (one material over the whole car, its look in a picture): the picture tells the windows
  // (light, bluish or very bright, high up) and the tyres (dark, grey, low down) from the paint.
  const scan = model.textured && materials.length === 1;
  const ext = () => {
    const mn = [Infinity, Infinity, Infinity]; const mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < model.P.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], model.P[i + k]); mx[k] = Math.max(mx[k], model.P[i + k]); }
    return { mn, mx };
  };
  // Z-up files (scans, CAD exports): taller than long as read → height and length swapped (x negated
  // too, so it is a turn, not a mirror image).
  let e = ext();
  if (e.mx[2] - e.mn[2] > Math.max(e.mx[1] - e.mn[1], e.mx[0] - e.mn[0]) * 1.1) {
    const upZ = (A) => { for (let i = 0; i < A.length; i += 3) { const y = A[i + 1]; A[i] = -A[i]; A[i + 1] = A[i + 2]; A[i + 2] = y; } };
    upZ(model.P); upZ(model.N);
    for (const w of wheelNodes) w.p = [-w.p[0], w.p[2], w.p[1]];
    e = ext();
  }
  // Lying sideways (long along x): turn a quarter.
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

  if (scan) splitScan(model);
  findPieces(model);
  findWheels(model, skipTri);
  if (model.splitByMat) scanRims(model);
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
  // (Not for scans: windows found by colour say nothing reliable about the front; keep the file's.)
  if (!front && !model.splitByMat) {
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
  // A car fitted to the game's wheels turns at its own size, then fits again.
  const fit = model.fit;
  if (model.orig) { unfitWheels(model); model.orig = null; }
  for (const A of [model.P, model.N]) for (let i = 0; i < A.length; i += 3) { A[i] = -A[i]; A[i + 1] = -A[i + 1]; }
  for (const p of model.pieces) {
    [p.min[0], p.max[0]] = [-p.max[0], -p.min[0]];
    [p.min[1], p.max[1]] = [-p.max[1], -p.min[1]];
  }
  for (const w of model.wheels) { w.p[0] = -w.p[0]; w.p[1] = -w.p[1]; }
  if (fit) fitToWheels(model, fit.game, fit.mode);
}

// Scans: windows and tyres told apart by the picture's colour (per triangle, then smoothed by the
// neighbours' vote), each its own material; pieces then split by material so the tyres are pieces
// the wheel finder sees.
function splitScan(model) {
  const { P, TC, M, materials } = model;
  const nt = M.length;
  let zMin = Infinity; let zMax = -Infinity;
  for (let i = 2; i < P.length; i += 3) { zMin = Math.min(zMin, P[i]); zMax = Math.max(zMax, P[i]); }
  const H = zMax - zMin;
  const label = new Uint8Array(nt); // 0 paint, 1 window, 2 tyre
  for (let t = 0; t < nt; t++) {
    let r = 0; let g = 0; let b = 0;
    for (let j = 0; j < 3; j++) { r += TC[t * 9 + j * 3]; g += TC[t * 9 + j * 3 + 1]; b += TC[t * 9 + j * 3 + 2]; }
    r /= 3; g /= 3; b /= 3;
    const v = Math.max(r, g, b); const sat = v ? (v - Math.min(r, g, b)) / v : 0;
    const z = (P[t * 9 + 2] + P[t * 9 + 5] + P[t * 9 + 8]) / 3 - zMin;
    if (v < 0.3 && sat < 0.45 && z < H * 0.4) label[t] = 2;
    else if (z > H * 0.5 && ((b > r + 0.06 && b > 0.5 && sat < 0.6) || (v > 0.85 && sat < 0.15))) label[t] = 1;
  }
  // Neighbours (shared corners) vote twice: no speckles.
  const byKey = new Map();
  const keyOf = (o) => `${Math.round(P[o] * 1e4)},${Math.round(P[o + 1] * 1e4)},${Math.round(P[o + 2] * 1e4)}`;
  for (let t = 0; t < nt; t++) for (let j = 0; j < 3; j++) { const k = keyOf(t * 9 + j * 3); const l = byKey.get(k); if (l) l.push(t); else byKey.set(k, [t]); }
  for (let round = 0; round < 2; round++) {
    const next = label.slice();
    for (let t = 0; t < nt; t++) {
      const votes = [0, 0, 0];
      for (let j = 0; j < 3; j++) for (const u of byKey.get(keyOf(t * 9 + j * 3))) votes[label[u]]++;
      const best = votes.indexOf(Math.max(...votes));
      if (votes[best] > votes[label[t]]) next[t] = best;
    }
    label.set(next);
  }
  const name = materials[0].name;
  const add = (suffix, category) => { materials.push({ name: `${name}_${suffix}`, tris: 0, color: suffix === 'window' ? '#9ac4e8' : '#222222', category }); return materials.length - 1; };
  const ids = [0, add('window', 'Glass_Gray'), add('tyre', 'skip')];
  for (let t = 0; t < nt; t++) if (label[t]) { M[t] = ids[label[t]]; materials[0].tris--; materials[M[t]].tris++; }
  model.splitByMat = true;
}

// Scans: the rims are painted like the body and joined to it; what lies inside a found tyre (its
// circle, from its outer face inwards) goes with the wheel.
function scanRims(model) {
  const { P, M, materials, wheels } = model;
  if (!wheels.length) return;
  const tyre = materials.findIndex((m) => m.category === 'skip');
  if (tyre < 0) return;
  for (let t = 0; t < M.length; t++) {
    if (M[t] === tyre) continue;
    const c = [0, 1, 2].map((k) => (P[t * 9 + k] + P[t * 9 + 3 + k] + P[t * 9 + 6 + k]) / 3);
    for (const w of wheels) {
      if (Math.sign(c[0]) !== Math.sign(w.p[0])) continue;
      const d = Math.hypot(c[1] - w.p[1], c[2] - w.p[2]);
      if (d < w.r * 0.8 && Math.abs(c[0]) > Math.abs(w.p[0]) - w.r * 0.6) { materials[M[t]].tris--; M[t] = tyre; materials[tyre].tris++; break; }
    }
  }
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
      const k = `${Math.round(P[o] * 1e4)},${Math.round(P[o + 1] * 1e4)},${Math.round(P[o + 2] * 1e4)}${model.splitByMat ? `|${model.M[t]}` : ''}`;
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
  // A "light" material high on the car is a window (a model naming its glass "...light..." had its
  // windscreen split into head / tail lamps): lamps sit below the beltline.
  if (model.zTop === undefined) { let z = 0; for (let i = 2; i < model.P.length; i += 3) z = Math.max(z, model.P[i]); model.zTop = z; }
  if ((model.P[t * 9 + 2] + model.P[t * 9 + 5] + model.P[t * 9 + 8]) / 3 > model.zTop * 0.6) return 'Glass_Gray';
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
// In game these part files are not drawn with the car's paint (pack 40: the front and lower sides stayed
// dark whatever their texture); the same geometry in the hood / roof files came out white and
// repaintable (pack 44). Builds in the template layout put it there.
export const INTO_DRAWN = { frontbumper: 'hood', headlight: 'hood', grill: 'hood', skirt: 'roof' };

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
export async function removeHidden(tris, log = () => {}, passThrough = null) {
  // passThrough(t): triangles rays go through (see-through glass), still kept themselves.
  const ref = makeReference(passThrough ? tris.filter((t) => !passThrough(t)) : tris);
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
  const bySlot = new Map();
  for (const t of tris) {
    const slot = m.slotOf(t.c0, t.n, t.mat);
    if (!bySlot.has(slot)) bySlot.set(slot, new Map());
    const g = bySlot.get(slot);
    if (!g.has(t.mat)) g.set(t.mat, []);
    g.get(t.mat).push(t);
  }
  const out = {};
  // weldCos: points at one spot share a vertex when their normals are within this (sharp edges kept).
  const buildParts = (g, weldCos) => {
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
          let v = cands.find((c) => N[c * 3] * n[0] + N[c * 3 + 1] * n[1] + N[c * 3 + 2] * n[2] >= weldCos);
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
    return parts;
  };
  for (const [slot, g] of bySlot) {
    const parts = buildParts(g, Math.cos((35 * Math.PI) / 180));
    const before = parts.reduce((s, q) => s + q.positions.length / 3, 0);
    let fit = fitParts(parts, 1, cap, 64000); // room for the template's stand-in pieces
    if ((cap && fit.verts > cap) || fit.verts > 64000) {
      // Noisy surfaces (3D scans): the sharp-edge splits leave thousands of loose islands the reducer
      // cannot join. Welded by position only, normals smoothed afterwards.
      const smooth = fitParts(buildParts(g, -2), 1, cap, 64000);
      if (smooth.verts < fit.verts) { fit = smooth; log(`${slot}: ผิวขรุขระ (แบบสแกน) เชื่อมจุดทั้งหมดก่อนลด`); }
    }
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
// RGBA → .png (8-bit RGBA, no filter), deflated with CompressionStream: the same in the page and in node.
const PNG_CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
async function png(px, w, h) {
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) raw.set(px.subarray ? px.subarray(y * w * 4, (y + 1) * w * 4) : px.slice(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  const idat = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  const chunk = (type, data) => {
    const out = new Uint8Array(12 + data.length); const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    let c = 0xffffffff;
    for (let i = 4; i < 8 + data.length; i++) c = PNG_CRC[(c ^ out[i]) & 0xff] ^ (c >>> 8);
    dv.setUint32(8 + data.length, (c ^ 0xffffffff) >>> 0);
    return out;
  };
  const ihdr = new Uint8Array(13); const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, q) => n + q.length, 0));
  let o = 0; for (const q of parts) { out.set(q, o); o += q.length; }
  return out;
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

export async function convert(model, { name, template, categories = new Map(), maxVerts = 3500, voxel = 0.015, raw = false, smooth = true, hideInterior = true, paintAll = true, slots = false, colours = 'tail', layout = 'template', partTextures = false, log = () => {} }) {
  await MeshoptSimplifier.ready;
  log('อ่านโมเดล…');
  const src = collect(model, categories);
  if (raw && hideInterior) {
    // With the template's see-through glass the cabin seen through the windows stays.
    src.outside = await removeHidden(src.tris, log);
    src.tris = layout === 'template' ? await removeHidden(src.tris, log, (t) => t.mat === 'Glass_Gray') : src.outside;
  }
  log(`ตัวรถ (ถอดล้อแล้ว): ${src.tris.length.toLocaleString()} สามเหลี่ยม, ยาว ${src.length.toFixed(2)} ม., ล้อ ${src.wheels.length}`);
  await tick();
  const m = metrics(src.tris, src.wheels);
  let bent = null;
  // Both layouts put every piece into the template's file for that spot (doors in roof like gtv98).
  if (layout === 'template' || layout === 'zones' || layout === 'atlas' || layout === 'islands' || layout === 'charts') {
    // The template bent onto this car first: every triangle goes into the file the template has at that
    // spot (gtv98's doors are in its roof file, not the body) so the UVs copied later come from the
    // same file and never jump across the texture (pack 44 / 45: black doors).
    log('ดัดรถแม่แบบเข้าหาทรงรถ แล้วแบ่งชิ้นตามไฟล์ของแม่แบบ…');
    await tick();
    const outsideForBend = src.outside || await removeHidden(src.tris, log);
    ({ bent } = await bendTemplate(model, { name, template, outside: outsideForBend, geometryOnly: true, log }));
    const near = nearestTemplateFile(bent);
    const slotOf0 = m.slotOf;
    m.slotOf = (c0, n, mat) => {
      const s0 = slotOf0(c0, n, mat);
      // Lamps stay where the lamp finder put them; everything else follows the template.
      const s = s0 === 'headlight' || s0 === 'rearlight' ? s0 : near(c0, /glass/i.test(mat) ? 1 : 0) || s0;
      return INTO_DRAWN[s] || s;
    };
    // Three garage colours where the template has them: its mask's colour under the closest point of
    // the bent template (gtv98: green lower band → colour 2, blue hood → colour 3).
    if (slots && (layout === 'zones' || layout === 'atlas' || layout === 'islands' || layout === 'charts')) {
      const slotAt = await templateMaskSlots(bent, template);
      const paint = src.tris.filter((t) => t.mat === 'Body_Color' || t.mat === 'Wing');
      let lab = smoothLabels(paint, paint.map((t) => slotAt(t.c0)));
      const pickup = colours === 'pickup';
      if (colours === 'band') {
        // Colour 2 (the lower band all around, like Escarabajo) by height: a straight line along the car
        // instead of the template's band edge, which falls ragged across this car's triangles.
        let z0 = Infinity; let z1 = -Infinity;
        for (const t of paint) { z0 = Math.min(z0, t.c0[2]); z1 = Math.max(z1, t.c0[2]); }
        const line = z0 + (z1 - z0) * 0.3;
        lab = smoothLabels(paint, lab.map((l, i) => (l === 3 ? 3 : paint[i].c0[2] < line && Math.abs(paint[i].n[2]) < 0.8 ? 2 : 1)));
      }
      if (colours === 'tail' || pickup) {
        // Body / hood / tail lid like game cars: colour 1 the body, colour 3 the hood (the template's),
        // colour 2 the tail lid (a sedan's trunk lid, a hatch / pickup tailgate).
        const tail = tailTris(paint.map((t) => ({ c: t.c0, n: t.n })), pickup);
        lab = smoothLabels(paint, lab.map((l, i) => (tail[i] ? 2 : l === 3 ? 3 : 1)));
        log(`3 สี: ฝาท้าย ${tail.filter(Boolean).length.toLocaleString()} สามเหลี่ยม = สี 2 · ฝากระโปรง = สี 3 · ตัวถังสี 1`);
      }
      paint.forEach((t, i) => { if (lab[i] === 3) t.mat = 'Hood_Paint'; else if (lab[i] === 2) t.mat = 'Lower_Paint'; });
    }
  }
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
  if (layout === 'template') {
    log('คัดลอก UV จากรถแม่แบบ…');
    await tick();
    uvsFromTemplate(lod, bent);
  } else if (layout === 'islands') {
    log('ตัด UV ตามเกาะของรถแม่แบบ (แผงเดียวกัน ตำแหน่งเดียวกันบนรูป)…');
    await tick();
    islandUVs(lod, bent, { slots });
  }
  return writeCar(lod, { name, template, bounds, paintAll, slots, partTextures, layout, log });
}

// "Atlas" layout: every triangle projected by its own face direction into one region of the texture —
// left side, right side, top, front, rear, each its own rectangle in the band that works (no overlaps), so a shop decal spreads
// over the car like on a game car (pack 53) and no triangle stretches across the texture (stretched
// triangles showed black / the wheels' picture, packs 44-53). Points shared across regions are split.
// Glass, trim and lamps take one point each in a reserved strip (flat UVs on a known texel are how game
// cars colour whole pieces: polestar1). The mask is drawn triangle by triangle with its colour slot.
// Returns { mask (1024² RGBA), colour (cw×ch RGBA) }.
// Only the band v 0.34-0.73 of the texture works for this car in game: above it (v < 0.33) the wheels'
// picture shows (pack 54: the whole left side; pack 48: everything below 0.45 m), below it (v > 0.74)
// black / other pictures (pack 55: hood, roof, rear deck, front and rear; packs 48 / 49: the rear deck).
// Pack 55's sides in v 0.37-0.73 took the three colours and the shop decals right.
const ATLAS_FLAT = { 1: [0.05, 0.40], 2: [0.05, 0.45], 3: [0.05, 0.50], glass: [0.05, 0.55], black: [0.05, 0.60] };
// "Charts" layout, the way Escarabajo's UVs are made: every panel (triangles facing the same way and
// connected) is its own piece, projected flat from its side, and no two pieces share texture — so a
// colour painted on one panel never lands on another, and nothing stretches. Pieces sit where
// Escarabajo has them: one side along the top, the other side in the lower middle, the top view in the
// middle, front and rear in the side columns; pieces that would cover another one (inner walls, layers)
// are packed in the free bottom strip. The bottom-left corner (the game's block in the colour layer) and
// Escarabajo's glass rectangle stay free. Trim / lamps sit on one black spot. Mask: every triangle in its
// colour slot. Returns { mask (1024² RGBA), colour (cw×ch RGBA, clear), size }.
// The sheet the shop decals are drawn for (Escarabajo's decal, 2026-10-13): the car unfolded — the left side
// (+x) along the top, upside down (wheels at the top edge, roof line at the bottom), the top view in the
// middle (left side's edge up), the right side (−x) below it upright; the front of the car to the right
// everywhere (numbers near the front doors at u ≈ 0.7). Each region filled along both axes.
const CHART_REGIONS = {
  left: [0.10, 0.005, 0.95, 0.215], top: [0.10, 0.23, 0.95, 0.515], right: [0.10, 0.525, 0.95, 0.80],
  front: [0.56, 0.82, 0.75, 0.99], rear: [0.77, 0.82, 0.96, 0.99], bottom: [0.19, 0.82, 0.54, 0.99],
};
const CHART_BLACK = [0.07, 0.60];
export function chartsLayout(lod, { slots, cw = 128, ch = 64, size = 1024 }) {
  const SIZE = size; const G = 512; // occupancy grid
  const lo = [Infinity, Infinity, Infinity]; const hi = [-Infinity, -Infinity, -Infinity];
  for (const parts of Object.values(lod)) for (const p of parts) for (let i = 0; i < p.positions.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p.positions[i + k]); hi[k] = Math.max(hi[k], p.positions[i + k]); }
  const ext = [hi[0] - lo[0] || 1, hi[1] - lo[1] || 1, hi[2] - lo[2] || 1];
  // per side: which axes go to u / v (RayCity: x left, y back, z up; v grows downwards on the sheet)
  // the front of the car towards +u (right), like every game car's sheet (Escarabajo / gtv98: u ≈ −0.18·y), so
  // shop decals land the right way round
  // [u axis, v axis, u flipped (front to the right), v flipped (upside down)]
  const AX = { left: [1, 2, true, true], right: [1, 2, true, false], top: [1, 0, true, false], front: [0, 2, false, false], rear: [0, 2, true, false] };
  const scaleOf = {};
  for (const [side, [a, b]] of Object.entries(AX)) { const r = CHART_REGIONS[side]; scaleOf[side] = Math.min((r[2] - r[0]) / ext[a], (r[3] - r[1]) / ext[b]); }
  // Escarabajo's own mapping, measured on its sheet (gtv98 the same within 1-6 %): with x, y, z scaled to
  // 0..1 over the car (y = 0 the front), u and v of its left side, top view and right side
  const ESC = {
    left: (n) => [1.000 - 0.891 * n[1], 0.017 + 0.284 * n[2]],
    top: (n) => [0.966 - 0.804 * n[1], 0.540 - 0.326 * n[0]],
    right: (n) => [0.994 - 0.874 * n[1], 0.753 - 0.291 * n[2]],
  };
  const projUV = (side, q, sc = null) => {
    if (!sc && ESC[side]) return ESC[side]([0, 1, 2].map((k) => (q[k] - lo[k]) / ext[k]));
    const [a, b, flip, vflip] = AX[side]; const r = CHART_REGIONS[side];
    // the region filled along both axes like the decal sheet (sc given: one scale, for packed pieces)
    const fa = sc ? (q[a] - lo[a]) * sc : ((q[a] - lo[a]) / ext[a]) * (r[2] - r[0]);
    const fb = sc ? (hi[b] - q[b]) * sc : ((hi[b] - q[b]) / ext[b]) * (r[3] - r[1]);
    const W = sc ? ext[a] * sc : r[2] - r[0]; const H = sc ? ext[b] * sc : r[3] - r[1];
    return [r[0] + (flip ? W - fa : fa), r[1] + (vflip ? H - fb : fb)];
  };
  const slotOfMat = (m) => {
    if (m === 'Glass_Gray') return 'glass';
    if (NOT_PAINT.has(m)) return 'black';
    if (!slots) return 1;
    if (m === 'Hood_Paint') return 3;
    if (m === 'Lower_Paint') return 2;
    if (m === 'Body_Color' || m === 'Wing') return 1;
    return 'black';
  };
  // 1. triangles by side; charts = connected (shared corner positions) triangles of one side and part
  const tris = []; // { p, t, side, slot }
  const parts = [];
  for (const list of Object.values(lod)) for (const p of list) parts.push(p);
  // which way the files' normals point: outwards (away from the car's middle) for most triangles, or
  // inwards (the owner's canyon) — then they are read reversed
  const mid = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const outward = (p) => {
    let sgn = 0; const P = p.positions; const N = p.normals;
    for (let i = 0; i < P.length; i += 3) sgn += (P[i] - mid[0]) * N[i] + (P[i + 1] - mid[1]) * N[i + 1] + (P[i + 2] - mid[2]) * N[i + 2];
    return sgn >= 0 ? 1 : -1;
  };
  parts.forEach((p, pi) => {
    const k = slotOfMat(p.name); const P = p.positions; const I = p.indices; const nsign = outward(p);
    for (let t = 0; t < I.length; t += 3) {
      const q = [I[t], I[t + 1], I[t + 2]].map((i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
      // facing by the files' normals (the winding can run either way); the face's own if they cancel out
      const vi0 = [I[t], I[t + 1], I[t + 2]]; let fn = [0, 1, 2].map((kk) => nsign * vi0.reduce((sum, i) => sum + p.normals[i * 3 + kk], 0));
      if (Math.abs(fn[0]) + Math.abs(fn[1]) + Math.abs(fn[2]) < 1e-6) fn = cross(sub(q[1], q[0]), sub(q[2], q[0]));
      const ax = Math.abs(fn[0]); const ay = Math.abs(fn[1]); const az = Math.abs(fn[2]);
      // facing down (the floor, the wheel-arch liners): black like game cars, by the files' normals
      let side;
      if (typeof k !== 'number') side = 'flat';
      else if (az >= ax && az >= ay) side = fn[2] >= 0 ? 'top' : 'bottom';
      else if (ax >= ay) side = fn[0] >= 0 ? 'left' : 'right';
      else side = fn[1] < 0 ? 'front' : 'rear';
      tris.push({ pi, t, side, slot: k, q, fn });
    }
  });
  // the floor and the wheel wells black, on the black spot
  const under = underTris(tris.map((tr) => ({ c: [0, 1, 2].map((kk) => (tr.q[0][kk] + tr.q[1][kk] + tr.q[2][kk]) / 3), n: tr.fn })));
  tris.forEach((tr, i) => { if (under[i] && typeof tr.slot === 'number') { tr.side = 'flat'; tr.slot = 'black'; } });
  const key = (v) => `${Math.round(v[0] * 1e4)},${Math.round(v[1] * 1e4)},${Math.round(v[2] * 1e4)}`;
  const par = new Int32Array(tris.length).map((_, i) => i);
  const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const byKey = new Map();
  tris.forEach((tr, i) => { if (tr.side === 'flat') return; for (const v of tr.q) { const k2 = `${tr.pi}|${tr.side}|${key(v)}`; const j = byKey.get(k2); if (j === undefined) byKey.set(k2, i); else par[find(i)] = find(j); } });
  const charts = new Map();
  tris.forEach((tr, i) => { if (tr.side === 'flat') return; const r = find(i); if (!charts.has(r)) charts.set(r, { side: tr.side, tris: [] }); charts.get(r).tris.push(i); });
  // 2. place each chart at its spot; a chart that would cover texels another chart owns moves to the bottom strip
  const grid = new Int32Array(G * G).fill(-1);
  const cellsOf = (uvTris) => {
    const cells = new Set();
    for (const tq of uvTris) {
      const xs = tq.map((t) => t[0] * G); const ys = tq.map((t) => t[1] * G);
      const d = (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0]);
      const x0 = Math.max(0, Math.floor(Math.min(...xs))); const x1 = Math.min(G - 1, Math.floor(Math.max(...xs)));
      const y0 = Math.max(0, Math.floor(Math.min(...ys))); const y1 = Math.min(G - 1, Math.floor(Math.max(...ys)));
      if (Math.abs(d) < 1e-9 || (x1 - x0 + 1) * (y1 - y0 + 1) <= 2) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells.add(y * G + x); continue; }
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = x + 0.5; const py = y + 0.5;
        const a = ((xs[1] - px) * (ys[2] - py) - (xs[2] - px) * (ys[1] - py)) / d;
        const b = ((xs[2] - px) * (ys[0] - py) - (xs[0] - px) * (ys[2] - py)) / d;
        if (a > -0.15 && b > -0.15 && 1 - a - b > -0.15) cells.add(y * G + x);
      }
    }
    return cells;
  };
  const list = [...charts.entries()].map(([id, c]) => ({ id, ...c }));
  for (const c of list) {
    if (c.side === 'bottom') { c.uv = null; continue; }
    c.uv = c.tris.map((i) => tris[i].q.map((q) => projUV(c.side, q)));
    let area = 0; for (const tq of c.uv) area += Math.abs((tq[1][0] - tq[0][0]) * (tq[2][1] - tq[0][1]) - (tq[2][0] - tq[0][0]) * (tq[1][1] - tq[0][1])) / 2;
    c.area = area;
  }
  list.sort((a, b) => (b.area || 0) - (a.area || 0));
  const displaced = [];
  for (const c of list) {
    if (!c.uv) { displaced.push(c); continue; }
    const cells = cellsOf(c.uv); let clash = 0;
    for (const cell of cells) if (grid[cell] >= 0 && grid[cell] !== c.id) clash++;
    if (clash > Math.max(1, cells.size * 0.02)) { displaced.push(c); continue; }
    for (const cell of cells) grid[cell] = c.id;
  }
  // 3. displaced charts (and bottom-facing ones) shelf-packed into the bottom strip, each projected from its own side
  const reg = CHART_REGIONS.bottom; const local = (c, sc) => {
    const side = c.side === 'bottom' ? 'top' : c.side; const [a, b] = AX[side];
    const pts = c.tris.map((i) => tris[i].q.map((q) => [q[a] * sc, -q[b] * sc]));
    let mu = Infinity; let mv = Infinity; let Mu = -Infinity; let Mv = -Infinity;
    for (const tq of pts) for (const [u, v] of tq) { mu = Math.min(mu, u); mv = Math.min(mv, v); Mu = Math.max(Mu, u); Mv = Math.max(Mv, v); }
    return { pts, w: Mu - mu, h: Mv - mv, mu, mv };
  };
  const base = Math.min(...Object.values(scaleOf));
  let sc = base;
  for (let tries = 0; tries < 30 && displaced.length; tries++) {
    const L = displaced.map((c) => ({ c, ...local(c, sc) })).sort((a, b) => b.h - a.h);
    const pad = 2 / SIZE; let x = reg[0]; let y = reg[1]; let rowH = 0; let ok = true;
    for (const e of L) {
      if (x + e.w > reg[2]) { x = reg[0]; y += rowH + pad; rowH = 0; }
      if (y + e.h > reg[3] || e.w > reg[2] - reg[0]) { ok = false; break; }
      e.at = [x - e.mu, y - e.mv]; x += e.w + pad; rowH = Math.max(rowH, e.h);
    }
    if (ok) { for (const e of L) e.c.uv = e.pts.map((tq) => tq.map(([u, v]) => [u + e.at[0], v + e.at[1]])); break; }
    sc *= 0.85;
  }
  for (const c of displaced) if (!c.uv) c.uv = c.tris.map(() => [CHART_BLACK, CHART_BLACK, CHART_BLACK]); // nothing fitted (never seen)
  // 4. new points (split per chart) and the mask, triangle by triangle
  const uvOf = new Map(); // tri index → [uv, uv, uv]
  for (const c of list) c.tris.forEach((i, k) => uvOf.set(i, c.uv[k]));
  const mask = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let i = 0; i < mask.length; i += 4) mask.set([255, 0, 0, 255], i);
  const RGB = { 1: [255, 0, 0], 2: [0, 255, 0], 3: [0, 0, 255] };
  const fill = (uvs, c) => {
    const xs = uvs.map((t) => t[0] * SIZE); const ys = uvs.map((t) => t[1] * SIZE);
    const d = (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0]);
    if (Math.abs(d) < 1e-9) return;
    const tol = 1.5 / Math.sqrt(Math.abs(d));
    for (let y = Math.max(0, Math.floor(Math.min(...ys)) - 2); y <= Math.min(SIZE - 1, Math.ceil(Math.max(...ys)) + 2); y++) {
      for (let x = Math.max(0, Math.floor(Math.min(...xs)) - 2); x <= Math.min(SIZE - 1, Math.ceil(Math.max(...xs)) + 2); x++) {
        const px = x + 0.5; const py = y + 0.5;
        const a = ((xs[1] - px) * (ys[2] - py) - (xs[2] - px) * (ys[1] - py)) / d;
        const b = ((xs[2] - px) * (ys[0] - py) - (xs[0] - px) * (ys[2] - py)) / d;
        if (a > -tol && b > -tol && 1 - a - b > -tol) mask.set([...c, 255], (y * SIZE + x) * 4);
      }
    }
  };
  { const cx = Math.round(CHART_BLACK[0] * SIZE); const cy = Math.round(CHART_BLACK[1] * SIZE); for (let y = cy - 8; y <= cy + 8; y++) for (let x = cx - 8; x <= cx + 8; x++) mask.set([0, 0, 0, 255], (y * SIZE + x) * 4); }
  const per = new Map(); tris.forEach((tr, i) => { if (!per.has(tr.pi)) per.set(tr.pi, []); per.get(tr.pi).push(i); });
  parts.forEach((p, pi) => {
    const P = p.positions; const N = p.normals; const I = p.indices;
    const nP = []; const nN = []; const nUV = []; const nI = []; const keyOf = new Map();
    for (const i of per.get(pi) || []) {
      const tr = tris[i]; const uv3 = tr.side === 'flat' ? [CHART_BLACK, CHART_BLACK, CHART_BLACK] : uvOf.get(i);
      const chartId = tr.side === 'flat' ? -1 : find(i);
      const v = [I[tr.t], I[tr.t + 1], I[tr.t + 2]];
      for (let j = 0; j < 3; j++) {
        const k2 = `${v[j]}|${chartId}`;
        let id = keyOf.get(k2);
        if (id === undefined) { id = nP.length / 3; keyOf.set(k2, id); nP.push(P[v[j] * 3], P[v[j] * 3 + 1], P[v[j] * 3 + 2]); nN.push(N[v[j] * 3], N[v[j] * 3 + 1], N[v[j] * 3 + 2]); nUV.push(uv3[j][0], uv3[j][1]); }
        nI.push(id);
      }
      if (typeof tr.slot === 'number' && tr.slot !== 1) fill(uv3, RGB[tr.slot]);
    }
    p.kind = KIND_OF[p.name] || 0;
    p.positions = new Float32Array(nP); p.normals = new Float32Array(nN); p.uvs = new Float32Array(nUV); p.indices = Uint32Array.from(nI);
  });
  return { mask, colour: new Uint8ClampedArray(cw * ch * 4), size: SIZE };
}

function atlasLayout(lod, { slots, paintAll, cw = 128, ch = 64 }) {
  const lo = [Infinity, Infinity, Infinity]; const hi = [-Infinity, -Infinity, -Infinity];
  for (const parts of Object.values(lod)) for (const p of parts) for (let i = 0; i < p.positions.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p.positions[i + k]); hi[k] = Math.max(hi[k], p.positions[i + k]); }
  const L = hi[1] - lo[1] || 1; const Wd = hi[0] - lo[0] || 1; const H = hi[2] - lo[2] || 1;
  const fx = (x) => (x - lo[0]) / Wd; const fy = (y) => (y - lo[1]) / L; const fz = (z) => (hi[2] - z) / H;
  const proj = {
    left: (q) => [0.10 + 0.88 * fy(q[1]), 0.345 + 0.12 * fz(q[2])],
    right: (q) => [0.10 + 0.88 * fy(q[1]), 0.472 + 0.12 * fz(q[2])],
    top: (q) => [0.10 + 0.58 * fy(q[1]), 0.599 + 0.126 * fx(q[0])],
    front: (q) => [0.70 + 0.13 * fx(q[0]), 0.599 + 0.126 * fz(q[2])],
    rear: (q) => [0.85 + 0.13 * fx(q[0]), 0.599 + 0.126 * fz(q[2])],
  };
  const SIZE = 1024;
  const mask = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let i = 0; i < mask.length; i += 4) mask.set([255, 0, 0, 255], i);
  const RGB = { 1: [255, 0, 0], 2: [0, 255, 0], 3: [0, 0, 255], glass: [255, 0, 0], black: [0, 0, 0] };
  const square = (uv, c) => { const cx = Math.round(uv[0] * SIZE); const cy = Math.round(uv[1] * SIZE); for (let y = cy - 6; y <= cy + 6; y++) for (let x = cx - 6; x <= cx + 6; x++) mask.set([...c, 255], (y * SIZE + x) * 4); };
  for (const k of Object.keys(ATLAS_FLAT)) square(ATLAS_FLAT[k], RGB[k]);
  const fill = (uvs, c) => {
    const xs = uvs.map((t) => t[0] * SIZE); const ys = uvs.map((t) => t[1] * SIZE);
    const d = (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0]);
    if (Math.abs(d) < 1e-9) return;
    const tol = 2.5 / Math.sqrt(Math.abs(d)); // about two pixels around the triangle
    for (let y = Math.max(0, Math.floor(Math.min(...ys)) - 3); y <= Math.min(SIZE - 1, Math.ceil(Math.max(...ys)) + 3); y++) {
      for (let x = Math.max(0, Math.floor(Math.min(...xs)) - 3); x <= Math.min(SIZE - 1, Math.ceil(Math.max(...xs)) + 3); x++) {
        const px = x + 0.5; const py = y + 0.5;
        const a = ((xs[1] - px) * (ys[2] - py) - (xs[2] - px) * (ys[1] - py)) / d;
        const b = ((xs[2] - px) * (ys[0] - py) - (xs[0] - px) * (ys[2] - py)) / d;
        if (a > -tol && b > -tol && 1 - a - b > -tol) mask.set([...c, 255], (y * SIZE + x) * 4);
      }
    }
  };
  const slotOfMat = (m) => {
    if (m === 'Glass_Gray') return 'glass';
    if (NOT_PAINT.has(m)) return 'black';
    if (!slots) return 1;
    if (m === 'Hood_Paint') return 3;
    if (m === 'Lower_Paint') return 2;
    if (m === 'Body_Color' || m === 'Wing') return 1;
    return 'black'; // trim, grille, chrome, plastic: no garage colour (like Escarabajo)
  };
  // Paint first, then the triangles of the other slots over it where they meet.
  const order = [];
  for (const parts of Object.values(lod)) for (const p of parts) order.push(p);
  for (const p of order) {
    const k = slotOfMat(p.name);
    const P = p.positions; const N = p.normals; const I = p.indices;
    const nP = []; const nN = []; const nUV = []; const nI = []; const keyOf = new Map();
    const flat = typeof k !== 'number' || (k === 1 && false);
    for (let t = 0; t < I.length; t += 3) {
      const v = [I[t], I[t + 1], I[t + 2]];
      const q = v.map((i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
      const e1 = q[1].map((x, j) => x - q[0][j]); const e2 = q[2].map((x, j) => x - q[0][j]);
      const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const ax = Math.abs(fn[0]); const ay = Math.abs(fn[1]); const az = Math.abs(fn[2]);
      let region;
      if (flat) region = 'flat';
      else if (az >= ax && az >= ay) region = fn[2] >= 0 ? 'top' : 'flat';
      else if (ax >= ay) region = fn[0] >= 0 ? 'left' : 'right';
      else region = fn[1] < 0 ? 'front' : 'rear';
      const uvT = [];
      for (let j = 0; j < 3; j++) {
        const key = `${v[j]}|${region}`;
        let id = keyOf.get(key);
        const uv = region === 'flat' ? ATLAS_FLAT[typeof k === 'number' ? k : k] : proj[region](q[j]);
        if (id === undefined) { id = nP.length / 3; keyOf.set(key, id); nP.push(...q[j]); nN.push(N[v[j] * 3], N[v[j] * 3 + 1], N[v[j] * 3 + 2]); nUV.push(uv[0], uv[1]); }
        nI.push(id);
        uvT.push(uv);
      }
      if (region !== 'flat' && typeof k === 'number' && k !== 1) fill(uvT, RGB[k]);
    }
    p.positions = new Float32Array(nP); p.normals = new Float32Array(nN); p.uvs = new Float32Array(nUV); p.indices = Uint32Array.from(nI);
  }
  // The colour layer: clear, gtv98's under-window value under the glass point.
  const colour = new Uint8ClampedArray(cw * ch * 4);
  const gx = Math.round(ATLAS_FLAT.glass[0] * cw); const gy = Math.round(ATLAS_FLAT.glass[1] * ch);
  for (let y = gy - 2; y <= gy + 2; y++) for (let x = gx - 2; x <= gx + 2; x++) colour.set([56, 59, 59, 0], (y * cw + x) * 4);
  return { mask, colour, size: SIZE };
}

// A car folder in the template's layout from finished geometry. lod: { slot ('body', 'hood', ...):
// [parts with positions, normals, uvs, indices] }; bounds: [min, max] of the body (mesh.xml).
// Returns Map(rel → Uint8Array).
export async function writeCar(lod, { name, template, bounds, paintAll = true, slots = false, partTextures = false, layout = 'zones', log = () => {} }) {
  const tpl = template.files;
  const tplName = template.name;
  // layout 'template': the pieces already carry the template's UV layout (uvsFromTemplate), so the
  // template's own textures (paint mask, colour layer, part textures) are used as they are.
  const asTemplate = layout === 'template' || layout === 'islands';
  // Geometry still in a file the game does not paint (Studio, old-body mode) joins its drawn neighbour
  // while that file stays within what has loaded in game.
  if (asTemplate) {
    for (const [from, to] of Object.entries(INTO_DRAWN)) {
      if (!lod[from]?.length) continue;
      let merged = [...(lod[to] || []), ...lod[from]];
      // a .0m holds 65,535 points and 65,535 indices (21,845 triangles): reduced again when the two together are over
      const ni = merged.reduce((t, q) => t + q.indices.length, 0);
      if (vertsOf(merged) > 60000 || ni > 60000) {
        const fit = fitParts(merged, 1, 60000, 60000);
        if (fit.verts > 64000 || fit.indices > 64000) { log(`${from}: ย้ายไป ${to} ไม่ได้ (เกินที่ไฟล์ .0m เก็บได้) เกมอาจไม่ทาสีชิ้นนี้`); continue; }
        log(`${to} + ${from}: ลดเหลือ ${fit.verts.toLocaleString()} จุด ${(fit.indices / 3).toLocaleString()} สามเหลี่ยม (เพดานไฟล์ .0m)`);
        merged = fit.parts;
      }
      lod[to] = merged;
      delete lod[from];
      log(`${from} → ${to} (ไฟล์ ${from} เกมไม่ทาสี)`);
    }
  }
  // paintAll: everything but glass / lamps / cabin samples the paint column. In game the colour follows
  // the UV column (a car with the whole mask red still showed its trim black and the hood brown).
  const atlas = layout === 'charts' ? chartsLayout(lod, { slots, size: pngSize(tpl.get(`${tplName}_base.png`), [1024, 1024])[0], ...(() => { const [cw, ch] = pngSize(tpl.get(`${tplName}_color.png`), [128, 64]); return { cw, ch }; })() }) : layout === 'atlas' ? atlasLayout(lod, { slots, paintAll, ...(() => { const [cw, ch] = pngSize(tpl.get(`${tplName}_color.png`), [128, 64]); return { cw, ch }; })() }) : null;
  for (const [slot, parts] of Object.entries(lod)) {
    for (const p of parts) {
      if (asTemplate || atlas || !ZONES.includes(p.name)) continue;
      // slots: each material on its own column (colour 1 / 2 / 3 by the mask; the hood's paint was
      // named Hood_Paint where the template's hood is).
      const mat = slots ? p.name : paintAll && !NOT_PAINT.has(p.name) ? 'Body_Color' : p.name;
      p.uvs = zoneUVs(mat, p.positions, p.normals);
    }
  }
  const out = new Map();
  const readTpl = (rel) => { const b = tpl.get(rel); return b ? parseOM(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) : null; };
  const tplLod = (dir, mesh, l) => {
    const pre = dir ? `${dir}/` : '';
    return readTpl(`${pre}${mesh}_${l}.0m`) || readTpl(`${pre}default_${l}.0m`)
      || readTpl([...tpl.keys()].find((r) => r.startsWith(pre) && !r.slice(pre.length).includes('/') && r.endsWith(`_${l}.0m`)));
  };
  const writeLods = (dir, mesh, tplMesh, parts) => {
    // Last guard for the file's limits (65,535 points / 65,535 indices) after the UV cuts added points
    // and triangles; room left for the template's stand-in pieces.
    const ni = parts.reduce((t, q) => t + q.indices.length, 0);
    if (vertsOf(parts) > 62000 || ni > 62000) {
      const fit = fitParts(parts, 1, 62000, 62000);
      log(`${dir || 'body'}: ${vertsOf(parts).toLocaleString()} จุด ${(ni / 3).toLocaleString()} สามเหลี่ยม → ${fit.verts.toLocaleString()} จุด ${(fit.indices / 3).toLocaleString()} สามเหลี่ยม (เพดานไฟล์ .0m)`);
      parts = fit.parts;
    }
    for (let l = 0; l < 3; l++) {
      const t = tplLod(dir, tplMesh, l);
      out.set(`${dir ? `${dir}/` : ''}${mesh}_${l}.0m`, writeOM(t, matchTemplateSubmeshes(t, parts)));
    }
  };
  log('เขียนไฟล์ตามแม่แบบ…');
  await tick();
  // One merged piece per kind the template file has (paint, glass, lamps); other kinds join the paint.
  const byKind = (parts, t) => {
    const kinds = new Set(t.submeshes.filter((x) => !(x.flags[1] || x.flags[2])).map((x) => x.flags[0]));
    const groups = new Map();
    for (const p of parts) { const k = kinds.has(p.kind || 0) ? (p.kind || 0) : 0; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
    return [...groups].map(([k, list]) => ({ ...merge(list), kind: k }));
  };
  writeLods('', 'body', 'body', lod.body ? byKind(lod.body, tplLod('', 'body', 2)) : []);
  const dirs = [...new Set([...tpl.keys()].filter((r) => r.includes('/')).map((r) => r.split('/')[0]))].filter((d) => !/^(dooropen|icon)$/i.test(d)).sort();
  for (const dir of dirs) {
    const listText = decodeSpec(tpl.get(`${dir}/list.xml`) || new Uint8Array());
    const variants = [...listText.matchAll(/<part\b[^>]*name='([^']*)'[^>]*mesh='([^']*)'[^>]*tex='([^']*)'/g)].map((x) => ({ name: x[1], mesh: x[2], tex: x[3] }));
    // Tail lamps as game cars build them (polestar1): the lamp shape once as the housing (kind 0) and
    // the same shape again as the brake / tail light (kind 3) and the indicator (kind 4) pieces,
    // which the game lights.
    if (asTemplate && dir === 'rearlight' && lod[dir]?.some((p) => p.kind === 3 || p.kind === 4)) {
      const lamps = lod[dir].filter((p) => p.kind === 3 || p.kind === 4);
      const rest = lod[dir].filter((p) => !(p.kind === 3 || p.kind === 4));
      const shape = merge(lamps);
      lod[dir] = [...rest, { ...shape, kind: 0 }, { ...shape, kind: 3 }, { ...shape, kind: 4 }];
    }
    const ours = lod[dir] ? byKind(lod[dir], tplLod(dir, tpl.has(`${dir}/default_2.0m`) ? 'default' : (variants[0]?.mesh || 'default'), 2)) : null;
    const tplHas = (mesh) => tpl.has(`${dir}/${mesh}_0.0m`);
    if (ours) {
      writeLods(dir, 'default', tplHas('default') ? 'default' : (variants[0]?.mesh || 'default'), ours);
      // Tuning-set variants (rbrc_001...: the template's extra shop parts) are this car's default as is.
      for (const v of variants) if (v.mesh !== 'default' && tplHas(v.mesh)) for (let l = 0; l < 3; l++) out.set(`${dir}/${v.mesh}_${l}.0m`, out.get(`${dir}/default_${l}.0m`));
    } else {
      for (const v of variants) if (tplHas(v.mesh)) writeLods(dir, v.mesh, v.mesh, []);
    }
    out.set(`${dir}/list.xml`, encodeSpec(listText.split(tplName).join(name)));
    // Transparent detail textures for every texture the list names or the template ships.
    // (One size per folder, the template's biggest texture there, like the builds that work in game.)
    const tplPngs = [...tpl.keys()].filter((r) => r.startsWith(`${dir}/`) && !r.slice(dir.length + 1).includes('/') && r.endsWith('.png'));
    // Only the textures the template really has: a list.xml texture missing on purpose (gtv98's hood,
    // roof, spoiler) makes the game paint that part like the body; a transparent stand-in there came
    // out brown / black in game.
    // In game a part texture is drawn as the part's own colour (pack 38: red texture → red trunk) and a
    // part with no texture takes the body's paint (pack 39: whole rear repaintable). So by default the
    // parts get no textures at all; `partTextures` keeps the template's.
    // A folder with no geometry of ours (only the template's stand-in boxes) keeps the template's
    // textures, so the file set is the template's wherever nothing of this car is drawn.
    if (asTemplate && (partTextures || !ours)) {
      for (const r of tplPngs) {
        out.set(r.split(tplName).join(name), tpl.get(r));
        const d = r.replace(/\.png$/, '_s.dds');
        if (tpl.has(d)) out.set(d.split(tplName).join(name), tpl.get(d));
      }
      continue;
    }
    const texNames = new Set(partTextures && !asTemplate ? tplPngs.map((r) => r.slice(dir.length + 1, -4)) : []);
    const [w, h] = tplPngs.map((r) => pngSize(tpl.get(r), [128, 128])).sort((a, b) => b[0] * b[1] - a[0] * a[1])[0] || [128, 128];
    for (const t of texNames) {
      const px = new Uint8ClampedArray(w * h * 4);
      const nm = t.split(tplName).join(name);
      out.set(`${dir}/${nm}.png`, await png(px, w, h));
      out.set(`${dir}/${nm}_s.dds`, dds(px, w, h, 'full'));
    }
  }
  // Paint mask (zone columns) and the transparent body detail layer — or the template's own.
  if (asTemplate) {
    // The template's own mask and colour layer as they are (pack 45 with a transparent colour layer
    // was as black as 44: the layer was not the cause).
    for (const suffix of ['_base.png', '_base_s.dds', '_color.png', '_color_s.dds']) if (tpl.has(`${tplName}${suffix}`)) out.set(`${name}${suffix}`, tpl.get(`${tplName}${suffix}`));
    if (paintAll) {
      // The whole car on colour slot 1 (red): the template's own slot 2 / 3 areas (gtv98: green trim,
      // blue hood) land as patches on another car's shape.
      const [w, h] = pngSize(tpl.get(`${tplName}_base.png`), [1024, 1024]);
      const px = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < px.length; i += 4) { px[i] = 255; px[i + 3] = 255; }
      out.set(`${name}_base.png`, await png(px, w, h));
      out.set(`${name}_base_s.dds`, dds(px, w, h, 'full'));
    }
    if (layout === 'islands') {
      // The template's mask with one black spot (on empty texture) for trim, grilles, lamps.
      const img = await decodePNG(out.get(`${name}_base.png`));
      const px = new Uint8ClampedArray(img.data);
      const cx = Math.round(ISLAND_BLACK[0] * img.w); const cy = Math.round(ISLAND_BLACK[1] * img.h);
      if (slots && !paintAll) islandMask(lod, px, img.w, img.h);
      for (let y = cy - 8; y <= cy + 8; y++) for (let x = cx - 8; x <= cx + 8; x++) px.set([0, 0, 0, 255], (y * img.w + x) * 4);
      out.set(`${name}_base.png`, await png(px, img.w, img.h));
      out.set(`${name}_base_s.dds`, dds(px, img.w, img.h, 'full'));
    }
  } else if (atlas) {
    out.set(`${name}_base.png`, await png(atlas.mask, atlas.size, atlas.size));
    // the template's _s copy: same size (gtv98) or half with mip levels (Escarabajo)
    const tdds = tpl.get(`${tplName}_base_s.dds`);
    const bmode = tdds && tdds.length >= 128 && new DataView(tdds.buffer, tdds.byteOffset, 128).getUint32(16, true) !== atlas.size ? 'half' : 'full';
    out.set(`${name}_base_s.dds`, dds(atlas.mask, atlas.size, atlas.size, bmode));
    const [cw2, ch2] = pngSize(tpl.get(`${tplName}_color.png`), [128, 64]);
    out.set(`${name}_color.png`, await png(atlas.colour, cw2, ch2));
    out.set(`${name}_color_s.dds`, dds(atlas.colour, cw2, ch2, 'half'));
  } else {
    const [w, h] = pngSize(tpl.get(`${tplName}_base.png`), [512, 512]);
    const px = maskPixels(w, h, paintAll, slots);
    out.set(`${name}_base.png`, await png(px, w, h));
    out.set(`${name}_base_s.dds`, dds(px, w, h, 'full'));
    const [cw2, ch2] = pngSize(tpl.get(`${tplName}_color.png`), [128, 64]);
    const clear = new Uint8ClampedArray(cw2 * ch2 * 4);
    // Under the glass column the colour gtv98 has under its windows (56,59,59, alpha 0): on rgb 0 the
    // glass came out milky white in game (pack 49), on gtv98's value dark and clear (packs 43-47).
    const gz = ZONES.indexOf('Glass_Gray');
    for (let y = 0; y < ch2; y++) for (let x = Math.floor((gz / 16) * cw2); x < Math.ceil(((gz + 1) / 16) * cw2); x++) clear.set([56, 59, 59, 0], (y * cw2 + x) * 4);
    out.set(`${name}_color.png`, await png(clear, cw2, ch2));
    out.set(`${name}_color_s.dds`, dds(clear, cw2, ch2, 'half'));
  }
  if (asTemplate && layout !== 'template') await clearColourArt(out, name);
  await glassLikeEscarabajo(out, name);
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
    if (meshFile) {
      try { out.set(`icon/${name}_${key}.png`, await renderIcon(meshFile)); } catch { out.set(`icon/${name}_${key}.png`, tpl.get(rel)); } // no WebGL: the template's icon
    }
  }
  await defaultPartsLikeEscarabajo(out, name, { log });
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
export async function bendTemplate(model, { name, template, categories = new Map(), rounds = 3, outside: given = null, geometryOnly = false, log = () => {} }) {
  await MeshoptSimplifier.ready;
  const tpl = template.files;
  const tplName = template.name;
  const outside = given || await removeHidden(collect(model, categories).tris, log);
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
  const bent = new Map(); // rel → the template file's pieces, bent (geometryOnly)
  const rename = (rel) => rel.split(tplName).join(name);
  for (const [rel, om] of oms) {
    const parts = omParts(om);
    bent.set(rel, { om, parts });
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
  if (geometryOnly) return { bent, stretch };
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
  await glassLikeEscarabajo(out, name);
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
  await defaultPartsLikeEscarabajo(out, name, { log });
  log(`เสร็จ: ${out.size} ไฟล์ · ไฟล์ default ครบแบบ Escarabajo · กระจกแบบ Escarabajo`);
  return out;
}

export { omParts, creaseNormals, smoothNormals, cellUV, CELLS, ZONES, merge, dds, png };

// ---------------------------------------------------------------------------------------------
// The template's UV layout on our pieces: every point takes the UV of the closest point on the bent
// template — same file and same kind (glass from the template's glass, lamps from its lamps, the rest
// from its paint pieces), else anywhere on the car. With it the template's own textures, decals and
// see-through glass work like on the template.
const KIND_OF = { Glass_Gray: 1, Taillight_Glass: 3, Turn_Signal_LED: 4 };

// Labels per triangle ({a, b, c} corners) smoothed by the neighbours' vote (shared corners), three rounds:
// clean borders between colour slots instead of a saw-tooth of single triangles.
export function smoothLabels(tris, labels) {
  const key = (p) => `${Math.round(p[0] * 1e3)},${Math.round(p[1] * 1e3)},${Math.round(p[2] * 1e3)}`;
  const at = new Map();
  tris.forEach((t, i) => { for (const p of [t.a, t.b, t.c]) { const k = key(p); const l = at.get(k); if (l) l.push(i); else at.set(k, [i]); } });
  let cur = Int8Array.from(labels);
  for (let round = 0; round < 3; round++) {
    const next = cur.slice();
    tris.forEach((t, i) => {
      const votes = [0, 0, 0, 0];
      for (const p of [t.a, t.b, t.c]) for (const j of at.get(key(p))) votes[cur[j]]++;
      let best = cur[i];
      for (let k = 0; k < 4; k++) if (votes[k] > votes[best]) best = k;
      next[i] = best;
    });
    cur = next;
  }
  return cur;
}

// .png (8-bit RGB / RGBA, not interlaced) → { w, h, data: RGBA }, with DecompressionStream: page and node.
export async function decodePNG(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const w = dv.getUint32(16); const h = dv.getUint32(20); const type = bytes[25];
  const ch = type === 6 ? 4 : type === 2 ? 3 : 0;
  if (!ch || bytes[24] !== 8 || bytes[28] !== 0) throw new Error('png ชนิดนี้ยังอ่านไม่ได้');
  const idat = [];
  for (let p = 8; p < bytes.length;) {
    const len = dv.getUint32(p); const t = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
    if (t === 'IDAT') idat.push(bytes.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const raw = new Uint8Array(await new Response(new Blob(idat).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
  const stride = w * ch; const out = new Uint8Array(w * h * 4); const prev = new Uint8Array(stride); const cur = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]; const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0; const b = prev[i]; const c = i >= ch ? prev[i - ch] : 0;
      let v = row[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c; const pa = Math.abs(pp - a); const pb = Math.abs(pp - b); const pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) { out[(y * w + x) * 4] = cur[x * ch]; out[(y * w + x) * 4 + 1] = cur[x * ch + 1]; out[(y * w + x) * 4 + 2] = cur[x * ch + 2]; out[(y * w + x) * 4 + 3] = ch === 4 ? cur[x * ch + 3] : 255; }
    prev.set(cur);
  }
  return { w, h, data: out };
}

// point → the template's colour slot there (1 red, 2 green, 3 blue, 0 none): its mask under the UV of the
// closest point of the bent template's stock paint pieces.
export async function templateMaskSlots(bent, template) {
  const img = await decodePNG(template.files.get(`${template.name}_base.png`));
  const P = []; const UV = [];
  for (const [rel, { om, parts }] of bent) {
    if (!/^body_2\.0m$|\/default_2\.0m$/.test(rel)) continue;
    parts.forEach((p, k) => {
      const f = om.submeshes[k].flags;
      if (f[0] !== 0 || f[1] || f[2] || p.positions.length / 3 <= 8) return;
      for (let t = 0; t < p.indices.length; t += 3) for (let j = 0; j < 3; j++) { const i = p.indices[t + j]; P.push(p.positions[i * 3], p.positions[i * 3 + 1], p.positions[i * 3 + 2]); UV.push(p.uvs[i * 2], p.uvs[i * 2 + 1]); }
    });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  const bvh = new MeshBVH(g, { indirect: true });
  const tri = new THREE.Triangle(); const A = new THREE.Vector3(); const B = new THREE.Vector3(); const C = new THREE.Vector3(); const bary = new THREE.Vector3(); const q = new THREE.Vector3();
  return (c) => {
    const hit = bvh.closestPointToPoint(q.set(c[0], c[1], c[2]), {});
    if (!hit) return 1;
    const f = hit.faceIndex;
    A.set(P[f * 9], P[f * 9 + 1], P[f * 9 + 2]); B.set(P[f * 9 + 3], P[f * 9 + 4], P[f * 9 + 5]); C.set(P[f * 9 + 6], P[f * 9 + 7], P[f * 9 + 8]);
    tri.set(A, B, C).getBarycoord(hit.point, bary);
    const u = UV[f * 6] * bary.x + UV[f * 6 + 2] * bary.y + UV[f * 6 + 4] * bary.z;
    const v = UV[f * 6 + 1] * bary.x + UV[f * 6 + 3] * bary.y + UV[f * 6 + 5] * bary.z;
    const x = Math.min(img.w - 1, Math.max(0, Math.floor(u * img.w))); const y = Math.min(img.h - 1, Math.max(0, Math.floor(v * img.h)));
    const o = (y * img.w + x) * 4;
    return img.data[o] > 128 ? 1 : img.data[o + 1] > 128 ? 2 : img.data[o + 2] > 128 ? 3 : 0;
  };
}

// "Islands" layout: the template's own UV sheet, cut like it. Every island of the template (pieces joined
// by shared points: a side panel, the hood, the roof...) gets a best-fit map from 3D to its UVs over the
// bent template; each triangle of the car takes the island of the closest template triangle (same file
// first) and all three corners go through that island's map — corners split where islands meet, so no
// triangle stretches across the texture (black / other pictures in game, packs 44-53) and shop decals,
// films and the mask land where they land on the template. Trim, grilles and lamps sit on one black spot.
const ISLAND_BLACK = [0.336, 0.383]; // empty in gtv98's sheet
// Faces that belong black (no garage colour) like game cars: the floor and every face looking down, and the
// wheel wells — low faces set back from the car's side (more than 12 cm inside the widest outward face of
// their 10 cm slice along the car), not looking up. tris: [{ c: centre, n: outward normal }] → [bool].
export function underTris(tris) {
  let z0 = Infinity; let z1 = -Infinity; let y0 = Infinity;
  for (const t of tris) { z0 = Math.min(z0, t.c[2]); z1 = Math.max(z1, t.c[2]); y0 = Math.min(y0, t.c[1]); }
  const H = z1 - z0; const slice = (y) => Math.floor((y - y0) / 0.1);
  const wide = new Map();
  for (const t of tris) {
    const l = Math.hypot(t.n[0], t.n[1], t.n[2]) || 1;
    if (Math.abs(t.n[0]) / l > 0.6 && t.n[0] * Math.sign(t.c[0]) > 0) { const k = slice(t.c[1]); wide.set(k, Math.max(wide.get(k) || 0, Math.abs(t.c[0]))); }
  }
  return tris.map((t) => {
    const l = Math.hypot(t.n[0], t.n[1], t.n[2]) || 1; const nz = t.n[2] / l;
    if (nz < -0.35) return true;
    if (t.c[2] > z0 + H * 0.55 || nz > 0.5) return false;
    const k = slice(t.c[1]); const w = Math.max(wide.get(k) || 0, wide.get(k - 1) || 0, wide.get(k + 1) || 0);
    return w > 0 && Math.abs(t.c[0]) < w - 0.12;
  });
}
// The tail lid among paint triangles ({ c: centre, n: normal }, RayCity space: y back, z up): the rear
// end's back-facing panel between bumper and roof line (tailgate / back of the trunk lid), and for a
// car that isn't a pickup also the trunk's top (facing up, the last fifth of the length, above the
// waist). Pickups leave the bed rails out.
export function tailTris(tris, pickup = false) {
  let y0 = Infinity; let y1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
  for (const t of tris) { y0 = Math.min(y0, t.c[1]); y1 = Math.max(y1, t.c[1]); z0 = Math.min(z0, t.c[2]); z1 = Math.max(z1, t.c[2]); }
  const L = y1 - y0; const H = z1 - z0;
  return tris.map((t) => {
    const back = t.c[1] > y1 - Math.min(0.35, L * 0.1) && t.n[1] > 0.6 && t.c[2] > z0 + H * 0.3 && t.c[2] < z0 + H * 0.75;
    const deck = !pickup && t.c[1] > y1 - L * 0.2 && t.n[2] > 0.6 && t.c[2] > z0 + H * 0.45 && t.c[2] < z0 + H * 0.8;
    return back || deck;
  });
}
// Old body (bent template) in three colours body / hood / tail lid: the template mask's lower band
// becomes colour 1, the hood stays colour 3, and the tail lid's triangles are filled green under
// their UVs. Changes `out` in place.
export async function tailColoursOnMask(out, name, { pickup = false } = {}) {
  const img = await decodePNG(out.get(`${name}_base.png`)); const { w, h } = img; const px = new Uint8ClampedArray(img.data);
  for (let i = 0; i < px.length; i += 4) if (px[i + 1] > 128 && px[i] < 128 && px[i + 2] < 128) px.set([255, 0, 0, 255], i);
  const tris = [];
  for (const [rel, b] of out) {
    if (!(rel === 'body_2.0m' || /^[^/]+\/default_2\.0m$/.test(rel))) continue;
    const om = parseOM(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    omParts(om).forEach((p, k) => {
      const f = om.submeshes[k].flags; if (f[0] !== 0 || p.positions.length / 3 <= 8) return;
      const P = p.positions; const U = p.uvs; const I = p.indices;
      for (let t = 0; t < I.length; t += 3) {
        const [a, b2, c] = [I[t], I[t + 1], I[t + 2]];
        const e1 = [P[b2 * 3] - P[a * 3], P[b2 * 3 + 1] - P[a * 3 + 1], P[b2 * 3 + 2] - P[a * 3 + 2]]; const e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
        const n = cross(e1, e2); const l = Math.hypot(n[0], n[1], n[2]) || 1;
        tris.push({ c: [0, 1, 2].map((k2) => (P[a * 3 + k2] + P[b2 * 3 + k2] + P[c * 3 + k2]) / 3), n: [n[0] / l, n[1] / l, n[2] / l], uv: [a, b2, c].map((i) => [U[i * 2] * w, U[i * 2 + 1] * h]) });
      }
    });
  }
  const tail = tailTris(tris, pickup);
  // texels of each triangle's UV (grown a little for the tail lid; exact for the others)
  const texels = (q, grow0, fn) => {
    const area = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]);
    const x0 = Math.max(0, Math.floor(Math.min(q[0][0], q[1][0], q[2][0])) - 1); const x1 = Math.min(w - 1, Math.ceil(Math.max(q[0][0], q[1][0], q[2][0])) + 1);
    const y0 = Math.max(0, Math.floor(Math.min(q[0][1], q[1][1], q[2][1])) - 1); const y1 = Math.min(h - 1, Math.ceil(Math.max(q[0][1], q[1][1], q[2][1])) + 1);
    // thin / flat UV triangles (frames, trims): their whole box counts as used by them
    if (Math.abs(area) < Math.max(1e-6, ((x1 - x0) + (y1 - y0)) * 0.6)) { if (!grow0) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) fn(y * w + x); return false; }
    const grow = grow0 / Math.sqrt(Math.abs(area));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const cx = x + 0.5; const cy = y + 0.5;
      const s0 = ((q[1][0] - q[0][0]) * (cy - q[0][1]) - (q[1][1] - q[0][1]) * (cx - q[0][0])) / area;
      const s1 = ((q[2][0] - q[1][0]) * (cy - q[1][1]) - (q[2][1] - q[1][1]) * (cx - q[1][0])) / area;
      const s2 = ((q[0][0] - q[2][0]) * (cy - q[2][1]) - (q[0][1] - q[2][1]) * (cx - q[2][0])) / area;
      if (s0 >= -grow && s1 >= -grow && s2 >= -grow) fn(y * w + x);
    }
    return true;
  };
  // the template's sheet overlaps (gtv98: window frames over the trunk lid): texels other panels use stay
  const other = new Uint8Array(w * h);
  tris.forEach((t, i) => { if (!tail[i]) texels(t.uv, 0, (o) => { other[o] = 1; }); });
  let n = 0;
  tris.forEach((t, i) => { if (tail[i] && texels(t.uv, 1.2, (o) => { if (!other[o]) px.set([0, 255, 0, 255], o * 4); })) n++; });
  out.set(`${name}_base.png`, await png(px, w, h));
  const old = out.get(`${name}_base_s.dds`);
  const mode = old && old.length >= 128 && new DataView(old.buffer, old.byteOffset, 128).getUint32(16, true) !== w ? 'half' : 'full';
  out.set(`${name}_base_s.dds`, dds(px, w, h, mode));
  return n;
}
// The paint mask drawn from our own triangles (islands layout, three colours): every paint triangle
// fills its UV triangle with its colour slot — Hood_Paint blue (3), Lower_Paint green (2), the rest red
// (1) — so a colour border follows the car's triangle edges instead of gtv98's mask under them (whose
// band / hood edges fall across our triangles: ragged green / blue patches). Filled 2 px wider than
// the triangles (mip levels / filtering at edges); texels no triangle touches are colour 1.
function islandMask(lod, px, w, h) {
  // votes per texel and colour slot; a texel takes the slot most triangles there have. Triangles the
  // island map squashed (UV area far below the usual for their size: clamped at the island's edge)
  // don't vote — they gave the stray patches.
  const votes = new Uint16Array(w * h * 4);
  const slotOf = (p) => (p.name === 'Hood_Paint' ? 3 : p.name === 'Lower_Paint' ? 2 : 1);
  const tris = [];
  for (const parts of Object.values(lod)) for (const p of parts) {
    if ((p.kind || 0) !== 0) continue;
    const U = p.uvs; const I = p.indices; const P = p.positions; const sl = slotOf(p);
    for (let t = 0; t < I.length; t += 3) {
      const q = [0, 1, 2].map((k) => [U[I[t + k] * 2] * w, U[I[t + k] * 2 + 1] * h]);
      const area = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]);
      if (Math.abs(area) < 1e-6) continue; // flat: trim on the black spot
      const a = I[t] * 3; const b = I[t + 1] * 3; const c = I[t + 2] * 3;
      const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]]; const e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
      const a3 = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]);
      tris.push({ q, area, sl, ratio: Math.abs(area) / Math.max(1e-12, a3) });
    }
  }
  const ratios = tris.map((t) => t.ratio).sort((x, y) => x - y);
  const med = ratios[ratios.length >> 1] || 0;
  for (const { q, area, sl, ratio } of tris) {
    if (ratio < med * 0.2) continue;
    const x0 = Math.max(0, Math.floor(Math.min(q[0][0], q[1][0], q[2][0]))); const x1 = Math.min(w - 1, Math.ceil(Math.max(q[0][0], q[1][0], q[2][0])));
    const y0 = Math.max(0, Math.floor(Math.min(q[0][1], q[1][1], q[2][1]))); const y1 = Math.min(h - 1, Math.ceil(Math.max(q[0][1], q[1][1], q[2][1])));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const cx = x + 0.5; const cy = y + 0.5;
      const s0 = ((q[1][0] - q[0][0]) * (cy - q[0][1]) - (q[1][1] - q[0][1]) * (cx - q[0][0])) / area;
      const s1 = ((q[2][0] - q[1][0]) * (cy - q[1][1]) - (q[2][1] - q[1][1]) * (cx - q[1][0])) / area;
      const s2 = ((q[0][0] - q[2][0]) * (cy - q[2][1]) - (q[0][1] - q[2][1]) * (cx - q[2][0])) / area;
      if (s0 >= -0.02 && s1 >= -0.02 && s2 >= -0.02) { const o = (y * w + x) * 4 + sl; if (votes[o] < 65535) votes[o]++; }
    }
  }
  const lab = new Uint8Array(w * h);
  for (let i = 0; i < lab.length; i++) { let best = 0; let bv = 0; for (let k = 1; k <= 3; k++) if (votes[i * 4 + k] > bv) { bv = votes[i * 4 + k]; best = k; } lab[i] = best; }
  // a 3×3 majority pass (single stray texels), then 2 px wider (mip levels / filtering at edges)
  {
    const next = lab.slice();
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const c = [0, 0, 0, 0];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) c[lab[(y + dy) * w + x + dx]]++;
      const cur = lab[y * w + x]; if (!cur) continue;
      let best = cur; for (let k = 1; k <= 3; k++) if (c[k] > c[best]) best = k;
      if (c[cur] <= 2) next[y * w + x] = best;
    }
    lab.set(next);
  }
  for (let it = 0; it < 2; it++) {
    const next = lab.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (lab[y * w + x]) continue;
      const n = (x > 0 && lab[y * w + x - 1]) || (x < w - 1 && lab[y * w + x + 1]) || (y > 0 && lab[(y - 1) * w + x]) || (y < h - 1 && lab[(y + 1) * w + x]);
      if (n) next[y * w + x] = n;
    }
    lab.set(next);
  }
  const RGB = [null, [255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]];
  // texels no triangle votes for: colour 1 (not the template's band / hood showing through)
  for (let i = 0; i < lab.length; i++) px.set(RGB[lab[i] || 1], i * 4);
}
export function islandUVs(lod, bent, { slots = true, clamp = true } = {}) {
  const sets = new Map(); // key → { P: [], isl: [] (island per triangle) }
  const islands = [];
  const add = (key, tri, id) => { const e = sets.get(key) || { P: [], isl: [] }; e.P.push(...tri); e.isl.push(id); sets.set(key, e); };
  for (const [rel, { om, parts }] of bent) {
    if (!/^body_2\.0m$|\/default_2\.0m$/.test(rel)) continue;
    parts.forEach((p, k) => {
      const f = om.submeshes[k].flags;
      if (f[1] || f[2] || p.positions.length / 3 <= 8) return;
      const kind = f[0] === 1 ? 1 : 0;
      const n = p.positions.length / 3;
      const par = new Int32Array(n).map((_, i) => i);
      const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
      for (let t = 0; t < p.indices.length; t += 3) { const a = find(p.indices[t]); const b = find(p.indices[t + 1]); const c = find(p.indices[t + 2]); par[a] = b; par[find(c)] = b; }
      const ids = new Map();
      for (let i = 0; i < n; i++) { const r = find(i); if (!ids.has(r)) { ids.set(r, islands.length); islands.push({ pts: [] }); } islands[ids.get(r)].pts.push(i); }
      for (const [r, id] of ids) {
        // least squares u, v = a·x + b·y + c·z + d over the island's points (a little ridge for flat ones)
        const isl = islands[id]; const M = Array.from({ length: 4 }, () => new Float64Array(4)); const bu = new Float64Array(4); const bv = new Float64Array(4);
        let u0 = 0; let v0 = 0;
        for (const i of isl.pts) {
          const x = [p.positions[i * 3], p.positions[i * 3 + 1], p.positions[i * 3 + 2], 1];
          for (let a = 0; a < 4; a++) { for (let b = 0; b < 4; b++) M[a][b] += x[a] * x[b]; bu[a] += x[a] * p.uvs[i * 2]; bv[a] += x[a] * p.uvs[i * 2 + 1]; }
          u0 += p.uvs[i * 2]; v0 += p.uvs[i * 2 + 1];
        }
        for (let a = 0; a < 3; a++) M[a][a] += 1e-4;
        const solve = (A, bb) => { const m = A.map((row, i) => [...row, bb[i]]); for (let c = 0; c < 4; c++) { let piv = c; for (let r2 = c + 1; r2 < 4; r2++) if (Math.abs(m[r2][c]) > Math.abs(m[piv][c])) piv = r2; [m[c], m[piv]] = [m[piv], m[c]]; if (Math.abs(m[c][c]) < 1e-12) return null; for (let r2 = 0; r2 < 4; r2++) if (r2 !== c) { const fct = m[r2][c] / m[c][c]; for (let k2 = c; k2 < 5; k2++) m[r2][k2] -= fct * m[c][k2]; } } return m.map((row, i) => row[4] / row[i]); };
        isl.cu = solve(M, bu) || [0, 0, 0, u0 / isl.pts.length]; isl.cv = solve(M, bv) || [0, 0, 0, v0 / isl.pts.length];
        // its own UV box, the map's output is kept inside it
        let uMin = 1; let uMax = 0; let vMin = 1; let vMax = 0;
        for (const i of isl.pts) { uMin = Math.min(uMin, p.uvs[i * 2]); uMax = Math.max(uMax, p.uvs[i * 2]); vMin = Math.min(vMin, p.uvs[i * 2 + 1]); vMax = Math.max(vMax, p.uvs[i * 2 + 1]); }
        isl.box = [uMin, uMax, vMin, vMax];
      }
      for (let t = 0; t < p.indices.length; t += 3) {
        const tri = []; for (let j = 0; j < 3; j++) { const i = p.indices[t + j]; tri.push(p.positions[i * 3], p.positions[i * 3 + 1], p.positions[i * 3 + 2]); }
        const id = ids.get(find(p.indices[t]));
        add(`${rel}|${kind}`, tri, id); add(`*|${kind}`, tri, id);
      }
    });
  }
  const trees = new Map();
  for (const [key, e] of sets) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(e.P), 3)); trees.set(key, { bvh: new MeshBVH(g, { indirect: true }), isl: e.isl }); }
  const q = new THREE.Vector3();
  const islandAt = (rel, kind, c) => {
    const local = trees.get(`${rel}|${kind}`); const global = trees.get(`*|${kind}`) || trees.get('*|0');
    let hit = local ? local.bvh.closestPointToPoint(q.set(...c), {}, 0, 0.15) : null; let set = local;
    if (!hit) { set = global; hit = global.bvh.closestPointToPoint(q.set(...c), {}); }
    return set.isl[hit.faceIndex];
  };
  const mapUV = (isl, x) => {
    const u = isl.cu[0] * x[0] + isl.cu[1] * x[1] + isl.cu[2] * x[2] + isl.cu[3];
    const v = isl.cv[0] * x[0] + isl.cv[1] * x[1] + isl.cv[2] * x[2] + isl.cv[3];
    if (!clamp) return [Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v))];
    const [a, b, c2, d] = isl.box;
    return [Math.min(b, Math.max(a, u)), Math.min(d, Math.max(c2, v))];
  };
  for (const [slot, parts] of Object.entries(lod)) {
    const rel = slot === 'body' ? 'body_2.0m' : `${slot}/default_2.0m`;
    for (const p of parts) {
      const kind = KIND_OF[p.name] || 0;
      p.kind = kind;
      const black = kind === 3 || kind === 4 || p.name === 'Interior_dark' || p.name === 'Projector_Glass' || (slots && !isPaint(p.name) && kind === 0 && !['Lower_Paint', 'Hood_Paint'].includes(p.name));
      const P = p.positions; const I = p.indices;
      const nP = []; const nN = []; const nUV = []; const nI = []; const keyOf = new Map();
      for (let t = 0; t < I.length; t += 3) {
        const v = [I[t], I[t + 1], I[t + 2]];
        const x = v.map((i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
        const c = [0, 1, 2].map((k2) => (x[0][k2] + x[1][k2] + x[2][k2]) / 3);
        const id = black ? -1 : islandAt(rel, kind === 1 ? 1 : 0, c);
        for (let j = 0; j < 3; j++) {
          const key = `${v[j]}|${id}`;
          let n = keyOf.get(key);
          if (n === undefined) {
            n = nP.length / 3; keyOf.set(key, n);
            nP.push(...x[j]); nN.push(p.normals[v[j] * 3], p.normals[v[j] * 3 + 1], p.normals[v[j] * 3 + 2]);
            const uv = id < 0 ? ISLAND_BLACK : mapUV(islands[id], x[j]);
            nUV.push(uv[0], uv[1]);
          }
          nI.push(n);
        }
      }
      p.positions = new Float32Array(nP); p.normals = new Float32Array(nN); p.uvs = new Float32Array(nUV); p.indices = Uint32Array.from(nI);
    }
  }
}

// (point, kind) → the slot whose template file has the closest surface there (stock files: body and
// the parts' default meshes; moving pieces left out), or null.
export function nearestTemplateFile(bent) {
  const sets = new Map();
  for (const [rel, { om, parts }] of bent) {
    if (!/^body_2\.0m$|\/default_2\.0m$/.test(rel)) continue;
    const slot = rel === 'body_2.0m' ? 'body' : rel.split('/')[0];
    parts.forEach((p, k) => {
      const f = om.submeshes[k].flags;
      if (f[1] || f[2] || p.positions.length / 3 <= 8) return;
      const kind = f[0] === 1 ? 1 : 0;
      const e = sets.get(kind) || { P: [], slots: [] };
      for (let t = 0; t < p.indices.length; t += 3) {
        for (let j = 0; j < 3; j++) { const i = p.indices[t + j]; e.P.push(p.positions[i * 3], p.positions[i * 3 + 1], p.positions[i * 3 + 2]); }
        e.slots.push(slot);
      }
      sets.set(kind, e);
    });
  }
  const trees = new Map();
  for (const [kind, e] of sets) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(e.P), 3));
    trees.set(kind, { bvh: new MeshBVH(g, { indirect: true }), slots: e.slots });
  }
  const q = new THREE.Vector3();
  return (c, kind = 0) => {
    const t = trees.get(kind) || trees.get(0);
    if (!t) return null;
    const hit = t.bvh.closestPointToPoint(q.set(c[0], c[1], c[2]), {});
    return hit ? t.slots[hit.faceIndex] : null;
  };
}
export function uvsFromTemplate(lod, bent) {
  const sets = new Map();
  const add = (key, P, UV) => { const e = sets.get(key) || { P: [], UV: [] }; for (const x of P) e.P.push(x); for (const x of UV) e.UV.push(x); sets.set(key, e); };
  for (const [rel, { om, parts }] of bent) {
    if (!/_2\.0m$/.test(rel)) continue;
    const stock = /^body_2|\/default_2/.test(rel);
    parts.forEach((p, k) => {
      const f = om.submeshes[k].flags;
      if (f[1] || f[2] || p.positions.length / 3 <= 8) return;
      for (let t = 0; t < p.indices.length; t += 3) {
        const v = [p.indices[t], p.indices[t + 1], p.indices[t + 2]];
        const P = v.flatMap((i) => [p.positions[i * 3], p.positions[i * 3 + 1], p.positions[i * 3 + 2]]);
        const UV = v.flatMap((i) => [p.uvs[i * 2], p.uvs[i * 2 + 1]]);
        add(`${rel}|${f[0]}`, P, UV);
        if (stock) add(`*|${f[0]}`, P, UV);
      }
    });
  }
  const trees = new Map();
  // Where the template's own triangles cover its texture (512² grid per set): a UV outside every
  // island came out black in game (packs 44-46).
  const GRID = 512;
  const coverOf = (UV) => {
    const m = new Uint8Array(GRID * GRID);
    for (let f = 0; f < UV.length / 6; f++) {
      const xs = [UV[f * 6], UV[f * 6 + 2], UV[f * 6 + 4]].map((u) => u * GRID); const ys = [UV[f * 6 + 1], UV[f * 6 + 3], UV[f * 6 + 5]].map((v) => v * GRID);
      const x0 = Math.max(0, Math.floor(Math.min(...xs)) - 1); const x1 = Math.min(GRID - 1, Math.ceil(Math.max(...xs)) + 1);
      const y0 = Math.max(0, Math.floor(Math.min(...ys)) - 1); const y1 = Math.min(GRID - 1, Math.ceil(Math.max(...ys)) + 1);
      const d = (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0]);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        // pixel touched by the triangle (1-pixel margin)
        let inside = Math.abs(d) < 1e-9;
        if (!inside) {
          const px = x + 0.5; const py = y + 0.5;
          const a = ((xs[1] - px) * (ys[2] - py) - (xs[2] - px) * (ys[1] - py)) / d;
          const b = ((xs[2] - px) * (ys[0] - py) - (xs[0] - px) * (ys[2] - py)) / d;
          const tol = 1.5 / Math.max(1, Math.sqrt(Math.abs(d)));
          inside = a > -tol && b > -tol && 1 - a - b > -tol;
        }
        if (inside) m[y * GRID + x] = 1;
      }
    }
    return m;
  };
  for (const [key, e] of sets) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(e.P), 3));
    trees.set(key, { bvh: new MeshBVH(g, { indirect: true }), P: e.P, UV: e.UV, cover: coverOf(e.UV) });
  }
  const covered = (set, u, v) => set.cover[Math.min(GRID - 1, Math.max(0, Math.floor(v * GRID))) * GRID + Math.min(GRID - 1, Math.max(0, Math.floor(u * GRID)))];
  const tri = new THREE.Triangle(); const A = new THREE.Vector3(); const B = new THREE.Vector3(); const C = new THREE.Vector3();
  const bary = new THREE.Vector3(); const q = new THREE.Vector3();
  for (const [slot, parts] of Object.entries(lod)) {
    const rel = slot === 'body' ? 'body_2.0m' : [...bent.keys()].find((r) => r === `${slot}/default_2.0m`) || [...bent.keys()].find((r) => r.startsWith(`${slot}/`) && r.endsWith('_2.0m'));
    for (const p of parts) {
      const kind = KIND_OF[p.name] || 0;
      p.kind = kind;
      const local = trees.get(`${rel}|${kind}`);
      const global = trees.get(`*|${kind}`) || trees.get('*|0');
      const uvs = new Float32Array((p.positions.length / 3) * 2);
      for (let i = 0; i < p.positions.length / 3; i++) {
        q.set(p.positions[i * 3], p.positions[i * 3 + 1], p.positions[i * 3 + 2]);
        let set = local; let hit = local ? local.bvh.closestPointToPoint(q, {}, 0, 0.12) : null;
        if (!hit) { set = global; hit = global.bvh.closestPointToPoint(q, {}); }
        const f = hit.faceIndex; const Pp = set.P; const U = set.UV;
        A.set(Pp[f * 9], Pp[f * 9 + 1], Pp[f * 9 + 2]); B.set(Pp[f * 9 + 3], Pp[f * 9 + 4], Pp[f * 9 + 5]); C.set(Pp[f * 9 + 6], Pp[f * 9 + 7], Pp[f * 9 + 8]);
        tri.set(A, B, C).getBarycoord(hit.point, bary);
        uvs[i * 2] = U[f * 6] * bary.x + U[f * 6 + 2] * bary.y + U[f * 6 + 4] * bary.z;
        uvs[i * 2 + 1] = U[f * 6 + 1] * bary.x + U[f * 6 + 3] * bary.y + U[f * 6 + 5] * bary.z;
      }
      // Where the template's own UVs collapse to a line or a point (its trim strips, small islands),
      // a 1–2 texel nudge per point keeps every paint triangle's UV area above zero (flat UVs came out
      // black / see-through in game). Glass stays as the template has it.
      if (kind === 0) {
        for (let i = 0; i < uvs.length / 2; i++) {
          const h = (a) => { const x = Math.sin(a) * 43758.5453; return x - Math.floor(x) - 0.5; };
          const X = p.positions[i * 3]; const Y = p.positions[i * 3 + 1]; const Z = p.positions[i * 3 + 2];
          uvs[i * 2] = Math.min(1, Math.max(0, uvs[i * 2] + 0.003 * h(X * 12.9898 + Y * 78.233 + Z * 37.719)));
          uvs[i * 2 + 1] = Math.min(1, Math.max(0, uvs[i * 2 + 1] + 0.003 * h(X * 93.989 + Y * 67.345 + Z * 24.123)));
        }
      }
      p.uvs = uvs;
      // A triangle whose corners took UVs from different template islands would stretch over the whole
      // texture (black / random patches in game): it gets its own corners, all mapped through the one
      // template triangle under its middle.
      const P = p.positions; const I = Uint32Array.from(p.indices); p.indices = I;
      const addP = []; const addN = []; const addUV = [];
      let nv = P.length / 3;
      const lens = (a, b) => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
      const uvl = (a, b) => Math.hypot(uvs[a * 2] - uvs[b * 2], uvs[a * 2 + 1] - uvs[b * 2 + 1]);
      for (let t = 0; t < I.length; t += 3) {
        const v = [I[t], I[t + 1], I[t + 2]];
        const span = Math.max(uvl(v[0], v[1]), uvl(v[1], v[2]), uvl(v[0], v[2]));
        const size = Math.max(lens(v[0], v[1]), lens(v[1], v[2]), lens(v[0], v[2]));
        // Its middle and edge middles in UV must lie on the template's islands too.
        const at = (wa, wb, wc) => [uvs[v[0] * 2] * wa + uvs[v[1] * 2] * wb + uvs[v[2] * 2] * wc, uvs[v[0] * 2 + 1] * wa + uvs[v[1] * 2 + 1] * wb + uvs[v[2] * 2 + 1] * wc];
        const home = local || global;
        const offIsland = [[1 / 3, 1 / 3, 1 / 3], [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5]].some(([a, b, c]) => { const [u, w] = at(a, b, c); return !covered(home, u, w) && !covered(global, u, w); });
        if (!offIsland && !(span > 0.04 && span > size * 0.35)) continue;
        q.set(0, 0, 0);
        for (const i of v) q.add(A.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]));
        q.divideScalar(3);
        let set = local; let hit = local ? local.bvh.closestPointToPoint(q, {}, 0, 0.12) : null;
        if (!hit) { set = global; hit = global.bvh.closestPointToPoint(q, {}); }
        const f = hit.faceIndex; const Pp = set.P; const U = set.UV;
        A.set(Pp[f * 9], Pp[f * 9 + 1], Pp[f * 9 + 2]); B.set(Pp[f * 9 + 3], Pp[f * 9 + 4], Pp[f * 9 + 5]); C.set(Pp[f * 9 + 6], Pp[f * 9 + 7], Pp[f * 9 + 8]);
        tri.set(A, B, C);
        const pl = new THREE.Plane(); tri.getPlane(pl);
        v.forEach((i, j) => {
          const c = new THREE.Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
          pl.projectPoint(c, c);
          tri.getBarycoord(c, bary);
          // inside the template triangle (its island), not extrapolated past it
          bary.set(Math.max(0, bary.x), Math.max(0, bary.y), Math.max(0, bary.z));
          bary.divideScalar(bary.x + bary.y + bary.z || 1);
          const u = U[f * 6] * bary.x + U[f * 6 + 2] * bary.y + U[f * 6 + 4] * bary.z;
          const w = U[f * 6 + 1] * bary.x + U[f * 6 + 3] * bary.y + U[f * 6 + 5] * bary.z;
          addP.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); addN.push(p.normals[i * 3], p.normals[i * 3 + 1], p.normals[i * 3 + 2]);
          addUV.push(Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, w)));
          I[t + j] = nv + j;
        });
        nv += 3;
      }
      if (addP.length) {
        const cat = (a, b) => { const o = new Float32Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };
        p.positions = cat(P, addP); p.normals = cat(p.normals, addN); p.uvs = cat(uvs, addUV);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Fitting the car to the game's wheels. The game puts its own wheels where the base car's are (the car
// the new one was registered from), so the model is scaled and moved until its wheels sit there.
// gtv98 measured from its wheel arches: axles at y −1.23 / +1.15, wheel radius 0.27 (its spec's
// MS_TractionRadius), wheels ±0.68 from the middle.
export const GAME_WHEELS = { gtv98: { front: -1.23, rear: 1.15, radius: 0.27, track: 0.68, maxWidth: 1.85 } };

// mode 'uniform': one scale for the whole car (shape kept), the axles land exactly, then the car moves
// up/down so the wheel centres match. 'stretch': length, width and height scaled separately so the
// axles, the track and the wheel size all match. Returns a short description, or null (no wheels).
export function fitToWheels(model, game, mode = 'uniform') {
  if (!model.orig) model.orig = { P: model.P.slice(), N: model.N.slice(), wheels: model.wheels.map((w) => ({ p: [...w.p], r: w.r })), pieces: model.pieces.map((p) => ({ min: [...p.min], max: [...p.max] })) };
  const o = model.orig;
  const fw = o.wheels.filter((w) => w.p[1] < 0); const rw = o.wheels.filter((w) => w.p[1] >= 0);
  if (!fw.length || !rw.length) return null;
  const avg = (list, f) => list.reduce((s, w) => s + f(w), 0) / list.length;
  const mf = avg(fw, (w) => w.p[1]); const mr = avg(rw, (w) => w.p[1]);
  const mrad = avg(o.wheels, (w) => w.r); const mtrack = avg(o.wheels, (w) => Math.abs(w.p[0]));
  const mmid = (mf + mr) / 2; const gmid = (game.front + game.rear) / 2;
  const sy = (game.rear - game.front) / (mr - mf);
  let [sx, sz, dz] = mode === 'stretch' ? [game.track / mtrack, game.radius / mrad, 0] : [sy, sy, game.radius - sy * mrad];
  // Never wider than maxWidth: the game's wheels sit only `track` from the middle, a wide body
  // swallows them (a 2.30 m car looked far too wide in game).
  let x0 = Infinity; let x1 = -Infinity;
  for (let i = 0; i < o.P.length; i += 3) { x0 = Math.min(x0, o.P[i]); x1 = Math.max(x1, o.P[i]); }
  if (game.maxWidth && (x1 - x0) * sx > game.maxWidth) sx = game.maxWidth / (x1 - x0);
  const map = (p) => [p[0] * sx, (p[1] - mmid) * sy + gmid, p[2] * sz + dz];
  for (let i = 0; i < model.P.length; i += 3) model.P.set(map([o.P[i], o.P[i + 1], o.P[i + 2]]), i);
  for (let i = 0; i < model.N.length; i += 3) {
    const n = [o.N[i] / sx, o.N[i + 1] / sy, o.N[i + 2] / sz]; const l = Math.hypot(...n) || 1;
    model.N[i] = n[0] / l; model.N[i + 1] = n[1] / l; model.N[i + 2] = n[2] / l;
  }
  model.wheels = o.wheels.map((w) => ({ p: map(w.p), r: w.r * sz }));
  model.pieces.forEach((p, k) => { const a = map(o.pieces[k].min); const b = map(o.pieces[k].max); p.min = a.map((v, j) => Math.min(v, b[j])); p.max = a.map((v, j) => Math.max(v, b[j])); });
  model.fit = { game, mode };
  model.zTop = undefined;
  const pct = (v) => `${Math.round(v * 100)}%`;
  const w = `กว้าง ${((x1 - x0) * sx).toFixed(2)} ม.`;
  return mode === 'stretch' ? `ยาว ×${pct(sy)} กว้าง ×${pct(sx)} สูง ×${pct(sz)} · ${w}` : `ย่อ/ขยายทั้งคัน ×${pct(sy)}${sx !== sy ? ` (ความกว้าง ×${pct(sx)})` : ''}${Math.abs(dz) > 0.005 ? ` · ${dz > 0 ? 'ยก' : 'ลด'}ตัวรถ ${Math.abs(dz * 100).toFixed(0)} ซม.` : ''} · ${w}`;
}

// Back to the model's own size.
export function unfitWheels(model) {
  const o = model.orig;
  if (!o) return;
  model.P.set(o.P); model.N.set(o.N);
  model.wheels = o.wheels.map((w) => ({ p: [...w.p], r: w.r }));
  model.pieces.forEach((p, k) => { p.min = [...o.pieces[k].min]; p.max = [...o.pieces[k].max]; });
  model.fit = null;
}

// ---------------------------------------------------------------------------------------------
// Glass like Escarabajo's (samples/escarabajo.rar), on every car: the glass pieces (kind 1) have their own
// rectangle of the texture (Escarabajo: u 0–0.125, v 0.25–0.375), red in the paint mask and near black with
// alpha 0 in the colour layer (Escarabajo 0–9, alpha 0; gtv98 / our older packs 56,59,59). Each glass
// piece is projected flat (along its main direction) into that rectangle, so no glass triangle reaches
// another region. The rectangle is Escarabajo's when nothing else uses it, else the closest free one.
// Changes the .0m files and both textures (and their _s copies) in place.
// The colour layer (<name>_color.png) is drawn over the car where its alpha is up. A new car's UVs don't
// match the template's pictures there (gtv98: lamp art in the middle → patches on our panels), so it is
// cleared except the block every game car keeps at its bottom-left (u < 0.17, v > 0.66) for the game.
export async function clearColourArt(out, name) {
  const b = out.get(`${name}_color.png`); if (!b) return 0;
  const img = await decodePNG(b); const { w, h } = img; const px = new Uint8ClampedArray(img.data); let n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if ((x + 0.5) / w <= 0.17 && (y + 0.5) / h >= 0.66) continue;
    const o = (y * w + x) * 4; if (px[o + 3]) n++; px.set([0, 0, 0, 0], o);
  }
  out.set(`${name}_color.png`, await png(px, w, h));
  const old = out.get(`${name}_color_s.dds`);
  const mode = old && old.length >= 128 && new DataView(old.buffer, old.byteOffset, 128).getUint32(16, true) === w ? 'full' : 'half';
  out.set(`${name}_color_s.dds`, dds(px, w, h, mode));
  return n;
}
// Glass laid out on the shop films' sheet like Escarabajo's (measured from its body / roof glass): the film
// picture sits at u 0-0.125, v 0.25-0.375 —
//   windshield, top 30 % of its height: the sun strip, left half on row v 0.252-0.287, right half on
//     v 0.287-0.322, u 0.002-0.123 across the half (centre at u 0.123 on the left row, 0.002 on the right)
//   rear window: u 0.008 (right, +x) - 0.123 (left), v 0.325 (top) - 0.374 (bottom)
//   side windows and the rest of the windshield: the line u 0.119, v 0.325 (top) - 0.375 (bottom)
// Without a film that corner is red in the mask and clear in the colour layer, so the glass stays clear.
export const FILM_RECT = [0, 0.25, 0.125, 0.375];
export function filmGlass(parts) {
  const all = parts.filter((p) => p.indices.length);
  if (!all.length) return 0;
  const mn = [Infinity, Infinity, Infinity]; const mx = [-Infinity, -Infinity, -Infinity];
  for (const p of all) for (let i = 0; i < p.positions.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p.positions[i + k]); mx[k] = Math.max(mx[k], p.positions[i + k]); }
  const mid = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, mn[2]];
  // every triangle with its outward normal and its kind of window
  const tris = [];
  for (const p of all) {
    const P = p.positions; const N = p.normals; let s = 0;
    for (let i = 0; i < P.length; i += 3) s += (P[i] - mid[0]) * N[i] + (P[i + 1] - mid[1]) * N[i + 1] + (P[i + 2] - mid[2]) * N[i + 2];
    const sg = s >= 0 ? 1 : -1;
    for (let t = 0; t < p.indices.length; t += 3) {
      const v = [p.indices[t], p.indices[t + 1], p.indices[t + 2]].map((i) => ({ p: [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], n: [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]] }));
      const n = [0, 1, 2].map((k) => sg * (v[0].n[k] + v[1].n[k] + v[2].n[k]));
      const kind = Math.abs(n[0]) > Math.abs(n[1]) ? 'side' : n[1] < 0 ? 'front' : 'rear';
      tris.push({ p, v, kind });
    }
  }
  const range = (kind, k) => { let a = Infinity; let b = -Infinity; for (const t of tris) if (t.kind === kind) for (const v of t.v) { a = Math.min(a, v.p[k]); b = Math.max(b, v.p[k]); } return [a, b]; };
  const [fzb, fzt] = range('front', 2); const [szb, szt] = range('side', 2); const [rzb, rzt] = range('rear', 2); const [rxa, rxb] = range('rear', 0);
  const sOf = (z) => (fzt - z) / ((fzt - fzb) || 1); // 0 at the windshield's top, 1 at its bottom
  const BAND = 0.3;
  // half width of the windshield along its height (top and band bottom, straight between)
  let hwTop = 0; let hwBot = 0;
  for (const t of tris) if (t.kind === 'front') for (const v of t.v) { const s = sOf(v.p[2]); if (s < 0.1) hwTop = Math.max(hwTop, Math.abs(v.p[0])); if (s >= 0.2 && s <= 0.4) hwBot = Math.max(hwBot, Math.abs(v.p[0])); }
  hwTop = hwTop || hwBot || 1; hwBot = hwBot || hwTop;
  const hw = (s) => hwTop + (hwBot - hwTop) * Math.min(1, s / BAND);
  const lerp = (a, b, f) => ({ p: a.p.map((x, k) => x + (b.p[k] - x) * f), n: a.n.map((x, k) => x + (b.n[k] - x) * f) });
  // split a polygon by f(v) = 0 into [negative side, positive side]
  const split = (poly, f) => {
    const neg = []; const pos = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]; const b = poly[(i + 1) % poly.length]; const fa = f(a); const fb = f(b);
      (fa < 0 ? neg : pos).push(a);
      if ((fa < 0) !== (fb < 0) && fa !== fb) { const c = lerp(a, b, fa / (fa - fb)); neg.push(c); pos.push(c); }
    }
    return [neg, pos];
  };
  const out = new Map(all.map((p) => [p, { P: [], N: [], U: [], I: [] }]));
  const emit = (p, poly, uvOf) => {
    if (poly.length < 3) return; const o = out.get(p); const base = o.P.length / 3;
    for (const v of poly) { o.P.push(...v.p); o.N.push(...v.n); o.U.push(...uvOf(v)); }
    for (let i = 1; i + 1 < poly.length; i++) o.I.push(base, base + i, base + i + 1);
  };
  const line = (z, zb, zt) => [0.119, 0.325 + 0.05 * Math.min(1, Math.max(0, (zt - z) / ((zt - zb) || 1)))];
  for (const t of tris) {
    if (t.kind === 'side') { emit(t.p, t.v, (v) => line(v.p[2], szb, szt)); continue; }
    if (t.kind === 'rear') { emit(t.p, t.v, (v) => [0.008 + 0.115 * (rxb - v.p[0]) / ((rxb - rxa) || 1), 0.325 + 0.049 * (rzt - v.p[2]) / ((rzt - rzb) || 1)]); continue; }
    const [band, low] = split(t.v, (v) => sOf(v.p[2]) - BAND);
    emit(t.p, low, (v) => line(sOf(v.p[2]), BAND, 1).map((x, k) => (k ? 0.325 + 0.05 * (sOf(v.p[2]) - BAND) / (1 - BAND) : x)));
    const [left, right] = split(band, (v) => v.p[0]);
    emit(t.p, left, (v) => { const s = Math.max(0, sOf(v.p[2])); return [0.123 - 0.121 * Math.min(1, Math.abs(v.p[0]) / hw(s)), 0.252 + 0.035 * s / BAND]; });
    emit(t.p, right, (v) => { const s = Math.max(0, sOf(v.p[2])); return [0.002 + 0.121 * Math.min(1, Math.abs(v.p[0]) / hw(s)), 0.287 + 0.035 * s / BAND]; });
  }
  let n = 0;
  for (const [p, o] of out) { p.positions = Float32Array.from(o.P); p.normals = Float32Array.from(o.N); p.uvs = Float32Array.from(o.U); p.indices = Uint32Array.from(o.I); n += o.I.length / 3; }
  return n;
}
// The licence plate like Escarabajo's: a 0.41 × 0.11 m plate of 8 points / 6 triangles over the whole cell
// u 0.75-1, v 0.875-1 (the game draws the plate picture there, which is why nothing else may use that cell).
// centre [x, y, z]; facing −1 front plate, +1 rear plate; out = how much further out its top edge stands (m).
export const PLATE_RECT = [0.75, 0.875, 1, 1];
export function plateQuad(centre, facing, out = 0) {
  // Escarabajo's front plate around its centre (x right, z up), uv as in its file
  const pts = [[-0.2035, 0.0505, 0.750, 0.881], [-0.2035, -0.0475, 0.750, 0.994], [-0.1935, -0.0525, 0.756, 1.000], [0.1935, -0.0525, 0.994, 1.000], [0.2035, -0.0475, 1.000, 0.994], [0.2035, 0.0505, 1.000, 0.881], [0.1935, 0.0555, 0.994, 0.875], [-0.1935, 0.0555, 0.756, 0.875]];
  const H = 0.108; const len = Math.hypot(H, out);
  const P = []; const U = []; const N = [];
  for (const [x, z, u, v] of pts) {
    const f = (z + 0.0525) / H - 0.5; // −0.5 bottom … 0.5 top
    // seen from behind, the rear plate's x runs the other way, so the picture reads right
    P.push(centre[0] + (facing > 0 ? -x : x), centre[1] + facing * out * f, centre[2] + z);
    U.push(u, v); N.push(0, (facing * H) / len, -out / len);
  }
  return { positions: Float32Array.from(P), normals: Float32Array.from(N), uvs: Float32Array.from(U), indices: Uint32Array.from([0, 1, 2, 2, 3, 4, 4, 5, 6, 2, 4, 6, 0, 2, 6, 7, 0, 6]) };
}
// Escarabajo's own values (the owner, 2026-10-13: the glass colour is to be Escarabajo's).
export const ESCARABAJO_GLASS = { rect: [0, 0.25, 0.125, 0.125], colour: [1, 1, 1, 0], mask: [255, 0, 0, 255] };
export async function glassLikeEscarabajo(out, name) {
  const maskPng = out.get(`${name}_base.png`); const colPng = out.get(`${name}_color.png`);
  if (!maskPng) return null;
  const mask = await decodePNG(maskPng);
  const col = colPng ? await decodePNG(colPng) : { w: 128, h: 64, data: new Uint8ClampedArray(128 * 64 * 4) };
  // Cells of the colour layer that other pieces' UVs touch.
  const GW = col.w; const GH = col.h; const used = new Uint8Array(GW * GH);
  const meshes = [];
  for (const [rel, b] of out) {
    if (!rel.endsWith('.0m')) continue;
    const om = parseOM(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    const parts = omParts(om);
    meshes.push({ rel, om, parts });
    for (const p of parts) {
      if (p.flags[0] === 1 || p.positions.length / 3 <= 8) continue;
      const U = p.uvs;
      for (let t = 0; t < p.indices.length; t += 3) {
        const q = [0, 1, 2].map((k) => [U[p.indices[t + k] * 2] * GW, U[p.indices[t + k] * 2 + 1] * GH]);
        const x0 = Math.max(0, Math.floor(Math.min(q[0][0], q[1][0], q[2][0]))); const x1 = Math.min(GW - 1, Math.floor(Math.max(q[0][0], q[1][0], q[2][0])));
        const y0 = Math.max(0, Math.floor(Math.min(q[0][1], q[1][1], q[2][1]))); const y1 = Math.min(GH - 1, Math.floor(Math.max(q[0][1], q[1][1], q[2][1])));
        const side = (a, b, x, y) => (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          if ((x1 - x0 + 1) * (y1 - y0 + 1) <= 4) { used[y * GW + x] = 1; continue; }
          // the cell is touched when its centre or a corner is inside the triangle
          for (const [px, py] of [[x + 0.5, y + 0.5], [x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]) {
            const s0 = side(q[0], q[1], px, py); const s1 = side(q[1], q[2], px, py); const s2 = side(q[2], q[0], px, py);
            if ((s0 >= 0 && s1 >= 0 && s2 >= 0) || (s0 <= 0 && s1 <= 0 && s2 <= 0)) { used[y * GW + x] = 1; break; }
          }
        }
        for (const [px, py] of q) used[Math.min(GH - 1, Math.max(0, Math.floor(py))) * GW + Math.min(GW - 1, Math.max(0, Math.floor(px)))] = 1;
      }
    }
  }
  if (!meshes.some((m) => m.parts.some((p) => p.flags[0] === 1 && p.positions.length / 3 > 8))) return null;
  // A free block the size of Escarabajo's rectangle (in colour-layer cells), closest to it.
  const [ru, rv, rw, rh] = ESCARABAJO_GLASS.rect;
  const BW = Math.max(4, Math.round(rw * GW)); const BH = Math.max(4, Math.round(rh * GH));
  const want = [ru * GW, rv * GH];
  let best = null; let bd = Infinity;
  for (let y = 0; y + BH <= GH; y++) for (let x = 0; x + BW <= GW; x++) {
    const d = (x - want[0]) ** 2 + (y - want[1]) ** 2; if (d >= bd) continue;
    let free = true;
    for (let yy = Math.max(0, y - 1); free && yy < Math.min(GH, y + BH + 1); yy++) for (let xx = Math.max(0, x - 1); xx < Math.min(GW, x + BW + 1); xx++) if (used[yy * GW + xx]) { free = false; break; }
    if (free) { bd = d; best = [x, y]; }
  }
  if (!best) best = want.map(Math.round); // nothing free: Escarabajo's own place
  // UV box inside the block (one cell in from its edge so mip levels stay on the glass colours).
  const box = [(best[0] + 1) / GW, (best[1] + 1) / GH, (BW - 2) / GW, (BH - 2) / GH];
  for (const m of meshes) {
    let changed = false;
    for (const p of m.parts) {
      if (p.flags[0] !== 1) continue;
      const P = p.positions; const n = P.length / 3; if (!n) continue;
      // flat projection along the piece's main direction (sum of its normals)
      const dir = [0, 0, 0]; for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) dir[k] += Math.abs(p.normals[i * 3 + k]);
      const ax = dir.indexOf(Math.max(...dir)); const [a1, a2] = [0, 1, 2].filter((k) => k !== ax);
      const lo = [Infinity, Infinity]; const hi = [-Infinity, -Infinity];
      for (let i = 0; i < n; i++) { lo[0] = Math.min(lo[0], P[i * 3 + a1]); hi[0] = Math.max(hi[0], P[i * 3 + a1]); lo[1] = Math.min(lo[1], P[i * 3 + a2]); hi[1] = Math.max(hi[1], P[i * 3 + a2]); }
      for (let i = 0; i < n; i++) {
        p.uvs[i * 2] = box[0] + box[2] * ((P[i * 3 + a1] - lo[0]) / (hi[0] - lo[0] || 1));
        p.uvs[i * 2 + 1] = box[1] + box[3] * ((P[i * 3 + a2] - lo[1]) / (hi[1] - lo[1] || 1));
      }
      changed = true;
    }
    if (changed) out.set(m.rel, writeOM(m.om, m.parts));
  }
  // Mask red and colour layer near black, alpha 0 under the block — Escarabajo's values.
  const paint = (img, data, rgba) => {
    const x0 = Math.floor((best[0] / GW) * img.w); const x1 = Math.ceil(((best[0] + BW) / GW) * img.w);
    const y0 = Math.floor((best[1] / GH) * img.h); const y1 = Math.ceil(((best[1] + BH) / GH) * img.h);
    for (let y = y0; y < Math.min(img.h, y1); y++) for (let x = x0; x < Math.min(img.w, x1); x++) data.set(rgba, (y * img.w + x) * 4);
  };
  const mpx = new Uint8ClampedArray(mask.data); paint(mask, mpx, ESCARABAJO_GLASS.mask);
  const cpx = new Uint8ClampedArray(col.data); paint(col, cpx, ESCARABAJO_GLASS.colour);
  const save = async (base, px, w, h, defMode) => {
    out.set(`${base}.png`, await png(px, w, h));
    if (out.has(`${base}_s.png`)) { out.set(`${base}_s.png`, await png(px, w, h)); return; }
    const old = out.get(`${base}_s.dds`);
    let mode = defMode;
    if (old && old.length >= 128) mode = new DataView(old.buffer, old.byteOffset, 128).getUint32(16, true) === w ? 'full' : 'half';
    out.set(`${base}_s.dds`, dds(px, w, h, mode));
  };
  await save(`${name}_base`, mpx, mask.w, mask.h, 'full');
  await save(`${name}_color`, cpx, col.w, col.h, 'half');
  return box;
}

// ---------------------------------------------------------------------------------------------
// The file set like Escarabajo's, default parts only: every part folder has default_0/1/2.0m (a folder
// with only a tuning variant takes that variant as its default), list.xml lists just the default
// (`<part id='0' name='default' mesh='default' tex='…' />`; tex '' where no texture is shipped, as
// Escarabajo's hood and roof), the variants' meshes / textures / icons are dropped, every folder gets
// its default icon, and the tail lamps get their own texture like Escarabajo's rearlight (housing,
// red brake light, amber indicator) with each lamp piece flat in its band. mainspoiler stays as it is
// (Escarabajo has no default wing either). Changes `out` in place.
const LAMP_BANDS = { 0: [[150, 20, 24, 255], 0], 3: [[205, 18, 22, 255], 1], 4: [[255, 168, 40, 255], 2] };
export async function defaultPartsLikeEscarabajo(out, name, { log = () => {} } = {}) {
  const dirs = [...new Set([...out.keys()].filter((r) => r.includes('/')).map((r) => r.split('/')[0]))].filter((d) => !/^(dooropen|icon|mainspoiler)$/i.test(d));
  const omOf = (b) => parseOM(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const added = [];
  for (const dir of dirs) {
    const files = [...out.keys()].filter((r) => r.startsWith(`${dir}/`) && !r.slice(dir.length + 1).includes('/'));
    const meshes = files.filter((r) => /_[0-2]\.0m$/.test(r));
    // default_0/1/2: from the default's other LODs, else from a variant
    for (let l = 0; l < 3; l++) {
      const rel = `${dir}/default_${l}.0m`;
      if (out.has(rel)) continue;
      const src = [`${dir}/default_2.0m`, `${dir}/default_1.0m`, `${dir}/default_0.0m`].find((r) => out.has(r)) || meshes.find((r) => r.endsWith(`_${l}.0m`)) || meshes[0];
      if (!src || !out.has(src)) continue;
      if (/\/default_[0-2]\.0m$/.test(src)) out.set(rel, out.get(src));
      else {
        // from a tuning variant: its pieces and flags, every point on one spot (nothing drawn), so the
        // default is the plain car (gtv98's sills are in its body) and not the variant's body kit
        const om = omOf(out.get(src)); const parts = omParts(om);
        for (const q of parts) { const c = [0, 1, 2].map((k) => q.positions[k] || 0); for (let i = 0; i < q.positions.length; i += 3) q.positions.set(c, i); }
        out.set(rel, writeOM(om, parts));
      }
      added.push(rel);
    }
    if (!out.has(`${dir}/default_2.0m`)) continue;
    // the list's own default / base entries (Escarabajo's lamps have a 'base' mesh shown with the default)
    const listText = decodeSpec(out.get(`${dir}/list.xml`) || new Uint8Array());
    const entry = (nm) => { const m = listText.match(new RegExp(`<part\\b[^>]*name='${nm}'[^>]*/>`)); return m ? { tex: (m[0].match(/tex='([^']*)'/) || [])[1] || '' } : null; };
    const base = out.has(`${dir}/base_2.0m`) ? entry('base') : null;
    for (const r of meshes) if (!/\/default_[0-2]\.0m$/.test(r) && !(base && /\/base_[0-2]\.0m$/.test(r))) out.delete(r);
    // the default's texture: kept when shipped (the list's, or named <name>_<dir>_default / <name>_<dir>), variants' dropped
    const pngs = files.filter((r) => r.endsWith('.png'));
    let tex = [entry('default')?.tex, `${name}_${dir}_default`, `${name}_${dir}`].find((t) => t && out.has(`${dir}/${t}.png`)) || '';
    const baseTex = base && out.has(`${dir}/${base.tex}.png`) ? base.tex : '';
    for (const r of pngs) {
      const t = r.slice(dir.length + 1, -4);
      if (t === tex || t === baseTex) continue;
      out.delete(r); out.delete(`${dir}/${t}_s.dds`); out.delete(`${dir}/${t}_s.png`);
    }
    for (const r of files.filter((x) => /_s\.dds$/.test(x) && !out.has(x.replace(/_s\.dds$/, '.png')))) out.delete(r);
    // tail lamps: their own texture, lamp pieces flat in their band
    // (a rearlight that already has its texture — old body mode, the template's lamp art — keeps it)
    if (dir === 'rearlight' && !tex) {
      const S = 128; const px = new Uint8ClampedArray(S * S * 4);
      for (const [rgba, band] of Object.values(LAMP_BANDS)) for (let y = band * 32; y < band * 32 + 32; y++) for (let x = 0; x < S; x++) px.set(rgba, (y * S + x) * 4);
      tex = `${name}_rearlight_default`;
      for (let l = 0; l < 3; l++) {
        const rel = `${dir}/default_${l}.0m`; const om = omOf(out.get(rel)); const parts = omParts(om);
        for (const p of parts) {
          const band = (LAMP_BANDS[p.flags[0]] || LAMP_BANDS[0])[1];
          const P = p.positions; const n = P.length / 3; if (!n) continue;
          // projected from behind (x across, z up), inside the band with a 4-texel margin
          let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
          for (let i = 0; i < n; i++) { x0 = Math.min(x0, P[i * 3]); x1 = Math.max(x1, P[i * 3]); z0 = Math.min(z0, P[i * 3 + 2]); z1 = Math.max(z1, P[i * 3 + 2]); }
          for (let i = 0; i < n; i++) {
            p.uvs[i * 2] = (4 + 120 * ((P[i * 3] - x0) / (x1 - x0 || 1))) / S;
            p.uvs[i * 2 + 1] = (band * 32 + 4 + 24 * ((z1 - P[i * 3 + 2]) / (z1 - z0 || 1))) / S;
          }
        }
        out.set(rel, writeOM(om, parts));
      }
      out.set(`${dir}/${tex}.png`, await png(px, S, S));
      out.set(`${dir}/${tex}_s.dds`, dds(px, S, S, 'full'));
    }
    const lines = base ? [`<part id='0' name='base' mesh='base' tex='${baseTex}' />`, `<part id='4' name='default' mesh='default' tex='${tex}' />`] : [`<part id='0' name='default' mesh='default' tex='${tex}' />`];
    out.set(`${dir}/list.xml`, encodeSpec(`<?xml version='1.0' encoding='UTF-16'?>\r\n<partlist>\r\n${lines.map((l) => `\t${l}\r\n`).join('')}</partlist>\r\n`));
  }
  // icons: the default of every folder; variants' icons dropped (mainspoiler's kept)
  for (const r of [...out.keys()].filter((x) => x.startsWith('icon/'))) {
    const key = r.slice(5 + name.length + 1, -4); const dir = key.split('_')[0];
    if (dirs.includes(dir) && key !== `${dir}_default` && key !== `${dir}_base`) out.delete(r);
  }
  for (const dir of dirs) {
    const rel = `icon/${name}_${dir}_default.png`;
    if (out.has(rel) || !out.has(`${dir}/default_2.0m`)) continue;
    try { out.set(rel, await renderIcon(out.get(`${dir}/default_2.0m`))); } catch { /* no WebGL here */ }
    if (!out.has(rel)) { const any = [...out.keys()].find((x) => x.startsWith('icon/') && x.endsWith('.png')); if (any) out.set(rel, out.get(any)); }
  }
  if (added.length) log(`เติม default ที่ขาด: ${added.join(', ')}`);
  return out;
}

// A car's parts back from Blender (.obj exported by the pages: one object per part, named
// "<file with / as __>#<part>"): each named part takes the object's own points, UVs and normals, so shape
// edits come back too (the old way matched by position and lost any moved point). Blender's ".001" / "_Mesh"
// suffixes and single / double underscores are allowed. meshes: [{ rel, parts }]; returns counts.
export function applyOBJ(meshes, text) {
  const V = []; const T = []; const N = []; const objs = new Map(); let cur = null; let named = false;
  const norm = (s) => s.replace(/\.\d+$/, '').replace(/_Mesh$/i, '').replace(/\.\d+$/, '').replace(/__/g, '_').toLowerCase();
  for (const line of text.split(/\r?\n/)) {
    const w = line.trim().split(/\s+/);
    if (w[0] === 'v') V.push([+w[1], +w[2], +w[3]]);
    else if (w[0] === 'vt') T.push([+w[1], +w[2]]);
    else if (w[0] === 'vn') N.push([+w[1], +w[2], +w[3]]);
    else if (w[0] === 'o' || (w[0] === 'g' && !named)) { if (w[0] === 'o') named = true; const k = norm(w.slice(1).join(' ')); if (!objs.has(k)) objs.set(k, []); cur = objs.get(k); }
    else if (w[0] === 'f' && cur) {
      const c = w.slice(1).map((s) => { const [a, b, n] = s.split('/'); const ix = (x, L) => (x ? (+x < 0 ? L + +x : +x - 1) : -1); return [ix(a, V.length), ix(b, T.length), ix(n, N.length)]; });
      for (let k = 1; k + 1 < c.length; k++) cur.push([c[0], c[k], c[k + 1]]);
    }
  }
  let parts = 0; let tris = 0; let tooBig = 0; const used = new Set();
  for (const m of meshes) m.parts.forEach((p, pi) => {
    const key = norm(`${m.rel.replace(/\//g, '__')}#${pi}`); const faces = objs.get(key); if (!faces || !faces.length) return;
    used.add(key);
    const map = new Map(); const P = []; const NN = []; const U = []; const I = [];
    for (const f of faces) {
      // normal of the face for corners without one (Blender coords: y up, -z forward)
      const [a, b, c] = f.map((x) => V[x[0]]); const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      let fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; const l = Math.hypot(...fn) || 1; fn = fn.map((x) => x / l);
      for (const [vi, ti, ni] of f) {
        const k = `${vi}/${ti}/${ni}`;
        if (!map.has(k)) {
          map.set(k, P.length / 3); const q = V[vi]; const t = T[ti] || [0, 0]; const n = N[ni] || fn;
          P.push(q[0], -q[2], q[1]); NN.push(n[0], -n[2], n[1]); U.push(t[0], 1 - t[1]); // back to RayCity: x, y back, z up
        }
        I.push(map.get(k));
      }
    }
    if (P.length / 3 > 65535) { tooBig++; return; }
    Object.assign(p, { positions: Float32Array.from(P), normals: Float32Array.from(NN), uvs: Float32Array.from(U), indices: Uint32Array.from(I) });
    delete p._adj; delete p._sg; parts++; tris += I.length / 3; m.dirty = true;
  });
  const unknown = [...objs.keys()].filter((k) => !used.has(k) && objs.get(k).length);
  return { parts, tris, tooBig, unknown };
}

// The game crashes on a mesh file with too many points (8,000 crashed; canyon's 6,032 and phoenix's 5,005
// load). capFileVerts reduces a file's big parts (meshoptimizer; UV seams kept, points keep their UVs, normals
// and colours) until the file holds at most `cap` points. parts: omParts list (changed in place); returns
// [before, after].
export const VERT_CAP = 5000; // (later steps add a few hundred: plates, glass, lamps)
export async function capFileVerts(parts, cap = VERT_CAP) {
  await MeshoptSimplifier.ready;
  const count = () => parts.reduce((n, p) => n + p.positions.length / 3, 0);
  const before = count(); if (before <= cap) return [before, before];
  const fixed = parts.filter((p) => p.positions.length / 3 <= 64).reduce((n, p) => n + p.positions.length / 3, 0);
  const big = parts.filter((p) => p.positions.length / 3 > 64);
  const total = big.reduce((n, p) => n + p.positions.length / 3, 0);
  const orig = big.map((p) => ({ positions: p.positions, normals: p.normals, uvs: p.uvs, indices: p.indices }));
  let ratio = (cap - fixed) / total;
  for (let round = 0; round < 12; round++) {
    big.forEach((p, k) => {
      const o = orig[k]; const nv = o.positions.length / 3; const want = Math.max(24, Math.floor(nv * ratio));
      let lo = 0.0; let hi = 1.0; let best = null;
      for (let it = 0; it < 14; it++) { // index target searched so the kept points fit `want`
        const mid = (lo + hi) / 2; const [idx] = MeshoptSimplifier.simplify(Uint32Array.from(o.indices), Float32Array.from(o.positions), 3, Math.max(3, Math.floor((o.indices.length / 3) * mid) * 3), 1);
        const used = new Set(idx); if (used.size <= want) { best = idx; lo = mid; } else hi = mid;
      }
      if (!best) best = MeshoptSimplifier.simplify(Uint32Array.from(o.indices), Float32Array.from(o.positions), 3, 3, 1)[0];
      const map = new Int32Array(nv).fill(-1); let n = 0; for (const i of best) if (map[i] < 0) map[i] = n++;
      const P = new Float32Array(n * 3); const N = new Float32Array(n * 3); const U = new Float32Array(n * 2);
      for (let i = 0; i < nv; i++) if (map[i] >= 0) { P.set(o.positions.subarray(i * 3, i * 3 + 3), map[i] * 3); N.set(o.normals.subarray(i * 3, i * 3 + 3), map[i] * 3); U.set(o.uvs.subarray(i * 2, i * 2 + 2), map[i] * 2); }
      Object.assign(p, { positions: P, normals: N, uvs: U, indices: Uint32Array.from(best, (i) => map[i]) }); delete p._adj; delete p._sg;
    });
    if (count() <= cap) break;
    ratio *= 0.93;
  }
  return [before, count()];
}
