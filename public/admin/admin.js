(function () {
  var $ = function (id) { return document.getElementById(id); };
  var current = "today";
  var timer = null;

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
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function fail(err) { if (err.message !== "signed out") toast(err.message); }

  function fmtDate(iso) {
    return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  }
  function pill(status) { return h("span", "pill " + status, status.replace("_", " ")); }
  function localISO(d) { return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }

  /* ---------- sign in ---------- */
  function showLogin() {
    clearInterval(timer);
    $("app").hidden = true;
    $("login").hidden = false;
    $("pw").focus();
  }
  function showApp() {
    $("login").hidden = true;
    $("app").hidden = false;
    $("b-from").value = $("b-from").value || localISO(new Date());
    go(current);
    clearInterval(timer);
    timer = setInterval(function () { go(current, true); }, 20000);
  }
  $("login-form").addEventListener("submit", function (e) {
    e.preventDefault();
    api("POST", "/api/admin/login", { password: $("pw").value })
      .then(function () { $("pw").value = ""; $("login-msg").textContent = ""; showApp(); })
      .catch(function (err) { $("login-msg").textContent = err.message; });
  });
  $("logout").addEventListener("click", function () { api("POST", "/api/admin/logout").then(showLogin); });

  /* ---------- tabs ---------- */
  $("tabs").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-tab]");
    if (b) go(b.dataset.tab);
  });
  function go(tab, quiet) {
    current = tab;
    [].forEach.call(document.querySelectorAll("#tabs button"), function (b) { b.classList.toggle("on", b.dataset.tab === tab); });
    [].forEach.call(document.querySelectorAll(".tab"), function (s) { s.hidden = s.id !== "tab-" + tab; });
    var load = { today: loadToday, bookings: loadBookings, orders: loadOrders, menu: loadMenu, settings: loadSettings }[tab];
    load(quiet);
    if (tab !== "orders") badge();
  }

  function badge() {
    api("GET", "/api/admin/stats").then(function (s) {
      $("order-badge").hidden = !s.openOrders;
      $("order-badge").textContent = s.openOrders;
    }).catch(fail);
  }

  /* ---------- today ---------- */
  function loadToday() {
    api("GET", "/api/admin/stats").then(function (s) {
      var k = $("kpis");
      k.innerHTML = "";
      [
        [s.bookingsToday, "Bookings today"], [s.coversToday, "Covers today"],
        [s.openOrders, "Open pickup orders"], ["₹" + s.orderSalesToday, "Pickup sales today (" + s.ordersToday + ")"],
        [s.noShowRate + "%", "No-show rate"],
      ].forEach(function (p) {
        var d = h("div", "kpi");
        d.appendChild(h("b", null, String(p[0])));
        d.appendChild(h("span", null, p[1]));
        k.appendChild(d);
      });
      return api("GET", "/api/admin/reservations?date=" + s.today);
    }).then(function (rows) {
      var box = $("today-list");
      box.innerHTML = "";
      if (!rows.length) { box.appendChild(h("p", "empty", "No bookings today.")); return; }
      box.appendChild(bookingTable(rows, false));
    }).catch(fail);
    api("GET", "/api/admin/digest").then(function (d) { $("digest").textContent = d.text; }).catch(fail);
  }
  $("copy-digest").addEventListener("click", function () {
    navigator.clipboard.writeText($("digest").textContent).then(function () { toast("Copied"); });
  });

  /* ---------- bookings ---------- */
  function bookingTable(rows, showDate) {
    var t = h("table");
    var head = h("tr");
    (showDate ? ["Date", "Time", "Guest", "Party", "Status", ""] : ["Time", "Guest", "Party", "Status", ""]).forEach(function (c) { head.appendChild(h("th", null, c)); });
    t.appendChild(head);
    rows.forEach(function (r) {
      var tr = h("tr");
      if (showDate) tr.appendChild(h("td", null, fmtDate(r.date)));
      tr.appendChild(h("td", null, r.time));
      var who = h("td");
      who.appendChild(h("div", null, r.name));
      who.appendChild(h("small", "hint", r.phone + (r.occasion ? " · " + r.occasion : "") + " · " + r.ref));
      if (r.note) who.appendChild(h("div", "hint", "Note: " + r.note));
      tr.appendChild(who);
      tr.appendChild(h("td", null, String(r.guests)));
      var st = h("td"); st.appendChild(pill(r.status)); tr.appendChild(st);
      var acts = h("td", "acts");
      var buttons = {
        confirmed: [["Seat", "seated"], ["No show", "no_show"], ["Cancel", "cancelled"]],
        seated: [["Done", "completed"]],
        completed: [], no_show: [["Undo", "confirmed"]], cancelled: [["Undo", "confirmed"]],
      }[r.status] || [];
      buttons.forEach(function (b) {
        var btn = h("button", "btn sm " + (b[1] === "cancelled" || b[1] === "no_show" ? "bad" : "ghost"), b[0]);
        btn.addEventListener("click", function () {
          api("PATCH", "/api/admin/reservations/" + r.ref, { status: b[1] }).then(function () { go(current, true); }).catch(fail);
        });
        acts.appendChild(btn);
      });
      tr.appendChild(acts);
      t.appendChild(tr);
    });
    return t;
  }
  function loadBookings() {
    var q = "?from=" + encodeURIComponent($("b-from").value) + ($("b-status").value ? "&status=" + $("b-status").value : "");
    api("GET", "/api/admin/reservations" + q).then(function (rows) {
      var box = $("b-table");
      box.innerHTML = "";
      box.appendChild(rows.length ? bookingTable(rows, true) : h("p", "empty", "No bookings match."));
    }).catch(fail);
  }
  $("b-from").addEventListener("change", loadBookings);
  $("b-status").addEventListener("change", loadBookings);

  /* ---------- orders ---------- */
  var NEXT = { new: ["Start", "preparing"], preparing: ["Ready", "ready"], ready: ["Collected", "collected"] };
  function loadOrders() {
    api("GET", "/api/admin/orders" + ($("o-all").checked ? "?scope=all" : "")).then(function (orders) {
      var open = orders.filter(function (o) { return NEXT[o.status]; }).length;
      $("order-badge").hidden = !open;
      $("order-badge").textContent = open;
      var board = $("o-board");
      board.innerHTML = "";
      if (!orders.length) { board.appendChild(h("p", "empty", "No open orders.")); return; }
      orders.forEach(function (o) {
        var c = h("div", "order");
        var head = h("header");
        head.appendChild(h("b", null, o.pickup));
        head.appendChild(pill(o.status));
        c.appendChild(head);
        c.appendChild(h("div", "meta", o.name + " · " + o.phone + " · " + o.ref + (o.pickupDate !== localISO(new Date()) ? " · " + fmtDate(o.pickupDate) : "")));
        var ul = h("ul");
        o.items.forEach(function (i) { ul.appendChild(h("li", null, i.qty + " × " + i.name)); });
        c.appendChild(ul);
        if (o.note) c.appendChild(h("div", "note", "Note: " + o.note));
        c.appendChild(h("div", "meta", "Total ₹" + o.total + ", pay at counter"));
        var acts = h("div", "acts");
        if (NEXT[o.status]) {
          var go1 = h("button", "btn sm", NEXT[o.status][0]);
          go1.addEventListener("click", function () { setOrder(o.ref, NEXT[o.status][1]); });
          acts.appendChild(go1);
          var no = h("button", "btn sm bad", "Cancel");
          no.addEventListener("click", function () { setOrder(o.ref, "cancelled"); });
          acts.appendChild(no);
        }
        c.appendChild(acts);
        board.appendChild(c);
      });
    }).catch(fail);
  }
  function setOrder(ref, status) {
    api("PATCH", "/api/admin/orders/" + ref, { status: status }).then(loadOrders).catch(fail);
  }
  $("o-all").addEventListener("change", loadOrders);

  /* ---------- menu ---------- */
  function loadMenu(quiet) {
    if (quiet && document.activeElement && document.activeElement.closest("#menu-groups")) return; // don't wipe an edit in progress
    api("GET", "/api/admin/menu").then(function (data) {
      var sel = $("n-cat");
      if (!sel.options.length) {
        data.categories.forEach(function (c) { var o = h("option", null, c.label); o.value = c.key; sel.appendChild(o); });
      }
      var box = $("menu-groups");
      box.innerHTML = "";
      data.categories.forEach(function (c) {
        var g = h("div", "card mgroup");
        g.appendChild(h("h2", null, c.label));
        data.menu[c.key].items.forEach(function (it) { g.appendChild(menuRow(it)); });
        box.appendChild(g);
      });
    }).catch(fail);
  }
  function menuRow(it) {
    var row = h("div", "mrow" + (it.available ? "" : " off"));
    var nm = h("div", "mname", it.name);
    if (it.note) nm.appendChild(h("small", null, it.note));
    row.appendChild(nm);
    var price = h("input");
    price.type = "number"; price.min = "0"; price.value = it.price;
    price.setAttribute("aria-label", "Price for " + it.name);
    price.addEventListener("change", function () {
      api("PATCH", "/api/admin/menu/items/" + it.id, { price: Number(price.value) }).then(function () { toast("Price saved"); }).catch(function (e) { fail(e); price.value = it.price; });
    });
    row.appendChild(price);
    var tog = h("button", "btn sm " + (it.available ? "ghost" : ""), it.available ? "Mark sold out" : "Back on");
    tog.addEventListener("click", function () {
      api("PATCH", "/api/admin/menu/items/" + it.id, { available: !it.available }).then(function () { loadMenu(); }).catch(fail);
    });
    row.appendChild(tog);
    var del = h("button", "btn sm bad", "Delete");
    del.addEventListener("click", function () {
      if (!window.confirm("Delete " + it.name + " from the menu?")) return;
      api("DELETE", "/api/admin/menu/items/" + it.id).then(function () { loadMenu(); }).catch(fail);
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
    api("GET", "/api/admin/settings").then(function (s) { $("s-seats").value = s.seats; $("s-dwell").value = s.dwellMin; }).catch(fail);
  }
  $("settings-form").addEventListener("submit", function (e) {
    e.preventDefault();
    api("PUT", "/api/admin/settings", { seats: Number($("s-seats").value), dwellMin: Number($("s-dwell").value) })
      .then(function () { $("s-msg").className = "msg ok"; $("s-msg").textContent = "Saved."; })
      .catch(function (err) { $("s-msg").className = "msg"; $("s-msg").textContent = err.message; });
  });

  /* ---------- start ---------- */
  api("GET", "/api/admin/me").then(function (r) { r.ok ? showApp() : showLogin(); }).catch(showLogin);
})();
