// Dogpamine — popup controller.
// 5-state UI machine: loading → (off | on | paused | error).
// Pattern: storage 가 진실의 소스. UI 는 항상 storage 를 반영. 토글/라디오/일시정지는
// storage 에 쓰고, storage.onChanged 가 다시 UI 를 그림 (단방향 데이터 흐름).

(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const { isExpired } = self.DogpamineSession;

  const SUPPORTED_URL_RE =
    /^https:\/\/www\.(?:youtube\.com\/shorts\/|instagram\.com\/reels\/)/;
  const PAUSE_DURATION_MS = 5 * 60 * 1000;
  const POLL_INTERVAL_MS = 10_000;
  const PUSH_FRESHNESS_MS = 5_000;

  let activeTabId = null;
  let pollHandle = null;
  let countdownHandle = null;
  let lastPushTs = 0;

  // ── 초기화 ───────────────────────────────────────────────────
  async function init() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      activeTabId = tab?.id ?? null;
      const url = tab?.url ?? '';
      console.log('[Dogpamine popup] active tab url =', url);

      if (!url || !SUPPORTED_URL_RE.test(url)) {
        setState('error');
        return;
      }

      const stored = await chrome.storage.local.get([
        'enabled', 'sessionMode', 'sessionStart', 'pausedUntil',
      ]);
      console.log('[Dogpamine popup] storage =', stored);

      // 안전망: 만료된 세션이 enabled=true 인 채로 남아있으면 즉시 정리.
      if (stored.enabled && isExpired(stored.sessionMode, stored.sessionStart)) {
        await chrome.storage.local.set({ enabled: false });
        stored.enabled = false;
        stored.pausedUntil = null;
      }

      renderFromStorage(stored);
      startPolling();
    } catch (e) {
      // init() 가 어디서 throw 되면 popup 이 영원히 "로딩 중…" 에 박힘.
      // 가시적 fallback — error state 의 카피를 바꿔서 정확한 원인 노출.
      console.error('[Dogpamine popup] init failed:', e);
      const errTitle = document.querySelector('.error-title');
      const errMuted = document.querySelector('.state--error .muted');
      if (errTitle) errTitle.textContent = '오류 발생';
      if (errMuted) errMuted.textContent = `popup 초기화 실패: ${e?.message || e}`;
      setState('error');
    }
  }

  // ── storage → UI ─────────────────────────────────────────────
  function renderFromStorage(stored) {
    const { enabled, sessionMode, pausedUntil } = stored;
    const now = Date.now();

    // 두 토글 input 의 checked 상태 동기화 — 각 섹션의 자연 상태로.
    $('toggle-off').checked = false;
    $('toggle-on').checked = true;

    // 라디오 동기화
    if (sessionMode) {
      const radio = document.querySelector(
        `input[name="session"][value="${sessionMode}"]`
      );
      if (radio) radio.checked = true;
    }

    if (enabled && pausedUntil && pausedUntil > now) {
      setState('paused');
      startCountdown();
      return;
    }

    stopCountdown();
    setState(enabled ? 'on' : 'off');
  }

  function setState(state) {
    body.dataset.state = state;
  }

  // ── 토글 핸들러 ──────────────────────────────────────────────
  $('toggle-off').addEventListener('change', async (e) => {
    if (e.target.checked) await enable();
  });
  $('toggle-on').addEventListener('change', async (e) => {
    if (!e.target.checked) await disable();
  });

  async function enable() {
    const selected =
      document.querySelector('input[name="session"]:checked')?.value || 'today';
    await chrome.storage.local.set({
      enabled: true,
      sessionMode: selected,
      sessionStart: Date.now(),
      pausedUntil: null,
    });
    // background 에 알람 등록 요청 — T6 에서 처리. 지금은 listener 없으면 silent fail.
    chrome.runtime
      .sendMessage({ type: 'session-start', mode: selected })
      .catch(() => {});
  }

  async function disable() {
    await chrome.storage.local.set({ enabled: false, pausedUntil: null });
    chrome.runtime.sendMessage({ type: 'session-end' }).catch(() => {});
  }

  // ── 라디오 핸들러 ────────────────────────────────────────────
  document.querySelectorAll('input[name="session"]').forEach((r) => {
    r.addEventListener('change', async (e) => {
      if (!e.target.checked) return;
      const mode = e.target.value;
      await chrome.storage.local.set({ sessionMode: mode, sessionStart: Date.now() });
      chrome.runtime
        .sendMessage({ type: 'session-mode-change', mode })
        .catch(() => {});
    });
  });

  // ── 일시정지 / 재개 ──────────────────────────────────────────
  $('pause-btn').addEventListener('click', async () => {
    const until = Date.now() + PAUSE_DURATION_MS;
    await chrome.storage.local.set({ pausedUntil: until });
  });

  $('resume-btn').addEventListener('click', async () => {
    await chrome.storage.local.set({ pausedUntil: null });
  });

  // ── 콘텐츠 스크립트로부터 stats 수신 (push + 10s keep-alive poll) ─
  async function fetchContentState() {
    if (!activeTabId) return;
    try {
      const resp = await chrome.tabs.sendMessage(activeTabId, { type: 'get-state' });
      if (resp) updateStats(resp);
    } catch {
      // 콘텐츠 스크립트 미주입 또는 페이지 전환 — stats 그대로 유지.
    }
  }

  function updateStats({ stage, saturation, measured, avgDwell }) {
    if (stage) {
      $('stage-badge').dataset.stage = stage;
      $('stage-badge').textContent = stage;
    }
    $('stat-saturation').innerHTML =
      saturation != null ? `${saturation}%` : '<span data-empty>—</span>';
    $('stat-count').innerHTML =
      measured > 0 ? `${measured}개` : '<span data-empty>측정 중…</span>';
    $('stat-dwell').innerHTML =
      avgDwell != null
        ? `${avgDwell.toFixed(1)}초`
        : '<span data-empty>측정 중…</span>';
  }

  function startPolling() {
    fetchContentState();
    pollHandle = setInterval(() => {
      // push 가 5초 안에 왔으면 폴링 skip (Eng 6: push 우선, poll 은 fallback).
      if (Date.now() - lastPushTs > PUSH_FRESHNESS_MS) fetchContentState();
    }, POLL_INTERVAL_MS);
  }

  // content script → popup push
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'state-update' && body.dataset.state === 'on') {
      lastPushTs = Date.now();
      updateStats(msg.payload);
    }
  });

  // ── storage.onChanged (다른 컨텍스트 변경 즉시 반영) ─────────
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    const relevant = ['enabled', 'sessionMode', 'sessionStart', 'pausedUntil'];
    if (!relevant.some((k) => k in changes)) return;
    const stored = await chrome.storage.local.get(relevant);
    renderFromStorage(stored);
  });

  // ── 일시정지 카운트다운 ──────────────────────────────────────
  function startCountdown() {
    stopCountdown();
    updateCountdown();
    countdownHandle = setInterval(updateCountdown, 1000);
  }

  function stopCountdown() {
    if (countdownHandle) {
      clearInterval(countdownHandle);
      countdownHandle = null;
    }
  }

  async function updateCountdown() {
    const { pausedUntil } = await chrome.storage.local.get('pausedUntil');
    if (!pausedUntil) {
      stopCountdown();
      return;
    }
    const remainingMs = pausedUntil - Date.now();
    if (remainingMs <= 0) {
      // 자동 재개
      await chrome.storage.local.set({ pausedUntil: null });
      stopCountdown();
      return;
    }
    const mins = Math.floor(remainingMs / 60_000);
    const secs = Math.floor((remainingMs % 60_000) / 1000);
    $('pause-remaining').textContent = `${mins}:${String(secs).padStart(2, '0')}`;
  }

  // ── popup 닫힐 때 cleanup ────────────────────────────────────
  window.addEventListener('unload', () => {
    if (pollHandle) clearInterval(pollHandle);
    stopCountdown();
  });

  // Boot
  init();
})();
