// The game's own screen for RayCity Drive, drawn from its interface pictures (ui/, pulled out by
// tools/extract-ui.mjs into js/drive/rc-ui.js): the player plate (level, name, EXP, car, money), the SP gauge,
// the dashboard (km/h, gear, RPM bars), the minimap's compass ring and the menu buttons. Each panel is a canvas at
// the picture's own size (×S for the screen); digits come from the game's digit fonts. Without rc-ui.js the
// panels fall back to plain shapes and text.

const UI = window.RC_UI || null;
const img = {};
if (UI) for (const [k, src] of Object.entries(UI.pics)) { img[k] = new Image(); img[k].src = src; }
const ready = (k) => img[k] && img[k].complete && img[k].naturalWidth > 0;

// screen scale: the game's pictures at 1× on a 720-high screen, smaller on phones
const scale = () => Math.max(0.62, Math.min(1.3, window.innerHeight / 720));

function panel(el, w, h) {
  const cv = document.createElement('canvas'); el.append(cv);
  const p = { cv, g: cv.getContext('2d'), w, h };
  p.fit = () => { const s = scale(); const d = Math.min(2, window.devicePixelRatio || 1); cv.width = Math.round(w * s * d); cv.height = Math.round(h * s * d); cv.style.width = `${w * s}px`; cv.style.height = `${h * s}px`; p.g.setTransform(s * d, 0, 0, s * d, 0, 0); p.g.imageSmoothingEnabled = true; };
  p.fit(); return p;
}
// text in one of the game's digit fonts (fonts[name]: pic, str, u, v ranges per char, space), at x (left, centre or
// right), y = top; height h in screen pixels (the font's own when omitted). Plain bold text when the font is missing.
function digits(g, name, str, x, y, align = 'left', h = 0) {
  const f = UI && UI.digits[name];
  if (!f || !ready(f.pic)) {
    g.font = `800 italic ${h || 14}px system-ui, sans-serif`; g.textAlign = align; g.textBaseline = 'top'; g.fillStyle = '#fff';
    g.strokeStyle = 'rgba(0,0,0,.7)'; g.lineWidth = 3; g.strokeText(str, x, y); g.fillText(str, x, y); return;
  }
  const chars = [...str].map((c) => f.str.indexOf(c)); const fh = f.v[0][1] - f.v[0][0]; const k = h ? h / fh : 1;
  let w = 0; for (const i of chars) if (i >= 0) w += (f.u[i][1] - f.u[i][0] + f.space) * k; else w += fh * 0.3 * k;
  let cx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  for (const i of chars) {
    if (i < 0) { cx += fh * 0.3 * k; continue; }
    const [u0, u1] = f.u[i]; const [v0, v1] = f.v[i];
    g.drawImage(img[f.pic], u0, v0, u1 - u0, v1 - v0, cx, y, (u1 - u0) * k, (v1 - v0) * k); cx += (u1 - u0 + f.space) * k;
  }
}
const money = (n) => Math.round(n).toLocaleString('en-US');
// a frame of one of the game's button sheets on an element, drawn at size px (the sheet's own cell size when 0)
function sprite(el, name, i, size = 0) {
  const d = UI && UI.buttons[name]; if (!d) return false;
  const k = size ? size / d.w : 1; const col = Math.floor(i / d.rows); const row = i % d.rows;
  el.style.backgroundImage = `url(${UI.pics[d.pic]})`; el.style.backgroundRepeat = 'no-repeat';
  el.style.backgroundPosition = `-${(d.x + col * d.dx) * k}px -${(d.y + row * d.dy) * k}px`;
  if (size) { const im = img[d.pic]; el.style.backgroundSize = `${(im.naturalWidth || 128) * k}px auto`; } else { el.style.width = `${d.w}px`; el.style.height = `${d.h}px`; }
  return true;
}

export function createHud() {
  const $ = (id) => document.getElementById(id);
  // --- player plate (portrait_bg: the round badge, EXP bar at 76–214 × 21–28, car row, car EXP 92–214 × 53–60,
  // money 92–214 × 67–75)
  const plateEl = $('plate'); plateEl.textContent = ''; plateEl.classList.add('game');
  const plate = panel(plateEl, 220, 80);
  let P = { name: 'RayCity PG', level: 1, exp: 0, car: '', carExp: 0, money: 0 };
  function drawPlate() {
    const { g } = plate; g.clearRect(0, 0, 256, 128);
    if (ready('plate')) g.drawImage(img.plate, 0, 0);
    else { g.fillStyle = 'rgba(14,18,28,.8)'; g.beginPath(); g.arc(30, 33, 28, 0, Math.PI * 2); g.fill(); g.fillRect(60, 18, 156, 60); }
    // the badge: dark red under the level number
    const rg = g.createRadialGradient(26, 26, 2, 30, 33, 25); rg.addColorStop(0, '#d8402e'); rg.addColorStop(0.7, '#6d0d0d'); rg.addColorStop(1, '#2a0606');
    g.fillStyle = rg; g.beginPath(); g.arc(30, 33, 24, 0, Math.PI * 2); g.fill();
    digits(g, 'level', String(P.level), 30, 30, 'center', 17);
    g.font = '700 10px system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.75)';
    g.strokeText(P.name, 82, 15); g.fillStyle = '#ffe24a'; g.fillText(P.name, 82, 15);
    const bar = (x0, x1, y0, y1, v, c0, c1) => { const gr = g.createLinearGradient(x0, 0, x1, 0); gr.addColorStop(0, c0); gr.addColorStop(1, c1); g.fillStyle = gr; g.fillRect(x0, y0, (x1 - x0) * Math.max(0, Math.min(1, v)), y1 - y0); };
    bar(77, 214, 21, 28, P.exp, '#c98a00', '#ffe066'); digits(g, 'sp', `${(P.exp * 100).toFixed(2)}%`, 146, 20, 'center', 9);
    if (P.car) { g.font = '700 9px system-ui, sans-serif'; g.strokeText(P.car, 92, 47); g.fillStyle = '#ffffff'; g.fillText(P.car, 92, 47); }
    bar(93, 214, 53, 60, P.carExp, '#2b8fd8', '#7fe0ff'); digits(g, 'sp', `${(P.carExp * 100).toFixed(2)}%`, 153, 52, 'center', 9);
    digits(g, 'money', money(P.money), 98, 64, 'left', 12);
  }

  // --- SP gauge (sp_graph: frame 0–228 × 0–14, the fill swatch at 4–30 × 17–24 stretched over 24–226)
  const spEl = $('sp'); spEl.textContent = ''; spEl.classList.add('game');
  const sp = panel(spEl, 230, 15);
  let spLast = '';
  function drawSp(v, max, on) {
    const key = `${Math.round(v)}|${max}|${on}`; if (key === spLast) return; spLast = key;
    const { g } = sp; g.clearRect(0, 0, 256, 64);
    if (ready('sp')) { g.drawImage(img.sp, 0, on ? 28 : 0, 228, 14, 0, 0, 228, 14); g.drawImage(img.sp, 4, 17, 26, 8, 25, 3, 200 * (v / max), 8); }
    else { g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(24, 1, 204, 12); g.fillStyle = on ? '#2cf0ff' : '#8a3cff'; g.fillRect(25, 3, 200 * (v / max), 8); }
    digits(g, 'sp', `${Math.round(v)}/${max}`, 125, 1, 'center', 11);
  }

  // --- dashboard (bg_dashboard 88–256 × 48–112: km/h and gear labels, fuel, the RPM ticks at y 98–104; the speed
  // left of km/h like the game's, rpmgauge's lit bars laid over the ticks, cut at the RPM)
  const dashEl = $('speed'); dashEl.textContent = ''; dashEl.classList.add('game');
  const dash = panel(dashEl, 168, 64);
  let dashLast = '';
  function drawDash(kmh, gear, rpm) {
    const key = `${kmh}|${gear}|${Math.round(rpm * 40)}`; if (key === dashLast) return; dashLast = key;
    const { g } = dash; g.clearRect(0, 0, 256, 128);
    if (ready('dash')) g.drawImage(img.dash, 88, 48, 168, 64, 0, 0, 168, 64);
    else { g.fillStyle = 'rgba(10,60,70,.8)'; g.fillRect(0, 2, 168, 62); }
    // the lit bars on the tick row (panel 32–118 × 50–56), as far as the RPM
    if (ready('rpm')) { const w = 132 * Math.max(0, Math.min(1, rpm)); if (w > 0) g.drawImage(img.rpm, 0, 18, w, 8, 32, 50, w * 0.65, 6); }
    digits(g, 'speed', String(kmh), 84, 12, 'right', 34);
    digits(g, 'gear', String(gear), 140, 28, 'center', 18);
  }

  // --- minimap: the game's compass ring (with its N) turns with the car; my car's arrow in the middle
  const ring = $('mini-n'); const mm = $('minimap');
  if (ready('compass') || UI) { ring.textContent = ''; const r = document.createElement('img'); r.src = UI ? UI.pics.compass : ''; r.className = 'compass'; ring.append(r); mm.classList.add('game'); }
  const me = mm.querySelector('.me'); if (UI && UI.pics.mycar) { me.classList.add('game'); me.style.backgroundImage = `url(${UI.pics.mycar})`; }

  // --- menu buttons (bottom left): the game's MENU, cash shop, town, race and quest buttons (normal / hover / pressed)
  const bar = $('menubar'); const buttons = {};
  for (const [k, title] of [['menu', 'เมนู (Esc)'], ['cash', 'ร้านค้า'], ['town', 'ไป TOWN'], ['race', 'แข่งขัน'], ['quest', 'เควส']]) {
    const b = document.createElement('button'); b.className = 'gbtn'; b.title = title; bar.append(b); buttons[k] = b;
    if (!sprite(b, k, 0)) { b.textContent = title; continue; }
    b.addEventListener('pointerenter', () => sprite(b, k, 1)); b.addEventListener('pointerleave', () => sprite(b, k, 0));
    b.addEventListener('pointerdown', () => sprite(b, k, 2)); b.addEventListener('pointerup', () => sprite(b, k, 1));
  }
  // the skill keys after them, like the game's slots: Ctrl boost, Shift drift, Space jump (frame 0 ready, 1 on,
  // 2 not now); the phone's pad buttons wear the same pictures
  const skills = {}; const skillState = {};
  const gap = document.createElement('i'); gap.className = 'gap'; bar.append(gap);
  for (const [k, title] of [['boost', 'บูสต์ (Ctrl) · SP 50'], ['drift', 'ดริฟต์ (Shift)'], ['jump', 'กระโดด (Space)']]) {
    const b = document.createElement('button'); b.className = 'gbtn skill'; b.title = title; b.dataset.k = k === 'drift' ? 'hand' : k; bar.append(b); skills[k] = b;
    if (!sprite(b, `s_${k}`, 0)) b.textContent = title.split(' ')[0];
    const pad = document.querySelector(`#pad-right button[data-k="${b.dataset.k}"]`);
    if (pad && UI && UI.buttons[`s_${k}`]) { pad.textContent = ''; pad.classList.add('skin'); }
  }
  function setSkills(st) {
    for (const [k, v] of Object.entries(st)) {
      if (skillState[k] === v) continue; skillState[k] = v; const f = { ready: 0, on: 1, off: 2 }[v];
      sprite(skills[k], `s_${k}`, f);
      const pad = document.querySelector(`#pad-right button.skin[data-k="${k === 'drift' ? 'hand' : k}"]`); if (pad) sprite(pad, `s_${k}`, f, pad.clientWidth || 58);
    }
  }

  const refit = () => { for (const p of [plate, sp, dash]) p.fit(); drawPlate(); spLast = ''; dashLast = ''; document.documentElement.style.setProperty('--ui', scale()); };
  window.addEventListener('resize', refit);
  for (const k of Object.keys(img)) img[k].addEventListener('load', () => { drawPlate(); spLast = ''; dashLast = ''; }, { once: true });
  refit();

  return {
    game: !!UI,
    pics: UI ? UI.pics : {},
    ui: UI,
    img,
    digits,
    buttons,
    skills,
    setSkills,
    plate(p) { P = { ...P, ...p }; drawPlate(); },
    sp: drawSp,
    dash: drawDash,
  };
}
