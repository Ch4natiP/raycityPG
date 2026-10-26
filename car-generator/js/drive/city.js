// The city around the car, built from the game's own minimap (ui/minimap/kr, pulled out by
// tools/extract-city.mjs as class maps: 0 none, 1 block, 2 lane, 3 road; 256 px over 1024 m, row 0 = the tile's
// largest y). Each tile becomes a ground plane (asphalt / pavement / grass painted from the map) with buildings
// on the blocks, turned like the tile's roads, and trees along the kerbs. Tiles are built around the car and
// dropped behind it. RayCity world (x, y) → three (x − ox, −(y − oy)).
import * as THREE from 'three';

const TILE = 1024; const PX = 256; const M = TILE / PX; // metres per map pixel

// small seeded random, so a tile always looks the same
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; }; }

function facadeTexture() {
  // one bay (6 m) by one floor (3.5 m): wall (tinted by the vertex colour) and a window
  const c = document.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 64);
  const grd = g.createLinearGradient(0, 10, 0, 50); grd.addColorStop(0, '#31465e'); grd.addColorStop(0.5, '#6f8fae'); grd.addColorStop(1, '#22344a');
  g.fillStyle = grd; g.fillRect(8, 12, 48, 34);
  g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(8, 12, 48, 3);
  g.fillStyle = '#c9c9c9'; g.fillRect(0, 56, 64, 8);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export function createCity(scene, data, opts = {}) {
  const BUILD = opts.build || 2600; const TREES = opts.trees || 260;
  const tiles = new Map(); // 'A_B' → { cls: Uint8Array(256²), A, B, angle, built: { group, blocks } }
  const group = new THREE.Group(); scene.add(group);
  let ox = 0; let oy = 0;
  const facade = facadeTexture();
  const matSide = new THREE.MeshStandardMaterial({ map: facade, vertexColors: true, roughness: 0.75, metalness: 0.05 });
  const matRoof = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.25, 2.2, 6).translate(0, 1.1, 0);
  const crownGeo = new THREE.IcosahedronGeometry(1.9, 1).translate(0, 3.4, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#5a4030', roughness: 1 });
  const crownMat = new THREE.MeshStandardMaterial({ vertexColors: false, roughness: 0.9 });
  const lineMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 });
  const minimapTiles = new Map(); // 'A_B' → canvas, coloured like the game's minimap
  const segs = new Map(); // traffic lane segments [ax, ay, bx, by, ...] by 25 m cell, RayCity metres

  async function load() {
    const roads = data.roads.kr || [];
    for (const [k, b64] of Object.entries(data.look.tiles)) {
      const m = /^kr_(\d+)_(\d+)$/.exec(k); if (!m) continue;
      const bm = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }));
      const cv = document.createElement('canvas'); cv.width = cv.height = PX; const g = cv.getContext('2d'); g.drawImage(bm, 0, 0);
      const px = g.getImageData(0, 0, PX, PX).data; const cls = new Uint8Array(PX * PX);
      for (let i = 0; i < cls.length; i++) cls[i] = Math.round(px[i * 4] / 85);
      tiles.set(`${+m[1]}_${+m[2]}`, { A: +m[1], B: +m[2], cls, bitmap: bm, angle: 0 });
    }
    // each tile's main road direction (mod 90°), weighted by length, for turning its buildings
    const hist = new Map(); segs.clear();
    for (const l of roads) {
      let x = 0; let y = 0; let px = null; let py = null;
      for (let i = 0; i < l.length; i += 3) {
        x += l[i] / 10; y += l[i + 1] / 10;
        if (px !== null) {
          const k = `${1000 + 2 * Math.floor(x / TILE)}_${1000 + 2 * Math.floor(y / TILE)}`; const L = Math.hypot(x - px, y - py);
          if (L > 0.5) { const sk = `${Math.floor((x + px) / 2 / 25)},${Math.floor((y + py) / 2 / 25)}`; let c = segs.get(sk); if (!c) segs.set(sk, (c = [])); c.push(px, py, x, y); }
          if (L > 1) { let h = hist.get(k); if (!h) hist.set(k, (h = new Float32Array(18))); const a = ((Math.atan2(y - py, x - px) % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2); h[Math.min(17, Math.floor((a / (Math.PI / 2)) * 18))] += L; }
        }
        px = x; py = y;
      }
    }
    for (const [k, t] of tiles) { const h = hist.get(k); if (h) { let bi = 0; for (let i = 1; i < 18; i++) if (h[i] > h[bi]) bi = i; t.angle = ((bi + 0.5) / 18) * (Math.PI / 2); } }
    for (const [k, t] of tiles) {
      const cv = document.createElement('canvas'); cv.width = cv.height = PX; const g = cv.getContext('2d'); const im = g.createImageData(PX, PX);
      const C = [[29, 39, 51], [47, 74, 53], [125, 138, 143], [232, 238, 240]];
      for (let i = 0; i < t.cls.length; i++) { const c = C[t.cls[i]] || C[0]; im.data.set([c[0], c[1], c[2], 255], i * 4); }
      g.putImageData(im, 0, 0); minimapTiles.set(k, cv);
    }
  }

  // RayCity world → map class
  function classRC(x, y) {
    const A = 1000 + 2 * Math.floor(x / TILE); const B = 1000 + 2 * Math.floor(y / TILE); const t = tiles.get(`${A}_${B}`); if (!t) return 0;
    const u = Math.floor((x - (A - 1000) * 512) / M); const v = Math.floor(((B - 1000) * 512 + TILE - y) / M);
    return t.cls[Math.min(PX - 1, Math.max(0, v)) * PX + Math.min(PX - 1, Math.max(0, u))];
  }
  const classAt = (X, Z) => classRC(X + ox, oy - Z);

  function groundTexture(t) {
    const S = 1024; const cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d');
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(t.bitmap, 0, 0, S, S);
    const im = g.getImageData(0, 0, S, S); const d = im.data; const r = rng(t.A * 7919 + t.B);
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i]; const n = (r() - 0.5) * 14;
      let c;
      if (v < 120) c = [74 + n, 150 + n * 1.4, 46 + n]; // grass
      else if (v < 200) c = [172 + n, 168 + n, 158 + n]; // pavement / lanes / kerbs
      else c = [96 + n * 0.6, 99 + n * 0.6, 106 + n * 0.6]; // asphalt
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    }
    // white edge lines where the asphalt meets the kerb (asphalt pixels with pavement or grass 1 px away)
    const asph = new Uint8Array(S * S); for (let i = 0; i < S * S; i++) asph[i] = d[i * 4] < 120 && d[i * 4 + 2] > d[i * 4 + 1] - 4 ? 1 : 0;
    for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) {
      const i = y * S + x; if (!asph[i] || (asph[i - 1] && asph[i + 1] && asph[i - S] && asph[i + S])) continue;
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 225;
    }
    g.putImageData(im, 0, 0);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    return tex;
  }

  // an opposite traffic lane within 1.6 m of (x, y)? (direction dx, dy)
  function oppositeNear(x, y, dx, dy) {
    const c = segs.get(`${Math.floor(x / 25)},${Math.floor(y / 25)}`); if (!c) return false;
    for (let k = 0; k < c.length; k += 4) {
      const ex = c[k + 2] - c[k]; const ey = c[k + 3] - c[k + 1]; const L = Math.hypot(ex, ey) || 1; if ((ex * dx + ey * dy) / L > -0.5) continue;
      const tt = Math.max(0, Math.min(1, ((x - c[k]) * ex + (y - c[k + 1]) * ey) / (L * L))); if (Math.hypot(c[k] + ex * tt - x, c[k + 1] + ey * tt - y) < 1.6) return true;
    }
    return false;
  }
  // a lane crossing (x, y) within 10 m at an angle: an intersection, where no lines are painted
  function crossing(x, y, dx, dy) {
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const c = segs.get(`${Math.floor(x / 25) + i},${Math.floor(y / 25) + j}`); if (!c) continue;
      for (let k = 0; k < c.length; k += 4) {
        const ex = c[k + 2] - c[k]; const ey = c[k + 3] - c[k + 1]; const L = Math.hypot(ex, ey) || 1; if (Math.abs((ex * dx + ey * dy) / L) > 0.87) continue;
        const tt = Math.max(0, Math.min(1, ((x - c[k]) * ex + (y - c[k + 1]) * ey) / (L * L))); if (Math.hypot(c[k] + ex * tt - x, c[k + 1] + ey * tt - y) < 10) return true;
      }
    }
    return false;
  }
  // lane lines from the game's traffic lanes (lane centres) as flat strips just over the ground: 1.75 m to a
  // lane's left lies either the centre line (an opposite lane 3.5 m over: solid yellow) or the line to the next
  // lane (white dashes, 3 m every 8 m); only over asphalt
  function markings(t, W) {
    const x0 = (t.A - 1000) * 512; const y0 = (t.B - 1000) * 512; const pos = []; const col = [];
    const quad = (ax, ay, bx, by, w, c) => {
      const L = Math.hypot(bx - ax, by - ay); const nx = (-(by - ay) / L) * w / 2; const ny = ((bx - ax) / L) * w / 2;
      const q = [[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]].map(([x, y]) => W(x, y));
      for (const k of [0, 2, 1, 0, 3, 2]) { pos.push(q[k][0], 0.03, q[k][1]); col.push(...c); }
    };
    const Y = [0.93, 0.72, 0.12]; const Wt = [0.92, 0.92, 0.92];
    for (let cy = Math.floor(y0 / 25); cy < Math.floor((y0 + TILE) / 25); cy++) for (let cx = Math.floor(x0 / 25); cx < Math.floor((x0 + TILE) / 25); cx++) {
      const c = segs.get(`${cx},${cy}`); if (!c) continue;
      for (let k = 0; k < c.length; k += 4) {
        const ax = c[k]; const ay = c[k + 1]; const bx = c[k + 2]; const by = c[k + 3]; const L = Math.hypot(bx - ax, by - ay); if (L < 1) continue;
        const dx = (bx - ax) / L; const dy = (by - ay) / L; const lx = -dy * 1.75; const ly = dx * 1.75;
        const mx = (ax + bx) / 2; const my = (ay + by) / 2;
        if (classRC(mx + lx, my + ly) !== 3) continue;
        const yellow = oppositeNear(mx + lx * 2, my + ly * 2, dx, dy);
        for (let s0 = 0; s0 < L; s0 += yellow ? 4 : 8) {
          const s1 = Math.min(L, s0 + (yellow ? 4 : 3)); const px = ax + dx * s0 + lx; const py = ay + dy * s0 + ly;
          if (classRC(px, py) === 3 && !crossing(px, py, dx, dy)) quad(px, py, ax + dx * s1 + lx, ay + dy * s1 + ly, yellow ? 0.18 : 0.15, yellow ? Y : Wt);
        }
      }
    }
    if (!pos.length) return null;
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const nrm = new Float32Array(pos.length); for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1; geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    const m = new THREE.Mesh(geo, lineMat); m.receiveShadow = true; m.renderOrder = 1; return m;
  }

  function buildTile(t) {
    const g = new THREE.Group(); const blocks = [];
    const x0 = (t.A - 1000) * 512; const y0 = (t.B - 1000) * 512;
    const W = (x, y) => [x - ox, -(y - oy)];
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(TILE, TILE), new THREE.MeshStandardMaterial({ map: groundTexture(t), roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2; const [gx, gz] = W(x0 + TILE / 2, y0 + TILE / 2); ground.position.set(gx, 0, gz); ground.receiveShadow = true; g.add(ground);
    const lines = markings(t, W); if (lines) g.add(lines);
    // buildings: footprints turned like the tile's roads, kept where the map is block all round them
    const r = rng(t.A * 104729 + t.B * 31); const ca = Math.cos(t.angle); const sa = Math.sin(t.angle);
    const pos = []; const col = []; const uv = []; const side = []; const roof = [];
    const free = (cx, cy, hx, hy, pad) => {
      for (let a = -hx - pad; a <= hx + pad; a += 3) for (let b = -hy - pad; b <= hy + pad; b += 3) {
        const x = cx + a * ca - b * sa; const y = cy + a * sa + b * ca;
        if (x < x0 || y < y0 || x >= x0 + TILE || y >= y0 + TILE || classRC(x, y) !== 1) return false;
      }
      return true;
    };
    const taken = [];
    const overlaps = (cx, cy, rr) => taken.some((q) => Math.hypot(q[0] - cx, q[1] - cy) < q[2] + rr);
    for (let i = 0; i < BUILD; i++) {
      const cx = x0 + r() * TILE; const cy = y0 + r() * TILE;
      if (classRC(cx, cy) !== 1) continue;
      const hx = 4 + r() * 10; const hy = 4 + r() * 10; const rr = Math.hypot(hx, hy);
      if (overlaps(cx, cy, rr * 0.8) || !free(cx, cy, hx, hy, 3)) continue;
      taken.push([cx, cy, rr * 0.8]);
      const tall = r(); const h = tall > 0.93 ? 40 + r() * 50 : tall > 0.6 ? 16 + r() * 22 : 7 + r() * 10;
      const tint = [[0.86, 0.86, 0.84], [0.7, 0.74, 0.8], [0.9, 0.85, 0.76], [0.55, 0.6, 0.68], [0.8, 0.78, 0.82], [0.35, 0.45, 0.7]][Math.floor(r() * 6)];
      const corners = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(([a, b]) => W(cx + a * ca - b * sa, cy + a * sa + b * ca));
      // walls
      for (let k = 0; k < 4; k++) {
        const p = corners[k]; const q = corners[(k + 1) % 4]; const L = Math.hypot(q[0] - p[0], q[1] - p[1]); const base = pos.length / 3;
        pos.push(p[0], 0, p[1], q[0], 0, q[1], q[0], h, q[1], p[0], h, p[1]);
        uv.push(0, 0, L / 6, 0, L / 6, h / 3.5, 0, h / 3.5);
        for (let j = 0; j < 4; j++) col.push(...tint);
        side.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      const base = pos.length / 3; const rt = tint.map((c) => c * 0.55);
      for (const p of corners) { pos.push(p[0], h, p[1]); uv.push(0, 0); col.push(...rt); }
      roof.push(base, base + 1, base + 2, base, base + 2, base + 3);
      const [bx, bz] = W(cx, cy); const u = [corners[1][0] - corners[0][0], corners[1][1] - corners[0][1]]; const ul = Math.hypot(u[0], u[1]);
      blocks.push({ x: bx, z: bz, ux: u[0] / ul, uz: u[1] / ul, hx, hz: hy });
    }
    if (pos.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex([...side, ...roof]); geo.addGroup(0, side.length, 0); geo.addGroup(side.length, roof.length, 1);
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, [matSide, matRoof]); m.castShadow = true; m.receiveShadow = true; g.add(m);
    }
    // trees on the grass along the kerbs: green and the odd pink one
    const spots = [];
    for (let i = 0; i < TREES * 5.4 && spots.length < TREES; i++) {
      const x = x0 + r() * TILE; const y = y0 + r() * TILE;
      if (classRC(x, y) !== 1) continue;
      let near = false; for (const [a, b] of [[6, 0], [-6, 0], [0, 6], [0, -6]]) if (classRC(x + a, y + b) >= 2) near = true;
      if (!near || overlaps(x, y, 2.5)) continue; spots.push([x, y]);
    }
    if (spots.length) {
      const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length); const crowns = new THREE.InstancedMesh(crownGeo, crownMat, spots.length);
      const mtx = new THREE.Matrix4(); const c = new THREE.Color();
      spots.forEach(([x, y], i) => {
        const [X, Z] = W(x, y); const s = 0.8 + r() * 0.6; mtx.makeScale(s, s, s).setPosition(X, 0, Z); trunks.setMatrixAt(i, mtx); crowns.setMatrixAt(i, mtx);
        crowns.setColorAt(i, r() < 0.25 ? c.setHSL(0.93, 0.55, 0.62 + r() * 0.1) : c.setHSL(0.27 + r() * 0.06, 0.5, 0.28 + r() * 0.1));
        blocks.push({ x: X, z: Z, ux: 1, uz: 0, hx: 0.35, hz: 0.35 });
      });
      trunks.castShadow = crowns.castShadow = true; g.add(trunks, crowns);
    }
    group.add(g);
    // collision grid for the tile (40 m cells)
    const grid = new Map();
    for (const b of blocks) {
      const R = Math.hypot(b.hx, b.hz);
      for (let i = Math.floor((b.x - R) / 40); i <= Math.floor((b.x + R) / 40); i++) for (let j = Math.floor((b.z - R) / 40); j <= Math.floor((b.z + R) / 40); j++) {
        const k = `${i},${j}`; let cell = grid.get(k); if (!cell) grid.set(k, (cell = [])); cell.push(b);
      }
    }
    t.built = { group: g, grid };
  }
  function dropTile(t) {
    t.built.group.traverse((o) => { if (o.geometry && o.geometry !== trunkGeo && o.geometry !== crownGeo) o.geometry.dispose(); if (o.material && !Array.isArray(o.material) && o.material !== lineMat && o.material.map && o.material.map !== facade) { o.material.map.dispose(); o.material.dispose(); } });
    group.remove(t.built.group); t.built = null;
  }

  return {
    load,
    get count() { return tiles.size; },
    get origin() { return [ox, oy]; },
    classRC,
    hasTile(A, B) { return tiles.has(`${A}_${B}`); },
    isBuilt(A, B) { const t = tiles.get(`${A}_${B}`); return !!(t && t.built); },
    classAt,
    setOrigin(x, y) { for (const t of tiles.values()) if (t.built) dropTile(t); ox = x; oy = y; },
    clear() { for (const t of tiles.values()) if (t.built) dropTile(t); },
    // build the tiles within reach of the car (one per call, nearest first), drop the far ones
    // false: no ground, buildings or trees (the real city is shown instead); the map data stays for the minimap
    visuals: true,
    update(X, Z, reach = 1) {
      if (!this.visuals) { for (const t of tiles.values()) if (t.built) dropTile(t); return false; }
      const x = X + ox; const y = oy - Z; const A = 1000 + 2 * Math.floor(x / TILE); const B = 1000 + 2 * Math.floor(y / TILE);
      let best = null; let bd = Infinity;
      for (const t of tiles.values()) {
        const da = Math.abs(t.A - A) / 2; const db = Math.abs(t.B - B) / 2;
        if (t.built && (da > reach + 1 || db > reach + 1)) dropTile(t);
        else if (!t.built && da <= reach && db <= reach) { const cx = (t.A - 1000) * 512 + 512; const cy = (t.B - 1000) * 512 + 512; const d = Math.hypot(cx - x, cy - y); if (d < bd) { bd = d; best = t; } }
      }
      if (best) buildTile(best);
      return !!best;
    },
    // a building or tree under a circle of radius r: its outward normal (nx, nz), or null
    hit(X, Z, r) {
      const x = X + ox; const y = oy - Z; const t = tiles.get(`${1000 + 2 * Math.floor(x / TILE)}_${1000 + 2 * Math.floor(y / TILE)}`);
      if (!t || !t.built) return null;
      for (const b of t.built.grid.get(`${Math.floor(X / 40)},${Math.floor(Z / 40)}`) || []) {
        const dx = X - b.x; const dz = Z - b.z; const lx = dx * b.ux + dz * b.uz; const lz = -dx * b.uz + dz * b.ux;
        const px = b.hx + r - Math.abs(lx); const pz = b.hz + r - Math.abs(lz);
        if (px > 0 && pz > 0) {
          if (px < pz) { const s = Math.sign(lx) || 1; return { nx: b.ux * s, nz: b.uz * s }; }
          const s = Math.sign(lz) || 1; return { nx: -b.uz * s, nz: b.ux * s };
        }
      }
      return null;
    },
    // the round minimap: the map around the car, heading up, radius in metres
    drawMinimap(ctx, X, Z, heading, size, radius, route) {
      const x = X + ox; const y = oy - Z; const s = size / 2 / radius; // px per metre
      ctx.save(); ctx.clearRect(0, 0, size, size); ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = '#1d2733'; ctx.fillRect(0, 0, size, size);
      // map offsets (dx, dy) from the car → canvas, the car's heading up (three forward = (sin h, cos h) in x, z)
      const c = Math.cos(heading) * s; const sn = Math.sin(heading) * s;
      ctx.setTransform(-c, -sn, -sn, c, size / 2, size / 2);
      for (const [k, cv] of minimapTiles) {
        const t = tiles.get(k); const tx = (t.A - 1000) * 512; const ty = (t.B - 1000) * 512;
        if (Math.abs(tx + 512 - x) > radius + 800 || Math.abs(ty + 512 - y) > radius + 800) continue;
        ctx.save(); ctx.scale(1, -1); ctx.drawImage(cv, tx - x, -(ty + TILE - y), TILE, TILE); ctx.restore(); // row 0 = the tile's top (largest y)
      }
      if (route && route.length) {
        ctx.strokeStyle = '#3fe0ff'; ctx.lineWidth = 3 / s; ctx.lineJoin = 'round'; ctx.beginPath();
        route.forEach((p, i) => { const dx = p.x + ox - x; const dy = oy - p.y - y; if (i) ctx.lineTo(dx, dy); else ctx.moveTo(dx, dy); }); ctx.stroke();
      }
      ctx.restore();
    },
    tileOf(X, Z) { const x = X + ox; const y = oy - Z; return tiles.has(`${1000 + 2 * Math.floor(x / TILE)}_${1000 + 2 * Math.floor(y / TILE)}`); },
  };
}
