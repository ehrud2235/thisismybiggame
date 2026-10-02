// 게임 루프, 조준 입력, HUD, 결과 카드, 디버그 패널.

import { CFG, TUNABLES } from './config.js';
import { STAGES } from './stages.js';
import { createWorld, stepWorld, shoot, predict, goalContact, DT } from './physics.js';
import { Renderer } from './render.js';
import { Sfx } from './audio.js';

const $ = (id) => document.getElementById(id);
const DEFAULTS = { ...CFG };

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
let showDebug = false;

function restart() {
  world = createWorld(stage);
  aim = null;
  resultAt = 0;
  renderer.reset();
  $('result').hidden = true;
  canvas.classList.remove('aiming');
  renderStage();
}

function renderStage() {
  $('stageNo').textContent = `STAGE ${stage.id}`;
  $('stageName').textContent = stage.name;
  $('rule').textContent = stage.hint;
  shownShots = -1;
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
  if (e.key === 'Escape') cancelAim();
  else if (e.key === 'r' || e.key === 'R') restart();
  else if (e.key === '`') toggleDebug();
  else if (e.key === 'm' || e.key === 'M') toggleSound();
});

// ---------- 시뮬 이벤트 → 소리, 효과, 결과 ----------
function handleEvents(events) {
  for (const e of events) {
    if (e.type === 'wall' || e.type === 'post') {
      sfx.wood(e.power);
      if (e.power > 150) renderer.impact(e, 'dust');
    } else if (e.type === 'marble') {
      sfx.glass(e.power);
      renderer.impact(e, 'spark');
    } else if (e.type === 'rest' && world.result) {
      if (world.phase === 'clear') sfx.clear(world.result.contact === 'inside');
      else sfx.fail();
      resultAt = performance.now() + 650;
    }
  }
}

function showResult() {
  const r = world.result;
  $('resEyebrow').textContent = `STAGE ${stage.id} · ${stage.name}`;
  const title = $('resTitle');
  title.textContent = r.pass ? (r.contact === 'inside' ? '완전 골인!' : '걸쳤다, 통과!') : '아깝다';
  title.className = r.pass ? 'pass' : '';
  const checks = [
    [r.pass, stage.goal.need === 'touch' ? '분필 원에 걸치기' : '분필 원 안에 넣기'],
    [r.contact === 'inside', '구슬 전체가 원 안에'],
    [r.pass && r.shots === 1, '한 발에 끝내기'],
  ];
  $('resChecks').innerHTML = checks.map(([on, text]) => `<li class="${on ? 'on' : ''}">${text}</li>`).join('');
  let note;
  if (r.pass) note = `${stage.shots}발 중 ${r.shots}발 사용`;
  else {
    const g = stage.goal, p = world.player;
    const gap = Math.max(0, Math.hypot(p.x - g.x, p.y - g.y) - g.r - p.r);
    note = `구슬 ${stage.shots}발을 다 썼다. 원까지 ${Math.max(1, Math.round(gap / 5))}cm 모자랐다.`;
  }
  $('resNote').textContent = note;
  $('result').hidden = false;
  $('againBtn').focus();
}

// ---------- HUD ----------
function updateHud() {
  const left = stage.shots - world.shots;
  if (left !== shownShots) {
    shownShots = left;
    $('ammo').innerHTML = Array.from({ length: stage.shots }, (_, i) => `<span class="pip${i < left ? '' : ' used'}"></span>`).join('');
    $('ammoLabel').textContent = `남은 구슬 ${left}`;
  }
  let hint = '';
  if (world.phase === 'aim') {
    const a = currentAim();
    if (!a) hint = '아무 데나 누르고 <b>뒤로 당겼다 놓기</b> · 당긴 만큼 세게 나간다';
    else if (a.power < CFG.minPower) hint = '조금 더 당겨야 나간다 · Esc / 우클릭 취소';
    else hint = `힘 <b>${Math.round(a.power * 100)}%</b> · 놓으면 발사 · Esc / 우클릭 취소`;
  } else if (world.phase === 'roll') {
    const c = goalContact(world);
    hint = c === 'inside' ? '원 안이다, 멈춰라…' : c === 'touch' ? '걸쳤다, 멈춰라…' : '구르는 중…';
  }
  const el = $('hint');
  if (el.innerHTML !== hint) el.innerHTML = hint;
}

function toggleSound() {
  sfx.muted = !sfx.muted;
  $('soundBtn').textContent = sfx.muted ? '소리 꺼짐' : '소리 켜짐';
  $('soundBtn').setAttribute('aria-pressed', String(!sfx.muted));
}

// ---------- 디버그 패널 ----------
function toggleDebug() {
  showDebug = !showDebug;
  $('debug').hidden = !showDebug;
  $('tuneBtn').setAttribute('aria-pressed', String(showDebug));
}

function buildDebug() {
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

let dbgT = 0;
function updateDebug(dt) {
  dbgT -= dt;
  if (dbgT > 0) return;
  dbgT = 0.1;
  const p = world.player;
  const speed = Math.hypot(p.vx, p.vy);
  const a = currentAim();
  const launch = a ? CFG.maxSpeed * Math.pow(a.power, CFG.powerCurve) : 0;
  $('dbgStats').innerHTML = `
    <div>상태 <b>${world.phase}</b> · 쏜 구슬 ${world.shots}/${stage.shots}</div>
    <div>지금 속도 <b>${speed.toFixed(0)}</b> px/s${a ? ` · 이대로 쏘면 <b>${launch.toFixed(0)}</b> px/s` : ''}</div>
    <div>분필 원 <b>${goalContact(world) === 'inside' ? '완전히 안' : goalContact(world) === 'touch' ? '걸침' : '밖'}</b> · 위치 ${p.x.toFixed(0)}, ${p.y.toFixed(0)}</div>`;
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
  if (showDebug) updateDebug(dt);
  requestAnimationFrame(frame);
}

$('retryBtn').addEventListener('click', restart);
$('againBtn').addEventListener('click', restart);
$('tuneBtn').addEventListener('click', toggleDebug);
$('soundBtn').addEventListener('click', () => { sfx.unlock(); toggleSound(); });
buildDebug();
renderStage();
window.__game = { get world() { return world; }, CFG, shoot: (angle, power) => shoot(world, angle, power), restart };
requestAnimationFrame(frame);
