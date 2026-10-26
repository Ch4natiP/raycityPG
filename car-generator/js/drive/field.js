// The game's real city (tools/extract-field.mjs → city/<region>/): sectors of 512 m streamed in around the car,
// each with its own pictures and baked light, the region's shared pictures from lib.bin. Ground height and walls
// come from the loaded meshes (BVH ray casts). RayCity world (x, y, z up) → three (x − ox, z, −(y − oy)).
import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';

THREE.Mesh.prototype.raycast = acceleratedRaycast;
const SEC = 512; const S = 50;

async function gunzip(buf) {
  return new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}
function header(u8, magic) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (new TextDecoder().decode(u8.subarray(0, 4)) !== magic) throw new Error(`not ${magic}`);
  const n = dv.getUint32(4, true); return { json: JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + n))), body: u8.subarray(8 + n) };
}

// DXT1/3/5 → RGBA, for GPUs without S3TC (most phones)
function dxtToRGBA(fmt, w, h, src) {
  const out = new Uint8Array(w * h * 4); const bs = fmt === 'DXT1' ? 8 : 16; let o = 0;
  const c565 = (c) => [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31];
  for (let by = 0; by < h; by += 4) for (let bx = 0; bx < w; bx += 4, o += bs) {
    const cb = o + (bs === 16 ? 8 : 0); const a = src[cb] | (src[cb + 1] << 8); const c = src[cb + 2] | (src[cb + 3] << 8);
    const p0 = c565(a); const p1 = c565(c); const four = a > c || bs === 16;
    const pal = [p0, p1, four ? p0.map((v, i) => (2 * v + p1[i]) / 3) : p0.map((v, i) => (v + p1[i]) / 2), four ? p0.map((v, i) => (v + 2 * p1[i]) / 3) : [0, 0, 0]];
    const bits = (src[cb + 4] | (src[cb + 5] << 8) | (src[cb + 6] << 16) | (src[cb + 7] << 24)) >>> 0;
    for (let i = 0; i < 16; i++) {
      const x = bx + (i & 3); const y = by + (i >> 2); if (x >= w || y >= h) continue; const q = (y * w + x) * 4; const k = (bits >>> (2 * i)) & 3;
      out[q] = pal[k][0]; out[q + 1] = pal[k][1]; out[q + 2] = pal[k][2];
      if (fmt === 'DXT3') out[q + 3] = ((src[o + (i >> 1)] >> ((i & 1) * 4)) & 15) * 17;
      else if (fmt === 'DXT5') {
        const a0 = src[o]; const a1 = src[o + 1]; const bit = 3 * i; const byte = o + 2 + (bit >> 3); const ka = ((src[byte] | (src[byte + 1] << 8)) >> (bit & 7)) & 7;
        out[q + 3] = ka === 0 ? a0 : ka === 1 ? a1 : a0 > a1 ? ((8 - ka) * a0 + (ka - 1) * a1) / 7 : ka === 6 ? 0 : ka === 7 ? 255 : ((6 - ka) * a0 + (ka - 1) * a1) / 5;
      } else out[q + 3] = !four && k === 3 ? 0 : 255;
    }
  }
  return out;
}

// stand-ins for the pictures the files do not have (the shared ones in the closed NEKO pack): small painted
// patterns by the kind the name says (kerb bricks, paving blocks, grass, rock, water, plain wall)
const standIns = new Map();
function standIn(name) {
  const n = name || '';
  const kind = /brick/.test(n) ? 'brick' : /sidewal|block|stair|pave/.test(n) ? 'block' : /grass|lawn|green/.test(n) ? 'grass'
    : /water|river/.test(n) ? 'water' : /asphalt|road|highway|tunnel/.test(n) ? 'asphalt' : /mount|rock|stone|cliff|hill/.test(n) ? 'rock' : 'wall';
  if (standIns.has(kind)) return standIns.get(kind);
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const noise = (base, amt) => { const im = g.getImageData(0, 0, 64, 64); for (let i = 0; i < im.data.length; i += 4) { const k = (Math.random() - 0.5) * amt; for (let j = 0; j < 3; j++) im.data[i + j] = Math.max(0, Math.min(255, im.data[i + j] + k)); } g.putImageData(im, 0, 0); };
  const fill = (col) => { g.fillStyle = col; g.fillRect(0, 0, 64, 64); };
  if (kind === 'brick') { fill('#8c6f62'); g.fillStyle = '#6f574d'; for (let y = 0; y < 64; y += 8) { g.fillRect(0, y, 64, 1); for (let x = (y / 8) % 2 ? 8 : 0; x < 64; x += 16) g.fillRect(x, y, 1, 8); } noise(0, 18); }
  else if (kind === 'block') { fill('#9e978d'); g.fillStyle = '#7f786f'; for (let y = 0; y < 64; y += 16) g.fillRect(0, y, 64, 1); for (let x = 0; x < 64; x += 16) g.fillRect(x, 0, 1, 64); noise(0, 16); }
  else if (kind === 'grass') { fill('#4a6e33'); noise(0, 34); }
  else if (kind === 'water') { fill('#2f5468'); noise(0, 12); }
  else if (kind === 'asphalt') { fill('#4b4d50'); noise(0, 20); }
  else if (kind === 'rock') { fill('#6d6a5f'); noise(0, 40); }
  else { fill('#8e8b86'); noise(0, 10); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  standIns.set(kind, t); return t;
}

export function createField(scene, renderer, base = 'city') {
  const group = new THREE.Group(); scene.add(group);
  const sectors = new Map(); // 'A_B' → { state, group, meshes }
  let region = null; let index = null; let lib = new Map(); let ox = 0; let oy = 0; let ready = false; let loading = 0;
  const s3tc = renderer.extensions.has('WEBGL_compressed_texture_s3tc') ? renderer.extensions.get('WEBGL_compressed_texture_s3tc') : null;
  const solid = new Map();
  const texFrom = (p, data) => {
    let t;
    if (s3tc) {
      const fmt = { DXT1: THREE.RGBA_S3TC_DXT1_Format, DXT3: THREE.RGBA_S3TC_DXT3_Format, DXT5: THREE.RGBA_S3TC_DXT5_Format }[p.fmt];
      t = new THREE.CompressedTexture([{ data, width: p.w, height: p.h }], p.w, p.h, fmt);
    } else { t = new THREE.DataTexture(dxtToRGBA(p.fmt, p.w, p.h, data), p.w, p.h, THREE.RGBAFormat); }
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.flipY = false;
    t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true;
    return t;
  };

  async function open(reg) {
    region = reg;
    const r = await fetch(`${base}/${reg}/index.json`); if (!r.ok) throw new Error('no city');
    index = await r.json(); index.set = new Set(index.sectors.map(([a, b]) => `${a}_${b}`));
    const lb = await fetch(`${base}/${reg}/lib.bin`);
    if (lb.ok) { const { json, body } = header(await gunzip(await lb.arrayBuffer()), 'RCL1'); for (const p of json.pics) lib.set(p.name, texFrom(p, body.slice(p.at, p.at + p.len))); }
    ready = true; return index.sectors.length;
  }

  async function load(key) {
    const rec = { state: 'loading', group: null, meshes: [] }; sectors.set(key, rec); loading++;
    try {
      const r = await fetch(`${base}/${region}/${key}.bin`); if (!r.ok) throw new Error(key);
      const { json, body } = header(await gunzip(await r.arrayBuffer()), 'RCS1');
      if (rec.state === 'dropped') return;
      const own = new Map(json.pics.map((p) => [p.name, texFrom(p, body.slice(p.at, p.at + p.len))])); rec.own = own;
      const pic = (n) => (n ? own.get(n) || lib.get(n) || null : null);
      const g = new THREE.Group(); g.rotation.x = -Math.PI / 2; g.scale.setScalar(1 / S); g.userData.x0 = json.x0; g.userData.y0 = json.y0;
      const mats = json.mats.map((m) => {
        const map = pic(m.tex) || (m.tex && !m.cut ? standIn(m.tex) : null); const light = pic(m.light);
        const mat = new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide });
        // the game multiplies by the baked light twice over (three's light map carries a 1/π): 8 looks like the game
        if (light) { light.channel = 1; mat.lightMap = light; mat.lightMapIntensity = 8; }
        if (m.cut) { mat.alphaTest = 0.5; mat.transparent = false; }
        return mat;
      });
      let o = 0;
      for (const m of json.meshes) {
        const P = new Int16Array(body.slice(o, o + m.nv * 6).buffer); o += m.nv * 6;
        const U8 = body.slice(o, o + m.nv * 8); o += m.nv * 8; const U = new Uint16Array(U8.buffer);
        const uv = new Uint16Array(m.nv * 2); const uv1 = new Uint16Array(m.nv * 2);
        for (let i = 0; i < m.nv; i++) { uv[i * 2] = U[i * 4]; uv[i * 2 + 1] = U[i * 4 + 1]; uv1[i * 2] = U[i * 4 + 2]; uv1[i * 2 + 1] = U[i * 4 + 3]; }
        const ib = m.ni * (m.wide ? 4 : 2); const I = m.wide ? new Uint32Array(body.slice(o, o + ib).buffer) : new Uint16Array(body.slice(o, o + ib).buffer); o += ib;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
        geo.setAttribute('uv', new THREE.Float16BufferAttribute(uv, 2)); geo.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2, true));
        geo.setIndex(new THREE.BufferAttribute(I, 1));
        geo.computeBoundingBox(); geo.computeBoundingSphere();
        // pieces with no picture at all are the game's invisible walls; cut-outs whose picture is missing (trees,
        // kerb holes: in the closed NEKO pack) would show as solid sheets: both left out of the view, the walls
        // still stop the car
        const md = json.mats[m.mat] || {}; const missing = md.tex && !pic(md.tex);
        const mesh = new THREE.Mesh(geo, mats[m.mat] || mats[0]); mesh.userData.tex = md.tex;
        if ((!md.tex && !md.light) || (md.cut && missing)) mesh.visible = false;
        g.add(mesh); rec.meshes.push(mesh);
      }
      place(g); group.add(g); rec.group = g; rec.state = 'ready';
      // ray-cast trees for the ground and walls, built after the sector shows
      setTimeout(() => { for (const mesh of rec.meshes) { try { mesh.geometry.boundsTree = new MeshBVH(mesh.geometry); } catch { /* keep plain */ } } rec.bvh = true; }, 0);
    } catch (e) { rec.state = 'failed'; console.warn('sector', key, e.message); } finally { loading--; }
  }
  function place(g) { g.position.set(g.userData.x0 - ox, 0, -(g.userData.y0 - oy)); g.updateMatrixWorld(true); }
  function drop(key) {
    const rec = sectors.get(key); rec.state = 'dropped';
    if (rec.group) {
      rec.group.traverse((o) => { if (o.geometry) { o.geometry.boundsTree = null; o.geometry.dispose(); } }); group.remove(rec.group);
      const seen = new Set(); for (const m of rec.meshes) if (!seen.has(m.material)) { seen.add(m.material); m.material.dispose(); }
      for (const t of (rec.own || new Map()).values()) t.dispose(); // (the shared pictures stay)
    }
    sectors.delete(key);
  }

  const ray = new THREE.Raycaster(); ray.firstHitOnly = true; const down = new THREE.Vector3(0, -1, 0); const tmp = new THREE.Vector3();
  const nearMeshes = (X, Z) => { const out = []; for (const r of sectors.values()) if (r.state === 'ready') { const g = r.group; const cx = g.position.x + SEC / 2; const cz = g.position.z - SEC / 2; if (Math.abs(X - cx) < SEC && Math.abs(Z - cz) < SEC) out.push(...r.meshes); } return out; };

  return {
    open, get ready() { return ready; }, get count() { return index ? index.sectors.length : 0; }, get loading() { return loading; },
    has(x, y) { return !!index && index.set.has(`${Math.floor(x / SEC) + 1000}_${Math.floor(y / SEC) + 1000}`); },
    setOrigin(x, y) { ox = x; oy = y; for (const r of sectors.values()) if (r.group) place(r.group); },
    get origin() { return [ox, oy]; },
    show(on) { group.visible = on; },
    clear() { for (const k of [...sectors.keys()]) drop(k); },
    // load the sectors within reach (nearest first, two at a time), drop the far ones
    update(X, Z, reach = 700) {
      if (!ready) return; const x = X + ox; const y = oy - Z;
      for (const k of [...sectors.keys()]) { const [a, b] = k.split('_').map(Number); const cx = (a - 1000) * SEC + SEC / 2; const cy = (b - 1000) * SEC + SEC / 2; if (Math.hypot(cx - x, cy - y) > reach + 900) drop(k); }
      if (loading >= 2) return;
      let best = null; let bd = Infinity;
      for (let a = Math.floor((x - reach) / SEC); a <= Math.floor((x + reach) / SEC); a++) for (let b = Math.floor((y - reach) / SEC); b <= Math.floor((y + reach) / SEC); b++) {
        const k = `${a + 1000}_${b + 1000}`; if (!index.set.has(k) || sectors.has(k)) continue;
        const d = Math.hypot(a * SEC + SEC / 2 - x, b * SEC + SEC / 2 - y); if (d < bd) { bd = d; best = k; }
      }
      if (best) load(best);
    },
    // the ground under (X, Z) (three metres), searched from 'from' down; null when nothing is loaded there
    ground(X, Z, from) {
      const ms = nearMeshes(X, Z); if (!ms.length) return null;
      ray.set(tmp.set(X, from, Z), down); ray.far = 260; const h = ray.intersectObjects(ms, false)[0];
      return h ? h.point.y : null;
    },
    // a wall within 'dist' along the horizontal direction (dx, dz) from (X, Y, Z): its normal, or null
    wall(X, Y, Z, dx, dz, dist) {
      const ms = nearMeshes(X, Z); if (!ms.length) return null;
      ray.set(tmp.set(X, Y, Z), new THREE.Vector3(dx, 0, dz).normalize()); ray.far = dist; const h = ray.intersectObjects(ms, false)[0];
      if (!h || !h.face) return null;
      const n = h.face.normal.clone().transformDirection(h.object.matrixWorld); if (Math.abs(n.y) > 0.6) return null; // a slope, not a wall
      n.y = 0; n.normalize(); if (n.x * dx + n.z * dz > 0) n.negate(); return { nx: n.x, nz: n.z, d: h.distance };
    },
  };
}
