/* ECU Tuner app — UI glue */
'use strict';
(() => {
const $ = id => document.getElementById(id);
const { SerialLink, SimLink, hex, sleep } = Link;
const store = {
  get(k, d) { try { const v = localStorage.getItem('ecu.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ecu.' + k, JSON.stringify(v)); } catch {} },
};
function toast(msg, ms = 2600) { const t = $('toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => t.style.display = 'none', ms); }
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------- settings / branding ----------------
const settings = { brand: 'PG PERFORMANCE', logo: 'PG', proto: 'honda', poll: 120, ...store.get('settings', {}) };
function applyBrand() {
  $('brandName').textContent = settings.brand; $('heroName').textContent = settings.brand;
  $('logoTxt').textContent = settings.logo; $('foot').textContent = `${settings.brand} · ECU TUNER`;
  document.title = `${settings.brand} ECU Tuner`;
  $('sBrand').value = settings.brand; $('sLogo').value = settings.logo; $('sProto').value = settings.proto; $('sPoll').value = settings.poll;
}
$('sSave').onclick = () => {
  Object.assign(settings, { brand: $('sBrand').value.trim() || 'PG PERFORMANCE', logo: $('sLogo').value.trim() || 'PG', proto: $('sProto').value, poll: Math.max(50, +$('sPoll').value || 120) });
  store.set('settings', settings); applyBrand(); toast('บันทึกแล้ว');
};
applyBrand();

// ---------------- navigation ----------------
function go(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('on', p.id === 'p-' + page));
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.go === page));
  if (page === 'files') renderFiles();
  if (page !== 'live') stopLive();
  scrollTo({ top: 0, behavior: 'smooth' });
}
document.addEventListener('click', e => { const el = e.target.closest('[data-go]'); if (el) go(el.dataset.go); });

// ---------------- file library (IndexedDB) ----------------
const db = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('ecu-tuner', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction('files', mode); const q = fn(t.objectStore('files')); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
  return {
    add: f => tx('readwrite', s => s.add({ ...f, date: Date.now() })),
    all: () => tx('readonly', s => s.getAll()),
    get: id => tx('readonly', s => s.get(id)),
    del: id => tx('readwrite', s => s.delete(id)),
  };
})();
function download(name, data, type = 'application/octet-stream') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const KIND = { bin: 'ไฟล์แมพ', log: 'Live log', backup: 'สำรอง ECU', term: 'Terminal log', other: 'อื่น ๆ' };
async function renderFiles() {
  const files = (await db.all()).sort((a, b) => b.date - a.date);
  $('filesInfo').textContent = `${files.length} ไฟล์`;
  $('filesBody').innerHTML = files.map(f => `<tr><td>${esc(f.name)}</td><td>${KIND[f.kind] || f.kind}</td><td>${(f.data.byteLength ?? f.data.length).toLocaleString()} B</td><td>${new Date(f.date).toLocaleString('th-TH')}</td>
    <td style="white-space:nowrap">${f.kind === 'bin' ? `<button class="btn" data-open="${f.id}">เปิดใน TabTuner</button> ` : ''}<button class="btn" data-dl="${f.id}">⬇</button> <button class="btn r" data-del="${f.id}">✕</button></td></tr>`).join('')
    || '<tr><td colspan="5" class="muted">ยังไม่มีไฟล์</td></tr>';
}
$('filesBody').onclick = async e => {
  const t = e.target;
  if (t.dataset.dl) { const f = await db.get(+t.dataset.dl); download(f.name, f.data); }
  if (t.dataset.del && confirm('ลบไฟล์นี้?')) { await db.del(+t.dataset.del); renderFiles(); }
  if (t.dataset.open) { const f = await db.get(+t.dataset.open); loadBin(f.name, new Uint8Array(f.data)); go('tuner'); }
};
$('fileImport').onchange = async e => {
  for (const f of e.target.files) { const buf = await f.arrayBuffer(); await db.add({ name: f.name, kind: /\.(bin|rom|ori|hex)$/i.test(f.name) ? 'bin' : 'other', data: buf }); }
  e.target.value = ''; renderFiles(); toast('นำเข้าแล้ว');
};

// ---------------- connection ----------------
let link = null, ecu = { id: null };
function setConn(state, text) {
  $('cDot').className = 'dot ' + (state === 'ok' ? 'ok' : state === 'wait' ? 'wait' : '');
  $('cName').textContent = text;
  $('btnConn').textContent = state === 'ok' ? '⏏ ตัดการเชื่อมต่อ' : '🔌 เชื่อมต่อ';
  $('fk1').textContent = state === 'ok' && ecu.id ? '✅' : '⬜';
}
const termLog = [];
function term(line) {
  const t = new Date().toLocaleTimeString('th-TH', { hour12: false }) + '.' + String(Date.now() % 1000).padStart(3, '0');
  termLog.push(`${t}  ${line}`); if (termLog.length > 3000) termLog.splice(0, 500);
  if ($('p-term').classList.contains('on')) { const ta = $('term'); ta.value = termLog.slice(-400).join('\n'); ta.scrollTop = ta.scrollHeight; }
}

$('btnConn').onclick = () => link ? disconnect() : $('connModal').classList.add('on');
$('cCancel').onclick = () => $('connModal').classList.remove('on');
$('cSerial').onclick = () => {
  $('connModal').classList.remove('on');
  if (!SerialLink.supported()) return alert('เบราว์เซอร์นี้ไม่รองรับ Web Serial\nกรุณาเปิดด้วย Google Chrome หรือ Microsoft Edge บนคอมพิวเตอร์');
  connect(new SerialLink());
};
$('cSim').onclick = () => { $('connModal').classList.remove('on'); connect(new SimLink()); };

async function connect(l) {
  try {
    setConn('wait', 'กำลังเปิดพอร์ต…');
    const name = await l.open({});
    link = l;
    l.onTraffic((dir, bytes) => { if (!livePolling || $('p-term').classList.contains('on')) term(`${dir === 'tx' ? '→' : '←'} ${hex(bytes)}`); });
    setConn('wait', `${name} — กำลังปลุก ECU…`);
    let ok = false;
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      await l.wakeup();
      await l.transact(Honda.CMD.ping(), 150);
      const r = await l.transact(Honda.CMD.init(), 500);
      ok = !!(r && r[0] === 0x02);
      if (!ok) { setConn('wait', `${name} — ECU ไม่ตอบ ลองครั้งที่ ${attempt + 1}…`); await sleep(400); }
    }
    if (!ok) { setConn('wait', `${name} — เปิดพอร์ตแล้ว แต่ ECU ไม่ตอบ`); toast('ECU ไม่ตอบ: เช็กว่าเปิดกุญแจแล้ว, สายเสียบแน่น, เลือกพอร์ตถูก', 6000); $('ecuId').textContent = '—'; return; }
    const id = await l.transact(Honda.CMD.readTable(0x00), 400);
    ecu.id = id ? hex(id.slice(4, -1)) : 'อ่านไม่ได้';
    $('ecuId').textContent = `Honda PGM-FI · ${ecu.id}`;
    setConn('ok', name);
    toast('เชื่อมต่อ ECU สำเร็จ');
  } catch (e) {
    console.error(e);
    link = null; setConn('', 'ยังไม่ได้เชื่อมต่อ');
    if (e && e.name !== 'NotFoundError') toast('เปิดพอร์ตไม่ได้: ' + (e.message || e), 5000);
  }
}
async function disconnect() { stopLive(); const l = link; link = null; ecu.id = null; await l?.close(); setConn('', 'ยังไม่ได้เชื่อมต่อ'); $('ecuId').textContent = '—'; }
function needLink() { if (!link) { $('connModal').classList.add('on'); return false; } return true; }

// ---------------- live data ----------------
let livePolling = false, recording = null;
const hist = [];
async function liveLoop() {
  let n = 0; const t0 = performance.now();
  while (livePolling && link) {
    const t = performance.now();
    const r11 = Honda.decodeTableReply(await link.transact(Honda.CMD.readTable(0x11), 300));
    const r20 = (n % 4 === 0) ? Honda.decodeTableReply(await link.transact(Honda.CMD.readTable(0x20), 300)) : null;
    if (r11) {
      n++;
      const vals = [...r11.values, ...(r20 ? r20.values : (liveLoop.last20 || []))];
      if (r20) liveLoop.last20 = r20.values;
      renderVals(vals);
      const get = k => vals.find(v => v.key === k)?.value ?? 0;
      hist.push({ rpm: get('rpm'), tps: get('tps'), inj: get('inj') }); if (hist.length > 300) hist.shift();
      drawGauge(get('rpm')); drawChart();
      if (recording) recording.push([Date.now(), ...vals.map(v => v.value)]), recording.cols ||= vals.map(v => `${v.name} (${v.unit})`);
      $('liveInfo').textContent = `${(n / ((performance.now() - t0) / 1000)).toFixed(1)} ครั้ง/วิ${recording ? ` • กำลังบันทึก ${recording.length} แถว` : ''}`;
    } else $('liveInfo').textContent = 'ECU ไม่ตอบตาราง 0x11 — รุ่นนี้อาจใช้ตารางอื่น (ดูใน Terminal / สำรองตาราง)';
    await sleep(Math.max(0, settings.poll - (performance.now() - t)));
  }
}
function renderVals(vals) {
  const box = $('vals');
  if (box.children.length !== vals.length) box.innerHTML = vals.map(v => `<div class="val" data-k="${v.key}"><small>${esc(v.name)}</small><b></b><i>${esc(v.unit)}</i><div class="bar"><div></div></div><code></code></div>`).join('');
  vals.forEach((v, i) => {
    const el = box.children[i];
    el.querySelector('b').textContent = v.value;
    el.querySelector('.bar div').style.width = v.max ? Math.max(0, Math.min(100, v.value / v.max * 100)) + '%' : '0';
    el.querySelector('code').textContent = hex(v.raw);
  });
}
function drawGauge(rpm) {
  const c = $('gauge'), g = c.getContext('2d'), W = c.width, cx = W / 2, cy = 290, r = 220, max = 12000;
  g.clearRect(0, 0, W, c.height);
  const a0 = Math.PI * .8, a1 = Math.PI * 2.2, a = a0 + (a1 - a0) * Math.min(1, rpm / max);
  g.lineWidth = 26; g.lineCap = 'round';
  g.strokeStyle = '#231d33'; g.beginPath(); g.arc(cx, cy, r, a0, a1); g.stroke();
  const gr = g.createLinearGradient(cx - r, 0, cx + r, 0); gr.addColorStop(0, '#8b5cf6'); gr.addColorStop(.7, '#ff8a1f'); gr.addColorStop(1, '#ff3b3b');
  g.strokeStyle = gr; g.beginPath(); g.arc(cx, cy, r, a0, a); g.stroke();
  g.fillStyle = '#958ca8'; g.font = '22px Kanit'; g.textAlign = 'center';
  for (let k = 0; k <= 12; k += 2) { const aa = a0 + (a1 - a0) * k / 12; g.fillText(k, cx + Math.cos(aa) * (r - 48), cy + Math.sin(aa) * (r - 48) + 8); }
  g.fillStyle = '#fff'; g.font = '500 76px Kanit'; g.fillText(rpm.toLocaleString(), cx, cy - 10);
  g.fillStyle = '#958ca8'; g.font = '24px Kanit'; g.fillText('RPM', cx, cy + 30);
}
function drawChart() {
  const c = $('chart'), g = c.getContext('2d'), W = c.width, H = c.height;
  g.clearRect(0, 0, W, H);
  g.strokeStyle = '#1e1a29'; g.lineWidth = 1;
  for (let y = 0; y <= 4; y++) { g.beginPath(); g.moveTo(0, H * y / 4); g.lineTo(W, H * y / 4); g.stroke(); }
  const line = (k, max, col) => {
    g.strokeStyle = col; g.lineWidth = 3; g.beginPath();
    hist.forEach((h, i) => { const x = W - (hist.length - 1 - i) * (W / 299), y = H - 6 - (H - 12) * Math.min(1, h[k] / max); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
  };
  line('rpm', 12000, '#ff8a1f'); line('tps', 100, '#a78bfa'); line('inj', 15, '#3ddc84');
}
function stopLive() { livePolling = false; $('liveStart').disabled = false; $('liveStop').disabled = true; }
$('liveStart').onclick = () => { if (!needLink()) return; livePolling = true; $('liveStart').disabled = true; $('liveStop').disabled = false; liveLoop(); };
$('liveStop').onclick = stopLive;
$('liveRec').onclick = async () => {
  if (!recording) { recording = []; $('liveRec').textContent = '⏹ หยุดบันทึก'; return; }
  const rows = recording; recording = null; $('liveRec').textContent = '⏺ บันทึก Log';
  if (!rows.length) return;
  const csv = ['เวลา,' + rows.cols.join(','), ...rows.map(r => [new Date(r[0]).toISOString(), ...r.slice(1)].join(','))].join('\n');
  const name = `live_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
  await db.add({ name, kind: 'log', data: new TextEncoder().encode('﻿' + csv).buffer });
  download(name, '﻿' + csv, 'text/csv'); toast('เก็บ log ในคลังไฟล์แล้ว');
};
drawGauge(0);

// ---------------- DTC ----------------
async function readDtc(cmd) {
  const out = [];
  for (let page = 1; page <= 4; page++) {
    const codes = Honda.decodeDtcReply(await link.transact(cmd(page), 400));
    if (!codes) break;
    out.push(...codes);
    if (codes.length < 3) break;
  }
  return out;
}
$('dtcRead').onclick = async () => {
  if (!needLink()) return;
  $('dtcBody').innerHTML = '<tr><td colspan="3" class="muted">กำลังอ่าน…</td></tr>';
  const now = await readDtc(Honda.CMD.dtcCurrent), past = await readDtc(Honda.CMD.dtcPast);
  const rows = [...now.map(c => [c, 'ปัจจุบัน']), ...past.filter(c => !now.includes(c)).map(c => [c, 'เคยเกิด (ประวัติ)'])];
  $('dtcBody').innerHTML = rows.map(([c, st]) => `<tr><td><span class="code">${c}</span></td><td>${esc(Honda.DTC_TEXT[c] || 'ไม่ทราบความหมาย — ดูคู่มือซ่อมรุ่นนั้น')}</td><td>${st}</td></tr>`).join('')
    || '<tr><td colspan="3"><div class="okbox">✅ ไม่พบรหัสปัญหา</div></td></tr>';
};
$('dtcClear').onclick = async () => {
  if (!needLink() || !confirm('ลบรหัสปัญหาทั้งหมดในกล่อง?')) return;
  const r = await link.transact(Honda.CMD.clearDtc(), 600);
  toast(r ? 'ลบรหัสปัญหาแล้ว — ปิด/เปิดกุญแจแล้วอ่านใหม่อีกครั้ง' : 'ECU ไม่ตอบคำสั่งลบ', 4000);
  $('dtcRead').click();
};

// ---------------- Recovery: table backup ----------------
$('recTables').onclick = async () => {
  if (!needLink()) return;
  const lines = [`# ECU table backup  ${new Date().toISOString()}`, `# link: ${link.name}`, `# ecu id: ${ecu.id}`];
  let found = 0;
  for (let t = 0; t <= 0xFF; t++) {
    $('recInfo').textContent = `กำลังอ่านตาราง 0x${t.toString(16).padStart(2, '0')} … (พบ ${found})`;
    const r = await link.transact(Honda.CMD.readTable(t), 150);
    if (r && r[0] === 0x02 && r[2] === 0x71 && r.length > 5) { lines.push(`${t.toString(16).padStart(2, '0')}: ${hex(r.slice(4, -1))}`); found++; }
  }
  const name = `ecu_tables_${(ecu.id || 'unknown').replace(/\s/g, '')}_${new Date().toISOString().slice(0, 10)}.txt`;
  await db.add({ name, kind: 'backup', data: new TextEncoder().encode(lines.join('\n')).buffer });
  $('recInfo').textContent = `เสร็จ — อ่านได้ ${found} ตาราง เก็บในคลังไฟล์แล้ว (${name})`;
};

// ---------------- Terminal ----------------
$('termSend').onclick = async () => {
  if (!needLink()) return;
  const bytes = ($('termIn').value.match(/[0-9a-f]{2}/gi) || []).map(h => parseInt(h, 16));
  if (!bytes.length) return;
  if ($('termCs').checked) bytes.push(Honda.checksum(bytes));
  const r = await link.transact(bytes, 600);
  if (!r) term('   (ไม่มีคำตอบ / ไม่ใช่เฟรมที่ checksum ถูก)');
};
$('termIn').onkeydown = e => { if (e.key === 'Enter') $('termSend').click(); };
$('termWake').onclick = async () => { if (!needLink()) return; term('-- wake-up --'); await link.wakeup(); };
$('termClear').onclick = () => { termLog.length = 0; $('term').value = ''; };
$('termSave').onclick = async () => { const name = `terminal_${Date.now()}.txt`; await db.add({ name, kind: 'term', data: new TextEncoder().encode(termLog.join('\n')).buffer }); toast('เก็บแล้ว'); };
document.querySelector('[data-go="term"]').addEventListener('click', () => setTimeout(() => { $('term').value = termLog.slice(-400).join('\n'); }, 0));

// ---------------- TabTuner (bin map editor) ----------------
let bin = null, orig = null, binFileName = '';
const savedMaps = store.get('maps', []);
function loadBin(name, data) {
  bin = new Uint8Array(data); orig = new Uint8Array(data); binFileName = name;
  $('binName').textContent = `${name} (${bin.length.toLocaleString()} B)`;
  $('binInfo').textContent = `${bin.length.toLocaleString()} ไบต์`;
  $('binSave').disabled = $('binDl').disabled = $('mfFind').disabled = false;
  $('mfList').innerHTML = ''; renderCmp();
  showMap(); showHex(); checkSum();
}
$('binFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  const buf = await f.arrayBuffer();
  loadBin(f.name, buf);
  await db.add({ name: f.name, kind: 'bin', data: buf });
  e.target.value = '';
};
function mapDef() {
  return { name: $('mName').value.trim() || 'map', off: parseInt($('mOff').value, 16) || 0, rows: Math.max(1, +$('mRows').value | 0), cols: Math.max(1, +$('mCols').value | 0),
           type: $('mType').value, scale: parseFloat($('mScale').value) || 1, axis: $('mAxis').value.trim() ? parseInt($('mAxis').value, 16) : null };
}
const width = t => t === 'u8' ? 1 : 2;
function rd(buf, off, t) { return t === 'u8' ? buf[off] : t === 'u16be' ? (buf[off] << 8) | buf[off + 1] : buf[off] | (buf[off + 1] << 8); }
function wr(buf, off, t, v) {
  v = Math.max(0, Math.min(t === 'u8' ? 255 : 65535, Math.round(v)));
  if (t === 'u8') buf[off] = v; else if (t === 'u16be') { buf[off] = v >> 8; buf[off + 1] = v & 255; } else { buf[off] = v & 255; buf[off + 1] = v >> 8; }
}
let sel = new Set(), dragFrom = null;
function cellOff(m, r, c) { return m.off + (r * m.cols + c) * width(m.type); }
function showMap() {
  if (!bin) return;
  const m = mapDef();
  if (cellOff(m, m.rows - 1, m.cols - 1) + width(m.type) > bin.length) { $('mapWrap').innerHTML = '<p class="muted" style="padding:14px">ตารางเกินขนาดไฟล์ — เช็ก Offset / แถว / คอลัมน์</p>'; return; }
  let lo = Infinity, hi = -Infinity;
  for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) { const v = rd(bin, cellOff(m, r, c), m.type); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  // axis layout (Honda Keihin): [row axis: rows values][column axis: cols values], same element type as the table
  const aw = width(m.type), axOk = m.axis != null && !isNaN(m.axis) && m.axis + (m.rows + m.cols) * aw <= bin.length;
  const yAx = r => axOk ? rd(bin, m.axis + r * aw, m.type) : r, xAx = c => axOk ? rd(bin, m.axis + (m.rows + c) * aw, m.type) : c;
  const thc = axOk ? ' class="ax"' : '';
  let h = '<table class="map"><thead><tr><th>' + (axOk ? 'Y \\ X' : '') + '</th>' + Array.from({ length: m.cols }, (_, c) => `<th${thc}>${xAx(c)}</th>`).join('') + '</tr></thead><tbody>';
  for (let r = 0; r < m.rows; r++) {
    h += `<tr><th${thc}>${yAx(r)}</th>`;
    for (let c = 0; c < m.cols; c++) {
      const o = cellOff(m, r, c), v = rd(bin, o, m.type), ov = rd(orig, o, m.type);
      const k = hi > lo ? (v - lo) / (hi - lo) : .5;
      const hue = 240 - k * 240;                                  // blue (low) → red (high)
      const key = `${r},${c}`;
      const cv = cmp && o + aw <= cmp.length ? rd(cmp, o, m.type) : null;
      const cmpTxt = cv != null && cv !== v ? ` • ไฟล์เทียบ ${+(cv * m.scale).toFixed(3)} (${cv > v ? '+' : ''}${(v ? (cv - v) / v * 100 : 0).toFixed(1)}%)` : '';
      h += `<td data-r="${r}" data-c="${c}" class="${sel.has(key) ? 'sel' : ''} ${v !== ov ? 'chg' : ''} ${cmpTxt ? 'cmpd' : ''}" style="background:hsl(${hue} 85% 62%)" title="0x${o.toString(16)} เดิม ${+(ov * m.scale).toFixed(3)}${cmpTxt}">${+(v * m.scale).toFixed(3)}</td>`;
    }
    h += '</tr>';
  }
  $('mapWrap').innerHTML = h + '</tbody></table>';
}
$('mapWrap').addEventListener('mousedown', e => {
  const td = e.target.closest('td'); if (!td) return;
  dragFrom = [+td.dataset.r, +td.dataset.c];
  if (!e.shiftKey && !e.ctrlKey) sel.clear();
  sel.add(`${dragFrom[0]},${dragFrom[1]}`); paintSel(); e.preventDefault();
});
$('mapWrap').addEventListener('mouseover', e => {
  const td = e.target.closest('td'); if (!td || !dragFrom) return;
  const [r0, c0] = dragFrom, r1 = +td.dataset.r, c1 = +td.dataset.c;
  sel.clear();
  for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) sel.add(`${r},${c}`);
  paintSel();
});
function paintSel() { $('mapWrap').querySelectorAll('td').forEach(td => td.classList.toggle('sel', sel.has(`${td.dataset.r},${td.dataset.c}`))); }
addEventListener('mouseup', () => dragFrom = null);
function editSel(fn) {
  if (!bin || !sel.size) return toast('เลือกช่องในตารางก่อน (ลากเมาส์)');
  const m = mapDef();
  for (const key of sel) { const [r, c] = key.split(',').map(Number); const o = cellOff(m, r, c); wr(bin, o, m.type, fn(rd(bin, o, m.type), o, m)); }
  showMap(); checkSum(); showHex();
}
document.querySelectorAll('[data-adj]').forEach(b => b.onclick = () => { const p = +b.dataset.adj; editSel(v => v * (1 + p / 100)); });
$('mSetBtn').onclick = () => { const x = parseFloat($('mSet').value); if (isNaN(x)) return; editSel((v, o, m) => x / m.scale); };
$('mUndo').onclick = () => editSel((v, o, m) => rd(orig, o, m.type));
$('mShow').onclick = () => { sel.clear(); showMap(); };
function renderMapPick() { $('mapPick').innerHTML = '<option value="">— ตั้งค่าเอง —</option>' + savedMaps.map((m, i) => `<option value="${i}">${esc(m.name)} @0x${m.off.toString(16)}</option>`).join(''); }
$('mapPick').onchange = () => {
  const m = savedMaps[+$('mapPick').value]; if (!m) return;
  $('mName').value = m.name; $('mOff').value = m.off.toString(16).toUpperCase(); $('mRows').value = m.rows; $('mCols').value = m.cols; $('mType').value = m.type; $('mScale').value = m.scale; $('mAxis').value = m.axis != null ? m.axis.toString(16).toUpperCase() : '';
  sel.clear(); showMap();
};
$('mKeep').onclick = () => { savedMaps.push(mapDef()); store.set('maps', savedMaps); renderMapPick(); toast('จำตารางแล้ว'); };
renderMapPick();

function checkSum() {
  if (!bin) return;
  if ($('csType').value === 'none') { $('csInfo').textContent = ''; return; }
  let s = 0; for (const b of bin) s = (s + b) & 0xFF;
  const touched = bin.some((b, i) => b !== orig[i]);
  $('csInfo').innerHTML = s === 0 ? '<span style="color:#3ddc84">✔ checksum ถูกต้อง</span>'
    : `<span style="color:#ff4d5e">✘ ผลรวม = 0x${s.toString(16).padStart(2, '0')} (ต้องเป็น 00)${touched ? '' : ' — ไฟล์นี้น่าจะถูกแก้มาก่อนโดยไม่ได้แก้ checksum ห้ามเอาไป Flash ตรงๆ'}</span>`;
}
$('csFix').onclick = () => {
  if (!bin) return;
  const at = parseInt($('csOff').value, 16);
  if (isNaN(at) || at < 0 || at >= bin.length) return toast('ใส่ตำแหน่งไบต์ checksum ก่อน (แต่ละรุ่นกล่องอยู่คนละที่ — ต้องรู้ตำแหน่งที่ถูกต้อง)', 5000);
  if (!confirm(`แก้ไบต์ที่ 0x${at.toString(16).toUpperCase()} (ตอนนี้ = 0x${bin[at].toString(16).padStart(2, '0')}) ให้ผลรวมเป็น 0?\nถ้าตำแหน่งนี้ไม่ใช่ไบต์ checksum จริงของกล่องรุ่นนี้ ไฟล์จะเสีย`)) return;
  let s = 0; for (let i = 0; i < bin.length; i++) if (i !== at) s = (s + bin[i]) & 0xFF;
  bin[at] = (0x100 - s) & 0xFF; checkSum(); showHex(); toast(`ตั้งไบต์ 0x${at.toString(16)} = 0x${bin[at].toString(16).padStart(2, '0')}`);
};
$('csType').onchange = checkSum;
function binOut() {
  const changed = bin.reduce((n, b, i) => n + (b !== orig[i]), 0);
  return { name: binFileName.replace(/(\.[^.]+)?$/, `_mod$1`), changed };
}
$('binSave').onclick = async () => { const o = binOut(); await db.add({ name: o.name, kind: 'bin', data: bin.slice().buffer }); toast(`บันทึก ${o.name} ลงคลังแล้ว (แก้ ${o.changed} ไบต์)`); };
$('binDl').onclick = () => download(binOut().name, bin);
function showHex() {
  if (!bin) return;
  const start = Math.max(0, (parseInt($('hexGo').value, 16) || 0) & ~15);
  let out = '';
  for (let a = start; a < Math.min(bin.length, start + 512); a += 16) {
    out += a.toString(16).padStart(6, '0').toUpperCase() + '  ';
    for (let i = 0; i < 16 && a + i < bin.length; i++) { const b = bin[a + i], h = b.toString(16).padStart(2, '0').toUpperCase(); out += b !== orig[a + i] ? `<span class="d">${h}</span> ` : cmp && a + i < cmp.length && b !== cmp[a + i] ? `<span class="c">${h}</span> ` : h + ' '; }
    out += '\n';
  }
  $('hexView').innerHTML = out;
}
$('hexShow').onclick = showHex;

// ---------------- Map Finder + compare ----------------
let found = [], cmp = null, cmpName = '';
const hx = n => '0x' + n.toString(16).toUpperCase();
function useTable(t, name) {
  $('mName').value = name; $('mOff').value = t.off.toString(16).toUpperCase(); $('mRows').value = t.rows; $('mCols').value = t.cols;
  $('mType').value = t.type; $('mScale').value = 1; $('mAxis').value = t.axisOff != null ? t.axisOff.toString(16).toUpperCase() : '';
  $('mapPick').value = ''; sel.clear(); showMap();
  $('mapWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
$('mfFind').onclick = async () => {
  if (!bin) return;
  $('mfInfo').textContent = 'กำลังค้นหา…'; await sleep(30);
  const t0 = performance.now();
  found = MapFinder.find(bin).filter(t => t.anchored || t.rows * t.cols >= 36);
  const main = found.filter(t => t.anchored);
  $('mfInfo').textContent = `เจอ ${found.length} ตาราง (${main.length} ตารางมีแกนชัดเจน ⭐) ใน ${Math.round(performance.now() - t0)} ms — กดเพื่อเปิด`;
  $('mfList').innerHTML = '<div class="pick">' + found.map((t, i) => {
    const big = t.anchored && t.rows * t.cols >= 200;
    return `<button data-mf="${i}" title="${t.type}${t.xAxis ? ` แกน X ${t.xAxis[0]}…${t.xAxis.at(-1)}` : ''}${t.yAxis ? ` แกน Y ${t.yAxis[0]}…${t.yAxis.at(-1)}` : ''}">${t.anchored ? '⭐ ' : ''}${big ? '<b>' : ''}${hx(t.off)} · ${t.cols}×${t.rows}${t.twin ? ` (ชุด ${t.twin + 1})` : ''}${big ? '</b>' : ''}</button>`;
  }).join('') + '</div>' + (main.some(t => t.rows * t.cols >= 200) ? '<p class="muted">ตารางใหญ่สีส้ม (เช่น 25×29, 29×29) มักเป็นแมพน้ำมันหลัก — ชุด 1/2 คือตารางคู่ที่ใช้แกนเดียวกัน ควรปรับไปพร้อมกัน ⚠ ชื่อ/หน่วยของตารางยังต้องยืนยันเอง (ไม่มี XDF)</p>' : '');
  renderCmp();
};
$('mfList').onclick = e => {
  const b = e.target.closest('[data-mf]'); if (!b) return;
  const t = found[+b.dataset.mf];
  document.querySelectorAll('#mfList [data-mf]').forEach(x => x.classList.toggle('on', x === b));
  useTable(t, `ตาราง ${hx(t.off)}${t.twin ? ` ชุด ${t.twin + 1}` : ''}`);
};
$('cmpFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  cmp = new Uint8Array(await f.arrayBuffer()); cmpName = f.name; e.target.value = '';
  renderCmp(); showMap(); showHex();
};
function renderCmp() {
  if (!cmp || !bin) { $('cmpList').innerHTML = cmp ? `<p class="muted">โหลดไฟล์เทียบ ${esc(cmpName)} แล้ว — เปิดไฟล์หลักก่อน</p>` : ''; return; }
  const ranges = MapFinder.diff(bin, cmp);
  const inTable = ([s, e]) => found.find(t => s < t.off + t.bytes && e > t.off);
  const bytes = ranges.reduce((n, [s, e]) => n + e - s, 0);
  $('cmpList').innerHTML = `<p class="muted">เทียบกับ <b>${esc(cmpName)}</b>${cmp.length !== bin.length ? ` ⚠ ขนาดไม่เท่ากัน (${cmp.length.toLocaleString()} / ${bin.length.toLocaleString()} B)` : ''} — ต่างกัน ${ranges.length} ช่วง (${bytes.toLocaleString()} ไบต์) · ช่องในตารางที่ต่างจะมีลายขีด</p>`
    + '<div class="pick">' + ranges.slice(0, 120).map(([s, e], i) => { const t = inTable([s, e]); return `<button data-rg="${s}" title="${e - s} ไบต์">${t ? '⭐ ' : ''}${hx(s)}–${hx(e - 1)}</button>`; }).join('')
    + (ranges.length > 120 ? `<span class="muted">… อีก ${ranges.length - 120} ช่วง</span>` : '') + `<button id="cmpClear">✕ เลิกเทียบ</button></div>`;
}
$('cmpList').onclick = e => {
  if (e.target.id === 'cmpClear') { cmp = null; renderCmp(); showMap(); showHex(); return; }
  const b = e.target.closest('[data-rg]'); if (!b) return;
  const s = +b.dataset.rg, t = found.find(t => s >= t.off && s < t.off + t.bytes);
  if (t) useTable(t, `ตาราง ${hx(t.off)}`);
  else { $('hexGo').value = s.toString(16); showHex(); document.querySelector('#p-tuner details').open = true; $('hexView').scrollIntoView({ behavior: 'smooth' }); }
};

// ---------------- PWA ----------------
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
