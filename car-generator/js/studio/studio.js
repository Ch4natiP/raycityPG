// RayCity Studio: a small 3ds Max–style editor for RayCity cars, in Thai. Four views (top, front,
// side, 3D), points / faces selection, move / rotate / scale gizmo, drawing new faces on a reference
// model (retopology), symmetry, undo, live vertex counts per game file, and export to a complete car
// folder (the same template layout the converter writes).
//
// Everything editable lives in `world`, a group turned so its local space is RayCity space
// (x left, y back, z up); the views show it in three.js space (x, z, −y).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { MeshoptSimplifier } from 'meshoptimizer';
import { EditMesh, SLOTS, partVerts } from './editMesh.js';
import { loadModel, convert, bendTemplate, writeCar, smoothNormals, categoryOf, removeHidden, CATEGORIES } from '../convert.js';
import { makeZip } from '../zip.js';
import { checkCar, renderChecks } from '../checkCar.js';

const GAME_MAX = 3500; // vertices per file that work in game (3,631 tested)
const MATS = CATEGORIES.filter(([v]) => v !== 'skip' && v !== 'Lights_Auto');
const MAT_COLORS = {
  Body_Color: '#4f8cff', Glass_Gray: '#26343f', Projector_Glass: '#fff6c4', Taillight_Glass: '#c3122a',
  Turn_Signal_LED: '#ffa21a', metal_chrome: '#d8dde3', metal_gray: '#8b939c', plastic_gray: '#4a4e56', Carbon_Fiber: '#2b2e33',
  Interior_dark: '#6a5442', Underbody: '#33363c', Grille: '#3a3d42', Leather: '#5a4636', Wing: '#4f8cff', WingDark: '#2b2e33',
};
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------------------------
// Scene, views

const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setScissorTest(true);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#2a2d35');
scene.add(new THREE.HemisphereLight('#e8eeff', '#30343c', 1.6));
const sun = new THREE.DirectionalLight('#ffffff', 1.6);
sun.position.set(4, 8, 5);
scene.add(sun);
const grid = new THREE.GridHelper(20, 40, '#4a5060', '#363a45');
scene.add(grid);

const world = new THREE.Group();
world.rotation.x = -Math.PI / 2; // local = RayCity space
scene.add(world);
world.updateMatrixWorld(true);

const vpEls = [...document.querySelectorAll('.vp')];
const ORTHO_HALF = 3;
function makeOrtho(pos, up, target, layer) {
  const cam = new THREE.OrthographicCamera(-ORTHO_HALF, ORTHO_HALF, ORTHO_HALF, -ORTHO_HALF, -100, 200);
  cam.position.set(...pos);
  cam.up.set(...up);
  cam.lookAt(...target);
  cam.layers.enable(layer);
  return cam;
}
const views = [
  { name: 'top', cam: makeOrtho([0, 30, 0], [0, 0, -1], [0, 0, 0], 1), target: [0, 0, 0] },
  { name: 'front', cam: makeOrtho([0, 0.7, 30], [0, 1, 0], [0, 0.7, 0], 2), target: [0, 0.7, 0] },
  { name: 'side', cam: makeOrtho([30, 0.7, 0], [0, 1, 0], [0, 0.7, 0], 3), target: [0, 0.7, 0] },
  { name: 'persp', cam: new THREE.PerspectiveCamera(40, 1, 0.02, 200), target: [0, 0.6, 0] },
];
views[3].cam.position.set(5.5, 3, 6.5);
views.forEach((v, i) => {
  v.el = vpEls[i];
  const c = new OrbitControls(v.cam, v.el);
  c.target.set(...v.target);
  c.screenSpacePanning = true;
  c.zoomToCursor = true;
  if (v.cam.isOrthographicCamera) {
    c.enableRotate = false;
    c.mouseButtons = { LEFT: -1, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
  } else {
    c.mouseButtons = { LEFT: -1, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
  }
  c.update();
  v.controls = c;
});
let active = 3;
let maximized = false;

const tc = new TransformControls(views[3].cam, views[3].el);
tc.setSpace('local');
const tcHelper = tc.getHelper();
scene.add(tcHelper);
const pivot = new THREE.Object3D();
world.add(pivot);
tc.addEventListener('dragging-changed', (e) => { for (const v of views) v.controls.enabled = !e.value; });

function setActive(i) {
  if (i === active || tc.dragging || marquee) return;
  active = i;
  vpEls.forEach((el, k) => el.classList.toggle('active', k === i));
  tc.disconnect();
  tc.domElement = views[i].el;
  tc.camera = views[i].cam;
  tc.connect();
}
vpEls.forEach((el, i) => el.addEventListener('pointerenter', () => setActive(i)));
vpEls[3].classList.add('active');

function rectOf(i) {
  const r = views[i].el.getBoundingClientRect();
  const c = canvas.getBoundingClientRect();
  return { x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height, H: c.height };
}

let busy = false; // long jobs (build, export): the views wait so the job isn't slowed by drawing
function render() {
  if (busy) { requestAnimationFrame(render); return; }
  const w = canvas.clientWidth; const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) renderer.setSize(w, h, false);
  renderer.setScissor(0, 0, w, h);
  renderer.setClearColor('#000');
  renderer.clear();
  views.forEach((v, i) => {
    if (maximized && i !== active) return;
    const r = rectOf(i);
    if (r.w < 2 || r.h < 2) return;
    const aspect = r.w / r.h;
    if (v.cam.isOrthographicCamera) {
      v.cam.left = -ORTHO_HALF * aspect; v.cam.right = ORTHO_HALF * aspect; v.cam.top = ORTHO_HALF; v.cam.bottom = -ORTHO_HALF;
    } else v.cam.aspect = aspect;
    v.cam.updateProjectionMatrix();
    v.controls.update();
    renderer.setViewport(r.x, r.H - r.y - r.h, r.w, r.h);
    renderer.setScissor(r.x, r.H - r.y - r.h, r.w, r.h);
    tcHelper.visible = i === active && Boolean(tc.object);
    renderer.render(scene, v.cam);
  });
  requestAnimationFrame(render);
}

// ---------------------------------------------------------------------------------------------
// Reference model (the model the car is built after)

let refModel = null; // from convert.loadModel (wheels removed)
let refMesh = null;
const refMat = new THREE.MeshStandardMaterial({ color: '#b9bec9', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, roughness: 0.8 });

async function showReference(model, outsideOnly = false) {
  if (refMesh) { world.remove(refMesh); refMesh.geometry.dispose(); refMesh = null; }
  let keep = [];
  const cats = new Map();
  for (let t = 0; t < model.C.length; t++) if (!model.removed[model.C[t]] && categoryOf(model, cats, t) !== 'skip') keep.push(t);
  if (outsideOnly) {
    // Only what can be seen from outside: drawing and snapping never land on seats or the engine.
    const tris = keep.map((t) => ({ a: [...model.P.subarray(t * 9, t * 9 + 3)], b: [...model.P.subarray(t * 9 + 3, t * 9 + 6)], c: [...model.P.subarray(t * 9 + 6, t * 9 + 9)], t }));
    keep = (await removeHidden(tris, (m) => { $('ref-info').textContent = m; })).map((x) => x.t);
  }
  const pos = new Float32Array(keep.length * 9); const nrm = new Float32Array(keep.length * 9);
  keep.forEach((t, i) => { pos.set(model.P.subarray(t * 9, t * 9 + 9), i * 9); nrm.set(model.N.subarray(t * 9, t * 9 + 9), i * 9); });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.boundsTree = new MeshBVH(g);
  refMesh = new THREE.Mesh(g, refMat);
  refMesh.raycast = acceleratedRaycast;
  refMesh.renderOrder = 2;
  world.add(refMesh);
  $('ref-info').textContent = `${keep.length.toLocaleString()} สามเหลี่ยม (ถอดล้อแล้ว${outsideOnly ? ', ตัดข้างในแล้ว' : ''}) · ล้อ ${model.wheels.length}`;
}

// Closest point on the reference surface (RayCity space) within `reach`, or null.
function onSurface(p, reach = 0.15) {
  if (!refMesh) return null;
  const hit = refMesh.geometry.boundsTree.closestPointToPoint(new THREE.Vector3(...p), {}, 0, reach);
  return hit && hit.distance <= reach ? [hit.point.x, hit.point.y, hit.point.z] : null;
}

// ---------------------------------------------------------------------------------------------
// The edited mesh and its display

let mesh = new EditMesh();
let mode = 'vert'; // 'vert' | 'face'
let tool = 'select';
const selV = new Set();
const selF = new Set();
const hiddenSlots = new Set();
let oneSided = false;

const faceMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
const selFaceMat = new THREE.MeshBasicMaterial({ color: '#ff8a1a', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthTest: true, polygonOffset: true, polygonOffsetFactor: -1 });
const wireMat = new THREE.LineBasicMaterial({ color: '#101216', transparent: true, opacity: 0.55 });
const pointMat = new THREE.PointsMaterial({ size: 4, sizeAttenuation: false, vertexColors: true });
let faceObj = null; let wireObj = null; let pointObj = null; let selObj = null;
let triFace = []; // display triangle → face index

function visibleFace(f) { return !hiddenSlots.has(f.slot); }

function refresh() {
  for (const o of [faceObj, wireObj, pointObj, selObj]) if (o) { world.remove(o); o.geometry.dispose(); }
  const V = mesh.verts;
  const pos = []; const col = []; triFace = [];
  const sp = [];
  const c = new THREE.Color();
  mesh.faces.forEach((f, fi) => {
    if (!visibleFace(f)) return;
    c.set(MAT_COLORS[f.mat] || '#4a4e56').convertSRGBToLinear();
    for (const t of mesh.triangles(f)) {
      for (const v of t) { pos.push(...V[v]); col.push(c.r, c.g, c.b); }
      triFace.push(fi);
      if (selF.has(fi)) for (const v of t) sp.push(...V[v]);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  faceObj = new THREE.Mesh(g, faceMat);
  // Edges (quads without their diagonal).
  const seen = new Set(); const ep = [];
  for (const f of mesh.faces) {
    if (!visibleFace(f)) continue;
    for (let k = 0; k < f.v.length; k++) {
      const a = f.v[k]; const b = f.v[(k + 1) % f.v.length];
      const key = a < b ? a * 1e7 + b : b * 1e7 + a;
      if (seen.has(key)) continue;
      seen.add(key);
      ep.push(...V[a], ...V[b]);
    }
  }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(ep, 3));
  wireObj = new THREE.LineSegments(wg, wireMat);
  // Points (point mode).
  const used = new Uint8Array(V.length);
  for (const f of mesh.faces) if (visibleFace(f)) for (const v of f.v) used[v] = 1;
  const pp = []; const pc = [];
  V.forEach((p, i) => {
    if (!used[i]) return;
    pp.push(...p);
    if (selV.has(i)) pc.push(1, 0.45, 0.05); else pc.push(0.12, 0.55, 0.65);
  });
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3));
  pg.setAttribute('color', new THREE.Float32BufferAttribute(pc, 3));
  pointObj = new THREE.Points(pg, pointMat);
  pointObj.visible = mode === 'vert';
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  selObj = new THREE.Mesh(sg, selFaceMat);
  faceMat.side = oneSided ? THREE.FrontSide : THREE.DoubleSide;
  world.add(faceObj, wireObj, pointObj, selObj);
  updateGizmo();
  queueCounts();
  updateStatus();
  queueAutosave();
}

// ---------------------------------------------------------------------------------------------
// Autosave: the work is kept in this browser after every change, so a closed tab loses nothing.

const AUTOSAVE = 'raycity-studio-autosave';
let autosaveTimer = 0;
function queueAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    if (!mesh.faces.length) return;
    try { localStorage.setItem(AUTOSAVE, JSON.stringify({ time: Date.now(), name: $('car-name').value, mesh: mesh.toJSON() })); } catch { /* full or blocked */ }
  }, 1500);
}
function offerRestore() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(AUTOSAVE) || 'null'); } catch { saved = null; }
  const b = $('btn-restore');
  if (!saved || !saved.mesh?.faces?.length) return;
  b.hidden = false;
  b.textContent = `↺ กู้งานล่าสุด (${new Date(saved.time).toLocaleString('th-TH')} · ${saved.mesh.faces.length.toLocaleString()} หน้า)`;
  b.addEventListener('click', () => {
    pushUndo();
    mesh = EditMesh.fromJSON(saved.mesh);
    if (saved.name) $('car-name').value = saved.name;
    selV.clear(); selF.clear();
    refresh();
    zoomAll();
    b.hidden = true;
  });
}

// ---------------------------------------------------------------------------------------------
// Undo

const undo = []; const redo = [];
function snapshot() { return JSON.stringify(mesh.toJSON()); }
function pushUndo() { undo.push(snapshot()); if (undo.length > 60) undo.shift(); redo.length = 0; }
function restore(s) { mesh = EditMesh.fromJSON(JSON.parse(s)); selV.clear(); selF.clear(); refresh(); }
function doUndo() { if (!undo.length) return; redo.push(snapshot()); restore(undo.pop()); }
function doRedo() { if (!redo.length) return; undo.push(snapshot()); restore(redo.pop()); }

// ---------------------------------------------------------------------------------------------
// Selection

function selectedVerts() {
  if (mode === 'vert') return [...selV];
  const s = new Set();
  for (const fi of selF) for (const v of mesh.faces[fi].v) s.add(v);
  return [...s];
}

function screenOf(i, p) {
  const r = rectOf(i);
  const v = new THREE.Vector3(...p).applyMatrix4(world.matrixWorld).project(views[i].cam);
  return { x: ((v.x + 1) / 2) * r.w, y: ((1 - v.y) / 2) * r.h, z: v.z };
}

function pickVert(i, x, y, radius = 10) {
  let best = -1; let bd = radius; let bz = Infinity;
  const used = new Uint8Array(mesh.verts.length);
  for (const f of mesh.faces) if (visibleFace(f)) for (const v of f.v) used[v] = 1;
  mesh.verts.forEach((p, k) => {
    if (!used[k]) return;
    const s = screenOf(i, p);
    if (s.z > 1 || s.z < -1) return;
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < bd - 1.5 || (d <= bd + 1.5 && s.z < bz)) { bd = Math.min(bd, d); bz = s.z; best = k; }
  });
  return best;
}

function rayAt(i, x, y) {
  const r = rectOf(i);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2((x / r.w) * 2 - 1, -(y / r.h) * 2 + 1), views[i].cam);
  return ray;
}

function pickFace(i, x, y) {
  if (!faceObj) return -1;
  const hit = rayAt(i, x, y).intersectObject(faceObj, false)[0];
  return hit ? triFace[hit.faceIndex] : -1;
}

function applySelection(ids, how) {
  const set = mode === 'vert' ? selV : selF;
  if (how === 'replace') set.clear();
  for (const id of ids) { if (how === 'remove') set.delete(id); else set.add(id); }
  refresh();
}

function boxSelect(i, x0, y0, x1, y1, how) {
  const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)];
  const [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
  const inside = (p) => { const s = screenOf(i, p); return s.z <= 1 && s.x >= ax && s.x <= bx && s.y >= ay && s.y <= by; };
  const ids = [];
  if (mode === 'vert') {
    const used = new Uint8Array(mesh.verts.length);
    for (const f of mesh.faces) if (visibleFace(f)) for (const v of f.v) used[v] = 1;
    mesh.verts.forEach((p, k) => { if (used[k] && inside(p)) ids.push(k); });
  } else {
    mesh.faces.forEach((f, k) => {
      if (!visibleFace(f)) return;
      const c = [0, 1, 2].map((d) => f.v.reduce((s, v) => s + mesh.verts[v][d], 0) / f.v.length);
      if (inside(c)) ids.push(k);
    });
  }
  applySelection(ids, how);
}

// ---------------------------------------------------------------------------------------------
// Gizmo: move / rotate / scale the selection (and its mirror half)

function updateGizmo() {
  const vs = selectedVerts();
  if (!vs.length || !['translate', 'rotate', 'scale'].includes(tool)) { if (!tc.dragging) tc.detach(); return; }
  if (tc.dragging) return;
  const c = [0, 1, 2].map((k) => vs.reduce((s, v) => s + mesh.verts[v][k], 0) / vs.length);
  pivot.position.set(...c);
  pivot.rotation.set(0, 0, 0);
  pivot.scale.set(1, 1, 1);
  pivot.updateMatrix();
  tc.setMode(tool);
  tc.attach(pivot);
}

// Mirror partners (x → −x) of the given points, through a 2 mm grid.
function mirrorPartners(ids) {
  const key = (x, y, z) => `${Math.round(x / 0.002)},${Math.round(y / 0.002)},${Math.round(z / 0.002)}`;
  const grid2 = new Map();
  mesh.verts.forEach((p, k) => {
    const kk = key(p[0], p[1], p[2]);
    if (!grid2.has(kk)) grid2.set(kk, []);
    grid2.get(kk).push(k);
  });
  const out = new Map();
  for (const i of ids) {
    const p = mesh.verts[i];
    if (Math.abs(p[0]) < 0.002) { out.set(i, i); continue; }
    let found = -1;
    for (let dx = -1; dx <= 1 && found < 0; dx++) for (let dy = -1; dy <= 1 && found < 0; dy++) for (let dz = -1; dz <= 1 && found < 0; dz++) {
      const kk = `${Math.round(-p[0] / 0.002) + dx},${Math.round(p[1] / 0.002) + dy},${Math.round(p[2] / 0.002) + dz}`;
      for (const j of grid2.get(kk) || []) if (j !== i) { found = j; break; }
    }
    if (found >= 0) out.set(i, found);
  }
  return out;
}

let drag = null;
tc.addEventListener('mouseDown', () => {
  const ids = selectedVerts();
  pivot.updateMatrix();
  const mirror = $('opt-mirror').checked;
  const partners = mirror ? mirrorPartners(ids) : new Map();
  const sel = new Set(ids);
  drag = {
    before: snapshot(),
    start: new Map(ids.map((i) => [i, [...mesh.verts[i]]])),
    mirrored: new Map([...partners].filter(([i, j]) => j !== i && !sel.has(j)).map(([, j]) => [j, [...mesh.verts[j]]])),
    centre: new Set([...partners].filter(([i, j]) => i === j).map(([i]) => i)),
    inv: pivot.matrix.clone().invert(),
  };
});
const S = new THREE.Matrix4().makeScale(-1, 1, 1);
tc.addEventListener('objectChange', () => {
  if (!drag) return;
  pivot.updateMatrix();
  const D = pivot.matrix.clone().multiply(drag.inv);
  const DM = S.clone().multiply(D).multiply(S);
  const v = new THREE.Vector3();
  for (const [i, p] of drag.start) {
    v.set(...p).applyMatrix4(D);
    mesh.verts[i] = [drag.centre.has(i) ? 0 : v.x, v.y, v.z];
  }
  for (const [j, p] of drag.mirrored) { v.set(...p).applyMatrix4(DM); mesh.verts[j] = [v.x, v.y, v.z]; }
  scheduleRefresh();
});
tc.addEventListener('mouseUp', () => {
  if (!drag) return;
  if ($('opt-snap').checked && refMesh) {
    for (const i of [...drag.start.keys(), ...drag.mirrored.keys()]) {
      const q = onSurface(mesh.verts[i], 0.08);
      if (q) mesh.verts[i] = drag.centre.has(i) ? [0, q[1], q[2]] : q;
    }
  }
  undo.push(drag.before); redo.length = 0;
  drag = null;
  refresh();
});
let refreshQueued = false;
function scheduleRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(() => { refreshQueued = false; refresh(); });
}

// ---------------------------------------------------------------------------------------------
// Drawing faces on the reference (retopology)

let drawPts = []; // { vi } existing point, or { p } new point on the surface
let drawPreview = null;
function drawPointAt(i, x, y) {
  const vi = pickVert(i, x, y, 10);
  if (vi >= 0) return { vi, p: mesh.verts[vi] };
  const ray = rayAt(i, x, y);
  const targets = [refMesh && refMesh.visible ? refMesh : null, faceObj].filter(Boolean);
  for (const t of targets) {
    const hit = ray.intersectObject(t, false)[0];
    if (hit) { const p = world.worldToLocal(hit.point.clone()); return { p: [p.x, p.y, p.z] }; }
  }
  return null;
}
function updateDrawPreview() {
  if (drawPreview) { world.remove(drawPreview); drawPreview.geometry.dispose(); drawPreview = null; }
  if (!drawPts.length) return;
  const pts = drawPts.map((d) => new THREE.Vector3(...d.p));
  const g = new THREE.BufferGeometry().setFromPoints(pts.length > 2 ? [...pts, pts[0]] : pts);
  drawPreview = new THREE.Line(g, new THREE.LineBasicMaterial({ color: '#ffb020', depthTest: false }));
  drawPreview.renderOrder = 10;
  const dots = new THREE.Points(new THREE.BufferGeometry().setFromPoints(pts), new THREE.PointsMaterial({ color: '#ffb020', size: 9, sizeAttenuation: false, depthTest: false }));
  dots.renderOrder = 10;
  drawPreview.add(dots);
  world.add(drawPreview);
}
function finishFace(viewIndex) {
  if (drawPts.length < 3) return;
  pushUndo();
  const mirror = $('opt-mirror').checked;
  const slot = $('cur-slot').value; const mat = $('cur-mat').value;
  const ids = drawPts.map((d) => {
    if (d.vi !== undefined) return d.vi;
    const p = [...d.p];
    if (mirror && Math.abs(p[0]) < 0.01) p[0] = 0;
    return mesh.addVert(p);
  });
  // Facing the camera that drew it (outwards).
  const P = ids.map((v) => mesh.verts[v]);
  const n = new THREE.Vector3().crossVectors(new THREE.Vector3(...P[1]).sub(new THREE.Vector3(...P[0])), new THREE.Vector3(...P[2]).sub(new THREE.Vector3(...P[0])));
  // View direction in RayCity space; the face's normal must point back at the viewer.
  const cam = views[viewIndex].cam;
  const ctr = new THREE.Vector3(...[0, 1, 2].map((k) => P.reduce((s2, p) => s2 + p[k], 0) / P.length));
  const dir = cam.isOrthographicCamera
    ? cam.getWorldDirection(new THREE.Vector3()).applyQuaternion(world.quaternion.clone().invert())
    : ctr.clone().sub(world.worldToLocal(cam.getWorldPosition(new THREE.Vector3())));
  if (n.dot(dir) > 0) ids.reverse();
  mesh.addFace(ids, slot, mat);
  if (mirror && !ids.every((v) => Math.abs(mesh.verts[v][0]) < 0.002)) {
    const mids = ids.map((v) => { const p = mesh.verts[v]; return mesh.vertAt([-p[0], p[1], p[2]], 0.002); });
    mesh.addFace([...mids].reverse(), slot, mat);
  }
  drawPts = [];
  updateDrawPreview();
  refresh();
}

// ---------------------------------------------------------------------------------------------
// Pointer input on the views

let marquee = null;
const marqEl = $('marquee');
vpEls.forEach((el, i) => {
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    setActive(i);
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left; const y = e.clientY - r.top;
    if (tool === 'draw') {
      const d = drawPointAt(i, x, y);
      if (!d) { status('คลิกบนผิวโมเดลต้นแบบ หรือบนจุดที่มีอยู่'); return; }
      if (drawPts.length >= 3 && d.vi !== undefined && drawPts[0].vi === d.vi) { finishFace(i); return; }
      if (drawPts.length >= 3 && d.vi === undefined && drawPts[0].p && Math.hypot(...[0, 1, 2].map((k) => d.p[k] - drawPts[0].p[k])) < 0.01) { finishFace(i); return; }
      drawPts.push(d);
      updateDrawPreview();
      if (drawPts.length === 4) finishFace(i);
      else status(`วาดหน้า: ${drawPts.length} จุด (คลิกจุดที่ ${drawPts.length + 1} · Enter = จบเป็นสามเหลี่ยม · Esc = ยกเลิก)`);
      return;
    }
    if (tc.axis !== null && tc.object) return; // on the gizmo
    marquee = { i, x0: x, y0: y, x1: x, y1: y, left: r.left - $('views').getBoundingClientRect().left, top: r.top - $('views').getBoundingClientRect().top };
  });
  el.addEventListener('pointermove', (e) => {
    if (!marquee || marquee.i !== i) return;
    const r = el.getBoundingClientRect();
    marquee.x1 = e.clientX - r.left; marquee.y1 = e.clientY - r.top;
    if (Math.hypot(marquee.x1 - marquee.x0, marquee.y1 - marquee.y0) > 4) {
      marqEl.hidden = false;
      Object.assign(marqEl.style, {
        left: `${marquee.left + Math.min(marquee.x0, marquee.x1)}px`, top: `${marquee.top + Math.min(marquee.y0, marquee.y1)}px`,
        width: `${Math.abs(marquee.x1 - marquee.x0)}px`, height: `${Math.abs(marquee.y1 - marquee.y0)}px`,
      });
    }
  });
});
window.addEventListener('pointerup', (e) => {
  if (!marquee) return;
  const m = marquee;
  marquee = null;
  marqEl.hidden = true;
  const how = e.shiftKey ? 'add' : (e.ctrlKey || e.altKey || e.metaKey) ? 'remove' : 'replace';
  if (Math.hypot(m.x1 - m.x0, m.y1 - m.y0) <= 4) {
    const id = mode === 'vert' ? pickVert(m.i, m.x0, m.y0) : pickFace(m.i, m.x0, m.y0);
    applySelection(id >= 0 ? [id] : [], how);
  } else boxSelect(m.i, m.x0, m.y0, m.x1, m.y1, how);
});

// ---------------------------------------------------------------------------------------------
// Commands

function setMode(m) {
  mode = m;
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  // Keep what was selected: points of the selected faces, or faces made only of selected points.
  if (m === 'vert') { selV.clear(); for (const fi of selF) for (const v of mesh.faces[fi].v) selV.add(v); selF.clear(); } else {
    selF.clear();
    mesh.faces.forEach((f, k) => { if (f.v.every((v) => selV.has(v))) selF.add(k); });
    selV.clear();
  }
  refresh();
}
function setTool(t) {
  tool = t;
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  if (t !== 'draw') { drawPts = []; updateDrawPreview(); }
  refresh();
  if (t === 'draw') status('วาดหน้า: คลิก 3–4 จุดบนผิวโมเดลต้นแบบ (หรือบนจุดที่มีอยู่) ครบ 4 จุดได้หน้าสี่เหลี่ยม · Enter = จบเป็นสามเหลี่ยม');
}

function deleteSelected() {
  if (mode === 'vert' ? !selV.size : !selF.size) return;
  pushUndo();
  if (mode === 'vert') mesh.deleteVerts([...selV]); else mesh.deleteFaces([...selF]);
  selV.clear(); selF.clear();
  refresh();
}
function weldSelected() {
  const vs = selectedVerts();
  if (vs.length < 2) { status('เลือกจุดอย่างน้อย 2 จุดก่อน'); return; }
  pushUndo();
  mesh.weld(vs);
  selV.clear(); selF.clear();
  refresh();
}
function flipSelected() {
  if (!selF.size) { status('เลือกหน้า (โหมดหน้า) ก่อน'); return; }
  pushUndo();
  mesh.flip([...selF]);
  refresh();
}
function snapSelected() {
  if (!refMesh) { status('ยังไม่ได้เปิดโมเดลต้นแบบ'); return; }
  const vs = selectedVerts();
  if (!vs.length) return;
  pushUndo();
  let n = 0;
  for (const i of vs) { const q = onSurface(mesh.verts[i], 0.15); if (q) { mesh.verts[i] = q; n++; } }
  status(`ติดผิว ${n}/${vs.length} จุด`);
  refresh();
}
function assignSelected(key, value) {
  if (!selF.size) { status('เลือกหน้า (โหมดหน้า) ก่อน'); return; }
  pushUndo();
  for (const fi of selF) mesh.faces[fi][key] = value;
  refresh();
}

// Polygon reduction of the selected faces (or the current part), shape kept, borders locked.
async function reduceSelected() {
  await MeshoptSimplifier.ready;
  const keep = Number($('reduce-keep').value);
  const ids = selF.size ? [...selF] : mesh.faces.map((f, k) => (f.slot === $('cur-slot').value ? k : -1)).filter((k) => k >= 0);
  if (!ids.length) { status('ไม่มีหน้าให้ลด'); return; }
  pushUndo();
  const P = new Float32Array(mesh.verts.flat());
  const groups = new Map();
  for (const fi of ids) {
    const f = mesh.faces[fi];
    const k = `${f.slot}|${f.mat}`;
    if (!groups.has(k)) groups.set(k, []);
    for (const t of mesh.triangles(f)) groups.get(k).push(...t);
  }
  const before = ids.length;
  const del = new Set(ids);
  mesh.faces = mesh.faces.filter((_, k) => !del.has(k));
  let after = 0;
  for (const [k, idx] of groups) {
    const [slot, mat] = k.split('|');
    const target = Math.max(3, Math.round((idx.length / 3) * keep) * 3);
    const [out] = MeshoptSimplifier.simplify(new Uint32Array(idx), P, 3, target, 0.05, ['LockBorder']);
    for (let t = 0; t < out.length; t += 3) { if (mesh.addFace([out[t], out[t + 1], out[t + 2]], slot, mat) >= 0) after++; }
  }
  mesh.compact();
  selF.clear(); selV.clear();
  status(`ลด poly: ${before.toLocaleString()} หน้า → ${after.toLocaleString()} สามเหลี่ยม`);
  refresh();
}

// Faces nobody can see from outside removed (seats, engine, inner panels).
async function removeHiddenFaces() {
  if (!mesh.faces.length) return;
  status('กำลังหาหน้าที่อยู่ข้างใน…');
  busy = true;
  await tick();
  const tris = [];
  mesh.faces.forEach((f, fi) => { for (const t of mesh.triangles(f)) tris.push({ a: mesh.verts[t[0]], b: mesh.verts[t[1]], c: mesh.verts[t[2]], fi }); });
  const seen = new Set((await removeHidden(tris, status)).map((t) => t.fi));
  busy = false;
  const gone = mesh.faces.length - seen.size;
  if (!gone) { status('ไม่มีหน้าที่ซ่อนอยู่ข้างใน'); return; }
  pushUndo();
  mesh.faces = mesh.faces.filter((_, k) => seen.has(k));
  mesh.compact();
  selV.clear(); selF.clear();
  refresh();
  status(`ลบหน้าข้างในที่มองไม่เห็น ${gone.toLocaleString()} หน้า`);
}

// The right half (x < 0) replaced by the mirror of the left half.
function mirrorAll() {
  pushUndo();
  for (const p of mesh.verts) if (Math.abs(p[0]) < 0.005) p[0] = 0;
  const cx = (f) => f.v.reduce((s, v) => s + mesh.verts[v][0], 0) / f.v.length;
  mesh.faces = mesh.faces.filter((f) => cx(f) >= -1e-5);
  mesh.compact();
  const key = (p) => `${Math.round(p[0] / 0.001)},${Math.round(p[1] / 0.001)},${Math.round(p[2] / 0.001)}`;
  const at = new Map(mesh.verts.map((p, i) => [key(p), i]));
  const mirrorV = (v) => {
    const p = mesh.verts[v];
    const q = [-p[0], p[1], p[2]];
    const k = key(q);
    if (!at.has(k)) at.set(k, mesh.addVert(q));
    return at.get(k);
  };
  for (const f of [...mesh.faces]) if (cx(f) > 1e-5) mesh.addFace(f.v.map(mirrorV).reverse(), f.slot, f.mat);
  selV.clear(); selF.clear();
  refresh();
}

function zoomAll() {
  let bb = mesh.faces.length ? mesh.bbox() : null;
  if (!bb && refMesh) { refMesh.geometry.computeBoundingBox(); const b = refMesh.geometry.boundingBox; bb = { min: b.min.toArray(), max: b.max.toArray() }; }
  if (!bb) return;
  const c = bb.min.map((v, k) => (v + bb.max[k]) / 2);
  const ct = new THREE.Vector3(...c).applyMatrix4(world.matrixWorld);
  const size = bb.max.map((v, k) => v - bb.min[k]);
  views.forEach((v, i) => {
    const r = rectOf(i);
    const aspect = r.w / Math.max(1, r.h);
    // Extent across / up the screen per view (RayCity x, y, z = width, length, height).
    const [across, up] = v.name === 'top' ? [size[0], size[1]] : v.name === 'front' ? [size[0], size[2]] : v.name === 'side' ? [size[1], size[2]] : [Math.max(...size), Math.max(...size)];
    if (v.cam.isOrthographicCamera) {
      v.cam.zoom = ORTHO_HALF / (Math.max(up / 2, across / 2 / aspect) * 1.15);
      const off = v.cam.position.clone().sub(v.controls.target);
      v.controls.target.copy(ct);
      v.cam.position.copy(ct).add(off);
    } else {
      const dir = v.cam.position.clone().sub(v.controls.target).normalize();
      v.controls.target.copy(ct);
      v.cam.position.copy(ct).add(dir.multiplyScalar(Math.max(...size) * 1.6));
    }
    v.cam.updateProjectionMatrix();
    v.controls.update();
  });
}

// ---------------------------------------------------------------------------------------------
// Files table: vertices per game file (as exported)

let countTimer = 0;
let lastParts = null;
function queueCounts() { clearTimeout(countTimer); countTimer = setTimeout(updateCounts, 250); }
function updateCounts() {
  lastParts = mesh.toParts();
  const t = $('files');
  t.innerHTML = '<tr><td>ไฟล์</td><td class="n">จุด</td><td class="n">สามเหลี่ยม</td><td></td></tr>';
  const cur = $('cur-slot').value;
  for (const [slot, label] of SLOTS) {
    const parts = lastParts[slot];
    const v = partVerts(parts);
    const tris = (parts || []).reduce((s, q) => s + q.indices.length / 3, 0);
    const tr = t.insertRow();
    tr.className = `${v > GAME_MAX ? 'over' : ''} ${slot === cur ? 'cur' : ''}`;
    const name = tr.insertCell();
    name.textContent = label;
    name.style.cursor = 'pointer';
    name.title = 'ใช้ชิ้นนี้กับหน้าที่วาดใหม่';
    name.addEventListener('click', () => { $('cur-slot').value = slot; updateCounts(); });
    const n = tr.insertCell(); n.className = 'n'; n.textContent = v ? `${v.toLocaleString()}${v > GAME_MAX ? ' ⚠' : ''}` : '–';
    const nt = tr.insertCell(); nt.className = 'n'; nt.textContent = tris ? tris.toLocaleString() : '';
    const b = tr.insertCell();
    if (v) {
      const sel = document.createElement('button');
      sel.textContent = 'เลือก';
      sel.title = 'เลือกทุกหน้าของชิ้นนี้';
      sel.addEventListener('click', () => {
        if (mode !== 'face') setMode('face');
        selF.clear();
        mesh.faces.forEach((f, k) => { if (f.slot === slot) selF.add(k); });
        refresh();
      });
      const eye = document.createElement('button');
      eye.textContent = hiddenSlots.has(slot) ? '🙈' : '👁';
      eye.title = 'ซ่อน / แสดงชิ้นนี้';
      eye.addEventListener('click', () => { if (hiddenSlots.has(slot)) hiddenSlots.delete(slot); else hiddenSlots.add(slot); selF.clear(); selV.clear(); refresh(); });
      b.append(sel, eye);
    }
  }
}

function status(t) { $('status').textContent = t; }
function updateStatus() {
  const total = lastParts ? Object.values(lastParts).reduce((s, p) => s + partVerts(p), 0) : 0;
  status(`${mode === 'vert' ? `เลือก ${selV.size} จุด` : `เลือก ${selF.size} หน้า`} · ทั้งหมด ${mesh.faces.length.toLocaleString()} หน้า ${mesh.verts.length.toLocaleString()} จุด`
    + (total ? ` · ในเกม ${total.toLocaleString()} จุด` : '') + ` · เครื่องมือ: ${{ select: 'เลือก', translate: 'ย้าย', rotate: 'หมุน', scale: 'ย่อขยาย', draw: 'วาดหน้า' }[tool]}`);
}

// ---------------------------------------------------------------------------------------------
// Files: reference, car folders, template, export, project

const tick = () => new Promise((r) => setTimeout(r, 0));
async function template() {
  if (template.cache) return template.cache;
  const b64 = (window.RC_TEMPLATES || {}).gtv98;
  if (!b64) throw new Error('ไม่มีรถแม่แบบ (gtv98) ในหน้าเว็บ');
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const json = await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  template.cache = { name: 'gtv98', files: new Map(Object.entries(JSON.parse(json)).map(([p, d]) => [p, Uint8Array.from(atob(d), (c) => c.charCodeAt(0))])) };
  return template.cache;
}

function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Body and the stock part of every slot from a car folder's files (Map rel → bytes).
function importCarFiles(files) {
  const m = new EditMesh();
  const pick = (dir) => {
    const pre = dir ? `${dir}/` : '';
    for (const l of [2, 1, 0]) {
      for (const name of [dir ? 'default' : 'body']) if (files.has(`${pre}${name}_${l}.0m`)) return files.get(`${pre}${name}_${l}.0m`);
      const any = [...files.keys()].find((r) => r.startsWith(pre) && !r.slice(pre.length).includes('/') && r.endsWith(`_${l}.0m`));
      if (any) return files.get(any);
    }
    return null;
  };
  const body = pick('');
  if (body) m.addOM(body, 'body');
  for (const [slot] of SLOTS) if (slot !== 'body') { const b = pick(slot); if (b) m.addOM(b, slot); }
  m.weldClose(1e-4);
  return m;
}

async function openReference(file) {
  $('ref-info').textContent = `กำลังเปิด ${file.name}…`;
  await tick();
  try {
    refModel = await loadModel(file);
  } catch (e) { $('ref-info').textContent = `เปิดไม่ได้: ${e.message}`; return; }
  await showReference(refModel, $('ref-outside').checked);
  if (!$('car-name').dataset.touched) $('car-name').value = 'rc_canyon';
  zoomAll();
}

async function autoBuild(bend = false) {
  if (!refModel) { status('เปิดโมเดลต้นแบบก่อน'); return; }
  const log = $('auto-log');
  log.textContent = '';
  const say = (t) => { log.textContent += `${t}\n`; };
  $('btn-auto').disabled = true;
  busy = true;
  try {
    const opts = { name: $('car-name').value || 'rc_car', template: await template(), maxVerts: GAME_MAX, log: say };
    const out = bend ? await bendTemplate(refModel, opts) : await convert(refModel, opts);
    pushUndo();
    mesh = importCarFiles(out);
    selV.clear(); selF.clear();
    say('เสร็จ เอามาแก้ต่อได้เลย');
    refresh();
    zoomAll();
  } catch (e) { console.error(e); say(`ผิดพลาด: ${e.message}`); }
  busy = false;
  $('btn-auto').disabled = false;
}

async function exportCar() {
  const log = $('export-log');
  const name = ($('car-name').value || 'rc_car').replace(/[^a-z0-9_]/gi, '_').toLowerCase();
  if (!mesh.faces.length) { log.textContent = 'ยังไม่มีตัวรถ'; return; }
  log.textContent = 'กำลังเขียนไฟล์…';
  await tick();
  busy = true;
  try {
    const parts = mesh.toParts();
    for (const [slot, p] of Object.entries(parts)) if (partVerts(p) > 65000) throw new Error(`${slot} ใหญ่เกินที่ไฟล์ .0m เก็บได้ (${partVerts(p).toLocaleString()} จุด)`);
    smoothNormals(Object.values(parts).flat());
    const bb = mesh.bbox();
    const out = await writeCar(parts, { name, template: await template(), bounds: [bb.min, bb.max], log: (t) => { log.textContent = t; } });
    log.textContent = 'บีบอัด .zip…';
    await tick();
    const files = [...out].sort((a, b) => a[0].localeCompare(b[0])).map(([rel, data]) => ({ path: `${name}/${rel}`, data }));
    download(await makeZip(files), `${name}.zip`);
    const over = Object.entries(parts).filter(([, p]) => partVerts(p) > GAME_MAX).map(([s]) => s);
    log.textContent = `ดาวน์โหลด ${name}.zip แล้ว (${files.length} ไฟล์)` + (over.length ? `\n⚠ เกิน ${GAME_MAX.toLocaleString()} จุด: ${over.join(', ')} ใส่เกมอาจเด้ง` : '\n✅ ทุกไฟล์ไม่เกิน 3,500 จุด');
    const checks = document.createElement('div');
    checks.className = 'checks';
    log.appendChild(checks);
    renderChecks(checks, await checkCar(out, name, await template()));
  } catch (e) { console.error(e); log.textContent = `ผิดพลาด: ${e.message}`; }
  busy = false;
}

// ---------------------------------------------------------------------------------------------
// Blueprints: an image behind the top / front / side view (that view only)

const BP_VIEWS = [
  { key: 'top', label: 'ด้านบน', layer: 1, basis: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], at: [0, 0, -0.05] },
  { key: 'front', label: 'ด้านหน้า', layer: 2, basis: [[1, 0, 0], [0, 0, 1], [0, -1, 0]], at: [0, 8, 0] },
  { key: 'side', label: 'ด้านข้าง', layer: 3, basis: [[0, 1, 0], [0, 0, 1], [1, 0, 0]], at: [-8, 0, 0] },
];
function buildBlueprints() {
  const box = $('blueprints');
  for (const v of BP_VIEWS) {
    const st = { size: v.key === 'front' ? 2.2 : 5, dx: 0, dy: v.key === 'top' ? 0 : 0.8, rot: 0, mesh: null, aspect: 1 };
    const div = document.createElement('div');
    div.className = 'bp';
    div.innerHTML = `<div class="row"><span>${v.label}</span><button>🖼 ใส่รูป</button></div>`;
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.hidden = true;
    div.querySelector('button').addEventListener('click', () => input.click());
    const place = () => {
      if (!st.mesh) return;
      const m = new THREE.Matrix4().makeBasis(...v.basis.map((a) => new THREE.Vector3(...a)));
      const r = new THREE.Matrix4().makeRotationZ((st.rot * Math.PI) / 2);
      const s = new THREE.Matrix4().makeScale(st.size, st.size / st.aspect, 1);
      const off = new THREE.Vector3(st.dx, st.dy, 0).applyMatrix4(new THREE.Matrix4().makeBasis(...v.basis.map((a) => new THREE.Vector3(...a))));
      const t = new THREE.Matrix4().makeTranslation(v.at[0] + off.x, v.at[1] + off.y, v.at[2] + off.z);
      st.mesh.matrix.copy(t.multiply(m).multiply(r).multiply(s));
    };
    const num = (label, key, step) => {
      const row = document.createElement('label'); row.className = 'row';
      row.innerHTML = `<span>${label}</span>`;
      const i = document.createElement('input'); i.type = 'number'; i.step = step; i.value = st[key];
      i.addEventListener('input', () => { st[key] = Number(i.value) || 0; place(); });
      row.appendChild(i); div.appendChild(row);
    };
    num('ความกว้างรูป (ม.)', 'size', 0.05);
    num('เลื่อนซ้าย-ขวา (ม.)', 'dx', 0.02);
    num('เลื่อนขึ้น-ลง (ม.)', 'dy', 0.02);
    const rotB = document.createElement('button'); rotB.textContent = '⟳ หมุนรูป 90°';
    rotB.addEventListener('click', () => { st.rot = (st.rot + 1) % 4; place(); });
    div.appendChild(rotB);
    input.addEventListener('change', () => {
      const f = input.files[0];
      if (!f) return;
      const url = URL.createObjectURL(f);
      new THREE.TextureLoader().load(url, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        st.aspect = tex.image.width / tex.image.height;
        if (st.mesh) { world.remove(st.mesh); st.mesh.material.map.dispose(); }
        st.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }));
        st.mesh.matrixAutoUpdate = false;
        st.mesh.layers.set(v.layer);
        st.mesh.renderOrder = -1;
        world.add(st.mesh);
        place();
      });
    });
    div.appendChild(input);
    box.appendChild(div);
  }
}

// ---------------------------------------------------------------------------------------------
// UI wiring

function fillSelect(sel, options, value) {
  for (const [v, l] of options) sel.add(new Option(l, v));
  sel.value = value;
}
fillSelect($('cur-slot'), SLOTS, 'body');
fillSelect($('cur-mat'), MATS, 'Body_Color');
$('cur-slot').addEventListener('change', updateCounts);

document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
$('btn-undo').addEventListener('click', doUndo);
$('btn-redo').addEventListener('click', doRedo);
$('btn-delete').addEventListener('click', deleteSelected);
$('btn-weld').addEventListener('click', weldSelected);
$('btn-flip').addEventListener('click', flipSelected);
$('btn-surface').addEventListener('click', snapSelected);
$('btn-max').addEventListener('click', () => { maximized = !maximized; $('views').classList.toggle('max', maximized); });
$('btn-zoom').addEventListener('click', zoomAll);
$('btn-oneside').addEventListener('click', (e) => { oneSided = !oneSided; e.target.classList.toggle('on', oneSided); refresh(); });
$('btn-assign-slot').addEventListener('click', () => assignSelected('slot', $('cur-slot').value));
$('btn-assign-mat').addEventListener('click', () => assignSelected('mat', $('cur-mat').value));
$('btn-reduce').addEventListener('click', reduceSelected);
$('btn-mirror-all').addEventListener('click', mirrorAll);
$('btn-hidden').addEventListener('click', removeHiddenFaces);
$('ref-outside').addEventListener('change', async (e) => { if (refModel) await showReference(refModel, e.target.checked); });
$('ref-opacity').addEventListener('input', (e) => { refMat.opacity = Number(e.target.value); });
$('ref-show').addEventListener('change', (e) => { if (refMesh) refMesh.visible = e.target.checked; });
$('car-name').addEventListener('input', (e) => { e.target.dataset.touched = '1'; });

$('btn-ref').addEventListener('click', () => $('file-ref').click());
$('file-ref').addEventListener('change', async (e) => { if (e.target.files[0]) await openReference(e.target.files[0]); e.target.value = ''; });
$('btn-auto').addEventListener('click', () => autoBuild(false));
$('btn-bend').addEventListener('click', () => autoBuild(true));
$('btn-new').addEventListener('click', () => { pushUndo(); mesh = new EditMesh(); selV.clear(); selF.clear(); refresh(); setTool('draw'); });
$('btn-open-car').addEventListener('click', () => $('file-car').click());
$('file-car').addEventListener('change', async (e) => {
  const list = [...e.target.files];
  if (!list.length) return;
  const files = new Map();
  for (const f of list) {
    const parts = (f.webkitRelativePath || f.name).split('/');
    files.set(parts.slice(1).join('/') || f.name, new Uint8Array(await f.arrayBuffer()));
  }
  const name = (list[0].webkitRelativePath || '').split('/')[0];
  if (name) { $('car-name').value = name; }
  pushUndo();
  mesh = importCarFiles(files);
  selV.clear(); selF.clear();
  refresh();
  zoomAll();
  e.target.value = '';
});
$('btn-export').addEventListener('click', exportCar);
$('btn-save').addEventListener('click', () => {
  const name = $('car-name').value || 'rc_car';
  download(new Blob([JSON.stringify({ app: 'raycity-studio', version: 1, name, mesh: mesh.toJSON() })], { type: 'application/json' }), `${name}.studio.json`);
});
$('btn-load').addEventListener('click', () => $('file-proj').click());
$('file-proj').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    pushUndo();
    mesh = EditMesh.fromJSON(j.mesh);
    if (j.name) $('car-name').value = j.name;
    selV.clear(); selF.clear();
    refresh();
    zoomAll();
  } catch (err) { status(`เปิดงานไม่ได้: ${err.message}`); }
  e.target.value = '';
});

// Dropping a model file on the views opens it as the reference.
$('views').addEventListener('dragover', (e) => e.preventDefault());
$('views').addEventListener('drop', async (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f && /\.(glb|gltf|fbx|obj)$/i.test(f.name)) await openReference(f);
});

window.addEventListener('keydown', (e) => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey) {
    if (k === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); }
    else if (k === 'y') { e.preventDefault(); doRedo(); }
    else if (k === 'a') {
      e.preventDefault();
      if (mode === 'vert') mesh.verts.forEach((_, i) => selV.add(i)); else mesh.faces.forEach((f, i) => { if (visibleFace(f)) selF.add(i); });
      refresh();
    } else if (k === 'w') { e.preventDefault(); weldSelected(); }
    return;
  }
  if (e.altKey && k === 'w') { e.preventDefault(); $('btn-max').click(); return; }
  if (k === '1') setMode('vert');
  else if (k === '2') setMode('face');
  else if (k === 'q') setTool('select');
  else if (k === 'w') setTool('translate');
  else if (k === 'e') setTool('rotate');
  else if (k === 'r') setTool('scale');
  else if (k === 'd') setTool('draw');
  else if (k === 'z') zoomAll();
  else if (k === 'f') flipSelected();
  else if (k === 'delete' || k === 'backspace') deleteSelected();
  else if (k === 'enter' && tool === 'draw') { e.preventDefault(); finishFace(active); }
  else if (k === 'escape') { drawPts = []; updateDrawPreview(); if (tool !== 'draw') { selV.clear(); selF.clear(); refresh(); } }
});

buildBlueprints();
offerRestore();
refresh();
render();
// Buttons give the keyboard back to the views (Enter / Space on a focused button would press it again).
document.addEventListener('click', (e) => { if (e.target.closest('button')) e.target.closest('button').blur(); });
window.studio = { get drawPts() { return drawPts; }, get mesh() { return mesh; }, openReference, autoBuild, exportCar, setMode, setTool, refresh, zoomAll, selV, selF, views, mirrorAll };
