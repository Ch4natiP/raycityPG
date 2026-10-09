// The mesh edited in RayCity Studio: shared points and faces (triangles or quads), every face in one
// part file (slot: 'body', 'hood', ...) with one material category (its colour cell in the paint mask).
// RayCity space: x left, y back (front −y), z up, metres.
import { parseOM, omParts } from '../om.js';
import { creaseNormals, cellUV, CELLS } from '../convert.js';

export const SLOTS = [
  ['body', 'ตัวถัง (body)'], ['hood', 'ฝากระโปรง (hood)'], ['roof', 'หลังคา (roof)'], ['frontbumper', 'กันชนหน้า'],
  ['rearbumper', 'กันชนหลัง'], ['skirt', 'สเกิร์ตข้าง'], ['headlight', 'ไฟหน้า'], ['rearlight', 'ไฟท้าย'],
  ['grill', 'กระจัง (grill)'], ['mainspoiler', 'สปอยเลอร์'],
];

export class EditMesh {
  constructor() {
    this.verts = []; // [x, y, z]
    this.faces = []; // { v: [a, b, c] | [a, b, c, d], slot, mat }
  }

  clone() {
    const m = new EditMesh();
    m.verts = this.verts.map((p) => [...p]);
    m.faces = this.faces.map((f) => ({ v: [...f.v], slot: f.slot, mat: f.mat }));
    return m;
  }

  toJSON() { return { verts: this.verts, faces: this.faces }; }

  static fromJSON(j) {
    const m = new EditMesh();
    m.verts = j.verts.map((p) => [...p]);
    m.faces = j.faces.map((f) => ({ v: [...f.v], slot: f.slot, mat: f.mat }));
    return m;
  }

  addVert(p) { this.verts.push([...p]); return this.verts.length - 1; }

  // Point at p (within tol), else a new one.
  vertAt(p, tol = 1e-4) {
    const i = this.verts.findIndex((q) => Math.abs(q[0] - p[0]) < tol && Math.abs(q[1] - p[1]) < tol && Math.abs(q[2] - p[2]) < tol);
    return i >= 0 ? i : this.addVert(p);
  }

  addFace(v, slot, mat) {
    if (new Set(v).size !== v.length) return -1;
    this.faces.push({ v: [...v], slot, mat });
    return this.faces.length - 1;
  }

  // Faces removed, then points no face uses (indices compacted).
  deleteFaces(ids) {
    const del = new Set(ids);
    this.faces = this.faces.filter((_, i) => !del.has(i));
    this.compact();
  }

  // Points removed with every face using them.
  deleteVerts(ids) {
    const del = new Set(ids);
    this.faces = this.faces.filter((f) => !f.v.some((v) => del.has(v)));
    this.compact();
  }

  compact() {
    const used = new Uint8Array(this.verts.length);
    for (const f of this.faces) for (const v of f.v) used[v] = 1;
    const map = new Int32Array(this.verts.length).fill(-1);
    const verts = [];
    this.verts.forEach((p, i) => { if (used[i]) { map[i] = verts.length; verts.push(p); } });
    this.verts = verts;
    for (const f of this.faces) f.v = f.v.map((v) => map[v]);
    return map;
  }

  // Selected points merged into one at their centre.
  weld(ids) {
    if (ids.length < 2) return;
    const c = [0, 1, 2].map((k) => ids.reduce((s, i) => s + this.verts[i][k], 0) / ids.length);
    const keep = ids[0];
    this.verts[keep] = c;
    const set = new Set(ids);
    for (const f of this.faces) f.v = f.v.map((v) => (set.has(v) ? keep : v));
    this.faces = this.faces.filter((f) => new Set(f.v).size >= 3).map((f) => {
      // A quad that lost a corner becomes a triangle.
      const v = f.v.filter((x, i) => f.v.indexOf(x) === i);
      return { ...f, v };
    });
    this.compact();
  }

  flip(ids) { for (const i of ids) this.faces[i].v.reverse(); }

  // Points closer than tol merged (after imports, mirroring).
  weldClose(tol = 1e-4) {
    const key = (p) => p.map((x) => Math.round(x / tol)).join(',');
    const first = new Map();
    const map = this.verts.map((p, i) => { const k = key(p); if (!first.has(k)) first.set(k, i); return first.get(k); });
    for (const f of this.faces) f.v = f.v.map((v) => map[v]);
    this.faces = this.faces.filter((f) => new Set(f.v).size === f.v.length);
    this.compact();
  }

  // Point i's mirror partner across x = 0 (or itself on the centre line), -1 if none.
  mirrorOf(i, tol = 0.002) {
    const p = this.verts[i];
    if (Math.abs(p[0]) < tol) return i;
    let best = -1; let bd = tol;
    this.verts.forEach((q, j) => {
      const d = Math.max(Math.abs(q[0] + p[0]), Math.abs(q[1] - p[1]), Math.abs(q[2] - p[2]));
      if (d < bd) { bd = d; best = j; }
    });
    return best;
  }

  triangles(f) { return f.v.length === 4 ? [[f.v[0], f.v[1], f.v[2]], [f.v[0], f.v[2], f.v[3]]] : [f.v]; }

  bbox(filter = () => true) {
    const min = [Infinity, Infinity, Infinity]; const max = [-Infinity, -Infinity, -Infinity];
    for (const f of this.faces) if (filter(f)) for (const v of f.v) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], this.verts[v][k]); max[k] = Math.max(max[k], this.verts[v][k]); }
    return { min, max };
  }

  // Game geometry per file: { slot: [part per material] } with crease normals and mask cell UVs —
  // what the .0m files will hold (so its vertex counts are the real ones).
  toParts(crease = 70) {
    const P = new Float32Array(this.verts.flat());
    const bySlot = new Map();
    for (const f of this.faces) {
      if (!bySlot.has(f.slot)) bySlot.set(f.slot, new Map());
      const g = bySlot.get(f.slot);
      if (!g.has(f.mat)) g.set(f.mat, []);
      for (const t of this.triangles(f)) g.get(f.mat).push(...t);
    }
    const out = {};
    for (const [slot, g] of bySlot) {
      out[slot] = [];
      for (const [mat, idx] of g) {
        const nm = creaseNormals(P, idx, crease);
        const [u, v] = cellUV(mat);
        out[slot].push({
          name: mat, kind: 0, positions: new Float32Array(nm.positions), normals: new Float32Array(nm.normals),
          uvs: new Float32Array((nm.positions.length / 3) * 2).map((_, i) => (i % 2 ? v : u)), indices: new Uint16Array(nm.indices),
        });
      }
    }
    return out;
  }

  // Adds a .0m file's geometry as slot `slot`; colours from the mask cell under each triangle.
  addOM(bytes, slot) {
    const om = parseOM(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    for (const part of omParts(om)) {
      const n = part.positions.length / 3;
      // Stand-ins (tiny closed boxes in empty template slots) are not geometry.
      let span = 0;
      for (let k = 0; k < 3; k++) {
        let lo = Infinity; let hi = -Infinity;
        for (let i = 0; i < n; i++) { lo = Math.min(lo, part.positions[i * 3 + k]); hi = Math.max(hi, part.positions[i * 3 + k]); }
        span = Math.max(span, hi - lo);
      }
      if (n <= 8 && span < 0.02) continue;
      const base = this.verts.length;
      for (let i = 0; i < n; i++) this.verts.push([part.positions[i * 3], part.positions[i * 3 + 1], part.positions[i * 3 + 2]]);
      for (let t = 0; t < part.indices.length; t += 3) {
        const a = part.indices[t]; const b = part.indices[t + 1]; const c = part.indices[t + 2];
        const u = (part.uvs[a * 2] + part.uvs[b * 2] + part.uvs[c * 2]) / 3;
        const v = (part.uvs[a * 2 + 1] + part.uvs[b * 2 + 1] + part.uvs[c * 2 + 1]) / 3;
        const mat = v < 1 / 32 ? (CELLS[Math.floor(u * 32)] || 'plastic_gray') : 'Body_Color';
        this.addFace([base + a, base + b, base + c], slot, mat);
      }
    }
  }
}

// Vertices of a { slot: parts } export, per slot.
export const partVerts = (parts) => (parts || []).reduce((s, q) => s + q.positions.length / 3, 0);
