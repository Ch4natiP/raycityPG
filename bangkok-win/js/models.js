import * as THREE from 'three';
import { labelTexture, vestTexture } from './textures.js';
import { GeoBuilder } from './geo.js';

const mats = new Map();
export function mat(color, opts = {}) {
  const key = `${color}|${JSON.stringify(opts)}`;
  if (!mats.has(key)) mats.set(key, new THREE.MeshLambertMaterial({ color, ...opts }));
  return mats.get(key);
}

function box(w, h, d, color, x = 0, y = 0, z = 0, opts) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), color instanceof THREE.Material ? color : mat(color, opts));
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function wheel(r, w, color = 0x151515) {
  const g = new THREE.CylinderGeometry(r, r, w, 14);
  g.rotateZ(Math.PI / 2);
  const m = new THREE.Mesh(g, mat(color));
  m.castShadow = true;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.45, r * 0.45, w + 0.02, 8).rotateZ(Math.PI / 2), mat(0x9aa0a6));
  m.add(hub);
  return m;
}

// ---------- People ----------
const SKINS = [0xe0b48a, 0xc68e5e, 0xa8714a, 0xf1c9a5];
const SHIRTS = [0xffffff, 0x2e86de, 0xe74c3c, 0xf1c40f, 0x27ae60, 0x8e44ad, 0xff9ff3, 0x222f3e, 0x48dbfb, 0xff6b6b];
const PANTS = [0x222f3e, 0x34495e, 0x576574, 0x2d3436, 0x8395a7, 0x3c2a21];

export function makePerson(r = Math.random, { vest = null, helmet = false, shirt = null } = {}) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  const skin = pick(SKINS);
  const root = new THREE.Group();
  const shirtMat = vest ? new THREE.MeshLambertMaterial({ map: vestTexture(vest) }) : mat(shirt ?? pick(SHIRTS));
  const pantsMat = mat(pick(PANTS));
  const skinMat = mat(skin);

  const hips = new THREE.Group();
  hips.position.y = 0.9;
  root.add(hips);
  const torso = box(0.42, 0.58, 0.24, shirtMat, 0, 0.32, 0);
  hips.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), skinMat);
  head.position.y = 0.76;
  head.castShadow = true;
  hips.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.135, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x1a1a1a));
  hair.position.y = 0.78;
  hips.add(hair);
  if (helmet) {
    const hm = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), mat(helmet === true ? 0xf5f5f5 : helmet));
    hm.position.y = 0.78;
    hm.castShadow = true;
    hips.add(hm);
  }

  const limb = (len, w, m) => {
    const g = new THREE.Group();
    const b = box(w, len, w, m, 0, -len / 2, 0);
    g.add(b);
    return g;
  };
  const legL = limb(0.45, 0.15, pantsMat); legL.position.set(0.11, 0, 0);
  const legR = limb(0.45, 0.15, pantsMat); legR.position.set(-0.11, 0, 0);
  const shinL = limb(0.45, 0.13, pantsMat); shinL.position.y = -0.45; legL.add(shinL);
  const shinR = limb(0.45, 0.13, pantsMat); shinR.position.y = -0.45; legR.add(shinR);
  hips.add(legL, legR);
  const armL = limb(0.55, 0.11, vest ? mat(0x2d3436) : shirtMat); armL.position.set(0.27, 0.58, 0);
  const armR = limb(0.55, 0.11, vest ? mat(0x2d3436) : shirtMat); armR.position.set(-0.27, 0.58, 0);
  const handL = box(0.1, 0.1, 0.1, skinMat, 0, -0.58, 0); armL.add(handL);
  const handR = box(0.1, 0.1, 0.1, skinMat, 0, -0.58, 0); armR.add(handR);
  hips.add(armL, armR);

  root.userData = { hips, legL, legR, shinL, shinR, armL, armR, torso };
  return root;
}

export function pose(p, name, t = 0) {
  const u = p.userData;
  const set = (o, x = 0, y = 0, z = 0) => o.rotation.set(x, y, z);
  if (name === 'stand') {
    u.hips.position.y = 0.9;
    set(u.legL); set(u.legR); set(u.shinL); set(u.shinR);
    set(u.armL, 0, 0, 0.08); set(u.armR, 0, 0, -0.08);
  } else if (name === 'wave') {
    u.hips.position.y = 0.9;
    set(u.legL); set(u.legR); set(u.shinL); set(u.shinR);
    set(u.armL, 0, 0, 0.08);
    set(u.armR, 0, 0, -2.6 + Math.sin(t * 8) * 0.35); // arm up hailing
  } else if (name === 'ride') {
    // Rider: hands forward on the handlebar.
    u.hips.position.y = 0;
    set(u.legL, -1.35, 0, 0.18); set(u.legR, -1.35, 0, -0.18);
    set(u.shinL, 1.45); set(u.shinR, 1.45);
    set(u.armL, -1.15, 0, 0.12); set(u.armR, -1.15, 0, -0.12);
  } else if (name === 'pillion') {
    u.hips.position.y = 0;
    set(u.legL, -1.4, 0, 0.3); set(u.legR, -1.4, 0, -0.3);
    set(u.shinL, 1.5); set(u.shinR, 1.5);
    set(u.armL, -0.5, 0, 0.35); set(u.armR, -0.5, 0, -0.35);
  } else if (name === 'sit') {
    u.hips.position.y = 0.45;
    set(u.legL, -1.5, 0, 0.05); set(u.legR, -1.5, 0, -0.05);
    set(u.shinL, 1.5); set(u.shinR, 1.5);
    set(u.armL, -0.4, 0, 0.1); set(u.armR, -0.4, 0, -0.1);
  } else if (name === 'walk') {
    u.hips.position.y = 0.9;
    const s = Math.sin(t * 7);
    set(u.legL, s * 0.5); set(u.legR, -s * 0.5);
    set(u.shinL, Math.max(0, -s) * 0.6); set(u.shinR, Math.max(0, s) * 0.6);
    set(u.armL, -s * 0.4, 0, 0.08); set(u.armR, s * 0.4, 0, -0.08);
  }
}

// ---------- Motorcycle ----------
export function makeBike(color = 0xc81e1e) {
  const root = new THREE.Group();
  const lean = new THREE.Group();
  root.add(lean);
  const body = new THREE.MeshLambertMaterial({ color });
  const dark = mat(0x222222);
  const chrome = mat(0xb8bec4);

  const wr = 0.3;
  const front = wheel(wr, 0.1);
  front.position.set(0, wr, 0.68);
  const rear = wheel(wr, 0.12);
  rear.position.set(0, wr, -0.62);
  const fork = new THREE.Group();
  fork.position.set(0, 0.95, 0.52);
  fork.rotation.x = 0.35;
  fork.add(box(0.06, 0.75, 0.06, chrome, 0.07, -0.33, 0), box(0.06, 0.75, 0.06, chrome, -0.07, -0.33, 0));
  fork.add(box(0.62, 0.04, 0.04, dark, 0, 0.08, -0.05)); // handlebar
  fork.add(box(0.24, 0.16, 0.14, body, 0, 0.02, 0.1)); // headlight cowl
  const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.07, 12), new THREE.MeshBasicMaterial({ color: 0xfff6d0 }));
  lamp.position.set(0, 0.02, 0.175);
  fork.add(lamp);
  lean.add(front, rear, fork);
  const rimMat = new THREE.MeshLambertMaterial({ color: 0x9aa0a6 }); // own material so the rims can be painted
  front.children[0].material = rimMat;
  rear.children[0].material = rimMat;
  lean.add(box(0.26, 0.22, 0.95, body, 0, 0.62, 0.0)); // body
  lean.add(box(0.3, 0.1, 0.7, dark, 0, 0.8, -0.28)); // seat
  lean.add(box(0.28, 0.3, 0.12, body, 0, 0.62, 0.42)); // leg shield
  lean.add(box(0.1, 0.08, 0.5, chrome, -0.16, 0.38, -0.45)); // exhaust
  lean.add(box(0.18, 0.08, 0.1, mat(0xff2222), 0, 0.78, -0.68)); // tail lamp
  lean.add(box(0.2, 0.04, 0.32, dark, 0, 0.64, -0.85)); // rear fender / plate
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.12), new THREE.MeshBasicMaterial({ map: labelTexture('กท 1234', { bg: '#ffe066', fg: '#111', w: 256, h: 128, font: 64 }) }));
  plate.position.set(0, 0.56, -0.9);
  plate.rotation.y = Math.PI;
  lean.add(plate);

  root.userData = { lean, front, rear, fork, body, rimMat };
  return root;
}

export function setBikeColor(bike, color, rim = null) {
  bike.userData.body.color.set(color);
  if (rim !== null && bike.userData.rimMat) bike.userData.rimMat.color.set(rim);
}

// ---------- Traffic ----------
const PAINTS = [0xf5f5f5, 0x1c1c1c, 0x9aa5b1, 0x8a1c1c, 0x1e3a8a, 0x6b7280, 0xd4d4d4, 0x0f5132];
const TAXIS = [[0xff4fa3, 0xff4fa3], [0x2ecc71, 0xf1c40f], [0xff8c1a, 0x2ecc71], [0x3498db, 0x3498db]];

function glassMat() { return mat(0x2b3a4a); }

function sedan(r, color, top = null) {
  const g = new THREE.Group();
  g.add(box(1.8, 0.62, 4.4, color, 0, 0.58, 0));
  g.add(box(1.6, 0.55, 2.2, top ?? color, 0, 1.15, -0.2));
  g.add(box(1.62, 0.42, 2.05, glassMat(), 0, 1.16, -0.2));
  g.add(box(1.5, 0.1, 0.2, mat(0xffffcc), 0, 0.68, 2.2, { emissive: 0x444422 }));
  g.add(box(1.5, 0.12, 0.08, mat(0xcc0000), 0, 0.72, -2.2));
  for (const [x, z] of [[0.82, 1.4], [-0.82, 1.4], [0.82, -1.35], [-0.82, -1.35]]) {
    const w = wheel(0.33, 0.24); w.position.set(x, 0.33, z); g.add(w);
  }
  return { group: g, len: 4.5, wid: 1.85 };
}

function buildVehicle(type, r) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  if (type === 'taxi') {
    const [a, b] = pick(TAXIS);
    const v = sedan(r, a, b);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.3), new THREE.MeshBasicMaterial({ map: labelTexture('TAXI-METER', { bg: '#ffeb3b', fg: '#111', w: 256, h: 96, font: 40 }) }));
    sign.position.set(0, 1.55, 0);
    v.group.add(sign);
    return { ...v, type };
  }
  if (type === 'tuktuk') {
    const g = new THREE.Group();
    const c = pick([0x1e5aa8, 0x0a8a4a, 0xd4202a, 0xf2b705]);
    g.add(box(1.35, 0.5, 2.4, c, 0, 0.55, 0));
    g.add(box(1.45, 0.08, 2.6, pick([0x1e5aa8, 0xd4202a, 0x111111]), 0, 1.85, -0.1));
    for (const [x, z] of [[0.65, -1.05], [-0.65, -1.05], [0.65, 0.5], [-0.65, 0.5]]) g.add(box(0.05, 1.05, 0.05, mat(0xb8bec4), x, 1.3, z));
    g.add(box(1.1, 0.5, 0.6, mat(0x3a2b1f), 0, 0.95, -0.7)); // bench
    g.add(box(0.6, 0.55, 0.06, glassMat(), 0, 1.35, 1.05));
    const f = wheel(0.25, 0.14); f.position.set(0, 0.25, 1.0); g.add(f);
    for (const x of [0.62, -0.62]) { const w = wheel(0.25, 0.16); w.position.set(x, 0.25, -0.9); g.add(w); }
    return { group: g, len: 2.7, wid: 1.45, type };
  }
  if (type === 'bus') {
    const g = new THREE.Group();
    const [low, high] = pick([[0xc0392b, 0xf3e5c0], [0x1f5fbf, 0xf5f5f5], [0xf39c12, 0xffffff]]);
    g.add(box(2.5, 1.2, 11, low, 0, 1.0, 0));
    g.add(box(2.5, 1.5, 11, high, 0, 2.35, 0));
    g.add(box(2.52, 0.9, 10.2, glassMat(), 0, 2.25, -0.2));
    g.add(box(2.2, 1.0, 0.05, glassMat(), 0, 2.3, 5.51));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.35), new THREE.MeshBasicMaterial({ map: labelTexture(String(pick([2, 8, 25, 29, 40, 77, 113, 501])), { bg: '#111', fg: '#ffb000', w: 256, h: 64, font: 48 }) }));
    sign.position.set(0, 2.95, 5.52);
    g.add(sign);
    for (const [x, z] of [[1.15, 3.6], [-1.15, 3.6], [1.15, -3.4], [-1.15, -3.4]]) { const w = wheel(0.5, 0.3); w.position.set(x, 0.5, z); g.add(w); }
    return { group: g, len: 11, wid: 2.5, type };
  }
  if (type === 'songthaew') {
    const g = new THREE.Group();
    const c = pick([0xc0392b, 0x2471a3, 0x1e8449]);
    g.add(box(1.85, 0.6, 5.0, c, 0, 0.6, 0));
    g.add(box(1.75, 0.65, 1.4, c, 0, 1.2, 1.5));
    g.add(box(1.77, 0.45, 1.3, glassMat(), 0, 1.25, 1.55));
    g.add(box(1.9, 0.08, 3.2, c, 0, 2.15, -0.9));
    for (const [x, z] of [[0.9, 0.6], [-0.9, 0.6], [0.9, -2.45], [-0.9, -2.45]]) g.add(box(0.06, 1.3, 0.06, mat(0xb8bec4), x, 1.5, z));
    for (const [x, z] of [[0.85, 1.6], [-0.85, 1.6], [0.85, -1.5], [-0.85, -1.5]]) { const w = wheel(0.36, 0.26); w.position.set(x, 0.36, z); g.add(w); }
    return { group: g, len: 5.1, wid: 1.9, type };
  }
  if (type === 'pickup') {
    const g = new THREE.Group();
    const c = pick(PAINTS);
    g.add(box(1.85, 0.7, 5.2, c, 0, 0.75, 0));
    g.add(box(1.75, 0.65, 2.0, c, 0, 1.42, 0.9));
    g.add(box(1.77, 0.45, 1.9, glassMat(), 0, 1.45, 0.92));
    for (const [x, z] of [[0.85, 1.7], [-0.85, 1.7], [0.85, -1.6], [-0.85, -1.6]]) { const w = wheel(0.38, 0.28); w.position.set(x, 0.38, z); g.add(w); }
    return { group: g, len: 5.2, wid: 1.9, type };
  }
  if (type === 'moto') {
    const g = makeBike(pick([0x111111, 0xc81e1e, 0x1f4fbf, 0xdddddd]));
    const p = makePerson(r, { helmet: pick([0xf5f5f5, 0x222222, 0xc0392b, true]) });
    pose(p, 'ride');
    p.position.set(0, 0.82, -0.15);
    p.rotation.x = 0.15;
    g.userData.lean.add(p);
    return { group: g, len: 1.9, wid: 0.8, type };
  }
  return { ...sedan(r, pick(PAINTS)), type: 'car' };
}

// Merge a vehicle's plain-coloured parts into one mesh (one draw call); textured signs stay separate.
const vehicleMat = new THREE.MeshLambertMaterial({ vertexColors: true });
function bake(root) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const gb = new GeoBuilder();
  const keep = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const rel = inv.clone().multiply(o.matrixWorld);
    if (o.material.map) keep.push({ o, rel });
    else gb.addGeometry(o.geometry.clone().applyMatrix4(rel), o.material.color);
  });
  root.clear();
  const mesh = new THREE.Mesh(gb.build(), vehicleMat);
  mesh.castShadow = true;
  root.add(mesh);
  for (const { o, rel } of keep) { rel.decompose(o.position, o.quaternion, o.scale); root.add(o); }
}

export function makeVehicle(type, r = Math.random) {
  const v = buildVehicle(type, r);
  bake(type === 'moto' ? v.group.userData.lean : v.group);
  return v;
}
