# Sound Stage Tickets — Admin (Standalone)

A separate admin panel for [Sound Stage Tickets](../sst-node). This is a
plain static HTML/CSS/JS site with **no backend of its own** - it manages
your storefront entirely by calling that backend's `/api/admin/*`
endpoints over HTTP, using a bearer token from login. You can host this
on a completely different domain, subdomain, or platform than the
storefront itself.

## Running it locally

```bash
npm start
```

Then open http://localhost:4000. Since this is just static files, you can
equally well open `index.html` directly in a browser, or serve the folder
with any static file server (`npx serve`, `python3 -m http.server`, etc.)
- `server.js` is provided only for convenience.

## First-time setup

On first visit you'll be asked to **connect a backend**: enter the URL
where your Sound Stage Tickets server (the `sst-node` project) is
running - e.g. `http://localhost:3000` for local testing, or
`https://your-backend.onrender.com` once deployed. This is saved in your
browser's `localStorage`, so you only do it once per browser.

After connecting, log in with the same admin credentials configured on
the backend (see the backend's README for `ADMIN_USERNAME`/
`ADMIN_PASSWORD`).

You can reconnect to a different backend anytime from **Settings** in
the sidebar.

## How the connection works

- No cookies are used (cookies don't work reliably across two different
  origins/domains). Instead, login returns a **bearer token**, stored in
  `localStorage`, sent as an `Authorization: Bearer <token>` header on
  every request.
- The backend must have CORS enabled for this admin site's origin. By
  default the backend allows any origin (`ADMIN_ORIGIN=*`) so this works
  immediately - for a production deployment, set the backend's
  `ADMIN_ORIGIN` environment variable to this admin site's exact URL
  (e.g. `https://sst-admin.onrender.com`) to lock that down.

## Deploying

This is a static site, so the simplest deploy is any static host:

- **Render:** the included `render.yaml` deploys this as a Render Static
  Site (free, no server process needed).
- **Netlify / Vercel / GitHub Pages / S3+CloudFront:** just upload this
  folder - there's no build step.
- **Node host:** `npm start` runs the included tiny static file server,
  if you'd rather run it as a web service than a static site.

Whichever you choose, once it's live:

1. Deploy the backend (`sst-node`) first and note its URL.
2. Set the backend's `ADMIN_ORIGIN` environment variable to this admin
   site's URL once you know it (locks down CORS to just this site).
3. Deploy this admin site, visit it, and connect it to the backend's URL
   via the setup screen.

## Project structure

```
index.html            Dashboard
orders.html / order-detail.html
customers.html
tickets.html           Ticket type management
distributors.html
commissions.html
settings.html          Change backend / change password
login.html
setup.html             First-run: connect to a backend
assets/
  styles.css           Shared dark-glass theme (no animations)
  icons.js             Inline SVG icon set (no emoji)
  api.js               Fetch wrapper: base URL + bearer token, used by every page
  shell.js             Shared sidebar/nav + auth guard
  logo.jpg
server.js              Optional local/Node static file server
```
