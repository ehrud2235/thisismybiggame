// 입력 → 선수 의도(InputState). 시뮬은 이 형태만 안다.
//
// InputState = {
//   move: {x,y}        왼쪽 스틱 / WASD (y+ = 상대 쪽)
//   lead, rear         앞손, 뒷손 버튼
//   rearWeight         뒷손 체중 (RT 깊이 / Shift)
//   stick: {x,y}       궤도 (오른쪽 스틱 / 마우스 휘두르기). x+ = 선수의 오른쪽
//   head: {x,y}        상체 움직임. x = 슬립, y- = 덕킹, y+ = 젖히기
//   guard              가드 조이기
//   guardStick: {x,y}  가드 위치
//   level              자세 높이 0..1
//   feint              페인트 수식 버튼
// }

export const emptyInput = () => ({
  move: { x: 0, y: 0 }, lead: false, rear: false, rearWeight: 0, stick: { x: 0, y: 0 },
  head: { x: 0, y: 0 }, guard: false, guardStick: { x: 0, y: 0 }, level: 0, feint: false,
});

const dead = (x, y, dz = 0.18) => {
  const m = Math.hypot(x, y);
  if (m < dz) return { x: 0, y: 0 };
  const k = Math.min(1, (m - dz) / (1 - dz)) / m;
  return { x: x * k, y: y * k };
};

// ---------- 키보드 + 마우스 ----------
export class KeyboardMouse {
  constructor(canvas) {
    this.keys = new Set();
    this.mouse = { left: false, right: false };
    this.vs = { x: 0, y: 0 }; // 마우스 휘두르기로 만든 가상 스틱
    this.touched = false;
    this.pressedOnce = new Set();
    addEventListener('keydown', (e) => {
      if (['Space', 'Tab', 'ShiftLeft', 'ShiftRight'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressedOnce.add(e.code);
      this.keys.add(e.code);
      this.touched = true;
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouse.left = true;
      if (e.button === 2) this.mouse.right = true;
      this.touched = true;
      if (document.pointerLockElement !== canvas && canvas.requestPointerLock) {
        try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* 샌드박스에서는 막힐 수 있다 */ }
      }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    addEventListener('mousemove', (e) => {
      this.vs.x += (e.movementX || 0) * 0.014;
      this.vs.y -= (e.movementY || 0) * 0.014;
      const m = Math.hypot(this.vs.x, this.vs.y);
      if (m > 1) { this.vs.x /= m; this.vs.y /= m; }
    });
  }

  consume(code) {
    const had = this.pressedOnce.has(code);
    this.pressedOnce.delete(code);
    return had;
  }

  read(dt) {
    const k = (c) => this.keys.has(c);
    const decay = Math.exp(-dt / 0.14);
    this.vs.x *= decay;
    this.vs.y *= decay;
    const inp = emptyInput();
    inp.move.x = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0);
    inp.move.y = (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0);
    const m = Math.hypot(inp.move.x, inp.move.y);
    if (m > 1) { inp.move.x /= m; inp.move.y /= m; }
    inp.lead = this.mouse.left;
    inp.rear = this.mouse.right;
    inp.rearWeight = k('ShiftLeft') || k('ShiftRight') ? 1 : 0;
    inp.stick = { x: this.vs.x, y: this.vs.y };
    inp.guard = k('Space');
    inp.guardStick = inp.guard ? { x: this.vs.x, y: this.vs.y } : { x: 0, y: 0 };
    inp.feint = k('KeyV');
    inp.level = k('KeyC') ? 1 : 0;
    inp.head.x = (k('KeyE') ? 1 : 0) - (k('KeyQ') ? 1 : 0);
    inp.head.y = (k('KeyF') ? 1 : 0) - (k('KeyR') ? 1 : 0);
    return inp;
  }
}

// ---------- 게임패드 ----------
export class Pad {
  constructor(index) {
    this.index = index;
    this.prevButtons = [];
    this.handT = 0;
  }

  get pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    return pads[this.index] || null;
  }

  get connected() { return !!this.pad; }

  // 버튼이 이번 프레임에 눌렸는가 (메뉴용)
  pressed(i) {
    const p = this.pad;
    if (!p) return false;
    const now = !!(p.buttons[i] && p.buttons[i].pressed);
    return now && !this.prevButtons[i];
  }

  anyPressed() {
    const p = this.pad;
    if (!p) return false;
    return p.buttons.some((b, i) => b.pressed && !this.prevButtons[i]);
  }

  endFrame() {
    const p = this.pad;
    this.prevButtons = p ? p.buttons.map((b) => b.pressed) : [];
  }

  read(dt) {
    const inp = emptyInput();
    const p = this.pad;
    if (!p) return inp;
    const ax = (i) => p.axes[i] || 0;
    const bv = (i) => (p.buttons[i] ? p.buttons[i].value : 0);
    const bp = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
    const L = dead(ax(0), -ax(1));
    const R = dead(ax(2), -ax(3));
    inp.move = L;
    inp.lead = bp(5);
    const rt = bv(7);
    inp.rear = rt > 0.15;
    inp.rearWeight = Math.max(0, Math.min(1, (rt - 0.15) / 0.8));
    inp.guard = bp(4);
    inp.level = Math.max(0, Math.min(1, (bv(6) - 0.1) / 0.8));
    inp.feint = bp(2);
    inp.stick = R;
    // 오른쪽 스틱은 상황에 따라 역할이 바뀐다: 손 버튼 → 궤도, LB → 가드 위치, 그 외 → 상체
    if (inp.lead || inp.rear) this.handT = 0.15;
    this.handT = Math.max(0, this.handT - dt);
    if (inp.guard) inp.guardStick = R;
    else if (this.handT <= 0) inp.head = R;
    return inp;
  }
}

export function mergeInputs(a, b) {
  const c = (x) => Math.max(-1, Math.min(1, x));
  const pick = (u, v) => (Math.hypot(u.x, u.y) >= Math.hypot(v.x, v.y) ? u : v);
  return {
    move: { x: c(a.move.x + b.move.x), y: c(a.move.y + b.move.y) },
    lead: a.lead || b.lead,
    rear: a.rear || b.rear,
    rearWeight: Math.max(a.rearWeight, b.rearWeight),
    stick: pick(a.stick, b.stick),
    head: pick(a.head, b.head),
    guard: a.guard || b.guard,
    guardStick: pick(a.guardStick, b.guardStick),
    level: Math.max(a.level, b.level),
    feint: a.feint || b.feint,
  };
}
