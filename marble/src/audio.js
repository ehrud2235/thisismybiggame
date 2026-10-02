// 효과음. 파일 없이 WebAudio로 합성한다. 브라우저 정책상 첫 입력 이후에만 소리가 난다.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.lastAt = {};
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { this.ctx = new AC(); } catch { return; }
      const len = Math.floor(this.ctx.sampleRate * 0.3);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  // 같은 소리가 너무 촘촘하게 겹치지 않게
  ready(kind, gap) {
    if (!this.ctx || this.muted) return false;
    const t = this.ctx.currentTime;
    if (t - (this.lastAt[kind] ?? -1) < gap) return false;
    this.lastAt[kind] = t;
    return true;
  }

  tone(freq, dur, gain, type = 'sine', delay = 0, slide = 1) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide !== 1) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  burst(dur, gain, freq, kind) {
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this.noise;
    f.type = kind;
    f.frequency.value = freq;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(c.destination);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  // 유리구슬끼리: 짧고 높은 '딱'
  glass(power) {
    if (power < 30 || !this.ready('glass', 0.03)) return;
    const v = Math.min(1, power / 1200);
    this.tone(2500 + v * 900, 0.08, 0.05 + v * 0.18);
    this.tone(3800 + v * 500, 0.05, 0.03 + v * 0.08);
  }

  // 판자·말뚝: 낮은 '퉁'
  wood(power) {
    if (power < 40 || !this.ready('wood', 0.04)) return;
    const v = Math.min(1, power / 1400);
    this.burst(0.05, 0.05 + v * 0.3, 900, 'lowpass');
    this.tone(200, 0.09, 0.04 + v * 0.22, 'triangle', 0, 0.7);
  }

  flick(power) {
    if (!this.ready('flick', 0.05)) return;
    this.burst(0.05, 0.12 + power * 0.2, 2200, 'highpass');
  }

  clear(perfect) {
    if (!this.ready('end', 0.5)) return;
    const notes = perfect ? [523.25, 659.25, 783.99, 1046.5] : [523.25, 659.25, 783.99];
    notes.forEach((n, i) => this.tone(n, 0.35, 0.12, 'sine', i * 0.09));
  }

  fail() {
    if (!this.ready('end', 0.5)) return;
    this.tone(392, 0.25, 0.1, 'triangle', 0);
    this.tone(311.13, 0.4, 0.1, 'triangle', 0.18);
  }
}
