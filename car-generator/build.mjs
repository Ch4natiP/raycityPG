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
  .replace('<script type="module" src="js/main.js"></script>', () => `<script>${embedCars()}</script>\n<script>${js}</script>`);
fs.writeFileSync('RayCity-Car-Generator.html', html);
fs.writeFileSync('js/embedded-cars.js', `${embedCars()}\n`); // same data for the dev page (index.html)
console.log(`RayCity-Car-Generator.html: ${(html.length / 1024).toFixed(0)} KB`);

// Built cars in ../cars/<name>/ are embedded so they open with one click: LOD 2 meshes, list.xml,
// textures and spec, as gzip + base64 of a JSON { path: base64 } map.
function embedCars() {
  const dir = path.resolve('../cars');
  const cars = {};
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      const root = path.join(dir, name);
      if (!fs.statSync(root).isDirectory()) continue;
      const files = {};
      const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const f = path.join(d, e.name);
          const rel = path.relative(root, f).split(path.sep).join('/');
          if (e.isDirectory()) { if (e.name !== 'icon') walk(f); continue; }
          if (/_2\.0m$|list\.xml$|\.png$/i.test(rel) || rel === `${name}.xml`) files[`${name}/${rel}`] = fs.readFileSync(f).toString('base64');
        }
      };
      walk(root);
      cars[name] = zlib.gzipSync(JSON.stringify(files), { level: 9 }).toString('base64');
    }
  }
  return `window.RC_EMBEDDED_CARS = ${JSON.stringify(cars)};`;
}
