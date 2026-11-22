/* Road dyno: wheel power from a full-throttle acceleration run.
 *
 *   P = m·a·v  +  ½·ρ·CdA·v³  +  Crr·m·g·v          (watts, v in m/s)
 *
 * Speed comes in as km/h samples (ECU speed sensor ~8 Hz in whole km/h, or GPS ~1 Hz), so
 * acceleration is the slope of a local least-squares line over a short time window instead of a
 * raw difference, which would be mostly quantisation noise.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Dyno = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const RHO = 1.2, G = 9.81, W_PER_HP = 745.7;

  /** local linear fit of v(t) around each sample → [{ t, v, a }] with v in km/h, a in km/h per s */
  function smooth(samples, win = 0.6) {
    return samples.map((s0, i) => {
      let n = 0, st = 0, sv = 0, stt = 0, stv = 0;
      for (let j = i; j >= 0 && s0.t - samples[j].t <= win; j--) add(samples[j]);
      for (let j = i + 1; j < samples.length && samples[j].t - s0.t <= win; j++) add(samples[j]);
      function add(p) { const t = p.t - s0.t; n++; st += t; sv += p.v; stt += t * t; stv += t * p.v; }
      const den = n * stt - st * st;
      const a = den > 1e-9 ? (n * stv - st * sv) / den : 0;
      const v = (sv - a * st) / n;
      return { ...s0, v, a };
    });
  }

  function powerHp(vKmh, aKmhS, o) {
    const v = vKmh / 3.6, a = aKmhS / 3.6, m = o.mass;
    return (m * a * v + 0.5 * RHO * o.cda * v ** 3 + o.crr * m * G * v) / W_PER_HP;
  }

  /** time at which speed first reaches `target` (linear interpolation), or null */
  function crossTime(pts, target) {
    for (let i = 1; i < pts.length; i++) if (pts[i - 1].v < target && pts[i].v >= target) {
      const p = pts[i - 1], q = pts[i];
      return p.t + (q.t - p.t) * (target - p.v) / (q.v - p.v);
    }
    return null;
  }

  /** samples: [{ t (s), v (km/h), rpm }] covering one acceleration → run summary */
  function analyse(samples, o) {
    const pts = smooth(samples, o.window ?? 0.6);
    const raw = pts.filter(p => p.v >= (o.from ?? 0) - 2 && p.a > 0).map(p => ({ v: p.v, rpm: p.rpm || 0, hp: powerHp(p.v, p.a, o) }));
    // average over ±2 km/h so the peak is not a single noisy sample
    const curve = raw.map(p => { const nb = raw.filter(q => Math.abs(q.v - p.v) <= 2); return { ...p, hp: nb.reduce((s, q) => s + q.hp, 0) / nb.length }; });
    const peak = curve.reduce((m, p) => (p.hp > (m?.hp ?? -1) ? p : m), null);
    const t0 = crossTime(pts, o.from), t1 = crossTime(pts, o.to);
    const vmax = samples.reduce((m, s) => Math.max(m, s.v), 0);
    const torque = peak && peak.rpm ? +(peak.hp * W_PER_HP / (2 * Math.PI * peak.rpm / 60)).toFixed(1) : null;
    return { curve, maxHp: peak ? +peak.hp.toFixed(1) : null, atV: peak?.v ?? null, atRpm: peak?.rpm || null, torque, vmax: +vmax.toFixed(1),
             time: t0 != null && t1 != null ? +(t1 - t0).toFixed(2) : null, from: o.from, to: o.to };
  }

  /** Watches a live stream and cuts out one acceleration run (speed rising through `from`, ends when speed stops rising). */
  class RunDetector {
    constructor(o) { this.o = o; this.reset(); }
    reset() { this.buf = []; this.rec = null; this.peakV = 0; this.peakAt = 0; }
    /** returns the finished run's samples, or null */
    push(s) {
      this.buf.push(s); while (this.buf.length && s.t - this.buf[0].t > 4) this.buf.shift();
      if (!this.rec) {
        if (this.buf.length > 2 && s.v >= this.o.from && this.buf[0].v < this.o.from) { this.rec = this.buf.slice(); this.peakV = s.v; this.peakAt = s.t; }
        return null;
      }
      this.rec.push(s);
      if (s.v > this.peakV) { this.peakV = s.v; this.peakAt = s.t; }
      const done = this.peakV - s.v >= 3 || s.t - this.peakAt > 1.5 || s.t - this.rec[0].t > 60;
      if (!done) return null;
      const run = this.rec.filter(p => p.t <= this.peakAt + 0.2); this.reset();
      return run.length > 5 ? run : null;
    }
  }

  return { smooth, powerHp, analyse, RunDetector };
});
