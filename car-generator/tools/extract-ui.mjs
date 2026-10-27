// Pulls the game's own interface pictures out of the game folder for RayCity Drive's screen (ui/): the player plate,
// SP gauge, dashboard, minimap ring, menu buttons, the portal signs (shop, garage, town, race, gas), the quest
// windows, stamps and timer digits, the level-up effect. Writes js/drive/rc-ui.js:
//   window.RC_UI = { pics: { name: PNG data URL }, digits: { name: font }, buttons: { name: frames } }
// digits from the game's <valdigit> files: { pic, str, u: [[u0, u1] per char], v: [[v0, v1] per char], space }
// buttons from its <button> files: { pic, w, h, x, y, dx, dy, rows } (frame i: column i / rows, row i % rows)
// Usage: node tools/extract-ui.mjs "<game folder (the one holding ui/)>"
import fs from 'node:fs';
import path from 'node:path';
import { dds, png, tga } from './img-lib.mjs';

const game = process.argv[2];
const UI = game && path.join(game, 'ui');
if (!UI || !fs.existsSync(UI)) { console.error('usage: node tools/extract-ui.mjs <game folder>'); process.exit(1); }

// file names in the game differ in case from the lists; find them without it
const find = (rel) => {
  let dir = UI;
  for (const part of rel.split('/')) {
    const hit = fs.existsSync(dir) && fs.readdirSync(dir).find((x) => x.toLowerCase() === part.toLowerCase());
    if (!hit) return null; dir = path.join(dir, hit);
  }
  return dir;
};
const text = (f) => { const b = fs.readFileSync(f); return b[0] === 0xff && b[1] === 0xfe ? b.toString('utf16le') : b.toString('utf8'); };
const attrs = (t, tag) => { const m = new RegExp(`<${tag}\\b([^>]*)>`, 's').exec(t); if (!m) return null; const o = {}; for (const a of m[1].matchAll(/(\w+)\s*=\s*'([^']*)'/g)) o[a[1]] = a[2]; return o; };

// RGBA → PNG data URL, box-filtered down by an integer factor when asked
function pic(rel, down = 1) {
  const f = find(rel); if (!f) { console.warn(`missing ui/${rel}`); return null; }
  const b = fs.readFileSync(f); const ext = path.extname(f).toLowerCase();
  if (ext === '.png') return `data:image/png;base64,${b.toString('base64')}`;
  let { w, h, data } = ext === '.dds' ? dds(b) : tga(b);
  if (down > 1) {
    const W = Math.floor(w / down); const H = Math.floor(h / down); const o = Buffer.alloc(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      // alpha-weighted, so the clear edge pixels don't darken the colours
      let r = 0; let g = 0; let bl = 0; let a = 0;
      for (let dy = 0; dy < down; dy++) for (let dx = 0; dx < down; dx++) { const i = ((y * down + dy) * w + x * down + dx) * 4; const al = data[i + 3]; r += data[i] * al; g += data[i + 1] * al; bl += data[i + 2] * al; a += al; }
      const q = (y * W + x) * 4; if (a) { o[q] = r / a; o[q + 1] = g / a; o[q + 2] = bl / a; } o[q + 3] = a / (down * down);
    }
    w = W; h = H; data = o;
  }
  return `data:image/png;base64,${png(w, h, 4, data).toString('base64')}`;
}
function digits(xml, picName) {
  const t = text(find(xml)); const m = attrs(t, 'map'); const tx = attrs(t, 'tex');
  const range = (s) => (s ? s.trim().split(/\s+/).map(Number) : null);
  const str = m.str; const u = []; const v = [];
  for (let i = 0; i < str.length; i++) { u.push(range(m[`u${i}`]) || range(m.u)); v.push(range(m[`v${i}`]) || range(m.v)); }
  return { pic: picName, str, u, v, space: +(tx.space || 0) };
}
function button(xml, picName) {
  const t = text(find(xml)); const tx = attrs(t, 'tex'); const ar = attrs(t, 'arrange');
  return { pic: picName, w: +tx.width, h: +tx.height, x: +ar.x, y: +ar.y, dx: +ar.width, dy: +ar.height, rows: +ar.row || 1 };
}

const pics = {}; const fonts = {}; const buttons = {};
const add = (name, rel, down) => { const p = pic(rel, down); if (p) pics[name] = p; };
// player plate (level, EXP, car, money) and the SP gauge
add('plate', 'portrait/portrait_bg.png'); add('sp', 'portrait/sp_graph.png');
add('f_level', 'portrait/font_level.png'); fonts.level = digits('portrait/font_level.xml', 'f_level');
add('f_money', 'portrait/font_money.png'); fonts.money = digits('portrait/font_money.xml', 'f_money');
add('f_sp', 'portrait/font_sp.png'); fonts.sp = digits('portrait/font_sp.xml', 'f_sp');
// dashboard: km/h and gear over the RPM bars
add('dash', 'dashboard/bg_dashboard.png'); add('rpm', 'dashboard/rpmgauge.tga');
add('f_speed', 'dashboard/font_speed.tga'); fonts.speed = digits('dashboard/speed_digit.xml', 'f_speed');
add('f_gear', 'dashboard/font_gear.tga'); fonts.gear = digits('dashboard/gear_digit.xml', 'f_gear');
// minimap ring with its N, my car's arrow, the NPC dots
add('compass', 'minimap/minimap_compass.tga'); add('mycar', 'minimap/marker_mycar.tga'); add('npcdot', 'minimap/marker_npc.png');
// menu buttons (bottom left): MENU, cash shop, go to town, race, quest
for (const [k, f] of [['menu', 'main'], ['cash', 'ingame_cut_cash'], ['town', 'ingame_cut_town'], ['race', 'ingame_cut_race'], ['quest', 'ingame_cut_quest']]) {
  add(`b_${k}`, `mainmenu/${f}.png`); buttons[k] = button(`mainmenu/${f}.xml`, `b_${k}`);
}
// portal signs: the octagon (left half) and its light column (right half)
for (const k of ['shop', 'garage', 'town', 'racing', 'gassta']) add(`p_${k}`, `portal/${k}_icon.tga`);
add('enter', 'portal/enterkey.png'); buttons.enter = button('portal/enterkey.xml', 'enter');
// quests: the paper window, name strip, NPC faces, timer digits, the result stamps, the arrow to the goal
add('q_paper', 'missionquest/quest_dialog_info_bg.png'); add('q_name', 'missionquest/quest_npc_name_back.png'); add('q_icon', 'missionquest/quest_green_icon.png');
add('q_done', 'missionquest/questcompletedstamp.png'); add('q_bar', 'missionquest/quest_bar.png');
add('f_time', 'missionquest/timelimit_big.tga'); fonts.time = digits('missionquest/timelimit_big.xml', 'f_time');
for (const k of ['excellent', 'great', 'good', 'normal', 'poor', 'fail']) add(`st_${k}`, `missionquest/stamp_${k}.tga`);
add('arrow', 'fieldinterface/green_arrow.dds'); add('dest', 'missionquest/missiondest.png');
const faces = [];
for (const f of fs.readdirSync(find('missionquest/quest')).sort()) {
  const m = /^quest_([a-z.-]+)\.png$/i.exec(f); if (!m || /^(back|baese|call|level|name|new|npc_bg|phone|qra|rp|small_x|favorites|cellphone)/i.test(m[1])) continue;
  add(`face_${faces.length}`, `missionquest/quest/${f}`); faces.push(m[1]);
}
// level up: the game's 14-frame burst, halved
const lv = [];
for (let i = 1; i <= 14; i++) { const k = `lvup_${i}`; add(k, `portrait/levelupeffect/user_levelup_${String(i).padStart(5, '0')}.dds`, 2); if (pics[k]) lv.push(k); }

const json = JSON.stringify({ pics, digits: fonts, buttons, faces, levelup: lv });
fs.writeFileSync(new URL('../js/drive/rc-ui.js', import.meta.url), `window.RC_UI = ${json};\n`);
console.log(`${Object.keys(pics).length} pictures, ${Object.keys(fonts).length} digit fonts, ${Object.keys(buttons).length} buttons, ${faces.length} faces; rc-ui.js ${(json.length / 1024).toFixed(0)} KB`);
