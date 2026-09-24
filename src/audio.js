// 효과음. 파일 없이 WebAudio로 합성한다.
// 막힌 소리 / 맞은 소리 / 제대로 들어간 소리가 확실히 달라야 한다 (기획 §10).

export class Audio {
  constructor() {
    this.ctx = null;
    this.noise = null;
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 1.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  _noise(t, dur, type, freq, q, gain, sweepTo) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.0);
    src.stop(t + dur + 0.02);
  }

  _tone(t, dur, f0, f1, gain, type = 'sine') {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  hit(power, clean, body) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const p = Math.min(1, power / 25);
    if (body) {
      this._noise(t, 0.14, 'lowpass', 500 + p * 400, 0.7, 0.5 + p * 0.5);
      this._tone(t, 0.16, 110, 48, 0.5 + p * 0.4);
      return;
    }
    this._noise(t, 0.11, 'lowpass', 900 + p * 1600, 0.8, 0.45 + p * 0.55);
    this._tone(t, 0.12, 150, 55, 0.35 + p * 0.5);
    if (clean) {
      // 제대로 들어간 소리: 날카로운 파열음
      this._noise(t, 0.035, 'highpass', 2600, 0.7, 0.35 + p * 0.4);
      this._tone(t, 0.25, 80, 38, 0.3 + p * 0.3);
    }
  }

  block(power) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const p = Math.min(1, power / 6);
    this._noise(t, 0.07, 'bandpass', 520, 1.6, 0.25 + p * 0.3);
    this._tone(t, 0.06, 220, 140, 0.12);
  }

  whoosh(weight) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.16, 'bandpass', 380, 1.2, 0.05 + weight * 0.1, 1400);
  }

  floor() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone(t, 0.35, 70, 30, 0.8);
    this._noise(t, 0.3, 'lowpass', 300, 0.7, 0.6);
  }

  crowd(intensity = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 700;
    f.Q.value = 0.5;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18 * intensity, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 3);
  }

  bell() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      this._tone(t + i * 0.28, 0.6, 1320, 1300, 0.18, 'triangle');
      this._tone(t + i * 0.28, 0.6, 2640, 2600, 0.06, 'sine');
    }
  }
}
