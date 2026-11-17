# Local Facebook Marketplace Extractor

A manual, local proof of concept. The local page is a small launcher: choose your logged-in Marketplace tab and open a full-page Planner-style board over it. Listings appear as cards in the board and are saved to SQLite. The extension reads rendered page elements only. It does not read cookies, credentials, private APIs, or pages you have not opened.

## Requirements

- Node.js 20 or newer
- Google Chrome
- A Facebook account already logged in in Chrome

## Set up

1. In this directory, run `npm install` and `npm start`.
2. Visit `http://127.0.0.1:3001/` to open the local launcher.
3. In Chrome, open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and choose this repository's `extension` directory.
4. Open or reload a Facebook Marketplace search or listing page in the Chrome profile where you are already logged in.
5. In the local launcher, choose your Marketplace tab and click **Open Full Page View**. The extension brings that tab forward and covers it with a dark Planner-style board. Listings from the current Marketplace search appear under **Not started**.
6. Drag a card to **In progress** to keep it across searches and reloads, or use its **Save to In progress** button. Drag it back to **Not started**, or click **Remove from In progress**, to unpin it; it appears in Not started only if it is part of the current search. **Completed** starts collapsed and contains every listing in the local SQLite database when expanded.
7. Use the board's search field to navigate to Marketplace results. Click **Load more** to scroll the underlying page and wait for one new batch. Click a card to open its Planner-style detail modal. If its description is missing, the extension briefly opens the item's rendered Marketplace page in the same tab behind the board, captures available details, then goes back to the search and restores the modal. The lookup waits up to 15 seconds for a description. Use **Refresh captured details** in the modal to repeat the lookup. Click outside the modal to close it. Press **Esc** anywhere in the board, including from a modal, to switch to a generic work board with no listing titles, prices, images, or other listing details. Press **Esc** again to return. The safe view persists across Marketplace page reloads in the same tab. **Show Marketplace** closes the board.
8. You can also open the board from the extension popup while on Marketplace, or use the popup's **Extract Listings** button while browsing normally.
9. Click **Export JSON** in the launcher or extension popup to download saved listings.

After updating the extension files, reload the extension on `chrome://extensions`, then refresh both the Marketplace tab and local launcher. The launcher bridge runs only on `127.0.0.1:3001` or `localhost:3001`.

The database is `data/listings.sqlite` by default; `DB_PATH` can set a different path. The database and its journal files are ignored by Git. The API binds only to `127.0.0.1:3001`. It exposes:

- `GET /api/health`
- `GET /api/listings/count`
- `GET /api/listings` — JSON for integration with another local application
- `POST /api/listings` — accepts `{ "listings": [...] }`, validates input and upserts by listing ID
- `PATCH /api/listings/:id/pin` — accepts `{ "pinned": true }` or `{ "pinned": false }` for the In progress column

Example local request:

```sh
curl http://127.0.0.1:3001/api/listings
```

## Data and limits

The normalized fields are `id`, `title`, `price`, `currency`, `location`, `imageUrl`, `listingUrl`, `description`, `condition`, and `seller`. Records also have `firstSeenAt`, `lastSeenAt`, and a `pinned` flag in the API and export. Existing databases gain the `pinned` column automatically. Missing fields are `null`; later partial captures do not erase previously captured values. A bare `$` is left with an unknown currency instead of guessing which dollar currency it means.

Facebook changes its DOM frequently, so extraction uses conservative heuristics around visible `/marketplace/item/{id}` links. Some cards may have missing or imperfect titles, locations or images. Search cards usually omit descriptions, so the detail lookup uses the same authenticated Marketplace tab and its rendered item page. The extension returns with Chrome's Back action and also restores the board's card and results scroll positions when possible. Facebook may still reset an infinite-scroll feed during navigation; in that case the original position cannot be guaranteed. Description, condition, and seller details appear only when the rendered item page exposes them. The local launcher does not paginate a hidden Marketplace tab: in testing, Marketplace did not render more cards until its tab became visible. The full-page board keeps that tab active, scrolls only when you click **Load more**, and waits at most 20 seconds for one new batch. Navigation can briefly expose the underlying page while the new document loads. No listing JSON is sent anywhere except the loopback API. The board displays image URLs from their original hosts.

Meta documents a [Marketplace search endpoint in the Content Library API](https://developers.facebook.com/docs/content-library-and-api/content-library-api/guides/fb-marketplace/), but [access is restricted to approved research programs](https://developers.facebook.com/docs/content-library-and-api/get-access) and [downloading its data is limited](https://developers.facebook.com/docs/content-library-and-api/content-library-api/overview). It is not a substitute for this local, logged-in consumer prototype.

Run `npm test` for normalization and SQLite deduplication checks.

The [MSOutlookit project](https://github.com/nkiryakov/msoutlookit) inspired the two-tab relay design. It uses a bookmarklet in a Reddit tab to fetch Reddit feeds from that tab's origin and send responses to its app tab. Here, a Chrome extension connects the dashboard and existing Marketplace tab; it forwards rendered listing data and does not use Marketplace network endpoints. A live same-origin probe of the ordinary Marketplace home and search URLs found zero listing item paths in their returned HTML, while the rendered home page contained 41 item links. This is why the full-page view relies on Facebook's rendered page rather than a simple HTML relay.
