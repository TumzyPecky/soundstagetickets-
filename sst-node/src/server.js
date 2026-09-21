const http = require("http");
const url = require("url");
const path = require("path");
const fs = require("fs");

const { seed } = require("./seed");
const { handlePublicApi } = require("./routes-public");
const { handleAdminApi } = require("./routes-admin");
const { sendJson } = require("./http-utils");
const { applySecurityHeaders, blockIfLooksAutomated, isProtectedRoute } = require("./security");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "..", "public");

// The admin panel is now a separate static site/deployment that calls
// this server's /api/admin/* endpoints over HTTP from a different origin.
// Set ADMIN_ORIGIN to that site's exact origin (e.g.
// https://sst-admin.onrender.com) once you know it, for a locked-down
// CORS policy. Left unset, this defaults to "*" (any origin) so the
// admin site works immediately during setup/local testing - tighten this
// before relying on it for anything sensitive. Note: CORS is a
// browser-enforced protection (it stops a webpage on another origin
// from reading responses via fetch/XHR) - it does not stop a script,
// curl, or another server from calling this API directly regardless of
// this setting. The admin API's real protection is the login + session
// token check on every /api/admin/* route, not CORS.
const ADMIN_ORIGIN = process.env.ADMIN_ORIGIN || "*";

if (ADMIN_ORIGIN === "*" && process.env.NODE_ENV === "production") {
  console.warn(
    "WARNING: ADMIN_ORIGIN is not set. CORS is wide open (any website can call this API from a browser). " +
      "Set ADMIN_ORIGIN to your admin panel's exact URL (e.g. https://sst-admin.onrender.com) in Render's environment variables."
  );
}

function applyCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", ADMIN_ORIGIN);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function serveStatic(req, res, pathname) {
  // Map a URL path to a file inside /public, defaulting to index.html for
  // directory-style routes so client-side links like /ticket/ABC still
  // resolve to a page (the page itself reads the id from the URL via JS).
  //
  // Note: the admin panel is a separate project/deployment now (see
  // sst-admin). This server only serves the public storefront, plus the
  // /api/admin/* endpoints that admin project talks to over HTTP.
  let filePath;

  if (pathname === "/" || pathname === "") {
    filePath = path.join(PUBLIC_DIR, "index.html");
  } else if (pathname.startsWith("/checkout")) {
    filePath = path.join(PUBLIC_DIR, "checkout.html");
  } else if (pathname.startsWith("/payment-status")) {
    filePath = path.join(PUBLIC_DIR, "payment-status.html");
  } else if (pathname.startsWith("/ticket/")) {
    filePath = path.join(PUBLIC_DIR, "ticket.html");
  } else {
    // Direct static asset request (css, js, images)
    filePath = path.join(PUBLIC_DIR, pathname);
  }

  // Prevent path traversal outside /public
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(resolved, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not found");
    }
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const parsedForSearch = new URL(req.url, `http://${req.headers.host}`);
  // Attach a URLSearchParams-compatible helper to the plain parsed object
  parsed.searchParams = parsedForSearch.searchParams;

  try {
    applySecurityHeaders(req, res);

    // Apply CORS broadly (health check included, since the separate
    // admin site's setup screen calls it cross-origin to verify a URL
    // before saving it) rather than only on /api/ - cheap and harmless
    // for a handful of routes on this server.
    if (parsed.pathname === "/healthz" || parsed.pathname.startsWith("/api/")) {
      applyCors(req, res);
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        return res.end();
      }
    }

    if (isProtectedRoute(parsed.pathname, req.method) && blockIfLooksAutomated(req, res)) {
      return;
    }

    if (parsed.pathname === "/healthz") {
      return sendJson(res, 200, { status: "ok" });
    }

    if (parsed.pathname.startsWith("/api/admin/")) {
      const handled = await handleAdminApi(req, parsed, res);
      if (handled !== null) return;
      return sendJson(res, 404, { error: "Not found" });
    }

    if (parsed.pathname.startsWith("/api/")) {
      const handled = await handlePublicApi(req, parsed, res);
      if (handled !== null) return;
      return sendJson(res, 404, { error: "Not found" });
    }

    return serveStatic(req, res, parsed.pathname);
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, { error: "Internal server error" });
  }
});

seed();

server.listen(PORT, HOST, () => {
  console.log(`Soundstage Tickets running at http://${HOST}:${PORT}`);
  console.log(`Admin API available at http://${HOST}:${PORT}/api/admin/* (run the separate sst-admin project to manage it)`);
});

// Don't let one bad request or an unexpected rejection take the whole
// process down - log it and keep serving. This matters on a host like
// Render where a crashed process means real downtime until it restarts.
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});
process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
});

// Respond to termination signals cleanly so the platform's health checks
// and rolling deploys behave (Render sends SIGTERM before killing a
// container during a deploy).
function shutdown(signal) {
  console.log(`${signal} received, shutting down.`);
  server.close(() => process.exit(0));
  // Force exit if connections don't close within a few seconds.
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
