// Parameter schema (drives the UI), defaults and presets.

export const SCHEMA = [
  { group: 'ตัวถัง · Body', items: [
    { key: 'length', label: 'ความยาว (m)', min: 3, max: 6, step: 0.01 },
    { key: 'width', label: 'ความกว้าง (m)', min: 1.4, max: 2.2, step: 0.01 },
    { key: 'clearance', label: 'ความสูงใต้ท้อง', min: 0.05, max: 0.4, step: 0.005 },
    { key: 'noseHeight', label: 'ความสูงหน้ารถ', min: 0.3, max: 1.2, step: 0.01 },
    { key: 'hoodHeight', label: 'ความสูงฝากระโปรงหน้า', min: 0.5, max: 1.3, step: 0.01 },
    { key: 'beltHeight', label: 'ความสูงขอบหน้าต่าง', min: 0.6, max: 1.3, step: 0.01 },
    { key: 'trunkHeight', label: 'ความสูงฝาท้าย', min: 0.6, max: 1.3, step: 0.01 },
    { key: 'tailHeight', label: 'ความสูงท้ายรถ', min: 0.4, max: 1.3, step: 0.01 },
    { key: 'crown', label: 'ความโค้งฝากระโปรง', min: 0, max: 0.1, step: 0.005 },
    { key: 'cornerRadius', label: 'ความมนมุมหน้า/ท้าย', min: 0.05, max: 1, step: 0.01 },
    { key: 'endTaper', label: 'ความสอบหน้า/ท้าย', min: 0, max: 0.5, step: 0.01 },
    { key: 'edgeRadius', label: 'ความมนขอบบน', min: 0.01, max: 0.2, step: 0.005 },
  ] },
  { group: 'ห้องโดยสาร · Cabin', items: [
    { key: 'roofHeight', label: 'ความสูงหลังคา', min: 0.9, max: 2.2, step: 0.01 },
    { key: 'windshieldBase', label: 'ตำแหน่งฐานกระจกหน้า', min: 0.1, max: 0.6, step: 0.005 },
    { key: 'roofFront', label: 'ต้นหลังคา', min: 0.2, max: 0.8, step: 0.005 },
    { key: 'roofRear', label: 'ท้ายหลังคา', min: 0.3, max: 0.94, step: 0.005 },
    { key: 'rearWindowBase', label: 'ฐานกระจกหลัง', min: 0.4, max: 0.965, step: 0.005 },
    { key: 'cabinTopWidth', label: 'ความกว้างหลังคา', min: 0.5, max: 0.95, step: 0.01 },
  ] },
  { group: 'ล้อ · Wheels', items: [
    { key: 'wheelRadius', label: 'รัศมีล้อ', min: 0.22, max: 0.55, step: 0.005 },
    { key: 'wheelWidth', label: 'ความกว้างยาง', min: 0.12, max: 0.4, step: 0.005 },
    { key: 'rimRatio', label: 'ขนาดแม็ก (สัดส่วน)', min: 0.45, max: 0.85, step: 0.01 },
    { key: 'frontOverhang', label: 'ระยะยื่นหน้า', min: 0.4, max: 1.5, step: 0.01 },
    { key: 'rearOverhang', label: 'ระยะยื่นท้าย', min: 0.4, max: 1.6, step: 0.01 },
    { key: 'wheelInset', label: 'ล้อหุบเข้า (- = ล้นซุ้ม)', min: -0.08, max: 0.15, step: 0.005 },
    { key: 'archScale', label: 'ขนาดซุ้มล้อ', min: 1.02, max: 1.4, step: 0.01 },
    { key: 'rimStyle', label: 'ลายแม็ก', type: 'select', options: [
      ['spoke', 'ก้าน'], ['split', 'ก้านคู่'], ['multi', 'ก้านถี่'], ['disc', 'จาน'],
    ] },
    { key: 'spokeCount', label: 'จำนวนก้าน', min: 3, max: 12, step: 1 },
  ] },
  { group: 'ไฟ & ชุดแต่ง · Parts', items: [
    { key: 'headlightStyle', label: 'ไฟหน้า', type: 'select', options: [
      ['rect', 'เหลี่ยม'], ['slim', 'เรียวยาว'], ['round', 'กลม'],
    ] },
    { key: 'taillightStyle', label: 'ไฟท้าย', type: 'select', options: [
      ['rect', 'เหลี่ยม'], ['bar', 'แถบยาว'], ['round', 'กลม'],
    ] },
    { key: 'grille', label: 'กระจังหน้า', type: 'select', options: [
      ['normal', 'ปกติ'], ['wide', 'กว้าง'], ['none', 'ไม่มี'],
    ] },
    { key: 'spoiler', label: 'สปอยเลอร์', type: 'select', options: [
      ['none', 'ไม่มี'], ['ducktail', 'หางเป็ด'], ['wing', 'วิง'], ['gt', 'GT Wing'],
    ] },
    { key: 'exhaust', label: 'ท่อไอเสีย', min: 0, max: 4, step: 1 },
    { key: 'stripeStyle', label: 'แถบคาด', type: 'select', options: [
      ['none', 'ไม่มี'], ['center', 'แถบเดี่ยว'], ['double', 'แถบคู่'],
    ] },
    { key: 'stripeWidth', label: 'ความกว้างแถบ', min: 0.1, max: 0.8, step: 0.01 },
    { key: 'splitter', label: 'ลิ้นหน้า', type: 'check' },
    { key: 'diffuser', label: 'ดิฟฟิวเซอร์', type: 'check' },
    { key: 'sideSkirts', label: 'สเกิร์ตข้าง', type: 'check' },
    { key: 'hoodScoop', label: 'สกู๊ปฝากระโปรง', type: 'check' },
    { key: 'roofRack', label: 'แร็คหลังคา', type: 'check' },
    { key: 'mirrors', label: 'กระจกข้าง', type: 'check' },
    { key: 'plates', label: 'ป้ายทะเบียน', type: 'check' },
    { key: 'bedCover', label: 'ฝาปิดกระบะ', type: 'check' },
    { key: 'underglow', label: 'ไฟใต้ท้อง (Neon)', type: 'check' },
  ] },
  { group: 'สี & วัสดุ · Paint', items: [
    { key: 'paintColor', label: 'สีตัวถัง', type: 'color' },
    { key: 'stripeColor', label: 'สีแถบคาด', type: 'color' },
    { key: 'rimColor', label: 'สีแม็ก', type: 'color' },
    { key: 'glassColor', label: 'สีกระจก', type: 'color' },
    { key: 'trimColor', label: 'สีพลาสติก/คิ้ว', type: 'color' },
    { key: 'caliperColor', label: 'สีคาลิปเปอร์', type: 'color' },
    { key: 'underglowColor', label: 'สีไฟใต้ท้อง', type: 'color' },
    { key: 'metalness', label: 'ความเมทัลลิก', min: 0, max: 1, step: 0.01 },
    { key: 'roughness', label: 'ความด้าน', min: 0, max: 1, step: 0.01 },
  ] },
  { group: 'ส่งออก · Export', items: [
    { key: 'name', label: 'ชื่อโมเดล', type: 'text' },
    { key: 'detail', label: 'ความละเอียด (Poly)', type: 'select', options: [
      ['low', 'ต่ำ (Low-poly)'], ['medium', 'กลาง'], ['high', 'สูง'],
    ] },
    { key: 'flatShading', label: 'Flat shading (สไตล์ low-poly)', type: 'check' },
  ] },
];

export const DEFAULTS = {
  name: 'RC_Sedan',
  length: 4.7, width: 1.82, clearance: 0.16,
  noseHeight: 0.62, hoodHeight: 0.86, beltHeight: 0.92, trunkHeight: 0.95, tailHeight: 0.88,
  crown: 0.03, cornerRadius: 0.45, endTaper: 0.2, edgeRadius: 0.08,
  roofHeight: 1.44, windshieldBase: 0.33, roofFront: 0.47, roofRear: 0.7, rearWindowBase: 0.84,
  cabinTopWidth: 0.76,
  wheelRadius: 0.33, wheelWidth: 0.22, rimRatio: 0.66, frontOverhang: 0.95, rearOverhang: 1.05,
  wheelInset: 0.03, archScale: 1.12, rimStyle: 'spoke', spokeCount: 5,
  headlightStyle: 'rect', taillightStyle: 'rect', grille: 'normal', spoiler: 'none', exhaust: 1,
  stripeStyle: 'none', stripeWidth: 0.3,
  splitter: false, diffuser: false, sideSkirts: false, hoodScoop: false, roofRack: false,
  mirrors: true, plates: true, bedCover: false, underglow: false,
  paintColor: '#c4172c', stripeColor: '#f2f2f2', rimColor: '#c9ccd1', glassColor: '#16202b',
  trimColor: '#151617', caliperColor: '#d4231d', underglowColor: '#29b6ff',
  metalness: 0.55, roughness: 0.32,
  detail: 'medium', flatShading: false,
};

export const PRESETS = {
  sedan: { label: 'ซีดาน', params: {} },
  sports: { label: 'สปอร์ต', params: {
    name: 'RC_Sports', length: 4.4, width: 1.88, clearance: 0.11,
    noseHeight: 0.48, hoodHeight: 0.72, beltHeight: 0.8, trunkHeight: 0.86, tailHeight: 0.84,
    roofHeight: 1.24, windshieldBase: 0.32, roofFront: 0.5, roofRear: 0.64, rearWindowBase: 0.88,
    cabinTopWidth: 0.7, wheelRadius: 0.34, wheelWidth: 0.26, rimRatio: 0.72, frontOverhang: 0.95,
    rearOverhang: 0.95, headlightStyle: 'slim', taillightStyle: 'bar', spoiler: 'wing', exhaust: 2,
    splitter: true, diffuser: true, paintColor: '#f2b705', rimColor: '#1d1f22', spokeCount: 10,
    rimStyle: 'split',
  } },
  hatchback: { label: 'แฮทช์แบ็ก', params: {
    name: 'RC_Hatch', length: 4.0, width: 1.75, clearance: 0.15,
    noseHeight: 0.6, hoodHeight: 0.84, beltHeight: 0.92, trunkHeight: 0.98, tailHeight: 0.95,
    roofHeight: 1.47, windshieldBase: 0.3, roofFront: 0.45, roofRear: 0.82, rearWindowBase: 0.95,
    cabinTopWidth: 0.78, wheelRadius: 0.31, frontOverhang: 0.8, rearOverhang: 0.65,
    paintColor: '#2a6fdb', taillightStyle: 'rect', rimStyle: 'multi', spokeCount: 6,
  } },
  suv: { label: 'SUV', params: {
    name: 'RC_SUV', length: 4.75, width: 1.92, clearance: 0.25,
    noseHeight: 0.85, hoodHeight: 1.08, beltHeight: 1.12, trunkHeight: 1.16, tailHeight: 1.12,
    roofHeight: 1.78, windshieldBase: 0.28, roofFront: 0.4, roofRear: 0.88, rearWindowBase: 0.96,
    cabinTopWidth: 0.82, wheelRadius: 0.38, wheelWidth: 0.26, frontOverhang: 0.9, rearOverhang: 0.95,
    grille: 'wide', roofRack: true, paintColor: '#3b4a3f', rimColor: '#8a8f96', exhaust: 2,
    cornerRadius: 0.3, edgeRadius: 0.1, rimStyle: 'spoke', spokeCount: 6,
  } },
  pickup: { label: 'กระบะ', params: {
    name: 'RC_Pickup', length: 5.3, width: 1.95, clearance: 0.27,
    noseHeight: 0.92, hoodHeight: 1.12, beltHeight: 1.15, trunkHeight: 1.15, tailHeight: 1.12,
    roofHeight: 1.85, windshieldBase: 0.27, roofFront: 0.37, roofRear: 0.52, rearWindowBase: 0.57,
    cabinTopWidth: 0.82, wheelRadius: 0.4, wheelWidth: 0.28, frontOverhang: 0.95, rearOverhang: 1.2,
    grille: 'wide', bedCover: true, paintColor: '#e8e8e8', rimColor: '#2b2d30', cornerRadius: 0.25,
    endTaper: 0.12, rimStyle: 'spoke', spokeCount: 6,
  } },
  muscle: { label: 'มัสเซิล', params: {
    name: 'RC_Muscle', length: 4.8, width: 1.9, clearance: 0.13,
    noseHeight: 0.66, hoodHeight: 0.88, beltHeight: 0.9, trunkHeight: 0.92, tailHeight: 0.9,
    roofHeight: 1.32, windshieldBase: 0.4, roofFront: 0.54, roofRear: 0.68, rearWindowBase: 0.82,
    cabinTopWidth: 0.72, wheelRadius: 0.35, wheelWidth: 0.27, hoodScoop: true, stripeStyle: 'double',
    stripeWidth: 0.4, spoiler: 'ducktail', exhaust: 2, headlightStyle: 'round', taillightStyle: 'bar',
    paintColor: '#0f3d8c', rimColor: '#d9d9d9', cornerRadius: 0.2, endTaper: 0.08, rimStyle: 'multi',
    spokeCount: 5,
  } },
  kei: { label: 'รถเล็ก', params: {
    name: 'RC_Kei', length: 3.4, width: 1.48, clearance: 0.15,
    noseHeight: 0.65, hoodHeight: 0.82, beltHeight: 0.9, trunkHeight: 0.95, tailHeight: 0.95,
    roofHeight: 1.62, windshieldBase: 0.22, roofFront: 0.32, roofRear: 0.92, rearWindowBase: 0.965,
    cabinTopWidth: 0.84, wheelRadius: 0.28, wheelWidth: 0.17, frontOverhang: 0.55, rearOverhang: 0.45,
    headlightStyle: 'round', paintColor: '#9fd8c7', rimColor: '#f0f0f0', rimStyle: 'disc', exhaust: 1,
    cornerRadius: 0.3, edgeRadius: 0.1,
  } },
  supercar: { label: 'ซูเปอร์คาร์', params: {
    name: 'RC_Super', length: 4.6, width: 1.98, clearance: 0.09,
    noseHeight: 0.42, hoodHeight: 0.62, beltHeight: 0.78, trunkHeight: 0.92, tailHeight: 0.95,
    roofHeight: 1.14, windshieldBase: 0.26, roofFront: 0.46, roofRear: 0.58, rearWindowBase: 0.86,
    cabinTopWidth: 0.62, wheelRadius: 0.35, wheelWidth: 0.3, rimRatio: 0.76, frontOverhang: 1.0,
    rearOverhang: 1.1, headlightStyle: 'slim', taillightStyle: 'bar', spoiler: 'gt', sideSkirts: true,
    splitter: true, diffuser: true, exhaust: 4, paintColor: '#7cd321', rimColor: '#202224',
    caliperColor: '#ffd400', rimStyle: 'split', spokeCount: 7, metalness: 0.7, roughness: 0.25,
    underglow: true, underglowColor: '#7cff3a',
  } },
};

export function presetParams(key) {
  return { ...DEFAULTS, ...(PRESETS[key]?.params || {}) };
}

// Deterministic RNG so a seed always reproduces the same car.
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PAINTS = ['#c4172c', '#f2b705', '#2a6fdb', '#0f3d8c', '#7cd321', '#e8e8e8', '#151617', '#ff6a00',
  '#8e44ad', '#16a085', '#b0b6bd', '#ff2e88', '#00b3c7', '#5a2e0e'];
const RIMS = ['#c9ccd1', '#1d1f22', '#d4af37', '#8a8f96', '#f0f0f0', '#b0302a'];
const GLOWS = ['#29b6ff', '#ff2e88', '#7cff3a', '#ffd400', '#b44cff'];

export function randomParams(seed) {
  const rnd = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const keys = Object.keys(PRESETS);
  const base = presetParams(pick(keys));
  const p = { ...base };
  for (const group of SCHEMA) {
    for (const it of group.items) {
      if (it.type || it.key === 'exhaust' || it.key === 'spokeCount') continue;
      const span = (it.max - it.min) * 0.08;
      p[it.key] = Math.min(it.max, Math.max(it.min, p[it.key] + (rnd() * 2 - 1) * span));
    }
  }
  p.spokeCount = 3 + Math.floor(rnd() * 8);
  p.exhaust = Math.floor(rnd() * 5);
  p.rimStyle = pick(['spoke', 'split', 'multi', 'disc', 'spoke', 'split']);
  p.headlightStyle = pick(['rect', 'slim', 'round']);
  p.taillightStyle = pick(['rect', 'bar', 'round']);
  p.spoiler = pick(['none', 'none', 'ducktail', 'wing', 'gt']);
  p.stripeStyle = pick(['none', 'none', 'center', 'double']);
  for (const k of ['splitter', 'diffuser', 'sideSkirts']) p[k] = rnd() < 0.4;
  p.hoodScoop = rnd() < 0.2;
  p.underglow = rnd() < 0.25;
  p.paintColor = pick(PAINTS);
  p.stripeColor = pick(['#f2f2f2', '#151617', '#f2b705', '#c4172c']);
  p.rimColor = pick(RIMS);
  p.underglowColor = pick(GLOWS);
  p.caliperColor = pick(['#d4231d', '#ffd400', '#2a6fdb', '#3a3d42']);
  p.metalness = 0.2 + rnd() * 0.7;
  p.roughness = 0.15 + rnd() * 0.4;
  p.name = `RC_Car_${seed}`;
  return p;
}
