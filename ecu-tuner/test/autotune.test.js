// node ecu-tuner/test/autotune.test.js
const assert = require('assert');
const AT = require('../js/autotune.js');

assert.strictEqual(AT.axisPos([0, 10, 20], 15), 1.5);
assert.strictEqual(AT.axisPos([0, 10, 20], -5), 0);
assert.strictEqual(AT.axisPos([0, 10, 20], 99), 2);
const w = AT.weights(1.25, 0.5, 3, 3);
assert.strictEqual(+w.reduce((s, x) => s + x[2], 0).toFixed(6), 1);
assert.deepStrictEqual(w.map(x => [x[0], x[1]]), [[1, 0], [1, 1], [2, 0], [2, 1]]);

assert.strictEqual(AT.targetAfr(30, 5000), 14.7);
assert.strictEqual(AT.targetAfr(100, 8000), 12.8);
assert.strictEqual(AT.narrowbandAfr(0.45), 14.7);
assert.ok(AT.narrowbandAfr(0.1) > 15 && AT.narrowbandAfr(0.9) < 13.5);

// closed loop: an engine 10 % lean in one region converges after a few passes
const rows = 4, cols = 4, map = Array.from({ length: rows }, () => new Array(cols).fill(1000));
const need = (r, c) => (r === 2 && c === 1 ? 1100 : 1000);       // fuel the engine really needs for 14.7
for (let pass = 0; pass < 4; pass++) {
  const log = new AT.Logger(rows, cols);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) for (let k = 0; k < 30; k++) log.add(r, c, 14.7 * need(r, c) / map[r][c], 14.7);
  const s = AT.suggest(log, { smooth: 0 });
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (s[r][c]) map[r][c] = Math.round(map[r][c] * s[r][c]);
}
assert.ok(Math.abs(map[2][1] - 1100) <= 2, 'lean cell corrected: ' + map[2][1]);
assert.strictEqual(map[0][0], 1000);
// step cap
const log = new AT.Logger(1, 1); for (let k = 0; k < 30; k++) log.add(0, 0, 18, 14.7);
assert.strictEqual(AT.suggest(log, { smooth: 0, maxStep: 0.05 })[0][0], 1.05);
console.log('all autotune tests passed');
