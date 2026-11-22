/* Fuel auto-tune from measured air/fuel ratio (AFR).
 *
 * Fuel delivered ∝ map value, and AFR ∝ air / fuel, so for a cell that ran at AFR_measured
 * while we wanted AFR_target the fuel value has to be scaled by AFR_measured / AFR_target
 * (lean → ratio > 1 → more fuel). Live samples land on the 4 cells around the operating point
 * with bilinear weights; a cell is only corrected once it has enough weight, the step per pass
 * is capped, and an optional neighbour blend keeps the surface smooth.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AutoTune = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** fractional index of value v on a (monotonic increasing) axis, clamped to its ends */
  function axisPos(axis, v) {
    const n = axis.length;
    if (!n) return 0;
    if (v <= axis[0]) return 0;
    if (v >= axis[n - 1]) return n - 1;
    let i = 0;
    while (i < n - 2 && v > axis[i + 1]) i++;
    const span = axis[i + 1] - axis[i];
    return i + (span ? (v - axis[i]) / span : 0);
  }

  /** bilinear weights of the 4 surrounding cells → [[row, col, weight], …] */
  function weights(rp, cp, rows, cols) {
    const r0 = Math.min(Math.floor(rp), rows - 1), c0 = Math.min(Math.floor(cp), cols - 1);
    const fr = rp - r0, fc = cp - c0, out = [];
    for (const [dr, wr] of [[0, 1 - fr], [1, fr]]) for (const [dc, wc] of [[0, 1 - fc], [1, fc]]) {
      const r = r0 + dr, c = c0 + dc, w = wr * wc;
      if (w > 1e-6 && r < rows && c < cols) out.push([r, c, w]);
    }
    return out;
  }

  /** target AFR: cruise value up to the enrichment throttle, blending to the full-load value at 95 % */
  function targetAfr(tps, rpm, o = {}) {
    const cruise = o.cruise ?? 14.7, wot = o.wot ?? 12.8, from = o.enrichFrom ?? 60, idle = o.idle ?? 14.2, idleRpm = o.idleRpm ?? 2000;
    let t = tps <= from ? cruise : tps >= 95 ? wot : cruise + (wot - cruise) * (tps - from) / (95 - from);
    if (rpm < idleRpm && tps < 8) t = idle;
    return t;
  }

  /** narrowband O2 volts → rough AFR (only trustworthy near 14.7; a wideband sensor is needed for real numbers) */
  function narrowbandAfr(v) {
    const pts = [[0.05, 16.5], [0.2, 15.4], [0.4, 14.8], [0.45, 14.7], [0.5, 14.6], [0.7, 13.9], [0.85, 13.0], [1.0, 12.5]];
    if (v <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) if (v <= pts[i][0]) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      return +(y0 + (y1 - y0) * (v - x0) / (x1 - x0)).toFixed(2);
    }
    return pts[pts.length - 1][1];
  }

  class Logger {
    constructor(rows, cols) { this.rows = rows; this.cols = cols; this.clear(); }
    clear() { const n = this.rows * this.cols; this.w = new Float64Array(n); this.afrW = new Float64Array(n); this.tgtW = new Float64Array(n); this.n = 0; }
    add(rp, cp, afr, target) {
      for (const [r, c, w] of weights(rp, cp, this.rows, this.cols)) {
        const k = r * this.cols + c;
        this.w[k] += w; this.afrW[k] += afr * w; this.tgtW[k] += target * w;
      }
      this.n++;
    }
    weight(r, c) { return this.w[r * this.cols + c]; }
    afr(r, c) { const k = r * this.cols + c; return this.w[k] ? this.afrW[k] / this.w[k] : null; }
    target(r, c) { const k = r * this.cols + c; return this.w[k] ? this.tgtW[k] / this.w[k] : null; }
  }

  /** per-cell fuel factor (null = not enough data). opts: minWeight, maxStep (fraction), smooth (0..1) */
  function suggest(log, o = {}) {
    const minW = o.minWeight ?? 15, maxStep = o.maxStep ?? 0.08, smooth = o.smooth ?? 0.25;
    const { rows, cols } = log, raw = Array.from({ length: rows }, () => new Array(cols).fill(null));
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (log.weight(r, c) < minW) continue;
      const f = log.afr(r, c) / log.target(r, c);
      raw[r][c] = Math.max(1 - maxStep, Math.min(1 + maxStep, f));
    }
    if (!smooth) return raw;
    const out = raw.map(row => row.slice());
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (raw[r][c] == null) continue;
      let s = 0, n = 0;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { const v = raw[r + dr]?.[c + dc]; if (v != null) { s += v; n++; } }
      if (n) out[r][c] = raw[r][c] * (1 - smooth) + (s / n) * smooth;
    }
    return out;
  }

  return { axisPos, weights, targetAfr, narrowbandAfr, Logger, suggest };
});
