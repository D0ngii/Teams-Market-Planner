import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { mergeListings } from './normalize.js';

const COLUMNS = ['id', 'title', 'price', 'currency', 'location', 'imageUrl', 'listingUrl', 'description', 'condition', 'seller'];

export function openDatabase(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS listings (
    id TEXT PRIMARY KEY,
    title TEXT, price REAL, currency TEXT, location TEXT, imageUrl TEXT,
    listingUrl TEXT NOT NULL, description TEXT, condition TEXT, seller TEXT,
    firstSeenAt TEXT NOT NULL, lastSeenAt TEXT NOT NULL
  )`);
  if (!db.pragma('table_info(listings)').some(column => column.name === 'pinned')) {
    db.exec('ALTER TABLE listings ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0');
  }
  const select = db.prepare('SELECT * FROM listings WHERE id = ?');
  const insert = db.prepare(`INSERT INTO listings (${COLUMNS.join(',')}, firstSeenAt, lastSeenAt)
    VALUES (${COLUMNS.map(() => '?').join(',')}, ?, ?)`);
  const update = db.prepare(`UPDATE listings SET ${COLUMNS.slice(1).map(c => `${c} = ?`).join(', ')}, lastSeenAt = ? WHERE id = ?`);
  const all = db.prepare('SELECT * FROM listings ORDER BY firstSeenAt DESC, id DESC');
  const count = db.prepare('SELECT COUNT(*) AS count FROM listings');
  const setPinned = db.prepare('UPDATE listings SET pinned = ? WHERE id = ?');

  const save = db.transaction(listings => {
    let inserted = 0;
    let updated = 0;
    const now = new Date().toISOString();
    for (const listing of listings) {
      const previous = select.get(listing.id);
      if (previous) {
        const merged = mergeListings(previous, listing);
        update.run(...COLUMNS.slice(1).map(c => merged[c]), now, listing.id);
        updated++;
      } else {
        insert.run(...COLUMNS.map(c => listing[c]), now, now);
        inserted++;
      }
    }
    return { inserted, updated, count: count.get().count };
  });

  return {
    db, save, all: () => all.all(), count: () => count.get().count,
    pin: (id, pinned) => {
      if (!setPinned.run(pinned ? 1 : 0, id).changes) return null;
      return select.get(id);
    }
  };
}
