// Bundles the generator (three.js included) into one self-contained HTML file
// that opens with a double-click, no web server or internet needed.
import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';


// Inside the one-page RayCity (each page in a tab): links to the other pages switch tabs instead.
const SHELL_HELPER = `<style>.in-shell .workspaces{display:none!important}</style><script>if (window.parent !== window) { document.documentElement.classList.add('in-shell'); document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a[href^="RayCity-"]'); if (a) { e.preventDefault(); window.parent.postMessage({ type: 'rc-tab', page: a.getAttribute('href') }, '*'); } }, true); }</script>`;
const withHelper = (h) => h.replace('</body>', () => `${SHELL_HELPER}\n</body>`);

const result = await build({
  entryPoints: ['js/main.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  write: false,
  legalComments: 'none',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync('style.css', 'utf8');
let html = fs.readFileSync('index.html', 'utf8');
html = html
  .replace(/\s*<script type="importmap">[\s\S]*?<\/script>/, '')
  .replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${css}</style>`)
  .replace('<script type="module" src="js/main.js"></script>', () => `<script>${embedCars()}\n${embedTests()}\n${embedTemplates()}\n${embedDraco()}</script>\n<script>${js}</script>`);
html = withHelper(html);
fs.writeFileSync('RayCity-Car-Generator.html', html);
fs.writeFileSync('js/embedded-cars.js', `${embedCars()}\n${embedTests()}\n${embedTemplates()}\n${embedDraco()}\n`); // same data for the dev page (index.html)
console.log(`RayCity-Car-Generator.html: ${(html.length / 1024).toFixed(0)} KB`);

// RayCity Studio (studio.html): same idea, its own page; only the template car and the decoder.
{
  const r = await build({ entryPoints: ['js/studio/studio.js'], bundle: true, minify: true, format: 'iife', write: false, legalComments: 'none' });
  const sjs = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const scss = fs.readFileSync('studio.css', 'utf8');
  let shtml = fs.readFileSync('studio.html', 'utf8')
    .replace(/\s*<script type="importmap">[\s\S]*?<\/script>/, '')
    .replace('<link rel="stylesheet" href="studio.css">', () => `<style>\n${scss}</style>`)
    .replace('<script src="js/embedded-cars.js"></script>', '')
    .replace('<script type="module" src="js/studio/studio.js"></script>', () => `<script>${embedTemplates()}\n${embedDraco()}</script>\n<script>${sjs}</script>`);
  shtml = withHelper(shtml);
fs.writeFileSync('RayCity-Studio.html', shtml);
  console.log(`RayCity-Studio.html: ${(shtml.length / 1024).toFixed(0)} KB`);
}

// RayCity UV (uv.html): the UV Editing workspace; the template car for gtv98's sheet.
{
  const r = await build({ entryPoints: ['js/uv/uv.js'], bundle: true, minify: true, format: 'iife', write: false, legalComments: 'none' });
  const ujs = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const ucss = fs.readFileSync('uv.css', 'utf8');
  let uhtml = fs.readFileSync('uv.html', 'utf8')
    .replace(/\s*<script type="importmap">[\s\S]*?<\/script>/, '')
    .replace('<link rel="stylesheet" href="uv.css">', () => `<style>\n${ucss}</style>`)
    .replace('<script src="js/embedded-cars.js"></script>', '')
    .replace('<script type="module" src="js/uv/uv.js"></script>', () => `<script>${embedTemplates()}\n${embedDraco()}</script>\n<script>${ujs}</script>`);
  uhtml = withHelper(uhtml);
fs.writeFileSync('RayCity-UV.html', uhtml);
  console.log(`RayCity-UV.html: ${(uhtml.length / 1024).toFixed(0)} KB`);
}

// RayCity Easy (easy.html): the whole job on one page; the template car and the decoder.
{
  const r = await build({ entryPoints: ['js/easy/easy.js'], bundle: true, minify: true, format: 'iife', write: false, legalComments: 'none' });
  const ejs = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const ecss = fs.readFileSync('easy.css', 'utf8');
  let ehtml = fs.readFileSync('easy.html', 'utf8')
    .replace(/\s*<script type="importmap">[\s\S]*?<\/script>/, '')
    .replace('<link rel="stylesheet" href="easy.css">', () => `<style>\n${ecss}</style>`)
    .replace('<script src="js/embedded-cars.js"></script>', '')
    .replace('<script type="module" src="js/easy/easy.js"></script>', () => `<script>${embedTemplates()}\n${embedDraco()}</script>\n<script>${ejs}</script>`);
  ehtml = withHelper(ehtml);
fs.writeFileSync('RayCity-Easy.html', ehtml);
  console.log(`RayCity-Easy.html: ${(ehtml.length / 1024).toFixed(0)} KB`);
}

// RayCity Drive (drive.html): the racing prototype; the template car (Escarabajo) to drive at once.
{
  const r = await build({ entryPoints: ['js/drive/drive.js'], bundle: true, minify: true, format: 'iife', write: false, legalComments: 'none' });
  const djs = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  let dhtml = fs.readFileSync('drive.html', 'utf8')
    .replace(/\s*<script type="importmap">[\s\S]*?<\/script>/, '')
    .replace('<script src="js/embedded-cars.js"></script>', '')
    .replace('<script type="module" src="js/drive/drive.js"></script>', () => `<script>${embedTemplates()}</script>\n<script>${djs}</script>`);
  dhtml = withHelper(dhtml);
  fs.writeFileSync('RayCity-Drive.html', dhtml);
  console.log(`RayCity-Drive.html: ${(dhtml.length / 1024).toFixed(0)} KB`);
}

// RayCity.html: every page in one file, one tab each (the pages as they are, opened in the tab on first use).
{
  const pages = [
    ['easy', '⚡ สร้างรถ', 'RayCity-Easy.html'],
    ['uv', '🖌 ลงสี / UV', 'RayCity-UV.html'],
    ['studio', '🛠 ปั้น / แก้รถ', 'RayCity-Studio.html'],
    ['gen', '📁 เปิด / ตรวจรถ · รถในเกม', 'RayCity-Car-Generator.html'],
    ['drive', '🏁 ขับลองบนเว็บ', 'RayCity-Drive.html'],
  ];
  const blobs = pages.map(([id, , file]) => `<script type="text/plain" id="page-${id}">${zlib.gzipSync(fs.readFileSync(file), { level: 9 }).toString('base64')}</script>`).join('\n');
  const shtml2 = `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>RayCity</title>
<style>
:root { --bg:#1d1d1d; --bar:#2b2b2b; --line:#3a3a3a; --text:#ececec; --muted:#a2a2a2; --accent:#4772b3; }
html,body { margin:0; height:100%; background:var(--bg); color:var(--text); font:14px/1.4 system-ui,"Noto Sans Thai","Segoe UI",sans-serif; }
body { display:grid; grid-template-rows:auto 1fr; }
header { display:flex; align-items:center; gap:6px; padding:6px 10px; background:var(--bar); border-bottom:1px solid var(--line); flex-wrap:wrap; }
header b { font-size:17px; margin-right:12px; } header b span { color:#ff9f1a; }
header button { background:#383838; color:var(--text); border:1px solid #4a4a4a; border-radius:8px; padding:7px 14px; font:inherit; cursor:pointer; }
header button.on { background:var(--accent); border-color:var(--accent); color:#fff; }
header .hint { color:var(--muted); font-size:12px; margin-left:auto; }
main { position:relative; min-height:0; }
iframe { position:absolute; inset:0; width:100%; height:100%; border:0; display:none; background:var(--bg); }
iframe.on { display:block; }
#loading { position:absolute; inset:0; display:none; align-items:center; justify-content:center; color:var(--muted); }
</style></head>
<body>
<header><b>RayCity <span>ครบในหน้าเดียว</span></b>
${pages.map(([id, label], i) => `<button data-tab="${id}"${i ? '' : ' class="on"'}>${label}</button>`).join('')}
<span class="hint">ขั้นตอน: ⚡ สร้างรถ → 🖌 ลงสี → ดาวน์โหลด .zip</span></header>
<main><div id="loading">กำลังเปิด…</div>${pages.map(([id]) => `<iframe id="f-${id}" title="${id}"></iframe>`).join('')}</main>
${blobs}
<script>
const frames = {}; const ready = {}; let pendingCar = null; let pendingAuto = false;
async function load(id) {
  if (frames[id]) return frames[id];
  document.getElementById('loading').style.display = 'flex';
  const b64 = document.getElementById('page-' + id).textContent.trim();
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const html = await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).blob();
  const f = document.getElementById('f-' + id);
  f.src = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  frames[id] = f;
  f.addEventListener('load', () => { document.getElementById('loading').style.display = 'none'; }, { once: true });
  return f;
}
async function show(id) {
  document.querySelectorAll('header button').forEach((b) => b.classList.toggle('on', b.dataset.tab === id));
  await load(id);
  document.querySelectorAll('iframe').forEach((f) => f.classList.toggle('on', f.id === 'f-' + id));
}
document.querySelectorAll('header button').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
const byFile = ${JSON.stringify(Object.fromEntries(pages.map(([id, , file]) => [file, id])))};
window.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type === 'rc-tab') { const id = byFile[d.page.split('#')[0]]; if (id) show(id); }
  if (d.type === 'rc-open-uv') { pendingCar = d.files; pendingAuto = !!d.auto; show('uv').then(() => { if (ready.uv) { frames.uv.contentWindow.postMessage({ type: 'rc-car', files: pendingCar, auto: pendingAuto }, '*'); pendingCar = null; } }); }
  if (d.type === 'rc-uv-ready' && frames.uv && e.source === frames.uv.contentWindow) { ready.uv = true; if (pendingCar) { frames.uv.contentWindow.postMessage({ type: 'rc-car', files: pendingCar, auto: pendingAuto }, '*'); pendingCar = null; } }
});
show('easy');
</script>
</body></html>`;
  fs.writeFileSync('RayCity.html', shtml2);
  console.log(`RayCity.html: ${(shtml2.length / 1024).toFixed(0)} KB`);
}

// Built cars in ../cars/<name>/ are embedded whole (every file, so the page can open them with one
// click and download the complete folder), as gzip + base64 of a JSON { path: base64 } map.
function embedCars() {
  const dir = path.resolve('../cars');
  const cars = {};
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      const root = path.join(dir, name);
      if (!fs.statSync(root).isDirectory() || !fs.existsSync(path.join(root, 'body_2.0m'))) continue; // cars only, not cars/test
      const files = {};
      const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const f = path.join(d, e.name);
          const rel = path.relative(root, f).split(path.sep).join('/');
          if (e.isDirectory()) { walk(f); continue; }
          files[`${name}/${rel}`] = fs.readFileSync(f).toString('base64');
        }
      };
      walk(root);
      cars[name] = zlib.gzipSync(JSON.stringify(files), { level: 9 }).toString('base64');
    }
  }
  return `window.RC_EMBEDDED_CARS = ${JSON.stringify(cars)};`;
}

// Template cars in templates/<name>/ (the file layout a converted 3D model is written in), like cars.
function embedTemplates() {
  const dir = path.resolve('templates');
  const out = {};
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      const root = path.join(dir, name);
      if (!fs.statSync(root).isDirectory()) continue;
      const files = {};
      const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const f = path.join(d, e.name);
          if (e.isDirectory()) walk(f);
          else files[path.relative(root, f).split(path.sep).join('/')] = fs.readFileSync(f).toString('base64');
        }
      };
      walk(root);
      out[name] = zlib.gzipSync(JSON.stringify(files), { level: 9 }).toString('base64');
    }
  }
  return `window.RC_TEMPLATES = ${JSON.stringify(out)};`;
}

// Draco decoder (compressed .glb models), so opening them needs no internet.
function embedDraco() {
  const d = 'node_modules/three/examples/jsm/libs/draco/gltf';
  if (!fs.existsSync(`${d}/draco_decoder.wasm`)) return 'window.RC_DRACO = null;';
  return `window.RC_DRACO = ${JSON.stringify({
    wrapper: fs.readFileSync(`${d}/draco_wasm_wrapper.js`).toString('base64'),
    wasm: fs.readFileSync(`${d}/draco_decoder.wasm`).toString('base64'),
  })};`;
}

// Test packs in ../cars/test/*.zip: downloadable from the page as they are (base64), in name order.
function embedTests() {
  const dir = path.resolve('../cars/test');
  const packs = [];
  if (fs.existsSync(dir)) {
    // The newest packs only (the page grew past 40 MB with all of them); the rest stay in cars/test.
    const zips = fs.readdirSync(dir).filter((x) => x.endsWith('.zip')).sort().reverse();
    const keep = [...zips.filter((x) => !/^\d/.test(x)), ...zips.filter((x) => /^\d/.test(x)).slice(0, 8)];
    for (const f of keep) {
      packs.push({ file: f, data: fs.readFileSync(path.join(dir, f)).toString('base64') });
    }
  }
  return `window.RC_TEST_PACKS = ${JSON.stringify(packs)};`;
}
