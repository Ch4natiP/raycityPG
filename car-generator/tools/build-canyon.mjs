// Build a RayCity car folder from a realistic glTF/GLB model by driving the real web tools headlessly,
// exactly the way the known-good packs 90/91 were made: RayCity-Easy (model's own surface, wheels fit to
// the game's wheels) -> RayCity-UV ⚡ (decal sheet + glass + plates + tail lamps, doors/hood opened). The
// built RayCity-Easy.html / RayCity-UV.html are self-contained (three.js bundled, templates embedded), so
// nothing is fetched from the internet. Needs the pre-installed Chromium (CHROME=path, or Playwright's).
//
//   node tools/build-canyon.mjs <model-dir-with-scene.gltf> <out-dir> [--name canyon] [--body new|old]
//     [--poly 60000|4800] [--colour tail|pickup|band|one] [--no-fit] [--light] [--no-doors] [--no-cap]
//
// --light         drop the model's interior/engine (hideInterior), a lighter car
// --no-doors      skip the Escarabajo-style completion (no opening doors/hood)
// --no-cap        don't let ⚡ reduce files over the game's point limit (heavier, can crash the game)
// Writes <out-dir>/<name>.zip (unpacks to <name>/, pack that to <name>.jmd for the game).
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : d; };
const flag = (f) => { const i = args.indexOf(f); if (i >= 0) { args.splice(i, 1); return true; } return false; };
const NAME = opt('--name', 'canyon');
const BODY = opt('--body', 'new');            // new = model's own surface (packs 90/91); old = bend gtv98
const UV = opt('--uv', 'template');           // new-body UV cut: template (copy gtv98 UVs, repaintable) | charts | islands
const POLY = opt('--poly', '60000');          // 60000 = no reduce (real geometry); 4800 = reduce per file
const COLOUR = opt('--colour', 'tail');       // tail | pickup | band | one
const FIT = !flag('--no-fit');                // fit wheel arches to the game's wheels
const FLIP = flag('--flip');                  // turn the model around (front was +y / faced backward)
const LIGHT = flag('--light');                // drop interior/engine
const DOORS = !flag('--no-doors');            // Escarabajo-style completion (opening doors + hood)
const NOCAP = flag('--no-cap');               // lift the per-file point cap in ⚡
const NO_READY = flag('--no-ready');          // skip the UV ⚡ (toSheet/glass/plate/tail): keep the raw convert output (gtv98-copied UVs)
const [MODEL_DIR, OUT_DIR] = args;
if (!MODEL_DIR || !OUT_DIR) {
  console.error('usage: node tools/build-canyon.mjs <model-dir> <out-dir> [--name canyon] [--body new|old] [--poly 60000|4800] [--colour tail|pickup|band|one] [--no-fit] [--light] [--no-doors] [--no-cap]');
  process.exit(1);
}
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODEL = path.resolve(MODEL_DIR);
fs.mkdirSync(path.resolve(OUT_DIR), { recursive: true });

// The model's files, by basename (three's LoadingManager matches texture/buffer URIs by basename).
const MIME = { '.gltf': 'model/gltf+json', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.bmp': 'image/bmp', '.tga': 'image/x-tga', '.obj': 'text/plain', '.fbx': 'application/octet-stream', '.mtl': 'text/plain' };
const modelFiles = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else modelFiles.push(f); } })(MODEL);
const main = modelFiles.find((f) => /\.(glb|gltf|fbx|obj)$/i.test(f));
if (!main) { console.error('no model file (.glb/.gltf/.fbx/.obj) in', MODEL); process.exit(1); }
// What the page fetches from /model/: every file that the model could reference, flat by basename.
const served = new Map(modelFiles.map((f) => [path.basename(f).toLowerCase(), f]));

const srv = http.createServer((rq, rs) => {
  const rel = decodeURIComponent(rq.url.split('?')[0]);
  let file;
  if (rel.startsWith('/model/')) file = served.get(rel.slice('/model/'.length).toLowerCase());
  else { const f = path.join(ROOT, rel); if (path.resolve(f).startsWith(ROOT) && fs.existsSync(f) && fs.statSync(f).isFile()) file = f; }
  if (!file) { rs.writeHead(404); rs.end(); return; }
  const ct = /\.html$/.test(file) ? 'text/html' : /\.m?js$/.test(file) ? 'text/javascript' : MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  rs.writeHead(200, { 'content-type': ct }); rs.end(fs.readFileSync(file));
}).listen(0);
const PORT = srv.address().port;
const base = `http://localhost:${PORT}`;
const say = (s) => console.log(`[canyon] ${s}`);

// The model files as {name, url} for the page to fetch and hand to window.easy.openModel.
const openList = modelFiles.map((f) => ({ name: path.basename(f), url: `/model/${encodeURIComponent(path.basename(f))}` }));
// put the main model first so readScene picks it
openList.sort((a, b) => (a.name === path.basename(main) ? -1 : b.name === path.basename(main) ? 1 : 0));

const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const ctx = await browser.newContext({ acceptDownloads: true });

try {
  // ---- Page A: RayCity Easy — load the model, convert to a car folder --------------------------------
  const easy = await ctx.newPage();
  easy.on('console', (m) => { const t = m.text(); if (/error|ผิดพลาด|เปิดไม่ได้|Error/i.test(t)) console.log(`  easy> ${t}`); });
  easy.on('pageerror', (e) => console.log(`  easy!> ${e.message}`));
  await easy.goto(`${base}/RayCity-Easy.html`);
  await easy.waitForFunction(() => window.easy && window.easy.openModel, null, { timeout: 30000 });
  say(`loading model ${path.basename(main)} (+${openList.length - 1} files)…`);
  const loaded = await easy.evaluate(async ({ list, body, uv, poly, colour, fit, light, flip }) => {
    const $ = (id) => document.getElementById(id);
    window.RC_LAYOUT = uv;
    document.querySelector(`input[name=body][value="${body}"]`).checked = true;
    document.querySelector('input[name=body]:checked').dispatchEvent(new Event('change', { bubbles: true }));
    $('poly-sel').value = poly;
    $('colour-sel').value = colour;
    $('fit-wheels').checked = fit;
    $('keep-all').checked = !light;
    const files = await Promise.all(list.map(async (f) => new File([await (await fetch(f.url)).arrayBuffer()], f.name)));
    await window.easy.openModel(files);
    if (flip) { const b = document.getElementById('btn-flip'); if (b) b.click(); }
    const m = window.easy.state.model;
    return m ? { tris: m.C.length, wheels: m.wheels.length } : null;
  }, { list: openList, body: BODY, uv: UV, poly: POLY, colour: COLOUR, fit: FIT, light: LIGHT, flip: FLIP });
  if (!loaded) throw new Error('model did not load (see easy> errors above)');
  say(`model: ${loaded.tris.toLocaleString()} triangles, ${loaded.wheels} wheels found`);

  say(`building (body=${BODY}, uv=${UV}, poly=${POLY}, colour=${COLOUR}, fit=${FIT}, light=${LIGHT})…`);
  const built = await easy.evaluate(async (name) => {
    document.getElementById('car-name').value = name;
    await window.easy.build();
    const out = window.easy.state.out;
    if (!out) return null;
    const toB64 = (u8) => { let s = ''; const C = 0x8000; for (let i = 0; i < u8.length; i += C) s += String.fromCharCode.apply(null, u8.subarray(i, i + C)); return btoa(s); };
    return { name: window.easy.state.outName, files: [...out].map(([rel, data]) => ({ path: `${window.easy.state.outName}/${rel}`, b64: toB64(data) })) };
  }, NAME);
  if (!built) throw new Error('build produced nothing (see easy> errors above)');
  say(`converted: ${built.files.length} files`);

  if (NO_READY) {
    // Keep the raw convert output (gtv98-copied template UVs), no ⚡ toSheet repack. Write + zip here.
    const outZip = path.join(path.resolve(OUT_DIR), `${NAME}.zip`);
    const stage = path.join(path.resolve(OUT_DIR), '_stage');
    fs.rmSync(stage, { recursive: true, force: true });
    for (const f of built.files) { const p = path.join(stage, f.path); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.from(f.b64, 'base64')); }
    const { execSync } = await import('node:child_process');
    fs.rmSync(outZip, { force: true });
    execSync(`cd ${JSON.stringify(stage)} && zip -qr ${JSON.stringify(outZip)} ${JSON.stringify(NAME)}`);
    say(`saved ${outZip} (raw convert output, no ⚡)`);
    await browser.close(); srv.close();
    process.exit(0);
  }

  // ---- Page B: RayCity UV — ⚡ make it game-ready, capture the download ------------------------------
  const uv = await ctx.newPage();
  uv.on('console', (m) => { const t = m.text(); if (/error|ผิดพลาด|Error/i.test(t)) console.log(`  uv> ${t}`); });
  uv.on('pageerror', (e) => console.log(`  uv!> ${e.message}`));
  await uv.goto(`${base}/RayCity-UV.html`);
  await uv.waitForFunction(() => window.uvApp, null, { timeout: 30000 });
  await uv.evaluate(({ doors, nocap }) => {
    const ec = document.getElementById('esc-complete'); if (ec) ec.checked = doors;
    const nc = document.getElementById('no-cap'); if (nc) nc.checked = nocap;
  }, { doors: DOORS, nocap: NOCAP });

  const outZip = path.join(path.resolve(OUT_DIR), `${NAME}.zip`);
  const dl = uv.waitForEvent('download', { timeout: 300000 });
  say(`⚡ making it game-ready (doors=${DOORS}, no-cap=${NOCAP})… this can take a minute`);
  await uv.evaluate((payload) => {
    const files = payload.files.map((f) => ({ path: f.path, data: Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0)) }));
    window.postMessage({ type: 'rc-car', files, auto: true }, '*');
  }, built);
  const download = await dl;
  await download.saveAs(outZip);
  // the final status line (what ⚡ did)
  const status = await uv.evaluate(() => document.getElementById('status')?.textContent || '').catch(() => '');
  say(`saved ${outZip}`);
  if (status) say(status.replace(/\s+/g, ' ').trim());
} finally {
  await browser.close();
  srv.close();
}
