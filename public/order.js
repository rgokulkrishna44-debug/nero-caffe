/* Order ahead for pickup. Only loaded when the Express back end serves the site;
   the static live page leaves this out. Prices are re-checked on the server. */
(function () {
  var cart = {}; // id -> { id, name, price, qty }
  var HOURS = { 0: [9, 22], 1: null, 2: [8, 22], 3: [8, 22], 4: [8, 22], 5: [8, 23], 6: [8, 23] };
  var LAST_PICKUP = 21.5;
  var LEAD_MIN = 20;
  var controls = {}; // id -> control element, so every button can refresh when the cart changes

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function money(n) { return "₹" + n; }
  function count() { return Object.keys(cart).reduce(function (n, id) { return n + cart[id].qty; }, 0); }
  function total() { return Object.keys(cart).reduce(function (n, id) { return n + cart[id].qty * cart[id].price; }, 0); }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function setQty(item, qty) {
    if (qty <= 0) delete cart[item.id];
    else cart[item.id] = { id: item.id, name: item.name, price: item.price, qty: Math.min(qty, 20) };
    refresh();
  }

  function renderControl(box, item) {
    box.innerHTML = "";
    var qty = cart[item.id] ? cart[item.id].qty : 0;
    if (!qty) {
      var add = el("button", "add-btn", "Add");
      add.type = "button";
      add.setAttribute("aria-label", "Add " + item.name + " to your order");
      add.addEventListener("click", function () { setQty(item, 1); });
      box.appendChild(add);
      return;
    }
    var minus = el("button", "step-btn", "−");
    minus.type = "button";
    minus.setAttribute("aria-label", "One less " + item.name);
    minus.addEventListener("click", function () { setQty(item, qty - 1); });
    var plus = el("button", "step-btn", "+");
    plus.type = "button";
    plus.setAttribute("aria-label", "One more " + item.name);
    plus.addEventListener("click", function () { setQty(item, qty + 1); });
    box.appendChild(minus);
    box.appendChild(el("span", "step-qty", String(qty)));
    box.appendChild(plus);
  }

  function decorate(row, item) {
    var box = el("span", "order-control");
    if (item.available === false) {
      box.appendChild(el("span", "sold-tag", "Sold out"));
    } else {
      controls[item.id] = { box: box, item: item };
      renderControl(box, item);
    }
    row.appendChild(box);
  }

  /* ---------- Floating bar + checkout dialog ---------- */
  var bar = el("div", "order-bar");
  bar.hidden = true;
  var barText = el("span", "order-bar-text");
  var barBtn = el("button", "btn btn-solid btn-small", "Review order");
  barBtn.type = "button";
  bar.appendChild(barText);
  bar.appendChild(barBtn);

  var dlg = document.createElement("dialog");
  dlg.className = "order-dialog";
  dlg.setAttribute("aria-label", "Your pickup order");

  function refresh() {
    Object.keys(controls).forEach(function (id) { renderControl(controls[id].box, controls[id].item); });
    var n = count();
    bar.hidden = n === 0 || dlg.open;
    barText.textContent = n + (n === 1 ? " item" : " items") + " · " + money(total());
    if (dlg.open) renderDialog();
  }

  function pickupOptions() {
    var now = new Date();
    var hours = HOURS[now.getDay()];
    if (!hours) return { closed: "We're closed today, so pickup orders open again tomorrow." };
    var earliest = now.getHours() * 60 + now.getMinutes() + LEAD_MIN;
    earliest = Math.max(Math.ceil(earliest / 15) * 15, hours[0] * 60);
    var out = [];
    for (var m = earliest; m <= LAST_PICKUP * 60; m += 15) out.push(pad(Math.floor(m / 60)) + ":" + pad(m % 60));
    if (!out.length) return { closed: "The kitchen has stopped taking pickup orders for today. Please come back tomorrow." };
    return { slots: out };
  }

  var formState = { name: "", phone: "", pickup: "", note: "" };

  function field(label, input, hint) {
    var wrap = el("div", "field");
    var l = el("label", null, label);
    l.setAttribute("for", input.id);
    wrap.appendChild(l);
    wrap.appendChild(input);
    if (hint) wrap.appendChild(el("p", "field-hint", hint));
    return wrap;
  }

  function renderDialog() {
    dlg.innerHTML = "";
    var head = el("div", "od-head");
    head.appendChild(el("h3", null, "Your pickup order"));
    var close = el("button", "od-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", function () { dlg.close(); });
    head.appendChild(close);
    dlg.appendChild(head);

    if (!count()) {
      dlg.appendChild(el("p", "od-empty", "Your order is empty. Tap Add on any dish in the menu."));
      return;
    }

    var list = el("ul", "od-list");
    Object.keys(cart).forEach(function (id) {
      var line = cart[id];
      var li = el("li");
      li.appendChild(el("span", "od-name", line.name));
      var box = el("span", "order-control");
      renderControl(box, line);
      li.appendChild(box);
      li.appendChild(el("span", "od-price", money(line.price * line.qty)));
      list.appendChild(li);
    });
    dlg.appendChild(list);
    var totalRow = el("p", "od-total");
    totalRow.appendChild(el("span", null, "Total, taxes included"));
    totalRow.appendChild(el("strong", null, money(total())));
    dlg.appendChild(totalRow);

    var form = el("form", "od-form");
    form.noValidate = true;
    var name = el("input");
    name.id = "od-name"; name.type = "text"; name.autocomplete = "name"; name.value = formState.name;
    var phone = el("input");
    phone.id = "od-phone"; phone.type = "tel"; phone.inputMode = "numeric"; phone.maxLength = 14;
    phone.placeholder = "98765 43210"; phone.value = formState.phone;
    var pickup = el("select");
    pickup.id = "od-pickup";
    var opts = pickupOptions();
    if (opts.closed) {
      form.appendChild(el("p", "form-message", opts.closed));
    } else {
      opts.slots.forEach(function (t) {
        var o = el("option", null, t);
        o.value = t;
        pickup.appendChild(o);
      });
      if (formState.pickup) pickup.value = formState.pickup;
    }
    var note = el("textarea");
    note.id = "od-note"; note.rows = 2; note.placeholder = "Allergies, extra hot, no sugar…"; note.value = formState.note;

    form.appendChild(field("Your name", name));
    form.appendChild(field("WhatsApp number", phone, "We message you here when your order is ready."));
    if (!opts.closed) form.appendChild(field("Pickup time today", pickup, "Pay at the counter when you collect."));
    form.appendChild(field("Note for the kitchen", note));
    var msg = el("p", "form-message");
    msg.setAttribute("role", "alert");
    var submit = el("button", "btn btn-solid", "Place order");
    submit.type = "submit";
    submit.disabled = !!opts.closed;
    form.appendChild(submit);
    form.appendChild(msg);
    dlg.appendChild(form);

    [name, phone, pickup, note].forEach(function (inp) {
      inp.addEventListener("input", function () {
        formState = { name: name.value, phone: phone.value, pickup: pickup.value, note: note.value };
      });
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      msg.textContent = "";
      if (!name.value.trim() || !phone.value.trim()) {
        msg.textContent = "Please add your name and WhatsApp number.";
        return;
      }
      submit.disabled = true;
      submit.textContent = "Placing your order…";
      fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.value.trim(),
          phone: phone.value,
          pickup: pickup.value,
          note: note.value.trim(),
          items: Object.keys(cart).map(function (id) { return { id: cart[id].id, qty: cart[id].qty }; }),
        }),
      })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) {
            if (!res.ok || !data.ok) throw new Error(data.error || "Something went wrong. Please try again.");
            showDone(name.value.trim(), data);
          });
        })
        .catch(function (err) {
          msg.textContent = err instanceof TypeError ? "We couldn't reach the kitchen. Check your connection and try again." : err.message;
          submit.disabled = false;
          submit.textContent = "Place order";
        });
    });
  }

  function showDone(name, data) {
    cart = {};
    formState = { name: "", phone: "", pickup: "", note: "" };
    Object.keys(controls).forEach(function (id) { renderControl(controls[id].box, controls[id].item); });
    bar.hidden = true;
    dlg.innerHTML = "";
    var box = el("div", "od-done");
    box.appendChild(el("h3", null, "Grazie, " + name.split(" ")[0] + ". Order received."));
    box.appendChild(el("p", null, "Pickup at " + data.pickup + " today. Total " + money(data.total) + ", paid at the counter."));
    var ref = el("p", "ref");
    ref.appendChild(document.createTextNode("Order reference "));
    ref.appendChild(el("strong", null, data.ref));
    box.appendChild(ref);
    var ok = el("button", "btn btn-ghost", "Done");
    ok.type = "button";
    ok.addEventListener("click", function () { dlg.close(); });
    box.appendChild(ok);
    dlg.appendChild(box);
  }

  barBtn.addEventListener("click", function () {
    renderDialog();
    dlg.showModal();
    bar.hidden = true;
  });
  dlg.addEventListener("close", function () { refresh(); });
  dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });

  function mount() {
    document.body.appendChild(bar);
    document.body.appendChild(dlg);
    var head = document.querySelector("#menu .section-head");
    if (head) {
      var tip = el("p", "order-tip", "Order ahead for pickup today. Tap Add on any dish, choose a time, and pay at the counter.");
      head.appendChild(tip);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();

  window.NeroOrder = { decorate: decorate };
})();
