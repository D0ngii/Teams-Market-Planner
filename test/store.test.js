import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { normalizeListing } from '../server/normalize.js';
import { openDatabase } from '../server/db.js';

test('normalizes Marketplace IDs and rejects mismatched URLs', () => {
  const listing = normalizeListing({ id: '12345', title: '  Blue   chair ', price: 25,
    listingUrl: 'https://www.facebook.com/marketplace/item/12345/' });
  assert.equal(listing.title, 'Blue chair');
  assert.equal(listing.listingUrl, 'https://www.facebook.com/marketplace/item/12345/');
  assert.throws(() => normalizeListing({ id: '12345', listingUrl: 'https://www.facebook.com/marketplace/item/99/' }));
  assert.throws(() => normalizeListing({ id: 'abc' }));
});

test('deduplicates by ID and preserves detail fields on later partial extracts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'marketplace-test-'));
  const store = openDatabase(join(dir, 'listings.sqlite'));
  try {
    const initial = normalizeListing({ id: '123', title: 'Chair', description: 'Solid wood', price: 25 });
    assert.deepEqual(store.save([initial]), { inserted: 1, updated: 0, count: 1 });
    const later = normalizeListing({ id: '123', title: 'Chair, blue', price: 20 });
    assert.deepEqual(store.save([later]), { inserted: 0, updated: 1, count: 1 });
    assert.equal(store.all()[0].description, 'Solid wood');
    assert.equal(store.all()[0].price, 20);
    assert.equal(store.all()[0].title, 'Chair, blue');
    assert.equal(store.pin('123', true).pinned, 1);
    store.save([normalizeListing({ id: '123', title: 'Chair, newer' })]);
    assert.equal(store.all()[0].pinned, 1);
    assert.equal(store.pin('123', false).pinned, 0);
  } finally {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('adds pin state to an existing listings database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'marketplace-migration-'));
  const path = join(dir, 'listings.sqlite');
  const old = new Database(path);
  old.exec(`CREATE TABLE listings (
    id TEXT PRIMARY KEY, title TEXT, price REAL, currency TEXT, location TEXT,
    imageUrl TEXT, listingUrl TEXT NOT NULL, description TEXT, condition TEXT,
    seller TEXT, firstSeenAt TEXT NOT NULL, lastSeenAt TEXT NOT NULL
  )`);
  old.close();
  const store = openDatabase(path);
  try {
    store.save([normalizeListing({ id: '44', title: 'Lamp' })]);
    assert.equal(store.all()[0].pinned, 0);
    assert.equal(store.pin('44', true).pinned, 1);
  } finally {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
