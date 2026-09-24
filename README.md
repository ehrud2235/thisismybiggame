# thisismybiggame

> 주변의 모든 물건을 무기로 만들어 연쇄적인 사고와 파괴를 일으키는 Physics Action Roguelite.

**집는다 → 던진다 → 부딪힌다 → 연쇄가 발생한다.**

## 지금 단계

**Phase 0 — 코어 검증.** 방 1개, 물체 3종, 적 1종. 재미가 검증되기 전에는 다른 것을 만들지 않는다.

## 문서

| 문서 | 내용 | 읽는 사람 |
|---|---|---|
| [docs/design-review.md](docs/design-review.md) | 확정된 결정, 전체 일정, 페이즈별 Kill Gate | 모두 |
| [docs/phase0-spec.md](docs/phase0-spec.md) | Phase 0 상세: 조작, 물체, 적, 수치, 테스트 방법 | 개발 AI |
| [docs/visual-direction.md](docs/visual-direction.md) | 비주얼 방향: 톤, 색 언어, 모션 과장, 폭발 연출 | 개발 AI |

## 역할

- **기획 AI:** 무엇을, 왜 만드는가. 재미 구조, 시스템, 밸런스, 수치 시작값
- **개발 AI:** 어떻게 만드는가. 엔진, 구조, 구현

기획 문서의 수치는 전부 시작값이다. 플레이테스트 결과에 따라 바뀐다.

## 판정 기준

방 하나에서 물건 하나를 던졌는데 예상보다 훨씬 큰 사고가 났을 때, **"씨발 뭐야 ㅋㅋ 한 번 더 해봐야겠다"**가 나오는가.
