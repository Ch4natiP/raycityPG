// node ecu-tuner/test/mapfinder.test.js — synthetic Honda-style layout: [row axis][col axis][table][twin table]
const assert = require('assert');
const MF = require('../js/mapfinder.js');
const rows = 12, cols = 10, base = 0x101;            // odd start: alignment must be detected
const bin = new Uint8Array(4096);
for (let i = 0; i < bin.length; i++) bin[i] = (i * 73 + 11) & 0xFF;   // noise
const put = (o, v) => { bin[o] = v & 255; bin[o + 1] = v >> 8; };
let o = base;
for (let r = 0; r < rows; r++, o += 2) put(o, 1000 + r * 500);       // row axis (rpm-like)
for (let c = 0; c < cols; c++, o += 2) put(o, c * 10);              // col axis (tps-like)
const tableAt = o;
for (const k of [1, 1.1]) for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++, o += 2) put(o, Math.round((2000 + c * 300 - r * 40) * k));
put(o, 0xFFFF); put(o + 2, 3);                                      // end marker
const found = MF.find(bin).filter(t => t.anchored);
assert.strictEqual(found.length, 2, JSON.stringify(found.map(t => [t.off, t.cols, t.rows])));
assert.deepStrictEqual([found[0].off, found[0].cols, found[0].rows, found[0].type, found[0].axisOff], [tableAt, cols, rows, 'u16le', base]);
assert.strictEqual(found[1].off, tableAt + rows * cols * 2);
assert.deepStrictEqual(found[0].yAxis.slice(0, 2), [1000, 1500]);
const b2 = bin.slice(); b2[tableAt + 4] ^= 1; b2[tableAt + 200] ^= 1;
assert.deepStrictEqual(MF.diff(bin, b2), [[tableAt + 4, tableAt + 5], [tableAt + 200, tableAt + 201]]);
console.log('all map finder tests passed');
