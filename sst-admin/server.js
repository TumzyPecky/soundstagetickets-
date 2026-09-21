// Minimal static file server for local use or any Node-capable host.
// This admin panel is plain static HTML/CSS/JS with no backend of its
// own - it only talks to the Sound Stage Tickets API server (configured
// at runtime via the Settings/Setup page). This file exists purely to
// serve those static files; if you're deploying to a static host
// (Netlify, Vercel, GitHub Pages, Render Static Site, S3 + CloudFront),
// you don't need this file at all - just upload the folder contents.

const http = require("http");
const path = require("path");
const fs = require("fs");

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;

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

const server = http.createServer((req, res) => {
  // Same security headers as the main API server (see sst-node's
  // src/security.js for the reasoning behind each one) - kept here too
  // since this file is what actually serves the admin panel if it's
  // deployed as a Node web service rather than Render's static hosting.
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "img-src 'self' data: blob:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "script-src 'self' 'unsafe-inline'",
      "connect-src 'self' *", // admin panel calls an operator-configured API URL, which can be any origin
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ")
  );

  const parsed = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(parsed.pathname);
  if (pathname === "/") pathname = "/index.html";

  const filePath = path.join(ROOT, pathname);
  const resolved = path.resolve(filePath);

  // Prevent path traversal outside this project's folder.
  if (!resolved.startsWith(ROOT)) {
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
});

server.listen(PORT, HOST, () => {
  console.log(`Sound Stage Tickets Admin running at http://${HOST}:${PORT}`);
  console.log("On first visit you'll be asked to connect this panel to your backend's API URL.");
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
