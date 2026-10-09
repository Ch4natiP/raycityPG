// "Check before the game": a car folder (Map rel → Uint8Array) against everything known to break a car
// in RayCity (2026-10 tests): missing files, broken .0m files, too many vertices per file, single-
// triangle pieces, pieces the garage animates, paint mask, size, textures.
import { parseOM } from './om.js';
import { decodeSpec } from './carSpec.js';

const TESTED_OK = 3631; // vertices per file seen working in game
const CRASH = 8000; // seen crashing

const omOf = (b) => parseOM(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

async function imagePixels(bytes) {
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  return { w: c.width, h: c.height, data: g.getImageData(0, 0, c.width, c.height).data };
}

function ddsInfo(b) {
  if (!b || b.length < 128) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint32(0, true) !== 0x20534444) return null;
  return { h: dv.getUint32(12, true), w: dv.getUint32(16, true), fourcc: String.fromCharCode(b[84], b[85], b[86], b[87]) };
}

// Returns [{ level: 'ok' | 'warn' | 'bad', text }].
export async function checkCar(files, name, template = null) {
  const out = [];
  const ok = (text) => out.push({ level: 'ok', text });
  const warn = (text) => out.push({ level: 'warn', text });
  const bad = (text) => out.push({ level: 'bad', text });

  // Name.
  if (!/^[a-z0-9_]+$/.test(name)) bad(`ชื่อรถ "${name}" ต้องเป็น a-z 0-9 _ ตัวเล็กเท่านั้น`);
  else ok(`ชื่อรถ ${name} ใช้ได้ (แพ็กเป็น ${name}.jmd)`);

  // Files the game opens.
  const need = ['body_0.0m', 'body_1.0m', 'body_2.0m', `${name}_base.png`, `${name}_base_s.dds`, `${name}_color.png`, `${name}_color_s.dds`, 'mesh.xml'];
  const missing = need.filter((r) => !files.has(r));
  const dirs = [...new Set([...files.keys()].filter((r) => r.includes('/')).map((r) => r.split('/')[0]))].filter((d) => !/^(dooropen|icon)$/i.test(d));
  for (const d of dirs) {
    const list = files.get(`${d}/list.xml`);
    if (!list) { missing.push(`${d}/list.xml`); continue; }
    const text = decodeSpec(list);
    for (const m of text.matchAll(/<part\b[^>]*mesh='([^']*)'[^>]*tex='([^']*)'/g)) {
      for (let l = 0; l < 3; l++) if (!files.has(`${d}/${m[1]}_${l}.0m`)) missing.push(`${d}/${m[1]}_${l}.0m`);
      if (m[2] && !files.has(`${d}/${m[2]}.png`)) missing.push(`${d}/${m[2]}.png`);
      if (m[2] && !files.has(`${d}/${m[2]}_s.dds`)) missing.push(`${d}/${m[2]}_s.dds`);
    }
    if (!/<part\b/.test(text)) warn(`${d}/list.xml ไม่มีรายการชิ้นส่วน`);
    if (/gtv98|escarabajo/.test(text) && name !== 'gtv98') warn(`${d}/list.xml ยังมีชื่อรถเก่าอยู่ข้างใน`);
  }
  if (template) {
    const tplDirs = new Set([...template.files.keys()].filter((r) => r.includes('/')).map((r) => r.split('/')[0]));
    for (const d of tplDirs) if (!dirs.includes(d) && !/^(dooropen|icon)$/i.test(d)) missing.push(`${d}/ (ทั้งโฟลเดอร์)`);
    if (!files.has('dooropen/default.xml') && template.files.has('dooropen/default.xml')) missing.push('dooropen/default.xml');
  }
  if (missing.length) bad(`ไฟล์ขาด ${missing.length} ไฟล์: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ' …' : ''}`);
  else ok('ไฟล์ครบทุกไฟล์ที่เกมเปิด');
  if ([...files.keys()].some((r) => !r.includes('/') && /\.xml$/i.test(r) && r !== 'mesh.xml')) warn('มีไฟล์สเปค .xml อยู่ในโฟลเดอร์ (ปกติย้ายออกไปไว้อีกที่ก่อนแพ็ก)');

  // Every .0m.
  let worst = 0; let worstRel = ''; let broken = 0; let tiny = 0; let flagsDiff = 0;
  const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const [rel, b] of files) {
    if (!rel.endsWith('.0m')) continue;
    let om;
    try { om = omOf(b); } catch { broken++; continue; }
    const nv = om.positions.length / 3;
    if (nv > worst) { worst = nv; worstRel = rel; }
    for (const s of om.submeshes) if (s.vertexCount < 6) tiny++;
    if (/_2\.0m$/.test(rel) && (rel.startsWith('body') || /\/default_2\.0m$/.test(rel))) {
      for (let i = 0; i < om.positions.length; i += 3) for (let k = 0; k < 3; k++) { box.min[k] = Math.min(box.min[k], om.positions[i + k]); box.max[k] = Math.max(box.max[k], om.positions[i + k]); }
    }
    // The garage animates the template's moving pieces (doors, hood...): same pieces needed.
    const tplRel = template && [...template.files.keys()].find((r) => r.replace(template.name, name) === rel);
    if (tplRel) {
      const t = omOf(template.files.get(tplRel));
      const moving = (sm) => sm.submeshes.filter((s) => s.flags[1] || s.flags[2]).map((s) => s.flags.join(',')).join(' ');
      if (moving(t) !== moving(om)) flagsDiff++;
    }
  }
  if (broken) bad(`ไฟล์ .0m เสีย ${broken} ไฟล์ (อ่านไม่ได้)`);
  if (worst > CRASH) bad(`${worstRel} มี ${worst.toLocaleString()} จุด เกิน ${CRASH.toLocaleString()} ที่เคยเด้ง`);
  else if (worst > TESTED_OK) warn(`${worstRel} มี ${worst.toLocaleString()} จุด เกินที่เคยผ่าน (${TESTED_OK.toLocaleString()}) ยังไม่รู้ว่าเด้งไหม`);
  else ok(`จุดต่อไฟล์สูงสุด ${worst.toLocaleString()} (${worstRel}) ไม่เกิน ${TESTED_OK.toLocaleString()} ที่เคยผ่าน`);
  if (tiny) bad(`มีชิ้นเล็กกว่า 6 จุด ${tiny} ชิ้น (สามเหลี่ยมเดี่ยว เคยทำเกมเด้งตอนเปิดโรงรถ)`);
  else ok('ไม่มีชิ้นสามเหลี่ยมเดี่ยว');
  if (flagsDiff) bad(`ชิ้นที่โรงรถขยับ (ประตู/ฝากระโปรง) ไม่ตรงกับรถแม่แบบ ${flagsDiff} ไฟล์ (เคยทำเด้งตอนเปิดหน้ารถ)`);
  else if (template) ok('ชิ้นที่โรงรถขยับ ตรงกับรถแม่แบบ');

  // Size and placement.
  if (box.min[0] < Infinity) {
    const len = box.max[1] - box.min[1]; const wid = box.max[0] - box.min[0];
    if (len > 8.5) warn(`รถยาว ${len.toFixed(2)} ม. (ที่เคยผ่านยาวสุด 8.5 ม.)`);
    else ok(`ขนาด ยาว ${len.toFixed(2)} × กว้าง ${wid.toFixed(2)} × สูง ${box.max[2].toFixed(2)} ม.`);
    if (box.min[2] < -0.1 || box.min[2] > 0.5) warn(`ใต้ท้องรถอยู่ที่ ${box.min[2].toFixed(2)} ม. (ควรใกล้ 0–0.3 ไม่งั้นรถจมหรือลอย)`);
    if (Math.abs(box.max[0] + box.min[0]) > 0.1) warn('รถไม่อยู่กลาง (ซ้าย-ขวาไม่เท่ากัน)');
  }

  // Paint mask: how much of the body samples red (the garage colour).
  const mask = files.get(`${name}_base.png`);
  const body = files.get('body_2.0m');
  if (mask && body) {
    try {
      const img = await imagePixels(mask);
      const om = omOf(body);
      let red = 0; let n = 0; let strip = 0; let flat = 0; let tris = 0;
      for (const s of om.submeshes) {
        for (let i = s.indexStart; i + 2 < s.indexStart + s.indexCount; i += 3) {
          const [a, b, c] = [0, 1, 2].map((k) => om.indices[i + k] + s.vertexStart);
          const area = (om.uvs[b * 2] - om.uvs[a * 2]) * (om.uvs[c * 2 + 1] - om.uvs[a * 2 + 1]) - (om.uvs[c * 2] - om.uvs[a * 2]) * (om.uvs[b * 2 + 1] - om.uvs[a * 2 + 1]);
          if (Math.abs(area) < 1e-12) flat++;
          tris++;
        }
      }
      for (let i = 0; i < om.uvs.length; i += 2) {
        const u = om.uvs[i]; const v = om.uvs[i + 1];
        const x = Math.min(img.w - 1, Math.max(0, Math.floor((((u % 1) + 1) % 1) * img.w)));
        const y = Math.min(img.h - 1, Math.max(0, Math.floor((((v % 1) + 1) % 1) * img.h)));
        if (img.data[(y * img.w + x) * 4] > 128) red++;
        if (v < 1 / 32) strip++;
        n++;
      }
      const pct = Math.round((red / Math.max(1, n)) * 100);
      if (flat > tris * 0.3) bad(`UV แบน: ${Math.round((flat / tris) * 100)}% ของสามเหลี่ยมมีทุกมุมอยู่จุดเดียวบนรูป (แบบที่ในเกมเป็นสีดำ/เทาโปร่ง และเปลี่ยนสีไม่ได้) · สร้างใหม่ด้วยเว็บเวอร์ชันนี้`);
      else if (strip > n * 0.9) warn('สีรถอ่านจากแถบเล็กบนสุดของมาสก์ (แบบเก่า) · สร้างใหม่ด้วยเว็บเวอร์ชันนี้');
      else if (pct < 20) warn(`ตัวถังเปลี่ยนสีได้แค่ ${pct}% (ส่วนที่เหลือเป็นสีดำตายตัว)`);
      else ok(`ตัวถังส่วนที่เปลี่ยนสีได้ประมาณ ${pct}%`);
    } catch { warn('อ่านรูปมาสก์สีไม่ได้'); }
  }

  // Textures: DXT3, same size as the PNG.
  const ddsBad = [];
  for (const [rel, b] of files) {
    if (!rel.endsWith('_s.dds')) continue;
    const i = ddsInfo(b);
    if (!i || i.fourcc !== 'DXT3') ddsBad.push(rel);
  }
  if (ddsBad.length) bad(`ไฟล์ .dds ผิดรูปแบบ (ต้องเป็น DXT3): ${ddsBad.slice(0, 5).join(', ')}`);
  else ok('ไฟล์ .dds เป็น DXT3 ทุกไฟล์ (แบบเดียวกับรถในเกม)');

  return out;
}

export function renderChecks(el, list) {
  el.innerHTML = '';
  const icon = { ok: '✅', warn: '⚠️', bad: '❌' };
  const badN = list.filter((c) => c.level === 'bad').length;
  const warnN = list.filter((c) => c.level === 'warn').length;
  const head = document.createElement('div');
  head.className = `check-head ${badN ? 'bad' : warnN ? 'warn' : 'ok'}`;
  head.textContent = badN ? `❌ ยังไม่พร้อม: แก้ ${badN} ข้อก่อนใส่เกม` : warnN ? `⚠️ ใส่เกมได้ แต่มี ${warnN} ข้อที่ควรระวัง` : '✅ พร้อมใส่เกม ผ่านทุกข้อ';
  el.appendChild(head);
  for (const c of list) {
    const row = document.createElement('div');
    row.className = `check-row ${c.level}`;
    row.textContent = `${icon[c.level]} ${c.text}`;
    el.appendChild(row);
  }
}
