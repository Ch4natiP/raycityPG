// Tiny synth: engine hum, horn, pickup ding, cash, crash. Starts after the first click.
export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  start() {
    if (this.ctx) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(ctx.destination);
      this.osc = ctx.createOscillator();
      this.osc.type = 'sawtooth';
      this.osc2 = ctx.createOscillator();
      this.osc2.type = 'square';
      this.filter = ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 600;
      this.eng = ctx.createGain();
      this.eng.gain.value = 0.0;
      this.osc.connect(this.filter);
      this.osc2.connect(this.filter);
      this.filter.connect(this.eng);
      this.eng.connect(this.master);
      this.osc.start();
      this.osc2.start();
    } catch { this.ctx = null; }
  }

  // Engine note follows the gearbox: rpm climbs through each gear and drops on the shift.
  engine(bike) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const rpm = bike.rpm;
    const load = bike.throttle ? (bike.shift > 0 ? 0.3 : 1) : 0.15;
    const f = 34 + rpm * 115 + bike.gear * 3;
    this.osc.frequency.setTargetAtTime(f, t, 0.03);
    this.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.03);
    this.filter.frequency.setTargetAtTime(280 + load * 900 + rpm * 900, t, 0.05);
    this.eng.gain.setTargetAtTime(this.muted ? 0 : 0.05 + load * 0.07 + rpm * 0.03, t, 0.06);
    if (!this.skidGain) this.makeSkid();
    this.skidGain.gain.setTargetAtTime(this.muted ? 0 : bike.skid * 0.1, t, 0.05);
  }

  // Rain on the city: low-passed noise, louder with heavier rain.
  rain(level) {
    if (!this.ctx) return;
    if (!this.rainGain) {
      const ctx = this.ctx;
      const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1400;
      this.rainGain = ctx.createGain();
      this.rainGain.gain.value = 0;
      src.connect(lp); lp.connect(this.rainGain); this.rainGain.connect(this.master);
      src.start();
    }
    this.rainGain.gain.setTargetAtTime(this.muted ? 0 : level * 0.12, this.ctx.currentTime, 0.3);
  }

  // Looping noise through a band-pass: tyre squeal under hard braking.
  makeSkid() {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2200;
    bp.Q.value = 6;
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    src.connect(bp);
    bp.connect(this.skidGain);
    this.skidGain.connect(this.master);
    src.start();
  }

  tone(freq, dur, type = 'sine', vol = 0.3, when = 0, slide = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.linearRampToValueAtTime(freq + slide, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  horn() { this.tone(420, 0.35, 'square', 0.12); this.tone(520, 0.35, 'square', 0.1); }
  carHorn() { this.tone(330, 0.5, 'sawtooth', 0.08); this.tone(392, 0.5, 'sawtooth', 0.06); }
  ding() { this.tone(880, 0.25, 'sine', 0.25); this.tone(1320, 0.4, 'sine', 0.2, 0.12); }
  levelUp() { [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.28, 'triangle', 0.22, i * 0.09)); }
  phone() { [1318, 1568, 1318, 1568].forEach((f, i) => this.tone(f, 0.12, 'sine', 0.15, i * 0.16)); }
  countdown(go) { this.tone(go ? 880 : 440, go ? 0.5 : 0.18, 'square', 0.12); }
  fanfare() { [392, 523, 659, 784, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.2, i * 0.11)); }
  lose() { [392, 349, 311, 262].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.18, i * 0.18)); }
  whistle() { this.tone(2400, 0.25, 'sine', 0.12); this.tone(2600, 0.35, 'sine', 0.1, 0.28); }
  cash() { [1046, 1318, 1568, 2093].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.2, i * 0.07)); }

  crash(power) {
    if (!this.ctx || this.muted) return;
    const len = 0.3;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = Math.min(0.6, 0.1 + power * 0.04);
    s.connect(g);
    g.connect(this.master);
    s.start();
  }

  toggle() {
    this.muted = !this.muted;
    return this.muted;
  }
}
