// Outer shell of a car model for build-car.mjs --bake: the source triangles are voxelized (windows
// count as solid), gaps smaller than a few centimetres are closed (door seams, grille holes: those
// come back through the baked texture), and the surface seen from outside is extracted as one
// watertight mesh (surface nets). A watertight mesh simplifies cleanly to a few thousand triangles.
//
// Coordinates: RayCity space (x left, y back, z up), metres.

export function buildHull(tris, { voxel = 0.02, close = 2, smooth = 12 } = {}) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const p of [t.a, t.b, t.c]) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]);
  }
  const margin = close + 3;
  const o = min.map((v) => v - margin * voxel);
  const n = [0, 1, 2].map((k) => Math.ceil((max[k] - min[k]) / voxel) + margin * 2 + 1);
  const [nx, ny, nz] = n;
  const id = (x, y, z) => x + nx * (y + ny * z);
  const total = nx * ny * nz;

  // 1. Solid voxels: points sampled over every triangle at half-voxel spacing.
  const solid = new Uint8Array(total);
  const mark = (p) => {
    const x = Math.floor((p[0] - o[0]) / voxel); const y = Math.floor((p[1] - o[1]) / voxel); const z = Math.floor((p[2] - o[2]) / voxel);
    solid[id(x, y, z)] = 1;
  };
  for (const t of tris) {
    const { a, b, c } = t;
    const lab = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const lac = Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    const steps = Math.max(1, Math.ceil(Math.max(lab, lac) / (voxel * 0.5)));
    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= steps - i; j++) {
        const u = i / steps; const v = j / steps;
        mark([a[0] + (b[0] - a[0]) * u + (c[0] - a[0]) * v, a[1] + (b[1] - a[1]) * u + (c[1] - a[1]) * v, a[2] + (b[2] - a[2]) * u + (c[2] - a[2]) * v]);
      }
    }
  }

  // 2. Morphological closing: grow the solid by `close` voxels, flood the outside air from the
  //    grid corner, then grow the outside back by `close` voxels.
  const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const bfsGrow = (mask, steps, blocked) => {
    let front = [];
    for (let i = 0; i < total; i++) if (mask[i]) front.push(i);
    for (let s = 0; s < steps; s++) {
      const next = [];
      for (const i of front) {
        const x = i % nx; const y = Math.floor(i / nx) % ny; const z = Math.floor(i / (nx * ny));
        for (const [dx, dy, dz] of N6) {
          const xx = x + dx; const yy = y + dy; const zz = z + dz;
          if (xx < 0 || yy < 0 || zz < 0 || xx >= nx || yy >= ny || zz >= nz) continue;
          const j = id(xx, yy, zz);
          if (mask[j] || (blocked && blocked[j])) continue;
          mask[j] = 1;
          next.push(j);
        }
      }
      front = next;
    }
  };
  const grown = solid.slice();
  bfsGrow(grown, close);
  const outside = new Uint8Array(total);
  {
    const stack = [0];
    outside[0] = 1;
    while (stack.length) {
      const i = stack.pop();
      const x = i % nx; const y = Math.floor(i / nx) % ny; const z = Math.floor(i / (nx * ny));
      for (const [dx, dy, dz] of N6) {
        const xx = x + dx; const yy = y + dy; const zz = z + dz;
        if (xx < 0 || yy < 0 || zz < 0 || xx >= nx || yy >= ny || zz >= nz) continue;
        const j = id(xx, yy, zz);
        if (outside[j] || grown[j]) continue;
        outside[j] = 1;
        stack.push(j);
      }
    }
  }
  bfsGrow(outside, close);
  const inside = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz ? 0 : outside[id(x, y, z)] ? 0 : 1);

  // 3. Surface nets: one vertex per cell (2×2×2 voxels) the surface crosses, one quad per voxel face
  //    between inside and outside.
  const cellVert = new Map();
  const pos = [];
  const vertOf = (cx, cy, cz) => {
    const k = cx + nx * (cy + ny * cz);
    let v = cellVert.get(k);
    if (v !== undefined) return v;
    // Mean of the crossing edges' midpoints (voxel centres at (i + 0.5) * voxel).
    let sx = 0; let sy = 0; let sz = 0; let m = 0;
    const corner = (i) => inside(cx + (i & 1), cy + ((i >> 1) & 1), cz + ((i >> 2) & 1));
    for (const [i, j] of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]) {
      if (corner(i) === corner(j)) continue;
      sx += ((i & 1) + (j & 1)) / 2; sy += (((i >> 1) & 1) + ((j >> 1) & 1)) / 2; sz += (((i >> 2) & 1) + ((j >> 2) & 1)) / 2;
      m++;
    }
    v = pos.length / 3;
    pos.push(o[0] + (cx + 0.5 + sx / m) * voxel, o[1] + (cy + 0.5 + sy / m) * voxel, o[2] + (cz + 0.5 + sz / m) * voxel);
    cellVert.set(k, v);
    return v;
  };
  const idx = [];
  const quad = (a, b, c, d, flip) => (flip ? idx.push(a, c, b, a, d, c) : idx.push(a, b, c, a, c, d));
  for (let z = 1; z < nz - 1; z++) {
    for (let y = 1; y < ny - 1; y++) {
      for (let x = 1; x < nx - 1; x++) {
        const s = inside(x, y, z);
        if (s !== inside(x + 1, y, z)) quad(vertOf(x, y - 1, z - 1), vertOf(x, y, z - 1), vertOf(x, y, z), vertOf(x, y - 1, z), !s);
        if (s !== inside(x, y + 1, z)) quad(vertOf(x - 1, y, z - 1), vertOf(x - 1, y, z), vertOf(x, y, z), vertOf(x, y, z - 1), !s);
        if (s !== inside(x, y, z + 1)) quad(vertOf(x - 1, y - 1, z), vertOf(x, y - 1, z), vertOf(x, y, z), vertOf(x - 1, y, z), !s);
      }
    }
  }
  const P = new Float32Array(pos);
  const I = new Uint32Array(idx);

  // 4. Taubin smoothing against the voxel steps: a shrinking step (λ) then an inflating one (μ), so
  //    the surface gets smooth without the car getting smaller.
  const nv = P.length / 3;
  const nbr = Array.from({ length: nv }, () => new Set());
  for (let t = 0; t < I.length; t += 3) {
    for (let e = 0; e < 3; e++) { nbr[I[t + e]].add(I[t + ((e + 1) % 3)]); nbr[I[t + ((e + 1) % 3)]].add(I[t + e]); }
  }
  const step = (f) => {
    const Q = P.slice();
    for (let v = 0; v < nv; v++) {
      let sx = 0; let sy = 0; let sz = 0;
      for (const w of nbr[v]) { sx += P[w * 3]; sy += P[w * 3 + 1]; sz += P[w * 3 + 2]; }
      const k = nbr[v].size || 1;
      Q[v * 3] = P[v * 3] + f * (sx / k - P[v * 3]);
      Q[v * 3 + 1] = P[v * 3 + 1] + f * (sy / k - P[v * 3 + 1]);
      Q[v * 3 + 2] = P[v * 3 + 2] + f * (sz / k - P[v * 3 + 2]);
    }
    P.set(Q);
  };
  for (let it = 0; it < smooth; it++) { step(0.5); step(-0.53); }

  // Outward winding check (signed volume).
  let vol = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3; const b = I[t + 1] * 3; const c = I[t + 2] * 3;
    vol += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  if (vol < 0) for (let t = 0; t < I.length; t += 3) { const s = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = s; }
  return { pos: P, idx: I, grid: n };
}
