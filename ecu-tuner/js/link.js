/* K-line link: Web Serial (real cable) or a virtual ECU (simulator).
 * Both expose: open(), close(), wakeup(), transact(bytes, timeoutMs) -> reply frame | null, onTraffic(cb)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./honda.js'));
  else root.Link = factory(root.Honda);
})(typeof self !== 'undefined' ? self : this, function (Honda) {
  'use strict';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const hex = a => Array.from(a, b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

  class BaseLink {
    constructor() { this.rx = []; this.listeners = []; this.busy = Promise.resolve(); this.waiter = null; }
    onTraffic(cb) { this.listeners.push(cb); }
    emit(dir, bytes) { for (const cb of this.listeners) cb(dir, bytes); }
    feed(bytes) {
      for (const b of bytes) this.rx.push(b);
      this.emit('rx', bytes);
      if (this.waiter) this.waiter();
    }
    /** Serialise requests: one transaction on the wire at a time. */
    transact(req, timeout = 400) {
      const run = () => this._transact(Uint8Array.from(req), timeout);
      const p = this.busy.then(run, run);
      this.busy = p.catch(() => {});
      return p;
    }
    async _transact(req, timeout) {
      this.rx = [];
      await this.write(req);
      this.emit('tx', req);
      const until = Date.now() + timeout;
      let echoStripped = false;
      while (Date.now() < until) {
        // K-line is half duplex: the cable hears its own transmission first
        if (!echoStripped && this.rx.length >= req.length) {
          if (req.every((b, i) => this.rx[i] === b)) this.rx.splice(0, req.length);
          echoStripped = true;
        }
        if (echoStripped) {
          const { frames } = Honda.parseStream(this.rx);
          const reply = frames.find(f => f[0] !== req[0] || f.length !== req.length || !f.every((b, i) => b === req[i]));
          if (reply) return reply;
        }
        await new Promise(r => { this.waiter = r; setTimeout(r, 20); });
        this.waiter = null;
      }
      return null;
    }
  }

  /** Real cable via the Web Serial API (Chrome / Edge on Windows, macOS, Linux, ChromeOS). */
  class SerialLink extends BaseLink {
    static supported() { return typeof navigator !== 'undefined' && 'serial' in navigator; }
    async open({ baud = Honda.BAUD, port = null } = {}) {
      this.port = port || await navigator.serial.requestPort();
      await this.port.open({ baudRate: baud, dataBits: 8, stopBits: 1, parity: 'none', bufferSize: 4096 });
      this.writer = this.port.writable.getWriter();
      this.reading = true;
      this.readLoop();
      const info = this.port.getInfo ? this.port.getInfo() : {};
      this.name = info.usbVendorId ? `USB ${info.usbVendorId.toString(16).padStart(4, '0')}:${(info.usbProductId || 0).toString(16).padStart(4, '0')}` : 'COM';
      if (info.usbVendorId === 0x0403) this.name += ' (FTDI FT232)';
      if (info.usbVendorId === 0x1a86) this.name += ' (CH340)';
      if (info.usbVendorId === 0x10c4) this.name += ' (CP210x)';
      if (info.usbVendorId === 0x067b) this.name += ' (PL2303)';
      return this.name;
    }
    async readLoop() {
      while (this.reading && this.port.readable) {
        this.reader = this.port.readable.getReader();
        try {
          for (;;) {
            const { value, done } = await this.reader.read();
            if (done) break;
            if (value) this.feed(value);
          }
        } catch (e) { /* cable unplugged or port closed */ }
        finally { try { this.reader.releaseLock(); } catch {} }
      }
    }
    async write(bytes) { await this.writer.write(bytes); }
    /** Honda wake-up: hold K-line low 70 ms then high 130 ms. */
    async wakeup() {
      try {
        await this.port.setSignals({ break: true });
        await sleep(70);
        await this.port.setSignals({ break: false });
      } catch (e) {
        // Some adapters/drivers do not support BREAK — fall back to a 0x00 byte at low baud (≈ 50 ms low)
        await this.reopen(200); await this.write(Uint8Array.of(0)); await sleep(60); await this.reopen(Honda.BAUD);
      }
      await sleep(130);
    }
    async reopen(baud) {
      this.reading = false;
      try { await this.reader?.cancel(); } catch {}
      try { this.writer.releaseLock(); } catch {}
      await this.port.close();
      await this.port.open({ baudRate: baud, bufferSize: 4096 });
      this.writer = this.port.writable.getWriter();
      this.reading = true; this.readLoop();
    }
    async close() {
      this.reading = false;
      try { await this.reader?.cancel(); } catch {}
      try { this.writer?.releaseLock(); } catch {}
      try { await this.port?.close(); } catch {}
    }
  }

  /** Virtual Honda ECU so every screen can be used and tested without a bike. */
  class SimLink extends BaseLink {
    async open() {
      this.name = 'ECU จำลอง (ไม่ได้ต่อรถ)';
      this.t0 = Date.now(); this.awake = false; this.diag = false;
      this.dtcNow = [[12, 1]]; this.dtcPast = [[7, 1], [21, 1]];
      this.memory = new Uint8Array(0x8000);
      for (let i = 0; i < this.memory.length; i++) this.memory[i] = (i * 7 + (i >> 8)) & 0xFF;
      return this.name;
    }
    async close() {}
    async wakeup() { await sleep(200); this.awake = true; }
    async write(req) {
      const echo = Array.from(req);
      const reply = this.respond(req);
      setTimeout(() => this.feed(Uint8Array.from(echo)), 4);
      if (reply) setTimeout(() => this.feed(reply), 25);
    }
    respond(req) {
      const [type, , cmd, arg] = req;
      if (Honda.checksum(Array.from(req.slice(0, -1))) !== req[req.length - 1]) return null;
      if (type === 0xFE) return null;                                    // ping: Honda ECUs stay silent
      if (type !== 0x72 || !this.awake) return null;
      if (cmd === 0x00 && arg === 0xF0) { this.diag = true; return Honda.frame(0x02, [0x00]); }
      if (!this.diag) return null;
      if (cmd === 0x71) return Honda.frame(0x02, [0x71, arg, ...this.table(arg)]);
      if (cmd === 0x74 || cmd === 0x73) {
        const list = cmd === 0x74 ? this.dtcNow : this.dtcPast;
        const page = list.slice((arg - 1) * 3, arg * 3).flat();
        while (page.length < 6) page.push(0);
        return Honda.frame(0x02, [cmd, arg, ...page]);
      }
      if (cmd === 0x60 && arg === 0x03) { this.dtcNow = []; this.dtcPast = []; return Honda.frame(0x02, [0x60, 0x03]); }
      return null;
    }
    table(t) {
      const s = (Date.now() - this.t0) / 1000;
      if (t === 0x00) return [0x38, 0x12, 0x4B, 0x30, 0x4A, 0x00, 0x41, 0x30];  // "K0W-A" style id bytes
      if (t === 0x11) {
        const rev = Math.max(0, Math.sin(s / 3));
        const rpm = Math.round(1500 + rev * 7500 + Math.sin(s * 9) * 40);
        const tps = Math.round(rev * 160);
        const ect = Math.min(40 + 95, Math.round(40 + 30 + s * 1.5));
        const inj = Math.round((2.1 + rev * 4) * 1000 / 4);
        return [rpm >> 8, rpm & 255, 26 + Math.round(rev * 180), tps, 90, ect, 120, 40 + 32, 60 + Math.round(rev * 60), 35 + Math.round(rev * 60),
                0, 0, 138 + Math.round(Math.sin(s) * 3), Math.round(rev * 95), inj >> 8, inj & 255, Math.round((12 + rev * 18 + 64) * 2), 0, 0, 0];
      }
      if (t === 0x20) return [Math.round(128 + Math.sin(s * 4) * 110), 128 + Math.round(Math.sin(s / 2) * 10), 0, 0];
      return [];
    }
  }

  return { SerialLink, SimLink, hex, sleep };
});
