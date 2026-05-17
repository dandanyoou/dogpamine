// Dogpamine — service worker.
//
// MV3 SW 는 dormancy 가 있어서 setInterval/setTimeout 신뢰 불가.
// 모든 작업은 이벤트 / alarm 트리거:
//   onInstalled        → 기본 storage 상태
//   onStartup          → 세션 유효성 재검증, alarm 재무장
//   onMessage          → popup 명령 (session-start/mode-change/end)
//   onAlarm            → expiry → storage.enabled=false
//   tabs.onRemoved     → tab 모드일 때 모든 YT/IG 탭 닫히면 OFF

importScripts('lib/session.js');

const { isExpired, expiryMs, delayMinutesUntil } = self.DogpamineSession;

const ALARM_NAME = 'dogpamine-session-expiry';
const SUPPORTED_RE =
  /^https:\/\/www\.(?:youtube\.com\/shorts\/|instagram\.com\/reels\/)/;

const DEFAULT_STATE = {
  enabled: false,
  sessionMode: 'tab',
  sessionStart: 0,
  pausedUntil: null,
};

// ── 1. Install: defaults ─────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    await chrome.storage.local.set(DEFAULT_STATE);
    console.log('[Dogpamine] installed — default state:', DEFAULT_STATE);
  }
});

// ── 2. Browser startup: verify + re-arm ──────────────────────────
chrome.runtime.onStartup.addListener(async () => {
  const s = await chrome.storage.local.get([
    'enabled', 'sessionMode', 'sessionStart',
  ]);
  if (!s.enabled) return;
  if (isExpired(s.sessionMode, s.sessionStart)) {
    console.log('[Dogpamine] startup: session expired → disabling');
    await chrome.storage.local.set({ enabled: false });
    await chrome.alarms.clear(ALARM_NAME);
    return;
  }
  await ensureAlarm(s.sessionMode, s.sessionStart);
});

// ── 3. Alarm management ──────────────────────────────────────────
async function ensureAlarm(sessionMode, sessionStart) {
  if (sessionMode === 'tab') {
    await chrome.alarms.clear(ALARM_NAME);
    return;
  }
  const delayMin = delayMinutesUntil(expiryMs(sessionMode, sessionStart));
  if (delayMin === null) {
    await chrome.alarms.clear(ALARM_NAME);
    return;
  }
  await chrome.alarms.create(ALARM_NAME, { delayInMinutes: delayMin });
  console.log(
    `[Dogpamine] alarm armed: ${delayMin.toFixed(2)}min (mode=${sessionMode})`
  );
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  console.log('[Dogpamine] alarm fired → disabling');
  await chrome.storage.local.set({ enabled: false });
  // storage.onChanged 가 모든 content script 의 detach() 트리거
});

// ── 4. Messages from popup ───────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (
    msg?.type === 'session-start' ||
    msg?.type === 'session-mode-change'
  ) {
    chrome.storage.local
      .get(['sessionMode', 'sessionStart'])
      .then((s) => ensureAlarm(s.sessionMode, s.sessionStart));
  } else if (msg?.type === 'session-end') {
    chrome.alarms.clear(ALARM_NAME);
  }
  // 'state-update' (content → popup) 와 'get-state' (popup → content)
  // 는 background 가 처리할 게 없음. silent ignore.
});

// ── 5. Tab-mode cleanup ──────────────────────────────────────────
chrome.tabs.onRemoved.addListener(async () => {
  const s = await chrome.storage.local.get(['enabled', 'sessionMode']);
  if (!s.enabled || s.sessionMode !== 'tab') return;
  const tabs = await chrome.tabs.query({});
  const hasSupported = tabs.some(
    (t) => t.url && SUPPORTED_RE.test(t.url)
  );
  if (!hasSupported) {
    console.log('[Dogpamine] tab mode: no YT/IG tabs left → disabling');
    await chrome.storage.local.set({ enabled: false });
    await chrome.alarms.clear(ALARM_NAME);
  }
});

console.log('[Dogpamine] background service worker loaded');
