import * as THREE from 'three';
import { BIKES, districtOf, nodeX, N, HALF, BLOCK } from './config.js';
import { buildCity } from './city.js';
import { Traffic } from './traffic.js';
import { Jobs } from './jobs.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { Bike } from './bike.js';

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
const player = new Bike(scene, bikeSpec());
const startStand = city.stands[0];
player.place(startStand.x, startStand.z, Math.PI / 2);
const jobs = new Jobs(scene, city, hud, sfx, save);
hud.stats(save);
const world = { colliders: city.colliders, traffic, groundHeight: city.groundHeight };

function respawn() {
  // nearest road, on the left lane, facing along it
  const i = Math.max(0, Math.min(N, Math.round((player.x + HALF) / BLOCK)));
  const j = Math.max(0, Math.min(N - 1, Math.floor((player.z + HALF) / BLOCK)));
  player.place(nodeX(i) + 4, nodeX(j) + BLOCK / 2, 0);
  jobs.cancel(player);
}

// ---- garage ----
function pickBike(b) {
  if (!save.owned.includes(b.id)) {
    if (save.money < b.price) return;
    save.money -= b.price;
    save.owned.push(b.id);
    sfx.cash();
  }
  save.bike = b.id;
  player.setSpec(b);
  save.write();
  hud.stats(save);
}
document.getElementById('garage-close').onclick = () => hud.closeGarage();
document.getElementById('garage-hint').onclick = () => hud.openGarage(save, pickBike);

// ---- step ----
let crashCooldown = 0;
let placeTimer = 0;
let shake = 0;

function step(dt) {
  const controls = { throttle: input.throttle, brake: input.brake, handbrake: input.handbrake, steer: input.steer, boost: input.boost };
  crashCooldown -= dt;
  for (const hit of player.update(dt, controls, world)) {
    if (crashCooldown > 0) continue;
    crashCooldown = 0.8;
    sfx.crash(hit.power);
    jobs.crash(hit.power + (hit.kind === 'car' ? 2 : 0));
    shake = Math.min(0.7, hit.power * 0.05);
    if (hit.car && hit.car.honk <= 0) { sfx.carHorn(); hit.car.honk = 3; }
  }

  // cars stopped behind the player honk now and then
  for (const c of traffic.cars) if (c.blockedByPlayer && c.honk <= 0 && Math.random() < dt * 0.3) { sfx.carHorn(); c.honk = 5; }

  // one-shot keys
  if (input.take('KeyH') || input.take('horn')) sfx.horn();
  if (input.take('KeyR') || input.take('reset')) respawn();
  if (input.take('KeyC') || input.take('cam')) camMode = (camMode + 1) % 3;
  if (input.take('KeyM')) { const m = sfx.toggle(); hud.toast(m ? 'ปิดเสียง' : 'เปิดเสียง', '🔊'); }
  const nearStand = city.stands.some((s) => Math.hypot(s.x - player.x, s.z - player.z) < 14) && Math.abs(player.speed) < 2 && !jobs.active;
  hud.showGarageHint(nearStand);
  if (nearStand && input.take('KeyG')) { if (hud.garageOpen) hud.closeGarage(); else hud.openGarage(save, pickBike); }
  if (!nearStand && hud.garageOpen) hud.closeGarage();

  traffic.update(dt, player);
  jobs.update(dt, player);
  city.updateTrain(dt);

  placeTimer -= dt;
  if (placeTimer <= 0) { player.district = districtOf(player.x, player.z); placeTimer = 0.5; }
}

// ---- camera ----
// A spring-damped chase camera: trails the bike, swings out a little into turns,
// leans with the bike, widens the view with speed and shakes on hits.
let camMode = 0; // 0 chase, 1 far, 2 rider's eyes
const camPos = new THREE.Vector3();
const camVel = new THREE.Vector3();
const camLook = new THREE.Vector3();
const lookVel = new THREE.Vector3();
const want = new THREE.Vector3();
const wantLook = new THREE.Vector3();
let camRoll = 0;
let camYaw = 0;
let camInit = false;

function spring(pos, vel, target, k, dt) {
  // critically damped: no wobble, no overshoot
  const d = 2 * Math.sqrt(k);
  vel.x += ((target.x - pos.x) * k - vel.x * d) * dt;
  vel.y += ((target.y - pos.y) * k - vel.y * d) * dt;
  vel.z += ((target.z - pos.z) * k - vel.z * d) * dt;
  pos.addScaledVector(vel, dt);
}

function updateCamera(dt) {
  const v = Math.abs(player.speed);
  const jumped = !camInit || Math.hypot(camPos.x - player.x, camPos.z - player.z) > 40; // first frame / teleport
  if (jumped) camYaw = player.h;
  // the camera heading lags the bike's, so turns show the bike's side a little
  let dh = player.h - camYaw;
  while (dh > Math.PI) dh -= Math.PI * 2;
  while (dh < -Math.PI) dh += Math.PI * 2;
  camYaw += dh * Math.min(1, dt * (camMode === 1 ? 3 : 4.5));
  const fx = Math.sin(camYaw);
  const fz = Math.cos(camYaw);
  const bx = Math.sin(player.h);
  const bz = Math.cos(player.h);
  const dist = camMode === 1 ? 11 : 4.4 + v * 0.05;
  const height = camMode === 1 ? 5.2 : 2.2 + v * 0.012;
  want.set(player.x - fx * dist, player.y + height, player.z - fz * dist);
  // look ahead of the bike, further at speed
  const ahead = 4 + v * 0.25;
  wantLook.set(player.x + bx * ahead, player.y + 1.2, player.z + bz * ahead);

  if (camMode === 2) {
    camPos.set(player.x + bx * 0.15, player.y + 1.72, player.z + bz * 0.15);
    camLook.set(player.x + bx * 10, player.y + 1.5, player.z + bz * 10);
  } else {
    // pull in front of walls behind the bike (narrow sois)
    for (let t = 0.4; t <= 1.0001; t += 0.1) {
      if (city.colliders.inside(player.x - fx * dist * t, player.z - fz * dist * t)) {
        want.x = player.x - fx * dist * Math.max(0.3, t - 0.15);
        want.z = player.z - fz * dist * Math.max(0.3, t - 0.15);
        break;
      }
    }
    if (jumped) { camPos.copy(want); camLook.copy(wantLook); camVel.set(0, 0, 0); lookVel.set(0, 0, 0); camInit = true; }
    spring(camPos, camVel, want, 60, dt);
    spring(camLook, lookVel, wantLook, 140, dt);
  }
  camera.position.copy(camPos);
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    shake = Math.max(0, shake - dt * 1.5);
  }
  // a faint road buzz at high speed
  if (v > 20) camera.position.y += (Math.random() - 0.5) * 0.012 * (v - 20) / 10;
  camera.lookAt(camLook);
  camRoll += ((camMode === 2 ? 0.7 : 0.22) * player.lean - camRoll) * Math.min(1, dt * 6);
  camera.rotateZ(camRoll); // roll with the bike's lean
  const fov = 60 + Math.min(16, v * 0.4) + (player.boosting ? 6 : 0);
  camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
  camera.updateProjectionMatrix();
  // the shadow box follows the player
  sun.position.set(player.x + SUN_DIR.x * 150, SUN_DIR.y * 150, player.z + SUN_DIR.z * 150);
  sun.target.position.set(player.x, 0, player.z);
}

// ---- loop ----
let running = false;
let last = performance.now();
function frame(dt) {
  if (running) {
    // fixed sub-steps keep collisions solid at high speed
    const n = Math.ceil(dt / (1 / 120));
    for (let k = 0; k < n; k++) step(dt / n);
    player.sync(dt);
    sfx.engine(player);
    input.endFrame();
    hud.frame(dt, player, jobs, player.boost);
  }
  updateCamera(dt);
}
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  frame(dt);
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
window.__game = { player, jobs, traffic, city, save, camera, renderer, step, frame, input, bikes: BIKES };
