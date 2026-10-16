import * as THREE from 'three';
import { makeBike, makePerson, pose } from './models.js';
import { labelTexture } from './textures.js';
import { routeBetween } from './jobs.js';

// Rival win riders roam the city. Ride up to one and press B to challenge: a race to a landmark,
// RayCity style: whoever is behind loses gauge every second (more the further behind),
// first to the finish or the last one with gauge left wins.
export const RIVALS = [
  { id: 'pu', name: 'เสี่ยปู้', level: 2, vest: 0x2e86de, bike: 0xf1c40f, line: 'มาดิ ลองของหน่อย' },
  { id: 'dang', name: 'แดง สิงห์รถซิ่ง', level: 4, vest: 0xc0392b, bike: 0x111111, line: 'แพ้แล้วอย่าร้องนะ' },
  { id: 'boy', name: 'บอย เด็กแว้นบางนา', level: 6, vest: 0x27ae60, bike: 0xff4fa3, line: 'บิดไม่ถึงอย่ามาท้า' },
  { id: 'kai', name: 'ไก่ ราชาซอย', level: 9, vest: 0x8e44ad, bike: 0x16a34a, line: 'ซอยนี้ข้ารู้ทุกซอก' },
  { id: 'max', name: 'แม็กซ์ สายฟ้าสุขุมวิท', level: 13, vest: 0x111111, bike: 0xf5f5f5, line: 'ยังเร็วไม่พอหรอก' },
];
export const battleReward = (r, first) => ({ money: (120 + 70 * r.level) * (first ? 2 : 1), xp: (30 + 12 * r.level) * (first ? 2 : 1) });

const GAUGE_LOSS = 0.09;  // gauge per metre behind, per second
const CRASH_LOSS = 7;

// rivals keep to the kerb side of the road, where bikes ride
const laneOff = (e) => Math.max(...e.lanes) + (e.main ? 0.4 : 1.8);

export class Battles {
  constructor(scene, city, traffic, save) {
    this.scene = scene;
    this.city = city;
    this.traffic = traffic;
    this.net = city.net;
    this.save = save;
    save.battle ??= { wins: 0, losses: 0, rivals: {} };
    this.active = null;
    this.rivals = RIVALS.map((r, k) => this.makeRival(r, k));
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 80, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = 40;
    this.finishBeam = beam;
    beam.visible = false;
    scene.add(beam);
  }

  makeRival(r, k) {
    const mesh = makeBike(r.bike);
    const rider = makePerson(() => 0.6, { vest: r.level, helmet: r.vest, shirt: r.vest });
    pose(rider, 'ride');
    rider.position.set(0, 0.82, -0.12);
    rider.rotation.x = 0.2;
    mesh.userData.lean.add(rider);
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(`⚔️ ${r.name} Lv.${r.level}`, { bg: '#1b1d22', fg: '#ffd84a', w: 512, h: 96, font: 46, border: '#ff7a00' }), depthTest: false }));
    tag.scale.set(4.2, 0.79, 1);
    tag.position.y = 2.6;
    tag.renderOrder = 6;
    mesh.add(tag);
    this.scene.add(mesh);
    const ri = { ...r, mesh, tag, x: 0, z: 0, h: 0, speed: 8, lat: 0, cool: 0, wps: null, wp: 0, gauge: 100 };
    const long = this.net.edges.filter((e) => e.len > 60);
    const e = long[(k * 37 + 11) % long.length];
    const p = this.net.at(e, true, e.len / 2);
    ri.x = p.x; ri.z = p.z;
    this.snapToRoad(ri);
    return ri;
  }

  record(id) { return this.save.battle.rivals[id] ??= { w: 0, l: 0 }; }

  // Rival the player can challenge right now (close, not racing, not cooling down).
  nearby(player) {
    if (this.active) return null;
    let best = null;
    for (const r of this.rivals) {
      const d = Math.hypot(r.x - player.x, r.z - player.z);
      if (d < 14 && r.cool <= 0 && (!best || d < best.d)) best = { r, d };
    }
    return best && best.r;
  }

  start(r, player) {
    const pois = this.city.pois.filter((p) => p.landmark);
    let fin = null;
    for (let t = 0; t < 60 && !fin; t++) {
      const p = pois[Math.floor(Math.random() * pois.length)];
      const d = Math.hypot(p.x - player.x, p.z - player.z);
      if (d > 350 && d < 850) fin = p;
    }
    fin ??= pois[0];
    const route = routeBetween(r.x, r.z, fin.x, fin.z);
    r.wps = route.pts.slice(1);
    r.wpMain = route.main.slice(1);
    r.wp = 0;
    r.gauge = 100;
    r.speed = 0;
    this.active = { r, fin, me: 100, countdown: 3.4, t: 0, result: null };
    this.finishBeam.position.set(fin.x, 40, fin.z);
    this.finishBeam.visible = true;
  }

  // Returns events: { countdown: n } | { go: true } | { end: 'win'|'lose', reward }
  update(dt, player) {
    const ev = [];
    for (const r of this.rivals) {
      r.cool = Math.max(0, r.cool - dt);
      if (this.active?.r === r) this.race(r, dt, player);
      else this.roam(r, dt);
      r.mesh.position.set(r.x, 0, r.z);
      r.mesh.rotation.y = r.h;
      const spin = (r.speed / 0.3) * dt;
      r.mesh.userData.front.rotation.x += spin;
      r.mesh.userData.rear.rotation.x += spin;
    }
    const a = this.active;
    if (!a) return ev;
    if (a.countdown > 0) {
      const before = Math.ceil(a.countdown);
      a.countdown -= dt;
      const now = Math.ceil(a.countdown);
      if (now !== before) ev.push(now > 0 ? { countdown: now } : { go: true });
      return ev;
    }
    a.t += dt;
    const r = a.r;
    // distance left for each racer along the roads
    const mine = routeBetween(player.x, player.z, a.fin.x, a.fin.z).len;
    a.mine = mine;
    a.theirs = this.remaining(r);
    const gap = mine - a.theirs;
    if (gap > 0) a.me -= gap * GAUGE_LOSS * dt; else r.gauge += gap * GAUGE_LOSS * dt;
    a.me = Math.max(0, a.me); r.gauge = Math.max(0, r.gauge);
    let end = null;
    if (Math.hypot(player.x - a.fin.x, player.z - a.fin.z) < 10) end = 'win';
    else if (a.theirs < 6) end = 'lose';
    else if (r.gauge <= 0) end = 'win';
    else if (a.me <= 0) end = 'lose';
    else if (a.t > 240) end = mine < a.theirs ? 'win' : 'lose';
    if (end) ev.push(this.finish(end));
    return ev;
  }

  crashed() { if (this.active && this.active.countdown <= 0) this.active.me = Math.max(0, this.active.me - CRASH_LOSS); }

  finish(result) {
    const a = this.active;
    const r = a.r;
    const rec = this.record(r.id);
    const first = result === 'win' && rec.w === 0;
    const reward = result === 'win' ? battleReward(r, first) : null;
    if (result === 'win') { rec.w++; this.save.battle.wins++; } else { rec.l++; this.save.battle.losses++; }
    this.active = null;
    this.finishBeam.visible = false;
    r.cool = 60;
    r.wps = null;
    this.snapToRoad(r);
    return { end: result, reward, rival: r, first };
  }

  cancel() { if (this.active) { this.active.r.cool = 20; this.active.r.wps = null; this.snapToRoad(this.active.r); this.active = null; this.finishBeam.visible = false; } }

  remaining(r) {
    if (!r.wps) return 0;
    let len = Math.hypot(r.wps[r.wp][0] - r.x, r.wps[r.wp][1] - r.z);
    for (let k = r.wp; k < r.wps.length - 1; k++) len += Math.hypot(r.wps[k + 1][0] - r.wps[k][0], r.wps[k + 1][1] - r.wps[k][1]);
    return len;
  }

  // Join the nearest road, heading whichever way it allows.
  snapToRoad(r) {
    const near = this.net.nearest(r.x, r.z);
    r.e = near.e;
    r.fwd = near.e.oneway ? true : Math.cos(r.h) * near.tz + Math.sin(r.h) * near.tx >= 0;
    r.s = r.fwd ? near.t : near.e.len - near.t;
    r.next = null;
  }

  // Cruise around like a win between jobs: keep to the kerb, turn at random at junctions.
  roam(r, dt) {
    const net = this.net;
    const node = net.nodes[r.fwd ? r.e.b : r.e.a];
    const remain = r.e.len - r.s;
    if (remain < (node.stop.get(r.e.id) ?? 2)) {
      const opts = node.edges.map((id) => net.edges[id]).filter((e) => e !== r.e && net.canTravel(e, node.id));
      const e = opts.length ? opts[Math.floor(Math.random() * opts.length)] : r.e;
      const fwd = opts.length ? e.a === node.id : !r.fwd;
      const p0 = net.at(e, fwd, 0);
      r.e = e; r.fwd = fwd;
      r.s = (r.x - p0.x) * p0.tx + (r.z - p0.z) * p0.tz;
      return;
    }
    const off = laneOff(r.e);
    const look = net.at(r.e, r.fwd, r.s + 6);
    this.steer(r, look.x + look.tz * off, look.z - look.tx * off, 9, dt);
    const tan = net.at(r.e, r.fwd, r.s);
    r.s += r.speed * dt * (Math.sin(r.h) * tan.tx + Math.cos(r.h) * tan.tz);
  }

  race(r, dt) {
    if (this.active.countdown > 0 || !r.wps) { r.speed = Math.max(0, r.speed - 10 * dt); return; }
    const wp = r.wps[r.wp];
    const prev = r.wp === 0 ? [r.x, r.z] : r.wps[r.wp - 1];
    const sx = wp[0] - prev[0]; const sz = wp[1] - prev[1];
    const sl = Math.hypot(sx, sz) || 1;
    const fx = sx / sl; const fz = sz / sl;
    const last = r.wp === r.wps.length - 1;
    const main = r.wpMain ? r.wpMain[r.wp] : false;
    const off = last ? 0 : (main ? 8 : 3.2) + r.lat;
    const tx = wp[0] + fz * off; const tz = wp[1] - fx * off;
    const d = Math.hypot(tx - r.x, tz - r.z);
    if (d < 7 && !last) { r.wp++; return; }
    const top = Math.min(36, 15 + r.level * 1.6);
    const corner = last ? top : 8 + r.level * 0.5;
    const want = d < 25 ? corner + (top - corner) * (d / 25) : top;
    // lane-split around cars: slow down and drift sideways
    let blocked = false;
    for (const c of this.traffic.cars) {
      if (!c.group.visible) continue;
      const rx = c.x - r.x; const rz = c.z - r.z;
      const f = rx * Math.sin(r.h) + rz * Math.cos(r.h);
      const l = Math.abs(rx * Math.cos(r.h) - rz * Math.sin(r.h));
      if (f > 0 && f < 9 && l < c.wid / 2 + 0.6) { blocked = true; break; }
    }
    r.lat += ((blocked ? 1.8 : 0) - r.lat) * Math.min(1, dt * 2);
    this.steer(r, tx, tz, blocked ? Math.min(want, 9) : want, dt, 6 + r.level * 0.3);
  }

  steer(r, tx, tz, want, dt, accel = 4) {
    const target = Math.atan2(tx - r.x, tz - r.z);
    let dh = target - r.h;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    r.h += Math.max(-2.6 * dt, Math.min(2.6 * dt, dh)) * Math.min(1, r.speed / 2 + 0.3);
    r.speed += Math.max(-12 * dt, Math.min(accel * dt, want - r.speed));
    r.x += Math.sin(r.h) * r.speed * dt;
    r.z += Math.cos(r.h) * r.speed * dt;
    r.mesh.userData.lean.rotation.z = -Math.max(-0.5, Math.min(0.5, dh * 1.4)) * Math.min(1, r.speed / 8);
  }
}
