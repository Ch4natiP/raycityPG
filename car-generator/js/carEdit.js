// Making a new car from an existing RayCity car folder: per-part scale / move / polygon reduction and
// a whole-car scale, applied to every .0m of the folder through writeOM with the original file as the
// template (untouched files stay byte-identical), plus renaming everything to the new car's name.
//
// RayCity space: x = left, y = back (front is −y), z = up, metres.
import { MeshoptSimplifier } from 'meshoptimizer';
import { parseOM, writeOM, omParts } from './om.js';

export const IDENTITY = { scale: [1, 1, 1], move: [0, 0, 0], keep: 1 };
const isIdentity = (e) => !e || (e.scale.every((v) => v === 1) && e.move.every((v) => v === 0) && e.keep >= 1);

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

// Fewer triangles for one submesh (borders locked so parts keep their outline), unused vertices dropped.
function reduce(part, keep) {
  const tris = part.indices.length / 3;
  const target = Math.max(1, Math.round(tris * keep));
  if (keep >= 1 || tris <= 4) return part;
  const idx = MeshoptSimplifier.simplify(new Uint32Array(part.indices), new Float32Array(part.positions), 3, target * 3, 1, ['LockBorder'])[0];
  const remap = new Map();
  const P = []; const N = []; const UV = []; const I = [];
  for (const v of idx) {
    let r = remap.get(v);
    if (r === undefined) {
      r = P.length / 3;
      remap.set(v, r);
      P.push(part.positions[v * 3], part.positions[v * 3 + 1], part.positions[v * 3 + 2]);
      N.push(part.normals[v * 3], part.normals[v * 3 + 1], part.normals[v * 3 + 2]);
      UV.push(part.uvs[v * 2], part.uvs[v * 2 + 1]);
    }
    I.push(r);
  }
  if (I.length < 3) return part; // never reduce a submesh away
  return { ...part, positions: new Float32Array(P), normals: new Float32Array(N), uvs: new Float32Array(UV), indices: new Uint16Array(I) };
}

// One .0m with the part's edit (around `pivot`) then the whole-car scale (around `carPivot`).
// Returns the new file bytes, or null when nothing changes.
export function editFile(bytes, edit, car, pivot, carPivot) {
  if (isIdentity(edit) && isIdentity(car)) return null;
  const e = edit || IDENTITY;
  const g = car || IDENTITY;
  const om = parseOM(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const s = [0, 1, 2].map((k) => e.scale[k] * g.scale[k]);
  const parts = omParts(om).map((part) => {
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
    return reduce(part, Math.min(e.keep, g.keep));
  });
  return writeOM(om, parts);
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
