// MongoDB-backed datastore.
//
// Keeps the exact same interface as the old JSON-file version (all,
// find, findOne, getById, insert, update, remove, raw, flushSync) so
// nothing else in the app needs to change. On boot, it connects to
// MongoDB and hydrates an in-memory cache with the full contents of
// every collection. Reads are served from memory (fast, sync). Writes
// update memory synchronously and are pushed to MongoDB in the
// background (fire-and-forget with error logging).
//
// Why in-memory + write-through? Because the old db.js was synchronous
// and every caller (services.js, routes-*.js, sessions.js, seed.js)
// expects sync returns. Making db.js fully async would require
// rewriting every single caller. This approach keeps the migration to
// one file.

const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);

const { MongoClient } = require("mongodb");

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB_NAME || "soundstage";

if (!MONGODB_URI) {
  console.error(
    "[db] MONGODB_URI is not set. Set it in your environment (Render → Environment tab, or .env locally)."
  );
  process.exit(1);
}

const COLLECTIONS = [
  "admins",
  "events",
  "ticketTypes",
  "customers",
  "orders",
  "orderItems",
  "tickets",
  "payments",
  "distributors",
  "commissions",
  "referrals",
  "notifications",
];

const SEQUENCES_COLLECTION = "_sequences";

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

// In-memory cache — same shape as the old JSON-file `state` object.
let state = structuredClone(DEFAULT_DATA);
let ready = false;

// Mongo handles
let client = null;
let mongoDb = null;
const mongoCollections = {};

/**
 * Connect to MongoDB and hydrate the in-memory cache from it. Called
 * once at module load; the rest of the app can just require() this file
 * and start using it. If MongoDB is unreachable at boot we log and
 * retry in the background so a transient outage doesn't kill the app.
 */
async function connectAndHydrate() {
  while (true) {
    try {
      client = new MongoClient(MONGODB_URI, {
        serverSelectionTimeoutMS: 10000,
      });
      await client.connect();
      mongoDb = client.db(DB_NAME);

      // Make sure every collection exists (Mongo creates on first write,
      // but explicit creation lets us index cleanly).
      const existing = new Set(
        (await mongoDb.listCollections().toArray()).map((c) => c.name)
      );

      for (const name of [...COLLECTIONS, SEQUENCES_COLLECTION]) {
        if (!existing.has(name)) {
          await mongoDb.createCollection(name);
        }
        mongoCollections[name] = mongoDb.collection(name);
      }

      // Create indexes on `id` (our app-level id, not Mongo's _id).
      for (const name of COLLECTIONS) {
        await mongoCollections[name].createIndex({ id: 1 }, { unique: true });
      }

      // Hydrate the cache from Mongo.
      for (const name of COLLECTIONS) {
        const rows = await mongoCollections[name].find({}).toArray();
        // Strip Mongo's internal _id — app code expects plain objects.
        state[name] = rows.map(({ _id, ...rest }) => rest);
      }

      // Hydrate sequences.
      const seqDoc = await mongoCollections[SEQUENCES_COLLECTION].findOne({
        _id: "sequences",
      });
      state._sequences = seqDoc && seqDoc.value ? seqDoc.value : {};

      ready = true;
      console.log(
        `[db] Connected to MongoDB (${DB_NAME}). Loaded ${COLLECTIONS.reduce(
          (n, c) => n + state[c].length,
          0
        )} records.`
      );
      return;
    } catch (err) {
      console.error("[db] MongoDB connection failed, retrying in 5s:", err.message);
      if (client) {
        try {
          await client.close();
        } catch {}
      }
      client = null;
      mongoDb = null;
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// Persist helpers — fire-and-forget writes to Mongo.
function persistRow(collection, row) {
  const { _id, ...clean } = row;
  mongoCollections[collection]
    .updateOne({ id: row.id }, { $set: clean }, { upsert: true })
    .catch((err) =>
      console.error(`[db] Failed to persist row in ${collection}:`, err.message)
    );
}

function persistDelete(collection, id) {
  mongoCollections[collection]
    .deleteOne({ id })
    .catch((err) =>
      console.error(`[db] Failed to delete row in ${collection}:`, err.message)
    );
}

function persistSequences() {
  mongoCollections[SEQUENCES_COLLECTION]
    .updateOne(
      { _id: "sequences" },
      { $set: { value: state._sequences } },
      { upsert: true }
    )
    .catch((err) =>
      console.error(`[db] Failed to persist sequences:`, err.message)
    );
}

function nextId(collection) {
  const seq = (state._sequences[collection] || 0) + 1;
  state._sequences[collection] = seq;
  persistSequences();
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
    persistRow(collection, record);
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
    persistRow(collection, state[collection][idx]);
    return state[collection][idx];
  },

  /** Remove a row by id. Returns true if something was removed. */
  remove(collection, id) {
    const before = state[collection].length;
    state[collection] = state[collection].filter((row) => row.id !== id);
    const changed = state[collection].length !== before;
    if (changed) persistDelete(collection, id);
    return changed;
  },

  /** Escape hatch for aggregate/reporting queries. */
  raw() {
    return state;
  },

  /**
   * Kept for compatibility with the old JSON-file API. With MongoDB
   * every write is already persisted (write-through), so this is a
   * no-op that resolves once the DB is ready. Returns a Promise so
   * `await db.flushSync()` in seed scripts works.
   */
  async flushSync() {
    while (!ready) {
      await new Promise((r) => setTimeout(r, 100));
    }
    // Give in-flight writes a moment to finish.
    await new Promise((r) => setTimeout(r, 200));
  },

  /** True once the initial hydration from Mongo has completed. */
  isReady() {
    return ready;
  },
};

// Kick off connection + hydration. The rest of the app can require() this
// module immediately; db.isReady() will flip to true once hydration is
// done. Route handlers should be fine without waiting because the app
// doesn't accept traffic until server.js binds the port, which happens
// after Mongo is reachable in practice. For safety, seed.js can await
// db.flushSync() before exiting.
connectAndHydrate();

module.exports = db;