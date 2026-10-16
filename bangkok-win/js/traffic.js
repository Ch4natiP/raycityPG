import { N, nodeX, isMain, roadW, laneOffsets, DIRS, rng } from './config.js';
import { makeVehicle } from './models.js';

// Cars drive on the left, follow lane lines between intersections and pick a turn at each one.
const TYPES = [
  ['car', 30], ['taxi', 22], ['moto', 18], ['tuktuk', 8], ['pickup', 10], ['bus', 5], ['songthaew', 5],
];

export class Traffic {
  constructor(scene, count = 70) {
    this.R = rng(777);
    this.cars = [];
    const total = TYPES.reduce((s, t) => s + t[1], 0);
    for (let k = 0; k < count; k++) {
      let roll = this.R() * total;
      let type = 'car';
      for (const [t, w] of TYPES) { roll -= w; if (roll <= 0) { type = t; break; } }
      const v = makeVehicle(type, this.R);
      scene.add(v.group);
      const c = { ...v, i: 0, j: 0, dir: 0, lane: 0, x: 0, z: 0, h: 0, speed: 0, top: 0, next: -1, honk: 0 };
      this.spawn(c);
      this.cars.push(c);
    }
  }

  laneFor(c) {
    const along = DIRS[c.dir][0] !== 0;
    const road = along ? c.j : c.i;
    const lanes = laneOffsets(road);
    const big = c.type === 'bus' || c.type === 'moto' || c.type === 'tuktuk' || c.type === 'songthaew';
    if (lanes.length === 1) return lanes[0];
    return big ? lanes[2] : lanes[Math.min(c.lane, 1)];
  }

  spawn(c) {
    const R = this.R;
    for (let tries = 0; tries < 50; tries++) {
      c.i = Math.floor(R() * (N + 1));
      c.j = Math.floor(R() * (N + 1));
      c.dir = Math.floor(R() * 4);
      const [dx, dz] = DIRS[c.dir];
      if (c.i + dx < 0 || c.i + dx > N || c.j + dz < 0 || c.j + dz > N) continue;
      c.lane = Math.floor(R() * 2);
      const off = this.laneFor(c);
      const t = 20 + R() * 60;
      c.x = nodeX(c.i) + dx * t + dz * off;
      c.z = nodeX(c.j) + dz * t - dx * off;
      if (this.cars.some((o) => o !== c && Math.hypot(o.x - c.x, o.z - c.z) < 12)) continue;
      c.h = Math.atan2(dx, dz);
      c.top = (c.type === 'bus' ? 9 : c.type === 'tuktuk' ? 10 : c.type === 'moto' ? 13 : 12) + R() * 3;
      c.speed = c.top * 0.6;
      c.next = -1;
      break;
    }
  }

  pickTurn(c, ti, tj) {
    const R = this.R;
    const back = (c.dir + 2) % 4;
    const opts = [];
    for (let d = 0; d < 4; d++) {
      if (d === back) continue;
      const ni = ti + DIRS[d][0];
      const nj = tj + DIRS[d][1];
      if (ni < 0 || ni > N || nj < 0 || nj > N) continue;
      opts.push(d);
    }
    if (!opts.length) return back;
    if (opts.includes(c.dir) && R() < 0.55) return c.dir;
    return opts[Math.floor(R() * opts.length)];
  }

  update(dt, player) {
    for (const c of this.cars) {
      const [dx, dz] = DIRS[c.dir];
      const nx = nodeX(c.i);
      const nz = nodeX(c.j);
      const s = (c.x - nx) * dx + (c.z - nz) * dz;
      const ti = c.i + dx;
      const tj = c.j + dz;
      const crossW = dx !== 0 ? roadW(ti) : roadW(tj);
      const remain = 100 - s;
      if (c.next < 0 && remain < 40) c.next = this.pickTurn(c, ti, tj);
      if (remain < crossW / 2 + (c.next === c.dir ? 0 : 3)) {
        c.i = ti; c.j = tj;
        c.dir = c.next;
        c.next = -1;
        continue;
      }
      // steer toward a point ahead on the lane line
      const off = this.laneFor(c);
      const look = s + 6 + c.speed * 0.4;
      const tx = nx + dx * look + dz * off;
      const tz = nz + dz * look - dx * off;
      const want = Math.atan2(tx - c.x, tz - c.z);
      let dh = want - c.h;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      c.h += Math.max(-2.2 * dt, Math.min(2.2 * dt, dh));

      // speed: slow for turns and for anything in front
      let target = c.top;
      if (c.next >= 0 && c.next !== c.dir && remain < 30) target = Math.min(target, 6);
      if (Math.abs(dh) > 0.3) target = Math.min(target, 5);
      const fx = Math.sin(c.h);
      const fz = Math.cos(c.h);
      const blocked = (ox, oz, len, wid) => {
        const rx = ox - c.x;
        const rz = oz - c.z;
        const f = rx * fx + rz * fz;
        const l = Math.abs(rx * fz - rz * fx);
        return f > 0 && f < c.len / 2 + len / 2 + 4 + c.speed * 0.6 && l < c.wid / 2 + wid / 2 + 0.3;
      };
      c.blockedByPlayer = false;
      if (player && blocked(player.x, player.z, 2, 0.8)) { target = 0; c.blockedByPlayer = true; }
      else {
        for (const o of this.cars) {
          if (o === c) continue;
          if (Math.abs(o.x - c.x) > 25 || Math.abs(o.z - c.z) > 25) continue;
          if (blocked(o.x, o.z, o.len, o.wid)) { target = Math.min(target, Math.max(0, o.speed - 1)); break; }
        }
      }
      const acc = target > c.speed ? 3 : 9;
      c.speed += Math.max(-acc * dt, Math.min(acc * dt, target - c.speed));
      if (c.speed < 0) c.speed = 0;
      c.x += fx * c.speed * dt;
      c.z += fz * c.speed * dt;
      c.group.position.set(c.x, 0, c.z);
      c.group.rotation.y = c.h;
      if (c.type === 'moto') c.group.userData.lean.rotation.z = -Math.max(-0.4, Math.min(0.4, dh * 1.2));
      c.honk = Math.max(0, c.honk - dt);
    }
  }

  // Player circle vs every car (as an oriented box). Pushes p out, returns the car hit.
  collide(p, r) {
    let hit = null;
    for (const c of this.cars) {
      const rx = p.x - c.x;
      const rz = p.z - c.z;
      if (rx * rx + rz * rz > 64) continue;
      const fx = Math.sin(c.h);
      const fz = Math.cos(c.h);
      const lf = rx * fx + rz * fz;          // along the car
      const ll = rx * fz - rz * fx;          // across (left +)
      const hl = c.len / 2;
      const hw = c.wid / 2;
      const qf = Math.max(-hl, Math.min(hl, lf));
      const ql = Math.max(-hw, Math.min(hw, ll));
      let df = lf - qf;
      let dl = ll - ql;
      let d = Math.hypot(df, dl);
      if (d >= r) continue;
      if (d < 1e-6) { // inside: push out the short way
        const outL = hw - Math.abs(ll);
        const outF = hl - Math.abs(lf);
        if (outL < outF) { dl = Math.sign(ll) || 1; df = 0; d = 0; } else { df = Math.sign(lf) || 1; dl = 0; d = 0; }
        const depth = (outL < outF ? outL : outF) + r;
        p.x += (df * fx + dl * fz) * depth;
        p.z += (df * fz - dl * fx) * depth;
      } else {
        const k = (r - d) / d;
        p.x += (df * fx + dl * fz) * k;
        p.z += (df * fz - dl * fx) * k;
      }
      hit = c;
    }
    return hit;
  }
}

export { isMain };
