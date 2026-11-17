function readItemDetails(html, id) {
  if (typeof html !== 'string' || !/^\d{1,30}$/.test(String(id || ''))) return null;
  const clean = value => {
    if (typeof value !== 'string') return null;
    const text = value.replace(/\s+/g, ' ').trim();
    if (!text || /^(?:see more|see less|marketplace)$/i.test(text)) return null;
    return text.slice(0, 10000);
  };
  const conditions = {
    new: 'New',
    used_like_new: 'Used - Like New',
    used_good: 'Used - Good',
    used_fair: 'Used - Fair'
  };
  const listing = { title: null, location: null, seller: null, condition: null, description: null, images: [] };
  const absorb = (node, overwrite) => {
    const description = clean(node?.redacted_description?.text) || clean(node?.marketplace_listing_description?.text);
    const title = clean(node?.marketplace_listing_title);
    const location = clean(node?.location_text?.text);
    const seller = clean(node?.marketplace_listing_seller?.name);
    let condition = null;
    if (Array.isArray(node?.attribute_data)) {
      const coded = node.attribute_data.find(item => conditions[String(item?.value || '').toLowerCase()]);
      const named = node.attribute_data.find(item => /condition/i.test(item?.attribute_name || ''));
      const chosen = coded || named;
      condition = clean(chosen?.label) || conditions[String(chosen?.value || '').toLowerCase()] || null;
    }
    const fields = { description, title, location, seller, condition };
    for (const [key, value] of Object.entries(fields)) {
      if (value && (overwrite || !listing[key])) listing[key] = value;
    }
    const images = [];
    const addPhoto = uri => {
      if (typeof uri !== 'string' || !/^https:\/\//.test(uri) || images.includes(uri)) return;
      images.push(uri);
    };
    addPhoto(node?.primary_listing_photo?.image?.uri);
    for (const photo of node?.listing_photos || node?.marketplace_listing_photos || []) {
      addPhoto(photo?.image?.uri || photo?.uri);
    }
    if (images.length > listing.images.length) listing.images = images.slice(0, 24);
  };
  const visit = (node, depth) => {
    if (!node || depth > 50) return;
    if (typeof node === 'string') {
      if (node.length > 2000000 || (!node.includes('redacted_description') && !node.includes('listing_photos') && !node.includes(`"id":"${id}"`))) return;
      try { visit(JSON.parse(node), depth + 1); } catch { /* Embedded text is not JSON. */ }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;
    const matches = String(node.id) === String(id);
    const hasDetail = node.redacted_description || node.marketplace_listing_description || node.marketplace_listing_title || node.listing_photos;
    if (matches && (node.__typename || hasDetail)) absorb(node, true);
    else if (hasDetail && (node.id == null || node.id === '')) absorb(node, false);
    for (const value of Object.values(node)) visit(value, depth + 1);
  };
  const chunks = [];
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) chunks.push(match[1]);
  if (!chunks.length) chunks.push(html);
  for (const chunk of chunks) {
    if (!chunk.includes(id) && !chunk.includes('redacted_description') && !chunk.includes('marketplace_listing_description') && !chunk.includes('listing_photos')) continue;
    try { visit(JSON.parse(chunk), 0); }
    catch {
      const loosened = chunk.replace(/\\u0022/gi, '"').replace(/\\"/g, '"');
      try { visit(JSON.parse(loosened), 0); } catch { /* This block is not listing JSON. */ }
    }
    if (listing.description && listing.images.length > 1) break;
  }
  if (!listing.description && !listing.title && !listing.location && !listing.seller && !listing.condition && !listing.images.length) return null;
  const details = {
    id: String(id),
    listingUrl: `https://www.facebook.com/marketplace/item/${id}/`,
    title: listing.title, location: listing.location, seller: listing.seller,
    condition: listing.condition, description: listing.description
  };
  if (listing.images.length) details.images = listing.images;
  return details;
}
