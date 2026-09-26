const { randomToken } = require("./auth");

// token -> { adminId?, distributorId?, expiresAt }
// A session belongs to exactly one of adminId or distributorId.
const sessions = new Map();

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function createSession(adminId) {
  const token = randomToken(24);
  sessions.set(token, { adminId, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

function createDistributorSession(distributorId) {
  const token = randomToken(24);
  sessions.set(token, { distributorId, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

function getSession(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function destroySession(token) {
  sessions.delete(token);
}

module.exports = { createSession, createDistributorSession, getSession, destroySession };