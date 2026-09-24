// 선수 한 명의 시뮬레이션 상태와 틱 갱신.
// 입력만으로 진행되고 난수를 쓰지 않는다. 좌표 규칙은 math.js 참고.

import { CFG, ANAT } from './config.js';
import {
  v3, copy, add, sub, scale, addScaled, len, dist, norm, lerp, lerpV, clamp,
  rotY, toWorld, toLocal, bezier, bezierLength, solveArm, springStep,
} from './math.js';

const HANDS = ['lead', 'rear'];
const REACTIONS = ['guard', 'guardLow', 'slipL', 'slipR', 'duck', 'lean', 'back'];

const spring = () => ({ x: 0, v: 0 });

function newHand(side) {
  return {
    side,
    phase: 'idle',        // idle | windup | flight | retract
    t: 0,                 // 현재 단계 경과
    elapsed: 0,           // 출발 후 전체 경과
    windup: 0,            // 준비 동작 시간 (트리거 깊이에 따라 늘어난다)
    weight: 0,
    dur: 0,
    stick: { x: 0, y: 0 },
    P: null,              // 로컬 베지어 제어점 4개
    target: null,
    targetBody: false,
    feint: false,
    committed: false,
    twist: 0,
    flow: 0,              // 1 = 흐름 연결, -1 = 끊김
    shape: null,
    fist: v3(),
    fistWorld: v3(),
    prevWorld: v3(),
    retractFrom: v3(),
    retractDur: 0.1,
    cost: 0,
    resolved: false,
  };
}

export function createFighter(id, x, z) {
  const f = {
    id,
    pos: { x, z },
    vel: { x: 0, z: 0 },
    yaw: 0,
    level: 0,
    headMove: v3(),        // 슬립/덕/젖히기 변위 (로컬)
    headStick: { x: 0, y: 0 },
    headClass: 'none',
    hs: { x: spring(), y: spring(), z: spring() },           // 맞았을 때 머리 위치 스프링
    hr: { yaw: spring(), pitch: spring(), roll: spring() },  // 머리 회전 스프링
    bodyBend: spring(),
    twist: 0,
    punchLean: 0,          // 칠 때 상체가 앞으로 실린다
    balance: { x: 0, z: 0 },
    stamina: CFG.staminaMax,
    staminaMax: CFG.staminaMax,
    headDmg: 0,
    bodyDmg: 0,
    rockedT: 0,
    overextendT: 0,
    guardShakeT: 0,
    guardTight: 0,
    guardShift: { x: 0, y: 0 },
    guardHeld: false,
    guardClass: 'none',
    slipLoad: { lead: 0, rear: 0 },
    lastTwist: 0,
    lastPunchT: -99,
    react: Object.fromEntries(REACTIONS.map((r) => [r, -99])),
    state: 'fight',        // fight | down | rising | ko
    stateT: 0,
    downDur: 0,
    downs: 0,
    pendingDownT: -1,
    forceRetreat: false,
    hands: { lead: newHand('lead'), rear: newHand('rear') },
    feet: {
      lead: { p: v3(), from: v3(), to: v3(), t: 1, lift: 0 },
      rear: { p: v3(), from: v3(), to: v3(), t: 1, lift: 0 },
    },
    stats: { thrown: 0, landed: 0, headLanded: 0, bodyLanded: 0, blocked: 0, missed: 0, feints: 0, unseen: 0, flow: 0 },
    prevIn: { lead: false, rear: false, guard: false },
  };
  for (const s of HANDS) f.hands[s].fist = copy(guardPos(f, s));
  return f;
}

const tired = (f) => f.stamina <= CFG.tiredThreshold;
const levelY = (f) => f.level * ANAT.levelDrop;

// 머리 움직임의 일부를 상체와 가드가 따라간다
function upperOffset(f, k) {
  return v3(f.headMove.x * k, f.headMove.y * k, f.headMove.z * k);
}

export function torsoYaw(f) {
  const t = f.twist;
  return ANAT.blade - (t > 0 ? t * 0.9 : t * 0.5);
}

export function chestPos(f) {
  const lean = v3(f.balance.x * 0.12, 0, f.balance.z * 0.12 + f.punchLean);
  return add(add(v3(0, ANAT.chestH - levelY(f), 0), upperOffset(f, 0.6)), lean);
}

export function shoulderPos(f, side) {
  const c = chestPos(f);
  const off = rotY(v3(side === 'lead' ? -ANAT.shoulderHalf : ANAT.shoulderHalf, 0.1, 0), torsoYaw(f));
  let p = add(c, off);
  // 준비 동작: 뒷손 어깨가 뒤로 빠지고 내려간다
  const h = f.hands[side];
  if (h.phase === 'windup' && !h.feintFlight) {
    const k = CFG.windupVisual * clamp(h.t / Math.max(0.001, h.windup), 0, 1) * h.weight;
    p = add(p, v3(0, -0.03 * k, -0.07 * k));
  }
  return p;
}

export function headPos(f) {
  const base = v3(ANAT.head.x, ANAT.head.y - levelY(f), ANAT.head.z);
  const hit = v3(f.hs.x.x, f.hs.y.x, f.hs.z.x);
  const lean = v3(f.balance.x * 0.18, 0, f.balance.z * 0.18 + f.punchLean * 0.7);
  return add(add(add(base, f.headMove), hit), lean);
}

function guardPos(f, side) {
  const loose = side === 'lead' ? ANAT.guardLead : ANAT.guardRear;
  const tight = side === 'lead' ? ANAT.tightLead : ANAT.tightRear;
  let g = lerpV(loose, tight, f.guardTight);
  g = v3(g.x, g.y - levelY(f), g.z);
  // 가드 위치 조절 (LB + 오른쪽 스틱)
  const sx = f.guardShift.x, sy = f.guardShift.y;
  g = add(g, v3(sx * 0.1, sy < 0 ? sy * 0.3 : sy * 0.05, sy < 0 ? sy * 0.05 : 0));
  // 흔들림, 지침: 가드가 처진다
  const droop = (f.rockedT > 0 ? 0.14 : 0) + (tired(f) ? 0.1 : 0);
  g = add(g, v3(0, -droop, -droop * 0.3));
  // 가드는 머리를 따라간다
  return add(g, upperOffset(f, 0.85));
}

// 오른쪽 스틱 → 궤도 모양
function trajectoryShape(side, stick) {
  const o = side === 'rear' ? stick.x : -stick.x; // 바깥쪽 성분
  const v = stick.y;
  const m = Math.min(1, Math.hypot(stick.x, stick.y));
  const s = clamp((m - 0.15) / 0.7, 0, 1); // 휘는 정도
  const ho = Math.max(0, o), up = Math.max(0, v), dn = Math.max(0, -v);
  const sum = ho + up + dn + 1e-6;
  const straightBase = side === 'lead' ? 4 : 8;
  const overBase = side === 'rear' ? 10 : 7;
  const curvedBase = (ho * 9 + dn * 8 + up * overBase) / sum;
  const base = lerp(straightBase, curvedBase, s * clamp((ho + up + dn) / Math.max(1e-6, m), 0, 1));
  const rot = s * (ho + up) / sum;
  let cat = 'straight';
  if (s >= 0.3) cat = ho >= up && ho >= dn ? 'hook' : up >= dn ? 'over' : 'upper';
  // 상대 기준 도착 방향. 뒷손(오른손) 바깥 궤도는 상대의 왼쪽으로 들어온다.
  const arriveSide = side === 'rear' ? 'L' : 'R';
  // 몸통 회전: 뒷손은 +, 앞손 훅/어퍼는 −
  const twist = side === 'rear' ? 0.7 + 0.3 * s : -(0.2 + 0.8 * ho * s + 0.4 * dn * s);
  const name = cat === 'straight' ? (side === 'lead' ? '잽' : '스트레이트')
    : cat === 'hook' ? (side === 'lead' ? '앞손 훅' : '뒷손 훅')
    : cat === 'over' ? '오버핸드' : (side === 'lead' ? '앞손 어퍼' : '뒷손 어퍼');
  return { o, v, m, s, base, rot, cat, arriveSide, twist, name };
}

function buildCurve(f, h, opp) {
  const P0 = h.start;
  const shoulder = shoulderPos(f, h.side);
  let T = h.target;
  // 사거리 제한: 팔 길이 + 보정. 넘으면 모자라게 끝난다 (헛침)
  const reach = (ANAT.upperArm + ANAT.foreArm) * (1 + CFG.reachStretch) + 0.12;
  const toT = sub(T, shoulder);
  const dT = len(toT);
  const dirT = norm(toT);
  T = addScaled(T, dirT, 0.07); // 뚫고 지나가듯 친다
  if (dT + 0.07 > reach) T = addScaled(shoulder, dirT, reach);
  const outAxis = v3(h.side === 'rear' ? 1 : -1, 0, 0);
  const sh = h.shape;
  const a = add(scale(outAxis, sh.o * sh.s), v3(0, sh.v * sh.s, 0));
  const L = Math.max(0.2, len(sub(T, P0)));
  const fwd = norm(sub(T, P0));
  const P1 = add(addScaled(P0, fwd, 0.25 * L), scale(a, 0.45 * L));
  const P2 = addScaled(add(T, scale(a, 0.5 * L)), fwd, -0.2 * L);
  h.P = [P0, P1, P2, T];
  h.arcLen = bezierLength(P0, P1, P2, T);
}

function launch(f, opp, side, input, now) {
  const h = f.hands[side];
  const shape = trajectoryShape(side, input.stick);
  h.phase = 'windup';
  h.t = 0;
  h.elapsed = 0;
  h.stick = { x: input.stick.x, y: input.stick.y };
  h.shape = shape;
  h.feint = !!input.feint;
  h.committed = false;
  h.resolved = false;
  h.start = copy(h.fist);
  h.targetBody = f.level > 0.5;
  h.target = oppTargetLocal(f, opp, h.targetBody);

  // 체중은 두 갈래로 얻는다.
  //  - 준비 동작으로 싣는 체중 (뒷손 트리거 깊이): 최대 100%. 대신 몸에 드러난다.
  //  - 준비 없이 얻는 체중 (전진 스텝, 슬립한 쪽 손, 흐름 연결): 합쳐도 freeWeightCap까지.
  // "센 주먹은 읽힌다"는 원칙을 지키기 위한 상한이다.
  const lv = rotY(v3(f.vel.x, 0, f.vel.z), -f.yaw);
  let free = side === 'lead' ? clamp(lv.z / CFG.moveSpeed, 0, 1) * 0.5 : 0;
  if (f.slipLoad[side] > 0) free = Math.max(free, CFG.slipLoadWeight);

  // 흐름: 이전 주먹과 몸통 회전 방향이 반대면 빨라진다
  h.flow = 0;
  if (now - f.lastPunchT < CFG.flowWindow && Math.abs(f.lastTwist) >= 0.3 && Math.abs(shape.twist) >= 0.3) {
    h.flow = Math.sign(f.lastTwist) !== Math.sign(shape.twist) ? 1 : -1;
  }
  if (h.flow === 1) free += CFG.flowWeightBonus;
  free = Math.min(free, CFG.freeWeightCap);

  let windupW = side === 'rear' && f.slipLoad.rear <= 0 ? input.rearWeight : 0;
  let w = Math.max(free, windupW);
  h.weight = w;
  h.windupW = windupW;
  h.windup = windupW * CFG.windupMax + (f.guardTight > 0.5 ? CFG.tightGuardDelay : 0);
  h.twist = shape.twist;
  h.feintFlight = false;

  buildCurve(f, h, opp);
  let dur = CFG.punchBaseTime + h.arcLen / CFG.punchSpeed;
  if (h.flow === 1) dur *= 1 - CFG.flowSpeedBonus;
  if (h.flow === -1) dur *= 1 + CFG.flowSpeedPenalty;
  if (tired(f)) dur /= 0.8;
  if (f.rockedT > 0) dur *= 1.1;
  h.dur = dur;

  if (h.feint) {
    f.stamina -= CFG.feintCost;
    f.stats.feints++;
  } else {
    h.cost = lerp(CFG.punchCostMin, CFG.punchCostMax, w);
    f.stamina -= h.cost;
    f.stats.thrown++;
    f.lastTwist = shape.twist;
    f.lastPunchT = now;
    if (h.flow === 1) f.stats.flow++;
  }
  f.slipLoad[side] = 0;
}

function oppTargetLocal(f, opp, body) {
  const world = body
    ? toWorld(v3(0, ANAT.pelvisH + 0.22 - levelY(opp), 0.05), opp.pos, opp.yaw)
    : toWorld(headPos(opp), opp.pos, opp.yaw);
  return toLocal(world, f.pos, f.yaw);
}

function updateHand(f, opp, h, input, dt, now, events) {
  if (h.phase === 'idle') {
    const g = guardPos(f, h.side);
    const k = Math.min(1, dt * 18);
    h.fist = lerpV(h.fist, g, k);
    return;
  }
  h.t += dt;
  h.elapsed += dt;

  const total = h.windup + h.dur;
  if (!h.committed) {
    // 트리거를 더 깊게 누르면 준비 동작이 길어진다 (누른 직후 60ms 안에서만)
    if (h.side === 'rear' && input.rear && h.elapsed < 0.06 && f.slipLoad.rear <= 0 && !h.feint) {
      if (input.rearWeight > h.windupW) {
        h.windupW = input.rearWeight;
        h.weight = Math.max(h.weight, input.rearWeight);
        h.windup = h.windupW * CFG.windupMax + (f.guardTight > 0.5 ? CFG.tightGuardDelay : 0);
      }
    }
    // 커밋 전: 목표를 약하게 따라가고, 스틱으로 궤도를 바꿀 수 있다
    const cur = oppTargetLocal(f, opp, h.targetBody || f.level > 0.5);
    h.targetBody = h.targetBody || f.level > 0.5;
    h.target = lerpV(h.target, cur, Math.min(1, dt * CFG.tracking));
    if (Math.hypot(input.stick.x - h.stick.x, input.stick.y - h.stick.y) > 0.25 && (input.lead || input.rear)) {
      h.stick = { x: input.stick.x, y: input.stick.y };
      h.shape = trajectoryShape(h.side, h.stick);
      h.twist = h.shape.twist;
    }
    buildCurve(f, h, opp);
    if (h.elapsed >= CFG.commitPoint * total) h.committed = true;
  }

  if (h.phase === 'windup') {
    const k = CFG.windupVisual * clamp(h.t / Math.max(0.001, h.windup), 0, 1) * h.windupW;
    const back = norm(sub(h.P[3], h.P[0]));
    h.fist = addScaled(h.start, back, -0.06 * k);
    if (h.t >= h.windup) {
      h.phase = 'flight';
      h.t = 0;
      h.start = copy(h.fist);
      h.P[0] = h.start;
      events.push({ type: 'launch', f: f.id, side: h.side, weight: h.weight, feint: h.feint });
    }
    return;
  }

  if (h.phase === 'flight') {
    const u = clamp(h.t / h.dur, 0, 1);
    const eu = Math.pow(u, 1.35);
    h.fist = bezier(h.P[0], h.P[1], h.P[2], h.P[3], eu);
    if (h.feint && u >= CFG.feintDepth) {
      startRetract(h, 0.12);
      events.push({ type: 'feint', f: f.id });
      return;
    }
    if (u >= 1) {
      // 끝까지 나갔는데 아무것도 못 맞혔다 → 헛침
      if (!h.resolved) {
        h.resolved = true;
        f.stats.missed++;
        f.stamina -= h.cost * (CFG.missCostMult - 1);
        if (h.weight > 0.3) {
          f.overextendT = CFG.overextendTime * h.weight;
          f.balance.z = clamp(f.balance.z + 0.55 * h.weight, -1, 1);
        }
        events.push({ type: 'miss', f: f.id, side: h.side, weight: h.weight, pos: toWorld(h.fist, f.pos, f.yaw) });
      }
      startRetract(h, h.dur * CFG.retractFactor);
    }
    return;
  }

  if (h.phase === 'retract') {
    const u = clamp(h.t / h.retractDur, 0, 1);
    h.fist = lerpV(h.retractFrom, guardPos(f, h.side), 1 - Math.pow(1 - u, 2));
    if (u >= 1) h.phase = 'idle';
  }
}

function startRetract(h, dur) {
  h.phase = 'retract';
  h.t = 0;
  h.retractFrom = copy(h.fist);
  h.retractDur = Math.max(0.06, dur);
}

export function isPunching(f) {
  return HANDS.some((s) => {
    const h = f.hands[s];
    return !h.feint && (h.phase === 'windup' || h.phase === 'flight');
  });
}

function recordReactions(f, input, now) {
  // 상체 움직임
  const hx = input.head.x, hy = input.head.y;
  let cls = 'none';
  if (Math.hypot(hx, hy) > 0.5) {
    if (Math.abs(hx) >= Math.abs(hy)) cls = hx > 0 ? 'slipR' : 'slipL';
    else cls = hy < 0 ? 'duck' : 'lean';
  }
  if (cls !== 'none' && cls !== f.headClass) {
    f.react[cls] = now;
    f.stamina -= CFG.headMoveCost;
  }
  f.headClass = cls;
  // 가드
  if (input.guard && !f.prevIn.guard) f.react.guard = now;
  let gcls = 'none';
  if (input.guard && Math.hypot(input.guardStick.x, input.guardStick.y) > 0.5) {
    gcls = input.guardStick.y < -0.5 ? 'low' : 'side';
  }
  if (gcls !== 'none' && gcls !== f.guardClass) f.react[gcls === 'low' ? 'guardLow' : 'guard'] = now;
  f.guardClass = gcls;
  // 뒤로 빠지기
  const lv = rotY(v3(f.vel.x, 0, f.vel.z), -f.yaw);
  if (lv.z < -0.9) f.react.back = now;
}

export function updateFighter(f, opp, input, dt, now, events) {
  // 상대를 향한다
  const dx = opp.pos.x - f.pos.x, dz = opp.pos.z - f.pos.z;
  const targetYaw = Math.atan2(dx, dz);
  let dy = targetYaw - f.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  f.yaw += dy * Math.min(1, dt * 14);

  f.stateT += dt;
  updateSprings(f, dt);
  updateFeet(f, dt);

  if (f.state !== 'fight') {
    updateDownState(f, dt, events);
    for (const s of HANDS) {
      const h = f.hands[s];
      h.phase = 'idle';
      h.fist = lerpV(h.fist, guardPos(f, s), Math.min(1, dt * 6));
      h.prevWorld = h.fistWorld = toWorld(h.fist, f.pos, f.yaw);
    }
    f.vel.x *= 0.8; f.vel.z *= 0.8;
    return;
  }

  // 타이머
  f.rockedT = Math.max(0, f.rockedT - dt);
  f.overextendT = Math.max(0, f.overextendT - dt);
  f.guardShakeT = Math.max(0, f.guardShakeT - dt);
  for (const s of HANDS) f.slipLoad[s] = Math.max(0, f.slipLoad[s] - dt);
  if (f.pendingDownT >= 0) {
    f.pendingDownT -= dt;
    if (f.pendingDownT < 0) knockDown(f, events, 'liver');
  }

  // 균형 회복
  const br = dt * 1.6;
  f.balance.x = Math.abs(f.balance.x) < br ? 0 : f.balance.x - Math.sign(f.balance.x) * br;
  f.balance.z = Math.abs(f.balance.z) < br ? 0 : f.balance.z - Math.sign(f.balance.z) * br;

  recordReactions(f, input, now);

  // 스텝
  let sp = 1;
  if (f.rockedT > 0) sp *= 0.6;
  if (tired(f)) sp *= 0.85;
  if (Math.hypot(f.balance.x, f.balance.z) > 0.7) sp *= 0.6;
  sp *= 1 - f.level * 0.25;
  let mx = input.move.x, mz = input.move.y;
  if (f.forceRetreat) { mx = 0; mz = -1; sp = 1; }
  let want = v3(mx * CFG.strafeSpeed * sp, 0, mz * CFG.moveSpeed * sp);
  if (want.z < 0 && f.overextendT > 0) want.z *= 0.5;
  if (f.rockedT > 0) want.x += Math.sin(now * 7 + f.id) * 0.35; // 비틀거림
  const wantW = rotY(want, f.yaw);
  const a = Math.min(1, dt / CFG.accelTime);
  f.vel.x += (wantW.x - f.vel.x) * a;
  f.vel.z += (wantW.z - f.vel.z) * a;
  f.pos.x += f.vel.x * dt;
  f.pos.z += f.vel.z * dt;

  // 자세 높이
  f.level += (clamp(input.level, 0, 1) - f.level) * Math.min(1, dt * 10);

  // 상체 움직임
  const hd = v3();
  if (input.head.x) hd.x = clamp(input.head.x, -1, 1) * CFG.slipDist;
  if (input.head.y < 0) { hd.y = input.head.y * CFG.duckDist; hd.z = -input.head.y * 0.06; }
  if (input.head.y > 0) { hd.z = -input.head.y * CFG.leanDist; hd.y = input.head.y * 0.02; }
  const maxStep = dt * (CFG.slipDist / Math.max(0.02, CFG.headMoveTime));
  for (const k of ['x', 'y', 'z']) {
    const d = hd[k] - f.headMove[k];
    f.headMove[k] += clamp(d, -maxStep, maxStep);
  }
  // 슬립한 쪽 다리에 체중이 실린다
  if (f.headMove.x > CFG.slipDist * 0.6) f.slipLoad.rear = 0.4;
  if (f.headMove.x < -CFG.slipDist * 0.6) f.slipLoad.lead = 0.4;

  // 가드
  f.guardHeld = input.guard;
  f.guardTight += ((input.guard ? 1 : 0) - f.guardTight) * Math.min(1, dt * 20);
  const gs = input.guard ? input.guardStick : { x: 0, y: 0 };
  f.guardShift.x += (gs.x - f.guardShift.x) * Math.min(1, dt * 15);
  f.guardShift.y += (gs.y - f.guardShift.y) * Math.min(1, dt * 15);

  // 주먹 출발 (누르는 순간, 지연 0)
  for (const s of HANDS) {
    const h = f.hands[s];
    const pressed = input[s] && !f.prevIn[s];
    const canGo = h.phase === 'idle' || (h.phase === 'retract' && h.t / h.retractDur > 0.4);
    if (pressed && canGo && f.stamina > 0) launch(f, opp, s, input, now);
  }

  // 몸통 회전
  let tw = 0;
  for (const s of HANDS) {
    const h = f.hands[s];
    if (h.phase === 'windup') tw += -0.3 * h.twist * h.windupW * CFG.windupVisual;
    else if (h.phase === 'flight') tw += h.twist * clamp(h.t / h.dur, 0, 1) * (h.feint ? 0.5 : 1);
    else if (h.phase === 'retract') tw += h.twist * (1 - clamp(h.t / h.retractDur, 0, 1)) * 0.6;
  }
  f.twist += (clamp(tw, -1, 1) - f.twist) * Math.min(1, dt * 25);

  // 상체 싣기: 치는 동안 가슴과 머리가 앞으로 나간다 (그만큼 카운터에도 노출된다)
  let pl = 0;
  for (const s of HANDS) {
    const h = f.hands[s];
    if (h.phase === 'flight') pl = Math.max(pl, (0.05 + 0.07 * h.weight) * clamp(h.t / h.dur, 0, 1) * (h.feint ? 0.4 : 1));
  }
  f.punchLean += (pl - f.punchLean) * Math.min(1, dt * 20);

  for (const s of HANDS) {
    const h = f.hands[s];
    h.prevWorld = h.fistWorld;
    updateHand(f, opp, h, input, dt, now, events);
    h.fistWorld = toWorld(h.fist, f.pos, f.yaw);
  }

  // 스태미나
  if (!isPunching(f)) f.stamina += CFG.staminaRegen * dt;
  f.stamina = clamp(f.stamina, 0, f.staminaMax);

  f.prevIn.lead = input.lead;
  f.prevIn.rear = input.rear;
  f.prevIn.guard = input.guard;
}

function updateSprings(f, dt) {
  springStep(f.hs.x, 150, 13, dt);
  springStep(f.hs.y, 150, 13, dt);
  springStep(f.hs.z, 150, 13, dt);
  springStep(f.hr.yaw, 110, 9, dt);
  springStep(f.hr.pitch, 110, 9, dt);
  springStep(f.hr.roll, 110, 9, dt);
  springStep(f.bodyBend, 60, 8, dt);
  f.hs.x.x = clamp(f.hs.x.x, -0.2, 0.2);
  f.hs.y.x = clamp(f.hs.y.x, -0.2, 0.2);
  f.hs.z.x = clamp(f.hs.z.x, -0.2, 0.2);
  f.hr.yaw.x = clamp(f.hr.yaw.x, -1.2, 1.2);
  f.hr.pitch.x = clamp(f.hr.pitch.x, -1.0, 1.0);
  f.hr.roll.x = clamp(f.hr.roll.x, -0.8, 0.8);
}

function updateFeet(f, dt) {
  for (const s of HANDS) {
    const ft = f.feet[s];
    const st = s === 'lead' ? ANAT.footLead : ANAT.footRear;
    const ideal = toWorld(v3(st.x, 0, st.z), f.pos, f.yaw);
    if (ft.t >= 1) {
      const other = f.feet[s === 'lead' ? 'rear' : 'lead'];
      const off = Math.hypot(ideal.x - ft.p.x, ideal.z - ft.p.z);
      if ((off > 0.14 && other.t >= 1) || off > 0.35) {
        ft.from = copy(ft.p);
        ft.to = v3(ideal.x + f.vel.x * 0.08, 0, ideal.z + f.vel.z * 0.08);
        ft.t = 0;
      }
    }
    if (ft.t < 1) {
      ft.t = Math.min(1, ft.t + dt / 0.13);
      ft.p = lerpV(ft.from, ft.to, ft.t);
      ft.lift = Math.sin(ft.t * Math.PI) * 0.06;
    } else ft.lift = 0;
    if (f.feet._init !== true) { ft.p = ideal; ft.t = 1; }
  }
  f.feet._init = true;
}

function updateDownState(f, dt, events) {
  if (f.state === 'down' && f.stateT >= f.downDur) {
    f.state = 'rising';
    f.stateT = 0;
  } else if (f.state === 'rising' && f.stateT >= 0.7) {
    f.state = 'fight';
    f.stateT = 0;
    f.rockedT = 1.2;
    f.balance.x = f.balance.z = 0;
    events.push({ type: 'rise', f: f.id });
  }
}

export function knockDown(f, events, cause) {
  if (f.state !== 'fight') return;
  f.downs++;
  f.state = 'down';
  f.stateT = 0;
  f.pendingDownT = -1;
  f.downDur = lerp(CFG.getUpMin, CFG.getUpMax, clamp(f.headDmg / 120, 0, 1));
  events.push({ type: 'down', f: f.id, cause, tko: f.downs >= CFG.downsForTKO });
}

export function knockOut(f, events) {
  f.state = 'ko';
  f.stateT = 0;
  events.push({ type: 'ko', f: f.id });
}

// 판정용 충돌체 (월드 좌표)
export function colliders(f) {
  const W = (p) => toWorld(p, f.pos, f.yaw);
  const list = [];
  for (const s of HANDS) {
    const h = f.hands[s];
    const sh = shoulderPos(f, s);
    const arm = solveArm(sh, h.fist, ANAT.upperArm, ANAT.foreArm, v3(s === 'lead' ? -0.4 : 0.4, -1, -0.2));
    const punching = h.phase === 'flight' && !h.feint;
    list.push({ kind: 'glove', side: s, a: W(h.fist), r: ANAT.gloveR, guard: !punching });
    list.push({ kind: 'forearm', side: s, a: W(arm.elbow), b: W(h.fist), r: ANAT.forearmR, guard: !punching });
  }
  list.push({ kind: 'head', a: W(headPos(f)), r: ANAT.headR });
  const pelvis = v3(0, ANAT.pelvisH - levelY(f) + 0.08, 0);
  list.push({ kind: 'body', a: W(pelvis), b: W(chestPos(f)), r: ANAT.torsoR });
  return list;
}

// 렌더링과 리플레이에 쓰는 스냅샷 (월드 좌표, 순수 데이터)
export function renderState(f) {
  const W = (p) => toWorld(p, f.pos, f.yaw);
  const lvl = levelY(f);
  const pelvisL = v3(f.balance.x * 0.05, ANAT.pelvisH - lvl, f.balance.z * 0.05);
  const arms = {};
  for (const s of HANDS) {
    const h = f.hands[s];
    const sh = shoulderPos(f, s);
    const arm = solveArm(sh, h.fist, ANAT.upperArm, ANAT.foreArm, v3(s === 'lead' ? -0.4 : 0.4, -1, -0.2));
    arms[s] = { shoulder: W(arm.shoulder), elbow: W(arm.elbow), fist: W(h.fist) };
  }
  const hp = headPos(f);
  const tYaw = torsoYaw(f);
  let st = {
    id: f.id,
    yaw: f.yaw,
    pelvis: W(pelvisL),
    chest: W(chestPos(f)),
    head: W(hp),
    headRot: { yaw: f.yaw + tYaw * 0.4 + f.hr.yaw.x, pitch: f.hr.pitch.x + f.headMove.y * -0.8, roll: f.hr.roll.x + f.headMove.x * -1.2 },
    torsoYaw: f.yaw + tYaw,
    bend: f.bodyBend.x,
    hips: {
      lead: W(add(pelvisL, rotY(v3(-ANAT.hipHalf, 0, 0), tYaw * 0.5))),
      rear: W(add(pelvisL, rotY(v3(ANAT.hipHalf, 0, 0), tYaw * 0.5))),
    },
    feet: {
      lead: v3(f.feet.lead.p.x, f.feet.lead.lift, f.feet.lead.p.z),
      rear: v3(f.feet.rear.p.x, f.feet.rear.lift, f.feet.rear.p.z),
    },
    arms,
    rocked: f.rockedT > 0,
    tired: tired(f),
    state: f.state,
    fall: 0,
  };
  if (f.state !== 'fight') st = fallenPose(f, st);
  return st;
}

function fallenPose(f, st) {
  // 다운: 뒤로 쓰러진 자세로 보간
  let k;
  if (f.state === 'down' || f.state === 'ko') k = smooth01(f.stateT / (f.state === 'ko' ? 0.45 : 0.6));
  else k = 1 - smooth01(f.stateT / 0.7);
  const back = rotY(v3(0, 0, -1), f.yaw);
  const side = rotY(v3(1, 0, 0), f.yaw);
  const base = v3((st.feet.lead.x + st.feet.rear.x) / 2, 0, (st.feet.lead.z + st.feet.rear.z) / 2);
  const pelvisD = add(base, add(scale(back, 0.35), v3(0, 0.16, 0)));
  const chestD = add(pelvisD, add(scale(back, 0.5), v3(0, 0.05, 0)));
  const headD = add(chestD, add(scale(back, 0.28), v3(0, 0.02, 0)));
  const mix = (a, b) => lerpV(a, b, k);
  const out = { ...st, fall: k };
  out.pelvis = mix(st.pelvis, pelvisD);
  out.chest = mix(st.chest, chestD);
  out.head = mix(st.head, headD);
  out.hips = { lead: mix(st.hips.lead, add(pelvisD, scale(side, -0.1))), rear: mix(st.hips.rear, add(pelvisD, scale(side, 0.1))) };
  out.headRot = { ...st.headRot, pitch: lerp(st.headRot.pitch, -1.2, k) };
  const arms = {};
  for (const s of HANDS) {
    const sgn = s === 'lead' ? -1 : 1;
    const sh = mix(st.arms[s].shoulder, add(chestD, scale(side, 0.2 * sgn)));
    const fist = mix(st.arms[s].fist, add(add(chestD, scale(side, 0.55 * sgn)), v3(0, -0.02, 0)));
    const el = mix(st.arms[s].elbow, lerpV(sh, fist, 0.5));
    arms[s] = { shoulder: sh, elbow: el, fist };
  }
  out.arms = arms;
  return out;
}

const smooth01 = (t) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

export { HANDS, trajectoryShape };
