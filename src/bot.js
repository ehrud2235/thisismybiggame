// 스파링 봇. 혼자 테스트할 때 P2 자리에 들어간다.
// 시뮬 바깥의 입력 장치일 뿐이므로 난수를 써도 시뮬의 결정성은 깨지지 않는다.

import { emptyInput } from './input.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class Bot {
  constructor(mode = 'spar', seed = 7) {
    this.mode = mode;          // spar | dummy
    this.r = rng(seed);
    this.t = 0;
    this.cool = 1.2;
    this.plan = [];
    this.hold = [];            // 누르고 있는 입력 {key, until, value}
    this.strafe = 1;
    this.strafeT = 0;
    this.seenPunch = new WeakSet();
    this.reaction = null;
    this.want = 1.2;
  }

  read(dt, self, opp) {
    this.t += dt;
    const inp = emptyInput();
    if (this.mode === 'dummy') {
      inp.guard = false;
      return inp;
    }
    const r = this.r;
    const d = Math.hypot(self.pos.x - opp.pos.x, self.pos.z - opp.pos.z);

    // 거리와 옆걸음
    this.strafeT -= dt;
    if (this.strafeT <= 0) {
      this.strafe = r() < 0.5 ? -1 : 1;
      this.strafeT = 0.8 + r() * 1.8;
      this.want = 0.85 + r() * 0.35;
    }
    inp.move.y = Math.max(-1, Math.min(1, (d - this.want) * 2.5));
    inp.move.x = this.strafe * 0.45;

    // 공격 계획
    this.cool -= dt;
    if (this.cool <= 0 && this.plan.length === 0 && d < 1.3 && self.state === 'fight') {
      this.makePlan();
      this.cool = 0.5 + r() * 1.3;
    }
    while (this.plan.length && this.plan[0].at <= this.t) {
      const a = this.plan.shift();
      this.hold.push({ ...a, until: this.t + (a.dur || 0.05) });
    }

    // 방어 반응: 상대가 치기 시작하면 한 박자 늦게 반응한다
    for (const s of ['lead', 'rear']) {
      const h = opp.hands[s];
      if ((h.phase === 'windup' || h.phase === 'flight') && !this.seenPunch.has(h.shape || h)) {
        this.seenPunch.add(h.shape || h);
        if (!this.reaction && r() < 0.45) {
          const kinds = ['guard', 'guard', 'slipL', 'slipR', 'duck', 'lean', 'back'];
          this.reaction = { kind: kinds[Math.floor(r() * kinds.length)], at: this.t + 0.14 + r() * 0.12, dur: 0.3 };
        }
      }
    }
    // 거리 안에서는 리듬 있게 머리를 흔든다 (가만히 서서 맞는 샌드백이 되지 않게)
    this.rhythmT = (this.rhythmT ?? 0.6) - dt;
    if (!this.reaction && d < 1.4 && this.rhythmT <= 0) {
      this.rhythmT = 0.35 + r() * 0.9;
      const kinds = ['slipL', 'slipR', 'duck', 'guard', 'lean'];
      this.reaction = { kind: kinds[Math.floor(r() * kinds.length)], at: this.t, dur: 0.22 + r() * 0.2 };
    }
    if (this.reaction && this.t >= this.reaction.at) {
      const k = this.reaction.kind;
      if (k === 'guard') inp.guard = true;
      if (k === 'slipL') inp.head.x = -1;
      if (k === 'slipR') inp.head.x = 1;
      if (k === 'duck') inp.head.y = -1;
      if (k === 'lean') inp.head.y = 1;
      if (k === 'back') inp.move.y = -1;
      if (this.t >= this.reaction.at + this.reaction.dur) this.reaction = null;
    }

    // 눌린 입력 적용
    this.hold = this.hold.filter((a) => a.until > this.t - 0.1);
    for (const a of this.hold) {
      if (a.levelOnly) { if (this.t < a.until) inp.level = 1; continue; }
      if (a.level) inp.level = 1;
      if (this.t < a.until) {
        inp[a.hand] = true;
        inp.stick = { ...a.stick };
        if (a.hand === 'rear') inp.rearWeight = a.weight;
        inp.feint = !!a.feint;
      } else {
        inp.stick = { ...a.stick };
      }
    }
    return inp;
  }

  makePlan() {
    const r = this.r;
    const t = this.t;
    const disc = () => {
      const a = r() * Math.PI * 2, m = Math.sqrt(r());
      return { x: Math.cos(a) * m, y: Math.sin(a) * m };
    };
    const p = r();
    if (p < 0.3) {
      this.plan.push({ at: t, hand: r() < 0.5 ? 'lead' : 'rear', stick: disc(), weight: r() });
    } else if (p < 0.65) {
      // 흐름이 이어지는 콤비: 잽 → 스트레이트 → 앞손 훅
      const n = 2 + Math.floor(r() * 2);
      const seq = [
        { hand: 'lead', stick: { x: 0, y: 0 } },
        { hand: 'rear', stick: { x: r() * 0.3, y: 0 } },
        { hand: 'lead', stick: { x: -0.9, y: r() * 0.4 - 0.2 } },
        { hand: 'rear', stick: { x: 0.8, y: r() * 0.8 - 0.4 } },
      ];
      for (let i = 0; i < n; i++) this.plan.push({ at: t + i * 0.2, ...seq[i], weight: 0.3 + r() * 0.5 });
    } else if (p < 0.82) {
      // 페인트 후 진짜
      this.plan.push({ at: t, hand: 'rear', stick: { x: 0, y: 0 }, weight: 0.5, feint: true });
      this.plan.push({ at: t + 0.22, hand: 'lead', stick: { x: -0.9, y: 0.1 }, weight: 0.6 });
    } else {
      // 바디
      this.plan.push({ at: t, levelOnly: true, dur: 0.45 });
      this.plan.push({ at: t + 0.15, hand: r() < 0.5 ? 'lead' : 'rear', stick: { x: r() < 0.5 ? -0.8 : 0.8, y: 0 }, weight: 0.6, level: true });
    }
  }
}
