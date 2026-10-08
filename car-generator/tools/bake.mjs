// Texture baking for build-car.mjs --bake: the low-poly parts get a UV atlas, and every texel takes the
// color of the detailed source model under it (grilles, badges, lamps, panel lines, trim), so the
// game car can stay close to the original cars' polygon counts and still look like the real one.
//
// How the game draws a car (from the original files): <car>_base.png is a pure paint mask (red = the
// player's paint), and <car>_color.png / each part's texture is a detail layer drawn over the paint
// with its alpha. So the bake writes paint as transparent (shaded a little at creases) and everything
// else (black trim, chrome, lights, badges) as opaque color.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

// ---------------------------------------------------------------------------------------------
// UV atlas: charts of connected triangles facing about the same way, projected flat and shelf-packed.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// Splits one part (positions/normals/indices) into charts. Returns { charts: [{ tris, verts2d, w, h }] }
// with verts2d in metres; the part is rebuilt later with one vertex per (vertex, chart).
function makeCharts(part, maxAngleCos = Math.cos((55 * Math.PI) / 180)) {
  const P = part.positions;
  const I = part.indices;
  const nt = I.length / 3;
  const v = (i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  const fn = [];
  const area = [];
  for (let t = 0; t < nt; t++) {
    const c = cross(sub(v(I[t * 3 + 1]), v(I[t * 3])), sub(v(I[t * 3 + 2]), v(I[t * 3])));
    area.push(Math.hypot(...c) / 2);
    fn.push(norm(c));
  }
  // Edge adjacency by vertex position (normals split vertices, charts should not stop there).
  const key = (i) => `${Math.round(P[i * 3] * 1e4)},${Math.round(P[i * 3 + 1] * 1e4)},${Math.round(P[i * 3 + 2] * 1e4)}`;
  const pk = Array.from({ length: P.length / 3 }, (_, i) => key(i));
  const edges = new Map();
  for (let t = 0; t < nt; t++) {
    for (let e = 0; e < 3; e++) {
      const a = pk[I[t * 3 + e]];
      const b = pk[I[t * 3 + ((e + 1) % 3)]];
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (!edges.has(k)) edges.set(k, []);
      edges.get(k).push(t);
    }
  }
  const nbr = Array.from({ length: nt }, () => []);
  for (const ts of edges.values()) for (const a of ts) for (const b of ts) if (a !== b) nbr[a].push(b);
  const chartOf = new Int32Array(nt).fill(-1);
  const charts = [];
  // Seeds in order of area, so big flat panels become big charts.
  const order = [...Array(nt).keys()].sort((a, b) => area[b] - area[a]);
  for (const seed of order) {
    if (chartOf[seed] >= 0) continue;
    const id = charts.length;
    const tris = [seed];
    chartOf[seed] = id;
    let n = fn[seed].slice();
    for (let q = 0; q < tris.length; q++) {
      for (const o of nbr[tris[q]]) {
        if (chartOf[o] >= 0 || dot(fn[o], norm(n)) < maxAngleCos) continue;
        chartOf[o] = id;
        tris.push(o);
        n = [n[0] + fn[o][0] * area[o], n[1] + fn[o][1] * area[o], n[2] + fn[o][2] * area[o]];
      }
    }
    charts.push({ tris, n: norm(n) });
  }
  // Flat projection of each chart.
  for (const ch of charts) {
    const n = ch.n;
    const up = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const u = norm(cross(up, n));
    const w = cross(n, u);
    const local = new Map(); // vertex index → 2d
    let minU = Infinity; let minV = Infinity; let maxU = -Infinity; let maxV = -Infinity;
    for (const t of ch.tris) {
      for (let e = 0; e < 3; e++) {
        const i = I[t * 3 + e];
        if (local.has(i)) continue;
        const p = v(i);
        const uv = [dot(p, u), dot(p, w)];
        local.set(i, uv);
        minU = Math.min(minU, uv[0]); maxU = Math.max(maxU, uv[0]);
        minV = Math.min(minV, uv[1]); maxV = Math.max(maxV, uv[1]);
      }
    }
    for (const uv of local.values()) { uv[0] -= minU; uv[1] -= minV; }
    ch.local = local;
    ch.w = Math.max(1e-4, maxU - minU);
    ch.h = Math.max(1e-4, maxV - minV);
  }
  return charts;
}

// Shelf packing of rectangles (metres × scale = pixels) into [x0, x1) × [y0, y1); false if it doesn't fit.
function shelfPack(rects, scale, x0, x1, y0, y1, pad) {
  let x = x0; let y = y0; let rowH = 0;
  for (const r of rects) {
    const w = Math.ceil(r.w * scale) + pad * 2;
    const h = Math.ceil(r.h * scale) + pad * 2;
    if (w > x1 - x0) return false;
    if (x + w > x1) { x = x0; y += rowH; rowH = 0; }
    if (y + h > y1) return false;
    r.px = x + pad; r.py = y + pad;
    x += w; rowH = Math.max(rowH, h);
  }
  return true;
}

// Gives every part an atlas UV set. parts: [{ positions, normals, indices, ... }] (mutated: vertices are
// split along chart seams, uvs set). The atlas is size × size; rows [paletteRows, size) are charts,
// the top rows hold the flat palette cells used by the far LODs.
export function unwrapParts(parts, size, top) {
  const pad = 2;
  const all = [];
  for (const part of parts) {
    part.charts = makeCharts(part);
    for (const ch of part.charts) all.push(ch);
  }
  all.sort((a, b) => b.h - a.h);
  // Largest scale that fits (binary search), so texel density is even over the whole car.
  let lo = 1; let hi = 4096;
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2;
    if (shelfPack(all, mid, 0, size, top, size, pad)) lo = mid; else hi = mid;
  }
  shelfPack(all, lo, 0, size, top, size, pad);
  for (const part of parts) {
    const P = []; const N = []; const UV = []; const IDX = [];
    for (const ch of part.charts) {
      const remap = new Map();
      for (const [i, uv] of ch.local) {
        remap.set(i, P.length / 3);
        P.push(part.positions[i * 3], part.positions[i * 3 + 1], part.positions[i * 3 + 2]);
        N.push(part.normals[i * 3], part.normals[i * 3 + 1], part.normals[i * 3 + 2]);
        UV.push((ch.px + uv[0] * lo) / size, (ch.py + ch.h * lo - uv[1] * lo) / size);
      }
      for (const t of ch.tris) for (let e = 0; e < 3; e++) IDX.push(remap.get(part.indices[t * 3 + e]));
    }
    part.positions = new Float32Array(P);
    part.normals = new Float32Array(N);
    part.uvs = new Float32Array(UV);
    part.indices = new Uint16Array(IDX);
    delete part.charts;
  }
  return lo; // pixels per metre
}

// ---------------------------------------------------------------------------------------------
// Bake.

const srgb = (c) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)));

// Reference model for ray casts: every source triangle (badges and interior included).
// tris: [{ a, b, c, mat (canonical), src (material record), uv: [[u,v]×3] | null }]
export function makeReference(tris) {
  const pos = new Float32Array(tris.length * 9);
  tris.forEach((t, i) => pos.set([...t.a, ...t.b, ...t.c], i * 9));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  // Keep triangle order (indirect) so a hit's faceIndex is the index into tris.
  const bvh = new MeshBVH(geo, { indirect: true });
  return { tris, bvh, mesh: Object.assign(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })), { geometry: geo }) };
}

// Color of a source triangle at barycentric (u, v, w): base color factor × texture, sRGB 0..255, alpha 0..1.
function sourceColor(t, bary) {
  const m = t.src;
  let r = m.factor[0]; let g = m.factor[1]; let b = m.factor[2]; let a = m.factor[3];
  if (m.tex && t.uv) {
    const u = t.uv[0][0] * bary.x + t.uv[1][0] * bary.y + t.uv[2][0] * bary.z;
    const v = t.uv[0][1] * bary.x + t.uv[1][1] * bary.y + t.uv[2][1] * bary.z;
    const { w, h, data } = m.tex;
    const x = Math.min(w - 1, Math.max(0, Math.floor((((u % 1) + 1) % 1) * w)));
    const y = Math.min(h - 1, Math.max(0, Math.floor((((v % 1) + 1) % 1) * h)));
    const o = (y * w + x) * 4;
    // texture is sRGB: to linear for the multiply
    const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    r *= lin(data[o]); g *= lin(data[o + 1]); b *= lin(data[o + 2]); a *= data[o + 3] / 255;
  }
  if (m.alphaMode === 'OPAQUE') a = 1;
  return [r, g, b, a];
}

// Look of each canonical category on top of the source color (the game has no reflections:
// chrome and lamps get a painted-in highlight instead).
function styleColor(mat, rgb, n) {
  const up = Math.max(0, n[2]);
  if (mat === 'metal_chrome') { const k = 0.55 + 0.35 * up; return [k, k, k * 1.03]; }
  if (mat === 'metal_gray') return rgb.map((c) => Math.min(1, c * 0.9 + 0.05));
  return rgb;
}

// Bakes one atlas. parts: [{ positions, normals, uvs, indices, name (canonical material) }] at the
// atlas's pixel size. Returns RGBA pixels (paint transparent).
export function bakeAtlas(ref, parts, size, { reach = 0.12 } = {}) {
  const px = new Uint8ClampedArray(size * size * 4);
  const filled = new Uint8Array(size * size);
  const ray = new THREE.Ray();
  const bary = new THREE.Vector3();
  const tri = new THREE.Triangle();
  const A = new THREE.Vector3(); const B = new THREE.Vector3(); const C = new THREE.Vector3();
  for (const part of parts) {
    const own = part.name;
    const ownGlass = /^Glass/i.test(own);
    const I = part.indices; const P = part.positions; const N = part.normals; const UV = part.uvs;
    for (let t = 0; t < I.length; t += 3) {
      const ia = I[t]; const ib = I[t + 1]; const ic = I[t + 2];
      const ux = [UV[ia * 2] * size, UV[ib * 2] * size, UV[ic * 2] * size];
      const uy = [UV[ia * 2 + 1] * size, UV[ib * 2 + 1] * size, UV[ic * 2 + 1] * size];
      const x0 = Math.max(0, Math.floor(Math.min(...ux)) - 1); const x1 = Math.min(size - 1, Math.ceil(Math.max(...ux)) + 1);
      const y0 = Math.max(0, Math.floor(Math.min(...uy)) - 1); const y1 = Math.min(size - 1, Math.ceil(Math.max(...uy)) + 1);
      const den = (uy[1] - uy[2]) * (ux[0] - ux[2]) + (ux[2] - ux[1]) * (uy[0] - uy[2]);
      if (Math.abs(den) < 1e-12) continue;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const sx = x + 0.5; const sy = y + 0.5;
          let w0 = ((uy[1] - uy[2]) * (sx - ux[2]) + (ux[2] - ux[1]) * (sy - uy[2])) / den;
          let w1 = ((uy[2] - uy[0]) * (sx - ux[2]) + (ux[0] - ux[2]) * (sy - uy[2])) / den;
          let w2 = 1 - w0 - w1;
          // Texels just outside the triangle (up to ~1 px) are baked too, clamped onto it: no seams.
          const e = 1.5 / Math.max(1, Math.sqrt(Math.abs(den)));
          if (w0 < -e || w1 < -e || w2 < -e) continue;
          const inside = w0 >= 0 && w1 >= 0 && w2 >= 0;
          if (filled[y * size + x] === 2 || (!inside && filled[y * size + x])) continue;
          w0 = Math.max(0, w0); w1 = Math.max(0, w1); w2 = Math.max(0, w2);
          const s = w0 + w1 + w2; w0 /= s; w1 /= s; w2 /= s;
          const p = [0, 1, 2].map((k) => P[ia * 3 + k] * w0 + P[ib * 3 + k] * w1 + P[ic * 3 + k] * w2);
          const n = norm([0, 1, 2].map((k) => N[ia * 3 + k] * w0 + N[ib * 3 + k] * w1 + N[ic * 3 + k] * w2));
          const c = ownGlass ? [0.02, 0.02, 0.025, 1, 1] : sample(p, n);
          const o = (y * size + x) * 4;
          px[o] = c[0] * 255; px[o + 1] = c[1] * 255; px[o + 2] = c[2] * 255; px[o + 3] = c[3] * 255;
          filled[y * size + x] = inside ? 2 : 1;
        }
      }
    }
  }
  dilate(px, filled, size, 4);
  return px;

  // Front-to-back along the inward normal from just outside the low-poly surface: transparent
  // source layers (lamp lenses, tinted plastic) are blended over what lies behind them.
  function sample(p, n) {
    ray.origin.set(p[0] + n[0] * reach, p[1] + n[1] * reach, p[2] + n[2] * reach);
    ray.direction.set(-n[0], -n[1], -n[2]);
    const hits = ref.bvh.raycast(ray, THREE.DoubleSide).filter((h) => h.distance <= reach * 2.5);
    if (!hits.length) {
      // Nothing under this texel within reach (holes we filled, underbody, wheel wells): flat dark.
      return [0.03, 0.03, 0.03, 1];
    }
    hits.sort((a, b) => a.distance - b.distance);
    let r = 0; let g = 0; let b = 0; let acc = 0;
    let paint = 0;
    let crease = 0;
    for (const h of hits) {
      const st = ref.tris[h.faceIndex];
      if (st.mat === 'Glass_Gray') {
        // Window: dark tint over whatever is behind (seats, dash), with a sky highlight from above.
        const k = (1 - acc) * 0.7;
        const hi = 0.06 + 0.3 * Math.max(0, n[2]);
        r += k * hi; g += k * (hi + 0.01); b += k * (hi + 0.03);
        acc += k;
        continue;
      }
      A.fromArray(st.a); B.fromArray(st.b); C.fromArray(st.c);
      tri.set(A, B, C);
      tri.getBarycoord(h.point, bary);
      const [cr, cg, cb, ca] = sourceColor(st, bary);
      const hn = norm(cross(sub(st.b, st.a), sub(st.c, st.a)));
      const facing = Math.abs(dot(hn, n));
      // Transparent layers: clear lenses stay thin (the reflector shows), tinted lamp glass is
      // thickened so the lamp keeps its red / amber.
      const tinted = Math.max(cr, cg, cb) - Math.min(cr, cg, cb) > 0.15;
      const alpha = ca >= 0.98 ? 1 : tinted ? Math.min(1, ca * 3.2) : ca * 0.5;
      const k = (1 - acc) * alpha;
      if (st.mat === 'Body_Color') {
        // Paint shows the player's color: transparent here, a little darker where the source surface
        // turns away from the low-poly one (panel gaps, creases).
        paint += k;
        crease += k * Math.min(1, Math.max(0, (0.85 - facing) / 0.6));
      } else {
        const [sr, sg, sb] = styleColor(st.mat, [cr, cg, cb], hn).map(srgb).map((c) => c / 255);
        const shade = 0.7 + 0.3 * facing;
        r += k * sr * shade; g += k * sg * shade; b += k * sb * shade;
      }
      acc += k;
      if (acc > 0.995) break;
    }
    if (acc < 1) { const k = 1 - acc; r += k * 0.03; g += k * 0.03; b += k * 0.03; acc = 1; }
    // Overlay alpha: opaque for everything but paint; paint keeps a dark crease line.
    const opaque = 1 - paint;
    const lineA = Math.min(0.5, crease * 0.6);
    const a = Math.min(1, opaque + lineA);
    if (a < 1e-3) return [0, 0, 0, 0];
    return [r / a, g / a, b / a, a];
  }
}

// Spreads baked texels into empty neighbours so filtering and mipmaps don't bleed in background.
function dilate(px, filled, size, steps) {
  for (let s = 0; s < steps; s++) {
    const add = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (filled[y * size + x]) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx; const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= size || yy >= size || !filled[yy * size + xx]) continue;
          add.push([y * size + x, yy * size + xx]);
          break;
        }
      }
    }
    for (const [to, from] of add) {
      px.copyWithin(to * 4, from * 4, from * 4 + 4);
      filled[to] = 1;
    }
  }
}

// Material of the source surface under a point of the shell (first hit along the inward normal).
export function materialAt(ref, p, n, reach = 0.12) {
  const ray = new THREE.Ray(new THREE.Vector3(p[0] + n[0] * reach, p[1] + n[1] * reach, p[2] + n[2] * reach), new THREE.Vector3(-n[0], -n[1], -n[2]));
  const hit = ref.bvh.raycastFirst(ray, THREE.DoubleSide);
  return hit && hit.distance <= reach * 2.5 ? ref.tris[hit.faceIndex].mat : null;
}
