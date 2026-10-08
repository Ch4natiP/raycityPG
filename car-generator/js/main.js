import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { buildCar, disposeObject } from './carBuilder.js';
import { parseOM, omToObject, writeOM, objectToParts, mergePartsByName } from './om.js';
import { SCHEMA, PRESETS, presetParams, randomParams } from './params.js';

const STORAGE_KEY = 'raycity-car-generator:params';

// --- Scene -------------------------------------------------------------------
const viewport = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#1b1e24');
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 500);
camera.position.set(5.5, 2.6, 6.5);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.6, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;

const sun = new THREE.DirectionalLight('#ffffff', 2.2);
sun.position.set(4, 8, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 0.5, far: 30 });
scene.add(sun, sun.target, new THREE.HemisphereLight('#cfe3ff', '#2a2a2a', 0.6));

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: '#2a2e36', roughness: 0.95 }),
);
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(400, 400, '#3f4652', '#323741');
grid.position.y = 0.002;
scene.add(grid);

// Cones give a sense of motion in drive mode.
const coneMat = new THREE.MeshStandardMaterial({ color: '#ff7a1a', roughness: 0.6 });
for (let i = 0; i < 40; i++) {
  const c = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.5, 12), coneMat);
  const a = (i / 40) * Math.PI * 2;
  c.position.set(Math.cos(a) * 30, 0.25, Math.sin(a) * 30);
  c.castShadow = true;
  scene.add(c);
}

// --- Materials (shared, updated from the color params) ------------------------
const mats = {
  paint: new THREE.MeshStandardMaterial({ name: 'Paint' }),
  stripe: new THREE.MeshStandardMaterial({ name: 'Stripe' }),
  trim: new THREE.MeshStandardMaterial({ name: 'Trim', roughness: 0.6, metalness: 0.1 }),
  glass: new THREE.MeshStandardMaterial({ name: 'Glass', roughness: 0.05, metalness: 0.9 }),
  rim: new THREE.MeshStandardMaterial({ name: 'Rim', roughness: 0.25, metalness: 0.9, side: THREE.DoubleSide }),
  rimDark: new THREE.MeshStandardMaterial({ name: 'RimInner', color: '#121314', roughness: 0.8 }),
  tire: new THREE.MeshStandardMaterial({ name: 'Tire', color: '#1a1a1a', roughness: 0.92 }),
  brake: new THREE.MeshStandardMaterial({ name: 'BrakeDisc', color: '#777b80', roughness: 0.45, metalness: 0.8 }),
  caliper: new THREE.MeshStandardMaterial({ name: 'Caliper', roughness: 0.4 }),
  chrome: new THREE.MeshStandardMaterial({ name: 'Chrome', color: '#e6e8ea', roughness: 0.1, metalness: 1 }),
  headlight: new THREE.MeshStandardMaterial({ name: 'Headlight', color: '#ffffff', emissive: '#fff4d6', emissiveIntensity: 1.2 }),
  taillight: new THREE.MeshStandardMaterial({ name: 'Taillight', color: '#7a0000', emissive: '#ff1a1a', emissiveIntensity: 1 }),
  plate: new THREE.MeshStandardMaterial({ name: 'Plate', color: '#f4f4f0', roughness: 0.5 }),
  glow: new THREE.MeshStandardMaterial({ name: 'Underglow', color: '#000000', transparent: true, opacity: 0.85 }),
};

function applyMaterials(p) {
  mats.paint.color.set(p.paintColor);
  mats.paint.metalness = p.metalness;
  mats.paint.roughness = p.roughness;
  mats.stripe.color.set(p.stripeColor);
  mats.stripe.metalness = p.metalness * 0.6;
  mats.stripe.roughness = p.roughness;
  mats.trim.color.set(p.trimColor);
  mats.glass.color.set(p.glassColor);
  mats.rim.color.set(p.rimColor);
  mats.caliper.color.set(p.caliperColor);
  mats.glow.emissive.set(p.underglowColor);
  mats.glow.emissiveIntensity = 2;
}

// --- State -------------------------------------------------------------------
let params = loadSaved() || presetParams('sedan');
const rig = new THREE.Group(); // moves in drive mode; the exported car stays at the origin
scene.add(rig);
let car = null;

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...presetParams('sedan'), ...JSON.parse(raw) } : null;
  } catch { return null; }
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(params)); } catch { /* storage unavailable */ }
}

function rebuild() {
  if (car) { rig.remove(car); disposeObject(car); }
  applyMaterials(params);
  car = buildCar(params, mats);
  car.visible = !imported;
  rig.add(car);
  updateStats();
  save();
}

// The model on screen: the generated car, or RayCity files opened by the user.
const viewed = () => imported || car;

let rebuildQueued = false;
function queueRebuild() {
  if (rebuildQueued) return;
  rebuildQueued = true;
  requestAnimationFrame(() => { rebuildQueued = false; rebuild(); });
}

function updateStats() {
  let tris = 0;
  let meshes = 0;
  const root = viewed();
  root.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    const g = o.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  const box = new THREE.Box3().setFromObject(root);
  const s = box.getSize(new THREE.Vector3());
  const u = root.userData;
  document.getElementById('stats').innerHTML =
    `<b>${Math.round(tris).toLocaleString()}</b> tris · ${meshes} meshes<br>` +
    `${s.x.toFixed(2)} × ${s.y.toFixed(2)} × ${s.z.toFixed(2)} m (W×H×L)<br>` +
    (imported ? `ไฟล์ RayCity: ${u.files}` : `ฐานล้อ ${u.wheelbase.toFixed(2)} m · ช่วงล้อ ${u.track.toFixed(2)} m`);
}

// --- UI ----------------------------------------------------------------------
const panel = document.getElementById('controls');
const inputs = {};

function buildUI() {
  for (const group of SCHEMA) {
    const det = document.createElement('details');
    det.open = group === SCHEMA[0];
    const sum = document.createElement('summary');
    sum.textContent = group.group;
    det.appendChild(sum);
    for (const it of group.items) det.appendChild(buildControl(it));
    panel.appendChild(det);
  }
}

function buildControl(it) {
  const row = document.createElement('label');
  row.className = `row row-${it.type || 'range'}`;
  const name = document.createElement('span');
  name.className = 'lbl';
  name.textContent = it.label;
  row.appendChild(name);
  let input;
  if (it.type === 'select') {
    input = document.createElement('select');
    for (const [v, t] of it.options) input.add(new Option(t, v));
    input.addEventListener('change', () => set(it.key, input.value));
  } else if (it.type === 'check') {
    input = document.createElement('input');
    input.type = 'checkbox';
    input.addEventListener('change', () => set(it.key, input.checked));
  } else if (it.type === 'color') {
    input = document.createElement('input');
    input.type = 'color';
    input.addEventListener('input', () => set(it.key, input.value));
  } else if (it.type === 'text') {
    input = document.createElement('input');
    input.type = 'text';
    input.addEventListener('change', () => set(it.key, input.value.replace(/[^\w\-]/g, '_') || 'Car'));
  } else {
    input = document.createElement('input');
    input.type = 'range';
    Object.assign(input, { min: it.min, max: it.max, step: it.step });
    const out = document.createElement('output');
    row.appendChild(out);
    input.addEventListener('input', () => {
      set(it.key, parseFloat(input.value));
      out.textContent = fmt(input.value, it.step);
    });
    input._out = out;
  }
  input._item = it;
  inputs[it.key] = input;
  row.appendChild(input);
  return row;
}

const fmt = (v, step) => (step >= 1 ? String(Math.round(v)) : Number(v).toFixed(step < 0.01 ? 3 : 2));

function syncUI() {
  for (const [key, input] of Object.entries(inputs)) {
    const v = params[key];
    if (input.type === 'checkbox') input.checked = !!v;
    else input.value = v;
    if (input._out) input._out.textContent = fmt(v, input._item.step);
  }
}

function set(key, value) {
  params[key] = value;
  queueRebuild();
}

function setParams(p) {
  params = { ...presetParams('sedan'), ...p };
  syncUI();
  rebuild();
}

function buildPresetBar() {
  const bar = document.getElementById('presets');
  for (const [key, preset] of Object.entries(PRESETS)) {
    const b = document.createElement('button');
    b.textContent = preset.label;
    b.addEventListener('click', () => setParams(presetParams(key)));
    bar.appendChild(b);
  }
}

// --- Export ------------------------------------------------------------------
function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportRoot() {
  // Export the car without the drive-mode transform.
  const root = viewed().clone();
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.traverse((o) => {
    if (o.name.endsWith('_Spin')) o.rotation.x = 0;
    if (/^Wheel_(FL|FR|RL|RR)$/.test(o.name)) o.rotation.y = 0;
  });
  return root;
}

export function exportGLB() {
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(exportRoot(), (result) => {
      resolve(new Blob([result], { type: 'model/gltf-binary' }));
    }, reject, { binary: true });
  });
}

export function exportOBJ() {
  return new Blob([new OBJExporter().parse(exportRoot())], { type: 'text/plain' });
}

function bindButtons() {
  const on = (id, fn) => document.getElementById(id).addEventListener('click', fn);
  const exportName = () => (imported ? imported.name : params.name);
  on('btn-glb', async () => download(await exportGLB(), `${exportName()}.glb`));
  on('btn-obj', () => download(exportOBJ(), `${exportName()}.obj`));
  on('btn-json', () => download(new Blob([JSON.stringify(params, null, 2)], { type: 'application/json' }), `${params.name}.json`));
  on('btn-load', () => document.getElementById('file-json').click());
  document.getElementById('file-json').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { setParams(JSON.parse(await f.text())); } catch (err) { alert(`อ่านไฟล์ไม่ได้: ${err.message}`); }
    e.target.value = '';
  });
  on('btn-png', () => {
    renderer.render(scene, camera);
    renderer.domElement.toBlob((b) => download(b, `${params.name}.png`));
  });
  on('btn-random', () => {
    const seed = Math.floor(Math.random() * 1e6);
    document.getElementById('seed').value = seed;
    setParams(randomParams(seed));
  });
  on('btn-seed', () => setParams(randomParams(parseInt(document.getElementById('seed').value, 10) || 1)));
  on('btn-drive', toggleDrive);
  on('btn-wire', () => {
    for (const m of Object.values(mats)) m.wireframe = !m.wireframe;
  });
}

// --- RayCity .0m import / export ---------------------------------------------
let imported = null; // THREE.Group of opened .0m files
let template = null; // { om, name } first opened .0m, used as the header template for export
const omPalette = ['#d9483b', '#3b8fd9', '#47c26f', '#e0b43a', '#a35bd6', '#3bc7c2', '#e07a3a', '#9aa3ad'];
const omColorMats = omPalette.map((c, i) => new THREE.MeshStandardMaterial({
  name: `RC_Submesh_${i}`, color: c, roughness: 0.5, side: THREE.DoubleSide,
}));

function setOmStatus(text) {
  document.getElementById('om-status').textContent = text;
}

function showImported(group) {
  if (imported) { scene.remove(imported); disposeObject(imported); }
  imported = group;
  if (imported) scene.add(imported);
  car.visible = !imported;
  document.getElementById('btn-om-back').hidden = !imported;
  updateStats();
}

async function openOmFiles(fileList) {
  const files = [...fileList];
  const oms = files.filter((f) => /\.0m$/i.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
  const tex = files.find((f) => /\.(png|jpe?g)$/i.test(f.name));
  if (!oms.length) { alert('กรุณาเลือกไฟล์ .0m อย่างน้อย 1 ไฟล์'); return; }
  let mats2 = omColorMats;
  if (tex) {
    const t = await new THREE.TextureLoader().loadAsync(URL.createObjectURL(tex));
    t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = false; // RayCity (Direct3D) UVs start at the top-left
    mats2 = [new THREE.MeshStandardMaterial({ name: 'RC_Texture', map: t, roughness: 0.5, side: THREE.DoubleSide })];
  }
  const group = new THREE.Group();
  group.name = oms[0].name.replace(/\.0m$/i, '');
  const notes = [];
  for (const [i, f] of oms.entries()) {
    try {
      const om = parseOM(await f.arrayBuffer());
      const obj = omToObject(om, mats2);
      obj.name = f.name.replace(/\.0m$/i, '');
      obj.position.x = (i - (oms.length - 1) / 2) * 2.8;
      group.add(obj);
      if (!template) template = { om, name: f.name };
      notes.push(`${f.name}: ${om.positions.length / 3} จุด, ${om.submeshes.length} ชิ้น`);
    } catch (err) {
      notes.push(`${f.name}: อ่านไม่ได้ (${err.message})`);
    }
  }
  group.userData.files = oms.map((f) => f.name).join(', ');
  if (group.children.length) showImported(group);
  setOmStatus(`${notes.join('\n')}\nแม่แบบสำหรับส่งออก: ${template ? template.name : '-'}`);
}

// Converts the generated car body (no wheels — RayCity stores those separately) to a .0m.
function exportOm() {
  if (!template) {
    alert('เปิดไฟล์ .0m ของรถในเกมก่อน 1 ไฟล์ (เช่น body_0.0m) เพื่อใช้เป็นแม่แบบ');
    return;
  }
  const root = car.clone();
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  const parts = mergePartsByName(objectToParts(root, (m) => {
    for (let o = m; o; o = o.parent) if (/^Wheel_|^Underglow$/.test(o.name)) return false;
    return true;
  }));
  // Every vertex samples the same texel as the template's main body so the car takes the player's paint color.
  const t = template.om;
  const uv = [t.uvs[0], t.uvs[1]];
  // Ground sits at RayCity z = 0 in both; center the new body where the template body is along Y.
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 1; i < t.positions.length; i += 3) { minY = Math.min(minY, t.positions[i]); maxY = Math.max(maxY, t.positions[i]); }
  const ty = (minY + maxY) / 2;
  for (const part of parts) {
    for (let i = 0; i < part.uvs.length; i += 2) { part.uvs[i] = uv[0]; part.uvs[i + 1] = uv[1]; }
    for (let i = 1; i < part.positions.length; i += 3) part.positions[i] += ty;
  }
  try {
    const bytes = writeOM(t, parts);
    download(new Blob([bytes], { type: 'application/octet-stream' }), template.name);
    setOmStatus(`ส่งออก ${template.name}: ${parts.length} ชิ้น, ${parts.reduce((s, q) => s + q.positions.length / 3, 0)} จุด`);
  } catch (err) {
    alert(err.message);
  }
}

function bindOmButtons() {
  const input = document.getElementById('file-om');
  document.getElementById('btn-om-open').addEventListener('click', () => input.click());
  input.addEventListener('change', async (e) => { await openOmFiles(e.target.files); e.target.value = ''; });
  document.getElementById('btn-om-back').addEventListener('click', () => showImported(null));
  document.getElementById('btn-om-export').addEventListener('click', exportOm);
}

// --- Drive mode --------------------------------------------------------------
const keys = new Set();
const drive = { on: false, speed: 0, steer: 0, heading: 0, spin: 0 };
window.addEventListener('keydown', (e) => {
  if (!drive.on || e.target.tagName === 'INPUT') return;
  keys.add(e.code);
  if (e.code === 'KeyR') resetDrive();
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

function resetDrive() {
  Object.assign(drive, { speed: 0, steer: 0, heading: 0, spin: 0 });
  rig.position.set(0, 0, 0);
  rig.rotation.set(0, 0, 0);
}

function toggleDrive() {
  if (imported && !drive.on) {
    alert('โหมดทดลองขับใช้ได้กับรถจากตัวสร้างรถเท่านั้น (ไฟล์ .0m ไม่มีล้อ)');
    return;
  }
  drive.on = !drive.on;
  document.getElementById('btn-drive').classList.toggle('active', drive.on);
  document.getElementById('drive-help').hidden = !drive.on;
  controls.enabled = !drive.on;
  if (!drive.on) {
    resetDrive();
    animateWheels();
    controls.target.set(0, 0.6, 0);
    camera.position.set(5.5, 2.6, 6.5);
  }
}

function animateWheels() {
  car.traverse((o) => {
    if (o.name.endsWith('_Spin')) o.rotation.x = drive.spin;
    if (o.name === 'Wheel_FL' || o.name === 'Wheel_FR') o.rotation.y = drive.steer;
  });
}

const camOffset = new THREE.Vector3();
function updateDrive(dt) {
  const fwd = keys.has('KeyW') || keys.has('ArrowUp');
  const back = keys.has('KeyS') || keys.has('ArrowDown');
  const left = keys.has('KeyA') || keys.has('ArrowLeft');
  const right = keys.has('KeyD') || keys.has('ArrowRight');
  const brake = keys.has('Space');
  const maxSpeed = 40;
  if (fwd) drive.speed += 14 * dt;
  if (back) drive.speed -= (drive.speed > 0 ? 25 : 8) * dt;
  if (brake) drive.speed *= Math.max(0, 1 - 4 * dt);
  drive.speed *= 1 - 0.35 * dt;
  drive.speed = THREE.MathUtils.clamp(drive.speed, -10, maxSpeed);
  const targetSteer = (left ? 1 : 0) - (right ? 1 : 0);
  const maxSteer = 0.55 / (1 + Math.abs(drive.speed) * 0.04);
  drive.steer += (targetSteer * maxSteer - drive.steer) * Math.min(1, 8 * dt);
  const wb = car.userData.wheelbase;
  drive.heading += (drive.speed * Math.tan(drive.steer) / wb) * dt;
  rig.rotation.y = drive.heading;
  rig.position.x += Math.sin(drive.heading) * drive.speed * dt;
  rig.position.z += Math.cos(drive.heading) * drive.speed * dt;
  drive.spin += (drive.speed / car.userData.wheelRadius) * dt;
  animateWheels();
  camOffset.set(-Math.sin(drive.heading) * 7, 2.6, -Math.cos(drive.heading) * 7);
  const desired = rig.position.clone().add(camOffset);
  camera.position.lerp(desired, Math.min(1, 4 * dt));
  controls.target.copy(rig.position).add(new THREE.Vector3(0, 0.8, 0));
  camera.lookAt(controls.target);
  sun.position.copy(rig.position).add(new THREE.Vector3(4, 8, 5));
  sun.target.position.copy(rig.position);
  document.getElementById('speed').textContent = `${Math.round(Math.abs(drive.speed) * 3.6)} km/h`;
}

// --- Loop --------------------------------------------------------------------
function resize() {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewport);

const clock = new THREE.Clock();
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (drive.on) updateDrive(dt);
  else controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

buildUI();
buildPresetBar();
bindButtons();
bindOmButtons();
syncUI();
rebuild();
resize();
tick();

// Handy for scripting / automated tests.
window.carGenerator = { setParams, getParams: () => ({ ...params }), exportGLB, exportOBJ, randomParams, openOmFiles };
