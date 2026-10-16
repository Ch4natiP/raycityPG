import { rng } from './config.js';
import * as THREE from 'three';
import { makeVehicle } from './models.js';
import { setLodFar } from './vehicles.js';
import { glowTexture, beamTexture } from './textures.js';

// Cars drive on the left, follow lane lines between intersections and pick a turn at each one.
const TYPES = [
  ['car', 30], ['taxi', 22], ['moto', 18], ['tuktuk', 8], ['pickup', 10], ['bus', 5], ['songthaew', 5],
];

export class Traffic {
  constructor(scene, net, count = 70) {
    this.R = rng(777);
    this.net = net;
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
    this.night = 0;
    this.lights = null;  // TrafficLights, set by the game
    this.blockers = [];  // other things cars stop for: { on, x, z, len, wid } (the rider on foot)
    this.active = count; // how many cars are on the road right now (rush hour = all of them)
    this.makeLights(scene);
  }

  // density 0..1 of the fleet: cars beyond it park out of sight (far from the player) until rush hour.
  setDensity(f, player) {
    const want = Math.round(this.cars.length * Math.max(0.2, Math.min(1, f)));
    for (const c of this.cars) {
      const on = c.group.visible;
      const far = !player || Math.hypot(c.x - player.x, c.z - player.z) > 140;
      if (!on && this.active < want) {
        this.spawn(c, player);
        if (!player || Math.hypot(c.x - player.x, c.z - player.z) > 90) { c.group.visible = true; this.active++; }
      } else if (on && this.active > want && far) {
        c.group.visible = false; this.active--;
        c.x = 1e5; c.z = 1e5; // out of every check
      }
    }
  }

  // Head and tail lights as glowing points (one draw call each) plus a beam of light on the road per car.
  makeLights(scene) {
    const n = this.cars.length;
    const glow = glowTexture();
    const pts = (color, size) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
      const m = new THREE.PointsMaterial({ map: glow, color, size, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      const p = new THREE.Points(g, m);
      p.frustumCulled = false;
      scene.add(p);
      return p;
    };
    this.heads = pts(0xfff2d8, 1.1);
    this.tails = pts(0xff2a1a, 0.7);
    this.beamMat = new THREE.MeshBasicMaterial({ map: beamTexture(), color: 0xfff0d0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.beams = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.beamMat, n);
    this.beams.frustumCulled = false;
    scene.add(this.beams);
    this.m4 = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.v3 = new THREE.Vector3();
    this.sc = new THREE.Vector3();
  }

  setNight(n) {
    this.night = n;
    const on = Math.min(1, n * 1.6);
    this.heads.material.opacity = on;
    this.tails.material.opacity = 0.25 + on * 0.75; // tail lights glow a little even by day
    this.beamMat.opacity = on * 0.35;
  }

  updateLights() {
    const hp = this.heads.geometry.attributes.position;
    const tp = this.tails.geometry.attributes.position;
    const Y = new THREE.Vector3(0, 1, 0);
    this.cars.forEach((c, k) => {
      if (!c.group.visible) {
        for (let s = 0; s < 2; s++) { hp.setXYZ(k * 2 + s, 0, -100, 0); tp.setXYZ(k * 2 + s, 0, -100, 0); }
        this.m4.makeScale(0, 0, 0);
        this.beams.setMatrixAt(k, this.m4);
        return;
      }
      const fx = Math.sin(c.h); const fz = Math.cos(c.h);
      const half = c.len / 2;
      const side = c.type === 'moto' ? 0 : c.wid * 0.36;
      const hy = c.type === 'bus' ? 1.0 : c.type === 'moto' ? 0.95 : 0.7;
      for (let s = 0; s < 2; s++) {
        const o = (s ? 1 : -1) * side;
        hp.setXYZ(k * 2 + s, c.x + fx * (half + 0.05) + fz * o, hy, c.z + fz * (half + 0.05) - fx * o);
        tp.setXYZ(k * 2 + s, c.x - fx * (half + 0.05) + fz * o, hy + 0.05, c.z - fz * (half + 0.05) - fx * o);
      }
      const len = c.type === 'moto' ? 9 : 14;
      this.q.setFromAxisAngle(Y, c.h + Math.PI);
      this.v3.set(c.x + fx * (half + len / 2), 0.05, c.z + fz * (half + len / 2));
      this.m4.compose(this.v3, this.q, this.sc.set(c.type === 'moto' ? 3.5 : 5.5, 1, len));
      this.beams.setMatrixAt(k, this.m4);
    });
    hp.needsUpdate = true;
    tp.needsUpdate = true;
    this.beams.instanceMatrix.needsUpdate = true;
  }

  laneFor(c) {
    const lanes = c.e.lanes;
    const big = c.type === 'bus' || c.type === 'moto' || c.type === 'tuktuk' || c.type === 'songthaew';
    if (lanes.length === 1) return lanes[0];
    return big ? lanes[lanes.length - 1] : lanes[Math.min(c.lane, lanes.length - 2)];
  }

  spawn(c, player = null) {
    const R = this.R;
    const net = this.net;
    for (let tries = 0; tries < 60; tries++) {
      const e = net.edges[Math.floor(R() * net.edges.length)];
      if (e.len < 50) continue;
      c.e = e;
      c.fwd = e.oneway ? true : R() < 0.5;
      c.lane = Math.floor(R() * 2);
      // never appear past a stop line
      const end = net.nodes[c.fwd ? e.b : e.a];
      const room = e.len - (end.stop.get(e.id) ?? 2) - 8 - 15;
      if (room < 5) continue;
      c.s = 15 + R() * room;
      const p = net.at(e, c.fwd, c.s);
      const off = this.laneFor(c);
      c.x = p.x + p.tz * off;
      c.z = p.z - p.tx * off;
      if (this.cars.some((o) => o !== c && Math.hypot(o.x - c.x, o.z - c.z) < 12)) continue;
      if (player && tries < 45 && Math.hypot(player.x - c.x, player.z - c.z) < 90) continue; // pop in out of sight
      c.h = Math.atan2(p.tx, p.tz);
      c.top = (c.type === 'bus' ? 9 : c.type === 'tuktuk' ? 10 : c.type === 'moto' ? 13 : 12) + R() * 3;
      c.speed = c.top * 0.6;
      c.next = null;
      break;
    }
  }

  // Which road to take at the junction ahead: often straight on, never back the way we came unless it is a dead end.
  pickNext(c, node) {
    const net = this.net;
    const inDir = net.awayDir(node, c.e); // pointing back where we came from
    const opts = [];
    for (const id of node.edges) {
      const e = net.edges[id];
      if (e === c.e || !net.canTravel(e, node.id) || e.len < 1) continue;
      const d = net.awayDir(node, e);
      opts.push({ e, fwd: e.a === node.id, straight: -(d.x * inDir.x + d.z * inDir.z) > 0.8 });
    }
    if (!opts.length) return { e: c.e, fwd: !c.fwd, straight: false, uturn: true };
    const st = opts.find((o) => o.straight);
    if (st && this.R() < 0.55) return st;
    return opts[Math.floor(this.R() * opts.length)];
  }

  update(dt, player) {
    const net = this.net;
    for (const c of this.cars) {
      if (!c.group.visible) continue;
      if (player) setLodFar(c, (c.x - player.x) ** 2 + (c.z - player.z) ** 2 > (c.type === 'bus' ? 90 : 60) ** 2);
      const e = c.e;
      const node = net.nodes[c.fwd ? e.b : e.a];
      const stop = node.stop.get(e.id) ?? 2;
      const remain = e.len - c.s;
      if (!c.next && remain < 40) c.next = this.pickNext(c, node);
      if (remain < stop + (c.next && !c.next.straight ? 3 : 0)) {
        // into the next road: measure where we are along it
        const n = c.next;
        const p0 = net.at(n.e, n.fwd, 0);
        c.e = n.e; c.fwd = n.fwd;
        c.s = (c.x - p0.x) * p0.tx + (c.z - p0.z) * p0.tz;
        c.next = null;
        continue;
      }
      // steer toward a point ahead on the lane line
      const off = this.laneFor(c);
      const look = net.at(e, c.fwd, c.s + 6 + c.speed * 0.4);
      const tx = look.x + look.tz * off;
      const tz = look.z - look.tx * off;
      const want = Math.atan2(tx - c.x, tz - c.z);
      let dh = want - c.h;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      // a parked car can't turn on the spot: steering scales with speed
      c.h += Math.max(-2.2 * dt, Math.min(2.2 * dt, dh)) * Math.min(1, c.speed / 3);

      // speed: slow for turns and for anything in front
      let target = c.top;
      if (c.next && !c.next.straight && remain < 30) target = Math.min(target, 6);
      if (Math.abs(dh) > 0.3) target = Math.min(target, 5);
      // traffic lights: stop at the line on red, and on yellow unless already too close to stop
      if (this.lights && node.signal) {
        const st = this.lights.stateFor(node, e.id);
        const toLine = remain - stop - (c.next && !c.next.straight ? 4.4 : 3.6); // turning cars commit a little earlier
        if (st !== 'g' && toLine > -0.5 && toLine < 40 && !(st === 'y' && toLine < c.speed * 0.9)) {
          target = Math.min(target, Math.max(0, toLine) * 0.7);
        }
      }
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
      for (const o of this.blockers) if (o.on && blocked(o.x, o.z, o.len, o.wid)) target = 0; // people on foot
      else {
        for (const o of this.cars) {
          if (o === c || !o.group.visible) continue;
          if (Math.abs(o.x - c.x) > 25 || Math.abs(o.z - c.z) > 25) continue;
          if (blocked(o.x, o.z, o.len, o.wid)) { target = Math.min(target, Math.max(0, o.speed - 1)); break; }
        }
      }
      const acc = target > c.speed ? 3 : 9;
      c.speed += Math.max(-acc * dt, Math.min(acc * dt, target - c.speed));
      if (c.speed < 0) c.speed = 0;
      c.x += fx * c.speed * dt;
      c.z += fz * c.speed * dt;
      const tan = net.at(e, c.fwd, c.s);
      c.s += c.speed * dt * (fx * tan.tx + fz * tan.tz); // progress along the road
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
      if (!c.group.visible) continue;
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

