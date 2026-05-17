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
      urlPattern: /\/reels\//,
      videoSelector: 'main video',
      mutationRoot: () => document.querySelector('main') || document.body,
      name: 'Instagram',
    },
  };

  const host = location.hostname.replace(/^www\./, '');
  const site = SITE_CONFIG[host];
  if (!site) return;

  const onSupportedPath = () => site.urlPattern.test(location.pathname);

  // ── 2. Stages + constants ────────────────────────────────────────
  const STAGES = [
    { dwellLt: Infinity, saturation: 100, overlay: false, label: 'FRESH' },
    { dwellLt: 6,        saturation: 90,  overlay: false, label: 'WARMING' },
    { dwellLt: 4,        saturation: 75,  overlay: false, label: 'DRIFTING' },
    { dwellLt: 3,        saturation: 60,  overlay: false, label: 'FADING' },
    { dwellLt: 2,        saturation: 45,  overlay: false, label: 'QUIETING' },
    { dwellLt: 1.5,      saturation: 35,  overlay: true,  label: 'STOP' },
  ];

  const DWELL_WINDOW = 5;
  const EXPIRY_CHECK_MS = 60_000;
  const DISCOVERY_DEBOUNCE_MS = 100;
  const PUSH_THROTTLE_MS = 1000;

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
    pausedUntil: null,
    storageChangeCounter: 0,
    initSnapshotCounter: 0,
    lastPushAt: 0,
  };

  const isExtensionAlive = () => {
    try { return !!chrome.runtime?.id; } catch { return false; }
  };

  // ── 4. Style element (synchronous no-op — Eng 5: no flash) ────────
  // Curve: cubic-bezier(0.4, 0, 0.2, 1) = Material standard "decelerate".
  // 2s duration (1.5s → 2s, autoplan T3 회수 시간) — 채도 "draining" 더 부드럽게.
  const SAT_TRANSITION = 'filter 2s cubic-bezier(0.4, 0, 0.2, 1)';
  const styleEl = document.createElement('style');
  styleEl.id = 'dogpamine-filter';
  styleEl.textContent = `html { filter: saturate(100%); transition: ${SAT_TRANSITION}; }`;
  document.documentElement.appendChild(styleEl);

  function setSaturation(percent) {
    styleEl.textContent =
      `html { filter: saturate(${percent}%); transition: ${SAT_TRANSITION}; }`;
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
        <button type="button" class="dogpamine-card__close" id="dogpamine-overlay-close">
          알겠어요
        </button>
        <p class="dogpamine-card__legend">포만감 알고리즘 · 행동 패턴 감지</p>
      </div>
    `;
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('visible'));

    const closeBtn = wrap.querySelector('#dogpamine-overlay-close');
    const close = () => {
      state.overlayDismissed = true;
      wrap.classList.remove('visible');
      // transition 끝나면 제거 (250ms)
      setTimeout(() => wrap.remove(), 300);
      // ESC focus trap 해제
      document.removeEventListener('keydown', onEsc);
    };
    closeBtn.addEventListener('click', close);
    const onEsc = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onEsc);
    closeBtn.focus();
  }

  function removeOverlay() {
    const ov = document.getElementById('dogpamine-overlay');
    if (ov) ov.remove();
  }

  function isPaused() {
    return state.pausedUntil && state.pausedUntil > Date.now();
  }

  function maybeAdvanceStage() {
    if (state.recentDwells.length < DWELL_WINDOW) return;
    if (isPaused()) return; // pausedUntil 매 tick 체크
    const avgSec =
      state.recentDwells.reduce((a, b) => a + b, 0) / state.recentDwells.length / 1000;
    for (let i = STAGES.length - 1; i > state.currentStageIdx; i--) {
      if (avgSec < STAGES[i].dwellLt) {
        state.currentStageIdx = i;
        applyStage();
        return;
      }
    }
  }

  // ── 6. Video observer (dwell measurement) ─────────────────────────
  function attachVideoObserver(video) {
    if (state.videoObservers.has(video)) return;
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

    const root = site.mutationRoot();
    const mo = new MutationObserver((mutations) => {
      const added = [];
      for (const m of mutations) for (const n of m.addedNodes) added.push(n);
      if (added.length) queueDiscovery(added);
    });
    mo.observe(root, { childList: true, subtree: true });
    state.mutationObserver = mo;

    discoverExisting(root);

    state.expiryHandle = setInterval(checkExpiry, EXPIRY_CHECK_MS);
    applyStage();
  }

  function detach() {
    if (!state.attached) return;
    state.attached = false;
    console.log('[Dogpamine] detach');

    if (state.mutationObserver) {
      state.mutationObserver.disconnect();
      state.mutationObserver = null;
    }
    state.videoObservers.forEach((obs, video) => {
      obs.disconnect();
      delete video.dataset.dogViewStart;
    });
    state.videoObservers.clear();

    if (state.expiryHandle) {
      clearInterval(state.expiryHandle);
      state.expiryHandle = null;
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

  // ── 11. Message handler (popup get-state) ────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (msg?.type === 'get-state') {
      respond(buildSnapshot());
    }
  });

  // ── 12. Storage onChanged ────────────────────────────────────────
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    state.storageChangeCounter++;

    if ('enabled' in changes) {
      const enabled = changes.enabled.newValue;
      if (enabled && onSupportedPath()) attach();
      else if (!enabled) detach();
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
      ]);
      if (state.storageChangeCounter > state.initSnapshotCounter) {
        // onChanged 가 get 사이에 발생 → 핸들러가 이미 신선한 상태 반영함, seed skip.
        console.log('[Dogpamine] init: onChanged advanced past us, skip seed');
        return;
      }
      state.pausedUntil = s.pausedUntil || null;
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

  // ── 14. SPA navigation (YT/IG pushState) ─────────────────────────
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    console.log('[Dogpamine] SPA nav →', lastPath);
    if (onSupportedPath()) init();
    else detach();
  }, 1000);

  console.log('[Dogpamine] content script loaded on', site.name, location.pathname);
  init();
})();
