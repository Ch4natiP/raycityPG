// The game's own cars for RayCity Drive (js/drive/rc-cars.js, pulled out of car/ by tools/extract-city.mjs):
// window.RC_CARS = base64 of gzip([u32 index length][index JSON][file bytes]). The index lists every car (name,
// spec numbers from car/carinfo, wheel positions under the arches, files as [offset, length]: mesh = compact parts,
// base / color = the paint mask and colour layer), the common wheel and the game's paints.

export async function loadGarage() {
  if (!window.RC_CARS) return null;
  const bin = Uint8Array.from(atob(window.RC_CARS), (c) => c.charCodeAt(0));
  const all = new Uint8Array(await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  const n = new DataView(all.buffer).getUint32(0, true);
  const index = JSON.parse(new TextDecoder().decode(all.subarray(4, 4 + n)));
  const data = all.subarray(4 + n);
  const file = (ref) => (ref ? data.subarray(ref[0], ref[0] + ref[1]) : null);
  return { ...index, file };
}

// compact parts → [{ positions, normals, uvs, indices, flags }] in RayCity space (z up, front −y)
export function compactParts(bytes) {
  const out = []; const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let o = 0;
  while (o + 9 <= bytes.length) {
    const flags = [bytes[o], bytes[o + 1], bytes[o + 2]]; const n = dv.getUint16(o + 3, true); const ni = dv.getUint32(o + 5, true); o += 9;
    const positions = new Float32Array(n * 3); const normals = new Float32Array(n * 3); const uvs = new Float32Array(n * 2); const indices = new Uint32Array(ni);
    for (let i = 0; i < n * 3; i++) positions[i] = dv.getInt16(o + i * 2, true) / 4000; o += n * 6;
    for (let i = 0; i < n * 3; i++) normals[i] = dv.getInt8(o + i) / 127; o += n * 3;
    for (let i = 0; i < n * 2; i++) uvs[i] = dv.getInt16(o + i * 2, true) / 8000; o += n * 4;
    for (let i = 0; i < ni; i++) indices[i] = dv.getUint16(o + i * 2, true); o += ni * 2;
    out.push({ positions, normals, uvs, indices, flags });
  }
  return out;
}

// how a car drives, from its spec: pull (torque over mass), top speed (drag), boost (BT_Power, BT_Duration seconds)
export function handling(spec = {}) {
  const mass = spec.BD_Mass || 1400; const torque = spec.EG_Torque || 100; const drag = spec.EG_Drag || 0.4;
  return {
    accel: Math.max(0.35, Math.min(1.5, (torque / 100) * Math.sqrt(1400 / mass))),
    top: 62 * Math.sqrt(0.4 / drag) * Math.min(1.1, Math.sqrt(1400 / Math.max(1000, mass)) ** 0.3),
    boost: (spec.BT_Power || 150) / 150,
    boostTime: spec.BT_Duration || 3,
    grip: (spec.TI_Mu || 0.6) / 0.6,
  };
}

// the game's garage as a scene: pictures and, on the lit pieces, the baked light on the second uv set.
// RayCity (x, y, z up) → three (x, z, −y).
export function garageScene(garage, THREE) {
  const g = new THREE.Group(); if (!garage || !garage.garage) return g;
  const texCache = new Map();
  const tex = (ref) => {
    if (!ref) return null; const k = ref[0]; if (texCache.has(k)) return texCache.get(k);
    const t = new THREE.Texture(); t.flipY = false; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
    createImageBitmap(new Blob([garage.file(ref)])).then((bm) => { t.image = bm; t.needsUpdate = true; });
    texCache.set(k, t); return t;
  };
  for (const m of garage.garage.meshes) {
    const b = garage.file(m.data); const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); let o = 0; const n = m.n;
    const P = new Float32Array(n * 3); const N = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { P[i * 3] = dv.getInt16(o + i * 6, true) / 1000; P[i * 3 + 1] = dv.getInt16(o + i * 6 + 4, true) / 1000; P[i * 3 + 2] = -dv.getInt16(o + i * 6 + 2, true) / 1000; } o += n * 6;
    for (let i = 0; i < n; i++) { N[i * 3] = dv.getInt8(o + i * 3) / 127; N[i * 3 + 1] = dv.getInt8(o + i * 3 + 2) / 127; N[i * 3 + 2] = -dv.getInt8(o + i * 3 + 1) / 127; } o += n * 3;
    const uv = (off) => { const U = new Float32Array(n * 2); for (let i = 0; i < n * 2; i++) U[i] = dv.getInt16(off + i * 2, true) / 400; return U; };
    const U0 = uv(o); o += n * 4; const U1 = m.lit ? uv(o) : null; if (m.lit) o += n * 4;
    const I = new Uint16Array(m.ni); for (let i = 0; i < m.ni; i++) I[i] = dv.getUint16(o + i * 2, true);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(U0, 2)); if (U1) geo.setAttribute('uv1', new THREE.BufferAttribute(U1, 2)); geo.setIndex(new THREE.BufferAttribute(I, 1));
    if (N.every((v) => v === 0)) geo.computeVertexNormals();
    let mat;
    const lm = m.lit ? tex(m.light) : null;
    if (lm) { lm.channel = 1; mat = new THREE.MeshBasicMaterial({ map: tex(m.tex), lightMap: lm, lightMapIntensity: 0.75, side: THREE.DoubleSide }); }
    else mat = new THREE.MeshLambertMaterial({ map: tex(m.tex), side: THREE.DoubleSide });
    g.add(new THREE.Mesh(geo, mat));
  }
  return g;
}
