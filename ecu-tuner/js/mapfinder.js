/* Map Finder — locate 2D calibration tables in a raw ECU .bin without a definition (XDF) file.
 *
 * Calibration maps (fuel, ignition, …) are smooth surfaces: neighbouring cells differ a little
 * both along a row and between rows; program code and random data do not. For each element type
 * and row width we look for blocks of ≥ MIN_ROWS rows where nearly every horizontal and vertical
 * neighbour pair is close, nudge the start so no axis tail is included, then keep the best
 * non-overlapping blocks. Honda Keihin ECUs store 16-bit values little-endian, which is the default.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MapFinder = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const WIDTH = { u8: 1, u16le: 2, u16be: 2 };
  const MIN_COLS = 6, MAX_COLS = 32, MIN_ROWS = 4, MAX_ROWS = 40;

  function values(bin, type, align) {
    const w = WIDTH[type], n = Math.floor((bin.length - align) / w), v = new Int32Array(n);
    for (let k = 0, o = align; k < n; k++, o += w)
      v[k] = type === 'u8' ? bin[o] : type === 'u16le' ? bin[o] | (bin[o + 1] << 8) : (bin[o] << 8) | bin[o + 1];
    return v;
  }
  const close = (a, b, full) => Math.abs(a - b) <= Math.max(Math.max(a, b) * 0.22, full * 0.02, 2);

  /** bad horizontal pairs in a row, or -1 if the row is unusable (flat, erased, too jumpy) */
  function rowBad(v, s, c, full) {
    let bad = 0, lo = Infinity, hi = -Infinity, same = 0;
    for (let k = 0; k < c; k++) {
      const x = v[s + k]; if (x < lo) lo = x; if (x > hi) hi = x;
      if (k) { if (!close(v[s + k - 1], x, full) && ++bad > 1) return -1; if (v[s + k - 1] === x) same++; }
    }
    return hi === lo || hi === full || same > c * 0.7 ? -1 : bad;
  }
  function vertBad(v, a, b, c, full) {
    let bad = 0;
    for (let k = 0; k < c; k++) if (!close(v[a + k], v[b + k], full) && ++bad > Math.max(1, c * 0.12)) return -1;
    return bad;
  }
  /** grow a block from element i with row width c → { rows, bad } */
  function measure(v, i, c, full) {
    let bad = rowBad(v, i, c, full);
    if (bad < 0) return { rows: 0, bad: 0 };
    let r = 1;
    while (r < MAX_ROWS && i + (r + 1) * c <= v.length) {
      const h = rowBad(v, i + r * c, c, full); if (h < 0) break;
      const vb = vertBad(v, i + (r - 1) * c, i + r * c, c, full); if (vb < 0) break;
      bad += h + vb; r++;
    }
    return { rows: r, bad };
  }
  const increasing = (v, s, n) => { if (s < 0 || n < 2) return false; for (let k = 1; k < n; k++) if (v[s + k] <= v[s + k - 1]) return false; return true; };

  function scan(bin, type, align) {
    const w = WIDTH[type], full = w === 1 ? 255 : 65535, v = values(bin, type, align), out = [];
    for (let i = 0; i < v.length - MIN_COLS * MIN_ROWS;) {
      let best = null;
      for (let c = MIN_COLS; c <= MAX_COLS; c++) {
        if (i + c * MIN_ROWS > v.length) break;
        const m = measure(v, i, c, full);
        if (m.rows < MIN_ROWS) continue;
        // a smaller width beats a multiple of itself (25 wide is also "smooth" as 50 wide)
        if (!best || m.rows * c > best.rows * best.cols * 1.6) best = { i, cols: c, ...m };
      }
      if (!best) { i++; continue; }
      // nudge start forward: drop axis tails / header words glued to the first row
      for (let s = 1; s <= 3; s++) {
        const m = measure(v, i + s, best.cols, full);
        if (m.rows >= best.rows - 1 && m.bad < best.bad) best = { ...best, i: i + s, ...m };
      }
      const { cols, rows } = best, at = best.i;
      const xAxis = increasing(v, at - cols, cols) ? Array.from(v.slice(at - cols, at)) : null;
      const yAt = xAxis ? at - cols - rows : at - rows;
      const yAxis = increasing(v, yAt, rows) ? Array.from(v.slice(yAt, yAt + rows)) : null;
      out.push({ off: align + at * w, type, cols, rows, bytes: cols * rows * w, bad: best.bad, xAxis, yAxis });
      i = at + cols * rows;
    }
    return out;
  }

  /** Axis-anchored search — Honda Keihin layout is  [row axis][column axis][rows × cols data]
   *  (often followed by more tables sharing the same axes). Much more exact than the smoothness scan. */
  function anchored(bin, type, align) {
    const w = WIDTH[type], full = w === 1 ? 255 : 65535, v = values(bin, type, align), out = [];
    let runStart = 0;
    for (let s2 = 1; s2 < v.length - MIN_COLS * MIN_ROWS; s2++) {
      if (v[s2] > v[s2 - 1]) continue;                 // s2 = first element after an increasing run
      const prevRun = s2 - runStart; runStart = s2;
      if (prevRun < MIN_ROWS) continue;
      let best = null;
      for (let c = 2; c <= MAX_COLS && s2 + c < v.length; c++) {
        if (v[s2 + c - 1] <= v[s2 + c - 2]) break;  // column axis must keep increasing
        if (c < MIN_COLS) continue;
        const d = s2 + c, m = measure(v, d, c, full);
        const rows = Math.min(m.rows, prevRun, MAX_ROWS);
        if (rows < MIN_ROWS || m.rows < rows) continue;
        const q = m.bad / (rows * c);
        if (!best || q < best.q || (q === best.q && rows * c > best.rows * best.cols)) best = { c, d, rows, q, bad: m.bad };
      }
      if (!best || best.q > 0.15) continue;
      const { c: cols, rows } = best;
      const xAxis = Array.from(v.slice(s2, s2 + cols)), yAxis = Array.from(v.slice(s2 - rows, s2));
      let d = best.d, n = 0;
      do {                                               // this table + following tables on the same axes
        out.push({ off: align + d * w, type, cols, rows, bytes: cols * rows * w, bad: best.bad, xAxis, yAxis, axisOff: align + (s2 - rows) * w, twin: n });
        d += cols * rows; n++;
      } while (d + cols * rows <= v.length && measure(v, d, cols, full).rows >= rows);
      s2 = d - 1; runStart = d;
    }
    return out;
  }

  /** Candidate tables sorted by address. types: which element types to try (Honda: u16le + u8). */
  function find(bin, types = ['u16le', 'u8']) {
    let all = [];
    for (const type of types) for (let a = 0; a < WIDTH[type]; a++) all = all.concat(anchored(bin, type, a).map(t => ({ ...t, anchored: true })));
    for (const type of types) for (let a = 0; a < WIDTH[type]; a++) all = all.concat(scan(bin, type, a));
    // bigger first; near-equal size → 16-bit, fewer rough cells, has axis
    const score = t => t.bytes * (t.anchored ? 3 : 1) * (t.type === 'u8' ? 0.8 : 1) * (t.xAxis ? 1.15 : 1) / (1 + t.bad / (t.rows * t.cols));
    all.sort((a, b) => score(b) - score(a));
    const taken = [], keep = [];
    for (const t of all) {
      if (taken.some(([s, e]) => t.off < e && t.off + t.bytes > s)) continue;
      taken.push([t.off, t.off + t.bytes]); keep.push(t);
    }
    return keep.sort((a, b) => a.off - b.off);
  }

  /** Byte ranges where two files differ (gaps < 8 bytes merged). */
  function diff(a, b) {
    const n = Math.min(a.length, b.length), out = [];
    let s = -1, last = -100;
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) {
      if (i - last > 8) { if (s >= 0) out.push([s, last + 1]); s = i; }
      last = i;
    }
    if (s >= 0) out.push([s, last + 1]);
    if (a.length !== b.length) out.push([n, Math.max(a.length, b.length)]);
    return out;
  }

  return { find, diff };
});
