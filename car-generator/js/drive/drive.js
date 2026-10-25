// RayCity Drive: a browser racing prototype. A RayCity car folder (.zip, the game's own .0m meshes, mask and
// colour layer) driven on a closed track: arcade physics, drift on the handbrake, lap timer, brake / reverse
// lamps lit like in the game (kind 4 red braking, kind 3 white reversing).
import * as THREE from 'three';
import { parseOM, omParts } from '../om.js';
import { readZip } from '../zip.js';
import { createCity } from './city.js';
import { loadGarage, compactParts, handling, garageScene } from './garage.js';
import { createTraffic } from './traffic.js';
import { createPeople } from './people.js';

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
const cam = new THREE.PerspectiveCamera(62, 1, 0.1, 3000);
const hemi = new THREE.HemisphereLight('#dfe9ff', '#3b4a2c', 0.9); scene.add(hemi);
const sun = new THREE.DirectionalLight('#ffffff', 1.6);
sun.position.set(-60, 120, 40); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 300 });
scene.add(sun, sun.target);
// the game's sunset: its sky picture (etc/skydome/sunset, upper half = the sky down to the horizon) on a dome
// that follows the camera, its fog colour and range (etc/env/sunset.xml), a low warm sun
const sky = new THREE.Mesh(new THREE.SphereGeometry(2000, 48, 24), new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false, depthWrite: false }));
sky.renderOrder = -1; sky.visible = false; scene.add(sky);
function gameSky(look) {
  if (!look || !look.sky) return;
  const img = new Image(); img.src = `data:image/png;base64,${look.sky}`;
  const tex = new THREE.Texture(img); img.onload = () => { tex.needsUpdate = true; }; tex.colorSpace = THREE.SRGBColorSpace;
  // v from the elevation: horizon = the picture's middle row, straight up = its top row; below the horizon holds
  const pos = sky.geometry.attributes.position; const uv = sky.geometry.attributes.uv;
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i) / 2000; uv.setY(i, 0.5 + 0.5 * Math.max(0.004, Math.asin(Math.max(-1, Math.min(1, y))) / (Math.PI / 2))); }
  uv.needsUpdate = true; sky.material.map = tex; sky.material.needsUpdate = true; sky.visible = true;
  // the game's fog colour is mixed with its HDR sky; on its own it browns everything, so lighten it towards the horizon
  const f = (look.fog ? new THREE.Color(`rgb(${look.fog.color.join(',')})`) : new THREE.Color('#a86a48')).lerp(new THREE.Color('#e8b08a'), 0.6);
  scene.background = f; scene.fog = new THREE.Fog(f, look.fog ? look.fog.range[0] : 400, look.fog ? look.fog.range[1] * 1.3 : 1100);
  hemi.color.set('#fff0e2'); hemi.groundColor.set('#55604a'); hemi.intensity = 1.15;
  sun.color.set('#ffe0bf'); sun.intensity = 1.9;
}
function resize() { renderer.setSize(window.innerWidth, window.innerHeight, false); cam.aspect = window.innerWidth / window.innerHeight; cam.updateProjectionMatrix(); }
window.addEventListener('resize', resize); resize();

// ---------------------------------------------------------------------------------------------
// Tracks. The practice loop (drawn into a ground texture), or one of the game's own race routes (track/*.0m)
// laid over the region's road network (etc/traffic/road_*.bin), both pulled out by tools/extract-city.mjs into
// js/drive/rc-city.js. RayCity world (x, y, z up) → three (x, z, −y), shifted so the start sits at the origin.
// TRACK holds the centre line as Vector2(x, z), HEIGHT its road height; LOOP false = a sprint to the finish.

const world = new THREE.Group(); scene.add(world);
let TRACK = []; let HEIGHT = []; let LOOP = true; let LAPS = 0; let ROAD_W = 14; let BOUND = 317;
let nearRoad = () => Infinity; // distance to the closest other road (city roads)
let city = null; let tilesOn = false; let traffic = null; let people = null; // the minimap city (js/drive/city.js), when the world is built from it
let SPAWN = null; // free roam: where R puts the car back
let blocks = []; let blockGrid = new Map(); // building footprints [x0, z0, x1, z1] for collisions
const unpack = (a) => { const o = []; let x = 0; let y = 0; let z = 0; for (let i = 0; i < a.length; i += 3) { x += a[i]; y += a[i + 1]; z += a[i + 2]; o.push([x / 10, y / 10, z / 10]); } return o; };
function clearWorld() {
  world.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) [o.material].flat().forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); }); });
  world.clear(); blocks = []; blockGrid = new Map(); nearRoad = () => Infinity;
  if (city) city.clear(); if (traffic) traffic.clear(); if (people) people.clear(); tilesOn = false; SPAWN = null; TRACK = []; HEIGHT = [];
}

// free roam in the city, like the game's field: the minimap city around the car, no race
function buildFree() {
  clearWorld();
  const t = CITY.tracks.find((q) => q.file === 'gwanghwamun') || CITY.tracks.find((q) => q.region === 'kr');
  const raw = unpack(t.path); const [ox, oy] = raw[0];
  city.setOrigin(ox, oy); tilesOn = true; LOOP = true; LAPS = 0; ROAD_W = 12; BOUND = 1e9;
  const b = raw[3] || raw[1]; SPAWN = { x: 0, z: 0, h: Math.atan2(b[0] - ox, -(b[1] - oy)) };
  $('track-info').textContent = 'ขับเล่นในเมือง (โซล) · ถนนและบล็อกจากแผนที่ในเกม · Shift = บูสต์ SP';
}

function buildPractice() {
  clearWorld();
  const pts = []; const N = 240;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    // a rounded, wavy loop (≈ 1.2 km)
    const r = 150 + 28 * Math.sin(a * 3) + 14 * Math.cos(a * 5);
    pts.push(new THREE.Vector2(Math.cos(a) * r * 1.25, Math.sin(a) * r * 0.8));
  }
  TRACK = pts; HEIGHT = pts.map(() => 0); LOOP = true; LAPS = 0; ROAD_W = 14; const WORLD = 640; BOUND = WORLD / 2 - 3;
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
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; world.add(ground);
  // tyre walls / cones on the outside of the bends, a few buildings
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.9, 10), new THREE.MeshStandardMaterial({ color: '#ff7a1a' }));
  TRACK.forEach((p, i) => { if (i % 4) return; const q = TRACK[(i + 1) % TRACK.length]; const dd = new THREE.Vector2().subVectors(q, p).normalize(); for (const s of [-1, 1]) { const c = cone.clone(); const o = p.clone().addScaledVector(new THREE.Vector2(-dd.y, dd.x), s * (ROAD_W / 2 + 2)); c.position.set(o.x, 0.45, o.y); c.castShadow = true; world.add(c); } });
  const box = new THREE.BoxGeometry(1, 1, 1);
  // buildings well away from the road (inside the loop and around it)
  for (let i = 0, n = 0; i < 2000 && n < 70; i++) { const x = (Math.random() - 0.5) * (WORLD - 40); const z = (Math.random() - 0.5) * (WORLD - 40); const sx = 10 + Math.random() * 14; const sz = 10 + Math.random() * 14; if (onTrack(x, z, true).dist < ROAD_W / 2 + 6 + Math.max(sx, sz) * 0.75) continue; const h = 8 + Math.random() * 40; const m = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.6, 0.08, 0.35 + Math.random() * 0.3) })); m.scale.set(sx, h, sz); m.position.set(x, h / 2, z); m.castShadow = true; world.add(m); addBlock(x - sx / 2, z - sz / 2, x + sx / 2, z + sz / 2); n++; }
  $('track-info').textContent = 'สนามฝึก · วงปิด ≈ 1.2 กม.';
}

// segments of polylines in a 40 m grid, for the nearest-distance queries
function segGrid(lines) {
  const G = new Map(); const C = 40;
  for (const l of lines) for (let i = 0; i + 1 < l.length; i++) {
    const a = l[i]; const b = l[i + 1];
    for (let gx = Math.floor(Math.min(a[0], b[0]) / C); gx <= Math.floor(Math.max(a[0], b[0]) / C); gx++)
      for (let gz = Math.floor(Math.min(a[1], b[1]) / C); gz <= Math.floor(Math.max(a[1], b[1]) / C); gz++) {
        const k = `${gx},${gz}`; let c = G.get(k); if (!c) G.set(k, (c = [])); c.push(a[0], a[1], b[0], b[1]);
      }
  }
  return (x, z) => {
    let best = Infinity; const gx = Math.floor(x / C); const gz = Math.floor(z / C);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const c = G.get(`${gx + i},${gz + j}`); if (!c) continue;
      for (let k = 0; k < c.length; k += 4) {
        const ax = c[k]; const az = c[k + 1]; const dx = c[k + 2] - ax; const dz = c[k + 3] - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
        const ex = ax + dx * t - x; const ez = az + dz * t - z; best = Math.min(best, ex * ex + ez * ez);
      }
    }
    return Math.sqrt(best);
  };
}
function addBlock(x0, z0, x1, z1) {
  const b = [x0, z0, x1, z1]; blocks.push(b);
  for (let gx = Math.floor(x0 / 40); gx <= Math.floor(x1 / 40); gx++) for (let gz = Math.floor(z0 / 40); gz <= Math.floor(z1 / 40); gz++) {
    const k = `${gx},${gz}`; let c = blockGrid.get(k); if (!c) blockGrid.set(k, (c = [])); c.push(b);
  }
}
function hitBlock(x, z, r) {
  for (const b of blockGrid.get(`${Math.floor(x / 40)},${Math.floor(z / 40)}`) || []) if (x > b[0] - r && x < b[2] + r && z > b[1] - r && z < b[3] + r) return b;
  return null;
}
// a flat ribbon along a polyline (points [x, z, y]), width w, raised by lift
function ribbon(lines, w, lift, pos, idx) {
  for (const l of lines) {
    if (l.length < 2) continue; const base = pos.length / 3;
    for (let i = 0; i < l.length; i++) {
      const a = l[Math.max(0, i - 1)]; const b = l[Math.min(l.length - 1, i + 1)];
      let dx = b[0] - a[0]; let dz = b[1] - a[1]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
      pos.push(l[i][0] - dz * w / 2, l[i][2] + lift, l[i][1] + dx * w / 2, l[i][0] + dz * w / 2, l[i][2] + lift, l[i][1] - dx * w / 2);
      if (i) { const v = base + i * 2; idx.push(v - 2, v, v - 1, v - 1, v, v + 1); }
    }
  }
}
function ribbonMesh(lines, w, lift, mat) {
  const pos = []; const idx = []; ribbon(lines, w, lift, pos, idx);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; world.add(m); return m;
}

const REGION = { kr: 'โซล', n1: 'เมืองใหม่ (n1)' };
let CITY = null;
async function loadCity() {
  if (!window.RC_CITY) return null;
  const bin = Uint8Array.from(atob(window.RC_CITY), (c) => c.charCodeAt(0));
  return JSON.parse(await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
}
function buildCity(t) {
  clearWorld();
  const raw = unpack(t.path); const [ox, oy, oz] = raw[0];
  const flat = t.region === 'kr' && city && city.count > 0; // the minimap city is flat
  const W = (q) => [q[0] - ox, -(q[1] - oy), flat ? 0 : q[2] - oz]; // → [x, z, height]
  const route = raw.map(W);
  TRACK = route.map((q) => new THREE.Vector2(q[0], q[1])); HEIGHT = route.map((q) => q[2]);
  LOOP = t.loop; LAPS = t.laps; ROAD_W = 12;
  if (flat) return cityRoute(t, route, ox, oy);
  let x0 = Infinity; let z0 = Infinity; let x1 = -Infinity; let z1 = -Infinity; let hmin = Infinity;
  for (const q of route) { x0 = Math.min(x0, q[0]); z0 = Math.min(z0, q[1]); x1 = Math.max(x1, q[0]); z1 = Math.max(z1, q[1]); hmin = Math.min(hmin, q[2]); }
  const M = 400; BOUND = Math.max(Math.abs(x0), Math.abs(x1), Math.abs(z0), Math.abs(z1)) + M;
  // the region's roads around the route
  const lines = (CITY.roads[t.region] || []).map((l) => unpack(l).map(W)).filter((l) => l.some((q) => q[0] > x0 - M && q[0] < x1 + M && q[1] > z0 - M && q[1] < z1 + M));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: '#56604c', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.scale.set(x1 - x0 + 2 * M + 800, z1 - z0 + 2 * M + 800, 1);
  ground.position.set((x0 + x1) / 2, Math.min(hmin, 0) - 0.4, (z0 + z1) / 2); ground.receiveShadow = true; world.add(ground);
  ribbonMesh(lines, 8, 0.02, new THREE.MeshStandardMaterial({ color: '#4a4d53', roughness: 0.95 }));
  ribbonMesh([route], ROAD_W + 1.2, 0.04, new THREE.MeshStandardMaterial({ color: '#e8e8e8', roughness: 0.9 }));
  ribbonMesh([route], ROAD_W, 0.06, new THREE.MeshStandardMaterial({ color: '#34373c', roughness: 0.9 }));
  const roadD = segGrid(lines); const routeD = segGrid([route]);
  nearRoad = roadD;
  // start and finish lines (chequered), arrows at the checkpoints
  const chk = (() => { const c = document.createElement('canvas'); c.width = 12; c.height = 2; const g = c.getContext('2d'); for (let i = 0; i < 12; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#fff'; g.fillRect(i, j, 1, 1); } const tx = new THREE.CanvasTexture(c); tx.magFilter = THREE.NearestFilter; return tx; })();
  const line = (i) => {
    const a = route[Math.min(i, route.length - 2)]; const b = route[Math.min(i, route.length - 2) + 1]; const p = route[i];
    const m = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, 2.4), new THREE.MeshStandardMaterial({ map: chk }));
    m.rotation.order = 'YXZ'; m.rotation.set(-Math.PI / 2, Math.atan2(b[0] - a[0], b[1] - a[1]), 0); m.position.set(p[0], p[2] + 0.08, p[1]); world.add(m);
  };
  line(0); if (!LOOP) line(route.length - 1);
  // buildings: blocks along the route that keep clear of every road
  const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
  const list = []; let acc = 0;
  for (let i = 0; i + 1 < route.length; i++) {
    const a = route[i]; const b = route[i + 1]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); const dx = (b[0] - a[0]) / (L || 1); const dz = (b[1] - a[1]) / (L || 1);
    for (acc += L; acc > 18; acc -= 18) {
      const t0 = 1 - acc / L; const px = a[0] + (b[0] - a[0]) * t0; const pz = a[1] + (b[1] - a[1]) * t0; const ph = a[2] + (b[2] - a[2]) * t0;
      for (const s of [-1, 1]) for (let row = 0; row < 3; row++) {
        const sx = 10 + Math.random() * 18; const sz = 10 + Math.random() * 18; const r = Math.max(sx, sz) * 0.72;
        const off = ROAD_W / 2 + 8 + r + row * 34 + Math.random() * 10; const x = px - dz * off * s; const z = pz + dx * off * s;
        if (routeD(x, z) < ROAD_W / 2 + 4 + r || roadD(x, z) < 7 + r || hitBlock(x, z, r)) continue;
        const h = 6 + Math.random() * Math.random() * 60; list.push([x, z, sx, sz, h, ph]); addBlock(x - sx / 2, z - sz / 2, x + sx / 2, z + sz / 2);
      }
    }
  }
  const inst = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ roughness: 0.85 }), list.length);
  const mtx = new THREE.Matrix4(); const col = new THREE.Color();
  const base = Math.min(hmin, 0) - 0.4;
  list.forEach(([x, z, sx, sz, h, ph], i) => { mtx.makeScale(sx, h + ph - base, sz).setPosition(x, base, z); inst.setMatrixAt(i, mtx); inst.setColorAt(i, col.setHSL(0.58 + Math.random() * 0.08, 0.06 + Math.random() * 0.08, 0.32 + Math.random() * 0.36)); });
  inst.castShadow = true; inst.receiveShadow = true; world.add(inst);
  const km = (t.length || 0) / 1000;
  $('track-info').textContent = `${t.name} · ${REGION[t.region] || t.region} · ${km ? `${km.toFixed(1)} กม. · ` : ''}${LOOP ? `วงปิด${LAPS ? ` ${LAPS} รอบ` : ''}` : 'วิ่งถึงเส้นชัย'} · ถนนรอบ ๆ ${lines.length.toLocaleString()} เส้น`;
}

// a kr route raced through the minimap city: the route drawn as the game's glowing guide, start / finish lines
function cityRoute(t, route, ox, oy) {
  city.setOrigin(ox, oy); tilesOn = true; BOUND = 1e9;
  const glow = new THREE.MeshBasicMaterial({ color: '#3fe0ff', transparent: true, opacity: 0.28, depthWrite: false });
  ribbonMesh([route], 3.2, 0.12, glow).renderOrder = 1;
  const chk = (() => { const c = document.createElement('canvas'); c.width = 12; c.height = 2; const g = c.getContext('2d'); for (let i = 0; i < 12; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#fff'; g.fillRect(i, j, 1, 1); } const tx = new THREE.CanvasTexture(c); tx.magFilter = THREE.NearestFilter; return tx; })();
  const line = (i) => {
    const a = route[Math.min(i, route.length - 2)]; const b = route[Math.min(i, route.length - 2) + 1]; const p = route[i];
    const m = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, 2.4), new THREE.MeshStandardMaterial({ map: chk }));
    m.rotation.order = 'YXZ'; m.rotation.set(-Math.PI / 2, Math.atan2(b[0] - a[0], b[1] - a[1]), 0); m.position.set(p[0], 0.1, p[1]); world.add(m);
  };
  line(0); if (!LOOP) line(route.length - 1);
  const km = (t.length || 0) / 1000;
  $('track-info').textContent = `${t.name} · โซล · ${km ? `${km.toFixed(1)} กม. · ` : ''}${LOOP ? `วงปิด${LAPS ? ` ${LAPS} รอบ` : ''}` : 'วิ่งถึงเส้นชัย'} · ตามเส้นสีฟ้า`;
}

// nearest distance to the track's centre line, its segment and the road height there; searched around the
// last segment (routes cross themselves), all of it when far off
let lastSeg = 0;
function onTrack(x, z, all = false) {
  const n = TRACK.length; const segs = LOOP ? n : n - 1;
  if (n < 2) return { dist: 0, seg: 0, h: 0 }; // free roam
  const scan = (from, to) => {
    let best = Infinity; let bi = 0; let bt = 0;
    for (let s = from; s < to; s++) {
      const i = ((s % segs) + segs) % segs; const a = TRACK[i]; const b = TRACK[(i + 1) % n]; const abx = b.x - a.x; const aby = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.y) * aby) / (abx * abx + aby * aby || 1)));
      const dx = a.x + abx * t - x; const dy = a.y + aby * t - z; const d = dx * dx + dy * dy; if (d < best) { best = d; bi = i; bt = t; }
    }
    return { dist: Math.sqrt(best), seg: bi, h: HEIGHT[bi] + (HEIGHT[(bi + 1) % n] - HEIGHT[bi]) * bt };
  };
  let r = all || segs < 120 ? scan(0, segs) : LOOP ? scan(lastSeg - 40, lastSeg + 40) : scan(Math.max(0, lastSeg - 40), Math.min(segs, lastSeg + 40));
  if (r.dist > 30 && !all && segs >= 120) r = scan(0, segs);
  return r;
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
  const parts = [];
  for (const rel of [...files.keys()].filter((r) => r === 'body_2.0m' || /^[^/]+\/default_2\.0m$/.test(r))) {
    const b = files.get(rel);
    try { parts.push(...omParts(parseOM(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)))); } catch { /* not a mesh we read */ }
  }
  const spec = GARAGE && GARAGE.cars.find((c) => c.name === name);
  await buildCar(parts, files.get(`${name}_base.png`), files.get(`${name}_color.png`), label, spec ? spec.wheels : null, spec ? spec.spec : {});
}
// one of the game's cars (js/drive/rc-cars.js)
async function loadGameCar(c) {
  await buildCar(compactParts(GARAGE.file(c.files.mesh)), GARAGE.file(c.files.base), GARAGE.file(c.files.color), c.name, c.wheels, c.spec);
}
let HANDLING = handling(); const CAMD = { d: 6.5, h: 2.4 };
async function buildCar(parts, maskBytes, colorBytes, label, wheelPos, spec) {
  car.clear(); lamps.brake = []; lamps.reverse = []; lamps.head = [];
  paintTex = new THREE.CanvasTexture(document.createElement('canvas')); paintTex.flipY = false; paintTex.colorSpace = THREE.SRGBColorSpace;
  maskImg = maskBytes ? await imageData(maskBytes) : null;
  colorImg = colorBytes ? await imageData(colorBytes) : null;
  if (!maskImg) { maskImg = new ImageData(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1); }
  repaint();
  const paint = new THREE.MeshStandardMaterial({ map: paintTex, roughness: 0.35, metalness: 0.2 });
  const glass = new THREE.MeshStandardMaterial({ color: '#1d2a3a', transparent: true, opacity: 0.55, roughness: 0.05, metalness: 0.6 });
  const shell = new THREE.Group(); shell.rotation.x = -Math.PI / 2; car.add(shell);
  let tris = 0;
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
  // wheels under the car's arches (gtv98's when unknown): the game's common wheel, or plain tyres
  wheels.length = 0;
  const wp = wheelPos || { front: -1.23, rear: 1.15, x: 0.72 }; const R = 0.31;
  const make = wheelMaker(R);
  for (const [x, y] of [[wp.x, wp.front], [-wp.x, wp.front], [wp.x, wp.rear], [-wp.x, wp.rear]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, R, -y);
    const w = make(x > 0); pivot.add(w); car.add(pivot); wheels.push({ pivot, w, front: y < 0 });
  }
  HANDLING = handling(spec);
  // chase camera back and up by the car's size (a bus needs more room than a coupe)
  const box = new THREE.Box3().setFromObject(car); const sz = box.getSize(new THREE.Vector3());
  CAMD.d = Math.max(6.5, sz.z * 1.45); CAMD.h = Math.max(2.4, sz.y * 1.5);
  $('car-info').textContent = `รถ: ${label} · ${tris.toLocaleString()} สามเหลี่ยม · ไฟเบรก ${lamps.brake.length} · ไฟถอย ${lamps.reverse.length}${spec && spec.BD_Mass ? ` · ${spec.BD_Mass} กก.` : ''}`;
}
let wheelGeo = null; let wheelMat = null;
function wheelMaker(R) {
  if (GARAGE && GARAGE.wheel && !wheelGeo) {
    const q = compactParts(GARAGE.file(GARAGE.wheel.mesh))[0];
    wheelGeo = new THREE.BufferGeometry();
    // RayCity (x axle, y, z up) → three (x, z, −y); the game's wheel is 0.34 m in radius
    const P = new Float32Array(q.positions.length); const N = new Float32Array(q.normals.length);
    for (let i = 0; i < P.length; i += 3) { P[i] = q.positions[i]; P[i + 1] = q.positions[i + 2]; P[i + 2] = -q.positions[i + 1]; N[i] = q.normals[i]; N[i + 1] = q.normals[i + 2]; N[i + 2] = -q.normals[i + 1]; }
    wheelGeo.setAttribute('position', new THREE.BufferAttribute(P, 3)); wheelGeo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    wheelGeo.setAttribute('uv', new THREE.BufferAttribute(q.uvs, 2)); wheelGeo.setIndex(new THREE.BufferAttribute(q.indices, 1));
    wheelMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide });
    if (GARAGE.wheel.tex) createImageBitmap(new Blob([GARAGE.file(GARAGE.wheel.tex)])).then((bm) => { const t = new THREE.Texture(bm); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; wheelMat.map = t; wheelMat.needsUpdate = true; });
  }
  if (wheelGeo) return (right) => { const m = new THREE.Mesh(wheelGeo, wheelMat); const s = R / 0.34; m.scale.set(right ? s : -s, s, s); m.castShadow = true; return m; };
  const tyre = new THREE.CylinderGeometry(R, R, 0.2, 20); tyre.rotateZ(Math.PI / 2);
  const tMat = new THREE.MeshStandardMaterial({ color: '#151515', roughness: 0.9 }); const rim = new THREE.MeshStandardMaterial({ color: '#b9bec7', metalness: 0.8, roughness: 0.3 });
  return () => { const w = new THREE.Mesh(tyre, tMat); w.castShadow = true; w.add(new THREE.Mesh(new THREE.CylinderGeometry(R * 0.63, R * 0.63, 0.21, 10).rotateZ(Math.PI / 2), rim)); return w; };
}
let GARAGE = null;
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

const S = { x: 0, z: 0, y: 0, h: 0, vx: 0, vz: 0, steer: 0, wheelSpin: 0 };
function reset() {
  if (SPAWN) Object.assign(S, { x: SPAWN.x, z: SPAWN.z, y: 0, h: SPAWN.h, vx: 0, vz: 0, steer: 0 });
  else { const a = TRACK[0]; const b = TRACK[1]; Object.assign(S, { x: a.x, z: a.y, y: HEIGHT[0], h: Math.atan2(b.x - a.x, b.y - a.y), vx: 0, vz: 0, steer: 0 }); }
  SP.v = SP.max;
  // a sprint's clock runs from the start; a loop's from the first time over the line
  lastSeg = 0; lap.n = 0; lap.t0 = performance.now(); lap.next = 1; lap.started = !LOOP; lap.done = false;
}
const keys = new Set();
const KEYMAP = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'hand', ShiftLeft: 'boost', ShiftRight: 'boost' };
const SP = { v: 8996, max: 8996 }; // the game's SP bar, spent on the boost
window.addEventListener('keydown', (e) => { if (KEYMAP[e.code]) { keys.add(KEYMAP[e.code]); e.preventDefault(); } if (e.code === 'KeyR') reset(); if (e.code === 'KeyC') camMode = (camMode + 1) % 2; });
window.addEventListener('keyup', (e) => { if (KEYMAP[e.code]) keys.delete(KEYMAP[e.code]); });
document.querySelectorAll('#touch button').forEach((b) => { const k = b.dataset.k; b.addEventListener('pointerdown', (e) => { e.preventDefault(); keys.add(k); }); for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => keys.delete(k)); });
let camMode = 0;
$('btn-panel').addEventListener('click', () => $('panel').classList.toggle('hide'));
$('btn-garage').addEventListener('click', (e) => { setGarage(!garageOn); e.currentTarget.blur(); });
$('btn-reset').addEventListener('click', (e) => { reset(); e.currentTarget.blur(); });
$('btn-cam').addEventListener('click', (e) => { camMode = (camMode + 1) % 2; e.currentTarget.blur(); });
const lap = { n: 0, t0: 0, best: Infinity, next: 1, started: false, done: false, time: 0 };
const fmt = (ms) => `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(2).padStart(5, '0')}`;

function step(dt) {
  const fx = Math.sin(S.h); const fz = Math.cos(S.h);
  let vf = S.vx * fx + S.vz * fz; let vs = S.vx * fz - S.vz * fx; // forward / side speed
  const tr = onTrack(S.x, S.z); lastSeg = tr.seg;
  const off = tilesOn ? city.classAt(S.x, S.z) < 2 : tr.dist > ROAD_W / 2 + 1 && nearRoad(S.x, S.z) > 5;
  const boost = keys.has('boost') && keys.has('up') && SP.v > 0;
  SP.v = Math.max(0, Math.min(SP.max, SP.v + (boost ? -2200 : 500) * dt));
  const up = keys.has('up'); const down = keys.has('down'); const hand = keys.has('hand');
  let braking = false; let reversing = false;
  const H = HANDLING; const top = H.top * (boost ? 1.3 : 1);
  if (up) vf += (vf < 0 ? 18 : (boost ? 9.5 + 6.5 * H.boost : 9.5) * H.accel * Math.max(0.15, 1 - vf / top)) * dt;
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
  const grip = (hand ? 1.2 : off ? 4 : 9) * HANDLING.grip;
  vs -= vs * Math.min(1, grip * dt);
  const nfx = Math.sin(S.h); const nfz = Math.cos(S.h);
  S.vx = nfx * vf + nfz * vs; S.vz = nfz * vf - nfx * vs;
  S.x += S.vx * dt; S.z += S.vz * dt;
  // buildings: back out of the wall, losing most of the speed into it
  const hb = hitBlock(S.x, S.z, 1.1); let hc = !hb && tilesOn ? city.hit(S.x, S.z, 1.1) : null;
  if (!hb && !hc && tilesOn && traffic) hc = traffic.hit(S.x, S.z, 1.0, ...city.origin);
  if (!hb && !hc && tilesOn && people) hc = people.hit(S.x, S.z, 0.9);
  if (hb || hc) {
    S.x -= S.vx * dt; S.z -= S.vz * dt;
    let nx; let nz;
    if (hc) { nx = hc.nx; nz = hc.nz; } else { nx = S.x < hb[0] ? -1 : S.x > hb[2] ? 1 : 0; nz = nx ? 0 : S.z < hb[1] ? -1 : 1; }
    const vn = S.vx * nx + S.vz * nz; if (vn < 0) { S.vx -= vn * nx * 1.3; S.vz -= vn * nz * 1.3; }
    S.vx *= 0.6; S.vz *= 0.6;
  }
  S.x = Math.max(-BOUND, Math.min(BOUND, S.x)); S.z = Math.max(-BOUND, Math.min(BOUND, S.z));
  S.y += (tr.h - S.y) * Math.min(1, dt * 10);
  S.wheelSpin += (vf / 0.27) * dt;
  // lamps like the game's: brake red while slowing down going forward, reverse white going backwards
  for (const m of lamps.brake) m.emissiveIntensity = braking ? 2.2 : 0.15;
  for (const m of lamps.reverse) m.emissiveIntensity = reversing ? 1.8 : 0;
  // laps: 8 checkpoints along the line, in order; a sprint ends past the last one at the finish
  if (TRACK.length < 2) return { vf, slip: Math.abs(vs), boost };
  const segs = LOOP ? TRACK.length : TRACK.length - 1; const NCP = 8; const cp = Math.min(NCP - 1, Math.floor((tr.seg * NCP) / segs));
  if (!lap.done && LOOP && cp === lap.next % NCP) {
    if (lap.next % NCP === 0) {
      const t = performance.now() - lap.t0; if (lap.started) { lap.n++; lap.best = Math.min(lap.best, t); }
      if (LAPS && lap.n >= LAPS) { lap.done = true; lap.time = t; } else { lap.started = true; lap.t0 = performance.now(); }
    }
    lap.next++;
  } else if (!lap.done && !LOOP) {
    if (cp === lap.next && lap.next < NCP) lap.next++;
    if (lap.next >= NCP && tr.seg >= segs - 1 && tr.dist < ROAD_W) { lap.done = true; lap.time = performance.now() - lap.t0; lap.n = 1; lap.best = Math.min(lap.best, lap.time); }
  }
  return { vf, slip: Math.abs(vs), boost };
}

const camPos = new THREE.Vector3(); const camLook = new THREE.Vector3();

// the game's garage: the car on show, the camera turning round it; the city waits hidden
let garageOn = false; let garageGroup = null; let garageSpin = 0; let savedFog = null; let savedBg = null; let savedLight = null;
function setGarage(on) {
  if (on && !garageGroup) { if (!GARAGE || !GARAGE.garage) return; garageGroup = garageScene(GARAGE, THREE); garageGroup.position.set(0, -2000, 0); scene.add(garageGroup); }
  garageOn = on; if (garageGroup) garageGroup.visible = on;
  for (const o of scene.children) if (o !== garageGroup && o !== car && !o.isLight && o !== cam) o.visible = on ? false : o === sky ? !!sky.material.map : true;
  // the garage's light is mostly baked: the scene lights only lift the unlit pieces and the car
  if (on) { savedLight = [sun.intensity, hemi.intensity]; sun.intensity = 0.7; hemi.intensity = 0.55; } else if (savedLight) { [sun.intensity, hemi.intensity] = savedLight; }
  if (on) { savedFog = scene.fog; savedBg = scene.background; scene.fog = null; scene.background = new THREE.Color('#05070a'); S.vx = S.vz = 0; car.position.set(0, -2000 + GARAGE_FLOOR, 0); car.rotation.y = 0; $('panel').classList.remove('hide'); }
  else { scene.fog = savedFog || scene.fog; scene.background = savedBg || scene.background; reset(); camPos.set(S.x, S.y + 3, S.z - 8); }
  document.body.classList.toggle('in-garage', on);
}
const GARAGE_FLOOR = 0;
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (garageOn) {
    garageSpin += dt * 0.35; const r = 6.2;
    cam.position.set(Math.sin(garageSpin) * r, -2000 + GARAGE_FLOOR + 1.7, Math.cos(garageSpin) * r); cam.lookAt(0, -2000 + GARAGE_FLOOR + 0.6, 0);
    sun.position.set(4, -2000 + 8, 3); sun.target.position.set(0, -2000, 0);
    renderer.render(scene, cam); requestAnimationFrame(frame); return;
  }
  let r = { vf: 0 }; for (let i = 0; i < 4; i++) r = step(dt / 4);
  car.position.set(S.x, S.y, S.z); car.rotation.y = S.h;
  for (const w of wheels) { w.w.rotation.x = S.wheelSpin; if (w.front) w.pivot.rotation.y = S.steer; }
  const fx = Math.sin(S.h); const fz = Math.cos(S.h);
  if (camMode === 0) { camPos.lerp(new THREE.Vector3(S.x - fx * CAMD.d, S.y + CAMD.h, S.z - fz * CAMD.d), Math.min(1, dt * 6)); camLook.set(S.x + fx * 3, S.y + 0.8, S.z + fz * 3); }
  else if (camMode === 1) { camPos.set(S.x + fx * 0.2, S.y + 1.25, S.z + fz * 0.2); camLook.set(S.x + fx * 10, S.y + 1.0, S.z + fz * 10); }
  else { camPos.set(S.x - fx * 0.01, S.y + 120, S.z - fz * 0.01); camLook.set(S.x, S.y, S.z); } // (overhead, for checking the map: drive.cam(2))
  cam.position.copy(camPos); cam.lookAt(camLook);
  sun.position.set(S.x - 70, S.y + 60, S.z - 50); sun.target.position.set(S.x, S.y, S.z);
  sky.position.copy(cam.position);
  if (tilesOn) { city.update(S.x, S.z); if (people) people.update(S.x, S.z); if (traffic) { const [ox, oy] = city.origin; traffic.update(dt, S.x + ox, oy - S.z, ox, oy, S); } }
  // HUD: speed, SP, the round minimap
  const kmh = Math.round(Math.abs(r.vf) * 3.6);
  $('kmh').textContent = kmh; $('gear').textContent = r.vf < -0.2 ? 'R' : kmh < 3 ? 'N' : Math.min(6, 1 + Math.floor(kmh / 38));
  $('sp-fill').style.width = `${(SP.v / SP.max) * 100}%`; $('sp-text').textContent = `${Math.round(SP.v)}/${SP.max}`; $('sp').classList.toggle('on', !!r.boost);
  const mm = $('mini'); const g = mm.getContext('2d');
  if (tilesOn) city.drawMinimap(g, S.x, S.z, S.h, mm.width, 260, TRACK);
  else { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, mm.width, mm.height); }
  $('mini-n').style.transform = `rotate(${(-S.h * 180) / Math.PI + 180}deg)`;
  $('lap-n').textContent = LOOP ? `${lap.n}${LAPS ? `/${LAPS}` : ''}` : lap.done ? 'ถึงเส้นชัย' : '-';
  $('lap-t').textContent = lap.done ? fmt(lap.time) : lap.started ? fmt(now - lap.t0) : '0:00.00'; $('lap-best').textContent = Number.isFinite(lap.best) ? fmt(lap.best) : '-';
  renderer.render(scene, cam);
  requestAnimationFrame(frame);
}

(async () => {
  buildPractice();
  CITY = await loadCity().catch(() => null);
  if (CITY && CITY.look) {
    gameSky(CITY.look);
    city = createCity(scene, CITY); await city.load();
  }
  if (CITY) {
    const sel = $('track'); const groups = {};
    if (city && city.count) { const o = document.createElement('option'); o.value = 'city'; o.textContent = '🏙️ ขับเล่นในเมือง (โซล)'; sel.prepend(o); sel.value = 'city'; buildFree(); }
    CITY.tracks.forEach((t, i) => {
      const r = REGION[t.region] ? t.region : 'other';
      if (!groups[r]) { groups[r] = document.createElement('optgroup'); groups[r].label = REGION[r] || 'อื่น ๆ (ไม่มีแผนที่ถนน)'; }
      const o = document.createElement('option'); o.value = i; o.textContent = `${t.name}${t.length ? ` · ${(t.length / 1000).toFixed(1)} กม.` : ''}${t.loop ? ' · วง' : ''}${t.hidden ? ' · (ซ่อน)' : ''}`; groups[r].append(o);
    });
    for (const r of ['kr', 'n1', 'other']) if (groups[r]) sel.append(groups[r]);
    sel.addEventListener('change', () => { if (sel.value === 'practice') buildPractice(); else if (sel.value === 'city') buildFree(); else buildCity(CITY.tracks[+sel.value]); reset(); camPos.set(S.x, S.y + 3, S.z - 8); sel.blur(); });
  }
  GARAGE = await loadGarage().catch(() => null);
  const first = GARAGE && (GARAGE.cars.find((c) => c.name === 'escarabajo') || GARAGE.cars[0]);
  if (first) {
    const pick = $('car-pick');
    GARAGE.cars.forEach((c, i) => { const o = document.createElement('option'); o.value = i; o.textContent = c.name + (c.spec.BD_Mass ? ` · ${c.spec.BD_Mass} กก.` : ''); pick.append(o); });
    pick.value = GARAGE.cars.indexOf(first); pick.hidden = false;
    pick.addEventListener('change', async () => { await loadGameCar(GARAGE.cars[+pick.value]); pick.blur(); });
    await loadGameCar(first);
  } else { const esc = await escarabajo(); if (esc) await loadCar(esc, 'Escarabajo (ในตัว)'); }
  // traffic on the Seoul lanes, in the game's cars
  if (GARAGE && city && city.count) people = createPeople(scene, GARAGE, city);
  if (GARAGE && city && city.count && CITY.roads.kr) traffic = createTraffic(scene, GARAGE, CITY.roads.kr.map((l) => unpack(l)), wheelMaker(0.31));
  // the game's paints for the three colours
  $('btn-paint').addEventListener('click', (e) => {
    const P = GARAGE && GARAGE.paints.length ? GARAGE.paints : ['#e8e8e8', '#2a6bd8', '#d63a2f', '#111111', '#f2c230'];
    for (const id of ['c1', 'c2', 'c3']) $(id).value = P[Math.floor(Math.random() * P.length)];
    repaint(); e.currentTarget.blur();
  });
  reset(); camPos.set(S.x, S.y + 3, S.z - 8);
  requestAnimationFrame(frame);
  window.drive = { S, keys, lap, car, cam: (m) => { camMode = m; }, city: () => city, traffic: () => traffic, SP, get track() { return { pts: TRACK, loop: LOOP, seg: lastSeg } } };
})();
