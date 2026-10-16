import * as THREE from 'three';
import { makeBike, makePerson, pose, setBikeColor } from './models.js';

// Every number that shapes how the bike feels lives here. Per-bike values (top, accel, grip) are in config.BIKES.
export const HANDLING = {
  // engine & gears: each gear's share of top speed at the rev limiter
  gears: [0.3, 0.5, 0.68, 0.84, 1.0],
  shiftTime: 0.14,       // s of reduced power while changing gear
  idleRpm: 0.18,
  // brakes and drag
  brake: 9.5,            // m/s² at full brake (S / ↓): 60 → 0 in about 15 m
  handbrake: 11,         // m/s² with Space (stops, never reverses)
  reverseAccel: 4,
  reverseTop: 3.5,
  coastDrag: 0.7,        // m/s² rolling resistance
  airDrag: 0.0015,       // × v² m/s²
  // steering: below ~4 m/s the bars turn the bike, above that leaning does
  lowSteer: 0.62,        // rad handlebar lock at walking pace
  wheelbase: 1.3,
  maxLean: 0.8,          // rad (~46°)
  leanIn: 3.0,           // rad/s rolling into a turn
  leanOut: 4.2,          // rad/s standing back up
  turnG: 13,             // m/s² "gravity" used for lean → turn rate (arcade: > 9.8)
  steerIn: 5.5,          // how fast the steering input builds up
  steerOut: 8,
  // tyres
  grip: 10,              // 1/s: how fast sideways sliding dies out
  // collisions (two circles along the bike so it fits between cars)
  radius: 0.36,
  circleOffset: 0.55,
  bounce: 0.15,
  crashSpeed: 6,         // m/s into a wall that counts as a crash
  // chassis animation
  pitchPerAccel: 0.006,
  maxPitch: 0.07,
  sidewalkTop: 0.7,
};

const H = HANDLING;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const approach = (v, target, rate) => (v < target ? Math.min(target, v + rate) : Math.max(target, v - rate));
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

export class Bike {
  constructor(scene, spec) {
    this.spec = spec;
    this.mesh = makeBike(spec.color);
    const lean = this.mesh.userData.lean;
    this.rider = makePerson(() => 0.3, { vest: 99, helmet: 0xff7a00 });
    pose(this.rider, 'ride');
    this.rider.position.set(0, 0.82, -0.12);
    this.rider.rotation.x = 0.18;
    lean.add(this.rider);
    this.seat = new THREE.Group(); // passengers sit here
    lean.add(this.seat);
    this.mesh.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(this.mesh);

    // state
    this.x = 0; this.z = 0; this.y = 0; this.h = 0;
    this.vx = 0; this.vz = 0;
    this.speed = 0;        // along the heading, m/s (negative = reversing)
    this.steer = 0;        // smoothed input, +1 = left
    this.lean = 0;         // rad, + = leaning left
    this.yawRate = 0;
    this.gear = 1;
    this.rpm = H.idleRpm;
    this.shift = 0;
    this.pitch = 0;
    this.wobble = 0;
    this.wobbleT = 0;
    this.boost = 1;
    this.boosting = false;
    this.throttle = 0;
    this.skid = 0;
    this.onSidewalk = false;
    this.district = '';
  }

  setSpec(spec) {
    this.spec = spec;
    setBikeColor(this.mesh, spec.color);
  }

  place(x, z, h) {
    this.x = x; this.z = z; this.h = h;
    this.vx = this.vz = this.speed = 0;
    this.lean = this.steer = this.yawRate = this.wobble = 0;
    this.gear = 1;
  }

  // controls: { throttle, brake, handbrake, steer, boost } ; world: { colliders, traffic, groundHeight }
  // Returns impacts this step: [{ power, kind: 'wall'|'car', car }]
  update(dt, c, world) {
    const spec = this.spec;
    const impacts = [];
    let fx = Math.sin(this.h);
    let fz = Math.cos(this.h);
    let v = this.vx * fx + this.vz * fz;
    let lat = this.vx * fz - this.vz * fx; // sideways (left +)

    // ---- boost gauge ----
    this.boosting = c.boost && this.boost > 0.02 && c.throttle > 0 && v > 1;
    this.boost = clamp(this.boost + (this.boosting ? -0.35 : 0.08) * dt, 0, 1);
    const top = spec.top * (this.boosting ? 1.3 : 1) * (this.onSidewalk ? H.sidewalkTop : 1);

    // ---- gearbox: automatic, picks the lowest gear that is not over the limiter ----
    const sp = Math.max(0, v);
    let g = 0;
    while (g < H.gears.length - 1 && sp > H.gears[g] * spec.top * 0.97) g++;
    if (g + 1 !== this.gear) { if (g + 1 > this.gear) this.shift = H.shiftTime; this.gear = g + 1; }
    this.shift = Math.max(0, this.shift - dt);
    const lo = g === 0 ? 0 : H.gears[g - 1] * spec.top;
    const hi = H.gears[g] * spec.top;
    const inGear = clamp((sp - lo * 0.55) / (hi - lo * 0.55), 0, 1);
    this.rpm = approach(this.rpm, H.idleRpm + (1 - H.idleRpm) * inGear * (c.throttle || sp > 1 ? 1 : 0), dt * 4);

    // ---- longitudinal ----
    let a = 0;
    if (c.throttle && v > -0.3) {
      const torque = 0.8 + 0.35 * Math.sin(inGear * Math.PI) - 0.25 * g / H.gears.length; // strong low gears, peak mid-rev
      a += spec.accel * torque * (this.shift > 0 ? 0.3 : 1) * (this.boosting ? 1.6 : 1) * clamp(1 - (sp / top) ** 4, 0, 1);
    }
    if (c.handbrake) {
      a -= Math.sign(v) * Math.min(Math.abs(v) / dt, H.handbrake);
    } else if (c.brake) {
      if (v > 0.4) a -= Math.min(v / dt, H.brake);
      else if (v > -H.reverseTop) a -= H.reverseAccel; // walk it backwards
    }
    if (!c.throttle && !c.brake && !c.handbrake) a -= Math.sign(v) * Math.min(Math.abs(v) / dt, H.coastDrag);
    a -= Math.sign(v) * H.airDrag * v * v;
    if (v > top) a -= (v - top) * 2;
    v += a * dt;
    this.throttle = c.throttle;
    this.skid = (c.brake || c.handbrake) && v > 8 ? Math.min(1, v / 25) : 0;

    // ---- steering & lean ----
    const sIn = c.steer;
    this.steer = approach(this.steer, sIn, dt * (Math.abs(sIn) > Math.abs(this.steer) && Math.sign(sIn) === Math.sign(this.steer || sIn) ? H.steerIn : H.steerOut));
    const as = Math.abs(v);
    const leanTarget = this.steer * H.maxLean * clamp((as - 2) / 9, 0, 1) * spec.grip ** 0.5;
    const rolling = Math.abs(leanTarget) > Math.abs(this.lean) && Math.sign(leanTarget) === Math.sign(this.lean || leanTarget);
    this.lean = approach(this.lean, clamp(leanTarget, -H.maxLean, H.maxLean), dt * (rolling ? H.leanIn : H.leanOut));
    // low speed: handlebars (works in reverse too); high speed: the lean sets the turn
    const kin = (v / H.wheelbase) * Math.tan(this.steer * H.lowSteer);
    const leanYaw = as > 0.5 ? (H.turnG * spec.grip * Math.tan(this.lean)) / Math.max(as, 3) : 0;
    const blend = clamp((as - 2.5) / 4, 0, 1);
    this.yawRate = kin * (1 - blend) + leanYaw * blend;
    this.h += this.yawRate * dt;

    // ---- tyres: velocity follows the new heading, a little slide survives ----
    fx = Math.sin(this.h);
    fz = Math.cos(this.h);
    lat *= Math.exp(-H.grip * spec.grip * dt);
    this.vx = fx * v + fz * lat;
    this.vz = fz * v - fx * lat;

    // ---- move & collide ----
    const nx = this.x + this.vx * dt;
    const nz = this.z + this.vz * dt;
    const pts = [
      { x: nx + fx * H.circleOffset, z: nz + fz * H.circleOffset },
      { x: nx - fx * H.circleOffset, z: nz - fz * H.circleOffset },
    ];
    let px = 0;
    let pz = 0;
    let hitCar = null;
    for (const p of pts) {
      const ox = p.x; const oz = p.z;
      world.colliders.resolve(p, H.radius);
      const car = world.traffic.collide(p, H.radius);
      if (car) hitCar = car;
      // take the largest push from either circle on each axis
      const dx = p.x - ox; const dz = p.z - oz;
      if (Math.abs(dx) > Math.abs(px)) px = dx;
      if (Math.abs(dz) > Math.abs(pz)) pz = dz;
    }
    this.x = nx + px;
    this.z = nz + pz;
    const push = Math.hypot(px, pz);
    if (push > 1e-5) {
      const n = { x: px / push, z: pz / push };
      let into = this.vx * n.x + this.vz * n.z; // negative = moving into it
      if (hitCar) { // relative to the car, which may be moving too
        into -= hitCar.speed * (Math.sin(hitCar.h) * n.x + Math.cos(hitCar.h) * n.z);
      }
      if (into < 0) {
        // cancel the part of the velocity going into the obstacle, keep the rest: the bike scrapes along walls
        this.vx -= n.x * into * (1 + H.bounce);
        this.vz -= n.z * into * (1 + H.bounce);
        const power = -into;
        if (power > 1.5) { this.wobble = Math.min(1, this.wobble + power * 0.08); this.wobbleT = 0; }
        if (power > (hitCar ? 3 : H.crashSpeed)) {
          // a real hit: lose more speed and get knocked upright
          this.vx *= 0.55; this.vz *= 0.55;
          this.lean *= 0.3;
          impacts.push({ power, kind: hitCar ? 'car' : 'wall', car: hitCar });
        }
        // swing the nose toward the slide direction so a glancing hit turns into a scrape
        const sp2 = Math.hypot(this.vx, this.vz);
        if (sp2 > 2 && v > 0) {
          const dir = Math.atan2(this.vx, this.vz);
          this.h += clamp(wrap(dir - this.h), -1, 1) * Math.min(1, dt * 10);
        }
      } else if (hitCar && hitCar.speed > 1) {
        // a car nudging into us: get carried a bit
        this.vx += (Math.sin(hitCar.h) * hitCar.speed - this.vx) * Math.min(1, dt * 3);
        this.vz += (Math.cos(hitCar.h) * hitCar.speed - this.vz) * Math.min(1, dt * 3);
      }
    }
    this.speed = this.vx * Math.sin(this.h) + this.vz * Math.cos(this.h);

    // ---- chassis: curb height, suspension pitch, wobble ----
    const gy = world.groundHeight(this.x, this.z);
    this.onSidewalk = gy > 0;
    this.y += (gy - this.y) * Math.min(1, dt * 15);
    this.pitch += (clamp(-a * H.pitchPerAccel, -H.maxPitch, H.maxPitch) - this.pitch) * Math.min(1, dt * 8);
    this.wobble = Math.max(0, this.wobble - dt * 1.8);
    this.wobbleT += dt;
    return impacts;
  }

  // Copy the physics state onto the model.
  sync(dt) {
    const u = this.mesh.userData;
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.set(0, this.h, 0);
    const wob = Math.sin(this.wobbleT * 22) * this.wobble * 0.18;
    u.lean.rotation.set(this.pitch, 0, -(this.lean + wob));
    const spin = (this.speed / 0.3) * dt;
    u.front.rotation.x += spin;
    u.rear.rotation.x += spin;
    // bars: real lock at low speed, a small counter-steer hint at speed
    const as = Math.abs(this.speed);
    u.fork.rotation.y = as < 5 ? this.steer * H.lowSteer * (1 - as / 6) : -this.steer * 0.04;
    // rider hangs into the turn and tucks when boosting
    this.rider.rotation.z = -this.lean * 0.25;
    this.rider.rotation.x = 0.18 + (this.boosting ? 0.25 : 0) + clamp(as / 40, 0, 0.12);
  }
}
