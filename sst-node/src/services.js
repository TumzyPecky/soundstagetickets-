const db = require("./db");
const { randomToken } = require("./auth");
const { sendMail } = require("./mailer");

function generateOrderNumber() {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = randomToken(2).toUpperCase();
  return `SST-${stamp}-${rand}`;
}

function generateTicketNumber() {
  return `TKT-${randomToken(6).toUpperCase()}`;
}

/**
 * Create a pending order + orderItem + customer (creating the customer if
 * new) for a single ticket type and quantity. Does not touch inventory or
 * issue tickets yet - that happens once payment succeeds.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LENGTH = 120;
const MAX_PHONE_LENGTH = 30;
const MAX_QUANTITY_PER_ORDER = 20;

function createOrder({ eventId, ticketTypeId, quantity, customer, deliveryMethod, whatsappNumber, referralCode }) {
  const event = db.getById("events", eventId);
  if (!event) throw httpError(404, "Event not found");

  const ticketType = db.getById("ticketTypes", ticketTypeId);
  if (!ticketType || ticketType.eventId !== eventId) {
    throw httpError(404, "Ticket type not found");
  }
  if (ticketType.status === "DISABLED") throw httpError(400, "This ticket type is unavailable");

  if (!customer || !customer.fullName || !customer.email || !customer.phone) {
    throw httpError(400, "Full name, email, and phone are required");
  }
  if (typeof customer.fullName !== "string" || customer.fullName.trim().length < 2 || customer.fullName.length > MAX_NAME_LENGTH) {
    throw httpError(400, "Please enter a valid name");
  }
  if (typeof customer.email !== "string" || !EMAIL_PATTERN.test(customer.email) || customer.email.length > MAX_NAME_LENGTH) {
    throw httpError(400, "Please enter a valid email address");
  }
  if (typeof customer.phone !== "string" || customer.phone.trim().length < 6 || customer.phone.length > MAX_PHONE_LENGTH) {
    throw httpError(400, "Please enter a valid phone number");
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY_PER_ORDER) {
    throw httpError(400, `Quantity must be between 1 and ${MAX_QUANTITY_PER_ORDER}`);
  }
  if (deliveryMethod === "WHATSAPP") {
    if (typeof whatsappNumber !== "string" || whatsappNumber.trim().length < 6 || whatsappNumber.length > MAX_PHONE_LENGTH) {
      throw httpError(400, "Please enter a valid WhatsApp number");
    }
  }

  const remaining = ticketType.quantity - ticketType.soldQuantity;
  if (remaining < quantity) throw httpError(400, "Not enough tickets remaining");

  let customerRow = db.findOne("customers", (c) => c.email.toLowerCase() === customer.email.toLowerCase());
  if (!customerRow) {
    customerRow = db.insert("customers", {
      fullName: customer.fullName.trim(),
      email: customer.email.trim().toLowerCase(),
      phone: customer.phone.trim(),
    });
  }

  let distributor = null;
  if (referralCode) {
    if (typeof referralCode !== "string" || referralCode.length > 40) {
      throw httpError(400, "Invalid referral code");
    }
    distributor = db.findOne("distributors", (d) => d.referralCode === referralCode && d.status === "ACTIVE");
    if (distributor) {
      db.insert("referrals", { distributorId: distributor.id, eventId });
    }
  }

  const unitPrice = ticketType.price;
  const total = unitPrice * quantity;

  const order = db.insert("orders", {
    orderNumber: generateOrderNumber(),
    eventId,
    customerId: customerRow.id,
    distributorId: distributor ? distributor.id : null,
    deliveryMethod: deliveryMethod === "WHATSAPP" ? "WHATSAPP" : "EMAIL",
    whatsappNumber: deliveryMethod === "WHATSAPP" ? whatsappNumber.trim() : null,
    total,
    status: "AWAITING_RECEIPT",
  });

  db.insert("orderItems", {
    orderId: order.id,
    ticketTypeId,
    quantity,
    unitPrice,
    total,
  });

  return { order, customer: customerRow };
}

/**
 * Storage cap for an uploaded receipt image, as a base64 data URL string.
 * Base64 inflates size by ~33%, so this caps the original file at
 * roughly 6MB - generous for a phone screenshot while keeping the
 * flat-file JSON database from growing unmanageably from image data.
 */
const MAX_RECEIPT_DATA_URL_LENGTH = 8 * 1024 * 1024;

/**
 * Attach a payment receipt screenshot to a pending order and move it
 * into the admin's review queue. `receiptDataUrl` is the full image as a
 * data URL (e.g. "data:image/jpeg;base64,...") - the browser reads the
 * user's uploaded file and sends it as one field, so no multipart
 * upload parsing is needed here. Required before an order can be
 * reviewed at all: this is the one and only proof of payment the admin
 * has to go on.
 */
/**
 * Confirms the base64 payload's first few bytes actually match the
 * claimed image format (PNG/JPEG/WEBP magic numbers), not just that the
 * data URL's text prefix says so. A data URL's "data:image/png;base64,"
 * prefix is just a label the client sets - trusting it alone would let
 * someone upload arbitrary bytes (or a much larger file than the prefix
 * implies) labeled as an image. This doesn't fully parse/validate the
 * image (no dependency for that here), but it closes the cheap
 * mislabeling case.
 */
function hasValidImageMagicBytes(receiptDataUrl) {
  const commaIndex = receiptDataUrl.indexOf(",");
  if (commaIndex === -1) return false;
  const base64Payload = receiptDataUrl.slice(commaIndex + 1);

  let buffer;
  try {
    // Only decode the first several bytes worth of base64 - enough to
    // check the magic number without allocating a buffer for the whole
    // (potentially several-MB) image just to validate it.
    buffer = Buffer.from(base64Payload.slice(0, 40), "base64");
  } catch {
    return false;
  }
  if (buffer.length < 4) return false;

  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isWebp = buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";

  return isPng || isJpeg || isWebp;
}

function submitReceipt(orderId, receiptDataUrl) {
  const order = db.getById("orders", orderId);
  if (!order) throw httpError(404, "Order not found");
  if (order.status !== "AWAITING_RECEIPT") {
    throw httpError(400, "This order is not awaiting a receipt upload");
  }
  if (!receiptDataUrl || typeof receiptDataUrl !== "string") {
    throw httpError(400, "A receipt screenshot is required");
  }
  if (!/^data:image\/(png|jpe?g|webp);base64,/.test(receiptDataUrl)) {
    throw httpError(400, "Receipt must be an image (PNG, JPG, or WEBP)");
  }
  if (receiptDataUrl.length > MAX_RECEIPT_DATA_URL_LENGTH) {
    throw httpError(400, "Receipt image is too large - please upload a smaller screenshot");
  }
  if (!hasValidImageMagicBytes(receiptDataUrl)) {
    throw httpError(400, "That file doesn't look like a valid image. Please upload a real screenshot.");
  }

  db.update("orders", order.id, {
    status: "PENDING_REVIEW",
    receiptImage: receiptDataUrl,
    receiptUploadedAt: new Date().toISOString(),
  });

  return db.getById("orders", order.id);
}

function buildTicketEmailHtml({ order, customer, event, items }) {
  const firstName = customer.fullName.split(" ")[0];
  const eventName = event ? event.name : "Soundstage Live Concert";
  const isVip = items.some((i) => /vip/i.test(i.ticketTypeName));
  const accentColor = isVip ? "#d4af37" : "#4f8bff";

  const dateStr = event && event.date ? new Date(event.date).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }) : "";
  const timeStr = event ? event.time || "" : "";
  const venueStr = event ? [event.venue, event.address].filter(Boolean).join(" — ") : "";

  const ticketRows = items
    .map(
      (i) => `
      <tr>
        <td style="padding:14px 0;border-bottom:1px solid #26314f;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="font-family:Arial,Helvetica,sans-serif;">
                <span style="display:inline-block;background:${/vip/i.test(i.ticketTypeName) ? "#d4af37" : "#4f8bff"};color:#0a0e1a;font-size:11px;font-weight:700;letter-spacing:0.03em;text-transform:uppercase;border-radius:4px;padding:3px 8px;margin-bottom:6px;">${i.ticketTypeName}</span><br/>
                <span style="font-family:Arial,Helvetica,sans-serif;color:#e7ecfb;font-size:14px;">Qty ${i.quantity} &nbsp;·&nbsp; Ticket${i.tickets.length > 1 ? "s" : ""}: <span style="font-family:'Courier New',monospace;color:#7dd3ff;">${i.tickets.join(", ")}</span></span>
              </td>
            </tr>
          </table>
        </td>
      </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Your Soundstage Ticket</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f5f7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background-color:#0d111c;border-radius:16px;overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="background-color:#07090f;background-image:linear-gradient(120deg,#050a1a 0%,#0b1530 40%,#1a3a8f 100%);padding:28px 28px 24px;text-align:center;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:19px;font-weight:800;color:#ffffff;letter-spacing:-0.01em;">Soundstage</div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:600;color:#7dd3ff;letter-spacing:0.08em;text-transform:uppercase;margin-top:2px;">Live Concert Tickets</div>
            </td>
          </tr>

          <!-- Success banner -->
          <tr>
            <td style="background-color:${accentColor};padding:14px 28px;text-align:center;">
              <span style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#0a0e1a;">✓ Payment Confirmed — You're Going!</span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:28px;">
              <p style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:700;color:#ffffff;margin:0 0 6px;">Hi ${escapeHtmlEmail(firstName)},</p>
              <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#a8b2c9;margin:0 0 24px;line-height:1.5;">Your order is confirmed and your ticket${items.length > 1 || items.some((i) => i.quantity > 1) ? "s are" : " is"} ready. Here's everything you need for the show.</p>

              <!-- Order summary card -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#131928;border:1px solid #26314f;border-radius:12px;margin-bottom:20px;">
                <tr>
                  <td style="padding:18px 20px;">
                    <p style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;color:#7dd3ff;letter-spacing:0.06em;text-transform:uppercase;margin:0 0 4px;">Order Number</p>
                    <p style="font-family:'Courier New',monospace;font-size:15px;color:#ffffff;margin:0 0 16px;">${escapeHtmlEmail(order.orderNumber)}</p>

                    <p style="font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:700;color:#ffffff;margin:0 0 10px;">${escapeHtmlEmail(eventName)}</p>

                    ${dateStr ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:4px;"><tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#a8b2c9;padding-right:6px;">📅</td><td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#e7ecfb;">${escapeHtmlEmail(dateStr)}${timeStr ? " · " + escapeHtmlEmail(timeStr) : ""}</td></tr></table>` : ""}
                    ${venueStr ? `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#a8b2c9;padding-right:6px;vertical-align:top;">📍</td><td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#e7ecfb;line-height:1.4;">${escapeHtmlEmail(venueStr)}</td></tr></table>` : ""}
                  </td>
                </tr>
              </table>

              <!-- Tickets -->
              <p style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;color:#7dd3ff;letter-spacing:0.06em;text-transform:uppercase;margin:0 0 4px;">Your Tickets</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${ticketRows}
              </table>

              <p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#a8b2c9;line-height:1.6;margin:24px 0 0;">Show this email or your ticket number at the door. Doors open early — get there ahead of the crowd.</p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:18px 28px;border-top:1px solid #26314f;text-align:center;">
              <p style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#5c6787;margin:0;">This is an automated confirmation from Soundstage Live Concert.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtmlEmail(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Admin approves a receipt: mark the order PAID, decrement inventory,
 * issue tickets, record a distributor commission if applicable, and
 * email the tickets to the customer. Idempotent - safe to call more
 * than once for the same order (returns the existing result rather than
 * double-issuing tickets).
 */
async function approveOrder(orderId) {
  const order = db.getById("orders", orderId);
  if (!order) throw httpError(404, "Order not found");

  if (order.status === "PAID") {
    return { order, alreadyConfirmed: true };
  }
  if (order.status !== "PENDING_REVIEW") {
    throw httpError(400, "Only orders awaiting review can be approved");
  }

  db.update("orders", order.id, { status: "PAID", reviewedAt: new Date().toISOString() });

  const items = db.find("orderItems", (i) => i.orderId === order.id);
  const tickets = [];
  const emailItems = [];

  for (const item of items) {
    const ticketType = db.getById("ticketTypes", item.ticketTypeId);
    db.update("ticketTypes", ticketType.id, {
      soldQuantity: ticketType.soldQuantity + item.quantity,
      status:
        ticketType.soldQuantity + item.quantity >= ticketType.quantity
          ? "SOLD_OUT"
          : ticketType.status,
    });

    const ticketNumbers = [];
    for (let i = 0; i < item.quantity; i++) {
      const ticket = db.insert("tickets", {
        orderId: order.id,
        ticketTypeId: item.ticketTypeId,
        ticketNumber: generateTicketNumber(),
        status: "VALID",
      });
      tickets.push(ticket);
      ticketNumbers.push(ticket.ticketNumber);
    }
    emailItems.push({ ticketTypeName: ticketType.name, quantity: item.quantity, tickets: ticketNumbers });
  }

  if (order.distributorId) {
    const distributor = db.getById("distributors", order.distributorId);
    if (distributor) {
      const rate = distributor.commissionRate ?? 0.1;
      db.insert("commissions", {
        distributorId: distributor.id,
        orderId: order.id,
        type: "PERCENTAGE",
        rate,
        amount: Math.round(order.total * rate),
        status: "PENDING",
      });
    }
  }

  const customer = db.getById("customers", order.customerId);
  const event = db.getById("events", order.eventId);

  let notificationStatus = "SENT";
  let notificationError = null;
  try {
    await sendMail({
      to: customer.email,
      subject: `Your ticket${tickets.length > 1 ? "s" : ""} for ${event ? event.name : "Soundstage Live Concert"}`,
      html: buildTicketEmailHtml({ order, customer, event, items: emailItems }),
    });
  } catch (err) {
    // Tickets already exist in the system regardless of whether the
    // email send succeeds - log it and let the order stay PAID; the
    // admin can resend manually if needed (see resendTicketEmail below).
    notificationStatus = "FAILED";
    notificationError = err.message;
    console.error(`Failed to email tickets for order ${order.orderNumber}:`, err.message);
  }

  db.insert("notifications", {
    orderId: order.id,
    type: "PAYMENT_CONFIRMED",
    channel: "EMAIL",
    status: notificationStatus,
    error: notificationError,
  });

  const updatedOrder = db.getById("orders", order.id);
  return { order: updatedOrder, tickets };
}

/**
 * Directly issue N tickets of one type to a distributor who paid the
 * admin outside the normal checkout flow (e.g. bought 5 tickets in bulk
 * to resell face-to-face). Skips receipt upload/review entirely since
 * the admin is recording a transaction that already happened - this
 * immediately creates a PAID order, decrements inventory, and issues
 * real tickets, same as approveOrder does for a normal customer order.
 *
 * No email is sent here: these tickets are handed off by the
 * distributor in person/however they resell, not delivered to an
 * inbox. The admin sees the ticket numbers on screen to share as needed.
 */
function issueBulkOrder({ distributorId, ticketTypeId, quantity }) {
  const distributor = db.getById("distributors", distributorId);
  if (!distributor) throw httpError(404, "Distributor not found");
  if (distributor.status !== "ACTIVE") {
    throw httpError(400, "Only active distributors can be issued tickets");
  }

  const ticketType = db.getById("ticketTypes", ticketTypeId);
  if (!ticketType) throw httpError(404, "Ticket type not found");
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY_PER_ORDER) {
    throw httpError(400, `Quantity must be between 1 and ${MAX_QUANTITY_PER_ORDER}`);
  }

  const remaining = ticketType.quantity - ticketType.soldQuantity;
  if (remaining < quantity) throw httpError(400, "Not enough tickets remaining");

  // Bulk orders don't have a separate buyer - the distributor is both
  // the purchaser and the one handling resale, so their own contact
  // info is used for the order's customer record (orders always need
  // one). If this distributor already has a customer record from an
  // earlier bulk order, reuse it rather than creating duplicates.
  let customerRow = db.findOne("customers", (c) => c.email.toLowerCase() === distributor.email.toLowerCase());
  if (!customerRow) {
    customerRow = db.insert("customers", {
      fullName: distributor.name,
      email: distributor.email,
      phone: distributor.phone,
    });
  }

  const total = ticketType.price * quantity;
  const order = db.insert("orders", {
    orderNumber: generateOrderNumber(),
    eventId: ticketType.eventId,
    customerId: customerRow.id,
    distributorId: distributor.id,
    deliveryMethod: "EMAIL",
    whatsappNumber: null,
    total,
    status: "PAID",
    isBulkDistributorOrder: true,
    reviewedAt: new Date().toISOString(),
  });

  db.insert("orderItems", {
    orderId: order.id,
    ticketTypeId: ticketType.id,
    quantity,
    unitPrice: ticketType.price,
  });

  db.update("ticketTypes", ticketType.id, {
    soldQuantity: ticketType.soldQuantity + quantity,
    status: ticketType.soldQuantity + quantity >= ticketType.quantity ? "SOLD_OUT" : ticketType.status,
  });

  const tickets = [];
  for (let i = 0; i < quantity; i++) {
    const ticket = db.insert("tickets", {
      orderId: order.id,
      ticketTypeId: ticketType.id,
      ticketNumber: generateTicketNumber(),
      status: "VALID",
    });
    tickets.push(ticket);
  }

  // Bulk orders are a direct sale to the distributor, not a referred
  // sale through their link - no commission is recorded here, since
  // commission is for sales the distributor drives to the site, and
  // this bypasses the site entirely.

  return { order, tickets, ticketType, distributor };
}

/**
 * Admin declines a receipt (payment not received, wrong amount, unclear
 * screenshot, etc). The order moves to DECLINED - inventory is untouched
 * since it was never decremented for a PENDING_REVIEW order.
 */
function declineOrder(orderId, reason) {
  const order = db.getById("orders", orderId);
  if (!order) throw httpError(404, "Order not found");
  if (order.status !== "PENDING_REVIEW") {
    throw httpError(400, "Only orders awaiting review can be declined");
  }

  db.update("orders", order.id, {
    status: "DECLINED",
    reviewedAt: new Date().toISOString(),
    declineReason: reason || null,
  });

  return db.getById("orders", order.id);
}

/**
 * Re-send the ticket email for an already-paid order (e.g. from the
 * admin panel, or if the original send failed). Does not re-issue
 * tickets - only re-sends the existing ones.
 */
async function resendTicketEmail(orderId) {
  const order = db.getById("orders", orderId);
  if (!order) throw httpError(404, "Order not found");
  if (order.status !== "PAID") throw httpError(400, "Order is not paid yet");

  const customer = db.getById("customers", order.customerId);
  const event = db.getById("events", order.eventId);
  const orderItems = db.find("orderItems", (i) => i.orderId === order.id);
  const allTickets = db.find("tickets", (t) => t.orderId === order.id);

  const emailItems = orderItems.map((item) => {
    const ticketType = db.getById("ticketTypes", item.ticketTypeId);
    const ticketNumbers = allTickets.filter((t) => t.ticketTypeId === item.ticketTypeId).map((t) => t.ticketNumber);
    return { ticketTypeName: ticketType.name, quantity: item.quantity, tickets: ticketNumbers };
  });

  await sendMail({
    to: customer.email,
    subject: `Your ticket${allTickets.length > 1 ? "s" : ""} for ${event ? event.name : "Soundstage Live Concert"} (resent)`,
    html: buildTicketEmailHtml({ order, customer, event, items: emailItems }),
  });

  db.insert("notifications", {
    orderId: order.id,
    type: "RESEND",
    channel: "EMAIL",
    status: "SENT",
  });

  return { ok: true };
}

function getOrderStatus(orderId) {
  const order = db.getById("orders", orderId);
  if (!order) throw httpError(404, "Order not found");
  return order;
}

function getTicketByNumber(ticketNumber) {
  const ticket = db.findOne("tickets", (t) => t.ticketNumber === ticketNumber);
  if (!ticket) return null;
  const order = db.getById("orders", ticket.orderId);
  const ticketType = db.getById("ticketTypes", ticket.ticketTypeId);
  const event = db.getById("events", ticketType.eventId);
  const customer = db.getById("customers", order.customerId);
  return { ticket, order, ticketType, event, customer };
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

module.exports = {
  createOrder,
  submitReceipt,
  approveOrder,
  declineOrder,
  issueBulkOrder,
  resendTicketEmail,
  getOrderStatus,
  getTicketByNumber,
  httpError,
};
