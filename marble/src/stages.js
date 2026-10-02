// 스테이지 정의. 판 좌표는 1000×640, 원점은 왼쪽 위.
// marbles[0]이 플레이어 구슬이다. 나머지는 밀려나는 구슬.
//
// goal.need
//   'touch'  : 목표 원에 조금이라도 걸치면 통과
//   'inside' : 구슬 전체가 원 안에 들어가야 통과
//
// walls 는 나무 블록(회전한 직사각형): 중심 cx, cy · 길이 len · 두께 thick · 각도 deg
// posts 는 둥근 나무 말뚝: x, y, r

export const BOARD = { w: 1000, h: 640 };

export const STAGES = [
  {
    id: 1,
    shots: 3,
    marbleR: 14,
    goal: { x: 835, y: 330, r: 62, need: 'touch' },
    walls: [
      { cx: 500, cy: 320, len: 260, thick: 24, deg: 90 },  // 가운데 블록
      { cx: 705, cy: 140, len: 120, thick: 20, deg: 35 },  // 원 위쪽을 가리는 비스듬한 블록
      { cx: 710, cy: 525, len: 110, thick: 20, deg: -30 }, // 원 아래쪽 비스듬한 블록
    ],
    posts: [
      { x: 320, y: 140, r: 16 },
      { x: 320, y: 500, r: 16 },
    ],
    marbles: [
      { kind: 'player', x: 150, y: 320 },
      { kind: 'green', x: 735, y: 330 },
      { kind: 'amber', x: 915, y: 470 },
    ],
  },
];
