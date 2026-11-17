import express from 'express';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.js';
import { mergeListings, normalizeListing } from './normalize.js';

const app = express();
const defaultPath = resolve(fileURLToPath(new URL('../data/listings.sqlite', import.meta.url)));
const store = openDatabase(process.env.DB_PATH || defaultPath);
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.static(fileURLToPath(new URL('./public/', import.meta.url))));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/listings/count', (_req, res) => res.json({ count: store.count() }));
app.get('/api/listings', (_req, res) => res.json({ listings: store.all() }));
app.patch('/api/listings/:id/pin', (req, res) => {
  if (!/^\d{1,30}$/.test(req.params.id) || typeof req.body?.pinned !== 'boolean') {
    return res.status(400).json({ error: 'Expected a listing ID and pinned boolean' });
  }
  const listing = store.pin(req.params.id, req.body.pinned);
  if (!listing) return res.status(404).json({ error: 'Listing not found' });
  res.json({ listing });
});
app.post('/api/listings', (req, res) => {
  try {
    if (!Array.isArray(req.body?.listings) || req.body.listings.length > 500) {
      return res.status(400).json({ error: 'Expected an array of up to 500 listings' });
    }
    const unique = new Map();
    for (const input of req.body.listings) {
      const listing = normalizeListing(input);
      unique.set(listing.id, unique.has(listing.id)
        ? mergeListings(unique.get(listing.id), listing) : listing);
    }
    res.json(store.save([...unique.values()]));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
app.use((error, _req, res, _next) => {
  res.status(error.status || 400).json({ error: error.message });
});

const port = Number(process.env.PORT || 3001);
app.listen(port, '127.0.0.1', () => {
  console.log(`Marketplace API listening at http://127.0.0.1:${port}`);
});
