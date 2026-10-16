import * as THREE from 'three';
import { BIKES } from './config.js';
import { buildCity } from './city.js';
import { buildOSMCity } from './cityosm.js';
import { Traffic } from './traffic.js';
import { Jobs, setRoadNet } from './jobs.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { Bike } from './bike.js';
import { Atmosphere } from './sky.js';
import { Phone } from './phone.js';
import { migrate, addXp } from './progress.js';
import { TrafficLights } from './lights.js';
import { Weather } from './weather.js';
import { Missions } from './missions.js';
import { CustomerBook } from './customers.js';
import { Battles } from './battle.js';
import { Shop } from './shop.js';
import { effective, wear, damage, warnings } from './garage.js';
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

// Real Bangkok streets (OpenStreetMap) when a map file is bundled; the generated grid city otherwise.
const realMap = typeof window.CITY_DATA === 'object' && save.settings.map !== 'grid';
const city = realMap ? buildOSMCity(scene, window.CITY_DATA, { shadows: !mobile }) : buildCity(scene, { shadows: !mobile });
const net = city.net; // the road graph: traffic, signals, routes and rivals all drive on it
setRoadNet(net);
const traffic = new Traffic(scene, net, mobile ? 60 : 120);
const lights = new TrafficLights(scene, net, city.colliders);
traffic.lights = lights;
const weather = new Weather(scene, city.bounds, city.style === 'osm' ? 0.075 : 0.015);
const hud = new Hud(city);
const sfx = new Sfx();
const input = new Input();

// ---- player ----
// the bike's numbers come from its parts, upgrades and the weather (garage.js)
const bikeSpec = () => effective(save, save.bike, weather.rain);
const player = new Bike(scene, bikeSpec());
player.setSpec(bikeSpec());
const startStand = city.stands[0];
player.place(startStand.x, startStand.z, Math.PI / 2);
const jobs = new Jobs(scene, city, hud, sfx, save);
jobs.clock = () => atmo.clock;
jobs.onLevelUp = (up) => { hud.levelUp(up); sfx.levelUp(); };
const book = new CustomerBook(save);
jobs.book = book;
jobs.onCall = (c) => { sfx.phone(); hud.toast(`📞 ${c.emoji} ${c.name} โทรมา: "${c.call}" (จุดสีชมพูบนแผนที่)`, 'สายเข้า'); };
const missions = new Missions(save, (m) => {
  save.money += m.money;
  save.earned += m.money;
  for (const up of addXp(save, m.xp)) { hud.levelUp(up); sfx.levelUp(); }
  hud.toast(`ภารกิจสำเร็จ: ${m.text} · +฿${m.money} +${m.xp} XP`, '🎯 ภารกิจ');
  sfx.cash();
  save.write();
  hud.stats(save);
});
jobs.emit = (type, data) => missions.event(type, data);
const battles = new Battles(scene, city, traffic, save);
hud.battles = battles;
const shop = new Shop({ save, sfx, onChange: () => { player.setSpec(bikeSpec()); hud.stats(save); } });
hud.stats(save);
const world = { colliders: city.colliders, traffic, groundHeight: city.groundHeight };

// The bike's own headlight: a real spotlight, on from dusk.
const headlight = new THREE.SpotLight(0xfff1d6, 0, 60, 0.5, 0.55, 1.3);
headlight.position.set(0, 1.0, 0.7);
headlight.target.position.set(0, 0, 14);
player.mesh.add(headlight, headlight.target);
const focus = new THREE.Vector3();

function respawn() {
  // nearest road, in the left lane, facing along it (the way traffic flows on a one-way street)
  const near = net.nearest(player.x, player.z);
  const e = near.e;
  const fwd = e.oneway ? true : Math.sin(player.h) * near.tx + Math.cos(player.h) * near.tz >= 0;
  const t = Math.max(8, Math.min(e.len - 8, near.t));
  const p = net.at(e, fwd, fwd ? t : e.len - t);
  const off = e.lanes[0];
  player.place(p.x + p.tz * off, p.z - p.tx * off, Math.atan2(p.tx, p.tz));
  jobs.cancel(player);
  if (battles.active) { battles.cancel(); jobs.locked = false; hud.toast('ยกเลิก Battle', '⚔️'); }
}

// ---- workshop ----
document.getElementById('garage-hint').onclick = () => shop.open();

// ---- step ----
let crashCooldown = 0;
let inJunction = false;
let kmAcc = 0;
let placeTimer = 0;
let shake = 0;

function step(dt) {
  let controls = { throttle: input.throttle, brake: input.brake, handbrake: input.handbrake, steer: input.steer, boost: input.boost };
  if (battles.active && battles.active.countdown > 0) controls = { throttle: 0, brake: 0, handbrake: 1, steer: 0, boost: false }; // wait for GO
  crashCooldown -= dt;
  const metres = Math.abs(player.speed) * dt;
  save.distance += metres;
  wear(save, save.bike, metres / 1000, player.braking || 0);
  kmAcc += metres;
  if (kmAcc >= 100) { missions.event('km', { km: kmAcc / 1000 }); kmAcc = 0; }
  for (const hit of player.update(dt, controls, world)) {
    if (hit.kind === 'honk') { sfx.carHorn(); hit.car.honk = 3; continue; }
    if (crashCooldown > 0) continue;
    crashCooldown = 0.8;
    sfx.crash(hit.power);
    jobs.crash(hit.power + (hit.kind === 'car' ? 2 : 0));
    battles.crashed();
    const broke = damage(save, save.bike, hit.power);
    if (broke.length) hud.toast(`💥 ${broke.map((p) => p.name).join(', ')} เสียหายหนัก! ไปซ่อมที่อู่`, '🔧 รถพัง');
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
  if (nearStand && input.take('KeyG')) { if (shop.isOpen) shop.close(); else shop.open(); }
  if (!nearStand && shop.isOpen) shop.close();

  // red lights: entering a junction while our direction has red
  {
    const node = net.nodeAt(player.x, player.z);
    const inside = !!(node && node.signal);
    if (inside && !inJunction && Math.abs(player.speed) > 4) {
      // the road we came in on: the one pointing back the way we are heading from
      const hx = Math.sin(player.h); const hz = Math.cos(player.h);
      let from = null; let best = -2;
      for (const id of node.edges) { const d = net.awayDir(node, net.edges[id]); const v = -(d.x * hx + d.z * hz); if (v > best) { best = v; from = id; } }
      if (from !== null && lights.stateFor(node, from) === 'r') ranRed();
    }
    inJunction = inside;
  }

  // battles: challenge a rival nearby with B
  const rival = !jobs.active && !battles.active ? battles.nearby(player) : null;
  hud.battleHint(!!rival);
  if (rival && input.take('KeyB')) {
    battles.start(rival, player);
    jobs.locked = true;
    hud.toast(`"${rival.line}" · แข่งไป ${battles.active.fin.name}!`, `⚔️ ${rival.name}`);
  }



  placeTimer -= dt;
  if (placeTimer <= 0) { player.district = city.districtOf(player.x, player.z); placeTimer = 0.5; }
}

function ranRed() {
  sfx.whistle();
  if (!jobs.redLight() && Math.random() < 0.3) {
    const fine = Math.min(save.money, 200);
    save.money -= fine;
    hud.stats(save);
    hud.toast(fine > 0 ? `ฝ่าไฟแดง! ตำรวจจราจรปรับ ฿${fine}` : 'ฝ่าไฟแดง! ตำรวจตักเตือน คราวหน้าโดนปรับนะ', '🚨 ตำรวจ');
  } else if (!jobs.active) hud.toast('ฝ่าไฟแดง! ระวังตำรวจนะพี่', '🚦');
}

function battleOver({ end, reward, rival, first }) {
  jobs.locked = false;
  if (end === 'win') {
    save.money += reward.money;
    save.earned += reward.money;
    for (const up of addXp(save, reward.xp)) { hud.levelUp(up); sfx.levelUp(); }
    hud.toast(`ชนะ ${rival.name}!${first ? ' (ชนะครั้งแรก x2)' : ''} · +฿${reward.money} +${reward.xp} XP`, '🏆 Battle');
    hud.countdown('WIN!');
    sfx.fanfare();
    missions.event('battleWin');
  } else {
    hud.toast(`แพ้ ${rival.name}... ไปแต่งรถแล้วมาใหม่!`, '⚔️ Battle');
    hud.countdown('LOSE');
    sfx.lose();
  }
  save.write();
  hud.stats(save);
}

// The rest of the city moves once per frame (the bike itself runs in fine sub-steps).
function worldStep(dt) {
  traffic.update(dt, player);
  jobs.update(dt, player);
  city.updateTrain(dt);
  lights.update(dt);
  for (const ev of battles.update(dt, player)) {
    if (ev.countdown) { hud.countdown(String(ev.countdown)); sfx.countdown(false); }
    if (ev.go) { hud.countdown('GO!'); sfx.countdown(true); }
    if (ev.end) battleOver(ev);
  }
}

// ---- time of day / weather → traffic, passengers and fares ----
let densityTimer = 0;
let specTimer = 0;
const isRush = () => { const h = atmo.hour; return (h >= 7 && h < 9.5) || (h >= 17 && h < 19.5); };
function updateCity(dt) {
  const h = atmo.hour;
  const rush = isRush();
  const late = h >= 0 && h < 5;
  const night = h >= 19 || h < 5;
  const wet = weather.rain > 0.3;
  densityTimer -= dt;
  if (densityTimer <= 0) { densityTimer = 2; traffic.setDensity(rush ? 1 : late ? 0.3 : night ? 0.5 : 0.65, player); }
  jobs.demand = { count: (rush ? 12 : late ? 5 : 8) + (wet ? 3 : 0), fareMul: (rush ? 1.3 : 1) * (wet ? 1.2 : 1) * (late ? 1.15 : 1) };
  jobs.context = () => ({ night, rush, rain: wet });
  const tags = [];
  if (rush) tags.push('🚦 ช่วงเร่งด่วน ×1.3');
  if (wet) tags.push(`${weather.label} ×1.2`);
  if (late) tags.push('🌙 ดึก ×1.15');
  hud.status(tags.join(' · '));
  missions.ensure(atmo.day, save.level);
  // parts wear and rain change the bike's numbers: refresh them now and then
  specTimer -= dt;
  if (specTimer <= 0) { specTimer = 1; player.setSpec(bikeSpec()); hud.warnings(warnings(save, save.bike)); }
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
  const paused = phone.isOpen || shop.isOpen; // the phone and the workshop pause the game
  if (paused) { if (shop.isOpen && input.take('KeyG')) shop.close(); input.endFrame(); } // G closes the workshop; drop key presses made while paused
  if (running && !paused) {
    // fixed sub-steps keep collisions solid at high speed
    const n = Math.ceil(dt / (1 / 120));
    for (let k = 0; k < n; k++) step(dt / n);
    worldStep(dt);
    player.sync(dt);
    sfx.engine(player);
    input.endFrame();
    hud.frame(dt, player, jobs, player.boost);
    hud.battle(battles.active);
    updateCity(dt);
    weather.update(dt, camera);
  }
  updateCamera(dt);
  focus.set(player.x, 0, player.z);
  atmo.rain = weather.rain;
  sfx.rain(running && !paused ? weather.rain : 0);
  atmo.update(running && !paused ? dt : 0, focus, camera);
  const n = atmo.night;
  city.setNight(n);
  traffic.setNight(n);
  traffic.updateLights();
  headlight.intensity = Math.min(1, Math.max(n, weather.rain * 0.6) * 1.6) * 90 * (player.spec.headlight ?? 1);
  player.setNight(Math.max(n, weather.rain * 0.5));
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
  maps: typeof window.CITY_DATA === 'object',
  onMap: (m) => { save.settings.map = m; save.write(); location.reload(); },
  save, hud, city, jobs, player, atmo, sfx, missions, battles, weather, rush: isRush,
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
window.__game = { player, jobs, traffic, city, save, camera, renderer, step, frame, input, bikes: BIKES, atmo, phone, hud, lights, net, weather, missions, book, battles, shop };
