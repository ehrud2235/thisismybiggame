// 모든 튜닝 값. 기획 문서(docs/phase0-spec.md)의 시작값을 그대로 옮겼다.
// 디버그 패널(` 키)에서 게임을 끄지 않고 바꿀 수 있다.

export const CFG = {
  // 이동
  moveSpeed: 2.3,
  strafeSpeed: 1.9,
  accelTime: 0.08,
  ringRadius: 4.5,
  minSeparation: 0.62,

  // 주먹
  punchBaseTime: 0.05,   // 궤도 길이와 무관한 고정 시간
  punchSpeed: 5.0,       // m/s. 출발→타격 시간 = base + 궤도길이 / speed
  windupMax: 0.12,       // 체중 최대일 때 준비 동작 시간
  windupVisual: 1.0,     // 준비 동작이 몸에 드러나는 크기 (가장 먼저 조정할 값)
  commitPoint: 0.35,     // 이 비율을 넘으면 되돌릴 수 없다
  feintDepth: 0.3,       // 페인트가 궤도의 어디까지 나갔다 돌아오는가
  retractFactor: 0.8,
  tracking: 6.0,         // 커밋 전 목표 추적 속도
  reachStretch: 0.10,
  flowWindow: 0.45,
  flowSpeedBonus: 0.30,
  flowSpeedPenalty: 0.20,
  flowWeightBonus: 0.2,
  overextendTime: 0.35,
  slipLoadWeight: 0.6,   // 슬립한 쪽 손에 준비 없이 실리는 체중
  freeWeightCap: 0.6,    // 준비 동작 없이 얻는 체중의 상한

  // 방어
  guardBlockMult: 0.15,
  tightGuardBlockMult: 0.05,
  tightGuardDelay: 0.05,
  guardShakeTime: 0.2,
  headMoveTime: 0.12,
  slipDist: 0.2,
  duckDist: 0.26,
  leanDist: 0.16,

  // 데미지
  unseenWindow: 0.25,
  unseenMult: 2.0,
  counterMult: 1.5,
  weightMultMax: 1.6,
  multCap: 4.0,
  chinBase: 36,
  chinMin: 8,
  chinLossPer10: 0.5,
  rockedRatio: 0.75,
  downRatio: 1.0,
  koRatio: 1.6,
  rockedTime: 3.0,
  rotationalKoBonus: 0.25,
  upperDuckMult: 1.3,
  liverThreshold: 20,
  liverDelay: 0.5,

  // 스태미나
  staminaMax: 100,
  punchCostMin: 3,
  punchCostMax: 8,
  missCostMult: 1.5,
  feintCost: 1,
  headMoveCost: 2,
  staminaRegen: 8,
  tiredThreshold: 25,

  // 다운
  getUpMin: 2,
  getUpMax: 4,
  downsForTKO: 2,

  // 손맛
  hitstopClean: 0.045,
  hitstopLight: 0.025,
  roundTime: 180,
  replaySpeed: 0.35,
};

// 디버그 패널에 노출할 값: [키, 최소, 최대, 스텝, 이름]
export const TUNABLES = [
  ['windupVisual', 0, 3, 0.05, '준비 동작 크기'],
  ['windupMax', 0, 0.3, 0.01, '준비 동작 시간'],
  ['punchSpeed', 2, 10, 0.1, '주먹 속도'],
  ['punchBaseTime', 0, 0.15, 0.005, '주먹 고정 시간'],
  ['commitPoint', 0.1, 0.9, 0.01, '커밋 지점'],
  ['tracking', 0, 20, 0.5, '목표 추적'],
  ['reachStretch', 0, 0.3, 0.01, '사거리 보정'],
  ['flowSpeedBonus', 0, 0.6, 0.01, '흐름 연결 보너스'],
  ['flowSpeedPenalty', 0, 0.6, 0.01, '흐름 끊김 페널티'],
  ['overextendTime', 0, 1, 0.01, '헛침 쏠림'],
  ['unseenWindow', 0.05, 0.6, 0.01, '못 본 주먹 판정 창'],
  ['unseenMult', 1, 4, 0.05, '못 본 주먹 배율'],
  ['counterMult', 1, 3, 0.05, '카운터 배율'],
  ['weightMultMax', 1, 2.5, 0.05, '체중 최대 배율'],
  ['chinBase', 5, 50, 0.5, '턱 기준'],
  ['rockedRatio', 0.2, 1, 0.01, '흔들림 비율'],
  ['koRatio', 1, 4, 0.05, 'KO 비율'],
  ['staminaRegen', 0, 30, 0.5, '스태미나 회복'],
  ['moveSpeed', 1, 5, 0.1, '이동 속도'],
  ['hitstopClean', 0, 0.15, 0.005, '히트스톱'],
  ['roundTime', 30, 600, 10, '라운드 시간'],
];

// 몸 치수 (m). 오서독스 기준, 왼손이 앞손.
export const ANAT = {
  upperArm: 0.31,
  foreArm: 0.39,
  shoulderHalf: 0.2,
  hipHalf: 0.1,
  thigh: 0.45,
  shin: 0.45,
  pelvisH: 0.9,
  chestH: 1.34,
  neckH: 1.52,
  headH: 1.66,
  levelDrop: 0.32,
  blade: 0.42,
  guardLead: { x: -0.10, y: 1.47, z: 0.30 },
  guardRear: { x: 0.12, y: 1.46, z: 0.17 },
  tightLead: { x: -0.07, y: 1.53, z: 0.19 },
  tightRear: { x: 0.08, y: 1.52, z: 0.14 },
  head: { x: 0.03, y: 1.66, z: 0.04 },
  footLead: { x: -0.13, z: 0.24 },
  footRear: { x: 0.16, z: -0.22 },
  headR: 0.115,
  gloveR: 0.07,
  fistR: 0.06,
  forearmR: 0.045,
  torsoR: 0.17,
};
