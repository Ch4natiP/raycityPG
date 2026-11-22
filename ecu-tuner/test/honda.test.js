// node ecu-tuner/test/honda.test.js
const assert = require('assert');
const Honda = require('../js/honda.js');
const { SimLink, hex } = require('../js/link.js');

assert.strictEqual(hex(Honda.CMD.init()), '72 05 00 F0 99');
assert.strictEqual(hex(Honda.CMD.ping()), 'FE 04 72 8C');
assert.strictEqual(hex(Honda.CMD.clearDtc()), '72 05 60 03 26');
assert.strictEqual(hex(Honda.CMD.readTable(0x11)), '72 05 71 11 07');

// stream parser: garbage + two frames + partial
const a = Array.from(Honda.frame(0x02, [0x00])), b = Array.from(Honda.frame(0x02, [0x71, 0x11, 1, 2, 3]));
const { frames, rest } = Honda.parseStream([0x55, ...a, ...b, 0x02, 0x09]);
assert.strictEqual(frames.length, 2);
assert.strictEqual(hex(frames[0]), '02 04 00 FA');
assert.deepStrictEqual(rest, [0x02, 0x09]);

const dtc = Honda.decodeDtcReply(Honda.frame(0x02, [0x74, 1, 12, 1, 7, 2, 0, 0]));
assert.deepStrictEqual(dtc, ['12-1', '7-2']);

(async () => {
  const link = new SimLink();
  await link.open();
  assert.strictEqual(await link.transact(Honda.CMD.init(), 200), null, 'ECU must ignore requests before wake-up');
  await link.wakeup();
  const r = await link.transact(Honda.CMD.init());
  assert.strictEqual(hex(r), '02 04 00 FA');
  const t = Honda.decodeTableReply(await link.transact(Honda.CMD.readTable(0x11)));
  const rpm = t.values.find(v => v.key === 'rpm').value;
  assert.ok(rpm > 1000 && rpm < 10000, 'rpm ' + rpm);
  assert.deepStrictEqual(Honda.decodeDtcReply(await link.transact(Honda.CMD.dtcCurrent(1))), ['12-1']);
  await link.transact(Honda.CMD.clearDtc());
  assert.deepStrictEqual(Honda.decodeDtcReply(await link.transact(Honda.CMD.dtcPast(1))), []);
  console.log('all honda protocol tests passed');
})().catch(e => { console.error(e); process.exit(1); });
