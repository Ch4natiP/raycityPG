// node ecu-tuner/test/tools.test.js
const assert = require('assert');
const T = require('../js/tools.js');

// Wave 125i bore 52.4 x stroke 57.9 ≈ 124.8 cc
assert.ok(Math.abs(T.displacement(52.4, 57.9) - 124.9) < 0.6, 'disp ' + T.displacement(52.4, 57.9));
// a 15 hp single needs a modest injector; round-trip must be consistent
const need = T.injectorNeeded(15, { cyl: 1 });
assert.ok(need > 40 && need < 120, 'injector ' + need);
assert.ok(Math.abs(T.injectorMaxHp(need, { cyl: 1 }) - 15) < 0.2, 'roundtrip');
// swapping 100cc -> 190cc injectors: shorten pulse to ~0.526
assert.strictEqual(T.fuelScale({ oldCc: 100, newCc: 190 }), 0.5263);
// bigger engine needs more fuel
assert.strictEqual(T.fuelScale({ oldDisp: 125, newDisp: 150 }), 1.2);
// both at once
assert.strictEqual(T.fuelScale({ oldCc: 100, newCc: 120, oldDisp: 125, newDisp: 150 }), 1);
assert.strictEqual(T.dtcInfo('12-1').name, 'หัวฉีด (Injector)');
assert.strictEqual(T.dtcInfo('99-9').name, 'ไม่ทราบความหมาย');
assert.ok(T.dtcSearch('o2').some(d => d.code === '21-1'));
assert.ok(T.dtcSearch('ลิ้นเร่ง').some(d => d.code.startsWith('8')));
console.log('all tools tests passed (injector ' + need + ' cc/min for 15 hp)');
