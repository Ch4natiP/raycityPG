import { poseCharacter } from './character.js';

// On foot: get off the bike (F), walk (W/S, A/D to turn), run (Shift), get back on (F next to it).
// The rider is the same character that sits on the bike, so the clothes come along.
const WALK = 1.6;   // m/s
const RUN = 4.6;
const TURN = 2.8;   // rad/s
const RADIUS = 0.32;

export class Walker {
  constructor(scene, bike, world) {
    this.scene = scene;
    this.bike = bike;
    this.world = world;     // { colliders, traffic, groundHeight }
    this.active = false;
    this.x = 0; this.z = 0; this.y = 0; this.h = 0;
    this.speed = 0;
    this.phase = 0;
    this.time = 0;
    this.busy = false;      // talking: stand still
    this.blocker = { on: false, x: 0, z: 0, len: 0.8, wid: 0.8 };
    world.traffic.blockers.push(this.blocker);
  }

  get person() { return this.bike.rider; }

  // Get off on the kerb side (the left in Thailand), else the right.
  dismount() {
    const b = this.bike;
    const fx = Math.sin(b.h); const fz = Math.cos(b.h);
    const col = this.world.colliders;
    let side = 1;
    const lx = b.x + fz * 0.8; const lz = b.z - fx * 0.8;
    if (col.inside(lx, lz)) side = -1;
    this.x = b.x + fz * 0.8 * side - fx * 0.15;
    this.z = b.z - fx * 0.8 * side - fz * 0.15;
    this.h = b.h + side * 0.4;
    this.y = this.world.groundHeight(this.x, this.z);
    b.speed = 0; b.vx = b.vz = 0; b.lean = 0; b.steer = 0;
    b.mounted = false;
    const p = this.person;
    p.parent?.remove(p);
    this.scene.add(p);
    this.active = true;
    this.speed = 0;
    this.place();
  }

  mount() {
    this.active = false;
    this.blocker.on = false;
    this.bike.mount();
  }

  nearBike() { return Math.hypot(this.x - this.bike.x, this.z - this.bike.z) < 2.4; }

  // controls: { forward: -1..1, turn: +1 left, run }
  update(dt, c) {
    this.time += dt;
    const top = c.run ? RUN : WALK;
    const want = this.busy ? 0 : c.forward * (c.forward < 0 ? WALK * 0.7 : top);
    this.speed += (want - this.speed) * Math.min(1, dt * 8);
    if (!this.busy) this.h += c.turn * TURN * dt * (c.run ? 0.8 : 1);
    const fx = Math.sin(this.h); const fz = Math.cos(this.h);
    const p = { x: this.x + fx * this.speed * dt, z: this.z + fz * this.speed * dt };
    this.world.colliders.resolve(p, RADIUS);
    // the parked bike and the cars are solid too
    const b = this.bike;
    const dx = p.x - b.x; const dz = p.z - b.z; const d = Math.hypot(dx, dz);
    if (d < 0.75 && d > 1e-4) { p.x = b.x + (dx / d) * 0.75; p.z = b.z + (dz / d) * 0.75; }
    this.world.traffic.collide(p, RADIUS);
    this.x = p.x; this.z = p.z;
    const gy = this.world.groundHeight(this.x, this.z);
    this.y += (gy - this.y) * Math.min(1, dt * 14);
    const v = Math.abs(this.speed);
    this.phase += dt * (v > 2.6 ? v / RUN : v / WALK);
    this.place();
    const pose = this.busy ? 'talk' : v > 2.6 ? 'run' : v > 0.15 ? 'walk' : 'idle';
    poseCharacter(this.person, pose, pose === 'idle' || pose === 'talk' ? this.time : this.phase);
    Object.assign(this.blocker, { on: true, x: this.x, z: this.z });
  }

  place() {
    const p = this.person;
    p.position.set(this.x, this.y, this.z);
    p.rotation.set(0, this.h, 0);
  }

  // the little "what can I do here" line above the controls
  hint(talk, el) {
    let html = '';
    if (!this.active) html = this.bike.speed < 1 && Math.abs(this.bike.speed) < 1 ? '<span><b>F</b> ลงจากรถ</span>' : '';
    else if (!talk.isOpen) {
      const npc = talk.nearest(this.x, this.z);
      if (npc) html += `<span><b>E</b> คุยกับ${talk.label(npc)}</span>`;
      if (this.nearBike()) html += '<span><b>F</b> ขึ้นรถ</span>';
      if (!html) html = '<span><b>W/S</b> เดิน · <b>A/D</b> หัน · <b>Shift</b> วิ่ง · <b>F</b> ที่รถ = ขึ้นรถ</span>';
    }
    if (html !== this.lastHint) { el.innerHTML = html; this.lastHint = html; }
  }

  // turn to face a point (someone you talk to)
  face(x, z) { this.h = Math.atan2(x - this.x, z - this.z); this.place(); }
}
