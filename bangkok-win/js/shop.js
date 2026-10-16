import * as THREE from 'three';
import { BIKES } from './config.js';
import { WARDROBE, itemPrice, itemId, outfitOf } from './wardrobe.js';
import { makeCharacter, poseCharacter } from './character.js';
import { PARTS, MODS, PAINTS, RIMS, NEONS, COSMETIC_PRICE, bikeState, effective, partPrice, modPrice } from './garage.js';

// The workshop at a win stand: buy bikes, repair each part, fit upgrades, paint.
const $ = (id) => document.getElementById(id);
const baht = (n) => `฿${Math.round(n).toLocaleString('th-TH')}`;
const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;
const TABS = [['bikes', '🛵 รถ'], ['repair', '🔧 ซ่อม'], ['tune', '⚙️ แต่ง'], ['paint', '🎨 สี'], ['look', '👕 แต่งตัว'], ['spec', '📊 สเปค']];

export class Shop {
  constructor({ save, onChange, onLook, sfx }) {
    this.save = save;
    this.onChange = onChange; // after anything that changes the bike
    this.onLook = onLook;     // after the rider changes clothes
    this.sfx = sfx;
    this.tab = 'repair';
    this.el = $('garage');
    $('garage-close').onclick = () => this.close();
    this.el.addEventListener('pointerdown', (e) => { if (e.target === this.el) this.close(); });
    addEventListener('keydown', (e) => { if (this.isOpen && e.code === 'Escape') { e.preventDefault(); this.close(); } });
  }

  get isOpen() { return this.el.classList.contains('show'); }
  open(tab) { if (tab) this.tab = tab; this.el.classList.add('show'); this.render(); $('garage-close').focus(); }
  close() { this.el.classList.remove('show'); this.preview?.stop(); }

  pay(cost) {
    if (this.save.money < cost) { this.flash('เงินไม่พอ'); return false; }
    this.save.money -= cost;
    this.sfx?.cash();
    return true;
  }

  flash(t) { const m = $('garage-msg'); m.textContent = t; m.classList.add('show'); clearTimeout(this.ft); this.ft = setTimeout(() => m.classList.remove('show'), 1800); }

  done(msg) {
    this.save.write();
    this.onChange();
    if (msg) this.flash(msg);
    this.render();
  }

  render() {
    const save = this.save;
    const bike = BIKES.find((b) => b.id === save.bike) || BIKES[0];
    $('garage-tabs').innerHTML = TABS.map(([id, label]) => `<button data-tab="${id}" class="${this.tab === id ? 'on' : ''}">${label}</button>`).join('');
    $('garage-tabs').querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { this.tab = b.dataset.tab; this.render(); }; });
    $('garage-money').textContent = `${baht(save.money)} · Lv.${save.level} · ${bike.name}`;
    const body = $('garage-list');
    body.innerHTML = this[`tab_${this.tab}`](bike);
    body.querySelectorAll('[data-act]').forEach((b) => { b.onclick = () => this.act(b.dataset.act, b.dataset.arg, bike); });
    if (this.tab === 'look') { (this.preview ??= new Preview()).show(body.querySelector('.look-preview'), outfitOf(save.look)); } else this.preview?.stop();
  }

  act(kind, arg, bike) {
    const save = this.save;
    const st = bikeState(save, bike.id);
    if (kind === 'buy') {
      const b = BIKES.find((x) => x.id === arg);
      if (!save.owned.includes(b.id)) { if (save.level < b.level || !this.pay(b.price)) return; save.owned.push(b.id); }
      save.bike = b.id;
      return this.done(`ใช้ ${b.name}`);
    }
    if (kind === 'repair') {
      const p = PARTS.find((x) => x.id === arg);
      if (!this.pay(partPrice(bike, p, st.parts[p.id]))) return;
      st.parts[p.id] = 1;
      return this.done(`เปลี่ยน${p.name}ใหม่แล้ว`);
    }
    if (kind === 'repairAll') {
      const cost = PARTS.reduce((s, p) => s + (st.parts[p.id] < 0.999 ? partPrice(bike, p, st.parts[p.id]) : 0), 0);
      if (!cost || !this.pay(cost)) return;
      for (const p of PARTS) st.parts[p.id] = 1;
      return this.done('ซ่อมครบทุกชิ้นแล้ว');
    }
    if (kind === 'mod') {
      const [slot, idx] = arg.split(':');
      const m = MODS.find((x) => x.slot === slot);
      const o = m.options[+idx];
      if (!st.owned[slot].includes(+idx)) {
        if (save.level < o.level || !this.pay(modPrice(bike, o))) return;
        st.owned[slot].push(+idx);
      }
      st.mods[slot] = +idx;
      return this.done(`ใส่${o.name}แล้ว`);
    }
    if (kind === 'wear') {
      const [key, raw] = arg.split('=');
      const cat = WARDROBE.find((c) => c.key === key);
      const value = raw === 'true' ? true : raw === 'false' ? false : raw === 'null' ? null : cat.numbers ? +raw : raw;
      const { price, level } = itemPrice(cat, value);
      const id = itemId(key, value);
      if (price && !save.closet.includes(id)) {
        if (save.level < level) return this.flash(`ต้อง Lv.${level}`);
        if (!this.pay(price)) return;
        save.closet.push(id);
      }
      save.look[key] = value;
      this.save.write();
      this.onLook?.();
      return this.render();
    }
    if (kind === 'paint' || kind === 'rim' || kind === 'neon') {
      const v = arg === 'null' ? null : +arg;
      if (st[kind] === v) return;
      if (!this.pay(COSMETIC_PRICE[kind])) return;
      st[kind] = v;
      return this.done('ทำสีเสร็จแล้ว');
    }
  }

  tab_bikes() {
    const save = this.save;
    return BIKES.map((b) => {
      const owned = save.owned.includes(b.id);
      const cur = save.bike === b.id;
      const locked = !owned && save.level < b.level;
      const btn = cur ? '<button disabled>ใช้อยู่</button>' : owned ? `<button data-act="buy" data-arg="${b.id}">ใช้คันนี้</button>`
        : locked ? `<button disabled>🔒 Lv.${b.level}</button>` : `<button data-act="buy" data-arg="${b.id}" ${save.money < b.price ? 'disabled' : ''}>ซื้อ ${baht(b.price)}</button>`;
      return `<div class="bike-row"><span class="sw" style="background:${hex(bikeState(save, b.id).paint)}"></span>
        <span class="nm">${b.name}<small>สูงสุด ${Math.round(b.top * 3.6)} กม./ชม. · อัตราเร่ง ${b.accel}</small></span>${btn}</div>`;
    }).join('');
  }

  tab_repair(bike) {
    const st = bikeState(this.save, bike.id);
    const groups = [...new Set(PARTS.map((p) => p.group))];
    const total = PARTS.reduce((s, p) => s + (st.parts[p.id] < 0.999 ? partPrice(bike, p, st.parts[p.id]) : 0), 0);
    return `<div class="shop-head"><span>สภาพรถโดยรวม <b>${Math.round(PARTS.reduce((s, p) => s + st.parts[p.id], 0) / PARTS.length * 100)}%</b></span>
      <button data-act="repairAll" ${total ? '' : 'disabled'}>ซ่อมทั้งหมด ${total ? baht(total) : ''}</button></div>` +
      groups.map((g) => `<div class="shop-group">${g}</div>` + PARTS.filter((p) => p.group === g).map((p) => {
        const c = st.parts[p.id];
        const pct = Math.round(c * 100);
        const cls = c < 0.25 ? 'bad' : c < 0.6 ? 'mid' : 'good';
        return `<div class="part-row"><span class="pi">${p.icon}</span><span class="pn">${p.name}<small>${p.tip}</small>
          <span class="bar ${cls}"><i style="width:${pct}%"></i></span></span><span class="pc">${pct}%</span>
          <button data-act="repair" data-arg="${p.id}" ${c >= 0.999 ? 'disabled' : ''}>${c >= 0.999 ? 'ใหม่' : `เปลี่ยน ${baht(partPrice(bike, p, c))}`}</button></div>`;
      }).join('')).join('');
  }

  tab_tune(bike) {
    const st = bikeState(this.save, bike.id);
    const fmt = (mul) => Object.entries(mul).map(([k, v]) => `${{ top: 'ความเร็ว', accel: 'อัตราเร่ง', grip: 'การเกาะ', brake: 'เบรก' }[k]} ${v >= 1 ? '+' : ''}${Math.round((v - 1) * 100)}%`).join(' · ') || 'มาตรฐาน';
    return MODS.map((m) => `<div class="shop-group">${m.icon} ${m.name}</div>` + m.options.map((o, k) => {
      const fitted = st.mods[m.slot] === k;
      const owned = st.owned[m.slot].includes(k);
      const locked = !owned && this.save.level < o.level;
      const btn = fitted ? '<button disabled>ติดอยู่</button>' : owned ? `<button data-act="mod" data-arg="${m.slot}:${k}">ใส่</button>`
        : locked ? `<button disabled>🔒 Lv.${o.level}</button>` : `<button data-act="mod" data-arg="${m.slot}:${k}" ${this.save.money < modPrice(bike, o) ? 'disabled' : ''}>${baht(modPrice(bike, o))}</button>`;
      return `<div class="part-row${fitted ? ' fitted' : ''}"><span class="pn">${o.name}<small>${fmt(o.mul)}${o.tireWear ? ' · ยางสึกเร็ว' : ''}${o.loud ? ' · เสียงดังขึ้น' : ''}</small></span>${btn}</div>`;
    }).join('')).join('');
  }

  tab_paint(bike) {
    const st = bikeState(this.save, bike.id);
    const sw = (kind, list) => list.map((c) => `<button class="swatch${st[kind] === c ? ' on' : ''}" data-act="${kind}" data-arg="${c}" title="${kind}" style="background:${c === null ? 'repeating-linear-gradient(45deg,#333 0 6px,#555 6px 12px)' : hex(c)}"></button>`).join('');
    return `<div class="shop-group">สีตัวรถ · ${baht(COSMETIC_PRICE.paint)}</div><div class="swatches">${sw('paint', PAINTS)}</div>
      <div class="shop-group">สีล้อแม็ก · ${baht(COSMETIC_PRICE.rim)}</div><div class="swatches">${sw('rim', RIMS)}</div>
      <div class="shop-group">ไฟใต้ท้อง (นีออน) · ${baht(COSMETIC_PRICE.neon)}</div><div class="swatches">${sw('neon', NEONS)}</div>`;
  }

  tab_look() {
    const save = this.save;
    const look = save.look;
    const rows = WARDROBE.map((cat) => {
      let items;
      if (cat.numbers) {
        const n = look[cat.key];
        items = `<button data-act="wear" data-arg="${cat.key}=${Math.max(1, n - 1)}">−</button><b class="vest-no">${n}</b><button data-act="wear" data-arg="${cat.key}=${Math.min(99, n + 1)}">+</button>`;
      } else if (cat.colors) {
        items = `<div class="swatches">${cat.colors.map((c) => {
          const { price } = itemPrice(cat, c);
          const owned = !price || save.closet.includes(itemId(cat.key, c));
          return `<button class="swatch${look[cat.key] === c ? ' on' : ''}" data-act="wear" data-arg="${cat.key}=${c}" title="${owned ? '' : baht(price)}" style="background:${c}">${owned ? '' : '฿'}</button>`;
        }).join('')}</div>`;
      } else {
        items = `<div class="chips">${cat.options.map(([v, name, price, level]) => {
          const on = look[cat.key] === v;
          const owned = !price || save.closet.includes(itemId(cat.key, v));
          const locked = !owned && level && save.level < level;
          const tag = on ? '' : owned ? '' : locked ? ` 🔒Lv.${level}` : ` ${baht(price)}`;
          return `<button class="chip${on ? ' on' : ''}" data-act="wear" data-arg="${cat.key}=${v}" ${locked ? 'disabled' : ''}>${name}${tag}</button>`;
        }).join('')}</div>`;
      }
      return `<div class="look-row"><span class="look-name">${cat.name}</span>${items}</div>`;
    }).join('');
    return `<div class="look"><div class="look-preview"></div><div class="look-list">
      <p class="shop-note">ใส่เสื้ออะไรก็ได้ แต่วินต้องใส่เสื้อวินทับเสมอ และต้องสวมหมวกกันน็อกทุกครั้ง</p>${rows}</div></div>`;
  }

  tab_spec(bike) {
    const now = effective(this.save, bike.id);
    const max = { top: 50, accel: 16, grip: 1.7, brake: 1.4 };
    const rows = [
      ['ความเร็วสูงสุด', now.top / max.top, `${Math.round(now.top * 3.6)} กม./ชม.`, bike.top / max.top],
      ['อัตราเร่ง', now.accel / max.accel, now.accel.toFixed(1), bike.accel / max.accel],
      ['การเกาะถนน', now.grip / max.grip, now.grip.toFixed(2), bike.grip / max.grip],
      ['เบรก', now.brakeMul / max.brake, `${Math.round(now.brakeMul * 100)}%`, 1 / max.brake],
    ];
    return `<p class="shop-note">แถบสีเทา = รถเดิมจากโรงงาน · แถบสี = ตอนนี้ (รวมของแต่งและสภาพชิ้นส่วน)</p>` + rows.map(([n, v, t, base]) => `
      <div class="spec-row"><span>${n}</span><span class="spec-bar"><i class="base" style="width:${Math.min(100, base * 100)}%"></i><i class="now" style="width:${Math.min(100, v * 100)}%"></i></span><b>${t}</b></div>`).join('') +
      (now.broken ? '<p class="shop-note bad">⚠️ เครื่องพัง/น้ำมันเครื่องหมด วิ่งได้แค่ช้าๆ รีบซ่อม!</p>' : '');
  }
}

// A turning 3D preview of the rider in the wardrobe (its own small renderer, made on first use).
class Preview {
  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(220, 300);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    const sun = new THREE.DirectionalLight(0xffffff, 2.4); sun.position.set(2, 3, 3);
    this.scene.add(sun, new THREE.HemisphereLight(0xdfeeff, 0x6b5a48, 1.1));
    this.camera = new THREE.PerspectiveCamera(30, 220 / 300, 0.1, 20);
    this.camera.position.set(0, 1.1, 4.2);
    this.camera.lookAt(0, 0.92, 0);
    this.person = null; this.key = ''; this.raf = 0; this.t = 0;
  }
  show(el, outfit) {
    if (!el) return;
    el.appendChild(this.renderer.domElement);
    const key = JSON.stringify(outfit);
    if (key !== this.key) {
      this.key = key;
      if (this.person) { this.scene.remove(this.person); this.person.userData.mesh.geometry.dispose(); }
      this.person = makeCharacter(outfit);
      this.scene.add(this.person);
    }
    if (!this.raf) { const loop = () => { this.t += 1 / 60; this.person.rotation.y = Math.sin(this.t * 0.6) * 0.9; poseCharacter(this.person, 'idle', this.t); this.renderer.render(this.scene, this.camera); this.raf = requestAnimationFrame(loop); }; loop(); }
  }
  stop() { cancelAnimationFrame(this.raf); this.raf = 0; }
}
