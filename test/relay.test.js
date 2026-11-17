import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('dashboard relay reads the selected Marketplace tab and saves its rendered listings', async () => {
  const tabs = [
    { id: 7, windowId: 1, active: false, title: 'Marketplace', url: 'https://www.facebook.com/marketplace/search/' },
    { id: 8, windowId: 1, active: false, title: 'Other', url: 'https://example.com/' },
    { id: 10, windowId: 1, active: true, title: 'Dashboard', url: 'http://127.0.0.1:3001/' }
  ];
  const sent = [];
  const overlayMessages = [];
  const session = new Map();
  let listener;
  const chrome = {
    runtime: { onMessage: { addListener(fn) { listener = fn; } } },
    storage: { session: {
      set: async values => { for (const [key, value] of Object.entries(values)) session.set(key, value); },
      get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, session.get(key)])),
      remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) session.delete(key); }
    } },
    windows: { update: async (id, properties) => {
      assert.equal(id, 1);
      assert.equal(properties.focused, true);
    } },
    tabs: {
      onRemoved: { addListener() {} },
      query: async () => tabs,
      get: async id => tabs.find(tab => tab.id === id),
      update: async (id, properties) => {
        const tab = tabs.find(item => item.id === id);
        if (properties.url) {
          tab.previousUrl = tab.url;
          tab.url = properties.url;
        }
        if (properties.active) tab.active = true;
      },
      goBack: async id => {
        const tab = tabs.find(item => item.id === id);
        tab.url = tab.previousUrl;
      },
      sendMessage: async (id, message) => {
        assert.equal(id, 7);
        if (message.type === 'OPEN_OVERLAY') {
          overlayMessages.push(message);
          return { ok: true };
        }
        if (message.type === 'INSPECTION_DONE') return { ok: true };
        const listings = [{ id: '123', title: 'Chair', listingUrl: 'https://www.facebook.com/marketplace/item/123/',
          description: tabs[0].url.includes('/marketplace/item/123/') ? 'Solid wood' : null }];
        return { ok: true, listings };
      }
    }
  };
  const fetch = async (url, options) => {
    sent.push({ url, options });
    return { ok: true, json: async () => ({ inserted: 1, updated: 0, count: 1 }) };
  };
  runInNewContext(readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8'), {
    chrome, fetch, setTimeout: callback => queueMicrotask(callback), URL
  });
  const sender = { url: 'http://127.0.0.1:3001/', tab: tabs[2] };
  const call = message => new Promise(resolve => {
    assert.equal(listener(message, sender, resolve), true);
  });

  const available = await call({ type: 'DASHBOARD_RELAY', command: 'LIST_TABS' });
  assert.equal(available.data.tabs.length, 1);
  const capture = await call({ type: 'DASHBOARD_RELAY', command: 'CAPTURE_TAB', tabId: 7 });
  assert.equal(capture.data.listings[0].id, '123');
  assert.equal(sent.length, 1);
  assert.match(sent[0].url, /\/api\/listings$/);
  assert.equal(JSON.parse(sent[0].options.body).listings[0].title, 'Chair');

  const opened = await call({ type: 'DASHBOARD_RELAY', command: 'OPEN_OVERLAY', tabId: 7 });
  assert.equal(opened.data.opened, true);
  assert.equal(overlayMessages.length, 1);
  assert.equal(tabs[0].active, true);

  const search = await call({ type: 'DASHBOARD_RELAY', command: 'SEARCH_TAB', tabId: 7, query: 'blue chair' });
  assert.equal(search.ok, true);
  assert.equal(tabs[0].url, 'https://www.facebook.com/marketplace/search/?query=blue%20chair');
  const rejected = await call({ type: 'DASHBOARD_RELAY', command: 'CAPTURE_TAB', tabId: 8 });
  assert.equal(rejected.ok, false);

  const marketplaceSender = { tab: tabs[0], url: 'https://www.facebook.com/marketplace/search/' };
  const localCall = message => new Promise(resolve => {
    assert.equal(listener(message, marketplaceSender, resolve), true);
  });
  await localCall({ type: 'SET_OVERLAY', enabled: true });
  await localCall({ type: 'SET_SAFE', enabled: true });
  const overlay = await localCall({ type: 'GET_OVERLAY' });
  assert.equal(overlay.data.enabled, true);
  assert.equal(overlay.data.safe, true);
  const origin = tabs[0].url;
  const inspected = await localCall({ type: 'INSPECT_ITEM', listingId: '123', snapshot: { listings: [] } });
  assert.equal(inspected.data.started, true);
  assert.equal(tabs[0].url, origin);
  assert.equal(JSON.parse(sent.at(-1).options.body).listings[0].description, 'Solid wood');
  const state = await localCall({ type: 'GET_OVERLAY' });
  assert.equal(state.data.inspection.phase, 'done');
  await localCall({ type: 'GET_SAVED_LISTINGS' });
  assert.match(sent.at(-1).url, /\/api\/listings$/);
  await localCall({ type: 'PIN_LISTING', id: '123', pinned: true });
  assert.match(sent.at(-1).url, /\/api\/listings\/123\/pin$/);
  assert.equal(sent.at(-1).options.method, 'PATCH');
  assert.equal(JSON.parse(sent.at(-1).options.body).pinned, true);
});
