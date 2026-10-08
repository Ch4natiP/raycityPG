import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { buildCar, disposeObject } from './carBuilder.js';
import { parseOM, omToObject, writeOM, objectToParts, mergePartsByName } from './om.js';
import { SPEC_TEMPLATE, SPEC_FIELDS, readSpec, writeSpec, encodeSpec, decodeSpec, suggestSpec } from './carSpec.js';
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
  if (folder && imported && /^(paintColor|trimColor|glassColor)$/.test(key)) queueReassemble();
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
  folder = null;
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
  f.choice = new Map(f.slots.map((slot) => {
    const def = slot.variants.find((v) => v.name === 'default') || slot.variants[0];
    return [slot.dir, def.name];
  }));
  folder = f;
  const specFile = f.files.get(`${f.name}.xml`)
    || [...f.files].find(([r]) => !r.includes('/') && /\.xml$/i.test(r) && r.toLowerCase() !== 'mesh.xml')?.[1];
  if (specFile) loadSpecText(decodeSpec(await specFile.arrayBuffer()), f.name);
  buildPartPickers();
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

const textureCache = new Map();
async function loadTexture(file, recolor) {
  const key = `${file.name}:${file.size}:${recolor || ''}`;
  if (textureCache.has(key)) return textureCache.get(key);
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const g = c.getContext('2d');
  g.drawImage(bmp, 0, 0);
  if (recolor) {
    // Body textures are paint masks: red = main paint (guess: green = secondary/trim, blue = glass).
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
      const om = parseOM(await folder.files.get(rel).arrayBuffer());
      // Part texture: in its folder, anywhere in the car folder, or else the body's paint mask
      // (parts with tex='' share the body texture).
      const findTex = (t) => t && (folder.files.get(`${prefix}${t}.png`)
        || [...folder.files].find(([r]) => r.split('/').pop().toLowerCase() === `${t}.png`.toLowerCase())?.[1]);
      let texFile = findTex(v.tex);
      let isMask = !slot.dir;
      if (!texFile) { texFile = findTex(bodyTexName()); isMask = true; }
      let partMats;
      if (texFile) {
        const recolor = isMask ? { paint: params.paintColor, trim: params.trimColor, glass: params.glassColor } : null;
        const map = await loadTexture(texFile, recolor);
        partMats = [new THREE.MeshStandardMaterial({
          name: `RC_${texFile.name.replace(/\.png$/i, '')}`, map, roughness: 0.4, metalness: isMask ? 0.5 : 0.2,
          transparent: !isMask, alphaTest: 0.05, side: THREE.DoubleSide,
        })];
      } else {
        partMats = om.submeshes.map(() => omColorMats[colorIndex++ % omColorMats.length]);
      }
      const obj = omToObject(om, partMats);
      obj.name = rel.replace(/\//g, '_').replace(/\.0m$/i, '');
      group.add(obj);
      if (!slot.dir) template = { om, name: rel.split('/').pop() };
      notes.push(`✔ ${rel}: ${om.positions.length / 3} จุด`);
    } catch (err) {
      notes.push(`✘ ${rel}: อ่านไม่ได้ (${err.message})`);
    }
  }
  group.userData.files = `โฟลเดอร์ ${folder.name}`;
  showImported(group);
  setOmStatus(`${notes.join('\n')}\nแม่แบบสำหรับส่งออก: ${template ? template.name : '-'}`);
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

function bindOmButtons() {
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
    if (entries.length) await openCarFolder(entries);
  });
  const input = document.getElementById('file-om');
  document.getElementById('btn-om-open').addEventListener('click', () => input.click());
  input.addEventListener('change', async (e) => { await openOmFiles(e.target.files); e.target.value = ''; });
  document.getElementById('btn-om-back').addEventListener('click', () => showImported(null));
  document.getElementById('btn-om-export').addEventListener('click', exportOm);
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
bindSpecButtons();
syncUI();
rebuild();
resize();
tick();

// Handy for scripting / automated tests.
window.carGenerator = { setParams, getParams: () => ({ ...params }), exportGLB, exportOBJ, randomParams, openOmFiles, openCarFolder };
