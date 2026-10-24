// RayCity Drive: a browser racing prototype. A RayCity car folder (.zip, the game's own .0m meshes, mask and
// colour layer) driven on a closed track: arcade physics, drift on the handbrake, lap timer, brake / reverse
// lamps lit like in the game (kind 4 red braking, kind 3 white reversing).
import * as THREE from 'three';
import { parseOM, omParts } from '../om.js';
import { readZip } from '../zip.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------------------------
// Scene

const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#7fa6d6');
scene.fog = new THREE.Fog('#7fa6d6', 120, 420);
const cam = new THREE.PerspectiveCamera(62, 1, 0.1, 1000);
scene.add(new THREE.HemisphereLight('#dfe9ff', '#3b4a2c', 0.9));
const sun = new THREE.DirectionalLight('#ffffff', 1.6);
sun.position.set(-60, 120, 40); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 300 });
scene.add(sun, sun.target);
function resize() { renderer.setSize(window.innerWidth, window.innerHeight, false); cam.aspect = window.innerWidth / window.innerHeight; cam.updateProjectionMatrix(); }
window.addEventListener('resize', resize); resize();

// ---------------------------------------------------------------------------------------------
// Track: a closed loop (centre line), drawn into the ground texture; checkpoints along it

const TRACK = (() => {
  const pts = []; const N = 240;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    // a rounded, wavy loop (≈ 1.2 km)
    const r = 150 + 28 * Math.sin(a * 3) + 14 * Math.cos(a * 5);
    pts.push(new THREE.Vector2(Math.cos(a) * r * 1.25, Math.sin(a) * r * 0.8));
  }
  return pts;
})();
const ROAD_W = 14; const WORLD = 640;
{
  const S = 2048; const cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d');
  const toPx = (p) => [(p.x / WORLD + 0.5) * S, (p.y / WORLD + 0.5) * S];
  g.fillStyle = '#4c6b34'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 6000; i++) { g.fillStyle = Math.random() < 0.5 ? '#46632f' : '#55753a'; g.fillRect(Math.random() * S, Math.random() * S, 3, 3); }
  const path = () => { g.beginPath(); TRACK.forEach((p, i) => { const [x, y] = toPx(p); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.closePath(); };
  const w = (m) => (m / WORLD) * S;
  g.lineJoin = 'round'; g.strokeStyle = '#d8d8d8'; g.lineWidth = w(ROAD_W + 1.6); path(); g.stroke();
  g.strokeStyle = '#c0392b'; g.setLineDash([w(3), w(3)]); g.lineWidth = w(ROAD_W + 1.6); path(); g.stroke(); g.setLineDash([]);
  g.strokeStyle = '#3a3d42'; g.lineWidth = w(ROAD_W); path(); g.stroke();
  g.strokeStyle = '#f2f2f2'; g.setLineDash([w(4), w(5)]); g.lineWidth = w(0.3); path(); g.stroke(); g.setLineDash([]);
  // start / finish
  const a = TRACK[0]; const b = TRACK[1]; const d = new THREE.Vector2().subVectors(b, a).normalize(); const n = new THREE.Vector2(-d.y, d.x);
  for (let k = -6; k < 6; k++) for (let j = 0; j < 2; j++) { g.fillStyle = (k + j) % 2 ? '#111' : '#fff'; const c = a.clone().addScaledVector(n, k * (ROAD_W / 12) + ROAD_W / 24).addScaledVector(d, j * 1.2); const [x, y] = toPx(c); g.fillRect(x - w(0.6), y - w(0.6), w(1.2), w(1.2)); }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(WORLD, WORLD), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  // tyre walls / cones on the outside of the bends, a few buildings
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.9, 10), new THREE.MeshStandardMaterial({ color: '#ff7a1a' }));
  TRACK.forEach((p, i) => { if (i % 4) return; const q = TRACK[(i + 1) % TRACK.length]; const dd = new THREE.Vector2().subVectors(q, p).normalize(); for (const s of [-1, 1]) { const c = cone.clone(); const o = p.clone().addScaledVector(new THREE.Vector2(-dd.y, dd.x), s * (ROAD_W / 2 + 2)); c.position.set(o.x, 0.45, o.y); c.castShadow = true; scene.add(c); } });
  const box = new THREE.BoxGeometry(1, 1, 1);
  // buildings well away from the road (inside the loop and around it)
  for (let i = 0, n = 0; i < 2000 && n < 70; i++) { const x = (Math.random() - 0.5) * (WORLD - 40); const z = (Math.random() - 0.5) * (WORLD - 40); const sx = 10 + Math.random() * 14; const sz = 10 + Math.random() * 14; if (onTrack(x, z).dist < ROAD_W / 2 + 6 + Math.max(sx, sz) * 0.75) continue; const h = 8 + Math.random() * 40; const m = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.6, 0.08, 0.35 + Math.random() * 0.3) })); m.scale.set(sx, h, sz); m.position.set(x, h / 2, z); m.castShadow = true; scene.add(m); n++; }
}
// nearest distance to the track's centre line and the index of its segment
function onTrack(x, z) {
  let best = Infinity; let bi = 0;
  for (let i = 0; i < TRACK.length; i++) {
    const a = TRACK[i]; const b = TRACK[(i + 1) % TRACK.length]; const abx = b.x - a.x; const aby = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.y) * aby) / (abx * abx + aby * aby)));
    const dx = a.x + abx * t - x; const dy = a.y + aby * t - z; const d = dx * dx + dy * dy; if (d < best) { best = d; bi = i; }
  }
  return { dist: Math.sqrt(best), seg: bi };
}

// ---------------------------------------------------------------------------------------------
// Car: the folder's body_2.0m and */default_2.0m, painted from the mask (R/G/B = colours 1/2/3, black = trim)
// and the colour layer on top; RayCity (x, y back, z up) → three (x, z, −y), so the car faces +z

const car = new THREE.Group(); scene.add(car);
const lamps = { brake: [], reverse: [], head: [] };
let files = null;
async function imageData(bytes) {
  const bm = await createImageBitmap(new Blob([bytes])); const cv = document.createElement('canvas'); cv.width = bm.width; cv.height = bm.height;
  const g = cv.getContext('2d'); g.drawImage(bm, 0, 0); return g.getImageData(0, 0, bm.width, bm.height);
}
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
let paintTex = null; let maskImg = null; let colorImg = null;
function repaint() {
  if (!maskImg) return;
  const { width: w, height: h, data } = maskImg; const cv = paintTex.image; cv.width = w; cv.height = h; const g = cv.getContext('2d');
  const out = g.createImageData(w, h); const C = [hex($('c1').value), hex($('c2').value), hex($('c3').value)];
  for (let i = 0; i < data.length; i += 4) {
    const k = data[i] > 128 ? 0 : data[i + 1] > 128 ? 1 : data[i + 2] > 128 ? 2 : -1;
    const c = k < 0 ? [24, 24, 26] : C[k]; out.data[i] = c[0]; out.data[i + 1] = c[1]; out.data[i + 2] = c[2]; out.data[i + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  if (colorImg) { const t = document.createElement('canvas'); t.width = colorImg.width; t.height = colorImg.height; t.getContext('2d').putImageData(colorImg, 0, 0); g.imageSmoothingEnabled = false; g.drawImage(t, 0, 0, w, h); }
  paintTex.needsUpdate = true;
}
for (const id of ['c1', 'c2', 'c3']) $(id).addEventListener('input', repaint);
async function loadCar(list, label) {
  // the folder holding body_2.0m
  const body = list.find((e) => /(^|\/)body_2\.0m$/i.test(e.path)); if (!body) throw new Error('ไม่เจอ body_2.0m');
  const root = body.path.replace(/body_2\.0m$/i, '');
  files = new Map(list.filter((e) => e.path.startsWith(root)).map((e) => [e.path.slice(root.length), e.data]));
  const name = ([...files.keys()].find((r) => !r.includes('/') && /_base\.png$/i.test(r)) || '').replace(/_base\.png$/i, '');
  car.clear(); lamps.brake = []; lamps.reverse = []; lamps.head = [];
  paintTex = new THREE.CanvasTexture(document.createElement('canvas')); paintTex.flipY = false; paintTex.colorSpace = THREE.SRGBColorSpace;
  maskImg = files.has(`${name}_base.png`) ? await imageData(files.get(`${name}_base.png`)) : null;
  colorImg = files.has(`${name}_color.png`) ? await imageData(files.get(`${name}_color.png`)) : null;
  if (!maskImg) { maskImg = new ImageData(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1); }
  repaint();
  const paint = new THREE.MeshStandardMaterial({ map: paintTex, roughness: 0.35, metalness: 0.2 });
  const glass = new THREE.MeshStandardMaterial({ color: '#1d2a3a', transparent: true, opacity: 0.55, roughness: 0.05, metalness: 0.6 });
  const shell = new THREE.Group(); shell.rotation.x = -Math.PI / 2; car.add(shell);
  let tris = 0;
  for (const rel of [...files.keys()].filter((r) => r === 'body_2.0m' || /^[^/]+\/default_2\.0m$/.test(r))) {
    const b = files.get(rel); let parts;
    try { parts = omParts(parseOM(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))); } catch { continue; }
    for (const p of parts) {
      if (p.positions.length / 3 <= 8 || !p.indices.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p.positions), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(p.normals), 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(p.uvs), 2));
      geo.setIndex(new THREE.BufferAttribute(Uint32Array.from(p.indices), 1));
      const k = p.flags[0]; let mat = paint;
      if (k === 1) mat = glass;
      else if (k === 2) { mat = new THREE.MeshStandardMaterial({ color: '#f4f1e6', emissive: '#fff6d8', emissiveIntensity: 0.6 }); lamps.head.push(mat); }
      else if (k === 3) { mat = new THREE.MeshStandardMaterial({ color: '#555', emissive: '#ffffff', emissiveIntensity: 0, transparent: true, opacity: 0.9 }); lamps.reverse.push(mat); }
      else if (k === 4) { mat = new THREE.MeshStandardMaterial({ color: '#5a0a0a', emissive: '#ff1a1a', emissiveIntensity: 0.15 }); lamps.brake.push(mat); }
      const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = k !== 1; mesh.renderOrder = k === 1 ? 2 : 0; shell.add(mesh); tris += p.indices.length / 3;
    }
  }
  // the game's wheels (front y −1.23, rear 1.15, radius 0.27)
  wheels.length = 0;
  const tyre = new THREE.CylinderGeometry(0.27, 0.27, 0.2, 20); tyre.rotateZ(Math.PI / 2);
  const tMat = new THREE.MeshStandardMaterial({ color: '#151515', roughness: 0.9 }); const rim = new THREE.MeshStandardMaterial({ color: '#b9bec7', metalness: 0.8, roughness: 0.3 });
  for (const [x, y] of [[0.72, -1.23], [-0.72, -1.23], [0.72, 1.15], [-0.72, 1.15]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, 0.27, -y);
    const w = new THREE.Mesh(tyre, tMat); w.castShadow = true; const r = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.21, 10).rotateZ(Math.PI / 2), rim); w.add(r);
    pivot.add(w); car.add(pivot); wheels.push({ pivot, w, front: y < 0 });
  }
  $('car-info').textContent = `รถ: ${label} · ${tris.toLocaleString()} สามเหลี่ยม · ไฟเบรก ${lamps.brake.length} · ไฟถอย ${lamps.reverse.length}`;
}
const wheels = [];
async function escarabajo() {
  const b64 = (window.RC_TEMPLATES || {}).escarabajo; if (!b64) return null;
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const json = await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  return Object.entries(JSON.parse(json)).map(([k, d]) => ({ path: `escarabajo/${k}`, data: Uint8Array.from(atob(d), (c) => c.charCodeAt(0)) }));
}
$('btn-car').addEventListener('click', () => $('file-car').click());
$('file-car').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try { await loadCar(await readZip(new Uint8Array(await f.arrayBuffer())), f.name.replace(/\.zip$/i, '')); reset(); } catch (err) { $('car-info').textContent = `เปิดไม่ได้: ${err.message}`; }
});

// ---------------------------------------------------------------------------------------------
// Driving: arcade model — velocity kept apart from the heading, the side slip bled off by tyre grip
// (much less on the handbrake: drifts), engine / brakes / drag, slower off the road

const S = { x: 0, z: 0, h: 0, vx: 0, vz: 0, steer: 0, wheelSpin: 0 };
function reset() {
  const a = TRACK[0]; const b = TRACK[1]; Object.assign(S, { x: a.x, z: a.y, h: Math.atan2(b.x - a.x, b.y - a.y), vx: 0, vz: 0, steer: 0 });
  lap.n = 0; lap.t0 = performance.now(); lap.next = 1; lap.started = false;
}
const keys = new Set();
const KEYMAP = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'hand' };
window.addEventListener('keydown', (e) => { if (KEYMAP[e.code]) { keys.add(KEYMAP[e.code]); e.preventDefault(); } if (e.code === 'KeyR') reset(); if (e.code === 'KeyC') camMode = (camMode + 1) % 2; });
window.addEventListener('keyup', (e) => { if (KEYMAP[e.code]) keys.delete(KEYMAP[e.code]); });
document.querySelectorAll('#touch button').forEach((b) => { const k = b.dataset.k; b.addEventListener('pointerdown', (e) => { e.preventDefault(); keys.add(k); }); for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => keys.delete(k)); });
let camMode = 0;
const lap = { n: 0, t0: 0, best: Infinity, next: 1, started: false };
const fmt = (ms) => `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(2).padStart(5, '0')}`;

function step(dt) {
  const fx = Math.sin(S.h); const fz = Math.cos(S.h);
  let vf = S.vx * fx + S.vz * fz; let vs = S.vx * fz - S.vz * fx; // forward / side speed
  const off = onTrack(S.x, S.z).dist > ROAD_W / 2 + 1;
  const up = keys.has('up'); const down = keys.has('down'); const hand = keys.has('hand');
  let braking = false; let reversing = false;
  if (up) vf += (vf < 0 ? 18 : 9.5 * Math.max(0.15, 1 - vf / 62)) * dt;
  if (down) { if (vf > 0.5) { vf = Math.max(0, vf - 16 * dt); braking = true; } else { vf = Math.max(-12, vf - 6 * dt); reversing = vf < -0.2; } }
  if (!up && !down) vf -= Math.sign(vf) * Math.min(Math.abs(vf), (1.2 + (off ? 6 : 0)) * dt);
  vf -= vf * Math.abs(vf) * (off ? 0.012 : 0.0016) * dt * 10;
  if (hand) { vf -= Math.sign(vf) * Math.min(Math.abs(vf), 5 * dt); braking = braking || Math.abs(vf) > 0.5; }
  if (vf < -0.2 && !down) reversing = false;
  // steering: less lock at speed
  const want = (keys.has('left') ? 1 : 0) - (keys.has('right') ? 1 : 0);
  const lock = 0.55 / (1 + Math.abs(vf) / 18);
  S.steer += (want * lock - S.steer) * Math.min(1, dt * 8);
  S.h += (vf / 2.38) * Math.tan(S.steer) * dt * (hand ? 1.35 : 1);
  const grip = hand ? 1.2 : off ? 4 : 9;
  vs -= vs * Math.min(1, grip * dt);
  const nfx = Math.sin(S.h); const nfz = Math.cos(S.h);
  S.vx = nfx * vf + nfz * vs; S.vz = nfz * vf - nfx * vs;
  S.x += S.vx * dt; S.z += S.vz * dt;
  const lim = WORLD / 2 - 3; S.x = Math.max(-lim, Math.min(lim, S.x)); S.z = Math.max(-lim, Math.min(lim, S.z));
  S.wheelSpin += (vf / 0.27) * dt;
  // lamps like the game's: brake red while slowing down going forward, reverse white going backwards
  for (const m of lamps.brake) m.emissiveIntensity = braking ? 2.2 : 0.15;
  for (const m of lamps.reverse) m.emissiveIntensity = reversing ? 1.8 : 0;
  // laps: checkpoints every 30 segments, in order
  const seg = onTrack(S.x, S.z).seg; const CP = 30; const cp = Math.floor(seg / CP);
  if (cp === lap.next % (TRACK.length / CP)) {
    if (lap.next % (TRACK.length / CP) === 0) { const t = performance.now() - lap.t0; if (lap.started) { lap.n++; lap.best = Math.min(lap.best, t); } lap.started = true; lap.t0 = performance.now(); }
    lap.next++;
  }
  return { vf, slip: Math.abs(vs) };
}

const camPos = new THREE.Vector3(); const camLook = new THREE.Vector3();
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  let r = { vf: 0 }; for (let i = 0; i < 4; i++) r = step(dt / 4);
  car.position.set(S.x, 0, S.z); car.rotation.y = S.h;
  for (const w of wheels) { w.w.rotation.x = S.wheelSpin; if (w.front) w.pivot.rotation.y = S.steer; }
  const fx = Math.sin(S.h); const fz = Math.cos(S.h);
  if (camMode === 0) { camPos.lerp(new THREE.Vector3(S.x - fx * 6.5, 2.4, S.z - fz * 6.5), Math.min(1, dt * 6)); camLook.set(S.x + fx * 3, 0.8, S.z + fz * 3); }
  else { camPos.set(S.x + fx * 0.2, 1.25, S.z + fz * 0.2); camLook.set(S.x + fx * 10, 1.0, S.z + fz * 10); }
  cam.position.copy(camPos); cam.lookAt(camLook);
  sun.position.set(S.x - 60, 120, S.z + 40); sun.target.position.set(S.x, 0, S.z);
  $('kmh').textContent = Math.round(Math.abs(r.vf) * 3.6);
  $('lap-n').textContent = lap.n; $('lap-t').textContent = lap.started ? fmt(now - lap.t0) : '0:00.00'; $('lap-best').textContent = Number.isFinite(lap.best) ? fmt(lap.best) : '-';
  renderer.render(scene, cam);
  requestAnimationFrame(frame);
}

(async () => {
  const esc = await escarabajo();
  if (esc) await loadCar(esc, 'Escarabajo (ในตัว)');
  reset(); camPos.set(S.x, 3, S.z - 8);
  requestAnimationFrame(frame);
  window.drive = { S, keys, lap, car };
})();
