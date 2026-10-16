import * as THREE from 'three';
import { HALF, BLOCK, N, nodeX, districtOf } from './config.js';
import { makePerson, pose } from './models.js';
import { tripXp, addXp, fareMultiplier, passengerTypes } from './progress.js';

const NAMES = ['ป้าสมศรี', 'น้องเมย์', 'พี่ต้น', 'ลุงชัย', 'น้องฟ้า', 'พี่แอน', 'เจ๊หมวย', 'น้องบอส', 'พี่โอ๊ต', 'ยายบุญมี', 'น้องเจน', 'พี่ก้อง', 'คุณวิชัย', 'น้องนุ่น', 'พี่เอก'];
const TYPES = {
  normal: { w: 55, fare: 1, speed: 7.5, extra: 25, label: '' },
  rush: { w: 20, fare: 1.5, speed: 10, extra: 12, label: '⚡ รีบมาก' },
  tourist: { w: 12, fare: 2, speed: 7, extra: 30, label: '🌏 นักท่องเที่ยว' },
  auntie: { w: 13, fare: 1, speed: 6, extra: 40, label: '🛍 แม่ค้า (ขับนิ่มๆ)' },
};
const LINES = {
  hail: ['พี่วินคะ ว่างไหมคะ', 'พี่ๆ ไปหน่อยครับ', 'วินๆ! ทางนี้!', 'พี่ว่างไหมจ๊ะ'],
  board: {
    normal: ['ไป {d} ค่ะพี่', 'ไป {d} ครับ', 'ส่ง {d} หน่อยพี่'],
    rush: ['พี่ ไป {d} ด่วนเลย! สายแล้ว!!', 'บิดเลยพี่ ไป {d} ประชุมจะเริ่มแล้ว!'],
    tourist: ['Hello! Go to {d} please!', 'Sawasdee krub! {d}, OK?'],
    auntie: ['ไป {d} จ้ะ ของเยอะ ขับเบาๆ นะ', 'ส่งป้าที่ {d} ทีลูก ระวังไข่แตกนะ'],
  },
  crash: ['โอ๊ย! ขับดีๆ สิพี่!', 'พี่!!! เกือบตายแล้ว!', 'ใจเย็นๆ พี่ ไม่รีบขนาดนั้น!', 'Oh my god!!', 'ไข่ป้าแตกหมดแล้ว!'],
  sidewalk: ['พี่ขึ้นฟุตบาทอีกแล้ว 😅', 'ระวังคนเดินนะพี่!', 'ทางเท้าไม่ใช่ถนนนะพี่!'],
  red: ['พี่!! ไฟแดง!', 'ฝ่าไฟแดงเลยเหรอพี่ 😱', 'เดี๋ยวตำรวจจับนะพี่!'],
  late: ['ช้ามากพี่...', 'สายแล้วอ่ะพี่', 'เกือบไม่ทันเลย'],
  good: ['ขอบคุณค่ะพี่ 🙏', 'ขอบคุณครับ ทอนไม่ต้องครับ', 'Thank you! Kop khun krub!', 'เร็วดีพี่ ชอบๆ', 'ขอบใจจ้ะลูก'],
};
const say = (arr, d = '') => arr[Math.floor(Math.random() * arr.length)].replace('{d}', d);

// Manhattan route on the road grid (guidance for the minimap / arrow).
export function routeBetween(ax, az, bx, bz) {
  const ni = (v) => Math.max(0, Math.min(N, Math.round((v + HALF) / BLOCK)));
  const ai = ni(ax); const aj = ni(az);
  const bi = ni(bx); const bj = ni(bz);
  const pts = [[ax, az], [nodeX(ai), nodeX(aj)]];
  // go along the longer axis first
  if (Math.abs(bi - ai) >= Math.abs(bj - aj)) pts.push([nodeX(bi), nodeX(aj)]);
  else pts.push([nodeX(ai), nodeX(bj)]);
  pts.push([nodeX(bi), nodeX(bj)], [bx, bz]);
  let len = 0;
  for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
  return { pts, len };
}

export class Jobs {
  constructor(scene, city, hud, sfx, save) {
    this.scene = scene;
    this.city = city;
    this.hud = hud;
    this.sfx = sfx;
    this.save = save;
    this.waiting = [];
    this.active = null;
    this.leaving = [];
    this.sidewalkTimer = 0;
    this.time = 0;
    this.book = null;                      // CustomerBook (named customers)
    this.demand = { count: 8, fareMul: 1 }; // set from the time of day and the weather
    this.locked = false;                   // no pick-ups during a battle
    this.emit = () => {};                  // (type, data) game events for missions
    this.context = () => ({});             // { night, rush, rain } at the moment

    const ringGeo = new THREE.RingGeometry(1.8, 2.4, 32).rotateX(-Math.PI / 2);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0x2ecc71, transparent: true, opacity: 0.8, depthWrite: false });
    this.ringGeo = ringGeo;
    // destination beacon
    const beacon = new THREE.Group();
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 60, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xffc400, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = 30;
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.4, 4.4, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffc400, transparent: true, opacity: 0.9, depthWrite: false }));
    ring.position.y = 0.25;
    beacon.add(beam, ring);
    beacon.visible = false;
    scene.add(beacon);
    this.beacon = beacon;

    for (let k = 0; k < 8; k++) this.spawnWaiting();
  }

  // Direction from a curb point into its sidewalk.
  inward(p) {
    for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) if (this.city.groundHeight(p.x + dx * 1.5, p.z + dz * 1.5) > 0) return [dx, dz];
    return [0, 0];
  }

  pickPoi(exclude = null, near = null) {
    const pois = this.city.pois;
    for (let t = 0; t < 40; t++) {
      const p = Math.random() < 0.35 ? pois.filter((q) => q.landmark)[Math.floor(Math.random() * pois.filter((q) => q.landmark).length)] : pois[Math.floor(Math.random() * pois.length)];
      if (p === exclude) continue;
      if (this.waiting.some((w) => w.poi === p)) continue;
      if (near) {
        const d = Math.hypot(p.x - near.x, p.z - near.z);
        if (d < near.min || d > near.max) continue;
      }
      return p;
    }
    return pois[Math.floor(Math.random() * pois.length)];
  }

  busyCustomers() {
    const ids = new Set(this.waiting.filter((w) => w.customer).map((w) => w.customer.id));
    if (this.active?.customer) ids.add(this.active.customer.id);
    return ids;
  }

  // forced: a regular customer who phoned in (waits near their home district)
  spawnWaiting(player = null, forced = null) {
    let poi;
    const customer = forced || (this.book ? this.book.pick(this.save.level || 1, this.busyCustomers()) : null);
    const atStand = !customer && Math.random() < 0.3;
    if (customer) {
      const home = this.city.pois.filter((p) => !p.stand && districtOf(p.x, p.z) === customer.home && (!player || Math.hypot(p.x - player.x, p.z - player.z) > 40));
      poi = home.length ? home[Math.floor(Math.random() * home.length)] : this.pickPoi();
    } else if (atStand) {
      const s = this.city.stands[Math.floor(Math.random() * this.city.stands.length)];
      poi = { name: s.name, x: s.x + (Math.random() - 0.5) * 4, z: s.z, stand: true };
    } else {
      poi = this.pickPoi(null, player ? { x: player.x, z: player.z, min: 50, max: 600 } : null);
    }
    // which kinds of passenger turn up depends on the player's level
    const kinds = passengerTypes(this.save.level || 1);
    let roll = Math.random() * kinds.reduce((sum, k) => sum + TYPES[k].w, 0);
    let type = 'normal';
    for (const k of kinds) { roll -= TYPES[k].w; if (roll <= 0) { type = k; break; } }
    if (customer) type = customer.type;
    const person = makePerson(Math.random, type === 'tourist' ? { shirt: 0xff9ff3 } : {});
    const [ix, iz] = poi.stand ? [0, 0] : this.inward(poi);
    person.position.set(poi.x + ix * 1.0, this.city.groundHeight(poi.x + ix, poi.z + iz), poi.z + iz * 1.0);
    person.rotation.y = Math.atan2(-ix, -iz);
    if (type === 'tourist') { // a big backpack
      const bp = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.5, 0.22), new THREE.MeshLambertMaterial({ color: 0x2e7d32 }));
      bp.position.set(0, 0.35, -0.22);
      person.userData.hips.add(bp);
    }
    const ring = new THREE.Mesh(this.ringGeo, this.ringMat);
    ring.position.set(poi.x - ix * 1.2, 0.25, poi.z - iz * 1.2);
    const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: customer ? customerIcon(customer) : iconTexture(type), depthTest: false }));
    icon.scale.set(1.4, 1.4, 1);
    icon.position.set(0, 2.5, 0);
    person.add(icon);
    this.scene.add(person, ring);
    this.waiting.push({ person, ring, icon, poi, type, customer, called: !!forced, name: customer ? customer.name : NAMES[Math.floor(Math.random() * NAMES.length)], hailed: false });
  }

  update(dt, player) {
    this.time += dt;
    // waiting people wave when you come close
    for (const w of this.waiting) {
      const d = Math.hypot(player.x - w.poi.x, player.z - w.poi.z);
      pose(w.person, d < 40 ? 'wave' : 'stand', this.time);
      w.ring.scale.setScalar(1 + Math.sin(this.time * 4) * 0.08);
      w.icon.position.y = 2.5 + Math.sin(this.time * 3) * 0.15;
      if (d < 30 && !w.hailed && !this.active) { w.hailed = true; this.hud.toast(say(LINES.hail), w.name); }
      if (!this.active && !this.locked && d < 5 && Math.abs(player.speed) < 3) { this.board(w, player); break; }
    }
    // people who got off walk away and vanish
    for (const l of this.leaving) {
      l.t -= dt;
      l.p.position.x += l.dx * dt * 1.2;
      l.p.position.z += l.dz * dt * 1.2;
      pose(l.p, 'walk', this.time);
      if (l.t <= 0) this.scene.remove(l.p);
    }
    this.leaving = this.leaving.filter((l) => l.t > 0);

    if (this.active) {
      const a = this.active;
      a.left -= dt;
      const d = Math.hypot(player.x - a.dest.x, player.z - a.dest.z);
      this.beacon.children[1].scale.setScalar(1 + Math.sin(this.time * 5) * 0.06);
      a.route = routeBetween(player.x, player.z, a.dest.x, a.dest.z);
      if (player.onSidewalk) {
        this.sidewalkTimer -= dt;
        if (this.sidewalkTimer <= 0 && Math.abs(player.speed) > 4) { this.sidewalkTimer = 12; a.sidewalk++; this.hud.toast(say(LINES.sidewalk), a.name); }
      }
      if (d < 8 && Math.abs(player.speed) < 3.5) this.dropOff(player);
      else this.hud.setJob(this.jobText(d));
    } else {
      this.hud.setJob(null);
    }
    while (this.waiting.length < this.demand.count) this.spawnWaiting(player);
    // regulars phone in for a ride now and then
    if (this.book && !this.active) {
      const caller = this.book.tick(dt, this.busyCustomers());
      if (caller) { this.spawnWaiting(player, caller); this.onCall?.(caller); }
    }
  }

  jobText(d) {
    const a = this.active;
    const t = Math.max(0, Math.ceil(a.left));
    const late = a.left < 0;
    return `<b>${a.name}</b> ${TYPES[a.type].label}<br>➜ <b>${a.dest.name}</b><br>` +
      `<span class="dist">${d > 1000 ? (d / 1000).toFixed(1) + ' กม.' : Math.round(d) + ' ม.'}</span> · ` +
      `<span class="${late ? 'late' : t < 15 ? 'warn' : ''}">⏱ ${late ? 'เลยเวลา!' : t + ' วิ'}</span> · ค่าโดยสาร ฿${a.fare}`;
  }

  board(w, player) {
    this.waiting = this.waiting.filter((x) => x !== w);
    this.scene.remove(w.ring);
    w.person.remove(w.icon);
    const dest = this.pickPoi(w.poi, { x: player.x, z: player.z, min: 180, max: 1100 });
    const route = routeBetween(player.x, player.z, dest.x, dest.z);
    const T = TYPES[w.type];
    const bond = w.customer && this.book ? this.book.fareBonus(w.customer) : 0;
    const fare = Math.round((20 + route.len * 0.04) * T.fare * fareMultiplier(this.save.level || 1) * this.demand.fareMul * (1 + bond) / 5) * 5;
    this.active = {
      ...w, dest, fare, left: route.len / T.speed + T.extra, total: route.len / T.speed + T.extra,
      crashes: 0, sidewalk: 0, redlights: 0, route,
    };
    pose(w.person, 'pillion');
    w.person.position.set(0, 0.86, -0.52);
    w.person.rotation.set(0.12, 0, 0);
    player.seat.add(w.person);
    this.beacon.position.set(dest.x, 0, dest.z);
    this.beacon.visible = true;
    this.hud.toast(say(LINES.board[w.type], dest.name), w.name);
    this.sfx.ding();
  }

  dropOff(player) {
    const a = this.active;
    this.active = null;
    this.beacon.visible = false;
    const timeBonus = a.left > 0 ? Math.round((a.left / a.total) * a.fare * 0.6) : 0;
    const crashCost = a.crashes * (a.type === 'auntie' ? 15 : 8) + a.sidewalk * 5 + a.redlights * 10;
    const tip = Math.max(0, timeBonus - crashCost);
    const paid = (a.left > -20 ? a.fare : Math.round(a.fare * 0.6)) + tip;
    let stars = 5 - a.crashes - (a.left < 0 ? 1 : 0) - (a.left < -20 ? 1 : 0) - Math.min(1, a.sidewalk) - Math.min(2, a.redlights);
    stars = Math.max(1, Math.min(5, stars));
    this.save.money += paid;
    this.save.trips += 1;
    this.save.earned += paid;
    this.save.ratings.push(stars);
    const xp = tripXp({ fare: a.fare, stars, landmark: !!a.dest.landmark, late: a.left < 0 });
    this.save.history.unshift({ name: a.name, from: a.poi.name, to: a.dest.name, fare: paid - tip, tip, stars, xp, clock: this.clock ? this.clock() : '' });
    if (this.save.history.length > 30) this.save.history.length = 30;
    const ups = addXp(this.save, xp);
    if (this.save.ratings.length > 20) this.save.ratings.shift();
    this.save.write();
    this.hud.stats(this.save);
    this.hud.payout({ fare: a.left > -20 ? a.fare : Math.round(a.fare * 0.6), tip, stars, dest: a.dest.name });
    this.hud.toast(say(stars >= 4 ? LINES.good : LINES.late), a.name);
    this.sfx.cash();
    this.hud.xpGain(xp);
    for (const up of ups) this.onLevelUp?.(up);
    if (a.customer && this.book) {
      const r = this.book.served(a.customer, stars, tip);
      if (r.first) this.hud.toast(`${a.customer.emoji} ลูกค้าใหม่! ${a.customer.name} (${a.customer.job}) เพิ่มในสมุดลูกค้าแล้ว`, '📒 สมุดลูกค้า');
      else if (r.levelledBond) this.hud.toast(`${a.customer.emoji} ${a.customer.name} เป็น "${r.bond.label}" แล้ว! ค่าโดยสาร +${Math.round(r.bond.bonus * 100)}%`, '💖 ลูกค้าประจำ');
    }
    this.emit('trip', { stars, crashes: a.crashes, type: a.type, landmark: !!a.dest.landmark, customer: !!a.customer, paid, redlights: a.redlights, ...this.context() });
    // hop off and walk to the sidewalk
    player.seat.remove(a.person);
    a.person.position.set(player.x + Math.cos(player.h) * 0.8, this.city.groundHeight(player.x, player.z), player.z - Math.sin(player.h) * 0.8);
    a.person.rotation.set(0, player.h + Math.PI / 2, 0);
    this.scene.add(a.person);
    const [ix, iz] = this.inward(a.dest);
    this.leaving.push({ p: a.person, t: 3, dx: ix || Math.cos(player.h), dz: iz || -Math.sin(player.h) });
  }

  // The rider went through a red light.
  redLight() {
    if (!this.active) return false;
    this.active.redlights++;
    this.hud.toast(say(LINES.red), this.active.name);
    return true;
  }

  crash(severity) {
    if (!this.active || severity < 5) return;
    this.active.crashes++;
    this.hud.toast(say(LINES.crash), this.active.name);
  }

  // Passenger flies off if the player resets / respawns mid-trip.
  cancel(player) {
    if (!this.active) return;
    player.seat.remove(this.active.person);
    this.active = null;
    this.beacon.visible = false;
    this.hud.toast('ผู้โดยสารลงกลางทาง... ไม่ได้ตังค์ 😢', 'ระบบ');
  }
}

// A customer's face in a pink bubble with a heart.
const custCache = {};
function customerIcon(c) {
  if (custCache[c.id]) return custCache[c.id];
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = '#ff4fa3';
  g.beginPath(); g.arc(64, 56, 50, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.moveTo(44, 96); g.lineTo(84, 96); g.lineTo(64, 124); g.fill();
  g.font = '58px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(c.emoji, 64, 58);
  g.font = '30px sans-serif';
  g.fillText('💖', 104, 22);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  custCache[c.id] = t;
  return t;
}

const iconCache = {};
function iconTexture(type) {
  if (iconCache[type]) return iconCache[type];
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = type === 'rush' ? '#e74c3c' : type === 'tourist' ? '#8e44ad' : type === 'auntie' ? '#e67e22' : '#27ae60';
  g.beginPath();
  g.arc(64, 56, 50, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(44, 96); g.lineTo(84, 96); g.lineTo(64, 124); g.fill();
  g.font = '60px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(type === 'rush' ? '⚡' : type === 'tourist' ? '🌏' : type === 'auntie' ? '🛍' : '🙋', 64, 60);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  iconCache[type] = t;
  return t;
}
