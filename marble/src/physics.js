// 구슬판 시뮬레이션. 고정 틱(120Hz), 난수를 쓰지 않는다 → 같은 샷이면 같은 결과.
// 렌더와 분리돼 있어서 Node에서 그대로 돌릴 수 있다 (tools/simtest.mjs).

import { CFG } from './config.js';
import { BOARD } from './stages.js';

export const DT = 1 / 120;
const MAX_MOVE = 0.35;              // 서브스텝 한 번에 반지름의 이 비율까지만 움직인다 (벽 뚫림 방지)
const MAX_ROLL_TICKS = 20 / DT;     // 안전장치: 20초 넘게 구르면 강제로 멈춘다

export function createWorld(stage) {
  const marbles = stage.marbles.map((m, i) => ({
    id: i, kind: m.kind,
    x: m.x, y: m.y, vx: 0, vy: 0,
    r: m.r ?? stage.marbleR, m: m.mass ?? 1,
    roll: 0,                        // 굴러간 거리. 렌더에서 무늬 회전에 쓴다
  }));
  return {
    stage,
    segs: buildSegments(stage),
    marbles,
    player: marbles[0],
    phase: 'aim',                   // aim | roll | clear | fail
    shots: 0,
    rollTicks: 0,
    tick: 0,
    events: [],
    result: null,
  };
}

// 블록 네 꼭짓점 (렌더도 같은 걸 쓴다)
export function plankCorners(p) {
  const a = (p.deg * Math.PI) / 180;
  const ux = Math.cos(a), uy = Math.sin(a);
  const hx = (p.len / 2), hy = (p.thick / 2);
  return [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(([lx, ly]) => [p.cx + lx * ux - ly * uy, p.cy + lx * uy + ly * ux]);
}

function buildSegments(stage) {
  const segs = [];
  const add = (ax, ay, bx, by) => {
    const ex = bx - ax, ey = by - ay;
    segs.push({ ax, ay, bx, by, ex, ey, len2: ex * ex + ey * ey });
  };
  const { w, h } = BOARD;
  add(0, 0, w, 0); add(w, 0, w, h); add(w, h, 0, h); add(0, h, 0, 0);
  for (const p of stage.walls) {
    const c = plankCorners(p);
    for (let i = 0; i < 4; i++) add(...c[i], ...c[(i + 1) % 4]);
  }
  return segs;
}

export function shoot(world, angle, power) {
  if (world.phase !== 'aim') return false;
  const p = Math.min(1, Math.max(0, power));
  if (p < CFG.minPower) return false;
  const v = CFG.maxSpeed * Math.pow(p, CFG.powerCurve);
  world.player.vx = Math.cos(angle) * v;
  world.player.vy = Math.sin(angle) * v;
  world.shots++;
  world.phase = 'roll';
  world.rollTicks = 0;
  return true;
}

export function stepWorld(world) {
  world.events = [];
  if (world.phase !== 'roll') return;
  world.tick++;
  world.rollTicks++;

  let vmax = 0, rmin = Infinity;
  for (const b of world.marbles) {
    vmax = Math.max(vmax, Math.hypot(b.vx, b.vy));
    rmin = Math.min(rmin, b.r);
  }
  const n = Math.max(1, Math.ceil((vmax * DT) / (rmin * MAX_MOVE)));
  const h = DT / n;

  for (let s = 0; s < n; s++) {
    for (const b of world.marbles) {
      b.x += b.vx * h;
      b.y += b.vy * h;
      rollFriction(b, h);
    }
    const ms = world.marbles;
    for (let i = 0; i < ms.length; i++) {
      for (let j = i + 1; j < ms.length; j++) collideMarbles(ms[i], ms[j], world.events);
    }
    for (const b of ms) {
      for (const sg of world.segs) collideSeg(b, sg, world.events);
      for (const p of world.stage.posts) collidePost(b, p, world.events);
    }
  }

  const resting = world.marbles.every((b) => b.vx === 0 && b.vy === 0);
  if (resting || world.rollTicks > MAX_ROLL_TICKS) settle(world);
}

function rollFriction(b, h) {
  const s = Math.hypot(b.vx, b.vy);
  if (s === 0) return;
  b.roll += s * h;
  const ns = s - (CFG.rollDecel + CFG.linearDamp * s) * h;
  if (ns < CFG.stopSpeed) { b.vx = 0; b.vy = 0; return; }
  const k = ns / s;
  b.vx *= k;
  b.vy *= k;
}

// 원 vs 선분. 가장 가까운 점에서 밀어내고, 법선 방향 속도만 반사한다
function collideSeg(b, sg, events) {
  let t = ((b.x - sg.ax) * sg.ex + (b.y - sg.ay) * sg.ey) / sg.len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = sg.ax + sg.ex * t, cy = sg.ay + sg.ey * t;
  const dx = b.x - cx, dy = b.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= b.r * b.r) return;
  const d = Math.sqrt(d2);
  if (d === 0) return;
  const nx = dx / d, ny = dy / d;
  b.x += nx * (b.r - d);
  b.y += ny * (b.r - d);
  bounce(b, nx, ny, CFG.wallRestitution, CFG.wallFriction, 'wall', cx, cy, events);
}

function collidePost(b, p, events) {
  const dx = b.x - p.x, dy = b.y - p.y;
  const rr = b.r + p.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rr * rr) return;
  const d = Math.sqrt(d2);
  if (d === 0) return;
  const nx = dx / d, ny = dy / d;
  b.x = p.x + nx * rr;
  b.y = p.y + ny * rr;
  bounce(b, nx, ny, CFG.postRestitution, 0, 'post', p.x + nx * p.r, p.y + ny * p.r, events);
}

function bounce(b, nx, ny, e, fr, type, cx, cy, events) {
  const vn = b.vx * nx + b.vy * ny;
  if (vn >= 0) return;
  const tx = -ny, ty = nx;
  const vt = (b.vx * tx + b.vy * ty) * (1 - fr);
  const out = -vn < CFG.bounceMin ? 0 : -vn * e;
  b.vx = nx * out + tx * vt;
  b.vy = ny * out + ty * vt;
  events.push({ type, x: cx, y: cy, power: -vn, id: b.id });
}

function collideMarbles(a, b, events) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const rr = a.r + b.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rr * rr) return;
  const d = Math.sqrt(d2);
  if (d === 0) return;
  const nx = dx / d, ny = dy / d;
  const ia = 1 / a.m, ib = 1 / b.m;
  const pen = (rr - d) / (ia + ib);
  a.x -= nx * pen * ia; a.y -= ny * pen * ia;
  b.x += nx * pen * ib; b.y += ny * pen * ib;
  const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rv >= 0) return;
  const j = (-(1 + CFG.marbleRestitution) * rv) / (ia + ib);
  a.vx -= j * nx * ia; a.vy -= j * ny * ia;
  b.vx += j * nx * ib; b.vy += j * ny * ib;
  events.push({ type: 'marble', x: a.x + nx * a.r, y: a.y + ny * a.r, power: -rv, id: a.id, other: b.id });
}

// 구슬과 목표 원의 관계: 'inside'(완전히 들어감) · 'touch'(걸침) · null
export function goalContact(world, b = world.player) {
  const g = world.stage.goal;
  const d = Math.hypot(b.x - g.x, b.y - g.y);
  if (d + b.r <= g.r) return 'inside';
  if (d < g.r + b.r) return 'touch';
  return null;
}

function settle(world) {
  for (const b of world.marbles) { b.vx = 0; b.vy = 0; }
  const contact = goalContact(world);
  const need = world.stage.goal.need;
  const pass = contact === 'inside' || (contact === 'touch' && need === 'touch');
  if (pass) {
    const stars = 1 + (contact === 'inside' ? 1 : 0) + (world.shots === 1 ? 1 : 0);
    world.phase = 'clear';
    world.result = { pass, contact, shots: world.shots, stars };
  } else if (world.shots >= world.stage.shots) {
    world.phase = 'fail';
    world.result = { pass, contact, shots: world.shots, stars: 0 };
  } else {
    world.phase = 'aim';
  }
  world.events.push({ type: 'rest', contact });
}

function cloneWorld(world) {
  const marbles = world.marbles.map((b) => ({ ...b }));
  return { ...world, marbles, player: marbles[0], events: [], result: null };
}

// 조준선: 지금 상태에서 쏘면 플레이어 구슬이 어디로 가는지 seconds 초만큼 미리 돌려본다
export function predict(world, angle, power, seconds) {
  const g = cloneWorld(world);
  const pts = [g.player.x, g.player.y];
  if (!shoot(g, angle, power)) return pts;
  const ticks = Math.round(seconds / DT);
  for (let i = 0; i < ticks && g.phase === 'roll'; i++) {
    stepWorld(g);
    if (i % 2 === 1) pts.push(g.player.x, g.player.y);
  }
  return pts;
}

export function snapshot(world) {
  return {
    phase: world.phase, shots: world.shots, tick: world.tick,
    marbles: world.marbles.map((b) => [b.x, b.y, b.vx, b.vy].map((v) => Math.round(v * 1e6) / 1e6)),
  };
}
