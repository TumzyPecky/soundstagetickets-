const db = require("./db");
const services = require("./services");
const { sendJson, readJsonBody } = require("./http-utils");
const { koboToNaira } = require("./money");
const { createDistributorSession, getSession, destroySession } = require("./sessions");
const distributorService = require("./distributor-service");
const { verifyPassword, hashPassword } = require("./auth");

function serializeTicketType(tt) {
  return {
    id: tt.id,
    name: tt.name,
    description: tt.description,
    price: tt.price,
    remaining: Math.max(tt.quantity - tt.soldQuantity, 0),
    status: tt.status,
  };
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1] : null;
}

function requireDistributor(req) {
  const token = getBearerToken(req);
  const session = getSession(token);
  if (!session || !session.distributorId) {
    throw distributorService.httpError(401, "Not authenticated");
  }
  const distributor = db.getById("distributors", session.distributorId);
  if (!distributor) throw distributorService.httpError(401, "Not authenticated");
  return distributor;
}

async function handlePublicApi(req, url, res) {
  const { pathname } = url;

  // GET /api/event - the single published event plus its ticket types
  if (pathname === "/api/event" && req.method === "GET") {
    const event = db.findOne("events", (e) => e.status === "PUBLISHED");
    if (!event) return sendJson(res, 404, { error: "No published event" });
    const ticketTypes = db
      .find("ticketTypes", (t) => t.eventId === event.id && t.status !== "DISABLED")
      .sort((a, b) => a.price - b.price)
      .map(serializeTicketType);
    return sendJson(res, 200, { event, ticketTypes });
  }

  // GET /api/tickets - flat list of purchasable ticket types (used by checkout page)
  if (pathname === "/api/tickets" && req.method === "GET") {
    const ticketTypes = db.all("ticketTypes").map(serializeTicketType);
    return sendJson(res, 200, { ticketTypes });
  }

  // GET /api/payment-info - the bank details buyers transfer to, shown
  // on the checkout page. Sourced from env vars so an admin can change
  // them via Render's dashboard without a code change.
  if (pathname === "/api/payment-info" && req.method === "GET") {
    return sendJson(res, 200, {
      bankName: process.env.BANK_NAME || "",
      accountName: process.env.BANK_ACCOUNT_NAME || "",
      accountNumber: process.env.BANK_ACCOUNT_NUMBER || "",
    });
  }

  // POST /api/orders - create a pending order
  if (pathname === "/api/orders" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const { order, customer } = services.createOrder(body);
      return sendJson(res, 201, { order, customer });
    } catch (err) {
      return sendJson(res, err.status || 500, { error: err.message });
    }
  }

  // POST /api/orders/:id/receipt - upload a payment receipt screenshot
  const receiptMatch = pathname.match(/^\/api\/orders\/([^/]+)\/receipt$/);
  if (receiptMatch && req.method === "POST") {
    try {
      const body = await readJsonBody(req, { maxSize: 9 * 1024 * 1024 });
      const order = services.submitReceipt(receiptMatch[1], body.receiptImage);
      return sendJson(res, 200, { order: { id: order.id, orderNumber: order.orderNumber, status: order.status } });
    } catch (err) {
      return sendJson(res, err.status || 500, { error: err.message });
    }
  }

  // GET /api/orders/:id/status
  const orderStatusMatch = pathname.match(/^\/api\/orders\/([^/]+)\/status$/);
  if (orderStatusMatch && req.method === "GET") {
    try {
      const order = services.getOrderStatus(orderStatusMatch[1]);
      const tickets = db.find("tickets", (t) => t.orderId === order.id).map((t) => t.ticketNumber);
      return sendJson(res, 200, { status: order.status, declineReason: order.declineReason || null, tickets });
    } catch (err) {
      return sendJson(res, err.status || 500, { error: err.message });
    }
  }

  // GET /api/ticket/:ticketNumber
  const ticketMatch = pathname.match(/^\/api\/ticket\/([^/]+)$/);
  if (ticketMatch && req.method === "GET") {
    const result = services.getTicketByNumber(decodeURIComponent(ticketMatch[1]));
    if (!result) return sendJson(res, 404, { error: "Ticket not found" });
    const { ticket, order, ticketType, event, customer } = result;
    return sendJson(res, 200, {
      ticket: {
        ticketNumber: ticket.ticketNumber,
        status: ticket.status,
      },
      ticketTypeName: ticketType.name,
      customerName: customer.fullName,
      event: {
        name: event.name,
        date: event.date,
        time: event.time,
        venue: event.venue,
        address: event.address,
        bannerUrl: event.bannerUrl,
      },
      priceLabel: `${koboToNaira(ticketType.price).toLocaleString("en-NG")}`,
    });
  }

  // ---------- Distributor portal API ----------

  // POST /api/distributor/login
  if (pathname === "/api/distributor/login" && req.method === "POST") {
    const body = await readJsonBody(req);
    const distributor = distributorService.verifyDistributorLogin(body.username, body.password);
    if (!distributor) {
      return sendJson(res, 401, { error: "Invalid username or password" });
    }
    const token = createDistributorSession(distributor.id);
    return sendJson(res, 200, {
      token,
      distributor: {
        id: distributor.id,
        name: distributor.name,
        username: distributor.portalUsername,
        status: distributor.status,
      },
    });
  }

  // POST /api/distributor/logout
  if (pathname === "/api/distributor/logout" && req.method === "POST") {
    const token = getBearerToken(req);
    destroySession(token);
    return sendJson(res, 200, { ok: true });
  }

  // GET /api/distributor/me
  if (pathname === "/api/distributor/me" && req.method === "GET") {
    try {
      const d = requireDistributor(req);
      return sendJson(res, 200, {
        distributor: {
          id: d.id,
          name: d.name,
          email: d.email,
          referralCode: d.referralCode,
          status: d.status,
          commissionRate: d.commissionRate,
        },
      });
    } catch (err) {
      return sendJson(res, err.status || 401, { error: err.message });
    }
  }

  // GET /api/distributor/stats
  if (pathname === "/api/distributor/stats" && req.method === "GET") {
    try {
      const d = requireDistributor(req);
      const stats = distributorService.getDistributorStats(d.id);
      return sendJson(res, 200, { stats });
    } catch (err) {
      return sendJson(res, err.status || 500, { error: err.message });
    }
  }

  // POST /api/distributor/change-password
  if (pathname === "/api/distributor/change-password" && req.method === "POST") {
    try {
      const d = requireDistributor(req);
      const body = await readJsonBody(req);
      if (!verifyPassword(body.currentPassword || "", d.passwordHash)) {
        return sendJson(res, 401, { error: "Current password is incorrect" });
      }
      if (!body.newPassword || body.newPassword.length < 8) {
        return sendJson(res, 400, { error: "New password must be at least 8 characters" });
      }
      db.update("distributors", d.id, { passwordHash: hashPassword(body.newPassword) });
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      return sendJson(res, err.status || 500, { error: err.message });
    }
  }

  return null; // not a public API route
}

module.exports = { handlePublicApi };