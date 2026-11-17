# Teams Market Planner

A local Planner-style board for Facebook Marketplace. You stay logged in in Chrome. The extension reads the listings already drawn on the page and saves the ones you keep to a SQLite database on your machine. Cookies, passwords, and private APIs stay untouched.

The board looks like Microsoft Teams Planner: three columns, small photos, and a detail view for each listing. Marketplace remains the page underneath, so new results can still load.

## What you need

- Node.js 20 or newer
- Google Chrome
- A Facebook account already logged in in that Chrome profile

## Start it

1. In this directory, run `npm install`, then `npm start`.
2. Open `http://127.0.0.1:3001/`. This is the local launcher.
3. In Chrome, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose this repository's `extension` folder.
4. Open Facebook Marketplace in the same Chrome profile, on the home page or a search.

After you change extension files, reload the extension on `chrome://extensions`, then refresh the Marketplace tab and the launcher. The launcher only talks to the extension on `127.0.0.1:3001` or `localhost:3001`.

## Open the board

On the launcher, pick your Marketplace tab and click **Open Full Page View**. Chrome brings that tab forward and covers it with the board. Listings from the page you are on appear under **Not started**.

You can do the same from the extension popup with **Open Full Page View**. **Open Dashboard** returns to the launcher. **Extract Listings** saves whatever is visible on Marketplace without opening the board. **Export JSON** downloads the saved collection. The launcher has the same export button.

## Use the board

The board has three columns.

**Not started** is the current Marketplace page. A new search replaces this column. Cards you have not kept live only here.

**In progress** is your shortlist. Drag a card here, or open it and click **Save to In progress**. These cards stay when you search again or reload the tab. Their title and price stay blurred until you hover or focus the card. The photo stays sharp. Drag a card back, or click **Remove from In progress**, to unpin it. It returns to Not started only when it is part of the page you are on.

**Completed** starts closed. Open it to see every listing stored in the local database, including ones that also appear in the other columns.

Each card shows a small photo, the title, and the price. A blue dot in the top-right corner means Marketplace marked that listing **Just listed**.

### Search and home

Type in the search bar and press Enter. The board stays up and Marketplace moves to that search. The gray text in the empty search bar is the search you are on. The field itself stays empty, ready for the next one.

**My day**, in the left sidebar, returns to the Marketplace home page. On the home page, with no search, it stays where it is.

### Open a listing

Click a card. The detail view shows the title, location, price, condition, seller, and description. Your Marketplace tab stays on the current page. The description and extra photos are filled in behind the board. If nothing comes back, the description area says so. **Refresh captured details** tries again.

**Get link** copies `https://www.facebook.com/marketplace/item/…`. The button reads **Copied** for a moment.

The preview on the right holds the listing's photos. When there is more than one, use the arrows, the left and right arrow keys, or click the photo. The large photo starts gray and turns to color when you hover it. Small photos on the board stay at the gray level set in Settings (the gear). The slider starts at 40%.

Click outside the card to close it.

### More listings

Scroll to the bottom of **Not started**. A spinner appears while Marketplace loads another batch. The same action is **Load more** in the **⋯** menu at the top right. One batch waits up to about 20 seconds. The status line says how many cards were added.

That same menu has:

- **Refresh**, which reads the cards on the current page again
- **Back**, which is the browser Back button for the Marketplace tab under the board
- **Show Marketplace**, which removes the board and restores the Facebook tab

### Hide the listings

Press **Esc** to cover your listings with a plain sample board: no titles, prices, photos, or other listing details from Marketplace. Press **Esc** again to return. This choice stays on if the Marketplace page reloads in the same tab. **Show Marketplace** clears it.

If Settings is open, **Esc** closes Settings. If a listing is open, **Esc** closes it and switches to the sample board.

## What gets saved

The database is `data/listings.sqlite`. Set `DB_PATH` to use another file. The database and its journal files are ignored by Git. The server listens only on `127.0.0.1:3001`.

Each listing can store `id`, `title`, `price`, `currency`, `location`, `imageUrl`, `listingUrl`, `description`, `condition`, and `seller`, plus `firstSeenAt`, `lastSeenAt`, and whether it is pinned to **In progress**. Older databases gain the `pinned` column on their own. Empty fields are `null`. A later visit that misses a field leaves the earlier value in place. A price written as a bare `$` keeps an unknown currency rather than guessing AUD, USD, or another dollar.

The card thumbnail is the saved image. Extra photos shown in the detail view are loaded for that viewing session.

## Local API

Another program on this machine can read and update the same collection:

- `GET /api/health`
- `GET /api/listings/count`
- `GET /api/listings`
- `POST /api/listings` with `{ "listings": [...] }`, validated and upserted by listing ID
- `PATCH /api/listings/:id/pin` with `{ "pinned": true }` or `{ "pinned": false }`

```sh
curl http://127.0.0.1:3001/api/listings
```

## Limits

Facebook changes the page often. The extension looks for visible `/marketplace/item/{id}` links, so a title, place, or photo can be missing or rough. Search cards rarely include the description, condition, or seller. Those appear when the item page itself shows them.

Marketplace usually draws more cards only while its tab is visible. The board keeps that tab active and scrolls it only when you load more. Searching, going home, or pressing **Back** loads a new Marketplace page, and the Facebook page can show for a moment while that page arrives.

Listing data is sent only to the loopback API. Card images are loaded from their original hosts.

Meta offers a [Marketplace search endpoint in the Content Library API](https://developers.facebook.com/docs/content-library-and-api/content-library-api/guides/fb-marketplace/). [Access is limited to approved research programs](https://developers.facebook.com/docs/content-library-and-api/get-access), and [downloading that data is limited](https://developers.facebook.com/docs/content-library-and-api/content-library-api/overview). This project is a local, logged-in prototype and does not use that API.

Run `npm test` to check listing normalization and SQLite deduplication.
