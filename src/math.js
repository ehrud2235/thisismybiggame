// 시뮬레이션 전용 벡터 연산. three.js에 의존하지 않는다 (시뮬은 렌더와 분리).

export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const copy = (a) => ({ x: a.x, y: a.y, z: a.z });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const addScaled = (a, b, s) => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const len = (a) => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
export const dist = (a, b) => len(sub(a, b));
export const norm = (a) => {
  const l = len(a);
  return l > 1e-9 ? scale(a, 1 / l) : v3(0, 0, 1);
};
export const lerp = (a, b, t) => a + (b - a) * t;
export const lerpV = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const smooth = (t) => t * t * (3 - 2 * t);

// y축 회전. three.js의 rotation.y와 같은 방향.
export const rotY = (a, ang) => {
  const c = Math.cos(ang), s = Math.sin(ang);
  return { x: a.x * c + a.z * s, y: a.y, z: -a.x * s + a.z * c };
};

// 선수 로컬 좌표: 원점 = 선수 발밑, +z = 상대 방향, +x = 선수의 오른쪽, +y = 위
export const toWorld = (local, pos, yaw) => {
  const r = rotY(local, yaw);
  return { x: r.x + pos.x, y: r.y, z: r.z + pos.z };
};
export const toLocal = (world, pos, yaw) => rotY({ x: world.x - pos.x, y: world.y, z: world.z - pos.z }, -yaw);
export const dirToLocal = (d, yaw) => rotY(d, -yaw);

export const bezier = (p0, p1, p2, p3, u) => {
  const a = 1 - u;
  const b0 = a * a * a, b1 = 3 * a * a * u, b2 = 3 * a * u * u, b3 = u * u * u;
  return {
    x: p0.x * b0 + p1.x * b1 + p2.x * b2 + p3.x * b3,
    y: p0.y * b0 + p1.y * b1 + p2.y * b2 + p3.y * b3,
    z: p0.z * b0 + p1.z * b1 + p2.z * b2 + p3.z * b3,
  };
};

export const bezierLength = (p0, p1, p2, p3, n = 12) => {
  let total = 0, prev = p0;
  for (let i = 1; i <= n; i++) {
    const p = bezier(p0, p1, p2, p3, i / n);
    total += dist(p, prev);
    prev = p;
  }
  return total;
};

// 점과 선분 사이 거리
export const pointSegDist = (p, a, b) => {
  const ab = sub(b, a);
  const t = clamp(dot(sub(p, a), ab) / Math.max(1e-9, dot(ab, ab)), 0, 1);
  return dist(p, addScaled(a, ab, t));
};

// 2본 IK. 어깨와 손 위치로 팔꿈치를 구한다.
// 손이 팔 길이보다 멀면 어깨를 손 쪽으로 끌어당긴다 (최대 0.15m).
export const solveArm = (shoulder, hand, upper, lower, pole) => {
  const reach = upper + lower;
  let sh = shoulder;
  let d = dist(sh, hand);
  if (d > reach * 0.995) {
    const pull = Math.min(0.15, d - reach * 0.995);
    sh = addScaled(sh, norm(sub(hand, sh)), pull);
    d = dist(sh, hand);
  }
  d = clamp(d, 0.05, reach * 0.999);
  const dir = norm(sub(hand, sh));
  const a = (upper * upper - lower * lower + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, upper * upper - a * a));
  let p = sub(pole, scale(dir, dot(pole, dir)));
  if (len(p) < 1e-6) p = v3(0, -1, 0);
  p = norm(p);
  return { shoulder: sh, elbow: addScaled(addScaled(sh, dir, a), p, h) };
};

// 감쇠 스프링 한 축
export const springStep = (s, k, c, dt) => {
  s.v += (-k * s.x - c * s.v) * dt;
  s.x += s.v * dt;
};
