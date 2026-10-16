import * as THREE from 'three';
import {
  N, BLOCK, HALF, SIDEWALK, CURB, nodeX, isMain, roadW, MEDIAN, BTS_ROW, BTS_Y, BTS_STATIONS,
  districtOf, NS_ROADS, EW_ROADS, blockRect, rng, laneOffsets, DISTRICTS,
} from './config.js';
import { GeoBuilder } from './geo.js';
import { RoadNet } from './roadnet.js';
import { Colliders } from './physics.js';
import { windowTexture, shopTexture, glassTexture, asphaltTexture, paveTexture, poolTexture, signAtlas, soiAtlas, labelTexture, SIGN_TEXTS, CHINA_SIGNS } from './textures.js';
import { makePerson, pose } from './models.js';

const UP = new THREE.Vector3(0, 1, 0);
const WALLS = ['#f2e3c6', '#e8d5b0', '#d9e4dd', '#f5c6a5', '#c9d6df', '#f7f1e3', '#e3c1a8', '#bfd8b8', '#f4d06f', '#e8a87c', '#d4e7f2', '#ffffff', '#f6b8b8', '#b8d8f6'];
const OLD_WALLS = ['#cfc6b4', '#bdb39f', '#d8cdb8', '#c4b8a0', '#e0d6c2', '#b9ae99'];
const AWNINGS = ['#e74c3c', '#2e86de', '#27ae60', '#f39c12', '#8e44ad', '#16a085', '#d35400', '#c0392b', '#ecf0f1'];
const ROOFS = ['#8d8d8d', '#a0522d', '#7f8c8d', '#6d6d6d', '#9b5e3c'];
const TOWER_TINTS = ['#ffffff', '#dfe9f3', '#e8f3ec', '#f3eadf', '#e2e2e2'];
const C = (s) => new THREE.Color(s);

export function buildCity(scene, { shadows = true } = {}) {
  const R = rng(20261016);
  const pick = (a) => a[Math.floor(R() * a.length)];
  const col = new Colliders();
  const lots = [];      // raised sidewalk areas {x0,z0,x1,z1,type}
  const pois = [];      // destinations {name, x, z, landmark}
  const stands = [];    // win stands {x, z, name}
  const labels = [];    // floating names over landmarks
  const people = [];    // decorative people (animated a little)

  // ---- materials ----
  const pairMat = ({ map, emissive }) => ({ map, emissiveMap: emissive, emissive: 0xffffff, emissiveIntensity: 0 });
  const offs = () => Math.floor(R() * 4) * 0.25; // random 4x4-window block offset so neighbours differ
  const atlas = signAtlas();
  const soiTex = soiAtlas();
  const M = {
    // emissive maps light up windows, shops and offices at night (see setNight)
    wall: new THREE.MeshLambertMaterial({ ...pairMat(windowTexture(R)), vertexColors: true }),
    shop: new THREE.MeshLambertMaterial({ ...pairMat(shopTexture()), vertexColors: true }),
    glass: new THREE.MeshStandardMaterial({ ...pairMat(glassTexture(R)), vertexColors: true, metalness: 0.55, roughness: 0.18, envMapIntensity: 1.2 }),
    pave: new THREE.MeshLambertMaterial({ map: paveTexture(R), vertexColors: true }),
    plain: new THREE.MeshLambertMaterial({ vertexColors: true }),
    awning: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    sign: new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true }),
    soi: new THREE.MeshBasicMaterial({ map: soiTex.texture, vertexColors: true }),
    mark: new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  };

  // Builders per 2x2-block chunk so the camera can cull far chunks.
  const chunks = new Map();
  const B = (kind, x, z) => {
    const cx = Math.floor((x + HALF + 200) / (BLOCK * 2));
    const cz = Math.floor((z + HALF + 200) / (BLOCK * 2));
    const k = `${kind}:${cx}:${cz}`;
    if (!chunks.has(k)) chunks.set(k, { kind, b: new GeoBuilder() });
    return chunks.get(k).b;
  };

  // ---- ground, river ----
  const groundSize = N * BLOCK + 900;
  const asphalt = asphaltTexture(R);
  asphalt.repeat.set(groundSize / 8, groundSize / 8);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(groundSize, groundSize), new THREE.MeshLambertMaterial({ map: asphalt, color: 0xd8d8d8 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const riverX0 = -HALF - 70;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(300, groundSize), new THREE.MeshLambertMaterial({ color: 0x5b7f8a }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(riverX0 - 150, 0.02, 0);
  scene.add(water);
  labels.push({ text: 'แม่น้ำเจ้าพระยา', x: riverX0 - 60, y: 18, z: 0, bg: '#1f5f7a' });

  // ---- helpers ----
  const sidewalk = (x0, z0, x1, z1, type, color = '#b9b4aa') => {
    B('pave', (x0 + x1) / 2, (z0 + z1) / 2).box(x0, 0, z0, x1, CURB, z1, C(color).lerp(C('#ffffff'), 0.35), { topTile: 2.4, tile: [1, 1] });
    lots.push({ x0, z0, x1, z1, type });
  };

  // A quad standing on a wall facing `n` (unit vector in xz), centred at c along the wall.
  const facadeQuad = (b, cx, cz, n, halfW, y0, y1, color, uv) => {
    const right = new THREE.Vector3().crossVectors(UP, n);
    const a = new THREE.Vector3(cx, y0, cz).addScaledVector(right, -halfW);
    const bb = new THREE.Vector3(cx, y0, cz).addScaledVector(right, halfW);
    b.quad(a, bb, bb.clone().setY(y1), a.clone().setY(y1), color, uv);
  };

  // A text board readable from both sides (two planes back to back).
  const board = (tex, w, h, x, y, z, rotY) => {
    const m = new THREE.MeshBasicMaterial({ map: tex });
    for (const flip of [0, Math.PI]) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
      s.position.set(x, y, z);
      s.rotation.y = rotY + flip;
      s.translateZ(0.01);
      scene.add(s);
    }
  };

  const signUV = (china) => {
    const r = china ? atlas.chinaStart + Math.floor(R() * CHINA_SIGNS.length) : Math.floor(R() * SIGN_TEXTS.length);
    return { r, uv: [0, 1 - (r + 1) / atlas.rows, 1, 1 - r / atlas.rows] };
  };

  // Power poles + tangled wires along a sidewalk line.
  const poleSpots = [];
  const medianLamps = []; // lamp posts down the middle of main roads, two arms each
  const wireRuns = [];

  // One row of shophouses (ตึกแถว) along an edge.
  // axis 'x': facade at z=f, facing sz (±1). axis 'z': facade at x=f, facing sx (±1).
  function shophouseRow(axis, f, s, a, b, depth, district, chunkX, chunkZ) {
    const china = district === 'เยาวราช';
    const palette = china ? OLD_WALLS : WALLS;
    let u = a;
    const signNames = [];
    while (u < b - 2) {
      const units = 1 + Math.floor(R() * 3);
      const w = Math.min(b - u, units * (4 + R() * 0.6));
      const u1 = b - (u + w) < 2.5 ? b : u + w;
      const floors = 2 + Math.floor(R() * (china ? 3 : 4));
      const h = 3.5 + floors * 3.4;
      const wall = C(pick(palette));
      const roof = C(pick(ROOFS));
      const [x0, x1, z0, z1] = axis === 'x'
        ? [u, u1, s < 0 ? f : f - depth, s < 0 ? f + depth : f]
        : [s < 0 ? f : f - depth, s < 0 ? f + depth : f, u, u1];
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      B('shop', chunkX, chunkZ).box(x0, CURB, z0, x1, 3.5, z1, C('#ffffff'), { tile: [8, 3.3], skip: { top: true }, uOffset: R() < 0.5 ? 0 : 0.5, ao: 0.35 });
      B('wall', chunkX, chunkZ).box(x0, 3.5, z0, x1, h, z1, wall, { tile: [16, 13.6], topColor: roof, uOffset: offs(), vOffset: offs() });
      if (R() < 0.35) { // water tank / rooftop shed
        const tx = cx + (R() - 0.5) * 2;
        const tz = cz + (R() - 0.5) * 2;
        B('plain', chunkX, chunkZ).box(tx - 0.8, h, tz - 0.8, tx + 0.8, h + 1.6, tz + 0.8, C(pick(['#d0d0d0', '#2e86de', '#c0392b'])));
      }
      // sign + awning on the facade, one per unit
      const n = axis === 'x' ? new THREE.Vector3(0, 0, s) : new THREE.Vector3(s, 0, 0);
      const len = u1 - u;
      const per = Math.max(1, Math.round(len / 4.2));
      for (let k = 0; k < per; k++) {
        const uc = u + (k + 0.5) * (len / per);
        const hw = len / per / 2 - 0.15;
        const fx = axis === 'x' ? uc : f + s * 0.06;
        const fz = axis === 'x' ? f + s * 0.06 : uc;
        const sg = signUV(china);
        signNames.push({ name: [...SIGN_TEXTS, ...CHINA_SIGNS][sg.r], u: uc });
        facadeQuad(B('sign', chunkX, chunkZ), fx, fz, n, hw, 3.7, 4.55, C('#ffffff'), sg.uv);
        if (china && R() < 0.5) { // vertical Chinatown sign sticking out
          const ox = axis === 'x' ? uc - hw + 0.2 : f + s * 1.0;
          const oz = axis === 'x' ? f + s * 1.0 : uc - hw + 0.2;
          B('plain', chunkX, chunkZ).box(ox - (axis === 'x' ? 0.08 : 0.8), 5, oz - (axis === 'x' ? 0.8 : 0.08), ox + (axis === 'x' ? 0.08 : 0.8), 9 + R() * 3, oz + (axis === 'x' ? 0.8 : 0.08), C(pick(['#b3121b', '#d4ac0d'])));
        }
        // awning
        const aw = C(pick(AWNINGS));
        const right = new THREE.Vector3().crossVectors(UP, n);
        const base = new THREE.Vector3(fx, 0, fz);
        const p0 = base.clone().addScaledVector(right, -hw).setY(3.45);
        const p1 = base.clone().addScaledVector(right, hw).setY(3.45);
        const p2 = p1.clone().addScaledVector(n, 1.7).setY(2.95);
        const p3 = p0.clone().addScaledVector(n, 1.7).setY(2.95);
        B('awning', chunkX, chunkZ).quad(p3, p2, p1, p0, aw);
      }
      u = u1;
    }
    // one collider for the whole row
    if (axis === 'x') col.add(a, s < 0 ? f : f - depth, b, s < 0 ? f + depth : f);
    else col.add(s < 0 ? f : f - depth, a, s < 0 ? f + depth : f, b);
    return signNames;
  }

  // Street things on a sidewalk strip: poles, carts, trees, people.
  function streetLife(axis, curb, s, a, b, district, cx, cz) {
    // s: direction from the road into the sidewalk
    const runs = [];
    for (let u = a + 6; u < b - 4; u += 22 + R() * 6) {
      const p = axis === 'x' ? { x: u, z: curb + s * 0.5, dx: 0, dz: -s } : { x: curb + s * 0.5, z: u, dx: -s, dz: 0 }; // (dx,dz) points at the road
      runs.push(p);
      poleSpots.push(p);
      col.add(p.x - 0.18, p.z - 0.18, p.x + 0.18, p.z + 0.18, 'pole');
    }
    if (runs.length > 1) wireRuns.push(runs);
    const carts = Math.floor(R() * 3);
    for (let k = 0; k < carts; k++) {
      const u = a + 5 + R() * (b - a - 10);
      const off = 1.6;
      const x = axis === 'x' ? u : curb + s * off;
      const z = axis === 'x' ? curb + s * off : u;
      const w = axis === 'x' ? [1.6, 0.8] : [0.8, 1.6];
      B('plain', cx, cz).box(x - w[0] / 2, CURB, z - w[1] / 2, x + w[0] / 2, CURB + 1.0, z + w[1] / 2, C(pick(['#d0d4d8', '#2e86de', '#e67e22'])), { topColor: C('#c0c0c0') });
      B('plain', cx, cz).box(x - 0.03, CURB + 1, z - 0.03, x + 0.03, CURB + 2.3, z + 0.03, C('#777'));
      const umb = new THREE.ConeGeometry(1.4, 0.6, 8);
      umb.translate(x, CURB + 2.5, z);
      B('plain', cx, cz).addGeometry(umb, C(pick(['#e74c3c', '#27ae60', '#f1c40f', '#2e86de', '#ff6b81'])));
      col.add(x - w[0] / 2, z - w[1] / 2, x + w[0] / 2, z + w[1] / 2, 'cart');
      if (R() < 0.7) {
        const v = makePerson(R);
        pose(v, 'stand');
        v.position.set(x + (axis === 'x' ? 0 : s * 1.0), CURB, z + (axis === 'x' ? s * 1.0 : 0));
        v.rotation.y = axis === 'x' ? (s > 0 ? Math.PI : 0) : (s > 0 ? -Math.PI / 2 : Math.PI / 2);
        people.push(v);
      }
    }
    const green = district === 'สีลม' || district === 'สุขุมวิท' || district === 'รัชดา';
    if (green) {
      for (let u = a + 14; u < b - 8; u += 18) {
        const x = axis === 'x' ? u : curb + s * 1.2;
        const z = axis === 'x' ? curb + s * 1.2 : u;
        tree(x, z, cx, cz, 0.8);
      }
    }
  }

  function tree(x, z, cx, cz, scale = 1) {
    const tr = new THREE.CylinderGeometry(0.18 * scale, 0.25 * scale, 3 * scale, 6);
    tr.translate(x, CURB + 1.5 * scale, z);
    B('plain', cx, cz).addGeometry(tr, C('#6b4f35'));
    const cn = new THREE.IcosahedronGeometry(2.2 * scale, 0);
    cn.translate(x, CURB + 4 * scale, z);
    B('plain', cx, cz).addGeometry(cn, C(pick(['#2f7d32', '#3e8e41', '#4caf50', '#2e6b30'])));
    col.add(x - 0.3, z - 0.3, x + 0.3, z + 0.3, 'tree');
  }

  // Shophouse-lined lot: sidewalk + rows on all four sides, maybe a tower inside.
  function shophouseLot(r, district, kind) {
    sidewalk(r.x0, r.z0, r.x1, r.z1, kind);
    const ix0 = r.x0 + SIDEWALK;
    const ix1 = r.x1 - SIDEWALK;
    const iz0 = r.z0 + SIDEWALK;
    const iz1 = r.z1 - SIDEWALK;
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    const D = Math.min(12, (Math.min(ix1 - ix0, iz1 - iz0)) / 2);
    const names = [];
    names.push({ side: 'n', list: shophouseRow('x', iz0, -1, ix0, ix1, D, district, cx, cz) });
    names.push({ side: 's', list: shophouseRow('x', iz1, 1, ix0, ix1, D, district, cx, cz) });
    if (iz1 - iz0 > 2 * D + 3) {
      names.push({ side: 'w', list: shophouseRow('z', ix0, -1, iz0 + D, iz1 - D, D, district, cx, cz) });
      names.push({ side: 'e', list: shophouseRow('z', ix1, 1, iz0 + D, iz1 - D, D, district, cx, cz) });
    }
    // Back-lot filler (often a condo tower poking out).
    const fx0 = ix0 + D; const fx1 = ix1 - D; const fz0 = iz0 + D; const fz1 = iz1 - D;
    if (fx1 - fx0 > 6 && fz1 - fz0 > 6) {
      const tall = (district === 'สยาม' || district === 'สุขุมวิท' || district === 'สีลม' || district === 'รัชดา') && R() < 0.55;
      const h = tall ? 35 + R() * 70 : 16 + R() * 10;
      B(tall ? 'glass' : 'wall', cx, cz).box(fx0 + 1, CURB, fz0 + 1, fx1 - 1, h, fz1 - 1, C(tall ? pick(TOWER_TINTS) : pick(WALLS)), { tile: tall ? [12, 14] : [16, 13.6], topColor: C('#8a8a8a'), uOffset: offs(), vOffset: offs(), ao: 0.3 });
      col.add(fx0 + 1, fz0 + 1, fx1 - 1, fz1 - 1);
    }
    // Street life on each sidewalk.
    streetLife('x', r.z0, 1, r.x0, r.x1, district, cx, cz);
    streetLife('x', r.z1, -1, r.x0, r.x1, district, cx, cz);
    streetLife('z', r.x0, 1, r.z0, r.z1, district, cx, cz);
    streetLife('z', r.x1, -1, r.z0, r.z1, district, cx, cz);
    // Destinations at the middle of each side, named after a shop there.
    for (const { side, list } of names) {
      if (!list.length) continue;
      const it = list[Math.floor(list.length / 2)];
      const shop = it.name.startsWith('ร้าน') || it.name.startsWith('ห้าง') ? it.name : `ร้าน${it.name}`;
      const p = side === 'n' ? { x: it.u, z: r.z0 } : side === 's' ? { x: it.u, z: r.z1 } : side === 'w' ? { x: r.x0, z: it.u } : { x: r.x1, z: it.u };
      pois.push({ name: `${shop} (${district})`, ...p, landmark: false });
    }
  }

  function towerLot(r, name, district) {
    sidewalk(r.x0, r.z0, r.x1, r.z1, 'tower', '#c9c5bd');
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    const m = SIDEWALK + 6;
    const split = R() < 0.5;
    const parts = split
      ? [[r.x0 + m, r.z0 + m, cx - 4, r.z1 - m], [cx + 4, r.z0 + m, r.x1 - m, r.z1 - m]]
      : [[r.x0 + m, r.z0 + m, r.x1 - m, r.z1 - m]];
    for (const [x0, z0, x1, z1] of parts) {
      const h = 50 + R() * 110;
      B('shop', cx, cz).box(x0 - 2, CURB, z0 - 2, x1 + 2, 7, z1 + 2, C('#f0f0f0'), { tile: [8, 3.5], ao: 0.35 });
      B('glass', cx, cz).box(x0, 7, z0, x1, h, z1, C(pick(TOWER_TINTS)), { tile: [12, 14], topColor: C('#7a7a7a'), uOffset: offs(), vOffset: offs() });
      B('plain', cx, cz).box(x0 + 3, h, z0 + 3, x1 - 3, h + 3, z1 - 3, C('#9aa0a6'));
      col.add(x0 - 2, z0 - 2, x1 + 2, z1 + 2);
    }
    for (let k = 0; k < 6; k++) tree(r.x0 + 4 + R() * (r.x1 - r.x0 - 8), r.z0 + 2, cx, cz, 0.7);
    if (name) {
      labels.push({ text: name, x: cx, y: 40, z: cz });
      pois.push({ name, x: cx, z: r.z1, landmark: true });
    } else {
      pois.push({ name: `${pick(['คอนโด', 'ออฟฟิศ', 'โรงแรม', 'ห้าง'])}${district}`, x: cx, z: r.z1, landmark: false });
    }
  }

  function templeLot(r, name) {
    sidewalk(r.x0, r.z0, r.x1, r.z1, 'temple', '#d8d2c4');
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    const p = B('plain', cx, cz);
    const m = SIDEWALK + 1;
    // white wall with a gate gap on the south side
    const wall = C('#f4f1ea');
    p.box(r.x0 + m, CURB, r.z0 + m, r.x1 - m, 2.4, r.z0 + m + 0.6, wall);
    p.box(r.x0 + m, CURB, r.z0 + m, r.x0 + m + 0.6, 2.4, r.z1 - m, wall);
    p.box(r.x1 - m - 0.6, CURB, r.z0 + m, r.x1 - m, 2.4, r.z1 - m, wall);
    p.box(r.x0 + m, CURB, r.z1 - m - 0.6, cx - 6, 2.4, r.z1 - m, wall);
    p.box(cx + 6, CURB, r.z1 - m - 0.6, r.x1 - m, 2.4, r.z1 - m, wall);
    col.add(r.x0 + m, r.z0 + m, r.x1 - m, r.z0 + m + 0.6);
    col.add(r.x0 + m, r.z0 + m, r.x0 + m + 0.6, r.z1 - m);
    col.add(r.x1 - m - 0.6, r.z0 + m, r.x1 - m, r.z1 - m);
    col.add(r.x0 + m, r.z1 - m - 0.6, cx - 6, r.z1 - m);
    col.add(cx + 6, r.z1 - m - 0.6, r.x1 - m, r.z1 - m);
    // gate posts
    p.box(cx - 6.5, CURB, r.z1 - m - 0.8, cx - 5.5, 6, r.z1 - m + 0.2, C('#e8c25a'));
    p.box(cx + 5.5, CURB, r.z1 - m - 0.8, cx + 6.5, 6, r.z1 - m + 0.2, C('#e8c25a'));
    p.box(cx - 6.5, 6, r.z1 - m - 0.8, cx + 6.5, 7, r.z1 - m + 0.2, C('#c0392b'));
    // ordination hall (โบสถ์): white body + stacked orange/green roofs
    const hx0 = cx - 9; const hx1 = cx + 9; const hz0 = cz - 18; const hz1 = cz + 8;
    p.box(hx0, CURB, hz0, hx1, 1.2, hz1, C('#efe9dc'));
    p.box(hx0 + 1, 1.2, hz0 + 1, hx1 - 1, 8, hz1 - 1, C('#fbf8f1'));
    col.add(hx0, hz0, hx1, hz1);
    for (let t = 0; t < 3; t++) {
      const inset = t * 1.6;
      const y0 = 8 + t * 3;
      const roofCol = t % 2 ? C('#1e8449') : C('#d35400');
      const g = new THREE.CylinderGeometry(0.01, 1, 1, 4, 1, false, Math.PI / 4);
      g.scale((hx1 - hx0 + 3 - inset * 2) / Math.SQRT2, 4.2, (hz1 - hz0 + 3 - inset * 2) / Math.SQRT2);
      g.translate(cx, y0 + 2.1, (hz0 + hz1) / 2);
      p.addGeometry(g, roofCol);
    }
    // golden chedi (เจดีย์)
    const chx = cx + 18; const chz = cz + 4;
    const tiers = [[6, 2], [5, 2], [4, 2], [3, 3]];
    let y = CURB;
    for (const [rad, h] of tiers) {
      const g = new THREE.CylinderGeometry(rad * 0.9, rad, h, 16);
      g.translate(chx, y + h / 2, chz);
      p.addGeometry(g, C('#e2b13c'));
      y += h;
    }
    const bell = new THREE.SphereGeometry(3, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    bell.translate(chx, y, chz);
    p.addGeometry(bell, C('#f1c40f'));
    const spire = new THREE.ConeGeometry(1.4, 16, 12);
    spire.translate(chx, y + 3 + 8, chz);
    p.addGeometry(spire, C('#f4d03f'));
    col.add(chx - 6, chz - 6, chx + 6, chz + 6);
    for (let k = 0; k < 8; k++) tree(r.x0 + 8 + R() * (r.x1 - r.x0 - 16), cz + 16 + R() * 10, cx, cz, 0.9);
    labels.push({ text: name, x: cx, y: 34, z: cz, bg: '#a04000' });
    pois.push({ name, x: cx, z: r.z1, landmark: true });
  }

  function parkLot(r, name) {
    sidewalk(r.x0, r.z0, r.x1, r.z1, 'park', '#b9b4aa');
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    const p = B('plain', cx, cz);
    p.box(r.x0 + SIDEWALK, CURB, r.z0 + SIDEWALK, r.x1 - SIDEWALK, CURB + 0.05, r.z1 - SIDEWALK, C('#5d9b4a'));
    const lake = new THREE.CylinderGeometry(16, 16, 0.1, 24);
    lake.scale(1.3, 1, 1);
    lake.translate(cx + 6, CURB + 0.08, cz - 4);
    p.addGeometry(lake, C('#4f8fa8'));
    col.add(cx + 6 - 19, cz - 4 - 14, cx + 6 + 19, cz - 4 + 14, 'water');
    for (let k = 0; k < 40; k++) {
      const x = r.x0 + 6 + R() * (r.x1 - r.x0 - 12);
      const z = r.z0 + 6 + R() * (r.z1 - r.z0 - 12);
      if (Math.hypot((x - cx - 6) / 1.3, z - cz + 4) < 19) continue;
      tree(x, z, cx, cz, 1 + R() * 0.5);
    }
    labels.push({ text: name, x: cx, y: 16, z: cz, bg: '#1e8449' });
    pois.push({ name, x: cx, z: r.z0, landmark: true });
  }

  function marketLot(r, name) {
    sidewalk(r.x0, r.z0, r.x1, r.z1, 'market', '#a9a499');
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    const p = B('plain', cx, cz);
    const aw = B('awning', cx, cz);
    // rows of stalls with colourful tarps, alleys between
    for (let z = r.z0 + SIDEWALK + 2; z < r.z1 - SIDEWALK - 6; z += 9) {
      for (let x = r.x0 + SIDEWALK + 2; x < r.x1 - SIDEWALK - 4; x += 5.2) {
        if (Math.abs(x - cx) < 3) continue; // centre alley
        p.box(x, CURB, z, x + 4.6, 1.0, z + 3.5, C(pick(['#c9b79c', '#a3a3a3', '#d8c3a5'])));
        const t = C(pick(['#e74c3c', '#3498db', '#f1c40f', '#2ecc71', '#e67e22', '#9b59b6']));
        const V = (a, b, c) => new THREE.Vector3(a, b, c);
        aw.quad(V(x - 0.3, 2.6, z + 4.2), V(x + 4.9, 2.6, z + 4.2), V(x + 4.9, 3.2, z - 0.3), V(x - 0.3, 3.2, z - 0.3), t);
        col.add(x, z, x + 4.6, z + 3.5, 'stall');
        if (R() < 0.4) {
          const v = makePerson(R);
          pose(v, 'stand');
          v.position.set(x + 2.3, CURB, z + 4.2);
          people.push(v);
        }
      }
    }
    labels.push({ text: name, x: cx, y: 14, z: cz, bg: '#c0392b' });
    pois.push({ name, x: cx, z: r.z1, landmark: true });
  }

  function monumentLot(r, name) {
    sidewalk(r.x0, r.z0, r.x1, r.z1, 'plaza', '#cfc8b8');
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    const p = B('plain', cx, cz);
    const base = new THREE.CylinderGeometry(14, 15, 1.2, 24);
    base.translate(cx, CURB + 0.6, cz);
    p.addGeometry(base, C('#bdb6a6'));
    for (let k = 0; k < 5; k++) { // five bayonet-shaped wings around an obelisk
      const a = (k / 5) * Math.PI * 2;
      p.rotBox(cx + Math.cos(a) * 3, 14, cz + Math.sin(a) * 3, 1.2, 26, 2.2, -a, C('#d8d2c2'));
    }
    const ob = new THREE.CylinderGeometry(0.6, 2.4, 40, 4);
    ob.translate(cx, CURB + 20, cz);
    p.addGeometry(ob, C('#e3ddcf'));
    col.add(cx - 15, cz - 15, cx + 15, cz + 15);
    for (let k = 0; k < 12; k++) tree(r.x0 + 6 + R() * (r.x1 - r.x0 - 12), r.z0 + 6 + R() * 8, cx, cz, 0.8);
    labels.push({ text: name, x: cx, y: 48, z: cz, bg: '#7f6a3a' });
    pois.push({ name, x: cx, z: r.z1, landmark: true });
  }

  // ---- blocks ----
  const special = new Map([
    ['1,1', { f: marketLot, name: 'ตลาดนัดจตุจักร' }],
    ['4,1', { f: monumentLot, name: 'อนุสาวรีย์ชัยสมรภูมิ' }],
    ['1,4', { f: templeLot, name: 'วัดโพธิ์' }],
    ['8,2', { f: templeLot, name: 'วัดพระราม 9' }],
    ['5,7', { f: parkLot, name: 'สวนลุมพินี' }],
    ['4,3', { f: towerLot, name: 'สยามสแควร์' }],
    ['3,6', { f: towerLot, name: 'โรงพยาบาลจุฬาฯ' }],
    ['7,4', { f: towerLot, name: 'ห้างราชประสงค์' }],
    ['6,8', { f: towerLot, name: 'ตึกสีลม' }],
    ['8,6', { f: towerLot, name: 'ห้างแยกอโศก' }],
    ['2,8', { f: marketLot, name: 'ตลาดเยาวราช' }],
  ]);

  let soiNo = 1;
  for (let bi = 0; bi < N; bi++) {
    for (let bj = 0; bj < N; bj++) {
      const r = blockRect(bi, bj);
      const cx = (r.x0 + r.x1) / 2;
      const cz = (r.z0 + r.z1) / 2;
      const district = districtOf(cx, cz);
      const sp = special.get(`${bi},${bj}`);
      if (sp) { sp.f(r, sp.name, district); continue; }
      if ((district === 'สยาม' || district === 'สีลม' || district === 'สุขุมวิท') && R() < 0.25) { towerLot(r, null, district); continue; }
      // Most blocks are cut by a soi (lane) into two lots.
      const soi = R();
      const SW = 7;
      if (soi < 0.4) { // north-south soi
        const sx = cx + (R() - 0.5) * 20;
        shophouseLot({ ...r, x1: sx - SW / 2 }, district, 'shop');
        shophouseLot({ ...r, x0: sx + SW / 2 }, district, 'shop');
        soiSign(sx, r.z0, 0, 1, soiNo++);
        soiSign(sx, r.z1, 0, -1, soiNo++);
      } else if (soi < 0.8) { // east-west soi
        const sz = cz + (R() - 0.5) * 20;
        shophouseLot({ ...r, z1: sz - SW / 2 }, district, 'shop');
        shophouseLot({ ...r, z0: sz + SW / 2 }, district, 'shop');
        soiSign(r.x0, sz, 1, 0, soiNo++);
        soiSign(r.x1, sz, -1, 0, soiNo++);
      } else {
        shophouseLot(r, district, 'shop');
      }
      if (district === 'ข้าวสาร' && bi === 2 && bj === 4) labels.push({ text: 'ถนนข้าวสาร', x: cx, y: 22, z: cz, bg: '#6c3483' });
    }
  }

  // Blue soi sign at a lane mouth. (dx,dz) points into the soi.
  function soiSign(x, z, dx, dz, n) {
    const px = x + (dz !== 0 ? 4.5 : dx * 1.5);
    const pz = z + (dx !== 0 ? 4.5 : dz * 1.5);
    const p = B('plain', px, pz);
    p.box(px - 0.05, CURB, pz - 0.05, px + 0.05, 3.2, pz + 0.05, C('#888'));
    // board faces along the road (both sides readable)
    const n0 = dz !== 0 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    for (const n1 of [n0, n0.clone().negate()]) facadeQuad(B('soi', px, pz), px + n1.x * 0.02, pz + n1.z * 0.02, n1, 0.8, 3.05, 3.55, C('#ffffff'), soiTex.uv(n));
  }

  // ---- edges: riverside on the west, a ring of shophouses elsewhere ----
  const E0 = HALF + roadW(0) / 2;
  const E1 = E0 + 40;
  for (let k = 0; k < N; k++) {
    const a = nodeX(k) + roadW(k) / 2;
    const b = nodeX(k + 1) - roadW(k + 1) / 2;
    shophouseLot({ x0: a, x1: b, z0: -E1, z1: -E0 }, districtOf((a + b) / 2, -HALF), 'edge');
    shophouseLot({ x0: a, x1: b, z0: E0, z1: E1 }, districtOf((a + b) / 2, HALF), 'edge');
    shophouseLot({ x0: E0, x1: E1, z0: a, z1: b }, districtOf(HALF, (a + b) / 2), 'edge');
    // riverside promenade
    sidewalk(-E0 - 12, a, -E0, b, 'river', '#c2b8a3');
    tree(-E0 - 6, (a + b) / 2, -E0, (a + b) / 2, 1);
  }
  // corners and the river railing
  for (const [x0, z0, x1, z1] of [[E0, -E1, E1, -E0], [E0, E0, E1, E1]]) { B('wall', x0, z0).box(x0, 0, z0, x1, 20, z1, C('#e8d5b0'), { tile: [16, 13.6], ao: 0.3 }); col.add(x0, z0, x1, z1); }
  col.add(-E1 - 30, -E1, riverX0 + 4, E1, 'water');
  B('plain', riverX0 + 4, 0).box(riverX0 + 3.6, 0, -E1, riverX0 + 4, 1.1, E1, C('#d9d9d9'));
  col.add(-E1 - 30, -E1 - 40, E1 + 40, -E1 + 4);
  col.add(-E1 - 30, E1 - 4, E1 + 40, E1 + 40);
  col.add(E1 - 4, -E1 - 40, E1 + 40, E1 + 40);
  B('plain', 0, -E1).box(-E1 - 30, 0, -E1 - 2, -E0 - 12, 1.2, -E1 + 4, C('#c8c8c8'));
  B('plain', 0, E1).box(-E1 - 30, 0, E1 - 4, -E0 - 12, 1.2, E1 + 2, C('#c8c8c8'));
  labels.push({ text: 'ท่าเรือ', x: -E0 - 6, y: 8, z: 0, bg: '#1f5f7a' });
  pois.push({ name: 'ท่าเรือริมแม่น้ำ', x: -E0, z: 15, landmark: true });

  // ---- road markings, medians, crosswalks ----
  const markWhite = C('#e9e9e9');
  const markYellow = C('#f2c230');
  const segs = []; // straight road segments for markings
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j < N; j++) {
      segs.push({ axis: 'z', at: nodeX(i), a: nodeX(j) + roadW(j) / 2, b: nodeX(j + 1) - roadW(j + 1) / 2, main: isMain(i), w: roadW(i), i });
      segs.push({ axis: 'x', at: nodeX(i), a: nodeX(j) + roadW(j) / 2, b: nodeX(j + 1) - roadW(j + 1) / 2, main: isMain(i), w: roadW(i), i });
    }
  }
  const markBox = (axis, at, off, a, b, w, color) => {
    const m = B('mark', axis === 'z' ? at : (a + b) / 2, axis === 'z' ? (a + b) / 2 : at);
    if (axis === 'z') m.box(at + off - w / 2, 0.01, a, at + off + w / 2, 0.02, b, color, { skip: { n: true, s: true, e: true, w: true } });
    else m.box(a, 0.01, at + off - w / 2, b, 0.02, at + off + w / 2, color, { skip: { n: true, s: true, e: true, w: true } });
  };
  for (const s of segs) {
    const len = s.b - s.a;
    if (s.main) {
      // raised median with shrubs (and BTS pillars on the BTS road)
      const bts = s.axis === 'x' && s.i === BTS_ROW;
      const mw = MEDIAN / 2;
      const ca = s.a + 2;
      const cb = s.b - 2;
      const pb = B('plain', s.axis === 'z' ? s.at : (ca + cb) / 2, s.axis === 'z' ? (ca + cb) / 2 : s.at);
      if (s.axis === 'z') { pb.box(s.at - mw, 0, ca, s.at + mw, 0.3, cb, C('#c9c3b5'), { topColor: C('#5e8f3e') }); col.add(s.at - mw, ca, s.at + mw, cb, 'median'); }
      else { pb.box(ca, 0, s.at - mw, cb, 0.3, s.at + mw, C('#c9c3b5'), { topColor: C('#5e8f3e') }); col.add(ca, s.at - mw, cb, s.at + mw, 'median'); }
      for (let u = ca + 14; u < cb - 6; u += 28) {
        const p = s.axis === 'z' ? { x: s.at, z: u } : { x: u, z: s.at };
        const [dx, dz] = s.axis === 'z' ? [1, 0] : [0, 1];
        medianLamps.push({ ...p, dx, dz, post: true }, { ...p, dx: -dx, dz: -dz, post: false });
      }
      if (bts) {
        for (let u = ca + 6; u < cb - 3; u += 24) {
          pb.box(u - 0.8, 0, s.at - 0.8, u + 0.8, BTS_Y, s.at + 0.8, C('#cfcfcf'));
          pb.box(u - 1, BTS_Y - 1.2, s.at - 4.6, u + 1, BTS_Y, s.at + 4.6, C('#c4c4c4'));
        }
      }
      for (const off of [5.2, 8.9]) {
        for (const sgn of [1, -1]) {
          for (let u = s.a + 2; u < s.b - 3; u += 9) markBox(s.axis, s.at, sgn * off, u, Math.min(u + 3, s.b - 2), 0.15, markWhite);
        }
      }
    } else {
      markBox(s.axis, s.at, 0.12, s.a + 1, s.b - 1, 0.12, markYellow);
      markBox(s.axis, s.at, -0.12, s.a + 1, s.b - 1, 0.12, markYellow);
    }
    // edge lines
    markBox(s.axis, s.at, s.w / 2 - 0.4, s.a, s.b, 0.12, markWhite);
    markBox(s.axis, s.at, -(s.w / 2 - 0.4), s.a, s.b, 0.12, markWhite);
    // zebra crossings at both ends
    for (const [u0, dir] of [[s.a, 1], [s.b, -1]]) {
      for (let o = -s.w / 2 + 1; o < s.w / 2 - 1; o += 1.2) {
        const ua = dir > 0 ? u0 + 0.6 : u0 - 3.6;
        markBox(s.axis, s.at, o + 0.3, ua, ua + 3, 0.6, markWhite);
      }
    }
    void len;
  }

  // ---- BTS skytrain deck + stations ----
  {
    const z = nodeX(BTS_ROW);
    const p = B('plain', 0, z);
    p.box(-HALF - 60, BTS_Y, z - 4.4, HALF + 60, BTS_Y + 1.1, z + 4.4, C('#d6d6d6'));
    p.box(-HALF - 60, BTS_Y + 1.1, z - 4.4, HALF + 60, BTS_Y + 2.0, z - 4.2, C('#bdbdbd'));
    p.box(-HALF - 60, BTS_Y + 1.1, z + 4.2, HALF + 60, BTS_Y + 2.0, z + 4.4, C('#bdbdbd'));
    for (const st of BTS_STATIONS) {
      const x = nodeX(st.block) + BLOCK / 2;
      p.box(x - 35, BTS_Y - 0.6, z - 11, x + 35, BTS_Y + 1.1, z + 11, C('#dcdcdc'));
      p.box(x - 35, BTS_Y + 6.2, z - 12, x + 35, BTS_Y + 6.8, z + 12, C('#7fa7b5'));
      for (const px of [-30, -10, 10, 30]) for (const pz of [-10.5, 10.5]) p.box(x + px - 0.2, BTS_Y + 1.1, z + pz - 0.2, x + px + 0.2, BTS_Y + 6.2, z + pz + 0.2, C('#9a9a9a'));
      // stairs down to both sidewalks, running along the road
      for (const sgn of [-1, 1]) {
        const sz = z + sgn * (roadW(BTS_ROW) / 2 + 1.6);
        const g = new THREE.BoxGeometry(16, 0.4, 2.4);
        g.rotateZ(0.62);
        g.translate(x + 28, BTS_Y / 2 - 0.2, sz);
        p.addGeometry(g, C('#bfbfbf'));
        p.box(x + 33, BTS_Y - 0.6, z + sgn * 11 - (sgn > 0 ? 0 : 6.6), x + 36, BTS_Y, z + sgn * 11 + (sgn > 0 ? 6.6 : 0), C('#d0d0d0'));
        col.add(x + 21.5, sz - 1.2, x + 28, sz + 1.2, 'stairs');
      }
      for (const sgn of [-1, 1]) {
        const s = new THREE.Mesh(new THREE.PlaneGeometry(14, 1.6), new THREE.MeshBasicMaterial({ map: labelTexture(`BTS ${st.name}`, { bg: '#0b6e4f', fg: '#fff', w: 1024, h: 120, font: 72 }) }));
        s.position.set(x, BTS_Y - 1.6, z + sgn * 11.05);
        s.rotation.y = sgn > 0 ? 0 : Math.PI;
        scene.add(s);
      }
      pois.push({ name: `BTS ${st.name}`, x: x + 14, z: z + roadW(BTS_ROW) / 2, landmark: true });
    }
  }
  const train = new THREE.Group();
  const trainWin = new THREE.MeshLambertMaterial({ color: 0x2b3a4a, emissive: 0xe8f0ff, emissiveIntensity: 0 });
  {
    for (let k = 0; k < 4; k++) {
      const car = new THREE.Group();
      car.add(new THREE.Mesh(new THREE.BoxGeometry(19.5, 3.4, 3.0), new THREE.MeshLambertMaterial({ color: 0xf4f4f4 })));
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(19.6, 0.5, 3.05), new THREE.MeshLambertMaterial({ color: k % 2 ? 0x1b7a3e : 0x1f4fbf }));
      stripe.position.y = -0.8;
      car.add(stripe);
      const win = new THREE.Mesh(new THREE.BoxGeometry(18, 1.1, 3.06), trainWin);
      win.position.y = 0.6;
      car.add(win);
      car.position.x = k * 20;
      car.children.forEach((m) => { m.castShadow = true; });
      train.add(car);
    }
    train.position.set(-HALF, BTS_Y + 1.1 + 1.9, nodeX(BTS_ROW) - 2);
    scene.add(train);
  }
  const trainState = { x: -HALF, dir: 1, wait: 0 };
  function updateTrain(dt) {
    if (trainState.wait > 0) { trainState.wait -= dt; return; }
    const prev = trainState.x;
    trainState.x += trainState.dir * 16 * dt;
    for (const st of BTS_STATIONS) {
      const sx = nodeX(st.block) + BLOCK / 2 - 30;
      if ((prev - sx) * (trainState.x - sx) <= 0 && prev !== sx) { trainState.x = sx; trainState.wait = 6; }
    }
    if (trainState.x > HALF - 40) { trainState.dir = -1; trainState.x = HALF - 40; }
    if (trainState.x < -HALF - 40) { trainState.dir = 1; trainState.x = -HALF - 40; }
    train.position.x = trainState.x;
    train.position.z = nodeX(BTS_ROW) + (trainState.dir > 0 ? -2 : 2);
  }

  // ---- win stands (ซุ้มวินมอเตอร์ไซค์) ----
  const standSpots = [
    { bi: 4, bj: 4, corner: [1, 1], name: 'วินปากซอยสยาม' },
    { bi: 1, bj: 2, corner: [1, 0], name: 'วินหน้าตลาด' },
    { bi: 6, bj: 6, corner: [0, 0], name: 'วินชิดลม' },
    { bi: 2, bj: 7, corner: [1, 0], name: 'วินเยาวราช' },
    { bi: 8, bj: 3, corner: [0, 1], name: 'วินรัชดา' },
  ];
  let vestNo = 1;
  for (const s of standSpots) {
    const r = blockRect(s.bi, s.bj);
    // stand on the sidewalk of the block's south or north edge near a corner
    const x = s.corner[0] ? r.x1 - 9 : r.x0 + 9;
    const zEdge = s.corner[1] ? r.z1 : r.z0;
    const inward = s.corner[1] ? -1 : 1;
    const z = zEdge + inward * 1.6;
    const p = B('plain', x, z);
    for (const [dx, dz] of [[-2.2, -1.1], [2.2, -1.1], [-2.2, 1.1], [2.2, 1.1]]) p.box(x + dx - 0.06, CURB, z + dz - 0.06, x + dx + 0.06, CURB + 2.6, z + dz + 0.06, C('#555'));
    p.box(x - 2.6, CURB + 2.6, z - 1.5, x + 2.6, CURB + 2.8, z + 1.5, C('#ff7a00'));
    p.box(x - 2, CURB, z - 0.3 * inward - 0.25, x + 2, CURB + 0.45, z - 0.3 * inward + 0.25, C('#6b4f35'));
    col.add(x - 2.3, z - 1.2, x + 2.3, z + 1.2, 'stand');
    board(labelTexture('วินมอเตอร์ไซค์รับจ้าง', { bg: '#ff7a00', fg: '#111', w: 768, h: 116, font: 60 }), 4.6, 0.7, x, CURB + 3.2, z, 0);
    for (let k = 0; k < 2; k++) {
      const v = makePerson(R, { vest: vestNo++ });
      pose(v, 'sit');
      v.position.set(x - 1.2 + k * 2.2, CURB, z - 0.3 * inward);
      v.rotation.y = inward < 0 ? 0 : Math.PI;
      people.push(v);
    }
    stands.push({ name: s.name, x, z: zEdge - inward * 2.5, sx: x, sz: z });
    labels.push({ text: `🛵 ${s.name}`, x, y: 9, z, bg: '#ff7a00', fg: '#111', small: true });
    pois.push({ name: s.name, x, z: zEdge, landmark: true });
  }

  // ---- poles & wires ----
  let lampMat = null;
  let poolMat = null;
  {
    const g = new THREE.CylinderGeometry(0.12, 0.17, 9, 6);
    g.translate(0, 4.5, 0);
    const im = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ color: 0x8c8c8c }), poleSpots.length);
    const arm = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.12, 0.12), new THREE.MeshLambertMaterial({ color: 0x777777 }), poleSpots.length * 2);
    const m4 = new THREE.Matrix4();
    poleSpots.forEach((p, k) => {
      m4.makeTranslation(p.x, CURB, p.z);
      im.setMatrixAt(k, m4);
      m4.makeTranslation(p.x, CURB + 8.2, p.z); arm.setMatrixAt(k * 2, m4);
      m4.makeTranslation(p.x, CURB + 7.4, p.z); arm.setMatrixAt(k * 2 + 1, m4);
    });
    im.castShadow = true;
    scene.add(im, arm);

    // Street lamps hang off every other pole over the road; at night each throws a pool of light on the asphalt.
    const lamps = [...poleSpots.filter((_, k) => k % 2 === 0), ...medianLamps];
    const posts = medianLamps.filter((l) => l.post);
    const postMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.14, 8.3, 6).translate(0, 4.15, 0), new THREE.MeshLambertMaterial({ color: 0x8a8a8a }), posts.length);
    posts.forEach((p, k) => { m4.makeTranslation(p.x, 0.3, p.z); postMesh.setMatrixAt(k, m4); });
    postMesh.castShadow = true;
    scene.add(postMesh);
    const armG = new THREE.BoxGeometry(0.08, 0.08, 2.2).translate(0, 0, 1.1);
    const headG = new THREE.BoxGeometry(0.35, 0.14, 0.7);
    const lampArm = new THREE.InstancedMesh(armG, new THREE.MeshLambertMaterial({ color: 0x6f6f6f }), lamps.length);
    lampMat = new THREE.MeshLambertMaterial({ color: 0x9a9a9a, emissive: 0xffc27a, emissiveIntensity: 0 });
    const lampHead = new THREE.InstancedMesh(headG, lampMat, lamps.length);
    poolMat = new THREE.MeshBasicMaterial({ map: poolTexture(), color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const pool = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), poolMat, lamps.length);
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3(1, 1, 1);
    const pos = new THREE.Vector3();
    const col4 = new THREE.Color();
    lamps.forEach((p, k) => {
      const yaw = Math.atan2(p.dx, p.dz);
      q.setFromAxisAngle(UP, yaw);
      const top = p.post === undefined ? CURB + 8.0 : 8.4;
      m4.compose(pos.set(p.x, top, p.z), q, sc.set(1, 1, 1)); lampArm.setMatrixAt(k, m4);
      m4.compose(pos.set(p.x + p.dx * 2.2, top - 0.05, p.z + p.dz * 2.2), q, sc); lampHead.setMatrixAt(k, m4);
      m4.compose(pos.set(p.x + p.dx * 3.5, 0.04, p.z + p.dz * 3.5), q, sc.set(15, 1, 15)); pool.setMatrixAt(k, m4);
      // mostly old sodium lamps (orange), some new white LEDs
      pool.setColorAt(k, p.post !== undefined ? col4.set(0xe9efff) : R() < 0.75 ? col4.set(0xffa860) : col4.set(0xdfe8ff)); // main roads have newer white lamps
    });
    scene.add(lampArm, lampHead, pool);
    const pts = [];
    for (const run of wireRuns) {
      for (let k = 0; k < run.length - 1; k++) {
        const a = run[k]; const b = run[k + 1];
        for (let w = 0; w < 5; w++) {
          const h0 = 6.6 + w * 0.4 + (R() - 0.5) * 0.3;
          const sag = 0.6 + R() * 1.4;
          const off = (w - 2) * 0.25;
          const ax = a.x + (a.z === b.z ? 0 : off); const az = a.z + (a.x === b.x ? 0 : off);
          const bx = b.x + (a.z === b.z ? 0 : off); const bz = b.z + (a.x === b.x ? 0 : off);
          let prev = null;
          for (let t = 0; t <= 6; t++) {
            const f = t / 6;
            const pt = [ax + (bx - ax) * f, h0 - sag * 4 * f * (1 - f), az + (bz - az) * f];
            if (prev) pts.push(...prev, ...pt);
            prev = pt;
          }
        }
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    scene.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x1a1a1a })));
  }

  // ---- finish meshes ----
  for (const { kind, b } of chunks.values()) {
    if (b.empty) continue;
    const m = b.mesh(M[kind], { cast: shadows && kind !== 'mark' && kind !== 'sign' && kind !== 'soi' && kind !== 'pave', receive: true });
    scene.add(m);
  }
  // Bake the standing / sitting extras into one mesh: hundreds of little people, one draw call.
  {
    const pb = new GeoBuilder();
    const live = [];
    for (const p of people) {
      let textured = false;
      p.traverse((o) => { if (o.isMesh && o.material.map) textured = true; });
      if (textured) { live.push(p); continue; } // vest numbers need their texture
      p.updateMatrixWorld(true);
      p.traverse((o) => {
        if (!o.isMesh) return;
        const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
        pb.addGeometry(g, o.material.color);
      });
    }
    if (!pb.empty) scene.add(pb.mesh(M.plain, { cast: shadows, receive: false }));
    for (const p of live) scene.add(p);
  }
  for (const l of labels) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(l.text, { bg: l.bg || '#222', fg: l.fg || '#fff', w: 512, h: 112, font: 54 }), depthWrite: false, fog: false }));
    s.position.set(l.x, l.y, l.z);
    const k = l.small ? 5 : 13;
    s.scale.set(k, k * 112 / 512, 1);
    s.renderOrder = 5;
    scene.add(s);
  }

  // ---- queries ----
  function groundHeight(x, z) {
    for (const l of nearLots(x, z)) if (x >= l.x0 && x <= l.x1 && z >= l.z0 && z <= l.z1) return CURB;
    return 0;
  }
  const lotGrid = new Map();
  for (const l of lots) {
    for (let a = Math.floor(l.x0 / 50); a <= Math.floor(l.x1 / 50); a++) for (let b = Math.floor(l.z0 / 50); b <= Math.floor(l.z1 / 50); b++) {
      const k = a * 1000 + b;
      if (!lotGrid.has(k)) lotGrid.set(k, []);
      lotGrid.get(k).push(l);
    }
  }
  function nearLots(x, z) { return lotGrid.get(Math.floor(x / 50) * 1000 + Math.floor(z / 50)) || []; }

  function placeName(x, z) {
    const i = Math.round((x + HALF) / BLOCK);
    const j = Math.round((z + HALF) / BLOCK);
    const onNS = i >= 0 && i <= N && Math.abs(x - nodeX(i)) < roadW(i) / 2;
    const onEW = j >= 0 && j <= N && Math.abs(z - nodeX(j)) < roadW(j) / 2;
    if (onNS && onEW) return `แยก ${NS_ROADS[i].replace('ถ.', '')} × ${EW_ROADS[j].replace('ถ.', '')}`;
    if (onNS) return NS_ROADS[i];
    if (onEW) return EW_ROADS[j];
    return groundHeight(x, z) > 0 ? 'บนทางเท้า 😅' : 'ในซอย';
  }

  // Keep only destinations a rider can actually pull up to: some open road inside the city
  // within a few metres. (Shops on the outer side of the border rows face nothing.)
  {
    const lim = HALF + roadW(0) / 2;
    const reachable = (q) => {
      for (let a = 0; a < 24; a++) for (const r of [2, 3.5, 5, 6.5]) {
        const x = q.x + Math.cos((a / 24) * Math.PI * 2) * r;
        const z = q.z + Math.sin((a / 24) * Math.PI * 2) * r;
        if (Math.abs(x) > lim || Math.abs(z) > lim) continue;
        if (!col.resolve({ x, z }, 0.6)) return true;
      }
      return false;
    };
    for (let k = pois.length - 1; k >= 0; k--) if (!reachable(pois[k])) pois.splice(k, 1);
  }

  // n: 0 = full day, 1 = deep night. Called by the sky every frame.
  function setNight(n) {
    const dusk = Math.min(1, n * 1.6); // lights come on before it is fully dark
    M.wall.emissiveIntensity = dusk * 0.7;
    M.shop.emissiveIntensity = dusk * 0.85;
    M.glass.emissiveIntensity = dusk * 0.5;
    lampMat.emissiveIntensity = dusk * 6;
    poolMat.opacity = dusk * 0.55;
    trainWin.emissiveIntensity = dusk * 1.4;
    // signs are backlit at night: keep them bright; by day they dim a little to sit in the scene
    M.sign.color.setScalar(0.82 + 0.25 * dusk);
    M.soi.color.setScalar(0.85 + 0.15 * dusk);
  }

  // ---- the road graph (every system that drives or routes uses this) ----
  const net = new RoadNet();
  const grid = [];
  for (let i = 0; i <= N; i++) { grid.push([]); for (let j = 0; j <= N; j++) grid[i].push(net.addNode(nodeX(i), nodeX(j), { signal: true })); }
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    if (i < N) { const a = grid[i][j]; const b = grid[i + 1][j]; net.addEdge(a, b, [{ x: a.x, z: a.z }, { x: b.x, z: b.z }], { width: roadW(j), lanes: laneOffsets(j), main: isMain(j), name: EW_ROADS[j], median: isMain(j) ? MEDIAN : 0 }); }
    if (j < N) { const a = grid[i][j]; const b = grid[i][j + 1]; net.addEdge(a, b, [{ x: a.x, z: a.z }, { x: b.x, z: b.z }], { width: roadW(i), lanes: laneOffsets(i), main: isMain(i), name: NS_ROADS[i], median: isMain(i) ? MEDIAN : 0 }); }
  }
  net.finalize();
  const third = (N * BLOCK) / 3;
  const districtLabels = DISTRICTS.flatMap((row, b) => row.map((name, a) => ({ name, x: -HALF + third * (a + 0.5), z: -HALF + third * (b + 0.5) })));
  const bounds = { x0: -HALF - 160, z0: -HALF - 160, x1: HALF + 160, z1: HALF + 160 };

  const mapPolys = [{ color: '#4c7f95', pts: [{ x: bounds.x0, z: bounds.z0 }, { x: -HALF - 70, z: bounds.z0 }, { x: -HALF - 70, z: bounds.z1 }, { x: bounds.x0, z: bounds.z1 }] }];

  return { style: 'grid', colliders: col, lots, pois, stands, groundHeight, placeName, updateTrain, people, setNight, net, districtLabels, bounds, districtOf, mapPolys };
}
