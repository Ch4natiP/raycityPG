// The app shows the Drive page as built by car-generator/build.mjs (one self-contained file).
import fs from 'node:fs';
const src = new URL('../car-generator/RayCity-Drive.html', import.meta.url);
fs.mkdirSync(new URL('./www/', import.meta.url), { recursive: true });
fs.copyFileSync(src, new URL('./www/index.html', import.meta.url));
console.log(`www/index.html ${(fs.statSync(src).size / 1048576).toFixed(1)} MB`);
