import { BIKES } from './config.js';

// The bike as a set of real parts. Every part wears with distance (some with braking or crashes),
// worn parts make the bike slower / slide more / stop worse, and the shop at a win stand can repair
// each part or swap it for an upgrade. All the numbers are here.

// Condition parts: wear = % lost per km of riding. price = baht for a new one on the 110cc (bigger bikes cost more).
export const PARTS = [
  { id: 'oil', name: 'น้ำมันเครื่อง', icon: '🛢️', wear: 2.6, price: 180, group: 'เครื่องยนต์', tip: 'หมดแล้วเครื่องสึกเร็ว 4 เท่า' },
  { id: 'engine', name: 'เครื่องยนต์ (ลูกสูบ/แหวน)', icon: '⚙️', wear: 0.22, price: 2200, group: 'เครื่องยนต์', tip: 'แรงม้าและความเร็วสูงสุด' },
  { id: 'spark', name: 'หัวเทียน', icon: '⚡', wear: 0.6, price: 90, group: 'เครื่องยนต์', tip: 'สึกแล้วเร่งไม่ขึ้น' },
  { id: 'filter', name: 'ไส้กรองอากาศ', icon: '🌬️', wear: 0.8, price: 150, group: 'เครื่องยนต์', tip: 'ฝุ่น กทม. เยอะ ตันเร็ว' },
  { id: 'battery', name: 'แบตเตอรี่', icon: '🔋', wear: 0.25, price: 550, group: 'ไฟฟ้า', tip: 'อ่อนแล้วไฟหน้าหรี่' },
  { id: 'light', name: 'ไฟหน้า', icon: '💡', wear: 0.08, price: 300, group: 'ไฟฟ้า', crash: 0.6, tip: 'แตกแล้วกลางคืนมองไม่เห็น' },
  { id: 'chain', name: 'โซ่-สเตอร์', icon: '⛓️', wear: 0.9, price: 450, group: 'ส่งกำลัง', tip: 'ยืดแล้วกินแรงและหย่อน' },
  { id: 'clutch', name: 'ผ้าคลัตช์/ชุดสายพาน', icon: '🌀', wear: 0.35, price: 650, group: 'ส่งกำลัง', tip: 'ลื่นแล้วออกตัวอืด' },
  { id: 'tireF', name: 'ยางหน้า', icon: '🛞', wear: 1.1, price: 650, group: 'ช่วงล่าง', crash: 0.3, tip: 'ดอกหมดแล้วลื่น โดยเฉพาะตอนฝนตก' },
  { id: 'tireR', name: 'ยางหลัง', icon: '🛞', wear: 1.4, price: 750, group: 'ช่วงล่าง', tip: 'ดอกหมดแล้วลื่น' },
  { id: 'brakeF', name: 'ผ้าเบรกหน้า', icon: '🛑', wear: 0.7, brakeWear: 1.6, price: 250, group: 'ช่วงล่าง', tip: 'เบรกหนักสึกเร็ว' },
  { id: 'brakeR', name: 'ผ้าเบรกหลัง', icon: '🛑', wear: 0.5, brakeWear: 1.0, price: 200, group: 'ช่วงล่าง', tip: 'ช่วยเบรก' },
  { id: 'shock', name: 'โช้คอัพ', icon: '🔩', wear: 0.4, price: 900, group: 'ช่วงล่าง', crash: 0.4, tip: 'เสื่อมแล้วรถเหวี่ยง' },
  { id: 'fork', name: 'โช้คหน้า/แผงคอ', icon: '🍴', wear: 0.15, price: 1100, group: 'ช่วงล่าง', crash: 0.7, tip: 'คดแล้วเลี้ยวไม่ตรง' },
  { id: 'body', name: 'ชุดสี/แฟริ่ง', icon: '🎨', wear: 0.05, price: 800, group: 'ตัวถัง', crash: 1.0, tip: 'รอยถลอกจากการชน' },
  { id: 'mirror', name: 'กระจกมองข้าง', icon: '🪞', wear: 0, price: 120, group: 'ตัวถัง', crash: 0.8, tip: 'ไม่มีกระจก ผู้โดยสารไม่สบายใจ' },
];

// Upgrades: one option per slot is fitted at a time. mul = multipliers on the bike's numbers.
// level = the rider level a shop starts selling it.
export const MODS = [
  { slot: 'exhaust', name: 'ท่อไอเสีย', icon: '💨', options: [
    { name: 'ท่อเดิมติดรถ', price: 0, level: 1, mul: {} },
    { name: 'ท่อสตรีท ปลายเลส', price: 1200, level: 2, mul: { accel: 1.04 }, loud: 1 },
    { name: 'ท่อสูตร คอไล่', price: 3500, level: 5, mul: { accel: 1.08, top: 1.02 }, loud: 2 },
    { name: 'ท่อไทเทเนียมแข่ง', price: 8000, level: 9, mul: { accel: 1.12, top: 1.04 }, loud: 3 },
  ] },
  { slot: 'ecu', name: 'กล่องไฟ ECU', icon: '🧠', options: [
    { name: 'กล่องเดิม', price: 0, level: 1, mul: {} },
    { name: 'กล่องปลดรอบ', price: 1500, level: 3, mul: { top: 1.03 } },
    { name: 'กล่องแต่ง จูนหัวฉีด', price: 4200, level: 6, mul: { top: 1.06, accel: 1.03 } },
    { name: 'กล่องแข่ง ปรับจูนได้', price: 9500, level: 10, mul: { top: 1.1, accel: 1.05 } },
  ] },
  { slot: 'intake', name: 'กรองอากาศ / ลิ้นเร่ง', icon: '🌪️', options: [
    { name: 'หม้อกรองเดิม', price: 0, level: 1, mul: {} },
    { name: 'กรองผ้าเปลือย', price: 650, level: 2, mul: { accel: 1.03 }, filterWear: 1.5 },
    { name: 'ลิ้นเร่งใหญ่ + กรองแต่ง', price: 2800, level: 6, mul: { accel: 1.07 }, filterWear: 1.3 },
  ] },
  { slot: 'sprocket', name: 'สเตอร์ (อัตราทด)', icon: '⚙️', options: [
    { name: 'มาตรฐาน', price: 0, level: 1, mul: {} },
    { name: 'ทดจัด (เน้นออกตัว)', price: 500, level: 2, mul: { accel: 1.1, top: 0.94 } },
    { name: 'ทดยาว (เน้นปลาย)', price: 500, level: 2, mul: { top: 1.07, accel: 0.92 } },
  ] },
  { slot: 'tires', name: 'ยาง', icon: '🛞', options: [
    { name: 'ยางเดิม', price: 0, level: 1, mul: {} },
    { name: 'ยางสตรีท', price: 1400, level: 2, mul: { grip: 1.06 } },
    { name: 'ยางสปอร์ตหน้ากว้าง', price: 3200, level: 5, mul: { grip: 1.12 } },
    { name: 'ยางซอฟต์คอมปาวด์', price: 6000, level: 9, mul: { grip: 1.18 }, tireWear: 1.7 },
  ] },
  { slot: 'brakes', name: 'ชุดเบรก', icon: '🛑', options: [
    { name: 'เบรกเดิม', price: 0, level: 1, mul: {} },
    { name: 'ผ้าเบรกเกรดดี', price: 800, level: 2, mul: { brake: 1.1 } },
    { name: 'จานใหญ่ + ปั๊มเรเดียล', price: 3800, level: 5, mul: { brake: 1.2 } },
    { name: 'ชุดเบรกแข่ง 4 พอต', price: 8500, level: 9, mul: { brake: 1.3 } },
  ] },
  { slot: 'suspension', name: 'โช้ค / ช่วงล่าง', icon: '🔩', options: [
    { name: 'โช้คเดิม', price: 0, level: 1, mul: {} },
    { name: 'โช้คปรับความหนืด', price: 2200, level: 3, mul: { grip: 1.04 } },
    { name: 'โช้คแก๊สแท้ง', price: 5500, level: 7, mul: { grip: 1.08 } },
  ] },
  { slot: 'wheels', name: 'ล้อ', icon: '⭕', options: [
    { name: 'ล้อซี่ลวดเดิม', price: 0, level: 1, mul: {} },
    { name: 'ล้อแม็กอัลลอย', price: 2500, level: 3, mul: { accel: 1.03 } },
    { name: 'ล้อแม็กฟอร์จน้ำหนักเบา', price: 7000, level: 8, mul: { accel: 1.06, grip: 1.02 } },
  ] },
  { slot: 'weight', name: 'ลดน้ำหนัก', icon: '🪶', options: [
    { name: 'เดิม', price: 0, level: 1, mul: {} },
    { name: 'เบาะแต่ง + ถอดของไม่จำเป็น', price: 900, level: 2, mul: { accel: 1.03 } },
    { name: 'ชุดคาร์บอนไฟเบอร์', price: 6500, level: 8, mul: { accel: 1.06, top: 1.02 } },
  ] },
];

export const PAINTS = [0xc81e1e, 0x1f4fbf, 0x16a34a, 0x111111, 0xf5f5f5, 0xff7a00, 0xf1c40f, 0x8e44ad, 0xff4fa3, 0x00a8a8, 0x6d6d6d, 0x7a4b2a];
export const RIMS = [0x9aa0a6, 0x111111, 0xd4a017, 0xc81e1e, 0x1f4fbf, 0xf5f5f5];
export const NEONS = [null, 0x2e86ff, 0xff2fa8, 0x2bff88, 0xff8a00, 0xb04bff];
export const COSMETIC_PRICE = { paint: 300, rim: 250, neon: 900 };

const classMul = (bike) => ({ wave: 1, scoot: 1.3, sport: 2, big: 3.4 }[bike.id] || 1);
export const partPrice = (bike, part, cond) => Math.max(10, Math.round((part.price * classMul(bike) * (1 - cond)) / 10) * 10);
export const modPrice = (bike, opt) => Math.round((opt.price * classMul(bike)) / 50) * 50;

// Per-bike state in the save: condition of every part (0..1), fitted mods, paint.
export function bikeState(save, id) {
  save.garage ??= {};
  const b = BIKES.find((x) => x.id === id) || BIKES[0];
  const st = save.garage[id] ??= {};
  st.parts ??= {};
  for (const p of PARTS) st.parts[p.id] ??= 1;
  st.mods ??= {};
  st.owned ??= {}; // slot → array of option indices bought
  for (const m of MODS) { st.mods[m.slot] ??= 0; st.owned[m.slot] ??= [0]; }
  st.paint ??= b.color;
  st.rim ??= RIMS[0];
  st.neon ??= null;
  return st;
}

const avg = (...v) => v.reduce((a, b) => a + b, 0) / v.length;

// What the parts and mods do to the bike. rain 0..1 makes tyres matter more.
export function effective(save, id, rain = 0) {
  const base = BIKES.find((x) => x.id === id) || BIKES[0];
  const st = bikeState(save, id);
  const c = st.parts;
  const mul = { top: 1, accel: 1, grip: 1, brake: 1 };
  for (const m of MODS) {
    const o = m.options[st.mods[m.slot]] || m.options[0];
    for (const [k, v] of Object.entries(o.mul)) mul[k] *= v;
  }
  // worn parts (a part only starts to hurt once it is below ~70 %)
  const hurt = (x) => Math.min(1, x / 0.7);
  const engine = avg(hurt(c.engine), hurt(c.spark), hurt(c.filter));
  const drive = avg(hurt(c.chain), hurt(c.clutch));
  const tyres = avg(hurt(c.tireF), hurt(c.tireR));
  const brakes = hurt(c.brakeF) * 0.65 + hurt(c.brakeR) * 0.35;
  const broken = c.engine < 0.05 || c.oil <= 0;
  const out = {
    ...base,
    top: base.top * mul.top * (0.82 + 0.18 * Math.min(engine, drive)) * (broken ? 0.4 : 1),
    accel: base.accel * mul.accel * (0.65 + 0.35 * engine) * (0.85 + 0.15 * drive) * (c.oil < 0.1 ? 0.85 : 1) * (broken ? 0.5 : 1),
    grip: base.grip * mul.grip * (0.78 + 0.22 * tyres) * (0.93 + 0.07 * hurt(c.shock)) * (0.95 + 0.05 * hurt(c.fork)) * (1 - 0.18 * rain * (1.3 - tyres * 0.5)),
    brakeMul: mul.brake * (0.5 + 0.5 * brakes) * (1 - 0.15 * rain),
    headlight: c.light > 0.15 ? (c.battery > 0.15 ? 1 : 0.4) : 0,
    color: st.paint,
    rim: st.rim,
    neon: st.neon,
    loud: (MODS[0].options[st.mods.exhaust] || {}).loud || 0,
    broken,
  };
  return out;
}

// Ride `km` (braking = share of that time spent on the brakes 0..1).
export function wear(save, id, km, braking = 0) {
  const st = bikeState(save, id);
  const tireMod = (MODS[4].options[st.mods.tires] || {}).tireWear || 1;
  const filterMod = (MODS[2].options[st.mods.intake] || {}).filterWear || 1;
  for (const p of PARTS) {
    let w = p.wear;
    if (p.id === 'engine' && st.parts.oil < 0.1) w *= 4; // running dry
    if (p.id.startsWith('tire')) w *= tireMod;
    if (p.id === 'filter') w *= filterMod;
    if (p.brakeWear) w += p.brakeWear * braking * 4;
    st.parts[p.id] = Math.max(0, st.parts[p.id] - (w / 100) * km);
  }
}

// A crash of `power` m/s knocks pieces off. Returns the parts that broke badly (for a message).
export function damage(save, id, power) {
  const st = bikeState(save, id);
  const hit = [];
  for (const p of PARTS) {
    if (!p.crash) continue;
    if (Math.random() > p.crash * Math.min(1, power / 10)) continue;
    const before = st.parts[p.id];
    st.parts[p.id] = Math.max(0, before - (0.04 + Math.random() * 0.06) * power / 3);
    if (before > 0.3 && st.parts[p.id] <= 0.3) hit.push(p);
  }
  return hit;
}

export function warnings(save, id) {
  const st = bikeState(save, id);
  return PARTS.filter((p) => st.parts[p.id] < 0.25).map((p) => ({ ...p, cond: st.parts[p.id] }));
}
