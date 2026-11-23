// node ecu-tuner/test/quicktune.test.js
const assert = require('assert');
const X = require('../js/xdf.js'), Q = require('../js/quicktune.js');
const xml = `<XDFFORMAT version="1.70"><XDFHEADER><BASEOFFSET offset="0" subtract="0"/><DEFAULTS datasizeinbits="16" signed="0" lsbfirst="1"/><REGION size="0x400"/></XDFHEADER>
<XDFTABLE uniqueid="0x1"><title>Fuel Map 1</title><XDFAXIS id="x"><indexcount>3</indexcount></XDFAXIS><XDFAXIS id="y"><indexcount>3</indexcount></XDFAXIS><XDFAXIS id="z"><EMBEDDEDDATA mmedtypeflags="0x02" mmedaddress="0x40" mmedelementsizebits="16" mmedrowcount="3" mmedcolcount="3"/><MATH equation="X/1000"><VAR id="X"/></MATH></XDFAXIS></XDFTABLE>
<XDFTABLE uniqueid="0x2"><title>Ignition Map</title><XDFAXIS id="x"><indexcount>3</indexcount></XDFAXIS><XDFAXIS id="y"><indexcount>3</indexcount></XDFAXIS><XDFAXIS id="z"><EMBEDDEDDATA mmedaddress="0x80" mmedelementsizebits="8" mmedrowcount="3" mmedcolcount="3"/><MATH equation="X*0.5"><VAR id="X"/></MATH></XDFAXIS></XDFTABLE>
<XDFCONSTANT><title>Rev Limiter #1</title><EMBEDDEDDATA mmedtypeflags="0x02" mmedaddress="0xC0" mmedelementsizebits="16"/><MATH equation="X"><VAR id="X"/></MATH></XDFCONSTANT></XDFFORMAT>`;
const xdf = X.parse(xml);
const cls = Q.classify(xdf);
assert.strictEqual(cls.fuel.length, 1); assert.strictEqual(cls.ignition.length, 1); assert.strictEqual(cls.rev.length, 1);

const bin = new Uint8Array(0x400);
for (let k = 0; k < 9; k++) { const v = 2000 + k * 100; bin[0x40 + k * 2] = v & 255; bin[0x41 + k * 2] = v >> 8; }  // fuel 2.0..2.8 ms
for (let k = 0; k < 9; k++) bin[0x80 + k] = 40;    // ignition 20 deg everywhere
bin[0xC0] = 0x0C; bin[0xC1] = 0x27;                // rev 9996... set 10000-ish
const orig = bin.slice();

// fuel +10%
const n = Q.applyFuelPct(X, bin, cls.fuel, 10);
assert.strictEqual(n, 9);
assert.ok(Math.abs(X.tableValue(bin, cls.fuel[0], 0, 0) - 2.2) < 1e-6, X.tableValue(bin, cls.fuel[0], 0, 0));

// ignition +2 deg (cap 3) -> 22
let ri = Q.applyIgnition(X, bin, orig, cls.ignition, 2, 3);
assert.strictEqual(ri.changed, 9); assert.strictEqual(ri.capped, 0);
assert.strictEqual(X.tableValue(bin, cls.ignition[0], 0, 0), 22);
// push +10 more, must cap at original(20)+3 = 23
ri = Q.applyIgnition(X, bin, orig, cls.ignition, 10, 3);
assert.strictEqual(X.tableValue(bin, cls.ignition[0], 0, 0), 23);
assert.ok(ri.capped === 9, 'all capped: ' + ri.capped);

// rev limit set to 11000, and cap test at 99999 -> 14000
assert.strictEqual(Q.setRevLimit(X, bin, cls.rev, 11000), 11000);
assert.strictEqual(X.constValue(bin, cls.rev[0].item), 11000);
assert.strictEqual(Q.setRevLimit(X, bin, cls.rev, 99999), 14000);
assert.strictEqual(Q.readRev(X, bin, cls.rev), 14000);
console.log('all quicktune tests passed');

// SOI/timing tables must NOT be treated as fuel-quantity maps
const xml2 = `<XDFFORMAT version="1.70"><XDFHEADER><DEFAULTS datasizeinbits="8"/><REGION size="0x400"/></XDFHEADER>
<XDFTABLE uniqueid="0x9"><title>Fuel, SOI Timing Low</title><XDFAXIS id="x"><indexcount>5</indexcount></XDFAXIS><XDFAXIS id="y"><indexcount>5</indexcount></XDFAXIS><XDFAXIS id="z"><EMBEDDEDDATA mmedaddress="0x40" mmedelementsizebits="8" mmedrowcount="5" mmedcolcount="5"/></XDFAXIS></XDFTABLE>
<XDFTABLE uniqueid="0xA"><title>Fuel Map 1</title><XDFAXIS id="x"><indexcount>5</indexcount></XDFAXIS><XDFAXIS id="y"><indexcount>5</indexcount></XDFAXIS><XDFAXIS id="z"><EMBEDDEDDATA mmedaddress="0x80" mmedelementsizebits="8" mmedrowcount="5" mmedcolcount="5"/></XDFAXIS></XDFTABLE></XDFFORMAT>`;
const c2 = Q.classify(X.parse(xml2));
assert.strictEqual(c2.fuel.length, 1, 'only real fuel map: ' + c2.fuel.map(t=>t.title));
assert.strictEqual(c2.fuel[0].title, 'Fuel Map 1');
assert.strictEqual(c2.ignition.length, 1, 'SOI timing counts as timing');
console.log('all quicktune tests passed (SOI excluded from fuel)');
