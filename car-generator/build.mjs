// Bundles the generator (three.js included) into one self-contained HTML file
// that opens with a double-click, no web server or internet needed.
import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

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
fs.writeFileSync('RayCity-Car-Generator.html', html);
fs.writeFileSync('js/embedded-cars.js', `${embedCars()}\n${embedTests()}\n${embedTemplates()}\n${embedDraco()}\n`); // same data for the dev page (index.html)
console.log(`RayCity-Car-Generator.html: ${(html.length / 1024).toFixed(0)} KB`);

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
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.zip')).sort().reverse()) {
      packs.push({ file: f, data: fs.readFileSync(path.join(dir, f)).toString('base64') });
    }
  }
  return `window.RC_TEST_PACKS = ${JSON.stringify(packs)};`;
}
