// Dogpamine — 시간 엔진 + 콘텐츠 분배 로직
//
// 두 가지 메커니즘이 동시에 작동:
//  1) 채도 페이드: 시간 지날수록 --saturation CSS 변수가 천천히 감소
//  2) 콘텐츠 분배: 새 릴스가 생성될 때, 시간 단계에 따라 'high'/'low' 비율 변화

// ─── 설정 ───────────────────────────────────────────────
// DEMO_MODE = true: 5분 안에 모든 단계 발생 (발표용)
// DEMO_MODE = false: 30분 사이클 (실제 사용자 경험 가까움)
// 팀이 발표 직전 DEMO_MODE 토글만 하면 됨.
const DEMO_MODE = true;
const TIME_SCALE = DEMO_MODE ? 1 : 6; // 6배 느림 = 30분 사이클

// 시간 단계 정의 (초 기준, DEMO_MODE).
// 각 단계마다: 채도(%), 취향 콘텐츠 비율(0–1)
const STAGES = [
  { t: 0,   saturation: 100, highRatio: 1.00, label: 'FRESH' },     // 0–60s: 정상 SNS
  { t: 60,  saturation: 90,  highRatio: 0.85, label: 'WARMING' },   // 60–120s: 살짝 김 빠짐
  { t: 120, saturation: 75,  highRatio: 0.65, label: 'DRIFTING' },  // 120–180s: 명확히 변화
  { t: 180, saturation: 60,  highRatio: 0.45, label: 'FADING' },    // 180–240s: 절반은 저자극
  { t: 240, saturation: 45,  highRatio: 0.25, label: 'QUIETING' },  // 240–300s: 저자극 위주
  { t: 300, saturation: 35,  highRatio: 0.15, label: 'STILL' },     // 300s+: 거의 다 저자극
];

const INITIAL_REELS = 8;     // 첫 로드 시 생성할 릴스 수
const APPEND_BATCH = 6;       // 무한 스크롤 시 추가 생성할 양
const APPEND_TRIGGER = 3;     // 끝에서 N개 남으면 새로 추가

// ─── 상태 ───────────────────────────────────────────────
const state = {
  startTime: Date.now(),
  viewedCount: 0,
  currentStage: STAGES[0],
};

// ─── 시간 → 단계 매핑 ───────────────────────────────────
function getElapsed() {
  return ((Date.now() - state.startTime) / 1000) / TIME_SCALE;
}

function getCurrentStage(elapsed) {
  // 마지막부터 역순으로 검색해서 첫 매치 반환
  for (let i = STAGES.length - 1; i >= 0; i--) {
    if (elapsed >= STAGES[i].t) return STAGES[i];
  }
  return STAGES[0];
}

// ─── 콘텐츠 픽 ───────────────────────────────────────────
function pickContent(stage) {
  const category = Math.random() < stage.highRatio ? 'high' : 'low';
  const pool = CONTENT[category];
  const item = pool[Math.floor(Math.random() * pool.length)];
  return { ...item, category };
}

// ─── 릴스 DOM 생성 ───────────────────────────────────────
function createReel(item, index) {
  const reel = document.createElement('div');
  reel.className = 'reel';
  reel.dataset.category = item.category;
  reel.dataset.index = index;
  reel.style.background = item.bg;

  reel.innerHTML = `
    <div class="tag">${item.category === 'high' ? '추천' : '잠시 쉬기'}</div>
    <div class="emoji">${item.emoji}</div>
    <div class="title">${item.title}</div>
    <div class="desc">${item.desc}</div>
    <div class="meta">@dogpamine • #${index + 1}</div>
  `;

  return reel;
}

// ─── 피드에 릴스 추가 ───────────────────────────────────
function appendReels(count) {
  const feed = document.getElementById('feed');
  const startIdx = feed.children.length;

  for (let i = 0; i < count; i++) {
    const stage = getCurrentStage(getElapsed());
    const item = pickContent(stage);
    const reel = createReel(item, startIdx + i);
    feed.appendChild(reel);
  }
}

// ─── 채도 업데이트 ─────────────────────────────────────
function updateSaturation() {
  const elapsed = getElapsed();
  const stage = getCurrentStage(elapsed);
  document.documentElement.style.setProperty('--saturation', stage.saturation + '%');

  if (stage !== state.currentStage) {
    state.currentStage = stage;
    console.log(`[Dogpamine] Stage → ${stage.label} (sat=${stage.saturation}%, high=${Math.round(stage.highRatio * 100)}%)`);
  }
}

// ─── 디버그 오버레이 ───────────────────────────────────
function updateDebug() {
  const elapsed = getElapsed();
  const stage = state.currentStage;
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(Math.floor(elapsed % 60)).padStart(2, '0');

  document.getElementById('debug').innerHTML = `
    <div class="row"><span class="label">경과</span><span class="value">${mm}:${ss}</span></div>
    <div class="row"><span class="label">단계</span><span class="value">${stage.label}</span></div>
    <div class="row"><span class="label">채도</span><span class="value">${stage.saturation}%</span></div>
    <div class="row"><span class="label">취향 비율</span><span class="value">${Math.round(stage.highRatio * 100)}%</span></div>
    <div class="row"><span class="label">본 영상</span><span class="value">${state.viewedCount}개</span></div>
    <div class="hint">D 키: 디버그 토글 / R 키: 리셋${DEMO_MODE ? ' / 데모모드' : ''}</div>
  `;
}

// ─── 스크롤 감지 → 추가 로드 + 시청 카운트 ──────────────
function setupScrollObserver() {
  const feed = document.getElementById('feed');

  // IntersectionObserver: 현재 화면에 있는 릴스 감지
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && entry.intersectionRatio > 0.7) {
        const idx = parseInt(entry.target.dataset.index, 10);
        // 새로 본 영상이면 카운트
        if (!entry.target.dataset.viewed) {
          entry.target.dataset.viewed = '1';
          state.viewedCount++;
        }
        // 끝에서 APPEND_TRIGGER개 남으면 더 로드
        const remaining = feed.children.length - idx - 1;
        if (remaining <= APPEND_TRIGGER) {
          appendReels(APPEND_BATCH);
          // 새로 추가된 릴스들도 observer에 등록
          feed.querySelectorAll('.reel:not([data-observed])').forEach(r => {
            r.dataset.observed = '1';
            observer.observe(r);
          });
        }
      }
    });
  }, { threshold: [0.7] });

  // 초기 릴스들 등록
  feed.querySelectorAll('.reel').forEach(r => {
    r.dataset.observed = '1';
    observer.observe(r);
  });
}

// ─── 키보드 단축키 ─────────────────────────────────────
function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'd' || e.key === 'D') {
      document.getElementById('debug').classList.toggle('hidden');
    }
    if (e.key === 'r' || e.key === 'R') {
      location.reload();
    }
  });
}

// ─── 초기화 ─────────────────────────────────────────────
function init() {
  appendReels(INITIAL_REELS);
  setupScrollObserver();
  setupKeyboard();
  updateSaturation();
  updateDebug();

  // 1초마다 채도 + 디버그 업데이트.
  // 채도 단계 변화는 30초 transition 으로 부드럽게.
  setInterval(() => {
    updateSaturation();
    updateDebug();
  }, 1000);
}

document.addEventListener('DOMContentLoaded', init);
