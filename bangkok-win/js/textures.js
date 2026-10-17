import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// Photo textures (tools/photos.py → assets/photos.js, embedded by the build). null when absent:
// then every surface uses the drawn texture below instead.
const PHOTOS = (typeof window !== 'undefined' && window.PHOTOS) || {};
export const hasPhoto = (name) => !!PHOTOS[name];
export function photo(name) {
  if (!PHOTOS[name]) return null;
  const t = new THREE.Texture();
  const img = new Image();
  img.onload = () => { t.image = img; t.needsUpdate = true; };
  img.src = PHOTOS[name];
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
// metres covered by one repeat of each surface texture (photos and drawings differ)
export const TILES = {
  wall: hasPhoto('facade') ? [12, 10.2] : [16, 13.6],
  glass: [12, 14],
  condo: hasPhoto('condo') ? [15, 18] : [12, 14],
  pave: hasPhoto('pave') ? 3 : 2.4,
  asphalt: hasPhoto('asphalt') ? 12 : 8,
};

// Pairs of textures: what a surface looks like by day (map) and what glows at night (emissive).
// Windows come in 4 x 4 blocks so neighbouring windows differ; buildings also get a random offset.
const LIT = ['#ffd59a', '#ffe2b8', '#fff1d6', '#ffcf86', '#e6eeff', '#cfe0ff', '#9fc3ff'];

// Shophouse upper floors: 4 bays x 4 floors, each bay 128 px = 4 m x 3.4 m.
export function windowTexture(rand = Math.random) {
  if (hasPhoto('facade')) return { map: photo('facade'), emissive: photo('facade_n') || blackTexture() };
  const [c, g] = canvas(512, 512);
  const [ec, eg] = canvas(512, 512);
  eg.fillStyle = '#000';
  eg.fillRect(0, 0, 512, 512);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 512, 512);
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
    const x = col * 128;
    const y = row * 128;
    // weathering streaks under each window
    g.fillStyle = 'rgba(80,70,60,0.08)';
    g.fillRect(x + 26, y + 92, 76, 30);
    g.fillStyle = '#e4e2dc';
    g.fillRect(x, y + 118, 128, 10); // floor band
    const kind = rand();
    // window frame + glass
    g.fillStyle = '#3d434b';
    g.fillRect(x + 20, y + 22, 88, 70);
    const curtain = ['#7a8794', '#a07a5a', '#c9b38e', '#6d7f73', '#8e6f8c', '#b8b0a2'][Math.floor(rand() * 6)];
    g.fillStyle = curtain;
    g.fillRect(x + 24, y + 26, 38, 62);
    g.fillRect(x + 66, y + 26, 38, 62);
    if (kind < 0.3) { g.fillStyle = 'rgba(30,35,40,0.7)'; g.fillRect(x + 24, y + 26, 80, 62); } // dark glass
    // security grille, the shophouse classic
    g.strokeStyle = kind < 0.55 ? '#d0d0d0' : '#7c7c7c';
    g.lineWidth = 2;
    for (let k = 24; k < 108; k += 8) { g.beginPath(); g.moveTo(x + k, y + 22); g.lineTo(x + k, y + 92); g.stroke(); }
    g.beginPath(); g.moveTo(x + 20, y + 57); g.lineTo(x + 108, y + 57); g.stroke();
    // A/C unit on some windows
    if (rand() < 0.55) {
      const ax = x + (rand() < 0.5 ? 6 : 84);
      g.fillStyle = '#dcdcdc';
      g.fillRect(ax, y + 95, 36, 20);
      g.fillStyle = '#9a9a9a';
      for (let k = 0; k < 5; k++) g.fillRect(ax + 3, y + 98 + k * 3.4, 30, 1.4);
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.fillRect(ax + 2, y + 115, 34, 6); // drip stain
    }
    // lights at night: about half the rooms are on
    if (rand() < 0.5) {
      const lc = LIT[Math.floor(rand() * LIT.length)];
      eg.fillStyle = lc;
      eg.fillRect(x + 24, y + 26, 80, 62);
      eg.fillStyle = 'rgba(0,0,0,0.55)'; // curtains block some of it
      eg.fillRect(x + 24, y + 26, 18 + rand() * 20, 62);
      eg.fillStyle = 'rgba(0,0,0,0.6)';
      for (let k = 24; k < 108; k += 8) eg.fillRect(x + k, y + 22, 2, 70);
    } else if (rand() < 0.15) { // a TV glow
      eg.fillStyle = '#3d5fa8';
      eg.fillRect(x + 30, y + 40, 50, 40);
    }
  }
  return { map: tex(c), emissive: tex(ec) };
}

// Condominium towers: balconies, A/C units, laundry.
export function condoTexture(rand = Math.random) {
  if (hasPhoto('condo')) return { map: photo('condo'), emissive: photo('condo_n') || blackTexture() };
  return glassTexture(rand);
}

function blackTexture() { const [c, g] = canvas(4, 4); g.fillRect(0, 0, 4, 4); return tex(c); }

// Ground floor shop: left half an open shop with goods, right half a rolling shutter.
export function shopTexture() {
  const [c, g] = canvas(256, 128);
  const [ec, eg] = canvas(256, 128);
  eg.fillStyle = '#000';
  eg.fillRect(0, 0, 256, 128);
  const goods = ['#e2b23a', '#c0392b', '#2e86c1', '#27ae60', '#f5f5f5', '#8e44ad', '#e67e22'];
  // open shop
  g.fillStyle = '#2b2622';
  g.fillRect(0, 0, 128, 128);
  for (let r = 0; r < 4; r++) for (let s = 0; s < 8; s++) {
    g.fillStyle = goods[(r * 3 + s) % goods.length];
    g.fillRect(8 + s * 14, 14 + r * 22, 10, 14);
  }
  g.fillStyle = '#6b4f35';
  g.fillRect(6, 104, 116, 24);
  // the same shop with its fluorescent tubes on
  eg.fillStyle = '#5a5246';
  eg.fillRect(0, 0, 128, 128);
  for (let r = 0; r < 4; r++) for (let s = 0; s < 8; s++) {
    eg.fillStyle = goods[(r * 3 + s) % goods.length];
    eg.fillRect(8 + s * 14, 14 + r * 22, 10, 14);
  }
  eg.fillStyle = '#ffffff';
  eg.fillRect(10, 4, 50, 4);
  eg.fillRect(68, 4, 50, 4);
  eg.fillStyle = '#8a6a48';
  eg.fillRect(6, 104, 116, 24);
  // shutter
  g.fillStyle = '#9aa3a8';
  g.fillRect(128, 0, 128, 128);
  g.fillStyle = '#7f888d';
  for (let y = 0; y < 128; y += 6) g.fillRect(128, y, 128, 2);
  g.fillStyle = 'rgba(60,50,40,0.25)';
  g.fillRect(128, 100, 128, 28); // grime at the bottom
  g.fillStyle = '#5b6366';
  g.fillRect(188, 112, 8, 8);
  g.fillStyle = '#555';
  g.fillRect(0, 0, 4, 128);
  g.fillRect(128, 0, 4, 128);
  const t = tex(c);
  if (hasPhoto('shutter')) { // the photographed roller shutter, drawn in once it has loaded
    const img = new Image();
    img.onload = () => { g.drawImage(img, 128, 0, 128, 128); g.fillStyle = '#555'; g.fillRect(128, 0, 4, 128); t.needsUpdate = true; };
    img.src = PHOTOS.shutter;
  }
  return { map: t, emissive: tex(ec) };
}

// Office / condo tower curtain wall: 4 x 4 cells of 3 m x 3.5 m.
export function glassTexture(rand = Math.random) {
  if (hasPhoto('glass')) return { map: photo('glass'), emissive: photo('glass_n') || blackTexture() };
  const [c, g] = canvas(512, 512);
  const [ec, eg] = canvas(512, 512);
  eg.fillStyle = '#000';
  eg.fillRect(0, 0, 512, 512);
  g.fillStyle = '#c8d3dc';
  g.fillRect(0, 0, 512, 512);
  for (let row = 0; row < 4; row++) {
    const officeFloor = rand() < 0.7;
    for (let col = 0; col < 4; col++) {
      const x = col * 128;
      const y = row * 128;
      const shade = 100 + Math.floor(rand() * 40);
      g.fillStyle = `rgb(${shade - 20},${shade + 10},${shade + 40})`;
      g.fillRect(x + 5, y + 8, 118, 104);
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(x + 5, y + 8, 56, 104);
      g.fillStyle = '#e8eef3';
      g.fillRect(x + 62, y + 8, 4, 104);
      if (officeFloor && rand() < 0.45) {
        const v = 0.55 + rand() * 0.45; // some offices brighter than others
        const warm = rand() < 0.3;
        eg.fillStyle = warm ? `rgb(${255 * v | 0},${215 * v | 0},${160 * v | 0})` : `rgb(${215 * v | 0},${228 * v | 0},${255 * v | 0})`;
        eg.fillRect(x + 5, y + 8, 118, 104);
        eg.fillStyle = 'rgba(0,0,0,0.5)'; // desks, blinds
        eg.fillRect(x + 5 + rand() * 60, y + 60, 30 + rand() * 40, 52);
        eg.fillStyle = 'rgba(0,0,0,0.35)';
        eg.fillRect(x + 62, y + 8, 4, 104);
        eg.fillRect(x + 5, y + 70, 118, 4);
      }
    }
  }
  return { map: tex(c), emissive: tex(ec) };
}

// Asphalt: grain, repair patches and oil stains. One tile = 8 m.
export function asphaltTexture(rand = Math.random) {
  if (hasPhoto('asphalt')) return photo('asphalt');
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#4a4c50';
  g.fillRect(0, 0, 512, 512);
  const img = g.getImageData(0, 0, 512, 512);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * 34;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  for (let k = 0; k < 3; k++) { // patched rectangles
    g.fillStyle = rand() < 0.5 ? 'rgba(30,30,32,0.16)' : 'rgba(110,110,110,0.09)';
    g.fillRect(rand() * 460, rand() * 460, 40 + rand() * 120, 30 + rand() * 90);
  }
  for (let k = 0; k < 4; k++) { // oil stains
    const x = rand() * 512; const y = rand() * 512; const r = 6 + rand() * 22;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(15,15,18,0.25)');
    gr.addColorStop(1, 'rgba(15,15,18,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.strokeStyle = 'rgba(20,20,22,0.5)';
  g.lineWidth = 1.5;
  for (let k = 0; k < 5; k++) { // cracks
    let x = rand() * 512; let y = rand() * 512;
    g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 8; s++) { x += (rand() - 0.5) * 40; y += (rand() - 0.5) * 40; g.lineTo(x, y); }
    g.stroke();
  }
  const t = tex(c);
  t.anisotropy = 8;
  return t;
}

// Sidewalk paving: 30 cm tiles, a few cracked or stained. One tile of texture = 2.4 m.
export function paveTexture(rand = Math.random) {
  if (hasPhoto('pave')) return photo('pave');
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#8f8a80';
  g.fillRect(0, 0, 256, 256);
  const cell = 32;
  for (let y = 0; y < 256; y += cell) for (let x = 0; x < 256; x += cell) {
    const v = 175 + Math.floor((rand() - 0.5) * 26);
    const red = rand() < 0.12;
    g.fillStyle = red ? `rgb(${v - 10},${v - 60},${v - 70})` : `rgb(${v},${v - 4},${v - 12})`;
    g.fillRect(x + 1, y + 1, cell - 2, cell - 2);
    if (rand() < 0.08) { g.fillStyle = 'rgba(40,35,30,0.25)'; g.fillRect(x + 1, y + 1, cell - 2, cell - 2); }
  }
  const t = tex(c);
  t.anisotropy = 8;
  return t;
}

// Soft round glow (car lights, street lamp heads) and the pool of light a lamp throws on the road.
export function glowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const [c, g] = canvas(64, 64);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, inner);
  gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  gr.addColorStop(1, outer);
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}

export function poolTexture() {
  const [c, g] = canvas(128, 128);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// Headlight beam on the road: bright near the car, fading forward.
export function beamTexture() {
  const [c, g] = canvas(64, 128);
  const gr = g.createLinearGradient(0, 128, 0, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(22, 128); g.lineTo(42, 128); g.lineTo(64, 0); g.lineTo(0, 0); g.closePath();
  g.fill();
  return new THREE.CanvasTexture(c);
}

export const SIGN_TEXTS = [
  'ข้าวมันไก่', 'ก๋วยเตี๋ยวเรือ', 'ร้านทอง', 'ร้านขายยา', 'ซ่อมรถมอเตอร์ไซค์', 'กาแฟสด',
  'โจ๊กหมู', 'ร้านตัดผม', 'มินิมาร์ท', 'ส้มตำ ไก่ย่าง', 'หมูกระทะ', 'นวดแผนไทย',
  'มือถือ ซิม', 'ข้าวแกง', 'ชาไทย ชานม', 'ผัดไทย', 'โรงรับจำนำ', 'เครื่องเขียน',
  'ร้านซักรีด', 'เบเกอรี่', 'ข้าวขาหมู', 'ร้านแว่นตา', 'คลินิก', 'อาหารตามสั่ง',
];
export const CHINA_SIGNS = ['ห้างทอง', 'ภัตตาคาร', 'หูฉลาม', 'ร้านยาจีน', 'ติ่มซำ', 'บะหมี่เกี๊ยว', 'รังนก', 'ข้าวหมูแดง'];

// Atlas of shop signs, one per row.
export function signAtlas() {
  const rows = SIGN_TEXTS.length + CHINA_SIGNS.length;
  const [c, g] = canvas(512, rows * 64);
  const bgs = ['#f7d046', '#e74c3c', '#2e86de', '#ffffff', '#27ae60', '#ff9f43', '#8e44ad', '#10ac84'];
  const all = [...SIGN_TEXTS, ...CHINA_SIGNS];
  all.forEach((t, r) => {
    const china = r >= SIGN_TEXTS.length;
    const bg = china ? '#b3121b' : bgs[r % bgs.length];
    g.fillStyle = bg;
    g.fillRect(0, r * 64, 512, 64);
    g.strokeStyle = china ? '#f1c40f' : 'rgba(0,0,0,.25)';
    g.lineWidth = 6;
    g.strokeRect(3, r * 64 + 3, 506, 58);
    g.fillStyle = china ? '#f6d365' : (bg === '#ffffff' || bg === '#f7d046') ? '#c0392b' : '#ffffff';
    g.font = 'bold 40px "Noto Sans Thai","Leelawadee UI","Tahoma",sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(t, 256, r * 64 + 34);
  });
  const t = tex(c, false);
  return { texture: t, rows, chinaStart: SIGN_TEXTS.length };
}

// A word on a board (station names, stand signs, labels over landmarks).
export function labelTexture(text, { bg = '#0b6e4f', fg = '#fff', w = 512, h = 128, font = 56, border = null } = {}) {
  const [c, g] = canvas(w, h);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  if (border) { g.strokeStyle = border; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8); }
  g.fillStyle = fg;
  g.font = `bold ${font}px "Noto Sans Thai","Leelawadee UI","Tahoma",sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = font;
  while (g.measureText(text).width > w - 30 && size > 12) { size -= 2; g.font = `bold ${size}px "Noto Sans Thai","Leelawadee UI","Tahoma",sans-serif`; }
  g.fillText(text, w / 2, h / 2 + 4);
  return tex(c, false);
}

// The orange win vest with a number on the back.
export function vestTexture(num) {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#ff7a00';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#ffd200';
  g.fillRect(0, 56, 128, 8);
  g.fillStyle = '#1b1b1b';
  g.font = 'bold 44px Tahoma,sans-serif';
  g.textAlign = 'center';
  g.fillText(String(num), 64, 46);
  return tex(c, false);
}

// Blue soi signs "ซอย 1".."ซอย 256" in one texture: 16 x 16 cells.
export function soiAtlas() {
  const [c, g] = canvas(2048, 768);
  for (let k = 0; k < 256; k++) {
    const x = (k % 16) * 128;
    const y = Math.floor(k / 16) * 48;
    g.fillStyle = '#1f4fbf';
    g.fillRect(x, y, 128, 48);
    g.strokeStyle = '#fff';
    g.lineWidth = 3;
    g.strokeRect(x + 3, y + 3, 122, 42);
    g.fillStyle = '#fff';
    g.font = 'bold 26px "Noto Sans Thai","Leelawadee UI","Tahoma",sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(`ซอย ${k + 1}`, x + 64, y + 26);
  }
  const t = tex(c, false);
  const uv = (n) => {
    const k = (n - 1) % 256;
    const col = k % 16;
    const row = Math.floor(k / 16);
    return [col / 16, 1 - (row + 1) / 16, (col + 1) / 16, 1 - row / 16];
  };
  return { texture: t, uv };
}
