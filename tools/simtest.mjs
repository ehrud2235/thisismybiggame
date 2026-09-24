// 봇 대 봇으로 시뮬을 여러 판 돌려서 숫자가 말이 되는지 본다. 렌더 없이 Node에서 돈다.
//   node tools/simtest.mjs [판 수]

import { CFG } from '../src/config.js';
import { createSim, stepSim, snapshot } from '../src/sim.js';
import { Bot } from '../src/bot.js';

const N = parseInt(process.argv[2] || '30', 10);
const results = { KO: 0, TKO: 0, 판정: 0 };
const agg = { thrown: 0, landed: 0, blocked: 0, missed: 0, feints: 0, unseen: 0, flow: 0, downs: 0, rocked: 0, liver: 0 };
let durations = [];
let bad = 0;

// 결정성: 같은 입력이면 같은 결과
function runOnce(seedA, seedB, maxT) {
  const sim = createSim();
  const b1 = new Bot('spar', seedA), b2 = new Bot('spar', seedB);
  let ticks = 0;
  while (sim.phase === 'fight' && ticks < maxT * 60) {
    const [a, b] = sim.fighters;
    stepSim(sim, [b1.read(1 / 60, a, b), b2.read(1 / 60, b, a)]);
    ticks++;
  }
  return sim;
}

const d1 = runOnce(1, 2, 30), d2 = runOnce(1, 2, 30);
const same = JSON.stringify(snapshot(d1)) === JSON.stringify(snapshot(d2));
console.log(`결정성 (같은 입력 → 같은 상태): ${same ? '통과' : '실패'}`);

for (let i = 0; i < N; i++) {
  const sim = runOnce(100 + i * 7, 900 + i * 13, CFG.roundTime + 5);
  for (const f of sim.fighters) {
    for (const k of ['thrown', 'landed', 'blocked', 'missed', 'feints', 'unseen', 'flow']) agg[k] += f.stats[k];
    agg.downs += f.downs;
    const snap = JSON.stringify(snapshot(sim));
    if (snap.includes('NaN') || snap.includes('null')) bad++;
  }
  for (const l of sim.log) {
    if (l.result === 'rocked') agg.rocked++;
    if (l.result === 'liver') agg.liver++;
  }
  if (sim.result) { results[sim.result.how]++; durations.push(sim.result.time); }
}

const avg = (a) => (a.reduce((x, y) => x + y, 0) / Math.max(1, a.length));
console.log(`\n${N}판 결과: KO ${results.KO} · TKO ${results.TKO} · 판정 ${results['판정']}`);
console.log(`평균 경기 시간: ${avg(durations).toFixed(1)}초`);
console.log(`판당 평균: 던짐 ${(agg.thrown / N).toFixed(0)} · 적중 ${(agg.landed / N).toFixed(0)} · 막힘 ${(agg.blocked / N).toFixed(0)} · 헛침 ${(agg.missed / N).toFixed(0)}`);
console.log(`판당 평균: 페인트 ${(agg.feints / N).toFixed(1)} · 못 본 주먹 ${(agg.unseen / N).toFixed(1)} · 흐름 연결 ${(agg.flow / N).toFixed(1)}`);
console.log(`판당 평균: 흔들림 ${(agg.rocked / N).toFixed(2)} · 다운 ${(agg.downs / N).toFixed(2)} · 리버 ${(agg.liver / N).toFixed(2)}`);
console.log(`NaN/null 스냅샷: ${bad}`);
if (!same || bad) process.exit(1);
