(() => {
  const ITEM_PATH = /^\/marketplace\/item\/(\d+)(?:\/|$)/;

  function clean(value) {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  }

  function rendered(element) {
    if (!element?.isConnected || !element.getClientRects().length) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function itemLink(anchor) {
    try {
      const url = new URL(anchor.href);
      if (!['facebook.com', 'www.facebook.com'].includes(url.hostname)) return null;
      const match = url.pathname.match(ITEM_PATH);
      return match ? { id: match[1], listingUrl: `https://www.facebook.com/marketplace/item/${match[1]}/` } : null;
    } catch { return null; }
  }

  function lines(element) {
    return (element?.innerText || '').split(/\n+/).map(clean).filter(Boolean);
  }

  function cardFor(anchor) {
    let node = anchor;
    for (let depth = 0; depth < 3 && node.parentElement; depth++) {
      if (node.querySelector('img') && lines(node).length >= 2) return node;
      const parent = node.parentElement;
      if (parent.querySelectorAll('a[href*="/marketplace/item/"]').length > 1) break;
      node = parent;
    }
    return node;
  }

  function priceFrom(text) {
    const match = text.match(/(?:A\$|US\$|CA\$|NZ\$|€|£|\$|₹|¥|₩|R\$)\s?[\d,.]+(?:\s?[kKmM])?|[\d,.]+\s?(?:USD|AUD|CAD|NZD|EUR|GBP)/);
    if (!match) return { price: null, currency: null };
    const token = match[0];
    const number = token.match(/[\d,.]+/);
    let price = number ? Number(number[0].replace(/,/g, '')) : NaN;
    if (/k\s*$/i.test(token)) price *= 1000;
    if (/m\s*$/i.test(token)) price *= 1000000;
    const currency = /CA\$|CAD/.test(token) ? 'CAD'
      : /US\$|USD/.test(token) ? 'USD'
      : /NZ\$|NZD/.test(token) ? 'NZD'
      : /A\$|AUD/.test(token) ? 'AUD'
      : /€|EUR/.test(token) ? 'EUR'
      : /£|GBP/.test(token) ? 'GBP'
      : /₹/.test(token) ? 'INR'
      : /¥/.test(token) ? 'JPY'
      : /₩/.test(token) ? 'KRW'
      : /R\$/.test(token) ? 'BRL'
      : /\$/.test(token) ? null : null;
    return { price: Number.isFinite(price) ? price : null, currency };
  }

  function formatPrice(listing) {
    if (typeof listing?.price !== 'number' || !Number.isFinite(listing.price)) return '';
    const amount = listing.price.toLocaleString(undefined, { maximumFractionDigits: listing.price % 1 ? 2 : 0 });
    const symbols = { AUD: 'A$', USD: 'US$', CAD: 'CA$', NZD: 'NZ$', EUR: '€', GBP: '£', INR: '₹', JPY: '¥', KRW: '₩', BRL: 'R$' };
    return `${symbols[listing.currency] || '$'}${amount}`;
  }

  function imageFrom(element) {
    const image = [...element.querySelectorAll('img')].filter(rendered)
      .sort((a, b) => {
        const area = img => {
          const rect = img.getBoundingClientRect();
          return rect.width * rect.height;
        };
        return area(b) - area(a);
      })[0];
    return image?.currentSrc || image?.src || null;
  }

  function extractCard(anchor) {
    const link = itemLink(anchor);
    if (!link || !rendered(anchor)) return null;
    const card = cardFor(anchor);
    const raw = lines(card);
    const justListed = raw.some(line => /^just listed$/i.test(line));
    const text = raw.filter(line => !/^(sponsored|new listing|just listed)$/i.test(line));
    const priceIndex = text.findIndex(line => priceFrom(line).price !== null || /^(free|contact seller)$/i.test(line));
    const { price, currency } = priceIndex >= 0 ? priceFrom(text[priceIndex]) : { price: null, currency: null };
    const withoutPrice = text.filter((_, index) => index !== priceIndex);
    const image = imageFrom(card);
    const title = withoutPrice[0] || clean(image && card.querySelector('img')?.alt) || null;
    const location = withoutPrice.length > 1 ? withoutPrice[withoutPrice.length - 1] : null;
    const listing = {
      ...link, title, price, currency, location, imageUrl: image,
      description: null, condition: null, seller: null
    };
    if (justListed) listing.justListed = true;
    return listing;
  }

  function valueAfterLabel(root, label) {
    const text = lines(root);
    const index = text.findIndex(line => line.toLowerCase() === label.toLowerCase());
    return index >= 0 ? text[index + 1] || null : null;
  }

  function itemShape(root) {
    const h2s = [...root.querySelectorAll('h2')];
    if (h2s.length < 2) return null;
    const profile = [...root.querySelectorAll('a[href*="/marketplace/profile/"]')].find(link => link.getAttribute('aria-label'));
    let sellerIndex = -1;
    if (profile) {
      h2s.forEach((heading, index) => {
        if (heading.compareDocumentPosition(profile) & Node.DOCUMENT_POSITION_FOLLOWING) sellerIndex = index;
      });
    }
    const descHeader = sellerIndex >= 1 ? h2s[sellerIndex - 1] : (h2s.length >= 3 ? h2s[h2s.length - 3] : h2s[0]);
    const sellerHeader = sellerIndex >= 1 ? h2s[sellerIndex] : h2s[h2s.length - 2];
    if (!descHeader || !sellerHeader || descHeader === sellerHeader) return null;
    const buttonText = element => {
      for (let node = element, depth = 0; node && depth < 4; node = node.parentElement, depth++) {
        if (node.getAttribute?.('role') === 'button') return true;
      }
      return false;
    };
    const leaf = element => [...element.children].every(child => !clean(child.innerText));
    const leaves = [...root.querySelectorAll('span,div')].filter(element => {
      if (!leaf(element) || !clean(element.innerText) || buttonText(element)) return false;
      if (descHeader.contains(element) || sellerHeader.contains(element)) return false;
      const after = descHeader.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING;
      const before = sellerHeader.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING;
      return after && before;
    }).map(element => ({ text: clean(element.innerText), span: element.parentElement?.tagName === 'SPAN' }));
    const firstBody = leaves.findIndex(item => !item.span);
    if (firstBody < 0) return { description: null, condition: leaves[1]?.text || null, location: null, seller: clean(profile?.getAttribute('aria-label') || '') || null };
    let lastBody = leaves.length - 1;
    while (lastBody > firstBody && leaves[lastBody].span) lastBody--;
    const description = leaves.slice(firstBody, lastBody + 1).map(item => item.text).join('\n').slice(0, 10000);
    const condition = leaves[1]?.text && firstBody >= 2 ? leaves[1].text : null;
    const location = leaves[lastBody + 1]?.span ? leaves[lastBody + 1].text : null;
    const usable = value => value && value.length < 80 && !/approximate|see more|joined facebook/i.test(value);
    return {
      description: description || null,
      condition: usable(condition) ? condition : null,
      location: usable(location) ? location : null,
      seller: clean(profile?.getAttribute('aria-label') || '') || null
    };
  }

  function descriptionFrom(root) {
    const label = [...root.querySelectorAll('h1,h2,h3,span,div')].find(element => {
      const value = clean(element.innerText);
      return /^(?:seller['’]s description|item description|description):?$/i.test(value) && value.length < 40;
    });
    const beside = clean(label?.nextElementSibling?.innerText || '');
    if (beside && !/^(?:seller['’]s description|item description|description):?$/i.test(beside)) return beside.slice(0, 10000);
    const text = lines(root);
    const index = text.findIndex(line => /^(?:seller['’]s description|item description|description):?$/i.test(line));
    if (index < 0) return null;
    const stop = /^(?:condition|seller information|seller|location|pickup location|details|about this item|shipping|delivery|meetup|send seller a message|message seller|report listing|related items|more from this seller):?$/i;
    const description = [];
    for (const line of text.slice(index + 1)) {
      if (stop.test(line)) break;
      if (/^(?:see more|see less|show more|show less)$/i.test(line)) continue;
      description.push(line);
      if (description.join('\n').length >= 10000) break;
    }
    return description.join('\n').slice(0, 10000) || null;
  }

  function detailForCurrentPage() {
    const match = location.pathname.match(ITEM_PATH);
    if (!match) return null;
    const root = document.querySelector('[role="main"]') || document.querySelector('main') || document.body;
    const headings = [...root.querySelectorAll('h1,h2,[role="heading"]')].filter(rendered);
    const title = headings.map(heading => clean(heading.innerText))
      .find(value => value && !/^marketplace$/i.test(value)) || null;
    const text = lines(root);
    const priceLine = text.find(line => priceFrom(line).price !== null);
    const { price, currency } = priceLine ? priceFrom(priceLine) : { price: null, currency: null };
    const shape = itemShape(root) || {};
    const description = shape.description || descriptionFrom(root);
    const condition = shape.condition || valueAfterLabel(root, 'Condition');
    const seller = shape.seller || valueAfterLabel(root, 'Seller information') || valueAfterLabel(root, 'Seller');
    const locationText = shape.location || valueAfterLabel(root, 'Location') || valueAfterLabel(root, 'Pickup location');
    return {
      id: match[1], listingUrl: `https://www.facebook.com/marketplace/item/${match[1]}/`,
      title, price, currency, location: locationText,
      imageUrl: imageFrom(root), description, condition, seller
    };
  }

  function merge(existing, incoming) {
    for (const [key, value] of Object.entries(incoming)) {
      if (value !== null && value !== '') existing[key] = value;
    }
    return existing;
  }

  function extract() {
    const listings = new Map();
    for (const anchor of document.querySelectorAll('a[href*="/marketplace/item/"]')) {
      const card = extractCard(anchor);
      if (card) listings.set(card.id, listings.has(card.id) ? merge(listings.get(card.id), card) : card);
    }
    const item = location.pathname.match(ITEM_PATH);
    const embedded = item && typeof readItemDetails === 'function'
      ? readItemDetails(document.documentElement?.innerHTML || '', item[1]) : null;
    if (!embedded?.description) {
      const detail = detailForCurrentPage();
      if (detail) listings.set(detail.id, listings.has(detail.id) ? merge(listings.get(detail.id), detail) : detail);
    }
    if (embedded) listings.set(embedded.id, listings.has(embedded.id) ? merge(listings.get(embedded.id), embedded) : embedded);
    if (item && (listings.get(item[1])?.images?.length || 0) < 2) {
      const photos = galleryFrom(document.querySelector('[role="main"]') || document.body);
      if (photos.length > (listings.get(item[1])?.images?.length || 0)) {
        const current = listings.get(item[1]) || { id: item[1], listingUrl: `https://www.facebook.com/marketplace/item/${item[1]}/` };
        current.images = photos;
        listings.set(item[1], current);
      }
    }
    return [...listings.values()];
  }

  function galleryFrom(root) {
    if (!root) return [];
    const profile = [...root.querySelectorAll('a[href*="/marketplace/profile/"]')].find(link => link.getAttribute('aria-label'));
    const urls = [];
    for (const image of root.querySelectorAll('img')) {
      if (profile && (profile.compareDocumentPosition(image) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      const src = image.currentSrc || image.src || '';
      if (!/^https:\/\//.test(src) || /emoji|rsrc\.php|static\.xx\.fbcdn/.test(src)) continue;
      const width = image.naturalWidth || image.width || image.getBoundingClientRect().width;
      if (width && width < 80) continue;
      if (!urls.includes(src)) urls.push(src);
      if (urls.length >= 24) break;
    }
    return urls;
  }

  function revealItemDescription() {
    if (!ITEM_PATH.test(location.pathname)) return;
    const control = [...document.querySelectorAll('div,span,a')].find(element => {
      const value = clean(element.innerText);
      return /^see more$/i.test(value) && value.length < 20;
    });
    control?.click();
  }

  let overlayHost = null;
  let overlayListings = new Map();

  function sendLocal(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, response => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!response?.ok) return reject(new Error(response?.error || 'Local API unavailable'));
        resolve(response.data);
      });
    });
  }

  function resultsScrollers() {
    const scores = new Map();
    for (const anchor of document.querySelectorAll('a[href*="/marketplace/item/"]')) {
      if (!rendered(anchor)) continue;
      for (let node = anchor.parentElement; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (node.scrollHeight > node.clientHeight + 80 &&
            (/auto|scroll|overlay/.test(style.overflowY) || node === document.scrollingElement)) {
          scores.set(node, (scores.get(node) || 0) + 1);
        }
      }
    }
    const ranked = [...scores]
      .filter(([node, count]) => count >= 2 || node === document.scrollingElement)
      .sort((a, b) => b[1] - a[1] ||
        (b[0].scrollHeight - b[0].clientHeight) - (a[0].scrollHeight - a[0].clientHeight))
      .map(([node]) => node);
    const root = document.scrollingElement || document.documentElement;
    if (!ranked.includes(root)) ranked.push(root);
    return ranked;
  }

  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

  function showOverlay(initialSafe = false, inspection = null) {
    if (overlayHost) return;
    overlayListings = new Map((inspection?.snapshot?.listings || []).map(listing => [listing.id, listing]));
    overlayHost = document.createElement('div');
    overlayHost.id = 'local-marketplace-overlay';
    overlayHost.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:block';
    const shadow = overlayHost.attachShadow({ mode: 'open' });
    const stroke = (body, size = 20) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
    const ico = {
      bell: stroke('<path d="M6 16.5h12l-1.15-1.25A2 2 0 0 1 16.2 13.8V11a4.2 4.2 0 0 0-8.4 0v2.8c0 .5-.2 1-.65 1.45L6 16.5z"/><path d="M10 16.5a2 2 0 0 0 4 0"/>'),
      chat: stroke('<path d="M6.2 16.6 4.4 19V7.2A2.2 2.2 0 0 1 6.6 5h11A2.2 2.2 0 0 1 19.8 7.2v7.2A2.2 2.2 0 0 1 17.6 16.6H6.2z"/>'),
      people: stroke('<circle cx="9" cy="8.6" r="2.1"/><circle cx="15.6" cy="9.2" r="1.6"/><path d="M4.6 17.4c.5-2.4 2.2-3.6 4.4-3.6s3.9 1.2 4.4 3.6"/><path d="M13.4 14.1c1.2-.4 2.5-.3 3.5.3 1 .6 1.6 1.7 1.8 3"/>'),
      calendar: stroke('<rect x="4" y="5.5" width="16" height="14" rx="2"/><path d="M4 10h16M8 3.8v3.2M16 3.8v3.2"/>'),
      phone: stroke('<path d="M8 4.8h2.1c.4 0 .7.3.8.7l.5 2.1a.8.8 0 0 1-.4.9L9.6 9.3a10.2 10.2 0 0 0 5.1 5.1l.8-1.4a.8.8 0 0 1 .9-.4l2.1.5c.4.1.7.4.7.8V16a1.5 1.5 0 0 1-1.6 1.5A12.4 12.4 0 0 1 6.5 6.4 1.5 1.5 0 0 1 8 4.8z"/>'),
      files: stroke('<path d="M4 8.2V18a1.6 1.6 0 0 0 1.6 1.6h13A1.6 1.6 0 0 0 20.2 18V10a1.6 1.6 0 0 0-1.6-1.6h-6.2L11 6.4H5.6A1.6 1.6 0 0 0 4 8.2z"/>'),
      sun: stroke('<circle cx="12" cy="12" r="3"/><path d="M12 3.6v1.8M12 18.6v1.8M5.1 5.1l1.3 1.3M17.6 17.6l1.3 1.3M3.6 12h1.8M18.6 12h1.8M5.1 18.9l1.3-1.3M17.6 6.4l1.3-1.3"/>'),
      tasks: stroke('<rect x="5" y="5" width="14" height="14" rx="2.2"/><path d="m8.2 12.1 2.4 2.4 5.2-5.3"/>'),
      plans: stroke('<rect x="3.8" y="5" width="4.6" height="14" rx="1"/><rect x="9.7" y="5" width="4.6" height="9.5" rx="1"/><rect x="15.6" y="5" width="4.6" height="12" rx="1"/>'),
      grid: stroke('<rect x="4" y="4" width="6.4" height="6.4" rx="1.2"/><rect x="13.6" y="4" width="6.4" height="6.4" rx="1.2"/><rect x="4" y="13.6" width="6.4" height="6.4" rx="1.2"/><rect x="13.6" y="13.6" width="6.4" height="6.4" rx="1.2"/>'),
      board: stroke('<rect x="3.6" y="4.8" width="4.8" height="14.4" rx="1"/><rect x="9.6" y="4.8" width="4.8" height="9" rx="1"/><rect x="15.6" y="4.8" width="4.8" height="11.5" rx="1"/>'),
      timeline: stroke('<path d="M4 7.5h6.5M4 12h10M4 16.5h8"/><circle cx="13.2" cy="7.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="17.2" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="14.6" cy="16.5" r="1.2" fill="currentColor" stroke="none"/>'),
      charts: stroke('<path d="M5 19V10.5M10 19V5.5M15 19v-7M20 19V8"/>'),
      star: stroke('<path d="m12 4.3 1.8 4 4.4.5-3.3 3 .9 4.4L12 14.2 8.2 16.2l.9-4.4-3.3-3 4.4-.5L12 4.3z"/>'),
      search: stroke('<circle cx="11" cy="11" r="5"/><path d="m15 15 3.4 3.4"/>'),
      filter: stroke('<path d="M4.5 6h15l-5.6 6.8V19l-3.8-2v-4.2L4.5 6z"/>'),
      chevron: stroke('<path d="m7 10 5 5 5-5"/>', 16),
      dots: stroke('<circle cx="6" cy="12" r="1.05" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.05" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.05" fill="currentColor" stroke="none"/>'),
      share: stroke('<circle cx="7.5" cy="12" r="2"/><circle cx="16.5" cy="7.5" r="2"/><circle cx="16.5" cy="16.5" r="2"/><path d="m9.3 11.1 5.2-2.6M9.3 12.9l5.2 2.6"/>', 16),
      gem: stroke('<path d="m12 3.8 7 4.6L12 20.2 5 8.4 12 3.8z"/><path d="M5 8.4h14"/>', 16),
      gear: stroke('<circle cx="12" cy="12" r="3"/><path d="M12 3.4v2M12 18.6v2M4.9 6.2l1.5 1.2M17.6 16.6l1.5 1.2M3.4 12h2M18.6 12h2M4.9 17.8l1.5-1.2M17.6 7.4l1.5-1.2"/>', 18)
    };
    const plannerMark = (size = 20) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><rect x="2" y="3.2" width="13" height="13" rx="3" fill="#8B8FFF"/><rect x="8" y="8" width="14" height="13" rx="3" fill="#5B5FC7"/><path d="M11.3 14.7 13.4 16.8 19.1 11" stroke="#fff" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const waffle = `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="currentColor"><circle cx="4.2" cy="4.2" r="1.25"/><circle cx="10" cy="4.2" r="1.25"/><circle cx="15.8" cy="4.2" r="1.25"/><circle cx="4.2" cy="10" r="1.25"/><circle cx="10" cy="10" r="1.25"/><circle cx="15.8" cy="10" r="1.25"/><circle cx="4.2" cy="15.8" r="1.25"/><circle cx="10" cy="15.8" r="1.25"/><circle cx="15.8" cy="15.8" r="1.25"/></svg>`;
    const apps = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><rect x="3" y="3" width="4.2" height="4.2" rx="1"/><rect x="9.9" y="3" width="4.2" height="4.2" rx="1"/><rect x="16.8" y="3" width="4.2" height="4.2" rx="1"/><rect x="3" y="9.9" width="4.2" height="4.2" rx="1"/><rect x="9.9" y="9.9" width="4.2" height="4.2" rx="1"/><rect x="16.8" y="9.9" width="4.2" height="4.2" rx="1"/><rect x="3" y="16.8" width="4.2" height="4.2" rx="1"/><rect x="9.9" y="16.8" width="4.2" height="4.2" rx="1"/><rect x="16.8" y="16.8" width="4.2" height="4.2" rx="1"/></svg>`;
    const rail = () => `<nav class="rail" aria-hidden="true"><span class="rail-item">${ico.bell}<i class="dot"></i></span><span class="rail-item">${ico.chat}</span><span class="rail-item">${ico.people}</span><span class="rail-item">${ico.calendar}</span><span class="rail-item">${ico.phone}</span><span class="rail-item">${ico.files}</span><span class="rail-item selected">${plannerMark(22)}</span><span class="rail-spacer"></span><span class="rail-item">${ico.dots}</span><span class="rail-item apps">${apps}</span></nav>`;
    const topbar = live => `<header class="topbar"><div class="waffle">${waffle}</div>${live
      ? `<form id="search" class="top-search">${ico.search}<input id="query" type="search" maxlength="120" placeholder="Search" aria-label="Search" autocomplete="off"><span class="kbd">⌘K</span></form>`
      : `<div class="top-search">${ico.search}<span class="fake-query">Search</span><span class="kbd">⌘K</span></div>`}<div class="avatar">JD</div></header>`;
    const sidebar = actionId => `<aside class="sidebar"><div class="brand">${plannerMark(22)}<span>Planner</span></div>${actionId
      ? `<button class="side-action" id="${actionId}" type="button"><span>＋ Create a plan</span><span class="chev">${ico.chevron}</span></button>`
      : `<div class="side-action"><span>＋ Create a plan</span><span class="chev">${ico.chevron}</span></div>`}${actionId
      ? `<button class="side-nav" id="my-day" type="button">${ico.sun}<span>My day</span></button>`
      : `<div class="side-nav">${ico.sun}<span>My day</span></div>`}<div class="side-nav">${ico.tasks}<span>My tasks</span></div><div class="side-nav">${ico.plans}<span>My plans</span></div><div class="side-label">Pinned</div><p class="side-note">Pinned items will appear here.</p></aside>`;
    const planHead = withMenu => `<div class="plan-head"><div class="crumbs"><span class="crumb">${ico.grid}<span>My plans</span></span><span class="sep">›</span><span class="crumb current">${plannerMark(18)}<span>IT Work Report</span></span><span class="icon-btn">${ico.star}</span>${withMenu
      ? `<span class="menu-anchor"><button class="icon-btn" id="tools-button" type="button" aria-label="More options" aria-expanded="false">${ico.dots}</button><div id="tools-menu" class="tools-menu" hidden><button id="refresh" type="button">Refresh</button><button id="more" type="button">Load more</button><button id="back" type="button">Back</button><button id="close" type="button">Show Marketplace</button></div></span>`
      : `<span class="icon-btn">${ico.dots}</span>`}</div><div class="plan-actions">${withMenu ? `<button class="icon-btn" id="settings-button" type="button" aria-label="Settings">${ico.gear}</button>` : ''}<span class="trial">${ico.gem}<span>Start free trial</span></span><span class="share">${ico.share}<span>Share</span></span></div></div>`;
    const viewbar = () => `<div class="viewbar"><div class="views"><span class="view">${ico.grid}<span>Grid</span></span><span class="view active">${ico.board}<span>Board</span></span><span class="view">${ico.timeline}<span>Timeline</span></span><span class="view">${ico.calendar}<span>Calendar</span></span><span class="view">${ico.charts}<span>Charts</span></span><span class="view quiet">${ico.dots}</span><span class="view quiet">${ico.search}</span><span class="view quiet">${ico.filter}</span></div><div class="view-end"><span class="group">Group by: Bucket ${ico.chevron}</span><div class="add-bucket">+ Add new bucket</div></div></div>`;
    const taskCard = name => `<article class="card static"><div class="title">${name}</div></article>`;
    shadow.innerHTML = `
      <style>
        *{box-sizing:border-box} [hidden]{display:none!important}
        :host{font-family:"Segoe UI Variable Text","Segoe UI","Segoe UI Variable",system-ui,sans-serif;color:#f5f5f5;font-size:14px;background:#1f1f1f}
        button,input{font:inherit} button{cursor:pointer;color:inherit} svg{display:block;flex:none}
        .shell{height:100vh;display:grid;grid-template-columns:48px 260px minmax(0,1fr);grid-template-rows:48px minmax(0,1fr);background:#1f1f1f;color:#f5f5f5}
        #safe-view{position:fixed;inset:0;z-index:20}
        .topbar{grid-column:1/-1;display:grid;grid-template-columns:48px minmax(0,1fr) 48px;align-items:center;background:#1f1f1f;border-bottom:1px solid #2a2a2a}
        .waffle{display:grid;place-items:center;color:#e4e4e4}
        .top-search{width:min(720px,72%);height:32px;margin:0 auto;display:flex;align-items:center;gap:8px;background:#292929;border:1px solid #3d3d3d;border-radius:4px;color:#bdbdbd;padding:0 10px}
        .top-search input,.fake-query{flex:1;min-width:0;border:0;outline:0;background:transparent;color:#fff;font:inherit}
        .fake-query{color:#9a9a9a}.top-search input::placeholder{color:#9a9a9a;font-size:12px}.kbd{color:#8d8d8d;font-size:12px}
        .avatar{width:28px;height:28px;margin:0 auto;border-radius:50%;background:#4f6bed;color:#fff;display:grid;place-items:center;font-size:11px;font-weight:700}
        .rail{grid-row:2;grid-column:1;background:#1f1f1f;display:flex;flex-direction:column;align-items:center;padding:8px 0 10px;gap:2px}
        .rail-item{width:48px;height:40px;display:grid;place-items:center;color:#c8c8c8;position:relative;border-radius:4px}
        .rail-item:hover{background:rgba(255,255,255,.06)}
        .rail-item.selected{box-shadow:inset 3px 0 0 #c4b5fd}
        .rail-spacer{flex:1}
        .dot{position:absolute;top:6px;right:9px;width:8px;height:8px;background:#d13438;border-radius:50%;box-shadow:0 0 0 2px #1f1f1f}
        .sidebar{grid-row:2;grid-column:2;background:#1f1f1f;border-right:1px solid #2c2c2c;padding:16px 8px 24px;overflow:auto}
        .brand{display:flex;align-items:center;gap:10px;font-size:20px;font-weight:600;padding:2px 8px 18px}
        .side-action{width:calc(100% - 8px);margin:0 4px 18px;height:32px;border:0;background:#5b5fc7;color:#fff;border-radius:4px;padding:0 4px 0 12px;font-weight:600;display:flex;align-items:center;justify-content:space-between}
        .side-action:hover{background:#6d71d4}.side-action .chev{display:grid;place-items:center;height:100%;padding:0 8px 0 8px;border-left:1px solid rgba(255,255,255,.28);margin-left:8px}
        .side-nav{display:flex;align-items:center;gap:12px;padding:8px 10px;border-radius:4px;color:#f3f3f3}
        button.side-nav{width:100%;border:0;background:transparent;font:inherit;text-align:left}
        .side-nav svg{color:#d2d2d2}.side-nav:hover{background:#2a2a2a}
        .side-label{font-size:12px;color:#adadad;padding:22px 10px 6px}.side-note{font-size:12px;color:#8f8f8f;padding:0 10px;line-height:1.45;margin:0}
        .workspace{grid-row:2;grid-column:3;min-width:0;min-height:0;display:flex;flex-direction:column;background:#1f1f1f;position:relative}
        .plan-head{min-height:52px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:8px 16px 4px 12px;position:relative;z-index:5}
        .crumbs{display:flex;align-items:center;gap:8px;min-width:0;color:#d0d0d0}
        .crumb{display:inline-flex;align-items:center;gap:8px;white-space:nowrap;font-size:14px}
        .crumb.current{color:#fff;font-weight:600;font-size:16px}.sep{color:#8d8d8d}
        .icon-btn{width:32px;height:32px;display:grid;place-items:center;border:0;background:transparent;color:#d0d0d0;border-radius:4px;padding:0}
        button.icon-btn:hover{background:#2e2e2e}
        .menu-anchor{position:relative;display:inline-flex}
        .tools-menu{position:absolute;top:36px;right:0;min-width:196px;background:#2b2b2b;border:1px solid #454545;border-radius:6px;padding:4px;z-index:9;box-shadow:0 12px 32px #000a}
        .tools-menu button{display:block;width:100%;text-align:left;border:0;background:transparent;color:#f3f3f3;border-radius:4px;padding:8px 10px}
        .tools-menu button:hover{background:#3a3a3a}.tools-menu button:disabled{opacity:.45;cursor:default}
        .plan-actions{display:flex;align-items:center;gap:10px;flex:none}
        .trial{display:inline-flex;align-items:center;gap:6px;color:#ececec}
        .share{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;background:#5b5fc7;color:#fff;border-radius:4px;font-weight:600}
        .viewbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:2px 12px 10px;flex-wrap:wrap}
        .views{display:flex;align-items:center;gap:2px;flex-wrap:wrap}
        .view{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px;border-radius:16px;color:#e6e6e6}
        .view.active{background:#5b5fc7;color:#fff;font-weight:600}
        .view.quiet{width:32px;padding:0;justify-content:center;color:#d0d0d0}
        .group{display:inline-flex;align-items:center;gap:4px;color:#eee;white-space:nowrap}
        .view-end{display:flex;align-items:center;gap:12px;margin-left:auto}
        .board{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px;align-content:start;padding:8px 20px 28px;overflow:auto;flex:1;min-height:0;scrollbar-width:thin;scrollbar-color:#4a4a4a transparent}
        .column{min-width:0}
        .column h2{font-size:14px;font-weight:600;margin:0 2px 2px;color:#fff}
        .column-toggle{border:0;background:transparent;color:inherit;font:inherit;font-weight:600;padding:0;text-align:left}
        .column-toggle::before{content:"▸";display:inline-block;width:14px;color:#bdbdbd;font-size:11px}
        .column-toggle[aria-expanded="true"]::before{content:"▾"}
        .column.drag-over{outline:2px dashed #8b8fff;outline-offset:4px;border-radius:6px}
        .add-task{color:#dedede;font-size:13px;padding:6px 2px 10px}
        .add-bucket{height:32px;padding:0 14px;background:#5b5fc7;color:#fff;border-radius:4px;font-weight:600;display:inline-flex;align-items:center;white-space:nowrap}
        .cards{display:flex;flex-direction:column;gap:8px;max-height:calc(100vh - 230px);overflow:auto;padding:0 2px 8px 0;scrollbar-width:thin;scrollbar-color:#4a4a4a transparent}
        .card{position:relative;background:#292929;border:1px solid #3a3a3a;border-radius:4px;padding:12px;color:#fff;cursor:grab}
        .card:hover{background:#313131;border-color:#4a4a4a}.card:active{cursor:grabbing}.card.static,.card.static .title{cursor:default}
        .card-main{display:flex;gap:10px;align-items:flex-start}
        .card-copy{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0}
        #pinned-cards .card-copy{filter:blur(6px);transition:filter .18s ease;user-select:none}
        #pinned-cards .card:hover .card-copy,#pinned-cards .card:focus-within .card-copy{filter:none;user-select:text}
        @media(prefers-reduced-motion:reduce){#pinned-cards .card-copy{transition:none}}
        .title{display:block;min-width:0;border:0;background:none;padding:0;text-align:left;color:#fff;font-weight:600;font-size:14px;line-height:1.35;overflow-wrap:anywhere;cursor:pointer}
        .card-price{color:#d2d2d2;font-size:13px;font-weight:600;line-height:1.2}
        .just-listed{position:absolute;top:8px;right:8px;width:9px;height:9px;border-radius:50%;background:#3b9eff;box-shadow:0 0 0 2px #292929}
        .card:hover .just-listed{box-shadow:0 0 0 2px #313131}
        .card img,.gray-swatch{width:62px;height:62px;object-fit:cover;border-radius:5px;background:#3b3b3b;flex:none;filter:grayscale(var(--card-gray, .4))}
        .settings{position:absolute;inset:0;z-index:7;background:#1f1f1f;padding:28px 36px;overflow:auto}
        .settings-back{border:0;background:transparent;color:#d0d0d0;padding:0 0 18px;font-size:14px}
        .settings-back:hover{color:#fff}
        .settings h2{margin:0 0 8px;font-size:22px;font-weight:600}
        .settings p{margin:0 0 22px;color:#adadad;max-width:460px}
        .settings-row{max-width:460px;background:#292929;border:1px solid #3a3a3a;border-radius:8px;padding:18px 18px 16px}
        .settings-row label{display:flex;justify-content:space-between;font-weight:600;margin-bottom:14px}
        .settings-row input{width:100%;accent-color:#5b5fc7}
        .gray-swatch{display:block;margin-top:16px;background:linear-gradient(135deg,#e0b04a,#3d7ec9 52%,#c44758)}
        .empty{color:#8f8f8f;font-size:13px;padding:8px 2px}
        .list-loading{display:flex;justify-content:center;padding:8px 0 2px}
        .list-loading[hidden]{display:none}
        .spinner{width:16px;height:16px;border:2px solid #4a4a4a;border-top-color:#5b5fc7;border-radius:50%;animation:spin .7s linear infinite}
        @keyframes spin{to{transform:rotate(360deg)}}
        @media(prefers-reduced-motion:reduce){.spinner{animation:none;border-top-color:#8b8fff}}
        .status{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);background:#333;color:#eee;border-radius:6px;padding:8px 12px;font-size:12px;z-index:8;max-width:min(480px,80%)}
        .status:empty{display:none}.status.error{background:#5c2b2b;color:#ffd2d2}
        #detail-backdrop{position:fixed;inset:0;z-index:10;background:#000b;display:grid;place-items:center;padding:26px}
        #detail{width:min(1120px,100%);height:min(760px,calc(100vh - 52px));min-height:420px;background:#292929;border:1px solid #454545;border-radius:8px;box-shadow:0 25px 80px #0009;display:grid;grid-template-rows:64px minmax(0,1fr);overflow:hidden}
        .detail-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 24px;border-bottom:1px solid #454545;color:#d4c6ff;font-weight:600}
        .detail-head-note{font-size:12px;color:#aaa;font-weight:400}
        .detail-main{display:grid;grid-template-columns:minmax(0,1fr) 300px;min-height:0}.detail-left{overflow:auto;padding:27px 30px 40px;scrollbar-color:#666 transparent}
        #detail-title{font-size:22px;line-height:1.3;overflow-wrap:anywhere;margin:0 0 12px;color:#fff}
        .detail-subtitle{color:#b9b9b9;font-size:13px;margin-bottom:20px}
        .detail-actions{display:flex;gap:9px;flex-wrap:wrap;margin-bottom:27px}.detail-actions button{border:1px solid #5b5b5b;background:#343434;border-radius:4px;padding:8px 12px}
        .detail-actions .keep{background:#5b5fc7;border-color:#5b5fc7;font-weight:600}.detail-actions button:hover{background:#6d71d4}
        .detail-section{font-size:15px;font-weight:600;border-bottom:1px solid #454545;padding-bottom:12px;margin:0 0 22px}
        .detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px 26px}
        .detail-field-label{display:block;color:#aaa;font-size:12px;margin-bottom:8px}
        .detail-field-value{border:1px solid #555;border-radius:4px;min-height:41px;padding:10px 12px;overflow-wrap:anywhere}
        .detail-description{margin-top:28px;line-height:1.55;white-space:pre-wrap}
        .detail-description h3{font-size:14px;margin:0 0 10px}.detail-description p{color:#ccc;margin:0}
        .detail-right{border-left:1px solid #454545;background:#222;overflow:auto;padding:27px 20px}
        .detail-right h3{font-size:16px;margin:0 0 18px}
        .preview-stage{position:relative;margin-bottom:12px}
        .detail-right img{width:100%;max-height:280px;object-fit:contain;background:#303030;border-radius:8px;margin-bottom:0;filter:grayscale(1) brightness(.22);transition:filter .25s ease}
        .detail-right img:hover{filter:grayscale(0) brightness(1)}
        .preview-arrow{position:absolute;top:50%;transform:translateY(-50%);width:32px;height:32px;border:0;border-radius:50%;background:#111c;color:#fff;font-size:22px;line-height:1;z-index:1}
        .preview-arrow[hidden]{display:none}
        .preview-arrow.prev{left:8px}.preview-arrow.next{right:8px}
        .preview-arrow:hover{background:#111e}
        .photo-count{margin:8px 0 0;color:#b6b6b6;font-size:12px;text-align:center}
        @media(prefers-reduced-motion:reduce){.detail-right img{transition:none}}
        .detail-right p{color:#b6b6b6;line-height:1.5;font-size:13px;overflow-wrap:anywhere}
        @media(max-width:800px){.detail-main{grid-template-columns:minmax(0,1fr) 210px}.detail-left{padding:22px}.detail-right{padding:22px 14px}}
        @media(max-width:600px){#detail-backdrop{padding:10px}#detail{height:calc(100vh - 20px)}.detail-main{display:block;overflow:auto}.detail-left,.detail-right{overflow:visible}.detail-right{border-left:0;border-top:1px solid #454545}.detail-grid{grid-template-columns:1fr}}
        @media(max-width:1100px){.shell{grid-template-columns:48px 220px minmax(0,1fr)}.trial span{display:none}}
        @media(max-width:820px){.shell{grid-template-columns:48px minmax(0,1fr)}.sidebar{display:none}.workspace{grid-column:2}.view > span{display:none}.top-search{width:92%}.board{grid-template-columns:1fr}}
      </style>
      <div class="app shell">
        ${topbar(true)}
        ${rail()}
        ${sidebar('more-side')}
        <main class="workspace">
          ${planHead(true)}
          ${viewbar()}
          <div id="status" class="status" role="status" aria-live="polite"></div>
          <div class="board">
            <section class="column" id="current-column"><h2 id="current-count">Not started (0)</h2><div class="add-task">+ Add task</div><div id="cards" class="cards"><div class="list-loading" hidden><span class="spinner" role="status" aria-label="Loading more"></span></div></div></section>
            <section class="column" id="pinned-column"><h2 id="pinned-count">In progress (0)</h2><div class="add-task">+ Add task</div><div id="pinned-cards" class="cards"></div></section>
            <section class="column"><h2><button id="completed-toggle" class="column-toggle" type="button" aria-expanded="false">Completed (0)</button></h2><div class="add-task">+ Add task</div><div id="completed-wrap" hidden><div id="completed-cards" class="cards"></div></div></section>
          </div>
          <div id="detail-backdrop" hidden><section id="detail" role="dialog" aria-modal="true" aria-labelledby="detail-title" tabindex="-1">
            <div class="detail-head"><span>Task</span><span class="detail-head-note">Click outside to close</span></div>
            <div class="detail-main"><div class="detail-left"><h2 id="detail-title"></h2><div id="detail-subtitle" class="detail-subtitle"></div>
            <div class="detail-actions"><button id="detail-pin" class="keep" type="button"></button><button id="detail-link" type="button">Get link</button><button id="detail-inspect" type="button">Refresh captured details</button></div>
              <h3 class="detail-section">Details</h3><div id="detail-fields" class="detail-grid"></div>
              <section class="detail-description"><h3>Description</h3><p id="detail-description"></p></section></div>
              <aside class="detail-right"><h3>Preview</h3><div class="preview-stage"><button id="detail-prev" class="preview-arrow prev" type="button" aria-label="Previous photo" hidden>‹</button><img id="detail-image" alt="" hidden><button id="detail-next" class="preview-arrow next" type="button" aria-label="Next photo" hidden>›</button></div><p id="detail-photo-count" class="photo-count" hidden></p><p id="detail-source"></p><p id="detail-seen"></p></aside></div>
          </section></div>
          <section id="settings-page" class="settings" hidden aria-label="Settings">
            <button id="settings-back" class="settings-back" type="button">‹ Board</button>
            <h2>Settings</h2>
            <p>Small photos on the board use this much gray. The full photo in a task still starts gray and returns to color when you hover it.</p>
            <div class="settings-row">
              <label for="gray-scale">Thumbnail grayscale <span id="gray-value">40%</span></label>
              <input id="gray-scale" type="range" min="0" max="100" step="1" value="40" aria-valuemin="0" aria-valuemax="100">
              <div class="gray-swatch" aria-hidden="true"></div>
            </div>
          </section>
        </main>
      </div>
      <div id="safe-view" class="shell" hidden aria-label="Planner">
        ${topbar(false)}
        ${rail()}
        ${sidebar('')}
        <main class="workspace">
          ${planHead(false)}
          ${viewbar()}
          <div class="board">
            <section class="column"><h2>To do (3)</h2><div class="add-task">+ Add task</div>
              ${taskCard('Review weekly priorities')}
              ${taskCard('Prepare meeting agenda')}
              ${taskCard('Organize shared resources')}
            </section>
            <section class="column"><h2>In progress (2)</h2><div class="add-task">+ Add task</div>
              ${taskCard('Follow up on open items')}
              ${taskCard('Update project notes')}
            </section>
            <section class="column"><h2>Completed (2)</h2><div class="add-task">+ Add task</div>
              ${taskCard('Sort recent documents')}
              ${taskCard('Share status update')}
            </section>
          </div>
        </main>
      </div>`;
    shadow.querySelector('.app').hidden = initialSafe;
    shadow.getElementById('safe-view').hidden = !initialSafe;
    try { sessionStorage.setItem('teamsPlannerCover', '1'); } catch { /* Cover is optional in private mode. */ }
    document.getElementById('teams-planner-cover')?.remove();
    document.documentElement.append(overlayHost);
    const previousTitle = document.title;
    const TEAMS_TITLE = '(1) Planner | Microsoft Teams';
    const savedIcons = [...document.querySelectorAll('link[rel~="icon"]')];
    const teamsIconUrl = chrome.runtime.getURL('teams.png');
    const applyTeamsTab = () => {
      if (document.title !== TEAMS_TITLE) document.title = TEAMS_TITLE;
      let ours = document.querySelector('link[data-teams-planner="1"]');
      for (const icon of [...document.querySelectorAll('link[rel~="icon"]')]) {
        if (icon !== ours) icon.remove();
      }
      if (!ours) {
        ours = document.createElement('link');
        ours.rel = 'icon';
        ours.type = 'image/png';
        ours.dataset.teamsPlanner = '1';
        ours.href = teamsIconUrl;
        (document.head || document.documentElement).append(ours);
      } else if (ours.href !== teamsIconUrl) {
        ours.href = teamsIconUrl;
      }
    };
    applyTeamsTab();
    let tabTimer = null;
    const tabObserver = new MutationObserver(() => {
      if (tabTimer || !overlayHost?.isConnected) return;
      tabTimer = setTimeout(() => {
        tabTimer = null;
        if (overlayHost?.isConnected) applyTeamsTab();
      }, 50);
    });
    tabObserver.observe(document.head, {
      subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['href', 'rel']
    });
    const cards = shadow.getElementById('cards');
    const pinnedCards = shadow.getElementById('pinned-cards');
    const completedCards = shadow.getElementById('completed-cards');
    const completedWrap = shadow.getElementById('completed-wrap');
    const completedToggle = shadow.getElementById('completed-toggle');
    const savedListings = new Map();
    const pinsTouched = new Set();
    let completedOpen = false;
    let focusedListingId = inspection?.listingId || null;
    let safeMode = initialSafe;
    const status = shadow.getElementById('status');
    const detailBackdrop = shadow.getElementById('detail-backdrop');
    const more = shadow.getElementById('more');
    const refresh = shadow.getElementById('refresh');
    const setStatus = (message, error = false) => {
      status.textContent = message;
      status.className = error ? 'status error' : 'status';
    };
    const makeCard = listing => {
        const card = document.createElement('div');
        card.className = 'card';
        card.draggable = true;
        card.addEventListener('dragstart', event => {
          event.dataTransfer.setData('text/plain', listing.id);
          event.dataTransfer.effectAllowed = 'move';
        });
        const main = document.createElement('div');
        main.className = 'card-main';
        const copy = document.createElement('div');
        copy.className = 'card-copy';
        const title = document.createElement('button');
        title.type = 'button';
        title.className = 'title';
        title.textContent = listing.title || 'Untitled task';
        title.dataset.listingId = listing.id;
        title.addEventListener('click', event => {
          event.stopPropagation();
          openDetail(listing.id);
        });
        copy.append(title);
        const priceText = formatPrice(listing);
        if (priceText) {
          const price = document.createElement('div');
          price.className = 'card-price';
          price.textContent = priceText;
          copy.append(price);
        }
        main.append(copy);
        if (listing.imageUrl) {
          const image = document.createElement('img');
          image.src = listing.imageUrl;
          image.alt = '';
          image.loading = 'lazy';
          main.append(image);
        }
        card.append(main);
        if (listing.justListed) {
          const marker = document.createElement('div');
          marker.className = 'just-listed';
          marker.setAttribute('aria-label', 'Just listed');
          card.append(marker);
        }
        card.addEventListener('click', () => openDetail(listing.id));
        return card;
    };
    let detailPhotoIndex = 0;
    let detailPhotoFor = null;
    let detailPhotos = [];
    const renderDetail = () => {
      if (!focusedListingId) return;
      const listing = { ...(savedListings.get(focusedListingId) || {}) };
      if (overlayListings.has(focusedListingId)) merge(listing, overlayListings.get(focusedListingId));
      const currentDetail = detailForCurrentPage();
      if (currentDetail?.id === focusedListingId) merge(listing, currentDetail);
      shadow.getElementById('detail-title').textContent = listing.title || 'Untitled task';
      shadow.getElementById('detail-subtitle').textContent = listing.location || 'Task';
      const kept = !!savedListings.get(focusedListingId)?.pinned;
      shadow.getElementById('detail-pin').textContent = kept ? 'Remove from In progress' : 'Save to In progress';
      shadow.getElementById('detail-inspect').textContent = 'Refresh captured details';
      const fields = shadow.getElementById('detail-fields');
      fields.replaceChildren();
      const fieldValues = {
        Status: kept ? 'In progress' : 'Not started',
        Price: listing.price == null ? 'Unavailable' : `${listing.currency || ''} ${listing.price.toLocaleString()}`.trim(),
        Location: listing.location || 'Unavailable',
        Condition: listing.condition || 'Unavailable',
        Seller: listing.seller || 'Unavailable',
        Currency: listing.currency || 'Unavailable'
      };
      for (const [label, value] of Object.entries(fieldValues)) {
        const field = document.createElement('div');
        const name = document.createElement('span');
        name.className = 'detail-field-label';
        name.textContent = label;
        const content = document.createElement('div');
        content.className = 'detail-field-value';
        content.textContent = value;
        field.append(name, content);
        fields.append(field);
      }
      shadow.getElementById('detail-description').textContent = listing.description
        || (inspectionInFlight ? 'Reading this listing…' : 'No description yet.');
      const photos = Array.isArray(listing.images) ? listing.images.filter(url => typeof url === 'string' && /^https:\/\//.test(url)) : [];
      if (listing.imageUrl && !photos.includes(listing.imageUrl)) photos.unshift(listing.imageUrl);
      if (detailPhotoFor !== focusedListingId) {
        detailPhotoFor = focusedListingId;
        detailPhotoIndex = 0;
      }
      if (detailPhotoIndex >= photos.length) detailPhotoIndex = 0;
      detailPhotos = photos;
      const image = shadow.getElementById('detail-image');
      const multiple = photos.length > 1;
      image.hidden = !photos.length;
      image.style.cursor = multiple ? 'pointer' : 'default';
      if (photos.length) image.src = photos[detailPhotoIndex];
      else image.removeAttribute('src');
      shadow.getElementById('detail-prev').hidden = !multiple;
      shadow.getElementById('detail-next').hidden = !multiple;
      const count = shadow.getElementById('detail-photo-count');
      count.hidden = !multiple;
      count.textContent = multiple ? `${detailPhotoIndex + 1} / ${photos.length}` : '';
      shadow.getElementById('detail-source').textContent = '';
      shadow.getElementById('detail-seen').textContent = listing.firstSeenAt
        ? `Updated ${new Date(listing.firstSeenAt).toLocaleDateString()}` : '';
    };
    const rememberDetails = (id, details) => {
      const current = {
        ...(overlayListings.get(id) || {}),
        ...(savedListings.get(id) || {}),
        id,
        listingUrl: `https://www.facebook.com/marketplace/item/${id}/`
      };
      merge(current, details || {});
      if (overlayListings.has(id)) merge(overlayListings.get(id), current);
      savedListings.set(id, { ...current, pinned: savedListings.get(id)?.pinned || 0 });
      if (focusedListingId === id) renderDetail();
      return current;
    };
    const readListingQuietly = async id => {
      let embedded = null;
      try {
        const response = await fetch(`https://www.facebook.com/marketplace/item/${id}/`, {
          credentials: 'include', redirect: 'follow', cache: 'no-store', signal: AbortSignal.timeout(4000)
        });
        if (response.ok) embedded = readItemDetails(await response.text(), id);
      } catch { /* A hidden window can still read the rendered listing. */ }
      if (embedded?.description && embedded.images?.length > 1) return embedded;
      const hidden = await sendLocal({ type: 'READ_ITEM', listingId: id });
      const combined = { ...(embedded || {}) };
      for (const [key, value] of Object.entries(hidden.listing || {})) {
        if (value == null || value === '') continue;
        if (key === 'images') {
          if (Array.isArray(value) && value.length > (combined.images?.length || 0)) combined.images = value;
          continue;
        }
        combined[key] = value;
      }
      return combined;
    };
    const inspectFocusedListing = async () => {
      if (!focusedListingId || inspectionInFlight) return;
      const id = focusedListingId;
      inspectionInFlight = true;
      const button = shadow.getElementById('detail-inspect');
      button.disabled = true;
      const description = shadow.getElementById('detail-description');
      if (!savedListings.get(id)?.description && !overlayListings.get(id)?.description) {
        description.textContent = 'Reading this listing…';
      }
      setStatus('Reading this listing…');
      try {
        const details = await readListingQuietly(id);
        const current = rememberDetails(id, details);
        current.galleryLoaded = true;
        if (savedListings.get(id)) savedListings.get(id).galleryLoaded = true;
        if (overlayListings.get(id)) overlayListings.get(id).galleryLoaded = true;
        if (focusedListingId === id) {
          shadow.getElementById('detail-description').textContent = current.description || 'No description was found for this listing.';
        }
        const payload = { ...current };
        if (typeof payload.price !== 'number' || !Number.isFinite(payload.price)) payload.price = null;
        try {
          await sendLocal({ type: 'SAVE_LISTINGS', listings: [payload] });
          const photoCount = current.images?.length || 0;
          setStatus(photoCount > 1 ? `${photoCount} photos loaded.` : current.description ? 'Description added.' : 'No description was found for this listing.', photoCount < 2 && !current.description);
        } catch (error) {
          setStatus(current.description ? `Description added. Local save failed: ${error.message}` : error.message, true);
        }
      } catch (error) {
        if (focusedListingId === id) {
          shadow.getElementById('detail-description').textContent = `Could not read the description. ${error.message}`;
        }
        setStatus(error.message, true);
      } finally {
        inspectionInFlight = false;
        if (button.isConnected) button.disabled = false;
        if (focusedListingId && focusedListingId !== id) {
          const next = savedListings.get(focusedListingId) || overlayListings.get(focusedListingId);
          if (!next?.description) inspectFocusedListing();
        }
      }
    };
    let inspectionInFlight = false;
    const openDetail = id => {
      focusedListingId = id;
      detailPhotoFor = id;
      detailPhotoIndex = 0;
      detailBackdrop.hidden = false;
      renderDetail();
      shadow.getElementById('detail-pin').focus();
      const listing = savedListings.get(id) || overlayListings.get(id);
      if (!listing?.description || !listing?.galleryLoaded) inspectFocusedListing();
    };
    const closeDetail = () => {
      const id = focusedListingId;
      focusedListingId = null;
      detailBackdrop.hidden = true;
      if (id) shadow.querySelector(`[data-listing-id="${id}"]`)?.focus();
    };
    detailBackdrop.addEventListener('click', event => {
      if (event.target === detailBackdrop) closeDetail();
    });
    const showPhoto = delta => {
      if (detailPhotos.length < 2) return;
      detailPhotoIndex = (detailPhotoIndex + delta + detailPhotos.length) % detailPhotos.length;
      renderDetail();
    };
    const onEscape = event => {
      if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && focusedListingId && overlayHost?.isConnected && shadow.getElementById('settings-page').hidden) {
        event.preventDefault();
        showPhoto(event.key === 'ArrowRight' ? 1 : -1);
        return;
      }
      if (event.key !== 'Escape' || !overlayHost?.isConnected) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const settingsPage = shadow.getElementById('settings-page');
      if (!settingsPage.hidden) {
        settingsPage.hidden = true;
        return;
      }
      if (focusedListingId) closeDetail();
      safeMode = !safeMode;
      shadow.querySelector('.app').hidden = safeMode;
      shadow.getElementById('safe-view').hidden = !safeMode;
      sendLocal({ type: 'SET_SAFE', enabled: safeMode }).catch(() => {});
    };
    const keepTyping = event => {
      if (!overlayHost?.isConnected || event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return;
      const path = event.composedPath();
      const field = path.find(node => node.tagName === 'TEXTAREA' || (node.tagName === 'INPUT' && ['text', 'search', 'url', 'email', 'password'].includes(node.type)));
      if (!field || !path.includes(overlayHost)) return;
      event.stopPropagation();
      event.preventDefault();
      const start = field.selectionStart ?? field.value.length;
      const end = field.selectionEnd ?? start;
      const next = field.value.slice(0, start) + event.key + field.value.slice(end);
      if (field.maxLength >= 0 && next.length > field.maxLength) return;
      field.value = next;
      const caret = start + event.key.length;
      field.setSelectionRange(caret, caret);
    };
    window.addEventListener('keydown', keepTyping, true);
    document.addEventListener('keydown', onEscape, true);
    shadow.getElementById('detail-pin').addEventListener('click', () => {
      if (focusedListingId) pinListing(focusedListingId, !savedListings.get(focusedListingId)?.pinned);
    });
    let linkCopiedTimer = 0;
    shadow.getElementById('detail-link').addEventListener('click', async () => {
      if (!focusedListingId) return;
      const button = shadow.getElementById('detail-link');
      const url = `https://www.facebook.com/marketplace/item/${focusedListingId}/`;
      const markCopied = () => {
        button.textContent = 'Copied';
        clearTimeout(linkCopiedTimer);
        linkCopiedTimer = setTimeout(() => { if (button.isConnected) button.textContent = 'Get link'; }, 1500);
      };
      try {
        await navigator.clipboard.writeText(url);
        markCopied();
      } catch {
        const field = document.createElement('textarea');
        field.value = url;
        field.setAttribute('readonly', '');
        field.style.cssText = 'position:fixed;left:-9999px';
        document.body.append(field);
        field.select();
        const copied = document.execCommand('copy');
        field.remove();
        if (copied) markCopied();
        else setStatus('Could not copy the link.', true);
      }
    });
    shadow.getElementById('detail-inspect').addEventListener('click', inspectFocusedListing);
    shadow.getElementById('detail-prev').addEventListener('click', event => {
      event.stopPropagation();
      showPhoto(-1);
    });
    shadow.getElementById('detail-next').addEventListener('click', event => {
      event.stopPropagation();
      showPhoto(1);
    });
    shadow.getElementById('detail-image').addEventListener('click', event => {
      event.stopPropagation();
      showPhoto(1);
    });
    const fillColumn = (target, items, emptyText) => {
      const scroll = target.scrollTop;
      const loading = target.querySelector('.list-loading');
      target.replaceChildren(...items.map(listing => makeCard(listing, !!savedListings.get(listing.id)?.pinned)));
      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = emptyText;
        target.append(empty);
      }
      if (loading) target.append(loading);
      target.scrollTop = scroll;
    };
    const draw = () => {
      const current = [...overlayListings.values()].filter(listing => !savedListings.get(listing.id)?.pinned);
      const withMarker = listing => overlayListings.get(listing.id)?.justListed ? { ...listing, justListed: true } : listing;
      const pinned = [...savedListings.values()].filter(listing => listing.pinned).map(withMarker);
      shadow.getElementById('current-count').textContent = `Not started (${current.length})`;
      shadow.getElementById('pinned-count').textContent = `In progress (${pinned.length})`;
      completedToggle.textContent = `Completed (${savedListings.size})`;
      fillColumn(cards, current, 'No tasks');
      fillColumn(pinnedCards, pinned, 'No tasks');
      completedWrap.hidden = !completedOpen;
      if (completedOpen) fillColumn(completedCards, [...savedListings.values()].map(withMarker), 'No tasks');
      more.disabled = !!detailForCurrentPage();
      renderDetail();
    };
    const add = listings => {
      for (const listing of listings) overlayListings.set(listing.id,
        overlayListings.has(listing.id) ? merge(overlayListings.get(listing.id), listing) : listing);
      draw();
    };
    const pinListing = async (id, pinned) => {
      try {
        const listing = savedListings.get(id) || overlayListings.get(id);
        if (!listing) throw new Error('Listing is no longer available.');
        if (!savedListings.has(id)) await sendLocal({ type: 'SAVE_LISTINGS', listings: [listing] });
        const result = await sendLocal({ type: 'PIN_LISTING', id, pinned });
        pinsTouched.add(id);
        savedListings.set(id, result.listing);
        draw();
        setStatus(pinned ? 'Moved to In progress.' : 'Moved to Not started.');
      } catch (error) { setStatus(error.message, true); }
    };
    for (const [columnId, pinned] of [['current-column', false], ['pinned-column', true]]) {
      const column = shadow.getElementById(columnId);
      column.addEventListener('dragover', event => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        column.classList.add('drag-over');
      });
      column.addEventListener('dragleave', event => {
        if (!column.contains(event.relatedTarget)) column.classList.remove('drag-over');
      });
      column.addEventListener('drop', event => {
        event.preventDefault();
        column.classList.remove('drag-over');
        const id = event.dataTransfer.getData('text/plain');
        if (/^\d{1,30}$/.test(id)) pinListing(id, pinned);
      });
    }
    completedToggle.addEventListener('click', () => {
      completedOpen = !completedOpen;
      completedToggle.setAttribute('aria-expanded', String(completedOpen));
      draw();
    });
    const save = async listings => {
      if (!listings.length) return;
      try {
        await sendLocal({ type: 'SAVE_LISTINGS', listings });
        for (const listing of listings) {
          const previous = savedListings.get(listing.id);
          savedListings.set(listing.id, previous
            ? { ...previous, ...Object.fromEntries(Object.entries(listing).filter(([, value]) => value !== null && value !== '')) }
            : { ...listing, pinned: 0 });
        }
        draw();
      }
      catch (error) { setStatus(`Showing results locally; save failed: ${error.message}`, true); }
    };
    const refreshSaved = () => sendLocal({ type: 'GET_SAVED_LISTINGS' }).then(result => {
      for (const listing of result.listings) {
        if (pinsTouched.has(listing.id)) continue;
        const local = savedListings.get(listing.id);
        if (local) {
          for (const field of ['description', 'condition', 'seller', 'location']) {
            if (!listing[field] && local[field]) listing[field] = local[field];
          }
          if (local.images?.length) listing.images = local.images;
          if (local.galleryLoaded) listing.galleryLoaded = true;
        }
        savedListings.set(listing.id, listing);
      }
      draw();
    }).catch(error => setStatus(`Saved collection unavailable: ${error.message}`, true));
    if (focusedListingId) detailBackdrop.hidden = false;
    if (inspection?.phase === 'loading' || inspection?.phase === 'returning') {
      sendLocal({ type: 'CLEAR_INSPECTION' }).catch(() => {});
    }
    refreshSaved();
    if (inspection?.snapshot && location.href === inspection.originalUrl) {
      const { cardsScroll, pinnedScroll, pageScroll, resultsScroll } = inspection.snapshot;
      cards.scrollTop = cardsScroll || 0;
      pinnedCards.scrollTop = pinnedScroll || 0;
      let restoreAttempts = 0;
      const restoreScroll = setInterval(() => {
        const scroller = resultsScrollers()[0];
        if (scroller && resultsScroll) scroller.scrollTop = resultsScroll;
        if (pageScroll) window.scrollTo(0, pageScroll);
        if (++restoreAttempts >= 20 || (scroller && scroller.scrollTop >= resultsScroll)) clearInterval(restoreScroll);
      }, 500);
    }
    const read = async () => {
      const listings = extract();
      add(listings);
      setStatus('');
      await save(listings);
    };
    let refreshTimer = null;
    const observer = new MutationObserver(() => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(async () => {
        refreshTimer = null;
        if (!overlayHost) return;
        try {
          const updates = extract().filter(listing => {
            const existing = overlayListings.get(listing.id);
            return !existing || Object.entries(listing).some(([key, value]) =>
              value !== null && value !== '' && value !== existing[key]);
          });
          if (!updates.length) return;
          add(updates);
          setStatus('');
          await save(updates);
        } catch (error) { setStatus(error.message, true); }
      }, 700);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    shadow.getElementById('close').addEventListener('click', async () => {
      try { await sendLocal({ type: 'SET_OVERLAY', enabled: false }); }
      catch { /* Closing the view still works if extension storage is unavailable. */ }
      finally {
        observer.disconnect();
        window.removeEventListener('keydown', keepTyping, true);
        document.removeEventListener('keydown', onEscape, true);
        if (refreshTimer) clearTimeout(refreshTimer);
        if (tabTimer) clearTimeout(tabTimer);
        tabObserver.disconnect();
        try { sessionStorage.removeItem('teamsPlannerCover'); } catch { /* Closing still removes the board. */ }
        document.getElementById('teams-planner-cover')?.remove();
        overlayHost.remove();
        overlayHost = null;
        document.querySelector('link[data-teams-planner="1"]')?.remove();
        for (const icon of [...document.querySelectorAll('link[rel~="icon"]')]) icon.remove();
        for (const icon of savedIcons) document.head.append(icon);
        document.title = previousTitle;
        sendLocal({ type: 'SET_SAFE', enabled: false }).catch(() => {});
      }
    });
    shadow.getElementById('back').addEventListener('click', () => history.back());
    const queryInput = shadow.getElementById('query');
    const currentQuery = (() => {
      try { return new URL(location.href).searchParams.get('query')?.trim().slice(0, 120) || ''; }
      catch { return ''; }
    })();
    if (currentQuery) queryInput.placeholder = currentQuery;
    shadow.getElementById('my-day').addEventListener('click', async () => {
      const path = location.pathname.replace(/\/$/, '');
      if (path === '/marketplace' && !currentQuery) return;
      try {
        await sendLocal({ type: 'SET_OVERLAY', enabled: true });
        location.assign('https://www.facebook.com/marketplace/');
      } catch (error) { setStatus(error.message, true); }
    });
    shadow.getElementById('search').addEventListener('submit', async event => {
      event.preventDefault();
      const query = queryInput.value.trim();
      if (query) {
        try {
          await sendLocal({ type: 'SET_OVERLAY', enabled: true });
          location.assign(`https://www.facebook.com/marketplace/search/?query=${encodeURIComponent(query)}`);
        } catch (error) { setStatus(error.message, true); }
      }
    });
    refresh.addEventListener('click', () => read().catch(error => setStatus(error.message, true)));
    shadow.getElementById('more-side').addEventListener('click', () => more.click());
    const toolsMenu = shadow.getElementById('tools-menu');
    const toolsButton = shadow.getElementById('tools-button');
    const closeTools = () => {
      toolsMenu.hidden = true;
      toolsButton.setAttribute('aria-expanded', 'false');
    };
    toolsButton.addEventListener('click', event => {
      event.stopPropagation();
      const open = toolsMenu.hidden;
      toolsMenu.hidden = !open;
      toolsButton.setAttribute('aria-expanded', String(open));
    });
    shadow.addEventListener('click', event => {
      if (toolsMenu.hidden || toolsMenu.contains(event.target) || toolsButton.contains(event.target)) return;
      closeTools();
    });
    for (const item of toolsMenu.querySelectorAll('button')) item.addEventListener('click', closeTools);
    const settingsPage = shadow.getElementById('settings-page');
    const grayInput = shadow.getElementById('gray-scale');
    const grayValue = shadow.getElementById('gray-value');
    const applyCardGray = amount => {
      const value = Math.min(100, Math.max(0, Math.round(Number(amount))));
      const safe = Number.isFinite(value) ? value : 40;
      overlayHost.style.setProperty('--card-gray', String(safe / 100));
      grayInput.value = String(safe);
      grayInput.setAttribute('aria-valuenow', String(safe));
      grayValue.textContent = `${safe}%`;
      return safe;
    };
    applyCardGray(40);
    try {
      chrome.storage.local.get('cardGrayscale', result => {
        if (chrome.runtime.lastError || !overlayHost?.isConnected || !result || !Number.isFinite(result.cardGrayscale)) return;
        applyCardGray(result.cardGrayscale);
      });
    } catch { /* The board keeps the default amount if extension storage is unavailable. */ }
    grayInput.addEventListener('input', () => {
      const value = applyCardGray(grayInput.value);
      try { chrome.storage.local.set({ cardGrayscale: value }); } catch { /* The slider still updates this session. */ }
    });
    shadow.getElementById('settings-button').addEventListener('click', () => {
      settingsPage.hidden = false;
      grayInput.focus();
    });
    shadow.getElementById('settings-back').addEventListener('click', () => {
      settingsPage.hidden = true;
    });
    let loadingMore = false;
    const listLoading = cards.querySelector('.list-loading');
    const setListLoading = on => {
      if (!listLoading) return;
      listLoading.hidden = !on;
      if (on && cards.scrollTop + cards.clientHeight >= cards.scrollHeight - listLoading.offsetHeight - 48) {
        cards.scrollTop = cards.scrollHeight;
      }
    };
    cards.addEventListener('scroll', () => {
      if (loadingMore || more.disabled || cards.scrollHeight <= cards.clientHeight + 8) return;
      if (cards.scrollTop + cards.clientHeight >= cards.scrollHeight - 80) more.click();
    });
    more.addEventListener('click', async () => {
      if (loadingMore) return;
      loadingMore = true;
      more.disabled = true;
      setListLoading(true);
      try {
        setStatus('Loading more tasks…');
        const before = new Set(extract().map(listing => listing.id));
        let moved = false;
        for (const scroller of resultsScrollers().slice(0, 3)) {
          const position = scroller.scrollTop;
          scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'auto' });
          await pause(350);
          if (scroller.scrollTop > position) { moved = true; break; }
        }
        if (!moved) setStatus('Nothing more to load.');
        else {
          let fresh = [];
          for (let check = 0; check < 40; check++) {
            await pause(500);
            fresh = extract().filter(listing => !before.has(listing.id));
            if (fresh.length) break;
          }
          if (fresh.length) {
            add(fresh);
            setStatus(`Added ${fresh.length} tasks.`);
            await save(fresh);
          } else setStatus('No new tasks appeared.');
        }
      } catch (error) {
        setStatus(error.message, true);
      } finally {
        loadingMore = false;
        setListLoading(false);
        more.disabled = !!detailForCurrentPage();
      }
    });
    read().then(() => {
      if (inspection?.phase === 'done' && location.href === inspection.originalUrl) {
        setStatus(inspection.message || 'Returned to your search.');
        sendLocal({ type: 'CLEAR_INSPECTION' }).catch(() => {});
      }
    }).catch(error => setStatus(error.message, true));
    shadow._inspectionDone = async message => {
      inspectionInFlight = false;
      shadow.getElementById('detail-inspect').disabled = false;
      await refreshSaved();
      setStatus(message || 'Returned to your search.');
      sendLocal({ type: 'CLEAR_INSPECTION' }).catch(() => {});
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'INSPECTION_DONE') {
      overlayHost?.shadowRoot?._inspectionDone?.(message.message);
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === 'EXTRACT_LISTINGS') {
      try {
        revealItemDescription();
        sendResponse({ ok: true, listings: extract() });
      }
      catch (error) { sendResponse({ ok: false, error: error.message }); }
      return;
    }
    if (message?.type === 'OPEN_OVERLAY') {
      sendLocal({ type: 'GET_OVERLAY' })
        .then(result => {
          showOverlay(result.safe, result.inspection);
          return sendLocal({ type: 'SET_OVERLAY', enabled: true });
        })
        .then(() => sendResponse({ ok: true }))
        .catch(error => sendResponse({ ok: false, error: error.message }));
      return true;
    }
  });

  sendLocal({ type: 'GET_OVERLAY' }).then(result => {
    if (result.enabled) showOverlay(result.safe, result.inspection);
    else {
      try { sessionStorage.removeItem('teamsPlannerCover'); } catch { /* The page can stay uncovered. */ }
      document.getElementById('teams-planner-cover')?.remove();
    }
  }).catch(() => {});
})();
