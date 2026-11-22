// node ecu-tuner/test/xdf.test.js — synthetic TunerPro XDF: linked axes, unit maths, constant, flag
const assert = require('assert');
const X = require('../js/xdf.js');
const xml = `<!-- Written --><XDFFORMAT version="1.70"><XDFHEADER><BASEOFFSET offset="0" subtract="0" />
<DEFAULTS datasizeinbits="16" signed="0" lsbfirst="1" /><REGION size="0x400" />
<CATEGORY index="0x0" name="Breakpoints" /><CATEGORY index="0x1" name="Fuel Maps" /></XDFHEADER>
<XDFTABLE uniqueid="0x10"><title>RPM Breakpoints</title><CATEGORYMEM index="0" category="1" />
 <XDFAXIS id="z"><EMBEDDEDDATA mmedtypeflags="0x02" mmedaddress="0x10" mmedelementsizebits="16" mmedrowcount="3" /><MATH equation="X"><VAR id="X"/></MATH></XDFAXIS></XDFTABLE>
<XDFTABLE uniqueid="0x20"><title>Fuel Map 1</title><CATEGORYMEM index="0" category="2" />
 <XDFAXIS id="x"><indexcount>2</indexcount><LABEL index="0" value="0"/><LABEL index="1" value="50"/><units>TPS</units></XDFAXIS>
 <XDFAXIS id="y"><indexcount>3</indexcount><embedinfo type="3" linkobjid="0x10" /><units>RPM</units></XDFAXIS>
 <XDFAXIS id="z"><EMBEDDEDDATA mmedtypeflags="0x02" mmedaddress="0x40" mmedelementsizebits="16" mmedrowcount="3" mmedcolcount="2" /><units>ms</units><decimalpl>3</decimalpl><MATH equation="X/1000"><VAR id="X"/></MATH></XDFAXIS></XDFTABLE>
<XDFTABLE uniqueid="0x30"><title>Ignition</title><XDFAXIS id="z"><EMBEDDEDDATA mmedaddress="0x80" mmedelementsizebits="8" mmedrowcount="1" mmedcolcount="2" /><MATH equation="X*0.317-17.380"><VAR id="X"/></MATH></XDFAXIS></XDFTABLE>
<XDFCONSTANT><title>Rev limit</title><EMBEDDEDDATA mmedtypeflags="0x02" mmedaddress="0x90" mmedelementsizebits="16" /><MATH equation="X"><VAR id="X"/></MATH></XDFCONSTANT>
<XDFFLAG><title>O2 sensor Enable</title><EMBEDDEDDATA mmedaddress="0xA0" mmedelementsizebits="8" /><mask>0x04</mask></XDFFLAG></XDFFORMAT>`;
const x = X.parse(xml);
assert.strictEqual(x.tables.length, 3); assert.strictEqual(x.constants.length, 1); assert.strictEqual(x.flags.length, 1);
const bin = new Uint8Array(0x400);
[900, 1500, 3000].forEach((v, i) => { bin[0x10 + i * 2] = v & 255; bin[0x11 + i * 2] = v >> 8; });
for (let k = 0; k < 6; k++) { const v = 2000 + k * 250; bin[0x40 + k * 2] = v & 255; bin[0x41 + k * 2] = v >> 8; }
bin[0x80] = 100; bin[0x90] = 0xD8; bin[0x91] = 0x27; bin[0xA0] = 0x05;
const fuel = x.tables.find(t => t.title === 'Fuel Map 1');
assert.deepStrictEqual(fuel.cats, ['Fuel Maps']);
assert.deepStrictEqual(X.axisValues(bin, fuel.y), [900, 1500, 3000]);
assert.deepStrictEqual(X.axisValues(bin, fuel.x), [0, 50]);
assert.strictEqual(X.tableValue(bin, fuel, 1, 1), 2.75);
X.setTableValue(bin, fuel, 1, 1, 3.1); assert.strictEqual(X.tableValue(bin, fuel, 1, 1), 3.1);
const ign = x.tables.find(t => t.title === 'Ignition');
assert.ok(Math.abs(X.tableValue(bin, ign, 0, 0) - 14.32) < 1e-9);
X.setTableValue(bin, ign, 0, 0, 16); assert.strictEqual(bin[0x80], Math.round((16 + 17.38) / 0.317));
assert.strictEqual(X.constValue(bin, x.constants[0]), 10200);
X.setConst(bin, x.constants[0], 10500); assert.strictEqual(X.constValue(bin, x.constants[0]), 10500);
assert.strictEqual(X.flagValue(bin, x.flags[0]), true); X.setFlag(bin, x.flags[0], false); assert.strictEqual(bin[0xA0], 0x01);
assert.ok(X.isEncrypted(new Uint8Array([0x05, 0x22, 0x97, 0])));
assert.strictEqual(X.compileMath('(X-40)*2')(50), 20);
console.log('all xdf tests passed');
