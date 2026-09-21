const db = require("./db");
const services = require("./services");
const { sendJson, readJsonBody } = require("./http-utils");
const { koboToNaira } = require("./money");

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
  // for a pending order. Moves the order into the admin's review queue.
  const receiptMatch = pathname.match(/^\/api\/orders\/([^/]+)\/receipt$/);
  if (receiptMatch && req.method === "POST") {
    try {
      // 9MB cap here (vs the 1MB default) to fit a base64-encoded photo;
      // services.submitReceipt applies its own tighter effective limit
      // and validates it's actually an image before accepting it.
      const body = await readJsonBody(req, { maxSize: 9 * 1024 * 1024 });
      const order = services.submitReceipt(receiptMatch[1], body.receiptImage);
      return sendJson(res, 200, { order: { id: order.id, orderNumber: order.orderNumber, status: order.status } });
    } catch (err) {
      return sendJson(res, err.status || 500, { error: err.message });
    }
  }

  // GET /api/orders/:id/status - poll an order's review status (used by
  // the "awaiting review" page after a receipt is uploaded)
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

  // GET /api/ticket/:ticketNumber - ticket detail for the ticket display page
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

  return null; // not a public API route
}

module.exports = { handlePublicApi };
