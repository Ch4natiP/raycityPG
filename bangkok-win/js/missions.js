// Daily missions: three a day, new ones when the clock passes midnight.
// Each template reacts to game events: trip, battleWin, km.
const TEMPLATES = [
  { id: 'trips', text: (n) => `ส่งผู้โดยสาร ${n} เที่ยว`, range: [3, 6], on: { trip: () => 1 } },
  { id: 'fivestar', text: (n) => `ได้ 5 ดาว ${n} เที่ยว`, range: [2, 4], on: { trip: (e) => (e.stars === 5 ? 1 : 0) } },
  { id: 'clean', text: (n) => `ส่ง ${n} เที่ยวติดกันแบบไม่ชนเลย`, range: [2, 4], streak: true, on: { trip: (e) => (e.crashes === 0 ? 1 : -1) } },
  { id: 'tourist', text: (n) => `ส่งนักท่องเที่ยว ${n} คน`, range: [1, 3], minLevel: 2, on: { trip: (e) => (e.type === 'tourist' ? 1 : 0) } },
  { id: 'night', text: (n) => `วิ่งงานกลางคืน (19:00–05:00) ${n} เที่ยว`, range: [2, 3], on: { trip: (e) => (e.night ? 1 : 0) } },
  { id: 'rush', text: (n) => `วิ่งงานช่วงเร่งด่วน ${n} เที่ยว`, range: [2, 4], on: { trip: (e) => (e.rush ? 1 : 0) } },
  { id: 'rain', text: (n) => `ส่งงานตอนฝนตก ${n} เที่ยว`, range: [1, 2], on: { trip: (e) => (e.rain ? 1 : 0) } },
  { id: 'earn', text: (n) => `หาเงินจากค่าโดยสารให้ได้ ฿${n}`, range: [300, 900], step: 50, on: { trip: (e) => e.paid } },
  { id: 'landmark', text: (n) => `ส่งผู้โดยสารที่สถานที่สำคัญ ${n} เที่ยว`, range: [1, 3], on: { trip: (e) => (e.landmark ? 1 : 0) } },
  { id: 'regular', text: (n) => `ส่งลูกค้าในสมุดลูกค้า ${n} คน`, range: [1, 3], on: { trip: (e) => (e.customer ? 1 : 0) } },
  { id: 'nored', text: (n) => `ส่ง ${n} เที่ยวโดยไม่ฝ่าไฟแดง`, range: [2, 4], streak: true, on: { trip: (e) => (e.redlights === 0 ? 1 : -1) } },
  { id: 'battle', text: (n) => `ชนะ Battle ${n} ครั้ง`, range: [1, 2], on: { battleWin: () => 1 } },
  { id: 'km', text: (n) => `ขับให้ได้ ${n} กม.`, range: [3, 8], on: { km: (e) => e.km } },
];

const rand = (a, b, step = 1) => Math.round((a + Math.random() * (b - a)) / step) * step;

export class Missions {
  constructor(save, onDone) {
    this.save = save;
    this.onDone = onDone; // (mission) => void, after the reward is paid
    save.missions ??= { day: -1, list: [] };
  }

  get list() { return this.save.missions.list; }

  // Call every frame with the game day; deals a fresh set when the day changes.
  ensure(day, level) {
    if (this.save.missions.day === day && this.list.length) return false;
    const pool = TEMPLATES.filter((t) => (t.minLevel || 1) <= level).sort(() => Math.random() - 0.5);
    this.save.missions = {
      day,
      list: pool.slice(0, 3).map((t) => {
        const target = rand(t.range[0], t.range[1], t.step || 1);
        const big = t.id === 'earn' ? target / 300 : target;
        return { id: t.id, target, progress: 0, done: false, text: t.text(target), money: Math.round((80 + big * 40 + level * 15) / 10) * 10, xp: Math.round(20 + big * 12 + level * 3) };
      }),
    };
    return true;
  }

  // Feed a game event; returns missions completed by it (already rewarded).
  event(type, data = {}) {
    const done = [];
    for (const m of this.list) {
      if (m.done) continue;
      const t = TEMPLATES.find((x) => x.id === m.id);
      const f = t?.on[type];
      if (!f) continue;
      const v = f(data);
      if (t.streak && v < 0) m.progress = 0;
      else if (v > 0) m.progress = Math.min(m.target, m.progress + v);
      if (m.progress >= m.target) { m.done = true; done.push(m); }
    }
    for (const m of done) this.onDone?.(m);
    return done;
  }
}
