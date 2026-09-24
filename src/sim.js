// 경기 전체 시뮬레이션. 고정 틱(60Hz), 입력 두 개만으로 진행된다.
// 난수를 쓰지 않으므로 같은 입력이면 같은 결과가 나온다 (온라인 롤백을 위한 전제).

import { CFG } from './config.js';
import { createFighter, updateFighter, renderState } from './fighter.js';
import { resolveHits, missLog } from './combat.js';

export const DT = 1 / 60;

export function createSim() {
  return {
    tick: 0,
    time: 0,
    clock: CFG.roundTime,
    phase: 'fight',          // fight | end
    result: null,
    hitstop: 0,
    fighters: [createFighter(0, 0, -0.7), createFighter(1, 0, 0.7)],
    events: [],
    log: [],
  };
}

export function stepSim(sim, inputs) {
  sim.events = [];
  if (sim.hitstop > 0) {
    sim.hitstop -= DT;
    return;
  }
  sim.tick++;
  sim.time += DT;
  const [a, b] = sim.fighters;

  // 한쪽이 다운되면 다른 쪽은 자동으로 물러난다
  a.forceRetreat = b.state !== 'fight' && distXZ(a, b) < 2.4 && a.state === 'fight';
  b.forceRetreat = a.state !== 'fight' && distXZ(a, b) < 2.4 && b.state === 'fight';

  const live = sim.phase === 'fight';
  updateFighter(a, b, live ? inputs[0] : IDLE, DT, sim.time, sim.events);
  updateFighter(b, a, live ? inputs[1] : IDLE, DT, sim.time, sim.events);

  if (live) {
    resolveHits(a, b, sim.time, sim.events, sim.log);
    resolveHits(b, a, sim.time, sim.events, sim.log);
  }

  for (const e of sim.events) {
    if (e.type === 'miss') {
      const f = sim.fighters[e.f];
      missLog(f, f.hands[e.side], sim.time, sim.log);
    }
  }

  separate(a, b);
  for (const f of sim.fighters) clampRing(f);

  // 히트스톱
  for (const e of sim.events) {
    if (e.type === 'hit') sim.hitstop = Math.max(sim.hitstop, e.clean ? CFG.hitstopClean : CFG.hitstopLight);
  }

  if (live) {
    sim.clock -= DT;
    for (const e of sim.events) {
      if (e.type === 'ko') end(sim, 1 - e.f, 'KO');
      if (e.type === 'down' && e.tko) end(sim, 1 - e.f, 'TKO');
    }
    if (sim.phase === 'fight' && sim.clock <= 0) {
      sim.clock = 0;
      const score = (f) => f.stats.headLanded * 2 + f.stats.bodyLanded;
      const sa = score(a), sb = score(b);
      end(sim, sa === sb ? -1 : sa > sb ? 0 : 1, '판정');
    }
  }
}

function end(sim, winner, how) {
  if (sim.phase === 'end') return;
  sim.phase = 'end';
  sim.result = { winner, how, time: CFG.roundTime - sim.clock };
  sim.events.push({ type: 'end', winner, how });
}

const IDLE = {
  move: { x: 0, y: 0 }, lead: false, rear: false, rearWeight: 0, stick: { x: 0, y: 0 },
  head: { x: 0, y: 0 }, guard: false, guardStick: { x: 0, y: 0 }, level: 0, feint: false,
};

const distXZ = (a, b) => Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);

function separate(a, b) {
  const d = distXZ(a, b);
  const min = CFG.minSeparation;
  if (d < min && d > 1e-6) {
    const push = (min - d) / 2;
    const nx = (a.pos.x - b.pos.x) / d, nz = (a.pos.z - b.pos.z) / d;
    a.pos.x += nx * push; a.pos.z += nz * push;
    b.pos.x -= nx * push; b.pos.z -= nz * push;
  }
}

function clampRing(f) {
  const r = CFG.ringRadius - 0.35;
  const d = Math.hypot(f.pos.x, f.pos.z);
  if (d > r) {
    f.pos.x *= r / d;
    f.pos.z *= r / d;
  }
}

export function snapshot(sim) {
  return sim.fighters.map(renderState);
}
