// City traffic for RayCity Drive: the game's own cars (js/drive/rc-cars.js) driving the game's traffic lanes
// (etc/traffic/road_kr.bin, one polyline per lane in its driving direction), joined end to start where lanes
// meet. Cars keep their distance to the one ahead and to the player, are put back on a lane near the player when
// they fall far behind, and shove the player (and slow down) on contact.
import * as THREE from 'three';
import { compactParts } from './garage.js';

const NEAR = 380; const FAR = 520;

export function createTraffic(scene, garage, lines, makeWheel, COUNT = 26) {
  // lanes in RayCity metres with running lengths; lane ends joined to lane starts within 4 m
  const lanes = lines.filter((l) => l.length >= 2).map((p) => { const L = [0]; for (let i = 1; i < p.length; i++) L.push(L[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])); return { p, L, len: L[L.length - 1], next: [] }; }).filter((l) => l.len > 8);
  const starts = new Map(); const key = (x, y) => `${Math.round(x / 4)},${Math.round(y / 4)}`;
  lanes.forEach((l, i) => { const k = key(l.p[0][0], l.p[0][1]); if (!starts.has(k)) starts.set(k, []); starts.get(k).push(i); });
  for (const l of lanes) { const e = l.p[l.p.length - 1]; const gx = Math.round(e[0] / 4); const gy = Math.round(e[1] / 4); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) l.next.push(...(starts.get(`${gx + a},${gy + b}`) || [])); }
  // lanes by 200 m cell, for putting cars near the player
  const cells = new Map();
  lanes.forEach((l, i) => { for (const q of l.p) { const k = `${Math.floor(q[0] / 200)},${Math.floor(q[1] / 200)}`; if (!cells.has(k)) cells.set(k, new Set()); cells.get(k).add(i); } });

  // a few car types: body as one geometry (paint / glass groups), paint texture = mask (paint white, trim dark)
  const pool = garage.cars.filter((c) => c.wheels && (c.spec.BD_Mass || 1400) < 4000);
  const types = [];
  for (let i = 0; i < Math.min(9, pool.length); i++) {
    const c = pool[Math.floor((i / 9) * pool.length + Math.random() * (pool.length / 9))] || pool[i];
    const parts = compactParts(garage.file(c.files.mesh)).filter((q) => q.flags[0] <= 1);
    const P = []; const N = []; const U = []; const I = [[], []];
    for (const q of parts) {
      const base = P.length / 3; const g = q.flags[0] === 1 ? 1 : 0;
      for (let k = 0; k < q.positions.length; k += 3) { P.push(q.positions[k], q.positions[k + 2], -q.positions[k + 1]); N.push(q.normals[k], q.normals[k + 2], -q.normals[k + 1]); }
      U.push(...q.uvs); for (const v of q.indices) I[g].push(base + v);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    geo.setIndex([...I[0], ...I[1]]); geo.addGroup(0, I[0].length, 0); geo.addGroup(I[0].length, I[1].length, 1);
    const tex = new THREE.CanvasTexture(document.createElement('canvas')); tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace;
    const mask = garage.file(c.files.base);
    if (mask) createImageBitmap(new Blob([mask])).then((bm) => {
      const cv = tex.image; cv.width = bm.width; cv.height = bm.height; const g = cv.getContext('2d'); g.drawImage(bm, 0, 0);
      const im = g.getImageData(0, 0, cv.width, cv.height); const d = im.data;
      for (let k = 0; k < d.length; k += 4) { const paint = d[k] > 128 || d[k + 1] > 128 || d[k + 2] > 128; const v = paint ? 255 : 30; d[k] = d[k + 1] = d[k + 2] = v; d[k + 3] = 255; }
      g.putImageData(im, 0, 0); tex.needsUpdate = true;
    });
    const box = new THREE.Box3().setFromBufferAttribute(geo.attributes.position);
    types.push({ geo, tex, wheels: c.wheels, half: Math.max(1.9, (box.max.z - box.min.z) / 2), width: Math.max(0.8, (box.max.x - box.min.x) / 2) });
  }
  const glass = new THREE.MeshStandardMaterial({ color: '#1d2a3a', transparent: true, opacity: 0.6, roughness: 0.05, metalness: 0.6 });
  const paints = garage.paints.length ? garage.paints : ['#d0d0d0', '#202020', '#a01818', '#1f4fa0'];
  const group = new THREE.Group(); scene.add(group);
  const cars = [];
  if (!types.length || !lanes.length) return { update() {}, hit() { return null; }, clear() {} };
  for (let i = 0; i < COUNT; i++) {
    const t = types[i % types.length];
    const mat = new THREE.MeshStandardMaterial({ map: t.tex, color: paints[Math.floor(Math.random() * paints.length)], roughness: 0.4, metalness: 0.25 });
    const o = new THREE.Group(); const body = new THREE.Mesh(t.geo, [mat, glass]); body.castShadow = true; o.add(body);
    const ws = [];
    for (const [x, y] of [[t.wheels.x, t.wheels.front], [-t.wheels.x, t.wheels.front], [t.wheels.x, t.wheels.rear], [-t.wheels.x, t.wheels.rear]]) { const w = makeWheel(x > 0); w.position.set(x, 0.31, -y); o.add(w); ws.push(w); }
    o.visible = false; group.add(o);
    cars.push({ o, t, ws, lane: -1, s: 0, v: 0, want: 9 + Math.random() * 6, x: 0, y: 0, h: 0 });
  }

  const at = (c) => { // position and heading along the lane
    const l = lanes[c.lane]; let i = 1; while (i < l.L.length - 1 && l.L[i] < c.s) i++;
    const a = l.p[i - 1]; const b = l.p[i]; const t = Math.min(1, Math.max(0, (c.s - l.L[i - 1]) / (l.L[i] - l.L[i - 1] || 1)));
    c.x = a[0] + (b[0] - a[0]) * t; c.y = a[1] + (b[1] - a[1]) * t; c.z = (a[2] || 0) + ((b[2] || 0) - (a[2] || 0)) * t; c.h = Math.atan2(b[0] - a[0], -(b[1] - a[1])); // three heading: forward (sin h, cos h) in x, z
  };
  function place(c, px, py) {
    // a lane in a cell around the player, the car NEAR·(0.3…1) away
    for (let tries = 0; tries < 30; tries++) {
      const a = Math.random() * Math.PI * 2; const r = NEAR * (0.3 + Math.random() * 0.7); const x = px + Math.cos(a) * r; const y = py + Math.sin(a) * r;
      const set = cells.get(`${Math.floor(x / 200)},${Math.floor(y / 200)}`); if (!set) continue;
      const arr = [...set]; const li = arr[Math.floor(Math.random() * arr.length)]; const l = lanes[li];
      c.lane = li; c.s = Math.random() * l.len; at(c);
      if (Math.hypot(c.x - px, c.y - py) < 60) continue;
      c.v = c.want * 0.8; c.o.visible = true; return true;
    }
    c.o.visible = false; c.lane = -1; return false;
  }

  const api = {
    heights: false, // true: on the lanes' own heights (the real city), else flat
    // px, py: the player in RayCity metres; ox, oy: the world origin; P: the player's state (three x, z, vx, vz)
    update(dt, px, py, ox, oy, P) {
      for (const c of cars) {
        if (c.lane < 0 || Math.hypot(c.x - px, c.y - py) > FAR) { place(c, px, py); continue; }
        // keep the distance to anything ahead in the lane's direction (other cars, the player)
        const fx = Math.sin(c.h); const fz = Math.cos(c.h); let gap = Infinity;
        const X = c.x - ox; const Z = -(c.y - oy);
        for (const d of cars) { if (d === c || d.lane < 0) continue; const dx = (d.x - ox) - X; const dz = -(d.y - oy) - Z; const ahead = dx * fx + dz * fz; if (ahead > 0 && ahead < gap && Math.abs(dx * fz - dz * fx) < 2.2) gap = ahead - d.t.half - c.t.half; }
        { const dx = P.x - X; const dz = P.z - Z; const ahead = dx * fx + dz * fz; if (ahead > 0 && Math.abs(dx * fz - dz * fx) < 2.4) gap = Math.min(gap, ahead - c.t.half - 2.3); }
        const target = gap < 3 ? 0 : gap < 20 ? c.want * (gap - 3) / 17 : c.want;
        c.v += Math.max(-9 * dt, Math.min(3 * dt, target - c.v));
        c.s += c.v * dt;
        const l = lanes[c.lane];
        if (c.s >= l.len) { if (l.next.length) { c.s -= l.len; c.lane = l.next[Math.floor(Math.random() * l.next.length)]; } else { place(c, px, py); continue; } }
        at(c);
        c.o.position.set(c.x - ox, api.heights ? c.z : 0, -(c.y - oy)); c.o.rotation.y = c.h;
        for (const w of c.ws) w.rotation.x += (c.v / 0.31) * dt;
      }
    },
    // a traffic car touching the player (circle of radius r at three X, Z): the push-out normal
    hit(X, Z, r, ox, oy) {
      for (const c of cars) {
        if (c.lane < 0) continue; const cx = c.x - ox; const cz = -(c.y - oy);
        const fx = Math.sin(c.h); const fz = Math.cos(c.h); const dx = X - cx; const dz = Z - cz;
        const lf = dx * fx + dz * fz; const ls = dx * fz - dz * fx;
        const pf = c.t.half + r - Math.abs(lf); const ps = c.t.width + r - Math.abs(ls);
        if (pf > 0 && ps > 0) { c.v *= 0.3; return pf < ps ? { nx: fx * Math.sign(lf), nz: fz * Math.sign(lf) } : { nx: fz * Math.sign(ls), nz: -fx * Math.sign(ls) }; }
      }
      return null;
    },
    clear() { for (const c of cars) { c.lane = -1; c.o.visible = false; } },
    get cars() { return cars; },
  };
  return api;
}
