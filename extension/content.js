// Dogpamine — content script (v0.2.0).
//
// 단방향 데이터 흐름: chrome.storage 가 진실의 소스.
//   storage.enabled = true  → attach() (observers, expiry tick, stage)
//   storage.enabled = false → detach() (cleanup, reset saturation)
//
// 핵심 결정 (autoplan T4 Eng 검토 통합):
//   - SITE_CONFIG 어댑터 패턴 (YouTube Shorts + Instagram Reels)
//   - styleEl 즉시 inject saturate(100%) no-op → 페이지 깜빡임 차단 (Eng 5)
//   - Init race fix: monotonic storageChangeCounter (Eng 1)
//   - Map-tracked IntersectionObservers → detach() 에서 깨끗히 정리 (Eng 2)
//   - 60s self-expiry safety net (SW dormancy 대비, Eng 3)
//   - KST 자정은 lib/session.js 위임 (Eng 4)
//   - popup 에 push (chrome.runtime.sendMessage), get-state 응답 (Eng 6)
//   - MutationObserver: 좁은 root + requestIdleCallback + 100ms debounce (Eng 8)
//   - Extension context invalidation 시 graceful cleanup (Eng Q)
//   - pausedUntil 매 dwell tick 체크 (단계 진행 일시정지)

(() => {
  'use strict';

  // ── 1. Site config ────────────────────────────────────────────────
  const SITE_CONFIG = {
    'youtube.com': {
      urlPattern: /\/shorts\//,
      videoSelector: 'ytd-reel-video-renderer video, #shorts-player video, video',
      mutationRoot: () => document.querySelector('ytd-shorts, ytd-app') || document.body,
      name: 'YouTube',
    },
    'instagram.com': {
      // IG는 reels URL 형태가 다양함:
      //   /reels/                     (피드 메인)
      //   /reels/{id}/                (피드 내 reel)
      //   /reel/{id}/                 (단수형 standalone reel)
      //   /{username}/reels/          (사용자 reels 탭)
      //   /{username}/reel/{id}/      (사용자 reel)
      //   /explore/reels/{id}/        (explore reels)
      // 따라서 단/복수 모두 잡는 패턴.
      urlPattern: /\/(reel|reels)\//,
      videoSelector: 'video',
      mutationRoot: () => document.body,
      name: 'Instagram',
    },
  };

  const host = location.hostname.replace(/^www\./, '');
  const site = SITE_CONFIG[host];
  if (!site) return;

  const onSupportedPath = () => site.urlPattern.test(location.pathname);

  // ── 2. Stages + constants ────────────────────────────────────────
  // 시연용 임팩트: 100/75/50/30/15/0 (STOP=완전 흑백). 단계당 ~15-20 gap.
  // 90%/82% 같은 미세한 차이는 인간 시각 인지 한계 아래라 안 보임 → 폐기.
  // dwellLt 임계값도 너그럽게 (10/8/6/4/3) — 시연자가 일부러 빠르게 안 swipe 해도 진행.
  const STAGES = [
    { dwellLt: Infinity, saturation: 100, overlay: false, label: 'FRESH' },
    { dwellLt: 10,       saturation: 75,  overlay: false, label: 'WARMING' },
    { dwellLt: 8,        saturation: 50,  overlay: false, label: 'DRIFTING' },
    { dwellLt: 6,        saturation: 30,  overlay: false, label: 'FADING' },
    { dwellLt: 4,        saturation: 15,  overlay: false, label: 'QUIETING' },
    { dwellLt: 3,        saturation: 0,   overlay: true,  label: 'STOP' },
  ];

  // DWELL_WINDOW = 1 — 매 swipe 마다 단계 1개씩 (점프 금지). 시연자가 단계별 변화 관찰 가능.
  const DWELL_WINDOW = 1;
  const EXPIRY_CHECK_MS = 60_000;
  const DISCOVERY_DEBOUNCE_MS = 100;
  const PUSH_THROTTLE_MS = 1000;
  const TICK_LOG_MS = 5_000;
  // 큐레이션 모드 자동 진행 — 영상 한 개당 ~10초 후 다음 큐 항목으로 navigate.
  // 시연용: 자동 타이머 OR 사용자 swipe (ArrowDown) 둘 다 트리거.
  const CURATED_AUTO_ADVANCE_MS = 10_000;

  // ── 3. State ──────────────────────────────────────────────────────
  const state = {
    attached: false,
    currentStageIdx: 0,
    recentDwells: [],
    measuredDwellCount: 0,
    observedVideoCount: 0,
    overlayDismissed: false,
    videoObservers: new Map(),  // video → IntersectionObserver
    mutationObserver: null,
    expiryHandle: null,
    tickHandle: null,
    pausedUntil: null,
    storageChangeCounter: 0,
    initSnapshotCounter: 0,
    lastPushAt: 0,
    curatedCache: null,
    recentJumps: [], // 최근 5개 큐레이션 URL — 즉시 중복 회피
    // 연속 큐레이션 시퀀스 모드 (CTA 클릭 → 큐 만들고 차례차례 navigate)
    curatedMode: false,
    curatedQueue: null,        // string[] — 큐레이션 URL 시퀀스
    curatedIndex: 0,
    curatedAutoTimer: null,    // setTimeout 핸들 (10초 자동 진행)
    curatedKeyHandler: null,   // ArrowDown swipe 감지 핸들러 (제거용 참조)
    // Sparse inject: 1:10 비율로 평소 피드에 silent 큐레이션 영상 삽입
    injectionCounter: 0,       // chrome.storage 에서 hydrate. 매 새 video visible 시 +1.
    pendingInjectId: null,     // 다음 inject 할 video id (미리 픽). pickCuratedShort 결과.
    justInjected: false,       // 우리가 방금 navigate 시킨 영상 표시 (storage 통해 page reload 너머 유지).
  };

  const isExtensionAlive = () => {
    try { return !!chrome.runtime?.id; } catch { return false; }
  };

  // ── 4. Style element (synchronous no-op — Eng 5: no flash) ────────
  // Curve: cubic-bezier(0.4, 0, 0.2, 1) = Material standard "decelerate".
  // 1.5s duration — 시연용 부드러운 변화.
  //
  // GPU compositing 우회: YouTube/Instagram 의 <video> 는 별도 GPU layer 라
  // html { filter } 가 video frame 까지 전파 안 되는 경우가 있음.
  // → video / player container 들에 직접 filter 를 박는다 (!important + 다중 selector).
  // 추가로 attachVideoObserver / setSaturation 에서 inline style.filter 도 적용.
  const SAT_TRANSITION = 'filter 1.5s cubic-bezier(0.4, 0, 0.2, 1)';
  const styleEl = document.createElement('style');
  styleEl.id = 'dogpamine-filter';

  function buildFilterCss(percent) {
    return `
      html { filter: saturate(${percent}%); transition: ${SAT_TRANSITION}; }
      video,
      ytd-reel-video-renderer,
      ytd-shorts,
      #shorts-player,
      .html5-video-container,
      .html5-main-video,
      div[class*="reels-player"],
      div[role="presentation"] video,
      article video,
      main video,
      section video,
      div[role="dialog"] video {
        filter: saturate(${percent}%) !important;
        transition: ${SAT_TRANSITION};
      }
    `;
  }

  styleEl.textContent = buildFilterCss(100);
  document.documentElement.appendChild(styleEl);

  function setSaturation(percent) {
    styleEl.textContent = buildFilterCss(percent);
    // 보강: 발견된 모든 video element 에 inline style 로 직접 강제.
    // CSS selector 가 안 먹는 엣지 케이스(YT shadow DOM 등) 대비.
    state.videoObservers.forEach((_obs, video) => {
      try {
        video.style.setProperty('filter', `saturate(${percent}%)`, 'important');
        video.style.setProperty('transition', SAT_TRANSITION);
      } catch { /* detached element */ }
    });
    updateHud(percent);
  }

  // ── 5. Stage logic ────────────────────────────────────────────────
  function applyStage() {
    const stage = STAGES[state.currentStageIdx];
    setSaturation(stage.saturation);
    console.log(`[Dogpamine] Stage → ${stage.label} (sat ${stage.saturation}%)`);
    pushStateToPopup();
    if (stage.overlay && !state.overlayDismissed) showOverlay();
  }

  // ── 5b. STOP overlay (T5) ─────────────────────────────────────────
  function showOverlay() {
    if (document.getElementById('dogpamine-overlay')) return;
    const avgSec = state.recentDwells.length > 0
      ? state.recentDwells.reduce((a, b) => a + b, 0) / state.recentDwells.length / 1000
      : 0;
    const wrap = document.createElement('div');
    wrap.id = 'dogpamine-overlay';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'dogpamine-overlay-title');
    wrap.innerHTML = `
      <div class="dogpamine-card">
        <span class="dogpamine-card__emoji" aria-hidden="true">🐶</span>
        <h2 class="dogpamine-card__title" id="dogpamine-overlay-title">도움이 되었길 바라요</h2>
        <p class="dogpamine-card__subtitle">잠깐 쉬어볼까요?</p>
        <div class="dogpamine-card__stats">
          <div class="dogpamine-card__stats-row">
            <span class="dogpamine-card__stats-label">본 영상</span>
            <span class="dogpamine-card__stats-value">${state.measuredDwellCount}개</span>
          </div>
          <div class="dogpamine-card__stats-row">
            <span class="dogpamine-card__stats-label">평균 체류</span>
            <span class="dogpamine-card__stats-value">${avgSec.toFixed(1)}초</span>
          </div>
        </div>
        <div class="dogpamine-card__actions">
          <button type="button" class="dogpamine-card__cta" id="dogpamine-overlay-jump">
            도파민 가벼운 영상 보기
          </button>
          <button type="button" class="dogpamine-card__close" id="dogpamine-overlay-close">
            알겠어요
          </button>
        </div>
        <p class="dogpamine-card__legend">포만감 알고리즘 · 행동 패턴 감지</p>
      </div>
    `;
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('visible'));

    const closeBtn = wrap.querySelector('#dogpamine-overlay-close');
    const jumpBtn = wrap.querySelector('#dogpamine-overlay-jump');
    const close = () => {
      state.overlayDismissed = true;
      wrap.classList.remove('visible');
      // transition 끝나면 제거 (250ms)
      setTimeout(() => wrap.remove(), 300);
      // ESC focus trap 해제
      document.removeEventListener('keydown', onEsc);
    };
    closeBtn.addEventListener('click', close);
    jumpBtn.addEventListener('click', () => {
      document.removeEventListener('keydown', onEsc);
      jumpToCuratedShort(); // 카테고리 미지정 — weights 기반 자동 선택
    });
    const onEsc = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onEsc);
    jumpBtn.focus(); // 시연: 첫 포커스를 CTA 에 — 사용자 행동 변화 유도
  }

  function removeOverlay() {
    const ov = document.getElementById('dogpamine-overlay');
    if (ov) ov.remove();
  }

  // ── 5c. In-page HUD — 시연 영상 우상단에 현재 단계 + 채도 표시 ─────
  // popup 은 영상 캡처에 안 잡히므로 화면 내부 HUD 가 필요.
  // filter:saturate(100%)!important 로 자기 자신은 흑백화 영향 받지 않음.
  function ensureHud() {
    let hud = document.getElementById('dogpamine-hud');
    if (hud) return hud;
    hud = document.createElement('div');
    hud.id = 'dogpamine-hud';
    hud.setAttribute('aria-hidden', 'true');
    hud.style.cssText = [
      'position:fixed', 'top:12px', 'right:12px', 'z-index:2147483646',
      'background:rgba(15,23,42,0.78)', 'color:#fff',
      'padding:8px 14px', 'border-radius:10px',
      'font:600 12px/1.3 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif',
      'letter-spacing:0.02em', 'box-shadow:0 6px 18px rgba(0,0,0,0.35)',
      'pointer-events:none', 'filter:saturate(100%) !important',
      'transition:opacity 0.25s ease', 'opacity:0.92',
      'display:flex', 'gap:10px', 'align-items:center',
    ].join(';');
    hud.innerHTML = `
      <span id="dogpamine-hud-label" style="font-weight:700">FRESH</span>
      <span style="opacity:0.55">|</span>
      <span id="dogpamine-hud-sat" style="font-variant-numeric:tabular-nums">100%</span>
    `;
    document.documentElement.appendChild(hud);
    return hud;
  }

  function updateHud(percent) {
    if (!state.attached) return;
    const hud = ensureHud();
    const labelEl = hud.querySelector('#dogpamine-hud-label');
    const satEl = hud.querySelector('#dogpamine-hud-sat');
    // 큐레이션 모드에선 stage 대신 진행도 표시
    if (state.curatedMode && state.curatedQueue) {
      if (labelEl) labelEl.textContent = '큐레이션';
      if (satEl) satEl.textContent = `${state.curatedIndex + 1}/${state.curatedQueue.length}`;
      return;
    }
    const stage = STAGES[state.currentStageIdx];
    if (labelEl) labelEl.textContent = stage.label;
    if (satEl) satEl.textContent = `${percent}%`;
  }

  function removeHud() {
    const hud = document.getElementById('dogpamine-hud');
    if (hud) hud.remove();
  }

  // ── 5d. Curated short jump ────────────────────────────────────────
  // YT Shorts 알고리즘은 클라이언트에서 못 바꾸지만, 우리가 'seed' URL 을
  // 결정하면 후속 자동 swipe 가 그 카테고리 안에서 흐름.
  // curated.json (web_accessible_resources) 에서 카테고리별 URL 풀 로딩.
  const RECENT_JUMP_MAX = 5;
  const PLACEHOLDER_RE = /\/shorts\/REPLACE_/;

  // 카테고리 → YouTube 검색 URL (Shorts 필터 sp=EgIYAQ%253D%253D 포함).
  // 진짜 큐레이션 URL 없을 때 fallback — 검색 결과에서 사용자가 첫 영상 클릭하면
  // 그 시점부터 YT 알고리즘이 그 카테고리 안에서 흐름.
  const SEARCH_FALLBACK_QUERIES = {
    news: '뉴스 shorts',
    animals: '귀여운 동물 shorts',
  };

  function buildSearchFallbackUrl(category) {
    const cat = SEARCH_FALLBACK_QUERIES[category] ? category : 'news';
    const q = SEARCH_FALLBACK_QUERIES[cat];
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIYAQ%253D%253D`;
  }

  async function loadCuratedList() {
    if (state.curatedCache) return state.curatedCache;
    if (!isExtensionAlive()) return null;
    try {
      const url = chrome.runtime.getURL('curated.json');
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`fetch ${resp.status}`);
      const data = await resp.json();
      state.curatedCache = data;
      // placeholder 감지 — 시연 전 실제 URL 로 교체 필요한 항목 명확히 경고
      const allUrls = Object.values(data.categories || {}).flat();
      const placeholders = allUrls.filter((u) => PLACEHOLDER_RE.test(u));
      if (placeholders.length > 0) {
        console.warn(
          `[Dogpamine] curated.json 에 placeholder URL ${placeholders.length}개 발견 ` +
          `— 시연 전 실제 Shorts URL 로 교체 필요. 예: ${placeholders[0]}`
        );
      } else {
        console.log(`[Dogpamine] curated.json 로딩: ${allUrls.length}개 URL`);
      }
      return data;
    } catch (e) {
      console.warn('[Dogpamine] curated.json 로딩 실패:', e);
      return null;
    }
  }

  function pickCategoryByWeight(weights) {
    const entries = Object.entries(weights || {});
    if (entries.length === 0) return null;
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let r = Math.random() * total;
    for (const [cat, w] of entries) {
      r -= w;
      if (r <= 0) return cat;
    }
    return entries[entries.length - 1][0]; // 부동소수점 보정
  }

  function pickCuratedShort(category) {
    const data = state.curatedCache;
    if (!data) return null;
    const cat = category || pickCategoryByWeight(data.weights);
    if (!cat) return null;
    const list = (data.categories && data.categories[cat]) || [];
    if (list.length === 0) return null;
    // recentJumps 5개 회피, 남는 게 없으면 전체에서 랜덤
    const pool = list.filter((u) => !state.recentJumps.includes(u));
    const chosen = pool.length > 0
      ? pool[Math.floor(Math.random() * pool.length)]
      : list[Math.floor(Math.random() * list.length)];
    state.recentJumps.push(chosen);
    if (state.recentJumps.length > RECENT_JUMP_MAX) state.recentJumps.shift();
    return chosen;
  }

  // URL 에서 11자 Shorts video ID 추출 — 큐 일치 비교용
  function extractShortId(pathname) {
    const m = pathname.match(/\/shorts\/([^/?]+)/);
    return m ? m[1] : '';
  }

  // news + animals 셔플 + 인터리브 큐 빌드.
  // weights.animals = 0.6 → animals 가 슬롯의 ~60% 차지하도록 ratio 인터리브.
  // placeholder URL 은 제외.
  function buildCuratedQueue(data) {
    if (!data || !data.categories) return [];
    const valid = (arr) => (arr || []).filter((u) => u && !PLACEHOLDER_RE.test(u));
    const shuffle = (arr) => arr.slice().sort(() => Math.random() - 0.5);
    const news = shuffle(valid(data.categories.news));
    const animals = shuffle(valid(data.categories.animals));
    if (news.length === 0 && animals.length === 0) return [];

    // 인터리브: animals 2개당 news 1개 (weights 0.6/0.4 근사).
    const result = [];
    let i = 0, j = 0;
    while (i < animals.length || j < news.length) {
      if (i < animals.length) result.push(animals[i++]);
      if (i < animals.length) result.push(animals[i++]);
      if (j < news.length) result.push(news[j++]);
    }
    return result;
  }

  async function jumpToCuratedShort(opts = {}) {
    const data = await loadCuratedList();

    // 데이터 자체 없음 → search fallback (검색 페이지)
    if (!data || !data.categories) {
      const category = opts.category || 'news';
      console.warn('[Dogpamine] curated 데이터 없음 — search fallback');
      location.assign(buildSearchFallbackUrl(category));
      return false;
    }

    // 진짜 URL 큐 빌드 (placeholder 자동 제외)
    const queue = buildCuratedQueue(data);

    if (queue.length === 0) {
      // 큐가 비어있음 (placeholder 만 있는 상태) → search fallback
      const category = opts.category || pickCategoryByWeight(data.weights) || 'news';
      console.warn('[Dogpamine] 큐레이션 큐 비어있음 (placeholder 만) — search fallback');
      location.assign(buildSearchFallbackUrl(category));
      return false;
    }

    console.log(`[Dogpamine] 큐레이션 시퀀스 시작 — ${queue.length}개 영상`);

    // storage 에 큐 저장 — page reload 후에도 next page 에서 읽음
    if (isExtensionAlive()) {
      try {
        await chrome.storage.local.set({
          curatedQueue: queue,
          curatedIndex: 0,
        });
      } catch (e) {
        console.warn('[Dogpamine] curatedQueue 저장 실패', e);
      }
    }

    // 점프 후 새 카테고리에서 fresh 시작 — 단계/dwell/overlay 리셋
    state.currentStageIdx = 0;
    state.recentDwells = [];
    state.measuredDwellCount = 0;
    state.observedVideoCount = 0;
    state.overlayDismissed = false;
    removeOverlay();
    location.assign(queue[0]);
    return true;
  }

  // ── 5e. Curated mode — 연속 시퀀스 자동 진행 ──────────────────────
  // 큐레이션 큐로 navigate 한 후, content.js 재주입 → init() 이 storage 에서
  // curatedQueue 읽고 enterCuratedMode() 호출. 채도 단계 진행 OFF, HUD 표시,
  // 10초 자동 타이머 OR ArrowDown swipe → advanceCuratedQueue().
  function enterCuratedMode(queue, index) {
    state.attached = true;
    state.curatedMode = true;
    state.curatedQueue = queue;
    state.curatedIndex = index;
    console.log(`[Dogpamine] 큐레이션 모드 ${index + 1}/${queue.length} → ${location.pathname}`);

    ensureHud();
    updateHud(100); // 채도 100% — 큐레이션 영상은 보상이라 색 살아있음

    // 자동 진행 타이머
    state.curatedAutoTimer = setTimeout(() => {
      console.log('[Dogpamine] 큐레이션 자동 진행 (타이머)');
      advanceCuratedQueue();
    }, CURATED_AUTO_ADVANCE_MS);

    // Swipe 감지 — ArrowDown / PageDown = YT 의 "다음 Shorts" 단축키
    state.curatedKeyHandler = (e) => {
      if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'j') {
        e.preventDefault();
        e.stopPropagation();
        console.log('[Dogpamine] 큐레이션 진행 (swipe)');
        advanceCuratedQueue();
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'k') {
        // 큐레이션 모드에선 뒤로 가기 차단 — YT 알고리즘 영상으로 못 돌아가게
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('keydown', state.curatedKeyHandler, true);
  }

  async function advanceCuratedQueue() {
    if (state.curatedAutoTimer) {
      clearTimeout(state.curatedAutoTimer);
      state.curatedAutoTimer = null;
    }
    const next = state.curatedIndex + 1;
    if (!state.curatedQueue || next >= state.curatedQueue.length) {
      console.log('[Dogpamine] 큐레이션 시퀀스 끝 — 일반 모드 복귀');
      await exitCuratedMode({ clearStorage: true });
      // 사용자 일반 YT 흐름 복귀 — 일단 그 자리에 머묾.
      return;
    }
    if (isExtensionAlive()) {
      try {
        await chrome.storage.local.set({ curatedIndex: next });
      } catch { /* ignore */ }
    }
    console.log(`[Dogpamine] 큐레이션 다음 ${next + 1}/${state.curatedQueue.length}`);
    location.assign(state.curatedQueue[next]);
  }

  async function exitCuratedMode({ clearStorage = false } = {}) {
    if (state.curatedAutoTimer) {
      clearTimeout(state.curatedAutoTimer);
      state.curatedAutoTimer = null;
    }
    if (state.curatedKeyHandler) {
      document.removeEventListener('keydown', state.curatedKeyHandler, true);
      state.curatedKeyHandler = null;
    }
    state.curatedMode = false;
    state.curatedQueue = null;
    state.curatedIndex = 0;
    if (clearStorage && isExtensionAlive()) {
      try {
        await chrome.storage.local.set({ curatedQueue: null, curatedIndex: 0 });
      } catch { /* ignore */ }
    }
  }

  // ── 5f. Sparse inject — 평소 피드 1:10 silent 큐레이션 삽입 ──────────
  // 결정 (디자인 doc v3 + eng review):
  //   - 매 10번째 새 video visible 마다 우리 curated URL 로 navigate (1:10 결정론적)
  //   - Silent: "Dogpamine 추천" 배지 안 붙임 — P4 defended premise
  //   - C1: curatedMode 활성 시 counter 증가 skip (무한 루프 방지)
  //   - C2: inject 직후 영상의 dwell 은 stage advance 트리거 X — justInjected guard
  //     in maybeAdvanceStage()
  //   - host gate: YT only (curated.json YT URL only — IG 는 Phase 3)
  //   - per-element dedup: dataset.dogInjectCounted='1' 로 multi-fire 방지
  const INJECT_INTERVAL = 10;

  async function hydrateInjectionState() {
    if (!isExtensionAlive()) return;
    try {
      const s = await chrome.storage.local.get(['injectionCounter', 'justInjected']);
      state.injectionCounter = Number(s.injectionCounter) || 0;
      state.justInjected = Boolean(s.justInjected);
      await loadCuratedList(); // idempotent — cache hit 시 즉시 return
      state.pendingInjectId = pickPendingInjectId();
      console.log(
        `[Dogpamine] hydrateInjectionState → counter=${state.injectionCounter} ` +
        `justInjected=${state.justInjected} pendingId=${state.pendingInjectId || '<none>'}`
      );
    } catch (e) {
      console.warn('[Dogpamine] hydrateInjectionState 실패:', e);
    }
  }

  function pickPendingInjectId() {
    const url = pickCuratedShort(); // 기존 — weights + recentJumps 회피, state.recentJumps push
    if (!url) return null;
    return extractShortId(new URL(url).pathname); // 11자 video id
  }

  function onVideoBecameVisible(videoEl) {
    // host gate: sparse inject 1차 범위 YT only
    if (site.name !== 'YouTube') return;
    // hydrate 완료 전 race protection
    if (!state.attached || state.injectionCounter === undefined) return;
    // per-element dedup — 같은 video element 다중 enter 차단
    if (videoEl.dataset.dogInjectCounted === '1') return;
    videoEl.dataset.dogInjectCounted = '1';
    // C1: curated mode 중엔 카운터 증가 skip
    if (state.curatedMode) return;
    // C2 trigger half: justInjected true 면 counter 증가 skip — clear 는 maybeAdvanceStage 가
    if (state.justInjected) return;

    state.injectionCounter += 1;
    if (isExtensionAlive()) {
      chrome.storage.local.set({ injectionCounter: state.injectionCounter }).catch(() => {});
    }

    if (state.injectionCounter % INJECT_INTERVAL === 0) {
      triggerSparseInject();
    }
  }

  async function triggerSparseInject() {
    if (!state.pendingInjectId) {
      state.pendingInjectId = pickPendingInjectId();
      if (!state.pendingInjectId) {
        console.warn('[Dogpamine] sparse inject — curated 없음, skip');
        return;
      }
    }
    const id = state.pendingInjectId;
    state.pendingInjectId = pickPendingInjectId(); // pre-load next for following inject
    state.justInjected = true;
    if (isExtensionAlive()) {
      try {
        await chrome.storage.local.set({ justInjected: true });
      } catch { /* page reload 직전 — 손실 허용 */ }
    }
    const targetUrl = `https://${location.hostname}/shorts/${id}`;
    console.log(`[Dogpamine] sparse inject → ${id} (count=${state.injectionCounter})`);
    location.assign(targetUrl);
  }

  function isPaused() {
    return state.pausedUntil && state.pausedUntil > Date.now();
  }

  function maybeAdvanceStage() {
    // Sparse inject C2 guard: 우리가 inject 한 비디오의 dwell 은 stage 진행 X.
    // EXIT 시점에 한 번 clear 후 다음 비디오부터 정상 advance.
    // 이 위치는 stage advance 의 단일 진입점 — IO EXIT, MO removedNodes 모두 거쳐감.
    if (state.justInjected) {
      state.justInjected = false;
      if (isExtensionAlive()) {
        chrome.storage.local.set({ justInjected: false }).catch(() => {});
      }
      return;
    }
    if (state.recentDwells.length < DWELL_WINDOW) return;
    if (isPaused()) return; // pausedUntil 매 tick 체크
    if (state.currentStageIdx >= STAGES.length - 1) return; // 이미 STOP
    const avgSec =
      state.recentDwells.reduce((a, b) => a + b, 0) / state.recentDwells.length / 1000;
    // 시연용: 한 swipe = 한 단계 (점프 금지). 다음 단계 임계값만 체크.
    const nextIdx = state.currentStageIdx + 1;
    if (avgSec < STAGES[nextIdx].dwellLt) {
      state.currentStageIdx = nextIdx;
      applyStage();
    }
  }

  // ── 6. Video observer (dwell measurement) ─────────────────────────
  function attachVideoObserver(video) {
    if (state.videoObservers.has(video)) return;
    state.observedVideoCount++;
    // 새 video 발견 즉시 현재 stage 채도 강제 — GPU layer 우회.
    try {
      const sat = STAGES[state.currentStageIdx].saturation;
      video.style.setProperty('filter', `saturate(${sat}%)`, 'important');
      video.style.setProperty('transition', SAT_TRANSITION);
    } catch { /* ignore */ }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const v = entry.target;
          const inView = entry.isIntersecting && entry.intersectionRatio >= 0.5;
          if (inView && !v.dataset.dogViewStart) {
            v.dataset.dogViewStart = String(Date.now());
            // Sparse inject hook: 새 video 처음 visible 시 1회 (per-element dedup 내부 처리).
            onVideoBecameVisible(v);
          } else if (!inView && v.dataset.dogViewStart) {
            const dwellMs = Date.now() - Number(v.dataset.dogViewStart);
            delete v.dataset.dogViewStart;
            state.recentDwells.push(dwellMs);
            if (state.recentDwells.length > DWELL_WINDOW) state.recentDwells.shift();
            state.measuredDwellCount++;
            maybeAdvanceStage();
            pushStateToPopup();
          }
        }
      },
      { threshold: [0.5] }
    );
    obs.observe(video);
    state.videoObservers.set(video, obs);
  }

  // ── 7. Video discovery (Eng 8: debounced + idle) ─────────────────
  let discoveryQueued = false;
  const discoveryQueue = new Set();

  function queueDiscovery(addedNodes) {
    for (const node of addedNodes) {
      if (node.nodeType === 1) discoveryQueue.add(node);
    }
    if (discoveryQueued) return;
    discoveryQueued = true;
    const flush = () => {
      discoveryQueued = false;
      const nodes = Array.from(discoveryQueue);
      discoveryQueue.clear();
      for (const node of nodes) {
        if (!node.isConnected) continue;
        if (node.tagName === 'VIDEO') attachVideoObserver(node);
        else if (node.querySelectorAll) {
          node.querySelectorAll('video').forEach(attachVideoObserver);
        }
      }
    };
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(flush, { timeout: DISCOVERY_DEBOUNCE_MS });
    } else {
      setTimeout(flush, DISCOVERY_DEBOUNCE_MS);
    }
  }

  function discoverExisting(root) {
    if (!root?.querySelectorAll) return;
    root.querySelectorAll('video').forEach(attachVideoObserver);
  }

  // ── 8. Attach / detach (Eng 2: full cleanup) ─────────────────────
  function attach() {
    if (state.attached) return;
    state.attached = true;
    console.log('[Dogpamine] attach on', site.name);
    ensureHud();
    // 큐레이션 데이터 백그라운드 로딩 — 첫 jump 트리거 시 await 안 해도 캐시 hit
    loadCuratedList();

    const root = site.mutationRoot();
    console.log('[Dogpamine] MO root =', root?.tagName, root);
    const mo = new MutationObserver((mutations) => {
      const added = [];
      for (const m of mutations) {
        for (const n of m.addedNodes) added.push(n);
        // YT virtual scroll fix: <video> destroy 될 때 dwell 강제 기록.
        // 기존 IO 는 element removal 시 silent disconnect — exit 이벤트 안 옴.
        for (const n of m.removedNodes) {
          if (n.nodeType !== 1) continue;
          const vids = n.tagName === 'VIDEO'
            ? [n]
            : (n.querySelectorAll ? Array.from(n.querySelectorAll('video')) : []);
          for (const v of vids) {
            if (v.dataset.dogViewStart) {
              const dwellMs = Date.now() - Number(v.dataset.dogViewStart);
              delete v.dataset.dogViewStart;
              state.recentDwells.push(dwellMs);
              if (state.recentDwells.length > DWELL_WINDOW) state.recentDwells.shift();
              state.measuredDwellCount++;
              console.log(`[Dogpamine] dwell on removal: ${dwellMs}ms`);
              maybeAdvanceStage();
              pushStateToPopup();
            }
            const obs = state.videoObservers.get(v);
            if (obs) { obs.disconnect(); state.videoObservers.delete(v); }
          }
        }
      }
      if (added.length) queueDiscovery(added);
    });
    mo.observe(root, { childList: true, subtree: true });
    state.mutationObserver = mo;

    discoverExisting(root);
    console.log(`[Dogpamine] initial discover: observed=${state.observedVideoCount}`);

    state.expiryHandle = setInterval(checkExpiry, EXPIRY_CHECK_MS);

    console.log(
      '[Dogpamine] 시연 단축키: Ctrl+Shift+S = 단계 강제 진행, ' +
      'Ctrl+Shift+D = 큐레이션 모드 진입, Ctrl+Shift+G = 단일 sparse inject'
    );

    // Sparse inject hydrate — counter + justInjected + pendingInjectId 복원
    hydrateInjectionState();

    // 5초 디버그 tick — 셀렉터 깨짐 / dwell 측정 정체 즉시 감지용.
    state.tickHandle = setInterval(() => {
      const avg = state.recentDwells.length > 0
        ? (state.recentDwells.reduce((a, b) => a + b, 0) / state.recentDwells.length / 1000).toFixed(2)
        : '—';
      console.log(
        `[Dogpamine] tick — stage=${STAGES[state.currentStageIdx].label} ` +
        `observed=${state.observedVideoCount} measured=${state.measuredDwellCount} ` +
        `avgDwell=${avg}s window=${state.recentDwells.length}/${DWELL_WINDOW}`
      );
    }, TICK_LOG_MS);

    applyStage();
  }

  function detach() {
    if (!state.attached) return;
    state.attached = false;
    console.log('[Dogpamine] detach');

    // 큐레이션 모드면 정리 (storage 큐는 명시적 종료 시에만 clear — detach 만으로는 보존)
    if (state.curatedMode) {
      exitCuratedMode({ clearStorage: false });
    }

    if (state.mutationObserver) {
      state.mutationObserver.disconnect();
      state.mutationObserver = null;
    }
    state.videoObservers.forEach((obs, video) => {
      obs.disconnect();
      delete video.dataset.dogViewStart;
      delete video.dataset.dogInjectCounted; // sparse inject per-element dedup cleanup
      // inline filter 정리 (setSaturation 이 박은 것)
      try {
        video.style.removeProperty('filter');
        video.style.removeProperty('transition');
      } catch { /* ignore */ }
    });
    state.videoObservers.clear();
    removeHud();

    if (state.expiryHandle) {
      clearInterval(state.expiryHandle);
      state.expiryHandle = null;
    }
    if (state.tickHandle) {
      clearInterval(state.tickHandle);
      state.tickHandle = null;
    }

    state.currentStageIdx = 0;
    state.recentDwells = [];
    state.measuredDwellCount = 0;
    state.observedVideoCount = 0;
    state.overlayDismissed = false;
    removeOverlay();
    setSaturation(100);
    pushStateToPopup();
  }

  // ── 9. Self-expiry safety net (Eng 3: SW dormancy) ───────────────
  async function checkExpiry() {
    if (!isExtensionAlive()) {
      // Extension reloaded/uninstalled — cleanup our DOM and bail.
      detach();
      styleEl.remove();
      return;
    }
    try {
      const s = await chrome.storage.local.get([
        'enabled', 'sessionMode', 'sessionStart',
      ]);
      if (!s.enabled) { detach(); return; }
      if (self.DogpamineSession.isExpired(s.sessionMode, s.sessionStart)) {
        console.log('[Dogpamine] self-expiry → writing enabled=false');
        await chrome.storage.local.set({ enabled: false });
        // storage.onChanged 가 detach() 트리거
      }
    } catch {
      detach();
    }
  }

  // ── 10. Push state to popup (throttled) ──────────────────────────
  function buildSnapshot() {
    const stage = STAGES[state.currentStageIdx];
    const avgDwell = state.recentDwells.length > 0
      ? state.recentDwells.reduce((a, b) => a + b, 0) / state.recentDwells.length / 1000
      : null;
    return {
      stage: stage.label,
      saturation: state.attached ? stage.saturation : null,
      measured: state.measuredDwellCount,
      avgDwell,
    };
  }

  function pushStateToPopup() {
    const now = Date.now();
    if (now - state.lastPushAt < PUSH_THROTTLE_MS) return;
    state.lastPushAt = now;
    if (!isExtensionAlive()) return;
    try {
      chrome.runtime.sendMessage({ type: 'state-update', payload: buildSnapshot() })
        .catch(() => {}); // popup 안 열려있으면 silent fail
    } catch { /* context invalidated */ }
  }

  // ── 11. Message handler (popup get-state, jump-curated) ──────────
  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (msg?.type === 'get-state') {
      respond(buildSnapshot());
    } else if (msg?.type === 'jump-curated') {
      jumpToCuratedShort({ category: msg.category });
      respond({ ok: true });
    }
  });

  // ── 12. Storage onChanged ────────────────────────────────────────
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    state.storageChangeCounter++;

    if ('enabled' in changes) {
      const enabled = changes.enabled.newValue;
      if (enabled && onSupportedPath()) {
        // re-init() — 큐레이션 큐 남아있으면 curated mode, 아니면 일반 attach
        init();
      } else if (!enabled) {
        detach();
        // 사용자가 명시적으로 OFF → 큐레이션 시퀀스도 종료
        if (isExtensionAlive()) {
          chrome.storage.local.set({ curatedQueue: null, curatedIndex: 0 })
            .catch(() => {});
        }
      }
    }
    // curatedQueue 외부에서 null 로 설정 (다른 탭/컨텍스트) → 현재 탭도 정리
    if ('curatedQueue' in changes && !changes.curatedQueue.newValue && state.curatedMode) {
      exitCuratedMode({ clearStorage: false });
    }
    if ('pausedUntil' in changes) {
      state.pausedUntil = changes.pausedUntil.newValue;
      // 일시정지 진입 시 단계 진행 멈춤 (applyStage 안 함, 채도 유지)
      // 만료 시 다음 dwell tick 에서 자연 재개
    }
  });

  // ── 13. Init (race fix: monotonic counter, Eng 1) ────────────────
  async function init() {
    if (!onSupportedPath()) return;
    state.initSnapshotCounter = state.storageChangeCounter;
    try {
      const s = await chrome.storage.local.get([
        'enabled', 'sessionMode', 'sessionStart', 'pausedUntil',
        'curatedQueue', 'curatedIndex',
        'injectionCounter', 'justInjected',
      ]);
      if (state.storageChangeCounter > state.initSnapshotCounter) {
        // onChanged 가 get 사이에 발생 → 핸들러가 이미 신선한 상태 반영함, seed skip.
        console.log('[Dogpamine] init: onChanged advanced past us, skip seed');
        return;
      }
      state.pausedUntil = s.pausedUntil || null;

      // ─ 큐레이션 모드 우선 체크 ─
      // 현재 URL의 Shorts video ID 가 storage 의 curatedQueue 안에 있으면 진입.
      // 일반 attach() 보다 우선 — 채도 단계 진행 OFF, 자동 시퀀스 작동.
      if (
        s.enabled &&
        Array.isArray(s.curatedQueue) &&
        s.curatedQueue.length > 0 &&
        !self.DogpamineSession.isExpired(s.sessionMode, s.sessionStart)
      ) {
        const currentId = extractShortId(location.pathname);
        if (currentId) {
          const matchIdx = s.curatedQueue.findIndex((u) => u.includes(currentId));
          if (matchIdx >= 0) {
            enterCuratedMode(s.curatedQueue, matchIdx);
            // index 동기화 (사용자가 직접 URL 입력으로 점프한 경우 대비)
            if (matchIdx !== s.curatedIndex) {
              await chrome.storage.local.set({ curatedIndex: matchIdx });
            }
            return;
          }
          // 큐레이션 URL 아닌 페이지로 사용자가 이탈 → 큐레이션 상태 정리
          console.log('[Dogpamine] 큐레이션 URL 아님 — 시퀀스 종료');
          await chrome.storage.local.set({ curatedQueue: null, curatedIndex: 0 });
        }
      }

      if (
        s.enabled &&
        !self.DogpamineSession.isExpired(s.sessionMode, s.sessionStart)
      ) {
        attach();
      }
    } catch (e) {
      console.warn('[Dogpamine] init storage read failed:', e);
    }
  }

  // ── 14. Dev hotkey — 시연 단축 (Ctrl+Shift+S 단계 사이클) ──────────
  function devCycleStage() {
    if (!state.attached) {
      console.log('[Dogpamine] DEV cycle 무시 — 익스텐션 OFF (popup 토글 ON 필요)');
      return;
    }
    state.currentStageIdx++;
    if (state.currentStageIdx >= STAGES.length) {
      // STOP 다음 → FRESH 리셋. overlayDismissed 도 false 로 → 다음 STOP 에 다시 등장.
      state.currentStageIdx = 0;
      state.recentDwells = [];
      state.measuredDwellCount = 0;
      state.observedVideoCount = 0;
      state.overlayDismissed = false;
      removeOverlay();
      console.log('[Dogpamine] DEV cycle → FRESH (reset)');
    } else {
      console.log(
        `[Dogpamine] DEV cycle → ${STAGES[state.currentStageIdx].label} ` +
        `(sat ${STAGES[state.currentStageIdx].saturation}%)`
      );
    }
    applyStage();
  }

  document.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || !e.shiftKey) return;
    // Ctrl+Shift+S — 단계 강제 cycle (시연 백업)
    if (e.key === 's' || e.key === 'S') {
      e.preventDefault();
      e.stopPropagation();
      devCycleStage();
      return;
    }
    // Ctrl+Shift+D — 큐레이션 영상 강제 점프 (시연용).
    // D 선택 이유: Ctrl+Shift+J 는 Chrome DevTools 콘솔이라 충돌.
    if (e.key === 'd' || e.key === 'D') {
      if (!state.attached) {
        console.log('[Dogpamine] jump 무시 — 익스텐션 OFF');
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      jumpToCuratedShort();
      return;
    }
    // Ctrl+Shift+G — 단일 sparse inject 강제 트리거 (시연용).
    // G 선택 이유: Ctrl+Shift+I (DevTools), B (북마크바) 충돌 회피. D 와 의미 분리:
    //   D = 전체 큐레이션 모드 진입 (시퀀스 + auto-advance)
    //   G = 한 번만 우리 영상으로 navigate, 그 후 YT 자연 흐름 복귀
    if (e.key === 'g' || e.key === 'G') {
      if (!state.attached) {
        console.log('[Dogpamine] sparse inject 무시 — 익스텐션 OFF');
        return;
      }
      if (!onSupportedPath()) {
        console.log('[Dogpamine] sparse inject 무시 — YT Shorts/IG Reels 아님');
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      console.log('[Dogpamine] forced sparse inject (Ctrl+Shift+G)');
      triggerSparseInject();
    }
  }, true); // capture phase — YT 의 단축키와 충돌 회피

  // ── 15. SPA navigation (YT/IG pushState) ─────────────────────────
  // 추가 안전망: attached 상태면 1초마다 현재 stage 채도 재적용.
  // IG 의 video element 가 SPA navigation 또는 src swap 으로 inline style 을
  // 잃을 수 있어 (특히 GPU layer 재생성 시), styleEl 의 CSS 규칙은 살아있지만
  // GPU 합성이 가로채는 경우엔 inline style 도 필요. 비용은 무시할만함.
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      console.log('[Dogpamine] SPA nav →', lastPath);
      if (onSupportedPath()) init();
      else detach();
      return;
    }
    if (state.attached && !state.curatedMode) {
      const sat = STAGES[state.currentStageIdx].saturation;
      // 재적용: video element 들에 inline filter 강제. styleEl 은 손대지 않음.
      state.videoObservers.forEach((_obs, video) => {
        try {
          const current = video.style.getPropertyValue('filter');
          if (!current.includes(`saturate(${sat}%)`)) {
            video.style.setProperty('filter', `saturate(${sat}%)`, 'important');
            video.style.setProperty('transition', SAT_TRANSITION);
          }
        } catch { /* detached */ }
      });
    }
  }, 1000);

  console.log('[Dogpamine] content script loaded on', site.name, location.pathname);
  init();
})();
