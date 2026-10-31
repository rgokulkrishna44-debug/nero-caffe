// Time helpers and seat capacity for table bookings.
const CFG = require("./config");
const { db, getSetting } = require("./db");

// Current date and minutes-since-midnight in the cafe's timezone (not the server's).
function nowLocal() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CFG.TIMEZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

function addDays(isoDate, n) {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function weekday(isoDate) {
  return new Date(isoDate + "T00:00:00Z").getUTCDay();
}

const toMin = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const toHHMM = (min) => String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0");

// Every bookable start time for a date, as "HH:MM". Empty when closed.
function slotsFor(isoDate) {
  const hours = CFG.HOURS[weekday(isoDate)];
  if (!hours) return [];
  const out = [];
  for (let t = hours[0]; t <= CFG.LAST_SEATING + 1e-9; t += CFG.SLOT_STEP) out.push(toHHMM(Math.round(t * 60)));
  return out;
}

const ACTIVE = "('confirmed','seated')";

// Peak number of seats in use during [startMin, startMin + dwell) on a date.
function peakOccupancy(isoDate, startMin) {
  const dwell = Number(getSetting("dwell_min", CFG.DEFAULT_DWELL_MIN));
  const rows = db
    .prepare(`SELECT time, guests FROM reservations WHERE date = ? AND status IN ${ACTIVE}`)
    .all(isoDate)
    .map((r) => ({ start: toMin(r.time), guests: r.guests }));
  const end = startMin + dwell;
  // Occupancy only rises when another booking starts, so test the window start and each later start.
  const checkpoints = [startMin, ...rows.map((r) => r.start).filter((s) => s > startMin && s < end)];
  let peak = 0;
  for (const x of checkpoints) {
    const used = rows.filter((r) => r.start <= x && x < r.start + dwell).reduce((sum, r) => sum + r.guests, 0);
    peak = Math.max(peak, used);
  }
  return peak;
}

function seatsLeft(isoDate, hhmm) {
  const seats = Number(getSetting("seats", CFG.DEFAULT_SEATS));
  return Math.max(0, seats - peakOccupancy(isoDate, toMin(hhmm)));
}

function availability(isoDate) {
  return slotsFor(isoDate).map((time) => ({ time, left: seatsLeft(isoDate, time) }));
}

module.exports = { nowLocal, addDays, weekday, toMin, toHHMM, slotsFor, seatsLeft, availability };
