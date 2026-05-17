# Dogpamine 🐶

> 내가 켜고 끄는 영상 자기제어 익스텐션

오늘은 적게 봐야지, 라고 결심한 사람을 위한 도구. 강제 차단도, 몰래 감시도 아님. **본인이 켤 때만** 작동하고, **본인이 끄면** 끝.

---

## 왜 만들었나

스크린타임 제한은 알림 무시하고 계속 봄. 의지력은 작동 안 함. 앱 삭제는 3일 후 재설치. 전부 사용자와 싸우는 방식.

Dogpamine 은 **사용자가 결정해서 켜고**, 켜져 있는 동안 영상 사이트의 화면 채도를 단계적으로 빠뜨려서 **자연스럽게 매력이 떨어지게** 만든다. 사용자는 통제당한다는 느낌 없이 폰을 내려놓는다.

핵심은 **본인 결정**:

- "오늘은 좀 적게 봐야겠다" → 익스텐션 켜기
- 좀 보다가 그만 → 끄기
- 5분만 잠깐 → 일시정지
- 자정에 자동 OFF, 또는 1시간 후 자동 OFF — 본인이 처음에 선택

---

## 작동 방식

### 켜졌을 때 보이는 것

YouTube Shorts 또는 Instagram Reels 에서 빠르게 스크롤하면, **화면 채도가 단계적으로 빠진다**.

| 단계 | 채도 | 트리거 (평균 체류) |
|---|---|---|
| FRESH | 100% | (시작) |
| WARMING | 90% | < 6초 |
| DRIFTING | 75% | < 4초 |
| FADING | 60% | < 3초 |
| QUIETING | 45% | < 2초 |
| STOP | 35% | < 1.5초 + 풀스크린 카드 |

마지막 단계에서 풀스크린 카드가 한 번 뜬다 — "도움이 되었길 바라요, 잠깐 쉬어볼까요?" 닫기 누르면 채도는 유지된 채 카드만 사라짐. 같은 세션에 또 안 뜸.

### 측정 방식 — 포만감 알고리즘

영상마다 화면에 머무른 시간을 측정한다 (체류 시간). 최근 5개 영상의 평균이 임계값 밑으로 떨어지면 단계 진행. 단방향 — 한 번 진행한 단계는 안 되돌아감.

```
포만감 알고리즘 (단순화):
  평균 체류 < 6초 → WARMING
  평균 체류 < 4초 → DRIFTING
  ...
  평균 체류 < 1.5초 → STOP
```

AI 모델 아님. 행동 패턴 감지 (behavioral). 데이터는 이 기기에만 저장됨, 어디로도 안 보냄.

### 켜고 끄는 방식

도구바의 익스텐션 아이콘 클릭 → popup 등장 → 토글 + 세션 모드 선택:

| 세션 | 의미 |
|---|---|
| 지금만 | 모든 YT/IG 탭 닫으면 자동 OFF |
| 오늘 종일 | 한국 시간 자정까지 |
| 1시간 | 지금부터 1시간 후 |

세션 모드에 따라 자동 OFF 시점이 결정됨. 중간에 끄고 싶으면 토글 OFF 한 번이면 즉시 정상 색 복원.

---

## 설치 (개발자 모드, 1회)

> Chrome Web Store 미배포 — 해커톤 프로젝트라 심사 시간 안 맞음. Phase 3 에서 배포 예정.

1. 이 repo 를 clone:
   ```bash
   git clone https://github.com/dandanyoou/dogpamine.git
   cd dogpamine
   ```
2. Chrome 주소창에 `chrome://extensions` → Enter
3. 우측 상단 **"개발자 모드"** 토글 ON
4. **"압축해제된 확장 프로그램을 로드합니다"** 클릭 → `dogpamine/extension/` 폴더 선택
5. 익스텐션 목록에 핑크 강아지 아이콘 "Dogpamine" 카드 등장 → 성공
6. (선택) 도구바 퍼즐 아이콘 → 핀 아이콘 클릭으로 도구바에 고정

---

## 사용

### 시연용 빠른 데모

1. 도구바 아이콘 클릭 → popup 열림
2. 토글 ON → 세션 "오늘 종일" 또는 "1시간" 선택
3. YouTube Shorts (`youtube.com/shorts/`) 또는 Instagram Reels (`instagram.com/reels/`) 방문
4. 처음 6-8초는 영상 시청 (popup 의 "평균 체류" 가 올라감)
5. 이제 빠르게 스크롤 → 1-2초씩만 머무름 → popup 의 단계 라벨이 WARMING → DRIFTING → ... 으로 진행
6. 동시에 화면 전체 채도가 점점 빠짐 (2초 cubic-bezier transition)
7. STOP 도달 시 풀스크린 카드 한 번 → "알겠어요" 클릭
8. 만족했으면 popup 다시 → 토글 OFF → 즉시 정상 색

### popup 의 모든 상태

| 상태 | 언제 | 보이는 것 |
|---|---|---|
| loading | 처음 popup 열린 직후 0.1초 | "상태 불러오는 중…" |
| off | 토글 꺼짐 (기본값) | 토글 + 켜면 작동 설명 |
| on | 토글 켜짐 | 토글 + 세션 라디오 + 자세히(접힘) + 5분 멈추기 |
| paused | "5분 잠깐 멈추기" 누름 | 카운트다운 + "지금 재개" 버튼 |
| error | YT/IG 아닌 페이지에서 popup 클릭 | "이 페이지는 지원 안돼요" + 지원 사이트 링크 |

---

## 시연 (발표 가이드, 2분 30초)

| 시각 | 화면 | 멘트 | 결과 |
|---|---|---|---|
| 0:00–0:20 | popup → 토글 ON + 오늘 종일 | "Dogpamine 이에요. 제가 결정해서 켜는 거예요. 오늘 종일 모드." | popup OFF → ON |
| 0:20–0:45 | YT Shorts 첫 영상 6-8초씩 | "처음엔 일반 시청. 평균 7초 체류." | popup 평균 체류 ~7초 |
| 0:45–1:30 | 빠르게 스크롤 (1-2초/영상) | "이제 흥미 떨어진 척, 빠르게. 보세요 — popup 평균 체류가 2초로 떨어졌고, 화면 채도가 점점 빠져요. 포만감 알고리즘이에요. AI 아니라, 행동 패턴 감지." | 단계 WARMING → STOP, 채도 90→35% |
| 1:30–2:00 | STOP 카드 | "마지막 단계에 한 번 카드가 뜸. '도움이 되었길 바라요. 잠깐 쉬어볼까요?' 닫아도 채도는 유지. 본인 통제권 그대로." | 풀스크린 카드 + 닫기 |
| 2:00–2:30 | popup → 토글 OFF | "내가 결정해서 꺼요. 즉시 정상 색 복원." | 채도 100% 즉시 |

백업 영상은 D-1 에 YT + IG 시나리오 각각 QuickTime 으로 녹화 (`~/Desktop/dogpamine-demo-yt.mp4`, `dogpamine-demo-ig.mp4`).

---

## 기술 스택

| 영역 | 선택 |
|---|---|
| 코어 | Manifest V3 + vanilla JavaScript (빌드 도구 없음) |
| 상태 저장 | `chrome.storage.local` (이 기기에만, 동기화 없음) |
| 자동 만료 | `chrome.alarms` (오늘 종일 / 1시간 모드) |
| 측정 | `IntersectionObserver` (체류 시간) + `MutationObserver` (동적 비디오 추가 감지) |
| popup | HTML/CSS, Pretendard 시스템 fallback, design tokens |
| 알고리즘 | 규칙 기반 임계값 (ML 모델 아님) |

---

## 파일 구조

```
extension/
  manifest.json        MV3, popup + matches YT/IG + permissions
  background.js        SW: alarms 등록, onMessage, onStartup, onTabRemoved
  content.js           SITE_CONFIG + dwell 측정 + 단계 진행 + 오버레이
  overlay.css          STOP 카드 스타일 (backdrop blur + spring-in)
  popup.html           5-state UI
  popup.css            디자인 시스템 (#FF6A88 핑크, Pretendard, WCAG AA)
  popup.js             storage-driven state machine
  lib/session.js       KST 자정 / expiry 계산 (popup + bg 공유)
  icons/
    icon-16.png        도구바
    icon-48.png        익스텐션 페이지
    icon-128.png       Chrome Web Store (배포 시)
```

---

## 로드맵

### ✅ Phase 1 — Instagram Reels 채도 페이드 (작동함)
### ✅ Phase 2 — popup UI + YT Shorts 확장 + STOP 오버레이 + 자기제어 모드 (작동함, v0.2.0 = 지금)
### Phase 3 (해커톤 이후)
- TikTok web (`/foryou`) 어댑터
- `chrome.storage.local` 일간 통계 + popup 라이브 그래프
- 셀렉터 자동 자가 진단 (30초 측정 0 시 popup 빨간등)
- Chrome Web Store 배포 (아이콘 4종, 스크린샷 5장, 프라이버시 정책)
- 영어 popup / README

---

## 문제 해결

| 증상 | 원인 | 해결 |
|---|---|---|
| 토글 ON 했는데 채도 안 빠짐 | YT/IG 셀렉터 깨짐 (브라우저 업데이트) | DevTools 콘솔에 `[Dogpamine] tick — measured=` 가 0 으로 정체되면 의심 |
| popup 의 "지원 안됨" 표시 | YT Shorts / IG Reels 가 아닌 페이지 | popup 의 "YouTube Shorts 열기" 링크 클릭 |
| "오늘 종일" 인데 다음 날도 켜져있음 | Chrome 이 자정에 닫혀있었던 케이스 | popup 한 번 열면 자체 검증 + onStartup 도 재검증 — 자동 OFF |
| 시크릿 모드에서 안 됨 | 익스텐션은 시크릿 모드에 별도 허용 필요 | `chrome://extensions` → Dogpamine 세부정보 → "시크릿 모드에서 허용" ON |
| 익스텐션 reload 후에도 STOP 카드 남아있음 | 매우 드문 케이스 | 페이지 새로고침 (`F5`) |

---

## 기여 / 피드백

해커톤 프로젝트라 구조가 빠르게 바뀔 수 있어요. PR / Issue 환영.

새 사이트 어댑터 추가는 `extension/content.js` 의 `SITE_CONFIG` 객체에 한 항목 추가하면 끝:

```js
'tiktok.com': {
  urlPattern: /\/foryou/,
  videoSelector: '[data-e2e="recommend-list-item-container"] video',
  mutationRoot: () => document.body,
  name: 'TikTok',
}
```

+ `manifest.json` 의 `content_scripts.matches` 와 `host_permissions` 에 도메인 추가.

---

## 한 줄

> 알고리즘과 싸우지 않고, **포만감 알고리즘**이 영상의 매력을 천천히 빠뜨림. 켜고 끄는 건 본인 결정.
