// NERO Caffe API as one pure function, so it can run inside an n8n Code node (GitHub Pages hosting)
// and in plain Node for tests. n8n's Code sandbox has no crypto or process, so hashing is pure JS.
// handle(st, req) -> { status, body, write, notify }
//   st    { cfg, menu, res }  the three parsed state rows (mutated in place when write is set)
//   req   { method, path, query, body, token, ip, now }  now = epoch ms
//   write name of the state row that changed ("cfg" | "menu" | "res") or null
//   notify reservation to hand to the n8n email workflow, or null
var neroHandle = (function () {
  var TZ = "Asia/Kolkata";
  var HOURS = { 0: [9, 22], 1: null, 2: [8, 22], 3: [8, 22], 4: [8, 22], 5: [8, 23], 6: [8, 23] };
  var LAST_SEATING = 21.5, SLOT_STEP = 0.5, MAX_GUESTS = 8, SESSION_MS = 12 * 3600 * 1000, FAIL_WINDOW = 15 * 60 * 1000;
  var STATUSES = ["confirmed", "seated", "completed", "no_show", "cancelled"];
  var DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, HM = /^[0-9]{2}:[0-9]{2}$/;
  var NL = String.fromCharCode(10), TAB = String.fromCharCode(9); // no backslashes: this file is pasted into an n8n Code node

  // ---------- SHA-256, HMAC, password hashing ----------
  var SHA_K = [], SHA_H = [];
  (function () {
    for (var n = 2, c = 0; c < 64; n++) {
      var prime = true;
      for (var d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
      if (!prime) continue;
      if (c < 8) SHA_H[c] = (Math.sqrt(n) % 1) * 4294967296 | 0;
      SHA_K[c++] = (Math.cbrt(n) % 1) * 4294967296 | 0;
    }
  })();
  var ror = function (x, n) { return (x >>> n) | (x << (32 - n)); };

  function sha256(bytes) {
    var len = bytes.length, total = ((len + 9 + 63) >> 6) << 6;
    var buf = new Uint8Array(total);
    buf.set(bytes);
    buf[len] = 0x80;
    var dv = new DataView(buf.buffer);
    dv.setUint32(total - 4, (len * 8) >>> 0);
    dv.setUint32(total - 8, Math.floor((len * 8) / 4294967296));
    var h = SHA_H.slice(), w = new Array(64), i;
    for (var o = 0; o < total; o += 64) {
      for (i = 0; i < 16; i++) w[i] = dv.getInt32(o + i * 4);
      for (i = 16; i < 64; i++) {
        var s0 = ror(w[i - 15], 7) ^ ror(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        var s1 = ror(w[i - 2], 17) ^ ror(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (i = 0; i < 64; i++) {
        var t1 = (hh + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + SHA_K[i] + w[i]) | 0;
        var t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
      h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
    }
    var out = new Uint8Array(32), odv = new DataView(out.buffer);
    for (i = 0; i < 8; i++) odv.setInt32(i * 4, h[i]);
    return out;
  }
  var utf8 = function (s) { return new TextEncoder().encode(String(s)); };
  function cat(a, b) { var r = new Uint8Array(a.length + b.length); r.set(a); r.set(b, a.length); return r; }
  function hex(bytes) { var s = ""; for (var i = 0; i < bytes.length; i++) s += (bytes[i] + 256).toString(16).slice(1); return s; }
  function hmacHex(key, msg) {
    var k = utf8(key);
    if (k.length > 64) k = sha256(k);
    var ip = new Uint8Array(64), op = new Uint8Array(64);
    for (var i = 0; i < 64; i++) { var x = k[i] || 0; ip[i] = x ^ 0x36; op[i] = x ^ 0x5c; }
    return hex(sha256(cat(op, sha256(cat(ip, utf8(msg))))));
  }
  function hashPassword(password, salt) {
    var h = sha256(utf8(salt + ":" + password));
    for (var i = 0; i < 2000; i++) h = sha256(cat(h, utf8(salt)));
    return hex(h);
  }
  function safeEq(a, b) {
    a = String(a); b = String(b);
    var diff = a.length ^ b.length;
    for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0);
    return diff === 0;
  }
  function randomHex(n) {
    var s = "";
    while (s.length < n) s += Math.floor(Math.random() * 4294967296).toString(16).padStart(8, "0");
    return s.slice(0, n);
  }
  var makeToken = function (cfg, now) { var exp = String(now + SESSION_MS); return exp + "." + hmacHex(cfg.secret, exp + ":" + cfg.pwv); };
  function validToken(cfg, token, now) {
    var parts = String(token || "").split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
    return safeEq(parts[1], hmacHex(cfg.secret, parts[0] + ":" + cfg.pwv)) && Number(parts[0]) > now;
  }

  // ---------- time and capacity ----------
  var clock = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  function nowLocal(ms) {
    var p = {};
    clock.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    return { date: p.year + "-" + p.month + "-" + p.day, minutes: Number(p.hour) * 60 + Number(p.minute) };
  }
  function addDays(day, n) { var d = new Date(day + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  var weekday = function (day) { return new Date(day + "T00:00:00Z").getUTCDay(); };
  var toMin = function (hhmm) { var p = hhmm.split(":").map(Number); return p[0] * 60 + p[1]; };
  var toHHMM = function (min) { return String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0"); };
  function realDay(day) { var d = new Date(day + "T00:00:00Z"); return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day; }
  function slotsFor(day) {
    var hours = HOURS[weekday(day)], out = [];
    if (!hours) return out;
    for (var t = hours[0]; t <= LAST_SEATING + 1e-9; t += SLOT_STEP) out.push(toHHMM(Math.round(t * 60)));
    return out;
  }
  var seatsOf = function (cfg) { return Number(cfg.seats); };
  function peakOccupancy(st, day, startMin) {
    var dwell = Number(st.cfg.dwellMin);
    var rows = st.res.filter(function (r) { return r.date === day && (r.status === "confirmed" || r.status === "seated"); })
      .map(function (r) { return { start: toMin(r.time), guests: r.guests }; });
    var end = startMin + dwell;
    var points = [startMin].concat(rows.map(function (r) { return r.start; }).filter(function (s) { return s > startMin && s < end; }));
    var peak = 0;
    points.forEach(function (x) {
      var used = rows.filter(function (r) { return r.start <= x && x < r.start + dwell; }).reduce(function (sum, r) { return sum + r.guests; }, 0);
      peak = Math.max(peak, used);
    });
    return peak;
  }
  var seatsLeft = function (st, day, hhmm) { return Math.max(0, seatsOf(st.cfg) - peakOccupancy(st, day, toMin(hhmm))); };

  // ---------- helpers ----------
  var clean = function (v, max) { return String(v == null ? "" : v).trim().slice(0, max); };
  function validEmail(raw) {
    var v = String(raw || "").trim();
    return v.length <= 120 && /^[^ @]+@[^ @]+[.][^ @]{2,}$/.test(v) && v.indexOf(NL) < 0 && v.indexOf(TAB) < 0 ? v : "";
  }
  function makeRef(st) {
    var alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", ref;
    do {
      ref = "NR-";
      for (var i = 0; i < 5; i++) ref += alphabet[Math.floor(Math.random() * alphabet.length)];
    } while (st.res.some(function (r) { return r.ref === ref; }));
    return ref;
  }
  var pub = function (r) {
    return { ref: r.ref, name: r.name, email: r.email, phone: r.phone, date: r.date, time: r.time, guests: r.guests, occasion: r.occasion, note: r.note, status: r.status, createdAt: r.createdAt };
  };
  var byDayTime = function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.time < b.time ? -1 : a.time > b.time ? 1 : 0; };

  function loadMenu(menu) {
    var out = {};
    menu.cats.forEach(function (c) { out[c.key] = { label: c.label, items: [] }; });
    menu.items.slice().sort(function (a, b) { return a.sort - b.sort || a.id - b.id; }).forEach(function (it) {
      if (!out[it.category]) return;
      var o = { id: it.id, name: it.name, price: it.price };
      if (it.note) o.note = it.note;
      if (it.veg !== null && it.veg !== undefined) o.veg = !!it.veg;
      o.available = !!it.available;
      out[it.category].items.push(o);
    });
    return out;
  }

  function digestFor(st, day) {
    var rows = st.res.filter(function (r) { return r.date === day && (r.status === "confirmed" || r.status === "seated" || r.status === "completed"); }).sort(function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
    var covers = rows.reduce(function (s, r) { return s + r.guests; }, 0);
    var lines = rows.map(function (r) {
      return r.time + "  " + r.name + "  " + r.guests + " guest" + (r.guests > 1 ? "s" : "") + (r.occasion ? "  (" + r.occasion + ")" : "") + (r.note ? "  note: " + r.note : "");
    });
    var label = new Date(day + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
    var text = rows.length
      ? "NERO Caffe, " + label + ": " + rows.length + " booking" + (rows.length > 1 ? "s" : "") + ", " + covers + " covers." + NL + lines.join(NL)
      : "NERO Caffe, " + label + ": no bookings yet.";
    return { date: day, bookings: rows.length, covers: covers, reservations: rows.map(pub), text: text };
  }

  // ---------- the router ----------
  function handle(st, req) {
    var now = req.now, method = String(req.method || "GET").toUpperCase();
    var path = String(req.path || "").split("?")[0];
    while (path.length > 1 && path.slice(-1) === "/") path = path.slice(0, -1);
    var q = req.query || {}, b = req.body && typeof req.body === "object" ? req.body : {};
    var cfg = st.cfg, nl = nowLocal(now);
    var tail = function (prefix) { var t = path.indexOf(prefix) === 0 ? path.slice(prefix.length) : ""; return t && t.indexOf("/") < 0 ? t : ""; };
    var refTail = tail("/api/admin/reservations/"), itemTail = tail("/api/admin/menu/items/");
    var out = function (status, body, write, notify) { return { status: status, body: body, write: write || null, notify: notify || null }; };
    var fail = function (status, msg) { return out(status, { error: msg }); };

    // public
    if (method === "GET" && path === "/api/menu") return out(200, loadMenu(st.menu));

    if (method === "GET" && path === "/api/availability") {
      var date = String(q.date || "");
      if (!DAY.test(date)) return fail(400, "Pass ?date=YYYY-MM-DD.");
      var slots = slotsFor(date).map(function (t) {
        return { time: t, left: seatsLeft(st, date, t), past: date === nl.date && toMin(t) < nl.minutes + 30 };
      });
      return out(200, { date: date, seats: seatsOf(cfg), slots: slots });
    }

    if (method === "POST" && path === "/api/reservations") {
      var guestName = clean(b.name, 80);
      if (!guestName || !b.email || !b.date || !b.time || !b.guests) return fail(400, "Name, email, date, time and guests are required.");
      var guestEmail = validEmail(b.email);
      if (!guestEmail) return fail(400, "Please enter a valid email address.");
      var guestCount = Number(b.guests);
      if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > MAX_GUESTS) return fail(400, "Online bookings are for 1 to 8 guests. Call us for larger groups.");
      if (!DAY.test(String(b.date)) || !HM.test(String(b.time)) || !realDay(b.date)) return fail(400, "Please choose a valid date and time.");
      if (b.date < nl.date) return fail(400, "Please choose a date from today onward.");
      if (weekday(b.date) === 1) return fail(400, "We're closed on Mondays. Please pick another day.");
      if (slotsFor(b.date).indexOf(b.time) < 0) return fail(400, "That time is outside our seating hours.");
      if (b.date === nl.date && toMin(b.time) < nl.minutes) return fail(400, "That time has already passed. Please pick a later slot.");
      if (seatsLeft(st, b.date, b.time) < guestCount) return fail(409, "That time is fully booked for your party size. Please try another time or day.");
      if (st.res.length >= 5000) return fail(503, "Bookings are paused for a moment. Please call us.");
      var row = {
        ref: makeRef(st), name: guestName, email: guestEmail, phone: "", date: b.date, time: b.time, guests: guestCount,
        occasion: clean(b.occasion, 40), note: clean(b.note, 300), status: "confirmed", createdAt: new Date(now).toISOString(),
      };
      st.res.push(row);
      return out(201, { ok: true, ref: row.ref, reservation: pub(row) }, "res", pub(row));
    }

    if (method === "POST" && (path === "/api/my-booking" || path === "/api/my-booking/cancel")) {
      var cancel = path === "/api/my-booking/cancel";
      var ref = clean(b.ref, 20).toUpperCase(), mail = clean(b.email, 120).toLowerCase();
      var hit = ref && mail ? st.res.filter(function (r) { return r.ref === ref && String(r.email).toLowerCase() === mail; })[0] : null;
      if (!hit) return fail(404, cancel ? "We couldn't find that booking." : "We couldn't find a booking with that reference and email. Check both and try again.");
      var wrote = null;
      if (cancel) {
        if (hit.status !== "confirmed") return fail(409, "This booking can no longer be cancelled online.");
        if (hit.date < nl.date || (hit.date === nl.date && toMin(hit.time) <= nl.minutes)) return fail(409, "This booking time has already started.");
        hit.status = "cancelled";
        wrote = "res";
      }
      var strip = function (r) { var o = pub(r); delete o.phone; delete o.email; return o; };
      var all = st.res.filter(function (r) { return String(r.email).toLowerCase() === mail; })
        .sort(function (x, y) { return -byDayTime(x, y); }).slice(0, 50);
      return out(200, {
        reservation: strip(hit),
        others: all.filter(function (r) { return r.ref !== hit.ref; }).map(strip),
        dwellMin: Number(cfg.dwellMin), timezone: TZ, now: nl,
      }, wrote);
    }

    // sign in
    if (method === "POST" && path === "/api/admin/login") {
      var ip = String(req.ip || "?");
      cfg.fails = cfg.fails || {};
      var rec = cfg.fails[ip], glob = cfg.gfail || { count: 0, first: 0 };
      var live = function (r) { return r && now - r.first < FAIL_WINDOW; };
      if ((live(rec) && rec.count >= 5) || (live(glob) && glob.count >= 30)) return fail(429, "Too many attempts. Try again in 15 minutes.");
      if (!safeEq(hashPassword(String(b.password || "").slice(0, 200), cfg.salt), cfg.pwHash)) {
        cfg.fails[ip] = live(rec) ? { count: rec.count + 1, first: rec.first } : { count: 1, first: now };
        cfg.gfail = live(glob) ? { count: glob.count + 1, first: glob.first } : { count: 1, first: now };
        Object.keys(cfg.fails).forEach(function (k) { if (!live(cfg.fails[k])) delete cfg.fails[k]; });
        return out(401, { error: "Wrong password." }, "cfg");
      }
      var had = !!cfg.fails[ip];
      delete cfg.fails[ip];
      return out(200, { ok: true, token: makeToken(cfg, now) }, had ? "cfg" : null);
    }
    if (method === "POST" && path === "/api/admin/logout") return out(200, { ok: true });
    if (method === "GET" && path === "/api/admin/me") return out(200, { ok: validToken(cfg, req.token, now) });

    // everything below needs a signed-in admin
    if (path.indexOf("/api/admin/") === 0 || path === "/api/reservations") {
      if (!validToken(cfg, req.token, now)) return fail(401, "Not signed in.");
    } else {
      return fail(404, "Not found.");
    }

    if (method === "POST" && path === "/api/admin/password") {
      var next = String(b.next || "");
      if (!safeEq(hashPassword(String(b.current || "").slice(0, 200), cfg.salt), cfg.pwHash)) return fail(403, "The current password is not right.");
      if (next.length < 8 || next.length > 100) return fail(400, "The new password must be 8 to 100 characters.");
      cfg.salt = randomHex(16);
      cfg.pwHash = hashPassword(next, cfg.salt);
      cfg.pwv = Number(cfg.pwv) + 1; // signs out every other session
      return out(200, { ok: true, token: makeToken(cfg, now) }, "cfg");
    }

    if (method === "GET" && path === "/api/reservations") return out(200, st.res.slice().sort(byDayTime).map(pub));

    if (method === "GET" && path === "/api/admin/reservations") {
      var list = st.res.filter(function (r) {
        return (!q.date || r.date === String(q.date)) && (!q.from || r.date >= String(q.from)) && (!q.status || r.status === String(q.status));
      });
      return out(200, list.sort(byDayTime).slice(0, 500).map(pub));
    }

    if (refTail && method === "PATCH") {
      if (STATUSES.indexOf(b.status) < 0) return fail(400, "Unknown status.");
      var target = st.res.filter(function (r) { return r.ref === decodeURIComponent(refTail); })[0];
      if (!target) return fail(404, "No such booking.");
      target.status = b.status;
      return out(200, { ok: true }, "res");
    }

    if (method === "POST" && path === "/api/admin/reservations") {
      var name = clean(b.name, 80);
      if (!name) return fail(400, "Enter the guest's name.");
      var guests = Number(b.guests);
      if (!Number.isInteger(guests) || guests < 1 || guests > 100) return fail(400, "Guests must be a whole number from 1 to 100.");
      var email = String(b.email || "").trim() ? validEmail(b.email) : "";
      if (String(b.email || "").trim() && !email) return fail(400, "That email address does not look right.");
      if (!DAY.test(String(b.date)) || !HM.test(String(b.time))) return fail(400, "Choose a date and a time.");
      if (!realDay(b.date) || toMin(b.time) >= 24 * 60) return fail(400, "Choose a valid date and time.");
      if (b.date < nl.date) return fail(400, "That date has already passed.");
      var left = seatsLeft(st, b.date, b.time);
      if (!b.override && left < guests) return fail(409, "Only " + left + " seat" + (left === 1 ? "" : "s") + " free at " + b.time + '. Tick "Ignore the seat limit" to book anyway.');
      if (st.res.length >= 5000) return fail(503, "Too many bookings are stored. Archive old ones first.");
      var made = {
        ref: makeRef(st), name: name, email: email, phone: clean(b.phone, 20), date: b.date, time: b.time, guests: guests,
        occasion: clean(b.occasion, 40), note: clean(b.note, 300), status: b.seated ? "seated" : "confirmed", createdAt: new Date(now).toISOString(),
      };
      st.res.push(made);
      return out(201, { ok: true, reservation: pub(made) }, "res");
    }

    if (method === "GET" && path === "/api/admin/menu") return out(200, { categories: st.menu.cats.map(function (c) { return { key: c.key, label: c.label }; }), menu: loadMenu(st.menu) });

    if (method === "POST" && path === "/api/admin/menu/items") {
      var price = Number(b.price);
      if (!clean(b.name, 80) || !Number.isInteger(price) || price < 0 || price > 100000) return fail(400, "Give the item a name and a whole-number price.");
      if (!st.menu.cats.some(function (c) { return c.key === b.category; })) return fail(400, "Unknown category.");
      var veg = b.veg === true || b.veg === "veg" ? 1 : b.veg === false || b.veg === "nonveg" ? 0 : null;
      var sorts = st.menu.items.filter(function (i) { return i.category === b.category; }).map(function (i) { return i.sort; });
      var item = { id: st.menu.next, category: b.category, name: clean(b.name, 80), price: price, note: clean(b.note, 200), veg: veg, available: 1, sort: sorts.length ? Math.max.apply(null, sorts) + 1 : 0 };
      st.menu.next += 1;
      st.menu.items.push(item);
      return out(201, { ok: true, id: item.id }, "menu");
    }

    if (/^[0-9]+$/.test(itemTail) && (method === "PATCH" || method === "DELETE")) {
      var id = Number(itemTail);
      var found = st.menu.items.filter(function (i) { return i.id === id; })[0];
      if (!found) return fail(404, "No such item.");
      if (method === "DELETE") {
        st.menu.items = st.menu.items.filter(function (i) { return i.id !== id; });
        return out(200, { ok: true }, "menu");
      }
      var nx = {
        name: b.name !== undefined ? clean(b.name, 80) : found.name,
        price: b.price !== undefined ? Number(b.price) : found.price,
        note: b.note !== undefined ? clean(b.note, 200) : found.note,
        available: b.available !== undefined ? (b.available ? 1 : 0) : found.available,
      };
      if (!nx.name || !Number.isInteger(nx.price) || nx.price < 0 || nx.price > 100000) return fail(400, "Give the item a name and a whole-number price.");
      found.name = nx.name; found.price = nx.price; found.note = nx.note; found.available = nx.available;
      return out(200, { ok: true }, "menu");
    }

    if (method === "GET" && path === "/api/admin/settings") return out(200, { seats: seatsOf(cfg), dwellMin: Number(cfg.dwellMin) });

    if (method === "PUT" && path === "/api/admin/settings") {
      var seats = Number(b.seats), dwell = Number(b.dwellMin);
      if (!Number.isInteger(seats) || seats < 1 || seats > 200) return fail(400, "Seats must be a whole number from 1 to 200.");
      if (!Number.isInteger(dwell) || dwell < 30 || dwell > 240) return fail(400, "Dining time must be between 30 and 240 minutes.");
      cfg.seats = seats;
      cfg.dwellMin = dwell;
      return out(200, { ok: true }, "cfg");
    }

    if (method === "GET" && path === "/api/admin/digest") {
      var when = q.date === "today" ? nl.date : DAY.test(String(q.date || "")) ? q.date : addDays(nl.date, 1);
      return out(200, digestFor(st, when));
    }

    if (method === "GET" && path === "/api/admin/stats") {
      var d = digestFor(st, nl.date);
      var noShows = st.res.filter(function (r) { return r.status === "no_show"; }).length;
      return out(200, { today: nl.date, bookingsToday: d.bookings, coversToday: d.covers, noShowRate: st.res.length ? Math.round((noShows / st.res.length) * 100) : 0 });
    }

    return fail(404, "Not found.");
  }

  handle.hashPassword = hashPassword;
  handle.randomHex = randomHex;
  handle.sha256hex = function (s) { return hex(sha256(utf8(s))); };
  handle.hmacHex = hmacHex;
  return handle;
})();
if (typeof module !== "undefined" && module.exports) module.exports = neroHandle;
