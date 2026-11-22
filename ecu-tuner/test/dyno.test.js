// node ecu-tuner/test/dyno.test.js — synthetic run with a known constant wheel power
const assert = require('assert');
const D = require('../js/dyno.js');
const o = { mass: 170, cda: 0.6, crr: 0.015, from: 15, to: 68 };
const P = 8.0 * 745.7;                       // 8 hp at the wheel
let v = 3, t = 0; const samples = [];
for (let k = 0; k < 4000 && v * 3.6 < 75; k++) {      // integrate dv/dt = (P/v - drag - roll) / m at 1 ms
  const drag = 0.5 * 1.2 * o.cda * v * v, roll = o.crr * o.mass * 9.81;
  v += (P / v - drag - roll) / o.mass * 0.001; t += 0.001;
  if (k % 125 === 0) samples.push({ t, v: Math.round(v * 3.6), rpm: Math.round(v * 3.6 * 130) });   // 8 Hz, whole km/h like the ECU
}
while (v * 3.6 < 75) { const drag = 0.5 * 1.2 * o.cda * v * v, roll = o.crr * o.mass * 9.81; v += (P / v - drag - roll) / o.mass * 0.005; t += 0.005; if (Math.round(t * 1000) % 125 === 0) samples.push({ t, v: Math.round(v * 3.6), rpm: Math.round(v * 3.6 * 130) }); }
const r = D.analyse(samples, o);
assert.ok(Math.abs(r.maxHp - 8) < 1.3, 'peak hp ' + r.maxHp);       // quantised 1 km/h input
const mid = r.curve.filter(p => p.v > 25 && p.v < 60), avg = mid.reduce((s, p) => s + p.hp, 0) / mid.length;
assert.ok(Math.abs(avg - 8) < 0.6, 'mid-range average hp ' + avg.toFixed(2));
assert.ok(r.time > 3 && r.time < 30, 'time ' + r.time);

const det = new D.RunDetector({ from: 15 });
let got = null; let tt = 0;
for (const sp of [5, 6, 8, 10, 12, 14, 16, 20, 25, 30, 34, 37, 39, 40, 40, 40, 40, 39, 36, 33]) { tt += 0.5; got = det.push({ t: tt, v: sp, rpm: 0 }) || got; }
assert.ok(got && got[0].v < 15 && Math.max(...got.map(s => s.v)) === 40, 'run detected');
console.log('all dyno tests passed (peak ' + r.maxHp + ' hp, mid avg ' + avg.toFixed(2) + ' hp, 15→68 ' + r.time + ' s)');
