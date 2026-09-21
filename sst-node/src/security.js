// Security headers and basic bot/scraper defenses.
//
// Honest scope of what this actually does:
//   - Response headers below are real, standard browser-side protections
//     (clickjacking, MIME sniffing, forced HTTPS, etc). They work against
//     any browser that respects them - which is all real browsers.
//   - The bot/scraper checks below filter out unsophisticated automated
//     traffic (missing/blank User-Agent, wrong Content-Type, scripted
//     tools that don't bother faking headers). A motivated attacker who
//     sets realistic headers will pass these checks - this raises the
//     bar for casual scraping/spam, it does not stop a targeted attack.
//   - None of this blocks by IP address. True IP-level blocking belongs
//     at the network/platform layer (Render, or a CDN like Cloudflare in
//     front of it) - an app can't reliably enforce that itself, and a
//     determined attacker rotates IPs anyway.

/**
 * Apply standard security headers to every response. Safe to call
 * unconditionally - none of these affect normal API or page behavior.
 */
function applySecurityHeaders(req, res) {
  // Stop the browser from guessing content types (e.g. treating an
  // uploaded image as executable script).
  res.setHeader("X-Content-Type-Options", "nosniff");

  // Prevent this site from being embedded in an <iframe> elsewhere -
  // blocks clickjacking attacks that overlay invisible buttons on top
  // of a legitimate-looking page.
  res.setHeader("X-Frame-Options", "DENY");

  // Tell browsers to only ever load this site over HTTPS for the next
  // year, including subdomains. Render terminates TLS in front of the
  // app, so this is safe to send even though the app itself speaks
  // plain HTTP internally.
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");

  // Don't leak the full referring URL (which can contain order IDs,
  // ticket numbers, etc in the query string) to third-party sites when
  // a link on this site is clicked.
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  // Restrict this site from being granted access to sensitive browser
  // features it never uses.
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");

  // A conservative Content-Security-Policy. 'unsafe-inline' is required
  // because the pages use inline <script> and <style> blocks throughout
  // rather than external files with hashes/nonces - loosening this
  // further than necessary would be the wrong tradeoff for a small
  // ticketing site, but note it does not protect against inline-script
  // injection the way a strict CSP would.
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "img-src 'self' data: blob:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "script-src 'self' 'unsafe-inline'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ")
  );
}

/**
 * Basic User-Agent sanity check. Rejects requests with no User-Agent at
 * all, or ones matching a short list of well-known scraping/testing
 * tools' default signatures. Intentionally does NOT try to maintain an
 * exhaustive blocklist - that's a losing game and gives false
 * confidence. This is a low-cost filter for low-effort automated
 * traffic, not a serious anti-bot system.
 */
const SUSPICIOUS_UA_PATTERNS = [
  /^$/, // completely blank
  /^curl\//i,
  /^python-requests\//i,
  /^python-urllib\//i,
  /^go-http-client\//i,
  /^java\//i,
  /^scrapy\//i,
  /^okhttp\//i,
  /^postmanruntime\//i,
  /^axios\//i,
  /^node-fetch\//i,
  /bot|crawler|spider/i,
];

function hasSuspiciousUserAgent(req) {
  const ua = req.headers["user-agent"] || "";
  return SUSPICIOUS_UA_PATTERNS.some((pattern) => pattern.test(ua));
}

/**
 * For routes that accept a JSON body, reject requests whose declared
 * Content-Type isn't actually JSON. A real browser using fetch() from
 * these pages always sends this correctly; a script probing the API
 * directly with the wrong header is a cheap tell.
 */
function hasValidJsonContentType(req) {
  if (req.method === "GET" || req.method === "OPTIONS") return true;
  const contentType = req.headers["content-type"] || "";
  return contentType.toLowerCase().includes("application/json");
}

/**
 * Runs the bot/scraper checks for a request and, if it looks automated,
 * writes a 403 and returns true (caller should stop handling the
 * request). Returns false if the request looks legitimate and normal
 * handling should continue.
 *
 * Applied only to state-changing API routes (order creation, receipt
 * upload, admin login) - GET requests for public data (event details,
 * ticket availability) are left alone, since blocking those would just
 * break legitimate previews/monitoring for no real security benefit.
 */
function blockIfLooksAutomated(req, res) {
  if (hasSuspiciousUserAgent(req)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Request blocked." }));
    return true;
  }
  if (!hasValidJsonContentType(req)) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid request." }));
    return true;
  }
  return false;
}

/**
 * The specific routes worth applying blockIfLooksAutomated to: anything
 * that creates data or costs the business something if spammed (orders,
 * receipt uploads, admin login). Read-only routes are intentionally
 * excluded - see the comment on blockIfLooksAutomated above.
 */
function isProtectedRoute(pathname, method) {
  if (method === "GET" || method === "OPTIONS") return false;
  return (
    pathname === "/api/orders" ||
    /^\/api\/orders\/[^/]+\/receipt$/.test(pathname) ||
    pathname === "/api/admin/login"
  );
}

module.exports = {
  applySecurityHeaders,
  blockIfLooksAutomated,
  isProtectedRoute,
};
