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

// ECU-id identification (verified against a real K60S read: id 01 03 0A 0D 01)
const C = require('../js/catalog.js');
assert.strictEqual(C.matchId([0x01,0x03,0x0A,0x0D,0x01,0xEE,0,0,0,0]).part, '30400-K60S-T71');
assert.strictEqual(C.matchId('01030A0D01EE00000000').model, 'Click 125i (2016-2017)');
assert.strictEqual(C.matchId([0x99,0,0,0,0]), null);
console.log('ecu-id match ok');
