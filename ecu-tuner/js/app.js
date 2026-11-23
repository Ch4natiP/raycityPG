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
function ask(msg, okText = 'ยืนยัน', danger = false) {
  return new Promise(res => {
    $('askMsg').textContent = msg; $('askOk').textContent = okText;
    $('askOk').className = 'btn ' + (danger ? 'r' : 'o');
    $('askModal').classList.add('on'); $('askOk').focus();
    const done = v => { $('askModal').classList.remove('on'); $('askOk').onclick = $('askNo').onclick = null; res(v); };
    $('askOk').onclick = () => done(true); $('askNo').onclick = () => done(false);
  });
}
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------- settings / branding ----------------
const settings = { brand: 'SM Remap', logo: 'SM', proto: 'honda', poll: 120, ...store.get('settings', {}) };
if (settings.brand === 'PG PERFORMANCE') Object.assign(settings, { brand: 'SM Remap', logo: 'SM' });
function applyBrand() {
  $('brandName').textContent = settings.brand; $('heroName').textContent = settings.brand;
  $('logoTxt').textContent = settings.logo; $('foot').textContent = `${settings.brand} · K-line 10400 baud`;
  const mark = $('logoMark'); mark.querySelectorAll('img').forEach(n => n.remove());
  if (settings.logoImg) { const im = new Image(); im.src = settings.logoImg; mark.prepend(im); mark.querySelector('b').style.display = 'none'; mark.querySelector('svg').style.display = 'none'; }
  else { mark.querySelector('b').style.display = ''; mark.querySelector('svg').style.display = ''; }
  document.title = settings.brand;
  $('sBrand').value = settings.brand; $('sLogo').value = settings.logo; $('sProto').value = settings.proto; $('sPoll').value = settings.poll;
}
$('sLogoImg').onchange = async e => {
  const f = e.target.files[0]; if (!f) return; e.target.value = '';
  if (f.size > 400000) return toast('รูปใหญ่เกินไป ใช้รูปเล็กกว่า 400KB', 5000);
  const rd = new FileReader(); rd.onload = () => { settings.logoImg = rd.result; store.set('settings', settings); applyBrand(); toast('ตั้งโลโก้แล้ว'); }; rd.readAsDataURL(f);
};
$('sLogoClear').onclick = () => { delete settings.logoImg; store.set('settings', settings); applyBrand(); };
$('sSave').onclick = () => {
  Object.assign(settings, { brand: $('sBrand').value.trim() || 'SM Remap', logo: $('sLogo').value.trim() || 'SM', proto: $('sProto').value, poll: Math.max(50, +$('sPoll').value || 120) });
  store.set('settings', settings); applyBrand(); toast('บันทึกแล้ว');
};
applyBrand();

// ---------------- navigation ----------------
function go(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('on', p.id === 'p-' + page));
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.go === page));
  if (page === 'files') renderFiles();
  if (page === 'calc') calc();
  if (page === 'dtcref') renderDtcRef();
  if (page === 'report' && !$('rpBike').value) $('rpBike').value = catBike();
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
  if (t.dataset.del && await ask('ลบไฟล์นี้ออกจากคลัง?', 'ลบไฟล์', true)) { await db.del(+t.dataset.del); renderFiles(); }
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
  $('btnConnTxt').textContent = state === 'ok' ? 'ตัดการเชื่อมต่อ' : 'เชื่อมต่อ';
  $('fk1').textContent = state === 'ok' && ecu.id ? '[✓]' : '[ ]';
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
  if (!SerialLink.supported()) return toast('เบราว์เซอร์นี้ต่อสายไม่ได้ (ไม่มี Web Serial) — เปิดด้วย Chrome หรือ Edge บนคอม หรือเปิดแบบรันในเครื่อง (localhost)', 7000);
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
    const idBytes = id ? Array.from(id.slice(4, -1)) : null;
    ecu.id = idBytes ? hex(idBytes) : 'อ่านไม่ได้';
    ecu.model = idBytes ? Catalog.matchId(idBytes) : null;
    $('ecuId').textContent = ecu.model ? `${ecu.model.part} · ${ecu.model.model}` : `Honda PGM-FI · ${ecu.id}`;
    if (ecu.model) log(`ระบุรุ่นจาก ECU ID: ${ecu.model.part} (${ecu.model.model})`);
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
    const r20 = (n % 2 === 0) ? Honda.decodeTableReply(await link.transact(Honda.CMD.readTable(0x20), 300)) : null;
    if (r11) {
      n++;
      const vals = [...r11.values, ...(r20 ? r20.values : (liveLoop.last20 || []))];
      if (r20) liveLoop.last20 = r20.values;
      const get = k => vals.find(v => v.key === k)?.value ?? 0;
      // derived values: AF ratio, lambda, injector duty (4-stroke: one injection per 2 revolutions)
      const afr = currentAfr(get('o2V'));
      if (afr != null) vals.push({ key: 'afr', name: 'AF อากาศ:น้ำมัน', unit: afrSource() === 'nb' ? '(ประมาณ)' : '', value: afr, raw: [], max: 18 },
                                 { key: 'lambda', name: 'Lambda', unit: 'λ', value: +(afr / 14.7).toFixed(3), raw: [], max: 1.3 });
      vals.push({ key: 'duty', name: 'Injector duty', unit: '%', value: +(get('inj') * get('rpm') / 1200).toFixed(1), raw: [], max: 100 });
      renderVals(vals);
      hist.push({ rpm: get('rpm'), tps: get('tps'), inj: get('inj'), afr, afr10: afr == null ? 0 : Math.max(0, afr - 10) }); if (hist.length > 300) hist.shift();
      drawGauge(get('rpm')); drawChart(); drawAfr(afr);
      onLiveSample({ rpm: get('rpm'), tps: get('tps'), map: get('map'), ect: get('ect'), afr });
      onDynoSample({ v: get('speed'), rpm: get('rpm') });
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
  // segmented rev strip + digital readout, like a dyno tach
  const c = $('gauge'), g = c.getContext('2d'), W = c.width, H = c.height, max = 12000, segs = 40, red = 9500;
  const ink = css('--ink'), muted = css('--muted'), acc = css('--accent'), amb = css('--amber'), bad = css('--bad'), off = css('--surface-2'), line = css('--line');
  g.clearRect(0, 0, W, H);
  const x0 = 20, sw = (W - 40) / segs, top = 34, h = 54, lit = Math.round(Math.min(1, rpm / max) * segs);
  for (let i = 0; i < segs; i++) {
    const v = (i + 1) / segs * max;
    g.fillStyle = i < lit ? (v > red ? bad : v > 7000 ? amb : acc) : off;
    g.fillRect(x0 + i * sw + 1.5, top + (h - h * (0.45 + 0.55 * i / segs)), sw - 3, h * (0.45 + 0.55 * i / segs));
  }
  g.fillStyle = muted; g.font = `22px ${css('--font-mono')}`; g.textAlign = 'center';
  for (let k = 0; k <= 12; k += 2) g.fillText(k ? k + 'k' : '0', x0 + (W - 40) * k / 12, top + h + 30);
  g.strokeStyle = line; g.beginPath(); g.moveTo(x0, top + h + 6); g.lineTo(W - 20, top + h + 6); g.stroke();
  g.textAlign = 'left'; g.fillStyle = ink; g.font = `600 92px ${css('--font-mono')}`;
  const txt = rpm.toLocaleString(), tw = g.measureText(txt).width;
  g.fillText(txt, x0, H - 34);
  g.fillStyle = muted; g.font = `26px ${css('--font-mono')}`;
  g.fillText('rpm', x0 + tw + 12, H - 38);
}
function drawChart() {
  const c = $('chart'), g = c.getContext('2d'), W = c.width, H = c.height;
  g.clearRect(0, 0, W, H);
  g.strokeStyle = css('--line'); g.lineWidth = 1;
  for (let y = 0; y <= 4; y++) { g.beginPath(); g.moveTo(0, H * y / 4 + .5); g.lineTo(W, H * y / 4 + .5); g.stroke(); }
  const line = (k, max, col) => {
    g.strokeStyle = col; g.lineWidth = 3; g.beginPath();
    hist.forEach((h, i) => { const x = W - (hist.length - 1 - i) * (W / 299), y = H - 6 - (H - 12) * Math.min(1, h[k] / max); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
  };
  line('rpm', 12000, css('--amber')); line('tps', 100, css('--accent')); line('inj', 15, css('--ok'));
  g.save(); g.setLineDash([8, 6]); line('afr10', 8, css('--bad')); g.restore();
}
function stopLive() { livePolling = false; $('liveStart').disabled = false; $('liveStop').disabled = true; }
$('liveScan').onclick = async () => {
  if (!needLink()) return;
  if (livePolling) stopLive();
  const out = $('liveScanOut'); out.innerHTML = '<div class="muted">กำลังสแกน… ให้เครื่องติด (เดินเบา) เพื่อให้ค่าขยับ</div>';
  // pass 1: find which diagnostic tables carry data
  const have = [];
  for (let t = 0x10; t <= 0x40; t++) {
    const r = await link.transact(Honda.CMD.readTable(t), 150);
    if (r && r[0] === 0x02 && r[2] === 0x71 && r.length > 6) have.push({ t, a: Array.from(r.slice(4, -1)) });
    out.querySelector('.muted').textContent = `กำลังสแกน… 0x${t.toString(16)} (พบ ${have.length})`;
  }
  if (!have.length) { out.innerHTML = '<div class="note">ไม่พบตารางที่มีข้อมูลในช่วง 0x10–0x40 · ลองตอนเครื่องติด หรือส่ง log มาให้ดู</div>'; return; }
  await sleep(700);
  // pass 2: read again, mark tables whose bytes changed = live sensor data
  const res = [];
  for (const h of have) {
    const r = await link.transact(Honda.CMD.readTable(h.t), 150);
    const b = r && r.length > 6 ? Array.from(r.slice(4, -1)) : [];
    const changed = b.reduce((n, v, i) => n + (v !== h.a[i] ? 1 : 0), 0);
    res.push({ t: h.t, len: h.a.length, changed, a: h.a, b });
  }
  res.sort((x, y) => y.changed - x.changed);
  const live = res.filter(r => r.changed);
  out.innerHTML = `<div class="panel stack"><b>ผลสแกนตาราง Live</b>`
    + (live.length ? `<div class="okbox">ตารางที่ค่าขยับ (น่าจะเป็นค่าสด): ${live.map(r => '0x' + r.t.toString(16).toUpperCase() + ` (${r.changed}/${r.len} ไบต์)`).join(', ')}</div>` : '<div class="note">ยังไม่มีตารางไหนค่าขยับ — เร่งเครื่องเบา ๆ แล้วสแกนใหม่</div>')
    + '<table class="list"><thead><tr><th>ตาราง</th><th>ยาว</th><th>เปลี่ยน</th><th>ไบต์ (ครั้งที่ 1 → 2)</th></tr></thead><tbody>'
    + res.map(r => `<tr><td><span class="code">0x${r.t.toString(16).toUpperCase()}</span></td><td>${r.len}</td><td>${r.changed || '—'}</td><td class="mono" style="font-size:11px">${hex(r.a)}<br>${r.changed ? hex(r.b) : ''}</td></tr>`).join('')
    + '</tbody></table><div class="row"><button class="btn o" id="liveScanSave">บันทึกผลลงคลัง</button><span class="muted">ส่งไฟล์นี้มาให้ผม จะปรับให้ Live Data อ่าน K60S ได้ถูกต้อง</span></div></div>';
  const txt = `# live table scan ${new Date().toISOString()}\n# ecu ${ecu.id}${ecu.model ? ' ' + ecu.model.part : ''}\n` + res.map(r => `${r.t.toString(16).padStart(2, '0')}: changed ${r.changed}/${r.len}\n  1: ${hex(r.a)}\n  2: ${hex(r.b)}`).join('\n');
  $('liveScanSave').onclick = async () => { const name = `live_scan_${(ecu.id || 'ecu').replace(/\s/g, '')}_${Date.now()}.txt`; await db.add({ name, kind: 'term', data: new TextEncoder().encode(txt).buffer }); download(name, txt, 'text/plain'); toast('บันทึกผลสแกนแล้ว'); };
};
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
drawGauge(0); drawChart();
document.fonts?.ready.then(() => { drawGauge(hist.length ? hist[hist.length - 1].rpm : 0); drawChart(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { drawGauge(hist.length ? hist[hist.length - 1].rpm : 0); drawChart(); });

// ---------------- AFR source ----------------
let wideband = null;
const afrSource = () => $('afrSrc').value;
function currentAfr(o2V) {
  if (afrSource() === 'wb') return link?.afr ? link.afr() : wideband?.afr() ?? null;   // the virtual ECU doubles as a wideband
  return o2V ? AutoTune.narrowbandAfr(o2V) : null;
}
function afrTargetNow(rpm, tps) { return AutoTune.targetAfr(tps, rpm, atOpts()); }
function drawAfr(afr) {
  const c = $('afrBar'), g = c.getContext('2d'), W = c.width, H = c.height, lo = 10, hi = 18;
  g.clearRect(0, 0, W, H);
  const x = v => 20 + (W - 40) * (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo);
  const grd = g.createLinearGradient(x(lo), 0, x(hi), 0);
  grd.addColorStop(0, css('--warn')); grd.addColorStop(0.5, css('--ok')); grd.addColorStop(1, css('--bad'));
  g.fillStyle = grd; g.globalAlpha = .35; g.fillRect(x(lo), 30, x(hi) - x(lo), 26); g.globalAlpha = 1;
  g.fillStyle = css('--muted'); g.font = `22px ${css('--font-mono')}`; g.textAlign = 'center';
  for (let v = lo; v <= hi; v += 1) g.fillText(v, x(v), 92);
  g.textAlign = 'left'; g.fillText('หนา', x(lo), 20); g.textAlign = 'right'; g.fillText('บาง', x(hi), 20);
  const last = hist.length ? hist[hist.length - 1] : null, tgt = last ? afrTargetNow(last.rpm, last.tps) : 14.7;
  g.fillStyle = css('--ink'); g.fillRect(x(tgt) - 1.5, 24, 3, 38);
  if (afr != null) { g.fillStyle = css('--ink'); g.beginPath(); g.moveTo(x(afr), 62); g.lineTo(x(afr) - 11, 80); g.lineTo(x(afr) + 11, 80); g.fill(); }
  $('afrVal').textContent = afr == null ? '—' : afr.toFixed(1);
  const st = $('afrState');
  if (afr == null) { st.className = 'pill'; st.textContent = afrSource() === 'wb' ? 'ยังไม่มีสัญญาณ Wideband' : 'ยังไม่มีข้อมูล'; return; }
  const d = afr - tgt;
  st.className = 'pill ' + (d > 0.4 ? 'lean' : d < -0.4 ? 'rich' : 'ok');
  st.textContent = d > 0.4 ? `บาง (+${d.toFixed(1)} จากเป้า ${tgt.toFixed(1)})` : d < -0.4 ? `หนา (${d.toFixed(1)} จากเป้า ${tgt.toFixed(1)})` : `พอดี (เป้า ${tgt.toFixed(1)})`;
}
$('afrSrc').onchange = () => {
  $('afrNote').textContent = afrSource() === 'wb'
    ? (link?.afr ? 'ECU จำลองส่งค่า AF แบบ Wideband ให้' : wideband ? 'รับค่าจาก Wideband อยู่' : 'กด “เชื่อมต่อ Wideband” แล้วเลือกพอร์ตของกล่อง Wideband (ส่งค่าเป็นข้อความทีละบรรทัด)')
    : 'O2 เดิมเป็นแบบแคบ บอกได้แค่หนา/บางรอบ ๆ 14.7 ถ้าจะจูนจริงควรใช้ Wideband';
  drawAfr(null);
};
$('wbConn').onclick = async () => {
  if (!SerialLink.supported()) return toast('ต้องใช้ Chrome หรือ Edge บนคอม (Web Serial) เพื่อต่อ Wideband', 5000);
  try { await wideband?.close(); wideband = new Link.WidebandLink(); await wideband.open(9600); $('afrSrc').value = 'wb'; $('afrSrc').onchange(); toast('เชื่อมต่อ Wideband แล้ว'); }
  catch (e) { wideband = null; if (e?.name !== 'NotFoundError') toast('เปิดพอร์ต Wideband ไม่ได้: ' + (e.message || e), 5000); }
};
drawAfr(null);

// ---------------- Live view switch ----------------
document.querySelectorAll('[data-lv]').forEach(b => b.onclick = () => {
  document.querySelectorAll('[data-lv]').forEach(x => x.classList.toggle('on', x === b));
  for (const n of ['1', '2', '3']) $('lv' + n).hidden = b.dataset.lv !== n;
  if (b.dataset.lv === '3') { $('dySim').hidden = !link?.startRun; drawDyno(); }
  if (b.dataset.lv === '2') { fillRtMaps(); buildRt(); }
});

// ---------------- Realtime table ----------------
let rt = null;            // { t: table def, yAx, xAx, tds[][], log }
let atOn = false, lastTps = null;
const atOpts = () => ({ cruise: +$('atCruise').value || 14.7, wot: +$('atWot').value || 12.8, enrichFrom: +$('atFrom').value || 60 });
function rtTables() {
  const list = [];
  for (const t of found) if (t.anchored) list.push({ ...t, label: `${hx(t.off)} · ${t.cols}×${t.rows}${t.twin ? ` ชุด ${t.twin + 1}` : ''}` });
  for (const m of savedMaps) if (m.axis != null) list.push({ off: m.off, rows: m.rows, cols: m.cols, type: m.type, axisOff: m.axis, label: `${m.name} @${hx(m.off)}` });
  if (xdf) for (const t of xdf.tables) if (t.z.rows > 3 && t.z.cols > 3) list.unshift({ xdf: t, off: t.z.addr, rows: t.z.rows, cols: t.z.cols, label: `XDF · ${t.title}` });
  return list;
}
function fillRtMaps() {
  const list = rtTables(), cur = $('rtMap').value;
  $('rtMap').innerHTML = list.length ? list.map((t, i) => `<option value="${i}">${esc(t.label)}</option>`).join('') : '<option value="">ยังไม่มีแมพ</option>';
  if (cur && +cur < list.length) $('rtMap').value = cur;
}
function buildRt() {
  const list = rtTables(), t = list[+$('rtMap').value];
  if (!bin || !t) { rt = null; $('rtWrap').innerHTML = '<p class="muted" style="padding:14px;margin:0">ยังไม่ได้เลือกแมพ</p>'; return; }
  const w = width(t.type);
  const yAx = t.xdf ? Xdf.axisValues(bin, t.xdf.y).map(Number) : Array.from({ length: t.rows }, (_, r) => rd(bin, t.axisOff + r * w, t.type));
  const xAx = t.xdf ? Xdf.axisValues(bin, t.xdf.x).map(Number) : Array.from({ length: t.cols }, (_, c) => rd(bin, t.axisOff + (t.rows + c) * w, t.type));
  if (t.xdf && rt?.t.off !== t.off) {   // XDF axes are already in real units: pick the live source from the unit text
    const src = u => /rpm|รอบ/i.test(u || '') ? 'rpm' : /kpa|map/i.test(u || '') ? 'map' : 'tps';
    $('rtYsrc').value = src(t.xdf.y.units); $('rtXsrc').value = src(t.xdf.x.units); $('rtYk').value = 1; $('rtXk').value = 1;
  }
  // axis scale guesses: rpm axes stored ×4 when they run past 20000; throttle axis end = 100 %
  if (!$('rtYk').value || rt?.t.off !== t.off) $('rtYk').value = $('rtYsrc').value === 'rpm' ? (yAx.at(-1) > 20000 ? 0.25 : 1) : +(100 / (yAx.at(-1) || 1)).toPrecision(3);
  if (!$('rtXk').value || rt?.t.off !== t.off) $('rtXk').value = $('rtXsrc').value === 'tps' ? +(100 / (xAx.at(-1) || 1)).toPrecision(3) : 1;
  const ky = +$('rtYk').value || 1, kx = +$('rtXk').value || 1;
  const keep = rt && rt.t.off === t.off && rt.log;
  rt = { t, yAx: yAx.map(v => v * ky), xAx: xAx.map(v => v * kx), log: keep || new AutoTune.Logger(t.rows, t.cols), sug: null };
  let h = '<table class="map"><thead><tr><th class="ax">' + ($('rtYsrc').value) + ' \\ ' + ($('rtXsrc').value) + '</th>' + rt.xAx.map(v => `<th class="ax">${+v.toFixed(v < 10 ? 1 : 0)}</th>`).join('') + '</tr></thead><tbody>';
  for (let r = 0; r < t.rows; r++) h += `<tr><th class="ax">${Math.round(rt.yAx[r])}</th>` + '<td></td>'.repeat(t.cols) + '</tr>';
  $('rtWrap').innerHTML = h + '</tbody></table>';
  rt.tds = [...$('rtWrap').querySelectorAll('tbody tr')].map(tr => [...tr.querySelectorAll('td')]);
  paintRt();
}
['rtMap', 'rtYsrc', 'rtXsrc'].forEach(id => $(id).onchange = () => { if (id !== 'rtMap') { $('rtYk').value = ''; $('rtXk').value = ''; } buildRt(); });
['rtYk', 'rtXk'].forEach(id => $(id).onchange = () => { const off = rt?.t.off; buildRt(); });
$('rtMode').onchange = () => paintRt();
function cellVal(r, c) { const t = rt.t; if (t.xdf) return +Xdf.tableValue(bin, t.xdf, r, c).toFixed(t.xdf.z.decimals ?? 2); return rd(bin, t.off + (r * t.cols + c) * width(t.type), t.type); }
function paintRt(pos) {
  if (!rt) return;
  const { t, log } = rt, mode = $('rtMode').value;
  let lo = Infinity, hi = -Infinity;
  for (let r = 0; r < t.rows; r++) for (let c = 0; c < t.cols; c++) { const v = cellVal(r, c); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const sug = mode === 'sug' ? (rt.sug = AutoTune.suggest(log, { minWeight: +$('atMinW').value || 15, maxStep: (+$('atMax').value || 8) / 100 })) : null;
  for (let r = 0; r < t.rows; r++) for (let c = 0; c < t.cols; c++) {
    const td = rt.tds[r][c], v = cellVal(r, c);
    let text = '', bg = '', nodata = false;
    if (mode === 'val') { text = v; const k = hi > lo ? (v - lo) / (hi - lo) : .5; bg = `hsl(${190 - k * 190} 70% 66%)`; }
    else if (mode === 'hits') { const w = log.weight(r, c); text = w ? Math.round(w) : ''; nodata = !w; bg = w ? `hsl(170 60% ${88 - Math.min(1, w / 40) * 40}%)` : ''; }
    else if (mode === 'afr') { const a = log.afr(r, c); nodata = a == null; text = a == null ? '' : a.toFixed(1); if (a != null) { const d = a - log.target(r, c); bg = d > 0.4 ? `hsl(0 75% ${80 - Math.min(1, d / 2) * 20}%)` : d < -0.4 ? `hsl(40 85% ${80 - Math.min(1, -d / 2) * 20}%)` : 'hsl(140 50% 75%)'; } }
    else { const f = sug[r][c]; nodata = f == null; text = f == null ? '' : ((f - 1) * 100 > 0 ? '+' : '') + ((f - 1) * 100).toFixed(1); if (f != null) bg = f > 1.004 ? `hsl(0 75% ${85 - Math.min(1, (f - 1) / .08) * 25}%)` : f < 0.996 ? `hsl(210 75% ${85 - Math.min(1, (1 - f) / .08) * 25}%)` : 'hsl(140 50% 78%)'; }
    td.textContent = text; td.style.background = bg; td.classList.toggle('nodata', nodata);
  }
  if (pos) markRt(pos);
}
function markRt({ rp, cp }) {
  rt.tds.flat().forEach(td => td.classList.remove('cur', 'near'));
  const ws = AutoTune.weights(rp, cp, rt.t.rows, rt.t.cols).sort((a, b) => b[2] - a[2]);
  ws.forEach(([r, c], i) => rt.tds[r][c].classList.add(i ? 'near' : 'cur'));
  const [r, c] = ws[0];
  $('rtCell').textContent = `แถว ${r} · คอลัมน์ ${c} · ค่า ${cellVal(r, c)} · ข้อมูล ${Math.round(rt.log.weight(r, c))}`;
}
let rtPaintAt = 0;
function onLiveSample(v) {
  $('rtRpm').textContent = v.rpm.toLocaleString(); $('rtTps').textContent = v.tps.toFixed(1) + '%';
  const tgt = afrTargetNow(v.rpm, v.tps);
  $('rtAfr').textContent = v.afr == null ? '—' : v.afr.toFixed(1); $('rtTgt').textContent = tgt.toFixed(1);
  if (!rt) return;
  const src = { rpm: v.rpm, tps: v.tps, map: v.map };
  const rp = AutoTune.axisPos(rt.yAx, src[$('rtYsrc').value]), cp = AutoTune.axisPos(rt.xAx, src[$('rtXsrc').value]);
  // autotune sample: steady throttle, warm engine, valid AFR
  const steady = lastTps == null || Math.abs(v.tps - lastTps) < 4; lastTps = v.tps;
  if (atOn && v.afr != null && steady && (!$('atWarm').checked || v.ect >= 70)) {
    rt.log.add(rp, cp, v.afr, tgt);
    $('atInfo').textContent = `เก็บแล้ว ${rt.log.n.toLocaleString()} จุด · ${countReady()} ช่องพร้อมคำนวณ`;
  } else if (atOn && $('atWarm').checked && v.ect < 70) $('atInfo').textContent = `รอเครื่องร้อน (ตอนนี้ ${v.ect}°C)`;
  if (performance.now() - rtPaintAt > 250 && !$('lv2').hidden) { rtPaintAt = performance.now(); paintRt({ rp, cp }); }
  else if (!$('lv2').hidden) markRt({ rp, cp });
}
function countReady() { const minW = +$('atMinW').value || 15; let n = 0; for (let k = 0; k < rt.log.w.length; k++) if (rt.log.w[k] >= minW) n++; return n; }
$('atStart').onclick = () => {
  if (!rt) return toast('เลือกแมพในหน้า 2 ก่อน');
  if (!livePolling) return toast('กด “เริ่มอ่าน” ก่อน');
  if (afrSource() === 'nb') toast('กำลังใช้ O2 เดิม (ค่าประมาณ) ผลจูนจะหยาบ แนะนำ Wideband', 5000);
  atOn = true; $('atStart').disabled = true; $('atStop').disabled = false; $('rtMode').value = 'hits'; paintRt();
};
$('atStop').onclick = () => { atOn = false; $('atStart').disabled = false; $('atStop').disabled = true; $('rtMode').value = 'sug'; paintRt(); };
$('atClear').onclick = () => { if (rt) { rt.log.clear(); paintRt(); $('atInfo').textContent = 'ล้างข้อมูลแล้ว'; } };
$('atApply').onclick = async () => {
  if (!rt) return;
  const sug = AutoTune.suggest(rt.log, { minWeight: +$('atMinW').value || 15, maxStep: (+$('atMax').value || 8) / 100 });
  const cells = []; sug.forEach((row, r) => row.forEach((f, c) => { if (f != null && Math.abs(f - 1) > 0.002) cells.push([r, c, f]); }));
  if (!cells.length) return toast('ยังไม่มีช่องที่ข้อมูลพอ หรือทุกช่องพอดีแล้ว');
  const twins = rt.t.xdf
    ? (xdf?.tables || []).filter(t => t !== rt.t.xdf && t.z.rows === rt.t.rows && t.z.cols === rt.t.cols && t.title.replace(/[\s#\d]+$/, '') === rt.t.xdf.title.replace(/[\s#\d]+$/, '')).map(t => ({ xdf: t, off: t.z.addr, rows: t.z.rows, cols: t.z.cols }))
    : found.filter(t => t.anchored && t.axisOff === rt.t.axisOff && t.off !== rt.t.off && t.rows === rt.t.rows && t.cols === rt.t.cols);
  const avg = cells.reduce((s, x) => s + (x[2] - 1), 0) / cells.length * 100;
  if (!await ask(`ปรับ ${cells.length} ช่องในแมพ ${hx(rt.t.off)}${twins.length ? ` และแมพคู่ ${twins.map(t => hx(t.off)).join(', ')}` : ''}\nเฉลี่ย ${avg > 0 ? '+' : ''}${avg.toFixed(1)}% (สูงสุด ±${$('atMax').value}%)\n\nแก้ในไฟล์บนคอมเท่านั้น ต้องตรวจดู แก้ checksum แล้ว Flash เอง`, 'นำไปใช้')) return;
  for (const t of [rt.t, ...twins]) for (const [r, c, f] of cells) { if (t.xdf) { Xdf.setTableValue(bin, t.xdf, r, c, Xdf.tableValue(bin, t.xdf, r, c) * f); continue; } const o = t.off + (r * t.cols + c) * width(t.type); wr(bin, o, t.type, rd(bin, o, t.type) * f); }
  // virtual ECU: make the simulated engine feel the new fuel map
  if (link?.applyFuelScale) { const ax = { y: rt.yAx, x: rt.xAx }, ys = $('rtYsrc').value, xs = $('rtXsrc').value, S = sug;
    link.applyFuelScale((rpm, tps) => { const src = { rpm, tps, map: 0 }; const ws = AutoTune.weights(AutoTune.axisPos(ax.y, src[ys]), AutoTune.axisPos(ax.x, src[xs]), S.length, S[0].length); let f = 0, wsum = 0; for (const [r, c, w] of ws) { f += (S[r][c] ?? 1) * w; wsum += w; } return wsum ? f / wsum : 1; }); }
  rt.log.clear(); paintRt(); showMap(); checkSum(); showHex(); if (xdf) renderXdfItem();
  toast(`ปรับแมพแล้ว ${cells.length} ช่อง — ขี่เก็บข้อมูลอีกรอบเพื่อตรวจผล`, 5000);
  $('atInfo').textContent = `รอบที่แล้วปรับ ${cells.length} ช่อง เฉลี่ย ${avg > 0 ? '+' : ''}${avg.toFixed(1)}% · เริ่มเก็บข้อมูลรอบใหม่เพื่อตรวจผล`;
};
$('rtDemo').onclick = () => {
  // Honda-like demo file: [rpm axis ×4][throttle axis 0..743][25×29 fuel map][twin]
  const rows = 29, cols = 25, b = new Uint8Array(0x8000).fill(0xFF), put = (o, v) => { b[o] = v & 255; b[o + 1] = v >> 8; };
  let o = 0x100; const axisOff = o;
  for (let r = 0; r < rows; r++, o += 2) put(o, Math.round((900 + r * 300) * 4));
  for (let c = 0; c < cols; c++, o += 2) put(o, Math.round(c * 743 / (cols - 1)));
  const tbl = o;
  for (let k = 0; k < 2; k++) for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++, o += 2) put(o, Math.round(1600 + c * 260 + r * 45));
  let s8 = 0; for (const x of b) s8 = (s8 + x) & 255; b[b.length - 1] = (b[b.length - 1] - s8) & 255;
  loadBin('ตัวอย่าง-25x29.bin', b.buffer);
  found = MapFinder.find(bin).filter(t => t.anchored);
  fillRtMaps(); $('rtMap').value = '0'; $('rtYk').value = ''; $('rtXk').value = ''; buildRt();
  toast('โหลดแมพตัวอย่างแล้ว — ต่อ ECU จำลอง เลือก AF = Wideband แล้วกดเริ่มอ่าน', 6000);
};

// ---------------- Road dyno ----------------
const dyno = { mode: 'before', xAxis: 'v', armed: false, det: null, runs: store.get('dyno', {}), gpsWatch: null };
const dyOpts = () => ({ mass: +$('dyMass').value || 170, cda: +$('dyCda').value || 0.6, crr: +$('dyCrr').value || 0.015, from: +$('dyFrom').value || 15, to: +$('dyTo').value || 68 });
document.querySelectorAll('[data-dym]').forEach(b => b.onclick = () => { dyno.mode = b.dataset.dym; document.querySelectorAll('[data-dym]').forEach(x => x.classList.toggle('on', x === b)); });
document.querySelectorAll('[data-dyx]').forEach(b => b.onclick = () => { dyno.xAxis = b.dataset.dyx; document.querySelectorAll('[data-dyx]').forEach(x => x.classList.toggle('on', x === b)); drawDyno(); });
function dyStatus(t) { $('dyStatus').textContent = t; }
function armDyno(on) {
  dyno.armed = on; $('dyArm').textContent = on ? 'ยกเลิก' : 'พร้อมวัด'; $('dyArm').className = 'btn ' + (on ? '' : 'o');
  dyno.det = on ? new Dyno.RunDetector(dyOpts()) : null;
  if (on && $('dySrc').value === 'gps') startGps(); else stopGps();
  dyStatus(on ? `พร้อมแล้ว (${dyno.mode === 'before' ? 'ก่อนจูน' : 'หลังจูน'}) · ชะลอให้ต่ำกว่า ${dyOpts().from} km/h แล้วเร่งสุด` : 'กด “พร้อมวัด” แล้วเร่งสุดจากความเร็วต่ำกว่า 15 km/h บนทางเรียบ โปรแกรมจับรอบวิ่งให้เอง');
}
$('dyArm').onclick = () => {
  if (dyno.armed) return armDyno(false);
  if ($('dySrc').value === 'ecu' && !livePolling) return toast('เชื่อมต่อแล้วกด “เริ่มอ่าน” ก่อน (หรือเลือกความเร็วจาก GPS)', 5000);
  armDyno(true);
};
$('dySim').onclick = () => { if (!livePolling) return toast('กด “เริ่มอ่าน” ก่อน'); if (!dyno.armed) armDyno(true); link.startRun(); dyStatus('ECU จำลองกำลังเร่งสุด…'); };
$('dyClear').onclick = async () => { if (await ask(`ล้างผล${dyno.mode === 'before' ? 'ก่อนจูน' : 'หลังจูน'}?`, 'ล้างผล', true)) { delete dyno.runs[dyno.mode]; store.set('dyno', dyno.runs); drawDyno(); } };
function onDynoSample({ v, rpm }) {
  if (!dyno.armed || $('dySrc').value !== 'ecu') return;
  feedDyno({ t: performance.now() / 1000, v, rpm });
}
function feedDyno(sample) {
  const run = dyno.det.push(sample);
  if (dyno.det.rec) dyStatus(`กำลังวัด… ${sample.v.toFixed(0)} km/h · ${sample.rpm ? sample.rpm + ' rpm' : ''}`);
  if (!run) return;
  const res = Dyno.analyse(run, dyOpts());
  if (res.maxHp == null) { dyStatus('รอบนี้สั้นเกินไป ลองใหม่'); return; }
  res.date = new Date().toLocaleString('th-TH'); res.src = $('dySrc').value; res.opts = dyOpts();
  res.curve = res.curve.map(p => ({ v: +p.v.toFixed(1), rpm: p.rpm, hp: +p.hp.toFixed(2) }));
  dyno.runs[dyno.mode] = res; store.set('dyno', dyno.runs);
  armDyno(false);
  dyStatus(`วัด${dyno.mode === 'before' ? 'ก่อนจูน' : 'หลังจูน'}เสร็จ: ${res.maxHp} hp ที่ ${res.atV.toFixed(0)} km/h${res.time ? ` · ${res.from}→${res.to} km/h ${res.time} วิ` : ''}`);
  drawDyno();
}
function startGps() {
  if (!navigator.geolocation) return toast('เครื่องนี้ไม่มี GPS / ไม่อนุญาตตำแหน่ง', 5000);
  stopGps();
  dyno.gpsWatch = navigator.geolocation.watchPosition(p => {
    if (dyno.armed && p.coords.speed != null) feedDyno({ t: p.timestamp / 1000, v: p.coords.speed * 3.6, rpm: hist.length ? hist[hist.length - 1].rpm : 0 });
  }, e => toast('ใช้ GPS ไม่ได้: ' + (e.message || 'ไม่ได้รับอนุญาต') + ' — เปิดแบบรันในเครื่องหรือบนมือถือ', 6000), { enableHighAccuracy: true, maximumAge: 0 });
}
function stopGps() { if (dyno.gpsWatch != null) navigator.geolocation.clearWatch(dyno.gpsWatch); dyno.gpsWatch = null; }
function drawDyno() {
  const B = dyno.runs.before, A = dyno.runs.after;
  const fmtHp = r => r ? `${r.maxHp} HP` : '—';
  $('dyBefore').textContent = fmtHp(B); $('dyAfter').textContent = fmtHp(A);
  $('dyBeforeAt').textContent = B ? `ที่ ${B.atV.toFixed(0)} km/h${B.atRpm ? ` · ${B.atRpm} rpm` : ''}${B.torque ? ` · ${B.torque} N·m` : ''} · ${B.date}` : 'ยังไม่ได้วัด';
  $('dyAfterAt').textContent = A ? `${B ? `${A.maxHp - B.maxHp >= 0 ? '+' : ''}${(A.maxHp - B.maxHp).toFixed(1)} HP (${((A.maxHp / B.maxHp - 1) * 100).toFixed(1)}%) · ` : ''}ที่ ${A.atV.toFixed(0)} km/h · ${A.date}` : 'ยังไม่ได้วัด';
  const last = A || B;
  $('dyVmax').textContent = last ? `${last.vmax} km/h` : '—';
  $('dyVmaxAt').textContent = A && B ? `ก่อน ${B.vmax} · หลัง ${A.vmax}` : last ? (A ? 'หลังจูน' : 'ก่อนจูน') : '';
  const o = dyOpts(); $('dyRangeLbl').textContent = `${o.from} → ${o.to} km/h`;
  $('dyTime').textContent = last?.time != null ? `${last.time} s` : '—';
  $('dyTimeAt').textContent = A && B && A.time != null && B.time != null ? `ก่อน ${B.time} s · หลัง ${A.time} s (${(A.time - B.time).toFixed(2)} s)` : last && last.time == null ? `ยังไม่ถึง ${o.to} km/h` : '';
  // chart
  const c = $('dyChart'), g = c.getContext('2d'), W = c.width, H = c.height, L = 70, R = 70, T = 110, Bm = 60;
  g.clearRect(0, 0, W, H);
  const xs = dyno.xAxis, runs = [[B, css('--before')], [A, css('--after')]].filter(r => r[0]);
  const all = runs.flatMap(([r]) => r.curve);
  const xmax = Math.max(xs === 'v' ? 80 : 10000, ...all.map(p => p[xs] || 0)) * 1.02, xmin = 0;
  const hpMax = Math.max(10, ...all.map(p => p.hp)) * 1.2, rpmMax = 10000;
  const X = v => L + (W - L - R) * (v - xmin) / (xmax - xmin), Y = hp => H - Bm - (H - T - Bm) * hp / hpMax, Yr = rpm => H - Bm - (H - T - Bm) * rpm / rpmMax;
  g.font = `22px ${css('--font-mono')}`; g.fillStyle = css('--muted'); g.strokeStyle = css('--line'); g.lineWidth = 1;
  const hpStep = hpMax > 30 ? 10 : hpMax > 15 ? 5 : 2;
  g.textAlign = 'right';
  for (let h = 0; h <= hpMax; h += hpStep) { g.beginPath(); g.moveTo(L, Y(h) + .5); g.lineTo(W - R, Y(h) + .5); g.stroke(); g.fillText(h, L - 10, Y(h) + 7); }
  g.textAlign = 'center';
  const xStep = xs === 'v' ? 10 : 1000;
  for (let x = 0; x <= xmax; x += xStep) g.fillText(xs === 'v' ? x : (x / 1000) + 'k', X(x), H - Bm + 30);
  g.textAlign = 'left'; g.fillText('HP', 10, T - 12); g.textAlign = 'right'; g.fillText(xs === 'v' ? 'km/h' : 'rpm', W - 10, H - 12);
  if (xs === 'v') { g.fillText('rpm', W - 10, T - 26); for (let r = 0; r <= rpmMax; r += 2000) g.fillText(r / 1000 + 'k', W - 10, Yr(r) + 7); }
  if (!runs.length) { g.textAlign = 'center'; g.fillStyle = css('--muted'); g.font = `28px ${css('--font-body')}`; g.fillText('ยังไม่มีผลวัด · กด “พร้อมวัด” แล้วเร่งสุด', W / 2, H / 2); return; }
  runs.forEach(([r, col], ri) => {
    const pts = r.curve.filter(p => p[xs]).sort((a, b) => a[xs] - b[xs]);
    if (xs === 'v') { g.strokeStyle = col; g.globalAlpha = .45; g.setLineDash([8, 7]); g.lineWidth = 2; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(X(p.v), Yr(p.rpm)) : g.moveTo(X(p.v), Yr(p.rpm))); g.stroke(); g.setLineDash([]); g.globalAlpha = 1; }
    g.strokeStyle = col; g.lineWidth = 4; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(X(p[xs]), Y(p.hp)) : g.moveTo(X(p[xs]), Y(p.hp))); g.stroke();
    const pk = pts.reduce((m, p) => (p.hp > m.hp ? p : m), pts[0]);
    const px = X(pk[xs]), py = Y(pk.hp);
    g.fillStyle = col; g.beginPath(); g.arc(px, py, 8, 0, 7); g.fill();
    const label = `MAX ${r.maxHp} HP`; g.font = `600 24px ${css('--font-mono')}`; const tw = g.measureText(label).width;
    const bx = Math.min(W - R - tw - 24, Math.max(L, px - tw / 2 - 12)), by = py - 52 - ri * 44;   // stack labels when both runs peak close together
    g.fillStyle = css('--surface'); g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.roundRect(bx, by, tw + 24, 36, 8); g.fill(); g.stroke();
    g.fillStyle = col; g.textAlign = 'left'; g.fillText(label, bx + 12, by + 26); g.font = `22px ${css('--font-mono')}`;
  });
}
drawDyno();

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
    || '<tr><td colspan="3"><div class="okbox">ไม่พบรหัสปัญหา</div></td></tr>';
};
$('dtcClear').onclick = async () => {
  if (!needLink() || !await ask('ลบรหัสปัญหาทั้งหมดในกล่อง?', 'ลบรหัส', true)) return;
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

// ---------------- Flash read (experimental, read-only) ----------------
let rdStop = false;
$('rdModel').innerHTML = '<option value="">กำหนดเอง</option>' + Catalog.ROWS.filter(r => r.kb <= 96).map((r, i) => `<option value="${Catalog.ROWS.indexOf(r)}">${r.part} · ${r.model} · ${r.kb}KB</option>`).join('');
$('rdModel').onchange = () => { const r = Catalog.ROWS[+$('rdModel').value]; if (r) { $('rdStart').value = r.start.toString(16).toUpperCase(); $('rdKb').value = r.kb; } };
$('rdStop').onclick = () => { rdStop = true; };
$('rdGo').onclick = async () => {
  if (!needLink()) return;
  if (livePolling) stopLive();
  const start = parseInt($('rdStart').value, 16) || 0, total = Math.round((+$('rdKb').value || 64) * 1024);
  const out = new Uint8Array(total); let pos = 0, chunk = 12, fails = 0; const t0 = performance.now(); rdStop = false;
  $('rdGo').disabled = true; $('rdStop').disabled = false;
  try {
    while (pos < total && !rdStop) {
      const n = Math.min(chunk, total - pos);
      const r = await link.transact(Honda.CMD.readFlash(start + pos, n), 600, 3);
      const data = r && r.length >= 5 ? r.slice(4, -1) : null;
      if (!data || data.length !== n) {
        if (++fails >= 3) { chunk--; fails = 0; }          // like HondaECU: shrink the request when the ECU refuses
        if (chunk < 1 || (pos === 0 && chunk < 9)) { $('rdInfo').textContent = 'กล่องไม่ตอบคำสั่งอ่านแฟลช — รุ่นนี้อาจต้องปลดล็อก (Security Access) หรือใช้โปรโตคอลอื่น · ส่ง Terminal log มาให้ดู'; return; }
        continue;
      }
      out.set(data, pos); pos += n; fails = 0;
      const dt = (performance.now() - t0) / 1000, rate = pos / dt;
      $('rdFill').style.width = (pos / total * 100).toFixed(1) + '%';
      $('rdInfo').textContent = `${(pos / 1024).toFixed(1)} / ${(total / 1024).toFixed(0)} KB · ${rate.toFixed(0)} B/s · เหลือ ${Math.ceil((total - pos) / rate)} วิ`;
    }
    if (pos < total) { $('rdInfo').textContent = `หยุดที่ ${(pos / 1024).toFixed(1)} KB (ยังไม่ครบ ไม่ได้บันทึก)`; return; }
    let s8 = 0; for (const b of out) s8 = (s8 + b) & 255;
    const name = `read_${(ecu.id || 'ecu').replace(/\s/g, '')}_${start.toString(16).toUpperCase()}_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.bin`;
    await db.add({ name, kind: 'bin', data: out.buffer.slice(0) });
    $('rdInfo').textContent = `ดูดเสร็จ ${(total / 1024).toFixed(0)} KB ใน ${((performance.now() - t0) / 1000).toFixed(0)} วิ · ผลรวม 8-bit = 0x${s8.toString(16).padStart(2, '0')} ${s8 === 0 ? '(ถูกต้องแบบ Keihin)' : '(ไม่เป็น 0 — ตรวจกับไฟล์ต้นฉบับ)'} · เก็บในคลังแล้ว: ${name}`;
    loadBin(name, out.buffer.slice(0));
  } finally { $('rdGo').disabled = false; $('rdStop').disabled = true; }
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
  applyCatalog(name);
  showMap(); showHex(); checkSum();
  if (xdf) renderXdfItem();
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
      const hue = 190 - k * 190;                                  // blue (low) → red (high)
      const key = `${r},${c}`;
      const cv = cmp && o + aw <= cmp.length ? rd(cmp, o, m.type) : null;
      const cmpTxt = cv != null && cv !== v ? ` • ไฟล์เทียบ ${+(cv * m.scale).toFixed(3)} (${cv > v ? '+' : ''}${(v ? (cv - v) / v * 100 : 0).toFixed(1)}%)` : '';
      h += `<td data-r="${r}" data-c="${c}" class="${sel.has(key) ? 'sel' : ''} ${v !== ov ? 'chg' : ''} ${cmpTxt ? 'cmpd' : ''}" style="background:hsl(${hue} 70% 66%)" title="0x${o.toString(16)} เดิม ${+(ov * m.scale).toFixed(3)}${cmpTxt}">${+(v * m.scale).toFixed(3)}</td>`;
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
  $('csInfo').innerHTML = s === 0 ? '<span class="good">checksum ถูกต้อง</span>'
    : `<span class="bad">ผลรวม = 0x${s.toString(16).padStart(2, '0')} (ต้องเป็น 00)${touched ? '' : ' — ไฟล์นี้น่าจะถูกแก้มาก่อนโดยไม่ได้แก้ checksum ห้ามเอาไป Flash ตรงๆ'}</span>`;
}
$('csFix').onclick = async () => {
  if (!bin) return;
  const at = parseInt($('csOff').value, 16);
  if (isNaN(at) || at < 0 || at >= bin.length) return toast('ใส่ตำแหน่งไบต์ checksum ก่อน (แต่ละรุ่นกล่องอยู่คนละที่ — ต้องรู้ตำแหน่งที่ถูกต้อง)', 5000);
  if (!await ask(`แก้ไบต์ที่ 0x${at.toString(16).toUpperCase()} (ตอนนี้ = 0x${bin[at].toString(16).padStart(2, '0')}) ให้ผลรวมเป็น 0?\nถ้าตำแหน่งนี้ไม่ใช่ไบต์ checksum จริงของกล่องรุ่นนี้ ไฟล์จะเสีย`, 'แก้ checksum', true)) return;
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

// ---------------- ECU catalogue ----------------
function applyCatalog(name) {
  const row = Catalog.match(name), hint = Catalog.nameChecksum(name), kb = Math.round(bin.length / 1024);
  const box = $('catInfo'); box.hidden = false;
  const cs = hint ?? row?.checksum ?? null;
  if (bin.length > 128 * 1024) {
    $('csType').value = 'none'; $('csOff').value = '';
    box.textContent = `${row ? `${row.part} · ${row.model} · ` : ''}ไฟล์ ${kb}KB: กล่องรุ่นใหญ่ ไม่มีไบต์ checksum แบบผลรวม 8-bit ให้แก้ในไฟล์ โปรแกรม Flash คำนวณเองตอนเขียน`;
  } else {
    $('csType').value = 'sum0'; $('csOff').value = cs != null ? cs.toString(16).toUpperCase() : '';
    box.textContent = row
      ? `${row.part} · ${row.model} · ${row.kb}KB · Start ${row.start.toString(16).toUpperCase()} · checksum ${cs != null ? '0x' + cs.toString(16).toUpperCase() : 'ไม่ต้องแก้'}${row.src === 'sheet' ? ' (จากตารางอ้างอิงร้าน ต้องยืนยัน)' : ''}${row.kb !== kb ? ` · ⚠ ขนาดไฟล์ ${kb}KB ไม่ตรงกับรุ่นนี้ (${row.kb}KB)` : ''}`
      : `ไม่รู้จักรหัสกล่องจากชื่อไฟล์${cs != null ? ` · ชื่อไฟล์บอก checksum ที่ 0x${cs.toString(16).toUpperCase()}` : ''} — ตั้งชื่อไฟล์ให้มีรหัส เช่น K73-T32 เพื่อให้โปรแกรมรู้รุ่น`;
  }
}

// ---------------- XDF definitions ----------------
let xdf = null, xdfSel = null, xdfCells = new Set(), xdfDrag = null;
const xdfItems = () => xdf ? [...(xdf.bytefns || []), ...xdf.tables, ...xdf.constants, ...xdf.flags] : [];
$('xdfFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return; e.target.value = '';
  const buf = new Uint8Array(await f.arrayBuffer());
  if (Xdf.isEncrypted(buf)) return toast('XDF ไฟล์นี้ถูกเข้ารหัส (เปิดได้เฉพาะใน TunerPro) ใช้ “ค้นหาแมพอัตโนมัติ” แทน', 7000);
  try { xdf = Xdf.parse(new TextDecoder('windows-874').decode(buf)); }
  catch (err) { return toast('อ่าน XDF ไม่ได้: ' + err.message, 6000); }
  xdf.name = f.name; xdfSel = null;
  $('xdfPanel').hidden = false; $('xdfTitle').textContent = f.name;
  $('xdfMeta').textContent = `${xdf.tables.length} ตาราง · ${xdf.constants.length} ค่า · ${xdf.flags.length} สวิตช์${xdf.size ? ` · ไฟล์ ${Math.round(xdf.size / 1024)}KB` : ''}`;
  if (bin && xdf.size && xdf.size !== bin.length) toast(`ขนาด BIN (${Math.round(bin.length / 1024)}KB) ไม่ตรงกับ XDF (${Math.round(xdf.size / 1024)}KB) — อาจเป็นคนละรุ่น`, 7000);
  renderXdfList(); fillRtMaps();
  const first = xdf.tables.find(t => /fuel|น้ำมัน/i.test(t.title) && t.z.rows > 2) || xdf.tables[0];
  if (first) selectXdf(first.id); else if (xdf.flags.length) selectXdf('__svc');
  refreshQuickTune();
};
$('xdfClose').onclick = () => { xdf = null; $('xdfPanel').hidden = true; fillRtMaps(); };
$('xdfSearch').oninput = () => renderXdfList();
function renderXdfList() {
  const q = $('xdfSearch').value.trim().toLowerCase(), groups = new Map();
  const svc = (xdf.flags.length || (xdf.bytefns || []).length) && !q;
  for (const it of xdfItems()) {
    if (q && !it.title.toLowerCase().includes(q) && !(it.cats || []).join(' ').toLowerCase().includes(q)) continue;
    const g = it.kind === 'bytes' ? 'รหัสกล่อง / ID' : it.kind === 'flag' ? 'สวิตช์ / เซนเซอร์' : (it.cats[0] || 'อื่น ๆ');
    if (!groups.has(g)) groups.set(g, []); groups.get(g).push(it);
  }
  const svcBtn = svc ? `<div class="cat">บริการช่าง</div><button data-xi="__svc" class="${xdfSel === '__svc' ? 'on' : ''}"><span>🔧 เปิด/ปิด DTC &amp; รหัสกล่อง</span><small>Service</small></button>` : '';
  $('xdfList').innerHTML = svcBtn + ([...groups].map(([g, items]) => `<div class="cat">${esc(g)}</div>` + items.map(it => `<button data-xi="${it.id}" class="${xdfSel?.id === it.id ? 'on' : ''}"><span>${esc(it.title)}</span><small>${it.kind === 'table' ? `${it.z.cols}×${it.z.rows}` : it.kind === 'flag' ? 'สวิตช์' : it.kind === 'bytes' ? 'ID' : 'ค่า'}</small></button>`).join('')).join('') || '<p class="muted" style="padding:10px">ไม่พบ</p>');
}
$('xdfList').onclick = e => { const b = e.target.closest('[data-xi]'); if (b) selectXdf(b.dataset.xi); };
function selectXdf(id) { xdfSel = id === '__svc' ? '__svc' : xdfItems().find(i => i.id === id); xdfCells.clear(); renderXdfList(); renderXdfItem(); if ($('xdf3d').checked) draw3d(); }
const fmt = (v, d) => v == null ? '—' : typeof v === 'number' ? +v.toFixed(d ?? 2) : v;
function renderXdfItem() {
  const it = xdfSel; if (!it) return;
  if (it === '__svc') return renderService();
  $('xdfItem').textContent = it.title;
  $('xdfTools').hidden = it.kind !== 'table';
  if (it.kind === 'bytes') return renderBytes(it);
  if (it.kind === 'table') {
    $('xdfUnits').textContent = it.z.units ? `· ${it.z.units}` : '';
    $('xdfAddr').textContent = `0x${it.z.addr.toString(16).toUpperCase()} · ${it.z.bits}-bit · ${it.z.eq}`;
    if (!bin) { $('xdfGrid').innerHTML = '<p class="muted" style="padding:14px;margin:0">เปิดไฟล์ .bin ก่อน</p>'; return; }
    const { rows, cols, decimals } = it.z, xs = Xdf.axisValues(bin, it.x), ys = Xdf.axisValues(bin, it.y);
    const vals = [], origVals = [];
    let lo = Infinity, hi = -Infinity;
    for (let r = 0; r < rows; r++) { vals.push([]); origVals.push([]); for (let c = 0; c < cols; c++) { const v = Xdf.tableValue(bin, it, r, c), o = Xdf.tableValue(orig, it, r, c); vals[r].push(v); origVals[r].push(o); if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } } }
    const xu = it.x.units || '', yu = it.y.units || '';
    let h = `<table class="map"><thead><tr><th class="ax">${esc(yu)}${yu || xu ? ' \\ ' : ''}${esc(xu)}</th>` + xs.map(v => `<th class="ax">${esc(fmt(v, it.x.decimals ?? 1))}</th>`).join('') + '</tr></thead><tbody>';
    for (let r = 0; r < rows; r++) {
      h += `<tr><th class="ax">${esc(fmt(ys[r], it.y.decimals ?? 0))}</th>`;
      for (let c = 0; c < cols; c++) {
        const v = vals[r][c], k = hi > lo ? (v - lo) / (hi - lo) : .5, ch = v !== origVals[r][c];
        const cv = cmp ? Xdf.tableValue(cmp, it, r, c) : null, cd = cv != null && Math.abs(cv - v) > 1e-9;
        h += `<td data-r="${r}" data-c="${c}" class="${xdfCells.has(r + ',' + c) ? 'sel' : ''} ${ch ? 'chg' : ''} ${cd ? 'cmpd' : ''}" style="background:hsl(${190 - k * 190} 70% 66%)" title="เดิม ${fmt(origVals[r][c], decimals)}${cd ? ` · ไฟล์เทียบ ${fmt(cv, decimals)}` : ''}">${fmt(v, decimals)}</td>`;
      }
      h += '</tr>';
    }
    $('xdfGrid').innerHTML = h + '</tbody></table>';
    if ($('xdf3d').checked) draw3d();
  } else {
    $('xdfUnits').textContent = it.units ? `· ${it.units}` : ''; $('xdfAddr').textContent = `0x${it.addr.toString(16).toUpperCase()}`;
    if (!bin) { $('xdfGrid').innerHTML = '<p class="muted" style="padding:14px;margin:0">เปิดไฟล์ .bin ก่อน</p>'; return; }
    if (it.kind === 'flag') {
      const on = Xdf.flagValue(bin, it), was = Xdf.flagValue(orig, it);
      $('xdfGrid').innerHTML = `<div class="xdf-form" style="padding:14px"><div class="item"><span>${esc(it.title)}${it.desc ? `<br><small class="muted">${esc(it.desc)}</small>` : ''}</span><label class="row"><input type="checkbox" id="xdfFlag" ${on ? 'checked' : ''}> ${on ? 'เปิด' : 'ปิด'}</label></div><p class="muted">ค่าเดิม: ${was ? 'เปิด' : 'ปิด'} · การปิดเซนเซอร์ที่เกี่ยวกับไอเสียหรือความปลอดภัยอาจทำให้รถทำงานผิดปกติ</p></div>`;
      $('xdfFlag').onchange = ev => { Xdf.setFlag(bin, it, ev.target.checked); afterXdfEdit(); };
    } else {
      const v = Xdf.constValue(bin, it);
      $('xdfGrid').innerHTML = `<div class="xdf-form" style="padding:14px"><div class="item"><span>${esc(it.title)}</span><span class="row"><input id="xdfConst" value="${fmt(v, it.decimals)}" size="8"> ${esc(it.units || '')} <button class="btn" id="xdfConstSet">บันทึก</button></span></div><p class="muted">ค่าเดิม: ${fmt(Xdf.constValue(orig, it), it.decimals)}</p></div>`;
      $('xdfConstSet').onclick = () => { const x = parseFloat($('xdfConst').value); if (!isNaN(x)) { Xdf.setConst(bin, it, x); afterXdfEdit(); } };
    }
  }
}
function renderBytes(it) {
  $('xdfItem').textContent = it.title; $('xdfUnits').textContent = ''; $('xdfAddr').textContent = it.regs.map(r => '0x' + r.addr.toString(16).toUpperCase()).join(', ');
  if (!bin) { $('xdfGrid').innerHTML = '<p class="muted" style="padding:14px;margin:0">เปิดไฟล์ .bin ก่อน</p>'; return; }
  $('xdfGrid').innerHTML = '<div class="xdf-form" style="padding:14px">' + it.regs.map((r, i) => {
    const cur = Xdf.readBytes(bin, r.addr, r.len), was = Xdf.readBytes(orig, r.addr, r.len);
    return `<div class="item" style="flex-wrap:wrap"><span>${esc(r.label || ('ส่วน ' + (i + 1)))} <small class="muted">0x${r.addr.toString(16).toUpperCase()} · ${r.len} ไบต์</small></span>
      <span class="row"><input data-breg="${i}" value="${Xdf.toHex(cur)}" size="${r.len * 3}" class="mono" aria-label="hex"><span class="muted mono">"${esc(Xdf.toAscii(cur))}"</span><button class="btn" data-bset="${i}">บันทึก</button></span>
      <div class="muted" style="flex-basis:100%">เดิม: ${Xdf.toHex(was)} "${esc(Xdf.toAscii(was))}"</div></div>`;
  }).join('') + '<p class="muted">รหัสกล่อง (ECM ID) ใช้ตอนเปลี่ยนกล่องให้ตรงรุ่นเดิม แก้เป็นเลขฐานสิบหกทีละไบต์ · จำนวนไบต์ต้องเท่าเดิม</p></div>';
  it.regs.forEach((r, i) => $('xdfGrid').querySelector(`[data-bset="${i}"]`).onclick = () => {
    const by = Xdf.parseHex($('xdfGrid').querySelector(`[data-breg="${i}"]`).value);
    if (by.length !== r.len) return toast(`ต้องมี ${r.len} ไบต์ (ตอนนี้ ${by.length})`);
    Xdf.writeBytes(bin, r.addr, by); afterXdfEdit(); renderBytes(it); toast('แก้รหัสแล้ว');
  });
}
function renderService() {
  $('xdfItem').textContent = 'บริการช่าง'; $('xdfUnits').textContent = ''; $('xdfAddr').textContent = ''; $('xdfTools').hidden = true;
  if (!bin) { $('xdfGrid').innerHTML = '<p class="muted" style="padding:14px;margin:0">เปิดไฟล์ .bin ก่อน</p>'; return; }
  let h = '<div class="xdf-form" style="padding:14px"><b>เปิด/ปิด DTC เซนเซอร์ (ปิดเมื่อถอดอุปกรณ์นั้นออก)</b>';
  xdf.flags.forEach((f, i) => { const on = Xdf.flagValue(bin, f), was = Xdf.flagValue(orig, bin ? f : f); h += `<div class="item"><span>${esc(f.title)}</span><label class="row"><input type="checkbox" data-sflag="${i}" ${on ? 'checked' : ''}> <span data-slab="${i}">${on ? 'เปิด' : 'ปิด'}</span></label></div>`; });
  h += '<p class="muted">ปิดสวิตช์เพื่อดับไฟโชว์ของเซนเซอร์ที่ถอดออกจริง ไม่ควรปิดเซนเซอร์ที่ยังติดอยู่ หรือตัวที่เกี่ยวกับความปลอดภัย (มุมเอียง/ไอเสีย) เพราะรถอาจทำงานผิดปกติ</p>';
  for (const b of (xdf.bytefns || [])) for (let i = 0; i < b.regs.length; i++) { const r = b.regs[i], cur = Xdf.readBytes(bin, r.addr, r.len); h += `<div class="item"><span>${esc(b.title)} ${esc(r.label || '')}</span><span class="muted mono">${Xdf.toHex(cur)}</span></div>`; }
  h += '<p class="muted">แก้รหัสกล่องได้ที่หมวด “รหัสกล่อง / ID” ทางซ้าย</p></div>';
  $('xdfGrid').innerHTML = h;
  xdf.flags.forEach((f, i) => { const cb = $('xdfGrid').querySelector(`[data-sflag="${i}"]`); cb.onchange = () => { Xdf.setFlag(bin, f, cb.checked); $('xdfGrid').querySelector(`[data-slab="${i}"]`).textContent = cb.checked ? 'เปิด' : 'ปิด'; checkSum(); showHex(); showMap(); }; });
}
function afterXdfEdit() { renderXdfItem(); checkSum(); showHex(); showMap(); }

// ---------------- Quick Tune ----------------
let qtCls = { fuel: [], ignition: [], rev: [] };
function refreshQuickTune() {
  qtCls = QuickTune.classify(xdf);
  const show = bin && (qtCls.fuel.length || qtCls.ignition.length || qtCls.rev.length);
  $('qtPanel').hidden = !show; if (!show) return;
  $('qtFuelN').textContent = qtCls.fuel.length ? `(${qtCls.fuel.map(t => t.title).join(', ')})` : 'ไม่พบตารางน้ำมันใน XDF นี้';
  $('qtIgnN').textContent = qtCls.ignition.length ? `(${qtCls.ignition.map(t => t.title).join(', ')})` : 'ไม่พบตารางไฟ';
  const rev = qtCls.rev.length ? QuickTune.readRev(Xdf, bin, qtCls.rev) : null;
  $('qtRev').textContent = rev != null ? `ปัจจุบัน ${Math.round(rev)} rpm` : 'ไม่พบรอบตัด';
}
document.querySelectorAll('[data-qf]').forEach(b => b.onclick = () => {
  if (!qtCls.fuel.length) return toast('ไม่พบตารางน้ำมันใน XDF นี้'); 
  const n = QuickTune.applyFuelPct(Xdf, bin, qtCls.fuel, +b.dataset.qf);
  afterXdfEdit(); refreshQuickTune(); toast(`ปรับน้ำมัน ${b.dataset.qf > 0 ? '+' : ''}${b.dataset.qf}% (${n} ช่อง)`);
});
document.querySelectorAll('[data-qi]').forEach(b => b.onclick = async () => {
  if (!qtCls.ignition.length) return toast('ไม่พบตารางไฟใน XDF นี้');
  const deg = +b.dataset.qi, cap = Math.max(0.5, +$('qtIgnCap').value || 3);
  if (deg > 0 && !await ask(`เพิ่มองศาไฟ +${deg}° (เพดาน +${cap}°)
รถเล็กไม่มีเซนเซอร์น็อก ใส่ไฟมากเกินเครื่องพังได้
เพิ่มน้ำมันให้พอก่อน แล้ววิ่งเทสต์ฟังเสียงเครื่อง`, 'เพิ่มไฟ')) return;
  const r = QuickTune.applyIgnition(Xdf, bin, orig, qtCls.ignition, deg, cap);
  afterXdfEdit(); toast(`ปรับไฟ ${deg > 0 ? '+' : ''}${deg}° · แก้ ${r.changed} ช่อง${r.capped ? ` · ชนเพดาน ${r.capped} ช่อง` : ''}`, 5000);
});
$('qtRevBtn').onclick = async () => {
  if (!qtCls.rev.length) return toast('ไม่พบรอบตัดใน XDF นี้');
  const rpm = parseInt($('qtRevSet').value, 10); if (!rpm) return toast('ใส่รอบใหม่ก่อน');
  if (!await ask(`ตั้งรอบตัดเป็น ${QuickTune.capRev(rpm)} rpm?
ตั้งสูงเกินกำลังเครื่อง/วาล์วลอยทำเครื่องพังได้`, 'ตั้งรอบตัด')) return;
  const v = QuickTune.setRevLimit(Xdf, bin, qtCls.rev, rpm);
  afterXdfEdit(); refreshQuickTune(); toast(`ตั้งรอบตัด ${v} rpm`);
};
// 3D surface view
$('xdf3d').onchange = () => { const on = $('xdf3d').checked; $('xdf3dCanvas').hidden = !on; $('xdfGrid').style.display = on ? 'none' : ''; if (on) draw3d(); };
function draw3d() {
  const it = xdfSel; const cv = $('xdf3dCanvas'); if (!bin || !it || it === '__svc' || it.kind !== 'table') { $('xdf3d').checked = false; $('xdf3dCanvas').hidden = true; $('xdfGrid').style.display = ''; return; }
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, { rows, cols } = it.z;
  g.clearRect(0, 0, W, H);
  let lo = Infinity, hi = -Infinity; const v = [];
  for (let r = 0; r < rows; r++) { v.push([]); for (let c = 0; c < cols; c++) { const x = Xdf.tableValue(bin, it, r, c); v[r].push(x); lo = Math.min(lo, x); hi = Math.max(hi, x); } }
  const ox = W * 0.12, oy = H * 0.72, sx = (W * 0.76) / cols, sy = -(H * 0.42) / Math.max(1, hi - lo), dz = (H * 0.30) / rows, dx2 = (W * 0.10) / rows;
  const px = (r, c, val) => [ox + c * sx + r * dx2, oy - r * dz + (val - lo) * sy];
  for (let r = rows - 1; r >= 0; r--) for (let c = 0; c < cols - 1; c++) {
    const p0 = px(r, c, v[r][c]), p1 = px(r, c + 1, v[r][c + 1]);
    const p2 = r + 1 < rows ? px(r + 1, c + 1, v[r + 1][c + 1]) : null, p3 = r + 1 < rows ? px(r + 1, c, v[r + 1][c]) : null;
    if (p2 && p3) { const k = (v[r][c] - lo) / (hi - lo || 1); g.beginPath(); g.moveTo(...p0); g.lineTo(...p1); g.lineTo(...p2); g.lineTo(...p3); g.closePath(); g.fillStyle = `hsl(${190 - k * 190} 70% 60%)`; g.fill(); g.strokeStyle = 'rgba(0,0,0,.25)'; g.stroke(); }
  }
  g.fillStyle = css('--muted'); g.font = `20px ${css('--font-mono')}`; g.fillText(`${it.title} · ${it.z.units || ''}  (${fmt(lo, 1)}–${fmt(hi, 1)})`, 14, 28);
}
$('xdfGrid').addEventListener('mousedown', e => {
  const td = e.target.closest('td[data-r]'); if (!td) return;
  xdfDrag = [+td.dataset.r, +td.dataset.c]; if (!e.shiftKey && !e.ctrlKey) xdfCells.clear();
  xdfCells.add(xdfDrag.join(',')); paintXdfSel(); e.preventDefault();
});
$('xdfGrid').addEventListener('mouseover', e => {
  const td = e.target.closest('td[data-r]'); if (!td || !xdfDrag) return;
  const [r0, c0] = xdfDrag, r1 = +td.dataset.r, c1 = +td.dataset.c; xdfCells.clear();
  for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) xdfCells.add(r + ',' + c);
  paintXdfSel();
});
addEventListener('mouseup', () => xdfDrag = null);
function paintXdfSel() { $('xdfGrid').querySelectorAll('td[data-r]').forEach(td => td.classList.toggle('sel', xdfCells.has(td.dataset.r + ',' + td.dataset.c))); }
document.querySelectorAll('[data-xa]').forEach(b => b.onclick = () => {
  const it = xdfSel; if (!it || it.kind !== 'table' || !bin) return;
  if (!xdfCells.size) return toast('ลากเมาส์เลือกช่องในตารางก่อน');
  const a = b.dataset.xa, v = +b.dataset.v, cells = [...xdfCells].map(k => k.split(',').map(Number));
  if (a === 'smooth') {
    const src = cells.map(([r, c]) => { let s = 0, n = 0; for (const [dr, dc] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) { const rr = r + dr, cc = c + dc; if (rr >= 0 && cc >= 0 && rr < it.z.rows && cc < it.z.cols) { s += Xdf.tableValue(bin, it, rr, cc); n++; } } return s / n; });
    cells.forEach(([r, c], i) => Xdf.setTableValue(bin, it, r, c, src[i]));
  } else for (const [r, c] of cells) {
    const cur = Xdf.tableValue(bin, it, r, c);
    if (a === 'undo') { Xdf.writeRaw(bin, Xdf.cellAddr(it.z, r, c), it.z.bits, it.z.signed, it.z.lsb, Xdf.tableRaw(orig, it, r, c)); continue; }
    let nv = a === 'set' ? parseFloat($('xdfSet').value) : a === 'add' ? cur + v : cur * (1 + v / 100);
    if (isNaN(nv)) return toast('ใส่ค่าก่อนกด “ตั้งค่า”');
    if (it.z.max != null && it.z.min != null && it.z.max > it.z.min) nv = Math.max(it.z.min, Math.min(it.z.max, nv));
    Xdf.setTableValue(bin, it, r, c, nv);
  }
  afterXdfEdit();
});

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
  $('mfInfo').textContent = `เจอ ${found.length} ตาราง (${main.length} ตารางมีแกนชัดเจน ◆) ใน ${Math.round(performance.now() - t0)} ms — กดเพื่อเปิด`;
  $('mfList').innerHTML = '<div class="pick">' + found.map((t, i) => {
    const big = t.anchored && t.rows * t.cols >= 200;
    return `<button data-mf="${i}" title="${t.type}${t.xAxis ? ` แกน X ${t.xAxis[0]}…${t.xAxis.at(-1)}` : ''}${t.yAxis ? ` แกน Y ${t.yAxis[0]}…${t.yAxis.at(-1)}` : ''}">${t.anchored ? '◆ ' : ''}${big ? '<b>' : ''}${hx(t.off)} · ${t.cols}×${t.rows}${t.twin ? ` (ชุด ${t.twin + 1})` : ''}${big ? '</b>' : ''}</button>`;
  }).join('') + '</div>' + (main.some(t => t.rows * t.cols >= 200) ? '<p class="muted">ตารางใหญ่ที่ตัวหนา (เช่น 25×29, 29×29) มักเป็นแมพน้ำมันหลัก ชุด 1 กับชุด 2 ใช้แกนเดียวกัน ควรปรับไปพร้อมกัน · ชื่อและหน่วยของตารางยังต้องยืนยันเอง เพราะไม่มี XDF</p>' : '');
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
  $('cmpList').innerHTML = `<p class="muted">เทียบกับ <b>${esc(cmpName)}</b>${cmp.length !== bin.length ? ` · ขนาดไม่เท่ากัน (${cmp.length.toLocaleString()} / ${bin.length.toLocaleString()} B)` : ''} — ต่างกัน ${ranges.length} ช่วง (${bytes.toLocaleString()} ไบต์) · ช่องในตารางที่ต่างจะมีลายขีด</p>`
    + '<div class="pick">' + ranges.slice(0, 120).map(([s, e], i) => { const t = inTable([s, e]); return `<button data-rg="${s}" title="${e - s} ไบต์">${t ? '◆ ' : ''}${hx(s)}–${hx(e - 1)}</button>`; }).join('')
    + (ranges.length > 120 ? `<span class="muted">… อีก ${ranges.length - 120} ช่วง</span>` : '') + `<button id="cmpClear">✕ เลิกเทียบ</button></div>`;
}
$('cmpList').onclick = e => {
  if (e.target.id === 'cmpClear') { cmp = null; renderCmp(); showMap(); showHex(); return; }
  const b = e.target.closest('[data-rg]'); if (!b) return;
  const s = +b.dataset.rg, t = found.find(t => s >= t.off && s < t.off + t.bytes);
  if (t) useTable(t, `ตาราง ${hx(t.off)}`);
  else { $('hexGo').value = s.toString(16); showHex(); document.querySelector('#p-tuner details').open = true; $('hexView').scrollIntoView({ behavior: 'smooth' }); }
};

// ---------------- Shop tools ----------------
function calc() {
  const n = id => parseFloat($(id).value), disp = Tools.displacement(n('cBore') || 0, n('cStroke') || 0, n('cCyl') || 1);
  $('cDisp').textContent = disp ? disp + ' cc' : '—';
  const hp = n('cHp') || 0, injN = Math.max(1, n('cInjN') || 1), duty = Math.min(0.99, (n('cDuty') || 80) / 100);
  const need = Tools.injectorNeeded(hp, { cyl: injN, duty });
  $('cInjNeed').textContent = need ? need + ' cc/min' : '—';
  $('cInjNote').textContent = need ? `ต่อหัว ${injN} หัว ที่รอบใช้งาน ${Math.round(duty * 100)}% · หัวฉีดจริงควรเผื่อขึ้นเบอร์ถัดไป` : '';
  const sc = Tools.fuelScale({ oldCc: n('cOldCc') || null, newCc: n('cNewCc') || null, oldDisp: n('cOldD') || null, newDisp: n('cNewD') || null });
  $('cScale').textContent = sc.toFixed(3);
}
['cBore', 'cStroke', 'cCyl', 'cHp', 'cInjN', 'cDuty', 'cOldCc', 'cNewCc', 'cOldD', 'cNewD'].forEach(id => $(id).addEventListener('input', calc));
function renderDtcRef() {
  const q = $('dtcQ').value, rows = Tools.dtcSearch(q);
  $('dtcRefBody').innerHTML = rows.map(d => `<tr><td><span class="code">${d.code}</span></td><td>${esc(d.name)}</td><td>${esc(d.cause)}</td><td class="muted">${esc(d.check)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">ไม่พบ</td></tr>';
}
$('dtcQ').addEventListener('input', renderDtcRef);
function catBike() { const r = binFileName ? Catalog.match(binFileName) : null; return r ? r.model : ''; }
let lastReport = null;
$('rpGen').onclick = () => {
  const B = store.get('dyno', {}).before, A = store.get('dyno', {}).after, esc2 = esc;
  const dtcRows = [...($('dtcBody').querySelectorAll('tr'))].map(tr => tr.textContent.trim()).filter(t => /\d-\d/.test(t));
  const rows = [];
  rows.push(['ร้าน', esc2(settings.brand)]);
  if ($('rpCust').value) rows.push(['ลูกค้า', esc2($('rpCust').value)]);
  rows.push(['รถ', esc2($('rpBike').value || catBike() || '—')]);
  if ($('rpKm').value) rows.push(['เลขไมล์', esc2($('rpKm').value) + ' กม.']);
  if (ecu.id) rows.push(['กล่อง ECU', esc2(ecu.id)]);
  rows.push(['วันที่', new Date().toLocaleString('th-TH')]);
  let dyno = '';
  if (A && B) dyno = `<table><tr><th>แรงม้าที่ล้อ</th><td>ก่อน <b class="big">${B.maxHp}</b> → หลัง <b class="big">${A.maxHp}</b> HP (${A.maxHp - B.maxHp >= 0 ? '+' : ''}${(A.maxHp - B.maxHp).toFixed(1)} HP)</td></tr>`
    + (A.time != null && B.time != null ? `<tr><th>${B.from}–${B.to} km/h</th><td>ก่อน ${B.time} → หลัง ${A.time} วิ</td></tr>` : '') + `<tr><th>ความเร็วสูงสุด</th><td>ก่อน ${B.vmax} → หลัง ${A.vmax} km/h</td></tr></table>`;
  else if (A || B) { const r = A || B; dyno = `<table><tr><th>แรงม้าที่ล้อ</th><td class="big">${r.maxHp} HP</td></tr><tr><th>ความเร็วสูงสุด</th><td>${r.vmax} km/h</td></tr></table>`; }
  const logo = settings.logoImg ? `<img src="${settings.logoImg}" style="height:46px;border-radius:6px">` : '';
  const html = `<div class="sheet"><div class="hd"><div style="display:flex;align-items:center;gap:10px">${logo}<div><h2>${esc2(settings.brand)}</h2><small>ใบส่งงานปรับแต่ง ECU</small></div></div><div class="muted">${new Date().toLocaleDateString('th-TH')}</div></div>`
    + `<table>${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>`
    + (dyno ? `<b>ผลทดสอบ Dyno</b>${dyno}` : '')
    + ($('rpNote').value ? `<b>รายการที่ทำ</b><p>${esc2($('rpNote').value).replace(/\n/g, '<br>')}</p>` : '')
    + (dtcRows.length ? `<b>รหัสปัญหาที่พบ</b><p>${dtcRows.map(esc2).join('<br>')}</p>` : '')
    + `<p class="muted">เอกสารนี้สรุปจากข้อมูลที่วัดในเครื่องมือ SM Remap · แรงม้าเป็นค่าประมาณที่ล้อ</p></div>`;
  $('rpOut').innerHTML = html; $('rpSave').disabled = false;
  lastReport = `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>ใบส่งรถ ${esc2($('rpBike').value || '')}</title>`
    + `<style>body{font-family:system-ui,'Segoe UI',sans-serif;max-width:700px;margin:24px auto;padding:0 16px;color:#13222b}h2{margin:0 0 2px}.hd{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #0a8f86;padding-bottom:8px;margin-bottom:10px}.hd img{height:46px;border-radius:6px;margin-right:10px;vertical-align:middle}table{width:100%;border-collapse:collapse;margin:6px 0}td,th{border:1px solid #ccc;padding:6px 9px;text-align:left}th{background:#f3f6f7;width:38%}.big{font-size:20px;color:#0a8f86;font-weight:700}.muted{color:#5a6b73}</style></head><body>${html}</body></html>`;
};
$('rpSave').onclick = async () => {
  if (!lastReport) return;
  const name = `ใบส่งรถ_${($('rpBike').value || 'bike').replace(/\s/g, '')}_${new Date().toISOString().slice(0, 10)}.html`;
  await db.add({ name, kind: 'other', data: new TextEncoder().encode(lastReport).buffer });
  download(name, lastReport, 'text/html'); toast('บันทึกใบส่งรถลงคลังแล้ว');
};

// ---------------- PWA ----------------
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
