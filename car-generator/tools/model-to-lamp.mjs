// Turn a 3D model (glTF) into a RayCity roof lamp: the geometry becomes <name>_0/1/2.0m (three LODs), and the model's
// base-colour texture becomes the lamp picture common_lamp_<name>.png/_s.dds (128, optionally tinted), its UVs remapped
// into the lamp slot (u 0–0.125, v 0.375–0.5). A line for lamp/list.xml and a shop icon are printed / written too.
//   node tools/model-to-lamp.mjs <model folder with scene.gltf> <lamp template .0m> <out folder> <name> [faceDeg] [heightM] [tint]
// faceDeg turns the model to aim its front (RayCity front is −Y); heightM is how tall it sits on the roof (default 0.34);
// tint is none|gold (gold makes it look like a cast-gold ornament). Needs headless Chromium (playwright-core; CHROME=path),
// three.js + meshoptimizer from node_modules. The model's own texture must be a baseColor image next to the glTF.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { dds, ddsLike, png } from './img-lib.mjs';
import { writeOM, parseOM } from '../js/om.js';

const LODS = [[2, 7000], [1, 2500], [0, 800]]; // lod → target triangle count
const SLOT = { u0: 0, u1: 0.125, v0: 0.375, v1: 0.5 }; // where a lamp's UVs sit

// weld by a key, returning unique arrays and an index
function weld(count, key, take) {
  const map = new Map(); const out = { P: [], N: [], U: [] }; const idx = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    const k = key(i); let j = map.get(k);
    if (j === undefined) { j = out.P.length / 3; map.set(k, j); take(i, out); }
    idx[i] = j;
  }
  return { ...out, idx };
}

export async function page(root, modelDir) {
  const srv = http.createServer((rq, rs) => {
    let rel = decodeURIComponent(rq.url.split('?')[0]);
    const f = rel.startsWith('/model/') ? path.join(modelDir, rel.slice('/model/'.length)) : path.join(root, rel);
    const base = rel.startsWith('/model/') ? path.resolve(modelDir) : root;
    if (!path.resolve(f).startsWith(base) || !fs.existsSync(f)) { rs.writeHead(404); rs.end(); return; }
    rs.writeHead(200, { 'content-type': /\.html$/.test(f) ? 'text/html' : /\.m?js$/.test(f) ? 'text/javascript' : /\.gltf$/.test(f) ? 'model/gltf+json' : 'application/octet-stream' }); rs.end(fs.readFileSync(f));
  }).listen(0);
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const pg = await browser.newPage();
  await pg.route('https://cdn.jsdelivr.net/npm/three@*/**', (r) => r.fulfill({ path: path.join(root, 'node_modules/three', new URL(r.request().url()).pathname.replace(/^\/npm\/three@[^/]+\//, '')), contentType: 'text/javascript' }));
  await pg.goto(`http://localhost:${srv.address().port}/tools/model-to-lamp.html`); await pg.waitForFunction(() => window.ready);
  return { pg, port: srv.address().port, close: async () => { await browser.close(); srv.close(); } };
}

// gold tint: luminance mapped onto a bronze→gold→pale ramp, a little of the original kept
function goldify(rgba, w, h) {
  const lo = [60, 38, 10], mid = [196, 150, 40], hi = [255, 224, 120]; const o = Buffer.from(rgba);
  for (let i = 0; i < o.length; i += 4) {
    const t = Math.min(1, (o[i] * 0.3 + o[i + 1] * 0.59 + o[i + 2] * 0.11) / 255 * 1.15);
    for (let c = 0; c < 3; c++) { const g = t < 0.5 ? lo[c] + (mid[c] - lo[c]) * (t / 0.5) : mid[c] + (hi[c] - mid[c]) * ((t - 0.5) / 0.5); o[i + c] = Math.max(0, Math.min(255, g * 0.82 + rgba[i + c] * 0.18)); }
    o[i + 3] = 255;
  }
  return o;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [modelDir, tplPath, outDir, name, faceDeg = '0', heightM = '0.34', tint = 'none', liftM = '0'] = process.argv.slice(2);
  if (!modelDir || !tplPath || !outDir || !name) { console.error('usage: node tools/model-to-lamp.mjs <model folder> <lamp template .0m> <out folder> <name> [faceDeg] [heightM] [tint]'); process.exit(1); }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  fs.mkdirSync(path.join(outDir, 'icon'), { recursive: true });
  const mo = await import('meshoptimizer'); const Simp = mo.MeshoptSimplifier; await Simp.ready;
  const { pg, close } = await page(root, path.resolve(modelDir));
  try {
    await pg.evaluate((u) => window.load(u), '/model/scene.gltf');
    const g = await pg.evaluate(([h, f, l]) => window.build(h, f, l), [+heightM, +faceDeg, +liftM]);
    // weld duplicate (position+uv) verts, then position-weld for adjacency so the simplifier can collapse seams
    const q = (v) => v.toFixed(4);
    const w1 = weld(g.count, (i) => `${q(g.P[i * 3])},${q(g.P[i * 3 + 1])},${q(g.P[i * 3 + 2])},${q(g.U[i * 2])},${q(g.U[i * 2 + 1])}`,
      (i, o) => { o.P.push(g.P[i * 3], g.P[i * 3 + 1], g.P[i * 3 + 2]); o.N.push(g.N[i * 3], g.N[i * 3 + 1], g.N[i * 3 + 2]); o.U.push(g.U[i * 2], g.U[i * 2 + 1]); });
    const pw = weld(w1.P.length / 3, (i) => `${q(w1.P[i * 3])},${q(w1.P[i * 3 + 1])},${q(w1.P[i * 3 + 2])}`,
      (i, o) => { o.P.push(w1.P[i * 3], w1.P[i * 3 + 1], w1.P[i * 3 + 2]); o.N.push(w1.N[i * 3], w1.N[i * 3 + 1], w1.N[i * 3 + 2]); o.U.push(w1.U[i * 2], w1.U[i * 2 + 1]); });
    const pwPos = new Float32Array(pw.P); const pwIdx = new Uint32Array(w1.idx.length); for (let i = 0; i < w1.idx.length; i++) pwIdx[i] = pw.idx[w1.idx[i]];
    const tpl = parseOM(new Uint8Array(fs.readFileSync(tplPath)).buffer);
    const writeLod = (lod, indices) => {
      const used = new Map(); const rp = [], rn = [], ru = []; const ri = new Array(indices.length);
      for (let i = 0; i < indices.length; i++) { const v = indices[i]; let n = used.get(v); if (n === undefined) { n = rp.length / 3; used.set(v, n); rp.push(pwPos[v * 3], pwPos[v * 3 + 1], pwPos[v * 3 + 2]); rn.push(pw.N[v * 3], pw.N[v * 3 + 1], pw.N[v * 3 + 2]); ru.push(SLOT.u0 + pw.U[v * 2] * (SLOT.u1 - SLOT.u0), SLOT.v0 + pw.U[v * 2 + 1] * (SLOT.v1 - SLOT.v0)); } ri[i] = n; }
      fs.writeFileSync(path.join(outDir, `${name}_${lod}.0m`), Buffer.from(writeOM(tpl, [{ positions: new Float32Array(rp), normals: new Float32Array(rn), uvs: new Float32Array(ru), indices: ri, flags: [0, 0, 0] }])));
      console.log(`${name}_${lod}.0m  ${rp.length / 3} verts  ${ri.length / 3} tris`);
    };
    for (const [lod, tris] of LODS) { const [si] = Simp.simplify(pwIdx, pwPos, 3, tris * 3, 1.0, []); writeLod(lod, Array.from(si)); }
    // the lamp picture: the model's baseColor (128), tinted, UVs already remapped into the slot above
    const texFile = fs.readdirSync(modelDir, { recursive: true }).find((f) => /basecolor|diffuse|albedo/i.test(f) && /\.(png|jpe?g)$/i.test(f)) || fs.readdirSync(path.join(modelDir, 'textures')).find((f) => /\.(png|jpe?g)$/i.test(f));
    const img = await pg.evaluate(async (p) => {
      const im = new Image(); await new Promise((ok) => { im.onload = ok; im.src = p; });
      const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); x.drawImage(im, 0, 0, 128, 128);
      const d = x.getImageData(0, 0, 128, 128).data; let s = ''; for (let i = 0; i < d.length; i += 32768) s += String.fromCharCode.apply(null, d.subarray(i, i + 32768)); return btoa(s);
    }, '/model/textures/' + texFile.split('/').pop());
    let rgba = Buffer.from(Uint8ClampedArray.from(atob(img), (ch) => ch.charCodeAt(0)));
    if (tint === 'gold') rgba = goldify(rgba, 128, 128);
    fs.writeFileSync(path.join(outDir, `common_lamp_${name}.png`), png(128, 128, 4, rgba));
    // a 128 DXT3 lamp picture: the header comes from the template lamp's own _s.dds (next to its .0m)
    const ddsTpl = tplPath.replace(/_\d\.0m$/, '_s.dds');
    fs.writeFileSync(path.join(outDir, `common_lamp_${name}_s.dds`), ddsLike(fs.readFileSync(ddsTpl), 128, 128, rgba));
    console.log(`list.xml: <part id='?' name='${name}' mesh='${name}' tex='common_lamp_${name}'/>`);
  } finally { await close(); }
}
