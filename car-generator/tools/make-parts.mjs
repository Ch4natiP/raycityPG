// New shop parts for every car (car/1.common): a plate, a roof lamp and a wheel (with its wide one) for RayCity PG,
// made the way the server's own added parts are (rbrc_…): <type>/<tex>.png and <tex>_s.dds (DXT3, no mip levels),
// <type>/icon/common_<type>_<name>.png (64 × 64, the shop icon) and a line in <type>/list.xml with the next free id.
// The game paints a part's picture into that part's slot of the car's picture (wheel u 0–0.25, v 0.75–1, 256 px;
// lamp u 0–0.125, v 0.375–0.5, 128 px; the plate onto the plate), so a wheel or a lamp is one of the game's shapes
// (mesh) with a new picture, drawn over the picture it starts from: its gloss (alpha) stays as it was, but where
// old letters were painted out (flatAlpha, on the 256-px layout) it takes the area's commonest value, so they leave no shine.
//   node tools/make-parts.mjs <game folder> <out folder>
// out: car/1.common/<type>/… (the new files and the updated list.xml of each type), parts.txt (the new ids, for the
// server's item table) and preview.png. Drawing: headless Chromium (playwright-core; CHROME=<path> for its
// executable), Inter for the letters, three.js from node_modules for the icons.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { dds, ddsLike, png } from './img-lib.mjs';

export const PARTS = [
  { type: 'plate', name: 'pg_raycity', tex: 'common_plate_pg_raycity', paint: 'plate', size: [256, 128], like: 'common_plate_default' },
  { type: 'lamp', name: 'pg_roofsign', mesh: 'taxi_round', tex: 'common_lamp_pg_roofsign', paint: 'roofSign', base: 'taxi_round', slot: [0, 0.375, 0.125], view: [0.8, 0.5, 1.6] },
  { type: 'wheel', name: 'pg_te37_blue', mesh: 'rbrc_wolk_te37w', tex: 'common_wheel_pg_te37_blue', paint: 'te37', base: 'rbrc_te37w_white', slot: [0, 0.75, 0.25], view: [-1.7, 0.35, 0.55], wide: true, flatAlpha: [[112, 212, 250, 243]] },
];

// list.xml: UTF-16 (BOM kept), lines as the file has them; new <part> lines go before </partlist>, written like the last one
export function readList(b) {
  const bom = b[0] === 0xff && b[1] === 0xfe; const text = b.toString('utf16le', bom ? 2 : 0);
  const ids = [...text.matchAll(/<part\s+id\s*=\s*['"](\d+)['"]/g)].map((m) => +m[1]);
  return { bom, text, eol: text.includes('\r\n') ? '\r\n' : '\n', max: ids.length ? Math.max(...ids) : 0 };
}
export function addParts(list, parts) {
  const last = [...list.text.matchAll(/^([ \t]*)<part\s[^\n]*$/gm)].pop(); const indent = last ? last[1] : '\t'; const q = last && last[0].includes('"') ? '"' : "'";
  const lines = parts.map((p) => `${indent}<part id=${q}${p.id}${q} name=${q}${p.name}${q}${p.mesh ? ` mesh=${q}${p.mesh}${q}` : ''} tex=${q}${p.tex}${q}/>`);
  const at = list.text.lastIndexOf('</partlist>'); if (at < 0) throw new Error('list.xml without </partlist>');
  const before = list.text.slice(0, at).replace(/[ \t]*$/, ''); const sep = before.endsWith('\n') ? '' : list.eol;
  const text = before + sep + lines.join(list.eol) + list.eol + list.text.slice(at);
  return Buffer.concat([list.bom ? Buffer.from([0xff, 0xfe]) : Buffer.alloc(0), Buffer.from(text, 'utf16le')]);
}

async function page(root) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
  const server = http.createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }); res.end(fs.readFileSync(file));
  }).listen(0);
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const pg = await browser.newPage();
  await pg.route('https://cdn.jsdelivr.net/npm/three@*/**', (route) => {
    const rel = new URL(route.request().url()).pathname.replace(/^\/npm\/three@[^/]+\//, '');
    route.fulfill({ path: path.join(root, 'node_modules/three', rel), contentType: 'text/javascript' });
  });
  await pg.goto(`http://localhost:${server.address().port}/tools/parts.html`); await pg.waitForFunction(() => window.ready);
  return { pg, close: async () => { await browser.close(); server.close(); } };
}
const fromUrl = (u) => Buffer.from(u.split(',')[1], 'base64');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [game, out] = process.argv.slice(2);
  if (!game || !out) { console.error('usage: node tools/make-parts.mjs <game folder> <out folder>'); process.exit(1); }
  const common = path.join(game, 'car', '1.common'); const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { pg, close } = await page(root); const lists = {}; const report = []; const shots = [];
  try {
    for (const p of PARTS) {
      const dir = path.join(common, p.type); const od = path.join(out, 'car', '1.common', p.type); fs.mkdirSync(path.join(od, 'icon'), { recursive: true });
      // the picture: over the one it starts from (opaque while drawn, its alpha put back after) or on a blank
      const like = fs.readFileSync(path.join(dir, `${p.base || p.like}_s.dds`)); const src = dds(like); const w = src.w, h = src.h;
      const base = p.base ? Buffer.from(src.data) : null; if (base) for (let i = 3; i < base.length; i += 4) base[i] = 255;
      const rgba = Buffer.from(await pg.evaluate(([k, a, b, c]) => window.paint(k, a, b, c), [p.paint, w, h, base ? base.toString('base64') : null]), 'base64');
      for (let i = 3; i < rgba.length; i += 4) rgba[i] = p.base ? src.data[i] : 255;
      for (const [x0, y0, x1, y1] of p.flatAlpha || []) {
        const f = w / 256; const at = []; for (let y = Math.round(y0 * f); y < Math.round(y1 * f); y++) for (let x = Math.round(x0 * f); x < Math.round(x1 * f); x++) at.push((y * w + x) * 4 + 3);
        const n = new Map(); for (const q of at) n.set(rgba[q], (n.get(rgba[q]) || 0) + 1); const mode = [...n].sort((a, b) => b[1] - a[1])[0][0]; for (const q of at) rgba[q] = mode;
      }
      fs.writeFileSync(path.join(od, `${p.tex}.png`), png(w, h, 4, rgba)); fs.writeFileSync(path.join(od, `${p.tex}_s.dds`), ddsLike(like, w, h, rgba));
      // icons (and a bigger look for the preview)
      const shot = async (mesh, size) => (mesh ? pg.evaluate((o) => window.render(o), { mesh: [...fs.readFileSync(path.join(dir, `${mesh}_2.0m`))], tex: rgba.toString('base64'), w, h, slot: p.slot, view: p.view, size, glow: size <= 64 })
        : pg.evaluate((o) => window.flat(o), { tex: rgba.toString('base64'), w, h, size }));
      const variants = [{ name: p.name, mesh: p.mesh }]; if (p.wide) variants.push({ name: `${p.name}_wide`, mesh: `${p.mesh}_wide` });
      const list = lists[p.type] || (lists[p.type] = { ...readList(fs.readFileSync(path.join(dir, 'list.xml'))), add: [] });
      for (const v of variants) {
        fs.writeFileSync(path.join(od, 'icon', `common_${p.type}_${v.name}.png`), fromUrl(await shot(v.mesh, 64)));
        shots.push({ label: `${p.type} ${v.name}`, url: await shot(v.mesh, 256) });
        const id = list.max + list.add.length + 1; list.add.push({ id, name: v.name, mesh: v.mesh, tex: p.tex }); report.push(`${p.type}\t${id}\t${v.name}\t${p.tex}${v.mesh ? `\t(${v.mesh})` : ''}`);
      }
      shots.push({ label: `${p.tex}.png`, url: `data:image/png;base64,${png(w, h, 4, rgba).toString('base64')}` });
    }
    for (const [type, list] of Object.entries(lists)) fs.writeFileSync(path.join(out, 'car', '1.common', type, 'list.xml'), addParts(list, list.add));
    fs.writeFileSync(path.join(out, 'parts.txt'), `type\tid\tname\ttex\t(mesh)\n${report.join('\n')}\n`);
    const sheet = await pg.evaluate(async (items) => {
      const imgs = await Promise.all(items.map((it) => new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.src = it.url; })));
      const c = document.createElement('canvas'); c.width = 280 * items.length; c.height = 300; const g = c.getContext('2d'); g.fillStyle = '#5a5f6a'; g.fillRect(0, 0, c.width, c.height);
      imgs.forEach((im, i) => { const s = Math.min(256 / im.width, 256 / im.height); g.drawImage(im, 12 + i * 280, 12, im.width * s, im.height * s); g.fillStyle = '#fff'; g.font = '14px Inter, sans-serif'; g.fillText(items[i].label, 12 + i * 280, 290); });
      return c.toDataURL('image/png');
    }, shots);
    fs.writeFileSync(path.join(out, 'preview.png'), fromUrl(sheet));
    console.log(report.join('\n'));
  } finally { await close(); }
}
