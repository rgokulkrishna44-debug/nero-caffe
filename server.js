const express = require("express");
const path = require("path");
const https = require("https");
const CFG = require("./config");
const { db, tx, getSetting, setSetting } = require("./db");
const B = require("./booking");
const auth = require("./auth");

const app = express();
const PORT = process.env.PORT || 3000;

app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(express.json({ limit: "50kb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(express.static(path.join(__dirname, "public")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin", "index.html")));

// ---------- helpers ----------

// Fire-and-forget: hand an event to n8n without blocking or failing the request if it is down.
// Set NERO_NOTIFY=off to run tests or demos without messaging anyone.
function notifyN8n(url, payload) {
  if (process.env.NERO_NOTIFY === "off") return;
  try {
    const body = JSON.stringify(payload);
    const req = https.request(
      url,
      { method: "POST", timeout: 8000, headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
      (res) => res.resume()
    );
    req.on("error", () => {});
    req.on("timeout", () => req.destroy());
    req.write(body);
    req.end();
  } catch {}
}

function makeRef(prefix) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no look-alike characters
  let s = "";
  for (let i = 0; i < 5; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return prefix + "-" + s;
}

// Returns "+91XXXXXXXXXX" for a valid Indian mobile number, otherwise "".
function indianMobile(raw) {
  const digits = String(raw || "").replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
  return /^[6-9]\d{9}$/.test(digits) ? "+91" + digits : "";
}

const clean = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
const rowToReservation = (r) => ({
  ref: r.ref, name: r.name, phone: r.phone, date: r.date, time: r.time, guests: r.guests,
  occasion: r.occasion, note: r.note, status: r.status, createdAt: r.created_at,
});

// ---------- public: menu ----------

// Sold-out items stay in the list with available: false, so the site can show them as sold out.
function loadMenu() {
  const cats = db.prepare("SELECT key, label FROM menu_categories ORDER BY sort").all();
  const items = db.prepare("SELECT * FROM menu_items ORDER BY sort, id").all();
  const menu = {};
  cats.forEach((c) => (menu[c.key] = { label: c.label, items: [] }));
  items.forEach((it) => {
    if (!menu[it.category]) return;
    const out = { id: it.id, name: it.name, price: it.price };
    if (it.note) out.note = it.note;
    if (it.veg !== null) out.veg = !!it.veg;
    out.available = !!it.available;
    menu[it.category].items.push(out);
  });
  return menu;
}

app.get("/api/menu", (req, res) => res.json(loadMenu()));

// ---------- public: bookings ----------

app.get("/api/availability", (req, res) => {
  const date = String(req.query.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "Pass ?date=YYYY-MM-DD." });
  const now = B.nowLocal();
  const slots = B.availability(date).map((s) => ({
    ...s,
    past: date === now.date && B.toMin(s.time) < now.minutes + 30,
  }));
  res.json({ date, seats: Number(getSetting("seats", CFG.DEFAULT_SEATS)), slots });
});

app.post("/api/reservations", (req, res) => {
  const { name, phone, date, time, guests, occasion, note } = req.body || {};

  if (!name || !phone || !date || !time || !guests) {
    return res.status(400).json({ error: "Name, WhatsApp number, date, time and guests are required." });
  }
  const mobile = indianMobile(phone);
  if (!mobile) return res.status(400).json({ error: "Please enter a valid 10-digit Indian mobile number." });
  const guestCount = Number(guests);
  if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > CFG.MAX_GUESTS) {
    return res.status(400).json({ error: "Online bookings are for 1 to 8 guests. Call us for larger groups." });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || !/^\d{2}:\d{2}$/.test(String(time))) {
    return res.status(400).json({ error: "Please choose a valid date and time." });
  }
  const now = B.nowLocal();
  if (date < now.date) return res.status(400).json({ error: "Please choose a date from today onward." });
  if (B.weekday(date) === 1) return res.status(400).json({ error: "We're closed on Mondays. Please pick another day." });
  if (!B.slotsFor(date).includes(time)) return res.status(400).json({ error: "That time is outside our seating hours." });
  if (date === now.date && B.toMin(time) < now.minutes) {
    return res.status(400).json({ error: "That time has already passed. Please pick a later slot." });
  }

  // Check capacity and insert in one transaction so two guests can't take the last seats together.
  let reservation;
  try {
    reservation = tx(() => {
      if (B.seatsLeft(date, time) < guestCount) {
        const err = new Error("full");
        err.full = true;
        throw err;
      }
      let ref;
      do ref = makeRef("NR");
      while (db.prepare("SELECT 1 FROM reservations WHERE ref = ?").get(ref));
      const r = {
        ref, name: clean(name, 80), phone: mobile, date, time, guests: guestCount,
        occasion: clean(occasion, 40), note: clean(note, 300), status: "confirmed", created_at: new Date().toISOString(),
      };
      db.prepare(
        `INSERT INTO reservations(ref, name, phone, date, time, guests, occasion, note, status, created_at)
         VALUES(@ref, @name, @phone, @date, @time, @guests, @occasion, @note, @status, @created_at)`
      ).run(r);
      return r;
    });
  } catch (err) {
    if (err.full) {
      return res.status(409).json({ error: "That time is fully booked for your party size. Please try another time or day." });
    }
    throw err;
  }

  const out = rowToReservation(reservation);
  notifyN8n(CFG.N8N_RESERVATION_URL, out);
  res.status(201).json({ ok: true, ref: out.ref, reservation: out });
});

// ---------- public: order ahead (pickup) ----------

app.post("/api/orders", (req, res) => {
  const { name, phone, pickup, items, note } = req.body || {};
  const mobile = indianMobile(phone);
  if (!clean(name, 80) || !mobile) return res.status(400).json({ error: "Please add your name and a valid 10-digit Indian mobile number." });
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "Your order is empty." });
  if (!/^\d{2}:\d{2}$/.test(String(pickup || ""))) return res.status(400).json({ error: "Please choose a pickup time." });

  const now = B.nowLocal();
  const hours = CFG.HOURS[B.weekday(now.date)];
  if (!hours) return res.status(400).json({ error: "We're closed today, so we can't take pickup orders." });
  const pickupMin = B.toMin(pickup);
  if (pickupMin < now.minutes + CFG.ORDER_LEAD_MIN) {
    return res.status(400).json({ error: `Pickup needs at least ${CFG.ORDER_LEAD_MIN} minutes. Please choose a later time.` });
  }
  if (pickupMin < hours[0] * 60 || pickupMin > CFG.LAST_SEATING * 60) {
    return res.status(400).json({ error: "Pickup must be within our kitchen hours, until 21:30." });
  }

  let totalQty = 0;
  const lines = [];
  const lookup = db.prepare("SELECT id, name, price, available FROM menu_items WHERE id = ?");
  for (const line of items) {
    const qty = Number(line && line.qty);
    const item = lookup.get(Number(line && line.id));
    if (!item || !Number.isInteger(qty) || qty < 1 || qty > CFG.ORDER_MAX_QTY) {
      return res.status(400).json({ error: "Something in your order is no longer on the menu. Please refresh and try again." });
    }
    if (!item.available) return res.status(409).json({ error: `Sorry, ${item.name} just ran out. Please remove it and try again.` });
    totalQty += qty;
    lines.push({ item_id: item.id, name: item.name, price: item.price, qty });
  }
  if (totalQty > CFG.ORDER_MAX_QTY) return res.status(400).json({ error: `Online orders are limited to ${CFG.ORDER_MAX_QTY} items. Call us for larger orders.` });

  // Prices always come from the database, never from the browser.
  const total = lines.reduce((sum, l) => sum + l.price * l.qty, 0);
  const order = tx(() => {
    let ref;
    do ref = makeRef("NO");
    while (db.prepare("SELECT 1 FROM orders WHERE ref = ?").get(ref));
    const info = db
      .prepare(
        `INSERT INTO orders(ref, name, phone, pickup_date, pickup_time, note, total, status, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, 'new', ?)`
      )
      .run(ref, clean(name, 80), mobile, now.date, pickup, clean(note, 300), total, new Date().toISOString());
    const id = Number(info.lastInsertRowid);
    const ins = db.prepare("INSERT INTO order_items(order_id, item_id, name, price, qty) VALUES(?, ?, ?, ?, ?)");
    lines.forEach((l) => ins.run(id, l.item_id, l.name, l.price, l.qty));
    return { id, ref };
  });

  const payload = { event: "order.created", ref: order.ref, name: clean(name, 80), phone: mobile, pickupDate: now.date, pickup, total, note: clean(note, 300), items: lines.map(({ name, qty, price }) => ({ name, qty, price })) };
  notifyN8n(CFG.N8N_ORDER_URL, payload);
  res.status(201).json({ ok: true, ref: order.ref, total, pickup });
});

// ---------- admin ----------

app.post("/api/admin/login", auth.login);
app.post("/api/admin/logout", auth.logout);
app.get("/api/admin/me", (req, res) => res.json({ ok: auth.validToken(auth.readCookie(req, auth.COOKIE)) }));
app.use("/api/admin", auth.requireAdmin);

const RES_STATUSES = ["confirmed", "seated", "completed", "no_show", "cancelled"];
const ORDER_STATUSES = ["new", "preparing", "ready", "collected", "cancelled"];

// Legacy public listing (it exposed guest phone numbers) now lives behind sign-in.
app.get("/api/reservations", auth.requireAdmin, (req, res) => {
  res.json(db.prepare("SELECT * FROM reservations ORDER BY date, time").all().map(rowToReservation));
});

app.get("/api/admin/reservations", (req, res) => {
  const { date, from, status } = req.query;
  const where = [];
  const args = [];
  if (date) { where.push("date = ?"); args.push(String(date)); }
  if (from) { where.push("date >= ?"); args.push(String(from)); }
  if (status) { where.push("status = ?"); args.push(String(status)); }
  const sql = "SELECT * FROM reservations" + (where.length ? " WHERE " + where.join(" AND ") : "") + " ORDER BY date, time LIMIT 500";
  res.json(db.prepare(sql).all(...args).map(rowToReservation));
});

app.patch("/api/admin/reservations/:ref", (req, res) => {
  const status = req.body && req.body.status;
  if (!RES_STATUSES.includes(status)) return res.status(400).json({ error: "Unknown status." });
  const info = db.prepare("UPDATE reservations SET status = ? WHERE ref = ?").run(status, req.params.ref);
  if (!info.changes) return res.status(404).json({ error: "No such booking." });
  res.json({ ok: true });
});

function ordersWithItems(rows) {
  const itemsStmt = db.prepare("SELECT name, price, qty FROM order_items WHERE order_id = ?");
  return rows.map((o) => ({
    id: o.id, ref: o.ref, name: o.name, phone: o.phone, pickupDate: o.pickup_date, pickup: o.pickup_time,
    note: o.note, total: o.total, status: o.status, createdAt: o.created_at, items: itemsStmt.all(o.id),
  }));
}

app.get("/api/admin/orders", (req, res) => {
  const scope = req.query.scope === "all" ? "" : "WHERE status IN ('new','preparing','ready')";
  const rows = db.prepare(`SELECT * FROM orders ${scope} ORDER BY pickup_date, pickup_time LIMIT 300`).all();
  res.json(ordersWithItems(rows));
});

app.patch("/api/admin/orders/:ref", (req, res) => {
  const status = req.body && req.body.status;
  if (!ORDER_STATUSES.includes(status)) return res.status(400).json({ error: "Unknown status." });
  const info = db.prepare("UPDATE orders SET status = ? WHERE ref = ?").run(status, req.params.ref);
  if (!info.changes) return res.status(404).json({ error: "No such order." });
  res.json({ ok: true });
});

app.get("/api/admin/menu", (req, res) => {
  const cats = db.prepare("SELECT key, label FROM menu_categories ORDER BY sort").all();
  res.json({ categories: cats, menu: loadMenu() });
});

app.post("/api/admin/menu/items", (req, res) => {
  const b = req.body || {};
  const price = Number(b.price);
  if (!clean(b.name, 80) || !Number.isInteger(price) || price < 0 || price > 100000) {
    return res.status(400).json({ error: "Give the item a name and a whole-number price." });
  }
  if (!db.prepare("SELECT 1 FROM menu_categories WHERE key = ?").get(b.category)) return res.status(400).json({ error: "Unknown category." });
  const veg = b.veg === true || b.veg === "veg" ? 1 : b.veg === false || b.veg === "nonveg" ? 0 : null;
  const sort = db.prepare("SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM menu_items WHERE category = ?").get(b.category).n;
  const info = db
    .prepare("INSERT INTO menu_items(category, name, price, note, veg, available, sort) VALUES(?, ?, ?, ?, ?, 1, ?)")
    .run(b.category, clean(b.name, 80), price, clean(b.note, 200), veg, sort);
  res.status(201).json({ ok: true, id: Number(info.lastInsertRowid) });
});

app.patch("/api/admin/menu/items/:id", (req, res) => {
  const item = db.prepare("SELECT * FROM menu_items WHERE id = ?").get(Number(req.params.id));
  if (!item) return res.status(404).json({ error: "No such item." });
  const b = req.body || {};
  const next = {
    name: b.name !== undefined ? clean(b.name, 80) : item.name,
    price: b.price !== undefined ? Number(b.price) : item.price,
    note: b.note !== undefined ? clean(b.note, 200) : item.note,
    available: b.available !== undefined ? (b.available ? 1 : 0) : item.available,
  };
  if (!next.name || !Number.isInteger(next.price) || next.price < 0 || next.price > 100000) {
    return res.status(400).json({ error: "Give the item a name and a whole-number price." });
  }
  db.prepare("UPDATE menu_items SET name = ?, price = ?, note = ?, available = ? WHERE id = ?").run(
    next.name, next.price, next.note, next.available, item.id
  );
  res.json({ ok: true });
});

app.delete("/api/admin/menu/items/:id", (req, res) => {
  // Past orders keep their own copy of the name and price, so deleting is safe.
  const info = db.prepare("DELETE FROM menu_items WHERE id = ?").run(Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: "No such item." });
  res.json({ ok: true });
});

app.get("/api/admin/settings", (req, res) => {
  res.json({ seats: Number(getSetting("seats", CFG.DEFAULT_SEATS)), dwellMin: Number(getSetting("dwell_min", CFG.DEFAULT_DWELL_MIN)) });
});

app.put("/api/admin/settings", (req, res) => {
  const seats = Number(req.body && req.body.seats);
  const dwell = Number(req.body && req.body.dwellMin);
  if (!Number.isInteger(seats) || seats < 1 || seats > 200) return res.status(400).json({ error: "Seats must be a whole number from 1 to 200." });
  if (!Number.isInteger(dwell) || dwell < 30 || dwell > 240) return res.status(400).json({ error: "Dining time must be between 30 and 240 minutes." });
  setSetting("seats", seats);
  setSetting("dwell_min", dwell);
  res.json({ ok: true });
});

// Summary of one day: used by the dashboard and by the n8n daily-digest workflow.
function digestFor(date) {
  const rows = db.prepare("SELECT * FROM reservations WHERE date = ? AND status IN ('confirmed','seated','completed') ORDER BY time").all(date);
  const covers = rows.reduce((s, r) => s + r.guests, 0);
  const lines = rows.map((r) => `${r.time}  ${r.name}  ${r.guests} guest${r.guests > 1 ? "s" : ""}${r.occasion ? "  (" + r.occasion + ")" : ""}${r.note ? "  note: " + r.note : ""}`);
  const label = new Date(date + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const text = rows.length
    ? `NERO Caffe, ${label}: ${rows.length} booking${rows.length > 1 ? "s" : ""}, ${covers} covers.\n` + lines.join("\n")
    : `NERO Caffe, ${label}: no bookings yet.`;
  return { date, bookings: rows.length, covers, reservations: rows.map(rowToReservation), text };
}

app.get("/api/admin/digest", (req, res) => {
  const now = B.nowLocal();
  const when = req.query.date === "today" ? now.date : /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || "")) ? req.query.date : B.addDays(now.date, 1);
  res.json(digestFor(when));
});

app.get("/api/admin/stats", (req, res) => {
  const today = B.nowLocal().date;
  const d = digestFor(today);
  const open = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS t FROM orders WHERE status IN ('new','preparing','ready')").get();
  const sales = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS t FROM orders WHERE pickup_date = ? AND status != 'cancelled'").get(today);
  const noShows = db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE status = 'no_show'").get().n;
  const total = db.prepare("SELECT COUNT(*) AS n FROM reservations").get().n;
  res.json({
    today, bookingsToday: d.bookings, coversToday: d.covers,
    openOrders: open.n, ordersToday: sales.n, orderSalesToday: sales.t,
    noShowRate: total ? Math.round((noShows / total) * 100) : 0,
  });
});

app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on our side. Please try again." });
});

app.listen(PORT, () => {
  console.log(`NERO Caffe server running at http://localhost:${PORT}  (admin: /admin)`);
});
