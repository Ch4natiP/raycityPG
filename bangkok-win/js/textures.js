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

// One floor of a shophouse: wall, a window with a grille and an A/C box. White, tinted per building.
export function windowTexture() {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#e6e6e6';
  g.fillRect(0, 118, 128, 10); // floor band
  g.fillStyle = '#3a4048';
  g.fillRect(22, 26, 84, 66);
  g.fillStyle = '#5d6a78';
  g.fillRect(26, 30, 36, 58);
  g.fillRect(66, 30, 36, 58);
  g.strokeStyle = '#c9c9c9';
  g.lineWidth = 2;
  for (let x = 26; x < 104; x += 8) { g.beginPath(); g.moveTo(x, 26); g.lineTo(x, 92); g.stroke(); }
  g.fillStyle = '#d9d9d9';
  g.fillRect(84, 96, 22, 14); // A/C unit
  g.fillStyle = '#9a9a9a';
  for (let y = 99; y < 108; y += 3) g.fillRect(86, y, 18, 1);
  return tex(c);
}

// Ground floor shop: open front with goods, or a rolling shutter.
export function shopTexture() {
  const [c, g] = canvas(256, 128);
  for (let k = 0; k < 2; k++) {
    const x0 = k * 128;
    if (k === 0) {
      g.fillStyle = '#2b2622';
      g.fillRect(x0, 0, 128, 128);
      const goods = ['#e2b23a', '#c0392b', '#2e86c1', '#27ae60', '#f5f5f5', '#8e44ad'];
      for (let r = 0; r < 4; r++) for (let s = 0; s < 8; s++) {
        g.fillStyle = goods[(r * 3 + s) % goods.length];
        g.fillRect(x0 + 8 + s * 14, 14 + r * 22, 10, 14);
      }
      g.fillStyle = '#6b4f35';
      g.fillRect(x0 + 6, 104, 116, 24);
    } else {
      g.fillStyle = '#9aa3a8';
      g.fillRect(x0, 0, 128, 128);
      g.fillStyle = '#7f888d';
      for (let y = 0; y < 128; y += 6) g.fillRect(x0, y, 128, 2);
      g.fillStyle = '#5b6366';
      g.fillRect(x0 + 60, 112, 8, 8);
    }
    g.fillStyle = '#555';
    g.fillRect(x0, 0, 4, 128);
  }
  return tex(c);
}

// Office / condo tower glass.
export function glassTexture() {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#c8d3dc';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#6f8aa3';
  g.fillRect(6, 8, 116, 104);
  g.fillStyle = '#8fa8bf';
  g.fillRect(6, 8, 56, 104);
  g.fillStyle = '#e8eef3';
  g.fillRect(62, 8, 4, 104);
  return tex(c);
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
