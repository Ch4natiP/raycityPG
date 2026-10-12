// RayCity Easy: the whole job on one page, step by step — open a model (with its pictures), choose the body
// (an existing game car bent to the model's shape, or a new body from the model's own surface cut into the
// template's UV islands), name and colours, build, see the car / its UVs / the checks, download.
// RayCity space: x left, y back, z up; three.js shows it as (x, z, −y).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadModel, convert, bendTemplate, turnAround, GAME_WHEELS, fitToWheels, decodePNG, dds, tailColoursOnMask } from '../convert.js';
import { parseOM, writeOM, omParts } from '../om.js';
import { makeZip, readZip } from '../zip.js';
import { checkCar, renderChecks, innerName } from '../checkCar.js';

const $ = (id) => document.getElementById(id);
const state = { model: null, modelName: '', template: null, out: null, outName: '' };

// ---------------------------------------------------------------------------------------------
// Templates: gtv98 from the page, or any car folder / zip the user gives

async function embedded(name) {
  const b64 = (window.RC_TEMPLATES || {})[name];
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const json = await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  return { name, files: new Map(Object.entries(JSON.parse(json)).map(([p, d]) => [p, Uint8Array.from(atob(d), (c) => c.charCodeAt(0))])) };
}
const templates = {};
async function currentTemplate() {
  const k = $('tpl-sel').value;
  if (!templates[k] && (window.RC_TEMPLATES || {})[k]) templates[k] = await embedded(k);
  return templates[k];
}
async function addTemplateZip(file) {
  const entries = await readZip(new Uint8Array(await file.arrayBuffer()));
  const body = entries.find((e) => /(^|\/)body_2\.0m$/i.test(e.path));
  if (!body) { $('build-log').textContent = 'zip นี้ไม่ใช่โฟลเดอร์รถ RayCity (ไม่มี body_2.0m)'; return; }
  const root = body.path.replace(/body_2\.0m$/i, '');
  const files = new Map(entries.filter((e) => e.path.startsWith(root)).map((e) => [e.path.slice(root.length), e.data]));
  const name = innerName(files) || file.name.replace(/\.zip$/i, '');
  templates[name] = { name, files };
  const o = document.createElement('option'); o.value = name; o.textContent = `${name} (จาก zip)`;
  $('tpl-sel').appendChild(o); $('tpl-sel').value = name;
}

// ---------------------------------------------------------------------------------------------
// 3D view

const gl = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: true });
const scene = new THREE.Scene(); scene.background = new THREE.Color('#2e2e2e');
scene.add(new THREE.HemisphereLight('#ffffff', '#4a4a4a', 2.2));
const sun = new THREE.DirectionalLight('#ffffff', 1.2); sun.position.set(4, 8, 5); scene.add(sun);
scene.add(new THREE.GridHelper(12, 24, '#555', '#3d3d3d'));
const cam = new THREE.PerspectiveCamera(38, 1, 0.02, 100); cam.position.set(5, 2.6, 6);
const controls = new OrbitControls(cam, gl); controls.target.set(0, 0.6, 0);
const modelGroup = new THREE.Group(); modelGroup.rotation.x = -Math.PI / 2; scene.add(modelGroup);
const carGroup = new THREE.Group(); carGroup.rotation.x = -Math.PI / 2; scene.add(carGroup);
let tab = 'model';

function showModel() {
  modelGroup.clear();
  const m = state.model; if (!m) return;
  const keep = []; const gone = [];
  for (let t = 0; t < m.C.length; t++) (m.removed[m.C[t]] ? gone : keep).push(t);
  const geo = (list, colours) => {
    const pos = new Float32Array(list.length * 9); const col = colours ? new Float32Array(list.length * 9) : null;
    list.forEach((t, i) => { pos.set(m.P.subarray(t * 9, t * 9 + 9), i * 9); if (col) { if (m.TC?.length && m.textured) col.set(m.TC.subarray(t * 9, t * 9 + 9), i * 9); else col.fill(0.75, i * 9, i * 9 + 9); } });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals(); return g;
  };
  modelGroup.add(new THREE.Mesh(geo(keep, true), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, side: THREE.DoubleSide })));
  if (gone.length) modelGroup.add(new THREE.Mesh(geo(gone, false), new THREE.MeshStandardMaterial({ color: '#ff2bd6', transparent: true, opacity: 0.45, depthWrite: false })));
  // the game's wheels
  const gw = GAME_WHEELS.gtv98; const tyre = new THREE.MeshStandardMaterial({ color: '#111', transparent: true, opacity: 0.6 });
  for (const y of [gw.front, gw.rear]) for (const x of [-gw.track, gw.track]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(gw.radius, gw.radius, 0.22, 24).rotateZ(Math.PI / 2), tyre); c.position.set(x, y, gw.radius); c.rotation.x = Math.PI / 2; modelGroup.add(c); }
}

let maskCanvas = null;
async function showCar() {
  carGroup.clear();
  if (!state.out) return;
  const name = state.outName;
  maskCanvas = null;
  try {
    const m = await decodePNG(state.out.get(`${name}_base.png`));
    maskCanvas = document.createElement('canvas'); maskCanvas.width = m.w; maskCanvas.height = m.h;
    maskCanvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(m.data), m.w, m.h), 0, 0);
  } catch { /* no mask */ }
  const tex = maskCanvas ? new THREE.CanvasTexture(maskCanvas) : null;
  if (tex) { tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; }
  for (const [rel, b] of state.out) {
    if (!(rel === 'body_2.0m' || /^[^/]+\/default_2\.0m$/.test(rel))) continue;
    const om = parseOM(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    omParts(om).forEach((p) => {
      if (p.positions.length / 3 <= 8) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p.positions, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(p.normals, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(p.uvs, 2));
      g.setIndex(new THREE.BufferAttribute(Uint32Array.from(p.indices), 1));
      const mat = p.flags[0] === 1 ? new THREE.MeshStandardMaterial({ color: '#7fb0e0', transparent: true, opacity: 0.35 }) : new THREE.MeshStandardMaterial({ map: tex, color: tex ? '#ffffff' : '#cccccc', roughness: 0.5 });
      carGroup.add(new THREE.Mesh(g, mat));
    });
  }
}

// ---------------------------------------------------------------------------------------------
// UV tab: the car's UVs on its mask, the template's sheet faint behind

const uvc = $('uv'); const g2 = uvc.getContext('2d');
// UV triangles (u,v × 3 per triangle) of the drawn files, read once per set of files
const uvCache = new WeakMap();
function uvTris(files) {
  const key = files.get('body_2.0m'); if (key && uvCache.has(key) && uvCache.get(key).files === files && uvCache.get(key).size === files.size) return uvCache.get(key).T;
  const out = [];
  for (const [rel, b] of files) {
    if (!(rel === 'body_2.0m' || /^[^/]+\/default_2\.0m$/.test(rel))) continue;
    const om = parseOM(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    for (const s of om.submeshes) {
      if (s.vertexCount <= 8) continue;
      for (let i = s.indexStart; i < s.indexStart + s.indexCount; i++) { const v = om.indices[i] + s.vertexStart; out.push(om.uvs[v * 2], om.uvs[v * 2 + 1]); }
    }
  }
  const T = new Float32Array(out);
  if (key) uvCache.set(key, { files, size: files.size, T });
  return T;
}
function drawUV() {
  const r = uvc.getBoundingClientRect(); uvc.width = Math.round(r.width); uvc.height = Math.round(r.height);
  g2.fillStyle = '#1d1d1d'; g2.fillRect(0, 0, uvc.width, uvc.height);
  if (!state.out) { g2.fillStyle = '#888'; g2.fillText('สร้างรถก่อน', 20, 60); return; }
  const S = Math.min(uvc.width, uvc.height) * 0.9; const ox = (uvc.width - S) / 2; const oy = (uvc.height - S) / 2 + 16;
  if (maskCanvas) { g2.globalAlpha = 0.55; g2.drawImage(maskCanvas, ox, oy, S, S); g2.globalAlpha = 1; }
  const tri = (files, style) => {
    g2.strokeStyle = style; g2.lineWidth = 0.6; g2.beginPath();
    const T = uvTris(files);
    for (let i = 0; i < T.length; i += 6) {
      g2.moveTo(ox + T[i] * S, oy + T[i + 1] * S); g2.lineTo(ox + T[i + 2] * S, oy + T[i + 3] * S); g2.lineTo(ox + T[i + 4] * S, oy + T[i + 5] * S); g2.closePath();
    }
    g2.stroke();
  };
  if (state.template) tri(state.template.files, 'rgba(255,255,255,0.15)');
  tri(state.out, 'rgba(255,230,120,0.8)');
  g2.fillStyle = '#ccc'; g2.fillText('เส้นเหลือง = UV ของรถเรา · เส้นจาง = แผงของรถต้นแบบ · แดง/เขียว/น้ำเงิน = สี 1/2/3 · ดำ = ไม่รับสี', ox, oy - 6);
}

function setTab(t) {
  tab = t;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  gl.hidden = t === 'uv'; uvc.hidden = t !== 'uv';
  modelGroup.visible = t === 'model'; carGroup.visible = t === 'car';
  $('legend').hidden = t === 'uv';
  if (t === 'uv') drawUV();
}
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

function loop() {
  const r = gl.getBoundingClientRect();
  if (gl.width !== Math.round(r.width) || gl.height !== Math.round(r.height)) { renderer.setSize(r.width, r.height, false); cam.aspect = r.width / Math.max(1, r.height); cam.updateProjectionMatrix(); }
  controls.update(); renderer.render(scene, cam); requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------------------------
// Steps

async function modelFiles(list) {
  const out = [];
  for (const f of list) {
    if (/\.zip$/i.test(f.name)) for (const e of await readZip(new Uint8Array(await f.arrayBuffer()))) out.push(new File([e.data], e.path.split('/').pop()));
    else out.push(f);
  }
  return out;
}
async function openModel(list) {
  const files = await modelFiles([...list]);
  const main = files.find((f) => /\.(glb|gltf|fbx|obj)$/i.test(f.name));
  if (!main) { $('model-info').textContent = 'ไม่เจอไฟล์โมเดล (.glb .gltf .fbx .obj)'; return; }
  $('model-info').textContent = `กำลังเปิด ${main.name}…`;
  try { state.model = await loadModel(files); } catch (e) { $('model-info').textContent = `เปิดไม่ได้: ${e.message}`; return; }
  state.modelName = main.name.replace(/\.[^.]+$/, '');
  const fit = $('fit-wheels').checked ? fitToWheels(state.model, GAME_WHEELS.gtv98, 'uniform') : null;
  const m = state.model;
  $('model-info').textContent = `${main.name}${files.length > 1 ? ` + ${files.length - 1} ไฟล์ประกอบ` : ''}\n${m.C.length.toLocaleString()} สามเหลี่ยม · เจอล้อ ${m.wheels.length} ล้อ (ถอดออก · สีชมพู)${fit ? `\nปรับให้ตรงล้อเกม: ${fit}` : ''}`;
  $('car-name').value = `rc_${state.modelName.replace(/[^a-z0-9]+/gi, '_').toLowerCase().replace(/^_|_$/g, '').slice(0, 20) || 'car'}`;
  // a pickup by its name: whole car / hood / tailgate colours
  if (/pick.?up|truck|canyon|hilux|ranger|tacoma|f.?150|silverado|navara|d.?max|triton|colorado|tundra|ram.?1500|revo/i.test(main.name)) { $('colour-sel').value = 'pickup'; $('model-info').textContent += '\nดูเหมือนกระบะ → เลือกสี "กระบะ 3 สี" ให้แล้ว'; }
  $('flip-row').hidden = false;
  $('s1').classList.add('done');
  $('btn-build').disabled = false;
  showModel(); setTab('model');
}

async function build() {
  const btn = $('btn-build'); btn.disabled = true;
  const logEl = $('build-log'); logEl.textContent = '';
  const say = (t) => { logEl.textContent = `${t}\n${logEl.textContent}`.split('\n').slice(0, 5).join('\n'); };
  const name = $('car-name').value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_') || 'rc_car';
  $('car-name').value = name;
  try {
    const template = await currentTemplate();
    state.template = template;
    const colours = $('colour-sel').value;
    const oneColour = colours === 'one';
    const pickup = colours === 'pickup';
    let out;
    if (document.querySelector('input[name=body]:checked').value === 'old') {
      say(`ดัดตัวถัง ${template.name} ให้เป็นทรงโมเดล…`);
      out = await bendTemplate(state.model, { name, template, log: say });
      if (colours === 'tail' || pickup) {
        const n = await tailColoursOnMask(out, name, { pickup });
        say(`3 สี: ตัวถัง / ฝากระโปรง / ฝาท้าย (${n.toLocaleString()} สามเหลี่ยม)`);
      }
      if (oneColour) {
        // one colour: the template's mask all red (slot 1), same size
        const m = await decodePNG(out.get(`${name}_base.png`));
        const px = new Uint8ClampedArray(m.w * m.h * 4); for (let i = 0; i < px.length; i += 4) px.set([255, 0, 0, 255], i);
        const { png } = await import('../convert.js');
        out.set(`${name}_base.png`, await png(px, m.w, m.h)); out.set(`${name}_base_s.dds`, dds(px, m.w, m.h, 'full'));
      }
    } else {
      out = await convert(state.model, { name, template, raw: true, hideInterior: true, maxVerts: +$('poly-sel').value, paintAll: oneColour, slots: !oneColour, colours, layout: 'charts', partTextures: false, log: say });
    }
    state.out = out; state.outName = name;
    say(`เสร็จ: ${out.size} ไฟล์`);
    renderChecks($('checks'), await checkCar(out, name, template));
    $('btn-download').disabled = false; $('btn-paint').disabled = false; $('btn-blender-out').disabled = false; $('btn-blender-in').disabled = false;
    $('s4').classList.add('done');
    await showCar(); setTab('car');
  } catch (e) { console.error(e); say(`ผิดพลาด: ${e.message}`); }
  btn.disabled = false;
}

function download(blob, filename) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); }
async function downloadZip() {
  const zipFiles = [...state.out].sort((a, b) => a[0].localeCompare(b[0])).map(([rel, data]) => ({ path: `${state.outName}/${rel}`, data }));
  download(await makeZip(zipFiles), `${state.outName}.zip`);
  $('s5').classList.add('done');
}

// ---------------------------------------------------------------------------------------------
// Blender round trip (UVs only; matched back by position within 2 mm)

function meshesOf(files) {
  return [...files.keys()].filter((r) => r === 'body_2.0m' || /^[^/]+\/default_2\.0m$/.test(r)).sort().map((rel) => {
    const b = files.get(rel); const om = parseOM(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    return { rel, om, orig: b, parts: omParts(om) };
  });
}
async function blenderOut() {
  const name = state.outName; const lines = [`mtllib ${name}.mtl`, 'usemtl mask']; let vo = 1;
  for (const m of meshesOf(state.out)) m.parts.forEach((p, pi) => {
    if (p.positions.length / 3 <= 8) return;
    lines.push(`o ${m.rel.replace(/\//g, '__')}#${pi}`);
    for (let i = 0; i < p.positions.length / 3; i++) lines.push(`v ${p.positions[i * 3].toFixed(6)} ${p.positions[i * 3 + 2].toFixed(6)} ${(-p.positions[i * 3 + 1]).toFixed(6)}`);
    for (let i = 0; i < p.positions.length / 3; i++) lines.push(`vt ${p.uvs[i * 2].toFixed(6)} ${(1 - p.uvs[i * 2 + 1]).toFixed(6)}`);
    for (let t = 0; t < p.indices.length; t += 3) lines.push(`f ${[0, 1, 2].map((k) => { const x = p.indices[t + k] + vo; return `${x}/${x}`; }).join(' ')}`);
    vo += p.positions.length / 3;
  });
  const files = [{ path: `${name}.obj`, data: new TextEncoder().encode(lines.join('\n')) }, { path: `${name}.mtl`, data: new TextEncoder().encode(`newmtl mask\nmap_Kd ${name}_base.png\n`) }, { path: `${name}_base.png`, data: state.out.get(`${name}_base.png`) }];
  download(await makeZip(files), `${name}_blender.zip`);
}
async function blenderIn(text) {
  const V = []; const T = []; const faces = new Map(); let obj = '';
  for (const line of text.split(/\r?\n/)) {
    const w = line.trim().split(/\s+/);
    if (w[0] === 'v') V.push([+w[1], +w[2], +w[3]]);
    else if (w[0] === 'vt') T.push([+w[1], +w[2]]);
    else if (w[0] === 'o' || w[0] === 'g') obj = w.slice(1).join(' ').replace(/\.\d+$/, '');
    else if (w[0] === 'f') {
      const c = w.slice(1).map((s) => { const [a, b] = s.split('/'); return { p: V[+a < 0 ? V.length + +a : +a - 1], t: T[+b < 0 ? T.length + +b : +b - 1] || [0, 0] }; });
      for (let k = 1; k + 1 < c.length; k++) { if (!faces.has(obj)) faces.set(obj, []); faces.get(obj).push([c[0], c[k], c[k + 1]]); }
    }
  }
  const CELL = 500; let matched = 0; let missing = 0;
  for (const m of meshesOf(state.out)) {
    let changed = false;
    m.parts.forEach((p, pi) => {
      if (p.positions.length / 3 <= 8) return;
      const nm = `${m.rel.replace(/\//g, '__')}#${pi}`;
      const list = faces.get(nm) || [...faces.entries()].find(([k]) => k.startsWith(nm))?.[1];
      if (!list) { missing += p.indices.length / 3; return; }
      const P = p.positions; const grid = new Map(); const canon = new Int32Array(P.length / 3);
      const key = (x, y, z) => `${x},${y},${z}`;
      const near = (q) => { const cx = Math.round(q[0] * CELL); const cy = Math.round(q[1] * CELL); const cz = Math.round(q[2] * CELL); let best = -1; let bd = 4e-6; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) for (const i of grid.get(key(cx + a, cy + b, cz + c)) || []) { const d = (P[i * 3] - q[0]) ** 2 + (P[i * 3 + 2] - q[1]) ** 2 + (-P[i * 3 + 1] - q[2]) ** 2; if (d < bd) { bd = d; best = i; } } return best < 0 ? -1 : canon[best]; };
      for (let i = 0; i < P.length / 3; i++) { const q = [P[i * 3], P[i * 3 + 2], -P[i * 3 + 1]]; const c0 = near(q); canon[i] = c0 >= 0 ? c0 : i; const k = key(Math.round(q[0] * CELL), Math.round(q[1] * CELL), Math.round(q[2] * CELL)); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); }
      const byTri = new Map();
      for (const f of list) { const ids = f.map((c) => near(c.p)); if (ids.includes(-1)) continue; f.ids = ids; byTri.set([...ids].sort((a, b) => a - b).join('|'), f); }
      const nP = []; const nN = []; const nUV = []; const nI = []; const keyOf = new Map();
      for (let t = 0; t < p.indices.length; t += 3) {
        const v = [p.indices[t], p.indices[t + 1], p.indices[t + 2]]; const ids = v.map((i) => canon[i]);
        const f = byTri.get([...ids].sort((a, b) => a - b).join('|')); if (f) matched++; else missing++;
        for (let j = 0; j < 3; j++) {
          let uv = [p.uvs[v[j] * 2], p.uvs[v[j] * 2 + 1]];
          if (f) { const c = f[f.ids.indexOf(ids[j])]; if (c) uv = [c.t[0], 1 - c.t[1]]; }
          const kk = `${v[j]}|${uv[0].toFixed(5)},${uv[1].toFixed(5)}`;
          let n = keyOf.get(kk);
          if (n === undefined) { n = nP.length / 3; keyOf.set(kk, n); nP.push(P[v[j] * 3], P[v[j] * 3 + 1], P[v[j] * 3 + 2]); nN.push(p.normals[v[j] * 3], p.normals[v[j] * 3 + 1], p.normals[v[j] * 3 + 2]); nUV.push(uv[0], uv[1]); }
          nI.push(n);
        }
      }
      p.positions = new Float32Array(nP); p.normals = new Float32Array(nN); p.uvs = new Float32Array(nUV); p.indices = Uint32Array.from(nI); changed = true;
    });
    if (!changed) continue;
    const bytes = writeOM(m.om, m.parts.map((q) => ({ ...q, kind: q.flags[0] })));
    for (const [rel, b] of state.out) if (b.length === m.orig.length && b.every((x, i) => x === m.orig[i])) state.out.set(rel, bytes);
  }
  $('build-log').textContent = `นำ UV จาก Blender: ตรงกัน ${matched.toLocaleString()} สามเหลี่ยม${missing ? ` · ไม่เจอ ${missing.toLocaleString()} (คง UV เดิม)` : ''}`;
  renderChecks($('checks'), await checkCar(state.out, state.outName, state.template));
  await showCar(); setTab('uv');
}

// ---------------------------------------------------------------------------------------------
// Wiring

const input = $('file-model');
$('btn-open').addEventListener('click', () => input.click());
input.addEventListener('change', (e) => { if (e.target.files.length) openModel(e.target.files); e.target.value = ''; });
const drop = $('drop');
['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
drop.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files.length) openModel(e.dataTransfer.files); });
window.addEventListener('dragover', (e) => e.preventDefault()); window.addEventListener('drop', (e) => e.preventDefault());
$('btn-flip').addEventListener('click', () => { if (state.model) { turnAround(state.model); showModel(); } });
document.querySelectorAll('input[name=body]').forEach((r) => r.addEventListener('change', () => {
  const old = document.querySelector('input[name=body]:checked').value === 'old';
  $('old-opts').hidden = !old; $('new-opts').hidden = old;
}));
$('btn-tpl').addEventListener('click', () => $('file-tpl').click());
$('file-tpl').addEventListener('change', async (e) => { if (e.target.files[0]) await addTemplateZip(e.target.files[0]); e.target.value = ''; });
$('btn-build').addEventListener('click', build);
$('btn-download').addEventListener('click', downloadZip);
// 🖌: the car to the RayCity UV page (paint the colours by clicking panels, edit UVs), sent by message
$('btn-paint').addEventListener('click', () => {
  const files0 = [...state.out].map(([rel, data]) => ({ path: `${state.outName}/${rel}`, data }));
  // inside the one-page RayCity: its UV tab takes the car
  if (window.parent !== window) { window.parent.postMessage({ type: 'rc-open-uv', files: files0 }, '*'); return; }
  const w = window.open('RayCity-UV.html', '_blank');
  if (!w) { $('build-log').textContent = 'เบราว์เซอร์บล็อกหน้าต่างใหม่ · อนุญาต pop-up แล้วกดอีกครั้ง'; return; }
  const files = [...state.out].map(([rel, data]) => ({ path: `${state.outName}/${rel}`, data }));
  const onMsg = (e) => { if (e.source === w && e.data?.type === 'rc-uv-ready') { w.postMessage({ type: 'rc-car', files }, '*'); window.removeEventListener('message', onMsg); } };
  window.addEventListener('message', onMsg);
});
$('btn-blender-out').addEventListener('click', blenderOut);
$('btn-blender-in').addEventListener('click', () => $('file-obj').click());
$('file-obj').addEventListener('change', async (e) => { if (e.target.files[0]) await blenderIn(await e.target.files[0].text()); e.target.value = ''; });
new ResizeObserver(() => { if (tab === 'uv') drawUV(); }).observe(uvc.parentElement);
document.addEventListener('click', (e) => { if (e.target.closest('button')) e.target.closest('button').blur(); });

setTab('model');
loop();
window.easy = { state, openModel, build, cam, controls };
