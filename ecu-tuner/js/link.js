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
    transact(req, timeout = 400, hdr = 1) {
      const run = () => this._transact(Uint8Array.from(req), timeout, hdr);
      const p = this.busy.then(run, run);
      this.busy = p.catch(() => {});
      return p;
    }
    async _transact(req, timeout, hdr = 1) {
      this.rx = [];
      try { await this.write(req); } catch { return null; }   // port hiccup (key-off): caller treats null as no reply
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
          const { frames } = Honda.parseStream(this.rx, hdr);
          const reply = frames.find(f => f[0] !== req[0] || f.length !== req.length || !f.every((b, i) => b === req[i]));
          if (reply) { this.lastOk = Date.now(); return reply; }
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
      const opts = { baudRate: baud, dataBits: 8, stopBits: 1, parity: 'none', bufferSize: 4096 };
      try {
        await this.port.open(opts);
      } catch (e) {
        // already-open, or the FTDI not yet released after an unplug/key-off — close and retry once
        try { await this.port.close(); } catch {}
        await sleep(400);
        await this.port.open(opts);
      }
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
      } catch (e) { /* adapter doesn't support BREAK — the init command alone re-establishes the session; never close/reopen the port here (it can jam the FTDI during key-off) */ }
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
      if (type === 0x82 && req[1] === 0x82 && this.awake) {        // flash read: 82 82 00 09 A2 A0 A1 N cs
        const addr = (req[4] << 16) | (req[6] << 8) | req[5], n = req[7], data = [];
        for (let k = 0; k < n; k++) data.push(this.memory[(addr + k) % this.memory.length]);
        const body = [0x92, 0x92, 0x00, data.length + 5, ...data];   // real ECU ORs the mtype with 0x10
        return Uint8Array.from([...body, Honda.checksum(body)]);
      }
      // ---- Keihin flash write protocol (so read/write round-trips can be tested) ----
      if (type === 0x7D && this.awake) { this.writeMode = true; return Honda.frame(0x0D, [req[2] ?? 1, req[3] ?? 1]); }
      if (type === 0x7B && this.awake) { return Honda.frame(0x0B, [req[2] ?? 0, req[3] ?? 0]); }
      if (type === 0x7E && this.awake) {
        const sub = req[3];
        if (sub === 0x05) return Honda.frame(0x0E, [1, 0]);               // erase status → done
        if (sub === 0x06) {                                              // write one 128-byte page
          const base = ((req[4] << 8) | req[5]) * 16, data = Array.from(req.slice(6, 6 + 128));
          for (let k = 0; k < data.length; k++) this.memory[(base + k) % this.memory.length] = data[k];
          return Honda.frame(0x0E, [1, 6]);                              // ack (len 5)
        }
        if (sub === 0x0D) return Honda.frame(0x0E, [1, 0x0F]);           // post-write → success
        return Honda.frame(0x0E, [1, sub ?? 1, 0]);                      // generic ack
      }
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
    /** operating point: rpm and throttle wander independently so every map cell gets visited */
    /** full-throttle pull from walking pace (for the road-dyno page); power rises a little with each applied tune */
    startRun() { this.run = { last: Date.now(), v: 1.5, phase: 'pull' }; }
    runState(s) {
      const r = this.run, now = Date.now(), dt = Math.min(0.2, (now - r.last) / 1000); r.last = now;
      const m = 170, drag = 0.5 * 1.2 * 0.6 * r.v * r.v, roll = 0.015 * m * 9.81;
      const rpm = Math.min(9600, Math.round(1600 + r.v * 3.6 * 118));
      const gain = 1 + 0.04 * (this.scales?.length || 0);
      const hp = gain * (3.5 + 6.5 * Math.sin(Math.min(1, Math.max(0, (rpm - 1600) / 6200)) * Math.PI / 2)) * (rpm > 9000 ? 0.85 : 1);
      if (r.phase === 'pull') { r.v += ((hp * 745.7) / Math.max(r.v, 1) - drag - roll) / m * dt; if (r.v * 3.6 >= 76) r.phase = 'coast'; }
      else { r.v -= (drag + roll + 1.8 * m) / m * dt; if (r.v < 1) this.run = null; }
      return { s, rpm, tps: r.phase === 'pull' ? 100 : 0, speed: r.v * 3.6 };
    }
    state() {
      const s = (Date.now() - this.t0) / 1000;
      if (this.run) return this.runState(s);
      // two incommensurate sweeps (Lissajous) so rpm × throttle covers the whole table within a minute or two
      const tps = Math.max(0, Math.min(100, 50 + 52 * Math.sin(s / 1.9 + 1)));
      const rpm = Math.round(5200 + 4000 * Math.sin(s / 5.3));
      return { s, rpm, tps };
    }
    /** "true" AFR of the virtual engine: lean pocket around 6000 rpm / 45 % throttle, slightly rich at full load */
    afrAt(rpm, tps) {
      const lean = 1 + 0.09 * Math.exp(-(((rpm - 6000) / 1500) ** 2) - (((tps - 45) / 20) ** 2));
      const rich = 1 - 0.05 * Math.max(0, (tps - 80) / 20) * Math.max(0, (rpm - 6500) / 3000);
      let fuel = 1; for (const f of this.scales || []) fuel *= f(rpm, tps);
      return 14.7 * lean * rich / fuel;
    }
    /** autotune result applied to the virtual engine (stands in for flashing the new map) */
    applyFuelScale(fn) { (this.scales ||= []).push(fn); }
    afr() { const { rpm, tps } = this.state(); return +(this.afrAt(rpm, tps) + (Math.random() - 0.5) * 0.2).toFixed(2); }
    table(t) {
      const { s, rpm, tps, speed } = this.state();
      if (t === 0x00) return [0x38, 0x12, 0x4B, 0x30, 0x4A, 0x00, 0x41, 0x30];  // "K0W-A" style id bytes
      if (t === 0x11) {
        const load = tps / 100;
        const ect = Math.min(40 + 95, Math.round(40 + 30 + s * 1.5));
        const inj = Math.round((2.1 + load * 4 + rpm / 9000) * 1000 / 4);
        return [rpm >> 8, rpm & 255, 26 + Math.round(load * 180), Math.round(tps * 1.6), 90, ect, 120, 40 + 32, 60 + Math.round(load * 60), 35 + Math.round(load * 60),
                0, 0, 138 + Math.round(Math.sin(s) * 3), Math.round(speed ?? load * rpm / 95), inj >> 8, inj & 255, Math.round((12 + load * 18 + 64) * 2), 0, 0, 0];
      }
      if (t === 0x20) {
        const afr = this.afrAt(rpm, tps), o2 = 0.45 + 0.4 * Math.tanh((14.7 - afr) * 3);
        return [Math.round(o2 / 1.25 * 256), 128 + Math.round(Math.sin(s / 2) * 10), 0, 0];
      }
      return [];
    }
  }

  /** Wideband AFR controller on a second USB serial port (most print one reading per line, e.g. "14.7" or "AFR 14.70").
   *  Values below 2 are taken as lambda and converted to petrol AFR. */
  class WidebandLink {
    async open(baud = 9600) {
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: baud });
      this.value = null; this.at = 0; this.reading = true; this.buf = '';
      const dec = new TextDecoder();
      (async () => {
        while (this.reading && this.port.readable) {
          this.reader = this.port.readable.getReader();
          try {
            for (;;) {
              const { value, done } = await this.reader.read(); if (done) break;
              this.buf += dec.decode(value, { stream: true });
              let i; while ((i = this.buf.search(/[\r\n]/)) >= 0) {
                const line = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1);
                const m = line.match(/(\d+(?:\.\d+)?)/);
                if (m) { let v = parseFloat(m[1]); if (v > 0 && v < 2) v *= 14.7; if (v > 6 && v < 25) { this.value = +v.toFixed(2); this.at = Date.now(); } }
              }
              if (this.buf.length > 200) this.buf = '';
            }
          } catch {} finally { try { this.reader.releaseLock(); } catch {} }
        }
      })();
    }
    afr() { return Date.now() - this.at < 1500 ? this.value : null; }
    async close() { this.reading = false; try { await this.reader?.cancel(); } catch {} try { await this.port?.close(); } catch {} }
  }

  return { SerialLink, SimLink, WidebandLink, hex, sleep };
});
