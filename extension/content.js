// Dogpamine — Instagram Reels 용 content script
//
// 역할:
//   1) IntersectionObserver 로 reel 별 <video> 체류 시간(dwell time) 측정
//   2) 최근 5개 reel 의 평균 dwell 이 임계값 깨면 단계 진행 (단방향)
//   3) 단계 진행 시 <html> 의 saturate() 필터 단계적 감소
//
// 단계 진행 트리거는 100% 행동 기반. 시간 기반 진행 없음.
// Mock SNS (app.js) 의 검증된 dwell 로직과 동일한 STAGES / maybeAdvanceStage 구조.

const STAGES = [
  { dwellLt: Infinity, saturation: 100, label: 'FRESH' },
  { dwellLt: 6,        saturation: 90,  label: 'WARMING' },
  { dwellLt: 4,        saturation: 75,  label: 'DRIFTING' },
  { dwellLt: 3,        saturation: 60,  label: 'FADING' },
  { dwellLt: 2,        saturation: 45,  label: 'QUIETING' },
  { dwellLt: 1.5,      saturation: 35,  label: 'STILL' },
];

const state = {
  currentStageIdx: 0,
  recentDwells: [],
  dwellWindow: 5,
  observedVideoCount: 0,
  measuredDwellCount: 0,
};

// ── CSS 주입 ────────────────────────────────────────────
// transition 으로 채도 변화가 1.5초에 걸쳐 부드럽게 보이게 한다.
// 인라인 <style> 가 CSP 에 막히면 chrome.scripting.insertCSS 로 전환 필요 (현재는 시도).
const styleEl = document.createElement('style');
styleEl.id = 'dogpamine-filter';
styleEl.textContent = 'html { filter: saturate(100%); transition: filter 1.5s ease; }';
document.documentElement.appendChild(styleEl);

function applyStage() {
  const stage = STAGES[state.currentStageIdx];
  styleEl.textContent =
    `html { filter: saturate(${stage.saturation}%); transition: filter 1.5s ease; }`;
}

// ── 단계 진행 판단 ──────────────────────────────────────
// 가장 높은 단계부터 검색해서 첫 매치. i > currentStageIdx 로만 진행 → 단방향.
function maybeAdvanceStage() {
  if (state.recentDwells.length < state.dwellWindow) return; // 워밍업
  const avgDwellSec =
    state.recentDwells.reduce((a, b) => a + b, 0) / state.recentDwells.length / 1000;
  for (let i = STAGES.length - 1; i > state.currentStageIdx; i--) {
    if (avgDwellSec < STAGES[i].dwellLt) {
      state.currentStageIdx = i;
      console.log(
        `[Dogpamine] Stage → ${STAGES[i].label} ` +
          `(avg dwell ${avgDwellSec.toFixed(2)}s, sat ${STAGES[i].saturation}%)`
      );
      applyStage();
      break;
    }
  }
}

// ── video 단위 dwell 측정 ───────────────────────────────
// 50% 이상 노출 시 viewStart 기록, 이탈 시 dwell 계산 → recentDwells 슬라이딩 윈도우.
// Instagram 이 같은 <video> 노드를 재활용하는 경우 (src 만 교체) 대비:
//   - dataset.dogObserved 는 영구 마커 (observer 중복 부착 방지)
//   - dataset.dogViewStart 는 진입/이탈마다 set/delete (재진입 시 새 dwell 측정 가능)
function attachVideoObserver(video) {
  if (video.dataset.dogObserved) return;
  video.dataset.dogObserved = '1';
  state.observedVideoCount++;

  const obs = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const v = entry.target;
        const inView = entry.isIntersecting && entry.intersectionRatio >= 0.5;
        if (inView && !v.dataset.dogViewStart) {
          v.dataset.dogViewStart = String(Date.now());
        } else if (!inView && v.dataset.dogViewStart) {
          const dwellMs = Date.now() - Number(v.dataset.dogViewStart);
          delete v.dataset.dogViewStart;
          state.recentDwells.push(dwellMs);
          if (state.recentDwells.length > state.dwellWindow) state.recentDwells.shift();
          state.measuredDwellCount++;
          maybeAdvanceStage();
        }
      }
    },
    { threshold: [0.5] }
  );
  obs.observe(video);
}

// ── 동적 reel 추가 감지 ─────────────────────────────────
// Instagram 은 SPA + 무한 스크롤 → 새 <video> 가 동적으로 DOM 에 추가됨.
// document.body 전체 subtree 감시는 무거울 수 있음 (Edge Case #2).
// 첫 구현: 콘솔에 mutation 카운트를 5초마다 찍어서 폭주 여부 확인.
let mutationCount = 0;
const mo = new MutationObserver((mutations) => {
  for (const m of mutations) {
    mutationCount++;
    for (const node of m.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (node.tagName === 'VIDEO') attachVideoObserver(node);
      else node.querySelectorAll && node.querySelectorAll('video').forEach(attachVideoObserver);
    }
  }
});
mo.observe(document.body, { childList: true, subtree: true });

// 초기 진입 시 이미 존재하는 video 들 캡처.
// run_at: document_idle 이지만 SPA hydration 타이밍에 따라 0개일 수 있음 — MutationObserver 가 채움.
document.querySelectorAll('main video').forEach(attachVideoObserver);

// ── 디버그 로그 (5초마다 한 번) ──────────────────────────
// 셀렉터 silent 깨짐 감지: observedVideoCount 가 0 으로 정체되면 셀렉터가 안 잡힌 것.
setInterval(() => {
  const avg =
    state.recentDwells.length > 0
      ? (state.recentDwells.reduce((a, b) => a + b, 0) / state.recentDwells.length / 1000).toFixed(2)
      : '—';
  console.log(
    `[Dogpamine] tick — stage=${STAGES[state.currentStageIdx].label} ` +
      `observed=${state.observedVideoCount} measured=${state.measuredDwellCount} ` +
      `avgDwell=${avg}s mutations=${mutationCount}`
  );
}, 5000);

console.log('[Dogpamine] content script loaded on', location.href);
