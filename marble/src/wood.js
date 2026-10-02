// 원목·우주 배경 텍스처. 픽셀 단위로 한 번만 만들어 두고 렌더에서 이미지로 쓴다.
// 고정 시드라서 새로고침해도 같은 판이 나온다.

export function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 값 노이즈 (0~1)
function makeNoise(seed) {
  const rand = rng(seed);
  const perm = new Uint8Array(512), val = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; val[i] = rand(); }
  for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const X = xi & 255, Y = yi & 255;
    const a = val[perm[X + perm[Y]]], b = val[perm[X + 1 + perm[Y]]];
    const c = val[perm[X + perm[Y + 1]]], d = val[perm[X + 1 + perm[Y + 1]]];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

function fbm(n, x, y) {
  return (n(x, y) * 0.5 + n(x * 2.03, y * 2.03) * 0.25 + n(x * 4.11, y * 4.11) * 0.125) / 0.875;
}

const mix = (a, b, t) => a + (b - a) * t;

// 결이 x 방향으로 흐르는 나무 한 픽셀. 반환: 0(밝은 춘재) ~ 1(진한 추재) 정도의 어둡기와 무늬 값
function grain(n, x, y, s, spacing, warpAmp) {
  // 결이 x를 따라 완만하게 휘고(warp), 군데군데 산 모양(무늬결)으로 솟는다
  const warp = fbm(n, x * 0.0028 + s * 3.1, y * 0.012 + s * 1.7) * warpAmp
    + Math.pow(fbm(n, x * 0.0011 + s * 9, s * 2.3), 2) * warpAmp * 1.6;
  const t = y / spacing + warp + s * 4.3;
  const d = t - Math.floor(t);
  const late = d * d * d * d * d * d * d * d * d;               // 나이테 끝이 얇고 진하게
  const fiber = n(x * 0.05 + s * 11, y * 0.55 + s * 5) - 0.5;   // 결 방향으로 길쭉한 잔결
  const figure = fbm(n, x * 0.0014 + s * 7, y * 0.009 + s) - 0.5; // 큰 색 얼룩
  return [late, fiber, figure];
}

// 판 바닥: 길게 이어 붙인 원목 띠 (엣지 글루 집성판)
export function makeFloor(w, h, k, seed) {
  const W = Math.ceil(w * k), H = Math.ceil(h * k);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const img = g.createImageData(W, H);
  const px = img.data;
  const n = makeNoise(seed);
  const rand = rng(seed + 1);
  const strips = 7, sh = h / strips;
  const info = Array.from({ length: strips }, () => ({
    s: rand() * 10,
    spacing: 13 + rand() * 13,
    warp: 1.4 + rand() * 1.8,
    tone: (rand() - 0.5) * 0.16,     // 띠마다 조금씩 다른 색
    red: (rand() - 0.5) * 10,
  }));
  // 밝은 메이플~허니 오크
  const L = [236, 205, 158], M = [214, 172, 118], D = [158, 108, 62];
  let i = 0;
  for (let py = 0; py < H; py++) {
    const y = py / k;
    const si = Math.min(strips - 1, Math.floor(y / sh));
    const ly = y - si * sh;
    const st = info[si];
    const seam = ly < 0.9 ? 0.32 : ly < 1.8 ? -0.06 : 0;    // 접착선과 그 옆 하이라이트
    for (let pxi = 0; pxi < W; pxi++) {
      const x = pxi / k;
      const [late, fiber, figure] = grain(n, x, ly + si * 37, st.s, st.spacing, st.warp);
      const base = Math.min(1, Math.max(0, 0.45 + figure * 1.3 + st.tone + late * 0.25));
      const dark = Math.min(1, late * 0.42 + Math.max(0, fiber) * 0.1 + seam);
      for (let c = 0; c < 3; c++) {
        let v = mix(mix(L[c], M[c], base), D[c], dark) + fiber * 6;
        if (c === 0) v += st.red;
        px[i + c] = v;
      }
      px[i + 3] = 255;
      i += 4;
    }
  }
  g.putImageData(img, 0, 0);
  return cv;
}

// 호두나무 띠: 테두리와 블록에 쓴다. 결이 x 방향
export function makeWalnut(w, h, k, seed) {
  const W = Math.ceil(w * k), H = Math.ceil(h * k);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const img = g.createImageData(W, H);
  const px = img.data;
  const n = makeNoise(seed);
  const L = [128, 86, 56], M = [96, 62, 40], D = [48, 29, 18];
  let i = 0;
  for (let py = 0; py < H; py++) {
    const y = py / k;
    for (let pxi = 0; pxi < W; pxi++) {
      const x = pxi / k;
      const [late, fiber, figure] = grain(n, x, y, 2.7, 7.5, 1.6);
      const base = Math.min(1, Math.max(0, 0.5 + figure * 1.4 + late * 0.3));
      const dark = Math.min(1, late * 0.6 + Math.max(0, fiber) * 0.18);
      for (let c = 0; c < 3; c++) px[i + c] = mix(mix(L[c], M[c], base), D[c], dark) + fiber * 10;
      px[i + 3] = 255;
      i += 4;
    }
  }
  g.putImageData(img, 0, 0);
  return cv;
}

// 나무 말뚝 윗면: 동심원 나이테 (마구리면)
export function makeEndGrain(r, k, seed) {
  const S = Math.ceil(r * 2 * k);
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const g = cv.getContext('2d');
  const img = g.createImageData(S, S);
  const px = img.data;
  const n = makeNoise(seed);
  const ox = r * 0.86, oy = r * 1.1;  // 심이 살짝 중심에서 벗어나 있다
  let i = 0;
  for (let py = 0; py < S; py++) {
    for (let pxi = 0; pxi < S; pxi++) {
      const x = pxi / k, y = py / k;
      const dx = x - ox, dy = y - oy;
      const d = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const t = d / 2.1 + fbm(n, Math.cos(a) * 2 + 5, Math.sin(a) * 2 + d * 0.05) * 1.4;
      const f = t - Math.floor(t);
      const late = f * f * f * f * f;
      const crack = n(a * 6, d * 0.4) > 0.93 ? 0.25 : 0;
      const edge = Math.max(0, (Math.hypot(x - r, y - r) / r - 0.82) * 2.2);
      const dark = Math.min(1, late * 0.55 + crack + edge * 0.5);
      px[i] = mix(176, 92, dark); px[i + 1] = mix(126, 58, dark); px[i + 2] = mix(78, 34, dark);
      px[i + 3] = 255;
      i += 4;
    }
  }
  g.putImageData(img, 0, 0);
  return cv;
}

// 우주 배경: 성운 + 별. 화면 크기로 만든다
export function makeSpace(W, H, dpr) {
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const sky = g.createLinearGradient(0, 0, W * 0.3, H);
  sky.addColorStop(0, '#060814');
  sky.addColorStop(1, '#03040a');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  const rand = rng(4242);
  const nebula = [[88, 70, 190, 0.22], [30, 120, 150, 0.14], [160, 60, 140, 0.12], [60, 90, 200, 0.16]];
  for (let j = 0; j < 9; j++) {
    const [r, gg, b, a] = nebula[j % nebula.length];
    const x = rand() * W, y = rand() * H, rad = (0.25 + rand() * 0.45) * Math.max(W, H);
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, `rgba(${r}, ${gg}, ${b}, ${a * (0.5 + rand() * 0.5)})`);
    grad.addColorStop(1, `rgba(${r}, ${gg}, ${b}, 0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
  }
  const count = Math.floor((W * H) / (1500 * dpr * dpr));
  for (let j = 0; j < count; j++) {
    const x = rand() * W, y = rand() * H;
    const big = rand() < 0.04;
    const s = (big ? 1.2 + rand() * 1.2 : 0.35 + rand() * 0.7) * dpr;
    const tint = rand();
    const col = tint < 0.15 ? '255, 220, 190' : tint < 0.35 ? '190, 210, 255' : '255, 255, 255';
    if (big) {
      const glow = g.createRadialGradient(x, y, 0, x, y, s * 5);
      glow.addColorStop(0, `rgba(${col}, 0.35)`);
      glow.addColorStop(1, `rgba(${col}, 0)`);
      g.fillStyle = glow;
      g.fillRect(x - s * 5, y - s * 5, s * 10, s * 10);
    }
    g.fillStyle = `rgba(${col}, ${big ? 1 : 0.35 + rand() * 0.55})`;
    g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill();
  }
  return cv;
}
