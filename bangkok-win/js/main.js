import * as THREE from 'three';
import { BIKES, districtOf, nodeX, N, HALF, BLOCK } from './config.js';
import { buildCity } from './city.js';
import { Traffic } from './traffic.js';
import { Jobs } from './jobs.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { Bike } from './bike.js';
import { Atmosphere } from './sky.js';
import { Phone } from './phone.js';
import { migrate } from './progress.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const mobile = matchMedia('(pointer: coarse)').matches;
document.body.classList.toggle('mobile', mobile);

// ---- save game ----
const SAVE_KEY = 'bangkok-win-save-v1';
const save = { money: 0, trips: 0, ratings: [], owned: ['wave'], bike: 'wave' };
try { Object.assign(save, JSON.parse(localStorage.getItem(SAVE_KEY) || '{}')); } catch { /* fresh start */ }
migrate(save);
save.write = () => { try { const { write, ...data } = save; localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* storage blocked */ } };

// ---- renderer / scene ----
const renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.25 : 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = !mobile;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.3, 1200);
// sky, sun / moon, haze and the clock; the game starts in the late afternoon so dusk comes soon
const atmo = new Atmosphere(scene, renderer, { mobile, hour: 16.5 });

// Bloom makes lamps, signs and lit windows glow. Desktop only (too heavy for phones).
let composer = null;
let bloom = null;
if (!mobile) {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.2, 0.55, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
}

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
jobs.clock = () => atmo.clock;
jobs.onLevelUp = (up) => { hud.levelUp(up); sfx.levelUp(); };
hud.stats(save);
const world = { colliders: city.colliders, traffic, groundHeight: city.groundHeight };

// The bike's own headlight: a real spotlight, on from dusk.
const headlight = new THREE.SpotLight(0xfff1d6, 0, 60, 0.5, 0.55, 1.3);
headlight.position.set(0, 1.0, 0.7);
headlight.target.position.set(0, 0, 14);
player.mesh.add(headlight, headlight.target);
const focus = new THREE.Vector3();

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
    if (save.money < b.price || save.level < b.level) return;
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
  save.distance += Math.abs(player.speed) * dt;
  for (const hit of player.update(dt, controls, world)) {
    if (hit.kind === 'honk') { sfx.carHorn(); hit.car.honk = 3; continue; }
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
  if (input.take('KeyT')) { atmo.skip(1); hud.toast(`เวลา ${atmo.clock} น.`, '🕐'); }
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
let camMode = 0; // 0 chase, 1 far, 2 rider's eyes
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
const want = new THREE.Vector3();
let camInit = false;

function updateCamera(dt) {
  const fx = Math.sin(player.h);
  const fz = Math.cos(player.h);
  const v = Math.abs(player.speed);
  const dist = camMode === 1 ? 11 : 5.2 + v * 0.06;
  const height = camMode === 1 ? 5.5 : 2.7;
  want.set(player.x - fx * dist, player.y + height, player.z - fz * dist);
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
    if (!camInit || camPos.distanceTo(want) > 40) { camPos.copy(want); camInit = true; } // first frame / teleport
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
  if (camMode === 2) camera.rotateZ(player.lean * 0.6);
  const fov = 62 + Math.min(18, v * 0.45);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
}

// ---- loop ----
let running = false;
let last = performance.now();
function frame(dt) {
  if (running && !phone.isOpen) { // the phone pauses the game
    // fixed sub-steps keep collisions solid at high speed
    const n = Math.ceil(dt / (1 / 120));
    for (let k = 0; k < n; k++) step(dt / n);
    player.sync(dt);
    sfx.engine(player);
    input.endFrame();
    hud.frame(dt, player, jobs, player.boost);
  }
  updateCamera(dt);
  focus.set(player.x, 0, player.z);
  atmo.update(running && !phone.isOpen ? dt : 0, focus, camera);
  const n = atmo.night;
  city.setNight(n);
  traffic.setNight(n);
  traffic.updateLights();
  headlight.intensity = Math.min(1, n * 1.6) * 90;
  if (bloom && bloomOn) { bloom.strength = 0.15 + n * 0.5; bloom.threshold = 0.95 - n * 0.15; }
  hud.clock(atmo.clock);
}
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  frame(dt);
  if (composer && bloomOn) composer.render(); else renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  if (composer) { composer.setSize(innerWidth, innerHeight); bloom.resolution.set(innerWidth / 2, innerHeight / 2); }
});

// ---- graphics quality: high = shadows + bloom, low = neither ----
let bloomOn = true;
function applyQuality(q) {
  save.settings.quality = q;
  save.write();
  bloomOn = q === 'high' && !!composer;
  atmo.sun.castShadow = q === 'high' && !mobile;
  renderer.setPixelRatio(Math.min(devicePixelRatio, q === 'high' && !mobile ? 1.75 : 1));
  renderer.setSize(innerWidth, innerHeight);
  if (composer) composer.setSize(innerWidth, innerHeight);
}
applyQuality(save.settings.quality);

// ---- phone ----
const phone = new Phone({
  save, hud, city, jobs, player, atmo, sfx,
  started: () => running,
  onQuality: applyQuality,
  onReset: () => { try { localStorage.removeItem(SAVE_KEY); } catch { /* blocked */ } location.reload(); },
});

document.getElementById('start').onclick = () => {
  document.getElementById('intro').classList.add('hide');
  sfx.start();
  running = true;
  hud.toast('ยินดีต้อนรับสู่วินมอไซค์ กทม.! ขับไปรับผู้โดยสารที่มีวงสีเขียว', '🛵');
};

// for debugging in the console / automated tests
window.__game = { player, jobs, traffic, city, save, camera, renderer, step, frame, input, bikes: BIKES, atmo, phone, hud };
