const db = require("./db");
const { verifyPassword, hashPassword, randomToken } = require("./auth");
const { createSession, getSession, destroySession } = require("./sessions");
const { sendJson, readJsonBody } = require("./http-utils");
const { nairaToKobo } = require("./money");
const { httpError, resendTicketEmail, approveOrder, declineOrder, issueBulkOrder } = require("./services");

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1] : null;
}

function requireAdmin(req) {
  const token = getBearerToken(req);
  const session = getSession(token);
  if (!session) throw httpError(401, "Not authenticated");
  const admin = db.getById("admins", session.adminId);
  if (!admin) throw httpError(401, "Not authenticated");
  return admin;
}

function enrichOrder(order) {
  const customer = db.getById("customers", order.customerId);
  const distributor = order.distributorId ? db.getById("distributors", order.distributorId) : null;
  const items = db
    .find("orderItems", (i) => i.orderId === order.id)
    .map((i) => ({ ...i, ticketType: db.getById("ticketTypes", i.ticketTypeId) }));
  const tickets = db.find("tickets", (t) => t.orderId === order.id);
  const notifications = db.find("notifications", (n) => n.orderId === order.id);
  return { ...order, customer, distributor, orderItems: items, tickets, notifications };
}

async function handleAdminApi(req, url, res) {
  const { pathname } = url;

  // ---------- Auth (no session required) ----------
  if (pathname === "/api/admin/login" && req.method === "POST") {
    const body = await readJsonBody(req);
    const admin = db.findOne(
      "admins",
      (a) => a.username === body.username || a.email === body.username
    );
    // Always run the (expensive) password hash comparison, even when no
    // matching account exists, using a dummy hash of the same shape.
    // Otherwise a request for a nonexistent username returns measurably
    // faster than one for a real username with a wrong password - a
    // timing side-channel an attacker could use to enumerate valid
    // usernames before attempting to guess passwords for a known-real one.
    const DUMMY_HASH = "0".repeat(32) + ":" + "0".repeat(128);
    const passwordOk = verifyPassword(body.password || "", admin ? admin.passwordHash : DUMMY_HASH);
    if (!admin || !passwordOk) {
      return sendJson(res, 401, { error: "Invalid username or password" });
    }
    const token = createSession(admin.id);
    // Returned in the body (not a cookie) so a separately-hosted admin
    // frontend on a different origin/domain can store and send it itself
    // via an Authorization header - cross-site cookies would require
    // SameSite=None and break on plain http:// during local development.
    return sendJson(res, 200, {
      token,
      admin: { id: admin.id, name: admin.name, username: admin.username },
    });
  }

  if (pathname === "/api/admin/logout" && req.method === "POST") {
    const token = getBearerToken(req);
    destroySession(token);
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === "/api/admin/me" && req.method === "GET") {
    try {
      const admin = requireAdmin(req);
      return sendJson(res, 200, { admin: { id: admin.id, name: admin.name, username: admin.username } });
    } catch (err) {
      return sendJson(res, err.status || 500, { error: err.message });
    }
  }

  // Everything past this point requires a valid session.
  let admin;
  try {
    admin = requireAdmin(req);
  } catch (err) {
    return sendJson(res, err.status || 401, { error: err.message });
  }

  // ---------- Dashboard ----------
  if (pathname === "/api/admin/dashboard" && req.method === "GET") {
    const orders = db.all("orders");
    const paidOrders = orders.filter((o) => o.status === "PAID");
    const ticketTypes = db.all("ticketTypes");
    const customers = db.all("customers");
    const distributors = db.all("distributors");
    const commissions = db.all("commissions");

    const ticketsSold = ticketTypes.reduce((s, t) => s + t.soldQuantity, 0);
    const ticketsRemaining = ticketTypes.reduce((s, t) => s + Math.max(t.quantity - t.soldQuantity, 0), 0);
    const distributorOrders = paidOrders.filter((o) => o.distributorId);

    return sendJson(res, 200, {
      totalRevenue: paidOrders.reduce((s, o) => s + o.total, 0),
      ticketsSold,
      ticketsRemaining,
      pendingReview: orders.filter((o) => o.status === "PENDING_REVIEW").length,
      successfulPayments: paidOrders.length,
      declinedPayments: orders.filter((o) => o.status === "DECLINED").length,
      customerCount: customers.length,
      distributorCount: distributors.length,
      distributorSales: distributorOrders.reduce((s, o) => s + o.total, 0),
      totalCommissions: commissions.reduce((s, c) => s + c.amount, 0),
      ticketTypes,
      recentOrders: orders
        .slice()
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 10)
        .map(enrichOrder),
    });
  }

  // ---------- Orders ----------
  if (pathname === "/api/admin/orders" && req.method === "GET") {
    const status = url.searchParams.get("status");
    const q = (url.searchParams.get("q") || "").toLowerCase();
    let orders = db.all("orders");
    if (status) orders = orders.filter((o) => o.status === status);
    orders = orders.map(enrichOrder);
    if (q) {
      orders = orders.filter(
        (o) =>
          o.orderNumber.toLowerCase().includes(q) ||
          o.customer.fullName.toLowerCase().includes(q) ||
          o.customer.email.toLowerCase().includes(q)
      );
    }
    orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return sendJson(res, 200, { orders });
  }

  const orderMatch = pathname.match(/^\/api\/admin\/orders\/([^/]+)$/);
  if (orderMatch && req.method === "GET") {
    const order = db.getById("orders", orderMatch[1]);
    if (!order) return sendJson(res, 404, { error: "Order not found" });
    return sendJson(res, 200, { order: enrichOrder(order) });
  }

  if (orderMatch && req.method === "PATCH") {
    const order = db.getById("orders", orderMatch[1]);
    if (!order) return sendJson(res, 404, { error: "Order not found" });
    const body = await readJsonBody(req);
    const updated = db.update("orders", order.id, { status: body.status });
    return sendJson(res, 200, { order: enrichOrder(updated) });
  }

  // POST /api/admin/orders/:id/approve - confirm the receipt is valid.
  // Issues tickets, records commission, and emails the tickets - see
  // services.approveOrder for the full flow.
  const approveMatch = pathname.match(/^\/api\/admin\/orders\/([^/]+)\/approve$/);
  if (approveMatch && req.method === "POST") {
    try {
      const result = await approveOrder(approveMatch[1]);
      return sendJson(res, 200, { order: enrichOrder(result.order) });
    } catch (err) {
      return sendJson(res, err.status || 500, { error: err.message });
    }
  }

  // POST /api/admin/orders/:id/decline - reject the receipt (payment not
  // received, wrong amount, unreadable screenshot, etc).
  const declineMatch = pathname.match(/^\/api\/admin\/orders\/([^/]+)\/decline$/);
  if (declineMatch && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const order = declineOrder(declineMatch[1], body.reason);
      return sendJson(res, 200, { order: enrichOrder(order) });
    } catch (err) {
      return sendJson(res, err.status || 500, { error: err.message });
    }
  }

  const resendMatch = pathname.match(/^\/api\/admin\/orders\/([^/]+)\/resend$/);
  if (resendMatch && req.method === "POST") {
    const order = db.getById("orders", resendMatch[1]);
    if (!order) return sendJson(res, 404, { error: "Order not found" });
    try {
      await resendTicketEmail(order.id);
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      return sendJson(res, err.status || 500, { error: err.message });
    }
  }

  // ---------- Customers ----------
  if (pathname === "/api/admin/customers" && req.method === "GET") {
    const q = (url.searchParams.get("q") || "").toLowerCase();
    let customers = db.all("customers");
    if (q) {
      customers = customers.filter(
        (c) =>
          c.fullName.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          c.phone.toLowerCase().includes(q)
      );
    }
    const enriched = customers.map((c) => {
      const orders = db.find("orders", (o) => o.customerId === c.id && o.status === "PAID");
      return {
        ...c,
        ticketsPurchased: orders.length,
        totalSpent: orders.reduce((s, o) => s + o.total, 0),
      };
    });
    enriched.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return sendJson(res, 200, { customers: enriched });
  }

  // ---------- Ticket types ----------
  if (pathname === "/api/admin/ticket-types" && req.method === "POST") {
    const body = await readJsonBody(req);
    if (!body.eventId || !body.name || body.priceNaira == null || !body.quantity) {
      return sendJson(res, 400, { error: "eventId, name, priceNaira, and quantity are required" });
    }
    const ticketType = db.insert("ticketTypes", {
      eventId: body.eventId,
      name: body.name,
      description: body.description || "",
      price: nairaToKobo(body.priceNaira),
      quantity: Number(body.quantity),
      soldQuantity: 0,
      status: "AVAILABLE",
    });
    return sendJson(res, 201, { ticketType });
  }

  const ttMatch = pathname.match(/^\/api\/admin\/ticket-types\/([^/]+)$/);
  if (ttMatch && req.method === "PATCH") {
    const ticketType = db.getById("ticketTypes", ttMatch[1]);
    if (!ticketType) return sendJson(res, 404, { error: "Ticket type not found" });
    const body = await readJsonBody(req);
    const patch = {};
    if (body.priceNaira != null) patch.price = nairaToKobo(body.priceNaira);
    if (body.quantity != null) {
      if (Number(body.quantity) < ticketType.soldQuantity) {
        return sendJson(res, 400, { error: "Quantity cannot be less than tickets already sold" });
      }
      patch.quantity = Number(body.quantity);
    }
    if (body.status) patch.status = body.status;
    const updated = db.update("ticketTypes", ticketType.id, patch);
    return sendJson(res, 200, { ticketType: updated });
  }

  // ---------- Distributors ----------
  if (pathname === "/api/admin/distributors" && req.method === "GET") {
    const distributors = db.all("distributors").map((d) => {
      const referrals = db.find("referrals", (r) => r.distributorId === d.id);
      const orders = db.find("orders", (o) => o.distributorId === d.id && o.status === "PAID");
      const commissions = db.find("commissions", (c) => c.distributorId === d.id);
      return {
        ...d,
        clicks: referrals.length,
        customers: new Set(orders.map((o) => o.customerId)).size,
        ticketsSold: orders.length,
        revenue: orders.reduce((s, o) => s + o.total, 0),
        commissionTotal: commissions.reduce((s, c) => s + c.amount, 0),
      };
    });
    distributors.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return sendJson(res, 200, { distributors });
  }

  if (pathname === "/api/admin/distributors" && req.method === "POST") {
    const body = await readJsonBody(req);
    if (!body.name || !body.email || !body.phone) {
      return sendJson(res, 400, { error: "name, email, and phone are required" });
    }
    const referralCode = (body.name.replace(/[^a-zA-Z]/g, "").slice(0, 6) + randomToken(2)).toUpperCase();
    const distributor = db.insert("distributors", {
      name: body.name,
      email: body.email,
      phone: body.phone,
      referralCode,
      commissionRate: body.commissionRate != null ? Number(body.commissionRate) : 0.1,
      status: "PENDING",
    });
    return sendJson(res, 201, { distributor });
  }

  const distMatch = pathname.match(/^\/api\/admin\/distributors\/([^/]+)$/);
  if (distMatch && req.method === "PATCH") {
    const distributor = db.getById("distributors", distMatch[1]);
    if (!distributor) return sendJson(res, 404, { error: "Distributor not found" });
    const body = await readJsonBody(req);
    const updated = db.update("distributors", distributor.id, { status: body.status });
    return sendJson(res, 200, { distributor: updated });
  }

  // POST /api/admin/distributors/:id/bulk-issue - record a bulk ticket
  // purchase a distributor paid for outside the normal checkout (e.g.
  // handed the admin cash/transfer for 5 tickets to resell themselves).
  // Issues real tickets immediately - no receipt upload or review step,
  // since the admin is recording a transaction that already happened.
  const bulkIssueMatch = pathname.match(/^\/api\/admin\/distributors\/([^/]+)\/bulk-issue$/);
  if (bulkIssueMatch && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const result = issueBulkOrder({
        distributorId: bulkIssueMatch[1],
        ticketTypeId: body.ticketTypeId,
        quantity: Number(body.quantity),
      });
      return sendJson(res, 201, {
        order: result.order,
        tickets: result.tickets.map((t) => t.ticketNumber),
        ticketType: result.ticketType.name,
      });
    } catch (err) {
      return sendJson(res, err.status || 500, { error: err.message });
    }
  }

  // ---------- Commissions ----------
  if (pathname === "/api/admin/commissions" && req.method === "GET") {
    const commissions = db.all("commissions").map((c) => ({
      ...c,
      distributor: db.getById("distributors", c.distributorId),
      order: db.getById("orders", c.orderId),
    }));
    commissions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return sendJson(res, 200, { commissions });
  }

  const commMatch = pathname.match(/^\/api\/admin\/commissions\/([^/]+)$/);
  if (commMatch && req.method === "PATCH") {
    const commission = db.getById("commissions", commMatch[1]);
    if (!commission) return sendJson(res, 404, { error: "Commission not found" });
    const body = await readJsonBody(req);
    const patch = { status: body.status };
    if (body.status === "PAID") patch.paidAt = new Date().toISOString();
    const updated = db.update("commissions", commission.id, patch);
    return sendJson(res, 200, { commission: updated });
  }

  // ---------- Admin account ----------
  if (pathname === "/api/admin/change-password" && req.method === "POST") {
    const body = await readJsonBody(req);
    if (!verifyPassword(body.currentPassword || "", admin.passwordHash)) {
      return sendJson(res, 401, { error: "Current password is incorrect" });
    }
    if (!body.newPassword || body.newPassword.length < 8) {
      return sendJson(res, 400, { error: "New password must be at least 8 characters" });
    }
    db.update("admins", admin.id, { passwordHash: hashPassword(body.newPassword) });
    return sendJson(res, 200, { ok: true });
  }

    // ---------- Distributor portal logins ----------
  // POST /api/admin/distributors/:id/set-login - create or reset a
  // distributor's login credentials for the distributor portal.
  const setLoginMatch = pathname.match(/^\/api\/admin\/distributors\/([^/]+)\/set-login$/);
  if (setLoginMatch && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const distributorService = require("./distributor-service");
      const updated = distributorService.setDistributorLogin(
        setLoginMatch[1],
        body.username,
        body.password
      );
      return sendJson(res, 200, {
        distributor: {
          id: updated.id,
          name: updated.name,
          portalUsername: updated.portalUsername,
        },
      });
    } catch (err) {
      return sendJson(res, err.status || 500, { error: err.message });
    }
  }

  // ---------- Notifications feed (for the admin bell) ----------
  // GET /api/admin/notifications - recent forward events, newest first.
  if (pathname === "/api/admin/notifications" && req.method === "GET") {
    const forwards = db
      .all("forwards")
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 50)
      .map((f) => {
        const distributor = db.getById("distributors", f.distributorId);
        return {
          id: f.id,
          type: "FORWARD",
          distributorName: distributor ? distributor.name : "Unknown",
          referralCode: f.referralCode,
          at: f.createdAt,
        };
      });
    return sendJson(res, 200, { notifications: forwards });
  }

  return null; // not an admin API route
}

module.exports = { handleAdminApi };
