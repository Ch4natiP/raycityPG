// The app shows the Drive page as built by car-generator/build.mjs (one self-contained file) and, beside it, the
// game's real city (car-generator/city/, from tools/extract-field.mjs) that the page streams in.
import fs from 'node:fs';
const src = new URL('../car-generator/RayCity-Drive.html', import.meta.url);
const www = new URL('./www/', import.meta.url);
fs.mkdirSync(www, { recursive: true });
fs.copyFileSync(src, new URL('./index.html', www));
console.log(`www/index.html ${(fs.statSync(src).size / 1048576).toFixed(1)} MB`);
const city = new URL('../car-generator/city/', import.meta.url);
if (fs.existsSync(city)) {
  fs.rmSync(new URL('./city/', www), { recursive: true, force: true });
  fs.cpSync(city, new URL('./city/', www), { recursive: true });
  let n = 0; let size = 0; for (const r of fs.readdirSync(city)) for (const f of fs.readdirSync(new URL(`${r}/`, city))) { n++; size += fs.statSync(new URL(`${r}/${f}`, city)).size; }
  console.log(`www/city: ${n} files, ${(size / 1048576).toFixed(0)} MB`);
}
