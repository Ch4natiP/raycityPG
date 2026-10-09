// Making a new car from an existing RayCity car folder: per-part scale / move / polygon reduction and
// a whole-car scale, applied to every .0m of the folder through writeOM with the original file as the
// template (untouched files stay byte-identical), plus renaming everything to the new car's name.
//
// RayCity space: x = left, y = back (front is −y), z = up, metres.
import { MeshoptSimplifier } from 'meshoptimizer';
import { parseOM, writeOM, omParts } from './om.js';

export const IDENTITY = { scale: [1, 1, 1], move: [0, 0, 0], keep: 1, maxVerts: 0 };
const isIdentity = (e) => !e || (e.scale.every((v) => v === 1) && e.move.every((v) => v === 0) && e.keep >= 1 && !e.maxVerts);

// Slot of a file in a car folder: '' (body) or the part folder.
export const slotOfPath = (rel) => (rel.includes('/') ? rel.slice(0, rel.indexOf('/')) : '');

export function bboxOf(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], positions[i + k]); max[k] = Math.max(max[k], positions[i + k]); }
  }
  return { min, max, center: min.map((v, k) => (v + max[k]) / 2) };
}

// Shape-keeping reduction of one submesh to about `keep` of its triangles.
// Vertices at the same place with the same UV and normals within 35° are welded first: split normals
// would otherwise look like open borders to the simplifier, which then can't remove anything near
// them. Real creases and UV seams stay split, and borders are locked, so neighbouring parts and the
// texture layout stay intact. Returns { part, error } (error in metres, the largest shape change).
const WELD_COS = Math.cos((35 * Math.PI) / 180);
// mode 0: borders locked (best shape). 1: borders may collapse too. minPiece: separate pieces smaller
// than this (metres, bounding-box diagonal) are dropped first (bolts, clips, small lettering).
function reduce(part, keep, mode = 0, minPiece = 0) {
  const tris = part.indices.length / 3;
  if ((keep >= 1 && !minPiece) || tris <= 4) return { part, error: 0 };
  const P = part.positions; const N = part.normals; const UV = part.uvs;
  const nv = P.length / 3;
  const canon = new Int32Array(nv);
  const buckets = new Map();
  const cP = []; const cN = []; const cUV = []; const members = [];
  for (let v = 0; v < nv; v++) {
    const key = `${Math.round(P[v * 3] * 1e5)},${Math.round(P[v * 3 + 1] * 1e5)},${Math.round(P[v * 3 + 2] * 1e5)},${Math.round(UV[v * 2] * 1e5)},${Math.round(UV[v * 2 + 1] * 1e5)}`;
    const list = buckets.get(key) || [];
    let c = list.find((k) => cN[k * 3] * N[v * 3] + cN[k * 3 + 1] * N[v * 3 + 1] + cN[k * 3 + 2] * N[v * 3 + 2] >= WELD_COS * members[k]);
    if (c === undefined) {
      c = cP.length / 3;
      cP.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); cUV.push(UV[v * 2], UV[v * 2 + 1]); cN.push(0, 0, 0); members.push(0);
      list.push(c);
      buckets.set(key, list);
    }
    cN[c * 3] += N[v * 3]; cN[c * 3 + 1] += N[v * 3 + 1]; cN[c * 3 + 2] += N[v * 3 + 2]; members[c]++;
    canon[v] = c;
  }
  let idx = [];
  for (let t = 0; t < part.indices.length; t += 3) {
    const a = canon[part.indices[t]]; const b = canon[part.indices[t + 1]]; const c = canon[part.indices[t + 2]];
    if (a !== b && b !== c && a !== c) idx.push(a, b, c);
  }
  if (minPiece > 0) idx = dropSmallPieces(idx, cP, minPiece);
  if (idx.length < 3) return { part, error: 0 };
  const target = Math.max(1, Math.round((idx.length / 3) * Math.min(1, keep)));
  const posArr = new Float32Array(cP);
  const [out, relErr] = keep >= 1 ? [new Uint32Array(idx), 0]
    : MeshoptSimplifier.simplify(new Uint32Array(idx), posArr, 3, target * 3, 1, mode === 0 ? ['LockBorder'] : []);
  const bb = bboxOf(posArr);
  const extent = Math.max(...bb.max.map((v, k) => v - bb.min[k]));
  const remap = new Map();
  const oP = []; const oN = []; const oUV = []; const oI = [];
  for (const c of out) {
    let r = remap.get(c);
    if (r === undefined) {
      r = oP.length / 3;
      remap.set(c, r);
      const l = Math.hypot(cN[c * 3], cN[c * 3 + 1], cN[c * 3 + 2]) || 1;
      oP.push(cP[c * 3], cP[c * 3 + 1], cP[c * 3 + 2]);
      oN.push(cN[c * 3] / l, cN[c * 3 + 1] / l, cN[c * 3 + 2] / l);
      oUV.push(cUV[c * 2], cUV[c * 2 + 1]);
    }
    oI.push(r);
  }
  if (oI.length < 3 || oP.length / 3 > 65535) return { part, error: 0 }; // never reduce a submesh away
  return {
    part: { ...part, positions: new Float32Array(oP), normals: new Float32Array(oN), uvs: new Float32Array(oUV), indices: new Uint16Array(oI) },
    error: relErr * extent,
  };
}

// Connected pieces (by shared position) smaller than `size` are removed.
function dropSmallPieces(idx, P, size) {
  const parent = new Int32Array(P.length / 3).map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const key = (v) => `${Math.round(P[v * 3] * 1e4)},${Math.round(P[v * 3 + 1] * 1e4)},${Math.round(P[v * 3 + 2] * 1e4)}`;
  const byPos = new Map();
  for (let v = 0; v < P.length / 3; v++) { const k = key(v); if (byPos.has(k)) parent[find(v)] = find(byPos.get(k)); else byPos.set(k, v); }
  for (let t = 0; t < idx.length; t += 3) { parent[find(idx[t])] = find(idx[t + 1]); parent[find(idx[t + 2])] = find(idx[t + 1]); }
  const box = new Map();
  for (const v of idx) {
    const r = find(v);
    const b = box.get(r) || [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], P[v * 3 + k]); b[k + 3] = Math.max(b[k + 3], P[v * 3 + k]); }
    box.set(r, b);
  }
  const diag = (r) => { const b = box.get(r); return Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]); };
  // Never everything: a submesh made only of small pieces keeps its largest one.
  let largest = -1; let largestD = -1;
  for (const r of box.keys()) { const d = diag(r); if (d > largestD) { largestD = d; largest = r; } }
  const keepPiece = (r) => diag(r) >= size || r === largest;
  const out = [];
  for (let t = 0; t < idx.length; t += 3) if (keepPiece(find(idx[t]))) out.push(idx[t], idx[t + 1], idx[t + 2]);
  return out;
}

// One .0m with the part's edit (around `pivot`) then the whole-car scale (around `carPivot`), the
// polygon keep ratios, and the whole-car vertex cap (the least reduction that fits under it).
// Returns { bytes, error, verts } or null when nothing changes.
export function editFileInfo(bytes, edit, car, pivot, carPivot) {
  if (isIdentity(edit) && isIdentity(car)) return null;
  const e = edit || IDENTITY;
  const g = car || IDENTITY;
  const om = parseOM(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const s = [0, 1, 2].map((k) => e.scale[k] * g.scale[k]);
  const moved = omParts(om).map((part) => {
    const P = part.positions; const N = part.normals;
    for (let i = 0; i < P.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        let v = (P[i + k] - pivot[k]) * e.scale[k] + pivot[k] + e.move[k];
        v = (v - carPivot[k]) * g.scale[k] + carPivot[k];
        P[i + k] = v;
      }
      // Normals follow the inverse scale.
      const n = [N[i] / s[0], N[i + 1] / s[1], N[i + 2] / s[2]];
      const l = Math.hypot(...n) || 1;
      N[i] = n[0] / l; N[i + 1] = n[1] / l; N[i + 2] = n[2] / l;
    }
    return part;
  });
  const base = Math.min(e.keep, g.keep);
  const run = (keep, mode = 0, minPiece = 0) => {
    const res = moved.map((p) => reduce(p, keep, mode, minPiece));
    return { parts: res.map((r) => r.part), error: Math.max(0, ...res.map((r) => r.error)), verts: res.reduce((n, r) => n + r.part.positions.length / 3, 0) };
  };
  let best = run(base);
  const cap = g.maxVerts || 0;
  if (cap && best.verts > cap) {
    // Least damage first: borders locked, then borders free, then tiny separate pieces dropped
    // (growing size); within a stage, binary search for the most triangles that fit under the cap.
    const stages = [[0, 0], [1, 0], [1, 0.02], [1, 0.05], [1, 0.1], [1, 0.2], [1, 0.4]];
    for (const [mode, minPiece] of stages) {
      const low = run(0.01, mode, minPiece);
      if (low.verts > cap) { best = low; continue; }
      let lo = 0.01; let hi = base;
      best = low;
      for (let k = 0; k < 9; k++) {
        const mid = (lo + hi) / 2;
        const r = run(mid, mode, minPiece);
        if (r.verts <= cap) { lo = mid; best = r; } else hi = mid;
      }
      break;
    }
  }
  return { bytes: writeOM(om, best.parts), error: best.error, verts: best.verts };
}

export function editFile(bytes, edit, car, pivot, carPivot) {
  return editFileInfo(bytes, edit, car, pivot, carPivot)?.bytes || null;
}

export const ready = MeshoptSimplifier.ready;

// Vertex / triangle counts of a .0m.
export function countsOf(bytes) {
  const om = parseOM(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return { verts: om.positions.length / 3, tris: om.indices.length / 3 };
}

// mesh.xml (UTF-16 collision hull): the whole-car scale applied to every pos="x y z".
export function editMeshXml(text, car, carPivot) {
  if (isIdentity(car)) return null;
  return text.replace(/pos=(["'])([^"']+)\1/g, (_, q, v) => {
    const p = v.trim().split(/\s+/).map(Number);
    return `pos=${q}${p.map((c, k) => ((c - carPivot[k]) * car.scale[k] + carPivot[k]).toFixed(10)).join(' ')}${q}`;
  });
}

// New path for a file when the car is renamed (folder prefix and every "<old>" in the file name).
export function renamePath(rel, oldName, newName) {
  if (!newName || newName === oldName) return rel;
  const parts = rel.split('/');
  parts[parts.length - 1] = parts[parts.length - 1].split(oldName).join(newName);
  return parts.join('/');
}
