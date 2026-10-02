// 스테이지 1을 렌더 없이 수천 번 쏴 보고 숫자가 말이 되는지 본다.
//   node marble/tools/simtest.mjs [각도 간격(도)]
// - 결정성: 같은 샷 → 같은 결과
// - 벽 뚫림: 구슬 중심이 판 밖이나 블록 안으로 들어가면 실패
// - 난이도: 한 번에 통과하는 샷이 전체 중 몇 %인가 (스테이지 설계 지표)

import { STAGES, BOARD } from '../src/stages.js';
import { createWorld, stepWorld, shoot, snapshot, plankCorners, DT } from '../src/physics.js';

const stage = STAGES[0];
const step = parseFloat(process.argv[2] || '1');
const planks = stage.walls.map(plankCorners);

function insidePoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function run(angle, power, check) {
  const w = createWorld(stage);
  shoot(w, angle, power);
  let bad = null, ticks = 0, maxV = 0;
  while (w.phase === 'roll') {
    stepWorld(w);
    ticks++;
    if (!check) continue;
    for (const b of w.marbles) {
      maxV = Math.max(maxV, Math.hypot(b.vx, b.vy));
      if (!Number.isFinite(b.x + b.y + b.vx + b.vy)) bad = 'NaN';
      else if (b.x < 0 || b.y < 0 || b.x > BOARD.w || b.y > BOARD.h) bad = '판 밖';
      else if (planks.some((p) => insidePoly(b.x, b.y, p))) bad = '블록 뚫림';
    }
  }
  return { w, ticks, bad, maxV };
}

// 결정성
const a = run(0.3, 0.8).w, b = run(0.3, 0.8).w;
const same = JSON.stringify(snapshot(a)) === JSON.stringify(snapshot(b));
console.log(`결정성 (같은 샷 → 같은 결과): ${same ? '통과' : '실패'}`);

let total = 0, touch = 0, inside = 0, bad = 0, fullTime = [], fullN = 0;
const hits = [];
for (let deg = 0; deg < 360; deg += step) {
  for (let p = 0.15; p <= 1.0001; p += 0.05) {
    const r = run((deg * Math.PI) / 180, p, true);
    total++;
    if (r.bad) { bad++; if (bad <= 5) console.log(`  문제: ${r.bad} @ ${deg}° · 힘 ${p.toFixed(2)}`); }
    if (r.w.result?.contact === 'inside') inside++;
    if (r.w.result?.pass) { touch++; hits.push(`${deg}°/${p.toFixed(2)}`); }
    if (p > 0.99) { fullTime.push(r.ticks * DT); fullN++; }
  }
}

const avg = (xs) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
console.log(`\n샷 ${total}개 (각도 ${step}° 간격 × 힘 0.15~1.0)`);
console.log(`한 번에 통과: ${touch}개 (${((touch / total) * 100).toFixed(2)}%) · 그중 완전 골인 ${inside}개`);
console.log(`최대 힘으로 쐈을 때 멈출 때까지: 평균 ${avg(fullTime).toFixed(2)}초 · 최장 ${Math.max(...fullTime).toFixed(2)}초`);
console.log(`통과 샷 예시: ${hits.slice(0, 12).join(', ')}${hits.length > 12 ? ' …' : ''}`);
console.log(`벽 뚫림 / NaN: ${bad}`);
if (!same || bad) process.exit(1);
