const db = require("./db");
const { hashPassword, verifyPassword, randomToken } = require("./auth");

// Max forwards deduped per (distributorId, ip) within the window.
const FORWARD_DEDUPE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Record a "forward" - a click on a distributor's referral link.
 * Deduped by (distributorId, ip) within a 1-hour window so refreshes
 * don't inflate the count. Only counts if the distributor is ACTIVE.
 * Returns true if recorded, false if deduped or invalid.
 */
function recordForward(code, ip) {
  if (!code || typeof code !== "string") return false;
  const distributor = db.findOne("distributors", (d) => d.referralCode === code);
  if (!distributor) return false;
  if (distributor.status !== "ACTIVE") return false;

  const now = Date.now();
  const recent = db.findOne(
    "forwards",
    (f) =>
      f.distributorId === distributor.id &&
      f.ip === ip &&
      now - new Date(f.createdAt).getTime() < FORWARD_DEDUPE_WINDOW_MS
  );
  if (recent) return false;

  db.insert("forwards", {
    distributorId: distributor.id,
    referralCode: code,
    ip: ip || "unknown",
  });
  return true;
}

/**
 * Look up a distributor by username (used at login).
 */
function findDistributorByUsername(username) {
  if (!username || typeof username !== "string") return null;
  return db.findOne(
    "distributors",
    (d) => d.portalUsername && d.portalUsername.toLowerCase() === username.toLowerCase()
  );
}

/**
 * Verify login credentials. Returns the distributor record or null.
 */
function verifyDistributorLogin(username, password) {
  const distributor = findDistributorByUsername(username);
  if (!distributor || !distributor.passwordHash) return null;
  if (!verifyPassword(password || "", distributor.passwordHash)) return null;
  return distributor;
}

/**
 * Admin action: set (or reset) a distributor's portal login credentials.
 */
function setDistributorLogin(distributorId, username, password) {
  const distributor = db.getById("distributors", distributorId);
  if (!distributor) throw httpError(404, "Distributor not found");
  if (!username || typeof username !== "string" || username.trim().length < 3) {
    throw httpError(400, "Username must be at least 3 characters");
  }
  if (!password || typeof password !== "string" || password.length < 8) {
    throw httpError(400, "Password must be at least 8 characters");
  }
  // Prevent duplicate usernames across distributors.
  const existing = db.findOne(
    "distributors",
    (d) =>
      d.id !== distributor.id &&
      d.portalUsername &&
      d.portalUsername.toLowerCase() === username.trim().toLowerCase()
  );
  if (existing) throw httpError(400, "That username is already taken");

  const updated = db.update("distributors", distributor.id, {
    portalUsername: username.trim(),
    passwordHash: hashPassword(password),
    portalLoginSetAt: new Date().toISOString(),
  });
  return updated;
}

/**
 * Aggregate stats for a single distributor's dashboard.
 */
function getDistributorStats(distributorId) {
  const distributor = db.getById("distributors", distributorId);
  if (!distributor) throw httpError(404, "Distributor not found");

  const forwards = db.find("forwards", (f) => f.distributorId === distributorId);
  const orders = db.find("orders", (o) => o.distributorId === distributorId && o.status === "PAID");
  const commissions = db.find("commissions", (c) => c.distributorId === distributorId);

  const revenue = orders.reduce((s, o) => s + o.total, 0);
  const commissionTotal = commissions.reduce((s, c) => s + c.amount, 0);
  const commissionPending = commissions
    .filter((c) => c.status === "PENDING" || c.status === "APPROVED")
    .reduce((s, c) => s + c.amount, 0);
  const commissionPaid = commissions
    .filter((c) => c.status === "PAID")
    .reduce((s, c) => s + c.amount, 0);

  return {
    forwards: forwards.length,
    ticketsSold: orders.length,
    revenue,
    commissionTotal,
    commissionPending,
    commissionPaid,
  };
}

module.exports = {
  recordForward,
  findDistributorByUsername,
  verifyDistributorLogin,
  setDistributorLogin,
  getDistributorStats,
  httpError,
};