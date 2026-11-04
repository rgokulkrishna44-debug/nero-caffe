(function () {
  var RESERVATION_ENDPOINT = "/api/reservations";
  var MENU_ENDPOINT = "/api/menu";

  var nav = document.getElementById("nav");
  var toggle = document.getElementById("nav-toggle");
  var navLinks = document.getElementById("nav-links");

  function onScroll() {
    nav.classList.toggle("scrolled", window.scrollY > 40);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  toggle.addEventListener("click", function () {
    var open = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
    document.body.style.overflow = open ? "hidden" : "";
  });
  navLinks.addEventListener("click", function (e) {
    if (e.target.closest("a") && nav.classList.contains("open")) {
      nav.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
      document.body.style.overflow = "";
    }
  });

  var sectionLinks = [].slice.call(navLinks.querySelectorAll('a[href^="#"]:not(.btn)'));
  if ("IntersectionObserver" in window) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var id = "#" + entry.target.id;
        sectionLinks.forEach(function (a) { a.classList.toggle("active", a.getAttribute("href") === id); });
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    [].slice.call(document.querySelectorAll("main section[id]")).forEach(function (section) { spy.observe(section); });
  }

  /* ---------- Scroll reveal ---------- */
  function setupReveal() {
    var targets = [].slice.call(document.querySelectorAll(".reveal, .collage"));
    [].slice.call(document.querySelectorAll(".sig-grid, .steps, .stats")).forEach(function (group) {
      [].slice.call(group.children).forEach(function (child, i) { child.style.setProperty("--stagger", (i % 3) * 0.12 + "s"); });
    });
    [].slice.call(document.querySelectorAll(".collage figure")).forEach(function (fig, i) {
      fig.style.setProperty("--stagger", i * 0.08 + "s");
    });

    if (!("IntersectionObserver" in window)) {
      targets.forEach(function (el) { el.classList.add("is-visible"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    targets.forEach(function (el) { io.observe(el); });
  }

  /* ---------- Menu ---------- */
  function renderMenu(menu) {
    var groupsEl = document.getElementById("menu-groups");
    groupsEl.innerHTML = "";
    Object.keys(menu).forEach(function (key) {
      var category = menu[key];
      var group = document.createElement("div");
      group.className = "menu-group reveal";

      var heading = document.createElement("h3");
      heading.textContent = category.label;
      group.appendChild(heading);

      category.items.forEach(function (item) {
        var row = document.createElement("div");
        row.className = "menu-item";

        var copy = document.createElement("span");
        copy.className = "item-copy";
        var name = document.createElement("span");
        name.className = "item-name";
        if (typeof item.veg === "boolean") {
          var dot = document.createElement("i");
          dot.className = "dot " + (item.veg ? "veg" : "nonveg");
          dot.setAttribute("aria-label", item.veg ? "Vegetarian" : "Non-vegetarian");
          name.appendChild(dot);
        }
        name.appendChild(document.createTextNode(item.name));
        copy.appendChild(name);
        if (item.note) {
          var note = document.createElement("span");
          note.className = "item-note";
          note.textContent = item.note;
          copy.appendChild(note);
        }

        var price = document.createElement("span");
        price.className = "price";
        price.textContent = "₹" + item.price;

        row.appendChild(copy);
        row.appendChild(price);
        if (item.available === false) row.classList.add("sold-out");
        group.appendChild(row);
      });
      groupsEl.appendChild(group);
    });
  }

  function loadMenu() {
    if (window.NERO_MENU) {
      renderMenu(window.NERO_MENU);
      return Promise.resolve();
    }
    return fetch(MENU_ENDPOINT)
      .then(function (res) {
        if (!res.ok) throw new Error("menu");
        return res.json();
      })
      .then(renderMenu)
      .catch(function () {
        document.getElementById("menu-groups").innerHTML =
          '<p class="menu-loading">The menu could not be loaded right now.</p>';
      });
  }

  /* ---------- Hours ---------- */
  var HOURS = { 0: [9, 22], 1: null, 2: [8, 22], 3: [8, 22], 4: [8, 22], 5: [8, 23], 6: [8, 23] };
  var LAST_SEATING_HOUR = 21.5;

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function localISO(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function fmtHour(h) { return pad(Math.floor(h)) + ":" + (h % 1 ? "30" : "00"); }

  function setupHours() {
    var day = new Date().getDay();
    var li = document.querySelector('#hours li[data-day="' + day + '"]');
    if (li) li.classList.add("today");
    var todayEl = document.getElementById("today-hours");
    var h = HOURS[day];
    todayEl.textContent = h ? fmtHour(h[0]) + " – " + fmtHour(h[1]) : "Closed today";
  }

  /* ---------- Booking ---------- */
  var form = document.getElementById("reservation-form");
  var message = document.getElementById("form-message");
  var submitBtn = document.getElementById("submit-btn");
  var done = document.getElementById("booking-done");
  var timeSelect = form.elements.time;
  var dateInput = form.elements.date;
  var guestsSelect = form.elements.guests;
  // Seats left per slot, from the Express back end. Stays null on the static live page.
  var availability = null;

  function loadAvailability() {
    availability = null;
    if (window.NERO_MENU || !dateInput.value) return Promise.resolve();
    var asked = dateInput.value;
    return fetch("/api/availability?date=" + encodeURIComponent(asked))
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (data && asked === dateInput.value) {
          availability = {};
          data.slots.forEach(function (slot) { availability[slot.time] = slot.left; });
        }
      })
      .catch(function () {});
  }

  function fillTimeSlots() {
    var previous = timeSelect.value;
    timeSelect.innerHTML = "";
    if (!dateInput.value) {
      timeSelect.innerHTML = "<option value=''>Pick a date first</option>";
      return;
    }
    var date = new Date(dateInput.value + "T00:00:00");
    var hours = HOURS[date.getDay()];
    if (!hours) {
      timeSelect.innerHTML = "<option value=''>Closed on Mondays</option>";
      return;
    }
    var now = new Date();
    var isToday = dateInput.value === localISO(now);
    var earliest = isToday ? now.getHours() + now.getMinutes() / 60 + 0.5 : 0;
    var count = 0;
    for (var t = hours[0]; t <= LAST_SEATING_HOUR; t += 0.5) {
      if (t < earliest) continue;
      var opt = document.createElement("option");
      opt.value = opt.textContent = fmtHour(t);
      var left = availability ? availability[opt.value] : undefined;
      if (left !== undefined && left < Number(guestsSelect.value || 1)) {
        opt.disabled = true;
        opt.textContent += left === 0 ? " (full)" : " (only " + left + " seat" + (left > 1 ? "s" : "") + ")";
      } else {
        count++;
      }
      timeSelect.appendChild(opt);
    }
    if (!count) {
      timeSelect.innerHTML = "<option value=''>" + (isToday ? "No tables left today" : "No tables left that day") + "</option>";
      return;
    }
    if (previous) timeSelect.value = previous;
    if (!timeSelect.value || timeSelect.selectedOptions[0].disabled) {
      var firstOpen = [].slice.call(timeSelect.options).filter(function (o) { return !o.disabled; })[0];
      timeSelect.value = firstOpen.value;
    }
  }

  function markInvalid(field, bad) {
    field.classList.toggle("invalid", bad);
    if (bad) field.setAttribute("aria-invalid", "true");
    else field.removeAttribute("aria-invalid");
  }

  // Returns the trimmed address, or "" when it doesn't look like an email.
  function cleanEmail(raw) {
    var v = String(raw).trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 120 ? v : "";
  }

  function validate(p) {
    var f = form.elements;
    var problems = [];
    markInvalid(f.name, !p.name);
    if (!p.name) problems.push("your name");
    markInvalid(f.email, !p.email);
    if (!p.email) problems.push("a valid email address");
    markInvalid(f.date, !p.date);
    if (!p.date) problems.push("a date");
    markInvalid(f.time, !p.time);
    if (p.date && !p.time) {
      var closed = !HOURS[new Date(p.date + "T00:00:00").getDay()];
      return closed ? "We're closed on Mondays. Please pick another day." : "There are no tables left on that day. Please pick another date.";
    }
    if (problems.length) return "Please add " + problems.join(", ") + ".";
    return null;
  }

  function showDone(p, ref, emailSent) {
    var dateLabel = new Date(p.date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
    document.getElementById("done-title").textContent = "Grazie, " + p.name.split(" ")[0] + ". You're booked.";
    document.getElementById("done-detail").textContent =
      "A table for " + p.guests + (p.guests === "1" ? " guest" : " guests") + " on " + dateLabel + " at " + p.time + ".";
    document.getElementById("done-ref").textContent = ref;
    try { localStorage.setItem("nero_booking", JSON.stringify({ ref: ref, email: p.email })); } catch (e) {}
    document.getElementById("done-view").href = "my-booking.html?ref=" + encodeURIComponent(ref);
    document.getElementById("done-note").textContent = emailSent === false
      ? "We couldn't email " + p.email + ", but your table is booked. Keep your reference handy."
      : "Your confirmation is on its way to " + p.email + ".";
    form.hidden = true;
    done.hidden = false;
  }

  function setupBooking() {
    dateInput.min = localISO(new Date());
    dateInput.addEventListener("change", function () {
      fillTimeSlots();
      loadAvailability().then(fillTimeSlots);
    });
    guestsSelect.addEventListener("change", fillTimeSlots);
    fillTimeSlots();

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      message.textContent = "";
      var f = form.elements;
      var payload = {
        name: f.name.value.trim(),
        email: cleanEmail(f.email.value),
        date: f.date.value,
        time: f.time.value,
        guests: f.guests.value,
        occasion: f.occasion.value,
        note: f.note.value.trim(),
      };

      var error = validate(payload);
      if (error) {
        message.textContent = error;
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "Booking your table…";

      fetch(RESERVATION_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) {
            if (!res.ok || data.ok === false) throw new Error(data.error || "Something went wrong. Please try again.");
            showDone(payload, data.ref || "NR-" + Date.now().toString(36).slice(-5).toUpperCase(), data.emailed);
          });
        })
        .catch(function (err) {
          loadAvailability().then(fillTimeSlots);
          message.textContent = err instanceof TypeError
            ? "We couldn't reach the booking service. Check your connection and try again."
            : err.message;
        })
        .then(function () {
          submitBtn.disabled = false;
          submitBtn.textContent = "Confirm reservation";
        });
    });

    document.getElementById("book-another").addEventListener("click", function () {
      form.reset();
      [].slice.call(form.querySelectorAll(".invalid")).forEach(function (el) { markInvalid(el, false); });
      fillTimeSlots();
      done.hidden = true;
      form.hidden = false;
    });
  }

  setupHours();
  setupBooking();
  loadMenu().then(setupReveal);
})();
