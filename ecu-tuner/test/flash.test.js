// node ecu-tuner/test/flash.test.js — full Keihin write then read-back against the virtual ECU
const assert = require('assert');
const H = require('../js/honda.js');
const { SimLink } = require('../js/link.js');
(async () => {
  const link = new SimLink(); await link.open(); await link.wakeup(); await link.transact(H.CMD.init());
  // target 1KB pattern
  const N = 1024, data = new Uint8Array(N);
  for (let i = 0; i < N; i++) data[i] = (i * 7 + 3) & 0xFF;
  // enter write + erase
  for (const f of H.CMD.initWrite()) assert.ok(await link.transact(f, 800), 'initWrite ack');
  for (const f of H.CMD.erase()) await link.transact(f, 800);
  const es = await link.transact(H.CMD.eraseStatus(), 800);
  assert.strictEqual(es[es.length - 2], 0x00, 'erase done');
  await link.transact(H.CMD.eraseDone(), 800);
  // write pages
  const page = 128;
  for (let off = 0; off < N; off += page) {
    const d = Array.from(data.slice(off, off + page));
    const offW = off / 16, nextW = (off + page >= N) ? 0 : (off + page) / 16;
    const r = await link.transact(H.CMD.writePage(offW, d, nextW), 1200);
    assert.ok(r, 'page ack at ' + off);
    assert.strictEqual(r[1], 0x05, 'page ack len 5');
  }
  const pw = H.CMD.postWrite(); let last; for (const f of pw) last = await link.transact(f, 800);
  assert.strictEqual(last[last.length - 2], 0x0F, 'post-write success 0x0f');
  // read back and compare
  const out = new Uint8Array(N);
  for (let off = 0; off < N; off += 12) {
    const r = await link.transact(H.CMD.readFlash(off, Math.min(12, N - off)), 600, 3);
    const rd = Array.from(r.slice(4, -1));
    out.set(rd, off);
  }
  assert.deepStrictEqual(Array.from(out), Array.from(data), 'read-back matches written data');
  console.log('all flash tests passed (write 1KB + verify read-back exact)');
})().catch(e => { console.error(e); process.exit(1); });
