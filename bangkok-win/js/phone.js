import { BIKES } from './config.js';
import { xpToNext, MAX_LEVEL, UNLOCKS } from './progress.js';
import { CUSTOMERS, RARITY, bondOf } from './customers.js';
import { RIVALS, battleReward } from './battle.js';
import { PARTS, bikeState } from './garage.js';

// The rider's phone: a home screen with apps. Opening it pauses the game.
// New apps are one entry in APPS plus a render function.
const $ = (id) => document.getElementById(id);
const baht = (n) => `฿${Math.round(n).toLocaleString('th-TH')}`;
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const APPS = [
  { id: 'missions', icon: '🎯', label: 'ภารกิจ', color: '#e74c3c' },
  { id: 'customers', icon: '📒', label: 'ลูกค้า', color: '#ff4fa3' },
  { id: 'battle', icon: '⚔️', label: 'Battle', color: '#111827' },
  { id: 'profile', icon: '👤', label: 'โปรไฟล์', color: '#ff7a00' },
  { id: 'map', icon: '🗺️', label: 'แผนที่', color: '#2e86de' },
  { id: 'history', icon: '🧾', label: 'ประวัติงาน', color: '#27ae60' },
  { id: 'bikes', icon: '🛵', label: 'รถของฉัน', color: '#c0392b' },
  { id: 'unlocks', icon: '🏆', label: 'ปลดล็อก', color: '#d4a017' },
  { id: 'settings', icon: '⚙️', label: 'ตั้งค่า', color: '#5d6d7e' },
];

export class Phone {
  constructor(game) {
    this.g = game; // { save, hud, city, jobs, player, atmo, sfx, onQuality, onReset }
    this.el = $('phone');
    this.screen = $('ph-screen');
    this.stack = [];
    $('ph-close').onclick = () => this.close();
    $('ph-home').onclick = () => this.show('home', true);
    $('ph-back').onclick = () => this.back();
    $('phone-btn').onclick = () => this.toggle();
    this.el.addEventListener('pointerdown', (e) => { if (e.target === this.el) this.close(); });
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyP' && !e.repeat && this.g.started()) { e.preventDefault(); this.toggle(); }
      else if (e.code === 'Escape' && this.isOpen) this.close();
    });
  }

  get isOpen() { return !this.el.hidden; }
  toggle() { if (this.isOpen) this.close(); else this.open(); }

  open() {
    this.el.hidden = false;
    for (const id of ['payout', 'toast', 'levelup']) $(id).classList.remove('show'); // their timers stop while paused
    this.show('home', true);
    $('ph-close').focus();
  }

  close() { this.el.hidden = true; }

  back() {
    this.stack.pop();
    this.show(this.stack.pop() || 'home');
  }

  show(id, reset = false) {
    if (reset) this.stack = [];
    this.stack.push(id);
    $('ph-clock').textContent = this.g.atmo.clock;
    this.screen.className = `ph-screen${id === 'home' ? '' : ' app'}`;
    this.screen.scrollTop = 0;
    this[`app_${id}`]();
  }

  // ---------- apps ----------
  app_home() {
    const { save, jobs } = this.g;
    const a = jobs.active;
    this.screen.innerHTML = `
      <div class="ph-card"><div class="s">เงินในกระเป๋า</div><div class="m">${baht(save.money)}</div>
        <div class="s">Lv.${save.level} · ${save.trips} เที่ยว · ${this.g.atmo.clock} น.</div>
        <div class="s">${this.g.weather.label}${this.g.rush() ? ' · 🚦 ช่วงเร่งด่วน' : ''}</div></div>
      <div class="ph-card" style="margin-top:10px"><div class="s">${a ? 'งานตอนนี้' : 'สถานะ'}</div>
        <div style="font-weight:700">${a ? `${esc(a.name)} → ${esc(a.dest.name)}` : `ว่าง · มีคนรอเรียกรถ ${jobs.waiting.length} คน`}</div></div>
      <div class="ph-apps">${APPS.map((p) => `<button class="ph-app" data-app="${p.id}"><span class="ic" style="background:${p.color}">${p.icon}</span><span class="lb">${p.label}</span></button>`).join('')}</div>`;
    this.screen.querySelectorAll('[data-app]').forEach((b) => { b.onclick = () => this.show(b.dataset.app); });
  }

  app_profile() {
    const { save } = this.g;
    const need = xpToNext(save.level);
    const pct = save.level >= MAX_LEVEL ? 100 : Math.round((save.xp / need) * 100);
    const r = save.ratings.length ? save.ratings.reduce((x, y) => x + y, 0) / save.ratings.length : 5;
    const bike = BIKES.find((b) => b.id === save.bike) || BIKES[0];
    this.screen.innerHTML = `
      <div class="ph-title">โปรไฟล์</div>
      <div class="ph-hero"><div class="ph-avatar">99</div><div class="grow" style="flex:1;min-width:0">
        <div style="font-weight:800">วินเบอร์ 99</div><div style="font-size:12px;color:#6b6f78">วินมอเตอร์ไซค์รับจ้าง · ${esc(bike.name)}</div>
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-top:6px"><b>Lv.${save.level}</b><span>${save.level >= MAX_LEVEL ? 'เลเวลสูงสุด' : `${save.xp} / ${need} XP`}</span></div>
        <div class="ph-xp"><div style="width:${pct}%"></div></div></div></div>
      <div class="ph-stats">
        <div class="ph-stat"><div class="k">เที่ยวที่ส่ง</div><div class="n">${save.trips}</div></div>
        <div class="ph-stat"><div class="k">คะแนนเฉลี่ย</div><div class="n">⭐ ${r.toFixed(1)}</div></div>
        <div class="ph-stat"><div class="k">รายได้รวม</div><div class="n">${baht(save.earned)}</div></div>
        <div class="ph-stat"><div class="k">ระยะทางที่ขับ</div><div class="n">${(save.distance / 1000).toFixed(1)} กม.</div></div>
      </div>
      <p style="font-size:12px;color:#6b6f78;margin-top:12px">ส่งผู้โดยสารให้ถึงไวๆ ไม่ชน ได้ดาวเยอะ = ได้ XP เยอะ ส่งที่สถานที่สำคัญได้ XP เพิ่ม</p>`;
  }

  app_map() {
    const { hud, city, jobs, player } = this.g;
    this.screen.innerHTML = `<div class="ph-title">แผนที่กรุงเทพฯ</div><canvas class="ph-map" id="ph-map" width="640" height="640"></canvas>
      <div class="ph-legend"><span><i style="background:#ff3b30"></i>เรา</span><span><i style="background:#2ecc71"></i>คนรอเรียกรถ</span>
        <span><i style="background:#ffc400"></i>จุดส่ง</span><span><i style="background:#ff7a00"></i>ซุ้มวิน</span>
        <span><i style="background:#ff4fa3"></i>ลูกค้าในสมุด</span><span><i style="background:#9b59b6"></i>คู่แข่ง Battle</span></div>
      ${city.attribution ? `<p style="font-size:11px;color:#6b6f78;margin-top:6px">แผนที่ ${city.attribution}</p>` : ''}`;
    const c = $('ph-map');
    const g = c.getContext('2d');
    const W = c.width;
    const k = W / hud.mapSpan;
    const tx = (x) => (x - hud.mapX0) * k;
    const tz = (z) => (z - hud.mapZ0) * k;
    g.drawImage(hud.mapImg, 0, 0, W, W);
    // district names
    g.font = 'bold 30px "Noto Sans Thai", Tahoma, sans-serif';
    g.textAlign = 'center';
    for (const d of city.districtLabels) {
      g.fillStyle = 'rgba(20,20,25,0.28)';
      g.fillText(d.name, tx(d.x), tz(d.z));
    }
    // landmarks
    g.font = 'bold 19px "Noto Sans Thai", Tahoma, sans-serif';
    for (const p of city.pois.filter((q) => q.landmark && !q.name.startsWith('วิน'))) {
      const name = p.name.replace('BTS ', '🚝 ');
      g.fillStyle = '#1b1d22';
      g.beginPath(); g.arc(tx(p.x), tz(p.z), 5, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.92)';
      const w = g.measureText(name).width + 10;
      g.fillRect(tx(p.x) - w / 2, tz(p.z) - 30, w, 24);
      g.fillStyle = '#1b1d22';
      g.fillText(name, tx(p.x), tz(p.z) - 12);
    }
    const dot = (x, z, color, r = 9) => { g.fillStyle = color; g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.arc(tx(x), tz(z), r, 0, Math.PI * 2); g.fill(); g.stroke(); };
    if (jobs.active) {
      g.strokeStyle = '#ffc400'; g.lineWidth = 7; g.beginPath();
      jobs.active.route.pts.forEach(([x, z], i) => (i ? g.lineTo(tx(x), tz(z)) : g.moveTo(tx(x), tz(z))));
      g.stroke();
      dot(jobs.active.dest.x, jobs.active.dest.z, '#ffc400', 13);
    } else for (const w of jobs.waiting) dot(w.poi.x, w.poi.z, w.customer ? '#ff4fa3' : '#2ecc71');
    for (const r of this.g.battles.rivals) dot(r.x, r.z, '#9b59b6', 8);
    if (this.g.battles.active) dot(this.g.battles.active.fin.x, this.g.battles.active.fin.z, '#ff2a2a', 13);
    // player arrow
    g.save();
    g.translate(tx(player.x), tz(player.z));
    g.rotate(-player.h + Math.PI);
    g.scale(1.8, 1.8);
    g.fillStyle = '#ff3b30'; g.strokeStyle = '#fff'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, -12); g.lineTo(8, 9); g.lineTo(0, 4); g.lineTo(-8, 9); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }

  app_history() {
    const h = this.g.save.history;
    const today = h.reduce((s, t) => s + t.fare + t.tip, 0);
    this.screen.innerHTML = `<div class="ph-title">ประวัติงาน</div>
      ${h.length ? `<div class="ph-row" style="margin-bottom:8px"><div class="grow"><div class="d">${h.length} เที่ยวล่าสุด</div><div class="t">ค่าโดยสาร + ทิป รวม ${baht(today)}</div></div></div>
      <div class="ph-list">${h.map((t) => `<div class="ph-row"><div class="grow"><div class="t">${esc(t.to)}</div>
        <div class="d">${esc(t.name)} · จาก ${esc(t.from)}${t.clock ? ` · ${t.clock} น.` : ''}</div>
        <div class="d">${'★'.repeat(t.stars)}${'☆'.repeat(5 - t.stars)} · +${t.xp} XP</div></div>
        <div class="v">${baht(t.fare)}${t.tip ? `<div class="d" style="text-align:right">ทิป ${baht(t.tip)}</div>` : ''}</div></div>`).join('')}</div>`
    : '<div class="ph-empty">ยังไม่มีงาน ไปรับผู้โดยสารคนแรกกันเลย 🛵</div>'}`;
  }

  app_bikes() {
    const { save } = this.g;
    this.screen.innerHTML = `<div class="ph-title">รถของฉัน</div><div class="ph-list">${BIKES.map((b) => {
      const owned = save.owned.includes(b.id);
      const cur = save.bike === b.id;
      const chip = cur ? '<span class="ph-chip cur">ใช้อยู่</span>' : owned ? '<span class="ph-chip ok">มีแล้ว</span>' : save.level < b.level ? `<span class="ph-chip">🔒 Lv.${b.level}</span>` : `<span class="ph-chip">${baht(b.price)}</span>`;
      return `<div class="ph-row${!owned && save.level < b.level ? ' locked' : ''}"><span class="em" style="color:#${b.color.toString(16).padStart(6, '0')}">●</span>
        <div class="grow"><div class="t">${esc(b.name)}</div><div class="d">สูงสุด ${Math.round(b.top * 3.6)} กม./ชม. · อัตราเร่ง ${b.accel}${owned ? ` · สภาพ ${Math.round(PARTS.reduce((t, p) => t + bikeState(save, b.id).parts[p.id], 0) / PARTS.length * 100)}%` : ''}</div></div>${chip}</div>`;
    }).join('')}</div><p style="font-size:12px;color:#6b6f78;margin-top:12px">ซื้อ ซ่อม แต่ง หรือเปลี่ยนรถได้ที่อู่ซุ้มวิน (จอดใกล้ซุ้มแล้วกด G)</p>`;
  }

  app_unlocks() {
    const { save } = this.g;
    this.screen.innerHTML = `<div class="ph-title">ปลดล็อก</div><div class="ph-list">${UNLOCKS.map((u) => {
      const got = save.level >= u.level && !u.soon;
      const chip = u.soon ? '<span class="ph-chip soon">เร็วๆ นี้</span>' : got ? '<span class="ph-chip ok">✓ ได้แล้ว</span>' : `<span class="ph-chip">Lv.${u.level}</span>`;
      return `<div class="ph-row${got ? '' : ' locked'}"><span class="em">${u.icon}</span><div class="grow"><div class="t">${esc(u.text)}</div><div class="d">เลเวล ${u.level}</div></div>${chip}</div>`;
    }).join('')}</div><p style="font-size:12px;color:#6b6f78;margin-top:12px">ทุกครั้งที่เลเวลอัป ได้โบนัสเงิน 50 บาท × เลเวลใหม่</p>`;
  }

  app_missions() {
    const ms = this.g.missions.list;
    this.screen.innerHTML = `<div class="ph-title">ภารกิจวันนี้</div><div class="ph-list">${ms.map((m) => {
      const pct = Math.round((m.progress / m.target) * 100);
      const prog = m.id === 'km' ? `${m.progress.toFixed(1)} / ${m.target}` : m.id === 'earn' ? `${baht(m.progress)} / ${baht(m.target)}` : `${m.progress} / ${m.target}`;
      return `<div class="ph-row${m.done ? '' : ''}"><span class="em">${m.done ? '✅' : '🎯'}</span><div class="grow"><div class="t">${esc(m.text)}</div>
        <div class="ph-xp"><div style="width:${pct}%"></div></div><div class="d">${prog} · รางวัล ${baht(m.money)} + ${m.xp} XP</div></div></div>`;
    }).join('')}</div><p style="font-size:12px;color:#6b6f78;margin-top:12px">ภารกิจใหม่ทุกเที่ยงคืน (เวลาในเกม) ทำเสร็จได้รางวัลทันที</p>`;
  }

  app_customers() {
    const book = this.g.save.customers || {};
    const met = CUSTOMERS.filter((c) => book[c.id]);
    this.screen.innerHTML = `<div class="ph-title">สมุดลูกค้า</div><div class="ph-card" style="background:#fff;color:#1b1d22;backdrop-filter:none">
      <b>พบแล้ว ${met.length} / ${CUSTOMERS.length} คน</b><div class="ph-xp"><div style="width:${Math.round(met.length / CUSTOMERS.length * 100)}%"></div></div>
      <div style="font-size:12px;color:#6b6f78">ส่งดีๆ ได้หัวใจ 💖 · 3 ดวง = ขาประจำ (โทรเรียกเรา, ค่าโดยสาร +20%) · 6 = เพื่อนสนิท (+40%) · 10 = VIP (+60%)</div></div>
      <div class="ph-list" style="margin-top:10px">${CUSTOMERS.map((c) => {
        const e = book[c.id];
        const rar = RARITY[c.rarity];
        if (!e) return `<div class="ph-row locked"><span class="em">❔</span><div class="grow"><div class="t">???</div><div class="d">ลูกค้า${rar.label} · แถว${esc(c.home)}${this.g.save.level < rar.level ? ` · เจอได้ตั้งแต่ Lv.${rar.level}` : ''}</div></div><span class="ph-chip" style="color:${rar.color}">${rar.label}</span></div>`;
        const b = bondOf(e.hearts);
        return `<div class="ph-row"><span class="em">${c.emoji}</span><div class="grow"><div class="t">${esc(c.name)} <span class="d">· ${esc(c.job)}</span></div>
          <div class="d">${'💖'.repeat(Math.min(5, Math.ceil(e.hearts / 2)))}${'🤍'.repeat(5 - Math.min(5, Math.ceil(e.hearts / 2)))} ${b.label} · ${e.rides} เที่ยว · ทิปสูงสุด ${baht(e.bestTip)}</div>
          <div class="d">ชอบ: ${esc(c.likes)}</div></div><span class="ph-chip" style="color:${rar.color}">${rar.label}</span></div>`;
      }).join('')}</div>`;
  }

  app_battle() {
    const { save, battles } = this.g;
    const rec = save.battle;
    this.screen.innerHTML = `<div class="ph-title">Battle</div><div class="ph-card" style="background:#111827;backdrop-filter:none">
      <div class="s">สถิติ</div><div class="m">${rec.wins}W · ${rec.losses}L</div>
      <div class="s">ขับเข้าไปใกล้วินคู่แข่ง (ป้าย ⚔️ เหนือหัว) แล้วกด B · ใครตามหลัง เกจลดเรื่อยๆ ถึงเส้นชัยก่อนหรือเกจอีกฝ่ายหมดก่อน = ชนะ</div></div>
      <div class="ph-list" style="margin-top:10px">${RIVALS.map((r) => {
        const st = rec.rivals[r.id] || { w: 0, l: 0 };
        const live = battles.rivals.find((x) => x.id === r.id);
        const d = Math.hypot(live.x - this.g.player.x, live.z - this.g.player.z);
        const rw = battleReward(r, st.w === 0);
        return `<div class="ph-row"><span class="em">🏍️</span><div class="grow"><div class="t">${esc(r.name)} <span class="ph-chip">Lv.${r.level}</span></div>
          <div class="d">"${esc(r.line)}" · ห่าง ${d > 1000 ? (d / 1000).toFixed(1) + ' กม.' : Math.round(d) + ' ม.'}</div>
          <div class="d">ชนะ ${st.w} แพ้ ${st.l} · รางวัล ${baht(rw.money)} + ${rw.xp} XP${st.w === 0 ? ' (ชนะครั้งแรก x2)' : ''}</div></div></div>`;
      }).join('')}</div><p style="font-size:12px;color:#6b6f78;margin-top:12px">คู่แข่งเป็นจุดสีม่วงบนแผนที่</p>`;
  }

  app_settings() {
    const { save, sfx } = this.g;
    const q = save.settings.quality;
    this.screen.innerHTML = `<div class="ph-title">ตั้งค่า</div><div class="ph-list">
      <div class="ph-row"><div class="grow"><div class="t">เสียง</div></div><div class="ph-seg"><button data-snd="on" class="${sfx.muted ? '' : 'on'}">เปิด</button><button data-snd="off" class="${sfx.muted ? 'on' : ''}">ปิด</button></div></div>
      <div class="ph-row"><div class="grow"><div class="t">คุณภาพภาพ</div><div class="d">ต่ำ = ปิดเงาและแสงเรือง ลื่นขึ้น</div></div><div class="ph-seg"><button data-q="high" class="${q === 'high' ? 'on' : ''}">สูง</button><button data-q="low" class="${q === 'low' ? 'on' : ''}">ต่ำ</button></div></div>
      <div class="ph-row"><div class="grow"><div class="t">สภาพอากาศ</div><div class="d">${this.g.weather.label}</div></div><div class="ph-seg"><button data-wx="auto" class="${this.g.weather.mode === 'auto' ? 'on' : ''}">อัตโนมัติ</button><button data-wx="clear" class="${this.g.weather.mode === 'clear' ? 'on' : ''}">แดด</button><button data-wx="rain" class="${this.g.weather.mode === 'rain' ? 'on' : ''}">ฝน</button></div></div>
      ${this.g.maps ? `<div class="ph-row"><div class="grow"><div class="t">แผนที่</div><div class="d">เปลี่ยนแล้วเกมจะโหลดใหม่ (เงิน/เลเวลอยู่ครบ)</div></div><div class="ph-seg"><button data-map="real" class="${save.settings.map !== 'grid' ? 'on' : ''}">กทม. จริง</button><button data-map="grid" class="${save.settings.map === 'grid' ? 'on' : ''}">เมืองจำลอง</button></div></div>` : ''}
      <div class="ph-row"><div class="grow"><div class="t">เวลา ${this.g.atmo.clock} น.</div><div class="d">เลื่อนเวลาไป 1 ชั่วโมง (เหมือนกด T)</div></div><button class="ph-btn ghost" id="ph-skip">+1 ชม.</button></div>
      <div class="ph-row"><div class="grow"><div class="t">เริ่มเกมใหม่</div><div class="d" id="ph-reset-d">ลบเงิน เลเวล และรถทั้งหมด</div></div><button class="ph-btn danger" id="ph-reset">ลบ</button></div>
    </div>`;
    this.screen.querySelectorAll('[data-snd]').forEach((b) => { b.onclick = () => { if ((b.dataset.snd === 'off') !== sfx.muted) sfx.toggle(); this.app_settings(); }; });
    this.screen.querySelectorAll('[data-map]').forEach((b) => { b.onclick = () => { if ((b.dataset.map === 'grid') !== (save.settings.map === 'grid')) this.g.onMap(b.dataset.map); }; });
    this.screen.querySelectorAll('[data-wx]').forEach((b) => { b.onclick = () => { this.g.weather.setMode(b.dataset.wx); this.app_settings(); }; });
    this.screen.querySelectorAll('[data-q]').forEach((b) => { b.onclick = () => { this.g.onQuality(b.dataset.q); this.app_settings(); }; });
    $('ph-skip').onclick = () => { this.g.atmo.skip(1); $('ph-clock').textContent = this.g.atmo.clock; this.app_settings(); };
    const reset = $('ph-reset');
    reset.onclick = () => {
      if (reset.dataset.armed) { this.g.onReset(); return; }
      reset.dataset.armed = '1';
      reset.textContent = 'ยืนยันลบ';
      $('ph-reset-d').textContent = 'กดอีกครั้งเพื่อลบจริง (ย้อนกลับไม่ได้)';
    };
  }
}
