function parseCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};
  if (!header) return cookies;
  for (const pair of header.split(";")) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function setCookie(res, name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push("Path=/");
  parts.push("HttpOnly");
  parts.push("SameSite=Lax");
  // Render (and most hosts) terminate TLS in front of the app, so the
  // request Node sees is plain HTTP even though the browser used HTTPS.
  // Setting Secure based on NODE_ENV keeps local `npm start` working over
  // http://localhost while still protecting the cookie once deployed.
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  if (options.maxAge) parts.push(`Max-Age=${options.maxAge}`);
  if (options.clear) parts.push("Max-Age=0");
  const existing = res.getHeader("Set-Cookie");
  const cookieStr = parts.join("; ");
  if (existing) {
    res.setHeader("Set-Cookie", Array.isArray(existing) ? [...existing, cookieStr] : [existing, cookieStr]);
  } else {
    res.setHeader("Set-Cookie", cookieStr);
  }
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    const MAX_SIZE = 1024 * 1024; // 1MB
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_SIZE) {
        reject(Object.assign(new Error("Payload too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function readJsonBody(req, options = {}) {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    // Default cap is plenty for ordinary form submissions. Routes that
    // accept an embedded image (the receipt upload) pass a larger
    // maxSize explicitly - this keeps every other route's limit tight
    // rather than loosening the default for everyone.
    const MAX_SIZE = options.maxSize || 1024 * 1024; // 1MB
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_SIZE) {
        reject(Object.assign(new Error("Payload too large"), { status: 413 }));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(Object.assign(new Error("Invalid JSON body"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

module.exports = { parseCookies, setCookie, readJsonBody, readRawBody, sendJson };
