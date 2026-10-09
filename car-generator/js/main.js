import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { buildCar, disposeObject } from './carBuilder.js';
import { parseOM, omToObject, writeOM, objectToParts, mergePartsByName } from './om.js';
import { SPEC_TEMPLATE, SPEC_FIELDS, readSpec, writeSpec, encodeSpec, decodeSpec, suggestSpec } from './carSpec.js';
import { makeZip, readZip } from './zip.js';
import { IDENTITY, slotOfPath, bboxOf, editFile, editFileInfo, editMeshXml, renamePath, countsOf, ready as editReady } from './carEdit.js';
import { SCHEMA, PRESETS, presetParams, randomParams } from './params.js';
import { checkCar, renderChecks, repairCar, completeCar } from './checkCar.js';
import { CATEGORIES, MODEL_TYPES, loadModel, convert, bendTemplate, turnAround, categoryOf, GAME_WHEELS, fitToWheels, unfitWheels } from './convert.js';

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
  paint: new THREE.MeshPhysicalMaterial({ name: 'Paint', clearcoatRoughness: 0.04, side: THREE.DoubleSide }),
  stripe: new THREE.MeshStandardMaterial({ name: 'Stripe' }),
  trim: new THREE.MeshStandardMaterial({ name: 'Trim', roughness: 0.6, metalness: 0.1, side: THREE.DoubleSide }),
  glass: new THREE.MeshPhysicalMaterial({
    name: 'Glass', roughness: 0.03, metalness: 0.2, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  }),
  chromeDark: new THREE.MeshStandardMaterial({ name: 'ChromeDark', color: '#2a2d31', roughness: 0.2, metalness: 1 }),
  lens: new THREE.MeshPhysicalMaterial({ name: 'Lens', color: '#ffffff', emissive: '#e8f1ff', emissiveIntensity: 1.6, roughness: 0.05 }),
  indicator: new THREE.MeshStandardMaterial({ name: 'Indicator', color: '#ffb000', emissive: '#ff8a00', emissiveIntensity: 0.4 }),
  reverse: new THREE.MeshStandardMaterial({ name: 'ReverseLight', color: '#f2f2f2', emissive: '#ffffff', emissiveIntensity: 0.2 }),
  fog: new THREE.MeshStandardMaterial({ name: 'FogLight', color: '#ffffff', emissive: '#fff6d8', emissiveIntensity: 1.2 }),
  seam: new THREE.MeshStandardMaterial({ name: 'PanelSeam', color: '#050505', roughness: 0.9 }),
  interior: new THREE.MeshStandardMaterial({ name: 'Interior', roughness: 0.85 }),
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
  mats.paint.clearcoat = p.clearcoat;
  mats.glass.opacity = p.glassOpacity;
  mats.interior.color.set(p.interiorColor);
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
  if (folder && imported && /^(paintColor|secondColor|twoTone)$/.test(key)) queueReassemble();
}

let reassembleTimer = 0;
function queueReassemble() {
  clearTimeout(reassembleTimer);
  reassembleTimer = setTimeout(() => assembleFolder(), 150);
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
    b.addEventListener('click', () => {
      if (imported) showImported(null); // back from a RayCity car to the generator
      setParams(presetParams(key));
    });
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
  on('btn-ingame', () => {
    inGameView = !inGameView;
    document.getElementById('btn-ingame').classList.toggle('active', inGameView);
    applySides(imported);
  });
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

// "In-game view": RayCity draws one side of each face. Showing RayCity cars single-sided reveals
// the holes a player would see; the default double-sided view hides them.
let inGameView = false;
function applySides(root) {
  if (!root) return;
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) { m.side = inGameView ? THREE.FrontSide : THREE.DoubleSide; m.needsUpdate = true; }
  });
}

function showImported(group) {
  if (imported) { scene.remove(imported); disposeObject(imported); }
  imported = group;
  if (imported) { applySides(imported); scene.add(imported); }
  car.visible = !imported;
  document.getElementById('btn-om-back').hidden = !imported;
  document.body.classList.toggle('rc-mode', Boolean(imported));
  if (!imported) { const ed = document.getElementById('car-edit'); if (ed) ed.hidden = true; }
  updateStats();
}

async function openOmFiles(fileList) {
  const files = [...fileList];
  folder = null;
  looseFiles = files;
  document.getElementById('om-parts').innerHTML = '';
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

// --- Whole car folder ----------------------------------------------------------
// A RayCity car folder: body_<lod>.0m + <car>_base.png at the root, and one subfolder per part
// type (hood, roof, ...). Each subfolder has list.xml naming its variants:
//   <part id='0' name='default' mesh='default' tex='escarabajo_hood' />  →  default_<lod>.0m + escarabajo_hood.png
// lod 0/1/2: 2 is the most detailed.
let looseFiles = null; // files from "open .0m" (no folder)
let folder = null; // { name, files: Map(rel -> File), slots: [{ dir, variants: [{ name, mesh, tex }] }], choice, lod }

const xmlText = async (file) => {
  const buf = new Uint8Array(await file.arrayBuffer());
  const utf16 = (buf[0] === 0xff && buf[1] === 0xfe) || (buf[1] === 0 && buf[0] === 0x3c);
  return new TextDecoder(utf16 ? 'utf-16le' : 'utf-8').decode(buf).replace(/^\uFEFF/, '').replace(/encoding=['"][^'"]*['"]/, '');
};

async function readFolder(entries) {
  const first = entries[0].path.split('/')[0];
  const strip = entries.every((e) => e.path.split('/').length > 1 && e.path.split('/')[0] === first);
  const files = new Map();
  for (const e of entries) files.set(strip ? e.path.split('/').slice(1).join('/') : e.path, e.file);
  const name = strip ? first : 'car';
  const dirs = new Set();
  for (const rel of files.keys()) if (rel.includes('/')) dirs.add(rel.slice(0, rel.indexOf('/')));
  const meshNames = (prefix) => [...new Set([...files.keys()]
    .filter((r) => r.startsWith(prefix) && /_\d\.0m$/i.test(r) && !r.slice(prefix.length).includes('/'))
    .map((r) => r.slice(prefix.length).replace(/_\d\.0m$/i, '')))];
  const slots = [];
  const bodyTex = [...files.keys()].find((r) => !r.includes('/') && /_base\.png$/i.test(r));
  if (meshNames('').length) {
    slots.push({ dir: '', label: 'ตัวถัง (body)', variants: meshNames('').map((m) => ({ name: m, mesh: m, tex: bodyTex ? bodyTex.replace(/\.png$/i, '') : '' })) });
  }
  for (const dir of [...dirs].sort()) {
    let variants = [];
    const list = files.get(`${dir}/list.xml`);
    if (list) {
      const doc = new DOMParser().parseFromString(await xmlText(list), 'text/xml');
      variants = [...doc.querySelectorAll('part')]
        .filter((el) => el.getAttribute('mesh'))
        .map((el) => ({ name: el.getAttribute('name'), mesh: el.getAttribute('mesh'), tex: el.getAttribute('tex') || '' }));
    }
    if (!variants.length) variants = meshNames(`${dir}/`).map((m) => ({ name: m, mesh: m, tex: '' }));
    variants = variants.filter((v) => [0, 1, 2].some((l) => files.has(`${dir}/${v.mesh}_${l}.0m`)));
    if (variants.length) slots.push({ dir, label: dir, variants });
  }
  return { name, files, slots };
}

async function openCarFolder(entries) {
  if (!entries.length) return;
  const f = await readFolder(entries);
  if (!f.slots.length) { alert('ไม่พบไฟล์ .0m ในโฟลเดอร์นี้'); return; }
  f.lod = 2;
  // Stock car: 'default' variant of each part; slots without one (e.g. mainspoiler) stay empty.
  f.choice = new Map(f.slots.map((slot) => {
    const def = slot.variants.find((v) => v.name === 'default') || (slot.dir ? null : slot.variants[0]);
    return [slot.dir, def ? def.name : ''];
  }));
  folder = f;
  looseFiles = null;
  f.specRel = f.files.has(`${f.name}.xml`) ? `${f.name}.xml`
    : [...f.files.keys()].find((r) => !r.includes('/') && /\.xml$/i.test(r) && r.toLowerCase() !== 'mesh.xml');
  if (f.specRel) loadSpecText(decodeSpec(await f.files.get(f.specRel).arrayBuffer()), f.name);
  f.edits = new Map();
  f.car = structuredClone(IDENTITY);
  f.newName = f.name;
  f.selected = '';
  f.explode = false;
  await computePivots(f);
  buildPartPickers();
  buildEditPanel();
  await assembleFolder();
}

function pickerRow(label, options, value, onChange) {
  const row = document.createElement('label');
  row.className = 'row row-select';
  const lbl = document.createElement('span');
  lbl.className = 'lbl';
  lbl.textContent = label;
  const sel = document.createElement('select');
  for (const [v, t] of options) sel.add(new Option(t, v));
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value));
  row.append(lbl, sel);
  return row;
}

function buildPartPickers() {
  const box = document.getElementById('om-parts');
  box.innerHTML = '';
  box.appendChild(pickerRow('ระดับรายละเอียด (LOD)', [['2', '2 (ละเอียดสุด)'], ['1', '1'], ['0', '0 (หยาบสุด)']], String(folder.lod),
    (v) => { folder.lod = Number(v); assembleFolder(); }));
  for (const slot of folder.slots) {
    const opts = slot.variants.map((v) => [v.name, v.name]);
    if (slot.dir) opts.unshift(['', '— ไม่ใส่ —']);
    box.appendChild(pickerRow(slot.label, opts, folder.choice.get(slot.dir),
      (v) => { folder.choice.set(slot.dir, v); assembleFolder(); }));
  }
}

// Submesh kinds from the .0m flags: glass, lamp lenses and lights drawn like in game.
const KIND_MATS = {
  1: new THREE.MeshStandardMaterial({ name: 'RC_Glass', color: '#24160d', roughness: 0.05, metalness: 0.5, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }),
  2: new THREE.MeshStandardMaterial({ name: 'RC_Headlight', color: '#dfe6ee', emissive: '#fff6e0', emissiveIntensity: 0.6, roughness: 0.05, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
  3: new THREE.MeshStandardMaterial({ name: 'RC_Taillight', color: '#8a0d0d', emissive: '#ff2020', emissiveIntensity: 0.8, roughness: 0.2, side: THREE.DoubleSide }),
  4: new THREE.MeshStandardMaterial({ name: 'RC_Indicator', color: '#c9862a', emissive: '#ffb347', emissiveIntensity: 0.4, roughness: 0.2, side: THREE.DoubleSide }),
};

const textureCache = new Map();
async function loadTexture(file, recolor) {
  const key = `${file.name}:${file.size}:${JSON.stringify(recolor)}`;
  if (textureCache.has(key)) return textureCache.get(key);
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const g = c.getContext('2d');
  g.drawImage(bmp, 0, 0);
  if (recolor) {
    // Body textures are paint masks: red = main paint, green/blue = second paint areas (e.g. the hood).
    const img = g.getImageData(0, 0, c.width, c.height);
    const pc = new THREE.Color(recolor.paint);
    const tc = new THREE.Color(recolor.trim);
    const gc = new THREE.Color(recolor.glass);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255;
      const gg = d[i + 1] / 255;
      const b = d[i + 2] / 255;
      d[i] = 255 * Math.min(1, r * pc.r + gg * tc.r + b * gc.r);
      d[i + 1] = 255 * Math.min(1, r * pc.g + gg * tc.g + b * gc.g);
      d[i + 2] = 255 * Math.min(1, r * pc.b + gg * tc.b + b * gc.b);
    }
    g.putImageData(img, 0, 0);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false; // RayCity (Direct3D) UVs start at the top-left
  textureCache.set(key, t);
  return t;
}

const bodyTexName = () => folder.slots.find((sl) => !sl.dir)?.variants[0]?.tex || '';

// How the game layers a car's textures (from the original files): the paint mask (<car>_base.png,
// recolored with the player's paint) and on top of it, by its alpha, a detail layer: <car>_color.png
// for the body, the part's own texture (tex in list.xml) for parts. Returns the composed texture and
// the detail layer's pixels (to tell lamps with baked art from bare lens submeshes).
async function composeTexture(baseFile, overlayFile, recolor) {
  const key = `C:${baseFile?.name}:${baseFile?.size}:${overlayFile?.name}:${overlayFile?.size}:${JSON.stringify(recolor)}`;
  if (textureCache.has(key)) return textureCache.get(key);
  const base = baseFile && (await loadTexture(baseFile, recolor)).image;
  const over = overlayFile && await createImageBitmap(overlayFile);
  const w = Math.max(base?.width || 0, over?.width || 0, 1);
  const h = Math.max(base?.height || 0, over?.height || 0, 1);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true;
  if (base) g.drawImage(base, 0, 0, w, h);
  let overPx = null;
  if (over) {
    g.drawImage(over, 0, 0, w, h);
    const oc = document.createElement('canvas');
    oc.width = over.width;
    oc.height = over.height;
    oc.getContext('2d').drawImage(over, 0, 0);
    overPx = { width: over.width, height: over.height, data: oc.getContext('2d').getImageData(0, 0, over.width, over.height).data };
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false;
  t.anisotropy = 4;
  const out = { texture: t, overPx };
  textureCache.set(key, out);
  return out;
}

// True when most vertices of submesh k land on opaque pixels of the detail layer.
function opaqueOver(overPx, om, k) {
  if (!overPx) return false;
  const s = om.submeshes[k];
  const step = Math.max(1, Math.floor(s.vertexCount / 64));
  let hit = 0;
  let n = 0;
  for (let i = s.vertexStart; i < s.vertexStart + s.vertexCount; i += step, n++) {
    const u = ((om.uvs[i * 2] % 1) + 1) % 1;
    const v = ((om.uvs[i * 2 + 1] % 1) + 1) % 1;
    const x = Math.min(overPx.width - 1, Math.floor(u * overPx.width));
    const y = Math.min(overPx.height - 1, Math.floor(v * overPx.height));
    if (overPx.data[(y * overPx.width + x) * 4 + 3] > 128) hit++;
  }
  return hit > n * 0.6;
}

async function assembleFolder() {
  const group = new THREE.Group();
  group.name = folder.name;
  const notes = [];
  let colorIndex = 0;
  template = null;
  for (const slot of folder.slots) {
    const v = slot.variants.find((x) => x.name === folder.choice.get(slot.dir));
    if (!v) continue;
    const prefix = slot.dir ? `${slot.dir}/` : '';
    const lods = [folder.lod, 2, 1, 0].filter((l, i, a) => a.indexOf(l) === i);
    const rel = lods.map((l) => `${prefix}${v.mesh}_${l}.0m`).find((r) => folder.files.has(r));
    try {
      const raw = new Uint8Array(await folder.files.get(rel).arrayBuffer());
      // The same edit the download writes (see carEdit.js), so the preview is the new car.
      const edited = editFile(raw, folder.edits.get(slot.dir), folder.car, folder.pivots.get(slot.dir) || [0, 0, 0], folder.carPivot);
      const om = parseOM((edited || raw).buffer.slice(0));
      // Paint mask recolored with the chosen paint, detail layer on top (see composeTexture).
      const findTex = (t) => t && (folder.files.get(`${prefix}${t}.png`)
        || [...folder.files].find(([r]) => r.split('/').pop().toLowerCase() === `${t}.png`.toLowerCase())?.[1]);
      const second = params.twoTone ? params.secondColor : params.paintColor;
      const baseName = bodyTexName();
      const bodyFile = findTex(baseName);
      const overlayFile = slot.dir ? findTex(v.tex) : findTex(baseName.replace(/_base$/i, '_color'));
      const recolor = { paint: params.paintColor, trim: second, glass: second };
      const comp = (bodyFile || overlayFile) && await composeTexture(bodyFile, overlayFile, recolor);
      const mat = comp && new THREE.MeshStandardMaterial({
        name: 'RC_Body', roughness: 0.35, metalness: 0.4, side: THREE.DoubleSide, map: comp.texture, alphaTest: 0,
      });
      const litMat = comp && new THREE.MeshStandardMaterial({
        name: 'RC_Lamp', roughness: 0.2, metalness: 0.1, side: THREE.DoubleSide, map: comp.texture,
        emissiveMap: comp.texture, emissive: '#ffffff', emissiveIntensity: 0.35,
      });
      const partMats = (kind, k) => {
        // Glass is drawn by the game's own glass shader; lamps use their baked art when the detail
        // layer has some there, else a plain lens color (the original cars' lenses).
        if (kind === 1) return KIND_MATS[1];
        if (KIND_MATS[kind]) return litMat && opaqueOver(comp.overPx, om, k) ? litMat : KIND_MATS[kind];
        return mat || omColorMats[(colorIndex + k) % omColorMats.length];
      };
      colorIndex += om.submeshes.length;
      const obj = omToObject(om, partMats);
      obj.name = rel.replace(/\//g, '_').replace(/\.0m$/i, '');
      obj.userData.slot = slot.dir;
      group.add(obj);
      if (!slot.dir) template = { om, name: rel.split('/').pop() };
      notes.push(`✔ ${rel}: ${om.positions.length / 3} จุด`);
    } catch (err) {
      notes.push(`✘ ${rel}: อ่านไม่ได้ (${err.message})`);
    }
  }
  group.userData.files = `โฟลเดอร์ ${folder.name}`;
  // Exploded view: every part pushed away from the car's centre; the selected part gets a box.
  const carBox = new THREE.Box3().setFromObject(group);
  const carCenter = carBox.getCenter(new THREE.Vector3());
  for (const obj of [...group.children]) {
    if (folder.explode && obj.userData.slot) {
      const c = new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3()).sub(carCenter);
      c.y = Math.max(0, c.y);
      obj.position.add(c.normalize().multiplyScalar(0.7));
    }
    if (folder.selected && obj.userData.slot === folder.selected) { // a part picked (body: no box)
      const helper = new THREE.BoxHelper(obj, '#ffb020');
      helper.userData.helper = true;
      group.add(helper);
    }
  }
  showImported(group);
  updateEditStats();
  setOmStatus(`${notes.join('\n')}\nแม่แบบสำหรับส่งออก: ${template ? template.name : '-'}`);
}

// --- New car from this folder ------------------------------------------------------------------
// Pivots: each part scales around the centre of its stock LOD 2 mesh; the whole car around the body's
// centre on the ground (x 0, z 0).
async function computePivots(f) {
  f.pivots = new Map();
  for (const slot of f.slots) {
    const v = slot.variants.find((x) => x.name === 'default') || slot.variants[0];
    const prefix = slot.dir ? `${slot.dir}/` : '';
    const rel = [2, 1, 0].map((l) => `${prefix}${v.mesh}_${l}.0m`).find((r) => f.files.has(r));
    if (!rel) continue;
    try { f.pivots.set(slot.dir, bboxOf(parseOM(await f.files.get(rel).arrayBuffer()).positions).center); } catch { /* unreadable */ }
  }
  const body = f.pivots.get('') || [0, 0, 0];
  f.carPivot = [0, body[1], 0];
  await editReady;
}

const editOf = (dir) => {
  if (!folder.edits.has(dir)) folder.edits.set(dir, structuredClone(IDENTITY));
  return folder.edits.get(dir);
};

function sliderRow(label, min, max, step, value, onInput, fmt = (v) => v.toFixed(2)) {
  const row = document.createElement('label');
  row.className = 'row';
  const lbl = document.createElement('span');
  lbl.className = 'lbl';
  lbl.textContent = label;
  const out = document.createElement('output');
  out.textContent = fmt(value);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = min; input.max = max; input.step = step; input.value = value;
  input.addEventListener('input', () => { out.textContent = fmt(Number(input.value)); onInput(Number(input.value)); });
  row.append(lbl, out, input);
  return row;
}

function buildEditPanel() {
  const box = document.getElementById('car-edit');
  box.hidden = !folder;
  box.innerHTML = '';
  if (!folder) return;
  const h = document.createElement('h2');
  h.textContent = 'สร้างรถคันใหม่จากโฟลเดอร์นี้';
  box.appendChild(h);
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = 'ไฟล์ทุกไฟล์เขียนจากไฟล์เดิมของรถคันนี้ ชิ้นที่ไม่แก้จะเหมือนเดิมทุกไบต์ · ยืดความยาวรถแล้วล้อในเกมอาจไม่ตรงซุ้มล้อ';
  box.appendChild(hint);
  // New name
  const nameRow = document.createElement('label');
  nameRow.className = 'row row-select';
  const nl = document.createElement('span');
  nl.className = 'lbl';
  nl.textContent = 'ชื่อรถใหม่';
  const ni = document.createElement('input');
  ni.type = 'text';
  ni.value = folder.newName;
  ni.addEventListener('change', () => { folder.newName = ni.value.trim().replace(/[^a-z0-9_]/gi, '_').toLowerCase() || folder.name; ni.value = folder.newName; });
  nameRow.append(nl, ni);
  box.appendChild(nameRow);
  // Whole car
  const car = folder.car;
  const sub = (t) => { const e = document.createElement('div'); e.className = 'edit-sub'; e.textContent = t; box.appendChild(e); };
  sub('ทั้งคัน');
  box.appendChild(sliderRow('กว้าง ×', 0.7, 1.4, 0.01, car.scale[0], (v) => { car.scale[0] = v; queueReassemble(); }));
  box.appendChild(sliderRow('ยาว ×', 0.7, 1.4, 0.01, car.scale[1], (v) => { car.scale[1] = v; queueReassemble(); }));
  box.appendChild(sliderRow('สูง ×', 0.7, 1.4, 0.01, car.scale[2], (v) => { car.scale[2] = v; queueReassemble(); }));
  box.appendChild(sliderRow('เก็บ poly ทั้งคัน %', 5, 100, 1, car.keep * 100, (v) => { car.keep = v / 100; queueReassemble(); }, (v) => `${v.toFixed(0)}%`));
  box.appendChild(pickerRow('จุดสูงสุดต่อไฟล์', [['0', 'ไม่จำกัด'], ['2000', '2,000 (เท่ารถในเกม)'], ['3000', '3,000'], ['4000', '4,000'], ['1500', '1,500'], ['1000', '1,000']],
    String(car.maxVerts || 0), (v) => { car.maxVerts = Number(v); queueReassemble(); }));
  const capHint = document.createElement('p');
  capHint.className = 'hint';
  capHint.textContent = 'ลดเฉพาะไฟล์ที่เกิน ลดน้อยที่สุดเท่าที่ต้องลด รวมจุดซ้อนก่อน ล็อกขอบชิ้นและรอยต่อภาพ ไม่ให้รูปทรงเสีย · ชุดที่ 8,000+ จุดเด้งในเกม';
  box.appendChild(capHint);
  // One part
  sub('ทีละชิ้น');
  const opts = folder.slots.map((sl) => [sl.dir, sl.dir || 'body (ตัวถัง)']);
  box.appendChild(pickerRow('ชิ้นที่แก้', opts, folder.selected, (v) => { folder.selected = v; buildEditPanel(); queueReassemble(); }));
  const e = editOf(folder.selected);
  box.appendChild(sliderRow('กว้าง ×', 0.5, 1.5, 0.01, e.scale[0], (v) => { e.scale[0] = v; queueReassemble(); }));
  box.appendChild(sliderRow('ยาว ×', 0.5, 1.5, 0.01, e.scale[1], (v) => { e.scale[1] = v; queueReassemble(); }));
  box.appendChild(sliderRow('สูง ×', 0.5, 1.5, 0.01, e.scale[2], (v) => { e.scale[2] = v; queueReassemble(); }));
  box.appendChild(sliderRow('เลื่อน ซ้าย/ขวา (ม.)', -0.5, 0.5, 0.005, e.move[0], (v) => { e.move[0] = v; queueReassemble(); }));
  box.appendChild(sliderRow('เลื่อน หน้า/หลัง (ม.)', -0.5, 0.5, 0.005, -e.move[1], (v) => { e.move[1] = -v; queueReassemble(); }));
  box.appendChild(sliderRow('เลื่อน ขึ้น/ลง (ม.)', -0.3, 0.3, 0.005, e.move[2], (v) => { e.move[2] = v; queueReassemble(); }));
  box.appendChild(sliderRow('เก็บ poly %', 5, 100, 1, e.keep * 100, (v) => { e.keep = v / 100; queueReassemble(); }, (v) => `${v.toFixed(0)}%`));
  const btns = document.createElement('div');
  btns.className = 'btns';
  const mk = (text, fn, cls) => { const b = document.createElement('button'); b.textContent = text; if (cls) b.className = cls; b.addEventListener('click', fn); btns.appendChild(b); return b; };
  mk('รีเซ็ตชิ้นนี้', () => { folder.edits.delete(folder.selected); buildEditPanel(); queueReassemble(); });
  mk('รีเซ็ตทั้งหมด', () => { folder.edits.clear(); folder.car = structuredClone(IDENTITY); buildEditPanel(); queueReassemble(); });
  mk(folder.explode ? 'รวมชิ้น' : 'แยกชิ้นให้ดู', () => { folder.explode = !folder.explode; buildEditPanel(); queueReassemble(); });
  mk('⬇ ดาวน์โหลดรถคันใหม่ (.zip)', downloadNewCar, 'accent');
  box.appendChild(btns);
  const stats = document.createElement('pre');
  stats.id = 'edit-stats';
  stats.className = 'hint';
  box.appendChild(stats);
}

// Vertex/triangle counts of every part's stock LOD 2 after the edits (the game's own cars stay
// under ~2,000 vertices per file).
let statsTimer = 0;
function updateEditStats() {
  clearTimeout(statsTimer);
  statsTimer = setTimeout(async () => {
    const el = document.getElementById('edit-stats');
    if (!el || !folder?.edits) return;
    const lines = ['ชิ้น            จุด (LOD2)  สามเหลี่ยม  เพี้ยนสูงสุด'];
    for (const slot of folder.slots) {
      const v = slot.variants.find((x) => x.name === folder.choice.get(slot.dir)) || slot.variants[0];
      const rel = `${slot.dir ? `${slot.dir}/` : ''}${v.mesh}_2.0m`;
      if (!folder.files.has(rel)) continue;
      const raw = new Uint8Array(await folder.files.get(rel).arrayBuffer());
      const info = editFileInfo(raw, folder.edits.get(slot.dir), folder.car, folder.pivots.get(slot.dir) || [0, 0, 0], folder.carPivot);
      const c = countsOf(info ? info.bytes : raw);
      const err = info && info.error ? `${(info.error * 1000).toFixed(0)} มม.` : '-';
      lines.push(`${(slot.dir || 'body').padEnd(15)} ${String(c.verts).padStart(6)}${c.verts > 2000 ? ' ⚠' : '  '}   ${String(c.tris).padStart(6)}     ${err}`);
    }
    lines.push('⚠ = เกิน 2,000 จุด (รถในเกมไม่เกินนี้)');
    el.textContent = lines.join('\n');
  }, 200);
}

// The new car: every file of the folder, edited and renamed, as <new name>.zip.
async function downloadNewCar() {
  const oldName = folder.name;
  const newName = folder.newName || oldName;
  const files = [];
  for (const [rel, file] of [...folder.files].sort((a, b) => a[0].localeCompare(b[0]))) {
    let data = new Uint8Array(await file.arrayBuffer());
    const lower = rel.toLowerCase();
    if (lower.endsWith('.0m')) {
      const dir = slotOfPath(rel);
      data = editFile(data, folder.edits.get(dir), folder.car, folder.pivots.get(dir) || [0, 0, 0], folder.carPivot) || data;
    } else if (lower === 'mesh.xml') {
      const t = editMeshXml(decodeSpec(await file.arrayBuffer()), folder.car, folder.carPivot);
      if (t) data = encodeSpec(t);
    } else if (lower.endsWith('list.xml') && newName !== oldName) {
      data = encodeSpec(decodeSpec(await file.arrayBuffer()).split(oldName).join(newName));
    } else if (rel === folder.specRel) {
      data = encodeSpec(writeSpec(spec.text, spec.values));
    }
    files.push({ path: `${newName}/${renamePath(rel, oldName, newName)}`, data: new Uint8Array(data) });
  }
  download(await makeZip(files), `${newName}.zip`);
  setOmStatus(`ดาวน์โหลด ${newName}.zip: ${files.length} ไฟล์ (สร้างจาก ${oldName})`);
}

// One-click download of everything for the car on screen: the opened / embedded folder with all
// LODs, textures, list.xml, dooropen, icons and the spec (with the edits made in the spec section).
async function downloadCarZip() {
  if (!imported || (!folder && !looseFiles)) {
    alert('เลือกรถ RayCity ด้านบน หรือเปิดโฟลเดอร์รถ / ไฟล์ .0m ก่อน แล้วค่อยกดดาวน์โหลด');
    return;
  }
  const btn = document.getElementById('btn-car-zip');
  btn.disabled = true;
  try {
    const name = folder ? folder.name : imported.name;
    const files = [];
    const entries = folder ? [...folder.files] : looseFiles.map((f) => [f.name, f]);
    for (const [rel, file] of entries.sort((a, b) => a[0].localeCompare(b[0]))) {
      const data = folder && rel === folder.specRel
        ? encodeSpec(writeSpec(spec.text, spec.values))
        : new Uint8Array(await file.arrayBuffer());
      files.push({ path: `${name}/${rel}`, data: new Uint8Array(data) });
    }
    download(await makeZip(files), `${name}.zip`);
    setOmStatus(`ดาวน์โหลด ${name}.zip: ${files.length} ไฟล์ (แตกไฟล์แล้วได้โฟลเดอร์ ${name}/ พร้อมวางในโฟลเดอร์ car ของเกม)`);
  } finally {
    btn.disabled = false;
  }
}

// Collects files from a drag-and-drop, walking into folders.
async function droppedEntries(dt) {
  const out = [];
  const walk = async (entry, prefix) => {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      out.push({ file, path: prefix + entry.name });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
      } while (batch.length);
    }
  };
  const roots = [...dt.items].map((it) => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean);
  for (const r of roots) await walk(r, '');
  return out;
}

// Cars embedded at build time (../cars/<name>): one button each, opened like a dropped folder.
async function openEmbeddedCar(name) {
  const b64 = (window.RC_EMBEDDED_CARS || {})[name];
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const json = await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  const entries = Object.entries(JSON.parse(json)).map(([p, data]) => ({
    path: p,
    file: new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], p.split('/').pop()),
  }));
  await openCarFolder(entries);
}

// Test packs (../cars/test/*.zip, embedded at build time): one download button each.
const TEST_PACK_INFO = {
  '48_canyon_like_40_all_white.zip': ['ชุด 48: สีแบบชุด 40 แต่ขาวทั้งคัน ⭐ ลองอันนี้', 'UV/มาสก์ของเราเอง (แบบ 39/40 ที่ไม่มีสามเหลี่ยมดำ) + หน้ารถ/สเกิร์ตย้ายเข้าไฟล์ที่ทาสีได้ + ประตูใน roof + กระจกใส · ลายในร้านจะไม่ตรงแบบ gtv98'],
  '47_canyon_uv_on_islands.zip': ['ชุด 47: แบบ 46 + ลายทุกสามเหลี่ยมอยู่บนเกาะลายของ gtv98 (ยังมีสามเหลี่ยมดำ)', 'สามเหลี่ยมที่ลายตกที่ว่างระหว่างเกาะ: ตัวถัง 5% → 0.4%, หลังคา/ประตู 9% → 2%, กันชนหลัง 16% → 3.5%'],
  '46_canyon_files_like_gtv98.zip': ['ชุด 46: ทุกชิ้นอยู่ไฟล์เดียวกับ gtv98 (ประตูอยู่ใน roof) + สี 3 ช่องแบบ 43 (ประตูขาวแล้ว)', 'แก้ประตู/ท้ายดำ: ลาย UV ไม่กระโดดข้ามรูปแล้ว (เหลือ 0.2%) · ไฟท้ายทำแบบ polestar1 (ไฟ 3 ชั้น)'],
  '45_canyon_clear_detail_layer.zip': ['ชุด 45: แบบ 44 + ชั้นรายละเอียดใส (ในเกมยังดำ)', 'ต่างจาก 44 แค่ 2 ไฟล์ canyon_color.png / canyon_color_s.dds (เป็นแบบใสเหมือนชุด 39 ที่ประตูขาว)'],
  '44_canyon_front_into_hood.zip': ['ชุด 44: แบบ 42 + ย้ายหน้ารถ/สเกิร์ตไปอยู่ในไฟล์ฝากระโปรง/หลังคา', 'เผื่อเกมไม่แสดงไฟล์กันชนหน้า ไฟหน้า สเกิร์ต · ไฟล์ที่เกมแสดงแน่: ตัวถัง ฝากระโปรง หลังคา กันชนหลัง ไฟท้าย'],
  '43_canyon_gtv98_layout_gtv98_paint.zip': ['ชุด 43: แบบ gtv98 + มาสก์สีของ gtv98 (3 ช่องสี)', 'ตัวถัง=สี1 ขอบล่าง/กันชน=สี2 ฝากระโปรง=สี3 แบบ gtv98 · กระจกใส · มีลายจุดเพี้ยนบ้าง'],
  '42_canyon_gtv98_layout_no_part_textures.zip': ['ชุด 42: แบบ gtv98 · ไม่มีรูปชิ้นส่วน ⭐ ลองอันนี้', 'กระจกใส + ใส่ลายได้ (ผ่านในชุด 41) + ชิ้นส่วนรับสีรถจากตัวถัง (แบบชุด 39) แก้ส่วนดำ/โปร่ง'],
  '41_canyon_gtv98_layout_glass_paintall.zip': ['ชุด 41: ✅ กระจกใส ใส่ลายได้ (ชิ้นส่วนยังดำ/โปร่ง)', 'UV แบบ gtv98 (ใส่ลายได้) · กระจกเป็นชิ้นใสแบบ gtv98 · รูปชิ้นส่วนของ gtv98 · ทั้งคันสี 1'],
  '40_canyon_part_colors_diagnostic.zip': ['ชุด 40: ทดสอบ · ทาสีแยกทุกชิ้น ดูว่าชิ้นไหนเกมแสดง', 'กันชนหน้า=แดง ไฟหน้า=เขียว กันชนหลัง=น้ำเงิน ไฟท้าย=เหลือง สเกิร์ต=ชมพู กระจัง=ฟ้า ฝากระโปรง=ส้ม หลังคา=ม่วง · ถ่ายรูปรอบคันส่งมา'],
  '39_canyon_no_part_textures.zip': ['ชุด 39: ✅ ท้ายรถเปลี่ยนสีได้แล้ว (ลบรูปของชิ้นส่วน) ⭐', 'แบบเดียวกับฝากระโปรง/หลังคาของ gtv98 ที่ไม่มีรูป → ชิ้นส่วนน่าจะได้สีรถจากตัวถัง'],
  '38_canyon_red_part_textures.zip': ['ชุด 38: เหมือน 37 + รูปของชิ้นส่วนเป็นสีแดง (แบบมาสก์สี)', 'ทดสอบว่าเกมใช้รูปของชิ้นส่วนเป็นมาสก์สีของชิ้นนั้นไหม'],
  '37_canyon_all_paint_column.zip': ['ชุด 37: ทุกผิวอ่านสีจากช่องสีรถ (ยกเว้นกระจก ไฟ)', 'ต่อจากชุด 35 (ไม่รวมชิ้น ไม่แหว่ง) · ตัวถังทั้งหมดเปลี่ยนสีได้'],
  '36_canyon_all_in_body.zip': ['ชุด 36: canyon ทุกชิ้นรวมในตัวถัง (ทาสีได้แน่นอน)', 'เหมือนชุด 35 แต่ฝากระโปรง กันชน ฯลฯ ย้ายมาอยู่ในไฟล์ตัวถัง (4,989 จุด) เผื่อชิ้นแยกยังไม่รับสี'],
  '35_canyon_narrow_wheels_paintall.zip': ['ชุด 35: canyon แคบลง + ซุ้มล้อตรงล้อเกม + เปลี่ยนสีได้ทั้งคัน ⭐', 'กว้าง 2.30 → 1.80 ม. · เลื่อนตัวรถ 11 ซม. ให้ซุ้มล้อตรงล้อเกม · ทุกส่วนเปลี่ยนสีได้ยกเว้นกระจกและไฟ'],
  '34_canyon_paint_parts.zip': ['ชุด 34: canyon · ฝากระโปรง/หลังคาได้สีรถแล้ว ⭐', 'ต่อจากชุด 33: ลบรูปชิ้นส่วนที่ gtv98 ไม่มี (ฝากระโปรงเคยเป็นน้ำตาล หลังคาดำ) · ไฟล์เหมือน gtv98 ทุกไฟล์'],
  '33_canyon_fixed.zip': ['ชุด 33: canyon (ที่คุณส่งมา) ซ่อมแล้ว ⭐', 'เปลี่ยนชื่อไฟล์ข้างในจาก rc_phoenix445 เป็น canyon ให้ตรงโฟลเดอร์ + แก้ UV แบน (สีเทาโปร่ง) · ไฟล์ครบเหมือน gtv98'],
  '32_phoenix445_fixed_uv.zip': ['ชุด 32: rc_phoenix445 ของคุณ แก้สีเทาโปร่ง/เปลี่ยนสีไม่ได้ ⭐', 'กระจาย UV ให้ทุกสามเหลี่ยม (เดิมแบน 100%) + มาสก์ช่องใหญ่ · ชื่อ rc_phoenix445 เดิม · ทรงเหมือนเดิม'],
  '31_urus_outer_surface_3500.zip': ['ชุด 31: Urus ผิวนอกจริงของโมเดล (ตัดข้างใน) ลดเหลือ 3,500 ⭐', 'ขอบสีคมตามต้นฉบับ ทุกไฟล์ไม่เกิน 3,508 จุด · มาสก์แบบใหม่ · ผ่านตรวจทุกข้อ'],
  '30_your_car_spread_uv_all_red.zip': ['ชุด 30: รถที่คุณส่งมา · ทั้งคันเป็นสีรถ (มาสก์แดงทั้งรูป)', 'ใช้ทดสอบว่าโครงนี้เปลี่ยนสีได้ไหม ถ้าชุดนี้ยังดำ = ปัญหาไม่ใช่ที่มาสก์'],
  '29_your_car_big_paint_zones.zip': ['ชุด 29: รถที่คุณส่งมา · มาสก์สีแบบช่องใหญ่ (แบบใหม่) ⭐', 'แก้ปัญหาสีดำเปลี่ยนสีไม่ได้: สีรถอ่านจากช่องใหญ่เต็มความสูงแทนแถบเล็กบนสุด'],
  '28_old_body_bent.zip': ['ชุด 28: ตัวถัง gtv98 ดัดเป็นทรง Urus 🛡 ปลอดภัยสุด', 'ไฟล์ทุกอย่างเหมือน gtv98 ที่เข้าเกมได้ (จำนวนจุดเท่าเดิม) ขยับแค่ตำแหน่งจุดให้เป็นทรงรถใหม่'],
  '25_limit_4000.zip': ['ชุด 25: หาเพดานเกม — ไม่เกิน 4,000 จุดต่อไฟล์', 'ตัวถัง 3,927 จุด · ลองทีละชุด 25 → 26 → 27 ชุดไหนเด้งบอกด้วย'],
  '26_limit_4500.zip': ['ชุด 26: หาเพดานเกม — ไม่เกิน 4,500 จุดต่อไฟล์', 'ตัวถัง 4,353 จุด'],
  '27_limit_6000.zip': ['ชุด 27: หาเพดานเกม — ไม่เกิน 6,000 จุดต่อไฟล์', 'ตัวถัง 5,825 จุด (8,000 เคยเด้ง)'],
  '24_urus_no_reduce.zip': ['ชุด 24: Urus ไม่ลด poly ใช้ผิวจริงของโมเดล ⚠ ทดลอง', 'ทั้งคัน ~105,000 สามเหลี่ยม (ตัวถัง 19,667 จุด) เกินที่เคยผ่าน (3,631) มาก ลองเพื่อดูว่าเกมรับได้ไหม ถ้าเด้งให้กลับไปใช้ชุดฐาน · ชื่อ rc_canyon เดิม'],
  '23_urus_from_web.zip': ['ชุด 23: Lamborghini Urus (ถอดล้อแล้ว) ทำจากหน้าเว็บ ⭐', 'สร้างด้วยปุ่ม "สร้างรถจากโมเดล 3D" ทุกชิ้นได้ 3,500 จุดของตัวเอง (ทั้งคัน ~17,500 สามเหลี่ยม) · ใช้ชื่อ rc_canyon เดิม'],
  '22_flat_colors_3500.zip': ['ชุด 22: สีเรียบต่อสามเหลี่ยม แบบรถในเกม ⭐', 'ทุกสามเหลี่ยมใช้สีเดียว (สีรถ/ดำ) ไม่มีปื้นดำมั่ว · ไม่เกิน 3,500 จุดต่อไฟล์'],
  'OK_gtv98_as_rc_canyon.zip': ['ชุดฐาน (ใช้ได้แล้ว)', 'gtv98 ของเกมเปลี่ยนชื่อเป็น rc_canyon ไม่มีไฟล์ของเราเลย ใช้สลับกลับเมื่อต้องการ'],
};
function bindTestPacks() {
  const box = document.getElementById('test-packs');
  const packs = window.RC_TEST_PACKS || [];
  document.getElementById('test-packs-box').hidden = !packs.length;
  for (const { file, data } of packs) {
    const [title, desc] = TEST_PACK_INFO[file] || [file, ''];
    const row = document.createElement('div');
    row.className = 'test-pack';
    const b = document.createElement('button');
    b.textContent = `⬇ ${title}`;
    b.title = file;
    b.addEventListener('click', () => {
      const bin = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      download(new Blob([bin], { type: 'application/zip' }), file);
    });
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = desc;
    row.append(b, p);
    box.appendChild(row);
  }
}

function bindEmbeddedCars() {
  const box = document.getElementById('embedded-cars');
  for (const name of Object.keys(window.RC_EMBEDDED_CARS || {})) {
    const b = document.createElement('button');
    b.className = 'accent';
    b.textContent = `🏎 ${name}`;
    b.title = 'เปิดรถ RayCity ที่ทำไว้แล้ว';
    b.addEventListener('click', () => openEmbeddedCar(name));
    box.appendChild(b);
  }
}

function bindOmButtons() {
  bindEmbeddedCars();
  bindTestPacks();
  const dirInput = document.getElementById('file-om-dir');
  document.getElementById('btn-om-folder').addEventListener('click', () => dirInput.click());
  dirInput.addEventListener('change', async (e) => {
    await openCarFolder([...e.target.files].map((file) => ({ file, path: file.webkitRelativePath || file.name })));
    e.target.value = '';
  });
  const hint = document.getElementById('drop-hint');
  viewport.addEventListener('dragover', (e) => { e.preventDefault(); hint.hidden = false; });
  viewport.addEventListener('dragleave', (e) => { if (e.target === viewport || e.target === renderer.domElement) hint.hidden = true; });
  // Dropping outside the 3D view should not make the browser open the file.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
  viewport.addEventListener('drop', async (e) => {
    e.preventDefault();
    hint.hidden = true;
    const entries = await droppedEntries(e.dataTransfer);
    // A model (with its pictures / .mtl, or a .zip of them) unless it is a RayCity car folder.
    const isCar = entries.some((x) => /(^|\/)body_\d\.0m$/i.test(x.path));
    const model = !isCar && entries.some((x) => MODEL_TYPES.split(',').some((t) => x.path.toLowerCase().endsWith(t)) || /\.zip$/i.test(x.path));
    if (model) await openModelFile(entries.map((x) => x.file));
    else if (entries.length) await openCarFolder(entries);
  });
  const input = document.getElementById('file-om');
  document.getElementById('btn-om-open').addEventListener('click', () => input.click());
  input.addEventListener('change', async (e) => { await openOmFiles(e.target.files); e.target.value = ''; });
  document.getElementById('btn-om-back').addEventListener('click', () => showImported(null));
  document.getElementById('btn-om-export').addEventListener('click', exportOm);
  document.getElementById('btn-car-zip').addEventListener('click', downloadCarZip);
  document.getElementById('btn-car-check').addEventListener('click', async () => {
    const el = document.getElementById('car-check');
    if (!folder) { el.textContent = 'เปิดโฟลเดอร์รถ หรือกดรถด้านบนก่อน'; return; }
    el.textContent = '🩺 กำลังตรวจ…';
    const files = new Map();
    for (const [rel, file] of folder.files) files.set(rel, new Uint8Array(await file.arrayBuffer()));
    let tpl = null;
    try { tpl = await modelTemplate(); } catch { /* no template: skip the template checks */ }
    const list = await checkCar(files, folder.name, tpl);
    renderChecks(el, list);
    // What the folder lacks, file by file, and a button to fill it in.
    const { added } = await completeCar(files, folder.name, tpl);
    const box = document.createElement('div');
    box.className = 'complete-box';
    if (!added.length) {
      box.textContent = '📁 ไฟล์ครบทั้งโฟลเดอร์แล้ว ไม่มีอะไรต้องเติม';
    } else {
      const det = document.createElement('details');
      det.open = added.length <= 12;
      const sum = document.createElement('summary');
      sum.textContent = `📁 โฟลเดอร์นี้ขาด ${added.length} ไฟล์ (กดดูรายการ)`;
      const ul = document.createElement('ul');
      for (const a of added) { const li = document.createElement('li'); li.textContent = `${a.rel} ← จะใช้ ${a.from}`; ul.appendChild(li); }
      det.append(sum, ul);
      const go = document.createElement('button');
      go.className = 'accent';
      go.textContent = `➕ เติมไฟล์ที่ขาดให้ครบ แล้วดาวน์โหลด ${folder.name}.zip`;
      go.addEventListener('click', async () => {
        go.disabled = true;
        const { files: full } = await completeCar(files, folder.name, tpl);
        const zipFiles = [...full].sort((a, b) => a[0].localeCompare(b[0])).map(([rel, data]) => ({ path: `${folder.name}/${rel}`, data }));
        download(await makeZip(zipFiles), `${folder.name}.zip`);
        const entries = zipFiles.map((z) => ({ path: z.path, file: new File([z.data], z.path.split('/').pop()) }));
        await openCarFolder(entries);
        const after = await checkCar(full, folder.name, tpl);
        renderChecks(el, [{ level: 'ok', text: `➕ เติมแล้ว ${added.length} ไฟล์ · เปิดโฟลเดอร์ที่ครบแล้วในจอ 3D` }, ...after]);
      });
      box.append(det, go);
    }
    el.appendChild(box);
    if (list.some((c) => /ซ่อมให้อัตโนมัติ|UV แบน/.test(c.text))) {
      const fix = document.createElement('button');
      fix.className = 'accent';
      fix.textContent = `🔧 ซ่อมให้อัตโนมัติ แล้วดาวน์โหลด ${folder.name}.zip`;
      fix.addEventListener('click', async () => {
        fix.disabled = true;
        const { files: fixed, fixes } = await repairCar(files, folder.name, tpl);
        const zipFiles = [...fixed].sort((a, b) => a[0].localeCompare(b[0])).map(([rel, data]) => ({ path: `${folder.name}/${rel}`, data }));
        download(await makeZip(zipFiles), `${folder.name}.zip`);
        const after = await checkCar(fixed, folder.name, tpl);
        renderChecks(el, [...fixes.map((t) => ({ level: 'ok', text: `🔧 ${t}` })), ...after]);
      });
      el.appendChild(fix);
    }
  });
}

// --- Car spec (.xml) -------------------------------------------------------------
let spec = { text: SPEC_TEMPLATE, values: readSpec(SPEC_TEMPLATE), name: '' };

function buildSpecFields() {
  const box = document.getElementById('spec-fields');
  box.innerHTML = '';
  for (const f of SPEC_FIELDS) {
    if (!(f.tag in spec.values)) continue;
    const row = document.createElement('label');
    row.className = 'row';
    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = f.label;
    lbl.title = f.tag;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = spec.values[f.tag];
    input.addEventListener('change', () => { spec.values[f.tag] = input.value.trim(); });
    row.append(lbl, input);
    box.appendChild(row);
  }
}

function loadSpecText(text, name) {
  spec = { text, values: readSpec(text), name };
  buildSpecFields();
}

function bindSpecButtons() {
  const input = document.getElementById('file-spec');
  document.getElementById('btn-spec-open').addEventListener('click', () => input.click());
  input.addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (f) loadSpecText(decodeSpec(await f.arrayBuffer()), f.name.replace(/\.xml$/i, ''));
    e.target.value = '';
  });
  document.getElementById('btn-spec-suggest').addEventListener('click', () => {
    Object.assign(spec.values, suggestSpec(params));
    buildSpecFields();
    document.getElementById('spec-box').open = true;
  });
  document.getElementById('btn-spec-export').addEventListener('click', () => {
    const name = imported && folder ? folder.name : spec.name || params.name;
    download(new Blob([encodeSpec(writeSpec(spec.text, spec.values))], { type: 'application/xml' }), `${name}.xml`);
  });
  buildSpecFields();
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

// --- 3D model → RayCity car ------------------------------------------------------
// A whole car model (with wheels, brakes, interior) is opened, shown with the parts that won't go into
// the game (wheels, cut materials) in pink, adjusted (click pieces, material categories, front/back),
// then converted on the page (js/convert.js) and opened as a car folder for checking and downloading.
const CAT_COLORS = {
  Body_Color: '#4f8cff', Glass_Gray: '#26343f', Projector_Glass: '#fff6c4', Taillight_Glass: '#c3122a', Lights_Auto: '#f1e3a0',
  Turn_Signal_LED: '#ffa21a', metal_chrome: '#d8dde3', metal_gray: '#8b939c', plastic_gray: '#3c3f45', Carbon_Fiber: '#23262b',
  Interior_dark: '#6a5442',
};
const srcModel = { model: null, categories: new Map(), preview: null, pick: false, hideRemoved: false, file: null, gameWheels: { ...GAME_WHEELS.gtv98 }, fitMode: 'uniform', fitNote: '' };

async function modelTemplate() {
  if (srcModel.template) return srcModel.template;
  const b64 = (window.RC_TEMPLATES || {}).gtv98;
  if (!b64) throw new Error('ไม่มีรถแม่แบบ (gtv98) ในหน้าเว็บ');
  return (async () => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const json = await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    const files = new Map(Object.entries(JSON.parse(json)).map(([p, d]) => [p, Uint8Array.from(atob(d), (c) => c.charCodeAt(0))]));
    srcModel.template = { name: 'gtv98', files };
    return srcModel.template;
  })();
}

// Preview: kept triangles in category colors, removed ones (wheels, cut materials) pink, a green
// arrow at the front.
function buildModelPreview() {
  const m = srcModel.model;
  const nt = m.C.length;
  const keep = []; const gone = [];
  for (let t = 0; t < nt; t++) {
    const cat = categoryOf(m, srcModel.categories, t);
    (m.removed[m.C[t]] || cat === 'skip' ? gone : keep).push(t);
  }
  const toThree = (A, list, colors) => {
    const pos = new Float32Array(list.length * 9); const nrm = new Float32Array(list.length * 9);
    const col = colors ? new Float32Array(list.length * 9) : null;
    const c = new THREE.Color();
    list.forEach((t, i) => {
      for (let j = 0; j < 3; j++) {
        const o = t * 9 + j * 3; const d = i * 9 + j * 3;
        pos[d] = m.P[o]; pos[d + 1] = m.P[o + 2]; pos[d + 2] = -m.P[o + 1];
        nrm[d] = m.N[o]; nrm[d + 1] = m.N[o + 2]; nrm[d + 2] = -m.N[o + 1];
      }
      if (col && srcModel.showTex && m.TC?.length) {
        // The model's own look (its pictures), corner by corner.
        for (let j = 0; j < 3; j++) { c.setRGB(m.TC[t * 9 + j * 3], m.TC[t * 9 + j * 3 + 1], m.TC[t * 9 + j * 3 + 2]).convertSRGBToLinear(); col.set([c.r, c.g, c.b], i * 9 + j * 3); }
      } else if (col) {
        c.set(CAT_COLORS[categoryOf(m, srcModel.categories, t)] || '#3c3f45').convertSRGBToLinear();
        for (let j = 0; j < 3; j++) col.set([c.r, c.g, c.b], i * 9 + j * 3);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  };
  const group = new THREE.Group();
  group.name = 'model';
  const kept = new THREE.Mesh(toThree(m.P, keep, true), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide }));
  kept.userData.tris = keep;
  const removed = new THREE.Mesh(toThree(m.P, gone, false), new THREE.MeshStandardMaterial({ color: '#ff2bd6', roughness: 0.6, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
  removed.userData.tris = gone;
  removed.visible = !srcModel.hideRemoved;
  kept.castShadow = true;
  group.add(kept, removed);
  let y0 = Infinity; let zTop = 0;
  for (let i = 0; i < m.P.length; i += 3) { y0 = Math.min(y0, m.P[i + 1]); zTop = Math.max(zTop, m.P[i + 2]); }
  // The game's own wheels (where they will be in game), dark see-through.
  const gw = srcModel.gameWheels;
  const tyreMat = new THREE.MeshStandardMaterial({ color: '#15171c', transparent: true, opacity: 0.55, roughness: 0.9, depthWrite: false });
  for (const y of [gw.front, gw.rear]) for (const x of [-gw.track, gw.track]) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(gw.radius, gw.radius, 0.22, 28).rotateZ(Math.PI / 2), tyreMat);
    t.position.set(x, gw.radius, -y);
    t.renderOrder = 3;
    group.add(t);
  }
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, zTop * 0.5, -y0 + 0.15), 0.9, '#3ee07a', 0.3, 0.2);
  group.add(arrow);
  group.userData.files = `โมเดลต้นฉบับ (ยังไม่แปลง) · ตัวรถ ${keep.length.toLocaleString()} · ถอด ${gone.length.toLocaleString()} สามเหลี่ยม`;
  srcModel.preview = group;
  srcModel.counts = { keep: keep.length, gone: gone.length };
  return group;
}

function showModelPreview() {
  folder = null;
  document.getElementById('om-parts').innerHTML = '';
  document.getElementById('car-edit').hidden = true;
  showImported(buildModelPreview());
  updateModelInfo();
}

function updateModelInfo() {
  const m = srcModel.model;
  const el = document.getElementById('model-info');
  if (!m || !el) return;
  const wheelsOff = m.pieces.filter((p, i) => p.wheel && m.removed[i]).length;
  el.textContent = `${m.C.length.toLocaleString()} สามเหลี่ยม · ${m.pieces.length.toLocaleString()} ชิ้น · ยาว ${(srcModel.length || 0).toFixed(2)} ม.\n`
    + `เจอล้อ ${m.wheels.length} ล้อ (${wheelsOff} ชิ้นที่เป็นล้อ/เบรก ถูกถอด)\n`
    + `ใส่ในรถ ${srcModel.counts.keep.toLocaleString()} · ถอดออก ${srcModel.counts.gone.toLocaleString()} สามเหลี่ยม (สีชมพู)`;
}

// A model with whatever came with it (.mtl, .bin, pictures), or a .zip holding them: one flat list of
// Files (folders inside a zip don't matter, textures are found by file name).
async function modelFiles(list) {
  const out = [];
  for (const f of [].concat(list)) {
    if (/\.zip$/i.test(f.name)) {
      for (const e of await readZip(new Uint8Array(await f.arrayBuffer()))) out.push(new File([e.data], e.path.split('/').pop()));
    } else out.push(f);
  }
  return out;
}

async function openModelFile(input) {
  const status = document.getElementById('model-log');
  const box = document.getElementById('model-panel');
  const files = await modelFiles(input);
  const file = files.find((f) => /\.(glb|gltf|fbx|obj)$/i.test(f.name));
  if (!file) { status.textContent = 'ไม่เจอไฟล์โมเดล (.glb .gltf .fbx .obj) ในที่เลือกมา'; return; }
  const extras = files.length - 1;
  status.textContent = `กำลังเปิด ${file.name}${extras ? ` + ไฟล์ประกอบ ${extras} ไฟล์ (รูป/วัสดุ)` : ''}…`;
  box.hidden = false;
  await new Promise((r) => setTimeout(r, 30));
  try {
    srcModel.model = await loadModel(files);
  } catch (e) {
    status.textContent = `เปิดไม่ได้: ${e.message}`;
    return;
  }
  srcModel.file = file;
  srcModel.showTex = !!srcModel.model.textured;
  srcModel.categories = new Map();
  const m = srcModel.model;
  let y0 = Infinity; let y1 = -Infinity;
  for (let i = 1; i < m.P.length; i += 3) { y0 = Math.min(y0, m.P[i]); y1 = Math.max(y1, m.P[i]); }
  srcModel.length = y1 - y0;
  srcModel.fitNote = fitToWheels(m, srcModel.gameWheels, srcModel.fitMode) || 'ไม่เจอล้อในโมเดล (ปรับขนาดเองไม่ได้)';
  status.textContent = '';
  buildModelPanel();
  showModelPreview();
  controls.target.set(0, 0.6, 0);
}

function buildModelPanel() {
  const m = srcModel.model;
  const box = document.getElementById('model-panel');
  box.innerHTML = '';
  const info = document.createElement('pre');
  info.id = 'model-info';
  info.className = 'hint';
  box.appendChild(info);

  // ⚡ The short way: everything that worked in game, in one click.
  const quick = document.createElement('div');
  quick.className = 'quick-box';
  quick.innerHTML = `<div class="quick-title">⚡ ทางลัด: เข้าเกมในคลิกเดียว</div>
    <div class="hint">ถอดล้อ ✔ · ปรับให้ตรงล้อเกม ✔ · ผิวจริงของโมเดล ✔ · UV แบบ gtv98 (ใส่ลายได้) ✔ · กระจกใส ✔ · เปลี่ยนสีได้ทั้งคัน ✔ · ตรวจ + ซ่อมอัตโนมัติ ✔</div>`;
  const qrow = document.createElement('div');
  qrow.className = 'btns';
  const qname = document.createElement('input');
  qname.type = 'text';
  qname.placeholder = 'ชื่อรถ (ชื่อ .jmd ที่ลงทะเบียนไว้)';
  qname.value = 'rc_canyon';
  qname.addEventListener('change', () => { qname.value = qname.value.trim().replace(/[^a-z0-9_]/gi, '_').toLowerCase(); });
  const qgo = document.createElement('button');
  qgo.className = 'accent';
  qgo.textContent = '⚡ สร้าง + ตรวจ + ดาวน์โหลด';
  // Reduce or not: 4,800 per file has loaded in game; the model's full surface can pass 8,000 per file,
  // which crashed the game before (the check after the build says which files).
  const qpoly = document.createElement('select');
  qpoly.title = 'ลด poly หรือใช้ผิวเต็มของโมเดล';
  qpoly.innerHTML = `<option value="60000">💎 ไม่ลด poly (ผิวเต็มของโมเดล)</option>
    <option value="4800">🔻 ลด poly (ไม่เกิน 4,800 จุดต่อไฟล์)</option>`;
  const qlog = document.createElement('pre');
  qlog.className = 'hint';
  qgo.addEventListener('click', () => quickBuild(qname.value || 'rc_car', qgo, qlog, +qpoly.value));
  qrow.append(qname, qpoly, qgo);
  quick.append(qrow, qlog);
  box.appendChild(quick);
  const adv = document.createElement('div');
  adv.className = 'edit-sub';
  adv.textContent = 'หรือปรับเองทีละขั้น ↓';
  box.appendChild(adv);

  const check = (label, value, onChange, title = '') => {
    const row = document.createElement('label');
    row.className = 'row row-check';
    row.title = title;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = value;
    input.addEventListener('change', () => onChange(input.checked));
    const span = document.createElement('span');
    span.textContent = label;
    row.append(input, span);
    box.appendChild(row);
    return input;
  };
  check(`ถอดล้อออก (ยาง ล้อแม็ก จานเบรก คาลิปเปอร์)`, true, (on) => {
    m.pieces.forEach((p, i) => { if (p.wheel) m.removed[i] = on ? 1 : 0; });
    showModelPreview();
  }, 'เกมใส่ล้อของมันเอง ล้อในโมเดลต้องเอาออก');
  check('ซ่อนชิ้นที่ถอดออก (ดูรถตอนไม่มีล้อ)', srcModel.hideRemoved, (on) => { srcModel.hideRemoved = on; if (srcModel.preview) srcModel.preview.children[1].visible = !on; });
  if (m.textured) check('🖼 แสดงสีจากรูปของโมเดล', srcModel.showTex, (on) => { srcModel.showTex = on; showModelPreview(); }, 'ไม่ติ๊ก = สีตามประเภทวัสดุ (กระจก ยาง สีรถ)');
  check('คลิกบนรถเพื่อถอด / ใส่ชิ้นนั้นคืน', srcModel.pick, (on) => { srcModel.pick = on; }, 'คลิกชิ้นสีชมพูเพื่อใส่คืน คลิกชิ้นอื่นเพื่อถอดออก (หมุนกล้องได้ตามปกติ)');

  const btns = document.createElement('div');
  btns.className = 'btns';
  const flip = document.createElement('button');
  flip.textContent = '↻ หันหน้ารถกลับ';
  flip.title = 'หน้ารถต้องอยู่ทางลูกศรสีเขียว';
  flip.addEventListener('click', () => { turnAround(m); showModelPreview(); });
  const back = document.createElement('button');
  back.textContent = '👁 ดูโมเดลต้นฉบับ';
  back.addEventListener('click', showModelPreview);
  btns.append(flip, back);
  box.appendChild(btns);
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = 'ลูกศรสีเขียว = หน้ารถ · สีชมพู = ไม่ใส่ในเกม · ล้อดำโปร่ง = ล้อของเกม · สีอื่นตามประเภทวัสดุด้านล่าง';
  box.appendChild(hint);

  // Fit to the game's wheels.
  const wsub = document.createElement('div');
  wsub.className = 'edit-sub';
  wsub.textContent = '🛞 ให้ซุ้มล้อตรงกับล้อในเกม';
  box.appendChild(wsub);
  const gw = srcModel.gameWheels;
  const wnote = document.createElement('p');
  wnote.className = 'hint';
  const refit = () => {
    srcModel.fitNote = fitToWheels(m, gw, srcModel.fitMode) || 'ไม่เจอล้อในโมเดล';
    wnote.textContent = `ปรับแล้ว: ${srcModel.fitNote}`;
    showModelPreview();
  };
  wnote.textContent = `ปรับแล้ว: ${srcModel.fitNote}`;
  const num = (label, key, step) => {
    const row = document.createElement('label');
    row.className = 'row';
    row.innerHTML = `<span>${label}</span>`;
    const i = document.createElement('input');
    i.type = 'number'; i.step = step; i.value = gw[key]; i.style.width = '80px';
    i.addEventListener('change', () => { gw[key] = Number(i.value) || gw[key]; refit(); });
    row.appendChild(i);
    box.appendChild(row);
  };
  box.appendChild(pickerRow('วิธีปรับ', [['uniform', 'ย่อ/ขยายทั้งคันเท่ากัน (ทรงเดิม)'], ['stretch', 'ยืดให้ตรงทุกด้าน (ยาว กว้าง สูง)']], srcModel.fitMode, (v) => { srcModel.fitMode = v; refit(); }));
  num('ล้อหน้าอยู่ที่ (ม. จากกลางรถ)', 'front', 0.01);
  num('ล้อหลังอยู่ที่ (ม.)', 'rear', 0.01);
  num('รัศมีล้อ (ม.)', 'radius', 0.01);
  num('ล้อห่างจากกลางรถ (ม.)', 'track', 0.01);
  const wb = document.createElement('div');
  wb.className = 'btns';
  const fitB = document.createElement('button');
  fitB.textContent = '🛞 ปรับให้ตรงล้อเกม';
  fitB.addEventListener('click', refit);
  const origB = document.createElement('button');
  origB.textContent = '↺ ขนาดเดิมของโมเดล';
  origB.addEventListener('click', () => { unfitWheels(m); wnote.textContent = 'ใช้ขนาดเดิมของโมเดล (ล้อเกมอาจไม่ตรงซุ้มล้อ)'; showModelPreview(); });
  wb.append(fitB, origB);
  box.append(wb, wnote);
  const wh = document.createElement('p');
  wh.className = 'hint';
  wh.textContent = 'ค่าเริ่มต้น = ล้อของ gtv98 (รถที่ใช้ลงทะเบียน) ถ้าลงทะเบียนจากรถคันอื่น ใส่ตำแหน่งล้อของคันนั้น · ดูในเกมแล้วล้อเลื่อนไปทางไหน ปรับตัวเลขตามได้';
  box.appendChild(wh);

  // Material categories.
  const det = document.createElement('details');
  const sum = document.createElement('summary');
  sum.textContent = `วัสดุในโมเดล (${m.materials.filter((x) => x.tris).length}) — เลือกว่าเป็นส่วนไหนของรถ`;
  det.appendChild(sum);
  const names = m.materials.filter((x) => x.tris).map((x) => x.name);
  let pre = names.length > 1 ? names[0] : '';
  for (const n of names) while (pre && !n.startsWith(pre)) pre = pre.slice(0, -1);
  for (const mat of [...m.materials].filter((x) => x.tris).sort((a, b) => b.tris - a.tris)) {
    const row = document.createElement('label');
    row.className = 'row row-select mat-row';
    const sw = document.createElement('i');
    sw.className = 'swatch';
    const span = document.createElement('span');
    span.textContent = `${mat.name.slice(pre.length) || mat.name} (${mat.tris.toLocaleString()})`;
    span.title = mat.name;
    const sel = document.createElement('select');
    for (const [v, l] of CATEGORIES) { const o = document.createElement('option'); o.value = v; o.textContent = l; sel.appendChild(o); }
    sel.value = srcModel.categories.get(mat.name) || mat.category;
    sw.style.background = sel.value === 'skip' ? '#ff2bd6' : CAT_COLORS[sel.value] || '#3c3f45';
    sel.addEventListener('change', () => {
      srcModel.categories.set(mat.name, sel.value);
      sw.style.background = sel.value === 'skip' ? '#ff2bd6' : CAT_COLORS[sel.value] || '#3c3f45';
      showModelPreview();
    });
    row.append(sw, span, sel);
    det.appendChild(row);
  }
  box.appendChild(det);

  // Output.
  const sub = document.createElement('div');
  sub.className = 'edit-sub';
  sub.textContent = 'แปลงเป็นรถ RayCity';
  box.appendChild(sub);
  const nameRow = document.createElement('label');
  nameRow.className = 'row';
  nameRow.innerHTML = '<span>ชื่อรถ (ชื่อไฟล์ .jmd)</span>';
  const ni = document.createElement('input');
  ni.type = 'text';
  ni.value = `rc_${(srcModel.file?.name || 'car').replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, '_').toLowerCase().replace(/^_|_$/g, '').slice(0, 20)}`;
  ni.addEventListener('change', () => { ni.value = ni.value.trim().replace(/[^a-z0-9_]/gi, '_').toLowerCase() || 'rc_car'; });
  nameRow.appendChild(ni);
  box.appendChild(nameRow);
  const capHint = document.createElement('p');
  capHint.className = 'hint';
  const CAP_HINTS = {
    2000: 'เท่ารถในเกม เบาสุด',
    3000: 'ปลอดภัย',
    3500: 'ละเอียดสุดที่เข้าเกมได้แน่นอน (ทดสอบแล้วถึง 3,631) · แต่ละชิ้น (ตัวถัง ฝากระโปรง หลังคา กันชน ไฟ) ได้ 3,500 ของตัวเอง',
    5000: '⚠ ยังไม่เคยทดสอบในเกม อาจเด้ง (8,000 เด้งแน่)',
    60000: 'ไม่ลด poly: ใช้โมเดลเดิมตามที่เป็น ลดเฉพาะไฟล์ที่ใหญ่เกินที่ไฟล์ .0m เก็บได้ (65,535 จุด/index ต่อไฟล์)',
  };
  const modeHint = document.createElement('p');
  modeHint.className = 'hint';
  const MODE_HINTS = {
    raw: 'ใช้สามเหลี่ยมของโมเดลเดิมตรงๆ ไม่สร้างผิวใหม่ ขอบสีคมตามต้นฉบับ (ลดเฉพาะไฟล์ที่เกินเพดาน) · แนะนำตั้ง "ภายในห้องโดยสาร" เป็นตัดทิ้ง จะเหลือ poly ให้ตัวรถมากขึ้น',
    shell: 'สร้างผิวนอกใหม่จากโมเดล (ปิดรู ตัดของข้างใน) เบาและทนในเกม แต่ผิวเป็นคลื่นเล็กน้อย ขอบสีหยักตามสามเหลี่ยม',
  };
  const updateModeHint = () => {
    const v = modeSel.querySelector('select').value;
    const lowCap = Number(capSel.querySelector('select').value) <= 5000;
    modeHint.textContent = MODE_HINTS[v] + (v === 'raw' && lowCap ? ' · ⚠ ลดเหลือไม่กี่พันจุดแบบนี้รถจะเป็นรู/ยุบ (โมเดลจริงมีหลายหมื่นจุด) ใช้ "สร้างผิวใหม่" จะดีกว่า' : '');
    modeHint.style.color = v === 'raw' && lowCap ? '#ff8a6a' : '';
    voxSel.hidden = v !== 'shell';
    hideRow.hidden = v !== 'raw';
    capSel.hidden = v === 'bend'; capHint.hidden = v === 'bend';
  };
  const modeSel = pickerRow('ผิวรถ', [['raw', 'ใช้ผิวจริงของโมเดล'], ['shell', 'สร้างผิวใหม่ (เปลือกนอก)'], ['bend', 'ดัดตัวถังรถเก่า (gtv98)']], 'shell', () => updateModeHint());
  modeHint.textContent = MODE_HINTS.shell;
  const hideRow = document.createElement('label');
  hideRow.className = 'row row-check';
  hideRow.innerHTML = '<input type="checkbox" checked><span>ตัดชิ้นข้างในที่มองไม่เห็นทิ้ง (เบาะ คอนโซล ห้องเครื่อง) · กระจกทึบอยู่แล้ว มองไม่เห็นข้างใน</span>';
  hideRow.hidden = true;
  const capSel = pickerRow('ลด poly (จุดสูงสุดต่อไฟล์)', [['2000', '2,000'], ['3000', '3,000'], ['3500', '3,500 (แนะนำ)'], ['5000', '5,000 (ทดลอง)'], ['60000', 'ไม่ลด poly']], '3500', (v) => {
    capHint.textContent = CAP_HINTS[v];
    capHint.style.color = Number(v) > 3500 ? '#ff8a6a' : '';
    if (v === '60000') modeSel.querySelector('select').value = 'raw';
    updateModeHint();
  });
  capHint.textContent = CAP_HINTS[3500];
  const voxSel = pickerRow('ความละเอียดผิว', [['0.01', '1.0 ซม. (ละเอียด ช้า)'], ['0.015', '1.5 ซม. (ปกติ)'], ['0.02', '2.0 ซม. (เร็ว)']], '0.015', () => {});
  const paintRow = document.createElement('label');
  paintRow.className = 'row row-check';
  paintRow.innerHTML = '<input type="checkbox" checked><span>เปลี่ยนสีได้ทั้งคัน (ยกเว้นกระจก ไฟ) · ไม่ติ๊ก = เปลี่ยนสีได้เฉพาะส่วนที่เป็นสีรถในโมเดล ที่เหลือดำ</span>';
  const layoutSel = pickerRow('UV / กระจก', [['template', 'เหมือน gtv98 (กระจกใส · ใส่ลายได้) ⭐'], ['zones', 'ช่องสี (แบบเก่า ชุด 39)']], 'template', () => {});
  box.append(capSel, capHint, modeSel, modeHint, hideRow, voxSel, paintRow, layoutSel);
  const go = document.createElement('button');
  go.className = 'accent';
  go.textContent = '⚙ สร้างรถ RayCity จากโมเดลนี้';
  const log = document.createElement('pre');
  log.id = 'model-build-log';
  log.className = 'hint';
  go.addEventListener('click', async () => {
    go.disabled = true;
    log.textContent = '';
    const say = (t) => { log.textContent += `${t}\n`; };
    try {
      const name = ni.value || 'rc_car';
      const out = modeSel.querySelector('select').value === 'bend'
        ? await bendTemplate(m, { name, template: await modelTemplate(), categories: srcModel.categories, log: say })
        : await convert(m, {
        name, template: await modelTemplate(), categories: srcModel.categories,
        maxVerts: Number(capSel.querySelector('select').value), voxel: Number(voxSel.querySelector('select').value),
        raw: modeSel.querySelector('select').value === 'raw', hideInterior: hideRow.querySelector('input').checked, paintAll: paintRow.querySelector('input').checked, layout: layoutSel.querySelector('select').value, log: say,
      });
      say('เปิดรถที่ได้ ตรวจดูแล้วกด "ดาวน์โหลดรถคันนี้ทั้งโฟลเดอร์" ได้เลย');
      const entries = [...out].map(([rel, bytes]) => ({ path: `${name}/${rel}`, file: new File([bytes], rel.split('/').pop()) }));
      await openCarFolder(entries);
      showBuildResult(name, out, entries);
    } catch (e) {
      console.error(e);
      say(`ผิดพลาด: ${e.message}`);
    }
    go.disabled = false;
  });
  const goRow = document.createElement('div');
  goRow.className = 'btns';
  goRow.appendChild(go);
  const result = document.createElement('div');
  result.id = 'model-result';
  result.hidden = true;
  box.append(goRow, log, result);
}

// ⚡ One click: build with the settings that worked in game, check, repair what can be repaired,
// download, and open the result for a look.
async function quickBuild(name, btn, logEl, maxVerts = 4800) {
  const m = srcModel.model;
  if (!m) return;
  btn.disabled = true;
  logEl.textContent = '';
  const say = (t) => { logEl.textContent = `${t}\n${logEl.textContent}`.split('\n').slice(0, 6).join('\n'); };
  try {
    const tpl = await modelTemplate();
    let out = await convert(m, { name, template: tpl, categories: srcModel.categories, maxVerts, raw: true, hideInterior: true, paintAll: true, layout: 'template', partTextures: false, log: say });
    let list = await checkCar(out, name, tpl);
    if (list.some((c) => c.level === 'bad')) {
      const r = await repairCar(out, name, tpl, true);
      out = r.files;
      list = await checkCar(out, name, tpl);
      for (const f of r.fixes) say(`🔧 ${f}`);
    }
    const bad = list.filter((c) => c.level === 'bad');
    const zipFiles = [...out].sort((a, b) => a[0].localeCompare(b[0])).map(([rel, data]) => ({ path: `${name}/${rel}`, data }));
    download(await makeZip(zipFiles), `${name}.zip`);
    say(bad.length ? `⚠ ดาวน์โหลด ${name}.zip แล้ว แต่ยังมี ${bad.length} ข้อที่ต้องดู (ด้านล่าง)` : `✅ ดาวน์โหลด ${name}.zip แล้ว · แตกไฟล์ → แพ็กเป็น ${name}.jmd → เข้าเกมได้เลย`);
    const entries = [...out].map(([rel, bytes]) => ({ path: `${name}/${rel}`, file: new File([bytes], rel.split('/').pop()) }));
    await openCarFolder(entries);
    showBuildResult(name, out, entries);
  } catch (e) {
    console.error(e);
    say(`ผิดพลาด: ${e.message}`);
  }
  btn.disabled = false;
}

// After a build: what came out (vertices per file against the game's limit) and the check-before-
// download buttons, right under the build button.
function showBuildResult(name, out, entries) {
  const box = document.getElementById('model-result');
  box.hidden = false;
  box.innerHTML = '';
  const h = document.createElement('div');
  h.className = 'result-title';
  h.textContent = `✅ สร้าง ${name} เสร็จ — จอ 3D ตอนนี้คือรถที่ได้ ตรวจดูก่อนโหลด`;
  box.appendChild(h);
  const rows = [...out.keys()].filter((r) => r === 'body_2.0m' || /^[^/]+\/default_2\.0m$/.test(r))
    .map((r) => [r.includes('/') ? r.split('/')[0] : 'ตัวถัง (body)', countsOf(out.get(r))]);
  const t = document.createElement('table');
  t.className = 'result-table';
  let worst = 0;
  for (const [label, c] of rows) {
    if (c.verts <= 30) continue; // empty stand-ins
    worst = Math.max(worst, c.verts);
    const tr = t.insertRow();
    tr.insertCell().textContent = label;
    tr.insertCell().textContent = `${c.verts.toLocaleString()} จุด · ${c.tris.toLocaleString()} ▲`;
    tr.insertCell().textContent = c.verts <= 65535 ? '✅' : '❌ เกิน';
  }
  box.appendChild(t);
  const note = document.createElement('p');
  note.className = 'hint';
  // The game's poly limit was lifted (2026-10-10); a .0m still holds at most 65,535 vertices.
  note.textContent = worst <= 65535 ? `จุดต่อไฟล์สูงสุด ${worst.toLocaleString()} (ไฟล์ .0m เก็บได้ไม่เกิน 65,535)` : '❌ มีไฟล์เกิน 65,535 จุด ไฟล์ .0m เก็บไม่ได้';
  if (worst > 65535) note.style.color = '#ff8a6a';
  box.appendChild(note);
  const checks = document.createElement('div');
  checks.className = 'checks';
  checks.textContent = '🩺 กำลังตรวจความพร้อมก่อนเข้าเกม…';
  box.appendChild(checks);
  modelTemplate().then((tpl) => checkCar(out, name, tpl)).then((list) => renderChecks(checks, list)).catch((e) => { checks.textContent = `ตรวจไม่ได้: ${e.message}`; });
  const btns = document.createElement('div');
  btns.className = 'btns';
  const mk = (text, fn, cls) => { const b = document.createElement('button'); b.textContent = text; if (cls) b.className = cls; b.addEventListener('click', fn); btns.appendChild(b); return b; };
  mk('👁 ดูรถที่ได้', () => openCarFolder(entries));
  mk('🔁 เทียบกับโมเดลต้นฉบับ', showModelPreview);
  mk('🎮 ดูแบบในเกม (ด้านเดียว)', () => document.getElementById('btn-ingame').click());
  mk('✏ แก้ต่อ (ขนาด ย้าย ลด poly รายชิ้น)', async () => {
    if (!folder || folder.name !== name) await openCarFolder(entries);
    const ed = document.getElementById('car-edit');
    ed.hidden = false;
    ed.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  mk('⬇ ดาวน์โหลดทั้งโฟลเดอร์ (.zip)', async () => {
    if (!folder || folder.name !== name) await openCarFolder(entries);
    await downloadCarZip();
  }, 'accent');
  box.appendChild(btns);
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Click a piece (pick mode): removed ↔ kept.
{
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || !srcModel.pick || imported !== srcModel.preview || !srcModel.preview) return;
    if (Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
    const r = renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hits = ray.intersectObjects(srcModel.preview.children.filter((o) => o.isMesh && o.visible), false);
    if (!hits.length) return;
    const h = hits[0];
    const m = srcModel.model;
    const piece = m.C[h.object.userData.tris[h.faceIndex]];
    m.removed[piece] = m.removed[piece] ? 0 : 1;
    showModelPreview();
  });
}

function bindModelButtons() {
  const input = document.getElementById('file-model');
  document.getElementById('btn-model-open').addEventListener('click', () => input.click());
  input.addEventListener('change', async (e) => { if (e.target.files.length) await openModelFile([...e.target.files]); e.target.value = ''; });
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
bindModelButtons();
bindSpecButtons();
syncUI();
rebuild();
resize();
tick();

// Handy for scripting / automated tests.
window.carGenerator = { setParams, getParams: () => ({ ...params }), exportGLB, exportOBJ, randomParams, openOmFiles, openCarFolder, openModelFile, srcModel };
