// Bundles the game (three.js included) into one HTML file that opens with a double-click.
import { build } from 'esbuild';
import fs from 'fs';

const r = await build({ entryPoints: ['js/main.js'], bundle: true, minify: true, format: 'iife', write: false, legalComments: 'none' });
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync('style.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8')
  .replace(/\s*<script type="importmap">[\s\S]*?<\/script>/, '')
  .replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${css}</style>`)
  .replace('<script type="module" src="js/main.js"></script>', () => `<script>${js}</script>`);
fs.writeFileSync('Bangkok-Win.html', html);
console.log(`Bangkok-Win.html: ${(html.length / 1024).toFixed(0)} KB`);
