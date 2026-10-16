import { BIKES } from './config.js';

// Levels: XP comes from finished trips. Everything about levelling lives here so later systems
// (more jobs, the mechanic's tuning, new districts) only need a row in UNLOCKS.
export const MAX_LEVEL = 50;

// XP needed to go from `level` to `level + 1`.
export const xpToNext = (level) => Math.round(60 + 40 * (level - 1) ** 1.35);

// XP for one delivered trip.
export function tripXp({ fare, stars, landmark, late }) {
  let xp = 10 + Math.round(fare / 4) + stars * 3;
  if (landmark) xp += 5;
  if (late) xp = Math.round(xp * 0.5);
  return xp;
}

export const levelBonus = (level) => level * 50; // baht paid out on reaching `level`

// What each level opens up. `soon` marks systems that are planned but not built yet.
export const UNLOCKS = [
  { level: 2, icon: '🌏', text: 'นักท่องเที่ยวเริ่มเรียกรถ (จ่ายแพงกว่า 2 เท่า)' },
  ...BIKES.filter((b) => b.level > 1).map((b) => ({ level: b.level, icon: '🛵', text: `ซื้อ${b.name}ได้ที่ซุ้มวิน` })),
  { level: 4, icon: '🛍', text: 'แม่ค้าเรียกรถ (ของเยอะ ขับนิ่มๆ)' },
  { level: 8, icon: '💸', text: 'ค่าโดยสารเพิ่ม 10% (ลูกค้าประจำ)' },
  { level: 12, icon: '💸', text: 'ค่าโดยสารเพิ่มอีก 10%' },
  { level: 15, icon: '🔧', text: 'อาชีพช่าง: จูนรถเอง', soon: true },
  { level: 20, icon: '🍜', text: 'อาชีพไรเดอร์ส่งอาหาร', soon: true },
].sort((a, b) => a.level - b.level);

export const fareMultiplier = (level) => 1 + (level >= 8 ? 0.1 : 0) + (level >= 12 ? 0.1 : 0);
export const passengerTypes = (level) => ['normal', 'rush', ...(level >= 2 ? ['tourist'] : []), ...(level >= 4 ? ['auntie'] : [])];

// Fill in fields older saves do not have.
export function migrate(save) {
  save.level ??= 1;
  save.xp ??= 0;
  save.earned ??= save.money || 0;
  save.distance ??= 0;
  save.history ??= [];
  save.settings ??= { quality: 'high' };
  return save;
}

// Add XP; returns the levels gained (each with its bonus) so the caller can celebrate them.
export function addXp(save, xp) {
  const ups = [];
  save.xp += xp;
  while (save.level < MAX_LEVEL && save.xp >= xpToNext(save.level)) {
    save.xp -= xpToNext(save.level);
    save.level += 1;
    const bonus = levelBonus(save.level);
    save.money += bonus;
    save.earned += bonus;
    ups.push({ level: save.level, bonus, unlocks: UNLOCKS.filter((u) => u.level === save.level) });
  }
  if (save.level >= MAX_LEVEL) save.xp = 0;
  return ups;
}
