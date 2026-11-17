(() => {
  const REQUEST = 'LOCAL_MARKETPLACE_REQUEST';
  const RESPONSE = 'LOCAL_MARKETPLACE_RESPONSE';
  const allowed = new Set(['LIST_TABS', 'CAPTURE_TAB', 'SEARCH_TAB', 'OPEN_ITEM', 'OPEN_OVERLAY']);

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (message?.channel !== REQUEST || typeof message.requestId !== 'string') return;
    if (!allowed.has(message.type)) {
      window.postMessage({ channel: RESPONSE, requestId: message.requestId,
        ok: false, error: 'The extension does not support this action. Reload it in chrome://extensions and refresh both tabs.' }, location.origin);
      return;
    }
    chrome.runtime.sendMessage({ type: 'DASHBOARD_RELAY', command: message.type,
      tabId: message.tabId, query: message.query, listingId: message.listingId }, response => {
      const result = chrome.runtime.lastError
        ? { ok: false, error: chrome.runtime.lastError.message }
        : response || { ok: false, error: 'Extension did not respond' };
      window.postMessage({ channel: RESPONSE, requestId: message.requestId, ...result }, location.origin);
    });
  });

  window.postMessage({ channel: RESPONSE, ready: true, version: 6 }, location.origin);
})();
