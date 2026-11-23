/* Quick Tune: classify XDF tables into fuel / ignition / rev-limiter and apply capped changes.
 * Pure logic + cap maths; the actual read/write goes through the Xdf module passed in.
 * Safety: ignition advance and rev limit are hard-capped and every change is reported, because
 * small bikes have no knock sensor — too much timing or rpm can break an engine.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QuickTune = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const IGN_ABS_MAX = 45;   // deg BTDC — refuse to write beyond this no matter what
  const REV_ABS_MAX = 14000;

  function classify(xdf) {
    const out = { fuel: [], ignition: [], rev: [] };
    if (!xdf) return out;
    for (const t of xdf.tables) {
      const big = t.z.rows > 2 && t.z.cols > 2, title = t.title.toLowerCase();
      const isTiming = /soi|timing|องศา|advance|ไฟ|spark|ign/.test(title);
      if (/rev|limit|ตัดรอบ|รอบตัด|limiter/.test(title)) out.rev.push({ item: t, kind: 'table' });
      else if (big && /fuel|น้ำมัน|injection|pulse/.test(title) && !isTiming) out.fuel.push(t);
      else if (big && /ign|spark|timing|ไฟ|advance|องศา/.test(title)) out.ignition.push(t);
    }
    for (const c of (xdf.constants || [])) if (/rev|limit|ตัดรอบ|รอบตัด|limiter/.test(c.title.toLowerCase())) out.rev.push({ item: c, kind: 'const' });
    return out;
  }

  /** clamp an rpm-like value to a safe ceiling */
  const capRev = rpm => Math.max(0, Math.min(REV_ABS_MAX, Math.round(rpm)));

  /** multiply every cell of each fuel table by factor; returns changed-cell count */
  function applyFuelPct(Xdf, bin, tables, pct) {
    const f = 1 + pct / 100; let n = 0;
    for (const t of tables) for (let r = 0; r < t.z.rows; r++) for (let c = 0; c < t.z.cols; c++) {
      const v = Xdf.tableValue(bin, t, r, c); if (v == null) continue;
      Xdf.setTableValue(bin, t, r, c, v * f); n++;
    }
    return n;
  }

  /** add `deg` to ignition cells, clamped so no cell exceeds its original by more than `cap`
   *  and never above IGN_ABS_MAX. Returns { changed, capped }. */
  function applyIgnition(Xdf, bin, orig, tables, deg, cap = 3) {
    let changed = 0, capped = 0;
    for (const t of tables) for (let r = 0; r < t.z.rows; r++) for (let c = 0; c < t.z.cols; c++) {
      const v = Xdf.tableValue(bin, t, r, c), o = Xdf.tableValue(orig, t, r, c);
      if (v == null) continue;
      let nv = v + deg;
      const ceil = Math.min(o + cap, IGN_ABS_MAX), floor = o - cap;
      if (nv > ceil) { nv = ceil; capped++; } else if (nv < floor) { nv = floor; capped++; }
      if (Math.abs(nv - v) > 1e-9) { Xdf.setTableValue(bin, t, r, c, nv); changed++; }
    }
    return { changed, capped };
  }

  /** set a rev-limiter value (every cell / the constant) to `rpm`, capped. Returns applied rpm. */
  function setRevLimit(Xdf, bin, revItems, rpm) {
    const v = capRev(rpm);
    for (const it of revItems) {
      if (it.kind === 'const') Xdf.setConst(bin, it.item, v);
      else { const t = it.item; for (let r = 0; r < t.z.rows; r++) for (let c = 0; c < t.z.cols; c++) { const cur = Xdf.tableValue(bin, t, r, c); if (cur != null && cur > 3000) Xdf.setTableValue(bin, t, r, c, v); } }
    }
    return v;
  }

  /** current rev-limiter reading (max over items) for display */
  function readRev(Xdf, bin, revItems) {
    let m = null;
    for (const it of revItems) {
      if (it.kind === 'const') { const v = Xdf.constValue(bin, it.item); if (v != null) m = Math.max(m ?? 0, v); }
      else { const t = it.item; for (let r = 0; r < t.z.rows; r++) for (let c = 0; c < t.z.cols; c++) { const v = Xdf.tableValue(bin, t, r, c); if (v != null) m = Math.max(m ?? 0, v); } }
    }
    return m;
  }

  return { IGN_ABS_MAX, REV_ABS_MAX, classify, capRev, applyFuelPct, applyIgnition, setRevLimit, readRev };
});
