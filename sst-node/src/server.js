require("dotenv").config();
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

// Comma-separated list of allowed origins for CORS, e.g.:
//   https://admin.soundstagetickets.com.ng,https://sst-distributor.onrender.com
// Unset = "*" (any origin), which is fine for local dev but should be
// locked down in production. Each browser request's Origin header is
// checked against this list; only matching origins get the CORS header.
const ADMIN_ORIGIN_RAW = process.env.ADMIN_ORIGIN || "*";
const ALLOWED_ORIGINS =
  ADMIN_ORIGIN_RAW === "*"
    ? ["*"]
    : ADMIN_ORIGIN_RAW.split(",").map((s) => s.trim()).filter(Boolean);

if (ADMIN_ORIGIN_RAW === "*" && process.env.NODE_ENV === "production") {
  console.warn(
    "WARNING: ADMIN_ORIGIN is not set. CORS is wide open (any website can call this API from a browser). " +
      "Set ADMIN_ORIGIN to a comma-separated list of allowed origins (admin panel + distributor portal) in Render's environment variables."
  );
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  let allowOrigin = "*";
  if (!ALLOWED_ORIGINS.includes("*")) {
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      allowOrigin = origin;
    } else {
      // Not an allowed origin: send a non-matching value so browsers
      // block the response. Backend still responds, but the browser
      // hides it from the calling page.
      allowOrigin = ALLOWED_ORIGINS[0] || "";
    }
  }
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
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
    filePath = path.join(PUBLIC_DIR, pathname);
  }

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
  parsed.searchParams = parsedForSearch.searchParams;

  try {
    applySecurityHeaders(req, res);

    // Apply CORS broadly — health check included, since both the admin
    // panel's setup screen and the distributor portal's setup screen
    // call /healthz cross-origin to verify a URL before saving it.
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

    // GET /go/:code - a distributor's referral landing page button hits
    // this route. Records a click (deduped by IP), then redirects to
    // the real ticket site. Set REAL_SITE_URL in the environment.
    const goMatch = parsed.pathname.match(/^\/go\/([^/]+)$/);
    if (goMatch && req.method === "GET") {
      const code = decodeURIComponent(goMatch[1]);
      const ip =
        (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
        req.socket.remoteAddress ||
        "unknown";
      try {
        const distributorService = require("./distributor-service");
        distributorService.recordForward(code, ip);
      } catch (err) {
        console.error("[go] recordForward failed:", err.message);
      }
      const target = process.env.REAL_SITE_URL || "https://soundstagetickets.com.ng";
      res.writeHead(302, { Location: `${target}/?ref=${encodeURIComponent(code)}` });
      return res.end();
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

seed().catch((err) => console.error("Seed failed:", err));

server.listen(PORT, HOST, () => {
  console.log(`Soundstage Tickets running at http://${HOST}:${PORT}`);
  console.log(
    `Admin API available at http://${HOST}:${PORT}/api/admin/* (run the separate sst-admin project to manage it)`
  );
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});
process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));