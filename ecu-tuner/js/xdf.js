/* TunerPro XDF (plain XML) definitions: tables, constants and flags with their addresses and unit maths.
 * Encrypted XDFs (binary, header 05 22 97 …) can only be opened by TunerPro and are rejected here.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Xdf = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- tiny XML reader (XDF is plain, attribute-heavy XML) ----------
  function parseXml(src) {
    const root = { name: '#root', attrs: {}, children: [], text: '' }, stack = [root];
    const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
    let m;
    while ((m = re.exec(src))) {
      const top = stack[stack.length - 1];
      if (m[1] != null) top.text += m[1];
      else if (m[2]) { while (stack.length > 1 && stack.pop().name !== m[2]); }
      else if (m[3]) {
        const node = { name: m[3], attrs: {}, children: [], text: '' };
        m[4].replace(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (_, k, a, b) => { node.attrs[k] = decode(a ?? b); });
        top.children.push(node);
        if (!m[5]) stack.push(node);
      } else if (m[6] && !m[0].startsWith('<')) top.text += decode(m[6]);
    }
    return root;
  }
  const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
  const kid = (n, name) => n?.children.find(c => c.name === name);
  const kids = (n, name) => n ? n.children.filter(c => c.name === name) : [];
  const txt = (n, name) => (kid(n, name)?.text ?? '').trim();
  const num = v => (v == null || v === '' ? null : /^-?0x/i.test(v) ? parseInt(v, 16) : Number(v));

  // ---------- unit maths: "X*0.0976", "(X-40)", "X/2.56", "X*0.5-64" ----------
  function compileMath(eq) {
    const src = String(eq || 'X').trim() || 'X';
    const toks = src.match(/0x[0-9a-f]+|\d*\.\d+(?:e[-+]?\d+)?|\d+(?:e[-+]?\d+)?|[A-Za-z_]\w*|[-+*/^()]/gi) || ['X'];
    let i = 0;
    const peek = () => toks[i], next = () => toks[i++];
    function expr() { let v = term(); while (peek() === '+' || peek() === '-') { const op = next(), r = term(), l = v; v = op === '+' ? x => l(x) + r(x) : x => l(x) - r(x); } return v; }
    function term() { let v = power(); while (peek() === '*' || peek() === '/') { const op = next(), r = power(), l = v; v = op === '*' ? x => l(x) * r(x) : x => l(x) / r(x); } return v; }
    function power() { const b = unary(); if (peek() === '^') { next(); const e = power(); return x => b(x) ** e(x); } return b; }
    function unary() { if (peek() === '-') { next(); const u = unary(); return x => -u(x); } if (peek() === '+') { next(); return unary(); } return atom(); }
    function atom() {
      const t = next();
      if (t === '(') { const v = expr(); next(); return v; }
      if (t == null) return () => 0;
      if (/^0x/i.test(t)) { const n = parseInt(t, 16); return () => n; }
      if (/^[\d.]/.test(t)) { const n = parseFloat(t); return () => n; }
      if (/^x$/i.test(t)) return x => x;
      return () => 0;                                          // other TunerPro variables (linked data) are not supported
    }
    let f;
    try { f = expr(); } catch { f = x => x; }
    return f;
  }
  /** inverse of the unit maths over the raw range (exact for linear equations, search otherwise) */
  function inverse(f, lo, hi) {
    const b = f(0), a = f(1) - b;
    if (a !== 0 && Math.abs(f(2) - (2 * a + b)) < 1e-9 * Math.max(1, Math.abs(a))) return y => (y - b) / a;
    return y => { let best = lo, d = Infinity; const step = Math.max(1, Math.floor((hi - lo) / 65536)); for (let r = lo; r <= hi; r += step) { const e = Math.abs(f(r) - y); if (e < d) { d = e; best = r; } } return best; };
  }

  // ---------- raw element access ----------
  function readRaw(bin, addr, bits, signed, lsb) {
    const n = bits >> 3; if (addr < 0 || addr + n > bin.length) return null;
    let v = 0;
    for (let k = 0; k < n; k++) v = v * 256 + bin[lsb ? addr + n - 1 - k : addr + k];
    if (signed && v >= 2 ** (bits - 1)) v -= 2 ** bits;
    return v;
  }
  function writeRaw(bin, addr, bits, signed, lsb, v) {
    const n = bits >> 3, lo = signed ? -(2 ** (bits - 1)) : 0, hi = signed ? 2 ** (bits - 1) - 1 : 2 ** bits - 1;
    v = Math.max(lo, Math.min(hi, Math.round(v))); if (v < 0) v += 2 ** bits;
    for (let k = 0; k < n; k++) { bin[lsb ? addr + k : addr + n - 1 - k] = v % 256; v = Math.floor(v / 256); }
  }
  const range = (bits, signed) => signed ? [-(2 ** (bits - 1)), 2 ** (bits - 1) - 1] : [0, 2 ** bits - 1];

  // ---------- XDF model ----------
  function isEncrypted(buf) { const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf); return b[0] === 0x05 && b[1] === 0x22 && b[2] === 0x97; }

  function parse(text) {
    const doc = parseXml(text), x = kid(doc, 'XDFFORMAT');
    if (!x) throw new Error('ไม่ใช่ไฟล์ XDF ที่อ่านได้');
    const h = kid(x, 'XDFHEADER'), d = kid(h, 'DEFAULTS')?.attrs || {}, bo = kid(h, 'BASEOFFSET')?.attrs || {};
    const base = (num(bo.offset) || 0) * (bo.subtract === '1' ? -1 : 1);
    const def = { bits: num(d.datasizeinbits) || 8, signed: d.signed === '1', lsb: d.lsbfirst === '1' };
    const cats = {}; for (const c of kids(h, 'CATEGORY')) cats[num(c.attrs.index)] = c.attrs.name;
    const catsOf = n => kids(n, 'CATEGORYMEM').map(c => cats[num(c.attrs.category) - 1]).filter(Boolean);

    function data(node, fallbackBits) {
      const e = kid(node, 'EMBEDDEDDATA')?.attrs || {}, tf = num(e.mmedtypeflags);
      const bits = num(e.mmedelementsizebits) || fallbackBits || def.bits;
      return {
        addr: e.mmedaddress != null ? num(e.mmedaddress) + base : null, bits,
        signed: tf != null ? !!(tf & 1) : def.signed, lsb: tf != null ? !!(tf & 2) : def.lsb, colMajor: tf != null ? !!(tf & 4) : false,
        rows: num(e.mmedrowcount), cols: num(e.mmedcolcount), major: num(e.mmedmajorstridebits) || 0, minor: num(e.mmedminorstridebits) || 0,
      };
    }
    function mathOf(node) { const eq = kid(node, 'MATH')?.attrs.equation || 'X'; return { eq, f: compileMath(eq) }; }
    function axis(node) {
      if (!node) return { count: 1, labels: ['0'] };
      const dd = data(node), m = mathOf(node), count = num(txt(node, 'indexcount')) || 1;
      const labels = kids(node, 'LABEL').sort((a, b) => num(a.attrs.index) - num(b.attrs.index)).map(l => l.attrs.value);
      const ei = kid(node, 'embedinfo')?.attrs;
      return { count, labels, link: ei && ei.type === '3' ? num(ei.linkobjid) : null, units: txt(node, 'units'), embedded: dd.addr != null && dd.addr >= 0 ? dd : null, math: m, decimals: num(txt(node, 'decimalpl')) };
    }

    const tables = kids(x, 'XDFTABLE').map((t, i) => {
      const axes = {}; for (const a of kids(t, 'XDFAXIS')) axes[a.attrs.id] = a;
      const z = axes.z, zd = data(z), m = mathOf(z), xa = axis(axes.x), ya = axis(axes.y);
      const rows = zd.rows || ya.count || 1, cols = zd.cols || xa.count || 1;
      const [lo, hi] = range(zd.bits, zd.signed);
      return {
        kind: 'table', id: 't' + i, uid: num(t.attrs.uniqueid), title: txt(t, 'title') || `ตาราง ${i + 1}`, desc: txt(t, 'description'), cats: catsOf(t),
        z: { ...zd, rows, cols, units: txt(z, 'units'), decimals: num(txt(z, 'decimalpl')) ?? 2, min: num(txt(z, 'min')), max: num(txt(z, 'max')), eq: m.eq, f: m.f, inv: inverse(m.f, lo, hi) },
        x: xa, y: ya,
      };
    }).filter(t => t.z.addr != null);

    const constants = kids(x, 'XDFCONSTANT').map((c, i) => {
      const cd = data(c), m = mathOf(c), [lo, hi] = range(cd.bits, cd.signed);
      return { kind: 'const', id: 'c' + i, title: txt(c, 'title') || `ค่า ${i + 1}`, desc: txt(c, 'description'), cats: catsOf(c), ...cd, units: txt(c, 'units'), decimals: num(txt(c, 'decimalpl')) ?? 2, eq: m.eq, f: m.f, inv: inverse(m.f, lo, hi) };
    }).filter(c => c.addr != null);

    const flags = kids(x, 'XDFFLAG').map((f, i) => {
      const fd = data(f, 8);
      return { kind: 'flag', id: 'f' + i, title: txt(f, 'title') || `แฟล็ก ${i + 1}`, desc: txt(f, 'description'), cats: catsOf(f), ...fd, mask: num(txt(f, 'mask')) || 1 };
    }).filter(f => f.addr != null);

    // axes that point at another table (embedinfo type 3) read that table's values
    const byUid = new Map(tables.map(t => [t.uid, t]));
    for (const t of tables) for (const a of [t.x, t.y]) if (a.link != null) a.linked = byUid.get(a.link) || null;
    // XDFFUNCTION / string tables = raw byte regions (ECM ID, Software): editable as hex + ASCII
    const bytefns = [];
    for (const fn of kids(x, 'XDFFUNCTION')) {
      const regs = kids(fn, 'XDFAXIS').map(ax => { const e = kid(ax, 'EMBEDDEDDATA')?.attrs || {}; return { addr: e.mmedaddress != null ? num(e.mmedaddress) + base : null, len: num(txt(ax, 'indexcount')) || num(e.mmedcolcount) || 1, label: txt(ax, 'units') }; }).filter(r => r.addr != null);
      if (regs.length) bytefns.push({ kind: 'bytes', id: 'b' + bytefns.length, title: txt(fn, 'title') || `ไบต์ ${bytefns.length + 1}`, cats: catsOf(fn), regs });
    }
    for (const t of tables) {   // 1-row 8-bit "string" tables with empty labels are ID/software byte strings
      if (t.z.bits === 8 && t.z.rows === 1 && t.z.cols >= 3 && /id|software|รหัส/i.test(t.title)) t.asBytes = { addr: t.z.addr, len: t.z.cols };
    }
    const region = kid(h, 'REGION')?.attrs;
    return { title: txt(h, 'deftitle') || txt(h, 'description'), size: region ? num(region.size) : null, categories: Object.values(cats), tables, constants, flags, bytefns };
  }

  // ---------- reading / writing through a definition ----------
  function cellAddr(z, r, c) {
    const el = z.bits;
    if (z.colMajor) return z.addr + (c * (z.major || z.rows * el) + r * (z.minor || el)) / 8;
    return z.addr + (r * (z.major || z.cols * el) + c * (z.minor || el)) / 8;
  }
  function tableRaw(bin, t, r, c) { return readRaw(bin, cellAddr(t.z, r, c), t.z.bits, t.z.signed, t.z.lsb); }
  function tableValue(bin, t, r, c) { const v = tableRaw(bin, t, r, c); return v == null ? null : t.z.f(v); }
  function setTableValue(bin, t, r, c, real) { writeRaw(bin, cellAddr(t.z, r, c), t.z.bits, t.z.signed, t.z.lsb, t.z.inv(real)); }
  function axisValues(bin, a) {
    if (a.linked) {
      const t = a.linked, out = [];
      for (let r = 0; r < t.z.rows; r++) for (let c = 0; c < t.z.cols; c++) out.push(tableValue(bin, t, r, c));
      if (out.length >= a.count) return out.slice(0, a.count).map(v => +(+v).toFixed(4));
    }
    if (a.embedded) {
      const e = a.embedded, step = (e.minor || e.bits) / 8, out = [];
      for (let k = 0; k < a.count; k++) { const v = readRaw(bin, e.addr + k * step, e.bits, e.signed, e.lsb); out.push(v == null ? k : a.math.f(v)); }
      return out;
    }
    if (a.labels.length >= a.count) return a.labels.slice(0, a.count).map(v => (isNaN(+v) ? v : +v));
    return Array.from({ length: a.count }, (_, k) => k);
  }
  const constValue = (bin, c) => { const v = readRaw(bin, c.addr, c.bits, c.signed, c.lsb); return v == null ? null : c.f(v); };
  const setConst = (bin, c, real) => writeRaw(bin, c.addr, c.bits, c.signed, c.lsb, c.inv(real));
  function readBytes(bin, addr, len) { const o = []; for (let k = 0; k < len; k++) o.push(bin[addr + k] ?? 0); return o; }
  function writeBytes(bin, addr, bytes) { for (let k = 0; k < bytes.length; k++) bin[addr + k] = bytes[k] & 255; }
  const toHex = a => a.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
  const toAscii = a => a.map(b => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
  const parseHex = s => (String(s).match(/[0-9a-f]{2}/gi) || []).map(h => parseInt(h, 16));
  const flagValue = (bin, f) => { const v = readRaw(bin, f.addr, f.bits, false, f.lsb); return v == null ? null : (v & f.mask) !== 0; };
  function setFlag(bin, f, on) { const v = readRaw(bin, f.addr, f.bits, false, f.lsb); writeRaw(bin, f.addr, f.bits, false, f.lsb, on ? v | f.mask : v & ~f.mask); }

  return { parse, isEncrypted, compileMath, inverse, readRaw, writeRaw, cellAddr, tableRaw, tableValue, setTableValue, axisValues, constValue, setConst, flagValue, setFlag, readBytes, writeBytes, toHex, toAscii, parseHex };
});
