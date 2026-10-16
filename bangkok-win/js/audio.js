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

  engine(speedRatio, throttle) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // fake gears: pitch climbs and drops back as the bike speeds up
    const gear = Math.min(3, Math.floor(speedRatio * 4));
    const inGear = speedRatio * 4 - gear;
    const f = 45 + gear * 8 + inGear * 70 + throttle * 12;
    this.osc.frequency.setTargetAtTime(f, t, 0.05);
    this.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    this.filter.frequency.setTargetAtTime(350 + throttle * 900 + speedRatio * 600, t, 0.08);
    this.eng.gain.setTargetAtTime(this.muted ? 0 : 0.07 + throttle * 0.08, t, 0.1);
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
