// โพสต์ขาย — server: serves public/ and POST /api/generate (Claude writes the captions).
// ANTHROPIC_API_KEY stays here on the server; the phone never sees it.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const PORT = Number(process.env.PORT || 8787);
const MODEL = process.env.POSTKAI_MODEL || 'claude-opus-5-5';
const FREE_PER_DAY = Number(process.env.FREE_PER_DAY || 3);
// Pro codes the seller has paid for, comma separated: PRO_CODES=ABC123,XYZ789
const PRO_CODES = new Set((process.env.PRO_CODES || '').split(',').map(s => s.trim()).filter(Boolean));
const MAX_BODY = 6 * 1024 * 1024;

const client = new Anthropic();

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json',
};

const SYSTEM = `คุณคือนักเขียนคำโฆษณาขายของออนไลน์ภาษาไทย ช่วยแม่ค้ารายย่อยเขียนโพสต์ขายสินค้าจากรูปถ่าย
- เขียนภาษาไทยที่คนไทยใช้จริง อ่านง่าย เป็นกันเอง ใส่อีโมจิพอดี ๆ
- บรรยายเฉพาะสิ่งที่เห็นในรูปหรือที่ผู้ขายบอก ห้ามแต่งสเปก ขนาด วัสดุ หรือสรรพคุณที่ไม่รู้ ถ้าจำเป็นให้เว้นเป็น [ใส่ขนาด] หรือ [ใส่สี] ให้ผู้ขายเติมเอง
- ห้ามอ้างสรรพคุณทางการแพทย์ ห้ามรับประกันผลลัพธ์ ห้ามเปรียบเทียบให้ร้ายร้านอื่น
- Facebook: ยาวได้ มีจุดเด่นเป็นข้อ ๆ และบอกวิธีสั่ง
- TikTok: สั้น เปิดด้วยประโยคดึงความสนใจ
- Shopee/Lazada: เป็นคำบรรยายสินค้า เป็นระเบียบ มีหัวข้อ
- LINE: สั้น เหมือนส่งข้อความหาลูกค้าประจำ
- ราคาแนะนำให้เป็นช่วงราคาตลาดไทยโดยประมาณ (บาท) และบอกตรง ๆ ว่าเป็นการประมาณ`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['product_name', 'highlights', 'captions', 'hashtags', 'price'],
  properties: {
    product_name: { type: 'string' },
    highlights: { type: 'array', items: { type: 'string' } },
    captions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['platform', 'text'],
        properties: {
          platform: { type: 'string', enum: ['facebook', 'tiktok', 'shopee', 'line'] },
          text: { type: 'string' },
        },
      },
    },
    hashtags: { type: 'array', items: { type: 'string' } },
    price: {
      type: 'object',
      additionalProperties: false,
      required: ['min', 'max', 'note'],
      properties: { min: { type: 'number' }, max: { type: 'number' }, note: { type: 'string' } },
    },
  },
};

const TONES = {
  friendly: 'เป็นกันเอง น่ารัก',
  pro: 'มืออาชีพ น่าเชื่อถือ',
  urgent: 'เร่งขาย มีของจำกัด กระตุ้นให้รีบสั่ง',
  premium: 'หรูหรา พรีเมียม',
};
const PLATFORMS = ['facebook', 'tiktok', 'shopee', 'line'];

// Free quota per device per day. In memory: fine for a prototype on one server,
// resets on restart. Move to a database before real launch.
const usage = new Map();
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
function quota(deviceId, proCode) {
  if (proCode && PRO_CODES.has(proCode)) return { pro: true, left: Infinity };
  const key = `${today()}:${deviceId}`;
  return { pro: false, key, used: usage.get(key) || 0, left: FREE_PER_DAY - (usage.get(key) || 0) };
}

async function generate({ image, mediaType, name, price, tone, platforms, details }) {
  const wanted = PLATFORMS.filter(p => platforms.includes(p));
  const info = [
    name && `ชื่อสินค้า: ${name}`,
    price && `ราคาที่ผู้ขายตั้ง: ${price} บาท`,
    details && `รายละเอียดจากผู้ขาย: ${details}`,
    `โทนการเขียน: ${TONES[tone] || TONES.friendly}`,
    `เขียนแคปชันสำหรับ: ${wanted.join(', ')} (แพลตฟอร์มละ 1 แคปชัน)`,
    'แฮชแท็กภาษาไทยและอังกฤษรวม 8-12 อัน ไม่ต้องใส่ # นำหน้า',
  ].filter(Boolean).join('\n');

  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
        { type: 'text', text: info },
      ],
    }],
  });

  if (response.stop_reason === 'refusal') throw Object.assign(new Error('refused'), { status: 422 });
  if (response.stop_reason === 'max_tokens') throw Object.assign(new Error('too long'), { status: 502 });
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return JSON.parse(text);
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error('too big'), { status: 413 });
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function api(req, res) {
  let body;
  try { body = await readJson(req); } catch (e) { return send(res, e.status || 400, { error: 'bad_request' }); }

  const deviceId = String(body.deviceId || '').slice(0, 64);
  if (!deviceId) return send(res, 400, { error: 'bad_request' });
  if (req.url === '/api/quota') {
    const q = quota(deviceId, body.proCode);
    return send(res, 200, { pro: q.pro, left: q.pro ? null : Math.max(0, q.left), perDay: FREE_PER_DAY });
  }

  const { image, mediaType } = body;
  if (typeof image !== 'string' || !/^image\/(jpeg|png|webp)$/.test(mediaType)) {
    return send(res, 400, { error: 'bad_image' });
  }
  const q = quota(deviceId, body.proCode);
  if (q.left <= 0) return send(res, 429, { error: 'quota', perDay: FREE_PER_DAY });

  try {
    const result = await generate({
      image, mediaType,
      name: String(body.name || '').slice(0, 120),
      price: String(body.price || '').slice(0, 20),
      details: String(body.details || '').slice(0, 500),
      tone: body.tone,
      platforms: Array.isArray(body.platforms) && body.platforms.length ? body.platforms : PLATFORMS,
    });
    if (!q.pro) usage.set(q.key, q.used + 1);
    send(res, 200, { result, left: q.pro ? null : q.left - 1, pro: q.pro });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return send(res, 503, { error: 'busy' });
    if (e instanceof Anthropic.APIError) console.error('claude', e.status, e.message);
    else console.error(e);
    send(res, e.status === 422 ? 422 : 502, { error: e.status === 422 ? 'refused' : 'failed' });
  }
}

async function file(req, res) {
  const url = new URL(req.url, 'http://x');
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const full = path.join(ROOT, rel);
  if (!full.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  try {
    const data = await fs.readFile(full);
    res.writeHead(200, { 'content-type': TYPES[path.extname(full)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('not found');
  }
}

http.createServer((req, res) => {
  if (req.method === 'POST' && (req.url === '/api/generate' || req.url === '/api/quota')) return api(req, res);
  if (req.method === 'GET') return file(req, res);
  res.writeHead(405); res.end();
}).listen(PORT, () => console.log(`โพสต์ขาย → http://localhost:${PORT}  (model ${MODEL}, ฟรี ${FREE_PER_DAY} ครั้ง/วัน)`));
