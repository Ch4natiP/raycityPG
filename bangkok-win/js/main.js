import * as THREE from 'three';
import { BIKES, districtOf, nodeX, N, HALF, BLOCK } from './config.js';
import { buildCity } from './city.js';
import { Traffic } from './traffic.js';
import { Jobs } from './jobs.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { makeBike, makePerson, pose, setBikeColor } from './models.js';

const mobile = matchMedia('(pointer: coarse)').matches;
document.body.classList.toggle('mobile', mobile);

// ---- save game ----
const SAVE_KEY = 'bangkok-win-save-v1';
const save = { money: 0, trips: 0, ratings: [], owned: ['wave'], bike: 'wave' };
try { Object.assign(save, JSON.parse(localStorage.getItem(SAVE_KEY) || '{}')); } catch { /* fresh start */ }
save.write = () => { try { const { write, ...data } = save; localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* storage blocked */ } };

// ---- renderer / scene ----
const renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.25 : 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = !mobile;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const SKY = 0xc9d8df;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 90, mobile ? 380 : 560);
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.3, 1200);

scene.add(new THREE.HemisphereLight(0xe8f2ff, 0x77685a, 1.5));
const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
sun.castShadow = !mobile;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 400 });
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.4;
scene.add(sun, sun.target);
const SUN_DIR = new THREE.Vector3(-0.45, 1, 0.3).normalize();

const city = buildCity(scene, { shadows: !mobile });
const traffic = new Traffic(scene, mobile ? 45 : 75);
const hud = new Hud(city);
const sfx = new Sfx();
const input = new Input();

// ---- player ----
const bikeSpec = () => BIKES.find((b) => b.id === save.bike) || BIKES[0];
const bike = makeBike(bikeSpec().color);
const rider = makePerson(() => 0.3, { vest: 99, helmet: 0xff7a00 });
pose(rider, 'ride');
rider.position.set(0, 0.82, -0.12);
rider.rotation.x = 0.18;
bike.userData.lean.add(rider);
const seat = new THREE.Group();
bike.userData.lean.add(seat);
bike.traverse((o) => { if (o.isMesh) o.castShadow = true; });
scene.add(bike);

const startStand = city.stands[0];
const player = {
  x: startStand.x, z: startStand.z, h: Math.PI / 2, speed: 0, steer: 0, lean: 0, y: 0,
  onSidewalk: false, seat, district: '', boost: 1,
};
const jobs = new Jobs(scene, city, hud, sfx, save);
hud.stats(save);

function respawn() {
  // nearest intersection, on the left lane, facing along the road
  const i = Math.max(0, Math.min(N, Math.round((player.x + HALF) / BLOCK)));
  const j = Math.max(0, Math.min(N - 1, Math.floor((player.z + HALF) / BLOCK)));
  player.x = nodeX(i) + 4;
  player.z = nodeX(j) + BLOCK / 2;
  player.h = 0;
  player.speed = 0;
  jobs.cancel(player);
}

// ---- camera ----
let camMode = 0; // 0 chase, 1 far, 2 first person
const camPos = new THREE.Vector3(player.x - 6, 3, player.z);
const camLook = new THREE.Vector3();

// ---- garage ----
function pickBike(b) {
  if (!save.owned.includes(b.id)) {
    if (save.money < b.price) return;
    save.money -= b.price;
    save.owned.push(b.id);
    sfx.cash();
  }
  save.bike = b.id;
  setBikeColor(bike, b.color);
  save.write();
  hud.stats(save);
}
document.getElementById('garage-close').onclick = () => hud.closeGarage();
document.getElementById('garage-hint').onclick = () => hud.openGarage(save, pickBike);

// ---- step ----
const tmp = { x: 0, z: 0 };
let crashCooldown = 0;
let placeTimer = 0;

function step(dt) {
  const spec = bikeSpec();
  const throttle = input.throttle;
  const brake = input.brake;
  const steerIn = input.steer;
  const boosting = input.boost && player.boost > 0.02 && throttle > 0;
  player.boost = Math.max(0, Math.min(1, player.boost + (boosting ? -0.35 : 0.08) * dt));

  // longitudinal
  const top = spec.top * (boosting ? 1.3 : 1) * (player.onSidewalk ? 0.7 : 1);
  const accel = spec.accel * (boosting ? 1.6 : 1);
  if (throttle && player.speed >= -0.5) player.speed += accel * dt * Math.max(0, 1 - Math.max(0, player.speed) / top) ** 0.6;
  if (brake) {
    if (player.speed > 0.5) player.speed = Math.max(0, player.speed - 20 * dt);
    else player.speed = Math.max(-5, player.speed - 6 * dt); // reverse / walk it back
  }
  if (!throttle && !brake) player.speed -= Math.sign(player.speed) * Math.min(Math.abs(player.speed), (1.2 + Math.abs(player.speed) * 0.08) * dt);
  if (player.speed > top) player.speed -= (player.speed - top) * 2 * dt;

  // steering: tighter at low speed, smooth at high speed
  player.steer += (steerIn - player.steer) * Math.min(1, dt * 8);
  const v = player.speed;
  const angle = (0.62 / (1 + Math.abs(v) * 0.11)) * spec.grip;
  const yaw = Math.max(-2.4, Math.min(2.4, (v / 1.35) * Math.tan(angle * player.steer)));
  player.h += yaw * dt;
  const leanTarget = -player.steer * Math.min(1, Math.abs(v) / 10) * 0.55 * Math.sign(v || 1);
  player.lean += (leanTarget - player.lean) * Math.min(1, dt * 6);

  // move + collide
  const fx = Math.sin(player.h);
  const fz = Math.cos(player.h);
  tmp.x = player.x + fx * v * dt;
  tmp.z = player.z + fz * v * dt;
  const hit = city.colliders.resolve(tmp, 0.55);
  crashCooldown -= dt;
  if (hit) {
    const into = -(fx * hit.nx + fz * hit.nz) * v; // speed straight into the wall
    if (into > 0) {
      player.speed -= Math.sign(v) * Math.min(Math.abs(v), into * 0.9 + 0.5);
      if (into > 4 && crashCooldown <= 0) { sfx.crash(into); jobs.crash(into); crashCooldown = 0.8; shake = Math.min(0.6, into * 0.04); }
    }
  }
  const car = traffic.collide(tmp, 0.65);
  if (car) {
    const rel = Math.abs(v - car.speed * Math.cos(car.h - player.h));
    if (rel > 3 && crashCooldown <= 0) { sfx.crash(rel); jobs.crash(rel + 2); crashCooldown = 0.8; shake = Math.min(0.7, rel * 0.05); }
    player.speed *= 0.5;
    if (car.honk <= 0) { sfx.carHorn(); car.honk = 3; }
  }
  player.x = tmp.x;
  player.z = tmp.z;
  const gy = city.groundHeight(player.x, player.z);
  player.onSidewalk = gy > 0;
  player.y += (gy - player.y) * Math.min(1, dt * 15);

  // honk at people blocking you: cars stopped for the player honk back sometimes
  for (const c of traffic.cars) if (c.blockedByPlayer && c.honk <= 0 && Math.random() < dt * 0.3) { sfx.carHorn(); c.honk = 5; }

  bike.position.set(player.x, player.y, player.z);
  bike.rotation.y = player.h;
  bike.userData.lean.rotation.z = player.lean;
  const spin = (v / 0.3) * dt;
  bike.userData.front.rotation.x += spin;
  bike.userData.rear.rotation.x += spin;
  bike.userData.fork.rotation.y = player.steer * 0.35 * Math.max(0.15, 1 - Math.abs(v) / 15);

  sfx.engine(Math.min(1, Math.abs(v) / spec.top), throttle);

  // one-shot keys
  if (input.take('KeyH') || input.take('horn')) sfx.horn();
  if (input.take('KeyR') || input.take('reset')) respawn();
  if (input.take('KeyC') || input.take('cam')) camMode = (camMode + 1) % 3;
  if (input.take('KeyM')) { const m = sfx.toggle(); hud.toast(m ? 'ปิดเสียง' : 'เปิดเสียง', '🔊'); }
  const nearStand = city.stands.some((s) => Math.hypot(s.x - player.x, s.z - player.z) < 14) && Math.abs(v) < 2 && !jobs.active;
  hud.showGarageHint(nearStand);
  if (nearStand && input.take('KeyG')) { if (hud.garageOpen) hud.closeGarage(); else hud.openGarage(save, pickBike); }
  if (!nearStand && hud.garageOpen) hud.closeGarage();

  traffic.update(dt, player);
  jobs.update(dt, player);
  city.updateTrain(dt);

  placeTimer -= dt;
  if (placeTimer <= 0) { player.district = districtOf(player.x, player.z); placeTimer = 0.5; }
}

let shake = 0;
function updateCamera(dt) {
  const fx = Math.sin(player.h);
  const fz = Math.cos(player.h);
  const v = Math.abs(player.speed);
  const dist = camMode === 1 ? 11 : 5.2 + v * 0.06;
  const height = camMode === 1 ? 5.5 : 2.7;
  const want = new THREE.Vector3(player.x - fx * dist, player.y + height, player.z - fz * dist);
  if (camMode === 2) {
    want.set(player.x + fx * 0.1, player.y + 1.75, player.z + fz * 0.1);
    camPos.copy(want);
  } else {
    // pull the camera in front of walls behind the bike (narrow sois)
    for (let t = 0.5; t <= 1.0001; t += 0.1) {
      const x = player.x - fx * dist * t;
      const z = player.z - fz * dist * t;
      if (city.colliders.inside(x, z)) { want.x = player.x - fx * dist * (t - 0.15); want.z = player.z - fz * dist * (t - 0.15); break; }
    }
    if (camPos.distanceTo(want) > 40) camPos.copy(want); // teleported / respawned
    else camPos.lerp(want, 1 - Math.exp(-dt * 7));
  }
  camLook.set(player.x + fx * 5, player.y + 1.5, player.z + fz * 5);
  camera.position.copy(camPos);
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    shake = Math.max(0, shake - dt * 1.5);
  }
  camera.lookAt(camLook);
  if (camMode === 2) camera.rotateZ(-player.lean * 0.6);
  const fov = 62 + Math.min(18, v * 0.45);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
  // the shadow box follows the player
  sun.position.set(player.x + SUN_DIR.x * 150, SUN_DIR.y * 150, player.z + SUN_DIR.z * 150);
  sun.target.position.set(player.x, 0, player.z);
}

// ---- loop ----
let running = false;
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (running) {
    // fixed sub-steps keep collisions solid at high speed
    const n = Math.ceil(dt / (1 / 120));
    for (let k = 0; k < n; k++) step(dt / n);
    input.endFrame();
    hud.frame(dt, player, jobs, player.boost);
  }
  updateCamera(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

document.getElementById('start').onclick = () => {
  document.getElementById('intro').classList.add('hide');
  sfx.start();
  running = true;
  hud.toast('ยินดีต้อนรับสู่วินมอไซค์ กทม.! ขับไปรับผู้โดยสารที่มีวงสีเขียว', '🛵');
};

// for debugging in the console / automated tests
window.__game = { player, jobs, traffic, city, save, camera, renderer, step, input };
