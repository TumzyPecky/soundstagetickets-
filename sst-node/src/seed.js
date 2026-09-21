const db = require("./db");
const { hashPassword } = require("./auth");
const { nairaToKobo } = require("./money");

function seed() {
  if (db.all("events").length === 0) {
    const event = db.insert("events", {
      name: "Soundstage Live Concert",
      description:
        "One Stage. Premium Music.\nExclusive studio-live performances, brought to the stage.\nGet your ticket. Experience it live..",
      date: "2026-10-24",
      time: "7:00 PM Prompt",
      venue: "Hybrid Heights",
      address: "Opposite UI International Conference Centre, UI Road, Ibadan",
      bannerUrl: "/assets/logo.jpg",
      status: "PUBLISHED",
    });

    const ticketTypes = [
      { name: "Flat", description: "General access", price: nairaToKobo(2000), quantity: 240 },
      { name: "VIP", description: "Reserved seating, dedicated bar, and priority entry", price: nairaToKobo(50000), quantity: 10 },
    ];

    for (const tt of ticketTypes) {
      db.insert("ticketTypes", {
        eventId: event.id,
        ...tt,
        soldQuantity: 0,
        status: "AVAILABLE",
      });
    }

    console.log(`Seeded event "${event.name}" with ${ticketTypes.length} ticket types.`);
  }

  if (db.all("admins").length === 0) {
    const username = process.env.ADMIN_USERNAME || "admin";
    const email = process.env.ADMIN_EMAIL || "admin@soundstagetickets.com";
    const password = process.env.ADMIN_PASSWORD || "ChangeMe123!";

    db.insert("admins", {
      email,
      username,
      passwordHash: hashPassword(password),
      name: "Site Admin",
    });

    if (!process.env.ADMIN_PASSWORD) {
      console.log(
        `Seeded default admin -> username: ${username} | password: ${password}\n` +
          "WARNING: this is the built-in default password. Set ADMIN_PASSWORD " +
          "(and optionally ADMIN_USERNAME / ADMIN_EMAIL) as environment variables " +
          "before deploying anywhere public, then delete data/db.json once so it " +
          "reseeds with your chosen credentials."
      );
    } else {
      console.log(`Seeded admin account -> username: ${username}`);
    }
  }

  db.flushSync();
}

module.exports = { seed };

if (require.main === module) {
  seed();
}
