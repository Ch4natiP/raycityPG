import { SKINS, HAIR_COLORS } from './character.js';

// The rider's wardrobe. Every look is allowed except one rule of the job: the orange win vest
// (with your number) always goes on top, and a helmet is never optional.
// price 0 = free; a price is paid once, then the item is yours (save.closet).

const SHIRT_COLORS = ['#ffffff', '#1b1b1b', '#2e86de', '#e74c3c', '#f1c40f', '#27ae60', '#8e44ad', '#ff9ff3', '#222f3e', '#48dbfb', '#f5f0e6', '#576574', '#6d4c41', '#b71c1c'];
const PANT_COLORS = ['#22314a', '#1b1b1b', '#34495e', '#576574', '#8395a7', '#3c2a21', '#6d6552', '#a1887f', '#f5f0e6'];
const SHOE_COLORS = ['#f5f5f5', '#1b1b1b', '#c0392b', '#2e86de', '#8b5a2b', '#6b6b6b', '#f1c40f'];
const HELMET_COLORS = ['#ff7a00', '#f5f5f5', '#1b1b1b', '#c0392b', '#1f4fbf', '#27ae60', '#f1c40f', '#8e44ad', '#b0b6bc'];
const GLOVE_COLORS = ['#1b1b1b', '#6d4c41', '#c0392b', '#f5f5f5'];
// Win vests are orange by law; the shade and the number are yours.
const VEST_COLORS = ['#ff7a00', '#ff8f1f', '#f26a10', '#ffa31a'];

export const WARDROBE = [
  { key: 'female', name: 'รูปร่าง', options: [[false, 'ชาย', 0], [true, 'หญิง', 0]] },
  { key: 'skin', name: 'สีผิว', colors: SKINS },
  { key: 'hair', name: 'ทรงผม', options: [['short', 'สั้นรองทรง', 0], ['buzz', 'เกรียน', 0], ['none', 'โล้น', 0], ['spiky', 'ตั้งชี้ฟู', 200, 2], ['long', 'ยาวประบ่า', 200], ['bun', 'มัดจุก', 150]] },
  { key: 'hairColor', name: 'สีผม', colors: [...HAIR_COLORS, '#c9a25a', '#8a2a1a', '#2a3f8a'], prices: { '#c9a25a': 150, '#8a2a1a': 150, '#2a3f8a': 250 } },
  { key: 'beard', name: 'หนวดเครา', options: [[false, 'ไม่ไว้', 0], [true, 'ไว้เครา', 0]] },
  { key: 'shirt', name: 'เสื้อ (ใส่ใต้เสื้อวิน)', options: [['tee', 'ยืดคอกลม', 0], ['polo', 'โปโล', 250], ['long', 'แขนยาวกันแดด', 300], ['hoodie', 'ฮู้ดดี้', 450, 3], ['jacket', 'แจ็กเก็ตหนัง', 900, 5]] },
  { key: 'shirtColor', name: 'สีเสื้อ', colors: SHIRT_COLORS },
  { key: 'pants', name: 'กางเกง', options: [['jeans', 'ยีนส์', 0], ['slacks', 'สแล็ค', 300], ['cargo', 'คาร์โก้', 350, 2], ['shorts', 'ขาสั้น', 150]] },
  { key: 'pantsColor', name: 'สีกางเกง', colors: PANT_COLORS },
  { key: 'shoes', name: 'รองเท้า', options: [['sandals', 'แตะ', 0], ['sneakers', 'ผ้าใบ', 400], ['boots', 'บูทหนัง', 900, 4]] },
  { key: 'shoesColor', name: 'สีรองเท้า', colors: SHOE_COLORS },
  { key: 'helmet', name: 'หมวกกันน็อก', options: [['half', 'ครึ่งใบ', 0], ['retro', 'ทรงวินเทจ', 800, 2], ['full', 'เต็มใบ', 1500, 4]] },
  { key: 'helmetColor', name: 'สีหมวก', colors: HELMET_COLORS },
  { key: 'glasses', name: 'แว่นกันแดด', options: [[false, 'ไม่ใส่', 0], [true, 'เรย์แบน', 350]] },
  { key: 'mask', name: 'หน้ากากกันฝุ่น', options: [[false, 'ไม่ใส่', 0], [true, 'ใส่ (PM2.5)', 40]] },
  { key: 'gloves', name: 'ถุงมือ', options: [[null, 'ไม่ใส่', 0], ...GLOVE_COLORS.map((c, k) => [c, ['ดำ', 'หนังน้ำตาล', 'แดง', 'ขาว'][k], 250])] },
  { key: 'vestColor', name: 'เสื้อวิน (บังคับใส่)', colors: VEST_COLORS },
  { key: 'vestNumber', name: 'เบอร์เสื้อวิน', numbers: true },
];

export const DEFAULT_LOOK = {
  female: false, skin: SKINS[2], hair: 'short', hairColor: HAIR_COLORS[0], beard: false,
  shirt: 'tee', shirtColor: '#f1c40f', pants: 'jeans', pantsColor: '#22314a', shoes: 'sandals', shoesColor: '#1b1b1b',
  helmet: 'half', helmetColor: '#ff7a00', glasses: false, mask: false, gloves: null, vestColor: '#ff7a00', vestNumber: 99,
};

// what an option costs (0 when free) and the level it needs
export function itemPrice(cat, value) {
  if (cat.options) { const o = cat.options.find((x) => x[0] === value); return { price: o?.[2] || 0, level: o?.[3] || 1 }; }
  if (cat.prices) return { price: cat.prices[value] || 0, level: 1 };
  return { price: 0, level: 1 };
}
export const itemId = (key, value) => `${key}:${value}`;

export function migrateLook(save) {
  save.look = { ...DEFAULT_LOOK, ...(save.look || {}) };
  save.closet ??= [];
  return save;
}

// The look as a character outfit (character.js). The vest is always there.
export function outfitOf(look) {
  return {
    female: look.female, skin: look.skin, hair: look.hair, hairColor: look.hairColor, beard: look.beard,
    shirt: look.shirt, shirtColor: look.shirtColor, pants: look.pants, pantsColor: look.pantsColor,
    shoes: look.shoes, shoesColor: look.shoesColor, helmet: look.helmet || 'half', helmetColor: look.helmetColor,
    glasses: look.glasses, mask: look.mask, gloves: look.gloves,
    vest: { color: look.vestColor || '#ff7a00', number: look.vestNumber ?? 99 },
    height: look.female ? 0.97 : 1.0,
  };
}
