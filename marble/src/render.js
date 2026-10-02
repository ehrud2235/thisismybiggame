// 캔버스 2D 렌더링. 시뮬 상태를 받아서 그리기만 한다.
// 원목 판(바닥·테두리·블록·말뚝·상감 원)은 한 번만 구워 두고(layer), 매 프레임 구슬과 조준만 그린다.
// 판 바깥은 우주. 세로 화면에서는 판을 90° 돌려서 꽉 채운다.

import { BOARD } from './stages.js';
import { plankCorners, goalContact } from './physics.js';
import { rng, makeFloor, makeWalnut, makeEndGrain, makeSpace } from './wood.js';

const TAU = Math.PI * 2;
const FRAME = 26;                 // 호두나무 테두리 두께 (판 좌표)
const MARGIN = 70;                // 판 그림자가 번지는 여백
const HUD_W = 130;                // 오른쪽 위 HUD 폭 (CSS px). 판과 겹치면 위 여백을 늘린다
const LIGHT = [-0.6, -0.8];       // 빛은 왼쪽 위에서

const MARBLE = {
  player: { light: '#d6e6ff', base: '#3a7be0', deep: '#0d2a63', vane: '#ff9b4a', tint: '90, 150, 255' },
  green: { light: '#d8f7e0', base: '#36a060', deep: '#0d4325', vane: '#f6f1e2', tint: '90, 220, 140' },
  amber: { light: '#fff0d2', base: '#e0952f', deep: '#6b3409', vane: '#fff6dc', tint: '255, 180, 80' },
};
const INK = '38, 22, 10';         // 판 위에 그리는 조준선 색

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.layer = null;
    this.layerK = 0;
    this.layerStage = null;
    this.space = null;
    this.trails = new Map();
    this.particles = [];
    this.shake = 0;
    this.time = 0;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    this.canvas.width = Math.round(cw * dpr);
    this.canvas.height = Math.round(ch * dpr);
    this.dpr = dpr;
    const W = BOARD.w + FRAME * 2, H = BOARD.h + FRAME * 2;
    const fit = (top, bottom) => {
      const aw = cw - 32, ah = ch - top - bottom;
      const land = Math.min(aw / W, ah / H), port = Math.min(aw / H, ah / W);
      const rot = port > land * 1.15 ? Math.PI / 2 : 0;
      const scale = Math.max(0.05, rot ? port : land);
      const side = (cw - (rot ? H : W) * scale) / 2;
      return { rot, scale, side, cy: top + ah / 2 };
    };
    let f = fit(24, 44);
    if (f.side < HUD_W) f = fit(104, 44);  // 오른쪽 위 HUD와 겹치면 판을 아래로
    this.rot = f.rot;
    this.scale = f.scale;
    this.cx = cw / 2;
    this.cy = f.cy;
    this.space = makeSpace(this.canvas.width, this.canvas.height, dpr);
  }

  // 화면에서 끈 벡터(CSS px) → 판 좌표 벡터
  screenVecToWorld(dx, dy) {
    const c = Math.cos(-this.rot), s = Math.sin(-this.rot);
    return [(dx * c - dy * s) / this.scale, (dx * s + dy * c) / this.scale];
  }

  reset() {
    this.trails.clear();
    this.particles.length = 0;
  }

  impact(e) {
    const n = Math.min(8, Math.floor(e.power / 140));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, sp = 40 + Math.random() * 160;
      this.particles.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 0.22, size: 1.5 });
    }
  }

  bump(power) {
    if (!this.reduced && power > 500) this.shake = Math.min(6, this.shake + power / 400);
  }

  draw(world, ui, dt) {
    const { ctx, canvas } = this;
    this.time += dt;
    const needK = Math.min(1.75, Math.max(1, this.scale * this.dpr));
    if (!this.layer || this.layerStage !== world.stage || needK > this.layerK * 1.25) this.bake(world.stage, needK);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.space, 0, 0);

    const sh = this.shake;
    this.shake = Math.max(0, sh - dt * 30);
    const ox = sh ? (Math.random() - 0.5) * sh : 0, oy = sh ? (Math.random() - 0.5) * sh : 0;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.translate(this.cx + ox, this.cy + oy);
    ctx.rotate(this.rot);
    ctx.scale(this.scale, this.scale);
    ctx.translate(-BOARD.w / 2, -BOARD.h / 2);

    const E = FRAME + MARGIN;
    ctx.drawImage(this.layer, -E, -E, BOARD.w + E * 2, BOARD.h + E * 2);

    this.drawGoalState(world);
    this.drawTrails(world);
    if (ui.aim && ui.guide) this.drawGuide(world, ui.guide);
    for (const b of world.marbles) this.drawShadow(b);
    for (const b of world.marbles) this.drawMarble(b);
    this.drawParticles(dt);
    if (world.phase === 'aim') {
      if (ui.aim) this.drawAim(world.player, ui.aim);
      else this.drawIdle(world.player);
    }
  }

  // ---------- 원목 판 굽기 ----------
  bake(stage, K) {
    const { w, h } = BOARD, E = FRAME + MARGIN;
    const cv = document.createElement('canvas');
    cv.width = Math.ceil((w + E * 2) * K);
    cv.height = Math.ceil((h + E * 2) * K);
    const g = cv.getContext('2d');
    g.scale(K, K);
    g.translate(E, E);
    const rand = rng(stage.id * 977 + 13);
    const walnut = makeWalnut(1100, 44, K, 77);
    const walnutPat = g.createPattern(walnut, 'repeat');
    walnutPat.setTransform(new DOMMatrix().scale(1 / K));

    // 판이 우주에 떠 있는 그림자
    g.save();
    g.filter = `blur(${28 * K}px)`;
    g.fillStyle = 'rgba(0, 0, 0, 0.75)';
    g.beginPath(); g.roundRect(-FRAME + 10, -FRAME + 24, w + FRAME * 2 - 20, h + FRAME * 2, 14); g.fill();
    g.restore();

    this.bakeFrame(g, walnut, K, rand);
    g.drawImage(makeFloor(w, h, K, 1234 + stage.id), 0, 0, w, h);
    this.bakeFloorLight(g);
    this.bakeInlay(g, stage, walnutPat);
    for (const p of stage.walls) this.bakeBlock(g, p, walnut, K, rand);
    stage.posts.forEach((p, i) => this.bakePeg(g, p, K, 300 + i));

    this.layer = cv;
    this.layerK = K;
    this.layerStage = stage;
  }

  bakeFrame(g, walnut, K, rand) {
    const { w, h } = BOARD, F = FRAME;
    g.save();
    g.beginPath(); g.roundRect(-F, -F, w + F * 2, h + F * 2, 9); g.clip();
    // 네 변을 45° 맞춤으로. 각 변의 로컬 좌표: x는 변을 따라, y=0이 바깥 모서리, y=F가 안쪽 모서리
    const sides = [
      { poly: [[-F, -F], [w + F, -F], [w, 0], [0, 0]], tx: -F, ty: -F, rot: 0, len: w + F * 2, lit: true },
      { poly: [[w + F, -F], [w + F, h + F], [w, h], [w, 0]], tx: w + F, ty: -F, rot: Math.PI / 2, len: h + F * 2, lit: false },
      { poly: [[w + F, h + F], [-F, h + F], [0, h], [w, h]], tx: w + F, ty: h + F, rot: Math.PI, len: w + F * 2, lit: false },
      { poly: [[-F, h + F], [-F, -F], [0, 0], [0, h]], tx: -F, ty: h + F, rot: -Math.PI / 2, len: h + F * 2, lit: true },
    ];
    for (const s of sides) {
      g.save();
      g.beginPath();
      s.poly.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.clip();
      g.translate(s.tx, s.ty);
      g.rotate(s.rot);
      const sy = rand() * (44 - F);
      g.drawImage(walnut, 0, sy * K, s.len * K, F * K, 0, 0, s.len, F);
      // 바깥 모서리: 왼쪽·위 변은 빛을 받고, 오른쪽·아래 변은 어둡다. 안쪽 모서리는 반대
      const outer = g.createLinearGradient(0, 0, 0, 6);
      outer.addColorStop(0, s.lit ? 'rgba(255, 236, 205, 0.32)' : 'rgba(0, 0, 0, 0.45)');
      outer.addColorStop(1, 'rgba(0, 0, 0, 0)');
      g.fillStyle = outer;
      g.fillRect(0, 0, s.len, 6);
      const inner = g.createLinearGradient(0, F, 0, F - 4);
      inner.addColorStop(0, s.lit ? 'rgba(0, 0, 0, 0.5)' : 'rgba(255, 236, 205, 0.35)');
      inner.addColorStop(1, 'rgba(0, 0, 0, 0)');
      g.fillStyle = inner;
      g.fillRect(0, F - 4, s.len, 4);
      const sheen = g.createLinearGradient(0, 0, 0, F);
      sheen.addColorStop(0.2, 'rgba(255, 255, 255, 0)');
      sheen.addColorStop(0.45, 'rgba(255, 245, 225, 0.07)');
      sheen.addColorStop(0.7, 'rgba(255, 255, 255, 0)');
      g.fillStyle = sheen;
      g.fillRect(0, 0, s.len, F);
      g.restore();
    }
    // 모서리 이음선
    g.strokeStyle = 'rgba(20, 10, 4, 0.7)';
    g.lineWidth = 0.9;
    for (const [x0, y0, x1, y1] of [[-F, -F, 0, 0], [w + F, -F, w, 0], [w + F, h + F, w, h], [-F, h + F, 0, h]]) {
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    }
    g.restore();
  }

  bakeFloorLight(g) {
    const { w, h } = BOARD;
    g.save();
    g.beginPath(); g.rect(0, 0, w, h); g.clip();
    // 바니시 광택과 가장자리 어둠
    const gloss = g.createRadialGradient(w * 0.28, h * 0.22, 0, w * 0.28, h * 0.22, w * 0.75);
    gloss.addColorStop(0, 'rgba(255, 250, 235, 0.16)');
    gloss.addColorStop(1, 'rgba(255, 250, 235, 0)');
    g.fillStyle = gloss;
    g.fillRect(0, 0, w, h);
    const vig = g.createRadialGradient(w / 2, h / 2, h * 0.45, w / 2, h / 2, w * 0.7);
    vig.addColorStop(0, 'rgba(70, 35, 10, 0)');
    vig.addColorStop(1, 'rgba(70, 35, 10, 0.22)');
    g.fillStyle = vig;
    g.fillRect(0, 0, w, h);
    // 테두리가 바닥에 드리운 그림자: 빛이 왼쪽 위라 위·왼쪽이 넓다
    const edge = (x0, y0, x1, y1, a, rect) => {
      const grad = g.createLinearGradient(x0, y0, x1, y1);
      grad.addColorStop(0, `rgba(40, 20, 6, ${a})`);
      grad.addColorStop(1, 'rgba(40, 20, 6, 0)');
      g.fillStyle = grad;
      g.fillRect(...rect);
    };
    edge(0, 0, 0, 18, 0.45, [0, 0, w, 18]);
    edge(0, 0, 14, 0, 0.4, [0, 0, 14, h]);
    edge(w, 0, w - 5, 0, 0.22, [w - 5, 0, 5, h]);
    edge(0, h, 0, h - 5, 0.22, [0, h - 5, w, 5]);
    g.restore();
  }

  // 목표 원: 호두나무 링 상감. 안쪽 가는 선 안에 구슬 중심이 멈추면 완전 골인
  bakeInlay(g, stage, walnutPat) {
    const goal = stage.goal;
    const ring = (r, width) => {
      g.strokeStyle = walnutPat;
      g.lineWidth = width;
      g.beginPath(); g.arc(goal.x, goal.y, r, 0, TAU); g.stroke();
      g.strokeStyle = 'rgba(30, 14, 4, 0.55)';
      g.lineWidth = 0.7;
      for (const e of [-width / 2, width / 2]) { g.beginPath(); g.arc(goal.x, goal.y, r + e, 0, TAU); g.stroke(); }
    };
    ring(goal.r - 4, 8);
    ring(goal.r - stage.marbleR, 1.6);
    g.fillStyle = walnutPat;
    g.beginPath(); g.arc(goal.x, goal.y, 3.5, 0, TAU); g.fill();
    const s = stage.marbles[0];
    g.strokeStyle = walnutPat;
    g.lineWidth = 2;
    g.beginPath(); g.arc(s.x, s.y, stage.marbleR + 7, 0, TAU); g.stroke();
  }

  bakeBlock(g, p, walnut, K, rand) {
    const pts = plankCorners(p);
    const path = () => {
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
    };
    g.save();
    g.translate(5, 8);
    g.filter = `blur(${5 * K}px)`;
    g.fillStyle = 'rgba(40, 18, 4, 0.5)';
    path(); g.fill();
    g.restore();

    const a = (p.deg * Math.PI) / 180;
    g.save();
    g.translate(p.cx, p.cy);
    g.rotate(a);
    const hl = p.len / 2, ht = p.thick / 2;
    g.beginPath(); g.roundRect(-hl, -ht, p.len, p.thick, 2.5); g.clip();
    const sx = rand() * (1100 - p.len), sy = rand() * (44 - p.thick);
    g.drawImage(walnut, sx * K, sy * K, p.len * K, p.thick * K, -hl, -ht, p.len, p.thick);
    // 모서리 베벨: 빛을 향한 면은 밝게, 반대 면은 어둡게
    const edges = [[0, -1, -hl, -ht, p.len, 3], [0, 1, -hl, ht - 3, p.len, 3], [-1, 0, -hl, -ht, 3, p.thick], [1, 0, hl - 3, -ht, 3, p.thick]];
    for (const [nx, ny, x, y, ew, eh] of edges) {
      const wx = nx * Math.cos(a) - ny * Math.sin(a), wy = nx * Math.sin(a) + ny * Math.cos(a);
      const dot = wx * LIGHT[0] + wy * LIGHT[1];
      const grad = g.createLinearGradient(x + (nx > 0 ? ew : 0), y + (ny > 0 ? eh : 0), x + (nx < 0 ? ew : 0), y + (ny < 0 ? eh : 0));
      grad.addColorStop(0, dot > 0 ? `rgba(255, 236, 205, ${0.4 * dot})` : `rgba(0, 0, 0, ${-0.55 * dot})`);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      g.fillStyle = grad;
      g.fillRect(x, y, ew, eh);
    }
    const sheen = g.createLinearGradient(0, -ht, 0, ht);
    sheen.addColorStop(0.3, 'rgba(255, 255, 255, 0)');
    sheen.addColorStop(0.5, 'rgba(255, 245, 225, 0.08)');
    sheen.addColorStop(0.7, 'rgba(255, 255, 255, 0)');
    g.fillStyle = sheen;
    g.fillRect(-hl, -ht, p.len, p.thick);
    g.restore();
    path();
    g.strokeStyle = 'rgba(25, 12, 4, 0.6)';
    g.lineWidth = 0.8;
    g.stroke();
  }

  bakePeg(g, p, K, seed) {
    g.save();
    g.filter = `blur(${4 * K}px)`;
    g.fillStyle = 'rgba(40, 18, 4, 0.5)';
    g.beginPath(); g.arc(p.x + 4, p.y + 7, p.r, 0, TAU); g.fill();
    g.restore();
    g.save();
    g.beginPath(); g.arc(p.x, p.y, p.r, 0, TAU); g.clip();
    g.drawImage(makeEndGrain(p.r, K, seed), p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    g.restore();
    const rim = g.createLinearGradient(p.x - p.r * 0.7, p.y - p.r * 0.7, p.x + p.r * 0.7, p.y + p.r * 0.7);
    rim.addColorStop(0, 'rgba(255, 236, 205, 0.5)');
    rim.addColorStop(0.5, 'rgba(255, 236, 205, 0)');
    rim.addColorStop(1, 'rgba(0, 0, 0, 0.5)');
    g.strokeStyle = rim;
    g.lineWidth = 2.5;
    g.beginPath(); g.arc(p.x, p.y, p.r - 1.25, 0, TAU); g.stroke();
    g.strokeStyle = 'rgba(25, 12, 4, 0.6)';
    g.lineWidth = 0.8;
    g.beginPath(); g.arc(p.x, p.y, p.r, 0, TAU); g.stroke();
  }

  // ---------- 매 프레임 ----------
  drawGoalState(world) {
    const contact = goalContact(world);
    if (!contact) return;
    const { ctx } = this, g = world.stage.goal;
    const pulse = this.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(this.time * 6);
    const a = (contact === 'inside' ? 0.5 : 0.3) + pulse * 0.25;
    ctx.save();
    ctx.shadowColor = `rgba(255, 190, 90, ${a})`;
    ctx.shadowBlur = 18 * this.scale * this.dpr;
    ctx.strokeStyle = `rgba(255, 200, 110, ${a})`;
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(g.x, g.y, g.r - 4, 0, TAU); ctx.stroke();
    ctx.restore();
  }

  drawTrails(world) {
    const { ctx } = this;
    ctx.lineCap = 'round';
    for (const b of world.marbles) {
      let tr = this.trails.get(b.id);
      if (!tr) { tr = []; this.trails.set(b.id, tr); }
      if (Math.hypot(b.vx, b.vy) > 160) tr.push(b.x, b.y);
      else if (tr.length) tr.splice(0, 2);
      while (tr.length > 20) tr.splice(0, 2);
      for (let i = 2; i < tr.length; i += 2) {
        const t = i / tr.length;
        ctx.strokeStyle = `rgba(255, 252, 240, ${t * 0.3})`;
        ctx.lineWidth = b.r * 1.4 * t;
        ctx.beginPath(); ctx.moveTo(tr[i - 2], tr[i - 1]); ctx.lineTo(tr[i], tr[i + 1]); ctx.stroke();
      }
    }
  }

  drawGuide(world, pts) {
    const { ctx } = this;
    let total = 0;
    for (let i = 2; i < pts.length; i += 2) total += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    if (total < 1) return;
    const gap = 14;
    let next = world.player.r + 8, walked = 0;
    for (let i = 2; i < pts.length; i += 2) {
      const x0 = pts[i - 2], y0 = pts[i - 1], x1 = pts[i], y1 = pts[i + 1];
      const seg = Math.hypot(x1 - x0, y1 - y0);
      while (seg > 0 && next <= walked + seg) {
        const t = (next - walked) / seg;
        ctx.fillStyle = `rgba(${INK}, ${0.7 * (1 - next / (total + gap))})`;
        ctx.beginPath(); ctx.arc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 2.4, 0, TAU); ctx.fill();
        next += gap;
      }
      walked += seg;
    }
    ctx.strokeStyle = `rgba(${INK}, 0.35)`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(pts[pts.length - 2], pts[pts.length - 1], world.player.r, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
  }

  drawShadow(b) {
    const { ctx } = this;
    const col = MARBLE[b.kind] || MARBLE.green;
    const sx = b.x + 4, sy = b.y + 6;
    const sh = ctx.createRadialGradient(sx, sy, b.r * 0.2, sx, sy, b.r * 1.25);
    sh.addColorStop(0, 'rgba(40, 18, 4, 0.5)');
    sh.addColorStop(1, 'rgba(40, 18, 4, 0)');
    ctx.fillStyle = sh;
    ctx.beginPath(); ctx.arc(sx, sy, b.r * 1.25, 0, TAU); ctx.fill();
    // 유리를 통과한 빛이 그림자 안에 모인다
    const cx = b.x + 2.5, cy = b.y + 3.5;
    const ca = ctx.createRadialGradient(cx, cy, 0, cx, cy, b.r * 0.55);
    ca.addColorStop(0, `rgba(${col.tint}, 0.55)`);
    ca.addColorStop(1, `rgba(${col.tint}, 0)`);
    ctx.fillStyle = ca;
    ctx.beginPath(); ctx.arc(cx, cy, b.r * 0.55, 0, TAU); ctx.fill();
  }

  // 유리구슬: 몸통 그라데이션 + 안쪽 무늬(굴러간 거리만큼 돈다) + 고정된 반사광
  drawMarble(b) {
    const { ctx } = this;
    const col = MARBLE[b.kind] || MARBLE.green;
    const r = b.r;
    const body = ctx.createRadialGradient(b.x - r * 0.35, b.y - r * 0.4, r * 0.1, b.x, b.y, r);
    body.addColorStop(0, col.light);
    body.addColorStop(0.5, col.base);
    body.addColorStop(1, col.deep);
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, TAU); ctx.fill();

    ctx.save();
    ctx.beginPath(); ctx.arc(b.x, b.y, r * 0.9, 0, TAU); ctx.clip();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.roll / r * 0.5 + b.id * 2.1);
    ctx.fillStyle = col.vane;
    ctx.globalAlpha = 0.85;
    for (const s of [1, -1]) {
      ctx.beginPath();
      ctx.moveTo(-r * 0.95, 0);
      ctx.bezierCurveTo(-r * 0.4, -r * 0.55 * s, r * 0.3, r * 0.35 * s, r * 0.95, 0);
      ctx.bezierCurveTo(r * 0.3, r * 0.15 * s, -r * 0.4, -r * 0.3 * s, -r * 0.95, 0);
      ctx.fill();
    }
    ctx.restore();

    // 가장자리 굴절로 어두운 테
    const rim = ctx.createRadialGradient(b.x, b.y, r * 0.7, b.x, b.y, r);
    rim.addColorStop(0, 'rgba(0, 0, 20, 0)');
    rim.addColorStop(1, 'rgba(0, 0, 20, 0.35)');
    ctx.fillStyle = rim;
    ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.beginPath(); ctx.ellipse(b.x - r * 0.36, b.y - r * 0.42, r * 0.3, r * 0.16, -0.6, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.beginPath(); ctx.arc(b.x + r * 0.42, b.y + r * 0.44, r * 0.13, 0, TAU); ctx.fill();
  }

  drawParticles(dt) {
    const { ctx } = this;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.max) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      const t = 1 - p.life / p.max;
      ctx.fillStyle = `rgba(255, 252, 240, ${t})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
    }
  }

  drawIdle(b) {
    if (this.reduced) return;
    const { ctx } = this;
    const t = (this.time % 1.6) / 1.6;
    ctx.strokeStyle = `rgba(${INK}, ${0.45 * (1 - t)})`;
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 5 + t * 14, 0, TAU); ctx.stroke();
  }

  drawAim(b, aim) {
    const { ctx } = this;
    const ux = Math.cos(aim.angle), uy = Math.sin(aim.angle);
    // 고무줄: 쏘는 방향의 반대로 당겨진다
    const pull = b.r + 10 + aim.power * 70;
    ctx.strokeStyle = `rgba(${INK}, 0.45)`;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(b.x - ux * b.r, b.y - uy * b.r); ctx.lineTo(b.x - ux * pull, b.y - uy * pull); ctx.stroke();
    ctx.fillStyle = `rgba(${INK}, 0.6)`;
    ctx.beginPath(); ctx.arc(b.x - ux * pull, b.y - uy * pull, 4.5, 0, TAU); ctx.fill();
    // 힘 링: 노랑 → 주황
    const p = aim.power;
    ctx.strokeStyle = `rgba(${INK}, 0.3)`;
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 9, 0, TAU); ctx.stroke();
    ctx.strokeStyle = `rgb(255, ${Math.round(196 - 90 * p)}, ${Math.round(80 - 40 * p)})`;
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 9, -Math.PI / 2, -Math.PI / 2 + TAU * p); ctx.stroke();
  }
}
