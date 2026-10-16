import { HALF, BIKES } from './config.js';

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
  buildMapImage() {
    const S = 0.6;
    const ext = HALF + 160;
    const size = Math.ceil(ext * 2 * S);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = '#56595e';
    g.fillRect(0, 0, size, size);
    g.fillStyle = '#4c7f95';
    g.fillRect(0, 0, (-HALF - 70 + ext) * S, size);
    const colors = { shop: '#d8d0c0', edge: '#cfc7b6', tower: '#b9c4cf', temple: '#e8a24a', park: '#7cb65f', market: '#e07a5f', plaza: '#d6cdb5', river: '#c9bea6' };
    for (const l of this.city.lots) {
      g.fillStyle = colors[l.type] || '#d8d0c0';
      g.fillRect((l.x0 + ext) * S, (l.z0 + ext) * S, (l.x1 - l.x0) * S, (l.z1 - l.z0) * S);
    }
    g.fillStyle = '#ff7a00';
    for (const s of this.city.stands) g.fillRect((s.sx + ext) * S - 4, (s.sz + ext) * S - 4, 8, 8);
    this.mapImg = c;
    this.mapS = S;
    this.mapExt = ext;
  }

  drawMinimap(player, jobs) {
    const g = this.mg;
    const W = this.mini.width;
    const view = 300; // metres across
    const k = W / view;
    const S = this.mapS;
    const ext = this.mapExt;
    g.save();
    g.clearRect(0, 0, W, W);
    g.beginPath();
    g.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#56595e';
    g.fillRect(0, 0, W, W);
    g.drawImage(this.mapImg, (player.x - view / 2 + ext) * S, (player.z - view / 2 + ext) * S, view * S, view * S, 0, 0, W, W);
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
        g.fillStyle = '#2ecc71';
        g.strokeStyle = '#fff';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(tx(w.poi.x), tz(w.poi.z), 5, 0, Math.PI * 2);
        g.fill();
        g.stroke();
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
    if (jobs.active) pin(jobs.active.dest.x, jobs.active.dest.z, '#ffc400');
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

  stats(save) {
    $('money').textContent = `฿${save.money.toLocaleString('th-TH')}`;
    $('trips').textContent = save.trips;
    const r = save.ratings.length ? save.ratings.reduce((a, b) => a + b, 0) / save.ratings.length : 5;
    $('rating').textContent = r.toFixed(1);
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

  openGarage(save, onPick) {
    const el = $('garage');
    const list = $('garage-list');
    list.innerHTML = '';
    for (const b of BIKES) {
      const owned = save.owned.includes(b.id);
      const cur = save.bike === b.id;
      const row = document.createElement('div');
      row.className = 'bike-row';
      row.innerHTML = `<span class="sw" style="background:#${b.color.toString(16).padStart(6, '0')}"></span>` +
        `<span class="nm">${b.name}<small>ความเร็วสูงสุด ${Math.round(b.top * 3.6)} กม./ชม.</small></span>`;
      const btn = document.createElement('button');
      btn.textContent = cur ? 'ใช้อยู่' : owned ? 'ใช้คันนี้' : `ซื้อ ฿${b.price.toLocaleString('th-TH')}`;
      btn.disabled = cur || (!owned && save.money < b.price);
      btn.onclick = () => { onPick(b); this.openGarage(save, onPick); };
      row.appendChild(btn);
      list.appendChild(row);
    }
    el.classList.add('show');
  }

  closeGarage() { $('garage').classList.remove('show'); }
  get garageOpen() { return $('garage').classList.contains('show'); }
}
