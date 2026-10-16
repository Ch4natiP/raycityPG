import { xpToNext, MAX_LEVEL } from './progress.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(city) {
    this.city = city;
    this.mini = $('minimap');
    this.mg = this.mini.getContext('2d');
    this.toastTimer = 0;
    this.payTimer = 0;
    this.lastPlace = '';
    this.buildMapImage();
  }

  // The whole city drawn once; the minimap shows a window of it around the player.
  // The whole city drawn once; the minimap shows a window of it around the player.
  // Works for the grid city (lots on a road-coloured ground) and for imported real streets.
  buildMapImage() {
    const S = 0.6;
    const bd = this.city.bounds;
    const span = Math.max(bd.x1 - bd.x0, bd.z1 - bd.z0);
    const size = Math.ceil(span * S);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const X = (x) => (x - bd.x0) * S;
    const Z = (z) => (z - bd.z0) * S;
    const grid = this.city.style === 'grid';
    g.fillStyle = grid ? '#56595e' : '#e4ddd0';
    g.fillRect(0, 0, size, size);
    for (const poly of this.city.mapPolys || []) {
      g.fillStyle = poly.color;
      g.beginPath();
      poly.pts.forEach((p, k) => (k ? g.lineTo(X(p.x), Z(p.z)) : g.moveTo(X(p.x), Z(p.z))));
      g.closePath();
      g.fill();
    }
    if (!grid) {
      g.strokeStyle = '#6b6e74';
      g.lineCap = 'round';
      g.lineJoin = 'round';
      for (const e of [...this.city.net.edges].sort((a, b) => a.width - b.width)) {
        g.lineWidth = Math.max(2, e.width * S);
        g.strokeStyle = e.main ? '#5d6066' : '#7a7d83';
        g.beginPath();
        e.pts.forEach((p, k) => (k ? g.lineTo(X(p.x), Z(p.z)) : g.moveTo(X(p.x), Z(p.z))));
        g.stroke();
      }
    }
    const colors = { shop: '#d8d0c0', edge: '#cfc7b6', tower: '#b9c4cf', temple: '#e8a24a', park: '#7cb65f', market: '#e07a5f', plaza: '#d6cdb5', river: '#c9bea6' };
    for (const l of this.city.lots) {
      g.fillStyle = colors[l.type] || '#d8d0c0';
      g.fillRect(X(l.x0), Z(l.z0), (l.x1 - l.x0) * S, (l.z1 - l.z0) * S);
    }
    g.fillStyle = '#ff7a00';
    for (const s of this.city.stands) g.fillRect(X(s.sx) - 4, Z(s.sz) - 4, 8, 8);
    this.mapImg = c;
    this.mapS = S;
    this.mapX0 = bd.x0;
    this.mapZ0 = bd.z0;
    this.mapSpan = span;
  }

  drawMinimap(player, jobs) {
    const g = this.mg;
    const W = this.mini.width;
    const view = 300; // metres across
    const k = W / view;
    const S = this.mapS;
    g.save();
    g.clearRect(0, 0, W, W);
    g.beginPath();
    g.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#56595e';
    g.fillRect(0, 0, W, W);
    g.drawImage(this.mapImg, (player.x - view / 2 - this.mapX0) * S, (player.z - view / 2 - this.mapZ0) * S, view * S, view * S, 0, 0, W, W);
    const tx = (x) => (x - player.x) * k + W / 2;
    const tz = (z) => (z - player.z) * k + W / 2;
    if (jobs.active) {
      const pts = jobs.active.route.pts;
      g.strokeStyle = '#ffc400';
      g.lineWidth = 4;
      g.lineJoin = 'round';
      g.beginPath();
      pts.forEach(([x, z], i) => (i ? g.lineTo(tx(x), tz(z)) : g.moveTo(tx(x), tz(z))));
      g.stroke();
    } else {
      for (const w of jobs.waiting) {
        g.fillStyle = w.customer ? '#ff4fa3' : '#2ecc71';
        g.strokeStyle = '#fff';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(tx(w.poi.x), tz(w.poi.z), 5, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
    }
    if (this.battles) {
      for (const r of this.battles.rivals) {
        g.fillStyle = '#9b59b6'; g.strokeStyle = '#fff'; g.lineWidth = 2;
        g.beginPath(); g.arc(tx(r.x), tz(r.z), 5, 0, Math.PI * 2); g.fill(); g.stroke();
      }
    }
    g.restore();
    // destination / nearest passenger pinned to the rim when off-screen
    const pin = (x, z, color) => {
      let dx = (x - player.x) * k;
      let dz = (z - player.z) * k;
      const d = Math.hypot(dx, dz);
      const R = W / 2 - 8;
      if (d > R) { dx = (dx / d) * R; dz = (dz / d) * R; }
      g.fillStyle = color;
      g.strokeStyle = '#000';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(W / 2 + dx, W / 2 + dz, 7, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    };
    if (this.battles?.active) pin(this.battles.active.fin.x, this.battles.active.fin.z, '#ff2a2a');
    else if (jobs.active) pin(jobs.active.dest.x, jobs.active.dest.z, '#ffc400');
    else {
      let best = null;
      for (const w of jobs.waiting) { const d = Math.hypot(w.poi.x - player.x, w.poi.z - player.z); if (!best || d < best.d) best = { d, w }; }
      if (best) pin(best.w.poi.x, best.w.poi.z, '#2ecc71');
    }
    // player arrow
    g.save();
    g.translate(W / 2, W / 2);
    g.rotate(-player.h + Math.PI);
    g.fillStyle = '#ff3b30';
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -10); g.lineTo(7, 8); g.lineTo(0, 4); g.lineTo(-7, 8); g.closePath();
    g.fill();
    g.stroke();
    g.restore();
    g.fillStyle = '#fff';
    g.font = 'bold 13px sans-serif';
    g.textAlign = 'center';
    g.fillText('N', W / 2, 14);
  }

  frame(dt, player, jobs, boost) {
    $('speed').textContent = Math.round(Math.abs(player.speed) * 3.6);
    $('gear').textContent = player.speed < -0.3 ? 'R' : player.gear;
    $('boost-fill').style.width = `${Math.round(boost * 100)}%`;
    const place = this.city.placeName(player.x, player.z);
    if (place !== this.lastPlace) { $('place').textContent = place; this.lastPlace = place; }
    $('district').textContent = player.district;
    this.drawMinimap(player, jobs);
    if (this.toastTimer > 0) { this.toastTimer -= dt; if (this.toastTimer <= 0) $('toast').classList.remove('show'); }
    if (this.payTimer > 0) { this.payTimer -= dt; if (this.payTimer <= 0) $('payout').classList.remove('show'); }
  }

  clock(t) { if (t !== this.lastClock) { $('clock').textContent = `🕐 ${t} น.`; this.lastClock = t; } }

  stats(save) {
    $('money').textContent = `฿${save.money.toLocaleString('th-TH')}`;
    $('trips').textContent = save.trips;
    const r = save.ratings.length ? save.ratings.reduce((a, b) => a + b, 0) / save.ratings.length : 5;
    $('rating').textContent = r.toFixed(1);
    $('lvl-badge').textContent = `Lv.${save.level}`;
    $('xp-fill').style.width = save.level >= MAX_LEVEL ? '100%' : `${Math.round((save.xp / xpToNext(save.level)) * 100)}%`;
  }

  xpGain(xp) {
    const el = $('xp-pop');
    el.textContent = `+${xp} XP`;
    el.classList.remove('show');
    void el.offsetWidth; // restart the transition
    el.classList.add('show');
    clearTimeout(this.xpT);
    this.xpT = setTimeout(() => el.classList.remove('show'), 1600);
  }

  levelUp({ level, bonus, unlocks }) {
    const el = $('levelup');
    el.innerHTML = `<div class="small">เลเวลอัป!</div><div class="big">Lv.${level}</div><div class="small">โบนัส ฿${bonus.toLocaleString('th-TH')}</div>` +
      unlocks.map((u) => `<div class="small">${u.icon} ${u.text}${u.soon ? ' (เร็วๆ นี้)' : ''}</div>`).join('');
    el.classList.add('show');
    clearTimeout(this.lvT);
    this.lvT = setTimeout(() => el.classList.remove('show'), 4000);
  }

  setJob(html) {
    const el = $('job');
    if (html === null) {
      el.innerHTML = '🙋 หาผู้โดยสาร: ขับไปหาจุด<b style="color:#2ecc71">สีเขียว</b> แล้วจอดใกล้ๆ';
      el.classList.add('idle');
    } else {
      el.innerHTML = html;
      el.classList.remove('idle');
    }
  }

  toast(text, who) {
    const el = $('toast');
    el.innerHTML = `<span class="who">${who}</span>${text}`;
    el.classList.add('show');
    this.toastTimer = 3.5;
  }

  payout({ fare, tip, stars, dest }) {
    const el = $('payout');
    el.innerHTML = `<div class="ttl">ส่งถึง ${dest}</div><div>ค่าโดยสาร <b>฿${fare}</b></div>` +
      `<div>ทิป <b>฿${tip}</b></div><div class="stars">${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}</div>`;
    el.classList.add('show');
    this.payTimer = 3.5;
  }

  showGarageHint(show) { $('garage-hint').classList.toggle('show', show); }

  battleHint(show) {
    $('battle-hint').classList.toggle('show', show);
    $('touch-battle').classList.toggle('show', show);
  }

  status(text) { if (text !== this.lastStatus) { $('status').textContent = text; this.lastStatus = text; } }

  // parts below 25 %: blinking tags, plus a toast the first time each one gets there
  warnings(list) {
    this.warned ??= new Set();
    const ids = new Set(list.map((p) => p.id));
    for (const p of list) if (!this.warned.has(p.id)) this.toast(`${p.icon} ${p.name}เหลือ ${Math.round(p.cond * 100)}% ${p.tip} · ซ่อมได้ที่อู่ซุ้มวิน`, '🔧 รถต้องซ่อม');
    this.warned = ids;
    $('warn').innerHTML = list.slice(0, 4).map((p) => `<span>${p.icon} ${p.name} ${Math.round(p.cond * 100)}%</span>`).join('');
  }

  countdown(t) {
    const el = $('countdown');
    el.textContent = t;
    clearTimeout(this.cdT);
    this.cdT = setTimeout(() => { el.textContent = ''; }, t.length > 2 ? 1600 : 900);
  }

  battle(a) {
    const box = $('battle');
    box.hidden = !a;
    $('job').style.visibility = a ? 'hidden' : '';
    if (!a) return;
    $('bt-title').textContent = `⚔️ VS ${a.r.name} → ${a.fin.name}`;
    $('bt-rname').textContent = a.r.name;
    $('bt-me').style.width = `${a.me}%`;
    $('bt-them').style.width = `${a.r.gauge}%`;
    $('bt-dist').textContent = a.countdown > 0 ? 'เตรียมตัว...' : `${Math.round(a.mine ?? 0)} ม. ${a.mine < a.theirs ? '🥇 นำอยู่' : '🥈 ตามหลัง'}`;
  }

}
