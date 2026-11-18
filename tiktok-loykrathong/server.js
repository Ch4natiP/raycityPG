// ลอยกระทงออนไลน์ — TikTok LIVE interactive overlay server
// รัน: npm install && npm start  แล้วเปิด http://localhost:3000
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

// ---------------------------------------------------------------------------
// Config (แก้ได้จากหน้าควบคุม แล้วบันทึกลง data/config.json)
// ---------------------------------------------------------------------------
const DEFAULT_CONFIG = {
  title: 'แม่น้ำเจ้าพระยา กรุงเทพฯ',
  subtitle: 'พิมพ์ "ลอย" ลอยกระทงฟรี • ส่งของขวัญเพื่อกระทงสุดพิเศษ',
  floatKeywords: ['ลอย', 'ลอยกระทง', 'float'],
  goal: 300,
  freeCooldownSec: 8,       // คนเดียวพิมพ์ "ลอย" ฟรีได้ทุกกี่วินาที
  likesPerFirework: 300,    // ไลค์รวมครบเท่านี้ ยิงพลุ 1 ชุด
  maxPerGift: 30,           // กระทงสูงสุดต่อการส่งของขวัญ 1 ครั้ง (กันจอแน่น)
  sound: true,
  showCharacters: true,
  tiers: [
    { id: 'leaf',   name: 'กระทงใบตอง',          minCoins: 0,   free: true },
    { id: 'lotus',  name: 'กระทงดอกบัวชมพู',      minCoins: 1 },
    { id: 'marigold', name: 'กระทงดาวเรือง',     minCoins: 10 },
    { id: 'gold',   name: 'กระทงทองคำ + พลุ',     minCoins: 99 },
    { id: 'royal',  name: 'กระทงยักษ์ + โคมลอย',   minCoins: 500 },
  ],
};

const DEFAULT_STATE = { floated: 0, likes: 0, likesSinceFirework: 0, users: {}, wishes: [] };

function readJson(file, fallback) {
  try { return { ...structuredClone(fallback), ...JSON.parse(fs.readFileSync(file, 'utf8')) }; }
  catch { return structuredClone(fallback); }
}
fs.mkdirSync(DATA_DIR, { recursive: true });
let config = readJson(CONFIG_FILE, DEFAULT_CONFIG);
let state = readJson(STATE_FILE, DEFAULT_STATE);

let saveTimer = null;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(STATE_FILE, JSON.stringify(state), () => {});
  }, 1000);
}

// ---------------------------------------------------------------------------
// Static file server
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.json': 'application/json',
};
const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  if (urlPath === '/overlay') urlPath = '/overlay.html';
  const file = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
});

// ---------------------------------------------------------------------------
// WebSocket hub: overlay + หน้าควบคุม ต่อเข้ามาที่ /ws
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ server, path: '/ws' });
function broadcast(msg) {
  const s = JSON.stringify(msg);
  for (const c of wss.clients) if (c.readyState === 1) c.send(s);
}
function log(text, level = 'info') {
  const line = { t: Date.now(), text, level };
  console.log(`[${new Date().toLocaleTimeString('th-TH')}] ${text}`);
  broadcast({ type: 'log', line });
}

function publicState() {
  const top = Object.values(state.users)
    .filter(u => u.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, 5)
    .map(u => ({ name: u.name, points: u.points, avatar: u.avatar }));
  return { floated: state.floated, likes: state.likes, goal: config.goal, top, wishes: state.wishes.slice(0, 4) };
}
let stateTimer = null;
function pushState() {
  if (stateTimer) return;
  stateTimer = setTimeout(() => { stateTimer = null; broadcast({ type: 'state', state: publicState() }); }, 150);
}

// ---------------------------------------------------------------------------
// Game logic — แปลงเหตุการณ์จาก TikTok เป็นกระทง/เอฟเฟกต์
// ---------------------------------------------------------------------------
function getUser(u) {
  const id = String(u.id || u.name || 'anon');
  let rec = state.users[id];
  if (!rec) rec = state.users[id] = { id, name: u.name || id, avatar: u.avatar || '', points: 0, krathongs: 0, lastFree: 0 };
  if (u.name) rec.name = u.name;
  if (u.avatar) rec.avatar = u.avatar;
  return rec;
}

function tierForCoins(coins) {
  const paid = config.tiers.filter(t => !t.free).sort((a, b) => b.minCoins - a.minCoins);
  return paid.find(t => coins >= t.minCoins) || paid[paid.length - 1];
}

function addWish(name, text) {
  text = String(text).replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!text) return '';
  state.wishes.unshift({ name, text, t: Date.now() });
  state.wishes.length = Math.min(state.wishes.length, 20);
  return text;
}

function floatKrathong(user, tier, count, wish) {
  const rec = getUser(user);
  rec.krathongs += count;
  state.floated += count;
  const prevGoal = state.floated - count;
  broadcast({
    type: 'float',
    user: { id: rec.id, name: rec.name, avatar: rec.avatar },
    tier: tier.id, tierName: tier.name, count: Math.min(count, config.maxPerGift), wish: wish || '',
  });
  if (config.goal > 0 && prevGoal < config.goal && state.floated >= config.goal) {
    broadcast({ type: 'fx', fx: 'goal' });
    log(`🎉 ครบเป้าหมาย ${config.goal} กระทงแล้ว!`);
  }
  saveSoon(); pushState();
}

function handleEvent(ev) {
  const user = ev.user || {};
  switch (ev.kind) {
    case 'join': {
      getUser(user);
      broadcast({ type: 'join', user });
      break;
    }
    case 'chat': {
      const text = String(ev.comment || '').trim();
      const lower = text.toLowerCase();
      broadcast({ type: 'chat', user, comment: text });
      const kw = config.floatKeywords.find(k => lower.startsWith(k.toLowerCase()));
      if (kw) {
        const rec = getUser(user);
        const now = Date.now();
        if (now - rec.lastFree < config.freeCooldownSec * 1000) return;
        rec.lastFree = now;
        rec.points += 1;
        // ข้อความหลังคีย์เวิร์ด = คำอธิษฐาน เช่น "ลอย ขอให้รวยๆ"
        const wish = addWish(rec.name, text.slice(kw.length));
        const free = config.tiers.find(t => t.free) || config.tiers[0];
        floatKrathong(user, free, 1, wish);
        log(`🪷 ${rec.name} ลอย${free.name}${wish ? ` — "${wish}"` : ''}`);
      } else if (/^(ชาย|หญิง|ผู้ชาย|ผู้หญิง)$/.test(text)) {
        broadcast({ type: 'gender', user, gender: text.includes('ชาย') ? 'm' : 'f' });
      } else if (/^(สวัสดี|ไหว้|สาธุ)/.test(text)) {
        broadcast({ type: 'wai', user });
      }
      break;
    }
    case 'gift': {
      const unit = Math.max(1, Number(ev.gift.diamonds) || 1);
      const count = Math.max(1, Number(ev.gift.count) || 1);
      const total = unit * count;
      const rec = getUser(user);
      rec.points += total;
      const tier = tierForCoins(unit);
      broadcast({ type: 'gift', user, gift: ev.gift, tierName: tier.name });
      floatKrathong(user, tier, count, '');
      if (total >= 99 || tier.id === 'gold' || tier.id === 'royal') broadcast({ type: 'fx', fx: 'fireworks', power: Math.min(10, Math.ceil(total / 100)) });
      if (tier.id === 'royal') broadcast({ type: 'fx', fx: 'lanterns', n: Math.min(40, 8 + Math.floor(total / 100)) });
      log(`🎁 ${rec.name} ส่ง ${ev.gift.name} x${count} (${total} เหรียญ) → ${tier.name}`);
      break;
    }
    case 'like': {
      const n = Math.max(1, Number(ev.count) || 1);
      state.likes += n;
      state.likesSinceFirework += n;
      broadcast({ type: 'like', user, count: n });
      if (config.likesPerFirework > 0 && state.likesSinceFirework >= config.likesPerFirework) {
        state.likesSinceFirework = 0;
        broadcast({ type: 'fx', fx: 'fireworks', power: 2 });
        log(`❤️ ไลค์ครบ ${config.likesPerFirework} — ยิงพลุ!`);
      }
      saveSoon(); pushState();
      break;
    }
    case 'follow': {
      const rec = getUser(user);
      rec.points += 5;
      broadcast({ type: 'follow', user });
      floatKrathong(user, config.tiers.find(t => t.free) || config.tiers[0], 1, 'ขอบคุณที่ติดตาม');
      log(`➕ ${rec.name} ติดตามแล้ว`);
      break;
    }
    case 'share': {
      const rec = getUser(user);
      rec.points += 3;
      broadcast({ type: 'share', user });
      broadcast({ type: 'fx', fx: 'fireworks', power: 1 });
      log(`🔗 ${rec.name} แชร์ไลฟ์`);
      pushState();
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// TikTok LIVE connection
// ---------------------------------------------------------------------------
let tiktok = null;
let tiktokStatus = { state: 'idle', username: '', message: 'ยังไม่ได้เชื่อมต่อ' };
let retryTimer = null;
let wantConnected = false;

function setStatus(s) { tiktokStatus = { ...tiktokStatus, ...s }; broadcast({ type: 'status', status: tiktokStatus }); }

function normUser(u) {
  if (!u) return { id: 'anon', name: 'ผู้ชม' };
  const avatar = u.profilePicture?.urls?.[0] || u.profilePicture?.url?.[0] || u.avatarThumb?.urlList?.[0] || u.avatarThumb?.url?.[0] || '';
  return { id: String(u.userId || u.uniqueId || u.displayId || u.id || u.nickname), name: u.nickname || u.uniqueId || u.displayId || 'ผู้ชม', avatar };
}

async function connectTikTok(username, signApiKey) {
  let TikTokLiveConnection, WebcastEvent, ControlEvent;
  try { ({ TikTokLiveConnection, WebcastEvent, ControlEvent } = require('tiktok-live-connector')); }
  catch (e) { setStatus({ state: 'error', message: 'ไม่พบ tiktok-live-connector — รัน npm install ก่อน' }); return; }

  await disconnectTikTok(false);
  wantConnected = true;
  username = String(username).replace(/^.*tiktok\.com\//, '').replace('/live', '').replace('@', '').trim();
  setStatus({ state: 'connecting', username, message: `กำลังเชื่อมต่อ @${username} ...` });

  const conn = new TikTokLiveConnection(username, {
    processInitialData: false,
    enableExtendedGiftInfo: true,
    ...(signApiKey ? { signApiKey } : {}),
  });
  tiktok = conn;

  conn.on(WebcastEvent.MEMBER, d => handleEvent({ kind: 'join', user: normUser(d.user) }));
  conn.on(WebcastEvent.CHAT, d => handleEvent({ kind: 'chat', user: normUser(d.user), comment: d.comment }));
  conn.on(WebcastEvent.LIKE, d => handleEvent({ kind: 'like', user: normUser(d.user), count: d.likeCount }));
  conn.on(WebcastEvent.FOLLOW, d => handleEvent({ kind: 'follow', user: normUser(d.user) }));
  conn.on(WebcastEvent.SHARE, d => handleEvent({ kind: 'share', user: normUser(d.user) }));
  conn.on(WebcastEvent.GIFT, d => {
    const g = d.giftDetails || d.gift || {};
    const type = g.giftType ?? g.type;
    if (type === 1 && !d.repeatEnd) return; // รอให้คอมโบจบก่อนค่อยนับ
    handleEvent({
      kind: 'gift', user: normUser(d.user),
      gift: {
        id: d.giftId,
        name: g.giftName || g.name || d.extendedGiftInfo?.name || `ของขวัญ #${d.giftId}`,
        diamonds: g.diamondCount ?? d.extendedGiftInfo?.diamond_count ?? 1,
        count: d.repeatCount || 1,
        image: d.extendedGiftInfo?.image?.url_list?.[0] || g.image?.urlList?.[0] || '',
      },
    });
  });
  conn.on(ControlEvent.DISCONNECTED, () => {
    if (tiktok !== conn) return;
    log('⚠️ หลุดการเชื่อมต่อ TikTok', 'warn');
    scheduleRetry(username, signApiKey);
  });
  conn.on(ControlEvent.ERROR, e => { if (tiktokStatus.state === 'connected') log(`TikTok error: ${e?.info || e?.message || e}`, 'warn'); });

  try {
    const st = await conn.connect();
    if (tiktok !== conn) return;
    setStatus({ state: 'connected', message: `เชื่อมต่อ @${username} แล้ว (room ${st.roomId})` });
    log(`✅ เชื่อมต่อไลฟ์ @${username} สำเร็จ`);
  } catch (e) {
    if (tiktok !== conn) return;
    const msg = e?.message || String(e);
    const offline = /offline|not.*live|UserOffline|Room ID/i.test(msg + (e?.name || ''));
    const limited = /rate|limit|429|sign/i.test(msg);
    const why = offline ? `ไม่พบไลฟ์ของ @${username} (ยังไม่ได้เริ่มไลฟ์ หรือชื่อผิด)`
      : limited ? 'โดนจำกัดการเชื่อมต่อ — ลองใส่ Euler API Key ในตัวเลือกขั้นสูง' : msg;
    log(`❌ เชื่อมต่อไม่สำเร็จ: ${why}`, 'warn');
    scheduleRetry(username, signApiKey, why);
  }
}

function scheduleRetry(username, key, why) {
  if (!wantConnected) return;
  clearTimeout(retryTimer);
  setStatus({ state: 'retrying', message: `${why || 'หลุดการเชื่อมต่อ'} (ลองใหม่ใน 15 วิ)` });
  retryTimer = setTimeout(() => { if (wantConnected) connectTikTok(username, key); }, 15000);
}

async function disconnectTikTok(user = true) {
  if (user) wantConnected = false;
  clearTimeout(retryTimer);
  const old = tiktok; tiktok = null;
  if (old) { try { await old.disconnect(); } catch {} }
  if (user) setStatus({ state: 'idle', message: 'ตัดการเชื่อมต่อแล้ว' });
}

// ---------------------------------------------------------------------------
// ข้อความจากหน้าควบคุม
// ---------------------------------------------------------------------------
wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'config', config }));
  ws.send(JSON.stringify({ type: 'state', state: publicState() }));
  ws.send(JSON.stringify({ type: 'status', status: tiktokStatus }));

  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    switch (m.type) {
      case 'connect': connectTikTok(m.username, m.signApiKey); break;
      case 'disconnect': disconnectTikTok(); break;
      case 'sim': if (m.event && m.event.kind) handleEvent(m.event); break;
      case 'fx': broadcast({ type: 'fx', fx: m.fx, power: m.power || 3, n: m.n || 20 }); break;
      case 'config':
        config = { ...config, ...m.config };
        fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), () => {});
        broadcast({ type: 'config', config }); pushState();
        log('💾 บันทึกการตั้งค่าแล้ว');
        break;
      case 'resetConfig':
        config = structuredClone(DEFAULT_CONFIG);
        fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), () => {});
        broadcast({ type: 'config', config }); pushState();
        break;
      case 'reset':
        state = structuredClone(DEFAULT_STATE);
        saveSoon(); broadcast({ type: 'reset' }); pushState();
        log('🧹 ล้างข้อมูลทั้งหมดแล้ว');
        break;
    }
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  🪷  ลอยกระทงออนไลน์ พร้อมแล้ว');
  console.log(`  หน้าควบคุม :  http://localhost:${PORT}`);
  console.log(`  หน้าไลฟ์ (ใส่ใน OBS / LIVE Studio):  http://localhost:${PORT}/overlay`);
  console.log('');
});
