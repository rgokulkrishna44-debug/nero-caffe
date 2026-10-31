// Cafe rules shared by the booking and ordering code. Times are Indian Standard Time.
module.exports = {
  TIMEZONE: "Asia/Kolkata",
  // day of week (0 = Sunday) -> [open hour, close hour] or null when closed
  HOURS: { 0: [9, 22], 1: null, 2: [8, 22], 3: [8, 22], 4: [8, 22], 5: [8, 23], 6: [8, 23] },
  LAST_SEATING: 21.5, // 21:30, also when the kitchen stops taking orders
  SLOT_STEP: 0.5, // booking slots every 30 minutes
  DEFAULT_SEATS: 18, // "Eighteen seats", see the Reserve section of the site
  DEFAULT_DWELL_MIN: 90, // how long a booking holds its seats
  MAX_GUESTS: 8,
  N8N_RESERVATION_URL: "https://n8n.luvias.in/webhook/nero-reservation",
};
