const API = 'http://127.0.0.1:3001/api';
const MARKETPLACE = /^https:\/\/(?:www\.)?facebook\.com\/marketplace(?:\/|$)/;
const DASHBOARD = /^http:\/\/(?:127\.0\.0\.1|localhost):3001\//;

async function api(path, options = {}) {
  const response = await fetch(API + path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Local API returned ${response.status}`);
  return data;
}

function save(listings) {
  return api('/listings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ listings })
  });
}

async function marketplaceTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs.filter(tab => tab.id && MARKETPLACE.test(tab.url || ''));
}

async function selectedTab(tabId) {
  if (!Number.isInteger(tabId)) throw new Error('Choose a Marketplace tab first.');
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !MARKETPLACE.test(tab.url || '')) throw new Error('That Marketplace tab is no longer open.');
  return tab;
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function navigate(tabId, url) {
  await chrome.tabs.update(tabId, { url });
  // Facebook may render results after navigation completes. Extraction retries below
  // only for this explicit dashboard action.
  await delay(900);
}

async function capture(tabId, expectedId = null) {
  let listings = [];
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const result = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_LISTINGS' });
      if (result?.ok) listings = result.listings || [];
      if (listings.length && (!expectedId || listings.some(item => item.id === expectedId))) break;
    } catch { /* The new document may still be loading. */ }
    await delay(700);
  }
  if (!listings.length) throw new Error('No displayed listings found in the Marketplace tab. Wait for it to load, then try again.');
  if (expectedId && !listings.some(item => item.id === expectedId)) {
    throw new Error('The listing detail page has not loaded yet. Try again.');
  }
  const saved = await save(listings);
  return { listings, saved };
}

const inspectingTabs = new Set();

function sameSearch(url, original) {
  try {
    const current = new URL(url);
    const target = new URL(original);
    return current.origin === target.origin
      && current.pathname.replace(/\/$/, '') === target.pathname.replace(/\/$/, '')
      && current.search === target.search;
  } catch { return url === original; }
}

async function returnToSearch(tabId, originalUrl) {
  try { await chrome.tabs.goBack(tabId); } catch { /* The direct load below still returns to the search. */ }
  for (let attempt = 0; attempt < 8; attempt++) {
    await delay(250);
    const current = await chrome.tabs.get(tabId).catch(() => null);
    if (!current?.url) return;
    if (sameSearch(current.url, originalUrl)) return;
    if (current.status === 'complete' && !/\/marketplace\/item\//.test(current.url)) break;
  }
  const current = await chrome.tabs.get(tabId).catch(() => null);
  if (!current?.url || !sameSearch(current.url, originalUrl)) {
    await chrome.tabs.update(tabId, { url: originalUrl }).catch(() => {});
  }
}

async function inspectItem(tabId, listingId, snapshot) {
  const tab = await selectedTab(tabId);
  if (inspectingTabs.has(tabId)) throw new Error('A listing is already being inspected.');
  inspectingTabs.add(tabId);
  const key = `inspectionTab:${tabId}`;
  const originalUrl = tab.url;
  const targetUrl = `https://www.facebook.com/marketplace/item/${listingId}/`;
  const inspection = { listingId, originalUrl, snapshot, phase: 'loading' };
  let navigated = false;
  try {
    await chrome.storage.session.set({ [key]: inspection });
    if (new URL(originalUrl).pathname !== new URL(targetUrl).pathname) {
      await chrome.tabs.update(tabId, { url: targetUrl });
      navigated = true;
    }
    let detail = null;
    for (let attempt = 0; attempt < 16; attempt++) {
      await chrome.tabs.get(tabId).catch(() => null);
      await delay(400);
      try {
        const result = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_LISTINGS' });
        const candidate = result?.listings?.find(item => item.id === listingId);
        if (candidate && (!detail || Object.keys(candidate).filter(field => candidate[field]).length >
            Object.keys(detail).filter(field => detail[field]).length)) detail = candidate;
        if (detail?.description) break;
      } catch { /* The listing page may still be loading. */ }
    }
    if (detail) await save([detail]);
    inspection.message = detail?.description
      ? 'Description captured and saved.'
      : detail ? 'Listing loaded, but no description was displayed.'
        : 'The listing did not finish loading; no details were captured.';
  } catch (error) {
    inspection.message = `Could not capture details: ${error.message}`;
  } finally {
    if (navigated) {
      inspection.phase = 'returning';
      await chrome.storage.session.set({ [key]: inspection }).catch(() => {});
      await returnToSearch(tabId, originalUrl);
    }
    inspection.phase = 'done';
    await chrome.storage.session.set({ [key]: inspection }).catch(() => {});
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        await chrome.tabs.sendMessage(tabId, { type: 'INSPECTION_DONE', message: inspection.message });
        break;
      } catch { await delay(300); }
    }
    inspectingTabs.delete(tabId);
  }
  return { started: true };
}

async function readItemQuietly(openerTabId, listingId) {
  const opener = await chrome.tabs.get(openerTabId);
  const targetUrl = `https://www.facebook.com/marketplace/item/${listingId}/`;
  let win;
  try {
    win = await chrome.windows.create({
      url: targetUrl, type: 'popup', focused: false, left: -3200, top: 0, width: 1280, height: 900
    });
  } catch {
    win = await chrome.windows.create({ url: targetUrl, type: 'popup', focused: false, state: 'minimized' });
  }
  if (opener?.windowId != null) await chrome.windows.update(opener.windowId, { focused: true }).catch(() => {});
  let tabId = win.tabs?.[0]?.id;
  if (!tabId && win?.id != null) {
    for (let attempt = 0; attempt < 10 && !tabId; attempt++) {
      await delay(200);
      tabId = (await chrome.tabs.query({ windowId: win.id }))[0]?.id;
    }
  }
  try {
    if (!tabId) throw new Error('Could not open the listing.');
    let detail = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      await delay(500);
      try {
        const result = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_LISTINGS' });
        const candidate = result?.listings?.find(item => item.id === listingId);
        const photos = item => item?.images?.length || 0;
        if (candidate && (!detail || photos(candidate) > photos(detail) || (photos(candidate) === photos(detail) && candidate.description && !detail.description))) detail = candidate;
        if (detail?.description && photos(detail) > 1) break;
        if (detail?.description && attempt >= 8) break;
      } catch { /* The listing page may still be loading. */ }
    }
    if (detail && (typeof detail.price !== 'number' || !Number.isFinite(detail.price))) detail.price = null;
    if (detail) await save([detail]).catch(() => {});
    return { listing: detail };
  } finally {
    if (win?.id != null) await chrome.windows.remove(win.id).catch(() => {});
    if (opener?.windowId != null) await chrome.windows.update(opener.windowId, { focused: true }).catch(() => {});
  }
}

async function relay(message) {
  if (message.command === 'LIST_TABS') {
    const tabs = await marketplaceTabs();
    return { tabs: tabs.map(tab => ({ id: tab.id, title: tab.title || 'Marketplace', url: tab.url })) };
  }
  const tab = await selectedTab(message.tabId);
  if (message.command === 'OPEN_OVERLAY') {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'OPEN_OVERLAY' })
      .catch(() => { throw new Error('Reload the Marketplace tab and try again.'); });
    if (!response?.ok) throw new Error(response?.error || 'Could not open full page view.');
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return { opened: true };
  }
  if (message.command === 'CAPTURE_TAB') return capture(tab.id);
  if (message.command === 'SEARCH_TAB') {
    if (typeof message.query !== 'string' || !message.query.trim() || message.query.length > 120) {
      throw new Error('Enter a search of up to 120 characters.');
    }
    const url = `https://www.facebook.com/marketplace/search/?query=${encodeURIComponent(message.query.trim())}`;
    await navigate(tab.id, url);
    return capture(tab.id);
  }
  if (message.command === 'OPEN_ITEM') {
    if (typeof message.listingId !== 'string' || !/^\d{1,30}$/.test(message.listingId)) {
      throw new Error('Invalid listing ID.');
    }
    await navigate(tab.id, `https://www.facebook.com/marketplace/item/${message.listingId}/`);
    return capture(tab.id, message.listingId);
  }
  throw new Error('Unknown dashboard command.');
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const respond = promise => {
    promise.then(data => sendResponse({ ok: true, data }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  };

  if (message?.type === 'DASHBOARD_RELAY') {
    if (!DASHBOARD.test(sender.url || '') || !sender.tab ||
        !['LIST_TABS', 'CAPTURE_TAB', 'SEARCH_TAB', 'OPEN_ITEM', 'OPEN_OVERLAY'].includes(message.command)) return;
    return respond(relay(message));
  }
  if (message?.type === 'SAVE_LISTINGS') return respond(save(message.listings));
  if (message?.type === 'GET_SAVED_LISTINGS') return respond(api('/listings'));
  if (message?.type === 'PIN_LISTING' && /^\d{1,30}$/.test(message.id || '') &&
      typeof message.pinned === 'boolean') {
    return respond(api(`/listings/${message.id}/pin`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: message.pinned })
    }));
  }
  if (message?.type === 'GET_COUNT') return respond(api('/listings/count'));
  if (message?.type === 'EXPORT_LISTINGS') return respond(api('/listings'));
  if (message?.type === 'READ_ITEM' && sender.tab?.id && MARKETPLACE.test(sender.url || '') &&
      /^\d{1,30}$/.test(message.listingId || '')) {
    return respond(readItemQuietly(sender.tab.id, message.listingId));
  }
  if (message?.type === 'INSPECT_ITEM' && sender.tab?.id && MARKETPLACE.test(sender.url || '') &&
      /^\d{1,30}$/.test(message.listingId || '')) {
    return respond(inspectItem(sender.tab.id, message.listingId, message.snapshot || null));
  }
  if (message?.type === 'RETURN_INSPECTION' && sender.tab?.id) {
    return respond(chrome.storage.session.get(`inspectionTab:${sender.tab.id}`).then(async value => {
      const inspection = value[`inspectionTab:${sender.tab.id}`];
      if (inspection?.originalUrl) await returnToSearch(sender.tab.id, inspection.originalUrl);
      return {};
    }));
  }
  if (message?.type === 'CLEAR_INSPECTION' && sender.tab?.id) {
    return respond(chrome.storage.session.remove(`inspectionTab:${sender.tab.id}`).then(() => ({})));
  }
  if (message?.type === 'SET_OVERLAY' && sender.tab?.id) {
    return respond(chrome.storage.session.set({ [`overlayTab:${sender.tab.id}`]: !!message.enabled })
      .then(() => ({ enabled: !!message.enabled })));
  }
  if (message?.type === 'SET_SAFE' && sender.tab?.id) {
    return respond(chrome.storage.session.set({ [`safeTab:${sender.tab.id}`]: !!message.enabled })
      .then(() => ({ safe: !!message.enabled })));
  }
  if (message?.type === 'GET_OVERLAY' && sender.tab?.id) {
    return respond(chrome.storage.session.get([`overlayTab:${sender.tab.id}`, `safeTab:${sender.tab.id}`, `inspectionTab:${sender.tab.id}`])
      .then(value => ({
        enabled: !!value[`overlayTab:${sender.tab.id}`],
        safe: !!value[`safeTab:${sender.tab.id}`],
        inspection: value[`inspectionTab:${sender.tab.id}`] || null
      })));
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
  chrome.storage.session.remove([`overlayTab:${tabId}`, `safeTab:${tabId}`, `inspectionTab:${tabId}`]).catch(() => {});
});
