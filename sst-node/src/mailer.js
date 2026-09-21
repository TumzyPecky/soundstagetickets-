// Minimal SMTP client for sending ticket emails via Gmail, using Node's
// built-in tls module - no external dependencies (nodemailer etc.).
//
// Setup required on the Gmail account you send from:
//   1. Enable 2-Step Verification on the Google account.
//   2. Create an "App Password": https://myaccount.google.com/apppasswords
//      (choose "Mail" as the app). Use that 16-character password below -
//      NOT the account's normal login password, which will not work.
//
// Required env vars:
//   GMAIL_USER            the Gmail address you're sending from
//   GMAIL_APP_PASSWORD    the 16-character App Password (no spaces)
//   MAIL_FROM_NAME        optional display name, e.g. "Soundstage Live Concert"

const tls = require("tls");

const GMAIL_USER = process.env.GMAIL_USER || "";
const GMAIL_APP_PASSWORD = (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
const MAIL_FROM_NAME = process.env.MAIL_FROM_NAME || "Soundstage Live Concert";

const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 465; // implicit TLS

function b64(str) {
  return Buffer.from(str, "utf8").toString("base64");
}

/**
 * Talks raw SMTP over an already-connected TLS socket. Sends one command,
 * waits for a response line (or block of lines), and resolves with it.
 * Throws if the server responds with a 4xx/5xx code.
 */
function smtpCommand(socket, command, { multiline = false } = {}) {
  return new Promise((resolve, reject) => {
    let buffer = "";

    function onData(chunk) {
      buffer += chunk.toString("utf8");
      // SMTP multi-line responses use "250-" for continuation lines and
      // "250 " (space) for the final line of a block.
      const lines = buffer.split("\r\n").filter(Boolean);
      const last = lines[lines.length - 1];
      if (!last) return;
      const isFinal = /^\d{3} /.test(last);
      if (!isFinal) return; // wait for more data

      socket.removeListener("data", onData);
      const code = Number(last.slice(0, 3));
      if (code >= 400) {
        reject(new Error(`SMTP error (${code}): ${buffer.trim()}`));
      } else {
        resolve(buffer.trim());
      }
    }

    socket.on("data", onData);
    if (command !== null) socket.write(command + "\r\n");
  });
}

/**
 * Sends a single email through Gmail's SMTP server. `html` is the email
 * body; a plain-text fallback is derived automatically if not provided.
 */
function sendMail({ to, subject, html, text }) {
  return new Promise((resolve, reject) => {
    if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
      return reject(new Error("GMAIL_USER / GMAIL_APP_PASSWORD are not set. Add them in Render's Environment tab."));
    }

    const socket = tls.connect(SMTP_PORT, SMTP_HOST, { servername: SMTP_HOST }, async () => {
      try {
        await smtpCommand(socket, null); // read the server's greeting banner
        await smtpCommand(socket, `EHLO ${SMTP_HOST}`, { multiline: true });
        await smtpCommand(socket, "AUTH LOGIN");
        await smtpCommand(socket, b64(GMAIL_USER));
        await smtpCommand(socket, b64(GMAIL_APP_PASSWORD));
        await smtpCommand(socket, `MAIL FROM:<${GMAIL_USER}>`);
        await smtpCommand(socket, `RCPT TO:<${to}>`);
        await smtpCommand(socket, "DATA");

        const plainText = text || html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        const boundary = "sst_" + Date.now().toString(36);
        const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@${SMTP_HOST}>`;

        const message = [
          `From: ${MAIL_FROM_NAME} <${GMAIL_USER}>`,
          `To: ${to}`,
          `Subject: ${subject}`,
          `Message-ID: ${messageId}`,
          "MIME-Version: 1.0",
          `Content-Type: multipart/alternative; boundary="${boundary}"`,
          "",
          `--${boundary}`,
          "Content-Type: text/plain; charset=UTF-8",
          "Content-Transfer-Encoding: 7bit",
          "",
          plainText,
          "",
          `--${boundary}`,
          "Content-Type: text/html; charset=UTF-8",
          "Content-Transfer-Encoding: 7bit",
          "",
          html,
          "",
          `--${boundary}--`,
          ".",
        ].join("\r\n");
        // A lone "." on a line marks end-of-DATA in SMTP; if the body
        // itself contains a line starting with ".", it must be escaped
        // by doubling it. Do that on everything except our own final ".".
        const escaped = message
          .split("\r\n")
          .map((line, idx, arr) => (idx < arr.length - 1 && line === ".") ? ".." : line)
          .join("\r\n");

        await smtpCommand(socket, escaped);
        await smtpCommand(socket, "QUIT");
        socket.end();
        resolve(true);
      } catch (err) {
        socket.destroy();
        reject(err);
      }
    });

    socket.on("error", reject);
  });
}

module.exports = { sendMail };
