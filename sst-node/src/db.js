// Lightweight, dependency-free JSON-file datastore.
// Stores everything in one file at data/db.json, loaded into memory on
// boot and flushed to disk after every write. Good enough for a single
// small server process; not meant for concurrent multi-process access.

const fs = require("fs");
const path = require("path");

// On most platforms this just lives alongside the app. On a host with an
// ephemeral filesystem (e.g. Render's default web service disk), set
// DATA_DIR to a mounted persistent disk path so data survives restarts
// and deploys - e.g. DATA_DIR=/var/data.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "db.json");

const DEFAULT_DATA = {
  admins: [],
  events: [],
  ticketTypes: [],
  customers: [],
  orders: [],
  orderItems: [],
  tickets: [],
  payments: [],
  distributors: [],
  commissions: [],
  referrals: [],
  notifications: [],
  _sequences: {},
};

function loadFromDisk() {
  if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(DEFAULT_DATA, null, 2));
    return structuredClone(DEFAULT_DATA);
  }
  const raw = fs.readFileSync(DB_PATH, "utf8");
  const parsed = JSON.parse(raw);
  // Ensure any collections added since the file was created still exist.
  return { ...structuredClone(DEFAULT_DATA), ...parsed };
}

let state = loadFromDisk();
let writeQueued = false;

function persist() {
  if (writeQueued) return;
  writeQueued = true;
  setImmediate(() => {
    fs.writeFileSync(DB_PATH, JSON.stringify(state, null, 2));
    writeQueued = false;
  });
}

function nextId(collection) {
  const seq = (state._sequences[collection] || 0) + 1;
  state._sequences[collection] = seq;
  return `${collection.slice(0, 3)}_${seq.toString().padStart(6, "0")}`;
}

const db = {
  /** Return a shallow copy of every row in a collection. */
  all(collection) {
    return [...state[collection]];
  },

  /** Find rows matching a predicate. */
  find(collection, predicate) {
    return state[collection].filter(predicate);
  },

  /** Find the first row matching a predicate, or undefined. */
  findOne(collection, predicate) {
    return state[collection].find(predicate);
  },

  /** Find a row by its id field. */
  getById(collection, id) {
    return state[collection].find((row) => row.id === id);
  },

  /** Insert a new row, auto-assigning an id and createdAt if absent. */
  insert(collection, row) {
    const record = {
      id: row.id || nextId(collection),
      createdAt: row.createdAt || new Date().toISOString(),
      ...row,
    };
    record.id = row.id || record.id;
    state[collection].push(record);
    persist();
    return record;
  },

  /** Merge `patch` into the row with the given id. Returns the updated row. */
  update(collection, id, patch) {
    const idx = state[collection].findIndex((row) => row.id === id);
    if (idx === -1) return null;
    state[collection][idx] = {
      ...state[collection][idx],
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    persist();
    return state[collection][idx];
  },

  /** Remove a row by id. Returns true if something was removed. */
  remove(collection, id) {
    const before = state[collection].length;
    state[collection] = state[collection].filter((row) => row.id !== id);
    const changed = state[collection].length !== before;
    if (changed) persist();
    return changed;
  },

  /** Escape hatch for aggregate/reporting queries. */
  raw() {
    return state;
  },

  /** Force a synchronous write (used by seed scripts before exit). */
  flushSync() {
    fs.writeFileSync(DB_PATH, JSON.stringify(state, null, 2));
  },
};

module.exports = db;
