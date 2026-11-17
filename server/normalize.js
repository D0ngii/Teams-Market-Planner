const URL_PATTERN = /^https:\/\/(?:www\.)?facebook\.com\/marketplace\/item\/(\d+)\/?$/;
const FIELDS = ['title', 'currency', 'location', 'imageUrl', 'description', 'condition', 'seller'];

function stringOrNull(value, max = 5000) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new Error('Listing fields must be strings');
  const cleaned = value.replace(/\s+/g, ' ').trim();
  if (cleaned.length > max) throw new Error(`Listing field exceeds ${max} characters`);
  return cleaned || null;
}

function imageUrl(value) {
  const text = stringOrNull(value, 3000);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    return url.href;
  } catch { throw new Error('Invalid image URL'); }
}

export function normalizeListing(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid listing');
  const id = stringOrNull(input.id, 30);
  if (!id || !/^\d+$/.test(id)) throw new Error('Invalid Marketplace listing ID');
  const rawUrl = stringOrNull(input.listingUrl, 300);
  if (rawUrl && rawUrl.match(URL_PATTERN)?.[1] !== id) throw new Error('Listing URL does not match ID');
  const listing = { id, listingUrl: `https://www.facebook.com/marketplace/item/${id}/` };
  for (const field of FIELDS) listing[field] = stringOrNull(input[field], field === 'description' ? 10000 : 3000);
  listing.imageUrl = imageUrl(input.imageUrl);
  if (listing.currency && !/^[A-Z]{3}$/.test(listing.currency)) throw new Error('Invalid currency');
  if (input.price == null || input.price === '') listing.price = null;
  else if (typeof input.price === 'number' && Number.isFinite(input.price) && input.price >= 0) listing.price = input.price;
  else throw new Error('Invalid price');
  return listing;
}

export function mergeListings(previous, next) {
  const merged = { ...previous };
  for (const [key, value] of Object.entries(next)) {
    if (value !== null && value !== '') merged[key] = value;
  }
  return merged;
}
