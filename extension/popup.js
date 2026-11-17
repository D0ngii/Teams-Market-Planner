const extractButton = document.getElementById('extract');
const dashboardButton = document.getElementById('dashboard');
const overlayButton = document.getElementById('overlay');
const exportButton = document.getElementById('export');
const status = document.getElementById('status');
const count = document.getElementById('count');

function setStatus(message, error = false) {
  status.textContent = message;
  status.className = error ? 'error' : '';
}

function send(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!response?.ok) return reject(new Error(response?.error || 'Local API unavailable'));
      resolve(response.data);
    });
  });
}

function queryTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_LISTINGS' }, response => {
      if (chrome.runtime.lastError) return reject(new Error('Reload the Marketplace tab and try again.'));
      if (!response?.ok) return reject(new Error(response?.error || 'Could not read this page'));
      resolve(response.listings);
    });
  });
}

dashboardButton.addEventListener('click', () => {
  chrome.tabs.create({ url: 'http://127.0.0.1:3001/' });
});

overlayButton.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url && new URL(tab.url);
    if (!url || !['facebook.com', 'www.facebook.com'].includes(url.hostname) ||
        !/^\/marketplace(?:\/|$)/.test(url.pathname)) {
      throw new Error('Open a Facebook Marketplace tab first.');
    }
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'OPEN_OVERLAY' });
    if (!response?.ok) throw new Error(response?.error || 'Could not open full page view.');
    window.close();
  } catch (error) {
    setStatus(error.message, true);
  }
});

async function refreshCount() {
  try {
    const result = await send({ type: 'GET_COUNT' });
    count.textContent = `Saved listings: ${result.count}`;
  } catch {
    count.textContent = 'Local API offline';
  }
}

extractButton.addEventListener('click', async () => {
  extractButton.disabled = true;
  setStatus('Reading the current page…');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url && new URL(tab.url);
    if (!url || !['facebook.com', 'www.facebook.com'].includes(url.hostname) ||
        !/^\/marketplace(?:\/|$)/.test(url.pathname)) {
      throw new Error('Open a Facebook Marketplace tab first.');
    }
    const listings = await queryTab(tab.id);
    if (!listings.length) {
      setStatus('No displayed listing links found. Scroll or open a listing and try again.');
      return;
    }
    const result = await send({ type: 'SAVE_LISTINGS', listings });
    setStatus(`Found ${listings.length}; added ${result.inserted}, updated ${result.updated}.`);
    await refreshCount();
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    extractButton.disabled = false;
  }
});

exportButton.addEventListener('click', async () => {
  exportButton.disabled = true;
  try {
    const data = await send({ type: 'EXPORT_LISTINGS' });
    const blob = new Blob([JSON.stringify(data.listings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `marketplace-listings-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(`Exported ${data.listings.length} listings.`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    exportButton.disabled = false;
  }
});

refreshCount();
