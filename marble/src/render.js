// 캔버스 2D 렌더링. 시뮬 상태를 받아서 그리기만 한다.
// 바닥·테두리·판자·분필 원은 한 번만 그려 두고(static layer), 매 프레임 구슬과 효과만 그린다.
// 세로 화면에서는 판을 90° 돌려서 꽉 채운다.

import { BOARD } from './stages.js';
import { plankCorners, goalContact } from './physics.js';

const TAU = Math.PI * 2;
const FRAME = 26;                       // 판 바깥 나무 테두리 두께 (판 좌표)
const HUD_TOP = 78, HUD_BOTTOM = 48, SIDE = 16; // HUD가 차지하는 화면 여백 (CSS px)

const C = {
  outside: '#2a1d13',
  dirt: '#b48e64', dirtDark: '#9a754d', dirtLight: '#caa77e',
  pebble: ['#8b7f70', '#a5978a', '#7a6c5e'],
  frame: '#6b4324', frameLight: '#86562f', frameDark: '#432812',
  plank: '#a46d3d', plankLight: '#c48c55', plankDark: '#5c3619',
  chalk: 'rgba(250, 247, 238, 0.86)',
  shadow: 'rgba(48, 26, 8, 0.32)',
};

const MARBLE = {
  player: { light: '#cfe1ff', base: '#3a7be0', deep: '#0f2c66', vane: '#ff8a3d' },
  green: { light: '#d4f5dc', base: '#3fa565', deep: '#0f4527', vane: '#f6f1e2' },
  amber: { light: '#ffeccb', base: '#e19633', deep: '#6e360a', vane: '#fff6dc' },
};

// 고정 시드 난수: 바닥 무늬가 새로고침해도 같다
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.layer = null;
    this.layerStage = null;
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
    const aw = cw - SIDE * 2, ah = ch - HUD_TOP - HUD_BOTTOM;
    const W = BOARD.w + FRAME * 2, H = BOARD.h + FRAME * 2;
    const land = Math.min(aw / W, ah / H), port = Math.min(aw / H, ah / W);
    this.rot = port > land * 1.15 ? Math.PI / 2 : 0;
    this.scale = Math.max(0.05, this.rot ? port : land);
    this.cx = cw / 2;
    this.cy = HUD_TOP + ah / 2;
    this.layer = null; // 배율이 바뀌었으니 다시 굽는다
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

  impact(e, kind) {
    const n = Math.min(10, Math.floor(e.power / 120));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, sp = 30 + Math.random() * (kind === 'spark' ? 160 : 80);
      this.particles.push({
        x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0, max: kind === 'spark' ? 0.25 : 0.5 + Math.random() * 0.3,
        size: kind === 'spark' ? 1.6 : 2.5 + Math.random() * 3, kind,
      });
    }
    if (!this.reduced && e.power > 500) this.shake = Math.min(6, this.shake + e.power / 400);
  }

  draw(world, ui, dt) {
    const { ctx, canvas } = this;
    this.time += dt;
    if (!this.layer || this.layerStage !== world.stage) this.bake(world.stage);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = C.outside;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const sh = this.shake;
    this.shake = Math.max(0, sh - dt * 30);
    const ox = sh ? (Math.random() - 0.5) * sh : 0, oy = sh ? (Math.random() - 0.5) * sh : 0;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.translate(this.cx + ox, this.cy + oy);
    ctx.rotate(this.rot);
    ctx.scale(this.scale, this.scale);
    ctx.translate(-BOARD.w / 2, -BOARD.h / 2);

    ctx.drawImage(this.layer, -FRAME, -FRAME, BOARD.w + FRAME * 2, BOARD.h + FRAME * 2);

    this.drawGoalState(world);
    this.drawTrails(world, dt);
    if (ui.aim && ui.guide) this.drawGuide(world, ui.guide);
    for (const b of world.marbles) this.drawShadow(b);
    for (const b of world.marbles) this.drawMarble(b);
    this.drawParticles(dt);
    if (world.phase === 'aim') {
      if (ui.aim) this.drawAim(world.player, ui.aim);
      else this.drawIdle(world.player);
    }
  }

  // ---------- 고정 레이어 ----------
  bake(stage) {
    const k = Math.min(2.5, this.scale * this.dpr);
    const W = BOARD.w + FRAME * 2, H = BOARD.h + FRAME * 2;
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(W * k);
    cv.height = Math.ceil(H * k);
    const g = cv.getContext('2d');
    g.scale(k, k);
    g.translate(FRAME, FRAME);
    const rand = rng(stage.id * 977 + 13);

    this.bakeFrame(g, rand);
    this.bakeDirt(g, rand);
    this.bakeChalk(g, stage, rand);
    for (const p of stage.walls) this.bakePlank(g, p, rand);
    for (const p of stage.posts) this.bakePost(g, p);

    this.layer = cv;
    this.layerStage = stage;
  }

  bakeFrame(g, rand) {
    const { w, h } = BOARD, F = FRAME;
    // 테두리 네 장을 45° 맞춤으로
    const sides = [
      [[-F, -F], [w + F, -F], [w, 0], [0, 0]],
      [[w + F, -F], [w + F, h + F], [w, h], [w, 0]],
      [[w + F, h + F], [-F, h + F], [0, h], [w, h]],
      [[-F, h + F], [-F, -F], [0, 0], [0, h]],
    ];
    sides.forEach((pts, i) => {
      g.beginPath();
      pts.forEach(([x, y], j) => (j ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      const horiz = i % 2 === 0;
      const grad = horiz
        ? g.createLinearGradient(0, i === 0 ? -F : h + F, 0, i === 0 ? 0 : h)
        : g.createLinearGradient(i === 1 ? w + F : -F, 0, i === 1 ? w : 0, 0);
      grad.addColorStop(0, C.frameDark);
      grad.addColorStop(0.35, C.frameLight);
      grad.addColorStop(1, C.frame);
      g.fillStyle = grad;
      g.fill();
      g.save();
      g.clip();
      g.strokeStyle = 'rgba(40, 22, 8, 0.35)';
      g.lineWidth = 1;
      for (let n = 0; n < 7; n++) {
        const t = 4 + rand() * (F - 8);
        g.beginPath();
        if (horiz) {
          const y = i === 0 ? -t : h + t;
          g.moveTo(-F, y);
          for (let x = -F; x <= w + F; x += 40) g.lineTo(x, y + (rand() - 0.5) * 2);
        } else {
          const x = i === 1 ? w + t : -t;
          g.moveTo(x, -F);
          for (let y = -F; y <= h + F; y += 40) g.lineTo(x + (rand() - 0.5) * 2, y);
        }
        g.stroke();
      }
      g.restore();
      g.strokeStyle = C.frameDark;
      g.lineWidth = 1.5;
      g.stroke();
    });
  }

  bakeDirt(g, rand) {
    const { w, h } = BOARD;
    g.save();
    g.beginPath();
    g.rect(0, 0, w, h);
    g.clip();
    g.fillStyle = C.dirt;
    g.fillRect(0, 0, w, h);
    // 얼룩
    for (let i = 0; i < 26; i++) {
      const x = rand() * w, y = rand() * h, r = 60 + rand() * 160;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      const col = rand() < 0.5 ? '154, 117, 77' : '210, 178, 136';
      grad.addColorStop(0, `rgba(${col}, ${0.18 + rand() * 0.15})`);
      grad.addColorStop(1, `rgba(${col}, 0)`);
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // 흙 알갱이
    for (let i = 0; i < 5200; i++) {
      g.fillStyle = rand() < 0.55 ? C.dirtDark : C.dirtLight;
      g.globalAlpha = 0.25 + rand() * 0.45;
      const s = 0.8 + rand() * 1.8;
      g.fillRect(rand() * w, rand() * h, s, s);
    }
    g.globalAlpha = 1;
    // 자갈
    for (let i = 0; i < 70; i++) {
      const x = rand() * w, y = rand() * h, rx = 2 + rand() * 4, ry = rx * (0.6 + rand() * 0.4);
      g.fillStyle = 'rgba(60, 40, 20, 0.25)';
      g.beginPath(); g.ellipse(x + 1, y + 1.5, rx, ry, rand() * TAU, 0, TAU); g.fill();
      g.fillStyle = C.pebble[Math.floor(rand() * C.pebble.length)];
      g.beginPath(); g.ellipse(x, y, rx, ry, rand() * TAU, 0, TAU); g.fill();
    }
    // 테두리가 흙에 드리운 그림자
    const edge = (x0, y0, x1, y1, fx, fy, fw, fh) => {
      const grad = g.createLinearGradient(x0, y0, x1, y1);
      grad.addColorStop(0, 'rgba(40, 22, 8, 0.42)');
      grad.addColorStop(1, 'rgba(40, 22, 8, 0)');
      g.fillStyle = grad;
      g.fillRect(fx, fy, fw, fh);
    };
    edge(0, 0, 0, 22, 0, 0, w, 22);
    edge(0, 0, 18, 0, 0, 0, 18, h);
    edge(w, 0, w - 10, 0, w - 10, 0, 10, h);
    edge(0, h, 0, h - 10, 0, h - 10, w, 10);
    g.restore();
  }

  // 분필 선: 여러 번 겹쳐 그은 흔들리는 원
  chalkCircle(g, x, y, r, rand, width = 3.2, passes = 3, dash = null) {
    g.save();
    g.strokeStyle = C.chalk;
    g.lineCap = 'round';
    if (dash) g.setLineDash(dash);
    for (let p = 0; p < passes; p++) {
      g.globalAlpha = 0.35 + rand() * 0.35;
      g.lineWidth = width * (0.6 + rand() * 0.6);
      const ph = rand() * TAU, wob = 1.2 + rand() * 1.6;
      g.beginPath();
      for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * TAU;
        const rr = r + Math.sin(a * 3 + ph) * wob + (rand() - 0.5) * 1.2;
        const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
        i ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.stroke();
    }
    g.restore();
  }

  bakeChalk(g, stage, rand) {
    const goal = stage.goal;
    g.save();
    g.fillStyle = 'rgba(250, 247, 238, 0.07)';
    g.beginPath(); g.arc(goal.x, goal.y, goal.r, 0, TAU); g.fill();
    g.restore();
    this.chalkCircle(g, goal.x, goal.y, goal.r, rand, 3.6, 4);
    // 이 안쪽에 구슬 중심이 멈추면 '완전 골인'
    this.chalkCircle(g, goal.x, goal.y, goal.r - stage.marbleR, rand, 1.6, 1, [3, 9]);
    // 출발 자리
    const s = stage.marbles[0];
    this.chalkCircle(g, s.x, s.y, stage.marbleR + 9, rand, 2.2, 2);
    g.save();
    g.strokeStyle = C.chalk;
    g.globalAlpha = 0.55;
    g.lineWidth = 2.4;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(s.x - 46, s.y - 60); g.lineTo(s.x - 44 + (rand() - 0.5) * 3, s.y + 60);
    g.stroke();
    g.restore();
  }

  bakePlank(g, p, rand) {
    const pts = plankCorners(p);
    const path = () => {
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
    };
    g.save();
    g.translate(4, 6);
    g.fillStyle = C.shadow;
    g.filter = 'blur(3px)';
    path(); g.fill();
    g.restore();

    path();
    const a = (p.deg * Math.PI) / 180, nx = -Math.sin(a), ny = Math.cos(a);
    const grad = g.createLinearGradient(p.cx - nx * p.thick / 2, p.cy - ny * p.thick / 2, p.cx + nx * p.thick / 2, p.cy + ny * p.thick / 2);
    grad.addColorStop(0, C.plankLight);
    grad.addColorStop(0.5, C.plank);
    grad.addColorStop(1, C.plankDark);
    g.fillStyle = grad;
    g.fill();
    g.save();
    g.clip();
    g.translate(p.cx, p.cy);
    g.rotate(a);
    g.strokeStyle = 'rgba(70, 38, 14, 0.4)';
    g.lineWidth = 0.9;
    for (let n = 0; n < 5; n++) {
      const y = -p.thick / 2 + 3 + rand() * (p.thick - 6);
      g.beginPath();
      g.moveTo(-p.len / 2, y);
      for (let x = -p.len / 2; x <= p.len / 2; x += 18) g.lineTo(x, y + (rand() - 0.5) * 1.6);
      g.stroke();
    }
    g.fillStyle = 'rgba(40, 30, 25, 0.75)';
    for (const sx of [-1, 1]) { g.beginPath(); g.arc(sx * (p.len / 2 - 9), 0, 1.8, 0, TAU); g.fill(); }
    g.restore();
    path();
    g.strokeStyle = C.plankDark;
    g.lineWidth = 1.4;
    g.stroke();
  }

  bakePost(g, p) {
    g.save();
    g.fillStyle = C.shadow;
    g.filter = 'blur(3px)';
    g.beginPath(); g.arc(p.x + 4, p.y + 6, p.r, 0, TAU); g.fill();
    g.restore();
    const grad = g.createRadialGradient(p.x - p.r * 0.3, p.y - p.r * 0.3, 1, p.x, p.y, p.r);
    grad.addColorStop(0, C.plankLight);
    grad.addColorStop(1, C.plank);
    g.fillStyle = grad;
    g.beginPath(); g.arc(p.x, p.y, p.r, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(70, 38, 14, 0.45)';
    g.lineWidth = 0.9;
    for (let rr = p.r * 0.3; rr < p.r; rr += p.r * 0.22) { g.beginPath(); g.arc(p.x, p.y, rr, 0, TAU); g.stroke(); }
    g.strokeStyle = C.plankDark;
    g.lineWidth = 2;
    g.beginPath(); g.arc(p.x, p.y, p.r, 0, TAU); g.stroke();
  }

  // ---------- 매 프레임 ----------
  drawGoalState(world) {
    const contact = goalContact(world);
    if (!contact) return;
    const { ctx } = this, g = world.stage.goal;
    const pulse = this.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(this.time * 6);
    ctx.fillStyle = contact === 'inside' ? `rgba(160, 230, 150, ${0.22 + pulse * 0.1})` : `rgba(160, 230, 150, ${0.1 + pulse * 0.08})`;
    ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, TAU); ctx.fill();
  }

  drawTrails(world, dt) {
    const { ctx } = this;
    for (const b of world.marbles) {
      let tr = this.trails.get(b.id);
      if (!tr) { tr = []; this.trails.set(b.id, tr); }
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > 120) tr.push(b.x, b.y);
      else if (tr.length) tr.splice(0, 2);
      while (tr.length > 28) tr.splice(0, 2);
      if (tr.length < 4) continue;
      ctx.lineCap = 'round';
      for (let i = 2; i < tr.length; i += 2) {
        const t = i / tr.length;
        ctx.strokeStyle = `rgba(255, 246, 225, ${t * 0.28})`;
        ctx.lineWidth = b.r * 1.5 * t;
        ctx.beginPath(); ctx.moveTo(tr[i - 2], tr[i - 1]); ctx.lineTo(tr[i], tr[i + 1]); ctx.stroke();
      }
    }
  }

  drawGuide(world, pts) {
    const { ctx } = this;
    // 경로를 따라 14px 간격으로 점을 찍는다. 멀어질수록 흐려진다
    let total = 0;
    for (let i = 2; i < pts.length; i += 2) total += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    if (total < 1) return;
    const gap = 14;
    let next = world.player.r + 8, walked = 0;
    ctx.fillStyle = '#fffaf0';
    for (let i = 2; i < pts.length; i += 2) {
      const x0 = pts[i - 2], y0 = pts[i - 1], x1 = pts[i], y1 = pts[i + 1];
      const seg = Math.hypot(x1 - x0, y1 - y0);
      while (seg > 0 && next <= walked + seg) {
        const t = (next - walked) / seg;
        ctx.globalAlpha = 0.85 * (1 - next / (total + gap));
        ctx.beginPath(); ctx.arc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 2.6, 0, TAU); ctx.fill();
        next += gap;
      }
      walked += seg;
    }
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#fffaf0';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(pts[pts.length - 2], pts[pts.length - 1], world.player.r, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  drawShadow(b) {
    const { ctx } = this;
    ctx.fillStyle = C.shadow;
    ctx.beginPath(); ctx.ellipse(b.x + 3, b.y + 5, b.r, b.r * 0.86, 0, 0, TAU); ctx.fill();
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
    ctx.beginPath(); ctx.arc(b.x, b.y, r * 0.92, 0, TAU); ctx.clip();
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

    ctx.strokeStyle = 'rgba(10, 10, 30, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(b.x, b.y, r - 0.5, 0, TAU); ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath(); ctx.ellipse(b.x - r * 0.36, b.y - r * 0.42, r * 0.3, r * 0.17, -0.6, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.beginPath(); ctx.arc(b.x + r * 0.4, b.y + r * 0.45, r * 0.12, 0, TAU); ctx.fill();
  }

  drawParticles(dt) {
    const { ctx } = this;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.max) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 1 - 4 * dt; p.vy *= 1 - 4 * dt;
      const t = 1 - p.life / p.max;
      ctx.fillStyle = p.kind === 'spark' ? `rgba(255, 252, 240, ${t})` : `rgba(120, 88, 56, ${t * 0.5})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (p.kind === 'spark' ? 1 : 1 + (1 - t)), 0, TAU); ctx.fill();
    }
  }

  drawIdle(b) {
    if (this.reduced) return;
    const { ctx } = this;
    const t = (this.time % 1.4) / 1.4;
    ctx.strokeStyle = `rgba(255, 250, 240, ${0.6 * (1 - t)})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 4 + t * 16, 0, TAU); ctx.stroke();
  }

  drawAim(b, aim) {
    const { ctx } = this;
    const ux = Math.cos(aim.angle), uy = Math.sin(aim.angle);
    // 고무줄: 쏘는 방향의 반대로 당겨진다
    const pull = b.r + 10 + aim.power * 70;
    ctx.strokeStyle = 'rgba(255, 250, 240, 0.55)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(b.x - ux * b.r, b.y - uy * b.r); ctx.lineTo(b.x - ux * pull, b.y - uy * pull); ctx.stroke();
    ctx.fillStyle = 'rgba(255, 250, 240, 0.8)';
    ctx.beginPath(); ctx.arc(b.x - ux * pull, b.y - uy * pull, 5, 0, TAU); ctx.fill();
    // 힘 링: 흰색 → 주황
    const p = aim.power;
    const rr = Math.round(255), gg = Math.round(240 - 102 * p), bb = Math.round(220 - 159 * p);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 9, 0, TAU); ctx.stroke();
    ctx.strokeStyle = `rgb(${rr}, ${gg}, ${bb})`;
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 9, -Math.PI / 2, -Math.PI / 2 + TAU * p); ctx.stroke();
  }
}
