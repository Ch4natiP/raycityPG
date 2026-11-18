/* ลอยกระทงออนไลน์ — ฉาก overlay (canvas 1080x1920) */
'use strict';
(() => {
const W = 1080, H = 1920;
const HORIZON = 1085;       // ขอบฟ้า/ริมฝั่งตรงข้าม
const NEAR_Y = 1650;        // ขอบท่าน้ำ (กระทงเริ่มลอยจากตรงนี้)
const params = new URLSearchParams(location.search);
const MUTED = params.has('mute');

const stage = document.getElementById('stage');
const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');

function fit() {
  const s = Math.min(innerWidth / W, innerHeight / H);
  stage.style.transform = `translate(${-W * s / 2}px, ${-H * s / 2}px) scale(${s})`;
}
addEventListener('resize', fit); fit();

// ---------- utils ----------
const rand = (a, b) => a + Math.random() * (b - a);
const pick = a => a[(Math.random() * a.length) | 0];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function hash(s) { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let config = { tiers: [], showCharacters: true, sound: true };

// =====================================================================
// ฉากพื้นหลัง (วาดครั้งเดียวลง offscreen)
// =====================================================================
const MOON = { x: 175, y: 300, r: 92 };
const stars = Array.from({ length: 170 }, () => ({ x: rand(0, W), y: rand(0, HORIZON - 250), r: rand(.6, 2.2), p: rand(0, 6.28), s: rand(1, 3) }));

function drawPrang(g, cx, baseY, h, w) {
  // ปรางค์ทรงฝักข้าวโพดแบบวัดอรุณฯ  (ขั้นฐาน 3 ชั้น + องค์ปรางค์ + นภศูล)
  const lit = g.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
  lit.addColorStop(0, '#7a4a2a'); lit.addColorStop(.35, '#f2c27a'); lit.addColorStop(.55, '#ffe2a6'); lit.addColorStop(1, '#8a5530');
  g.fillStyle = lit;
  const steps = 4; let y = baseY, sw = w;
  for (let i = 0; i < steps; i++) {
    const sh = h * 0.07;
    g.fillRect(cx - sw / 2, y - sh, sw, sh);
    g.fillStyle = 'rgba(80,40,20,.55)'; g.fillRect(cx - sw / 2, y - sh, sw, 3);
    g.fillStyle = lit;
    y -= sh; sw *= 0.82;
  }
  const bodyBase = y, bw = sw * 0.95, top = baseY - h * 0.88;
  g.beginPath();
  g.moveTo(cx - bw / 2, bodyBase);
  g.bezierCurveTo(cx - bw * 0.62, bodyBase - (bodyBase - top) * 0.45, cx - bw * 0.25, top + (bodyBase - top) * 0.12, cx, top);
  g.bezierCurveTo(cx + bw * 0.25, top + (bodyBase - top) * 0.12, cx + bw * 0.62, bodyBase - (bodyBase - top) * 0.45, cx + bw / 2, bodyBase);
  g.closePath(); g.fill();
  // ลายชั้นขวาง
  g.save(); g.clip();
  for (let yy = bodyBase; yy > top; yy -= h * 0.035) {
    g.fillStyle = 'rgba(90,45,20,.35)'; g.fillRect(cx - bw, yy, bw * 2, 2.5);
    g.fillStyle = 'rgba(255,240,200,.25)'; g.fillRect(cx - bw, yy - 3, bw * 2, 1.5);
  }
  g.restore();
  // นภศูล
  g.strokeStyle = '#ffe9b8'; g.lineWidth = Math.max(1.5, w * 0.02);
  g.beginPath(); g.moveTo(cx, top); g.lineTo(cx, baseY - h); g.stroke();
  // ไฟประดับ
  for (let i = 0; i < 26; i++) {
    const t = Math.random(), yy = bodyBase - (bodyBase - top) * t;
    const half = bw / 2 * (1 - t * 0.85);
    const px = cx + rand(-half, half) * 0.9;
    g.fillStyle = 'rgba(255,250,215,.95)'; g.beginPath(); g.arc(px, yy, rand(1, 2.4), 0, 7); g.fill();
  }
}

function buildBackground() {
  const c = mk(W, H), g = c.getContext('2d');
  // ท้องฟ้า
  const sky = g.createLinearGradient(0, 0, 0, HORIZON);
  sky.addColorStop(0, '#05051a'); sky.addColorStop(.45, '#191446'); sky.addColorStop(.8, '#3b2464'); sky.addColorStop(1, '#7a3d5e');
  g.fillStyle = sky; g.fillRect(0, 0, W, HORIZON);
  // แสงหลังวัด
  let gl = g.createRadialGradient(540, 820, 20, 540, 820, 520);
  gl.addColorStop(0, 'rgba(255,190,100,.55)'); gl.addColorStop(1, 'rgba(255,150,80,0)');
  g.fillStyle = gl; g.fillRect(0, 300, W, HORIZON - 300);
  // พระจันทร์
  gl = g.createRadialGradient(MOON.x, MOON.y, MOON.r * .6, MOON.x, MOON.y, MOON.r * 3.2);
  gl.addColorStop(0, 'rgba(255,240,200,.45)'); gl.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = gl; g.fillRect(0, 0, 600, 700);
  const mg = g.createRadialGradient(MOON.x - 25, MOON.y - 25, 10, MOON.x, MOON.y, MOON.r);
  mg.addColorStop(0, '#fffbe8'); mg.addColorStop(.8, '#f6e2a8'); mg.addColorStop(1, '#e8c77d');
  g.fillStyle = mg; g.beginPath(); g.arc(MOON.x, MOON.y, MOON.r, 0, 7); g.fill();
  g.fillStyle = 'rgba(190,160,100,.28)';
  for (const [dx, dy, r] of [[-30, -10, 18], [20, 25, 24], [30, -35, 12], [-15, 40, 10]]) { g.beginPath(); g.arc(MOON.x + dx, MOON.y + dy, r, 0, 7); g.fill(); }
  // เมืองไกล ๆ
  for (let x = 0; x < W; x += rand(18, 40)) {
    const bh = rand(20, 90), bw = rand(16, 36);
    g.fillStyle = '#1d1435'; g.fillRect(x, HORIZON - bh, bw, bh);
    g.fillStyle = 'rgba(255,210,130,.6)';
    for (let k = 0; k < bh / 9; k++) if (Math.random() < .35) g.fillRect(x + rand(2, bw - 4), HORIZON - bh + k * 9 + 3, 2, 3);
  }
  // ต้นไม้ริมฝั่ง
  g.fillStyle = '#120c22';
  for (let x = -20; x < W + 20; x += rand(25, 45)) { g.beginPath(); g.ellipse(x, HORIZON - 8, rand(22, 40), rand(18, 40), 0, 0, 7); g.fill(); }
  // วัดอรุณฯ: ปรางค์ประธาน + ปรางค์ทิศ
  drawPrang(g, 285, HORIZON - 10, 190, 92);
  drawPrang(g, 795, HORIZON - 10, 190, 92);
  drawPrang(g, 380, HORIZON - 15, 270, 120);
  drawPrang(g, 700, HORIZON - 15, 270, 120);
  // ระเบียงฐาน
  g.fillStyle = '#c98e52'; g.fillRect(250, HORIZON - 40, 580, 32);
  g.fillStyle = 'rgba(255,240,190,.8)';
  for (let x = 258; x < 830; x += 16) g.fillRect(x, HORIZON - 32, 3, 3);
  drawPrang(g, 540, HORIZON - 30, 560, 210);
  // เขื่อนริมน้ำ + ไฟ
  g.fillStyle = '#2a1d3a'; g.fillRect(0, HORIZON - 6, W, 14);
  for (let x = 6; x < W; x += 22) { g.fillStyle = '#ffd98a'; g.fillRect(x, HORIZON - 4, 3, 3); }
  // แม่น้ำ
  const river = g.createLinearGradient(0, HORIZON, 0, NEAR_Y);
  river.addColorStop(0, '#2c1d4d'); river.addColorStop(.35, '#122045'); river.addColorStop(1, '#06102a');
  g.fillStyle = river; g.fillRect(0, HORIZON + 8, W, NEAR_Y - HORIZON);
  // เงาสะท้อนวัด
  g.save(); g.globalAlpha = .28; g.translate(0, 2 * (HORIZON + 8)); g.scale(1, -1);
  g.drawImage(c, 0, HORIZON - 600, W, 600, 0, HORIZON - 600, W, 600);
  g.restore();
  g.fillStyle = river; g.globalAlpha = .45; g.fillRect(0, HORIZON + 8, W, NEAR_Y - HORIZON); g.globalAlpha = 1;
  return c;
}

function buildPier() {
  const c = mk(W, H - NEAR_Y + 40), g = c.getContext('2d'), top = 40;
  // เสาท่า
  g.fillStyle = '#3a2213';
  for (let x = 20; x < W; x += 110) g.fillRect(x, 0, 22, top + 30);
  // พื้นไม้ (ทัศนมิติ)
  for (let i = 0; i < 14; i++) {
    const y0 = top + i * 20, h = 20;
    const gg = g.createLinearGradient(0, y0, 0, y0 + h);
    const base = 70 + (i % 2) * 10;
    gg.addColorStop(0, `rgb(${base + 70},${base + 35},${base - 20})`); gg.addColorStop(1, `rgb(${base + 40},${base + 15},${base - 35})`);
    g.fillStyle = gg; g.fillRect(0, y0, W, h);
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, y0 + h - 2, W, 2);
    g.fillStyle = 'rgba(0,0,0,.18)';
    for (let x = (i * 137) % 160; x < W; x += 160) g.fillRect(x, y0, 2, h);
  }
  g.fillStyle = '#5a3418'; g.fillRect(0, top - 6, W, 12);
  g.fillStyle = 'rgba(255,200,120,.25)'; g.fillRect(0, top - 6, W, 3);
  // แสงไฟส้มบนพื้น
  for (const x of [70, W - 70]) {
    const r = g.createRadialGradient(x, top + 60, 10, x, top + 60, 300);
    r.addColorStop(0, 'rgba(255,170,70,.35)'); r.addColorStop(1, 'rgba(255,170,70,0)');
    g.fillStyle = r; g.fillRect(0, 0, W, c.height);
  }
  return c;
}

let BG = null, PIER = null;

// =====================================================================
// กระทง (เรนเดอร์ล่วงหน้าเป็นสไปรต์ต่อระดับ)
// =====================================================================
const TIER_STYLE = {
  leaf:     { petal: ['#cfeec0', '#7fc86d'], inner: '#ffffff', flower: '#ffffff', scale: 1.0, glow: 'rgba(255,190,90,' },
  lotus:    { petal: ['#ffd1e6', '#ef5f9c'], inner: '#fff0f6', flower: '#ff8fbf', scale: 1.1, glow: 'rgba(255,150,190,' },
  marigold: { petal: ['#ffe28a', '#ff9a1f'], inner: '#fff1b8', flower: '#ffb21f', scale: 1.2, glow: 'rgba(255,190,60,' },
  gold:     { petal: ['#fff2b0', '#d4a017'], inner: '#fff9d8', flower: '#ffd84a', scale: 1.4, glow: 'rgba(255,215,90,', sparkle: true },
  royal:    { petal: ['#fff6c8', '#c9900f'], inner: '#ffffff', flower: '#ff6f3c', scale: 2.0, glow: 'rgba(255,220,120,', sparkle: true, candles: 3 },
};
const SPR = 200; // ขนาดสไปรต์
function buildKrathong(st) {
  const c = mk(SPR, SPR), g = c.getContext('2d'), cx = SPR / 2, cy = SPR * 0.62;
  // ใบตองฐาน (กลีบแหลมรอบ ๆ)
  g.fillStyle = '#2f7a2b';
  for (let i = 0; i < 16; i++) {
    const a = Math.PI * 2 * i / 16;
    g.save(); g.translate(cx, cy); g.scale(1, .42); g.rotate(a);
    g.beginPath(); g.moveTo(-14, 52); g.lineTo(0, 86); g.lineTo(14, 52); g.closePath();
    g.fillStyle = i % 2 ? '#2e7a2a' : '#3f9a36'; g.fill(); g.restore();
  }
  g.fillStyle = '#245f22'; g.beginPath(); g.ellipse(cx, cy, 64, 26, 0, 0, 7); g.fill();
  g.fillStyle = '#4caf3f'; g.beginPath(); g.ellipse(cx, cy - 5, 60, 23, 0, 0, 7); g.fill();
  // กลีบดอกบัว 2 ชั้น
  const petal = (x, y, ang, len, wid, col) => {
    g.save(); g.translate(x, y); g.rotate(ang);
    const pg = g.createLinearGradient(0, 0, 0, -len);
    pg.addColorStop(0, col[1]); pg.addColorStop(1, col[0]);
    g.fillStyle = pg; g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, 0);
    g.quadraticCurveTo(-wid, -len * .55, 0, -len); g.quadraticCurveTo(wid, -len * .55, 0, 0);
    g.fill(); g.stroke(); g.restore();
  };
  for (let i = -3; i <= 3; i++) petal(cx + i * 15, cy - 8, i * 0.2, 46, 15, st.petal);
  g.fillStyle = st.inner; g.beginPath(); g.ellipse(cx, cy - 22, 40, 12, 0, 0, 7); g.fill();
  for (let i = -2; i <= 2; i++) petal(cx + i * 17, cy - 2, i * 0.28, 38, 14, st.petal);
  // ดอกไม้ตกแต่ง
  for (const [dx, dy] of [[-26, -28], [26, -28], [-12, -36], [12, -36], [0, -26]]) {
    g.fillStyle = st.flower; g.beginPath(); g.arc(cx + dx, cy + dy, 6, 0, 7); g.fill();
    g.fillStyle = '#fff8'; g.beginPath(); g.arc(cx + dx - 1.5, cy + dy - 1.5, 2, 0, 7); g.fill();
  }
  // ธูป 3 ดอก
  g.strokeStyle = '#a8432a'; g.lineWidth = 2;
  for (const dx of [-16, -10, -4]) { g.beginPath(); g.moveTo(cx + dx, cy - 30); g.lineTo(cx + dx - 3, cy - 82); g.stroke(); }
  // เทียน
  const candles = st.candles || 1;
  for (let k = 0; k < candles; k++) {
    const x = cx + 10 + (k - (candles - 1) / 2) * 20 - (candles > 1 ? 10 : 0);
    const cg = g.createLinearGradient(x - 5, 0, x + 5, 0);
    cg.addColorStop(0, '#e9dcc0'); cg.addColorStop(.5, '#fffaf0'); cg.addColorStop(1, '#d9c8a6');
    g.fillStyle = cg; g.fillRect(x - 5, cy - 68, 10, 38);
  }
  return c;
}
const SPRITES = {};
for (const k in TIER_STYLE) SPRITES[k] = buildKrathong(TIER_STYLE[k]);

function drawMiniKrathong(c, tier) {
  const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height);
  g.drawImage(SPRITES[tier] || SPRITES.leaf, 0, 0, c.width, c.height);
  g.fillStyle = '#ffcf5a';
  const st = TIER_STYLE[tier] || TIER_STYLE.leaf, n = st.candles || 1;
  for (let k = 0; k < n; k++) {
    const x = (SPR / 2 + 10 + (k - (n - 1) / 2) * 20 - (n > 1 ? 10 : 0)) * c.width / SPR;
    g.beginPath(); g.ellipse(x, (SPR * .62 - 76) * c.height / SPR, 3, 6, 0, 0, 7); g.fill();
  }
}

const krathongs = [];
const MAX_K = 160;
class Krathong {
  constructor(tier, owner, u, wish) {
    this.tier = TIER_STYLE[tier] ? tier : 'leaf';
    this.st = TIER_STYLE[this.tier];
    this.owner = owner; this.wish = wish;
    this.u = u;                       // ตำแหน่งแนวขวาง (-1..1 ที่ระยะใกล้)
    this.z = 1;                       // ระยะ 1 = ใกล้, 6 = ไกล
    this.speed = rand(.085, .12);
    this.drift = rand(-.04, .04);
    this.ph = rand(0, 6.28);
    this.age = 0; this.alpha = 0;
  }
  update(dt) {
    this.age += dt;
    this.z += this.speed * dt * (this.z < 1.25 ? 1.6 : 1);
    this.u += this.drift * dt;
    this.alpha = Math.min(1, this.age * 2) * clamp((6.2 - this.z) / 1.2, 0, 1);
    return this.z < 6.2;
  }
  get s() { return 1 / this.z; }
  get x() { return W / 2 + this.u * 760 * this.s + Math.sin(this.age * .9 + this.ph) * 8 * this.s; }
  get y() { return HORIZON + 12 + (NEAR_Y - HORIZON - 12) * this.s; }
  draw(g, t) {
    const s = this.s * this.st.scale, x = this.x, y = this.y + Math.sin(t * 2 + this.ph) * 2.5 * this.s;
    const a = this.alpha; if (a <= 0) return;
    g.globalAlpha = a;
    // แสงสะท้อนบนน้ำ
    const rg = g.createRadialGradient(x, y + 6 * s, 2, x, y + 6 * s, 120 * s);
    rg.addColorStop(0, this.st.glow + '.55)'); rg.addColorStop(1, this.st.glow + '0)');
    g.fillStyle = rg; g.beginPath(); g.ellipse(x, y + 6 * s, 120 * s, 40 * s, 0, 0, 7); g.fill();
    g.fillStyle = this.st.glow + '.35)';
    for (let i = 1; i <= 4; i++) g.fillRect(x - (20 - i * 3) * s, y + (10 + i * 9) * s, (40 - i * 6) * s * (1 + Math.sin(t * 3 + i) * .2), 2.5 * s);
    // ตัวกระทง
    const sz = SPR * 0.62 * s;
    g.drawImage(SPRITES[this.tier], x - sz / 2, y - sz * 0.62 - 0 * s, sz, sz);
    // เปลวเทียน
    const n = this.st.candles || 1;
    for (let k = 0; k < n; k++) {
      const fx = x + (10 + (k - (n - 1) / 2) * 20 - (n > 1 ? 10 : 0)) * 0.62 * s;
      const fy = y + (-68 - 8) * 0.62 * s;
      const fl = 1 + Math.sin(t * 13 + this.ph + k) * .12 + Math.sin(t * 7.3 + k) * .08;
      const fg = g.createRadialGradient(fx, fy, 0, fx, fy, 26 * s);
      fg.addColorStop(0, 'rgba(255,220,140,.9)'); fg.addColorStop(1, 'rgba(255,160,60,0)');
      g.fillStyle = fg; g.beginPath(); g.arc(fx, fy, 26 * s, 0, 7); g.fill();
      g.fillStyle = '#fff3b0'; g.beginPath(); g.ellipse(fx, fy, 3.2 * s, 7.5 * s * fl, 0, 0, 7); g.fill();
    }
    // ปลายธูป
    g.fillStyle = '#ff5a2a';
    for (const dx of [-16, -10, -4]) { g.beginPath(); g.arc(x + (dx - 3) * .62 * s, y - (SPR * .62 - (SPR * .62 - 82)) * 0 + (-82) * .62 * s, 1.8 * s + .5, 0, 7); g.fill(); }
    if (this.st.sparkle) {
      g.fillStyle = '#fff6c0';
      for (let i = 0; i < 4; i++) {
        const a2 = t * 1.5 + i * 1.57 + this.ph, r = 50 * s;
        const sp = (Math.sin(t * 5 + i * 2) + 1) / 2;
        star4(g, x + Math.cos(a2) * r, y - 25 * s + Math.sin(a2) * r * .5, 6 * s * sp + 1);
      }
    }
    // ป้ายชื่อ
    if (s > .3 && this.owner) {
      const fs = Math.round(clamp(24 * this.s, 12, 24));
      g.font = `500 ${fs}px Kanit, sans-serif`;
      const label = this.owner.length > 14 ? this.owner.slice(0, 13) + '…' : this.owner;
      const tw = g.measureText(label).width;
      const ly = y - sz * 0.66 - fs;
      g.fillStyle = 'rgba(15,8,35,.7)'; rr(g, x - tw / 2 - 10, ly - fs * .5 - 6, tw + 20, fs + 10, 12); g.fill();
      g.fillStyle = '#ffe9a8'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, x, ly);
      if (this.wish && this.age < 9) {
        const wf = Math.round(fs * .9);
        g.font = `400 ${wf}px Kanit, sans-serif`;
        const wl = this.wish.length > 22 ? this.wish.slice(0, 21) + '…' : this.wish;
        const ww = g.measureText(wl).width;
        const wy = ly - fs - 10;
        g.globalAlpha = a * clamp(9 - this.age, 0, 1);
        g.fillStyle = 'rgba(255,255,255,.88)'; rr(g, x - ww / 2 - 12, wy - wf * .5 - 6, ww + 24, wf + 12, 14); g.fill();
        g.fillStyle = '#5a2a68'; g.fillText(wl, x, wy);
      }
    }
    g.globalAlpha = 1;
  }
}
function star4(g, x, y, r) {
  g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r * .25, y - r * .25); g.lineTo(x + r, y); g.lineTo(x + r * .25, y + r * .25);
  g.lineTo(x, y + r); g.lineTo(x - r * .25, y + r * .25); g.lineTo(x - r, y); g.lineTo(x - r * .25, y - r * .25); g.closePath(); g.fill();
}

// คิวปล่อยกระทง (กันการปล่อยพร้อมกันทีละร้อย)
const spawnQueue = [];
function queueKrathong(tier, owner, u, wish, delay = 0) { spawnQueue.push({ tier, owner, u, wish, at: performance.now() + delay }); }
function processQueue(now) {
  let n = 0;
  while (spawnQueue.length && spawnQueue[0].at <= now && n < 3) {
    const q = spawnQueue.shift(); n++;
    if (krathongs.length >= MAX_K) {
      // เร่งกระทงที่ไกลที่สุดให้หายไปก่อน
      krathongs.sort((a, b) => b.z - a.z); krathongs[0].z = Math.max(krathongs[0].z, 5.6);
    }
    krathongs.push(new Krathong(q.tier, q.owner, q.u, q.wish));
    sfx.plop();
  }
  spawnQueue.sort((a, b) => a.at - b.at);
}

// =====================================================================
// ตัวละครบนท่าน้ำ
// =====================================================================
const SLOTS = [];
(() => {
  const rows = [{ y: 1745, n: 9, x0: 120, x1: 960 }, { y: 1815, n: 10, x0: 80, x1: 1000 }, { y: 1885, n: 9, x0: 120, x1: 960 }];
  for (const r of rows) for (let i = 0; i < r.n; i++) SLOTS.push({ x: r.x0 + (r.x1 - r.x0) * i / (r.n - 1) + (r.y === 1815 ? 0 : 0), y: r.y });
  // จัดลำดับให้ช่องกลาง ๆ ถูกใช้ก่อน
  SLOTS.sort((a, b) => Math.abs(a.x - 540) + (a.y - 1745) * 2.5 - (Math.abs(b.x - 540) + (b.y - 1745) * 2.5));
})();
const people = new Map(); // id -> person
const OUTFIT_F = [['#e0447a', '#7b1f5a'], ['#f2b632', '#8a3d12'], ['#7c5cd6', '#33206e'], ['#2fb39a', '#14564e'], ['#ff7a3d', '#7a2410'], ['#e8e0ff', '#5b4a9c']];
const OUTFIT_M = [['#f5f1e6', '#1f4b8f'], ['#ffe9b8', '#7a1f2a'], ['#d8f0ff', '#2a5e3a'], ['#fff', '#6b3c8f'], ['#f3e0c7', '#2c2c5a']];
const SKIN = ['#f6d2b0', '#eec39a', '#d9a87f', '#c78f66'];

function addPerson(user) {
  if (!config.showCharacters || !user) return null;
  const id = String(user.id || user.name);
  let p = people.get(id);
  if (p) { p.name = user.name || p.name; p.last = performance.now(); return p; }
  const used = new Set([...people.values()].map(q => q.slot));
  let slot = SLOTS.findIndex((_, i) => !used.has(i));
  if (slot < 0) {
    // แทนที่คนที่เงียบนานที่สุด
    let old = null; for (const q of people.values()) if (!old || q.last < old.last) old = q;
    people.delete(old.id); slot = old.slot;
  }
  const h = hash(id);
  p = { id, name: user.name || 'ผู้ชม', slot, gender: h % 2 ? 'f' : 'm', outfit: h >>> 3, skin: SKIN[(h >>> 7) % SKIN.length],
        last: performance.now(), born: performance.now(), act: null, actT: 0, bub: null, bubT: 0, ph: (h % 628) / 100 };
  people.set(id, p);
  return p;
}
function personAct(user, act, bub) {
  const p = addPerson(user); if (!p) return null;
  p.act = act; p.actT = 0; p.last = performance.now();
  if (bub) { p.bub = bub; p.bubT = 0; }
  return p;
}

function drawPerson(g, p, t, dt) {
  const s0 = SLOTS[p.slot]; if (!s0) return;
  const appear = clamp((performance.now() - p.born) / 400, 0, 1);
  p.actT += dt; p.bubT += dt;
  if (p.act && p.actT > 1.6) p.act = null;
  let x = s0.x, y = s0.y, crouch = 0, jump = 0;
  if (p.act === 'float') crouch = Math.sin(clamp(p.actT / 1.6, 0, 1) * Math.PI) * 14;
  if (p.act === 'gift' || p.act === 'follow') jump = Math.abs(Math.sin(p.actT * 7)) * 22 * (1 - p.actT / 1.6);
  const bob = Math.sin(t * 2 + p.ph) * 1.5;
  y += crouch - jump + bob + (1 - appear) * 40;
  const sc = 0.92 + (s0.y - 1745) / 900;
  g.save(); g.translate(x, y); g.scale(sc, sc); g.globalAlpha = appear;
  // เงา
  g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(0, 4, 20, 6, 0, 0, 7); g.fill();
  const f = p.gender === 'f';
  const [c1, c2] = (f ? OUTFIT_F : OUTFIT_M)[p.outfit % (f ? OUTFIT_F.length : OUTFIT_M.length)];
  // ขา / ผ้าซิ่น / โจงกระเบน
  if (f) {
    g.fillStyle = c2; rr(g, -13, -34, 26, 36, 4); g.fill();
    g.fillStyle = 'rgba(255,215,120,.8)'; g.fillRect(-13, -6, 26, 3); g.fillRect(-13, -26, 26, 2);
  } else {
    g.fillStyle = c2; rr(g, -13, -34, 26, 22, 5); g.fill();
    g.fillStyle = p.skin; g.fillRect(-10, -13, 7, 14); g.fillRect(3, -13, 7, 14);
  }
  // ตัว
  g.fillStyle = c1; rr(g, -14, -62, 28, 30, 8); g.fill();
  if (f) { g.fillStyle = c2; g.beginPath(); g.moveTo(-14, -60); g.lineTo(14, -38); g.lineTo(14, -32); g.lineTo(-14, -54); g.closePath(); g.fill(); g.fillStyle = 'rgba(255,215,120,.7)'; g.fillRect(-14, -62, 28, 2); }
  else { g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(-1, -62, 2, 30); for (const by of [-56, -48, -40]) { g.fillStyle = '#d4af37'; g.beginPath(); g.arc(0, by, 1.6, 0, 7); g.fill(); } }
  // แขน (ไหว้ = พนมมือ)
  g.fillStyle = p.skin;
  if (p.act === 'wai') { g.beginPath(); g.ellipse(0, -64, 4, 9, 0, 0, 7); g.fill(); }
  else if (p.act === 'float') { g.fillRect(-18, -50, 6, 18); g.fillRect(12, -50, 6, 18); }
  else { g.save(); g.translate(-15, -58); g.rotate(.15); g.fillRect(-3, 0, 6, 22); g.restore(); g.save(); g.translate(15, -58); g.rotate(-.15); g.fillRect(-3, 0, 6, 22); g.restore(); }
  // หัว
  g.fillStyle = p.skin; g.beginPath(); g.arc(0, -78, 16, 0, 7); g.fill();
  g.fillStyle = '#1b1020';
  g.beginPath(); g.arc(0, -82, 16.5, Math.PI * 1.05, Math.PI * 1.95); g.fill();
  if (f) { g.beginPath(); g.arc(0, -96, 8, 0, 7); g.fill(); g.fillStyle = '#ffffff'; g.beginPath(); g.arc(7, -97, 4, 0, 7); g.fill(); g.fillStyle = '#ffd34d'; g.beginPath(); g.arc(7, -97, 1.6, 0, 7); g.fill(); }
  else { g.fillRect(-16, -86, 32, 6); }
  g.fillStyle = '#2a1a1a'; g.beginPath(); g.arc(-5.5, -77, 1.8, 0, 7); g.arc(5.5, -77, 1.8, 0, 7); g.fill();
  g.strokeStyle = '#a0504a'; g.lineWidth = 1.5; g.beginPath(); g.arc(0, -72, 4, .2, Math.PI - .2); g.stroke();
  g.fillStyle = 'rgba(255,120,120,.35)'; g.beginPath(); g.arc(-9, -72, 3, 0, 7); g.arc(9, -72, 3, 0, 7); g.fill();
  // ป้ายชื่อ
  g.font = '500 15px Kanit, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const nm = p.name.length > 9 ? p.name.slice(0, 8) + '…' : p.name;
  const tw = g.measureText(nm).width;
  g.fillStyle = 'rgba(10,5,25,.65)'; rr(g, -tw / 2 - 6, -124, tw + 12, 20, 8); g.fill();
  g.fillStyle = '#fff'; g.fillText(nm, 0, -114);
  // บับเบิล
  if (p.bub && p.bubT < 3) {
    g.globalAlpha = appear * clamp(3 - p.bubT, 0, 1);
    g.font = '500 20px Kanit, sans-serif';
    const bw = g.measureText(p.bub).width + 20;
    g.fillStyle = '#fff'; rr(g, -bw / 2, -160, bw, 30, 14); g.fill();
    g.beginPath(); g.moveTo(-6, -131); g.lineTo(6, -131); g.lineTo(0, -124); g.fill();
    g.fillStyle = '#5a2a68'; g.fillText(p.bub, 0, -145);
  }
  g.restore();
}

// =====================================================================
// เอฟเฟกต์: พลุ / โคมลอย / หัวใจ / ประกาย
// =====================================================================
const parts = [];
const rockets = [];
const lanterns = [];
const hearts = [];
const FW_COL = ['#ffd84a', '#ff5fa2', '#7cf2ff', '#b48cff', '#ff8a3d', '#9dff7a', '#ffffff'];
function firework(x, y) {
  rockets.push({ x: x ?? rand(150, W - 150), y: H * .62, ty: y ?? rand(330, 820), vx: rand(-40, 40), col: pick(FW_COL), col2: pick(FW_COL) });
  sfx.whistle();
}
function burst(x, y, col, col2) {
  const n = 90, ring = Math.random() < .4;
  for (let i = 0; i < n; i++) {
    const a = Math.PI * 2 * i / n + rand(-.05, .05), sp = ring ? 330 : rand(80, 380);
    parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(1.2, 2), max: 2, col: i % 3 ? col : col2, size: rand(2, 3.6) });
  }
  sfx.boom();
}
function lanternWave(n) { for (let i = 0; i < n; i++) lanterns.push({ x: rand(60, W - 60), y: H + rand(0, 900), vy: rand(55, 95), ph: rand(0, 6.28), s: rand(.6, 1.25) }); }
function addHearts(n) { for (let i = 0; i < Math.min(n, 12); i++) hearts.push({ x: rand(W - 230, W - 60), y: H - rand(120, 200), vy: rand(150, 260), ph: rand(0, 6), life: 0, col: pick(['#ff4d79', '#ff8fb1', '#ffb3c7', '#ff2e5e']) }); }

function drawHeart(g, x, y, s) {
  g.beginPath(); g.moveTo(x, y + s * .3);
  g.bezierCurveTo(x, y, x - s * .5, y, x - s * .5, y + s * .3);
  g.bezierCurveTo(x - s * .5, y + s * .6, x, y + s * .8, x, y + s);
  g.bezierCurveTo(x, y + s * .8, x + s * .5, y + s * .6, x + s * .5, y + s * .3);
  g.bezierCurveTo(x + s * .5, y, x, y, x, y + s * .3); g.fill();
}

function updateFx(g, dt, t) {
  for (let i = rockets.length - 1; i >= 0; i--) {
    const r = rockets[i]; r.y -= 900 * dt; r.x += r.vx * dt;
    g.fillStyle = '#ffe9b0'; g.beginPath(); g.arc(r.x, r.y, 3, 0, 7); g.fill();
    parts.push({ x: r.x, y: r.y, vx: rand(-15, 15), vy: rand(20, 60), life: .45, max: .45, col: '#ffcf7a', size: 2 });
    if (r.y <= r.ty) { burst(r.x, r.y, r.col, r.col2); rockets.splice(i, 1); }
  }
  g.globalCompositeOperation = 'lighter';
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.life -= dt; if (p.life <= 0) { parts.splice(i, 1); continue; }
    p.vx *= .985; p.vy = p.vy * .985 + 120 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    g.globalAlpha = clamp(p.life / p.max, 0, 1);
    g.fillStyle = p.col; g.beginPath(); g.arc(p.x, p.y, p.size, 0, 7); g.fill();
  }
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  for (let i = lanterns.length - 1; i >= 0; i--) {
    const l = lanterns[i]; l.y -= l.vy * dt; const x = l.x + Math.sin(t * .8 + l.ph) * 20;
    if (l.y < -80) { lanterns.splice(i, 1); continue; }
    if (l.y > H) continue;
    const s = l.s * (l.y < 1100 ? .6 + l.y / 2750 : 1);
    const gg = g.createRadialGradient(x, l.y, 4, x, l.y, 60 * s);
    gg.addColorStop(0, 'rgba(255,190,90,.6)'); gg.addColorStop(1, 'rgba(255,140,40,0)');
    g.fillStyle = gg; g.beginPath(); g.arc(x, l.y, 60 * s, 0, 7); g.fill();
    const bg = g.createLinearGradient(0, l.y - 28 * s, 0, l.y + 28 * s);
    bg.addColorStop(0, '#ffcf6a'); bg.addColorStop(1, '#ff7b22');
    g.fillStyle = bg; g.beginPath();
    g.moveTo(x - 15 * s, l.y - 26 * s); g.lineTo(x + 15 * s, l.y - 26 * s); g.lineTo(x + 19 * s, l.y + 24 * s); g.lineTo(x - 19 * s, l.y + 24 * s); g.closePath(); g.fill();
    g.fillStyle = '#fff5c8'; g.beginPath(); g.ellipse(x, l.y + 22 * s, 6 * s, 3 * s, 0, 0, 7); g.fill();
  }
  for (let i = hearts.length - 1; i >= 0; i--) {
    const h = hearts[i]; h.life += dt; h.y -= h.vy * dt; if (h.life > 2.4) { hearts.splice(i, 1); continue; }
    g.globalAlpha = clamp(2.4 - h.life, 0, 1); g.fillStyle = h.col;
    drawHeart(g, h.x + Math.sin(h.life * 4 + h.ph) * 18, h.y, 34);
  }
  g.globalAlpha = 1;
}

// =====================================================================
// เสียง (สังเคราะห์ด้วย WebAudio — ไม่ต้องใช้ไฟล์)
// =====================================================================
const sfx = (() => {
  let ac = null, last = {};
  const ok = () => {
    if (MUTED || !config.sound) return false;
    if (!ac) { try { ac = new AudioContext(); } catch { return false; } }
    if (ac.state === 'suspended') ac.resume();
    return true;
  };
  const throttle = (k, ms) => { const n = performance.now(); if (n - (last[k] || 0) < ms) return true; last[k] = n; return false; };
  function tone(freq, dur, type = 'sine', vol = .15, slide = 0, delay = 0) {
    const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur);
  }
  function noise(dur, vol, freq) {
    const len = ac.sampleRate * dur, b = ac.createBuffer(1, len, ac.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = b; f.type = 'lowpass'; f.frequency.value = freq; g.gain.value = vol;
    s.connect(f).connect(g).connect(ac.destination); s.start();
  }
  return {
    plop() { if (!ok() || throttle('plop', 120)) return; tone(rand(380, 520), .18, 'sine', .12, .45); noise(.12, .05, 900); },
    chime() { if (!ok() || throttle('chime', 300)) return; [1, 1.5, 2, 2.5].forEach((m, i) => tone(660 * m, 1.2, 'sine', .07, 0, i * .07)); },
    whistle() { if (!ok() || throttle('wh', 150)) return; tone(700, .6, 'triangle', .03, 2.2); },
    boom() { if (!ok() || throttle('boom', 90)) return; noise(.9, .35, 420); tone(90, .5, 'sine', .2, .5); },
    join() { if (!ok() || throttle('join', 400)) return; tone(880, .15, 'sine', .05); tone(1320, .2, 'sine', .04, 0, .08); },
  };
})();

// =====================================================================
// HUD
// =====================================================================
const $ = id => document.getElementById(id);
function renderConfig() {
  $('tTitle').textContent = config.title || '';
  $('tSub').textContent = config.subtitle || '';
  $('tSub').style.display = config.subtitle ? '' : 'none';
  const list = $('tierList'); list.innerHTML = '';
  for (const t of config.tiers || []) {
    const row = document.createElement('div'); row.className = 'row';
    const c = mk(58, 58); drawMiniKrathong(c, t.id);
    const info = document.createElement('div');
    const kw = (config.floatKeywords || ['ลอย'])[0];
    info.innerHTML = t.free ? `<span class="c">ฟรี</span> พิมพ์ "${esc(kw)}"<small>${esc(t.name)}</small>`
                            : `<span class="c">${t.minCoins}+ 🪙</span><small>${esc(t.name)}</small>`;
    row.append(c, info); list.append(row);
  }
}
function renderState(st) {
  const ul = $('wishList');
  if (st.wishes?.length) ul.innerHTML = st.wishes.map(w => `<li><b>${esc(w.name)}:</b> ${esc(w.text)}</li>`).join('');
  const ol = $('topList');
  ol.innerHTML = (st.top || []).map((u, i) =>
    `<li><span class="rk">${['🥇', '🥈', '🥉', '4', '5'][i]}</span>${u.avatar ? `<img src="${esc(u.avatar)}" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'av'}))">` : '<span class="av"></span>'}<span class="nm">${esc(u.name)}</span><span class="pt">${u.points}</span></li>`
  ).join('') || '<li style="opacity:.7;justify-content:center">ยังไม่มีใครลอย — มาเป็นคนแรกกัน!</li>';
  const goal = st.goal || 0;
  $('goal').style.display = goal > 0 ? '' : 'none';
  $('gFill').style.width = goal ? Math.min(100, st.floated / goal * 100) + '%' : '0';
  $('gTxt').textContent = `🪷 กระทงลอยแล้ว ${st.floated.toLocaleString()} / ${goal.toLocaleString()}`;
}
const toastBox = $('toasts');
function toast(html, avatar, ms = 4200) {
  while (toastBox.children.length >= 3) toastBox.firstChild.remove();
  const d = document.createElement('div'); d.className = 'toast';
  d.innerHTML = (avatar ? `<img src="${esc(avatar)}" referrerpolicy="no-referrer" onerror="this.remove()">` : '') + `<span>${html}</span>`;
  toastBox.append(d);
  setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 400); }, ms);
}

// =====================================================================
// รับเหตุการณ์จาก server
// =====================================================================
function spawnFor(user, tier, count, wish) {
  const p = personAct(user, 'float');
  const baseX = p ? SLOTS[p.slot].x : rand(200, 880);
  const n = Math.max(1, count | 0);
  for (let i = 0; i < n; i++) {
    const u = clamp((baseX - W / 2) / 760 + (n > 1 ? rand(-.35, .35) : rand(-.04, .04)), -.85, .85);
    queueKrathong(tier, user.name, u, i === 0 ? wish : '', 450 + i * 260);
  }
}

function onMsg(m) {
  switch (m.type) {
    case 'config': config = m.config; renderConfig(); if (!config.showCharacters) people.clear(); break;
    case 'state': renderState(m.state); break;
    case 'reset': krathongs.length = 0; spawnQueue.length = 0; people.clear(); $('wishList').innerHTML = ''; break;
    case 'join': if (addPerson(m.user)) sfx.join(); break;
    case 'chat': {
      const p = people.get(String(m.user.id || m.user.name));
      if (p && m.comment && m.comment.length <= 18) { p.bub = m.comment; p.bubT = 0; }
      break;
    }
    case 'gender': { const p = addPerson(m.user); if (p) { p.gender = m.gender; p.born = performance.now(); } break; }
    case 'wai': personAct(m.user, 'wai', '🙏 สวัสดี'); break;
    case 'float':
      spawnFor(m.user, m.tier, m.count, m.wish);
      break;
    case 'gift': {
      const g = m.gift;
      personAct(m.user, 'gift', `🎁 x${g.count}`);
      sfx.chime();
      toast(`<b>${esc(m.user.name)}</b> ส่ง ${esc(g.name)} x${g.count} → ${esc(m.tierName)}`, m.user.avatar);
      break;
    }
    case 'follow': personAct(m.user, 'follow', '💖 ติดตามแล้ว'); toast(`<b>${esc(m.user.name)}</b> กดติดตาม 💖 ขอบคุณค่ะ`, m.user.avatar, 3000); break;
    case 'share': personAct(m.user, 'follow', '🔗 แชร์แล้ว'); toast(`<b>${esc(m.user.name)}</b> แชร์ไลฟ์ 🔗 ขอบคุณค่ะ`, m.user.avatar, 3000); break;
    case 'like': addHearts(Math.ceil(m.count / 5)); break;
    case 'fx':
      if (m.fx === 'fireworks') { const n = clamp(m.power || 3, 1, 12); for (let i = 0; i < n; i++) setTimeout(() => firework(), i * 380); }
      if (m.fx === 'lanterns') lanternWave(m.n || 20);
      if (m.fx === 'goal') {
        for (let i = 0; i < 14; i++) setTimeout(() => firework(), i * 300);
        lanternWave(30);
        $('goalBanner').style.opacity = 1; setTimeout(() => $('goalBanner').style.opacity = 0, 5000);
      }
      break;
  }
}

function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => { $('conn').style.color = '#7dff9a'; };
  ws.onmessage = e => { try { onMsg(JSON.parse(e.data)); } catch (err) { console.error(err); } };
  ws.onclose = () => { $('conn').style.color = '#ff6b6b'; setTimeout(connect, 2000); };
}

// =====================================================================
// Main loop
// =====================================================================
let lastT = performance.now();
function frame(now) {
  const dt = Math.min(.05, (now - lastT) / 1000); lastT = now;
  const t = now / 1000;
  if (!BG) { BG = buildBackground(); PIER = buildPier(); }
  ctx.drawImage(BG, 0, 0);
  // ดาวกระพริบ
  for (const s of stars) { ctx.globalAlpha = .45 + .55 * Math.abs(Math.sin(t * s.s * .6 + s.p)); ctx.fillStyle = '#fff'; ctx.fillRect(s.x, s.y, s.r, s.r); }
  ctx.globalAlpha = 1;
  // แสงจันทร์บนน้ำ + ระลอกคลื่น
  for (let i = 0; i < 46; i++) {
    const y = HORIZON + 14 + Math.pow(i / 46, 1.6) * (NEAR_Y - HORIZON - 20);
    const k = (y - HORIZON) / (NEAR_Y - HORIZON);
    const w = (30 + k * 160) * (0.6 + 0.4 * Math.sin(t * 1.3 + i * 1.7));
    ctx.fillStyle = `rgba(255,236,180,${.10 + .18 * (1 - k)})`;
    ctx.fillRect(540 - w / 2 + Math.sin(t + i) * 10 * k, y, w, 2 + k * 3);
    ctx.fillStyle = `rgba(255,240,200,${.08})`;
    ctx.fillRect(MOON.x - w * .3, y, w * .6, 1.5 + k * 2);
  }
  ctx.strokeStyle = 'rgba(140,170,255,.07)'; ctx.lineWidth = 2;
  for (let i = 0; i < 12; i++) {
    const y = HORIZON + 40 + ((i * 47 + t * 18) % (NEAR_Y - HORIZON - 40));
    ctx.beginPath(); ctx.moveTo(0, y);
    for (let x = 0; x <= W; x += 60) ctx.lineTo(x, y + Math.sin(x / 90 + t + i) * 3);
    ctx.stroke();
  }
  processQueue(now);
  for (let i = krathongs.length - 1; i >= 0; i--) if (!krathongs[i].update(dt)) krathongs.splice(i, 1);
  krathongs.sort((a, b) => b.z - a.z);
  for (const k of krathongs) k.draw(ctx, t);
  updateFx(ctx, dt, t);
  // ท่าน้ำ + โคมไฟ
  ctx.drawImage(PIER, 0, NEAR_Y - 40);
  for (const lx of [55, W - 55]) {
    ctx.fillStyle = '#3b2414'; ctx.fillRect(lx - 6, 1560, 12, 200);
    const fl = .85 + Math.sin(t * 9 + lx) * .06;
    const lg = ctx.createRadialGradient(lx, 1555, 5, lx, 1555, 120);
    lg.addColorStop(0, `rgba(255,190,90,${.6 * fl})`); lg.addColorStop(1, 'rgba(255,150,50,0)');
    ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(lx, 1555, 120, 0, 7); ctx.fill();
    ctx.fillStyle = '#5a3416'; ctx.fillRect(lx - 24, 1520, 48, 8); ctx.fillRect(lx - 22, 1582, 44, 8);
    ctx.fillStyle = `rgba(255,214,130,${fl})`; ctx.fillRect(lx - 18, 1528, 36, 54);
    ctx.strokeStyle = '#5a3416'; ctx.lineWidth = 3; ctx.strokeRect(lx - 18, 1528, 36, 54);
    ctx.beginPath(); ctx.moveTo(lx, 1528); ctx.lineTo(lx, 1582); ctx.stroke();
  }
  // คน (เรียงหลังไปหน้า)
  const ps = [...people.values()].sort((a, b) => SLOTS[a.slot].y - SLOTS[b.slot].y);
  for (const p of ps) drawPerson(ctx, p, t, dt);
  requestAnimationFrame(frame);
}

document.fonts?.ready.then(() => { BG = null; });
connect();
requestAnimationFrame(frame);
})();
