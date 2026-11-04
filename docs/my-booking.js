(function () {
  "use strict";
  var STORE = "nero_booking"; // { ref, email } remembered on this device after a booking or lookup
  var $ = function (id) { return document.getElementById(id); };

  var lookup = $("mb-lookup"), dash = $("mb-dash"), loading = $("mb-loading");
  var current = null; // { ref, email, data }
  var tick = null;

  var STATUS = {
    confirmed: "Table reserved",
    seated: "Seated now",
    completed: "Completed",
    no_show: "Missed",
    cancelled: "Cancelled",
  };

  function saved() {
    try { return JSON.parse(localStorage.getItem(STORE) || "null"); } catch (e) { return null; }
  }
  function remember(ref, email) { try { localStorage.setItem(STORE, JSON.stringify({ ref: ref, email: email })); } catch (e) {} }
  function forget() { try { localStorage.removeItem(STORE); } catch (e) {} }

  // Bookings are in cafe time (IST), whatever timezone the guest's device is in.
  function startOf(r) { return new Date(r.date + "T" + r.time + ":00+05:30"); }
  function fmtDate(iso, long) {
    return new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", {
      weekday: long ? "long" : "short", day: "numeric", month: long ? "long" : "short", timeZone: "UTC",
    });
  }
  function fmtTime(hhmm) {
    var p = hhmm.split(":"), h = Number(p[0]), m = p[1];
    return (h % 12 || 12) + ":" + m + " " + (h >= 12 ? "pm" : "am");
  }
  function addMinutes(hhmm, n) {
    var p = hhmm.split(":"), t = Number(p[0]) * 60 + Number(p[1]) + n;
    return String(Math.floor(t / 60) % 24).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0");
  }

  function countdown(r, dwellMin) {
    if (r.status === "cancelled") return "This booking was cancelled";
    if (r.status === "completed") return "We hope you enjoyed it";
    if (r.status === "no_show") return "You didn't make it this time";
    var ms = startOf(r) - Date.now();
    if (r.status === "seated" || (ms <= 0 && ms > -dwellMin * 60000)) return "Your table is ready";
    if (ms <= 0) return "This booking has passed";
    var mins = Math.round(ms / 60000), days = Math.floor(mins / 1440), hrs = Math.floor((mins % 1440) / 60), rem = mins % 60;
    if (days >= 1) return "In " + days + (days === 1 ? " day" : " days") + (hrs ? ", " + hrs + " h" : "");
    if (hrs >= 1) return "In " + hrs + " h " + rem + " min";
    return "In " + Math.max(mins, 1) + " min";
  }

  function show(which) {
    lookup.hidden = which !== "lookup";
    dash.hidden = which !== "dash";
    loading.hidden = which !== "loading";
  }

  function post(url, body) {
    return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) { var e = new Error(data.error || "Something went wrong. Please try again."); e.status = res.status; throw e; }
          return data;
        });
      });
  }

  function fact(label, value) {
    var wrap = document.createElement("div"), dt = document.createElement("dt"), dd = document.createElement("dd");
    dt.textContent = label; dd.textContent = value;
    wrap.appendChild(dt); wrap.appendChild(dd);
    return wrap;
  }

  function render(data) {
    var r = data.reservation;
    current.data = data;
    document.title = "NERO Caffè · " + fmtDate(r.date, false) + " " + fmtTime(r.time);

    $("mb-hello").textContent = "Ciao, " + r.name.split(" ")[0] + ".";
    var pill = $("mb-pill");
    pill.textContent = STATUS[r.status] || r.status;
    pill.className = "mb-pill " + r.status;
    $("mb-when").textContent = countdown(r, data.dwellMin);
    $("mb-date").textContent = fmtDate(r.date, true);
    $("mb-time").textContent = fmtTime(r.time);
    $("mb-guests").textContent = r.guests + (r.guests === 1 ? " guest" : " guests");

    var facts = $("mb-facts");
    facts.textContent = "";
    facts.appendChild(fact("Booking reference", r.ref));
    facts.appendChild(fact("Seats held until", fmtTime(addMinutes(r.time, data.dwellMin))));
    if (r.occasion) facts.appendChild(fact("Occasion", r.occasion));
    if (r.note) facts.appendChild(fact("Your note", r.note));
    facts.appendChild(fact("Booked on", new Date(r.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })));

    var live = r.status === "confirmed" || r.status === "seated";
    $("mb-hold").textContent = live
      ? "We hold your table for 15 minutes past " + fmtTime(r.time) + ". 14 Lavelle Road, Ashok Nagar."
      : "";
    $("mb-ics").hidden = r.status !== "confirmed";
    $("mb-cancel").hidden = !(r.status === "confirmed" && startOf(r) > Date.now());
    $("mb-confirm").hidden = true;

    var others = data.others || [];
    $("mb-others-wrap").hidden = !others.length;
    var list = $("mb-others");
    list.textContent = "";
    others.forEach(function (o) {
      var li = document.createElement("li"), btn = document.createElement("button"), meta = document.createElement("span");
      btn.type = "button";
      btn.textContent = fmtDate(o.date, false) + " · " + fmtTime(o.time) + " · " + o.guests + (o.guests === 1 ? " guest" : " guests");
      meta.textContent = (STATUS[o.status] || o.status) + " · " + o.ref;
      btn.addEventListener("click", function () { open(o.ref, current.email, true); window.scrollTo({ top: 0, behavior: "smooth" }); });
      li.appendChild(btn); li.appendChild(meta);
      list.appendChild(li);
    });

    show("dash");
    clearInterval(tick);
    tick = setInterval(function () { if (current && current.data) $("mb-when").textContent = countdown(current.data.reservation, current.data.dwellMin); }, 30000);
  }

  // Fetch and display one booking. `quiet` means a failure falls back to the lookup form with a message.
  function open(ref, email, quiet) {
    show("loading");
    return post("/api/my-booking", { ref: ref, email: email })
      .then(function (data) {
        current = { ref: data.reservation.ref, email: email, data: data };
        remember(current.ref, email);
        render(data);
      })
      .catch(function (err) {
        show("lookup");
        if (err.status === 404 && quiet) forget();
        $("mb-error").textContent = err instanceof TypeError ? "We couldn't reach the booking service. Check your connection and try again." : err.message;
      });
  }

  function downloadIcs() {
    var r = current.data.reservation, start = startOf(r), end = new Date(start.getTime() + current.data.dwellMin * 60000);
    var z = function (d) { return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); };
    var lines = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//NERO Caffe//Booking//EN", "BEGIN:VEVENT",
      "UID:" + r.ref + "@nerocaffe.in", "DTSTAMP:" + z(new Date()), "DTSTART:" + z(start), "DTEND:" + z(end),
      "SUMMARY:Table at NERO Caffe (" + r.guests + (r.guests === 1 ? " guest)" : " guests)"),
      "LOCATION:NERO Caffe\\, 14 Lavelle Road\\, Ashok Nagar\\, Bengaluru 560001",
      "DESCRIPTION:Booking reference " + r.ref + ". Tables are held for 15 minutes.",
      "END:VEVENT", "END:VCALENDAR",
    ];
    var blob = new Blob([lines.join("\r\n")], { type: "text/calendar" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "nero-" + r.ref + ".ics";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  $("mb-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var ref = $("mb-ref").value.trim().toUpperCase(), email = $("mb-email").value.trim();
    $("mb-error").textContent = "";
    if (!ref || !email) { $("mb-error").textContent = "Please enter both your booking reference and email."; return; }
    var btn = $("mb-find");
    btn.disabled = true;
    open(ref, email, false).then(function () { btn.disabled = false; });
  });

  $("mb-ics").addEventListener("click", downloadIcs);
  $("mb-cancel").addEventListener("click", function () { $("mb-confirm").hidden = false; $("mb-card-msg").textContent = ""; });
  $("mb-cancel-no").addEventListener("click", function () { $("mb-confirm").hidden = true; });
  $("mb-cancel-yes").addEventListener("click", function () {
    var btn = $("mb-cancel-yes");
    btn.disabled = true;
    post("/api/my-booking/cancel", { ref: current.ref, email: current.email })
      .then(function (data) { render(data); })
      .catch(function (err) { $("mb-card-msg").textContent = err.message; $("mb-confirm").hidden = true; })
      .then(function () { btn.disabled = false; });
  });
  $("mb-switch").addEventListener("click", function () { clearInterval(tick); $("mb-error").textContent = ""; show("lookup"); });
  $("mb-forget").addEventListener("click", function () { forget(); current = null; clearInterval(tick); $("mb-form").reset(); $("mb-error").textContent = ""; show("lookup"); });

  // Start: a link can carry ?ref=NR-XXXXX; otherwise reopen whatever this device last looked at.
  var qs = new URLSearchParams(location.search), s = saved();
  if (qs.get("ref")) $("mb-ref").value = qs.get("ref").toUpperCase();
  if (s && s.ref && s.email && (!qs.get("ref") || qs.get("ref").toUpperCase() === s.ref)) open(s.ref, s.email, true);
  else show("lookup");
})();
