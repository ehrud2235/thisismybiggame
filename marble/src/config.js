// 구슬치기 튜닝 값. 디버그 패널(` 키)에서 게임을 끄지 않고 바꿀 수 있다.
// 거리는 판 좌표(px, 판 하나가 1000×640), 시간은 초.

export const CFG = {
  // 발사
  maxSpeed: 1500,        // 끝까지 당겼을 때 첫 속도 (px/s)
  maxPull: 170,          // 이만큼 끌면 최대 힘 (화면 CSS px. 판 배율과 무관하게 손가락 거리 기준)
  minPower: 0.06,        // 이보다 약하게 놓으면 발사 취소
  powerCurve: 1.35,      // 1보다 크면 약한 샷을 더 세밀하게 조절할 수 있다

  // 구름
  rollDecel: 240,        // 속도와 무관하게 깎이는 감속 (px/s²). 흙바닥의 구름 저항
  linearDamp: 0.55,      // 속도에 비례해 깎이는 감속 (1/s). 빠를수록 많이 깎인다
  stopSpeed: 7,          // 이보다 느리면 멈춘 것으로 본다

  // 충돌
  wallRestitution: 0.72, // 판자 반발. 1이면 속도 그대로 튕긴다
  wallFriction: 0.08,    // 판자에 긁히며 잃는 접선 속도 비율
  bounceMin: 24,         // 이보다 느리게 부딪히면 튕기지 않고 미끄러진다
  postRestitution: 0.6,  // 말뚝 반발
  marbleRestitution: 0.93,

  // 보조
  guideTime: 0.45,       // 조준선이 미리 보여주는 시간. 스테이지가 올라가면 줄일 수 있다
};

// [키, 최소, 최대, 간격, 이름]
export const TUNABLES = [
  ['maxSpeed', 500, 3000, 50, '최대 속도'],
  ['maxPull', 80, 320, 5, '최대 당김'],
  ['powerCurve', 0.6, 2.5, 0.05, '힘 곡선'],
  ['rollDecel', 0, 800, 10, '구름 저항'],
  ['linearDamp', 0, 2, 0.05, '속도 감쇠'],
  ['wallRestitution', 0.1, 1, 0.01, '판자 반발'],
  ['wallFriction', 0, 0.5, 0.01, '판자 마찰'],
  ['postRestitution', 0.1, 1, 0.01, '말뚝 반발'],
  ['marbleRestitution', 0.5, 1, 0.01, '구슬끼리 반발'],
  ['guideTime', 0, 1.5, 0.05, '조준선 길이'],
];
