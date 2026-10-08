// Renders the shop icons (icon/<car>_<part>_<variant>.png, 64×64) for a built car folder,
// one per variant name found in the template car's icon folder.
//
//   node tools/make-icons.mjs <car-folder> <template-car-folder> [chromium-path]
//
// Needs playwright-core and a Chromium. three.js is loaded from node_modules (no internet needed).
import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';

const [CAR, TPL, CHROME] = process.argv.slice(2);
if (!CAR || !TPL) {
  console.error('usage: node tools/make-icons.mjs <car-folder> <template-car-folder> [chromium-path]');
  process.exit(1);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = path.basename(path.resolve(CAR));
const tplName = path.basename(path.resolve(TPL));
const types = { '.html': 'text/html', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  const m = p.match(/^\/three@[^/]+\/(.*)$/);
  const file = m ? path.join(root, 'node_modules/three', m[1]) : path.join(root, p);
  if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch({
  executablePath: CHROME || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.route('https://cdn.jsdelivr.net/npm/three@*/**', (route) => {
  const rel = new URL(route.request().url()).pathname.replace(/^\/npm\/three@[^/]+\//, '');
  route.fulfill({ path: path.join(root, 'node_modules/three', rel), contentType: 'text/javascript' });
});
await page.goto(`http://localhost:${port}/tools/icons.html`);
await page.waitForFunction(() => window.ready);

const listVariants = (dir) => {
  const f = path.join(CAR, dir, 'list.xml');
  if (!fs.existsSync(f)) return [];
  const b = fs.readFileSync(f);
  const text = new TextDecoder(b[0] === 0xff ? 'utf-16le' : 'utf-8').decode(b);
  return [...text.matchAll(/<part\b[^>]*name='([^']*)'[^>]*mesh='([^']*)'/g)].map((m) => ({ name: m[1], mesh: m[2] }));
};

fs.mkdirSync(path.join(CAR, 'icon'), { recursive: true });
const wanted = fs.readdirSync(path.join(TPL, 'icon')).filter((f) => f.endsWith('.png'))
  .map((f) => f.slice(tplName.length + 1, -4)); // "<part>_<variant>"
let n = 0;
for (const key of wanted) {
  const dir = key.split('_')[0];
  const variant = key.slice(dir.length + 1);
  const v = listVariants(dir).find((x) => x.name === variant) || { mesh: 'default' };
  const file = path.join(CAR, dir, `${v.mesh}_2.0m`);
  if (!fs.existsSync(file)) { console.warn(`! no mesh for ${key}`); continue; }
  const url = await page.evaluate((bytes) => window.renderIcon(bytes), [...fs.readFileSync(file)]);
  fs.writeFileSync(path.join(CAR, 'icon', `${name}_${key}.png`), Buffer.from(url.split(',')[1], 'base64'));
  n++;
}
console.log(`${n} icons → ${path.join(CAR, 'icon')}`);
await browser.close();
server.close();
