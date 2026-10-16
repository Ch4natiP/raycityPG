// Bundles the game (three.js included) into one HTML file that opens with a double-click.
import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';

// nodePaths: the shared car builder in ../car-generator imports three from here, too
const r = await build({ entryPoints: ['js/main.js'], bundle: true, nodePaths: [path.resolve('node_modules')], minify: true, format: 'iife', write: false, legalComments: 'none' });
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync('style.css', 'utf8');
// Real-street maps made by tools/osm-import.mjs ride along inside the page.
const maps = fs.existsSync('data') ? fs.readdirSync('data').filter((f) => /^city-.*\.json$/.test(f)) : [];
const mapScript = maps.length ? `<script>window.CITY_DATA=${fs.readFileSync(`data/${maps[0]}`, 'utf8')};</script>\n` : '';
if (maps.length) console.log(`map: data/${maps[0]}`);
const html = fs.readFileSync('index.html', 'utf8')
  .replace(/\s*<script type="importmap">[\s\S]*?<\/script>/, '')
  .replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${css}</style>`)
  .replace('<script type="module" src="js/main.js"></script>', () => `${mapScript}<script>${js}</script>`);
fs.writeFileSync('Bangkok-Win.html', html);
console.log(`Bangkok-Win.html: ${(html.length / 1024).toFixed(0)} KB`);
