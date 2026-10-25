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

// how a car drives, from its spec: pull (torque over mass), top speed (drag), boost (BT_Power)
export function handling(spec = {}) {
  const mass = spec.BD_Mass || 1400; const torque = spec.EG_Torque || 100; const drag = spec.EG_Drag || 0.4;
  return {
    accel: Math.max(0.35, Math.min(1.5, (torque / 100) * Math.sqrt(1400 / mass))),
    top: 62 * Math.sqrt(0.4 / drag) * Math.min(1.1, Math.sqrt(1400 / Math.max(1000, mass)) ** 0.3),
    boost: (spec.BT_Power || 150) / 150,
    grip: (spec.TI_Mu || 0.6) / 0.6,
  };
}
