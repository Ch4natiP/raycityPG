// โพสต์ขาย — photo in, styled post image + Thai sales captions out.
const $ = id => document.getElementById(id);
const canvas = $('canvas');
const ctx = canvas.getContext('2d');
const SIZE = canvas.width;

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
let deviceId = store.get('pk.device');
if (!deviceId) {
  deviceId = (crypto.randomUUID?.() || String(Math.random()).slice(2)) + '';
  store.set('pk.device', deviceId);
}

// Inside a claude.ai artifact there is no server: the page asks Claude through the
// viewer's own account (the `sample` capability) and saves through `downloads`.
const inArtifact = !!window.claude;
let sample = null;

const BGS = [
  { id: 'photo', label: 'รูปเดิม', fill: null },
  { id: 'white', fill: ['#ffffff', '#f1f1f1'] },
  { id: 'cream', fill: ['#fff6e9', '#f5e3c8'] },
  { id: 'pink', fill: ['#ffe4ec', '#ffc2d4'] },
  { id: 'sky', fill: ['#e3f2ff', '#b9dcff'] },
  { id: 'mint', fill: ['#e6fbf1', '#bdeed6'] },
  { id: 'night', fill: ['#2b2b3a', '#0f0f17'], dark: true },
];
const PLATFORM_NAMES = { facebook: 'Facebook', tiktok: 'TikTok', shopee: 'Shopee / Lazada', line: 'LINE' };

const state = {
  photo: null,      // original ImageBitmap/Image
  cutout: null,     // background-removed image, if made
  bg: 'white',
  tone: 'friendly',
  platforms: new Set(['facebook', 'tiktok', 'shopee']),
  proCode: store.get('pk.pro') || '',
  result: null,
};

// ---------- photo ----------
async function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const img = await loadImage(URL.createObjectURL(file));
  state.photo = img;
  state.cutout = null;
  $('cutNote').hidden = true;
  $('drop').hidden = true;
  $('editor').hidden = false;
  $('goBtn').disabled = false;
  draw();
}
function loadImage(src) {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = fail;
    img.src = src;
  });
}

$('file').addEventListener('change', e => loadFile(e.target.files[0]));
$('changeBtn').addEventListener('click', () => $('file').click());
const drop = $('drop');
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); loadFile(e.dataTransfer.files[0]); });

// ---------- drawing ----------
function fit(w, h, boxW, boxH, cover) {
  const s = cover ? Math.max(boxW / w, boxH / h) : Math.min(boxW / w, boxH / h);
  return { w: w * s, h: h * s };
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function draw() {
  const img = state.cutout || state.photo;
  if (!img) return;
  const bg = BGS.find(b => b.id === state.bg);
  const shop = $('shop').value.trim();
  const price = $('price').value.trim();
  const footer = shop || price ? 150 : 0;
  ctx.clearRect(0, 0, SIZE, SIZE);

  if (!bg.fill) {
    // Full-bleed photo; a soft gradient keeps the footer text readable.
    const d = fit(state.photo.width, state.photo.height, SIZE, SIZE, true);
    ctx.drawImage(state.photo, (SIZE - d.w) / 2, (SIZE - d.h) / 2, d.w, d.h);
    if (footer) {
      const g = ctx.createLinearGradient(0, SIZE - 320, 0, SIZE);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,.6)');
      ctx.fillStyle = g;
      ctx.fillRect(0, SIZE - 320, SIZE, 320);
    }
  } else {
    const g = ctx.createLinearGradient(0, 0, SIZE, SIZE);
    g.addColorStop(0, bg.fill[0]);
    g.addColorStop(1, bg.fill[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SIZE, SIZE);

    const pad = 90;
    const boxH = SIZE - pad * 2 - footer + (footer ? 40 : 0);
    const d = fit(img.width, img.height, SIZE - pad * 2, boxH, false);
    const x = (SIZE - d.w) / 2;
    const y = pad + (boxH - d.h) / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.22)';
    ctx.shadowBlur = 50;
    ctx.shadowOffsetY = 24;
    if (state.cutout) {
      ctx.drawImage(img, x, y, d.w, d.h);
    } else {
      roundRect(x, y, d.w, d.h, 28);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.clip();
      ctx.drawImage(img, x, y, d.w, d.h);
    }
    ctx.restore();
  }

  const light = !bg.fill || bg.dark;
  ctx.textBaseline = 'middle';
  if (price) {
    const text = `฿${Number(price).toLocaleString('th-TH')}`;
    ctx.font = '800 64px "Noto Sans Thai", sans-serif';
    const w = ctx.measureText(text).width + 64;
    roundRect(60, SIZE - 125, w, 96, 48);
    ctx.fillStyle = '#ff6b3d';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(text, 92, SIZE - 75);
  }
  if (shop) {
    ctx.font = '600 40px "Noto Sans Thai", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = light ? 'rgba(255,255,255,.92)' : 'rgba(40,30,25,.75)';
    ctx.fillText(shop, SIZE - 60, SIZE - 75);
    ctx.textAlign = 'left';
  }
}

const bgs = $('bgs');
for (const b of BGS) {
  const el = document.createElement('button');
  el.type = 'button';
  el.dataset.v = b.id;
  if (b.fill) {
    el.className = 'swatch';
    el.style.background = `linear-gradient(135deg, ${b.fill[0]}, ${b.fill[1]})`;
    el.setAttribute('aria-label', `พื้นหลัง ${b.id}`);
  } else {
    el.className = 'chip';
    el.textContent = b.label;
  }
  bgs.append(el);
}
function pick(group, value, multi) {
  for (const el of group.children) {
    if (multi) { if (el.dataset.v === value) el.classList.toggle('on'); }
    else el.classList.toggle('on', el.dataset.v === value);
  }
}
pick(bgs, state.bg);
bgs.addEventListener('click', e => {
  const v = e.target.closest('button')?.dataset.v;
  if (!v) return;
  state.bg = v;
  pick(bgs, v);
  draw();
});
$('tones').addEventListener('click', e => {
  const v = e.target.closest('button')?.dataset.v;
  if (!v) return;
  state.tone = v;
  pick($('tones'), v);
});
$('platforms').addEventListener('click', e => {
  const v = e.target.closest('button')?.dataset.v;
  if (!v) return;
  if (state.platforms.has(v) && state.platforms.size === 1) return;
  state.platforms.has(v) ? state.platforms.delete(v) : state.platforms.add(v);
  pick($('platforms'), v, true);
});
for (const id of ['shop', 'price']) $(id).addEventListener('input', draw);
document.fonts?.ready.then(draw);

// ---------- background removal (runs on the phone, no upload) ----------
$('cutBtn').addEventListener('click', async () => {
  const btn = $('cutBtn');
  const note = $('cutNote');
  btn.disabled = true;
  note.hidden = false;
  note.textContent = 'กำลังลบพื้นหลัง… ครั้งแรกต้องโหลดโมเดลประมาณ 1 นาที';
  try {
    const { removeBackground } = await import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm');
    const src = await new Promise(ok => photoCanvas(1600).toBlob(ok, 'image/png'));
    const out = await removeBackground(src);
    state.cutout = await loadImage(URL.createObjectURL(out));
    if (state.bg === 'photo') { state.bg = 'white'; pick(bgs, 'white'); }
    note.textContent = 'ลบพื้นหลังแล้ว ✓';
    draw();
  } catch (err) {
    console.error(err);
    note.textContent = 'ลบพื้นหลังไม่สำเร็จ ลองใหม่อีกครั้ง หรือใช้พื้นหลังแบบกรอบรูปแทน';
  } finally {
    btn.disabled = false;
  }
});

// The original photo, scaled down so it uploads fast and costs less.
function photoCanvas(max) {
  const p = state.photo;
  const s = Math.min(1, max / Math.max(p.width, p.height));
  const c = document.createElement('canvas');
  c.width = Math.round(p.width * s);
  c.height = Math.round(p.height * s);
  c.getContext('2d').drawImage(p, 0, 0, c.width, c.height);
  return c;
}

// ---------- quota / pro ----------
async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId, proCode: state.proCode, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}
function showQuota(left, pro) {
  const btn = $('quotaBtn');
  btn.classList.toggle('pro', !!pro);
  btn.innerHTML = pro ? 'Pro <b>ไม่จำกัด</b>' : `ฟรีวันนี้ <b>${left}</b>`;
}
let demo = false;
async function refreshQuota() {
  if (inArtifact) {
    $('quotaBtn').hidden = true;
    sample = await claude.use('sample');
    demo = !sample;
    return;
  }
  try {
    const r = await post('/api/quota', {});
    if (!r.ok) throw new Error(r.status);
    showQuota(r.data.left, r.data.pro);
  } catch {
    demo = true;
    $('quotaBtn').innerHTML = 'โหมด<b>ตัวอย่าง</b>';
  }
}
const ready = refreshQuota();

$('quotaBtn').addEventListener('click', () => { $('proCode').value = state.proCode; $('proDlg').showModal(); });
$('proDlg').addEventListener('close', () => {
  if ($('proDlg').returnValue !== 'ok') return;
  state.proCode = $('proCode').value.trim();
  store.set('pk.pro', state.proCode);
  refreshQuota();
});

// ---------- generate ----------
function setStatus(text, err) {
  const s = $('status');
  s.innerHTML = text;
  s.classList.toggle('err', !!err);
}

$('goBtn').addEventListener('click', async () => {
  if (!state.photo) return;
  const btn = $('goBtn');
  btn.disabled = true;
  setStatus('<span class="spin">⏳</span> กำลังดูรูปและเขียนแคปชัน…');
  await ready;
  const input = {
    name: $('name').value.trim(),
    price: $('price').value.trim(),
    details: $('details').value.trim(),
    tone: state.tone,
    platforms: [...state.platforms],
  };
  try {
    if (demo) {
      showResult(demoResult(input), true);
      setStatus('นี่คือตัวอย่างจากแม่แบบ ยังไม่ได้ใช้ AI (ยังไม่ได้เชื่อมเซิร์ฟเวอร์)');
      return;
    }
    if (sample) {
      showResult(await askClaude(input));
      setStatus('เสร็จแล้ว ✓');
      return;
    }
    const image = photoCanvas(1024).toDataURL('image/jpeg', 0.85).split(',')[1];
    const r = await post('/api/generate', { ...input, image, mediaType: 'image/jpeg' });
    if (r.status === 429) {
      setStatus(`ใช้ฟรีครบ ${r.data.perDay} ครั้งของวันนี้แล้ว พรุ่งนี้มาใหม่ หรืออัปเกรดเป็น Pro`, true);
      showQuota(0);
      $('proDlg').showModal();
      return;
    }
    if (r.status === 422) return setStatus('รูปนี้สร้างแคปชันไม่ได้ ลองรูปสินค้าอื่น', true);
    if (!r.ok) return setStatus('ระบบไม่ว่างชั่วคราว ลองใหม่อีกครั้งในอีกสักครู่', true);
    showQuota(r.data.left, r.data.pro);
    showResult(r.data.result);
    setStatus('เสร็จแล้ว ✓');
  } catch (err) {
    console.error(err);
    setStatus(SAMPLE_ERRORS[err?.code] || 'เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่', true);
  } finally {
    btn.disabled = false;
  }
});

const SAMPLE_ERRORS = {
  not_granted: 'ต้องกดอนุญาตให้หน้านี้ใช้ Claude ก่อน จึงจะเขียนแคปชันได้',
  sampling_disabled: 'บัญชีนี้ใช้ Claude จากหน้านี้ไม่ได้',
  rate_limited: 'ใช้บ่อยเกินไป รอสักครู่แล้วลองใหม่',
  refused: 'รูปนี้สร้างแคปชันไม่ได้ ลองรูปสินค้าอื่น',
  invalid_json: 'AI ตอบกลับมาไม่ครบ กดสร้างใหม่อีกครั้ง',
  image_rejected: 'ใช้รูปนี้ไม่ได้ ลองรูป JPG หรือ PNG อื่น',
  session_expired: 'กรุณาเข้าสู่ระบบ claude.ai ใหม่',
  upstream_error: 'ระบบไม่ว่างชั่วคราว ลองใหม่อีกครั้งในอีกสักครู่',
};

// Same rules as server.mjs, sent as one prompt because `sample` has no system prompt.
async function askClaude({ name, price, details, tone, platforms }) {
  const caps = await sample.limits().catch(() => null);
  const images = caps?.images
    ? [await new Promise(ok => photoCanvas(1024).toBlob(ok, 'image/jpeg', 0.85))]
    : undefined;
  const TONES = { friendly: 'เป็นกันเอง น่ารัก', pro: 'มืออาชีพ น่าเชื่อถือ', urgent: 'เร่งขาย มีของจำกัด', premium: 'หรูหรา พรีเมียม' };
  const prompt = [
    'คุณคือนักเขียนคำโฆษณาขายของออนไลน์ภาษาไทย ช่วยแม่ค้ารายย่อยเขียนโพสต์ขายสินค้า' + (images ? 'จากรูปที่แนบมา' : ''),
    '- เขียนภาษาไทยที่คนไทยใช้จริง อ่านง่าย ใส่อีโมจิพอดี ๆ',
    '- บรรยายเฉพาะสิ่งที่เห็นในรูปหรือที่ผู้ขายบอก ห้ามแต่งสเปก ขนาด วัสดุ หรือสรรพคุณ ถ้าไม่รู้ให้เว้นเป็น [ใส่ขนาด] หรือ [ใส่สี]',
    '- ห้ามอ้างสรรพคุณทางการแพทย์ ห้ามรับประกันผลลัพธ์',
    '- Facebook ยาวได้ มีจุดเด่นเป็นข้อ ๆ และบอกวิธีสั่ง / TikTok สั้น เปิดด้วยประโยคดึงความสนใจ / Shopee เป็นคำบรรยายสินค้ามีหัวข้อ / LINE สั้นเหมือนส่งหาลูกค้าประจำ',
    '',
    name && `ชื่อสินค้า: ${name}`,
    price && `ราคาที่ผู้ขายตั้ง: ${price} บาท`,
    details && `รายละเอียดจากผู้ขาย: ${details}`,
    `โทน: ${TONES[tone] || TONES.friendly}`,
    `เขียนแคปชันสำหรับ: ${platforms.join(', ')} (แพลตฟอร์มละ 1 แคปชัน)`,
    '',
    'ตอบเป็น JSON อย่างเดียว รูปแบบนี้:',
    '{"captions":[{"platform":"facebook","text":"..."}],"hashtags":["พร้อมส่ง","..."],"price":{"min":250,"max":390,"note":"ราคาตลาดออนไลน์โดยประมาณ"}}',
    'platform ใช้ได้เฉพาะ facebook, tiktok, shopee, line · hashtags 8-12 อัน ไม่ต้องใส่ # · price เป็นช่วงราคาตลาดไทยโดยประมาณ (บาท)',
  ].filter(s => s !== '' && s != null && s !== false).join('\n');

  const r = await sample.json(prompt, { images, cache: false });
  const captions = (Array.isArray(r?.captions) ? r.captions : [])
    .filter(c => c && typeof c.text === 'string' && PLATFORM_NAMES[c.platform]);
  if (!captions.length) throw { code: 'invalid_json' };
  const min = Number(r.price?.min), max = Number(r.price?.max);
  return {
    captions,
    hashtags: Array.isArray(r.hashtags) ? r.hashtags.map(String).slice(0, 15) : [],
    price: min > 0 && max >= min ? { min, max, note: String(r.price.note || '') } : null,
  };
}

function showResult(result, isDemo) {
  state.result = result;
  const caps = $('captions');
  caps.replaceChildren();
  for (const c of result.captions) {
    const box = document.createElement('div');
    box.className = 'cap';
    const head = document.createElement('div');
    head.className = 'cap-head';
    const title = document.createElement('b');
    title.textContent = PLATFORM_NAMES[c.platform] || c.platform;
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'btn ghost small copy';
    copy.textContent = 'คัดลอก';
    copy.dataset.text = c.text;
    const pre = document.createElement('pre');
    pre.textContent = c.text;
    head.append(title, copy);
    box.append(head, pre);
    caps.append(box);
  }
  $('tags').textContent = result.hashtags.map(t => '#' + t.replace(/^#/, '').replace(/\s+/g, '')).join(' ');

  const tip = $('priceTip');
  const { min, max, note } = result.price || {};
  tip.hidden = isDemo || !(min || max);
  if (!tip.hidden) {
    tip.textContent = `💡 ราคาตลาดโดยประมาณ ${Math.round(min).toLocaleString('th-TH')}–${Math.round(max).toLocaleString('th-TH')} บาท${note ? ' · ' + note : ''}`;
  }
  $('result').hidden = false;
  $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('result').addEventListener('click', async e => {
  const btn = e.target.closest('.copy');
  if (!btn) return;
  const text = btn.dataset.copy === 'tags' ? $('tags').textContent : btn.dataset.text;
  try {
    await navigator.clipboard.writeText(text);
    const old = btn.textContent;
    btn.textContent = 'คัดลอกแล้ว ✓';
    setTimeout(() => { btn.textContent = old; }, 1500);
  } catch {
    setStatus('คัดลอกอัตโนมัติไม่ได้ กดค้างที่ข้อความเพื่อคัดลอกเอง', true);
  }
});

// ---------- save / share ----------
const imageBlob = () => new Promise(ok => canvas.toBlob(ok, 'image/jpeg', 0.92));
const fileName = () => `postkai-${Date.now()}.jpg`;
$('saveBtn').addEventListener('click', async () => {
  if (inArtifact) {
    const downloads = await claude.use('downloads');
    if (!downloads) return setStatus('บันทึกรูปจากหน้านี้ไม่ได้ กดค้างที่รูปเพื่อบันทึกแทน', true);
    try { await downloads.save({ filename: fileName(), data: await imageBlob() }); }
    catch (e) { if (e?.code !== 'declined') setStatus('บันทึกรูปไม่สำเร็จ ลองใหม่อีกครั้ง', true); }
    return;
  }
  const url = URL.createObjectURL(await imageBlob());
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName() });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});
if (navigator.canShare?.({ files: [new File([''], 'x.jpg', { type: 'image/jpeg' })] })) {
  $('shareBtn').hidden = false;
  $('shareBtn').addEventListener('click', async () => {
    const file = new File([await imageBlob()], fileName(), { type: 'image/jpeg' });
    const text = state.result?.captions[0]?.text || '';
    try { await navigator.share({ files: [file], text }); } catch {}
  });
}

// ---------- demo mode (no server): simple templates so the app can be shown anywhere ----------
function demoResult({ name, price, details, platforms }) {
  const n = name || 'สินค้าตัวนี้';
  const p = price ? `ราคาเพียง ${Number(price).toLocaleString('th-TH')} บาท` : 'ราคา [ใส่ราคา] บาท';
  const extra = details ? `\n${details}` : '';
  const T = {
    facebook: `✨ ${n} มาแล้วจ้า ✨\n\n✅ [จุดเด่นที่ 1]\n✅ [จุดเด่นที่ 2]\n✅ [จุดเด่นที่ 3]${extra}\n\n💰 ${p}\n📦 พร้อมส่งทั่วไทย\n💬 สนใจทักแชทได้เลยค่ะ`,
    tiktok: `ใครกำลังหา${n}อยู่ ต้องดูตัวนี้! 👀 ${p} กดตะกร้าได้เลย 🛒`,
    shopee: `【${n}】\n\nรายละเอียดสินค้า\n• [ขนาด]\n• [วัสดุ]\n• [สี]${extra}\n\n${p}\nสินค้าพร้อมส่ง จัดส่งภายใน 1-2 วัน`,
    line: `สวัสดีค่ะ 😊 ร้านมี${n}เข้าใหม่ ${p} สนใจตอบกลับข้อความนี้ได้เลยนะคะ`,
  };
  return {
    captions: platforms.map(pl => ({ platform: pl, text: T[pl] })),
    hashtags: ['ของดีบอกต่อ', 'พร้อมส่ง', 'ส่งทั่วไทย', 'ร้านค้าออนไลน์', 'ช้อปออนไลน์'],
    price: null,
  };
}

if (inArtifact) $('cutBtn').hidden = true; // its model download is blocked inside an artifact
else if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
