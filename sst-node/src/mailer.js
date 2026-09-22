// Email sender for ticket emails.
//
// WHY THIS CHANGED: Render's free plan blocks outbound SMTP (ports 25, 465,
// 587). The old code opened a raw TLS socket to smtp.gmail.com:465, so every
// send failed with a socket error (ECONNRESET / ETIMEDOUT) - and because
// those errors have an empty `message`, the log line showed nothing after
// the colon. HTTPS (port 443) is never blocked, so the primary path now
// sends through an email provider's HTTP API instead.
//
// Providers, tried in this order:
//   1. Resend HTTP API   (works on Render free tier)  <- recommended
//   2. Gmail SMTP        (only works where outbound SMTP is allowed:
//                         local dev, or a paid Render plan)
//
// Env vars:
//   RESEND_API_KEY        API key from https://resend.com/api-keys
//   MAIL_FROM_ADDRESS     verified sender, e.g. tickets@yourdomain.com
//                         (if you haven't verified a domain yet, leave this
//                         unset and Resend's test sender is used - see README)
//   MAIL_FROM_NAME        display name, e.g. "Soundstage Live Concert"
//   MAIL_REPLY_TO         optional reply-to address (e.g. your Gmail)
//   GMAIL_USER / GMAIL_APP_PASSWORD   optional SMTP fallback

const tls = require("tls");

const RESEND_API_KEY = (process.env.RESEND_API_KEY || "").trim();
const MAIL_FROM_ADDRESS = (process.env.MAIL_FROM_ADDRESS || "").trim();
const MAIL_FROM_NAME = process.env.MAIL_FROM_NAME || "Soundstage Live Concert";
const MAIL_REPLY_TO = (process.env.MAIL_REPLY_TO || process.env.GMAIL_USER || "").trim();

const GMAIL_USER = (process.env.GMAIL_USER || "").trim();
const GMAIL_APP_PASSWORD = (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");

const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 465; // implicit TLS
const SEND_TIMEOUT_MS = 20000;

// Resend's shared test sender. It works with no domain setup, but Resend
// only delivers from it to the email address that owns the Resend account.
// To email real customers you must verify your own domain in Resend and
// set MAIL_FROM_ADDRESS.
const RESEND_TEST_SENDER = "onboarding@resend.dev";

/**
 * Turns any thrown value into a readable string. Socket errors like
 * ECONNRESET have an empty .message and only a .code, which is why the old
 * logs printed nothing after the colon.
 */
function describeError(err) {
  if (!err) return "Unknown error";
  const parts = [];
  if (err.message) parts.push(err.message);
  if (err.code && !parts.join(" ").includes(err.code)) parts.push(`[${err.code}]`);
  if (err.cause && err.cause.code && !parts.join(" ").includes(err.cause.code)) parts.push(`[${err.cause.code}]`);
  if (err.cause && err.cause.message && err.cause.message !== err.message) parts.push(err.cause.message);
  return parts.length ? parts.join(" ") : String(err.name || "Unknown error");
}

function stripHtml(html) {
  return html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Provider 1: Resend (HTTPS)
// ---------------------------------------------------------------------------
async function sendViaResend({ to, subject, html, text }) {
  const fromAddress = MAIL_FROM_ADDRESS || RESEND_TEST_SENDER;
  const body = {
    from: `${MAIL_FROM_NAME} <${fromAddress}>`,
    to: [to],
    subject,
    html,
    text: text || stripHtml(html),
  };
  if (MAIL_REPLY_TO) body.reply_to = MAIL_REPLY_TO;

  let res;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (err) {
    if (err && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new Error(`Resend request timed out after ${SEND_TIMEOUT_MS / 1000}s`);
    }
    throw new Error(`Could not reach Resend: ${describeError(err)}`);
  }

  if (!res.ok) {
    let detail = "";
    try {
      const data = await res.json();
      detail = data.message || data.error || JSON.stringify(data);
    } catch (_) {
      detail = await res.text().catch(() => "");
    }
    let hint = "";
    if (/domain|verify|testing emails/i.test(detail)) {
      // Domain problems also come back as 403/422, so check the message
      // first - otherwise a valid key gets blamed.
      hint = " (Resend needs a verified sending domain to email customers - verify one in Resend and set MAIL_FROM_ADDRESS)";
    } else if (res.status === 401 || res.status === 403) {
      hint = " (check RESEND_API_KEY)";
    }
    throw new Error(`Resend error ${res.status}: ${detail || res.statusText}${hint}`);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Provider 2: Gmail SMTP (raw TLS) - fallback, needs outbound SMTP allowed
// ---------------------------------------------------------------------------
function b64(str) {
  return Buffer.from(str, "utf8").toString("base64");
}

/** Encode a header value that may contain non-ASCII characters (RFC 2047). */
function encodeHeader(value) {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${b64(value)}?=`;
}

function smtpCommand(socket, command) {
  return new Promise((resolve, reject) => {
    let buffer = "";

    function cleanup() {
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
      socket.removeListener("close", onClose);
    }
    function onError(err) {
      cleanup();
      reject(new Error(describeError(err)));
    }
    function onClose() {
      cleanup();
      reject(new Error("SMTP connection closed unexpectedly"));
    }
    function onData(chunk) {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n").filter(Boolean);
      const last = lines[lines.length - 1];
      if (!last || !/^\d{3} /.test(last)) return; // wait for the final line
      cleanup();
      const code = Number(last.slice(0, 3));
      if (code >= 400) reject(new Error(`SMTP error (${code}): ${buffer.trim()}`));
      else resolve(buffer.trim());
    }

    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("close", onClose);
    if (command !== null) socket.write(command + "\r\n");
  });
}

function sendViaGmailSmtp({ to, subject, html, text }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let socket;

    const timer = setTimeout(() => {
      fail(new Error(
        `Gmail SMTP timed out after ${SEND_TIMEOUT_MS / 1000}s - the host is probably blocking outbound SMTP ` +
        `(Render's free plan does). Set RESEND_API_KEY to send over HTTPS instead.`
      ));
    }, SEND_TIMEOUT_MS);

    function fail(err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (socket) socket.destroy();
      reject(err);
    }
    function succeed() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(true);
    }

    socket = tls.connect(SMTP_PORT, SMTP_HOST, { servername: SMTP_HOST }, async () => {
      try {
        await smtpCommand(socket, null); // greeting banner
        await smtpCommand(socket, `EHLO ${SMTP_HOST}`);
        await smtpCommand(socket, "AUTH LOGIN");
        await smtpCommand(socket, b64(GMAIL_USER));
        await smtpCommand(socket, b64(GMAIL_APP_PASSWORD));
        await smtpCommand(socket, `MAIL FROM:<${GMAIL_USER}>`);
        await smtpCommand(socket, `RCPT TO:<${to}>`);
        await smtpCommand(socket, "DATA");

        const plainText = text || stripHtml(html);
        const boundary = "sst_" + Date.now().toString(36);
        const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@${SMTP_HOST}>`;

        // Base64 bodies avoid every line-length / dot-stuffing / non-ASCII
        // problem the old 7bit version could hit (e.g. "₦" or emoji in an
        // event name would previously corrupt the message).
        const wrap = (s) => Buffer.from(s, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");

        const message = [
          `From: ${encodeHeader(MAIL_FROM_NAME)} <${GMAIL_USER}>`,
          `To: ${to}`,
          `Subject: ${encodeHeader(subject)}`,
          `Message-ID: ${messageId}`,
          "MIME-Version: 1.0",
          `Content-Type: multipart/alternative; boundary="${boundary}"`,
          "",
          `--${boundary}`,
          "Content-Type: text/plain; charset=UTF-8",
          "Content-Transfer-Encoding: base64",
          "",
          wrap(plainText),
          "",
          `--${boundary}`,
          "Content-Type: text/html; charset=UTF-8",
          "Content-Transfer-Encoding: base64",
          "",
          wrap(html),
          "",
          `--${boundary}--`,
          ".",
        ].join("\r\n");

        await smtpCommand(socket, message);
        await smtpCommand(socket, "QUIT").catch(() => {});
        socket.end();
        succeed();
      } catch (err) {
        fail(err);
      }
    });

    socket.on("error", (err) => fail(new Error(`Gmail SMTP connection failed: ${describeError(err)}`)));
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** True if at least one email provider is configured. */
function isMailConfigured() {
  return Boolean(RESEND_API_KEY || (GMAIL_USER && GMAIL_APP_PASSWORD));
}

/**
 * Sends one email. Tries Resend first (HTTPS), then Gmail SMTP. Rejects with
 * an Error whose message always says what actually went wrong.
 */
async function sendMail({ to, subject, html, text }) {
  if (!to) throw new Error("No recipient email address on this order's customer");
  if (!isMailConfigured()) {
    throw new Error(
      "No email provider configured. Set RESEND_API_KEY (recommended) in Render's Environment tab, " +
      "or GMAIL_USER + GMAIL_APP_PASSWORD."
    );
  }

  const errors = [];

  if (RESEND_API_KEY) {
    try {
      return await sendViaResend({ to, subject, html, text });
    } catch (err) {
      errors.push(describeError(err));
    }
  }

  if (GMAIL_USER && GMAIL_APP_PASSWORD) {
    try {
      return await sendViaGmailSmtp({ to, subject, html, text });
    } catch (err) {
      errors.push(describeError(err));
    }
  }

  throw new Error(errors.join(" | "));
}

module.exports = { sendMail, isMailConfigured, describeError };
