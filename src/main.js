// 게임 루프, 입력 배정, 리플레이, HUD, 디버그 패널.

import { CFG, TUNABLES } from './config.js';
import { createSim, stepSim, snapshot, DT } from './sim.js';
import { KeyboardMouse, Pad, mergeInputs, emptyInput } from './input.js';
import { Bot } from './bot.js';
import { Renderer } from './render.js';
import { Audio } from './audio.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const AUTO = params.has('auto'); // 봇 대 봇 자동 테스트

const canvas = $('c');
const renderer = new Renderer(canvas);
const audio = new Audio();
const kb = new KeyboardMouse(canvas);
const pads = [0, 1, 2, 3].map((i) => new Pad(i));

let sim = createSim();
let mode = AUTO ? 'fight' : 'intro'; // intro | fight | replay | end
let p2Source = 'bot';                // bot | dummy | pad
let bot2 = new Bot('spar', 11);
let bot1 = new Bot('spar', 5);
let acc = 0;
let last = performance.now();
let wall = 0;
let showDebug = false;
let showTrails = false;
let msgT = 0;

// 리플레이 버퍼: 틱마다 스냅샷
const BUF = 420;
const buf = [];
let replay = null;       // { from, to, pos, unseen, text }
let pendingReplay = null;
let endShownAt = 0;

function connectedPads() {
  return pads.filter((p) => p.connected);
}

function sources() {
  const cp = connectedPads();
  if (p2Source === 'pad' && cp.length === 0) p2Source = 'bot';
  if (cp.length >= 2 && p2Source !== 'bot' && p2Source !== 'dummy') {
    return { p1: { kb: true, pad: cp[0] }, p2: { pad: cp[1] } };
  }
  if (p2Source === 'pad' && cp.length >= 1) {
    return cp.length >= 2 ? { p1: { kb: true, pad: cp[0] }, p2: { pad: cp[1] } } : { p1: { kb: true }, p2: { pad: cp[0] } };
  }
  return { p1: { kb: true, pad: cp[0] || null }, p2: { bot: true } };
}

function readInputs() {
  const [a, b] = sim.fighters;
  if (AUTO) return [bot1.read(DT, a, b), bot2.read(DT, b, a)];
  const src = sources();
  let i1 = kb.read(DT);
  if (src.p1.pad) i1 = mergeInputs(i1, src.p1.pad.read(DT));
  let i2 = emptyInput();
  if (src.p2.pad) i2 = src.p2.pad.read(DT);
  else {
    bot2.mode = p2Source === 'dummy' ? 'dummy' : 'spar';
    i2 = bot2.read(DT, b, a);
  }
  return [i1, i2];
}

function restart() {
  sim = createSim();
  bot1 = new Bot('spar', 5 + Math.floor(Math.random() * 1000));
  bot2 = new Bot(p2Source === 'dummy' ? 'dummy' : 'spar', 11 + Math.floor(Math.random() * 1000));
  buf.length = 0;
  replay = null;
  pendingReplay = null;
  mode = 'fight';
  $('end').hidden = true;
  $('intro').hidden = true;
  message('FIGHT', 1.0);
  audio.bell();
}

function message(text, dur = 1.2, cls = '') {
  const m = $('msg');
  m.textContent = text;
  m.className = cls;
  m.hidden = false;
  msgT = dur;
}

// ---------- 이벤트 → 소리, 이펙트 ----------
let lastUnseen = false;
function handleEvents(events) {
  for (const e of events) {
    if (e.type === 'hit') {
      audio.hit(e.power, e.clean, e.body);
      renderer.sweat(e.pos, e.dir, e.power);
      renderer.shake(Math.min(0.06, e.power * 0.0025) * (e.clean ? 1.4 : 1));
      renderer.hitFlash(e.target, Math.min(0.6, e.power / 30));
      lastUnseen = e.unseen;
      if (e.result === 'rocked') message('흔들린다', 0.9, 'small');
      if (e.result === 'liver') message('리버', 0.9, 'small');
    } else if (e.type === 'block') {
      audio.block(e.power);
    } else if (e.type === 'miss') {
      audio.whoosh(e.weight);
    } else if (e.type === 'launch') {
      if (e.weight > 0.5 && !e.feint) audio.whoosh(e.weight * 0.6);
    } else if (e.type === 'down' || e.type === 'ko') {
      setTimeout(() => audio.floor(), 280);
      audio.crowd(e.type === 'ko' ? 1.4 : 1);
      message(e.type === 'ko' ? 'KO' : e.tko ? 'TKO' : 'DOWN', 1.6, 'big');
      if ((!AUTO || params.has('replay')) && !pendingReplay) {
        pendingReplay = { at: wall + 0.7, impact: buf.length - 1, unseen: lastUnseen, text: e.type === 'ko' ? 'KO' : e.tko ? 'TKO' : 'DOWN' };
      }
    } else if (e.type === 'end') {
      setTimeout(() => audio.bell(), e.how === '판정' ? 0 : 900);
      if (e.how === '판정') message('판정', 1.5, 'big');
    }
  }
}

// ---------- 루프 ----------
function frame(nowMs) {
  const dt = Math.min(0.1, (nowMs - last) / 1000);
  last = nowMs;
  wall += dt;

  // 메뉴 입력
  const anyPad = pads.some((p) => p.anyPressed());
  const startKey = kb.consume('Enter') || kb.consume('Space');
  if (kb.consume('Backquote') || pads.some((p) => p.pressed(8))) toggleDebug();
  if (kb.consume('KeyB')) cycleP2();
  if (kb.consume('KeyT')) showTrails = !showTrails;
  if (kb.consume('KeyL')) downloadLog();

  if (mode === 'intro') {
    if (startKey || anyPad || kb.consume('Mouse')) { audio.unlock(); restart(); }
  } else if (mode === 'end') {
    if ((startKey || anyPad) && wall - endShownAt > 0.8) restart();
  }

  if (mode === 'fight' || mode === 'end') {
    acc += dt;
    let n = 0;
    while (acc >= DT && n < 6) {
      const inputs = readInputs();
      stepSim(sim, inputs);
      handleEvents(sim.events);
      buf.push(snapshot(sim));
      if (buf.length > BUF) { buf.shift(); if (pendingReplay) pendingReplay.impact--; }
      acc -= DT;
      n++;
    }
    if (mode === 'fight' && sim.phase === 'end' && !pendingReplay) showEnd();
    if (pendingReplay && wall >= pendingReplay.at) {
      replay = { from: Math.max(0, pendingReplay.impact - 75), to: Math.min(buf.length - 1, pendingReplay.impact + 40), pos: 0, unseen: pendingReplay.unseen, text: pendingReplay.text };
      replay.pos = replay.from;
      pendingReplay = null;
      mode = 'replay';
      $('replay').hidden = false;
      $('unseen').hidden = true;
    }
  } else if (mode === 'replay') {
    replay.pos += (dt / DT) * CFG.replaySpeed;
    if (replay.unseen && replay.pos >= replay.to - 42) $('unseen').hidden = false;
    if (replay.pos >= replay.to || startKey) {
      $('replay').hidden = true;
      mode = 'fight';
      acc = 0;
      if (sim.phase === 'end') showEnd();
    }
  }

  // 그리기
  let snaps;
  if (mode === 'replay') {
    const i = Math.floor(replay.pos);
    snaps = buf[Math.min(buf.length - 1, i)];
  } else {
    snaps = buf.length ? buf[buf.length - 1] : snapshot(sim);
  }
  renderer.render(snaps, dt, wall, { replay: mode === 'replay', trails: showTrails });

  updateHud(dt);
  for (const p of pads) p.endFrame();
  requestAnimationFrame(frame);
}

function showEnd() {
  if (mode === 'end') return;
  mode = 'end';
  endShownAt = wall;
  const r = sim.result;
  const names = ['P1 (빨강)', 'P2 (파랑)'];
  $('endTitle').textContent = r.winner < 0 ? '무승부' : `${names[r.winner]} 승`;
  const mm = Math.floor(r.time / 60), ss = Math.floor(r.time % 60).toString().padStart(2, '0');
  $('endHow').textContent = `${r.how} · ${mm}:${ss}`;
  const rows = sim.fighters.map((f, i) => {
    const s = f.stats;
    return `<tr><th>${names[i]}</th><td>${s.landed}/${s.thrown}</td><td>${s.headLanded}</td><td>${s.bodyLanded}</td><td>${s.unseen}</td><td>${s.feints}</td><td>${s.flow}</td></tr>`;
  }).join('');
  $('endStats').innerHTML = `<tr><th></th><th>적중/시도</th><th>머리</th><th>몸</th><th>못 본 주먹</th><th>페인트</th><th>흐름 연결</th></tr>${rows}`;
  $('end').hidden = false;
  if (AUTO) window.__done = true;
}

// ---------- HUD ----------
function updateHud(dt) {
  const t = Math.max(0, sim.clock);
  $('clock').textContent = `${Math.floor(t / 60)}:${Math.floor(t % 60).toString().padStart(2, '0')}`;
  const src = sources();
  $('p1src').textContent = src.p1.pad ? '키보드·마우스 / 패드' : '키보드·마우스';
  $('p2src').textContent = src.p2.pad ? '패드' : p2Source === 'dummy' ? '샌드백 (B로 변경)' : '스파링 봇 (B로 변경)';
  if (msgT > 0) {
    msgT -= dt;
    if (msgT <= 0) $('msg').hidden = true;
  }
  if (showDebug) updateDebug();
}

function cycleP2() {
  const order = connectedPads().length ? ['bot', 'dummy', 'pad'] : ['bot', 'dummy'];
  p2Source = order[(order.indexOf(p2Source) + 1) % order.length];
  bot2.mode = p2Source === 'dummy' ? 'dummy' : 'spar';
}

// ---------- 디버그 패널 ----------
function toggleDebug() {
  showDebug = !showDebug;
  $('debug').hidden = !showDebug;
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
  $('dlLog').addEventListener('click', downloadLog);
  $('trailBtn').addEventListener('click', () => { showTrails = !showTrails; });
}

let dbgT = 0;
function updateDebug() {
  dbgT -= 1 / 60;
  if (dbgT > 0) return;
  dbgT = 0.1;
  const html = sim.fighters.map((f, i) => {
    const chin = Math.max(CFG.chinMin, CFG.chinBase - f.headDmg / 10 * CFG.chinLossPer10);
    const s = f.stats;
    return `<div class="fs"><b>P${i + 1}</b> ${f.state}${f.rockedT > 0 ? ' · 흔들림' : ''}
      <div>머리 ${f.headDmg.toFixed(1)} · 턱 기준 ${chin.toFixed(1)} · 몸 ${f.bodyDmg.toFixed(1)}</div>
      <div>스태미나 ${f.stamina.toFixed(0)}/${f.staminaMax.toFixed(0)} · 균형 ${Math.hypot(f.balance.x, f.balance.z).toFixed(2)} · 다운 ${f.downs}</div>
      <div>던짐 ${s.thrown} · 적중 ${s.landed} · 막힘 ${s.blocked} · 헛침 ${s.missed} · 페인트 ${s.feints} · 못 봄 ${s.unseen} · 흐름 ${s.flow}</div></div>`;
  }).join('');
  const lastHits = sim.log.slice(-5).reverse().map((l) =>
    `<div>P${l.attacker + 1} ${l.name} · ${l.outcome}${l.final !== undefined ? ` · ${l.final}` : ''}${l.unseen ? ' · 못 봄' : ''}${l.counter ? ' · 카운터' : ''}${l.result && l.result !== 'hit' && l.result !== 'block' ? ' · ' + l.result : ''} · 체중 ${l.weight}</div>`).join('');
  $('dbgStats').innerHTML = html + `<div class="fs"><b>최근 타격</b>${lastHits}</div>`;
}

function downloadLog() {
  const data = { at: new Date().toISOString(), cfg: CFG, result: sim.result, stats: sim.fighters.map((f) => f.stats), punches: sim.log };
  window.fightLog = data;
  console.log('[fight log]', data);
  try {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fight-log-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch { /* 샌드박스에서는 막힐 수 있다. 콘솔의 window.fightLog 참고 */ }
}

// ---------- 시작 ----------
canvas.addEventListener('mousedown', () => { audio.unlock(); kb.pressedOnce.add('Mouse'); });
addEventListener('keydown', () => audio.unlock(), { once: true });
buildDebug();
if (AUTO) {
  $('intro').hidden = true;
  CFG.roundTime = parseFloat(params.get('time') || '60');
  restart();
}
window.__game = { get sim() { return sim; }, CFG, get mode() { return mode; } };
requestAnimationFrame(frame);
