// People on the pavements, in the game's own models and skins (person/, pulled out into js/drive/rc-cars.js):
// named characters with a name tag (some offering a quest, like the game's green "!"), and the street crowd.
// Each city tile near the car gets its people on the kerbside, facing the road; they leave with the tile.
// The quest givers are listed for js/drive/play.js (questNear, take); one taken stays taken while the page is open.
import * as THREE from 'three';
import { compactParts } from './garage.js';

const TILE = 1024;
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; }; }

function label(text, color = '#ffe14d', quest = false) {
  const c = document.createElement('canvas'); c.width = 256; c.height = quest ? 128 : 48; const g = c.getContext('2d');
  g.font = '700 26px system-ui, sans-serif'; g.textAlign = 'center'; g.lineWidth = 5; g.strokeStyle = 'rgba(0,0,0,.85)';
  const y = quest ? 112 : 34;
  if (quest) {
    g.fillStyle = 'rgba(40,220,90,.25)'; g.strokeStyle = '#3ce06a'; g.lineWidth = 4; g.beginPath(); g.arc(128, 44, 30, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#ffffff'; g.font = '900 40px system-ui'; g.fillText('!', 128, 59); g.font = '700 20px system-ui'; g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.85)';
    g.strokeText('รับเควส', 128, 90); g.fillStyle = '#5dff8a'; g.fillText('รับเควส', 128, 90); g.font = '700 26px system-ui'; g.lineWidth = 5;
  }
  g.strokeText(text, 128, y); g.fillStyle = color; g.fillText(text, 128, y);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true }));
  s.scale.set(3.2, quest ? 1.6 : 0.6, 1); s.renderOrder = 3; return s;
}
const pretty = (m) => m.replace(/_\d+$/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function createPeople(scene, garage, city, density = 1, groundAt = null) {
  const list = (garage && garage.people) || [];
  const geos = new Map(); const mats = [];
  const geoOf = (p) => {
    if (geos.has(p.model)) return geos.get(p.model);
    const parts = compactParts(garage.file(p.mesh)); const P = []; const N = []; const U = []; const I = [];
    for (const q of parts) { const base = P.length / 3; for (let k = 0; k < q.positions.length; k += 3) { P.push(q.positions[k], q.positions[k + 2], -q.positions[k + 1]); N.push(q.normals[k], q.normals[k + 2], -q.normals[k + 1]); } U.push(...q.uvs); for (const v of q.indices) I.push(base + v); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(I);
    if (N.every((v) => v === 0)) g.computeVertexNormals();
    geos.set(p.model, g); return g;
  };
  const matOf = (i) => {
    if (mats[i]) return mats[i];
    const m = new THREE.MeshStandardMaterial({ roughness: 0.8, alphaTest: 0.5, side: THREE.DoubleSide });
    createImageBitmap(new Blob([garage.file(list[i].skin)])).then((bm) => { const t = new THREE.Texture(bm); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; m.map = t; m.needsUpdate = true; });
    mats[i] = m; return m;
  };
  const named = list.map((p, i) => [p, i]).filter(([p]) => p.named); const crowd = list.map((p, i) => [p, i]).filter(([p]) => !p.named);
  const group = new THREE.Group(); scene.add(group);
  const tiles = new Map(); // 'A_B' → { group, spots: [[X, Z]] }
  const givers = []; const taken = new Set(); // quest givers near the car: { id, X, Z, y, name, face, sprite, group }

  function populate(A, B) {
    const g = new THREE.Group(); const spots = []; const r = rng(A * 7349 + B * 13);
    const x0 = (A - 1000) * 512; const y0 = (B - 1000) * 512; const [ox, oy] = city.origin;
    let tries = 0; const want = Math.round((7 + Math.floor(r() * 5)) * density);
    while (spots.length < want && tries++ < 4000) {
      const x = x0 + r() * TILE; const y = y0 + r() * TILE;
      if (city.classRC(x, y) !== 1) continue;
      // on the kerb: asphalt 3–6 m away in some direction; face it
      let face = null;
      for (let a = 0; a < 8 && !face; a++) { const dx = Math.cos((a / 8) * Math.PI * 2); const dy = Math.sin((a / 8) * Math.PI * 2); if (city.classRC(x + dx * 4, y + dy * 4) === 3 && city.classRC(x + dx * 1.5, y + dy * 1.5) !== 3) face = [dx, dy]; }
      if (!face) continue;
      const isNamed = named.length && r() < 0.45; const [p, i] = isNamed ? named[Math.floor(r() * named.length)] : crowd[Math.floor(r() * crowd.length)] || named[0];
      const m = new THREE.Mesh(geoOf(p), matOf(i)); m.castShadow = true;
      const X = x - ox; const Z = -(y - oy); const gy = groundAt ? groundAt(X, Z) : 0; if (gy === null) continue;
      m.position.set(X, gy, Z); m.rotation.y = Math.atan2(face[0], -face[1]) + Math.PI;
      g.add(m);
      if (isNamed) {
        const id = `${A}_${B}_${spots.length}`; const quest = r() < 0.35 && !taken.has(id); const face = Math.floor(r() * 1000);
        const s = label(pretty(p.model), '#ffe14d', quest); s.position.set(X, gy + 2.35, Z); g.add(s);
        if (quest) givers.push({ id, key: `${A}_${B}`, X, Z, y: gy, name: pretty(p.model), face, sprite: s, group: g });
      }
      spots.push([X, Z]);
    }
    group.add(g); tiles.set(`${A}_${B}`, { group: g, spots });
  }
  function drop(k) {
    const t = tiles.get(k); t.group.traverse((o) => { if (o.isSprite) { o.material.map.dispose(); o.material.dispose(); } }); group.remove(t.group); tiles.delete(k);
    for (let i = givers.length - 1; i >= 0; i--) if (givers[i].key === k) givers.splice(i, 1);
  }
  return {
    update(X, Z) {
      if (!list.length) return;
      const [ox, oy] = city.origin; const x = X + ox; const y = oy - Z; const A = 1000 + 2 * Math.floor(x / TILE); const B = 1000 + 2 * Math.floor(y / TILE);
      for (const k of [...tiles.keys()]) { const [a, b] = k.split('_').map(Number); if (Math.abs(a - A) > 4 || Math.abs(b - B) > 4) drop(k); }
      for (let a = A - 2; a <= A + 2; a += 2) for (let b = B - 2; b <= B + 2; b += 2) if (!tiles.has(`${a}_${b}`) && city.hasTile(a, b) && (city.isBuilt(a, b) || (!city.visuals && groundAt && groundAt(X, Z) !== null))) { populate(a, b); return; }
    },
    hit(X, Z, r) {
      for (const t of tiles.values()) for (const [x, z] of t.spots) { const dx = X - x; const dz = Z - z; const d = Math.hypot(dx, dz); if (d < r + 0.35) return { nx: dx / (d || 1), nz: dz / (d || 1) }; }
      return null;
    },
    clear() { for (const k of [...tiles.keys()]) drop(k); },
    givers,
    // the nearest quest giver within r metres
    questNear(X, Z, r) { let best = null; let bd = r; for (const q of givers) { const d = Math.hypot(q.X - X, q.Z - Z); if (d < bd) { bd = d; best = q; } } return best; },
    // a giver whose quest was accepted: the "!" becomes a plain name tag
    take(q) {
      taken.add(q.id); const i = givers.indexOf(q); if (i >= 0) givers.splice(i, 1);
      const s = label(q.name); s.position.copy(q.sprite.position); s.position.y -= 0.5; q.group.add(s);
      q.group.remove(q.sprite); q.sprite.material.map.dispose(); q.sprite.material.dispose();
    },
  };
}
