// Bundles the generator (three.js included) into one self-contained HTML file
// that opens with a double-click, no web server or internet needed.
import { build } from 'esbuild';
import fs from 'fs';

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
  .replace('<script type="module" src="js/main.js"></script>', () => `<script>${js}</script>`);
fs.writeFileSync('RayCity-Car-Generator.html', html);
console.log(`RayCity-Car-Generator.html: ${(html.length / 1024).toFixed(0)} KB`);
