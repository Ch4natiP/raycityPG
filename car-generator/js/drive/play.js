// Playing in the field, like the game: portals by the road (shop, garage, town, race, gas station) under their
// octagon signs and light columns, the quest givers' green "!" (a delivery: drive it to the star before the clock
// runs out; the game's stamp and the reward), EXP, levels and RP kept in the browser ('rc-profile'), the level-up
// burst, and the car shop. Pictures from the game (js/drive/rc-ui.js, through the hud). three world (x, z); the
// RayCity map's (x, y) = (X + ox, oy − Z).
import * as THREE from 'three';

const PORTALS = {
  shop: { name: 'ร้านค้า', pic: 'p_shop', color: '#f0dc3c' },
  garage: { name: 'โรงรถ', pic: 'p_garage', color: '#6be03a' },
  town: { name: 'TOWN', pic: 'p_town', color: '#45d8d0' },
  racing: { name: 'การแข่งขัน', pic: 'p_racing', color: '#c04ae8' },
  gassta: { name: 'ปั๊มน้ำมัน', pic: 'p_gassta', color: '#f0a02a' },
};
const LINES = [
  'ช่วยเอาของชิ้นนี้ไปส่งให้หน่อยได้ไหม ลูกค้ารออยู่ ต้องถึงก่อนหมดเวลานะ!',
  'ด่วนเลย! เอากล่องนี้ไปส่งที่จุดดาวบนแผนที่ ไปให้ทันเวลาล่ะ',
  'ฝากของหน่อยสิ คนรับรออยู่ปลายทาง ขับเร็ว ๆ แต่อย่าชนนะ',
  'มีพัสดุต้องส่งด่วน ช่วยฉันหน่อย แล้วจะให้รางวัลอย่างงาม',
];
const STAMPS = [['excellent', 0.5, 1.5], ['great', 0.3, 1.25], ['good', 0.15, 1], ['normal', 0, 0.8]];
export const expNeed = (lv) => Math.round(100 * lv ** 1.5);
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${Math.floor((s * 10) % 10)}`;

export function createPlay({ scene, hud, city, people, roads, actions }) {
  const el = document.getElementById('play');
  const pic = (k) => (hud.pics[k] || '');
  // --- profile
  const P = (() => { try { return { level: 1, exp: 0, rp: 50000, owned: ['escarabajo'], done: 0, ...JSON.parse(localStorage.getItem('rc-profile') || '{}') }; } catch { return { level: 1, exp: 0, rp: 50000, owned: ['escarabajo'], done: 0 }; } })();
  const save = () => { try { localStorage.setItem('rc-profile', JSON.stringify(P)); } catch { /* private mode */ } };
  const showProfile = () => hud.plate({ level: P.level, exp: P.exp / expNeed(P.level), money: P.rp });
  function reward(exp, rp) {
    P.rp += rp; P.exp += exp; let up = false;
    while (P.exp >= expNeed(P.level)) { P.exp -= expNeed(P.level); P.level++; up = true; }
    save(); showProfile(); if (up) levelUp();
  }

  // --- screen pieces
  el.innerHTML = `
    <div id="prompt" class="hide"><i class="key"></i><span></span></div>
    <div id="qwin" class="hide"><div class="who"><img class="face" alt=""><b></b></div><p></p><div class="rew"></div>
      <div class="row"><button class="ok">รับเควส</button><button class="no">ไม่รับ</button></div></div>
    <div id="qbar" class="hide"><canvas width="150" height="28"></canvas><div class="goal"></div></div>
    <img id="qarrow" class="hide" alt="">
    <div id="stamp" class="hide"><img alt=""><div class="txt"></div></div>
    <img id="lvup" class="hide" alt="">
    <div id="toast" class="hide"></div>
    <div id="shopwin" class="gwin hide"><div class="head"><b>ร้านค้า · รถ</b><span class="rp"></span><button class="x">✕</button></div><div class="list"></div></div>
    <div id="racewin" class="gwin race hide"><div class="head"><b>การแข่งขัน · เลือกสนาม</b><span class="rp"></span><button class="x">✕</button></div><div class="list"></div></div>`;
  const $ = (s) => el.querySelector(s);
  const prompt = $('#prompt'); const qwin = $('#qwin'); const qbar = $('#qbar'); const arrow = $('#qarrow'); const stamp = $('#stamp'); const lvup = $('#lvup'); const toast = $('#toast'); const shopwin = $('#shopwin'); const racewin = $('#racewin');
  prompt.querySelector('.key').style.backgroundImage = `url(${pic('enter')})`;
  qwin.style.backgroundImage = `url(${pic('q_paper')})`; arrow.src = pic('arrow');
  let toastT = 0;
  const say = (t, ms = 2500) => { toast.textContent = t; toast.classList.remove('hide'); toastT = performance.now() + ms; };

  // --- portals: the octagon (left half of the picture) on a light column (right half), a ring on the ground
  const world = new THREE.Group(); scene.add(world);
  const texOf = (k, half) => { const t = new THREE.TextureLoader().load(pic(k)); t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(0.5, 1); t.offset.set(half, 0); return t; };
  let portals = [];
  function setPortals(list) {
    for (const p of portals) world.remove(p.group);
    portals = list.map((q) => {
      const d = PORTALS[q.kind]; const g = new THREE.Group(); g.position.set(q.X, q.y, q.Z);
      const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: texOf(d.pic, 0), transparent: true, depthWrite: false })); sign.scale.set(4.6, 4.6, 1); sign.position.y = 7; sign.renderOrder = 3; g.add(sign);
      const col = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 13, 28, 1, true), new THREE.MeshBasicMaterial({ map: texOf(d.pic, 0.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      col.position.y = 6.5; g.add(col);
      const ring = new THREE.Mesh(new THREE.RingGeometry(5.4, 6.4, 40), new THREE.MeshBasicMaterial({ color: d.color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.15; g.add(ring);
      world.add(g); return { ...q, group: g, sign, d };
    });
  }

  // --- the goal of a delivery: a green column, the star on the minimap, the arrow on screen
  const goalMesh = new THREE.Group(); goalMesh.visible = false; scene.add(goalMesh);
  {
    const c = document.createElement('canvas'); c.width = 4; c.height = 64; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 64, 0, 0); gr.addColorStop(0, 'rgba(90,255,120,.95)'); gr.addColorStop(1, 'rgba(90,255,120,0)'); g.fillStyle = gr; g.fillRect(0, 0, 4, 64);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 30, 28, 1, true), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    col.position.y = 15; goalMesh.add(col);
    const a = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.TextureLoader().load(pic('arrow')), transparent: true, depthWrite: false, rotation: Math.PI, fog: false })); a.scale.set(4, 4, 1); a.position.y = 9; goalMesh.add(a); goalMesh.userData.arrow = a;
  }
  let quest = null; // { giver, X, Z, y, limit, left, exp, rp }
  // a road point (the game's traffic lanes) 350–1100 m away, on the map
  function pickGoal(X, Z) {
    const [ox, oy] = city.origin;
    for (let k = 0; k < 4000; k++) {
      const l = roads[Math.floor(Math.random() * roads.length)]; const q = l[Math.floor(Math.random() * l.length)];
      const gx = q[0] - ox; const gz = -(q[1] - oy); const d = Math.hypot(gx - X, gz - Z);
      if (d > 350 && d < 1100 && city.tileOf(gx, gz)) return { X: gx, Z: gz, y: q[2], d };
    }
    return null;
  }
  function offer(giver, S) {
    const goal = pickGoal(S.x, S.z); if (!goal) return;
    const limit = Math.round(goal.d / 12.5 * 1.45 + 20); const exp = Math.round(60 + goal.d * 0.15 + P.level * 8); const rp = Math.round(goal.d * 6 / 10) * 10;
    const face = hud.ui ? hud.ui.faces.length : 0;
    qwin.querySelector('.face').src = face ? pic(`face_${giver.face % face}`) : '';
    qwin.querySelector('b').textContent = giver.name; qwin.querySelector('p').textContent = LINES[giver.face % LINES.length];
    qwin.querySelector('.rew').innerHTML = `ส่งของ · ระยะ ${(goal.d / 1000).toFixed(1)} กม. · เวลา ${fmtTime(limit)}<br>รางวัล <b>${exp} EXP</b> · <b>${rp.toLocaleString()} RP</b>`;
    qwin.classList.remove('hide'); actions.stop();
    qwin.onAccept = () => { quest = { giver, ...goal, limit, left: limit, exp, rp }; people.take(giver); goalMesh.position.set(goal.X, goal.y, goal.Z); goalMesh.visible = true; qbar.classList.remove('hide'); arrow.classList.remove('hide'); close(); };
  }
  function close() { qwin.classList.add('hide'); qwin.onAccept = null; }
  qwin.querySelector('.ok').addEventListener('click', () => qwin.onAccept && qwin.onAccept());
  qwin.querySelector('.no').addEventListener('click', close);
  function finish(ok) {
    goalMesh.visible = false; qbar.classList.add('hide'); arrow.classList.add('hide');
    const f = quest.left / quest.limit; const [name, , k] = ok ? STAMPS.find((s) => f >= s[1]) : ['fail', 0, 0.1];
    const exp = Math.round(quest.exp * k); const rp = Math.round((quest.rp * k) / 10) * 10;
    showStamp(name, ok ? `ส่งของสำเร็จ! +${exp} EXP · +${rp.toLocaleString()} RP` : `หมดเวลา · +${exp} EXP`);
    if (ok) P.done++; reward(exp, ok ? rp : 0); quest = null;
  }
  let stampT = 0;
  function showStamp(name, text) { stamp.querySelector('img').src = pic(`st_${name}`); stamp.querySelector('.txt').textContent = text; stamp.classList.remove('hide'); stamp.classList.remove('pop'); void stamp.offsetWidth; stamp.classList.add('pop'); stampT = performance.now() + 3200; }
  // the game's level-up burst (14 frames)
  let lvT = -1;
  function levelUp() { lvT = performance.now(); lvup.classList.remove('hide'); say(`LEVEL UP! เลเวล ${P.level}`, 3000); }

  // --- the car shop: the game's cars, priced by how they go
  function price(c) { if (c.name === 'escarabajo') return 0; const h = actions.handling(c.spec); const perf = h.accel * 0.45 + (h.top / 62) * 0.4 + h.boost * 0.15; return Math.max(10000, Math.round((perf ** 4 * 60000) / 1000) * 1000); }
  function openShop() {
    const list = shopwin.querySelector('.list'); list.textContent = ''; shopwin.querySelector('.rp').textContent = `${P.rp.toLocaleString()} RP`;
    for (const c of actions.cars()) {
      const own = P.owned.includes(c.name); const cost = price(c); const h = actions.handling(c.spec);
      const row = document.createElement('div'); row.className = 'car';
      row.innerHTML = `<b>${c.name.charAt(0).toUpperCase() + c.name.slice(1)}</b><span class="st">แรง ${'▮'.repeat(Math.round(h.accel * 4))} · เร็ว ${Math.round(h.top * 3.6)} กม./ชม.</span><span class="pr">${own ? 'มีแล้ว' : `${cost.toLocaleString()} RP`}</span>`;
      const b = document.createElement('button'); b.textContent = own ? 'ใช้คันนี้' : 'ซื้อ'; b.disabled = !own && P.rp < cost;
      b.addEventListener('click', async () => {
        if (!own) { if (P.rp < cost) return; P.rp -= cost; P.owned.push(c.name); save(); showProfile(); say(`ซื้อ ${c.name} แล้ว`); }
        await actions.useCar(c.name); P.car = c.name; save(); openShop();
      });
      row.append(b); list.append(row);
    }
    shopwin.classList.remove('hide'); actions.stop();
  }
  shopwin.querySelector('.x').addEventListener('click', () => shopwin.classList.add('hide'));
  // the race portal: the game's Seoul routes, nearest start first
  function openRaces(S) {
    const list = racewin.querySelector('.list'); list.textContent = ''; racewin.querySelector('.rp').textContent = 'วิ่งจบได้ EXP · RP';
    for (const t of actions.races().map((q) => ({ ...q, d: Math.hypot(q.X - S.x, q.Z - S.z) })).sort((a, b) => a.d - b.d).slice(0, 40)) {
      const row = document.createElement('div'); row.className = 'car';
      row.innerHTML = `<b>${t.name}</b><span class="st">${(t.length / 1000).toFixed(1)} กม. · ${t.loop ? `วงปิด ${t.laps} รอบ` : 'วิ่งถึงเส้นชัย'} · จุดเริ่มห่าง ${(t.d / 1000).toFixed(1)} กม.</span><span class="pr">${t.pay ? `~${t.pay.toLocaleString()} RP` : ''}</span>`;
      const b = document.createElement('button'); b.textContent = 'แข่ง'; b.addEventListener('click', () => { racewin.classList.add('hide'); actions.startRace(t.i); });
      row.append(b); list.append(row);
    }
    racewin.classList.remove('hide'); actions.stop();
  }
  racewin.querySelector('.x').addEventListener('click', () => racewin.classList.add('hide'));

  // --- what Enter (or a tap on the prompt) does here
  let near = null;
  function act(S) {
    if (!near || document.body.classList.contains('in-garage')) return;
    if (near.giver) return offer(near.giver, S);
    const k = near.portal.kind;
    if (k === 'shop') openShop();
    else if (k === 'garage') actions.garage();
    else if (k === 'town') actions.town();
    else if (k === 'racing') openRaces(S);
    else if (k === 'gassta') { actions.refill(); say('เติม SP เต็มแล้ว'); }
  }
  let lastS = null;
  prompt.addEventListener('click', () => lastS && act(lastS));
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
    if (!qwin.classList.contains('hide')) { if (qwin.onAccept) qwin.onAccept(); } else if (lastS) act(lastS);
  });

  const busy = () => !qwin.classList.contains('hide') || !shopwin.classList.contains('hide') || !racewin.classList.contains('hide');
  showProfile();
  return {
    profile: P,
    say,
    // the quest button: what's under way, or where to get one
    questInfo() { say(quest ? `เควสส่งของให้ ${quest.giver.name} · เหลือ ${fmtTime(Math.max(0, quest.left))}` : `ไปหา NPC ที่มี ! สีเขียว แล้วกด Enter เพื่อรับเควส · ส่งสำเร็จแล้ว ${P.done} ครั้ง`, 3500); },
    setPortals,
    get portals() { return portals; },
    get quest() { return quest; },
    openShop,
    openRaces: () => lastS && openRaces(lastS),
    reward,
    showStamp,
    busy,
    // a finished race: the stamp by the average speed, EXP and RP by the length
    racePay: (metres) => Math.round((metres * 3) / 10) * 10,
    raceDone(ms, metres) {
      const kmh = metres / (ms / 1000) * 3.6; const [name, k] = kmh > 110 ? ['excellent', 1.5] : kmh > 90 ? ['great', 1.25] : kmh > 70 ? ['good', 1] : ['normal', 0.8];
      const exp = Math.round((80 + metres * 0.08) * k); const rp = Math.round((metres * 3 * k) / 10) * 10;
      showStamp(name, `เข้าเส้นชัย ${Math.round(kmh)} กม./ชม. เฉลี่ย · +${exp} EXP · +${rp.toLocaleString()} RP`); reward(exp, rp); say('กดปุ่ม TOWN เพื่อกลับเมือง', 5000);
    },
    update(dt, S, kmh, on) {
      lastS = S; const now = performance.now();
      world.visible = on; goalMesh.visible = on && !!quest;
      // (a race on: the delivery waits, its clock and arrow hidden)
      qbar.classList.toggle('hide', !(on && quest)); arrow.classList.toggle('hide', !(on && quest));
      // what's near: a portal (within its ring) or a quest giver, slow enough to stop
      near = null;
      if (on) {
        let bd = 7;
        for (const p of portals) { const d = Math.hypot(p.X - S.x, p.Z - S.z); if (d < bd) { bd = d; near = { portal: p }; } }
        if (!near && !quest && people) { const g = people.questNear(S.x, S.z, 6); if (g) near = { giver: g }; }
      }
      const show = near && kmh < 45 && !busy();
      prompt.classList.toggle('hide', !show);
      if (show) prompt.querySelector('span').textContent = near.giver ? `รับเควส · ${near.giver.name}` : near.portal.d.name;
      if (show) prompt.querySelector('.key').style.backgroundPosition = `0 -${Math.floor(now / 250) % 2 * 60}px`;
      for (const p of portals) p.group.children[1].rotation.y += dt * 0.6;
      // the delivery under way: clock, distance, arrow; the goal reached in time or not
      if (quest && on) {
        quest.left -= dt; const dx = quest.X - S.x; const dz = quest.Z - S.z; const d = Math.hypot(dx, dz);
        const cv = qbar.querySelector('canvas'); const g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height); hud.digits(g, 'time', fmtTime(Math.max(0, quest.left)), cv.width / 2, 1, 'center', 25);
        qbar.querySelector('.goal').textContent = `ส่งของให้ ${quest.giver.name} · อีก ${d > 1000 ? `${(d / 1000).toFixed(2)} กม.` : `${Math.round(d)} ม.`}`;
        qbar.classList.toggle('late', quest.left < 15);
        const fx = Math.sin(S.h); const fz = Math.cos(S.h); const ang = Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz);
        arrow.style.transform = `translateX(-50%) rotate(${ang}rad)`;
        goalMesh.userData.arrow.position.y = 9 + Math.sin(now / 250) * 0.8;
        if (d < 12) finish(true); else if (quest.left <= 0) finish(false);
      }
      if (stampT && now > stampT) { stamp.classList.add('hide'); stampT = 0; }
      if (toastT && now > toastT) { toast.classList.add('hide'); toastT = 0; }
      if (lvT >= 0) { const f = Math.floor((now - lvT) / 70); const fr = hud.ui ? hud.ui.levelup : []; if (f < fr.length) lvup.src = pic(fr[f]); else if (now - lvT > 2600) { lvup.classList.add('hide'); lvT = -1; } }
    },
    // markers on the round minimap, drawn the way city.drawMinimap places the map: portals, quest givers, the goal
    drawMinimap(g, S, size, radius) {
      const s = size / 2 / radius; const c = Math.cos(S.h) * s; const sn = Math.sin(S.h) * s;
      const at = (X, Z, clamp) => {
        const dx = X - S.x; const dy = S.z - Z; let px = -c * dx - sn * dy; let py = -sn * dx + c * dy; const r = Math.hypot(px, py); const R = size / 2 - 8;
        if (r > R) { if (!clamp) return null; px *= R / r; py *= R / r; }
        return [px + size / 2, py + size / 2];
      };
      const dot = hud.img.npcdot;
      for (const q of people ? people.givers : []) { const p = at(q.X, q.Z); if (p && dot && dot.complete) g.drawImage(dot, 0, 26, 12, 12, p[0] - 7, p[1] - 7, 14, 14); }
      for (const q of portals) { const p = at(q.X, q.Z); const im = hud.img[q.d.pic]; if (p && im && im.complete) g.drawImage(im, 0, 0, 128, 128, p[0] - 10, p[1] - 10, 20, 20); }
      if (quest) { const p = at(quest.X, quest.Z, true); const k = 1 + 0.2 * Math.sin(performance.now() / 200); if (dot && dot.complete) g.drawImage(dot, 0, 52, 12, 12, p[0] - 9 * k, p[1] - 9 * k, 18 * k, 18 * k); }
    },
  };
}
