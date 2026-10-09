// Reader / writer for RayCity ".0m" mesh files (reverse-engineered from car body files).
//
// Layout as understood so far (little endian):
//   header       magic AA 47 47 03, then scene/transform data (not decoded; kept as-is when writing)
//   submeshes    0xFF, u8 count, 4 unknown bytes, then `count` records placed 28 bytes apart
//                (the last one is 25 bytes, the 3 bytes in between are copied from the template).
//                Record fields: +1 u16 vertexCount, +3 u16 indexCount,
//                +5/+9/+17 [u8 1, u8 pad, u16 vertexStart], +21 [u8 1, u8 pad, u16 indexStart],
//                +13 unknown (kept from the template). The 3 bytes before each record are
//                submesh flags (flags[0] = render kind: 0 paint, 1 glass, 2 headlight, 3 taillight, 4 indicator).
//   geometry     bbox min/max (6 × f32)
//                u16 n, n × float3 position
//                u16 n, n × float3 normal
//                u16 0  (unused block, maybe vertex colors)
//                u16 n, n × float2 uv
//                u16 m, m × u16 index (local to each submesh, submeshes in table order)
// RayCity space: Z up, car front towards −Y, left side +X.
// three.js space used by the generator: Y up, front +Z, left +X  →  rc = (x, −z, y).
import * as THREE from 'three';

const MAGIC = 0x034747aa;
const REC_STRIDE = 28;
const REC_SIZE = 25;

function findGeometry(dv) {
  const len = dv.byteLength;
  for (let o = 0; o + 30 < len; o++) {
    const n = dv.getUint16(o + 24, true);
    if (n < 3) continue;
    const end = o + 26 + 12 * n;
    if (end + 2 > len || dv.getUint16(end, true) !== n) continue;
    // The normals are followed by an empty block and the uv count: rules out false matches.
    const nEnd = end + 2 + 12 * n;
    if (nEnd + 4 > len || dv.getUint16(nEnd, true) !== 0 || dv.getUint16(nEnd + 2, true) !== n) continue;
    const bb = [];
    for (let k = 0; k < 6; k++) bb.push(dv.getFloat32(o + 4 * k, true));
    if (!bb.every((v) => Number.isFinite(v) && Math.abs(v) < 100)) continue;
    if (!(bb[0] <= bb[3] && bb[1] <= bb[4] && bb[2] <= bb[5])) continue;
    let inside = true;
    for (let i = 0; i < n && inside; i++) {
      for (let k = 0; k < 3; k++) {
        const v = dv.getFloat32(o + 26 + 12 * i + 4 * k, true);
        if (!(v >= bb[k] - 1e-3 && v <= bb[k + 3] + 1e-3)) { inside = false; break; }
      }
    }
    if (inside) return o;
  }
  throw new Error('ไม่พบข้อมูลโมเดลในไฟล์ .0m');
}

function findSubmeshTable(dv, geomStart, vertexCount, indexCount) {
  for (let k = geomStart - 6; k >= 0; k--) {
    if (dv.getUint8(k) !== 0xff) continue;
    const count = dv.getUint8(k + 1);
    if (!count || k + 6 + REC_STRIDE * (count - 1) + REC_SIZE !== geomStart) continue;
    const recs = [];
    let sv = 0;
    let si = 0;
    for (let j = 0; j < count; j++) {
      const r = k + 6 + REC_STRIDE * j;
      const v = dv.getUint16(r + 1, true);
      const i = dv.getUint16(r + 3, true);
      // The 3 bytes before each record are per-submesh flags. flags[0] is the render kind:
      // 0 paint/texture, 1 glass, 2 headlight lens, 3 tail/brake light, 4 indicator/reverse light.
      // flags[1..2] are set on moving pieces (e.g. hood 00 01 02) — meaning not decoded yet.
      const flags = Array.from(new Uint8Array(dv.buffer, dv.byteOffset + r - 3, 3));
      recs.push({ vertexCount: v, indexCount: i, vertexStart: sv, indexStart: si, flags });
      sv += v;
      si += i;
    }
    if (sv === vertexCount && si === indexCount) return { offset: k, submeshes: recs };
  }
  return null;
}

export function parseOM(buffer) {
  const dv = new DataView(buffer);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('ไม่ใช่ไฟล์ .0m ของ RayCity');
  const start = findGeometry(dv);
  const bbox = new Float32Array(buffer.slice(start, start + 24));
  let p = start + 24;
  const n = dv.getUint16(p, true); p += 2;
  const positions = new Float32Array(buffer.slice(p, p + 12 * n)); p += 12 * n;
  p += 2;
  const normals = new Float32Array(buffer.slice(p, p + 12 * n)); p += 12 * n;
  const extra = dv.getUint16(p, true); p += 2;
  if (extra !== 0) throw new Error(`โครงสร้างไฟล์ยังไม่รองรับ (block=${extra})`);
  const nuv = dv.getUint16(p, true); p += 2;
  const uvs = new Float32Array(buffer.slice(p, p + 8 * nuv)); p += 8 * nuv;
  const ni = dv.getUint16(p, true); p += 2;
  const indices = new Uint16Array(buffer.slice(p, p + 2 * ni)); p += 2 * ni;
  const table = findSubmeshTable(dv, start, n, ni);
  return {
    buffer,
    bbox,
    positions, normals, uvs, indices,
    submeshes: table ? table.submeshes : [{ vertexCount: n, indexCount: ni, vertexStart: 0, indexStart: 0 }],
    tableOffset: table ? table.offset : -1,
    trailing: dv.byteLength - p,
  };
}

// Builds a THREE.Group (Y-up) with one mesh per submesh.
export const SUBMESH_KIND = { PAINT: 0, GLASS: 1, HEADLIGHT: 2, TAILLIGHT: 3, INDICATOR: 4 };

// materials: array (cycled per submesh) or function(kind, index) → material.
export function omToObject(om, materials) {
  const group = new THREE.Group();
  om.submeshes.forEach((s, k) => {
    const g = new THREE.BufferGeometry();
    const vs = s.vertexStart;
    const pos = new Float32Array(s.vertexCount * 3);
    const nrm = new Float32Array(s.vertexCount * 3);
    for (let i = 0; i < s.vertexCount; i++) {
      const a = (vs + i) * 3;
      pos.set([om.positions[a], om.positions[a + 2], -om.positions[a + 1]], i * 3);
      nrm.set([om.normals[a], om.normals[a + 2], -om.normals[a + 1]], i * 3);
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    if (om.uvs.length >= (vs + s.vertexCount) * 2) {
      g.setAttribute('uv', new THREE.BufferAttribute(om.uvs.slice(vs * 2, (vs + s.vertexCount) * 2), 2));
    }
    g.setIndex(new THREE.BufferAttribute(om.indices.slice(s.indexStart, s.indexStart + s.indexCount), 1));
    const kind = s.flags ? s.flags[0] : 0;
    const mat = typeof materials === 'function' ? materials(kind, k) : materials[k % materials.length];
    const mesh = new THREE.Mesh(g, mat);
    mesh.userData.kind = kind;
    mesh.name = `Submesh_${k}`;
    mesh.castShadow = true;
    group.add(mesh);
  });
  return group;
}

/**
 * Writes a .0m file. The header and record bytes that are not understood yet are copied
 * from `template` (a parsed .0m), only counts, offsets and geometry are replaced.
 * parts: [{ positions, normals, uvs, indices, kind? | flags? }] in RayCity space (Z up).
 */
export function writeOM(template, parts) {
  if (template.tableOffset < 0) throw new Error('ไฟล์แม่แบบไม่มีตารางชิ้นส่วนที่อ่านได้');
  if (!parts.length || parts.length > 255) throw new Error('จำนวนชิ้นส่วนต้องอยู่ระหว่าง 1–255');
  const nv = parts.reduce((s, q) => s + q.positions.length / 3, 0);
  const ni = parts.reduce((s, q) => s + q.indices.length, 0);
  if (nv > 65535 || ni > 65535) {
    throw new Error(`โมเดลใหญ่เกินไป (${nv} จุด / ${ni} index, สูงสุด 65535) ลองลดความละเอียดลง`);
  }
  const src = new Uint8Array(template.buffer);
  const k = template.tableOffset;
  const tplCount = template.submeshes.length;
  const tplRec = (j) => src.slice(k + 6 + REC_STRIDE * j, k + 6 + REC_STRIDE * j + REC_SIZE);
  const tplGap = (j) => src.slice(k + 6 + REC_STRIDE * j - 3, k + 6 + REC_STRIDE * j);

  const geomSize = 24 + 2 + nv * 12 + 2 + nv * 12 + 2 + 2 + nv * 8 + 2 + ni * 2;
  const tableSize = 6 + REC_STRIDE * (parts.length - 1) + REC_SIZE;
  const out = new Uint8Array(k + tableSize + geomSize);
  const dv = new DataView(out.buffer);
  out.set(src.slice(0, k), 0);
  let p = k;
  out.set(src.slice(k, k + 6), p);
  out[p + 1] = parts.length;
  p += 6;
  let vs = 0;
  let is = 0;
  parts.forEach((part, j) => {
    if (j > 0) out.set(tplCount > 1 ? tplGap(Math.min(j, tplCount - 1)) : new Uint8Array(3), p - 3);
    // Submesh flags: given by the part (kind = glass/light...) — never inherit the template's,
    // which could turn a random piece into glass or a moving hood.
    out.set(part.flags || [part.kind || 0, 0, 0], p - 3);
    const rec = tplRec(Math.min(j, tplCount - 1));
    out.set(rec, p);
    const v = part.positions.length / 3;
    const i = part.indices.length;
    dv.setUint16(p + 1, v, true);
    dv.setUint16(p + 3, i, true);
    for (const f of [5, 9, 17]) { out[f + p] = 1; dv.setUint16(p + f + 2, vs, true); }
    out[p + 21] = 1;
    dv.setUint16(p + 23, is, true);
    vs += v;
    is += i;
    p += j < parts.length - 1 ? REC_STRIDE : REC_SIZE;
  });

  // The stored bbox is a loose bound in original files: keep the template's and grow it if needed.
  const min = [template.bbox[0], template.bbox[1], template.bbox[2]];
  const max = [template.bbox[3], template.bbox[4], template.bbox[5]];
  for (const part of parts) {
    for (let a = 0; a < part.positions.length; a += 3) {
      for (let c = 0; c < 3; c++) {
        min[c] = Math.min(min[c], part.positions[a + c]);
        max[c] = Math.max(max[c], part.positions[a + c]);
      }
    }
  }
  for (const v of [...min, ...max]) { dv.setFloat32(p, v, true); p += 4; }
  const writeF32 = (key) => {
    for (const part of parts) for (const v of part[key]) { dv.setFloat32(p, v, true); p += 4; }
  };
  dv.setUint16(p, nv, true); p += 2;
  writeF32('positions');
  dv.setUint16(p, nv, true); p += 2;
  writeF32('normals');
  dv.setUint16(p, 0, true); p += 2;
  dv.setUint16(p, nv, true); p += 2;
  writeF32('uvs');
  dv.setUint16(p, ni, true); p += 2;
  for (const part of parts) for (const v of part.indices) { dv.setUint16(p, v, true); p += 2; }
  return out;
}

/**
 * Converts every mesh under `root` (one part per mesh material group) into RayCity-space parts.
 * `filter(mesh)` can skip meshes (e.g. wheels, which RayCity keeps in separate files).
 */
export function objectToParts(root, filter = () => true) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const parts = [];
  const v = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  root.traverse((o) => {
    if (!o.isMesh || !filter(o)) return;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    nm.getNormalMatrix(m);
    let g = o.geometry;
    if (!g.attributes.normal) { g = g.clone(); g.computeVertexNormals(); }
    const pos = g.attributes.position;
    const nrm = g.attributes.normal;
    const uv = g.attributes.uv;
    const index = g.index ? g.index.array : Array.from({ length: pos.count }, (_, i) => i);
    const groups = g.groups.length ? g.groups : [{ start: 0, count: index.length }];
    for (const grp of groups) {
      const remap = new Map();
      const P = [];
      const N = [];
      const U = [];
      const I = [];
      for (let t = grp.start; t < grp.start + grp.count; t++) {
        const src = index[t];
        let dst = remap.get(src);
        if (dst === undefined) {
          dst = remap.size;
          remap.set(src, dst);
          v.fromBufferAttribute(pos, src).applyMatrix4(m);
          P.push(v.x, -v.z, v.y);
          v.fromBufferAttribute(nrm, src).applyMatrix3(nm).normalize();
          N.push(v.x, -v.z, v.y);
          if (uv) U.push(uv.getX(src), uv.getY(src)); else U.push(0, 0);
        }
        I.push(dst);
      }
      const mat = Array.isArray(o.material) ? o.material[grp.materialIndex ?? 0] : o.material;
      if (I.length) parts.push({ name: mat?.name || o.name, positions: P, normals: N, uvs: U, indices: I });
    }
  });
  return parts;
}

// Merges parts that share a name (material), keeping every merged part under the u16 limits.
export function mergePartsByName(parts) {
  const byName = new Map();
  for (const part of parts) {
    let list = byName.get(part.name);
    if (!list) byName.set(part.name, (list = []));
    let cur = list[list.length - 1];
    if (!cur || cur.positions.length / 3 + part.positions.length / 3 > 65535) {
      cur = { name: part.name, positions: [], normals: [], uvs: [], indices: [] };
      list.push(cur);
    }
    const base = cur.positions.length / 3;
    cur.positions.push(...part.positions);
    cur.normals.push(...part.normals);
    cur.uvs.push(...part.uvs);
    for (const i of part.indices) cur.indices.push(base + i);
  }
  return [...byName.values()].flat();
}

// Submeshes of a parsed .0m as writeOM parts (flags kept).
export function omParts(om) {
  return om.submeshes.map((s) => ({
    positions: om.positions.slice(s.vertexStart * 3, (s.vertexStart + s.vertexCount) * 3),
    normals: om.normals.slice(s.vertexStart * 3, (s.vertexStart + s.vertexCount) * 3),
    uvs: om.uvs.slice(s.vertexStart * 2, (s.vertexStart + s.vertexCount) * 2),
    indices: om.indices.slice(s.indexStart, s.indexStart + s.indexCount),
    flags: s.flags.slice(),
  }));
}

// Lays parts out like the template's submesh table. Moving pieces (flags[1..2] set: doors 0/1, hood 2,
// door windows, ...) are found by the game through the template's header and flags, so every one of
// them keeps its index and flags; where the new car has no such piece, a hidden 1 mm triangle stands
// in at the template piece's position. The new car's own parts fill the other slots, then follow.
export function matchTemplateSubmeshes(template, parts) {
  // Stand-in: a closed 5 mm box (8 vertices, 12 triangles) at the template piece's first vertex.
  // The game's own files never have a submesh under 6 vertices, so no single triangles.
  const placeholder = (s) => {
    const i = s.vertexStart * 3;
    const [x, y, z] = [template.positions[i], template.positions[i + 1], template.positions[i + 2]];
    const d = 0.0025;
    const P = []; const N = [];
    for (let k = 0; k < 8; k++) {
      const c = [k & 1 ? 1 : -1, k & 2 ? 1 : -1, k & 4 ? 1 : -1];
      P.push(x + c[0] * d, y + c[1] * d, z + c[2] * d);
      const l = Math.sqrt(3);
      N.push(c[0] / l, c[1] / l, c[2] / l);
    }
    const u = template.uvs[s.vertexStart * 2]; const v = template.uvs[s.vertexStart * 2 + 1];
    return {
      positions: new Float32Array(P),
      normals: new Float32Array(N),
      uvs: new Float32Array(16).map((_, k) => (k % 2 ? v : u)),
      indices: new Uint16Array([0, 2, 3, 0, 3, 1, 4, 5, 7, 4, 7, 6, 0, 1, 5, 0, 5, 4, 2, 6, 7, 2, 7, 3, 0, 4, 6, 0, 6, 2, 1, 3, 7, 1, 7, 5]),
      flags: s.flags.slice(),
    };
  };
  const moving = (f) => f[1] !== 0 || f[2] !== 0;
  const own = parts.map((p) => ({ ...p, flags: [(p.flags ? p.flags[0] : p.kind) || 0, 0, 0] }));
  // Each template piece takes our piece of the same kind (paint, glass, lamp), else a stand-in.
  const out = template.submeshes.map((s) => {
    if (moving(s.flags)) return placeholder(s);
    const i = own.findIndex((p) => p.flags[0] === s.flags[0]);
    return i >= 0 ? own.splice(i, 1)[0] : placeholder(s);
  });
  return out.concat(own);
}
