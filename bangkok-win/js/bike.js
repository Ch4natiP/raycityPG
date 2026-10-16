import * as THREE from 'three';
import { glowTexture } from './textures.js';
import { makeMoto, paintMoto, seatOf, seatRider } from './vehicles.js';
import { makeCharacter, poseCharacter, randomOutfit } from './character.js';

// Every number that shapes how the bike feels lives here. Per-bike values (top, accel, grip) are in config.BIKES.
// These are the original (first-version) handling numbers: direct, arcade steering and strong brakes.
export const HANDLING = {
  gears: [0.3, 0.5, 0.68, 0.84, 1.0], // for the gear display and engine sound only
  idleRpm: 0.18,
  brake: 20,             // m/s² (S / ↓ and Space)
  reverseAccel: 6,
  reverseTop: 5,
  coastDrag: 1.2,        // m/s², plus 8% of speed per second
  steerRate: 8,          // how fast the steering input follows the keys
  lowSteer: 0.62,        // rad of steering at standstill, shrinks with speed
  steerFade: 0.11,
  wheelbase: 1.35,
  maxYaw: 2.4,           // rad/s
  lean: 0.55,            // rad of visual lean at full steer
  radius: 0.55,          // collision circle
  carRadius: 0.65,
  crashSpeed: 4,         // m/s into a wall that counts as a crash
  sidewalkTop: 0.7,
};

const H = HANDLING;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const approach = (v, target, rate) => (v < target ? Math.min(target, v + rate) : Math.max(target, v - rate));

export class Bike {
  constructor(scene, spec, outfit = null) {
    this.spec = spec;
    this.mesh = new THREE.Group();   // moves with the physics; the bike model inside can be swapped
    this.seat = new THREE.Group();   // passengers sit here
    this.setRider(outfit || randomOutfit(() => 0.3, { vest: 99, helmet: 0xff7a00 }));
    this.setModel(spec.id || 'wave');
    // neon under-glow (a garage extra)
    this.neon = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.neon.position.y = 0.04;
    this.mesh.add(this.neon);
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
    this.boost = 1;
    this.boosting = false;
    this.throttle = 0;
    this.skid = 0;
    this.onSidewalk = false;
    this.district = '';
  }

  // The model of the bike (each bike in the garage looks like itself).
  setModel(kind) {
    if (this.model && this.kind === kind) return;
    if (this.model) this.mesh.remove(this.model);
    this.kind = kind;
    this.model = makeMoto(kind, { paint: '#' + new THREE.Color(this.spec.color ?? 0xc81e1e).getHexString(), plate: '1กท 2547', yellow: true });
    this.model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.mesh.add(this.model);
    Object.assign(this.mesh.userData, this.model.userData);
    const s = seatOf(kind);
    this.seatInfo = s;
    if (this.rider.parent === null || this.mounted !== false) this.mount();
    this.seat.position.set(0, s.py - 0.86, s.pz + 0.52); // passengers are placed at (0, 0.86, -0.52) on the seat
    this.model.userData.lean.add(this.seat);
  }

  // The player's character (outfit from the wardrobe).
  setRider(outfit) {
    const old = this.rider;
    this.outfit = outfit;
    this.rider = makeCharacter(outfit);
    poseCharacter(this.rider, this.mounted === false ? 'idle' : 'ride');
    if (old) {
      const parent = old.parent;
      parent?.remove(old);
      if (this.mounted !== false && this.model) this.mount(); // hands back on the grips
      else if (parent) { parent.add(this.rider); this.rider.position.copy(old.position); this.rider.rotation.copy(old.rotation); }
      old.userData.mesh.geometry.dispose();
    }
  }

  // put the rider back on the seat
  mount() {
    this.mounted = true;
    const s = this.seatInfo;
    if (!s || !this.model) return;
    seatRider(this.rider, this.kind, this.model.userData.lean);
  }

  // spec: the bike's numbers after parts and upgrades (see garage.effective); also carries paint.
  setSpec(spec) {
    this.spec = spec;
    if (spec.id && spec.id !== this.kind) this.setModel(spec.id);
    paintMoto(this.mesh, spec.color, spec.rim ?? null);
    this.neon.visible = spec.neon != null;
    if (spec.neon != null) this.neon.material.color.set(spec.neon);
  }

  setNight(n) { this.neon.material.opacity = this.neon.visible ? 0.35 + 0.55 * Math.min(1, n * 1.6) : 0; }

  place(x, z, h) {
    this.x = x; this.z = z; this.h = h;
    this.vx = this.vz = this.speed = 0;
    this.lean = this.steer = this.yawRate = 0;
    this.gear = 1;
  }

  // controls: { throttle, brake, handbrake, steer, boost } ; world: { colliders, traffic, groundHeight }
  // Returns impacts this step: [{ power, kind: 'wall'|'car', car }]
  update(dt, c, world) {
    const spec = this.spec;
    const impacts = [];
    let v = this.speed;

    // ---- boost gauge ----
    this.boosting = c.boost && this.boost > 0.02 && c.throttle > 0;
    this.boost = clamp(this.boost + (this.boosting ? -0.35 : 0.08) * dt, 0, 1);

    // ---- longitudinal ----
    const top = spec.top * (this.boosting ? 1.3 : 1) * (this.onSidewalk ? H.sidewalkTop : 1);
    const accel = spec.accel * (this.boosting ? 1.6 : 1);
    if (c.throttle && v >= -0.5) v += accel * dt * Math.max(0, 1 - Math.max(0, v) / top) ** 0.6;
    const brake = H.brake * (spec.brakeMul ?? 1); // worn pads brake less, upgraded kits more
    this.braking = (c.brake || c.handbrake) && Math.abs(v) > 0.5 ? 1 : 0;
    if (c.handbrake) v -= Math.sign(v) * Math.min(Math.abs(v), brake * dt);
    else if (c.brake) {
      if (v > 0.5) v = Math.max(0, v - brake * dt);
      else v = Math.max(-H.reverseTop, v - H.reverseAccel * dt); // reverse / walk it back
    }
    if (!c.throttle && !c.brake && !c.handbrake) v -= Math.sign(v) * Math.min(Math.abs(v), (H.coastDrag + Math.abs(v) * 0.08) * dt);
    if (v > top) v -= (v - top) * 2 * dt;
    this.throttle = c.throttle;
    this.skid = 0;

    // ---- steering: tighter at low speed, smooth at high speed ----
    this.steer += (c.steer - this.steer) * Math.min(1, dt * H.steerRate);
    const angle = (H.lowSteer / (1 + Math.abs(v) * H.steerFade)) * spec.grip;
    this.yawRate = clamp((v / H.wheelbase) * Math.tan(angle * this.steer), -H.maxYaw, H.maxYaw);
    this.h += this.yawRate * dt;
    const leanTarget = this.steer * Math.min(1, Math.abs(v) / 10) * H.lean * Math.sign(v || 1);
    this.lean += (leanTarget - this.lean) * Math.min(1, dt * 6);

    // ---- move & collide ----
    const fx = Math.sin(this.h);
    const fz = Math.cos(this.h);
    const p = { x: this.x + fx * v * dt, z: this.z + fz * v * dt };
    const hit = world.colliders.resolve(p, H.radius);
    if (hit) {
      const into = -(fx * hit.nx + fz * hit.nz) * v; // speed straight into the wall
      if (into > 0) {
        v -= Math.sign(v) * Math.min(Math.abs(v), into * 0.9 + 0.5);
        if (into > H.crashSpeed) impacts.push({ power: into, kind: 'wall' });
      }
    }
    const car = world.traffic.collide(p, H.carRadius);
    if (car) {
      const rel = Math.abs(v - car.speed * Math.cos(car.h - this.h));
      if (rel > 3) impacts.push({ power: rel, kind: 'car', car });
      v *= 0.5;
      if (car.honk <= 0) impacts.push({ power: 0, kind: 'honk', car });
    }
    this.x = p.x;
    this.z = p.z;
    this.speed = v;
    this.vx = fx * v;
    this.vz = fz * v;

    // ---- gear + rpm, for the display and the engine note ----
    const sp = Math.max(0, v);
    let g = 0;
    while (g < H.gears.length - 1 && sp > H.gears[g] * spec.top * 0.97) g++;
    this.gear = g + 1;
    const lo = g === 0 ? 0 : H.gears[g - 1] * spec.top;
    const hi = H.gears[g] * spec.top;
    const inGear = clamp((sp - lo * 0.55) / (hi - lo * 0.55), 0, 1);
    this.rpm = approach(this.rpm, H.idleRpm + (1 - H.idleRpm) * inGear * (c.throttle || sp > 1 ? 1 : 0), dt * 4);
    this.shift = 0;

    // ---- curb height ----
    const gy = world.groundHeight(this.x, this.z);
    this.onSidewalk = gy > 0;
    this.y += (gy - this.y) * Math.min(1, dt * 15);
    return impacts;
  }

  // Copy the physics state onto the model.
  sync(dt) {
    const u = this.mesh.userData;
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.set(0, this.h, 0);
    u.lean.rotation.set(0, 0, -this.lean);
    const spin = (this.speed / 0.3) * dt;
    u.front.rotation.x += spin;
    u.rear.rotation.x += spin;
    u.fork.rotation.y = this.steer * 0.35 * Math.max(0.15, 1 - Math.abs(this.speed) / 15);
  }
}
