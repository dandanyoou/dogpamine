# TODOS — dogpamine

## Completed

- [x] **Sparse inject 구현 완료 (v0.3.0)** — content.js +110 line (state 4 fields + hydrateInjectionState + onVideoBecameVisible + triggerSparseInject + pickPendingInjectId + C2 guard at maybeAdvanceStage + IO enter branch hook + Ctrl+Shift+G handler). 디자인 doc v3 (test-main-design-sparse-inject-20260519-174901.md) Assignment 10 step 전부 반영. eng review 4 결정 (Ctrl+Shift+G, justInjected EXIT clear, C2 guard at maybeAdvanceStage 첫 줄, manual test 전략) 코드에 lock.

## sparse inject 관찰 항목 (Phase 3 후속)

- [ ] **`RECENT_JUMP_MAX` 5 → 8 고려** — sparse inject 가 STOP→curated jump 와 같은 5-slot recentJumps 큐 공유. 시연 중 동일 카테고리/출처 비디오가 연속 inject 되는 게 보이면 한 줄 수정 (`extension/content.js:281`).
  - **Why:** `pickCuratedShort` 가 매번 recentJumps 에 push. sparse inject 가 빈도 높으면 5-slot 큐 빠르게 소진 → 중복 회피 효과 감소.
  - **Files:** `extension/content.js:281` (`const RECENT_JUMP_MAX = 5`)
  - **Trigger:** 시연 리허설 또는 실사용 중 동일 출처 영상 연속 inject 관찰.
  - **Effort:** ~1 line + 시연 1회 검증.

## Phase 3 후속 (README 명시)

- [ ] **IG sparse inject** — curated.json 에 `instagram` 카테고리 추가, host gate 완화 (현재 `if (site.name !== 'YouTube') return`).
- [ ] **TikTok web (`/foryou`) 어댑터** — SITE_CONFIG 에 항목 추가.
- [ ] **`chrome.storage.local` 일간 통계** — sparse inject 발생 횟수 + 사용자 swipe 패턴 기록 → popup 라이브 그래프.
- [ ] **셀렉터 자동 자가 진단** — 30초간 measured=0 시 popup 빨간등.
- [ ] **Chrome Web Store 배포** — 아이콘 4종, 스크린샷 5장, 프라이버시 정책.
- [ ] **영어 popup / README**.
- [ ] **Sparse inject Silent → Visible 전환 검토 (Phase 3)** — P4 ethical decision 재방문. 실사용자 피드백 수집 후 결정.
