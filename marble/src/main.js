// 게임 루프, 조준 입력, HUD, 결과 카드, 설정 패널.
// 화면 글자는 해외 플레이어도 읽도록 짧은 영어로 쓴다.

import { CFG, TUNABLES } from './config.js';
import { STAGES } from './stages.js';
import { createWorld, stepWorld, shoot, predict, goalContact, DT } from './physics.js';
import { Renderer } from './render.js';
import { Sfx } from './audio.js';

const $ = (id) => document.getElementById(id);
const DEFAULTS = { ...CFG };
const MM_PER_PX = 0.57;      // 구슬 지름 16mm 기준 판 좌표 1px의 실제 길이
const STAR = '<svg class="star{on}" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.5l2.9 6 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.2 1.3-6.6L2.5 9.3l6.6-.8z"/></svg>';

const canvas = $('c');
const renderer = new Renderer(canvas);
const sfx = new Sfx();

let stage = STAGES[0];
let world = createWorld(stage);
let aim = null;              // { id, sx, sy, x, y } 화면 좌표 (CSS px)
let acc = 0;
let last = performance.now();
let resultAt = 0;            // 결과 카드를 띄울 시각
let shownShots = -1;

function restart() {
  world = createWorld(stage);
  aim = null;
  resultAt = 0;
  shownShots = -1;
  renderer.reset();
  $('result').hidden = true;
  canvas.classList.remove('aiming');
  $('stageNo').textContent = `STAGE ${stage.id}`;
}

// ---------- 조준 ----------
function currentAim() {
  if (!aim) return null;
  const dx = aim.x - aim.sx, dy = aim.y - aim.sy;
  const power = Math.min(1, Math.hypot(dx, dy) / CFG.maxPull);
  const [wx, wy] = renderer.screenVecToWorld(-dx, -dy);
  return { angle: Math.atan2(wy, wx), power };
}

canvas.addEventListener('pointerdown', (e) => {
  sfx.unlock();
  if (!$('settings').hidden) { toggleSettings(false); return; }
  if (world.phase !== 'aim' || aim) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  aim = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add('aiming');
});
canvas.addEventListener('pointermove', (e) => {
  if (!aim || e.pointerId !== aim.id) return;
  aim.x = e.clientX;
  aim.y = e.clientY;
});
canvas.addEventListener('pointerup', (e) => {
  if (!aim || e.pointerId !== aim.id) return;
  const a = currentAim();
  cancelAim();
  if (shoot(world, a.angle, a.power)) sfx.flick(a.power);
});
canvas.addEventListener('pointercancel', cancelAim);
canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); cancelAim(); });

function cancelAim() {
  aim = null;
  canvas.classList.remove('aiming');
}

addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === 'Escape') { cancelAim(); toggleSettings(false); }
  else if (e.key === 'r' || e.key === 'R') restart();
  else if (e.key === '`') toggleSettings();
  else if (e.key === 'm' || e.key === 'M') toggleSound();
});

// ---------- 시뮬 이벤트 → 소리, 효과, 결과 ----------
function handleEvents(events) {
  for (const e of events) {
    if (e.type === 'wall' || e.type === 'post') {
      sfx.wood(e.power);
      renderer.bump(e.power);
    } else if (e.type === 'marble') {
      sfx.glass(e.power);
      renderer.impact(e);
    } else if (e.type === 'rest' && world.result) {
      if (world.phase === 'clear') sfx.clear(world.result.contact === 'inside');
      else sfx.fail();
      resultAt = performance.now() + 650;
    }
  }
}

function showResult() {
  const r = world.result;
  $('resStage').textContent = `STAGE ${stage.id}`;
  $('resTitle').textContent = r.pass ? (r.contact === 'inside' ? 'PERFECT' : 'CLEAR') : 'MISSED';
  const stars = [[r.pass, 'Clear'], [r.contact === 'inside', 'Perfect'], [r.pass && r.shots === 1, 'One shot']];
  $('resStars').innerHTML = stars.map(([on]) => STAR.replace('{on}', on ? ' on' : '')).join('');
  $('resStars').setAttribute('aria-label', `${stars.filter(([on]) => on).length} of 3 stars`);
  if (r.pass) $('resNote').textContent = `${r.shots} / ${stage.shots} shots`;
  else {
    const g = stage.goal, p = world.player;
    const gap = Math.max(0, Math.hypot(p.x - g.x, p.y - g.y) - g.r - p.r);
    $('resNote').textContent = `${Math.max(0.1, (gap * MM_PER_PX) / 10).toFixed(1)} cm short`;
  }
  $('result').hidden = false;
  $('againBtn').focus();
}

// ---------- HUD ----------
function updateHud() {
  const left = stage.shots - world.shots;
  if (left !== shownShots) {
    shownShots = left;
    $('ammo').innerHTML = Array.from({ length: stage.shots }, (_, i) => `<span class="pip${i < left ? '' : ' used'}"></span>`).join('');
    $('ammo').setAttribute('aria-label', `${left} marbles left`);
  }
  let hint = '';
  if (world.phase === 'aim') {
    const a = currentAim();
    if (!a) hint = 'PULL &amp; RELEASE';
    else if (a.power < CFG.minPower) hint = 'PULL MORE';
    else hint = `RELEASE · <b>${Math.round(a.power * 100)}%</b>`;
  }
  const el = $('hint');
  if (el.innerHTML !== hint) el.innerHTML = hint;
}

function toggleSound() {
  sfx.muted = !sfx.muted;
  $('soundBtn').textContent = sfx.muted ? 'Off' : 'On';
  $('soundBtn').setAttribute('aria-pressed', String(!sfx.muted));
}

// ---------- 설정 패널 ----------
function toggleSettings(open = $('settings').hidden) {
  $('settings').hidden = !open;
  $('gearBtn').setAttribute('aria-expanded', String(open));
}

function buildTunables() {
  const box = $('tunables');
  for (const [key, min, max, step, label] of TUNABLES) {
    const row = document.createElement('label');
    row.className = 'tune';
    const id = `t_${key}`;
    row.innerHTML = `<span>${label}</span><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${CFG[key]}"><output>${CFG[key]}</output>`;
    const input = row.querySelector('input'), out = row.querySelector('output');
    input.addEventListener('input', () => { CFG[key] = parseFloat(input.value); out.textContent = input.value; });
    box.appendChild(row);
  }
  $('resetTune').addEventListener('click', () => {
    Object.assign(CFG, DEFAULTS);
    for (const [key] of TUNABLES) {
      const input = $(`t_${key}`);
      input.value = CFG[key];
      input.nextElementSibling.textContent = CFG[key];
    }
  });
}

let readoutT = 0;
function updateReadout(dt) {
  readoutT -= dt;
  if (readoutT > 0) return;
  readoutT = 0.1;
  const p = world.player;
  const a = currentAim();
  const launch = a ? CFG.maxSpeed * Math.pow(a.power, CFG.powerCurve) : 0;
  $('dbgStats').innerHTML = `Speed <b>${Math.hypot(p.vx, p.vy).toFixed(0)}</b> px/s${a ? ` · launch <b>${launch.toFixed(0)}</b>` : ''}`;
}

// ---------- 루프 ----------
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;
  while (acc >= DT) {
    stepWorld(world);
    handleEvents(world.events);
    acc -= DT;
  }
  if (resultAt && now >= resultAt) { resultAt = 0; showResult(); }

  const a = world.phase === 'aim' ? currentAim() : null;
  const guide = a && a.power >= CFG.minPower && CFG.guideTime > 0 ? predict(world, a.angle, a.power, CFG.guideTime) : null;
  renderer.draw(world, { aim: a, guide }, dt);
  updateHud();
  if ($('physics').open && !$('settings').hidden) updateReadout(dt);
  requestAnimationFrame(frame);
}

$('gearBtn').addEventListener('click', () => toggleSettings());
$('retryBtn').addEventListener('click', () => { restart(); toggleSettings(false); });
$('againBtn').addEventListener('click', restart);
$('soundBtn').addEventListener('click', () => { sfx.unlock(); toggleSound(); });
buildTunables();
restart();
window.__game = { get world() { return world; }, CFG, shoot: (angle, power) => shoot(world, angle, power), restart };
requestAnimationFrame(frame);
