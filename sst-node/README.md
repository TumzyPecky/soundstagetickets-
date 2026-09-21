# Sound Stage Tickets — Backend

The public storefront and API backend for Sound Stage Tickets. Plain
Node.js (no framework), plain HTML/CSS/JS for the storefront — no build
step, no external npm packages required.

**The admin panel is a separate project** (`sst-admin`) that talks to
this server entirely over its `/api/admin/*` HTTP endpoints. This
project has no admin UI of its own — see `../sst-admin/README.md` to run
or deploy it. They can live on completely different domains; this server
just needs `ADMIN_ORIGIN` set correctly (see below) so the admin site's
browser requests are allowed through.

## Running it

```bash
npm start
```

Then open http://localhost:3000 for the public site.

The server auto-seeds one sample event, four ticket types, and a default
admin account the first time it runs. Data persists to `data/db.json`
between restarts. Delete that file (or run `npm run seed` after clearing
it) to start over.

To manage this backend, run the separate `sst-admin` project and connect
it to this server's URL (`http://localhost:3000` for local use) - see
that project's README for the first-run setup screen and default login
(`admin` / `ChangeMe123!`, unless you set `ADMIN_PASSWORD`).

## Connecting the admin panel (CORS)

Because the admin panel is a separate site/origin, this server allows
cross-origin requests to `/api/*` and returns a bearer token on login
instead of a cookie (cookies don't work reliably cross-site, especially
over plain HTTP during local development).

By default, `ADMIN_ORIGIN` is unset, which allows **any** origin to call
the admin API (`Access-Control-Allow-Origin: *`) - convenient while
you're setting things up, but not something you want left that way once
this is handling real orders. Once your admin site has a known URL, set:

```
ADMIN_ORIGIN=https://your-admin-site.example.com
```

so only that origin can call the admin endpoints. (Even with `*`, no one
can do anything without a valid login - this just limits which websites'
JavaScript can attempt to.)

## Deploying (e.g. Render)

This app needs nothing beyond Node itself - no database server, no build
step - so deployment is just "run `npm start`" on any host that runs
Node 18+.

### Render

1. Push this project to a Git repo, connect it in Render as a **Web
   Service**, or use the included `render.yaml` (Render will pick it up
   automatically as a Blueprint - it provisions a 1GB persistent disk for
   you).
2. Build command: `npm install`. Start command: `npm start`.
3. In the service's **Environment** tab, set at minimum:
   - `ADMIN_PASSWORD` - a real password (the built-in default is only
     for local testing and should never be used on a public deploy)
   - `NODE_ENV=production`
   - `DATA_DIR=/var/data` (only if you attached a persistent disk - see
     below)
   - `ADMIN_ORIGIN` - the URL of your deployed `sst-admin` site, once you
     know it (see "Connecting the admin panel" above)
4. Deploy. Render sets `PORT` for you automatically; the app already
   reads it via `process.env.PORT` and binds to `0.0.0.0`.
5. Deploy `sst-admin` (see its own README) and point it at this
   backend's URL from its setup screen.

**Persistent data - read this before deploying for real use:** Render's
default web service disk is *ephemeral* - anything written to it
(including this app's `data/db.json`) is wiped on every redeploy and can
be lost on a restart. For a real deployment, attach a **Persistent
Disk** (Render's paid disk add-on, included as a 1GB disk in
`render.yaml`) mounted at, say, `/var/data`, and set `DATA_DIR=/var/data`
so the app writes there instead of inside the app's own ephemeral
folder. Without this, orders/tickets/customers will disappear on your
next deploy.

If you'd rather not manage a disk at all, the cleanest fix is swapping
`src/db.js` for a real hosted database (Render Postgres, or any external
Postgres/MySQL/SQLite-over-network provider) - see "How data is stored"
below for where that swap happens.

### Any other host / VPS / your own domain

Same idea anywhere that runs Node 18+:

```bash
git clone <your-repo>
cd sst-node
npm install
ADMIN_PASSWORD=your-strong-password NODE_ENV=production npm start
```

Put this behind a reverse proxy (nginx, Caddy) for TLS/your domain, or
use a process manager (pm2, systemd) to keep it running and restart it
on crash or reboot. See `.env.example` for every environment variable
the app reads.

## How data is stored

There's no database server involved. `src/db.js` is a small dependency-free
JSON-file datastore: everything lives in `data/db.json`, loaded into memory
on boot and written back to disk after every change. This keeps setup to
"just run `node`" with no native module compilation, while still giving you
real persistence across restarts. If you outgrow this later, swap `src/db.js`
for a real SQLite (`better-sqlite3`) or Postgres client — the rest of the
app talks to it through a small, consistent interface (`insert`, `update`,
`find`, `findOne`, `getById`, `remove`) so the services and routes files
don't need to change much.

## Payments

Checkout currently **simulates** a successful payment — there is no real
payment gateway wired up yet. The flow is:

1. `POST /api/orders` creates a `PENDING` order.
2. `POST /api/payments/initialize` creates a payment record and returns a
   reference (this is where you'd call your gateway's "initialize
   transaction" endpoint instead).
3. The checkout page waits ~900ms (to feel like a real redirect/popup) and
   calls `POST /api/payments/confirm`, which immediately marks the payment
   successful, decrements ticket inventory, issues ticket numbers, and
   records a distributor commission if a referral code was used.

**To wire up a real gateway (e.g. Paystack):** replace the body of
`initializePayment()` in `src/services.js` with a real "initialize
transaction" API call, and have your gateway's webhook call
`confirmPayment(reference)` instead of the frontend calling
`/api/payments/confirm` directly. The rest of the app (inventory,
ticket issuance, commissions, notifications) does not need to change.

## Admin authentication

Admin login (`POST /api/admin/login`) returns a bearer token (not a
cookie), which the separate admin site stores and sends back as
`Authorization: Bearer <token>` on every subsequent admin request.
Sessions are tracked in-memory (`src/sessions.js`), so restarting this
server logs every admin site out. Fine for local/demo use; swap for a
persisted session store (e.g. a `sessions` collection in the datastore,
or Redis) if you need sessions to survive restarts.

## Project structure

```
src/
  server.js          Main HTTP server + routing + CORS
  db.js              JSON-file datastore
  auth.js            Password hashing (scrypt, built-in crypto)
  sessions.js        In-memory admin session/token store
  services.js        Order/payment/ticket business logic
  routes-public.js   Public API endpoints (storefront)
  routes-admin.js    Admin API endpoints (bearer-token protected)
  money.js           Kobo/Naira helpers
  seed.js            Creates sample event + admin on first run

public/
  index.html         Homepage (event + ticket types)
  checkout.html       Order form + simulated payment
  payment-status.html Payment result page
  ticket.html         Ticket lookup/display
  assets/
    styles.css         Shared dark-glass theme (no animations)
    icons.js           Inline SVG icon set (no emoji)
    api.js             Small fetch() wrapper used by the storefront pages
    logo.jpg
```

## Notes

- No animations or transitions are used anywhere in the UI, per request —
  styling is static dark glass panels.
- No emoji anywhere in the UI; all icons are inline SVG from
  `public/assets/icons.js`.
- There's no rate limiting, CSRF protection, or input sanitization beyond
  basic validation — this is a functional demo/starting point, not a
  hardened production build.
