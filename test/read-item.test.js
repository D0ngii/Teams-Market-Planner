import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const context = { JSON, String, RegExp };
runInNewContext(readFileSync(new URL('../extension/read-item.js', import.meta.url), 'utf8'), context);

test('reads a Marketplace item description from the page payload', () => {
  const html = '{"redacted_description":{"delight_ranges":[],"inline_style_ranges":[],"text":"Solid oak chair\\nwith marks"},"marketplace_listing_title":"Oak chair","location_text":{"text":"Sydney, NSW"},"marketplace_listing_seller":{"__typename":"User","name":"Alex"},"attribute_data":[{"attribute_name":"Condition","value":"used_good","label":"Used - Good"}]}';
  const details = context.readItemDetails(html, '123');
  assert.equal(details.description, 'Solid oak chair with marks');
  assert.equal(details.title, 'Oak chair');
  assert.equal(details.location, 'Sydney, NSW');
  assert.equal(details.seller, 'Alex');
  assert.equal(details.condition, 'Used - Good');
  assert.equal(details.listingUrl, 'https://www.facebook.com/marketplace/item/123/');
});

test('reads a description when the payload quotes are escaped', () => {
  const html = '{\\"redacted_description\\":{\\"text\\":\\"Solid wood\\"}}';
  const details = context.readItemDetails(html, '123');
  assert.equal(details.description, 'Solid wood');
});

test('uses the matching listing when the page includes other items', () => {
  const html = `<script type="application/json">{"data":{
    "other":{"__typename":"MarketplaceListing","id":"999","redacted_description":{"text":"Wrong item"}},
    "item":{"__typename":"MarketplaceListing","id":"123","marketplace_listing_title":"Oak chair","redacted_description":{"text":"Solid oak"},"location_text":{"text":"Sydney, NSW"},"marketplace_listing_seller":{"name":"Alex"},"attribute_data":[{"attribute_name":"Condition","value":"used_good","label":"Used - Good"}]}
  }}</script>`;
  const details = context.readItemDetails(html, '123');
  assert.equal(details.description, 'Solid oak');
  assert.equal(details.title, 'Oak chair');
  assert.equal(details.condition, 'Used - Good');
  assert.equal(details.seller, 'Alex');
});

test('keeps the photos for the opened listing', () => {
  const html = `<script type="application/json">{"data":{
    "other":{"__typename":"MarketplaceListing","id":"999","listing_photos":[{"image":{"uri":"https://cdn.example/wrong.jpg"}}]},
    "item":{"__typename":"MarketplaceListing","id":"123","redacted_description":{"text":"Solid oak"},"listing_photos":[{"image":{"uri":"https://cdn.example/a.jpg"}},{"image":{"uri":"https://cdn.example/b.jpg"}}]}
  }}</script>`;
  const details = context.readItemDetails(html, '123');
  assert.deepEqual(Array.from(details.images), ['https://cdn.example/a.jpg', 'https://cdn.example/b.jpg']);
});

test('ignores a page with no item description', () => {
  assert.equal(context.readItemDetails('<html>Marketplace</html>', '123'), null);
  assert.equal(context.readItemDetails('{"redacted_description":{"text":"Solid wood"}}', 'nope'), null);
});
