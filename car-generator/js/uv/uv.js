// RayCity UV: the "UV Editing" workspace of RayCity Studio (Blender-like). Opens a car folder (or its .zip),
// shows every game file's UVs on the car's paint mask with gtv98's panels faint behind (the game's shop
// decals and films are drawn for that sheet), and lets islands be picked (on the sheet or on the car), moved,
// turned, flipped and scaled. Triangles whose UVs stretch across the texture (black in game) show red and can
// be cut by face direction. A Blender round trip (.obj out, .obj back, matched by position) does the rest.
// RayCity space: x left, y back, z up; three.js shows it as (x, z, −y).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { parseOM, writeOM, omParts } from '../om.js';
import { makeZip, readZip } from '../zip.js';
import { decodePNG, png, dds } from '../convert.js';

const $ = (id) => document.getElementById(id);
const status = (t) => { $('status').textContent = t; };

// ---------------------------------------------------------------------------------------------
// Car state: files (rel → bytes), and per game mesh (the _2.0m of the body and every part default) its
// parsed parts with islands. LOD / variant files that were byte-identical to an edited mesh are written
// with it.

const car = { name: '', files: new Map(), meshes: [], mask: null, maskImg: null, color: null, colorImg: null, colorDirty: false };
// The colour layer (<name>_color.png, 128×64) is drawn over the car where its alpha is up: every game car
// keeps the same block at its bottom-left (black / purple squares, a black-white ramp) for the game's own
// use, so paint UVs must stay out of it (a car whose tail lid sat there showed checkers and stripes).
const RESERVED = [0, 0.66, 0.17, 1]; // u0, v0, u1, v1
let selected = new Set(); // island keys "mesh|part|island"
const undo = []; const redo = [];

const isStretched = (p, t) => {
  const I = p.indices; const U = p.uvs; const P = p.positions;
  const a = I[t]; const b = I[t + 1]; const c = I[t + 2];
  const uvl = (x, y) => Math.hypot(U[x * 2] - U[y * 2], U[x * 2 + 1] - U[y * 2 + 1]);
  const len = (x, y) => Math.hypot(P[x * 3] - P[y * 3], P[x * 3 + 1] - P[y * 3 + 1], P[x * 3 + 2] - P[y * 3 + 2]);
  const span = Math.max(uvl(a, b), uvl(b, c), uvl(a, c));
  return span > 0.04 && span > Math.max(len(a, b), len(b, c), len(a, c)) * 0.35;
};

function islandsOf(p) {
  const n = p.positions.length / 3;
  const par = new Int32Array(n).map((_, i) => i);
  const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let t = 0; t < p.indices.length; t += 3) { const a = find(p.indices[t]); par[a] = find(p.indices[t + 1]); par[find(p.indices[t + 2])] = find(p.indices[t + 1]); }
  const id = new Map(); const vertIsl = new Int32Array(n);
  for (let i = 0; i < n; i++) { const r = find(i); if (!id.has(r)) id.set(r, id.size); vertIsl[i] = id.get(r); }
  return { count: id.size, vertIsl };
}

async function openFiles(entries) {
  // entries: [{ path, data }]; the car folder is the directory holding body_2.0m
  const body = entries.find((e) => /(^|\/)body_2\.0m$/i.test(e.path));
  if (!body) { status('ไม่เจอ body_2.0m ในที่เปิด (ต้องเป็นโฟลเดอร์รถ RayCity)'); return; }
  const root = body.path.replace(/body_2\.0m$/i, '');
  car.files = new Map(entries.filter((e) => e.path.startsWith(root)).map((e) => [e.path.slice(root.length), e.data]));
  car.name = (([...car.files.keys()].find((r) => !r.includes('/') && /_base\.png$/i.test(r)) || 'car_base.png').replace(/_base\.png$/i, ''));
  car.meshes = [];
  for (const rel of [...car.files.keys()].filter((r) => r === 'body_2.0m' || /^[^/]+\/default_2\.0m$/.test(r)).sort()) {
    const b = car.files.get(rel);
    const om = parseOM(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    const parts = omParts(om);
    if (!parts.some((q) => q.positions.length / 3 > 8)) continue;
    car.meshes.push({ rel, om, parts, orig: b, isl: parts.map(islandsOf), dirty: false });
  }
  try {
    const m = await decodePNG(car.files.get(`${car.name}_base.png`));
    car.mask = m;
    const c = document.createElement('canvas'); c.width = m.w; c.height = m.h;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(m.data), m.w, m.h), 0, 0);
    car.maskImg = c;
  } catch { car.mask = null; car.maskImg = null; }
  try {
    const c0 = await decodePNG(car.files.get(`${car.name}_color.png`));
    car.color = c0; car.colorDirty = false;
    const c = document.createElement('canvas'); c.width = c0.w; c.height = c0.h;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(c0.data), c0.w, c0.h), 0, 0);
    car.colorImg = c;
  } catch { car.color = null; car.colorImg = null; }
  selected = new Set(); undo.length = 0; redo.length = 0; paint.sel = new Map(); paint.dirty = false; box0 = null;
  $('file-sel').innerHTML = `<option value="*">ทุกไฟล์</option>${car.meshes.map((m, i) => `<option value="${i}">${m.rel}</option>`).join('')}`;
  $('car-info').textContent = `${car.name} · ${car.files.size} ไฟล์ · ${car.meshes.length} ไฟล์ที่มีรูปทรง`;
  build3D(); viewFrom('iso');
  refresh();
  status('คลิกเกาะในจอซ้าย หรือคลิกบนรถ แล้วลากย้าย · ปุ่มด้านบน หมุน/กลับ/ย่อขยาย · สีแดง = ลายยืด');
}

// ---------------------------------------------------------------------------------------------
// gtv98's sheet, faint behind (from the embedded template)

let guide = null;
async function loadGuide() {
  const b64 = (window.RC_TEMPLATES || {})[$('guide-sel').value];
  if (!b64) return;
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const json = await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  const files = Object.entries(JSON.parse(json)).map(([p, d]) => [p, Uint8Array.from(atob(d), (c) => c.charCodeAt(0))]);
  guide = [];
  for (const [rel, b] of files) {
    if (!(rel === 'body_2.0m' || /^[^/]+\/default_2\.0m$/.test(rel))) continue;
    const om = parseOM(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    for (const s of om.submeshes) {
      if (s.vertexCount <= 8) continue;
      for (let i = s.indexStart; i < s.indexStart + s.indexCount; i += 3) guide.push([0, 1, 2].map((k) => { const v = om.indices[i + k] + s.vertexStart; return [om.uvs[v * 2], om.uvs[v * 2 + 1]]; }));
    }
  }
  refresh();
}

// ---------------------------------------------------------------------------------------------
// 2D sheet

const uvc = $('uv'); const g2 = uvc.getContext('2d');
let view = { s: 1, x: 0, y: 0 }; // sheet → canvas: px = x + u * S * s
const sheetSize = () => Math.min(uvc.width, uvc.height) * 0.92;
const toPx = (u, v) => { const S = sheetSize() * view.s; return [(uvc.width - S) / 2 + view.x + u * S, (uvc.height - S) / 2 + view.y + v * S]; };
const toUV = (x, y) => { const S = sheetSize() * view.s; return [(x - (uvc.width - S) / 2 - view.x) / S, (y - (uvc.height - S) / 2 - view.y) / S]; };
const shown = () => { const v = $('file-sel').value; return car.meshes.map((m, i) => i).filter((i) => v === '*' || +v === i); };

function draw2D() {
  const r = uvc.getBoundingClientRect();
  if (uvc.width !== Math.round(r.width) || uvc.height !== Math.round(r.height)) { uvc.width = Math.round(r.width); uvc.height = Math.round(r.height); }
  g2.fillStyle = '#1d1d1d'; g2.fillRect(0, 0, uvc.width, uvc.height);
  const [x0, y0] = toPx(0, 0); const [x1, y1] = toPx(1, 1);
  if (car.maskImg) { g2.globalAlpha = 0.55; g2.drawImage(car.maskImg, x0, y0, x1 - x0, y1 - y0); g2.globalAlpha = 1; }
  if (car.colorImg && $('opt-color').checked) { g2.imageSmoothingEnabled = false; g2.drawImage(car.colorImg, x0, y0, x1 - x0, y1 - y0); g2.imageSmoothingEnabled = true; }
  g2.strokeStyle = '#777'; g2.strokeRect(x0, y0, x1 - x0, y1 - y0);
  if (car.meshes.length) {
    const [rx0, ry0] = toPx(RESERVED[0], RESERVED[1]); const [rx1, ry1] = toPx(RESERVED[2], RESERVED[3]);
    g2.save(); g2.strokeStyle = '#d070ff'; g2.setLineDash([6, 4]); g2.lineWidth = 2; g2.strokeRect(rx0, ry0, rx1 - rx0, ry1 - ry0); g2.restore();
    g2.fillStyle = '#e0a0ff'; g2.font = '11px system-ui, sans-serif'; g2.fillText('โซนของเกม ห้ามวางแผงรถ', rx0 + 3, ry0 - 4);
  }
  if (!car.meshes.length) { g2.fillStyle = '#bbb'; g2.font = '16px system-ui, sans-serif'; g2.fillText('กด 📦 เปิด .zip รถ ทางซ้ายก่อน (zip ที่ดาวน์โหลดจาก RayCity Easy)', x0 + 20, y0 + 40); g2.fillText('หรือในหน้า RayCity Easy กดปุ่ม 🖌 ลงสี / แก้ UV ต่อ', x0 + 20, y0 + 66); }
  if (guide && $('opt-guide').checked) {
    g2.strokeStyle = 'rgba(255,255,255,0.18)'; g2.lineWidth = 1; g2.beginPath();
    for (const t of guide) { const p = t.map(([u, v]) => toPx(u, v)); g2.moveTo(...p[0]); g2.lineTo(...p[1]); g2.lineTo(...p[2]); g2.closePath(); }
    g2.stroke();
  }
  let stretched = 0; let onArt = 0;
  // triangles whose middle sits on the game's block or on a visible picture of the colour layer
  const artAt = (u, v) => {
    if (u >= RESERVED[0] && u <= RESERVED[2] && v >= RESERVED[1] && v <= RESERVED[3]) return true;
    if (!car.color) return false;
    const x = Math.min(car.color.w - 1, Math.max(0, Math.floor(u * car.color.w))); const y = Math.min(car.color.h - 1, Math.max(0, Math.floor(v * car.color.h)));
    return car.color.data[(y * car.color.w + x) * 4 + 3] > 40;
  };
  const art = new Path2D();
  for (const mi of shown()) {
    const m = car.meshes[mi];
    m.parts.forEach((p, pi) => {
      if (p.positions.length / 3 <= 8) return;
      const isl = m.isl[pi];
      const norm = new Path2D(); const sel = new Path2D(); const bad = new Path2D();
      for (let t = 0; t < p.indices.length; t += 3) {
        const pts = [0, 1, 2].map((k) => toPx(p.uvs[p.indices[t + k] * 2], p.uvs[p.indices[t + k] * 2 + 1]));
        const key = `${mi}|${pi}|${isl.vertIsl[p.indices[t]]}`;
        const st = isStretched(p, t); if (st) stretched++;
        if (p.flags[0] !== 1) {
          const cu = (p.uvs[p.indices[t] * 2] + p.uvs[p.indices[t + 1] * 2] + p.uvs[p.indices[t + 2] * 2]) / 3; const cv = (p.uvs[p.indices[t] * 2 + 1] + p.uvs[p.indices[t + 1] * 2 + 1] + p.uvs[p.indices[t + 2] * 2 + 1]) / 3;
          if (artAt(cu, cv)) { onArt++; art.moveTo(...pts[0]); art.lineTo(...pts[1]); art.lineTo(...pts[2]); art.closePath(); }
        }
        const path = st ? bad : selected.has(key) ? sel : norm;
        path.moveTo(...pts[0]); path.lineTo(...pts[1]); path.lineTo(...pts[2]); path.closePath();
      }
      g2.lineWidth = 1;
      g2.strokeStyle = 'rgba(230,230,230,0.75)'; g2.stroke(norm);
      g2.fillStyle = 'rgba(255,159,26,0.35)'; g2.fill(sel); g2.strokeStyle = '#ff9f1a'; g2.stroke(sel);
      g2.fillStyle = 'rgba(255,60,80,0.5)'; g2.fill(bad); g2.strokeStyle = '#ff3c50'; g2.stroke(bad);
    });
  }
  g2.fillStyle = 'rgba(200,90,255,0.55)'; g2.fill(art);
  draw2D.onArt = onArt;
  return stretched;
}

// Island under a sheet point (topmost: last drawn)
function pickUV(u, v) {
  const ids = shown();
  for (let k = ids.length - 1; k >= 0; k--) {
    const mi = ids[k]; const m = car.meshes[mi];
    for (let pi = m.parts.length - 1; pi >= 0; pi--) {
      const p = m.parts[pi]; if (p.positions.length / 3 <= 8) continue;
      for (let t = 0; t < p.indices.length; t += 3) {
        const a = p.indices[t]; const b = p.indices[t + 1]; const c = p.indices[t + 2];
        const U = p.uvs;
        const d = (U[b * 2] - U[a * 2]) * (U[c * 2 + 1] - U[a * 2 + 1]) - (U[c * 2] - U[a * 2]) * (U[b * 2 + 1] - U[a * 2 + 1]);
        if (Math.abs(d) < 1e-12) continue;
        const l1 = ((U[b * 2] - u) * (U[c * 2 + 1] - v) - (U[c * 2] - u) * (U[b * 2 + 1] - v)) / d;
        const l2 = ((U[c * 2] - u) * (U[a * 2 + 1] - v) - (U[a * 2] - u) * (U[c * 2 + 1] - v)) / d;
        if (l1 >= 0 && l2 >= 0 && l1 + l2 <= 1) return `${mi}|${pi}|${m.isl[pi].vertIsl[a]}`;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Edits on the selected islands (UVs only; "cut" also splits points)

function snapshot() { return car.meshes.map((m) => m.parts.map((p) => ({ positions: p.positions, normals: p.normals, uvs: p.uvs.slice(), indices: p.indices }))); }
function pushUndo() { undo.push(snapshot()); if (undo.length > 60) undo.shift(); redo.length = 0; }
function restore(s) {
  if (s.mask) { car.mask.data.set(s.mask); paint.dirty = true; maskChanged(); return; }
  car.meshes.forEach((m, mi) => { m.parts.forEach((p, pi) => Object.assign(p, s[mi][pi])); m.isl = m.parts.map(islandsOf); m.dirty = true; });
  refresh(); build3D();
}
function forSelectedVerts(fn) {
  const groups = new Map();
  for (const key of selected) { const [mi, pi, id] = key.split('|').map(Number); const k = `${mi}|${pi}`; if (!groups.has(k)) groups.set(k, new Set()); groups.get(k).add(id); }
  for (const [k, ids] of groups) {
    const [mi, pi] = k.split('|').map(Number); const m = car.meshes[mi]; const p = m.parts[pi]; const isl = m.isl[pi];
    for (let i = 0; i < p.positions.length / 3; i++) if (ids.has(isl.vertIsl[i])) fn(p, i);
    m.dirty = true;
  }
}
function selBox() {
  let a = Infinity; let b = Infinity; let c = -Infinity; let d = -Infinity;
  forSelectedVerts((p, i) => { a = Math.min(a, p.uvs[i * 2]); b = Math.min(b, p.uvs[i * 2 + 1]); c = Math.max(c, p.uvs[i * 2]); d = Math.max(d, p.uvs[i * 2 + 1]); });
  return { cu: (a + c) / 2, cv: (b + d) / 2, box: [a, b, c, d] };
}
function transformSel(f) {
  if (!selected.size) { status('เลือกเกาะก่อน (คลิกในจอซ้าย หรือคลิกบนรถ)'); return; }
  pushUndo();
  const { cu, cv } = selBox();
  forSelectedVerts((p, i) => { const [u, v] = f(p.uvs[i * 2] - cu, p.uvs[i * 2 + 1] - cv); p.uvs[i * 2] = cu + u; p.uvs[i * 2 + 1] = cv + v; });
  refresh(); update3DUVs();
}

// Cut by face direction inside each triangle's island box (or the whole car's stretched triangles):
// every triangle projected by its own normal; points split where neighbours project differently.
function cutParts(filter) {
  pushUndo();
  let cut = 0;
  car.meshes.forEach((m, mi) => {
    m.parts.forEach((p, pi) => {
      if (p.positions.length / 3 <= 8) return;
      const isl = m.isl[pi];
      // island boxes
      const box = new Map();
      for (let i = 0; i < p.positions.length / 3; i++) { const id = isl.vertIsl[i]; const b = box.get(id) || [1, 1, 0, 0]; b[0] = Math.min(b[0], p.uvs[i * 2]); b[1] = Math.min(b[1], p.uvs[i * 2 + 1]); b[2] = Math.max(b[2], p.uvs[i * 2]); b[3] = Math.max(b[3], p.uvs[i * 2 + 1]); box.set(id, b); }
      const P = p.positions; const I = p.indices;
      const nP = []; const nN = []; const nUV = []; const nI = []; const keyOf = new Map();
      // 3D bounds per island for the projection
      const lo = new Map(); const hi = new Map();
      for (let i = 0; i < P.length / 3; i++) { const id = isl.vertIsl[i]; const l = lo.get(id) || [Infinity, Infinity, Infinity]; const h = hi.get(id) || [-Infinity, -Infinity, -Infinity]; for (let k = 0; k < 3; k++) { l[k] = Math.min(l[k], P[i * 3 + k]); h[k] = Math.max(h[k], P[i * 3 + k]); } lo.set(id, l); hi.set(id, h); }
      for (let t = 0; t < I.length; t += 3) {
        const v = [I[t], I[t + 1], I[t + 2]]; const id = isl.vertIsl[v[0]];
        const doCut = filter(mi, pi, id, p, t);
        let region = 'keep';
        if (doCut) {
          cut++;
          const q = v.map((i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
          const e1 = q[1].map((x, j) => x - q[0][j]); const e2 = q[2].map((x, j) => x - q[0][j]);
          const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
          const ax = Math.abs(fn[0]); const ay = Math.abs(fn[1]); const az = Math.abs(fn[2]);
          region = az >= ax && az >= ay ? 'z' : ax >= ay ? 'x' : 'y';
        }
        for (let j = 0; j < 3; j++) {
          const key = `${v[j]}|${region}`;
          let n = keyOf.get(key);
          if (n === undefined) {
            n = nP.length / 3; keyOf.set(key, n);
            nP.push(P[v[j] * 3], P[v[j] * 3 + 1], P[v[j] * 3 + 2]); nN.push(p.normals[v[j] * 3], p.normals[v[j] * 3 + 1], p.normals[v[j] * 3 + 2]);
            if (region === 'keep') nUV.push(p.uvs[v[j] * 2], p.uvs[v[j] * 2 + 1]);
            else {
              const b = box.get(id); const l = lo.get(id); const h = hi.get(id);
              const f = (k) => (P[v[j] * 3 + k] - l[k]) / ((h[k] - l[k]) || 1);
              const [a, c2] = region === 'z' ? [f(1), f(0)] : region === 'x' ? [f(1), 1 - f(2)] : [f(0), 1 - f(2)];
              nUV.push(b[0] + (b[2] - b[0]) * a, b[1] + (b[3] - b[1]) * c2);
            }
          }
          nI.push(n);
        }
      }
      p.positions = new Float32Array(nP); p.normals = new Float32Array(nN); p.uvs = new Float32Array(nUV); p.indices = Uint32Array.from(nI);
      m.isl[pi] = islandsOf(p); m.dirty = true;
    });
  });
  selected = new Set();
  refresh(); build3D();
  status(cut ? `ตัดใหม่ ${cut} สามเหลี่ยม` : 'ไม่มีอะไรต้องตัด');
}

// ---------------------------------------------------------------------------------------------
// 3D view: the car with a grid over the mask so the UV layout shows on the body

const gl = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: true });
const scene = new THREE.Scene(); scene.background = new THREE.Color('#393939');
scene.add(new THREE.HemisphereLight('#ffffff', '#555555', 2.2));
const cam = new THREE.PerspectiveCamera(40, 1, 0.02, 100); cam.position.set(4.5, 2.5, 5.5);
const controls = new OrbitControls(cam, gl);
controls.mouseButtons = { LEFT: -1, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
controls.target.set(0, 0.6, 0);
const carGroup = new THREE.Group(); carGroup.rotation.x = -Math.PI / 2; scene.add(carGroup);
let texCanvas = null; let tex = null;
function makeTexture() {
  texCanvas = document.createElement('canvas'); texCanvas.width = texCanvas.height = 1024;
  const g = texCanvas.getContext('2d');
  tex = new THREE.CanvasTexture(texCanvas); tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace;
  drawTexture();
}
// the mask on the car; the checker grid (where the UVs go) only outside paint mode
function drawTexture() {
  if (!texCanvas) return;
  const g = texCanvas.getContext('2d');
  g.clearRect(0, 0, 1024, 1024);
  if (car.maskImg) g.drawImage(paint.preview && car.mask ? previewCanvas() : car.maskImg, 0, 0, 1024, 1024); else { g.fillStyle = '#c33'; g.fillRect(0, 0, 1024, 1024); }
  if (car.colorImg && $('opt-color') && $('opt-color').checked) { g.imageSmoothingEnabled = false; g.drawImage(car.colorImg, 0, 0, 1024, 1024); g.imageSmoothingEnabled = true; }
  if (!paint.on && !paint.preview) {
    g.globalAlpha = 0.35; g.fillStyle = '#fff';
    for (let i = 0; i < 32; i++) for (let j = 0; j < 32; j++) if ((i + j) % 2) g.fillRect(i * 32, j * 32, 32, 32);
    g.globalAlpha = 1;
  }
  if (tex) tex.needsUpdate = true;
}
function build3D() {
  carGroup.clear();
  if (!car.meshes.length) return;
  makeTexture();
  car.meshes.forEach((m, mi) => m.parts.forEach((p, pi) => {
    if (p.positions.length / 3 <= 8) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p.positions), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(p.normals), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(p.uvs), 2));
    geo.setIndex(new THREE.BufferAttribute(Uint32Array.from(p.indices), 1));
    const mat = p.flags[0] === 1 ? new THREE.MeshStandardMaterial({ color: '#6fa8dc', transparent: true, opacity: 0.4 }) : new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
    const mesh = new THREE.Mesh(geo, mat); mesh.userData = { mi, pi };
    carGroup.add(mesh);
  }));
}
// camera: the whole car in view, from a side (RayCity: x left, y back, z up; three: x, z, -y)
function viewFrom(dir) {
  const b = new THREE.Box3().setFromObject(carGroup); if (b.isEmpty()) return;
  const c = b.getCenter(new THREE.Vector3()); const r = b.getSize(new THREE.Vector3()).length() * 0.62;
  const d = { iso: [1, 0.55, 1.15], front: [0, 0.25, 1], back: [0, 0.25, -1], left: [1, 0.15, 0], right: [-1, 0.15, 0], top: [0.001, 1, 0.001] }[dir] || [1, 0.55, 1.15];
  const v = new THREE.Vector3(...d).normalize().multiplyScalar(r / Math.tan((cam.fov * Math.PI) / 360));
  controls.target.copy(c); cam.position.copy(c).add(v); cam.near = 0.01; cam.far = 200; cam.updateProjectionMatrix(); controls.update();
}
document.querySelectorAll('#views3d button').forEach((b) => b.addEventListener('click', () => viewFrom(b.dataset.v)));
function update3DUVs() {
  for (const mesh of carGroup.children) { if (mesh.userData.mi === undefined) continue; const p = car.meshes[mesh.userData.mi].parts[mesh.userData.pi]; mesh.geometry.attributes.uv.array.set(p.uvs); mesh.geometry.attributes.uv.needsUpdate = true; }
}
const ray = new THREE.Raycaster(); const mouse = new THREE.Vector2();
gl.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  if (paint.on) { paintDown(e); return; }
  const r = gl.getBoundingClientRect();
  mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, cam);
  const hit = ray.intersectObjects(carGroup.children.filter((o) => o.userData.mi !== undefined))[0];
  if (!hit) { if (!e.shiftKey) { selected = new Set(); refresh(); } return; }
  const { mi, pi } = hit.object.userData; const p = car.meshes[mi].parts[pi];
  const key = `${mi}|${pi}|${car.meshes[mi].isl[pi].vertIsl[p.indices[hit.faceIndex * 3]]}`;
  if (!e.shiftKey) selected = new Set();
  if (selected.has(key) && e.shiftKey) selected.delete(key); else selected.add(key);
  refresh();
});

// ---------------------------------------------------------------------------------------------
// Sheet mouse: click picks, drag moves, wheel zooms, middle / right drag pans

let drag = null;
uvc.addEventListener('contextmenu', (e) => e.preventDefault());
uvc.addEventListener('pointerdown', (e) => {
  uvc.setPointerCapture(e.pointerId);
  const r = uvc.getBoundingClientRect(); const x = e.clientX - r.left; const y = e.clientY - r.top;
  if (e.button !== 0) { drag = { pan: true, x, y, vx: view.x, vy: view.y }; return; }
  if (paint.on && car.mask) { paintStart(); drag = { paint: true }; paintAt2D(...toUV(x, y)); return; }
  const [u, v] = toUV(x, y);
  const key = pickUV(u, v);
  if (key) {
    if (!e.shiftKey && !selected.has(key)) selected = new Set();
    selected.add(key);
    pushUndo();
    drag = { move: true, u, v };
  } else if (!e.shiftKey) selected = new Set();
  refresh();
});
uvc.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const r = uvc.getBoundingClientRect(); const x = e.clientX - r.left; const y = e.clientY - r.top;
  if (drag.pan) { view.x = drag.vx + x - drag.x; view.y = drag.vy + y - drag.y; refresh(); return; }
  if (drag.paint) { paintAt2D(...toUV(x, y)); return; }
  const [u, v] = toUV(x, y); const du = u - drag.u; const dv = v - drag.v; drag.u = u; drag.v = v;
  forSelectedVerts((p, i) => { p.uvs[i * 2] += du; p.uvs[i * 2 + 1] += dv; });
  refresh(); update3DUVs();
});
uvc.addEventListener('pointerup', () => { if (drag?.paint) paintEnd(); drag = null; });
uvc.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = uvc.getBoundingClientRect(); const x = e.clientX - r.left; const y = e.clientY - r.top;
  const [u, v] = toUV(x, y);
  view.s = Math.min(20, Math.max(0.3, view.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
  const [x2, y2] = toPx(u, v); view.x += x - x2; view.y += y - y2;
  refresh();
}, { passive: false });

// ---------------------------------------------------------------------------------------------
// Blender round trip

function exportOBJ() {
  const lines = ['# RayCity car for Blender UV editing. Keep the shape; edit the UVs only.', `mtllib ${car.name}.mtl`, `usemtl mask`];
  let vo = 1;
  car.meshes.forEach((m) => m.parts.forEach((p, pi) => {
    if (p.positions.length / 3 <= 8) return;
    lines.push(`o ${m.rel.replace(/\//g, '__')}#${pi}`);
    for (let i = 0; i < p.positions.length / 3; i++) lines.push(`v ${p.positions[i * 3].toFixed(6)} ${p.positions[i * 3 + 2].toFixed(6)} ${(-p.positions[i * 3 + 1]).toFixed(6)}`);
    for (let i = 0; i < p.positions.length / 3; i++) lines.push(`vt ${p.uvs[i * 2].toFixed(6)} ${(1 - p.uvs[i * 2 + 1]).toFixed(6)}`);
    for (let t = 0; t < p.indices.length; t += 3) { const f = [0, 1, 2].map((k) => p.indices[t + k] + vo); lines.push(`f ${f.map((x) => `${x}/${x}`).join(' ')}`); }
    vo += p.positions.length / 3;
  }));
  return new TextEncoder().encode(lines.join('\n'));
}
async function importOBJ(text) {
  // faces with their corner positions + uvs, by object
  const V = []; const T = []; const faces = new Map(); let obj = '';
  for (const line of text.split(/\r?\n/)) {
    const w = line.trim().split(/\s+/);
    if (w[0] === 'v') V.push([+w[1], +w[2], +w[3]]);
    else if (w[0] === 'vt') T.push([+w[1], +w[2]]);
    else if (w[0] === 'o' || w[0] === 'g') obj = w.slice(1).join(' ').replace(/_[A-Za-z]*\.\d+$|\.\d+$/, '');
    else if (w[0] === 'f') {
      const c = w.slice(1).map((s) => { const [a, b] = s.split('/'); const vi = +a < 0 ? V.length + +a : +a - 1; const ti = +b < 0 ? T.length + +b : +b - 1; return { p: V[vi], t: T[ti] || [0, 0] }; });
      for (let k = 1; k + 1 < c.length; k++) { if (!faces.has(obj)) faces.set(obj, []); faces.get(obj).push([c[0], c[k], c[k + 1]]); }
    }
  }
  pushUndo();
  // Points matched by position within 2 mm (a grid of 2 mm cells, neighbours searched), so float
  // rounding through Blender never splits a match.
  const CELL = 500;
  const cellKey = (x, y, z) => `${x},${y},${z}`;
  let matched = 0; let missing = 0;
  car.meshes.forEach((m) => m.parts.forEach((p, pi) => {
    if (p.positions.length / 3 <= 8) return;
    const name = `${m.rel.replace(/\//g, '__')}#${pi}`;
    const list = faces.get(name) || [...faces.entries()].find(([k]) => k.startsWith(name))?.[1];
    if (!list) { missing += p.indices.length / 3; return; }
    const P = p.positions; const I = p.indices;
    // canonical id per position (points split at UV seams share one), via the grid
    const grid = new Map(); const canon = new Int32Array(P.length / 3);
    const near = (q) => {
      const cx = Math.round(q[0] * CELL); const cy = Math.round(q[1] * CELL); const cz = Math.round(q[2] * CELL);
      let best = -1; let bd = 4e-6;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) for (const i of grid.get(cellKey(cx + a, cy + b, cz + c)) || []) {
        const d = (P[i * 3] - q[0]) ** 2 + (P[i * 3 + 2] - q[1]) ** 2 + (-P[i * 3 + 1] - q[2]) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      return best < 0 ? -1 : canon[best];
    };
    for (let i = 0; i < P.length / 3; i++) {
      const q = [P[i * 3], P[i * 3 + 2], -P[i * 3 + 1]];
      const c0 = near(q);
      canon[i] = c0 >= 0 ? c0 : i;
      const k = cellKey(Math.round(q[0] * CELL), Math.round(q[1] * CELL), Math.round(q[2] * CELL));
      if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i);
    }
    const byTri = new Map();
    for (const f of list) { const ids = f.map((c) => near(c.p)); if (ids.includes(-1)) continue; f.ids = ids; byTri.set([...ids].sort((a, b) => a - b).join('|'), f); }
    const nP = []; const nN = []; const nUV = []; const nI = []; const keyOf = new Map();
    for (let t = 0; t < I.length; t += 3) {
      const v = [I[t], I[t + 1], I[t + 2]];
      const ids = v.map((i) => canon[i]);
      const f = byTri.get([...ids].sort((a, b) => a - b).join('|'));
      if (f) matched++; else missing++;
      for (let j = 0; j < 3; j++) {
        let uv = [p.uvs[v[j] * 2], p.uvs[v[j] * 2 + 1]];
        if (f) { const c = f[f.ids.indexOf(ids[j])]; if (c) uv = [c.t[0], 1 - c.t[1]]; }
        const kk = `${v[j]}|${uv[0].toFixed(5)},${uv[1].toFixed(5)}`;
        let n = keyOf.get(kk);
        if (n === undefined) { n = nP.length / 3; keyOf.set(kk, n); nP.push(P[v[j] * 3], P[v[j] * 3 + 1], P[v[j] * 3 + 2]); nN.push(p.normals[v[j] * 3], p.normals[v[j] * 3 + 1], p.normals[v[j] * 3 + 2]); nUV.push(uv[0], uv[1]); }
        nI.push(n);
      }
    }
    p.positions = new Float32Array(nP); p.normals = new Float32Array(nN); p.uvs = new Float32Array(nUV); p.indices = Uint32Array.from(nI);
    m.isl[pi] = islandsOf(p); m.dirty = true;
  }));
  selected = new Set(); refresh(); build3D();
  status(`นำ UV จาก Blender: ตรงกัน ${matched.toLocaleString()} สามเหลี่ยม${missing ? ` · ไม่เจอ ${missing.toLocaleString()} (คง UV เดิม: อย่าแก้รูปทรงใน Blender)` : ''}`);
}

// ---------------------------------------------------------------------------------------------
// Save: every edited mesh, and the files that were copies of it (LODs, tuning variants)

async function saveZip() {
  const out = new Map(car.files);
  let n = 0;
  for (const m of car.meshes) {
    if (!m.dirty) continue;
    const parts = m.parts.map((p) => ({ ...p, kind: p.flags[0] }));
    const bytes = writeOM(m.om, parts);
    for (const [rel, b] of car.files) if (b.length === m.orig.length && b.every((x, i) => x === m.orig[i])) { out.set(rel, bytes); n++; }
  }
  if (paint.dirty && car.mask) {
    const { w, h, data } = car.mask; const px = new Uint8ClampedArray(data);
    out.set(`${car.name}_base.png`, await png(px, w, h));
    const old = car.files.get(`${car.name}_base_s.dds`);
    const mode = old && old.length >= 128 && new DataView(old.buffer, old.byteOffset, 128).getUint32(16, true) !== w ? 'half' : 'full';
    out.set(`${car.name}_base_s.dds`, dds(px, w, h, mode));
  }
  if (car.colorDirty && car.color) {
    const { w, h, data } = car.color; const px = new Uint8ClampedArray(data);
    out.set(`${car.name}_color.png`, await png(px, w, h));
    const old = car.files.get(`${car.name}_color_s.dds`);
    const mode = old && old.length >= 128 && new DataView(old.buffer, old.byteOffset, 128).getUint32(16, true) === w ? 'full' : 'half';
    out.set(`${car.name}_color_s.dds`, dds(px, w, h, mode));
  }
  const zipFiles = [...out].sort((a, b) => a[0].localeCompare(b[0])).map(([rel, data]) => ({ path: `${car.name}/${rel}`, data }));
  const blob = await makeZip(zipFiles);
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${car.name}.zip`; a.click();
  $('save-log').textContent = `ดาวน์โหลด ${car.name}.zip แล้ว · เขียนใหม่ ${n} ไฟล์ .0m${paint.dirty ? ' · รูปสี (_base.png + _s.dds) ใหม่' : ''}${car.colorDirty ? ' · ชั้นลาย _color ใหม่' : ''}`;
}

// ---------------------------------------------------------------------------------------------
// Paint: the garage colours on the mask. Colour 1 red (the body), 2 green, 3 blue, black = no colour.
// Tools on the car: a whole panel (flood over the smooth surface within its UV island), a brush, a whole
// piece, a box (everything facing you inside a dragged frame), a selection (click / frame triangles,
// then paint them at once), a dividing line (a plane across the car: one side painted), the eyedropper.
// Protected colours are never painted over (masking tape). Each triangle is filled in the mask under
// its UVs; the sheet on the left takes a round brush.

const paint = { on: false, slot: 1, mode: 'panel', size: 0.25, dirty: false, stroke: false, protect: new Set(), backfaces: false, sel: new Map(), preview: false };
const SLOT_RGBA = { 0: [0, 0, 0, 255], 1: [255, 0, 0, 255], 2: [0, 255, 0, 255], 3: [0, 0, 255, 255] };
const SLOT_NAME = ['ดำ (ไม่รับสี)', 'สี 1', 'สี 2', 'สี 3'];
const slotAtPx = (d, o) => (d[o] > 128 ? 1 : d[o + 1] > 128 ? 2 : d[o + 2] > 128 ? 3 : 0);
function paintStart() { if (!car.mask) return; undo.push({ mask: car.mask.data.slice() }); if (undo.length > 60) undo.shift(); redo.length = 0; paint.stroke = true; }
function paintEnd() { paint.stroke = false; }
function maskChanged() {
  const { w, h, data } = car.mask;
  car.maskImg.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
  drawTexture(); refresh();
}
function setTexel(o) { const d = car.mask.data; if (paint.protect.size && paint.protect.has(slotAtPx(d, o * 4))) return; d.set(SLOT_RGBA[paint.slot], o * 4); }
function fillTri(U, a, b, c) {
  const { w, h } = car.mask;
  const q = [a, b, c].map((i) => [U[i * 2] * w, U[i * 2 + 1] * h]);
  const area = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]);
  const x0 = Math.max(0, Math.floor(Math.min(q[0][0], q[1][0], q[2][0])) - 1); const x1 = Math.min(w - 1, Math.ceil(Math.max(q[0][0], q[1][0], q[2][0])) + 1);
  const y0 = Math.max(0, Math.floor(Math.min(q[0][1], q[1][1], q[2][1])) - 1); const y1 = Math.min(h - 1, Math.ceil(Math.max(q[0][1], q[1][1], q[2][1])) + 1);
  if (Math.abs(area) < 1e-6) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setTexel(y * w + x); return; } // flat UVs: that spot
  const grow = 1.2 / Math.sqrt(Math.abs(area)); // about one texel wider (edges, filtering)
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const cx = x + 0.5; const cy = y + 0.5;
    const s0 = ((q[1][0] - q[0][0]) * (cy - q[0][1]) - (q[1][1] - q[0][1]) * (cx - q[0][0])) / area;
    const s1 = ((q[2][0] - q[1][0]) * (cy - q[1][1]) - (q[2][1] - q[1][1]) * (cx - q[1][0])) / area;
    const s2 = ((q[0][0] - q[2][0]) * (cy - q[2][1]) - (q[0][1] - q[2][1]) * (cx - q[2][0])) / area;
    if (s0 >= -grow && s1 >= -grow && s2 >= -grow) setTexel(y * w + x);
  }
}
// every paintable triangle: fn(mesh, part, t, centre[3], normal[3]) — glass left out
function eachTri(fn) {
  for (const mesh of carGroup.children) {
    if (!mesh.userData || mesh.userData.mi === undefined) continue;
    const p = car.meshes[mesh.userData.mi].parts[mesh.userData.pi]; if (p.flags[0] === 1) continue; const P = p.positions;
    for (let t = 0; t < p.indices.length; t += 3) {
      const [a, b, c] = [p.indices[t], p.indices[t + 1], p.indices[t + 2]];
      const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]]; const e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      fn(mesh, p, t / 3, [(P[a * 3] + P[b * 3] + P[c * 3]) / 3, (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3, (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3], n);
    }
  }
}
const fillT = (p, t) => fillTri(p.uvs, p.indices[t * 3], p.indices[t * 3 + 1], p.indices[t * 3 + 2]);
// triangles of a part connected over its smooth surface (shared corner positions, normals within 25°)
function panelOf(p, start, vertIsl = null) {
  const key = (i) => `${Math.round(p.positions[i * 3] * 2000)},${Math.round(p.positions[i * 3 + 1] * 2000)},${Math.round(p.positions[i * 3 + 2] * 2000)}`;
  if (!p._adj) {
    const byPos = new Map(); const nt = p.indices.length / 3; const fn = new Float32Array(nt * 3);
    for (let t = 0; t < nt; t++) {
      const [a, b, c] = [p.indices[t * 3], p.indices[t * 3 + 1], p.indices[t * 3 + 2]]; const P = p.positions;
      const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]]; const e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; const l = Math.hypot(...n) || 1;
      fn.set([n[0] / l, n[1] / l, n[2] / l], t * 3);
      for (const v of [a, b, c]) { const k = key(v); if (!byPos.has(k)) byPos.set(k, []); byPos.get(k).push(t); }
    }
    p._adj = { byPos, fn };
  }
  const { byPos, fn } = p._adj; const cos = Math.cos((+$('panel-angle').value * Math.PI) / 180);
  const isl0 = vertIsl ? vertIsl[p.indices[start * 3]] : -1;
  const seen = new Set([start]); const list = [start];
  for (let k = 0; k < list.length; k++) {
    const t = list[k];
    for (const v of [p.indices[t * 3], p.indices[t * 3 + 1], p.indices[t * 3 + 2]]) for (const u of byPos.get(key(v))) {
      if (seen.has(u)) continue;
      if (vertIsl && vertIsl[p.indices[u * 3]] !== isl0) continue; // same UV island only
      if (fn[t * 3] * fn[u * 3] + fn[t * 3 + 1] * fn[u * 3 + 1] + fn[t * 3 + 2] * fn[u * 3 + 2] < cos) continue;
      seen.add(u); list.push(u);
    }
  }
  return list;
}
function hitAt(e) {
  const r = gl.getBoundingClientRect();
  mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, cam);
  // glass is clicked through (the panel behind it is what gets painted)
  return ray.intersectObjects(carGroup.children.filter((o) => o.visible && o.userData.mi !== undefined && car.meshes[o.userData.mi].parts[o.userData.pi].flags[0] !== 1))[0] || null;
}
const said = (n, what = 'ลงสี') => status(`${what} ${SLOT_NAME[paint.slot]} ${n.toLocaleString()} สามเหลี่ยม · Ctrl+Z ย้อน · เสร็จแล้วกด ⬇ ดาวน์โหลด (ข้อ 5)`);
function paintAt3D(e) {
  const hit = hitAt(e); if (!hit) return;
  const { mi, pi } = hit.object.userData; const m = car.meshes[mi]; const p = m.parts[pi];
  if (p.flags[0] === 1) { status('กระจก: ไม่ต้องลงสี (กระจกแบบ Escarabajo ตั้งไว้แล้ว)'); return; }
  if (paint.mode === 'pick') {
    const { w, h, data } = car.mask; const x = Math.min(w - 1, Math.max(0, Math.floor(hit.uv.x * w))); const y = Math.min(h - 1, Math.max(0, Math.floor(hit.uv.y * h)));
    chooseSlot(slotAtPx(data, (y * w + x) * 4)); status(`ดูดสี: ${SLOT_NAME[paint.slot]} · คลิกแผงอื่นเพื่อทาด้วยสีนี้`); setMode('panel'); return;
  }
  if (paint.mode === 'select') {
    const add = panelOf(p, hit.faceIndex, m.isl[pi].vertIsl);
    const k = `${mi}|${pi}`; const set = paint.sel.get(k) || new Set();
    const removing = e.altKey || e.ctrlKey;
    for (const t of add) { if (removing) set.delete(t); else set.add(t); }
    paint.sel.set(k, set); drawSelection(); return;
  }
  let n = 0;
  if (paint.mode === 'part') { for (let t = 0; t < p.indices.length / 3; t++) { fillT(p, t); n++; } }
  else if (paint.mode === 'panel') { for (const t of panelOf(p, hit.faceIndex, m.isl[pi].vertIsl)) { fillT(p, t); n++; } }
  else if (paint.mode === 'brush') {
    const c = carGroup.worldToLocal(hit.point.clone()); const R2 = paint.size * paint.size;
    eachTri((mesh, q, t, ce) => { const d = (ce[0] - c.x) ** 2 + (ce[1] - c.y) ** 2 + (ce[2] - c.z) ** 2; if (d <= R2) { fillT(q, t); n++; } });
  }
  paint.dirty = true; maskChanged(); said(n);
}
function paintAt2D(u, v) {
  const { w, h } = car.mask; const R = Math.max(2, paint.size * 60);
  const cx = u * w; const cy = v * h;
  for (let y = Math.max(0, Math.floor(cy - R)); y <= Math.min(h - 1, Math.ceil(cy + R)); y++) for (let x = Math.max(0, Math.floor(cx - R)); x <= Math.min(w - 1, Math.ceil(cx + R)); x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= R * R) setTexel(y * w + x);
  paint.dirty = true; maskChanged();
}

// Box (frame): triangles whose centre falls inside the dragged frame on screen; only those facing you
// unless "ด้านหลังด้วย" is on.
const rectEl = $('rect'); let rect = null;
function trisInRect(x0, y0, x1, y1, fn) {
  const r = gl.getBoundingClientRect(); const v = new THREE.Vector3(); const nm = new THREE.Vector3(); const camDir = new THREE.Vector3();
  carGroup.updateMatrixWorld();
  const M = carGroup.matrixWorld; const N3 = new THREE.Matrix3().getNormalMatrix(M);
  eachTri((mesh, p, t, c, n) => {
    v.set(c[0], c[1], c[2]).applyMatrix4(M);
    if (!paint.backfaces) { nm.set(n[0], n[1], n[2]).applyMatrix3(N3); camDir.copy(v).sub(cam.position); if (nm.dot(camDir) > 0) return; }
    v.project(cam);
    const sx = (v.x + 1) / 2 * r.width; const sy = (1 - v.y) / 2 * r.height;
    if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1 && v.z < 1) fn(mesh, p, t);
  });
}
function showRect() { if (!rect) { rectEl.hidden = true; return; } const [x0, x1] = [Math.min(rect.x0, rect.x1), Math.max(rect.x0, rect.x1)]; const [y0, y1] = [Math.min(rect.y0, rect.y1), Math.max(rect.y0, rect.y1)]; Object.assign(rectEl.style, { left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` }); rectEl.hidden = false; }
function finishRect(e) {
  const [x0, x1] = [Math.min(rect.x0, rect.x1), Math.max(rect.x0, rect.x1)]; const [y0, y1] = [Math.min(rect.y0, rect.y1), Math.max(rect.y0, rect.y1)];
  rect = null; showRect();
  if (x1 - x0 < 3 && y1 - y0 < 3) return;
  if (paint.mode === 'select') {
    const removing = e.altKey || e.ctrlKey;
    trisInRect(x0, y0, x1, y1, (mesh, p, t) => { const k = `${mesh.userData.mi}|${mesh.userData.pi}`; const set = paint.sel.get(k) || new Set(); if (removing) set.delete(t); else set.add(t); paint.sel.set(k, set); });
    drawSelection(); return;
  }
  paintStart(); let n = 0;
  trisInRect(x0, y0, x1, y1, (mesh, p, t) => { fillT(p, t); n++; });
  paintEnd(); paint.dirty = true; maskChanged(); said(n, 'ครอบทาสี');
}

// Selection: yellow over the chosen triangles; painted at once with the chosen colour
let selMesh = null;
function selCount() { let n = 0; for (const s of paint.sel.values()) n += s.size; return n; }
function drawSelection() {
  if (selMesh) { carGroup.remove(selMesh); selMesh.geometry.dispose(); selMesh = null; }
  const pos = [];
  for (const [k, set] of paint.sel) {
    const [mi, pi] = k.split('|').map(Number); const p = car.meshes[mi].parts[pi]; const P = p.positions;
    for (const t of set) for (let j = 0; j < 3; j++) { const v = p.indices[t * 3 + j]; pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); }
  }
  if (pos.length) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    selMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#ffd400', transparent: true, opacity: 0.55, depthTest: true, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide }));
    selMesh.userData = {}; carGroup.add(selMesh);
  }
  $('sel-info').textContent = `เลือกไว้ ${selCount().toLocaleString()} สามเหลี่ยม`;
}
$('btn-sel-paint').addEventListener('click', () => {
  if (!selCount()) { status('ยังไม่ได้เลือก · เลือกวิธีทา "เลือกจุดก่อน" แล้วคลิก / ลากกรอบบนรถ'); return; }
  paintStart(); let n = 0;
  for (const [k, set] of paint.sel) { const [mi, pi] = k.split('|').map(Number); const p = car.meshes[mi].parts[pi]; for (const t of set) { fillT(p, t); n++; } }
  paintEnd(); paint.dirty = true; maskChanged(); said(n, 'ทาที่เลือก');
});
$('btn-sel-clear').addEventListener('click', () => { paint.sel = new Map(); drawSelection(); });
$('btn-sel-grow').addEventListener('click', () => {
  // grow the selection by one ring of neighbouring triangles (sharing a corner)
  for (const [k, set] of paint.sel) {
    const [mi, pi] = k.split('|').map(Number); const p = car.meshes[mi].parts[pi];
    const vs = new Set(); for (const t of set) for (let j = 0; j < 3; j++) vs.add(p.indices[t * 3 + j]);
    for (let t = 0; t < p.indices.length / 3; t++) if (!set.has(t) && [0, 1, 2].some((j) => vs.has(p.indices[t * 3 + j]))) set.add(t);
  }
  drawSelection();
});

// Dividing line: a plane across the car (height / length / width at a position); one side painted.
let planeMesh = null;
function carBox() {
  const mn = [Infinity, Infinity, Infinity]; const mx = [-Infinity, -Infinity, -Infinity];
  eachTri((mesh, p, t, c) => { for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], c[k]); mx[k] = Math.max(mx[k], c[k]); } });
  return { mn, mx };
}
let box0 = null;
function linePos() { const ax = +$('line-axis').value; const f = +$('line-pos').value / 100; return { ax, at: box0.mn[ax] + (box0.mx[ax] - box0.mn[ax]) * f }; }
function drawPlane() {
  if (planeMesh) { carGroup.remove(planeMesh); planeMesh.geometry.dispose(); planeMesh = null; }
  if (!paint.on || paint.mode !== 'line' || !car.meshes.length) return;
  box0 = box0 || carBox();
  const { ax, at } = linePos(); const s = [0, 1, 2].map((k) => (box0.mx[k] - box0.mn[k]) * 1.05 + 0.05); const c = [0, 1, 2].map((k) => (box0.mn[k] + box0.mx[k]) / 2);
  const size = [...s]; size[ax] = 0.004; c[ax] = at;
  planeMesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshBasicMaterial({ color: '#ffd400', transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
  planeMesh.position.set(...c); planeMesh.userData = {}; carGroup.add(planeMesh);
  $('line-info').textContent = ['ความสูง', 'ความยาว', 'ความกว้าง'][[2, 1, 0].indexOf(ax)] + ` ${(at - box0.mn[ax]).toFixed(2)} ม. จากขอบ`;
}
$('line-axis').addEventListener('change', drawPlane); $('line-pos').addEventListener('input', drawPlane);
$('btn-line-paint').addEventListener('click', () => {
  if (!car.meshes.length) return; box0 = box0 || carBox();
  const { ax, at } = linePos(); const side = $('line-side').value; // 'lo' | 'hi'
  paintStart(); let n = 0;
  eachTri((mesh, p, t, c) => { if (side === 'lo' ? c[ax] < at : c[ax] > at) { fillT(p, t); n++; } });
  paintEnd(); paint.dirty = true; maskChanged(); said(n, 'ทาตามเส้น');
});

// Replace one colour with another over the whole mask; preview the garage colours
$('btn-replace').addEventListener('click', () => {
  if (!car.mask) return; const from = +$('replace-from').value; const d = car.mask.data; paintStart(); let n = 0;
  for (let o = 0; o < d.length; o += 4) if (slotAtPx(d, o) === from && d[o + 3] > 0) { d.set(SLOT_RGBA[paint.slot], o); n++; }
  paintEnd(); paint.dirty = true; maskChanged(); status(`แทน ${SLOT_NAME[from]} → ${SLOT_NAME[paint.slot]} (${n.toLocaleString()} จุดบนรูป)`);
});
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function previewCanvas() {
  // the mask with slot colours swapped for the chosen garage colours (as the car shows in the garage)
  const { w, h, data } = car.mask; const c = document.createElement('canvas'); c.width = w; c.height = h;
  const img = new ImageData(w, h); const col = [[40, 40, 40], hex($('pv-1').value), hex($('pv-2').value), hex($('pv-3').value)];
  for (let o = 0; o < data.length; o += 4) { const k = slotAtPx(data, o); img.data.set([...col[k], 255], o); }
  c.getContext('2d').putImageData(img, 0, 0); return c;
}
['pv-on', 'pv-1', 'pv-2', 'pv-3'].forEach((id) => $(id).addEventListener('input', () => { paint.preview = $('pv-on').checked; drawTexture(); }));

// Mouse on the car while painting
gl.addEventListener('pointermove', (e) => {
  if (!paint.on) return;
  if (rect) { const r = gl.getBoundingClientRect(); rect.x1 = e.clientX - r.left; rect.y1 = e.clientY - r.top; showRect(); return; }
  if (paint.stroke && paint.mode === 'brush' && (e.buttons & 1)) paintAt3D(e);
});
gl.addEventListener('pointerup', (e) => { if (rect) finishRect(e); if (paint.stroke) paintEnd(); });
function paintDown(e) {
  if (!car.mask) { status('รถคันนี้ไม่มีรูปมาสก์ (_base.png)'); return; }
  gl.setPointerCapture(e.pointerId);
  const r = gl.getBoundingClientRect();
  if (paint.mode === 'box' || (paint.mode === 'select' && e.shiftKey)) { rect = { x0: e.clientX - r.left, y0: e.clientY - r.top, x1: e.clientX - r.left, y1: e.clientY - r.top }; showRect(); return; }
  if (paint.mode === 'line') { status('เส้นแบ่งสี: เลื่อนแถบตำแหน่ง แล้วกด "ทาฝั่งนี้"'); return; }
  if (paint.mode !== 'select' && paint.mode !== 'pick') paintStart();
  paintAt3D(e);
}

// UI
function chooseSlot(k) { paint.slot = k; document.querySelectorAll('#paint-slots button').forEach((x) => x.classList.toggle('on', +x.dataset.slot === k)); }
const MODE_HELP = {
  panel: 'คลิกบนรถ = ทาทั้งแผง (ปรับ "ความคมขอบแผง" ถ้าทาเกิน/ขาด)',
  brush: 'คลิกค้างแล้วลากบนรถ = แปรง (ปรับขนาดแปรง)',
  part: 'คลิกบนรถ = ทาทั้งชิ้น (ทั้งไฟล์ชิ้นนั้น)',
  box: 'ลากกรอบบนรถ = ครอบทาสีทุกอย่างในกรอบที่หันมาหาเรา',
  select: 'คลิก = เพิ่มแผงที่เลือก · Shift+ลาก = เลือกด้วยกรอบ · Ctrl/Alt+คลิก = เอาออก · แล้วกด "ทาที่เลือก"',
  line: 'เลือกแนวเส้น + เลื่อนตำแหน่ง (เส้นเหลืองบนรถ) แล้วกด "ทาฝั่งนี้"',
  pick: 'คลิกบนรถ = ดูดสีที่จุดนั้นมาใช้',
};
function setMode(m) {
  paint.mode = m; $('paint-mode').value = m;
  for (const id of ['brush', 'select', 'line', 'box', 'panel']) $(`opt-${id}`).hidden = !(m === id || (id === 'box' && m === 'select'));
  $('mode-help').textContent = MODE_HELP[m];
  drawPlane();
}
function setPaint(on) {
  paint.on = on;
  $('btn-paint').classList.toggle('accent', on);
  $('btn-paint').textContent = on ? '🖌 กำลังลงสี (กดอีกครั้งเพื่อเลิก)' : '🖌 เริ่มลงสี';
  drawTexture(); drawPlane();
  status(on ? `${MODE_HELP[paint.mode]} · ลากเมาส์ขวา = หมุนดู · ล้อเมาส์ = ซูม` : 'เลิกลงสี');
}
$('btn-paint').addEventListener('click', () => { if (!car.meshes.length) { status('เปิดรถก่อน'); return; } setPaint(!paint.on); });
document.querySelectorAll('#paint-slots button').forEach((b) => b.addEventListener('click', () => { chooseSlot(+b.dataset.slot); if (!paint.on && car.meshes.length) setPaint(true); }));
$('paint-mode').addEventListener('change', (e) => { setMode(e.target.value); if (!paint.on && car.meshes.length) setPaint(true); });
$('paint-size').addEventListener('input', (e) => { paint.size = +e.target.value; });
$('opt-back').addEventListener('change', (e) => { paint.backfaces = e.target.checked; });
document.querySelectorAll('#protect input').forEach((c) => c.addEventListener('change', () => { paint.protect = new Set([...document.querySelectorAll('#protect input:checked')].map((x) => +x.value)); }));
$('btn-paint-all').addEventListener('click', () => {
  if (!car.mask) return;
  paintStart(); let n = 0; eachTri((mesh, p, t) => { fillT(p, t); n++; });
  paintEnd(); paint.dirty = true; maskChanged(); said(n, 'ทาทั้งคัน');
});
setMode('panel');

// Opened from RayCity Easy (🖌 button): the car comes by message
if (window.opener) {
  window.addEventListener('message', async (e) => { if (e.data?.type === 'rc-car' && Array.isArray(e.data.files)) { await openFiles(e.data.files); setPaint(true); } });
  try { window.opener.postMessage({ type: 'rc-uv-ready' }, '*'); } catch { /* opener closed */ }
}

// 🧽 the colour layer cleared (alpha 0, so the paint shows) everywhere but the game's block
$('btn-clear-color').addEventListener('click', () => {
  if (!car.color) { status('รถคันนี้ไม่มี _color.png'); return; }
  const { w, h, data } = car.color; let n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = (x + 0.5) / w; const v = (y + 0.5) / h;
    if (u <= RESERVED[2] && v >= RESERVED[1]) continue;
    const o = (y * w + x) * 4; if (data[o + 3]) n++; data.set([0, 0, 0, 0], o);
  }
  car.colorImg.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
  car.colorDirty = true; drawTexture(); refresh();
  status(`ล้างลายในชั้น _color แล้ว (${n.toLocaleString()} จุด) · เหลือแค่บล็อกของเกมมุมล่างซ้าย · แผงที่ยังม่วงอยู่ = อยู่ในโซนเกม ให้ลากย้ายออก`);
});
$('opt-color').addEventListener('change', () => { drawTexture(); refresh(); });

// ---------------------------------------------------------------------------------------------
// UI

function refresh() {
  const st = draw2D();
  let isl = 0; for (const m of car.meshes) for (const q of m.isl) isl += q.count;
  const art = draw2D.onArt || 0;
  $('stats').textContent = car.meshes.length ? `เกาะ UV ${isl.toLocaleString()} · เลือก ${selected.size}\nสามเหลี่ยมลายยืด (แดง): ${st.toLocaleString()}${st ? ' → กด 🩹' : ' ✅'}\nสามเหลี่ยมทับลาย/โซนเกม (ม่วง): ${art.toLocaleString()}${art ? ' → กด 🧽 หรือย้ายเกาะออก' : ' ✅'}` : '';
  if ($('art-info')) $('art-info').textContent = car.meshes.length ? (art ? `⚠ มี ${art.toLocaleString()} สามเหลี่ยมที่จะมีรูปแปลกติดในเกม (สีม่วงในจอซ้าย)` : '✅ ไม่มีแผงไหนทับลาย') : '';
}
function loop() {
  const r = gl.getBoundingClientRect();
  if (gl.width !== Math.round(r.width) || gl.height !== Math.round(r.height)) { renderer.setSize(r.width, r.height, false); cam.aspect = r.width / Math.max(1, r.height); cam.updateProjectionMatrix(); }
  controls.update();
  for (const mesh of carGroup.children) {
    const { mi, pi } = mesh.userData;
    const any = [...selected].some((k) => k.startsWith(`${mi}|${pi}|`));
    if (mesh.material.emissive) mesh.material.emissive.set(any ? '#3a2400' : '#000000');
  }
  renderer.render(scene, cam);
  requestAnimationFrame(loop);
}
new ResizeObserver(refresh).observe(uvc);

const zipIn = $('file-zip'); const dirIn = $('file-dir'); const objIn = $('file-obj');
$('btn-open-zip').addEventListener('click', () => zipIn.click());
$('btn-open-dir').addEventListener('click', () => dirIn.click());
zipIn.addEventListener('change', async (e) => { const f = e.target.files[0]; if (f) await openFiles(await readZip(new Uint8Array(await f.arrayBuffer()))); e.target.value = ''; });
dirIn.addEventListener('change', async (e) => { const list = []; for (const f of e.target.files) list.push({ path: f.webkitRelativePath || f.name, data: new Uint8Array(await f.arrayBuffer()) }); await openFiles(list); e.target.value = ''; });
$('file-sel').addEventListener('change', () => { selected = new Set(); refresh(); });
$('opt-guide').addEventListener('change', refresh);
$('guide-sel').addEventListener('change', loadGuide);
$('btn-undo').addEventListener('click', () => { if (undo.length) { const s = undo.pop(); redo.push(s.mask ? { mask: car.mask.data.slice() } : snapshot()); restore(s); } });
$('btn-redo').addEventListener('click', () => { if (redo.length) { const s = redo.pop(); undo.push(s.mask ? { mask: car.mask.data.slice() } : snapshot()); restore(s); } });
$('btn-rot').addEventListener('click', () => transformSel((u, v) => [-v, u]));
$('btn-flipu').addEventListener('click', () => transformSel((u, v) => [-u, v]));
$('btn-flipv').addEventListener('click', () => transformSel((u, v) => [u, -v]));
$('btn-bigger').addEventListener('click', () => transformSel((u, v) => [u * 1.1, v * 1.1]));
$('btn-smaller').addEventListener('click', () => transformSel((u, v) => [u / 1.1, v / 1.1]));
$('btn-cut').addEventListener('click', () => { if (!selected.size) { status('เลือกเกาะก่อน'); return; } const sel = new Set(selected); cutParts((mi, pi, id) => sel.has(`${mi}|${pi}|${id}`)); });
$('btn-fixall').addEventListener('click', () => cutParts((mi, pi, id, p, t) => isStretched(p, t)));
$('btn-save').addEventListener('click', () => { if (car.meshes.length) saveZip(); });
$('btn-blender-out').addEventListener('click', async () => {
  if (!car.meshes.length) return;
  const mtl = new TextEncoder().encode(`newmtl mask\nmap_Kd ${car.name}_base.png\n`);
  const files = [{ path: `${car.name}.obj`, data: exportOBJ() }, { path: `${car.name}.mtl`, data: mtl }];
  if (car.files.has(`${car.name}_base.png`)) files.push({ path: `${car.name}_base.png`, data: car.files.get(`${car.name}_base.png`) });
  const a = document.createElement('a'); a.href = URL.createObjectURL(await makeZip(files)); a.download = `${car.name}_blender.zip`; a.click();
  status('แตก zip แล้วเปิด .obj ใน Blender (File › Import › Wavefront) · แก้เสร็จ Export เป็น .obj แล้วกด ⬆ นำกลับ');
});
$('btn-blender-in').addEventListener('click', () => objIn.click());
objIn.addEventListener('change', async (e) => { const f = e.target.files[0]; if (f && car.meshes.length) await importOBJ(await f.text()); e.target.value = ''; });
window.addEventListener('keydown', (e) => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); $(e.shiftKey ? 'btn-redo' : 'btn-undo').click(); }
  else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); $('btn-redo').click(); }
  else if (k === 'b') $('btn-paint').click();
  else if (paint.on && ['1', '2', '3', '0'].includes(k)) document.querySelector(`#paint-slots button[data-slot="${k}"]`).click();
  else if (paint.on && k === 'i') setMode('pick');
  else if (paint.on && k === 'enter' && paint.mode === 'select') $('btn-sel-paint').click();
  else if (k === 'r') $('btn-rot').click();
  else if (k === '+' || k === '=') $('btn-bigger').click();
  else if (k === '-') $('btn-smaller').click();
  else if (k === 'a' && !e.altKey) { car.meshes.forEach((m, mi) => { if (!shown().includes(mi)) return; m.isl.forEach((q, pi) => { for (let i = 0; i < q.count; i++) selected.add(`${mi}|${pi}|${i}`); }); }); refresh(); }
  else if (k === 'a' && e.altKey) { e.preventDefault(); selected = new Set(); refresh(); }
});
document.addEventListener('click', (e) => { if (e.target.closest('button')) e.target.closest('button').blur(); });

loadGuide();
refresh();
loop();
window.uvApp = { car, openFiles, cutParts, isStretched, refresh, get selected() { return selected; } };
