import fs from 'fs';
const { parseOM } = await import('./js/om.js');
const f = process.argv[2]; const b = fs.readFileSync(f); const om = parseOM(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
let area = 0, degenerate = 0;
for (const s of om.submeshes) {
  for (let t = s.indexStart; t < s.indexStart + s.indexCount; t += 3) {
    const v = [0,1,2].map(k => { const i = (s.vertexStart + om.indices[t+k]) * 3; return [om.positions[i], om.positions[i+1], om.positions[i+2]]; });
    const u = [v[1][0]-v[0][0], v[1][1]-v[0][1], v[1][2]-v[0][2]], w = [v[2][0]-v[0][0], v[2][1]-v[0][1], v[2][2]-v[0][2]];
    const c = [u[1]*w[2]-u[2]*w[1], u[2]*w[0]-u[0]*w[2], u[0]*w[1]-u[1]*w[0]]; const a = Math.hypot(...c)/2; area += a; if (a < 1e-7) degenerate++;
  }
}
console.log(f.split('/').slice(-2).join('/'), 'submeshes', om.submeshes.length, 'tris', om.indices.length/3, 'area', area.toFixed(3), 'degenerate', degenerate);
