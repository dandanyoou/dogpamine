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
| WARMING | 82% | < 6초 |
| DRIFTING | 60% | < 4초 |
| FADING | 40% | < 3초 |
| QUIETING | 22% | < 2초 |
| STOP | 8% (거의 흑백) | < 1.5초 + 풀스크린 카드 |

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

### 시연용 단축키 — `Ctrl+Shift+S`

영상 녹화 시 자연 스크롤만으로는 단계 진행이 청중에게 안 보일 수 있어요. 토글 ON 상태에서 YouTube/Instagram 페이지가 active 일 때 **`Ctrl+Shift+S`** 한 번 = 단계 1개 강제 진행.

- 누를 때마다: FRESH → WARMING → DRIFTING → FADING → QUIETING → STOP (오버레이 등장) → FRESH (리셋, 다시 시작)
- 각 단계 사이 1초씩 채도 transition — 영상 녹화 페이스에 맞게 누르는 간격 조절
- STOP 도달 시 오버레이 자동 표시. "알겠어요" 누르면 채도는 유지된 채 카드만 사라짐. 다음 STOP 진입 시 다시 등장 (cycle 마다 overlayDismissed 리셋됨)

자연 스크롤만으로 시연하면 평균 체류가 임계값 (`< 1.5초` 등) 까지 떨어져야 진행됨. 단축키는 그 트리거를 본인이 직접 컨트롤하게 해줌 — **녹화 영상의 예측 가능성** 보장.

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
### ✅ Phase 2 — popup UI + YT Shorts 확장 + STOP 오버레이 + 자기제어 모드 + STOP 큐레이션 CTA (작동함, v0.2.x)
### ✅ Phase 2.5 — Sparse inject 1:10 silent (v0.3.0 = 지금)
- 토글 ON 상태에서 자연 스크롤 매 10번째 비디오가 우리 curated 영상으로 silent navigate
- 결정론적 카운터 (`chrome.storage.local.injectionCounter`) — page reload 가로질러 유지
- C1: 큐레이션 모드 중엔 카운터 증가 skip
- C2: inject 직후 영상은 채도 stage 진행 X (보상 영상 채도 보존)
- 시연 단축키 `Ctrl+Shift+G` — 단일 sparse inject 강제 트리거 (`S`=채도 단계, `D`=큐레이션 모드 진입, `G`=단일 inject 로 의미 구분)
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

## A부터 Z까지 — 처음 쓰는 분 5분 가이드

위 섹션들 (설치 / 사용 / 시연) 이 흩어져 있어서, **처음 보는 분이 다른 데 안 보고 이거 하나만 따라가도 작동** 까지 가게 정리했어요. 빠진 단계 없이.

**A.** Chrome / Edge / Brave 중 하나 켜기 — MV3 익스텐션이라 Firefox·Safari 는 미지원.
**B.** 이 repo 받기 — `git clone https://github.com/dandanyoou/dogpamine.git` 또는 GitHub 페이지의 **Code → Download ZIP**.
**C.** 받은 폴더는 그대로 둠 — 옮기지 마세요. 익스텐션이 폴더 경로를 기억해서 옮기면 깨져요.
**D.** Chrome 주소창에 `chrome://extensions` → Enter.
**E.** 우측 상단 **개발자 모드** 토글 ON.
**F.** 좌측 상단 **"압축해제된 확장 프로그램을 로드합니다"** 버튼 클릭.
**G.** 받은 폴더 안의 `extension/` *서브폴더* 선택 — `extension/manifest.json` 이 있는 그곳. 상위 폴더 고르면 안 됨.
**H.** 익스텐션 목록에 핑크 강아지 아이콘의 **"Dogpamine"** 카드가 뜨면 설치 성공.
**I.** (선택) 주소창 우측 퍼즐 아이콘 클릭 → Dogpamine 옆 핀 아이콘 ON → 도구바 고정. 다음부터 한 번에 popup 열림.
**J.** 도구바의 Dogpamine 아이콘 클릭 → popup 열림.
**K.** 상단 토글 **ON** (분홍색 점이 오른쪽으로). 이때부터 측정 시작.
**L.** 세션 모드 라디오 하나 선택:
  - **지금만** — YT/IG 탭 다 닫으면 자동 OFF
  - **오늘 종일** — 한국 시간 자정까지
  - **1시간** — 지금부터 60분 후 자동 OFF
**M.** popup 닫고, 새 탭에서 https://www.youtube.com/shorts/ 또는 https://www.instagram.com/reels/ 방문.
**N.** 처음엔 영상 6-8초씩 *정상 시청*. popup 다시 열어보면 **"평균 체류 ~7초"** 정도로 표시됨.
**O.** 이제 의도적으로 빠르게 스크롤 (영상마다 1-2초만 보고 다음). 화면 채도가 단계적으로 빠지는 게 보임:
  `FRESH → WARMING → DRIFTING → FADING → QUIETING → STOP`
**P.** STOP 단계 도달 시 풀스크린 카드 한 번 등장 — *"도움이 되었길 바라요, 잠깐 쉬어볼까요?"* **"알겠어요"** 클릭하면 카드만 사라지고 채도는 유지됨.
**Q.** 그만 보려면 도구바 아이콘 → popup → 토글 **OFF** → 즉시 정상 색 복원. 강제 차단이 아니라 본인이 끄는 거.
**R.** 잠깐 5분만 멈추고 싶으면 popup 의 **"5분 잠깐 멈추기"** 버튼 → 카운트다운 → 5분 후 자동 재개.
**S.** 시연 / 영상 녹화용 — 토글 ON 상태에서 YT/IG 페이지가 활성일 때 **`Ctrl+Shift+S`** 한 번 누르면 단계 1개씩 강제 진행 (자연 스크롤보다 예측 가능).
**T.** 채도가 전혀 안 빠지면 디버깅 — `F12` → Console 탭 → `[Dogpamine] tick — measured=` 로그가 5초마다 나오는지 확인. 안 나오면 `chrome://extensions` → Dogpamine 카드의 새로고침 아이콘 한 번 클릭.
**U.** 시크릿 모드에서 쓰려면 별도 허용 — `chrome://extensions` → Dogpamine **세부정보** → **"시크릿 모드에서 허용"** ON.
**V.** 다음 날 / 컴퓨터 재시작 후 — Chrome 켜고 popup 한 번 열면 만료된 세션은 자동 OFF. 본인이 따로 안 꺼도 됨.
**W.** TikTok 등 다른 사이트는 아직 X. 현재 YouTube Shorts + Instagram Reels 만. Phase 3 에서 추가 예정.
**X.** 익스텐션 영구 삭제: `chrome://extensions` → Dogpamine 카드 → **"제거"** → 확인.
**Y.** 프라이버시 — 측정 데이터는 어디로도 안 보냄. `chrome.storage.local` 로 이 기기에만 저장. 익스텐션 삭제하면 전부 사라짐.
**Z.** 막히면 위쪽 **문제 해결** 표 먼저 보고, 그래도 안 되면 GitHub Issues 에 증상 + Console 로그 적기.

끝. A 부터 Z 까지 다 따라가면 5분 안에 처음 STOP 단계 도달까지 갑니다.

---

## 한 줄

> 알고리즘과 싸우지 않고, **포만감 알고리즘**이 영상의 매력을 천천히 빠뜨림. 켜고 끄는 건 본인 결정.
