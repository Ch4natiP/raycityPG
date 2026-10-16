import * as THREE from 'three';

// People: a real skeleton (bones), body and clothes as separate pieces bound to it, all merged
// into ONE skinned mesh per person (one draw call). Outfits are plain data, so the rider can
// change clothes; the win vest is a layer of its own.
//
// Rest pose: standing, arms down, facing +z, feet on y = 0.

const BONES = [
  // name, parent, rest position relative to parent
  ['root', -1, [0, 0, 0]],
  ['hips', 0, [0, 0.95, 0]],
  ['spine', 1, [0, 0.12, 0]],
  ['chest', 2, [0, 0.18, 0]],
  ['neck', 3, [0, 0.24, 0]],
  ['head', 4, [0, 0.07, 0]],
  ['armL', 3, [0.185, 0.155, 0]],
  ['foreL', 6, [0, -0.29, 0]],
  ['handL', 7, [0, -0.25, 0]],
  ['armR', 3, [-0.185, 0.155, 0]],
  ['foreR', 9, [0, -0.29, 0]],
  ['handR', 10, [0, -0.25, 0]],
  ['legL', 1, [0.095, -0.03, 0]],
  ['shinL', 12, [0, -0.43, 0]],
  ['footL', 13, [0, -0.42, 0]],
  ['legR', 1, [-0.095, -0.03, 0]],
  ['shinR', 15, [0, -0.43, 0]],
  ['footR', 16, [0, -0.42, 0]],
];
const BI = Object.fromEntries(BONES.map((b, k) => [b[0], k]));
// model-space rest positions of every joint
const REST = [];
for (const [, parent, p] of BONES) {
  const base = parent < 0 ? [0, 0, 0] : REST[parent];
  REST.push([base[0] + p[0], base[1] + p[1], base[2] + p[2]]);
}

export const SKINS = ['#e9c39b', '#d9a77c', '#c68e5e', '#a8714a', '#8d5a3a', '#f1d1b0'];
export const HAIR_COLORS = ['#141414', '#2b1d14', '#3d2a1c', '#5b3b24', '#8a8a8a', '#7a3b1f'];
export const OUTFIT = {
  hair: ['short', 'buzz', 'spiky', 'long', 'bun', 'none'],
  shirt: ['tee', 'long', 'polo', 'hoodie', 'jacket'],
  pants: ['jeans', 'cargo', 'slacks', 'shorts'],
  shoes: ['sneakers', 'sandals', 'boots'],
  helmet: ['none', 'half', 'full', 'retro'],
};
const SHIRT_COLORS = ['#ffffff', '#2e86de', '#e74c3c', '#f1c40f', '#27ae60', '#8e44ad', '#ff9ff3', '#222f3e', '#48dbfb', '#ff6b6b', '#f5f0e6', '#576574'];
const PANT_COLORS = ['#22314a', '#34495e', '#576574', '#2d3436', '#8395a7', '#3c2a21', '#6d6552', '#1b1b1b'];
const SHOE_COLORS = ['#f5f5f5', '#1b1b1b', '#c0392b', '#2e86de', '#8b5a2b', '#6b6b6b'];

export function randomOutfit(r = Math.random, opts = {}) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  const female = opts.female ?? r() < 0.45;
  return {
    female,
    skin: pick(SKINS),
    hair: female ? pick(['long', 'bun', 'short', 'long']) : pick(['short', 'buzz', 'spiky', 'short', 'none']),
    hairColor: pick(HAIR_COLORS.slice(0, 4)),
    shirt: opts.shirt ? 'tee' : pick(['tee', 'tee', 'polo', 'long', 'hoodie']),
    shirtColor: opts.shirt ? `#${new THREE.Color(opts.shirt).getHexString()}` : pick(SHIRT_COLORS),
    pants: pick(['jeans', 'slacks', 'cargo', 'shorts', 'jeans']),
    pantsColor: pick(PANT_COLORS),
    shoes: pick(['sneakers', 'sandals', 'sneakers']),
    shoesColor: pick(SHOE_COLORS),
    helmet: opts.helmet ? 'half' : 'none',
    helmetColor: typeof opts.helmet === 'number' ? `#${new THREE.Color(opts.helmet).getHexString()}` : '#f5f5f5',
    glasses: r() < 0.12,
    mask: r() < 0.1,
    gloves: null,
    vest: opts.vest != null ? { color: opts.vestColor || '#ff7a00', number: opts.vest } : null,
    height: 0.94 + r() * 0.1 - (female ? 0.05 : 0),
    beard: !female && r() < 0.12,
  };
}

// ---------- geometry assembly ----------
class Parts {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.si = []; this.idx = []; }
  // add a geometry already placed in model space; bone = joint index or a function(y) => joint
  add(g, color, bone, uvMode = null) {
    // keep the primitive's own index: shared corners stay shared (no welding pass needed)
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position; const n = g.attributes.normal; const u = g.attributes.uv;
    const c = new THREE.Color(color);
    const base = this.pos.length / 3;
    for (let k = 0; k < p.count; k++) {
      const y = p.getY(k);
      this.pos.push(p.getX(k), y, p.getZ(k));
      this.nor.push(n.getX(k), n.getY(k), n.getZ(k));
      if (uvMode === 'vest' && u) this.uv.push(u.getX(k), 0.5 + u.getY(k) * 0.5);
      else this.uv.push(0.05, 0.05); // plain white corner of the texture
      this.col.push(c.r, c.g, c.b);
      this.si.push(typeof bone === 'function' ? bone(y, p.getX(k)) : bone);
    }
    if (g.index) for (let k = 0; k < g.index.count; k++) this.idx.push(base + g.index.getX(k));
    else for (let k = 0; k < p.count; k++) this.idx.push(base + k);
  }
}
const at = (g, j, dx = 0, dy = 0, dz = 0) => { const r = REST[BI[j]]; g.translate(r[0] + dx, r[1] + dy, r[2] + dz); return g; };
let Q = 1; // detail: 1 for the people you meet, less for crowds and riders far away
const q = (n) => Math.max(6, Math.round(n * Q));
const capsule = (rad, len, seg = 8) => new THREE.CapsuleGeometry(rad, Math.max(0.001, len), 4, seg);
// a limb hanging down from joint j: from the joint to `len` below it
const limb = (j, rad, len, rad2 = rad) => { const g = new THREE.CylinderGeometry(rad, rad2, len, q(12), 1); g.translate(0, -len / 2, 0); return at(g, j); };
const ball = (j, rad, dx = 0, dy = 0, dz = 0, sx = 1, sy = 1, sz = 1, seg = 12) => { const g = new THREE.SphereGeometry(rad, q(seg), Math.max(4, Math.round(q(seg) * 0.75))); g.scale(sx, sy, sz); return at(g, j, dx, dy, dz); };
const torsoBone = (y) => (y < REST[BI.spine][1] ? BI.hips : y < REST[BI.chest][1] + 0.02 ? BI.spine : BI.chest);

// Torso as a lathe (round, then flattened front-to-back), from hips to the base of the neck.
function torso(grow = 0, from = -0.06, to = 0.5, female = false) {
  const prof = [[-0.06, 0.155], [0.02, 0.16], [0.12, 0.145], [0.2, 0.15], [0.3, female ? 0.165 : 0.172], [0.4, female ? 0.168 : 0.182], [0.46, 0.17], [0.5, 0.13], [0.53, 0.075]];
  const pts = prof.filter(([y]) => y >= from - 0.001 && y <= to + 0.001).map(([y, r]) => new THREE.Vector2(r + grow, y));
  const g = new THREE.LatheGeometry(pts, q(18));
  g.scale(1, 1, 0.62);
  return at(g, 'hips');
}

export function makeCharacter(outfit, { lite = false } = {}) {
  const o = outfit;
  Q = lite ? 0.55 : 1;
  const P = new Parts();
  const skin = o.skin;
  const shirtLong = o.shirt === 'long' || o.shirt === 'hoodie' || o.shirt === 'jacket';
  // --- body (skin where clothes do not cover) ---
  P.add(ball('head', 0.102, 0, 0.1, 0.005, 0.95, 1.2, 1.08, 22), skin, BI.head);
  P.add(ball('head', 0.06, 0, 0.045, 0.045, 1.1, 0.9, 1, 14), skin, BI.head); // jaw and chin
  P.add(limb('neck', 0.05, 0.1, 0.055).translate(0, 0.1, 0), skin, BI.neck);
  for (const s of [1, -1]) P.add(ball('head', 0.022, s * 0.103, 0.1, 0, 0.6, 1, 1), skin, BI.head); // ears
  { const nose = new THREE.ConeGeometry(0.017, 0.045, 8); nose.rotateX(-0.35); nose.scale(1, 1, 0.8); at(nose, 'head', 0, 0.092, 0.11); P.add(nose, skin, BI.head); } // nose
  for (const s of [1, -1]) {
    P.add(ball('head', 0.016, s * 0.036, 0.113, 0.093, 1.25, 0.75, 0.6), '#f2efe8', BI.head); // eye white
    P.add(ball('head', 0.0095, s * 0.036, 0.113, 0.1, 1, 1, 0.6), '#1a1410', BI.head); // iris
    const brow = new THREE.BoxGeometry(0.03, 0.006, 0.008); at(brow, 'head', s * 0.038, 0.138, 0.1); P.add(brow, o.hairColor, BI.head);
  }
  const mouth = new THREE.BoxGeometry(0.035, 0.005, 0.006); at(mouth, 'head', 0, 0.052, 0.104); P.add(mouth, '#8a4a3a', BI.head);
  if (o.beard) P.add(ball('head', 0.09, 0, 0.045, 0.02, 1, 0.55, 1), o.hairColor, BI.head);
  // hair
  if (o.hair !== 'none') {
    const capH = o.hair === 'buzz' ? 0.5 : 0.55;
    // a cap tilted back: the fringe sits high on the forehead, the back covers the nape
    const cap = new THREE.SphereGeometry(o.hair === 'buzz' ? 0.107 : 0.113, 20, 10, 0, Math.PI * 2, 0, Math.PI * (capH + 0.08));
    cap.rotateX(-0.62); cap.scale(1, 1.17, 1.1); at(cap, 'head', 0, 0.112, -0.004);
    P.add(cap, o.hairColor, BI.head);
    if (o.hair === 'long') { const back = new THREE.CapsuleGeometry(0.09, 0.14, 4, 12); back.scale(1.15, 1, 0.55); at(back, 'head', 0, 0.02, -0.07); P.add(back, o.hairColor, BI.head); }
    if (o.hair === 'bun') P.add(ball('head', 0.05, 0, 0.2, -0.08), o.hairColor, BI.head);
    if (o.hair === 'spiky') for (let k = 0; k < 7; k++) { const c = new THREE.ConeGeometry(0.025, 0.07, 5); c.rotateX(-0.4 + (k % 3) * 0.3); c.rotateZ((k - 3) * 0.25); at(c, 'head', (k - 3) * 0.028, 0.23, -0.01 + (k % 2) * 0.03); P.add(c, o.hairColor, BI.head); }
  }
  // arms: skin below the sleeve
  const sleeveLen = shirtLong ? 0.54 : o.shirt === 'polo' || o.shirt === 'tee' ? 0.14 : 0.14;
  for (const [side, s] of [['L', 1], ['R', -1]]) {
    const arm = `arm${side}`; const fore = `fore${side}`; const hand = `hand${side}`;
    if (sleeveLen < 0.29) P.add(limb(arm, 0.045, 0.29 - sleeveLen, 0.04).translate(0, -sleeveLen, 0), skin, BI[arm]);
    if (!shirtLong) P.add(limb(fore, 0.04, 0.25, 0.033), skin, BI[fore]);
    P.add(ball(arm, 0.047, 0, 0, 0), skin, BI[arm]);
    // hand: palm + thumb, or gloves
    const palm = new THREE.BoxGeometry(0.06, 0.09, 0.03); at(palm, hand, 0, -0.04, 0.005);
    P.add(palm, o.gloves || skin, BI[hand]);
    const thumb = new THREE.BoxGeometry(0.02, 0.04, 0.02); at(thumb, hand, s * 0.035, -0.025, 0.02);
    P.add(thumb, o.gloves || skin, BI[hand]);
    void s;
  }
  // legs: skin below shorts
  if (o.pants === 'shorts') for (const side of ['L', 'R']) { P.add(limb(`shin${side}`, 0.052, 0.39, 0.04).translate(0, 0.02, 0), skin, BI[`shin${side}`]); P.add(limb(`leg${side}`, 0.065, 0.12, 0.055).translate(0, -0.31, 0), skin, BI[`leg${side}`]); }

  // --- clothes ---
  // shirt torso + sleeves
  const shirt = o.shirtColor;
  P.add(torso(0.008, -0.04, 0.53, o.female), shirt, torsoBone);
  if (o.shirt === 'hoodie') { const hood = new THREE.TorusGeometry(0.1, 0.035, 6, 14); hood.rotateX(Math.PI / 2.4); at(hood, 'neck', 0, 0.02, -0.03); P.add(hood, shirt, BI.chest); }
  if (o.shirt === 'polo') { const collar = new THREE.TorusGeometry(0.065, 0.015, 5, 14); collar.rotateX(Math.PI / 2); at(collar, 'neck', 0, 0.01, 0.005); P.add(collar, shirt, BI.chest); }
  if (o.shirt === 'jacket') { const zip = new THREE.BoxGeometry(0.012, 0.42, 0.01); at(zip, 'hips', 0, 0.26, 0.112); P.add(zip, '#bdbdbd', torsoBone); }
  for (const side of ['L', 'R']) {
    const arm = `arm${side}`; const fore = `fore${side}`;
    P.add(limb(arm, 0.056, Math.min(0.29, sleeveLen), 0.05), shirt, BI[arm]);
    P.add(ball(arm, 0.054, 0, -0.01, 0, 1, 0.9, 1), shirt, BI[arm]);
    if (shirtLong) { P.add(limb(fore, 0.047, 0.24, 0.04), shirt, BI[fore]); P.add(ball(fore, 0.048), shirt, BI[fore]); }
  }
  // pants
  const pc = o.pantsColor;
  P.add(torso(0.012, -0.08, 0.06), pc, BI.hips);
  for (const side of ['L', 'R']) {
    const leg = `leg${side}`; const shin = `shin${side}`;
    const len = o.pants === 'shorts' ? 0.3 : 0.43;
    P.add(limb(leg, o.pants === 'cargo' ? 0.082 : 0.075, len, o.pants === 'shorts' ? 0.07 : 0.06), pc, BI[leg]);
    P.add(ball(leg, 0.078, 0, 0.0, 0), pc, BI[leg]);
    if (o.pants === 'cargo') { const pocket = new THREE.BoxGeometry(0.03, 0.09, 0.07); at(pocket, leg, (side === 'L' ? 1 : -1) * 0.075, -0.24, 0); P.add(pocket, pc, BI[leg]); }
    if (o.pants !== 'shorts') { P.add(limb(shin, 0.058, 0.4, o.pants === 'slacks' ? 0.045 : 0.05), pc, BI[shin]); P.add(ball(shin, 0.057), pc, BI[shin]); }
    // shoes
    const sc = o.shoesColor;
    const foot = `foot${side}`;
    if (o.shoes === 'sandals') {
      const sole = new THREE.BoxGeometry(0.085, 0.018, 0.23); at(sole, foot, 0, -0.06, 0.045); P.add(sole, '#3a2a20', BI[foot]);
      const strap = new THREE.BoxGeometry(0.092, 0.015, 0.03); at(strap, foot, 0, -0.035, 0.08); P.add(strap, sc, BI[foot]);
      const top = new THREE.BoxGeometry(0.072, 0.04, 0.2); at(top, foot, 0, -0.031, 0.045); P.add(top, skin, BI[foot]);
      if (o.pants === 'shorts') P.add(limb(foot, 0.04, 0.04).translate(0, 0.0, 0), skin, BI[foot]);
    } else {
      const shoe = new THREE.CapsuleGeometry(0.042, 0.15, 4, 10); shoe.rotateX(Math.PI / 2); shoe.scale(0.95, o.shoes === 'boots' ? 1.05 : 0.8, 1); at(shoe, foot, 0, -0.036, 0.045);
      P.add(shoe, sc, BI[foot]);
      P.add(ball(foot, 0.044, 0, -0.03, -0.035, 0.95, 1.05, 1.1), sc, BI[foot]); // heel + ankle collar
      const sole = new THREE.BoxGeometry(0.082, 0.018, 0.225); at(sole, foot, 0, -0.06, 0.045); P.add(sole, o.shoes === 'sneakers' ? '#f2f2f2' : '#2a2a2a', BI[foot]);
      if (o.shoes === 'boots') P.add(limb(foot, 0.06, 0.14).translate(0, 0.1, 0), sc, BI[foot]);
    }
  }
  // the win vest: always worn by riders, number on the back, reflective band
  if (o.vest) {
    const v = new THREE.LatheGeometry([[0.13, -0.02], [0.165, 0.06], [0.168, 0.16], [0.18, 0.3], [0.192, 0.4], [0.18, 0.46], [0.13, 0.5]].map(([r, y]) => new THREE.Vector2(r + (o.shirt === 'hoodie' || o.shirt === 'jacket' ? 0.03 : 0.018), y)), 20);
    v.scale(1, 1, 0.64); at(v, 'hips');
    P.add(v, '#ffffff', torsoBone, 'vest');
  }
  // helmet, glasses, mask
  if (o.helmet !== 'none') {
    const hc = o.helmetColor;
    const shell = new THREE.SphereGeometry(0.135, 16, 10, 0, Math.PI * 2, 0, Math.PI * (o.helmet === 'full' ? 0.75 : 0.55));
    shell.scale(1, 1.05, 1.12); at(shell, 'head', 0, 0.105, -0.005);
    P.add(shell, hc, BI.head);
    if (o.helmet === 'full') {
      const visor = new THREE.SphereGeometry(0.138, 14, 6, -0.9, 1.8, Math.PI * 0.38, Math.PI * 0.2); visor.scale(1, 1.05, 1.12); at(visor, 'head', 0, 0.105, -0.002);
      P.add(visor, '#1c242e', BI.head);
      const chin = new THREE.TorusGeometry(0.1, 0.03, 6, 12, Math.PI); chin.rotateX(Math.PI / 2); chin.rotateZ(Math.PI); at(chin, 'head', 0, 0.03, 0.02);
      P.add(chin, hc, BI.head);
    } else {
      const brim = new THREE.BoxGeometry(0.16, 0.012, 0.06); at(brim, 'head', 0, 0.165, 0.12); P.add(brim, o.helmet === 'retro' ? '#2a2a2a' : hc, BI.head);
      if (o.helmet === 'retro') { const band = new THREE.TorusGeometry(0.135, 0.008, 4, 20); band.rotateX(Math.PI / 2); at(band, 'head', 0, 0.115, -0.005); P.add(band, '#e9e2cf', BI.head); }
    }
  }
  if (o.glasses) {
    for (const s of [1, -1]) { const lens = new THREE.CylinderGeometry(0.022, 0.022, 0.006, 10); lens.rotateX(Math.PI / 2); at(lens, 'head', s * 0.04, 0.115, 0.112); P.add(lens, '#0d0d0d', BI.head); }
    const bridge = new THREE.BoxGeometry(0.11, 0.006, 0.006); at(bridge, 'head', 0, 0.12, 0.11); P.add(bridge, '#0d0d0d', BI.head);
  }
  if (o.mask) { const m = new THREE.BoxGeometry(0.11, 0.06, 0.03); at(m, 'head', 0, 0.06, 0.1); P.add(m, o.maskColor || '#e8f0f5', BI.head); }

  // --- assemble the skinned mesh ---
  let geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(P.nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(P.uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(P.col, 3));
  const n = P.si.length;
  const si = new Uint16Array(n * 4); const sw = new Float32Array(n * 4);
  for (let k = 0; k < n; k++) { si[k * 4] = P.si[k]; sw[k * 4] = 1; }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  geo.setIndex(P.idx);
  geo.computeBoundingSphere();

  const bones = BONES.map(([name]) => { const b = new THREE.Bone(); b.name = name; return b; });
  BONES.forEach(([, parent, p], k) => { bones[k].position.set(...p); if (parent >= 0) bones[parent].add(bones[k]); });
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshLambertMaterial({ map: personTexture(o.vest), vertexColors: true }));
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  const root = new THREE.Group();
  root.add(bones[0]);
  root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  root.scale.setScalar(o.height || 1);
  const b = Object.fromEntries(BONES.map(([name], k) => [name, bones[k]]));
  root.userData = {
    mesh, bones: b, outfit: o,
    // names the old poses used
    hips: b.hips, torso: b.chest, legL: b.legL, legR: b.legR, shinL: b.shinL, shinR: b.shinR, armL: b.armL, armR: b.armR,
  };
  return root;
}

// Vest artwork: orange body, grey reflective band, the rider's number on the back. Bottom half is plain white.
const texCache = new Map();
function personTexture(vest) {
  const key = vest ? `${vest.color}|${vest.number}|${vest.text || ''}` : 'plain';
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 256);
  if (vest) {
    // top half = vest (v 0.5..1); u wraps around the body, 0.5 = the back
    g.fillStyle = vest.color;
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#d9dde2';
    g.fillRect(0, 74, 256, 10);
    g.fillStyle = '#ffd200';
    g.fillRect(0, 84, 256, 3);
    g.fillStyle = '#111';
    g.textAlign = 'center';
    g.font = 'bold 44px Tahoma, sans-serif';
    g.fillText(String(vest.number), 128, 62);
    g.font = 'bold 13px Tahoma, sans-serif';
    g.fillText(vest.text || 'วินมอเตอร์ไซค์', 128, 22);
    // a small number on the front, too
    g.font = 'bold 14px Tahoma, sans-serif';
    g.fillText(String(vest.number), 20, 50);
    g.fillText(String(vest.number), 236, 50);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  texCache.set(key, t);
  return t;
}

// ---------- poses and animation ----------
const set = (o, x = 0, y = 0, z = 0) => o.rotation.set(x, y, z);
export function poseCharacter(p, name, t = 0) {
  const b = p.userData.bones;
  const hipsY = 0.95;
  b.hips.position.set(0, hipsY, 0);
  for (const k of ['spine', 'chest', 'neck', 'head', 'hips']) set(b[k]);
  const arms = (lx, lz, fx = 0, rx = lx, rz = -lz, frx = fx) => { set(b.armL, lx, 0, lz); set(b.foreL, fx); set(b.armR, rx, 0, rz); set(b.foreR, frx); set(b.handL); set(b.handR); };
  const legs = (l, sl, r = l, sr = sl) => { set(b.legL, l); set(b.shinL, sl); set(b.legR, r); set(b.shinR, sr); set(b.footL); set(b.footR); };
  const breathe = Math.sin(t * 2) * 0.015;
  switch (name) {
    case 'wave':
      legs(0, 0); arms(0, 0.1, -0.1, 0, -2.6 + Math.sin(t * 8) * 0.35, -0.3);
      b.head.rotation.y = Math.sin(t * 1.3) * 0.15;
      break;
    case 'ride':
      b.hips.position.y = 0;
      legs(-1.3, 1.5); b.legL.rotation.z = 0.2; b.legR.rotation.z = -0.2;
      set(b.footL, -0.2); set(b.footR, -0.2);
      b.spine.rotation.x = 0.25; b.chest.rotation.x = 0.1; b.head.rotation.x = -0.3;
      arms(-1.05, 0.22, -0.35, -1.05, -0.22, -0.35);
      break;
    case 'pillion':
      b.hips.position.y = 0;
      legs(-1.35, 1.55); b.legL.rotation.z = 0.32; b.legR.rotation.z = -0.32;
      b.spine.rotation.x = 0.08;
      arms(-0.55, 0.35, -0.6, -0.55, -0.35, -0.6);
      b.head.rotation.y = Math.sin(t * 0.7) * 0.4;
      break;
    case 'sit':
      b.hips.position.y = 0.47;
      legs(-1.5, 1.5); b.legL.rotation.z = 0.06; b.legR.rotation.z = -0.06;
      b.spine.rotation.x = 0.12 + breathe;
      arms(-0.5, 0.12, -0.7);
      b.head.rotation.x = 0.1 + Math.sin(t * 0.5) * 0.08;
      break;
    case 'walk':
    case 'run': {
      const run = name === 'run';
      const f = run ? 10 : 6.5;
      const s = Math.sin(t * f);
      const amp = run ? 0.85 : 0.5;
      b.hips.position.y = hipsY - (run ? 0.04 : 0.01) + Math.abs(Math.cos(t * f)) * (run ? 0.05 : 0.02);
      legs(s * amp, Math.max(0, -s) * (run ? 1.3 : 0.7) + 0.05, -s * amp, Math.max(0, s) * (run ? 1.3 : 0.7) + 0.05);
      set(b.footL, Math.max(0, s) * 0.3); set(b.footR, Math.max(0, -s) * 0.3);
      arms(-s * amp * 0.8, 0.08, run ? -1.2 : -0.25, s * amp * 0.8, -0.08, run ? -1.2 : -0.25);
      b.spine.rotation.x = run ? 0.18 : 0.04;
      b.spine.rotation.y = s * 0.12;
      b.chest.rotation.y = -s * 0.15;
      break;
    }
    case 'talk':
      legs(0, 0.02);
      arms(-0.35 + Math.sin(t * 3.1) * 0.2, 0.15, -0.9 + Math.sin(t * 4.3) * 0.25, 0.05, -0.08, -0.05);
      b.head.rotation.x = Math.sin(t * 5) * 0.06;
      b.head.rotation.y = Math.sin(t * 1.7) * 0.12;
      b.chest.rotation.x = breathe;
      break;
    case 'idle':
    case 'stand':
    default:
      legs(0, 0.02);
      arms(0.02, 0.09, -0.08);
      b.chest.rotation.x = breathe;
      b.head.rotation.y = Math.sin(t * 0.6 + p.id) * 0.2;
      break;
  }
}

// Freeze a posed character into plain geometry (with vertex colours) in world space,
// so crowds of extras can be merged into the city mesh.
export function bakeCharacter(p) {
  p.updateMatrixWorld(true);
  const mesh = p.userData.mesh;
  mesh.skeleton.update();
  const src = mesh.geometry;
  const pos = src.attributes.position; const col = src.attributes.color;
  const out = new THREE.BufferGeometry();
  const P = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let k = 0; k < pos.count; k++) {
    v.fromBufferAttribute(pos, k);
    mesh.applyBoneTransform(k, v);
    v.applyMatrix4(mesh.matrixWorld);
    P[k * 3] = v.x; P[k * 3 + 1] = v.y; P[k * 3 + 2] = v.z;
  }
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('color', col.clone());
  out.setAttribute('uv', src.attributes.uv.clone());
  out.setIndex(src.index.clone());
  out.computeVertexNormals();
  return out;
}

// Two-bone reach: put a hand (or a foot) on a world-space point (a handlebar grip, a footpeg).
// Elbows bend forward-out like a person's; knees bend forward.
const _t = new THREE.Vector3();
function twoBone(p, upper, lower, target, a, c, knee) {
  const b = p.userData.bones;
  const up = b[upper]; const lo = b[lower];
  p.updateMatrixWorld(true);
  _t.copy(target); up.parent.worldToLocal(_t);
  const d = _t.sub(up.position);
  const dist = Math.min(a + c - 0.002, Math.max(0.05, d.length()));
  const bend = Math.PI - Math.acos(Math.max(-1, Math.min(1, (a * a + c * c - dist * dist) / (2 * a * c))));
  const alpha = Math.acos(Math.max(-1, Math.min(1, (a * a + dist * dist - c * c) / (2 * a * dist))));
  const roll = Math.atan2(d.x, Math.hypot(d.y, d.z));
  const pitch = Math.atan2(d.z, -d.y);
  if (knee) { up.rotation.set(-(pitch + alpha), 0, roll); lo.rotation.set(bend, 0, 0); }
  else { up.rotation.set(-(pitch - alpha), 0, roll); lo.rotation.set(-bend, 0, 0); }
}
export function reach(p, side, target) {
  twoBone(p, `arm${side}`, `fore${side}`, target, 0.29, 0.31, false);
  p.userData.bones[`hand${side}`].rotation.set(0.3, 0, 0);
}
export function plant(p, side, target, lean = 0) {
  twoBone(p, `leg${side}`, `shin${side}`, target, 0.43, 0.42, true);
  const b = p.userData.bones;
  b[`foot${side}`].rotation.set(-(b[`leg${side}`].rotation.x + b[`shin${side}`].rotation.x) - lean, 0, 0);
}

// Crowds: a few dozen ready-made extras (outfit + pose), built once, frozen and shared.
// Streets and riders reuse them through instancing, so a busy city costs little.
const crowdCache = new Map();
export const CROWD_KINDS = 24;
function crowdRng(seed) {
  let x = (seed * 2654435761) >>> 0;
  return () => { x = (x + 0x6d2b79f5) >>> 0; let t = x; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function crowdOutfit(arch, opts = {}) { return randomOutfit(crowdRng(arch + 1), opts); }
// setup(person) may pose it differently (a rider reaching for the bars); key must name that setup.
export function crowdGeometry(arch, poseName = 'stand', { opts = {}, setup = null, key = '' } = {}) {
  const k = `${arch}|${poseName}|${key}`;
  if (crowdCache.has(k)) return crowdCache.get(k);
  const p = makeCharacter(crowdOutfit(arch, opts), { lite: true });
  if (setup) setup(p); else poseCharacter(p, poseName, arch * 1.7);
  const g = bakeCharacter(p);
  g.deleteAttribute('uv');
  p.userData.mesh.geometry.dispose();
  crowdCache.set(k, g);
  return g;
}

// Place many extras at once: entries [{ arch, pose, x, y, z, rot }] -> one InstancedMesh per kind of person.
export function crowdMeshes(entries, shadows = true) {
  const groups = new Map();
  for (const e of entries) { const k = `${e.arch}|${e.pose}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const m4 = new THREE.Matrix4(); const q = new THREE.Quaternion(); const one = new THREE.Vector3(1, 1, 1); const up = new THREE.Vector3(0, 1, 0); const p = new THREE.Vector3();
  const out = [];
  for (const [k, list] of groups) {
    const [arch, pose] = k.split('|');
    const im = new THREE.InstancedMesh(crowdGeometry(+arch, pose), mat, list.length);
    list.forEach((e, i) => im.setMatrixAt(i, m4.compose(p.set(e.x, e.y, e.z), q.setFromAxisAngle(up, e.rot || 0), one)));
    im.castShadow = shadows;
    im.computeBoundingSphere();
    out.push(im);
  }
  return out;
}
