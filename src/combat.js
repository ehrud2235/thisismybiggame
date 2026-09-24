// 타격 판정과 데미지. 기획: docs/phase0-spec.md §5~§6

import { CFG, ANAT } from './config.js';
import { sub, norm, lerpV, dist, dot, pointSegDist, clamp, dirToLocal, rotY, v3 } from './math.js';
import { colliders, isPunching, knockDown, knockOut, HANDS } from './fighter.js';

// 주먹 경로를 잘게 나눠 상대 충돌체와 검사한다. 가장 먼저 닿은 것을 돌려준다.
function sweep(a, b, cols) {
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    const p = lerpV(a, b, i / steps);
    let best = null, bestDepth = 0;
    for (const c of cols) {
      const d = c.b ? pointSegDist(p, c.a, c.b) : dist(p, c.a);
      const depth = c.r + ANAT.fistR - d;
      if (depth > 0) {
        // 가드가 머리보다 앞에 있으면 가드가 먼저 막는다
        const score = depth + (c.guard ? 0.02 : 0);
        if (!best || score > bestDepth) { best = c; bestDepth = score; }
      }
    }
    if (best) return { col: best, point: p };
  }
  return null;
}

// 방어자가 타격 직전에 그 방향으로 반응했는가
function judgeSeen(def, shape, body, now) {
  const W = CFG.unseenWindow;
  const recent = (k) => now - def.react[k] <= W;
  if (isPunching(def)) return { unseen: true, extra: 1, why: '치는 중' };
  if (recent('back')) return { unseen: false, extra: 1 };
  if (body) {
    if (recent('guardLow') || recent('guard')) return { unseen: false, extra: 1 };
    return { unseen: true, extra: 1, why: '바디' };
  }
  if (recent('guard')) return { unseen: false, extra: 1 };
  const cat = shape.cat;
  if (cat === 'straight') {
    if (recent('slipL') || recent('slipR') || recent('duck') || recent('lean')) return { unseen: false, extra: 1 };
    return { unseen: true, extra: 1 };
  }
  if (cat === 'hook' || cat === 'over') {
    // 공격자 기준 arriveSide 'L' = 방어자의 왼쪽으로 들어온다
    const into = shape.arriveSide === 'L' ? 'slipL' : 'slipR';
    const away = shape.arriveSide === 'L' ? 'slipR' : 'slipL';
    if (recent(into)) return { unseen: true, extra: CFG.counterMult, why: '주먹 쪽으로 슬립' };
    if (recent(away) || recent('duck') || recent('lean')) return { unseen: false, extra: 1 };
    return { unseen: true, extra: 1 };
  }
  // 어퍼
  if (recent('duck')) return { unseen: true, extra: CFG.upperDuckMult, why: '숙인 머리' };
  if (recent('lean') || recent('slipL') || recent('slipR')) return { unseen: false, extra: 1 };
  return { unseen: true, extra: 1 };
}

export function resolveHits(att, def, now, events, log) {
  if (def.state !== 'fight' && def.state !== 'rising') return;
  const cols = colliders(def);
  for (const s of HANDS) {
    const h = att.hands[s];
    if (h.phase !== 'flight' || h.feint || h.resolved) continue;
    const hit = sweep(h.prevWorld, h.fistWorld, cols);
    if (!hit) continue;
    h.resolved = true;
    applyHit(att, def, h, hit, now, events, log);
    // 주먹은 닿은 자리에서 돌아온다
    h.phase = 'retract';
    h.t = 0;
    h.retractFrom = h.fist;
    h.retractDur = Math.max(0.08, h.dur * CFG.retractFactor);
  }
}

function applyHit(att, def, h, hit, now, events, log) {
  const shape = h.shape;
  const dir = norm(sub(h.fistWorld, h.prevWorld));
  const kind = hit.col.kind;
  const blocked = kind === 'glove' || kind === 'forearm';
  const body = kind === 'body';

  // 배율
  const weightMult = 1 + (CFG.weightMultMax - 1) * h.weight;
  const seen = judgeSeen(def, shape, body, now);
  const defVel = v3(def.vel.x, 0, def.vel.z);
  const toAtt = norm(v3(att.pos.x - def.pos.x, 0, att.pos.z - def.pos.z));
  // 카운터는 상대가 실제로 들어오는 중일 때만. 치는 중이라는 이유는 '못 봄'에서 이미 계산했다.
  const counter = dot(defVel, toAtt) > 0.6 || def.punchLean > 0.06;
  let mult = weightMult * (seen.unseen ? CFG.unseenMult : 1) * seen.extra * (counter ? CFG.counterMult : 1);
  mult = Math.min(mult, CFG.multCap);
  let final = shape.base * mult;
  if (att.stamina <= CFG.tiredThreshold) final *= 0.75;
  if (blocked) final *= def.guardTight > 0.5 ? CFG.tightGuardBlockMult : CFG.guardBlockMult;

  const chin = Math.max(CFG.chinMin, CFG.chinBase - (def.headDmg / 10) * CFG.chinLossPer10);
  const koVal = final * (1 + CFG.rotationalKoBonus * shape.rot);
  const ratio = koVal / chin;

  // 반응: 머리가 맞은 힘의 방향으로, 힘의 크기만큼 꺾인다
  const dl = dirToLocal(dir, def.yaw);
  const pow = blocked ? final * 2.5 : final;
  if (!body) {
    def.hs.x.v += dl.x * pow * 0.09;
    def.hs.y.v += dl.y * pow * 0.07;
    def.hs.z.v += dl.z * pow * 0.09;
    const rotK = 0.5 + shape.rot;
    def.hr.yaw.v += dl.x * pow * 0.35 * rotK;
    def.hr.pitch.v += (-dl.y * 1.2 - dl.z * 0.4) * pow * 0.28;
    def.hr.roll.v += -dl.x * pow * 0.18;
  } else {
    def.bodyBend.v += pow * 0.25;
  }
  // 균형이 이미 무너져 있었는지는 이번 타격이 밀기 전에 본다
  const wasBroken = Math.hypot(def.balance.x, def.balance.z) > 0.7;
  const push = (blocked ? 0.004 : 0.012) * final * (1 + (1 - shape.rot));
  def.balance.x = clamp(def.balance.x + dl.x * push, -1, 1);
  def.balance.z = clamp(def.balance.z + dl.z * push, -1, 1);
  def.vel.x += dir.x * final * 0.04;
  def.vel.z += dir.z * final * 0.04;

  let result = blocked ? 'block' : 'hit';
  if (blocked) {
    def.guardShakeT = CFG.guardShakeTime;
    def.headDmg += final;
    att.stats.blocked++;
  } else if (body) {
    def.bodyDmg += final;
    def.staminaMax = Math.max(40, CFG.staminaMax - def.bodyDmg);
    def.stamina = Math.min(def.stamina, def.staminaMax);
    att.stats.landed++;
    att.stats.bodyLanded++;
    // 리버샷: 상대의 오른쪽 옆구리(앞손 바디 훅)로 세게 → 한 박자 뒤에 무릎을 꿇는다
    if (shape.cat === 'hook' && shape.arriveSide === 'R' && final >= CFG.liverThreshold && def.pendingDownT < 0) {
      def.pendingDownT = CFG.liverDelay;
      result = 'liver';
    }
  } else {
    att.stats.landed++;
    att.stats.headLanded++;
    if (seen.unseen) att.stats.unseen++;
    const broken = wasBroken;
    if (ratio >= CFG.koRatio) { knockOut(def, events); result = 'ko'; }
    else if (ratio >= CFG.downRatio || (broken && ratio >= CFG.rockedRatio)) { knockDown(def, events, 'strike'); result = 'down'; }
    else if (ratio >= CFG.rockedRatio) { def.rockedT = CFG.rockedTime; result = 'rocked'; }
    def.headDmg += final;
  }

  const clean = !blocked && (seen.unseen || ratio >= CFG.rockedRatio);
  events.push({
    type: blocked ? 'block' : 'hit',
    f: att.id, target: def.id, pos: hit.point, dir, power: final, clean, unseen: seen.unseen && !blocked,
    body, result, name: shape.name,
  });

  log.push({
    t: +now.toFixed(3),
    attacker: att.id,
    hand: h.side,
    name: shape.name,
    stick: [+h.stick.x.toFixed(2), +h.stick.y.toFixed(2)],
    curve: +shape.s.toFixed(2),
    weight: +h.weight.toFixed(2),
    flow: h.flow,
    target: body ? 'body' : 'head',
    outcome: blocked ? 'blocked' : 'landed',
    unseen: seen.unseen,
    unseenWhy: seen.why || null,
    counter,
    mult: +mult.toFixed(2),
    final: +final.toFixed(1),
    chinRatio: +ratio.toFixed(2),
    result,
  });
}

export function missLog(att, h, now, log) {
  log.push({
    t: +now.toFixed(3), attacker: att.id, hand: h.side, name: h.shape.name,
    stick: [+h.stick.x.toFixed(2), +h.stick.y.toFixed(2)], curve: +h.shape.s.toFixed(2),
    weight: +h.weight.toFixed(2), flow: h.flow, outcome: 'missed',
  });
}
