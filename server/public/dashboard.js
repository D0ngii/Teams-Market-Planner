const tabSelect = document.getElementById('marketplace-tab');
const findTabsButton = document.getElementById('find-tabs');
const overlayButton = document.getElementById('overlay');
const exportButton = document.getElementById('export');
const relayStatus = document.getElementById('relay-status');
const summary = document.getElementById('summary');
const pending = new Map();
let relayReady = false;

window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== location.origin ||
      event.data?.channel !== 'LOCAL_MARKETPLACE_RESPONSE') return;
  const message = event.data;
  if (message.ready) {
    if (message.version !== 6) {
      relayReady = false;
      setStatus('Extension update needed. Reload it in chrome://extensions, then refresh this page.', true);
    } else if (!relayReady) {
      relayReady = true;
      findTabs();
    }
    return;
  }
  const job = pending.get(message.requestId);
  if (!job) return;
  clearTimeout(job.timer);
  pending.delete(message.requestId);
  if (message.ok) job.resolve(message.data);
  else job.reject(new Error(message.error || 'Extension request failed'));
});

function setStatus(message, error = false) {
  relayStatus.textContent = message;
  relayStatus.className = error ? 'error' : '';
}

function relay(type, fields = {}) {
  if (!relayReady) return Promise.reject(new Error('Reload this page after reloading the extension.'));
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('Extension relay did not answer. Reload the extension and refresh this page.'));
    }, 20000);
    pending.set(requestId, { resolve, reject, timer });
    window.postMessage({ channel: 'LOCAL_MARKETPLACE_REQUEST', type, requestId, ...fields }, location.origin);
  });
}

function selectedTabId() {
  const tabId = Number(tabSelect.value);
  if (!Number.isInteger(tabId) || tabId <= 0) throw new Error('Open a Facebook Marketplace tab first.');
  sessionStorage.setItem('marketplace-tab-id', String(tabId));
  return tabId;
}

async function findTabs() {
  findTabsButton.disabled = true;
  try {
    const result = await relay('LIST_TABS');
    const previous = tabSelect.value || sessionStorage.getItem('marketplace-tab-id');
    tabSelect.replaceChildren();
    if (!result.tabs.length) {
      tabSelect.add(new Option('No Marketplace tab open', ''));
      setStatus('Open Facebook Marketplace in Chrome, then click Find tabs.', true);
      return;
    }
    for (const tab of result.tabs) tabSelect.add(new Option(`${tab.title} — ${tab.url}`, String(tab.id)));
    if (result.tabs.some(tab => String(tab.id) === previous)) tabSelect.value = previous;
    setStatus(`Connected to ${result.tabs.length} Marketplace tab${result.tabs.length === 1 ? '' : 's'}.`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    findTabsButton.disabled = false;
  }
}

async function loadCount() {
  try {
    const response = await fetch('/api/listings/count');
    if (!response.ok) throw new Error(`API returned ${response.status}`);
    const result = await response.json();
    summary.textContent = `${result.count} listings saved locally`;
  } catch {
    summary.textContent = 'Local collection unavailable';
  }
}

findTabsButton.addEventListener('click', findTabs);
overlayButton.addEventListener('click', async () => {
  overlayButton.disabled = true;
  setStatus('Opening Planner in the Marketplace tab…');
  try {
    await relay('OPEN_OVERLAY', { tabId: selectedTabId() });
    setStatus('Planner opened in the Marketplace tab.');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    overlayButton.disabled = false;
  }
});
exportButton.addEventListener('click', async () => {
  exportButton.disabled = true;
  try {
    const response = await fetch('/api/listings');
    if (!response.ok) throw new Error(`API returned ${response.status}`);
    const result = await response.json();
    const blob = new Blob([JSON.stringify(result.listings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `marketplace-listings-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    setStatus(`Export failed: ${error.message}`, true);
  } finally {
    exportButton.disabled = false;
  }
});

loadCount();
setTimeout(() => {
  if (!relayReady) setStatus('Extension bridge not detected. Reload the extension, then refresh this page.', true);
}, 1500);
