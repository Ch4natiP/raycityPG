import * as THREE from 'three';
import { GeoBuilder } from './geo.js';
import { Colliders } from './physics.js';
import { RoadNet } from './roadnet.js';
import { BTS_Y, rng } from './config.js';
import { windowTexture, shopTexture, glassTexture, asphaltTexture, paveTexture, poolTexture, signAtlas, labelTexture, SIGN_TEXTS } from './textures.js';
import { makePerson, pose } from './models.js';
import { crowdMeshes, CROWD_KINDS } from './character.js';

// Real streets: builds the city from the file made by tools/osm-import.mjs (OpenStreetMap data).
// Returns the same interface as buildCity() in city.js, so the rest of the game does not care which it is.
const C = (s) => new THREE.Color(s);
const UP = new THREE.Vector3(0, 1, 0);
const WALLS = ['#f2e3c6', '#e8d5b0', '#d9e4dd', '#f5c6a5', '#c9d6df', '#f7f1e3', '#e3c1a8', '#bfd8b8', '#e8a87c', '#d4e7f2', '#ffffff', '#cfc6b4', '#bdb39f'];
const ROOFS = ['#8d8d8d', '#a0522d', '#7f8c8d', '#6d6d6d', '#9b5e3c', '#b0b0b0'];
const TOWER_TINTS = ['#ffffff', '#dfe9f3', '#e8f3ec', '#f3eadf', '#e2e2e2'];
const ROAD_Y = 0.05;

export function buildOSMCity(scene, data, { shadows = true } = {}) {
  const R = rng(1314);
  const pick = (a) => a[Math.floor(R() * a.length)];
  const name = (k) => (k >= 0 ? data.names[k] : '');
  const col = new Colliders();
  const pois = [];
  const stands = [];
  const labels = [];
  const people = [];
  const npcs = []; // people you can talk to on foot
  const extras = []; // street crowd (instanced)

  // ---- road graph ----
  const net = new RoadNet();
  const nodes = data.nodes.map(([x, z, sig]) => net.addNode(x, z, { signal: !!sig }));
  for (const [a, b, w, oneway, main, nmk, lanes, median, flatPts] of data.edges) {
    const pts = [];
    for (let k = 0; k < flatPts.length; k += 2) pts.push({ x: flatPts[k], z: flatPts[k + 1] });
    net.addEdge(nodes[a], nodes[b], pts, { width: w, lanes, oneway, main: !!main, name: name(nmk), median });
  }
  net.finalize();
  // busy junctions without mapped signals still get them (main road meets main road)
  for (const n of net.nodes) if (!n.signal && n.edges.length >= 3 && n.edges.filter((id) => net.edges[id].main).length >= 3) n.signal = true;

  let bx0 = Infinity; let bz0 = Infinity; let bx1 = -Infinity; let bz1 = -Infinity;
  for (const n of net.nodes) { bx0 = Math.min(bx0, n.x); bz0 = Math.min(bz0, n.z); bx1 = Math.max(bx1, n.x); bz1 = Math.max(bz1, n.z); }
  const bounds = { x0: bx0 - 120, z0: bz0 - 120, x1: bx1 + 120, z1: bz1 + 120 };

  // ---- materials (same look as the grid city) ----
  const atlas = signAtlas();
  const pairMat = ({ map, emissive }) => ({ map, emissiveMap: emissive, emissive: 0xffffff, emissiveIntensity: 0 });
  const offs = () => Math.floor(R() * 4) * 0.25;
  const asphalt = asphaltTexture(R);
  const M = {
    wall: new THREE.MeshLambertMaterial({ ...pairMat(windowTexture(R)), vertexColors: true }),
    shop: new THREE.MeshLambertMaterial({ ...pairMat(shopTexture()), vertexColors: true }),
    glass: new THREE.MeshStandardMaterial({ ...pairMat(glassTexture(R)), vertexColors: true, metalness: 0.55, roughness: 0.18, envMapIntensity: 1.2 }),
    plain: new THREE.MeshLambertMaterial({ vertexColors: true }),
    awning: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    sign: new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true }),
    road: new THREE.MeshLambertMaterial({ map: asphalt, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    mark: new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    area: new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -0.5, polygonOffsetUnits: -0.5 }),
  };
  const chunks = new Map();
  const B = (kind, x, z) => {
    const k = `${kind}:${Math.floor(x / 250)}:${Math.floor(z / 250)}`;
    if (!chunks.has(k)) chunks.set(k, { kind, b: new GeoBuilder() });
    return chunks.get(k).b;
  };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  // ground: pavement everywhere, roads drawn on top
  const pave = paveTexture(R);
  const gw = bounds.x1 - bounds.x0 + 1200; const gd = bounds.z1 - bounds.z0 + 1200;
  pave.repeat.set(gw / 2.4, gd / 2.4);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(gw, gd), new THREE.MeshLambertMaterial({ map: pave, color: 0xcfcac0 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((bounds.x0 + bounds.x1) / 2, 0, (bounds.z0 + bounds.z1) / 2);
  ground.receiveShadow = true;
  scene.add(ground);

  // flat polygon on the ground (parks, water, junction patches)
  const fillPoly = (kind, pts, y, color, uvScale = 0) => {
    if (pts.length < 3) return;
    const contour = pts.map((p) => new THREE.Vector2(p.x, p.z));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const b = B(kind, pts[0].x, pts[0].z);
    const cc = C(color);
    for (const [i, j, k] of tris) {
      const a = pts[i]; const c2 = pts[j]; const d = pts[k];
      addTri(b, V(a.x, y, a.z), V(c2.x, y, c2.z), V(d.x, y, d.z), cc, uvScale);
    }
  };
  const ptsOf = (flat) => { const out = []; for (let k = 0; k < flat.length; k += 2) out.push({ x: flat[k], z: flat[k + 1] }); return out; };

  // ---- parks and water ----
  const mapPolys = [];
  for (const g of data.green) { const pts = ptsOf(g); fillPoly('area', pts, 0.02, '#5d9b4a'); mapPolys.push({ color: '#9fcf86', pts }); }
  for (const w of data.water) { const pts = ptsOf(w); fillPoly('area', pts, 0.025, '#4f8fa8'); mapPolys.push({ color: '#79b4cc', pts }); for (let k = 0; k < pts.length; k++) { const a = pts[k]; const b = pts[(k + 1) % pts.length]; col.addSeg(a.x, a.z, b.x, b.z, 'water'); } }
  for (const c of data.canals) { const pts = ptsOf(c); ribbon('area', pts, 9, 0.025, '#4f8fa8', 0); }

  // ---- roads: asphalt ribbons, junction patches, markings, medians ----
  function ribbon(kind, pts, width, y, color, uvScale, trimA = 0, trimB = 0) {
    const P = trim(pts, trimA, trimB);
    if (P.length < 2) return;
    const b = B(kind, P[0].x, P[0].z);
    const cc = C(color);
    const L = []; const Rr = [];
    for (let k = 0; k < P.length; k++) {
      const p = P[k];
      const a = P[Math.max(0, k - 1)]; const c2 = P[Math.min(P.length - 1, k + 1)];
      let dx = c2.x - a.x; let dz = c2.z - a.z;
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const lx = dz; const lz = -dx; // left of travel
      L.push(V(p.x + lx * width / 2, y, p.z + lz * width / 2));
      Rr.push(V(p.x - lx * width / 2, y, p.z - lz * width / 2));
    }
    for (let k = 0; k < P.length - 1; k++) {
      const a = Rr[k]; const bb = Rr[k + 1]; const c2 = L[k + 1]; const d = L[k];
      // CCW seen from above (normal up): right-a → right-b → left-b → left-a
      quadUp(b, a, bb, c2, d, cc, uvScale);
    }
  }
  function trim(pts, a, b) {
    // cut `a` metres off the start and `b` off the end of a polyline
    const cum = [0];
    for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z));
    const L = cum[cum.length - 1];
    if (L - a - b < 0.5) return [];
    const at = (t) => { let k = 0; while (k < pts.length - 2 && cum[k + 1] < t) k++; const f = (t - cum[k]) / (cum[k + 1] - cum[k] || 1); return { x: pts[k].x + (pts[k + 1].x - pts[k].x) * f, z: pts[k].z + (pts[k + 1].z - pts[k].z) * f }; };
    const out = [at(a)];
    for (let k = 1; k < pts.length - 1; k++) if (cum[k] > a && cum[k] < L - b) out.push(pts[k]);
    out.push(at(L - b));
    return out;
  }
  // offset a polyline sideways (left of a→b positive)
  function offsetLine(pts, off) {
    return pts.map((p, k) => {
      const a = pts[Math.max(0, k - 1)]; const c2 = pts[Math.min(pts.length - 1, k + 1)];
      let dx = c2.x - a.x; let dz = c2.z - a.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      return { x: p.x + dz * off, z: p.z - dx * off };
    });
  }
  function dashed(pts, width, y, color, dash, gap) {
    const cum = [0];
    for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z));
    const L = cum[cum.length - 1];
    for (let t = 0; t < L - 0.5; t += dash + gap) ribbon('mark', pts, width, y, color, 0, t, Math.max(0, L - t - dash));
  }

  const white = '#e9e9e9'; const yellow = '#f2c230';
  for (const e of net.edges) {
    const nA = net.nodes[e.a]; const nB = net.nodes[e.b];
    ribbon('road', e.pts, e.width, ROAD_Y, '#d8d8d8', 8);
    const ta = nA.edges.length >= 3 ? nA.r + 1 : 0;
    const tb = nB.edges.length >= 3 ? nB.r + 1 : 0;
    const P = trim(e.pts, ta, tb);
    if (P.length < 2) continue;
    // kerb-side edge lines
    ribbon('mark', offsetLine(P, e.width / 2 - 0.35), 0.12, ROAD_Y + 0.01, white, 0);
    ribbon('mark', offsetLine(P, -(e.width / 2 - 0.35)), 0.12, ROAD_Y + 0.01, white, 0);
    if (e.median) {
      // raised median with shrubs; it is solid
      ribbon('plain', P, e.median, 0.3, '#5e8f3e', 0);
      const left = offsetLine(P, e.median / 2); const right = offsetLine(P, -e.median / 2);
      for (let k = 0; k < P.length - 1; k++) { col.addSeg(left[k].x, left[k].z, left[k + 1].x, left[k + 1].z, 'median'); col.addSeg(right[k].x, right[k].z, right[k + 1].x, right[k + 1].z, 'median'); }
    } else if (!e.oneway) {
      if (e.main || e.width > 9) { ribbon('mark', offsetLine(P, 0.12), 0.1, ROAD_Y + 0.01, yellow, 0); ribbon('mark', offsetLine(P, -0.12), 0.1, ROAD_Y + 0.01, yellow, 0); }
      else dashed(P, 0.12, ROAD_Y + 0.01, white, 3, 5);
    }
    // lane dividers
    const lanes = e.lanes;
    for (let k = 0; k < lanes.length - 1; k++) {
      const mid = (lanes[k] + lanes[k + 1]) / 2;
      dashed(offsetLine(P, mid), 0.12, ROAD_Y + 0.01, white, 3, 6);
      if (!e.oneway) dashed(offsetLine(P, -mid), 0.12, ROAD_Y + 0.01, white, 3, 6);
    }
    // zebra crossings at signalled junctions
    for (const [n, atStart] of [[nA, true], [nB, false]]) {
      if (!n.signal) continue;
      const stop = n.stop.get(e.id);
      const len = e.len;
      const p = net.at(e, true, atStart ? stop + 1.5 : len - stop - 1.5);
      for (let o = -e.width / 2 + 0.8; o < e.width / 2 - 0.8; o += 1.2) {
        const cx = p.x + p.tz * (o + 0.3); const cz = p.z - p.tx * (o + 0.3);
        const a = { x: cx - p.tx * 1.5, z: cz - p.tz * 1.5 }; const b = { x: cx + p.tx * 1.5, z: cz + p.tz * 1.5 };
        ribbon('mark', [a, b], 0.6, ROAD_Y + 0.012, white, 0);
      }
    }
  }
  // junction patches: a disc of asphalt where roads meet
  for (const n of net.nodes) {
    if (n.edges.length < 2) continue;
    const r = Math.max(...n.edges.map((id) => net.edges[id].width)) / 2 + 0.6;
    const pts = [];
    for (let k = 0; k < 20; k++) pts.push({ x: n.x + Math.cos((k / 20) * Math.PI * 2) * r, z: n.z + Math.sin((k / 20) * Math.PI * 2) * r });
    fillPoly('road', pts, ROAD_Y - 0.002, '#d8d8d8', 8);
  }

  // what is road (for the "riding on the pavement" rule)
  const onRoad = (x, z) => {
    const near = net.nearest(x, z, 40);
    if (!near) return false;
    if (near.dist < near.e.width / 2 + 0.4) return true;
    for (const id of [near.e.a, near.e.b]) { const n = net.nodes[id]; if (Math.hypot(x - n.x, z - n.z) < n.r + 0.5) return true; }
    return false;
  };

  // ---- buildings ----
  let built = 0;
  for (const bld of data.buildings) {
    const [h0, kind, ...flatPts] = bld;
    const pts = ptsOf(flatPts);
    if (pts.length < 3) continue;
    let cx = 0; let cz = 0;
    for (const p of pts) { cx += p.x; cz += p.z; }
    cx /= pts.length; cz /= pts.length;
    let A = 0;
    for (let k = 0; k < pts.length; k++) { const a = pts[k]; const b = pts[(k + 1) % pts.length]; A += a.x * b.z - b.x * a.z; }
    A = Math.abs(A) / 2;
    // height: from the map, else a guess from the footprint (Bangkok: low shophouses, a few towers)
    let h = h0;
    if (!h) {
      if (kind === 4) h = 9 + R() * 4;
      else if (kind === 5) h = 6 + R() * 3;
      else if (A < 150) h = 3.5 + (2 + Math.floor(R() * 3)) * 3.3;
      else if (A < 700) h = 10 + R() * 14;
      else if (A < 2500) h = 14 + R() * 30;
      else h = 18 + R() * 50;
    }
    const tall = h >= 30;
    const low = h < 24 && A < 900;
    const wall = C(tall ? pick(TOWER_TINTS) : kind === 4 ? '#f4f1ea' : pick(WALLS));
    const roof = C(kind === 4 ? '#d35400' : pick(ROOFS));
    const uo = offs(); const vo = offs();
    // outward normal check: polygon centroid on the inside
    for (let k = 0; k < pts.length; k++) {
      const p0 = pts[k]; const p1 = pts[(k + 1) % pts.length];
      const dx = p1.x - p0.x; const dz = p1.z - p0.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.3) continue;
      let nx = dz / len; let nz = -dx / len;
      if ((p0.x + p1.x) / 2 * nx + (p0.z + p1.z) / 2 * nz - (cx * nx + cz * nz) < 0) { nx = -nx; nz = -nz; }
      // wall quad facing (nx, nz)
      const facing = (a, b, y0, y1, kindW, color, tile, u0, v0) => {
        // order so that (b-a) x up points outward
        const ax = a.x; const az = a.z; const bx2 = b.x; const bz2 = b.z;
        const outward = (-(bz2 - az)) * nx + ((bx2 - ax)) * nz; // (b-a) x up = (-dz, 0, dx)
        const [s0, s1] = outward > 0 ? [a, b] : [b, a];
        const L2 = Math.hypot(b.x - a.x, b.z - a.z);
        const uv = tile ? [u0, v0, u0 + L2 / tile[0], v0 + (y1 - y0) / tile[1]] : [0, 0, 1, 1];
        B(kindW, cx, cz).quad(V(s0.x, y0, s0.z), V(s1.x, y0, s1.z), V(s1.x, y1, s1.z), V(s0.x, y1, s0.z), color, uv);
      };
      if (low) {
        facing(p0, p1, 0, 3.5, 'shop', [C('#c8c8c8'), C('#c8c8c8'), C('#ffffff'), C('#ffffff')], [8, 3.3], uo + (k % 2) * 0.5, 0);
        facing(p0, p1, 3.5, h, 'wall', wall, [16, 13.6], uo, vo);
      } else {
        facing(p0, p1, 0, h, tall ? 'glass' : 'wall', [wall.clone().multiplyScalar(0.7), wall.clone().multiplyScalar(0.7), wall, wall], tall ? [12, 14] : [16, 13.6], uo, vo);
      }
      // shop sign + awning on walls that face a street
      if (low && len > 3.2 && len < 40) {
        const mx = (p0.x + p1.x) / 2 + nx * 4; const mz = (p0.z + p1.z) / 2 + nz * 4;
        const near = net.nearest(mx, mz, 30);
        if (near && near.dist < near.e.width / 2 + 9) {
          const w = Math.min(len - 0.6, 7);
          const midx = (p0.x + p1.x) / 2 + nx * 0.06; const midz = (p0.z + p1.z) / 2 + nz * 0.06;
          const ux = dx / len; const uz = dz / len;
          const a = { x: midx - ux * w / 2, z: midz - uz * w / 2 }; const b = { x: midx + ux * w / 2, z: midz + uz * w / 2 };
          const r = Math.floor(R() * SIGN_TEXTS.length);
          const outward = (-(b.z - a.z)) * nx + (b.x - a.x) * nz;
          const [s0, s1] = outward > 0 ? [a, b] : [b, a];
          B('sign', cx, cz).quad(V(s0.x, 3.7, s0.z), V(s1.x, 3.7, s1.z), V(s1.x, 4.5, s1.z), V(s0.x, 4.5, s0.z), C('#ffffff'), [0, 1 - (r + 1) / atlas.rows, 1, 1 - r / atlas.rows]);
          const aw = C(pick(['#e74c3c', '#2e86de', '#27ae60', '#f39c12', '#8e44ad', '#16a085', '#d35400']));
          B('awning', cx, cz).quad(V(s0.x + nx * 1.6, 2.95, s0.z + nz * 1.6), V(s1.x + nx * 1.6, 2.95, s1.z + nz * 1.6), V(s1.x, 3.45, s1.z), V(s0.x, 3.45, s0.z), aw);
          if (R() < 0.08) pois.push({ name: `ร้าน${SIGN_TEXTS[r].replace(/^ร้าน/, '')}`, x: near.x, z: near.z, landmark: false, shop: true });
          // people in front of the shops: customers, passers-by, a vendor now and then
          if (R() < 0.14) {
            const ex = midx + nx * (0.9 + R() * 0.8); const ez = midz + nz * (0.9 + R() * 0.8);
            if (!col.inside(ex, ez)) {
              const vendor = R() < 0.2;
              extras.push({ arch: Math.floor(R() * CROWD_KINDS), pose: R() < 0.3 ? 'talk' : 'stand', x: ex, y: 0, z: ez, rot: Math.atan2(nx, nz) + (R() - 0.5) * 2 });
              npcs.push(vendor ? { kind: 'vendor', v: Math.floor(R() * 8), x: ex, z: ez } : { kind: 'local', x: ex, z: ez });
            }
          }
        }
      }
    }
    // roof
    const contour = pts.map((p) => new THREE.Vector2(p.x, p.z));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const [i, j, k] of tris) addTri(B('plain', cx, cz), V(pts[i].x, h, pts[i].z), V(pts[j].x, h, pts[j].z), V(pts[k].x, h, pts[k].z), roof, 0);
    if (!tall && A > 40 && R() < 0.3) B('plain', cx, cz).box(cx - 0.8, h, cz - 0.8, cx + 0.8, h + 1.6, cz + 0.8, C(pick(['#d0d0d0', '#2e86de', '#c0392b'])));
    col.addPoly(pts);
    mapPolys.push({ color: tall ? '#b9c4cf' : '#cfc6b6', pts });
    built++;
  }

  // ---- street lamps along the roads, power poles + wires down the sois ----
  const lampSpots = [];
  const poleRuns = [];
  for (const e of net.edges) {
    if (e.len < 25) continue;
    const step = e.main ? 32 : 28;
    const sides = e.main ? [1, -1] : [1];
    for (const side of sides) {
      const run = [];
      for (let t = 10; t < e.len - 8; t += step) {
        const p = net.at(e, true, t);
        const off = side * (e.width / 2 + 0.7);
        const x = p.x + p.tz * off; const z = p.z - p.tx * off;
        if (col.inside(x, z)) continue;
        const spot = { x, z, dx: -p.tz * side, dz: p.tx * side };
        if (e.main) lampSpots.push(spot); else run.push(spot);
        col.add(x - 0.15, z - 0.15, x + 0.15, z + 0.15, 'pole');
      }
      if (run.length) { poleRuns.push(run); lampSpots.push(...run.filter((_, k) => k % 2 === 0)); }
    }
  }
  const m4 = new THREE.Matrix4();
  let lampMat; let poolMat;
  {
    const poles = [...lampSpots, ...poleRuns.flat().filter((p) => !lampSpots.includes(p))];
    const pg = new THREE.CylinderGeometry(0.12, 0.17, 9, 6).translate(0, 4.5, 0);
    const im = new THREE.InstancedMesh(pg, new THREE.MeshLambertMaterial({ color: 0x8c8c8c }), Math.max(1, poles.length));
    poles.forEach((p, k) => { m4.makeTranslation(p.x, 0, p.z); im.setMatrixAt(k, m4); });
    im.castShadow = true;
    scene.add(im);
    const armG = new THREE.BoxGeometry(0.08, 0.08, 2.2).translate(0, 0, 1.1);
    const headG = new THREE.BoxGeometry(0.35, 0.14, 0.7);
    const n = Math.max(1, lampSpots.length);
    const arm = new THREE.InstancedMesh(armG, new THREE.MeshLambertMaterial({ color: 0x6f6f6f }), n);
    lampMat = new THREE.MeshLambertMaterial({ color: 0x9a9a9a, emissive: 0xffc27a, emissiveIntensity: 0 });
    const head = new THREE.InstancedMesh(headG, lampMat, n);
    poolMat = new THREE.MeshBasicMaterial({ map: poolTexture(), color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const pool = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), poolMat, n);
    const q = new THREE.Quaternion(); const sc = new THREE.Vector3(1, 1, 1); const pos = new THREE.Vector3(); const c4 = new THREE.Color();
    lampSpots.forEach((p, k) => {
      q.setFromAxisAngle(UP, Math.atan2(p.dx, p.dz));
      m4.compose(pos.set(p.x, 8.0, p.z), q, sc.set(1, 1, 1)); arm.setMatrixAt(k, m4);
      m4.compose(pos.set(p.x + p.dx * 2.2, 7.95, p.z + p.dz * 2.2), q, sc); head.setMatrixAt(k, m4);
      m4.compose(pos.set(p.x + p.dx * 3.5, ROAD_Y + 0.02, p.z + p.dz * 3.5), q, sc.set(14, 1, 14)); pool.setMatrixAt(k, m4);
      pool.setColorAt(k, R() < 0.6 ? c4.set(0xffa860) : c4.set(0xe9efff));
    });
    scene.add(arm, head, pool);
    // tangled overhead wires between the soi poles
    const wp = [];
    for (const run of poleRuns) for (let k = 0; k < run.length - 1; k++) {
      const a = run[k]; const b = run[k + 1];
      for (let w = 0; w < 4; w++) {
        const h0 = 6.6 + w * 0.4; const sag = 0.6 + R() * 1.2; let prev = null;
        for (let t = 0; t <= 6; t++) { const f = t / 6; const p = [a.x + (b.x - a.x) * f, h0 - sag * 4 * f * (1 - f), a.z + (b.z - a.z) * f]; if (prev) wp.push(...prev, ...p); prev = p; }
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
    scene.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x1a1a1a })));
  }

  // ---- trees along main roads ----
  for (const e of net.edges) {
    if (!e.main || e.len < 30) continue;
    for (let t = 16; t < e.len - 10; t += 22) {
      const p = net.at(e, true, t);
      for (const side of [1, -1]) {
        const off = side * (e.width / 2 + 2.2);
        const x = p.x + p.tz * off; const z = p.z - p.tx * off;
        if (col.inside(x, z) || R() < 0.4) continue;
        const tr = new THREE.CylinderGeometry(0.18, 0.25, 3, 6).translate(x, 1.5, z);
        B('plain', x, z).addGeometry(tr, C('#6b4f35'));
        const cn = new THREE.IcosahedronGeometry(2.2, 0).translate(x, 4, z);
        B('plain', x, z).addGeometry(cn, C(pick(['#2f7d32', '#3e8e41', '#4caf50', '#2e6b30'])));
        col.add(x - 0.3, z - 0.3, x + 0.3, z + 0.3, 'tree');
      }
    }
  }

  // ---- BTS viaduct, stations and a train ----
  const railLines = data.rail.map(([nmk, ...f]) => ({ name: name(nmk), pts: ptsOf(f) })).filter((r) => r.pts.length >= 2);
  for (const line of railLines) {
    for (let k = 0; k < line.pts.length - 1; k++) {
      const a = line.pts[k]; const b = line.pts[k + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.5) continue;
      const ang = Math.atan2(b.x - a.x, b.z - a.z);
      B('plain', a.x, a.z).rotBox((a.x + b.x) / 2, BTS_Y + 0.55, (a.z + b.z) / 2, 5.2, 1.1, len + 0.3, ang, C('#d6d6d6'));
    }
    // pillars every ~25 m along the line
    let acc = 0;
    for (let k = 0; k < line.pts.length - 1; k++) {
      const a = line.pts[k]; const b = line.pts[k + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      for (; acc < len; acc += 25) {
        const x = a.x + (b.x - a.x) * (acc / len); const z = a.z + (b.z - a.z) * (acc / len);
        B('plain', x, z).box(x - 0.8, 0, z - 0.8, x + 0.8, BTS_Y, z + 0.8, C('#cfcfcf'));
        col.add(x - 0.8, z - 0.8, x + 0.8, z + 0.8, 'pillar');
      }
      acc -= len;
    }
  }
  const nearestRail = (x, z) => {
    let best = null;
    for (const line of railLines) for (let k = 0; k < line.pts.length - 1; k++) {
      const a = line.pts[k]; const b = line.pts[k + 1];
      const dx = b.x - a.x; const dz = b.z - a.z; const l2 = dx * dx + dz * dz || 1;
      const f = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
      const px = a.x + dx * f; const pz = a.z + dz * f; const d = Math.hypot(x - px, z - pz);
      if (!best || d < best.d) best = { d, x: px, z: pz, ang: Math.atan2(dx, dz) };
    }
    return best;
  };
  for (const [x, z, nmk, sys] of data.stations) {
    const nmStation = name(nmk);
    const near = sys === 'BTS' ? nearestRail(x, z) : null;
    if (near && near.d < 60) {
      B('plain', near.x, near.z).rotBox(near.x, BTS_Y + 0.3, near.z, 22, 1.4, 70, near.ang, C('#dcdcdc'));
      B('plain', near.x, near.z).rotBox(near.x, BTS_Y + 6.5, near.z, 24, 0.6, 70, near.ang, C('#7fa7b5'));
      labels.push({ text: `BTS ${nmStation.replace(/^(สถานี|BTS)\s*/, '')}`, x: near.x, y: BTS_Y + 10, z: near.z, bg: '#0b6e4f' });
    }
    const road = net.nearest(x, z, 80);
    if (road) pois.push({ name: `${sys === 'MRT' ? 'MRT' : sys === 'BTS' ? 'BTS' : 'สถานี'} ${nmStation.replace(/^(สถานี|BTS|MRT)\s*/, '')}`, x: road.x, z: road.z, landmark: true, station: true });
  }
  const train = new THREE.Group();
  const mainLine = railLines.slice().sort((a, b) => b.pts.length - a.pts.length)[0];
  if (mainLine) {
    for (let k = 0; k < 4; k++) {
      const car = new THREE.Mesh(new THREE.BoxGeometry(3, 3.4, 19.5), new THREE.MeshLambertMaterial({ color: 0xf4f4f4 }));
      car.position.z = -k * 20;
      car.castShadow = true;
      train.add(car);
    }
    scene.add(train);
  }
  const trainWin = new THREE.MeshLambertMaterial({ color: 0x2b3a4a, emissive: 0xe8f0ff, emissiveIntensity: 0 });
  train.children.forEach((car) => { const w = new THREE.Mesh(new THREE.BoxGeometry(3.06, 1.1, 18), trainWin); w.position.y = 0.6; car.add(w); });
  const trainState = { t: 0, dir: 1, wait: 0 };
  const lineLen = mainLine ? mainLine.pts.reduce((s, p, k) => (k ? s + Math.hypot(p.x - mainLine.pts[k - 1].x, p.z - mainLine.pts[k - 1].z) : 0), 0) : 0;
  function updateTrain(dt) {
    if (!mainLine) return;
    if (trainState.wait > 0) { trainState.wait -= dt; return; }
    trainState.t += trainState.dir * 16 * dt;
    if (trainState.t > lineLen) { trainState.t = lineLen; trainState.dir = -1; trainState.wait = 8; }
    if (trainState.t < 0) { trainState.t = 0; trainState.dir = 1; trainState.wait = 8; }
    let t = trainState.t; let k = 0;
    while (k < mainLine.pts.length - 2) { const l = Math.hypot(mainLine.pts[k + 1].x - mainLine.pts[k].x, mainLine.pts[k + 1].z - mainLine.pts[k].z); if (t <= l) break; t -= l; k++; }
    const a = mainLine.pts[k]; const b = mainLine.pts[k + 1];
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    train.position.set(a.x + (b.x - a.x) * (t / l), BTS_Y + 3, a.z + (b.z - a.z) * (t / l));
    train.rotation.y = Math.atan2(b.x - a.x, b.z - a.z) + (trainState.dir < 0 ? Math.PI : 0);
  }

  // ---- places to drive to ----
  for (const [x, z, nmk, landmark] of data.pois) {
    const near = net.nearest(x, z, 80);
    if (!near) continue;
    // stop at the kerb on the side of the road the place is on
    const side = Math.sign((x - near.x) * near.tz - (z - near.z) * near.tx) || 1;
    const off = side * (near.e.width / 2 - 1.2);
    pois.push({ name: name(nmk), x: near.x + near.tz * off, z: near.z - near.tx * off, landmark: !!landmark });
    if (landmark) labels.push({ text: name(nmk), x, y: 28, z, bg: '#7f6a3a' });
  }
  // de-duplicate: one point per name within 25 m
  for (let k = pois.length - 1; k >= 0; k--) if (pois.slice(0, k).some((q) => q.name === pois[k].name && Math.hypot(q.x - pois[k].x, q.z - pois[k].z) < 25)) pois.splice(k, 1);

  // ---- win stands: at the busiest corners, near BTS stations first ----
  const standAt = pois.filter((p) => p.station).concat(net.nodes.filter((n) => n.signal).map((n) => ({ x: n.x, z: n.z, name: '' })));
  for (const sp of standAt) {
    if (stands.length >= 6) break;
    if (stands.some((s) => Math.hypot(s.x - sp.x, s.z - sp.z) < 250)) continue;
    const near = net.nearest(sp.x + 15, sp.z + 15, 60);
    if (!near || near.e.len < 30) continue;
    const t = Math.max(8, Math.min(near.e.len - 8, near.t));
    const p = net.at(near.e, true, t);
    const off = near.e.width / 2 + 1.8;
    const x = p.x + p.tz * off; const z = p.z - p.tx * off;
    if (col.inside(x, z)) continue;
    const ang = Math.atan2(p.tx, p.tz);
    const b = B('plain', x, z);
    b.rotBox(x, 2.8, z, 3, 0.2, 5.2, ang, C('#ff7a00'));
    b.rotBox(x - p.tz * 0.3, 0.45, z + p.tx * 0.3, 0.5, 0.45, 4, ang, C('#6b4f35'));
    col.add(x - 1.4, z - 1.4, x + 1.4, z + 1.4, 'stand');
    const nameStand = `วิน${sp.name ? sp.name.replace(/^(BTS|MRT|สถานี)\s*/, '') : (near.e.name || 'ปากซอย').replace(/^ถ(นน|\.)\s*/, '')}`;
    for (let k = 0; k < 2; k++) {
      const number = stands.length * 2 + k + 1;
      const v = makePerson(R, { vest: number });
      pose(v, 'sit');
      v.position.set(x + p.tx * (k - 0.5) * 2, 0, z + p.tz * (k - 0.5) * 2);
      v.rotation.y = ang - Math.PI / 2;
      scene.add(v);
      npcs.push({ kind: 'win', number, x: v.position.x, z: v.position.z, person: v });
    }
    const sx = p.x + p.tz * (near.e.width / 2 - 1.5); const sz = p.z - p.tx * (near.e.width / 2 - 1.5);
    stands.push({ name: nameStand, x: sx, z: sz, sx: x, sz: z });
    labels.push({ text: `🛵 ${nameStand}`, x, y: 6, z, bg: '#ff7a00', fg: '#111', small: true });
    pois.push({ name: nameStand, x: sx, z: sz, landmark: true });
  }

  // ---- finish meshes and labels ----
  for (const m of crowdMeshes(extras, shadows)) scene.add(m);
  for (const { kind, b } of chunks.values()) {
    if (b.empty) continue;
    scene.add(b.mesh(M[kind], { cast: shadows && (kind === 'wall' || kind === 'glass' || kind === 'shop' || kind === 'plain'), receive: true }));
  }
  for (const l of labels) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(l.text, { bg: l.bg || '#222', fg: l.fg || '#fff', w: 512, h: 112, font: 54 }), depthWrite: false, fog: false }));
    s.position.set(l.x, l.y, l.z);
    const k = l.small ? 5 : 11;
    s.scale.set(k, k * 112 / 512, 1);
    s.renderOrder = 5;
    scene.add(s);
  }

  // ---- queries the game uses ----
  const places = data.places.map(([x, z, nmk]) => ({ name: name(nmk), x, z })).filter((p) => p.name);
  const districtOf = (x, z) => {
    let best = null;
    for (const p of places) { const d = Math.hypot(p.x - x, p.z - z); if (!best || d < best.d) best = { d, name: p.name }; }
    return best ? best.name : 'กรุงเทพฯ';
  };
  function setNight(n) {
    const dusk = Math.min(1, n * 1.6);
    M.wall.emissiveIntensity = dusk * 0.7;
    M.shop.emissiveIntensity = dusk * 0.85;
    M.glass.emissiveIntensity = dusk * 0.5;
    lampMat.emissiveIntensity = dusk * 6;
    poolMat.opacity = dusk * 0.55;
    trainWin.emissiveIntensity = dusk * 1.4;
    M.sign.color.setScalar(0.82 + 0.25 * dusk);
  }

  console.info(`real city: ${net.nodes.length} junctions, ${net.edges.length} roads, ${built} buildings, ${pois.length} destinations, ${stands.length} win stands`);
  return {
    style: 'osm', colliders: col, lots: [], pois, stands, people, npcs,
    groundHeight: (x, z) => (onRoad(x, z) ? 0 : 0.001), // pavement: flat, but counts as "on the sidewalk"
    placeName: (x, z) => net.placeName(x, z) || 'ทางเท้า',
    updateTrain, setNight, net, districtLabels: places, bounds, districtOf, mapPolys,
    attribution: data.meta?.attribution || '© OpenStreetMap contributors',
  };
}

// triangle with an upward normal and optional world-space uv (metres per repeat)
function addTri(b, a, c, d, color, uvScale) {
  const n = new THREE.Vector3().subVectors(c, a).cross(new THREE.Vector3().subVectors(d, a));
  if (n.y < 0) { const t = c; c = d; d = t; }
  const base = b.pos.length / 3;
  for (const p of [a, c, d]) {
    b.pos.push(p.x, p.y, p.z);
    b.nor.push(0, 1, 0);
    b.uv.push(uvScale ? p.x / uvScale : 0.02, uvScale ? -p.z / uvScale : 0.02);
    b.col.push(color.r, color.g, color.b);
  }
  b.idx.push(base, base + 1, base + 2);
}

// flat quad on the ground (a, b, c, d counter-clockwise from above)
function quadUp(b, a, bb, c, d, color, uvScale) {
  addTri(b, a, bb, c, color, uvScale);
  addTri(b, a, c, d, color, uvScale);
}
