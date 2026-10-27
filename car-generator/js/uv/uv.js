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
import { decodePNG, png, dds, chartsLayout, underTris, filmGlass, plateQuad, FILM_RECT, PLATE_RECT, applyOBJ, capFileVerts, VERT_CAP, turnCar, measureArches, glassShell, orientOutward, splitLikeEscarabajo, blackSpot, closeOpenings, addOpenings, headlightPicture, openingParts, lineSeenInside } from '../convert.js';
import { decodeSpec, encodeSpec } from '../carSpec.js';

const $ = (id) => document.getElementById(id);
const status = (t) => { $('status').textContent = t; };

// ---------------------------------------------------------------------------------------------
// Car state: files (rel → bytes), and per game mesh (the _2.0m of the body and every part default) its
// parsed parts with islands. LOD / variant files that were byte-identical to an edited mesh are written
// with it.

const car = { name: '', files: new Map(), meshes: [], mask: null, maskImg: null, color: null, colorImg: null, colorDirty: false };
let decalImg = null; // a shop decal / film picture opened to line the UVs up with
let filmImg = null; let plateImg = null; // a window film (128×128) / plate (256×128) picture, drawn in their cells
// The colour layer (<name>_color.png, 128×64) is drawn over the car where its alpha is up: every game car
// keeps the same block at its bottom-left (black / purple squares, a black-white ramp) for the game's own
// use, so paint UVs must stay out of it (a car whose tail lid sat there showed checkers and stripes).
const RESERVED = [0, 0.66, 0.17, 1]; // u0, v0, u1, v1 (the box the block sits in)
// the block itself: a black square (u < 0.08, v 0.69-0.84) over a purple one, and a black-white ramp (u 0.08-0.16, v > 0.84)
const inBlock = (u, v) => (u <= 0.08 && v >= 0.69) || (u <= 0.16 && v >= 0.84);
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
  car.meshes = []; car.headlightPic = null;
  for (const rel of [...car.files.keys()].filter((r) => r === 'body_2.0m' || /^[^/]+\/default_2\.0m$/.test(r)).sort()) {
    const b = car.files.get(rel);
    const om = parseOM(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    const parts = omParts(om);
    if (!parts.some((q) => q.positions.length / 3 > 8) && !/^(front|rear)bumper\/|^(head|rear)light\/|^(skirt|hood|roof)\//.test(rel)) continue; // (bumpers / lamps / skirt / hood / roof of only a holder stay: plates, lamps and Escarabajo's parts go there)
    // a part with its own texture (list.xml tex, e.g. the tail lamps' red / amber bands) doesn't use the
    // body's paint mask: left off the sheet and not painted
    const dir = rel.includes('/') ? rel.split('/')[0] : '';
    const listText = dir && car.files.has(`${dir}/list.xml`) ? decodeSpec(car.files.get(`${dir}/list.xml`)) : '';
    const tex = (listText.match(/name='default'[^>]*tex='([^']*)'/) || [])[1] || '';
    if (tex && dir !== 'rearlight' && dir !== 'headlight' && car.files.has(`${dir}/${tex}.png`)) { // (lamp folders always load: 🔴 / 💡 work on them)
      // only a texture that covers the part completely (our tail lamps' opaque bands) hides the mask;
      // game cars' part textures are mostly see-through (the paint shows) and stay on the sheet
      try {
        const t = await decodePNG(car.files.get(`${dir}/${tex}.png`)); let solid = 0;
        for (let i = 3; i < t.data.length; i += 4) if (t.data[i] >= 250) solid++;
        if (solid > (t.data.length / 4) * 0.7) continue; // (our lamp bands: 75 % opaque; Escarabajo's lamp texture about half)
      } catch { /* unreadable: keep it */ }
    }
    car.meshes.push({ rel, om, parts, orig: b, isl: parts.map(islandsOf), dirty: false });
  }
  await loadLampPics();
  if (!escPic) { try { const tpl = await escarabajoTemplate(); const b = tpl && tpl.get('rearlight/escarabajo_rearlight_base.png'); if (b) escPic = flipRows(await decodePNG(b)); } catch { /* no template */ } }
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
  selected = new Set(); selectedPts = new Map(); undo.length = 0; redo.length = 0; paint.sel = new Map(); paint.dirty = false; box0 = null; carMid = null; platesOn = false;
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
  if (decalImg && $('decal-on').checked) { g2.globalAlpha = +$('decal-alpha').value; g2.drawImage(decalImg, x0, y0, x1 - x0, y1 - y0); g2.globalAlpha = 1; }
  const cell = (img, r) => { if (!img) return; const [a, b] = toPx(r[0], r[1]); const [c, d] = toPx(r[2], r[3]); g2.drawImage(img, a, b, c - a, d - b); };
  cell(filmImg, FILM_RECT); cell(plateImg, PLATE_RECT);
  if (car.colorImg && $('opt-color').checked) { g2.imageSmoothingEnabled = false; g2.drawImage(car.colorImg, x0, y0, x1 - x0, y1 - y0); g2.imageSmoothingEnabled = true; }
  g2.strokeStyle = '#777'; g2.strokeRect(x0, y0, x1 - x0, y1 - y0);
  if (car.meshes.length) {
    const [rx0, ry0] = toPx(RESERVED[0], RESERVED[1]); const [rx1, ry1] = toPx(RESERVED[2], RESERVED[3]);
    g2.save(); g2.strokeStyle = '#d070ff'; g2.setLineDash([6, 4]); g2.lineWidth = 2; g2.beginPath();
    for (const [u, v] of [[0, 0.69], [0.08, 0.69], [0.08, 0.84], [0.16, 0.84], [0.16, 1], [0, 1]]) { const [x, y] = toPx(u, v); if (u === 0 && v === 0.69) g2.moveTo(x, y); else g2.lineTo(x, y); }
    g2.closePath(); g2.stroke(); g2.restore();
    g2.fillStyle = '#e0a0ff'; g2.font = '11px system-ui, sans-serif'; g2.fillText('โซนของเกม ห้ามวางแผงรถ', rx0 + 3, toPx(0, 0.69)[1] - 4);
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
    if (inBlock(u, v)) return true;
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
  if (drag && drag.box) { g2.save(); g2.strokeStyle = '#ffd400'; g2.setLineDash([5, 4]); g2.strokeRect(Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1), Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0)); g2.restore(); }
  if (selectedPts.size) { g2.fillStyle = '#ffd400'; for (const [k, pts] of selectedPts) { const [mi, pi] = k.split('|').map(Number); const U = car.meshes[mi].parts[pi].uvs; for (const i of pts) { const [x, y] = toPx(U[i * 2], U[i * 2 + 1]); g2.fillRect(x - 3, y - 3, 6, 6); } } }
  draw2D.onArt = onArt;
  return stretched;
}

// Islands sitting flat (all corners on one texel) within a few pixels of a sheet point
function spotKeys(u, v) {
  const out = new Set(); const [qx, qy] = toPx(u, v);
  for (const mi of shown()) {
    const m = car.meshes[mi];
    m.parts.forEach((p, pi) => {
      if (p.positions.length / 3 <= 8) return; const U = p.uvs;
      for (let t = 0; t < p.indices.length; t += 3) {
        const a = p.indices[t]; const b = p.indices[t + 1]; const c = p.indices[t + 2];
        if (Math.abs((U[b * 2] - U[a * 2]) * (U[c * 2 + 1] - U[a * 2 + 1]) - (U[c * 2] - U[a * 2]) * (U[b * 2 + 1] - U[a * 2 + 1])) > 1e-12) continue;
        const [px0, py0] = toPx(U[a * 2], U[a * 2 + 1]);
        if (Math.hypot(px0 - qx, py0 - qy) < 6) out.add(`${mi}|${pi}|${m.isl[pi].vertIsl[a]}`);
      }
    });
  }
  return out;
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
        if (Math.abs(d) < 1e-12) {
          // flat (the whole triangle on one spot, a piece coloured by one texel): picked within a few pixels
          const [px0, py0] = toPx(U[a * 2], U[a * 2 + 1]); const [qx, qy] = toPx(u, v);
          if (Math.hypot(px0 - qx, py0 - qy) < 6) return `${mi}|${pi}|${m.isl[pi].vertIsl[a]}`;
          continue;
        }
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
function comboSnap() { return { combo: true, uv: snapshot(), mask: car.mask ? car.mask.data.slice() : null, color: car.color ? car.color.data.slice() : null }; }
function restore(s) {
  if (s.combo) {
    restore(s.uv);
    if (s.mask && car.mask) { car.mask.data.set(s.mask); paint.dirty = true; }
    if (s.color && car.color) { car.color.data.set(s.color); car.colorDirty = true; car.colorImg.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(car.color.data), car.color.w, car.color.h), 0, 0); }
    if (car.mask) maskChanged();
    return;
  }
  if (s.mask) { car.mask.data.set(s.mask); paint.dirty = true; maskChanged(); return; }
  car.meshes.forEach((m, mi) => { m.parts.forEach((p, pi) => Object.assign(p, s[mi][pi])); m.isl = m.parts.map(islandsOf); m.dirty = true; });
  refresh(); build3D();
}
// single UV points picked in point mode: "mesh|part" → Set(point)
let selectedPts = new Map();
// An edit of the selected UVs: the UVs and the mask before it, so the colours can follow the islands
let edit = null;
function beginEdit() {
  const carry = $('opt-carry') && $('opt-carry').checked && car.mask;
  if (carry) { undo.push(comboSnap()); if (undo.length > 60) undo.shift(); redo.length = 0; } else pushUndo();
  edit = { carry, uvs: car.meshes.map((m) => m.parts.map((p) => p.uvs.slice())), mask: carry ? car.mask.data.slice() : null };
}
function endEdit() {
  if (!edit) return;
  if (edit.carry) carryColours(edit);
  edit = null; refresh(); update3DUVs();
}
// every triangle whose UVs moved: its texels at the new place take the colour from the old place
function carryColours(e) {
  const { w, h, data } = car.mask; const old = e.mask; let moved = 0;
  car.meshes.forEach((m, mi) => m.parts.forEach((p, pi) => {
    const o = e.uvs[mi] && e.uvs[mi][pi]; if (!o || o.length !== p.uvs.length) return;
    const U = p.uvs; const I = p.indices;
    for (let t = 0; t < I.length; t += 3) {
      const v = [I[t], I[t + 1], I[t + 2]];
      if (v.every((i) => U[i * 2] === o[i * 2] && U[i * 2 + 1] === o[i * 2 + 1])) continue;
      moved++;
      const q = v.map((i) => [U[i * 2] * w, U[i * 2 + 1] * h]); const s0 = v.map((i) => [o[i * 2] * w, o[i * 2 + 1] * h]);
      const area = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]);
      if (Math.abs(area) < 1e-6) { // flat: the spot moves with its colour
        const sx = Math.min(w - 1, Math.max(0, Math.floor(s0[0][0]))); const sy = Math.min(h - 1, Math.max(0, Math.floor(s0[0][1])));
        const x = Math.min(w - 1, Math.max(0, Math.floor(q[0][0]))); const y = Math.min(h - 1, Math.max(0, Math.floor(q[0][1])));
        data.set(old.subarray((sy * w + sx) * 4, (sy * w + sx) * 4 + 4), (y * w + x) * 4); continue;
      }
      const x0 = Math.max(0, Math.floor(Math.min(q[0][0], q[1][0], q[2][0])) - 1); const x1 = Math.min(w - 1, Math.ceil(Math.max(q[0][0], q[1][0], q[2][0])) + 1);
      const y0 = Math.max(0, Math.floor(Math.min(q[0][1], q[1][1], q[2][1])) - 1); const y1 = Math.min(h - 1, Math.ceil(Math.max(q[0][1], q[1][1], q[2][1])) + 1);
      const grow = 1.2 / Math.sqrt(Math.abs(area));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const cx = x + 0.5; const cy = y + 0.5;
        const b0 = ((q[1][0] - cx) * (q[2][1] - cy) - (q[2][0] - cx) * (q[1][1] - cy)) / area;
        const b1 = ((q[2][0] - cx) * (q[0][1] - cy) - (q[0][0] - cx) * (q[2][1] - cy)) / area;
        const b2 = 1 - b0 - b1;
        if (b0 < -grow || b1 < -grow || b2 < -grow) continue;
        const c0 = Math.min(1, Math.max(0, b0)); const c1 = Math.min(1, Math.max(0, b1)); const c2 = Math.max(0, 1 - c0 - c1);
        const sx = Math.min(w - 1, Math.max(0, Math.floor(c0 * s0[0][0] + c1 * s0[1][0] + c2 * s0[2][0])));
        const sy = Math.min(h - 1, Math.max(0, Math.floor(c0 * s0[0][1] + c1 * s0[1][1] + c2 * s0[2][1])));
        data.set(old.subarray((sy * w + sx) * 4, (sy * w + sx) * 4 + 4), (y * w + x) * 4);
      }
    }
  }));
  if (moved) { paint.dirty = true; maskChanged(); }
}
function forSelectedVerts(fn) {
  for (const [k, pts] of selectedPts) { const [mi, pi] = k.split('|').map(Number); const m = car.meshes[mi]; const p = m.parts[pi]; for (const i of pts) fn(p, i); m.dirty = true; }
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
  if (!selected.size && !selectedPts.size) { status('เลือกเกาะก่อน (คลิกในจอซ้าย หรือคลิกบนรถ)'); return; }
  beginEdit();
  const { cu, cv } = selBox();
  forSelectedVerts((p, i) => { const [u, v] = f(p.uvs[i * 2] - cu, p.uvs[i * 2 + 1] - cv); p.uvs[i * 2] = cu + u; p.uvs[i * 2 + 1] = cv + v; });
  endEdit();
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
  if (decalImg && $('decal-on') && $('decal-on').checked) g.drawImage(decalImg, 0, 0, 1024, 1024);
  if (filmImg) g.drawImage(filmImg, FILM_RECT[0] * 1024, FILM_RECT[1] * 1024, (FILM_RECT[2] - FILM_RECT[0]) * 1024, (FILM_RECT[3] - FILM_RECT[1]) * 1024);
  if (plateImg) g.drawImage(plateImg, PLATE_RECT[0] * 1024, PLATE_RECT[1] * 1024, (PLATE_RECT[2] - PLATE_RECT[0]) * 1024, (PLATE_RECT[3] - PLATE_RECT[1]) * 1024);
  if (!paint.on && !paint.preview) {
    g.globalAlpha = 0.35; g.fillStyle = '#fff';
    for (let i = 0; i < 32; i++) for (let j = 0; j < 32; j++) if ((i + j) % 2) g.fillRect(i * 32, j * 32, 32, 32);
    g.globalAlpha = 1;
  }
  if (tex) tex.needsUpdate = true;
}
function collapsed(P) { let d = 0; for (let i = 3; i < P.length; i += 3) d = Math.max(d, Math.abs(P[i] - P[0]) + Math.abs(P[i + 1] - P[1]) + Math.abs(P[i + 2] - P[2])); return d < 0.01; }
function build3D() {
  carGroup.clear();
  if (!car.meshes.length) return;
  makeTexture();
  car.meshes.forEach((m, mi) => m.parts.forEach((p, pi) => {
    if (p.positions.length / 3 <= 8 && collapsed(p.positions)) return; // plate holders squashed to a point
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p.positions), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(p.normals), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(p.uvs), 2));
    geo.setIndex(new THREE.BufferAttribute(Uint32Array.from(p.indices), 1));
    const mat = p.flags[0] === 1 ? (filmImg ? new THREE.MeshStandardMaterial({ map: tex, transparent: true, opacity: 0.8, side: THREE.DoubleSide }) : new THREE.MeshStandardMaterial({ color: '#6fa8dc', transparent: true, opacity: 0.4, side: THREE.DoubleSide })) : new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, side: THREE.DoubleSide });
    const lf = lampFolder(m.rel); const lp = lf && lamp.tex.get(lf);
    const mesh = new THREE.Mesh(geo, lp && p.flags[0] === 0 ? new THREE.MeshStandardMaterial({ map: lp, roughness: 0.4, side: THREE.DoubleSide }) : mat); mesh.userData = { mi, pi };
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
  if (lamp.mode) { lampClick(e); return; }
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
  if (modal) { modalEnd(true); return; } // a click confirms G / R / S
  if ($('pick-mode').value === 'point') {
    const hit = pickPoint(u, v);
    if (hit) {
      const k = `${hit.mi}|${hit.pi}`;
      if (!e.shiftKey && !(selectedPts.get(k) && selectedPts.get(k).has(hit.ids[0]))) { selectedPts = new Map(); selected = new Set(); }
      const set = selectedPts.get(k) || new Set(); hit.ids.forEach((i) => set.add(i)); selectedPts.set(k, set);
      beginEdit(); drag = { move: true, u, v }; refresh(); return;
    }
    if (!e.shiftKey) { selectedPts = new Map(); selected = new Set(); }
    drag = { box: true, x0: x, y0: y, x1: x, y1: y }; refresh(); return;
  }
  // a colour spot (pieces with all their UVs on one texel): every piece on it selected and lit on the car
  const spot = spotKeys(u, v);
  if (spot.size && !paint.on) { selected = spot; selectedPts = new Map(); refresh(); status(`จุดสีนี้: ${spot.size} ชิ้น (สีส้มบนรถ) · ทั้งชิ้นใช้สีของจุดนี้ · ลากเพื่อย้ายจุดได้`); beginEdit(); drag = { move: true, u, v }; return; }
  const key = pickUV(u, v);
  if (key) {
    if (!e.shiftKey && !selected.has(key)) { selected = new Set(); selectedPts = new Map(); }
    selected.add(key);
    beginEdit();
    drag = { move: true, u, v };
  } else {
    if (!e.shiftKey) { selected = new Set(); selectedPts = new Map(); }
    drag = { box: true, x0: x, y0: y, x1: x, y1: y }; // drag on empty sheet: a frame selects every island it touches
  }
  refresh();
});
uvc.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const r = uvc.getBoundingClientRect(); const x = e.clientX - r.left; const y = e.clientY - r.top;
  if (drag.pan) { view.x = drag.vx + x - drag.x; view.y = drag.vy + y - drag.y; refresh(); return; }
  if (drag.paint) { paintAt2D(...toUV(x, y)); return; }
  if (drag.box) { drag.x1 = x; drag.y1 = y; refresh(); return; }
  const [u, v] = toUV(x, y); const du = u - drag.u; const dv = v - drag.v; drag.u = u; drag.v = v;
  forSelectedVerts((p, i) => { p.uvs[i * 2] += du; p.uvs[i * 2 + 1] += dv; });
  refresh(); update3DUVs();
});
uvc.addEventListener('pointerup', () => {
  if (drag?.paint) paintEnd();
  if (drag?.move) endEdit();
  if (drag?.box) boxSelect(drag);
  drag = null;
});
// frame selection on the sheet: islands (or points in point mode) with a point inside
function boxSelect(d) {
  const [ua, va] = toUV(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1)); const [ub, vb] = toUV(Math.max(d.x0, d.x1), Math.max(d.y0, d.y1));
  if (Math.abs(d.x1 - d.x0) < 3 && Math.abs(d.y1 - d.y0) < 3) { refresh(); return; }
  const pointMode = $('pick-mode').value === 'point';
  for (const mi of shown()) car.meshes[mi].parts.forEach((p, pi) => {
    if (p.positions.length / 3 <= 8) return; const U = p.uvs; const isl = car.meshes[mi].isl[pi];
    for (let i = 0; i < U.length / 2; i++) {
      if (U[i * 2] < ua || U[i * 2] > ub || U[i * 2 + 1] < va || U[i * 2 + 1] > vb) continue;
      if (pointMode) { const k = `${mi}|${pi}`; const set = selectedPts.get(k) || new Set(); set.add(i); selectedPts.set(k, set); } else selected.add(`${mi}|${pi}|${isl.vertIsl[i]}`);
    }
  });
  refresh();
  status(`เลือกแล้ว: ${selected.size} เกาะ${selectedPts.size ? ` · ${[...selectedPts.values()].reduce((n, x) => n + x.size, 0)} จุด` : ''} · ลากย้าย / G ย้าย · R หมุน · S ย่อขยาย (ตามเมาส์)`);
}
// the UV point nearest the mouse (within 8 px), with every point at the same place (welded in UV)
function pickPoint(u, v) {
  const [qx, qy] = toPx(u, v); let best = null; let bd = 8;
  for (const mi of shown()) car.meshes[mi].parts.forEach((p, pi) => {
    if (p.positions.length / 3 <= 8) return; const U = p.uvs;
    for (let i = 0; i < U.length / 2; i++) { const [x, y] = toPx(U[i * 2], U[i * 2 + 1]); const d = Math.hypot(x - qx, y - qy); if (d < bd) { bd = d; best = { mi, pi, i }; } }
  });
  if (!best) return null;
  const p = car.meshes[best.mi].parts[best.pi]; const U = p.uvs; const ids = [];
  for (let i = 0; i < U.length / 2; i++) if (Math.abs(U[i * 2] - U[best.i * 2]) < 1e-7 && Math.abs(U[i * 2 + 1] - U[best.i * 2 + 1]) < 1e-7) ids.push(i);
  return { mi: best.mi, pi: best.pi, ids };
}
// G / R / S with the mouse (Blender-like): move, turn by any angle, scale; click or Enter confirms, Esc / right click cancels
let modal = null; let lastMouse = [0.5, 0.5];
uvc.addEventListener('pointermove', (e) => {
  const r = uvc.getBoundingClientRect(); lastMouse = toUV(e.clientX - r.left, e.clientY - r.top);
  if (!modal) return;
  const [u, v] = lastMouse; const { cu, cv } = modal;
  const a0 = Math.atan2(modal.v0 - cv, modal.u0 - cu); const a1 = Math.atan2(v - cv, u - cu);
  const d0 = Math.hypot(modal.u0 - cu, modal.v0 - cv) || 1e-6; const d1 = Math.hypot(u - cu, v - cv);
  let ang = a1 - a0; if (e.ctrlKey) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12); // Ctrl: 15° steps
  const sc = d1 / d0; const ca = Math.cos(ang); const sa = Math.sin(ang);
  let k = 0;
  forSelectedVerts((p, i) => {
    const bu = modal.base[k * 2]; const bv = modal.base[k * 2 + 1]; k++;
    let nu = bu; let nv = bv;
    if (modal.type === 'G') { nu = bu + (u - modal.u0); nv = bv + (v - modal.v0); if (e.shiftKey) { if (Math.abs(u - modal.u0) > Math.abs(v - modal.v0)) nv = bv; else nu = bu; } }
    else if (modal.type === 'R') { nu = cu + (bu - cu) * ca - (bv - cv) * sa; nv = cv + (bu - cu) * sa + (bv - cv) * ca; }
    else { nu = cu + (bu - cu) * sc; nv = cv + (bv - cv) * sc; }
    p.uvs[i * 2] = nu; p.uvs[i * 2 + 1] = nv;
  });
  status(modal.type === 'G' ? 'ย้าย (Shift = แนวตรง) · คลิก/Enter ยืนยัน · Esc ยกเลิก' : modal.type === 'R' ? `หมุน ${(ang * 180 / Math.PI).toFixed(1)}° (Ctrl = ทีละ 15°) · คลิก/Enter ยืนยัน · Esc ยกเลิก` : `ย่อ/ขยาย ×${sc.toFixed(2)} · คลิก/Enter ยืนยัน · Esc ยกเลิก`);
  refresh(); update3DUVs();
});
function modalStart(type) {
  if (!selected.size && !selectedPts.size) { status('เลือกเกาะหรือจุดก่อน แล้วกด G / R / S'); return; }
  beginEdit();
  const base = []; forSelectedVerts((p, i) => base.push(p.uvs[i * 2], p.uvs[i * 2 + 1]));
  const { cu, cv } = selBox();
  modal = { type, base, cu, cv, u0: lastMouse[0], v0: lastMouse[1] };
  if (type !== 'G' && Math.hypot(modal.u0 - cu, modal.v0 - cv) < 0.01) { modal.u0 = cu + 0.05; modal.v0 = cv; }
  status(`${type === 'G' ? 'ย้าย' : type === 'R' ? 'หมุน' : 'ย่อ/ขยาย'}: ขยับเมาส์ · คลิก/Enter ยืนยัน · Esc ยกเลิก`);
}
function modalEnd(ok) {
  if (!modal) return;
  if (!ok) { let k = 0; forSelectedVerts((p, i) => { p.uvs[i * 2] = modal.base[k * 2]; p.uvs[i * 2 + 1] = modal.base[k * 2 + 1]; k++; }); edit = null; undo.pop(); modal = null; refresh(); update3DUVs(); status('ยกเลิก'); return; }
  modal = null; endEdit(); status('เรียบร้อย · Ctrl+Z ย้อน');
}
uvc.addEventListener('contextmenu', () => { if (modal) modalEnd(false); });
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

// each object's material names its kind (glass / lamps), so a holder (8 points) can be modelled into in Blender
const KIND_MTL = ['paint', 'glass', 'headlight_lamp', 'brake_reverse_lamp', 'brake_lamp'];
function exportOBJ() {
  const lines = ['# RayCity car for Blender. Edit shape and UVs; keep each object (its name is its game part).', `mtllib ${car.name}.mtl`, `usemtl mask`];
  let vo = 1;
  car.meshes.forEach((m) => m.parts.forEach((p, pi) => {
    lines.push(`o ${m.rel.replace(/\//g, '__')}#${pi}`); lines.push(`usemtl ${KIND_MTL[p.flags[0]] || 'paint'}${p.positions.length / 3 <= 8 ? '_holder' : ''}`);
    for (let i = 0; i < p.positions.length / 3; i++) lines.push(`v ${p.positions[i * 3].toFixed(6)} ${p.positions[i * 3 + 2].toFixed(6)} ${(-p.positions[i * 3 + 1]).toFixed(6)}`);
    for (let i = 0; i < p.positions.length / 3; i++) lines.push(`vt ${p.uvs[i * 2].toFixed(6)} ${(1 - p.uvs[i * 2 + 1]).toFixed(6)}`);
    for (let t = 0; t < p.indices.length; t += 3) { const f = [0, 1, 2].map((k) => p.indices[t + k] + vo); lines.push(`f ${f.map((x) => `${x}/${x}`).join(' ')}`); }
    vo += p.positions.length / 3;
  }));
  return new TextEncoder().encode(lines.join('\n'));
}
async function importOBJ(text) {
  undo.push(comboSnap()); if (undo.length > 60) undo.shift(); redo.length = 0;
  const r = applyOBJ(car.meshes, text);
  for (const m of car.meshes) m.isl = m.parts.map(islandsOf);
  carMid = null; build3D(); refresh();
  status(r.parts ? `นำกลับจาก Blender แล้ว: ${r.parts} ชิ้น (${r.tris.toLocaleString()} สามเหลี่ยม) · รับทั้งรูปทรงและ UV${r.tooBig ? ` · ⚠ ${r.tooBig} ชิ้นจุดเกิน 65,535 ไม่ได้นำเข้า` : ''}${r.unknown.length ? ` · ⚠ ชื่อไม่ตรงชิ้นไหน: ${r.unknown.slice(0, 5).join(', ')}` : ''} · กด ⚡ ทำให้พร้อมใส่เกม ได้เลย`
    : `ไม่เจอชิ้นที่ชื่อตรงกัน: ชื่อ object ใน Blender ต้องเป็นแบบ body_2.0m#0 (ที่ส่งออกจากเว็บ) · เจอ: ${r.unknown.slice(0, 5).join(', ') || 'ไม่มี object'}`);
}

// ---------------------------------------------------------------------------------------------
// Save: every edited mesh, and the files that were copies of it (LODs, tuning variants)

// Lamps (headlight 2 / brake 3 / indicator 4) take their colour from their folder's own picture
// (list.xml tex, 128×128 over the part's UVs; Escarabajo: red lamps in escarabajo_rearlight). A folder whose
// picture is missing shows its lamps black: the picture is made (clear, the lamp colour in its spot's 4×4
// block), or the colour put into the one there.
const LAMP_RGB = { 2: [255, 250, 235, 255], 3: [210, 18, 18, 255], 4: [255, 150, 0, 255] };
// 💡 Lamps like Escarabajo's: a clicked panel goes into the lamp folder's paint (headlight at the front,
// rearlight at the back) and is coloured in that folder's picture (white / red / amber / black housing).
// The folder picture (128×128 like Escarabajo's) holds one cell per colour; ↩ puts a panel back into the
// bumper's paint (car colours).
const lamp = { mode: null, pics: new Map(), tex: new Map() };
let escPic = null; // Escarabajo's rearlight picture, UV order
const LAMP_PAINT = { head: [238, 238, 228, 255], tail: [205, 12, 12, 255], turn: [255, 140, 0, 255], trim: [14, 14, 14, 255] };
// one 16 × 16 px cell per colour in the folder picture's top row (u k/8 … (k+1)/8, v 0 … 1/8): a lamp panel's
// triangles point at the middle of their colour's cell, so every triangle is fully that colour at any size
const LAMP_CELL = { head: 0, tail: 1, turn: 2, trim: 3 };
// Part pictures are read straight (row = v · height): a lamp lights up in the colour of the picture under its
// UVs (on Escarabajo's brake patch it lit white — that patch is its reverse-light art).
const flipRows = (q) => q; // (in-game test 2026-10-15: lamps lit white from Escarabajo's reverse-light art = pictures are read straight; kept as a no-op hook)
// Escarabajo's rearlight picture (escarabajo_rearlight_base): solid red lamp and black housing texels (UV order)
const ESC_CELL = { head: [0.191, 0.535], tail: [0.191, 0.535], turn: [0.191, 0.535], trim: [0.113, 0.391] };
// Escarabajo's solid red lamp art: the lamps light up red there
const ESC_RED_LAMP = [0.14, 0.497, 0.235, 0.534];
const cellUV = (k, dir) => (dir && lamp.pics.get(dir) && lamp.pics.get(dir).esc ? ESC_CELL[k] : [(LAMP_CELL[k] + 0.5) / 8, 0.5 / 8]);
function paintCells(q) { for (const [k, i] of Object.entries(LAMP_CELL)) for (let y = 0; y < Math.ceil(q.h / 8); y++) for (let x = Math.floor((i * q.w) / 8); x < Math.ceil(((i + 1) * q.w) / 8); x++) q.data.set(LAMP_PAINT[k], (y * q.w + x) * 4); }
// triangles tris of p get colour k: own points (so neighbours of another colour keep theirs) on the cell
function colourTris(p, tris, k, dir) {
  const [cu, cv] = cellUV(k, dir); const n0 = p.positions.length / 3;
  const P = new Float32Array((n0 + tris.length * 3) * 3); P.set(p.positions); const N = new Float32Array(P.length); N.set(p.normals); const U = new Float32Array((n0 + tris.length * 3) * 2); U.set(p.uvs);
  const I = Uint32Array.from(p.indices); let n = n0;
  for (const t of tris) for (let j = 0; j < 3; j++) { const i = I[t * 3 + j]; P.set(p.positions.subarray(i * 3, i * 3 + 3), n * 3); N.set(p.normals.subarray(i * 3, i * 3 + 3), n * 3); U[n * 2] = cu; U[n * 2 + 1] = cv; I[t * 3 + j] = n; n++; }
  // points nobody uses any more dropped
  const used = new Int32Array(n).fill(-1); let m = 0; for (const i of I) if (used[i] < 0) used[i] = m++;
  const P2 = new Float32Array(m * 3); const N2 = new Float32Array(m * 3); const U2 = new Float32Array(m * 2);
  for (let i = 0; i < n; i++) if (used[i] >= 0) { P2.set(P.subarray(i * 3, i * 3 + 3), used[i] * 3); N2.set(N.subarray(i * 3, i * 3 + 3), used[i] * 3); U2.set(U.subarray(i * 2, i * 2 + 2), used[i] * 2); }
  Object.assign(p, { positions: P2, normals: N2, uvs: U2, indices: Uint32Array.from(I, (i) => used[i]) }); p._adj = null; p._sg = 0;
}
const lampFolder = (rel) => { const d = rel.includes('/') ? rel.split('/')[0] : ''; return d === 'headlight' || d === 'rearlight' ? d : null; };
function lampPic(dir) {
  if (!lamp.pics.has(dir)) lamp.pics.set(dir, { w: 128, h: 128, data: new Uint8ClampedArray(128 * 128 * 4) });
  const q = lamp.pics.get(dir); if (!q.esc) paintCells(q);
  if (!lamp.tex.has(dir)) { const cv = document.createElement('canvas'); cv.width = q.w; cv.height = q.h; const t = new THREE.CanvasTexture(cv); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; lamp.tex.set(dir, t); }
  return q;
}
function lampPicShow(dir) { const q = lamp.pics.get(dir); const t = lamp.tex.get(dir); if (!q || !t) return; const g = t.image.getContext('2d'); const img = new ImageData(new Uint8ClampedArray(q.data), q.w, q.h); for (let i = 3; i < img.data.length; i += 4) if (!img.data[i]) { img.data[i - 3] = 140; img.data[i - 2] = 140; img.data[i - 1] = 140; img.data[i] = 255; } g.putImageData(img, 0, 0); t.needsUpdate = true; }
async function loadLampPics() {
  lamp.pics = new Map(); lamp.tex = new Map(); lamp.mode = null;
  document.querySelectorAll('#lamp-modes button').forEach((b) => b.classList.remove('accent'));
  for (const dir of ['headlight', 'rearlight']) {
    const list = car.files.has(`${dir}/list.xml`) ? decodeSpec(car.files.get(`${dir}/list.xml`)) : '';
    const tex = (list.match(/mesh='default'[^>]*tex='([^']*)'/) || [])[1];
    const b = tex && car.files.get(`${dir}/${tex}.png`); if (!b) continue;
    try {
      const q = flipRows(await decodePNG(b)); const at = (u, v) => q.data.subarray((Math.floor(v * q.h) * q.w + Math.floor(u * q.w)) * 4, (Math.floor(v * q.h) * q.w + Math.floor(u * q.w)) * 4 + 4);
      const cell = at(...[(LAMP_CELL.tail + 0.5) / 8, 0.5 / 8]); const ours = cell[0] === LAMP_PAINT.tail[0] && cell[1] === LAMP_PAINT.tail[1] && cell[3] === 255;
      const r = at(...ESC_CELL.tail); const esc = !ours && r[0] > 180 && r[1] < 80 && r[3] > 200;
      lamp.pics.set(dir, { w: q.w, h: q.h, data: new Uint8ClampedArray(q.data), esc }); lampPic(dir); lampPicShow(dir);
    } catch { /* unreadable */ }
  }
}
function rasterUV(q, U, a, b, c, col) {
  const { w, h, data } = q; const P = [a, b, c].map((i) => [U[i * 2] * w, U[i * 2 + 1] * h]);
  const area = (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (P[1][1] - P[0][1]);
  const x0 = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0])) - 1); const x1 = Math.min(w - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])) + 1);
  const y0 = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1])) - 1); const y1 = Math.min(h - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])) + 1);
  if (Math.abs(area) < 1e-9) { data.set(col, (Math.min(h - 1, Math.max(0, Math.floor(P[0][1]))) * w + Math.min(w - 1, Math.max(0, Math.floor(P[0][0])))) * 4); return; }
  const grow = 1 / Math.sqrt(Math.abs(area));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const cx = x + 0.5; const cy = y + 0.5;
    const b0 = ((P[1][0] - cx) * (P[2][1] - cy) - (P[2][0] - cx) * (P[1][1] - cy)) / area; const b1 = ((P[2][0] - cx) * (P[0][1] - cy) - (P[0][0] - cx) * (P[2][1] - cy)) / area;
    if (b0 >= -grow && b1 >= -grow && 1 - b0 - b1 >= -grow) data.set(col, (y * w + x) * 4);
  }
}
// move triangles tris (indices of p's triangles) into part dst; returns their new triangle numbers in dst
function moveTris(p, tris, dst) {
  const set = new Set(tris); const I = p.indices; const keep = []; const take = [];
  for (let t = 0; t < I.length / 3; t++) (set.has(t) ? take : keep).push(t);
  const base = dst.positions.length / 3; const map = new Map(); const P = [...dst.positions]; const N = [...dst.normals]; const U = [...dst.uvs]; const ni = [...dst.indices];
  const out = [];
  for (const t of take) { out.push(ni.length / 3); for (let k = 0; k < 3; k++) { const i = I[t * 3 + k]; if (!map.has(i)) { map.set(i, base + map.size); P.push(...p.positions.subarray(i * 3, i * 3 + 3)); N.push(...p.normals.subarray(i * 3, i * 3 + 3)); U.push(...p.uvs.subarray(i * 2, i * 2 + 2)); } ni.push(map.get(i)); } }
  Object.assign(dst, { positions: Float32Array.from(P), normals: Float32Array.from(N), uvs: Float32Array.from(U), indices: Uint32Array.from(ni) }); dst._adj = null; dst._sg = 0;
  // what stays in p (a squashed triangle if nothing)
  if (!keep.length) { const a = I[0]; const one = (A, n) => Float32Array.from([...A.subarray(a * n, a * n + n), ...A.subarray(a * n, a * n + n), ...A.subarray(a * n, a * n + n)]); Object.assign(p, { positions: one(p.positions, 3), normals: one(p.normals, 3), uvs: one(p.uvs, 2), indices: Uint32Array.from([0, 1, 2]) }); }
  else { const rm = new Int32Array(p.positions.length / 3).fill(-1); let n = 0; const kI = []; for (const t of keep) for (let k = 0; k < 3; k++) { const i = I[t * 3 + k]; if (rm[i] < 0) rm[i] = n++; kI.push(rm[i]); }
    const P2 = new Float32Array(n * 3); const N2 = new Float32Array(n * 3); const U2 = new Float32Array(n * 2);
    for (let i = 0; i < rm.length; i++) if (rm[i] >= 0) { P2.set(p.positions.subarray(i * 3, i * 3 + 3), rm[i] * 3); N2.set(p.normals.subarray(i * 3, i * 3 + 3), rm[i] * 3); U2.set(p.uvs.subarray(i * 2, i * 2 + 2), rm[i] * 2); }
    Object.assign(p, { positions: P2, normals: N2, uvs: U2, indices: Uint32Array.from(kI) }); }
  p._adj = null; p._sg = 0;
  return out;
}
const paintPartOf = (rel, holderOk) => { const m = car.meshes.find((x) => x.rel === rel); const p = m && m.parts.filter((q) => q.flags[0] === 0 && (holderOk || q.positions.length / 3 > 8)).sort((a, b) => b.positions.length - a.positions.length)[0]; return p ? { m, p } : null; };
function lampClick(e) {
  const hit = hitAt(e); if (!hit) return;
  const { mi, pi } = hit.object.userData; const m = car.meshes[mi]; const p = m.parts[pi];
  if (LAMP_RGB[p.flags[0]] && LAMP_PAINT[lamp.mode] && lampFolder(m.rel)) { // a lamp itself: its colour spot in the folder picture
    const q = lampPic(lampFolder(m.rel)); const U = p.uvs; for (let t = 0; t < p.indices.length; t += 3) rasterUV(q, U, p.indices[t], p.indices[t + 1], p.indices[t + 2], LAMP_PAINT[lamp.mode]);
    lampPicShow(lampFolder(m.rel)); build3D(); status('ใส่สีให้ดวงไฟแล้ว (จุดสีของดวงไฟในรูปของโฟลเดอร์)'); return;
  }
  if (p.flags[0] !== 0) { status('คลิกโดนกระจก: คลิกแผงสีแทน'); return; }
  const tris = panelOf(p, hit.faceIndex, m.isl[pi].vertIsl);
  const P = p.positions; const I = p.indices; const t0 = hit.faceIndex;
  const front = (P[I[t0 * 3] * 3 + 1] + P[I[t0 * 3 + 1] * 3 + 1] + P[I[t0 * 3 + 2] * 3 + 1]) / 3 < 0; // y < 0: front half
  undo.push(comboSnap()); if (undo.length > 60) undo.shift(); redo.length = 0;
  const from = lampFolder(m.rel);
  if (lamp.mode === 'paint') {
    if (!from) { status('แผงนี้เป็นสีรถอยู่แล้ว'); return; }
    const to = paintPartOf(front ? 'frontbumper/default_2.0m' : 'rearbumper/default_2.0m') || paintPartOf('body_2.0m');
    moveTris(p, tris, to.p); m.dirty = true; to.m.dirty = true;
    status(`คืน ${tris.length} สามเหลี่ยม เป็นสีรถ (${to.m.rel.split('/')[0]})`);
  } else {
    const dir = lamp.mode === 'head' ? 'headlight' : lamp.mode === 'tail' ? 'rearlight' : front ? 'headlight' : 'rearlight';
    let tp = p; let tt = tris;
    if (from !== dir) {
      const to = paintPartOf(`${dir}/default_2.0m`, true);
      if (!to) { status(`ไม่มีไฟล์ ${dir}/default_2.0m ในรถคันนี้`); return; }
      tt = moveTris(p, tris, to.p); tp = to.p; m.dirty = true; to.m.dirty = true;
    }
    lampPic(dir); colourTris(tp, tt, lamp.mode, dir); lampPicShow(dir);
    status(`${{ head: 'ไฟหน้า', tail: 'ไฟท้าย', turn: 'ไฟเลี้ยว', trim: 'กรอบไฟ' }[lamp.mode]}: ${tris.length} สามเหลี่ยม → ${dir} (รูปของโฟลเดอร์) · คลิกแผงต่อได้`);
  }
  for (const x of car.meshes) x.isl = x.parts.map(islandsOf);
  build3D(); refresh();
}
// 🔴 Tail lamps by themselves: every paint triangle facing back within 1.5 cm (across) / 6 cm (deep) of a
// brake / indicator lamp facing back goes into rearlight's paint, red / amber in its picture; the rest of rearlight's paint
// (the tail panel) black like a housing.
function tailAuto() {
  const rl = car.meshes.find((m) => m.rel === 'rearlight/default_2.0m'); if (!rl) { status('ไม่มี rearlight/default_2.0m'); return; }
  // a car whose lamps are only holders (made from a model whose lamp glass was not found): the rearlight
  // panel itself becomes the lamps — a copy 3 mm out along its normals, kind 3 (reverse) on its inner third,
  // kind 4 (brake) on the rest; the panel stays as the housing
  { const k3 = rl.parts.find((x) => x.flags[0] === 3); const k4 = rl.parts.find((x) => x.flags[0] === 4); const pan = rl.parts.filter((x) => x.flags[0] === 0 && x.positions.length / 3 > 8).sort((a, b) => b.positions.length - a.positions.length)[0];
    let pcy = 0; if (pan) { for (let i = 1; i < pan.positions.length; i += 3) pcy += pan.positions[i]; pcy /= pan.positions.length / 3; }
    if (pan && pcy < 0) status('⚠ แผงไฟท้ายอยู่ครึ่งหน้ารถ (รถเพิ่งกลับด้าน?) · ไม่ได้สร้างไฟจากแผงนี้');
    else if (k3 && k4 && pan && rl.parts.every((x) => (x.flags[0] !== 3 && x.flags[0] !== 4) || x.positions.length / 3 <= 8)) {
      const P = pan.positions; const N = pan.normals; const I = pan.indices; const sg = outwardSign(pan); let xm = 0; let xn = Infinity; for (let i = 0; i < P.length; i += 3) { xm = Math.max(xm, Math.abs(P[i])); xn = Math.min(xn, Math.abs(P[i])); } const xcut = xn + (xm - xn) * 0.35; // (inner 35 % of each side's span)
      const make = (inner) => { const map = new Map(); const Pp = []; const Nn = []; const Uu = []; const Ii = [];
        for (let t = 0; t < I.length; t += 3) { const cx = (P[I[t] * 3] + P[I[t + 1] * 3] + P[I[t + 2] * 3]) / 3; if ((Math.abs(cx) < xcut) !== inner) continue;
          for (let k = 0; k < 3; k++) { const i = I[t + k]; if (!map.has(i)) { map.set(i, map.size); for (let c = 0; c < 3; c++) Pp.push(P[i * 3 + c] + sg * N[i * 3 + c] * 0.003); Nn.push(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]); Uu.push(0, 0); } Ii.push(map.get(i)); } }
        return { positions: Float32Array.from(Pp), normals: Float32Array.from(Nn), uvs: Float32Array.from(Uu), indices: Uint32Array.from(Ii), _sg: 0 }; };
      const rev = make(true); const brk = make(false);
      if (rev.indices.length && brk.indices.length) {
        Object.assign(k3, rev); Object.assign(k4, brk);
        for (const x of rl.parts) if (x !== k3 && x !== k4 && (x.flags[0] === 3 || x.flags[0] === 4)) { const a = x.positions.slice(0, 3); Object.assign(x, { positions: Float32Array.from([...a, ...a, ...a]), normals: Float32Array.from([0, 1, 0, 0, 1, 0, 0, 1, 0]), uvs: new Float32Array(6), indices: Uint32Array.from([0, 1, 2]) }); }
        rl.dirty = true;
      }
    } }
  const lenses = [];
  for (const p of rl.parts) { const k = p.flags[0]; if (k !== 3 && k !== 4) continue; const P = p.positions; const I = p.indices;
    // each lamp piece in its connected bits (by position)
    const key = (i) => `${Math.round(P[i * 3] * 1000)},${Math.round(P[i * 3 + 1] * 1000)},${Math.round(P[i * 3 + 2] * 1000)}`;
    const par = new Map(); const find = (a) => { while (par.get(a) !== a) { par.set(a, par.get(par.get(a))); a = par.get(a); } return a; };
    for (let i = 0; i < P.length / 3; i++) if (!par.has(key(i))) par.set(key(i), key(i));
    for (let t = 0; t < I.length; t += 3) { const a = find(key(I[t])); par.set(a, find(key(I[t + 1]))); par.set(find(key(I[t + 2])), find(key(I[t + 1]))); }
    const box = new Map();
    const sg = outwardSign(p);
    for (let i = 0; i < P.length / 3; i++) { const r = find(key(i)); if (!box.has(r)) box.set(r, { mn: [9, 9, 9], mx: [-9, -9, -9], k, ny: 0, n: 0 }); const e = box.get(r); for (let c = 0; c < 3; c++) { e.mn[c] = Math.min(e.mn[c], P[i * 3 + c]); e.mx[c] = Math.max(e.mx[c], P[i * 3 + c]); } e.ny += sg * p.normals[i * 3 + 1]; e.n++; }
    // lamps facing back only (side markers keep their own colour spot)
    for (const e of box.values()) if (e.mx[0] - e.mn[0] + e.mx[2] - e.mn[2] > 0.02 && e.ny / e.n > 0.5) lenses.push(e);
  }
  if (!lenses.length && !rl.parts.some((x) => (x.flags[0] === 3 || x.flags[0] === 4) && x.positions.length / 3 > 8)) { status('rearlight ไม่มีดวงไฟ (ไฟเบรก/ไฟเลี้ยว) และไม่มีแผงไฟให้ใช้แทน'); return; } // (lamps not facing back, e.g. made from the panel: no red surround, the panel stays a black housing)
  undo.push(comboSnap()); if (undo.length > 60) undo.shift(); redo.length = 0;
  const near = (c) => lenses.find((e) => c[0] > e.mn[0] - 0.015 && c[0] < e.mx[0] + 0.015 && c[2] > e.mn[2] - 0.015 && c[2] < e.mx[2] + 0.015 && c[1] > e.mn[1] - 0.06 && c[1] < e.mx[1] + 0.06);
  const dst = paintPartOf('rearlight/default_2.0m', true); let red = 0;
  // bumper / body paint near the lamps joins rearlight
  for (const m of car.meshes) { if (lampFolder(m.rel)) continue; for (const p of m.parts) {
    if (p.flags[0] !== 0 || p.positions.length / 3 <= 8) continue; const P = p.positions; const I = p.indices; const N = p.normals; const take = [];
    for (let t = 0; t < I.length / 3; t++) { const c = [0, 1, 2].map((k) => (P[I[t * 3] * 3 + k] + P[I[t * 3 + 1] * 3 + k] + P[I[t * 3 + 2] * 3 + k]) / 3); const ny = N[I[t * 3] * 3 + 1] * outwardSign(p); if (ny > 0.3 && near(c)) take.push(t); }
    if (take.length) { moveTris(p, take, dst.p); m.dirty = true; dst.m.dirty = true; }
  } }
  // the picture: Escarabajo's own rearlight picture (its lamps light up in the game), from the built-in template
  if (!(lamp.pics.get('rearlight') || {}).esc && escPic) lamp.pics.set('rearlight', { ...escPic, data: new Uint8ClampedArray(escPic.data), esc: true });
  const q = lampPic('rearlight'); const p = dst.p; const P = p.positions; const I = p.indices; const by = { tail: [], turn: [], trim: [] };
  for (let t = 0; t < I.length / 3; t++) {
    const c = [0, 1, 2].map((k) => (P[I[t * 3] * 3 + k] + P[I[t * 3 + 1] * 3 + k] + P[I[t * 3 + 2] * 3 + k]) / 3); const e = near(c);
    by[e ? (e.k === 4 ? 'turn' : 'tail') : 'trim'].push(t);
  }
  red = by.tail.length + by.turn.length; const nTris = I.length / 3;
  for (const k of ['tail', 'turn', 'trim']) if (by[k].length) colourTris(p, by[k], k, 'rearlight');
  // the lamps themselves: each lamp (connected bit) spread over Escarabajo's own brake / indicator patch, as
  // Escarabajo's lamps are (packs 73-76 lit red braking, white reversing; on solid red art they lit white)
  // Two lights: kind 3 lights white reversing, kind 4 red braking. A car whose kind 4 is only a holder (canyon)
  // gets its kind 3 lamps split: the innermost lamp each side stays kind 3 (reverse), the others and the side
  // markers become kind 4 (brake). (Both over the same place: the one in front hides the other — pack 79
  // braked red but lost the reverse light.)
  { const k3 = rl.parts.find((x) => x.flags[0] === 3 && x.positions.length / 3 > 8); const k4 = rl.parts.find((x) => x.flags[0] === 4);
    if (k3 && k4 && k4.positions.length / 3 <= 8) {
      const P = k3.positions; const N = k3.normals; const I = k3.indices; const nv = P.length / 3; const sg = outwardSign(k3);
      const par = new Int32Array(nv).map((_, i) => i); const find = (a2) => { while (par[a2] !== a2) { par[a2] = par[par[a2]]; a2 = par[a2]; } return a2; };
      for (let t = 0; t < I.length; t += 3) { par[find(I[t])] = find(I[t + 1]); par[find(I[t + 2])] = find(I[t + 1]); }
      const bits = new Map(); for (let i = 0; i < nv; i++) { const r = find(i); if (!bits.has(r)) bits.set(r, { cx: 0, ny: 0, n: 0 }); const e = bits.get(r); e.cx += P[i * 3]; e.ny += sg * N[i * 3 + 1]; e.n++; }
      const rev = new Set(); for (const side of [1, -1]) { let best = null; for (const [r, e] of bits) if (e.ny / e.n > 0.5 && side * e.cx > 0 && (!best || Math.abs(e.cx) < Math.abs(best[1].cx))) best = [r, e]; if (best) rev.add(best[0]); }
      const take = (want) => { const map = new Map(); const Pp = []; const Nn = []; const Uu = []; const Ii = [];
        for (let t = 0; t < I.length; t += 3) { if (rev.has(find(I[t])) !== want) continue; for (let k = 0; k < 3; k++) { const i = I[t + k]; if (!map.has(i)) { map.set(i, map.size); Pp.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); Nn.push(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]); Uu.push(k3.uvs[i * 2], k3.uvs[i * 2 + 1]); } Ii.push(map.get(i)); } }
        return { positions: Float32Array.from(Pp), normals: Float32Array.from(Nn), uvs: Float32Array.from(Uu), indices: Uint32Array.from(Ii), _sg: 0 }; };
      if (rev.size && rev.size < bits.size) { Object.assign(k4, take(false)); Object.assign(k3, take(true)); rl.dirty = true; }
    } }
  for (const l of rl.parts) {
    if (l.flags[0] !== 3 && l.flags[0] !== 4) continue; const R = l.flags[0] === 3 ? [0.272, 0.846, 0.373, 0.896] : [0.386, 0.858, 0.422, 0.894]; // Escarabajo's own lamp patches (in game: red when braking, white when reversing; lamps on solid red art lit white)
    const L = l.positions; const LI = l.indices; const nv = L.length / 3; const par = new Int32Array(nv).map((_, i) => i);
    const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
    for (let t = 0; t < LI.length; t += 3) { par[find(LI[t])] = find(LI[t + 1]); par[find(LI[t + 2])] = find(LI[t + 1]); }
    const bx = new Map(); for (let i = 0; i < nv; i++) { const r = find(i); if (!bx.has(r)) bx.set(r, [Infinity, -Infinity, Infinity, -Infinity]); const e = bx.get(r); e[0] = Math.min(e[0], L[i * 3]); e[1] = Math.max(e[1], L[i * 3]); e[2] = Math.min(e[2], L[i * 3 + 2]); e[3] = Math.max(e[3], L[i * 3 + 2]); }
    const U = new Float32Array(l.uvs.length);
    for (let i = 0; i < nv; i++) { const e = bx.get(find(i)); U[i * 2] = R[0] + (R[2] - R[0]) * ((e[1] - L[i * 3]) / ((e[1] - e[0]) || 1)); U[i * 2 + 1] = R[1] + (R[3] - R[1]) * ((e[3] - L[i * 3 + 2]) / ((e[3] - e[2]) || 1)); }
    l.uvs = U; rl.dirty = true;
  }
  // (no backing behind the lamps: with one, pack 75 lit white when braking; packs 73 / 74 without it lit red)
  lampPicShow('rearlight');
  for (const x of car.meshes) x.isl = x.parts.map(islandsOf);
  build3D(); refresh();
  status(`ไฟท้ายอัตโนมัติ: ดวงไฟ ${lenses.length} ดวง · แดง/ส้ม ${red} สามเหลี่ยม · แผงท้ายที่เหลือดำ (${nTris - red}) · ปรับต่อได้ด้วยปุ่มสีไฟ`);
}
$('btn-tail-auto').addEventListener('click', tailAuto);
document.querySelectorAll('#lamp-modes button').forEach((b) => b.addEventListener('click', () => {
  lamp.mode = lamp.mode === b.dataset.lamp ? null : b.dataset.lamp;
  document.querySelectorAll('#lamp-modes button').forEach((x) => x.classList.toggle('accent', x.dataset.lamp === lamp.mode));
  if (lamp.mode && paint.on) setPaint(false);
  status(lamp.mode ? 'คลิกแผงบนรถเพื่อทำเป็นไฟ (กดปุ่มเดิมอีกครั้งเพื่อเลิก)' : 'เลิกทำไฟ');
}));
async function lampPictures(out) {
  let n = 0;
  const dirs = new Set([...lamp.pics.keys()]);
  for (const m of car.meshes) { const dir = m.rel.includes('/') ? m.rel.split('/')[0] : ''; if (dir && m.parts.some((p) => LAMP_RGB[p.flags[0]])) dirs.add(dir); }
  for (const dir of dirs) {
    const spots = new Map();
    for (const m of car.meshes) if (m.rel.startsWith(`${dir}/`)) for (const p of m.parts) { const c = LAMP_RGB[p.flags[0]]; const U = p.uvs; if (c && U.length && U.every((x, i) => x === U[i & 1])) spots.set(`${U[0]},${U[1]}`, [U[0], U[1], c]); }
    if ((lamp.pics.get(dir) || {}).esc) spots.clear(); // (Escarabajo's picture: its lamp patches stay as they are)
    if (!spots.size && !lamp.pics.has(dir)) continue;
    const list = car.files.has(`${dir}/list.xml`) ? decodeSpec(car.files.get(`${dir}/list.xml`)) : '';
    const names = [...list.matchAll(/tex='([^']+)'/g)].map((x) => x[1]); // every variant's picture (a missing one borrows another folder's)
    for (const tex of new Set(names)) {
      let pic = { w: 128, h: 128, data: new Uint8ClampedArray(128 * 128 * 4) };
      const had = out.get(`${dir}/${tex}.png`);
      if (lamp.pics.has(dir)) { const q = lamp.pics.get(dir); pic = { w: q.w, h: q.h, data: new Uint8ClampedArray(q.data) }; } // the page's (painted) picture
      else if (had) { try { pic = flipRows(await decodePNG(had)); } catch { /* unreadable: a new one */ } }
      const { w, h, data } = pic;
      for (const [u, v, c] of spots.values()) {
        const bx = Math.floor(Math.min(w - 1, u * w) / 4) * 4; const by = Math.floor(Math.min(h - 1, v * h) / 4) * 4;
        for (let y = by; y < by + 4 && y < h; y++) for (let x = bx; x < bx + 4 && x < w; x++) data.set(c, (y * w + x) * 4);
      }
      const fl = flipRows({ w, h, data }).data; // (upside down in the file, as the game reads it)
      out.set(`${dir}/${tex}.png`, await png(fl, w, h));
      out.set(`${dir}/${tex}_s.dds`, dds(fl, w, h, 'full')); // (as gtv98's, which canyon's folders come from: full size, no mipmaps)
      n++;
    }
  }
  // every picture a folder's list.xml names must be there: a missing one makes the game draw that folder with
  // another folder's picture (the rearlight's red showed on the front bumper / grill / boot lid): clear ones
  const clear = new Uint8ClampedArray(128 * 128 * 4);
  for (const [rel, b] of car.files) {
    const mm = rel.match(/^([^/]+)\/list\.xml$/); if (!mm) continue;
    for (const [, tex] of decodeSpec(b).matchAll(/tex='([^']+)'/g)) {
      if (out.has(`${mm[1]}/${tex}.png`)) continue;
      out.set(`${mm[1]}/${tex}.png`, await png(clear, 128, 128)); out.set(`${mm[1]}/${tex}_s.dds`, dds(clear, 128, 128, 'full')); n++;
    }
  }
  return n;
}
// 🧩 The paint of the lamp folders (rearlight / headlight default) is drawn with the folder's own picture in
// the game, not the car's colours (no picture: black): its triangles join the bumper's paint (rear / front, the
// body without one), so they take the 3 colours. The lamp folder keeps one squashed triangle in their place.
$('btn-lamp-panel').addEventListener('click', () => {
  if (!car.meshes.length) return;
  undo.push(comboSnap()); if (undo.length > 60) undo.shift(); redo.length = 0;
  let moved = 0; const where = [];
  for (const [lamp, bumper] of [['rearlight', 'rearbumper'], ['headlight', 'frontbumper']]) {
    const src = car.meshes.find((m) => m.rel === `${lamp}/default_2.0m`); if (!src) continue;
    const dstM = car.meshes.find((m) => m.rel === `${bumper}/default_2.0m` && m.parts.some((p) => p.flags[0] === 0 && p.positions.length / 3 > 8)) || car.meshes.find((m) => m.rel === 'body_2.0m');
    const dst = dstM && dstM.parts.filter((p) => p.flags[0] === 0 && p.positions.length / 3 > 8).sort((a, b) => b.positions.length - a.positions.length)[0];
    if (!dst) continue;
    for (const p of src.parts) {
      if (p.flags[0] !== 0 || p.positions.length / 3 <= 8 || p.indices.length <= 3) continue;
      const base = dst.positions.length / 3; const cat = (a, b, T) => { const r = new T(a.length + b.length); r.set(a); r.set(b, a.length); return r; };
      Object.assign(dst, { positions: cat(dst.positions, p.positions, Float32Array), normals: cat(dst.normals, p.normals, Float32Array), uvs: cat(dst.uvs, p.uvs, Float32Array), indices: cat(dst.indices, Uint32Array.from(p.indices, (i) => i + base), Uint32Array) });
      moved += p.indices.length / 3;
      // what stays: one triangle squashed onto the first point
      const a = p.indices[0];
      Object.assign(p, { positions: Float32Array.from([...p.positions.subarray(a * 3, a * 3 + 3), ...p.positions.subarray(a * 3, a * 3 + 3), ...p.positions.subarray(a * 3, a * 3 + 3)]), normals: Float32Array.from([...p.normals.subarray(a * 3, a * 3 + 3), ...p.normals.subarray(a * 3, a * 3 + 3), ...p.normals.subarray(a * 3, a * 3 + 3)]), uvs: Float32Array.from([...p.uvs.subarray(a * 2, a * 2 + 2), ...p.uvs.subarray(a * 2, a * 2 + 2), ...p.uvs.subarray(a * 2, a * 2 + 2)]), indices: Uint32Array.from([0, 1, 2]) });
      p._sg = 0; dst._sg = 0; src.dirty = true; dstM.dirty = true; where.push(`${lamp} → ${dstM.rel.split('/')[0].replace('_2.0m', '')}`);
    }
  }
  for (const m of car.meshes) m.isl = m.parts.map(islandsOf);
  build3D(); refresh();
  $('body-info').textContent = moved ? `ย้ายแผง ${moved.toLocaleString()} สามเหลี่ยม (${[...new Set(where)].join(', ')}) · รับสีรถแล้ว` : 'ไม่มีแผงสีในโฟลเดอร์ไฟให้ย้าย';
  status($('body-info').textContent);
});
$('ride-nose').addEventListener('input', () => { const v = +$('ride-nose').value; $('ride-nose-v').textContent = v ? `${v > 0 ? 'ลง' : 'ขึ้น'} ${Math.abs(v * 100).toFixed(1)} ซม.` : '0 ซม.'; });
$('btn-turn-car').addEventListener('click', () => { if (!car.meshes.length) return; undo.push(comboSnap()); if (undo.length > 60) undo.shift(); redo.length = 0; turnCar(car.meshes); carMid = null; for (const m of car.meshes) m.isl = m.parts.map(islandsOf); build3D(); refresh(); status('กลับหน้า-หลังรถแล้ว (หมุนครึ่งรอบ) · กด ⚡ ต่อได้เลย'); });
$('ride-shift').addEventListener('input', () => { const v = +$('ride-shift').value; $('ride-shift-v').textContent = v ? `${v < 0 ? 'ไปหน้า' : 'ไปหลัง'} ${Math.abs(v * 100).toFixed(1)} ซม.` : '0 ซม.'; });
$('ride-drop').addEventListener('input', () => { const v = +$('ride-drop').value; $('ride-drop-v').textContent = `${v >= 0 ? 'ลง' : 'ขึ้น'} ${Math.abs(v * 100).toFixed(1)} ซม.`; });
async function saveZip() {
  const out = new Map(car.files);
  let n = 0;
  for (const m of car.meshes) {
    if (!m.dirty) continue;
    const parts = m.parts.map((p) => ({ ...p, kind: p.flags[0] }));
    const bytes = writeOM(m.om, parts);
    const dir = (r) => (r.includes('/') ? r.split('/')[0] : '');
    const lodBase = m.rel.replace(/_2\.0m$/, ''); // (LOD 0 / 1 of the same mesh get it too, even when they differed)
    for (const [rel, b] of car.files) if ((dir(rel) === dir(m.rel) && b.length === m.orig.length && b.every((x, i) => x === m.orig[i])) || /_[01]\.0m$/.test(rel) && rel.replace(/_[01]\.0m$/, '') === lodBase) { out.set(rel, bytes); n++; }
  }
  // the headlight folder's own picture (🧩: Escarabajo's with the reflectors' silver), named in its list
  if (car.headlightPic && out.has('headlight/list.xml')) {
    const { w, h, data } = car.headlightPic; const tex = `${car.name}_headlight`;
    out.set(`headlight/${tex}.png`, await png(data, w, h)); out.set(`headlight/${tex}_s.dds`, dds(data, w, h, 'half'));
    out.set('headlight/list.xml', encodeSpec(decodeSpec(out.get('headlight/list.xml')).replace(/(name='(?:base|default)'[^>]*tex=')[^']*'/g, `$1${tex}'`)));
  }
  const lampN = await lampPictures(out);
  // a lamp folder whose list has a 'base' part (the game's default for Escarabajo-style folders): base = the
  // edited default mesh and its picture, so the car shows the same lamps whichever part the game picks
  for (const dir of ['rearlight', 'headlight']) {
    const lt = out.get(`${dir}/list.xml`); if (!lt || !out.has(`${dir}/base_2.0m`) || !out.has(`${dir}/default_2.0m`)) continue;
    const text = decodeSpec(lt); const tex = (text.match(/name='default'[^>]*tex='([^']*)'/) || [])[1];
    if (!car.meshes.some((m) => m.rel === `${dir}/default_2.0m` && m.dirty)) continue;
    for (const l of ['0', '1', '2']) if (out.has(`${dir}/default_${l}.0m`)) out.set(`${dir}/base_${l}.0m`, out.get(`${dir}/default_${l}.0m`));
    if (tex) out.set(`${dir}/list.xml`, encodeSpec(text.replace(/(name='base'[^>]*tex=')[^']*'/, `$1${tex}'`)));
  }
  // ride height / wheel arches: every mesh file moved down and along (the wheels stay where the game puts them)
  const drop = +$('ride-drop').value; const shift = +$('ride-shift').value; const nose = +$('ride-nose').value; let lowered = 0;
  // nose: down by `nose` at the front wheels, nothing at the rear wheels (the game's: y −1.23 / 1.15), straight between
  const YF = -1.23; const YR = 1.15;
  if (drop || shift || nose) for (const [rel, b] of out) {
    if (!/\.0m$/i.test(rel)) continue;
    try {
      const om = parseOM(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); const parts = omParts(om);
      for (const q of parts) { const P = Float32Array.from(q.positions); for (let i = 0; i < P.length; i += 3) { P[i + 2] -= drop + nose * ((YR - P[i + 1]) / (YR - YF)); P[i + 1] += shift; } q.positions = P; } // (y < 0 is the front: forward = minus)
      out.set(rel, writeOM(om, parts.map((q) => ({ ...q, kind: q.flags[0] })))); lowered++;
    } catch { /* not a mesh */ }
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
  $('save-log').textContent = `ดาวน์โหลด ${car.name}.zip แล้ว · เขียนใหม่ ${n} ไฟล์ .0m${paint.dirty ? ' · รูปสี (_base.png + _s.dds) ใหม่' : ''}${car.colorDirty ? ' · ชั้นลาย _color ใหม่' : ''}${lampN ? ` · รูปสีไฟ ${lampN} รูป` : ''}${lowered ? ` · ตัวรถ${drop ? ` ลง ${(drop * 100).toFixed(1)} ซม.` : ''}${shift ? ` ${shift < 0 ? 'ไปหน้า' : 'ไปหลัง'} ${Math.abs(shift * 100).toFixed(1)} ซม.` : ''}${nose ? ` หน้า${nose > 0 ? 'ลง' : 'ขึ้น'} ${Math.abs(nose * 100).toFixed(1)} ซม.` : ''} (${lowered} ไฟล์)` : ''}`;
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
// +1 when a piece's normals point away from the car's middle, −1 when into it (cached per piece)
let carMid = null;
function outwardSign(p) {
  if (p._sg) return p._sg;
  if (!carMid) {
    const mn = [Infinity, Infinity, Infinity]; const mx = [-Infinity, -Infinity, -Infinity];
    for (const m of car.meshes) for (const q of m.parts) if (q.positions.length / 3 > 8) for (let i = 0; i < q.positions.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], q.positions[i + k]); mx[k] = Math.max(mx[k], q.positions[i + k]); }
    carMid = [0, 1, 2].map((k) => (mn[k] + mx[k]) / 2);
  }
  let s = 0; const P = p.positions; const N = p.normals;
  for (let i = 0; i < P.length; i += 3) s += (P[i] - carMid[0]) * N[i] + (P[i + 1] - carMid[1]) * N[i + 1] + (P[i + 2] - carMid[2]) * N[i + 2];
  p._sg = s >= 0 ? 1 : -1; return p._sg;
}
// every paintable triangle: fn(mesh, part, t, centre[3], normal[3]) — glass left out
function eachTri(fn) {
  for (const mesh of carGroup.children) {
    if (!mesh.userData || mesh.userData.mi === undefined) continue;
    const p = car.meshes[mesh.userData.mi].parts[mesh.userData.pi]; if (p.flags[0] === 1) continue; const P = p.positions;
    for (let t = 0; t < p.indices.length; t += 3) {
      const [a, b, c] = [p.indices[t], p.indices[t + 1], p.indices[t + 2]];
      const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]]; const e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
      // facing: the files' own normals (the winding of game files can run either way), read reversed for a
      // piece whose normals point into the car
      const Nn = p.normals; const sg = outwardSign(p); let n = [sg * (Nn[a * 3] + Nn[b * 3] + Nn[c * 3]), sg * (Nn[a * 3 + 1] + Nn[b * 3 + 1] + Nn[c * 3 + 1]), sg * (Nn[a * 3 + 2] + Nn[b * 3 + 2] + Nn[c * 3 + 2])];
      if (!(Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2]) > 1e-9)) n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
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
// What the camera sees: the car's depth rendered once (glass, selection and guides left out), so a frame
// paints only surfaces in view, not the cabin or the far side behind them.
function depthView() {
  const W = gl.width; const H = gl.height;
  const rt = new THREE.WebGLRenderTarget(W, H);
  const hidden = carGroup.children.filter((o) => o.visible && (o.userData.mi === undefined || car.meshes[o.userData.mi].parts[o.userData.pi].flags[0] === 1));
  hidden.forEach((o) => { o.visible = false; });
  const grid = scene.children.filter((o) => o !== carGroup && o.visible && !o.isLight); grid.forEach((o) => { o.visible = false; });
  // view distance (0-100 m) in 24 bits of RGB
  scene.overrideMaterial = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    vertexShader: 'varying float vz; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vz = -mv.z; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'precision highp float; varying float vz; void main() { float v = floor(clamp(vz / 100.0, 0.0, 1.0) * 16777215.0); float r = floor(v / 65536.0); float g = floor((v - r * 65536.0) / 256.0); float b = v - r * 65536.0 - g * 256.0; gl_FragColor = vec4(r, g, b, 255.0) / 255.0; }',
  });
  const bg = scene.background; scene.background = null;
  renderer.setRenderTarget(rt); renderer.setClearColor(0xffffff, 1); renderer.clear(); renderer.render(scene, cam);
  const px = new Uint8Array(W * H * 4); renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
  renderer.setRenderTarget(null); scene.overrideMaterial = null; scene.background = bg;
  hidden.forEach((o) => { o.visible = true; }); grid.forEach((o) => { o.visible = true; });
  rt.dispose();
  return { W, H, at: (x, y) => { const o = ((H - 1 - y) * W + x) * 4; return ((px[o] * 65536 + px[o + 1] * 256 + px[o + 2]) / 16777215) * 100; } };
}
function trisInRect(x0, y0, x1, y1, fn) {
  const r = gl.getBoundingClientRect(); const v = new THREE.Vector3(); const nm = new THREE.Vector3(); const camDir = new THREE.Vector3();
  carGroup.updateMatrixWorld();
  const M = carGroup.matrixWorld; const N3 = new THREE.Matrix3().getNormalMatrix(M);
  const depth = paint.backfaces ? null : depthView();
  eachTri((mesh, p, t, c, n) => {
    v.set(c[0], c[1], c[2]).applyMatrix4(M); const vw = v.clone();
    if (!paint.backfaces) { nm.set(n[0], n[1], n[2]).applyMatrix3(N3); camDir.copy(v).sub(cam.position); if (nm.dot(camDir) > 0) return; }
    v.project(cam);
    const sx = (v.x + 1) / 2 * r.width; const sy = (1 - v.y) / 2 * r.height;
    if (!(sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1 && v.z < 1)) return;
    if (depth) {
      const dx = Math.min(depth.W - 1, Math.max(0, Math.floor((sx / r.width) * depth.W))); const dy = Math.min(depth.H - 1, Math.max(0, Math.floor((sy / r.height) * depth.H)));
      const seen = depth.at(dx, dy); const mine = -vw.applyMatrix4(cam.matrixWorldInverse).z;
      if (mine > seen + 0.03 + seen * 0.01) return; // behind what is in view
    }
    fn(mesh, p, t);
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
// ⬛ the floor and the wheel-arch liners (every face looking down, by the files' normals) black
$('btn-floor-black').addEventListener('click', () => {
  if (!car.mask) return;
  const keep = paint.slot; paint.slot = 0; paintStart(); let n = 0;
  let shared = 0;
  const all = []; eachTri((mesh, p, t, c, nrm) => all.push({ p, t, c, n: nrm }));
  const under = underTris(all); let ui = 0;
  eachTri((mesh, p, t) => {
    if (!under[ui++]) return;
    // a piece on one colour spot shares it with others: painting the spot would blacken them all
    const U = p.uvs; const [a, b, cc] = [p.indices[t * 3], p.indices[t * 3 + 1], p.indices[t * 3 + 2]];
    if (Math.abs((U[b * 2] - U[a * 2]) * (U[cc * 2 + 1] - U[a * 2 + 1]) - (U[cc * 2] - U[a * 2]) * (U[b * 2 + 1] - U[a * 2 + 1])) < 1e-9) { shared++; return; }
    fillT(p, t); n++;
  });
  paintEnd(); paint.slot = keep; paint.dirty = true; maskChanged();
  status(`พื้นรถ + ซุ้มล้อ เป็นดำแล้ว (${n.toLocaleString()} สามเหลี่ยม)${shared ? ` · ข้าม ${shared.toLocaleString()} ที่อยู่บนจุดสีร่วม (กด 📐 ก่อน แล้วค่อยกดปุ่มนี้)` : ''} · Ctrl+Z ย้อน`);
});
$('btn-paint-all').addEventListener('click', () => {
  if (!car.mask) return;
  paintStart(); let n = 0; eachTri((mesh, p, t) => { fillT(p, t); n++; });
  paintEnd(); paint.dirty = true; maskChanged(); said(n, 'ทาทั้งคัน');
});
setMode('panel');

// Opened from RayCity Easy (🖌 button): the car comes by message
// (or from the one-page RayCity, whose tab holds this page)
// ⚡ Everything for the game in one go (a car straight from Blender / the Easy page): decal sheet + glass
// (🎯), plates (🔖), tail lamps (🔴), then the download
async function readyForGame() {
  if (!car.meshes.length) { status('เปิดรถก่อน'); return; }
  status('⚡ กำลังทำให้พร้อมใส่เกม… (ย้าย UV ลงแผ่นลาย · กระจก · ป้าย · ไฟท้าย)'); await new Promise((r) => setTimeout(r, 30));
  const steps = [];
  // wheel arches onto the game's wheels (front y −1.23, rear 1.15): the car moved along, if a little off
  { const a = measureArches(car.meshes); if (a) { const dy = ((-1.23 - a.front) + (1.15 - a.rear)) / 2; if (Math.abs(dy) > 0.01 && Math.abs(dy) < 0.3) { for (const m of car.meshes) { for (const p of m.parts) for (let i = 1; i < p.positions.length; i += 3) p.positions[i] += dy; m.dirty = true; } steps.push(`🛞 ซุ้มล้อตรงล้อเกม (เลื่อน ${(dy * 100).toFixed(1)} ซม.)`); } } }
  // no glass in the model (its glass part only a holder): glass made over the open windows
  { const bm = car.meshes.find((m) => m.rel === 'body_2.0m'); const gp = bm && bm.parts.find((p) => p.flags[0] === 1);
    if (gp && gp.positions.length / 3 <= 8 && !car.meshes.some((m) => m.parts.some((p) => p.flags[0] === 1 && p.positions.length / 3 > 8))) { const g = glassShell(car.meshes); if (g.cells) { Object.assign(gp, { positions: g.positions, normals: g.normals, uvs: new Float32Array(g.positions.length / 3 * 2), indices: g.indices }); delete gp._sg; bm.dirty = true; steps.push(`🪟 สร้างกระจกให้ (${g.cells} ช่อง)`); } } }
  // files over the game's point limit (they crash the game) reduced first, unless the server's client has the
  // limit lifted (the box under ⚡); a .0m part still holds at most 65,535 points
  const cut = []; if (!$('no-cap').checked) for (const m of car.meshes) { const [a, b] = await capFileVerts(m.parts, VERT_CAP); if (b < a) { m.dirty = true; m.isl = m.parts.map(islandsOf); cut.push(`${m.rel.replace('_2.0m', '')} ${a.toLocaleString()}→${b.toLocaleString()}`); } }
  if (cut.length) { carMid = null; build3D(); steps.push(`🔻 ลดจุด (เกมเด้งถ้าเกิน): ${cut.join(', ')}`); }
  await toSheet(); steps.push('🎯 ' + $('status').textContent.split('·')[0].trim());
  initPlateSliders(); plateUndo = false; plateNow(); steps.push('🔖 ' + $('plate-info').textContent);
  tailAuto(); steps.push('🔴 ' + $('status').textContent.split('·')[0].trim());
  if ($('esc-complete').checked) steps.push('🧩 ' + await completeLikeEscarabajo());
  await saveZip();
  status(`⚡ พร้อมใส่เกม · ดาวน์โหลด ${car.name}.zip แล้ว — ${steps.join(' | ')}`);
}
$('btn-ready-game').addEventListener('click', readyForGame);
// 🧩 Complete like Escarabajo: triangles wound into the car turned out, the paint shared out over the part files
// the way Escarabajo has them (front bumper, skirts, rear bumper, hood lid, roof + pillars, body), the open
// headlights closed with a lens the game lights (and a reflector), the other openings (grille, intakes, around
// the tail lamps) backed with black so the car isn't see-through, the headlight folder its own picture, and the
// front doors (with their windows) and the hood lid made the moving pieces the game opens, hinged on the car;
// last, a black floor pan and a black lining on whatever is still seen from behind (no see-through, like Escarabajo).
async function completeLikeEscarabajo() {
  const o = orientOutward(car.meshes);
  const s = splitLikeEscarabajo(car.meshes);
  if (s.missing) return `แยกชิ้นไม่ได้: ไม่มีโฟลเดอร์ ${s.missing}`;
  // a black spot of the mask for the backings / reflectors (painted in the free strip if the mask has none)
  let black = car.mask ? blackSpot(car.mask) : null;
  if (!black && car.mask) {
    const { w, h, data } = car.mask; const cx = Math.floor(0.03 * w); const cy = Math.floor(0.45 * h);
    for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) data.set([0, 0, 0, 255], (y * w + x) * 4);
    paint.dirty = true; maskChanged(); black = [(cx + 0.5) / w, (cy + 0.5) / h];
  }
  const op = closeOpenings(car.meshes, { blackUV: black || [0.03, 0.45] });
  addOpenings(car.meshes, op);
  if (op.lens) {
    let esc = null; try { const tpl = await escarabajoTemplate(); const b = tpl && tpl.get('headlight/escarabajo_headlight.png'); if (b) esc = await decodePNG(b); } catch { /* no template */ }
    car.headlightPic = headlightPicture(esc, black || [0.03, 0.45]);
  }
  const dr = openingParts(car.meshes);
  const ln = lineSeenInside(car.meshes, black || [0.03, 0.45]);
  for (const m of car.meshes) m.isl = m.parts.map(islandsOf);
  carMid = null; build3D(); refresh();
  const c = s.counts; const sz = (n) => n.toLocaleString();
  return `ครบแบบ Escarabajo: กลับด้าน ${sz(o.flipped)} สามเหลี่ยม · กันชนหน้า ${sz(c.frontbumper)} · สเกิร์ต ${sz(c.skirt)} · กันชนหลัง ${sz(c.rearbumper)} · ฝากระโปรง ${sz(c.hood)} · หลังคา ${sz(c.roof)} · ตัวถัง ${sz(c.body)}${op.lens ? ` · ไฟหน้า ${sz(op.cells.lamp)} ซม²` : ''} · ปิดช่องเปิด ${sz((op.cells.front || 0) + (op.cells.rear || 0))} ซม²${dr.error ? ` · ประตูเปิดไม่ได้: ${dr.error}` : ` · ประตูเปิดได้ (ซ้าย ${sz(dr.doors[0])} / ขวา ${sz(dr.doors[1])} สามเหลี่ยม + กระจก)${dr.hood ? ` · ฝากระโปรงเปิดได้ (${sz(dr.hood)})` : ''}`} · พื้นใต้ท้อง + ผิวในสีดำ ${sz(ln.lined)} สามเหลี่ยม`;
}
try { $('esc-complete').checked = localStorage.getItem('rc-esc-complete') !== '0'; } catch { /* private mode */ }
$('esc-complete').addEventListener('change', (e) => { try { localStorage.setItem('rc-esc-complete', e.target.checked ? '1' : '0'); } catch { /* private mode */ } });
try { $('no-cap').checked = localStorage.getItem('rc-no-cap') === '1'; } catch { /* private mode */ }
$('no-cap').addEventListener('change', (e) => { try { localStorage.setItem('rc-no-cap', e.target.checked ? '1' : '0'); } catch { /* private mode */ } });
window.addEventListener('message', async (e) => { if (e.data?.type === 'rc-car' && Array.isArray(e.data.files)) { await openFiles(e.data.files); if (e.data.auto) await readyForGame(); else setPaint(true); } });
for (const w of [window.opener, window.parent !== window ? window.parent : null]) if (w) try { w.postMessage({ type: 'rc-uv-ready' }, '*'); } catch { /* gone */ }

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
// 📐 The car's UVs laid out on the shop decals' sheet (Escarabajo's decal): the car unfolded — left side on
// top upside down, top view in the middle, right side below, front to the right — every panel its own
// piece, none sharing texture (chartsLayout, the same as new-body builds).
// Pieces on one colour spot (trim, lamps), black pieces and glass keep their spots. The mask is redrawn
// from each triangle's old colour, so every panel keeps its colour; the colour layer keeps only the game's block.
async function escarabajoTemplate() {
  const b64 = (window.RC_TEMPLATES || {}).escarabajo; if (!b64) return null;
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const json = await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  return new Map(Object.entries(JSON.parse(json)).map(([k, d]) => [k, Uint8Array.from(atob(d), (c) => c.charCodeAt(0))]));
}
$('btn-like-esc').addEventListener('click', async () => {
  if (!car.meshes.length || !car.mask) return;
  const tpl = new Map();
  status('กำลังจัด UV ตามแบบ Escarabajo…'); await new Promise((r) => setTimeout(r, 30));
  const { w, h, data } = car.mask; const old = data.slice();
  const slotAt = (u, v) => { const x = Math.min(w - 1, Math.max(0, Math.floor(u * w))); const y = Math.min(h - 1, Math.max(0, Math.floor(v * h))); const o = (y * w + x) * 4; return old[o] > 128 ? 1 : old[o + 1] > 128 ? 2 : old[o + 2] > 128 ? 3 : 0; };
  // boxes of this car and of Escarabajo
  const box = (list) => { const mn = [Infinity, Infinity, Infinity]; const mx = [-Infinity, -Infinity, -Infinity]; for (const P of list) for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], P[i + k]); mx[k] = Math.max(mx[k], P[i + k]); } return { mn, mx }; };
  const mine = box(car.meshes.flatMap((m) => m.parts.filter((p) => p.positions.length / 3 > 8).map((p) => p.positions)));
  const bent = new Map(); const escPos = [];
  for (const [rel, b] of tpl) {
    if (!(rel === 'body_2.0m' || /^[^/]+\/default_2\.0m$/.test(rel))) continue;
    const om = parseOM(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); const parts = omParts(om);
    bent.set(rel, { om, parts }); parts.forEach((p) => { if (p.positions.length / 3 > 8) escPos.push(p.positions); });
  }
  const esc = box(escPos);
  for (const { parts } of bent.values()) for (const p of parts) for (let i = 0; i < p.positions.length; i += 3) for (let k = 0; k < 3; k++) p.positions[i + k] = mine.mn[k] + ((p.positions[i + k] - esc.mn[k]) / ((esc.mx[k] - esc.mn[k]) || 1)) * (mine.mx[k] - mine.mn[k]);
  undo.push(comboSnap()); if (undo.length > 60) undo.shift(); redo.length = 0;
  const lod = {}; const jobs = [];
  for (const m of car.meshes) {
    const slot = m.rel === 'body_2.0m' ? 'body' : m.rel.split('/')[0];
    m.parts.forEach((p, pi) => {
      if (p.flags[0] !== 0 || p.positions.length / 3 <= 8) return;
      const I = p.indices; const U = p.uvs; const move = []; const keep = []; const slots = [];
      for (let t = 0; t < I.length; t += 3) {
        const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
        const flat = Math.abs((U[b * 2] - U[a * 2]) * (U[c * 2 + 1] - U[a * 2 + 1]) - (U[c * 2] - U[a * 2]) * (U[b * 2 + 1] - U[a * 2 + 1])) < 1e-9;
        const sl = slotAt((U[a * 2] + U[b * 2] + U[c * 2]) / 3, (U[a * 2 + 1] + U[b * 2 + 1] + U[c * 2 + 1]) / 3);
        // black pieces (trim) keep their spot; painted ones — also pieces on one colour spot — are laid out
        // so shop decals show on them
        if (sl === 0) keep.push(a, b, c); else { move.push(a, b, c); slots.push(sl); }
      }
      if (!move.length) return;
      const proxy = { name: 'Body_Color', positions: p.positions, normals: p.normals, uvs: p.uvs, indices: Uint32Array.from(move) };
      (lod[slot] = lod[slot] || []).push(proxy);
      jobs.push({ m, pi, p, proxy, keep, slots });
    });
  }
  chartsLayout(lod, { slots: false, size: w });
  // new mask: red, each moved triangle in its old colour (majority per texel), kept spots re-stamped
  const votes = new Uint16Array(w * h * 4);
  for (const j of jobs) {
    const U = j.proxy.uvs; const I = j.proxy.indices;
    for (let t = 0, k = 0; t < I.length; t += 3, k++) {
      const q = [I[t], I[t + 1], I[t + 2]].map((i) => [U[i * 2] * w, U[i * 2 + 1] * h]);
      const area = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]); if (Math.abs(area) < 1e-6) continue;
      const x0 = Math.max(0, Math.floor(Math.min(q[0][0], q[1][0], q[2][0])) - 1); const x1 = Math.min(w - 1, Math.ceil(Math.max(q[0][0], q[1][0], q[2][0])) + 1);
      const y0 = Math.max(0, Math.floor(Math.min(q[0][1], q[1][1], q[2][1])) - 1); const y1 = Math.min(h - 1, Math.ceil(Math.max(q[0][1], q[1][1], q[2][1])) + 1);
      const grow = 1.2 / Math.sqrt(Math.abs(area));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const cx = x + 0.5; const cy = y + 0.5;
        const s0 = ((q[1][0] - q[0][0]) * (cy - q[0][1]) - (q[1][1] - q[0][1]) * (cx - q[0][0])) / area;
        const s1 = ((q[2][0] - q[1][0]) * (cy - q[1][1]) - (q[2][1] - q[1][1]) * (cx - q[1][0])) / area;
        const s2 = ((q[0][0] - q[2][0]) * (cy - q[2][1]) - (q[0][1] - q[2][1]) * (cx - q[2][0])) / area;
        if (s0 >= -grow && s1 >= -grow && s2 >= -grow) { const o = (y * w + x) * 4 + j.slots[k]; if (votes[o] < 65535) votes[o]++; }
      }
    }
  }
  const RGB = [null, [255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]];
  for (let i = 0; i < w * h; i++) { let best = 1; let bv = 0; for (let k = 1; k <= 3; k++) if (votes[i * 4 + k] > bv) { bv = votes[i * 4 + k]; best = k; } data.set(RGB[best], i * 4); }
  // the black spot the floor / wheel-arch liners went to (chartsLayout puts faces looking down there)
  { const cx = Math.round(0.07 * w); const cy = Math.round(0.60 * h); const r = Math.max(4, Math.round(w / 64)); for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) data.set([0, 0, 0, 255], (y * w + x) * 4); }
  // merge: moved triangles (new points) + kept ones (old points); spots of kept pieces keep their old colour
  for (const j of jobs) {
    const p = j.p; const pr = j.proxy; const nOld = p.positions.length / 3;
    const P = new Float32Array(p.positions.length + pr.positions.length); P.set(p.positions); P.set(pr.positions, p.positions.length);
    const N = new Float32Array(p.normals.length + pr.normals.length); N.set(p.normals); N.set(pr.normals, p.normals.length);
    const UV = new Float32Array(p.uvs.length + pr.uvs.length); UV.set(p.uvs); UV.set(pr.uvs, p.uvs.length);
    const idx = [...j.keep, ...[...pr.indices].map((i) => i + nOld)];
    j.m.parts[j.pi] = { ...p, positions: P, normals: N, uvs: UV, indices: Uint32Array.from(idx) };
  }
  for (const m of car.meshes) {
    for (const p of m.parts) {
      if (p.positions.length / 3 <= 8) continue; const U = p.uvs; const I = p.indices;
      for (let t = 0; t < I.length; t += 3) {
        const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
        if (p.flags[0] === 0 && slotAt((U[a * 2] + U[b * 2] + U[c * 2]) / 3, (U[a * 2 + 1] + U[b * 2 + 1] + U[c * 2 + 1]) / 3) !== 0) continue;
        // kept (flat spot, black panel or glass): its old texels back
        for (const i of [a, b, c]) { const x = Math.min(w - 1, Math.max(0, Math.floor(U[i * 2] * w))); const y = Math.min(h - 1, Math.max(0, Math.floor(U[i * 2 + 1] * h))); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = Math.min(w - 1, Math.max(0, x + dx)); const yy = Math.min(h - 1, Math.max(0, y + dy)); const o = (yy * w + xx) * 4; data.set(old.subarray(o, o + 4), o); } }
      }
    }
    m.isl = m.parts.map(islandsOf); m.dirty = true;
  }
  if (car.color) {
    const cd = car.color.data;
    for (let y = 0; y < car.color.h; y++) for (let x = 0; x < car.color.w; x++) { if ((x + 0.5) / car.color.w <= RESERVED[2] && (y + 0.5) / car.color.h >= RESERVED[1]) continue; const o = (y * car.color.w + x) * 4; if (cd[o + 3]) cd.set([0, 0, 0, 0], o); }
    car.colorDirty = true; car.colorImg.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(cd), car.color.w, car.color.h), 0, 0);
  }
  paint.dirty = true; selected = new Set();
  build3D(); maskChanged();
  status(`จัด UV ตามแผ่นลายในร้านแล้ว (${jobs.reduce((n, j) => n + j.slots.length, 0).toLocaleString()} สามเหลี่ยม · สีย้ายตาม) · เปิดรูปลายมาเทียบได้ · กด ⬇ ดาวน์โหลด`);
});
// 🎯 The car's own UV islands (its cut kept, nothing re-cut) moved onto the shop decals' sheet: each island
// fitted (affine, least squares) from where it is to where Escarabajo's sheet wants its points — left side on
// top upside down, top view in the middle, right side below; front / rear / floor pieces packed into the free
// bottom strip, clear of the plate's cell. Glass laid out like Escarabajo's for the films, lamp spots off the
// sheets (glassLikeEsc). Colours follow.
const SHEET = {
  L: (x, y, z) => [1.000 - 0.891 * y, 0.017 + 0.284 * z],
  T: (x, y, z) => [0.966 - 0.804 * y, 0.540 - 0.326 * x],
  R: (x, y, z) => [0.994 - 0.874 * y, 0.753 - 0.291 * z],
};
function fitAffine(src, dst) { // src, dst: [[u, v]…] → f(u, v) or null
  let a = [0, 0, 0, 0, 0, 0]; const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; const bu = [0, 0, 0]; const bv = [0, 0, 0];
  for (let i = 0; i < src.length; i++) { const r = [src[i][0], src[i][1], 1]; for (let j = 0; j < 3; j++) { for (let k = 0; k < 3; k++) M[j][k] += r[j] * r[k]; bu[j] += r[j] * dst[i][0]; bv[j] += r[j] * dst[i][1]; } }
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M); if (!(Math.abs(D) > 1e-14)) return null;
  const solve = (b) => [0, 1, 2].map((c) => det(M.map((row, j) => row.map((x, k) => (k === c ? b[j] : x)))) / D);
  const [p, q] = [solve(bu), solve(bv)]; a = [...p, ...q];
  return (u, v) => [a[0] * u + a[1] * v + a[2], a[3] * u + a[4] * v + a[5]];
}
async function toSheet() {
  if (!car.meshes.length || !car.mask) return;
  status('กำลังย้ายเกาะ UV เดิมลงแผ่นลาย…'); await new Promise((r) => setTimeout(r, 30));
  const { w, h, data } = car.mask; const old = data.slice();
  const slotAt = (u, v) => { const x = Math.min(w - 1, Math.max(0, Math.floor(u * w))); const y = Math.min(h - 1, Math.max(0, Math.floor(v * h))); const o = (y * w + x) * 4; return old[o] > 128 ? 1 : old[o + 1] > 128 ? 2 : old[o + 2] > 128 ? 3 : 0; };
  const mn = [Infinity, Infinity, Infinity]; const mx = [-Infinity, -Infinity, -Infinity];
  for (const m of car.meshes) for (const p of m.parts) if (p.flags[0] === 0 && p.positions.length / 3 > 8) for (let i = 0; i < p.positions.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p.positions[i + k]); mx[k] = Math.max(mx[k], p.positions[i + k]); }
  const nrm = (P, i) => [0, 1, 2].map((k) => (P[i * 3 + k] - mn[k]) / ((mx[k] - mn[k]) || 1));
  undo.push(comboSnap()); if (undo.length > 60) undo.shift(); redo.length = 0;
  const oldUV = new Map(); const strip = []; let fitted = 0; let spots = 0;
  for (const m of car.meshes) m.parts.forEach((p) => {
    const U = p.uvs; const I = p.indices; const P = p.positions;
    if (p.flags[0] !== 0) { if (p.flags[0] === 1 || LAMP_SPOT[p.flags[0]]) spots++; return; } // glass / lamps: glassLikeEsc below
    if (P.length / 3 <= 8) return;
    oldUV.set(p, U.slice());
    const isl = islandsOf(p); const groups = new Map();
    for (let t = 0; t < I.length; t += 3) { const g = isl.vertIsl[I[t]]; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(t); }
    const sg = outwardSign(p); const N = p.normals;
    for (const tris of groups.values()) {
      let flat = true; const votes = [0, 0, 0, 0]; const n = [0, 0, 0]; let cx = 0; let cnt = 0; const pts = new Set();
      for (const t of tris) {
        const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
        const ar = (U[b * 2] - U[a * 2]) * (U[c * 2 + 1] - U[a * 2 + 1]) - (U[c * 2] - U[a * 2]) * (U[b * 2 + 1] - U[a * 2 + 1]);
        if (Math.abs(ar) > 1e-9) flat = false;
        votes[slotAt((U[a * 2] + U[b * 2] + U[c * 2]) / 3, (U[a * 2 + 1] + U[b * 2 + 1] + U[c * 2 + 1]) / 3)]++;
        const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]]; const e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
        const A = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]);
        for (const v of [a, b, c]) { for (let k = 0; k < 3; k++) n[k] += sg * N[v * 3 + k] * A; pts.add(v); }
      }
      // spots (one texel), black trim and plates keep their place
      if (flat || votes[0] > votes[1] + votes[2] + votes[3] || tris.every((t) => isPlateTri(p, t))) continue;
      for (const v of pts) { cx += nrm(P, v)[0]; cnt++; } cx /= cnt;
      const [ax, ay, az] = n.map(Math.abs); let view = null;
      if (ax >= ay && ax >= az) view = (n[0] > 0) === (cx > 0.5) ? (n[0] > 0 ? 'L' : 'R') : null; // inner walls → strip
      else if (az >= ay && n[2] > 0) view = 'T';
      const list = [...pts];
      if (view) {
        const f = fitAffine(list.map((v) => [U[v * 2], U[v * 2 + 1]]), list.map((v) => SHEET[view](...nrm(P, v))));
        if (f) { for (const v of list) { const [nu, nv] = f(U[v * 2], U[v * 2 + 1]); U[v * 2] = nu; U[v * 2 + 1] = nv; } fitted++; continue; }
      }
      strip.push({ U, list });
    }
  });
  // front / rear / floor pieces: shelf-packed where the shop decals never draw — left of the sheet's rear end
  // (u < 0.10; the sides end at u 0.11, the top view at 0.16), between the film cell, the lamp spots and the
  // game's block. The bottom strip is not free: decals paint it (Escarabajo's front / rear faces sit there),
  // so pieces put there showed bits of the decal.
  { const pad = 2 / w; const boxes = strip.map((e) => { let a = Infinity; let b = Infinity; let c = -Infinity; let d = -Infinity; for (const v of e.list) { a = Math.min(a, e.U[v * 2]); c = Math.max(c, e.U[v * 2]); b = Math.min(b, e.U[v * 2 + 1]); d = Math.max(d, e.U[v * 2 + 1]); } return { ...e, a, b, w: c - a, h: d - b }; }).sort((p, q) => q.h - p.h);
    const AREAS = FREE_AREAS;
    const place = (sc, go) => {
      let k = 0; let x = AREAS[0][0]; let y = AREAS[0][1]; let rh = 0;
      for (const e of boxes) {
        for (;;) {
          const A = AREAS[k];
          if (x + e.w * sc > A[2]) { x = A[0]; y += rh + pad; rh = 0; }
          if (y + e.h * sc <= A[3] && x + e.w * sc <= A[2]) break;
          k++; if (k >= AREAS.length) return false; x = AREAS[k][0]; y = AREAS[k][1]; rh = 0;
        }
        if (go) for (const v of e.list) { e.U[v * 2] = x + (e.U[v * 2] - e.a) * sc; e.U[v * 2 + 1] = y + (e.U[v * 2 + 1] - e.b) * sc; }
        x += e.w * sc + pad; rh = Math.max(rh, e.h * sc);
      }
      return true;
    };
    let sc = 1; while (!place(sc, false) && sc > 0.01) sc *= 0.93; place(sc, true); stripScale = sc; }
  // colours: new mask red; moved triangles take their old texels (a grown pass, then an exact one so
  // neighbours never bleed into each other); spots that did not move get their old texels back
  data.fill(0); for (let i = 0; i < w * h; i++) data.set([255, 0, 0, 255], i * 4);
  const keep = [];
  // files not on the page (placeholders, variants unlike default) keep their UVs: their colour spots stay too
  const sameAs = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  for (const [rel, b] of car.files) {
    if (!/\.0m$/i.test(rel) || car.meshes.some((m) => sameAs(m.orig, b))) continue;
    try {
      for (const q of omParts(parseOM(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)))) { const U = q.uvs; const I = q.indices; for (let t = 0; t < I.length; t += 3) { const tri = [I[t], I[t + 1], I[t + 2]].map((i) => [U[i * 2], U[i * 2 + 1]]); if (Math.abs((tri[1][0] - tri[0][0]) * (tri[2][1] - tri[0][1]) - (tri[2][0] - tri[0][0]) * (tri[1][1] - tri[0][1])) < 1e-9) keep.push(tri); } }
    } catch { /* not a mesh */ }
  }
  for (const pass of [0, 1]) for (const m of car.meshes) for (const p of m.parts) {
    const o = oldUV.get(p); const U = p.uvs; const I = p.indices;
    if (!o || p.flags[0] !== 0) { if (pass === 0 && p.flags[0] === 0) for (let t = 0; t < I.length; t += 3) keep.push([I[t], I[t + 1], I[t + 2]].map((i) => [U[i * 2], U[i * 2 + 1]])); continue; }
    for (let t = 0; t < I.length; t += 3) {
      const v = [I[t], I[t + 1], I[t + 2]];
      const q = v.map((i) => [U[i * 2] * w, U[i * 2 + 1] * h]); const s0 = v.map((i) => [o[i * 2] * w, o[i * 2 + 1] * h]);
      const area = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]);
      if (Math.abs(area) < 1e-6 || v.every((i) => U[i * 2] === o[i * 2] && U[i * 2 + 1] === o[i * 2 + 1])) { if (pass === 0) keep.push(v.map((i) => [o[i * 2], o[i * 2 + 1]])); continue; }
      const x0 = Math.max(0, Math.floor(Math.min(q[0][0], q[1][0], q[2][0])) - 2); const x1 = Math.min(w - 1, Math.ceil(Math.max(q[0][0], q[1][0], q[2][0])) + 2);
      const y0 = Math.max(0, Math.floor(Math.min(q[0][1], q[1][1], q[2][1])) - 2); const y1 = Math.min(h - 1, Math.ceil(Math.max(q[0][1], q[1][1], q[2][1])) + 2);
      const grow = pass === 0 ? 2 / Math.sqrt(Math.abs(area)) : 0;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const cx = x + 0.5; const cy = y + 0.5;
        const b0 = ((q[1][0] - cx) * (q[2][1] - cy) - (q[2][0] - cx) * (q[1][1] - cy)) / area; const b1 = ((q[2][0] - cx) * (q[0][1] - cy) - (q[0][0] - cx) * (q[2][1] - cy)) / area; const b2 = 1 - b0 - b1;
        if (b0 < -grow || b1 < -grow || b2 < -grow) continue;
        const c0 = Math.min(1, Math.max(0, b0)); const c1 = Math.min(1, Math.max(0, b1)); const c2 = Math.max(0, 1 - c0 - c1);
        const sx = Math.min(w - 1, Math.max(0, Math.floor(c0 * s0[0][0] + c1 * s0[1][0] + c2 * s0[2][0]))); const sy = Math.min(h - 1, Math.max(0, Math.floor(c0 * s0[0][1] + c1 * s0[1][1] + c2 * s0[2][1])));
        data.set(old.subarray((sy * w + sx) * 4, (sy * w + sx) * 4 + 4), (y * w + x) * 4);
      }
    }
  }
  for (const tri of keep) { const u = (tri[0][0] + tri[1][0] + tri[2][0]) / 3; const v = (tri[0][1] + tri[1][1] + tri[2][1]) / 3; const sx = Math.floor(u * w); const sy = Math.floor(v * h); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = Math.min(w - 1, Math.max(0, sx + dx)); const y = Math.min(h - 1, Math.max(0, sy + dy)); const o = (y * w + x) * 4; data.set(old.subarray(o, o + 4), o); } }
  const gl = glassLikeEsc();
  if (car.color) {
    const cd = car.color.data;
    for (let y = 0; y < car.color.h; y++) for (let x = 0; x < car.color.w; x++) { if ((x + 0.5) / car.color.w <= RESERVED[2] && (y + 0.5) / car.color.h >= RESERVED[1]) continue; const o = (y * car.color.w + x) * 4; if (cd[o + 3]) cd.set([0, 0, 0, 0], o); }
    car.colorDirty = true; car.colorImg.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(cd), car.color.w, car.color.h), 0, 0);
  }
  for (const m of car.meshes) { m.isl = m.parts.map(islandsOf); m.dirty = true; }
  paint.dirty = true; selected = new Set(); selectedPts = new Map();
  build3D(); maskChanged();
  status(`ย้ายเกาะเดิมลงแผ่นลายแล้ว: ${fitted} เกาะ (ซ้าย/บน/ขวา) · ${strip.length} ชิ้น (หน้า/หลัง/ใต้) ไปมุมซ้ายที่ลายไม่ทับ (ย่อ ${Math.round(stripScale * 100)}%) · กระจก ${gl.n.toLocaleString()} สามเหลี่ยม จัดแบบ Escarabajo (ฟิล์มลงถูกที่) · ไฟ ${gl.lamps} ชิ้น พ้นแผ่นลาย · สีย้ายตาม · เปิดรูปลายมาเทียบได้`);
}
$('btn-to-sheet').addEventListener('click', toSheet);
// 🪟 Glass like Escarabajo's on the films' picture (filmGlass), lamps' colour spots off the sheets, the film,
// plate and lamp cells red in the mask and clear in the colour layer (no film = clear glass).
const LAMP_SPOT = { 2: [0.03, 0.45], 3: [0.06, 0.45], 4: [0.09, 0.45] };
// sheet areas no shop decal draws on (left of the rear end), clear of the film cell, lamp spots and game block
const FREE_AREAS = [[0.004, 0.127, 0.099, 0.247], [0.004, 0.378, 0.099, 0.438], [0.004, 0.462, 0.099, 0.655]];
let stripScale = 1;
const inRect = (u, v, r) => u >= r[0] && u <= r[2] && v >= r[1] && v <= r[3];
function paintIn(r) { // paint triangles of the page's files whose middle lies in r (plates left out)
  let n = 0;
  for (const m of car.meshes) for (const p of m.parts) { if (p.flags[0] !== 0) continue; const U = p.uvs; const I = p.indices;
    for (let t = 0; t < I.length; t += 3) { const u = (U[I[t] * 2] + U[I[t + 1] * 2] + U[I[t + 2] * 2]) / 3; const v = (U[I[t] * 2 + 1] + U[I[t + 1] * 2 + 1] + U[I[t + 2] * 2 + 1]) / 3; if (inRect(u, v, r) && !isPlateTri(p, t)) n++; } }
  return n;
}
function redCells() {
  if (car.mask) {
    const { w, h, data } = car.mask;
    const fill = (r) => { for (let y = Math.floor(r[1] * h); y < Math.min(h, Math.ceil(r[3] * h)); y++) for (let x = Math.floor(r[0] * w); x < Math.min(w, Math.ceil(r[2] * w)); x++) data.set([255, 0, 0, 255], (y * w + x) * 4); };
    fill(FILM_RECT); fill(PLATE_RECT); for (const sp of Object.values(LAMP_SPOT)) fill([sp[0] - 0.006, sp[1] - 0.006, sp[0] + 0.006, sp[1] + 0.006]);
    paint.dirty = true;
  }
  if (car.color) {
    const { w, h, data } = car.color; let ch = false;
    for (const r of [FILM_RECT, PLATE_RECT]) for (let y = Math.floor(r[1] * h); y < Math.min(h, Math.ceil(r[3] * h)); y++) for (let x = Math.floor(r[0] * w); x < Math.min(w, Math.ceil(r[2] * w)); x++) { if ((x + 0.5) / w <= RESERVED[2] && (y + 0.5) / h >= RESERVED[1]) continue; const o = (y * w + x) * 4; if (data[o + 3]) { data.set([0, 0, 0, 0], o); ch = true; } }
    if (ch) { car.colorDirty = true; car.colorImg.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0); }
  }
}
function glassLikeEsc() {
  const glass = []; let lamps = 0;
  for (const m of car.meshes) for (const p of m.parts) {
    if (p.flags[0] === 1) { glass.push(p); m.dirty = true; }
    const sp = LAMP_SPOT[p.flags[0]]; const U = p.uvs;
    // a lamp on one colour spot (not its own picture) goes to its spot off the sheets
    if (sp && U.length && U.every((x, i) => x === U[i & 1])) { for (let i = 0; i < U.length; i += 2) { U[i] = sp[0]; U[i + 1] = sp[1]; } lamps++; m.dirty = true; }
  }
  const n = filmGlass(glass);
  redCells();
  return { n, lamps };
}
$('btn-film-glass').addEventListener('click', () => {
  if (!car.meshes.length) return;
  undo.push(comboSnap()); if (undo.length > 60) undo.shift(); redo.length = 0;
  const { n, lamps } = glassLikeEsc();
  for (const m of car.meshes) m.isl = m.parts.map(islandsOf);
  build3D(); if (car.mask) maskChanged(); refresh();
  const over = paintIn(FILM_RECT);
  status(`จัดกระจกแบบ Escarabajo แล้ว (${n.toLocaleString()} สามเหลี่ยม) · ไฟ ${lamps} ชิ้น ย้ายพ้นแผ่นลาย${over ? ` · ⚠ มีแผงทับช่องฟิล์ม ${over} สามเหลี่ยม (กด 🎯 หรือลากออก)` : ''} · เปิดรูปฟิล์มมาดูได้`);
});
// 🔖 Licence plates like Escarabajo's (plateQuad), placed on the car's own front / rear at the middle.
// A bumper's plate holder (8 points of paint, Escarabajo keeps its plate so) becomes the plate; without one
// the plate's 8 points join the bumper's paint (or the body's). Moving a slider places both again.
const isPlateTri = (p, t) => [p.indices[t], p.indices[t + 1], p.indices[t + 2]].every((i) => inRect(p.uvs[i * 2], p.uvs[i * 2 + 1], PLATE_RECT));
function stripPlates(p) { // a part without its plate triangles (points used only by them dropped)
  if (p.positions.length / 3 <= 8) return false;
  const I = p.indices; const keep = []; let had = false;
  for (let t = 0; t < I.length; t += 3) { if (isPlateTri(p, t)) had = true; else keep.push(I[t], I[t + 1], I[t + 2]); }
  if (!had) return false;
  const map = new Int32Array(p.positions.length / 3).fill(-1); let n = 0; for (const i of keep) if (map[i] < 0) map[i] = n++;
  const P = new Float32Array(n * 3); const N = new Float32Array(n * 3); const U = new Float32Array(n * 2);
  for (let i = 0; i < map.length; i++) if (map[i] >= 0) { const j = map[i]; P.set(p.positions.subarray(i * 3, i * 3 + 3), j * 3); N.set(p.normals.subarray(i * 3, i * 3 + 3), j * 3); U.set(p.uvs.subarray(i * 2, i * 2 + 2), j * 2); }
  Object.assign(p, { positions: P, normals: N, uvs: U, indices: Uint32Array.from(keep.map((i) => map[i])) }); p._sg = 0;
  return true;
}
function plateBox() {
  const mn = [Infinity, Infinity, Infinity]; const mx = [-Infinity, -Infinity, -Infinity];
  for (const m of car.meshes) for (const p of m.parts) if (p.flags[0] === 0 && p.positions.length / 3 > 8) for (let i = 0; i < p.positions.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p.positions[i + k]); mx[k] = Math.max(mx[k], p.positions[i + k]); }
  return { mn, mx };
}
// the car's outermost surface at the middle (|x| < 18 cm) around height z: front = smallest y, rear = biggest
function surfaceAt(z, facing) {
  let best = null;
  for (const m of car.meshes) for (const p of m.parts) {
    if (p.flags[0] === 1 || p.positions.length / 3 <= 8) continue; const P = p.positions; const I = p.indices;
    for (let t = 0; t < I.length; t += 3) {
      if (isPlateTri(p, t)) continue;
      const c = [0, 1, 2].map((k) => (P[I[t] * 3 + k] + P[I[t + 1] * 3 + k] + P[I[t + 2] * 3 + k]) / 3);
      if (Math.abs(c[0]) > 0.18 || Math.abs(c[2] - z) > 0.04) continue;
      if (best === null || facing * c[1] > facing * best) best = c[1];
    }
  }
  return best;
}
function holder(slot) { const m = car.meshes.find((q) => q.rel === `${slot}bumper/default_2.0m`); if (!m) return null; const k = m.parts.findIndex((p) => p.flags[0] === 0 && p.positions.length / 3 === 8); return k < 0 ? null : { m, p: m.parts[k] }; }
function initPlateSliders() {
  const { mn, mx } = plateBox(); if (!isFinite(mn[2])) return;
  const H = mx[2] - mn[2];
  for (const [id, slot, frac] of [['plate-fz', 'front', 0.21], ['plate-rz', 'rear', 0.3]]) {
    const el = $(id); el.min = mn[2].toFixed(3); el.max = mx[2].toFixed(3);
    // where the model had its plate (its holder, if it sits at the middle), else Escarabajo's height share
    const hd = holder(slot); const z = hd && Math.abs(hd.p.positions[0]) < 0.15 && hd.p.positions[2] > mn[2] && hd.p.positions[2] < mx[2] ? hd.p.positions[2] : mn[2] + frac * H;
    el.value = z.toFixed(3);
  }
  showPlateVals();
}
function showPlateVals() { for (const id of ['plate-fz', 'plate-rz', 'plate-rt', 'plate-gap']) $(`${id}-v`).textContent = `${(+$(id).value * 100).toFixed(1)} ซม.`; }
function placePlates() {
  for (const m of car.meshes) for (const p of m.parts) if (p.flags[0] === 0 && stripPlates(p)) m.dirty = true;
  const gap = +$('plate-gap').value; const rt = +$('plate-rt').value; const res = [];
  for (const [slot, facing, z] of [['front', -1, +$('plate-fz').value], ['rear', 1, +$('plate-rz').value]]) {
    const lo = surfaceAt(z - 0.04, facing); const hi = surfaceAt(z + 0.04, facing); const mid = surfaceAt(z, facing);
    const ys = [lo, mid, hi].filter((v) => v !== null); if (!ys.length) continue;
    const y = facing > 0 ? Math.max(...ys) : Math.min(...ys);
    // the rear plate leans with the surface behind it, plus the slider
    const out = facing > 0 ? (lo !== null && hi !== null ? (hi - lo) * (0.108 / 0.08) : 0) + rt : 0;
    const q = plateQuad([0, y + facing * gap, z], facing, out);
    const hd = holder(slot);
    if (hd) { Object.assign(hd.p, q); hd.p._sg = 0; hd.m.dirty = true; res.push(slot); continue; }
    const m = car.meshes.find((x) => x.rel === `${slot}bumper/default_2.0m` && x.parts.some((p) => p.flags[0] === 0 && p.positions.length / 3 > 8)) || car.meshes.find((x) => x.rel === 'body_2.0m');
    const p = m && m.parts.filter((x) => x.flags[0] === 0).sort((a, b) => b.positions.length - a.positions.length)[0]; if (!p) continue;
    const base = p.positions.length / 3; const cat = (a, b, T) => { const r = new T(a.length + b.length); r.set(a); r.set(b, a.length); return r; };
    Object.assign(p, { positions: cat(p.positions, q.positions, Float32Array), normals: cat(p.normals, q.normals, Float32Array), uvs: cat(p.uvs, q.uvs, Float32Array), indices: cat(p.indices, q.indices.map((i) => i + base), Uint32Array) });
    p._sg = 0; m.dirty = true; res.push(slot);
  }
  return res;
}
let platesOn = false; let plateUndo = false;
function plateNow() {
  if (!car.meshes.length) return;
  if (!plateUndo) { undo.push(comboSnap()); if (undo.length > 60) undo.shift(); redo.length = 0; plateUndo = true; }
  const done = placePlates(); platesOn = true;
  redCells();
  for (const m of car.meshes) m.isl = m.parts.map(islandsOf);
  build3D(); if (car.mask) maskChanged(); refresh(); showPlateVals();
  const over = paintIn(PLATE_RECT);
  $('plate-info').textContent = `ป้าย: ${done.map((s) => (s === 'front' ? 'หน้า' : 'หลัง')).join(' + ') || 'วางไม่ได้ (ไม่เจอผิวรถตรงกลาง)'}${over ? ` · ⚠ มีแผงทับช่องป้าย ${over} สามเหลี่ยม: ลากออก หรือกด 🎯` : ' · ช่องป้ายว่าง ✅'}`;
}
$('btn-plates').addEventListener('click', () => { if (!car.meshes.length) return; initPlateSliders(); plateUndo = false; plateNow(); });
for (const id of ['plate-fz', 'plate-rz', 'plate-rt', 'plate-gap']) {
  $(id).addEventListener('input', () => { showPlateVals(); if (platesOn) plateNow(); });
  $(id).addEventListener('change', () => { plateUndo = false; });
}
async function pictureFile(f) {
  if (/\.dds$/i.test(f.name)) return ddsToCanvas(new Uint8Array(await f.arrayBuffer()));
  const bm = await createImageBitmap(f); const cv = document.createElement('canvas'); cv.width = bm.width; cv.height = bm.height; cv.getContext('2d').drawImage(bm, 0, 0); return cv;
}
$('btn-film-img').addEventListener('click', () => $('file-film').click());
$('btn-plate-img').addEventListener('click', () => $('file-plate').click());
$('file-film').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { filmImg = await pictureFile(f); build3D(); drawTexture(); refresh(); status(`เปิดรูปฟิล์ม ${f.name} · แสดงบนกระจก (ช่อง u 0–0.125, v 0.25–0.375)`); } catch (err) { status(`เปิดรูปไม่ได้: ${err.message}`); } });
$('file-plate').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { plateImg = await pictureFile(f); drawTexture(); refresh(); status(`เปิดรูปป้าย ${f.name} · แสดงบนป้าย (ช่อง u 0.75–1, v 0.875–1)`); } catch (err) { status(`เปิดรูปไม่ได้: ${err.message}`); } });
// 🖼 A shop decal / film picture (png, jpg or the game's .dds) shown over the sheet and on the car, so the
// panels can be moved where the picture expects them.
function ddsToCanvas(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const h = dv.getUint32(12, true); const w = dv.getUint32(16, true); const four = String.fromCharCode(b[84], b[85], b[86], b[87]);
  const out = new Uint8ClampedArray(w * h * 4); const bw = Math.ceil(w / 4); const bh = Math.ceil(h / 4);
  const bs = four === 'DXT1' ? 8 : 16; let o = 128;
  const c565 = (c) => [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31];
  if (!['DXT1', 'DXT3', 'DXT5'].includes(four)) throw new Error(`ไม่รองรับ ${four}`);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++, o += bs) {
    const co = o + bs - 8; const c0 = dv.getUint16(co, true); const c1 = dv.getUint16(co + 2, true); const idx = dv.getUint32(co + 4, true);
    const a = c565(c0); const c = c565(c1);
    const cols = c0 > c1 || four !== 'DXT1' ? [a, c, a.map((x, i) => (2 * x + c[i]) / 3), a.map((x, i) => (x + 2 * c[i]) / 3)] : [a, c, a.map((x, i) => (x + c[i]) / 2), [0, 0, 0]];
    let al = null;
    if (four === 'DXT5') { const a0 = b[o]; const a1 = b[o + 1]; const tab = [a0, a1]; for (let k = 2; k < 8; k++) tab.push(a0 > a1 ? ((8 - k) * a0 + (k - 1) * a1) / 7 : k < 6 ? ((6 - k) * a0 + (k - 1) * a1) / 5 : k === 6 ? 0 : 255); let bits = 0n; for (let k = 0; k < 6; k++) bits |= BigInt(b[o + 2 + k]) << BigInt(8 * k); al = []; for (let k = 0; k < 16; k++) al.push(tab[Number((bits >> BigInt(3 * k)) & 7n)]); }
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const px = bx * 4 + x; const py = by * 4 + y; if (px >= w || py >= h) continue;
      const k = y * 4 + x; const col = cols[(idx >> (2 * k)) & 3];
      let alpha = 255;
      if (four === 'DXT3') alpha = ((b[o + (k >> 1)] >> (4 * (k & 1))) & 15) * 17;
      else if (four === 'DXT5') alpha = al[k];
      else if (c0 <= c1 && ((idx >> (2 * k)) & 3) === 3) alpha = 0;
      out.set([col[0], col[1], col[2], alpha], (py * w + px) * 4);
    }
  }
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').putImageData(new ImageData(out, w, h), 0, 0); return cv;
}
$('btn-decal').addEventListener('click', () => $('file-decal').click());
$('file-decal').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    if (/\.dds$/i.test(f.name)) decalImg = ddsToCanvas(new Uint8Array(await f.arrayBuffer()));
    else { const bm = await createImageBitmap(f); const cv = document.createElement('canvas'); cv.width = bm.width; cv.height = bm.height; cv.getContext('2d').drawImage(bm, 0, 0); decalImg = cv; }
    $('decal-on').checked = true; drawTexture(); refresh();
    status(`เปิดรูปลาย ${f.name} (${decalImg.width}×${decalImg.height}) · ทับบนรูปซ้ายและบนรถ · ลากเกาะให้แผงตรงกับลาย`);
  } catch (err) { status(`เปิดรูปลายไม่ได้: ${err.message}`); }
});
['decal-on', 'decal-alpha'].forEach((id) => $(id).addEventListener('input', () => { drawTexture(); refresh(); }));
// Which way the car faces on the sheet: game cars have the front towards the right (u falls as y, the
// length towards the back, grows: Escarabajo / gtv98 u ≈ −0.18·y). A sheet the other way round gets the
// shop decals back to front. Slope of u over y on the side panels; > 0 = facing left.
function facing() {
  let n = 0; let sy = 0; let su = 0; let syy = 0; let syu = 0;
  for (const m of car.meshes) for (const p of m.parts) {
    if (p.flags[0] !== 0 || p.positions.length / 3 <= 8) continue;
    const P = p.positions; const U = p.uvs; const I = p.indices;
    for (let t = 0; t < I.length; t += 3) {
      const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
      const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]]; const e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
      const nx = e1[1] * e2[2] - e1[2] * e2[1]; const ny = e1[2] * e2[0] - e1[0] * e2[2]; const nz = e1[0] * e2[1] - e1[1] * e2[0];
      const L = Math.hypot(nx, ny, nz); if (L < 1e-12 || Math.abs(nx) / L < 0.85) continue;
      if (Math.abs((U[b * 2] - U[a * 2]) * (U[c * 2 + 1] - U[a * 2 + 1]) - (U[c * 2] - U[a * 2]) * (U[b * 2 + 1] - U[a * 2 + 1])) < 1e-9) continue;
      for (const i of [a, b, c]) { const y = P[i * 3 + 1]; const u = U[i * 2]; n++; sy += y; su += u; syy += y * y; syu += y * u; }
    }
  }
  if (n < 30) return 0;
  return (syu - (sy * su) / n) / Math.max(1e-9, syy - (sy * sy) / n);
}
// ⇋ the whole layout mirrored left-right inside its own box (front to the right); mask and colour layer with it
$('btn-flip-layout').addEventListener('click', () => {
  if (!car.meshes.length) return;
  let u0 = Infinity; let u1 = -Infinity;
  for (const m of car.meshes) for (const p of m.parts) for (let i = 0; i < p.uvs.length; i += 2) { u0 = Math.min(u0, p.uvs[i]); u1 = Math.max(u1, p.uvs[i]); }
  undo.push(comboSnap()); if (undo.length > 60) undo.shift(); redo.length = 0;
  for (const m of car.meshes) { for (const p of m.parts) for (let i = 0; i < p.uvs.length; i += 2) p.uvs[i] = u0 + u1 - p.uvs[i]; m.dirty = true; }
  const mirror = (img, keepBlock) => {
    const { w, h, data } = img; const src = data.slice();
    const x0 = Math.max(0, Math.floor(u0 * w)); const x1 = Math.min(w - 1, Math.ceil(u1 * w) - 1);
    for (let y = 0; y < h; y++) for (let x = x0; x <= x1; x++) {
      const v = (y + 0.5) / h; const sx = x0 + x1 - x;
      const inBlock = (xx) => keepBlock && (xx + 0.5) / w <= RESERVED[2] && v >= RESERVED[1];
      if (inBlock(x)) continue;
      const o = (y * w + x) * 4;
      if (inBlock(sx)) { data.set([0, 0, 0, 0], o); continue; }
      data.set(src.subarray((y * w + sx) * 4, (y * w + sx) * 4 + 4), o);
    }
  };
  if (car.mask) { mirror(car.mask, false); paint.dirty = true; }
  if (car.color) { mirror(car.color, true); car.colorDirty = true; car.colorImg.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(car.color.data), car.color.w, car.color.h), 0, 0); }
  if (car.mask) maskChanged();
  update3DUVs(); refresh();
  status(`กลับลายเส้นซ้าย-ขวาแล้ว (สีกลับตาม) · ${facing() < 0 ? 'หน้ารถหันขวาแบบรถในเกม ✅' : 'หน้ารถยังหันซ้าย'} · กด ⬇ ดาวน์โหลด`);
});
// 🪟 Glass look: what the paint mask and the colour layer hold under the glass pieces (kind 1).
//   clear: mask black (no garage colour) + colour layer dark with some alpha (tinted, see-through)
//   clearer: mask black + colour layer alpha 0 (pack 48: fully clear)
//   paint: mask red + colour layer near black alpha 0 (Escarabajo's values: the glass takes colour 1)
const GLASS_LOOK = { paint: [[255, 0, 0, 255], [1, 1, 1, 0]], mine: [[255, 0, 0, 255], [0, 0, 0, 0]] }; // paint = Escarabajo's values; mine = the owner's white car
$('btn-glass').addEventListener('click', () => {
  if (!car.mask) return;
  const [mrgba, crgba] = GLASS_LOOK[$('glass-look').value];
  undo.push(comboSnap()); if (undo.length > 60) undo.shift(); redo.length = 0;
  const fillImg = (img, rgba, U, a, b, c) => {
    const { w, h, data } = img; const q = [a, b, c].map((i) => [U[i * 2] * w, U[i * 2 + 1] * h]);
    const area = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]);
    const x0 = Math.max(0, Math.floor(Math.min(q[0][0], q[1][0], q[2][0])) - 1); const x1 = Math.min(w - 1, Math.ceil(Math.max(q[0][0], q[1][0], q[2][0])) + 1);
    const y0 = Math.max(0, Math.floor(Math.min(q[0][1], q[1][1], q[2][1])) - 1); const y1 = Math.min(h - 1, Math.ceil(Math.max(q[0][1], q[1][1], q[2][1])) + 1);
    if (Math.abs(area) < 1e-6) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) data.set(rgba, (y * w + x) * 4); return; }
    const grow = 1.2 / Math.sqrt(Math.abs(area));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const cx = x + 0.5; const cy = y + 0.5;
      const s0 = ((q[1][0] - q[0][0]) * (cy - q[0][1]) - (q[1][1] - q[0][1]) * (cx - q[0][0])) / area;
      const s1 = ((q[2][0] - q[1][0]) * (cy - q[1][1]) - (q[2][1] - q[1][1]) * (cx - q[1][0])) / area;
      const s2 = ((q[0][0] - q[2][0]) * (cy - q[2][1]) - (q[0][1] - q[2][1]) * (cx - q[2][0])) / area;
      if (s0 >= -grow && s1 >= -grow && s2 >= -grow) data.set(rgba, (y * w + x) * 4);
    }
  };
  let n = 0;
  for (const m of car.meshes) for (const p of m.parts) {
    if (p.flags[0] !== 1) continue;
    for (let t = 0; t < p.indices.length; t += 3) {
      fillImg(car.mask, mrgba, p.uvs, p.indices[t], p.indices[t + 1], p.indices[t + 2]);
      if (car.color) fillImg(car.color, crgba, p.uvs, p.indices[t], p.indices[t + 1], p.indices[t + 2]);
      n++;
    }
  }
  paint.dirty = true;
  if (car.color) { car.colorDirty = true; car.colorImg.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(car.color.data), car.color.w, car.color.h), 0, 0); }
  maskChanged();
  status(n ? `ตั้งกระจก ${n.toLocaleString()} สามเหลี่ยม เป็น "${$('glass-look').selectedOptions[0].textContent}" · กด ⬇ ดาวน์โหลดแล้วลองในเกม` : 'รถคันนี้ไม่มีชิ้นกระจก (ชนิด 1)');
});
// ⤒ the whole layout (every UV of the body-mask files, the flat colour spots and glass too) moved up — and
// made smaller only if there is no room — until nothing is left in the game's block; the paint mask and the
// colour layer move with it, so every panel keeps its colour.
$('btn-clear-zone').addEventListener('click', () => {
  if (!car.meshes.length) return;
  const M = 0.008; // margin
  let minU = Infinity; let minV = Infinity; let confV = -Infinity;
  for (const m of car.meshes) for (const p of m.parts) for (let i = 0; i < p.uvs.length; i += 2) {
    const u = p.uvs[i]; const v = p.uvs[i + 1];
    minU = Math.min(minU, u); minV = Math.min(minV, v);
    if (inBlock(u - M, v + M)) confV = Math.max(confV, v);
  }
  const limit = 0.69 - M;
  if (confV <= limit) { status('ไม่มีลายเส้นอยู่ในโซนของเกมแล้ว ✅'); return; }
  let s = 1; let dv = confV - limit; // shift up
  if (minV - dv < M) { // no room: shrink about the top-left of the layout, then shift
    s = (limit - M) / (confV - minV); dv = 0;
  }
  const tf = (u, v) => (s === 1 ? [u, v - dv] : [minU + (u - minU) * s, M + (v - minV) * s]);
  const inv = (u, v) => (s === 1 ? [u, v + dv] : [minU + (u - minU) / s, minV + (v - M) / s]);
  undo.push(comboSnap()); if (undo.length > 60) undo.shift(); redo.length = 0;
  for (const m of car.meshes) { for (const p of m.parts) for (let i = 0; i < p.uvs.length; i += 2) { const [u, v] = tf(p.uvs[i], p.uvs[i + 1]); p.uvs[i] = u; p.uvs[i + 1] = v; } m.dirty = true; }
  const moveImg = (img, fill, keepBlock) => {
    const { w, h, data } = img; const src = data.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4; const u = (x + 0.5) / w; const v = (y + 0.5) / h;
      if (keepBlock && u <= RESERVED[2] && v >= RESERVED[1]) continue; // the game's block stays
      const [su, sv] = inv(u, v);
      if (su < 0 || su >= 1 || sv < 0 || sv >= 1) { data.set(fill, o); continue; }
      const sx = Math.floor(su * w); const sy = Math.floor(sv * h); const so = (sy * w + sx) * 4;
      if (keepBlock && (sx + 0.5) / w <= RESERVED[2] && (sy + 0.5) / h >= RESERVED[1]) { data.set(fill, o); continue; }
      data.set(src.subarray(so, so + 4), o);
    }
  };
  if (car.mask) { moveImg(car.mask, [255, 0, 0, 255], false); paint.dirty = true; }
  if (car.color) { moveImg(car.color, [0, 0, 0, 0], true); car.colorDirty = true; car.colorImg.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(car.color.data), car.color.w, car.color.h), 0, 0); }
  if (car.mask) maskChanged();
  update3DUVs(); refresh();
  status(s === 1 ? `ย้ายลายเส้นทั้งหมดขึ้น ${(dv * 100).toFixed(1)}% ของรูป (สีย้ายตามไปด้วย) · ไม่มีอะไรอยู่ในโซนเกมแล้ว · กด ⬇ ดาวน์โหลด` : `ที่ไม่พอ: ย่อทั้งหมดเหลือ ${(s * 100).toFixed(0)}% แล้วย้ายขึ้น (สีย้ายตาม) · กด ⬇ ดาวน์โหลด`);
});

// ---------------------------------------------------------------------------------------------
// UI

function refresh() {
  const st = draw2D();
  let isl = 0; for (const m of car.meshes) for (const q of m.isl) isl += q.count;
  const art = draw2D.onArt || 0;
  $('stats').textContent = car.meshes.length ? `เกาะ UV ${isl.toLocaleString()} · เลือก ${selected.size}\nสามเหลี่ยมลายยืด (แดง): ${st.toLocaleString()}${st ? ' → กด 🩹' : ' ✅'}\nสามเหลี่ยมทับลาย/โซนเกม (ม่วง): ${art.toLocaleString()}${art ? ' → กด 🧽 หรือย้ายเกาะออก' : ' ✅'}` : '';
  if ($('spot-info')) {
    // pieces sitting on one texel, by the mask colour there
    const cnt = { R: 0, G: 0, B: 0, K: 0 };
    if (car.mask) for (const m of car.meshes) for (const p of m.parts) {
      if (p.positions.length / 3 <= 8 || p.flags[0] === 1) continue;
      for (let t = 0; t < p.indices.length; t += 3) {
        const [a, b, c] = [p.indices[t], p.indices[t + 1], p.indices[t + 2]]; const U = p.uvs;
        if (Math.abs((U[b * 2] - U[a * 2]) * (U[c * 2 + 1] - U[a * 2 + 1]) - (U[c * 2] - U[a * 2]) * (U[b * 2 + 1] - U[a * 2 + 1])) > 1e-12) continue;
        const x = Math.min(car.mask.w - 1, Math.max(0, Math.floor(U[a * 2] * car.mask.w))); const y = Math.min(car.mask.h - 1, Math.max(0, Math.floor(U[a * 2 + 1] * car.mask.h)));
        const o = (y * car.mask.w + x) * 4; const d = car.mask.data;
        cnt[d[o] > 128 ? 'R' : d[o + 1] > 128 ? 'G' : d[o + 2] > 128 ? 'B' : 'K']++;
      }
    }
    const any = cnt.R + cnt.G + cnt.B + cnt.K;
    $('spot-info').textContent = !car.meshes.length ? '' : any ? `ชิ้นที่ทั้งชิ้นใช้จุดสีเดียว: แดง ${cnt.R.toLocaleString()} · เขียว ${cnt.G.toLocaleString()} · น้ำเงิน ${cnt.B.toLocaleString()} · ดำ ${cnt.K.toLocaleString()} สามเหลี่ยม — คลิกที่จุดในจอซ้าย = ไฮไลต์ชิ้นนั้นบนรถ (สีส้ม)` : 'ไม่มีชิ้นไหนใช้จุดสี (จุดที่เห็นบนรูปไม่มีชิ้นไหนใช้ ลบได้)';
  }
  if ($('face-info')) { const f = car.meshes.length ? facing() : 0; $('face-info').textContent = !car.meshes.length ? '' : f > 0 ? '⚠ หน้ารถบนรูปหันซ้าย (รถในเกมหันขวา) → ลายในร้านจะกลับหน้า-หลัง · กด ⇋' : f < 0 ? '✅ หน้ารถบนรูปหันขวาแบบรถในเกม' : ''; }
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
const nowLike = (s) => (s.combo ? comboSnap() : s.mask ? { mask: car.mask.data.slice() } : snapshot());
$('btn-undo').addEventListener('click', () => { if (undo.length) { const s = undo.pop(); redo.push(nowLike(s)); restore(s); } });
$('btn-redo').addEventListener('click', () => { if (redo.length) { const s = redo.pop(); undo.push(nowLike(s)); restore(s); } });
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
  const mtl = new TextEncoder().encode([...KIND_MTL, ...KIND_MTL.map((k) => `${k}_holder`), 'mask'].map((k) => `newmtl ${k}\nmap_Kd ${car.name}_base.png\n`).join(''));
  const files = [{ path: `${car.name}.obj`, data: exportOBJ() }, { path: `${car.name}.mtl`, data: mtl }];
  if (car.files.has(`${car.name}_base.png`)) files.push({ path: `${car.name}_base.png`, data: car.files.get(`${car.name}_base.png`) });
  const a = document.createElement('a'); a.href = URL.createObjectURL(await makeZip(files)); a.download = `${car.name}_blender.zip`; a.click();
  status('แตก zip แล้วเปิด .obj ใน Blender (File › Import › Wavefront) · แก้เสร็จ Export เป็น .obj แล้วกด ⬆ นำกลับ');
});
$('btn-blender-in').addEventListener('click', () => objIn.click());
objIn.addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; if (!car.meshes.length) { status('เปิดรถ (.zip ที่ใช้ส่งออก) ก่อน แล้วค่อยกด ⬆ นำกลับ'); return; } await importOBJ(await f.text()); });
window.addEventListener('keydown', (e) => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); $(e.shiftKey ? 'btn-redo' : 'btn-undo').click(); }
  else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); $('btn-redo').click(); }
  else if (k === 'b') $('btn-paint').click();
  else if (paint.on && ['1', '2', '3', '0'].includes(k)) document.querySelector(`#paint-slots button[data-slot="${k}"]`).click();
  else if (paint.on && k === 'i') setMode('pick');
  else if (paint.on && k === 'enter' && paint.mode === 'select') $('btn-sel-paint').click();
  else if (modal && k === 'enter') { e.preventDefault(); modalEnd(true); }
  else if (modal && k === 'escape') modalEnd(false);
  else if (!paint.on && (k === 'g' || k === 'r' || k === 's') && !e.ctrlKey && !e.metaKey) modalStart(k.toUpperCase());
  else if (!paint.on && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(k) && (selected.size || selectedPts.size)) {
    e.preventDefault(); const st = (e.shiftKey ? 10 : 1) / 1024; const du = k === 'arrowleft' ? -st : k === 'arrowright' ? st : 0; const dv = k === 'arrowup' ? -st : k === 'arrowdown' ? st : 0;
    beginEdit(); forSelectedVerts((p, i) => { p.uvs[i * 2] += du; p.uvs[i * 2 + 1] += dv; }); endEdit();
  }
  else if (k === 'tab') { e.preventDefault(); $('pick-mode').value = $('pick-mode').value === 'island' ? 'point' : 'island'; selected = new Set(); selectedPts = new Map(); refresh(); status($('pick-mode').value === 'point' ? 'โหมดจุด: คลิก/ลากกรอบเลือกจุด UV' : 'โหมดเกาะ'); }
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
