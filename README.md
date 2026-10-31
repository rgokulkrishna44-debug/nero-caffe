# NERO Caffè

A premium cafe website for a Web Technologies course project: a dark espresso-themed
front end (HTML/CSS/JS), a Node/Express back end with a JSON-file store, and an n8n
automation that sends an alert for every table booking.

**Live site:** https://n8n.luvias.in/webhook/nero-caffe

## Sections

Every section has its own link in the navigation bar and footer:

| Link | Anchor | What it shows |
|---|---|---|
| Our Story | `#storia` | Origin story, photo pair, key numbers |
| Signatures | `#signatures` | Six house favourites with photos and prices |
| Our Coffee | `#process` | Bean-to-cup process in three steps |
| Menu | `#menu` | Full menu in ₹ with veg / non-veg markers |
| Gallery | `#galleria` | Photo collage |
| Reserve | `#prenota` | Working table booking form |
| Visit | `#visit` | Address, hours (today highlighted), contact |

Motion: hero entrance animation and slow image zoom, scroll-triggered reveals,
a scrolling ticker, sticky nav that turns solid on scroll and highlights the current
section, and hover effects. All motion is disabled for visitors who set "reduce motion".

## Structure

```
nero-cafe/
├── server.js              Express server: static hosting + API routes
├── package.json
├── data/
│   ├── menu.js            menu data (shared by the server and the online build)
│   └── reservations.json  flat-file store for bookings
├── public/
│   ├── index.html
│   ├── styles.css
│   ├── script.js
│   └── images/            17 cafe and food photos
└── tools/
    └── build-online.js    builds the single-file page used for the live site
```

## Back end (Express)

- `GET  /api/menu` returns the menu as JSON
- `GET  /api/reservations` lists stored bookings
- `POST /api/reservations` validates and saves a booking, returns `{ ok, ref }`
  - required: `name`, `email`, `date`, `time`, `guests` (1–8)
  - optional: `occasion`, `note`
  - rejects invalid emails, past dates and Mondays (closed) with a `400` and an `error` message
  - forwards each saved booking to the n8n webhook, which sends the guest a confirmation email

## Automation (n8n)

Two workflows on the n8n instance:

1. **NERO Caffe Reservation Alerts**: `POST /webhook/nero-reservation`. Checks the email
   address, emails the guest a confirmation, emails the owner a copy, and replies with
   `{ ok, ref, emailed }`, where `emailed` is `true` only when Gmail accepted the guest email.
   WhatsApp is not used.
2. **NERO Caffe Website**: `GET /webhook/nero-caffe`. Serves the live page over HTTPS;
   any plain `http://` request gets a permanent (301) redirect to the `https://` URL.

## Running locally

```bash
cd nero-cafe
npm install
npm start
```

Then open http://localhost:3000

## Updating the live site

1. Edit files in `public/` (or the menu in `data/menu.js`).
2. Run `node tools/build-online.js`. This writes `../online-demo/index.html` with the
   CSS and JS inlined, the menu embedded, and photos served from Unsplash's CDN.
3. Paste that file into the "Serve Website" node of the NERO Caffe Website workflow
   (Response Body) and publish the workflow.

Photos: Unsplash (free to use under the Unsplash License).

## Back office, database and order ahead (added 31 Oct)

- Storage is now SQLite (`data/nero.db`, Node's built-in `node:sqlite`, Node 22.5+). First run imports the menu and any old `reservations.json`.
- **Capacity:** bookings are refused when seats in use would pass the limit (default 18 seats, 90 minute tables, editable in the admin). `GET /api/availability?date=` feeds the booking form, which greys out full times.
- **Admin dashboard:** `/admin`. Bookings (seat, done, no show, cancel), menu editor (prices, sold out, add or delete), settings, tomorrow's digest.
- **Order ahead removed (31 Oct):** the pickup cart, checkout dialog and `/api/orders` were taken out. The menu still shows sold-out items.
- **Security:** `GET /api/reservations` (which listed guest contact details) now needs sign-in.
- Environment variables: `NERO_ADMIN_PASSWORD`, `NERO_API_KEY` (header `x-api-key`, for n8n), `NERO_SESSION_SECRET`, `NERO_DB`, `NERO_NOTIFY=off` (no emails when testing). Unset passwords are generated and printed at start.
