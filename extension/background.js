// Dogpamine — service worker.
// T1 단계: install 시 기본 storage 상태 set. alarms 풀 구현은 T6.

const DEFAULT_STATE = {
  enabled: false,
  sessionMode: 'tab',
  sessionStart: 0,
  pausedUntil: null,
};

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.storage.local.set(DEFAULT_STATE);
    console.log('[Dogpamine] installed — default state:', DEFAULT_STATE);
  }
});

console.log('[Dogpamine] background service worker loaded');
