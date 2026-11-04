(function () {
  var $ = function (id) { return document.getElementById(id); };
  var TABS = {
    today: ["Today", null],
    bookings: ["Bookings", "Search, filter and manage every reservation"],
    insights: ["Insights", "How the cafe is filling up"],
    menu: ["Menu", "Prices and what is sold out"],
    settings: ["Settings", "Seating rules for online bookings"],
  };
  var STATUS_LABEL = { confirmed: "Confirmed", seated: "Seated", completed: "Done", no_show: "No show", cancelled: "Cancelled" };
  var S = {
    view: "today", res: [], seats: 18, dwell: 90, today: "", digest: "", known: null,
    updated: 0, failed: false, busy: false, drawer: null, unseen: 0, range: "upcoming", status: "", q: "", win: "7", menuQ: "",
  };
  var pollTimer = null, liveTimer = null;

  /* ---------- helpers ---------- */
  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function api(method, url, body) {
    return fetch(url, {
      method: method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401 && url !== "/api/admin/login") { showLogin(); throw new Error("signed out"); }
        if (!res.ok) throw new Error(data.error || "Request failed");
        return data;
      });
    });
  }
  function toast(text) {
    var t = $("toast");
    t.hidden = true; void t.offsetWidth;
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { t.hidden = true; }, 3200);
  }
  function fail(err) { if (err && err.message !== "signed out") toast(err.message); }
  function addDays(iso, n) { var d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function fmt(iso, opts) { return new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", Object.assign({ timeZone: "UTC" }, opts)); }
  function dayLabel(iso) {
    if (iso === S.today) return "Today";
    if (iso === addDays(S.today, 1)) return "Tomorrow";
    if (iso === addDays(S.today, -1)) return "Yesterday";
    return fmt(iso, { weekday: "long", day: "numeric", month: "short" });
  }
  function mins(hhmm) { var p = hhmm.split(":"); return Number(p[0]) * 60 + Number(p[1]); }
  function hhmm(m) { return ("0" + Math.floor(m / 60)).slice(-2) + ":" + ("0" + (m % 60)).slice(-2); }
  function nowMin() {
    var p = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()).split(":");
    return Number(p[0]) % 24 * 60 + Number(p[1]);
  }
  function pill(status) { return h("span", "pill " + status, STATUS_LABEL[status] || status); }
  function plural(n, w) { return n + " " + w + (n === 1 ? "" : "s"); }
  function countUp(el, to, suffix) {
    if (!window.matchMedia || matchMedia("(prefers-reduced-motion: reduce)").matches || to < 2) { el.textContent = to + (suffix || ""); return; }
    var t0 = performance.now();
    (function step(t) {
      var k = Math.min(1, (t - t0) / 500);
      el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))) + (suffix || "");
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }
  function kpi(box, label, value, opts, animate) {
    opts = opts || {};
    var d = h("div", "kpi");
    d.appendChild(h("span", null, label));
    var b = h("b");
    if (typeof value === "number" && animate) countUp(b, value, opts.suffix); else b.textContent = value + (opts.suffix && typeof value === "number" ? opts.suffix : "");
    if (opts.small) b.appendChild(h("small", null, opts.small));
    d.appendChild(b);
    if (opts.meter != null) { var m = h("div", "meter"), i = h("i"); i.style.width = "0"; m.appendChild(i); d.appendChild(m); setTimeout(function () { i.style.width = Math.min(100, opts.meter) + "%"; }, 30); }
    if (opts.sub) d.appendChild(h("p", null, opts.sub));
    box.appendChild(d);
  }

  /* ---------- tooltips (any element with data-tip) ---------- */
  var tip = $("tip");
  document.addEventListener("mousemove", function (e) {
    var t = e.target.closest && e.target.closest("[data-tip]");
    if (!t) { tip.hidden = true; return; }
    tip.textContent = t.getAttribute("data-tip");
    tip.hidden = false;
    var x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
    tip.style.left = x + "px";
    tip.style.top = (e.clientY + 18) + "px";
  });

  /* ---------- sign in / out ---------- */
  function showLogin() {
    clearTimeout(pollTimer); clearInterval(liveTimer);
    closeDrawer(true);
    $("app").hidden = true;
    $("login").hidden = false;
    $("pw").focus();
  }
  function showApp() {
    $("login").hidden = true;
    $("app").hidden = false;
    S.known = null;
    var tab = (location.hash || "").slice(1);
    go(TABS[tab] ? tab : "today");
    refresh().then(schedule);
    clearInterval(liveTimer);
    liveTimer = setInterval(setLive, 1000);
  }
  function schedule() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(function () { refresh().then(schedule); }, document.hidden ? 30000 : 10000);
  }
  var BASE_TITLE = document.title;
  function setTitle() { document.title = (S.unseen ? "(" + S.unseen + ") " : "") + BASE_TITLE; }
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) { S.unseen = 0; setTitle(); if (!$("app").hidden) refresh(); }
  });
  $("login-form").addEventListener("submit", function (e) {
    e.preventDefault();
    api("POST", "/api/admin/login", { password: $("pw").value })
      .then(function () { $("pw").value = ""; $("login-msg").textContent = ""; showApp(); })
      .catch(function (err) { $("login-msg").textContent = err.message; });
  });
  function signOut() { api("POST", "/api/admin/logout").then(showLogin); }
  $("logout").addEventListener("click", signOut);
  $("logout-m").addEventListener("click", signOut);
  $("refresh").addEventListener("click", function () { refresh().then(function () { toast("Up to date"); }); });

  /* ---------- live data ---------- */
  function setLive() {
    var live = $("live"), txt = $("live-text");
    if (S.failed) { live.classList.add("off"); txt.textContent = "Offline, retrying"; return; }
    live.classList.remove("off");
    if (!S.updated) { txt.textContent = "Connecting"; return; }
    var s = Math.round((Date.now() - S.updated) / 1000);
    txt.textContent = s < 5 ? "Live" : "Live · " + s + "s ago";
  }
  function refresh() {
    if (S.busy) return Promise.resolve();
    S.busy = true;
    return api("GET", "/api/admin/stats").then(function (st) {
      S.today = st.today;
      return Promise.all([
        api("GET", "/api/admin/settings"),
        api("GET", "/api/admin/reservations?from=" + addDays(S.today, -29)),
        api("GET", "/api/admin/digest"),
      ]);
    }).then(function (r) {
      S.seats = r[0].seats; S.dwell = r[0].dwellMin; S.res = r[1]; S.digest = r[2].text;
      var refs = {};
      S.res.forEach(function (x) { refs[x.ref] = 1; });
      if (S.known) {
        var fresh = S.res.filter(function (x) { return !S.known[x.ref] && x.status === "confirmed"; });
        if (document.hidden && fresh.length) { S.unseen += fresh.length; setTitle(); }
        if (fresh.length === 1) {
          var f = fresh[0];
          toast("New booking: " + f.name + ", " + plural(f.guests, "guest") + ", " + dayLabel(f.date) + " " + f.time);
        } else if (fresh.length > 1) toast(fresh.length + " new bookings");
        if (fresh.length) { var bd = $("nav-badge"); bd.classList.remove("pop"); void bd.offsetWidth; bd.classList.add("pop"); }
      }
      S.known = refs;
      S.updated = Date.now(); S.failed = false; setLive();
      render(false);
    }).catch(function (e) { if (e.message !== "signed out") { S.failed = true; setLive(); } })
      .then(function () { S.busy = false; });
  }
  function setStatus(ref, status) {
    return api("PATCH", "/api/admin/reservations/" + ref, { status: status }).then(function () {
      toast(STATUS_LABEL[status] ? "Marked " + STATUS_LABEL[status].toLowerCase() : "Updated");
      return refresh();
    }).catch(fail);
  }
  function actionsFor(r) {
    var acts = h("div", "acts");
    var buttons = {
      confirmed: [["Seat", "seated"], ["No show", "no_show"], ["Cancel", "cancelled"]],
      seated: [["Done", "completed"]],
      completed: [], no_show: [["Undo", "confirmed"]], cancelled: [["Undo", "confirmed"]],
    }[r.status] || [];
    buttons.forEach(function (b) {
      var bad = b[1] === "cancelled" || b[1] === "no_show";
      var btn = h("button", "btn sm " + (bad ? "bad" : "ghost"), b[0]);
      btn.type = "button";
      btn.addEventListener("click", function (e) { e.stopPropagation(); btn.disabled = true; setStatus(r.ref, b[1]); });
      acts.appendChild(btn);
    });
    return acts;
  }

  /* ---------- navigation ---------- */
  $("tabs").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-tab]");
    if (b) go(b.dataset.tab);
  });
  function go(tab) {
    S.view = tab;
    if (location.hash !== "#" + tab) history.replaceState(null, "", "#" + tab);
    [].forEach.call(document.querySelectorAll("#tabs button"), function (b) { b.classList.toggle("on", b.dataset.tab === tab); });
    [].forEach.call(document.querySelectorAll(".tab"), function (s) { s.hidden = s.id !== "tab-" + tab; });
    $("page-title").textContent = TABS[tab][0];
    window.scrollTo(0, 0);
    if (tab === "menu") loadMenu();
    if (tab === "settings") loadSettings();
    render(true);
  }
  function render(animate) {
    if (!S.today) return;
    $("page-sub").textContent = S.view === "today" ? fmt(S.today, { weekday: "long", day: "numeric", month: "long" }) : TABS[S.view][1];
    var upcoming = S.res.filter(function (r) { return r.date >= S.today && r.status === "confirmed"; }).length;
    var bd = $("nav-badge"); bd.hidden = !upcoming; bd.textContent = upcoming;
    ({ today: renderToday, bookings: renderBookings, insights: renderInsights }[S.view] || function () {})(animate);
    if (S.drawer && S.drawer !== NEW) renderDrawer();
  }

  /* ---------- today ---------- */
  function renderToday(animate) {
    var rows = S.res.filter(function (r) { return r.date === S.today; });
    var active = rows.filter(function (r) { return r.status !== "cancelled" && r.status !== "no_show"; });
    var covers = active.reduce(function (s, r) { return s + r.guests; }, 0);
    var seated = rows.filter(function (r) { return r.status === "seated"; }).reduce(function (s, r) { return s + r.guests; }, 0);
    var nm = nowMin();
    var next = rows.filter(function (r) { return r.status === "confirmed" && mins(r.time) >= nm - 15; })[0];
    var k = $("kpis"); k.innerHTML = "";
    kpi(k, "Bookings today", active.length, null, animate);
    kpi(k, "Covers today", covers, null, animate);
    kpi(k, "Seats in use now", seated, { small: "of " + S.seats, meter: S.seats ? seated / S.seats * 100 : 0 }, animate);
    kpi(k, "Next arrival", next ? next.time : "None", { sub: next ? next.name + ", " + plural(next.guests, "guest") : "Nobody else expected" }, false);

    drawAttention(rows, nm);
    drawTimeline(rows, nm, animate);

    $("print-title").textContent = "NERO Caffè, " + fmt(S.today, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) + ". " + plural(active.length, "booking") + ", " + plural(covers, "cover") + ".";
    var box = $("today-list"); box.innerHTML = "";
    if (!rows.length) box.appendChild(h("p", "empty", "No bookings today."));
    else box.appendChild(bookingTable(rows, false));
    $("digest").textContent = S.digest;
  }
  // Guests who should have arrived by now but are still marked confirmed.
  function drawAttention(rows, nm) {
    var box = $("attention");
    var late = rows.filter(function (r) { return r.status === "confirmed" && mins(r.time) + 15 < nm; });
    box.hidden = !late.length;
    box.innerHTML = "";
    if (!late.length) return;
    box.appendChild(h("h2", null, late.length === 1 ? "1 guest is overdue" : late.length + " guests are overdue"));
    box.appendChild(h("p", "hint", "Still marked confirmed after their booking time. Seat them or mark a no show so the floor and numbers stay right."));
    late.forEach(function (r) {
      var row = h("div", "late-row");
      var who = h("button", "link late-who", r.time + "  " + r.name + ", " + plural(r.guests, "guest"));
      who.type = "button";
      who.addEventListener("click", function () { openDrawer(r.ref); });
      row.appendChild(who);
      var acts = h("div", "acts");
      [["Seat", "seated", "btn sm"], ["No show", "no_show", "btn sm bad"]].forEach(function (b) {
        var btn = h("button", b[2], b[0]); btn.type = "button";
        btn.addEventListener("click", function () { btn.disabled = true; setStatus(r.ref, b[1]); });
        acts.appendChild(btn);
      });
      row.appendChild(acts);
      box.appendChild(row);
    });
  }
  $("print-day").addEventListener("click", function () { window.print(); });
  $("copy-digest").addEventListener("click", function () {
    navigator.clipboard.writeText($("digest").textContent).then(function () { toast("Copied"); });
  });

  function drawTimeline(rows, nm, animate) {
    var box = $("timeline"); box.innerHTML = "";
    var shown = rows.filter(function (r) { return r.status !== "cancelled"; });
    var t0 = 8 * 60, t1 = 23 * 60;
    shown.forEach(function (r) {
      t0 = Math.min(t0, Math.floor(mins(r.time) / 60) * 60);
      t1 = Math.max(t1, Math.ceil((mins(r.time) + S.dwell) / 60) * 60);
    });
    var span = t1 - t0, hours = span / 60;
    $("tl-sub").textContent = shown.length ? plural(shown.length, "booking") + " on the floor" : "";

    var axis = h("div", "tl-axis");
    for (var i = 0; i < hours; i++) axis.appendChild(h("span", null, hhmm(t0 + i * 60)));
    box.appendChild(axis);

    var body = h("div", "tl-body");
    body.style.setProperty("--n", hours);
    // seats in use per half hour, same rule the booking page uses (confirmed + seated)
    var occ = h("div", "tl-occ");
    var busy = shown.filter(function (r) { return r.status === "confirmed" || r.status === "seated"; });
    for (var m = t0; m < t1; m += 30) {
      var used = busy.filter(function (r) { var s = mins(r.time); return s < m + 30 && m < s + S.dwell; }).reduce(function (a, r) { return a + r.guests; }, 0);
      var bar = h("i", used >= S.seats ? "full" : "");
      var pct = S.seats ? Math.min(100, used / S.seats * 100) : 0;
      bar.style.height = animate ? "0" : pct + "%";
      bar.setAttribute("data-tip", hhmm(m) + "  " + used + " of " + S.seats + " seats");
      if (animate) setTimeout((function (b, p) { return function () { b.style.height = p + "%"; }; })(bar, pct), 30);
      occ.appendChild(bar);
    }
    body.appendChild(occ);

    var lanes = [], ends = [];
    var sorted = shown.slice().sort(function (a, b) { return mins(a.time) - mins(b.time); });
    sorted.forEach(function (r) {
      var s = mins(r.time), e = s + S.dwell, lane = 0;
      while (ends[lane] != null && ends[lane] > s) lane++;
      ends[lane] = e;
      (lanes[lane] = lanes[lane] || []).push(r);
    });
    var lw = h("div", "tl-lanes");
    lw.style.height = Math.max(lanes.length, 1) * 38 + "px";
    lanes.forEach(function (list, li) {
      list.forEach(function (r) {
        var b = h("div", "tl-bar " + r.status);
        b.style.left = (mins(r.time) - t0) / span * 100 + "%";
        b.style.width = "calc(" + S.dwell / span * 100 + "% - 3px)";
        b.style.top = li * 38 + "px";
        b.appendChild(h("b", null, r.time));
        b.appendChild(h("span", null, r.name + " · " + r.guests));
        b.setAttribute("data-tip", r.name + "\n" + plural(r.guests, "guest") + ", " + r.time + " to " + hhmm(mins(r.time) + S.dwell) + "\n" + STATUS_LABEL[r.status]);
        b.tabIndex = 0;
        b.addEventListener("click", function () { openDrawer(r.ref); });
        b.addEventListener("keydown", function (ev) { if (ev.key === "Enter") openDrawer(r.ref); });
        lw.appendChild(b);
      });
    });
    body.appendChild(lw);
    if (!shown.length) body.appendChild(h("div", "tl-empty", "Nothing booked yet today"));
    if (nm >= t0 && nm <= t1) {
      var nowLine = h("div", "tl-now");
      nowLine.style.left = (nm - t0) / span * 100 + "%";
      nowLine.setAttribute("data-t", hhmm(nm));
      body.appendChild(nowLine);
    }
    box.appendChild(body);
  }

  /* ---------- booking list (today arrivals and bookings tab) ---------- */
  function bookingTable(rows, grouped) {
    var t = h("table");
    var head = h("tr");
    ["Time", "Guest", "Party", "Status", ""].forEach(function (c, i) { var th = h("th", i === 2 ? "hide-s" : null, c); head.appendChild(th); });
    t.appendChild(head);
    var lastDate = null;
    rows.forEach(function (r) {
      if (grouped && r.date !== lastDate) {
        lastDate = r.date;
        var g = h("tr", "group"), gc = h("td"), n = rows.filter(function (x) { return x.date === r.date; });
        gc.colSpan = 5;
        gc.textContent = dayLabel(r.date);
        gc.appendChild(h("small", null, fmt(r.date, { day: "numeric", month: "short", year: "numeric" }) + " · " + plural(n.length, "booking") + ", " + plural(n.reduce(function (s, x) { return s + (x.status === "cancelled" ? 0 : x.guests); }, 0), "cover")));
        g.appendChild(gc); t.appendChild(g);
      }
      var tr = h("tr", "row" + (r.status === "cancelled" ? " dim" : ""));
      tr.tabIndex = 0;
      tr.appendChild(h("td", "t", r.time));
      var who = h("td");
      who.appendChild(h("div", null, r.name));
      who.appendChild(h("small", null, (r.email || r.phone || "") + (r.occasion ? " · " + r.occasion : "") + (r.email || r.phone ? " · " : "") + r.ref));
      if (r.note) who.appendChild(h("small", null, "Note: " + r.note));
      tr.appendChild(who);
      tr.appendChild(h("td", "hide-s", String(r.guests)));
      var st = h("td"); st.appendChild(pill(r.status)); tr.appendChild(st);
      var ac = h("td", "acts-cell"); ac.appendChild(actionsFor(r)); tr.appendChild(ac);
      tr.addEventListener("click", function () { openDrawer(r.ref); });
      tr.addEventListener("keydown", function (ev) { if (ev.key === "Enter" && ev.target === tr) openDrawer(r.ref); });
      t.appendChild(tr);
    });
    return t;
  }

  /* ---------- bookings tab ---------- */
  function rangeRows() {
    var q = S.q.trim().toLowerCase();
    var out = S.res.filter(function (r) {
      var ok = { upcoming: r.date >= S.today, today: r.date === S.today, past: r.date < S.today, all: true }[S.range];
      if (!ok) return false;
      if (!q) return true;
      return [r.name, r.ref, r.email, r.phone].join(" ").toLowerCase().indexOf(q) >= 0;
    });
    if (S.range === "past") out.reverse();
    return out;
  }
  function renderBookings() {
    var base = rangeRows();
    var counts = { "": base.length };
    base.forEach(function (r) { counts[r.status] = (counts[r.status] || 0) + 1; });
    var chips = $("b-status"); chips.innerHTML = "";
    [["", "All"], ["confirmed", "Confirmed"], ["seated", "Seated"], ["completed", "Done"], ["no_show", "No show"], ["cancelled", "Cancelled"]].forEach(function (c) {
      var b = h("button", S.status === c[0] ? "on" : "", c[1]);
      b.type = "button";
      b.appendChild(h("em", null, String(counts[c[0]] || 0)));
      b.addEventListener("click", function () { S.status = c[0]; renderBookings(); });
      chips.appendChild(b);
    });
    var rows = S.status ? base.filter(function (r) { return r.status === S.status; }) : base;
    var box = $("b-table"); box.innerHTML = "";
    box.appendChild(rows.length ? bookingTable(rows, true) : h("p", "empty", S.q ? "Nothing matches that search." : "No bookings here."));
  }
  $("b-q").addEventListener("input", function (e) { S.q = e.target.value; renderBookings(); });
  $("b-range").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-v]");
    if (!b) return;
    S.range = b.dataset.v;
    [].forEach.call($("b-range").children, function (x) { x.classList.toggle("on", x === b); });
    renderBookings();
  });

  /* ---------- export ---------- */
  function csvCell(v) {
    v = v == null ? "" : String(v);
    // Guest typed text must not become a spreadsheet formula (phone numbers like +91 98... stay as they are).
    if (/^[=@\t\r]/.test(v) || (/^[+\-]/.test(v) && !/^[+\-][\d\s()\-]+$/.test(v))) v = "'" + v;
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  $("b-export").addEventListener("click", function () {
    var base = rangeRows(), rows = S.status ? base.filter(function (r) { return r.status === S.status; }) : base;
    if (!rows.length) { toast("Nothing to export"); return; }
    var head = ["Reference", "Date", "Time", "Name", "Guests", "Status", "Phone", "Email", "Occasion", "Note"];
    var lines = [head.join(",")].concat(rows.map(function (r) {
      return [r.ref, r.date, r.time, r.name, r.guests, STATUS_LABEL[r.status] || r.status, r.phone, r.email, r.occasion, r.note].map(csvCell).join(",");
    }));
    var blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "nero-bookings-" + S.today + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast("Exported " + plural(rows.length, "booking"));
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && S.drawer) closeDrawer();
    var typing = /^(INPUT|SELECT|TEXTAREA)$/.test((document.activeElement || {}).tagName || "");
    if (e.key === "/" && !typing && !$("app").hidden) { e.preventDefault(); if (S.view !== "bookings") go("bookings"); $("b-q").focus(); }
  });

  /* ---------- drawer ---------- */
  var opener = null;
  function openDrawer(ref) {
    if (!S.drawer) opener = document.activeElement;
    S.drawer = ref;
    if (ref === NEW) renderNewBooking(); else renderDrawer();
    $("scrim").hidden = false; $("drawer").classList.add("open"); $("drawer").setAttribute("aria-hidden", "false");
    var first = $("drawer").querySelector("input:not([type=checkbox]), .d-x");
    if (first) first.focus({ preventScroll: true });
  }
  function closeDrawer(instant) {
    var was = S.drawer;
    S.drawer = null;
    $("scrim").hidden = true;
    $("drawer").classList.remove("open"); $("drawer").setAttribute("aria-hidden", "true");
    if (was && !instant && opener && opener.focus && document.contains(opener)) opener.focus({ preventScroll: true });
    opener = null;
  }
  $("scrim").addEventListener("click", function () { closeDrawer(); });
  function renderDrawer() {
    if (S.drawer === NEW) return; // never redraw the form while someone is typing in it
    var r = S.res.filter(function (x) { return x.ref === S.drawer; })[0];
    var d = $("drawer");
    if (!r) { closeDrawer(); return; }
    d.innerHTML = "";
    var head = h("div", "d-head"), tt = h("div");
    tt.appendChild(h("div", "d-ref", r.ref));
    tt.appendChild(h("h2", null, r.name));
    var x = h("button", "d-x", "×"); x.type = "button"; x.setAttribute("aria-label", "Close");
    x.addEventListener("click", function () { closeDrawer(); });
    head.appendChild(tt); head.appendChild(x); d.appendChild(head);
    var body = h("div", "d-body");
    var st = h("div"); st.appendChild(pill(r.status)); body.appendChild(st);
    var g = h("div", "d-grid");
    function field(label, value, href) {
      var f = h("div", "d-f"); f.appendChild(h("small", null, label));
      var v = h("div");
      if (href && value) { var a = h("a", null, value); a.href = href; v.appendChild(a); } else v.textContent = value || "Not given";
      f.appendChild(v); g.appendChild(f);
    }
    field("Date", dayLabel(r.date) + ", " + fmt(r.date, { day: "numeric", month: "short" }));
    field("Time", r.time + " to " + hhmm(mins(r.time) + S.dwell));
    field("Party", plural(r.guests, "guest"));
    field("Occasion", r.occasion);
    field("Email", r.email, r.email ? "mailto:" + r.email : null);
    field("Phone", r.phone, r.phone ? "tel:" + r.phone : null);
    body.appendChild(g);
    if (r.note) body.appendChild(h("div", "d-note", r.note));
    if (r.createdAt) body.appendChild(h("p", "hint", "Booked " + new Date(r.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })));
    d.appendChild(body);
    var foot = h("div", "d-foot"); foot.appendChild(actionsFor(r)); d.appendChild(foot);
  }


  /* ---------- new booking (phone call or walk in) ---------- */
  var NEW = "__new";
  $("new-booking").addEventListener("click", function () { openDrawer(NEW); });
  function renderNewBooking() {
    var d = $("drawer"); d.innerHTML = "";
    var head = h("div", "d-head"), tt = h("div");
    tt.appendChild(h("div", "d-ref", "ADD BY HAND"));
    tt.appendChild(h("h2", null, "New booking"));
    var x = h("button", "d-x", "×"); x.type = "button"; x.setAttribute("aria-label", "Close");
    x.addEventListener("click", function () { closeDrawer(); });
    head.appendChild(tt); head.appendChild(x); d.appendChild(head);

    var form = h("form", "d-body nb"); form.noValidate = true;
    function field(label, el) { var l = h("label", null, label); l.appendChild(el); return l; }
    function input(type, attrs) { var i = h("input"); i.type = type; Object.keys(attrs || {}).forEach(function (k) { i.setAttribute(k, attrs[k]); }); return i; }

    var kind = h("div", "chips"), phoneBtn = h("button", "on", "Phone booking"), walkBtn = h("button", null, "Walk in, seat now");
    phoneBtn.type = walkBtn.type = "button"; kind.appendChild(phoneBtn); kind.appendChild(walkBtn);
    form.appendChild(kind);

    var name = input("text", { required: "", maxlength: 80, autocomplete: "off" });
    var phone = input("tel", { maxlength: 20, autocomplete: "off", placeholder: "Optional" });
    var email = input("email", { maxlength: 120, autocomplete: "off", placeholder: "Optional" });
    var date = input("date", { min: S.today, required: "" }); date.value = S.today;
    var time = h("select");
    var guests = input("number", { min: 1, max: 100, required: "" }); guests.value = 2;
    var occasion = input("text", { maxlength: 40, placeholder: "Optional" });
    var note = h("textarea"); note.maxLength = 300; note.rows = 2;
    form.appendChild(field("Guest name", name));
    var two = h("div", "two-f"); two.appendChild(field("Phone", phone)); two.appendChild(field("Email", email)); form.appendChild(two);
    var two2 = h("div", "two-f"); two2.appendChild(field("Date", date)); two2.appendChild(field("Time", time)); form.appendChild(two2);
    var two3 = h("div", "two-f"); two3.appendChild(field("Guests", guests)); two3.appendChild(field("Occasion", occasion)); form.appendChild(two3);
    form.appendChild(field("Note", note));

    var over = input("checkbox"), ol = h("label", "check"); ol.appendChild(over); ol.appendChild(document.createTextNode(" Ignore the seat limit"));
    form.appendChild(ol);
    form.appendChild(h("p", "hint", "No confirmation email is sent from here. Tell the guest their time yourself."));
    var msg = h("p", "msg"); form.appendChild(msg);
    var go = h("button", "btn", "Add booking"); go.type = "submit"; form.appendChild(go);
    d.appendChild(form);

    var walk = false, slots = [];
    function setKind(w) {
      walk = w; phoneBtn.classList.toggle("on", !w); walkBtn.classList.toggle("on", w);
      if (w) { date.value = S.today; loadSlots(true); }
    }
    phoneBtn.addEventListener("click", function () { setKind(false); });
    walkBtn.addEventListener("click", function () { setKind(true); });

    // Seat counts come from the same public availability the booking page uses.
    function loadSlots(pickNow) {
      var want = time.value;
      fetch("/api/availability?date=" + encodeURIComponent(date.value)).then(function (r) { return r.json(); }).then(function (a) {
        slots = a.slots || [];
        time.innerHTML = "";
        if (!slots.length) { var o = h("option", null, "Closed that day"); o.value = ""; time.appendChild(o); return; }
        var nm = nowMin(), best = null;
        slots.forEach(function (sl) {
          var o = h("option", null, sl.time + "   " + (sl.left ? sl.left + " free" : "full")); o.value = sl.time; time.appendChild(o);
          if (mins(sl.time) <= nm) best = sl.time;
        });
        if (pickNow && date.value === S.today && best) time.value = best;
        else if (want && slots.some(function (sl) { return sl.time === want; })) time.value = want;
        else if (date.value === S.today && best) time.value = slots.filter(function (sl) { return mins(sl.time) > nm; }).map(function (sl) { return sl.time; })[0] || best;
      }).catch(function () { var o = h("option", null, "Could not load times"); o.value = ""; time.innerHTML = ""; time.appendChild(o); });
    }
    date.addEventListener("change", function () { loadSlots(false); });
    loadSlots(false);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      msg.textContent = "";
      if (!name.value.trim()) { msg.textContent = "Enter the guest's name."; name.focus(); return; }
      if (!time.value) { msg.textContent = "Pick a time. The cafe is closed on that date."; return; }
      go.disabled = true;
      api("POST", "/api/admin/reservations", {
        name: name.value, phone: phone.value, email: email.value, date: date.value, time: time.value,
        guests: Number(guests.value), occasion: occasion.value, note: note.value, seated: walk, override: over.checked,
      }).then(function (r) {
        var b = r.reservation;
        closeDrawer();
        toast("Added " + b.name + ", " + plural(b.guests, "guest") + ", " + dayLabel(b.date) + " " + b.time);
        if (b.date === S.today && S.view !== "today") go("today");
        return refresh();
      }).catch(function (err) { go.disabled = false; msg.textContent = err.message; });
    });
  }

  /* ---------- insights ---------- */
  function windowDays() {
    var n = S.win === "30" ? 30 : S.win === "7" ? 7 : 14, out = [], i;
    if (S.win === "next14") for (i = 0; i < n; i++) out.push(addDays(S.today, i));
    else for (i = n - 1; i >= 0; i--) out.push(addDays(S.today, -i));
    return out;
  }
  $("i-win").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-v]");
    if (!b) return;
    S.win = b.dataset.v;
    [].forEach.call($("i-win").children, function (x) { x.classList.toggle("on", x === b); });
    renderInsights(true);
  });
  function renderInsights(animate) {
    var days = windowDays(), set = {};
    days.forEach(function (d) { set[d] = 1; });
    var rows = S.res.filter(function (r) { return set[r.date]; });
    var kept = rows.filter(function (r) { return r.status !== "cancelled"; });
    var covers = kept.reduce(function (s, r) { return s + r.guests; }, 0);
    var count = function (st) { return rows.filter(function (r) { return r.status === st; }).length; };
    var resolved = count("completed") + count("seated") + count("no_show");
    var ns = resolved ? Math.round(count("no_show") / resolved * 100) : null;
    var k = $("i-kpis"); k.innerHTML = "";
    kpi(k, "Bookings", kept.length, null, animate);
    kpi(k, "Covers", covers, null, animate);
    kpi(k, "Average party", kept.length ? (covers / kept.length).toFixed(1) : "0", { small: "guests" }, false);
    kpi(k, "No show rate", ns == null ? "None yet" : ns, ns == null ? null : { suffix: "%" }, animate);
    kpi(k, "Cancelled", count("cancelled"), null, animate);

    // bookings per day
    var perDay = days.map(function (d) {
      var l = kept.filter(function (r) { return r.date === d; });
      return { d: d, n: l.length, c: l.reduce(function (s, r) { return s + r.guests; }, 0) };
    });
    var max = Math.max.apply(null, perDay.map(function (x) { return x.n; }).concat([1]));
    $("i-days-sub").textContent = S.win === "next14" ? "Confirmed and upcoming" : "Excluding cancelled";
    drawBars($("chart-days"), perDay.map(function (x) {
      return { label: perDay.length > 14 ? (new Date(x.d + "T00:00:00Z").getUTCDate() % 3 === 1 ? fmt(x.d, { day: "numeric" }) : "") : fmt(x.d, { weekday: "short", day: "numeric" }), v: x.n, now: x.d === S.today, tip: fmt(x.d, { weekday: "long", day: "numeric", month: "short" }) + "\n" + plural(x.n, "booking") + ", " + plural(x.c, "cover") };
    }), max, animate, perDay.length <= 14);

    // busy hours (guests by start hour)
    var byHour = {};
    kept.forEach(function (r) { var hr = Math.floor(mins(r.time) / 60); byHour[hr] = (byHour[hr] || 0) + r.guests; });
    var hrs = []; for (var hh = 8; hh <= 22; hh++) hrs.push(hh);
    var hmax = Math.max.apply(null, hrs.map(function (x) { return byHour[x] || 0; }).concat([1]));
    drawBars($("chart-hours"), hrs.map(function (x) {
      return { label: ("0" + x).slice(-2), v: byHour[x] || 0, tip: hhmm(x * 60) + " hour\n" + plural(byHour[x] || 0, "guest") };
    }), hmax, animate, false);

    drawDonut($("chart-status"), ["confirmed", "seated", "completed", "no_show", "cancelled"].map(function (s) { return [s, count(s)]; }), rows.length);
  }
  var COLORS = { confirmed: "#d6a45f", seated: "#e0c070", completed: "#8fb98b", no_show: "#d0654f", cancelled: "#7d6a5a" };
  function drawBars(box, items, max, animate, showVals) {
    box.innerHTML = "";
    var bars = h("div", "bars"), axis = h("div", "axis");
    bars.style.gridTemplateColumns = axis.style.gridTemplateColumns = "repeat(" + items.length + ",minmax(0,1fr))";
    items.forEach(function (it) {
      var b = h("div", "bar" + (it.now ? " now" : "") + (it.v ? "" : " zero")), i = h("i");
      var p = it.v / max * 86;
      b.style.setProperty("--h", animate ? "0%" : p + "%");
      if (animate) setTimeout(function () { b.style.setProperty("--h", p + "%"); }, 40);
      b.setAttribute("data-tip", it.tip);
      b.appendChild(i);
      if (showVals && it.v) b.appendChild(h("b", null, String(it.v)));
      bars.appendChild(b);
      axis.appendChild(h("span", null, it.label));
    });
    box.appendChild(bars); box.appendChild(axis);
  }
  function drawDonut(box, parts, total) {
    box.innerHTML = "";
    var NS = "http://www.w3.org/2000/svg", R = 40, C = 2 * Math.PI * R;
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 100 100"); svg.setAttribute("class", "donut");
    var track = document.createElementNS(NS, "circle");
    track.setAttribute("cx", 50); track.setAttribute("cy", 50); track.setAttribute("r", R); track.setAttribute("stroke", "#3d2d22");
    svg.appendChild(track);
    var off = 0;
    parts.forEach(function (p) {
      if (!p[1] || !total) return;
      var len = p[1] / total * C, c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", 50); c.setAttribute("cy", 50); c.setAttribute("r", R);
      c.setAttribute("stroke", COLORS[p[0]]);
      c.setAttribute("stroke-dasharray", Math.max(len - 1.5, 0.5) + " " + C);
      c.setAttribute("stroke-dashoffset", -off);
      c.setAttribute("transform", "rotate(-90 50 50)");
      c.setAttribute("data-tip", STATUS_LABEL[p[0]] + "\n" + plural(p[1], "booking") + " (" + Math.round(p[1] / total * 100) + "%)");
      svg.appendChild(c);
      off += len;
    });
    var big = document.createElementNS(NS, "text");
    big.setAttribute("x", 50); big.setAttribute("y", 54); big.setAttribute("font-size", 20); big.setAttribute("font-family", "Cormorant Garamond,serif");
    big.textContent = total;
    var lab = document.createElementNS(NS, "text");
    lab.setAttribute("x", 50); lab.setAttribute("y", 66); lab.setAttribute("font-size", 6); lab.setAttribute("fill", "#bca994"); lab.style.fill = "#bca994";
    lab.textContent = "BOOKINGS";
    svg.appendChild(big); svg.appendChild(lab);
    box.appendChild(svg);
    var ul = h("ul", "dl");
    parts.forEach(function (p) {
      var li = h("li"), sw = h("i");
      sw.style.background = COLORS[p[0]];
      li.appendChild(sw); li.appendChild(h("span", null, STATUS_LABEL[p[0]])); li.appendChild(h("b", null, String(p[1])));
      ul.appendChild(li);
    });
    box.appendChild(ul);
  }

  /* ---------- menu ---------- */
  var menuData = null;
  function loadMenu() {
    api("GET", "/api/admin/menu").then(function (data) {
      menuData = data;
      var sel = $("n-cat");
      if (!sel.options.length) data.categories.forEach(function (c) { var o = h("option", null, c.label); o.value = c.key; sel.appendChild(o); });
      drawMenu();
    }).catch(fail);
  }
  function drawMenu() {
    if (!menuData) return;
    var q = S.menuQ.trim().toLowerCase(), box = $("menu-groups");
    box.innerHTML = "";
    menuData.categories.forEach(function (c) {
      var items = menuData.menu[c.key].items.filter(function (it) { return !q || (it.name + " " + (it.note || "")).toLowerCase().indexOf(q) >= 0; });
      if (!items.length) return;
      var g = h("div", "card mgroup");
      g.appendChild(h("h2", null, c.label));
      items.forEach(function (it) { g.appendChild(menuRow(it)); });
      box.appendChild(g);
    });
    if (!box.children.length) box.appendChild(h("p", "empty", "No items match."));
  }
  $("m-q").addEventListener("input", function (e) { S.menuQ = e.target.value; drawMenu(); });
  function menuRow(it) {
    var row = h("div", "mrow" + (it.available ? "" : " off"));
    var nm = h("div", "mname", it.name);
    if (it.note) nm.appendChild(h("small", null, it.note));
    row.appendChild(nm);
    var price = h("input");
    price.type = "number"; price.min = "0"; price.value = it.price;
    price.setAttribute("aria-label", "Price for " + it.name);
    price.addEventListener("change", function () {
      api("PATCH", "/api/admin/menu/items/" + it.id, { price: Number(price.value) }).then(function () { it.price = Number(price.value); toast("Price saved"); }).catch(function (e) { fail(e); price.value = it.price; });
    });
    row.appendChild(price);
    var tog = h("button", "btn sm " + (it.available ? "ghost" : ""), it.available ? "Mark sold out" : "Back on");
    tog.type = "button";
    tog.addEventListener("click", function () {
      api("PATCH", "/api/admin/menu/items/" + it.id, { available: !it.available }).then(function () { it.available = !it.available; drawMenu(); toast(it.available ? it.name + " is back on" : it.name + " marked sold out"); }).catch(fail);
    });
    row.appendChild(tog);
    var del = h("button", "btn sm bad", "Delete");
    del.type = "button";
    del.addEventListener("click", function () {
      if (!del.classList.contains("armed")) {
        del.classList.add("armed"); del.textContent = "Sure?";
        setTimeout(function () { del.classList.remove("armed"); del.textContent = "Delete"; }, 3000);
        return;
      }
      api("DELETE", "/api/admin/menu/items/" + it.id).then(function () { toast("Deleted " + it.name); loadMenu(); }).catch(fail);
    });
    row.appendChild(del);
    return row;
  }
  $("add-item").addEventListener("submit", function (e) {
    e.preventDefault();
    api("POST", "/api/admin/menu/items", {
      category: $("n-cat").value, name: $("n-name").value, price: Number($("n-price").value),
      note: $("n-note").value, veg: $("n-veg").value === "" ? null : $("n-veg").value,
    }).then(function () { $("add-item").reset(); toast("Added to the menu"); loadMenu(); }).catch(fail);
  });

  /* ---------- settings ---------- */
  function loadSettings() {
    api("GET", "/api/admin/settings").then(function (s) { $("s-seats").value = s.seats; $("s-dwell").value = s.dwellMin; $("s-msg").textContent = ""; }).catch(fail);
  }
  $("settings-form").addEventListener("submit", function (e) {
    e.preventDefault();
    api("PUT", "/api/admin/settings", { seats: Number($("s-seats").value), dwellMin: Number($("s-dwell").value) })
      .then(function () { $("s-msg").className = "msg ok"; $("s-msg").textContent = "Saved."; refresh(); })
      .catch(function (err) { $("s-msg").className = "msg"; $("s-msg").textContent = err.message; });
  });

  /* ---------- password (n8n backend only; on Render it comes from NERO_ADMIN_PASSWORD) ---------- */
  if (window.NERO_N8N) $("pw-card").hidden = false;
  $("pw-form").addEventListener("submit", function (e) {
    e.preventDefault();
    api("POST", "/api/admin/password", { current: $("pw-cur").value, next: $("pw-new").value })
      .then(function () { $("pw-form").reset(); $("pw-msg").className = "msg ok"; $("pw-msg").textContent = "Password changed."; })
      .catch(function (err) { $("pw-msg").className = "msg"; $("pw-msg").textContent = err.message; });
  });

  /* ---------- start ---------- */
  api("GET", "/api/admin/me").then(function (r) { r.ok ? showApp() : showLogin(); }).catch(showLogin);
})();
