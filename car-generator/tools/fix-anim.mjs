// Re-lays out every .0m of a built car folder like the template car's submesh tables, so the moving
// pieces the game animates (doors, hood, ...) exist with the template's indices and flags.
// Cars built before this was part of build-car.mjs crash when the garage opens the doors.
//
//   node tools/fix-anim.mjs <car-folder> <template-car-folder>
import fs from 'fs';
import path from 'path';
import { parseOM, writeOM, omParts, matchTemplateSubmeshes } from '../js/om.js';

const [CAR, TPL] = process.argv.slice(2);
if (!CAR || !TPL) {
  console.error('usage: node tools/fix-anim.mjs <car-folder> <template-car-folder>');
  process.exit(1);
}
const readOM = (f) => { const b = fs.readFileSync(f); return parseOM(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); };
const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

let n = 0;
for (const file of walk(CAR).filter((f) => f.endsWith('.0m'))) {
  const rel = path.relative(CAR, file);
  const m = /^(.*?)([^/\\]+)_(\d)\.0m$/.exec(rel);
  if (!m) continue;
  const [, dir, mesh, lod] = m;
  const tplFile = [mesh, 'default'].map((x) => path.join(TPL, dir, `${x}_${lod}.0m`)).find((f) => fs.existsSync(f))
    || fs.readdirSync(path.join(TPL, dir)).filter((f) => f.endsWith(`_${lod}.0m`)).map((f) => path.join(TPL, dir, f))[0];
  if (!tplFile) { console.warn(`! no template for ${rel}`); continue; }
  const tpl = readOM(tplFile);
  const parts = matchTemplateSubmeshes(tpl, omParts(readOM(file)));
  fs.writeFileSync(file, writeOM(tpl, parts));
  n++;
}
console.log(`${n} files laid out like ${TPL}`);
