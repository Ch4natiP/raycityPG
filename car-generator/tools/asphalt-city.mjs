// Black asphalt like Bangkok's roads for the game's city (the road surfaces' pictures; the road shapes are left
// as they are): the asphalt's grain kept but brought down to a deep, nearly neutral black, the painted lines and
// marks (much brighter than the asphalt around them) kept bright, so they stand out like fresh paint on new road.
// Pictures keep their names, sizes, DXT kind and mip levels.
//   node tools/asphalt-city.mjs <out folder> <picture.dds> [more .dds...]
// Seoul's road pictures (field/common/tex.jmd; some sectors keep their own copies, <sector>_road_asphalt_a_02):
export const ASPHALT = ['road_asphalt', 'road_asphalt_a_02', 'highway_002_72', 'highway_004_72', 'etc_asphalt_parking_00', 'etc_asphalt_01', 'etc_asphalt_01_00'];
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dds, ddsLike } from './img-lib.mjs';

// RGBA → RGBA: asphalt 46 bright on average (sRGB), its grain at 70 %, a touch cool. Marks are told from the
// grain by the brightness around them (7 × 7 px, wrapping like the tiling picture): a painted line is a bright
// patch, a pale stone a lone pixel; where the surroundings are 20–45 over the average, the old colour comes back
export function blacken(data, w, h) {
  let sum = 0; let n = 0; const L = new Float32Array(w * h);
  for (let i = 0; i < L.length; i++) { L[i] = data[i * 4] * 0.3 + data[i * 4 + 1] * 0.59 + data[i * 4 + 2] * 0.11; if (data[i * 4 + 3] >= 128) { sum += L[i]; n++; } }
  const m = n ? sum / n : 0; const out = Buffer.from(data);
  const R = 3; const A = new Float32Array(w * h); const B = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let t = 0; for (let d = -R; d <= R; d++) t += L[y * w + ((x + d + w) % w)]; A[y * w + x] = t / (2 * R + 1); }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let t = 0; for (let d = -R; d <= R; d++) t += A[((y + d + h) % h) * w + x]; B[y * w + x] = t / (2 * R + 1); }
  for (let i = 0; i < L.length; i++) {
    const v = 46 + (L[i] - m) * 0.7; const dark = [v * 0.98, v, v * 1.04];
    const t = Math.max(0, Math.min(1, (B[i] - m - 20) / 25)); const k = t * t * (3 - 2 * t);
    for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.max(0, Math.min(255, dark[c] + (data[i * 4 + c] - dark[c]) * k));
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [outDir, ...inputs] = process.argv.slice(2);
  if (!outDir || !inputs.length) { console.error('usage: node tools/asphalt-city.mjs <out folder> <picture.dds>...'); process.exit(1); }
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of inputs) { const raw = fs.readFileSync(f); const { w, h, data } = dds(raw); fs.writeFileSync(path.join(outDir, path.basename(f)), ddsLike(raw, w, h, blacken(data, w, h))); }
  console.log(`${inputs.length} road pictures made black`);
}
