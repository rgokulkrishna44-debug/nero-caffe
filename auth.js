// Admin sign-in: one shared password, signed httpOnly session cookie, and an API key
// for automations (n8n). Secrets come from the environment, never from files in the repo.
const crypto = require("crypto");

function fromEnvOrRandom(name, label) {
  if (process.env[name]) return process.env[name];
  const value = crypto.randomBytes(9).toString("base64url");
  console.log(`[auth] ${name} is not set. Temporary ${label} for this run: ${value}`);
  return value;
}

const ADMIN_PASSWORD = fromEnvOrRandom("NERO_ADMIN_PASSWORD", "admin password");
const API_KEY = fromEnvOrRandom("NERO_API_KEY", "automation API key");
const SESSION_SECRET = process.env.NERO_SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const COOKIE = "nero_admin";
const SESSION_MS = 12 * 60 * 60 * 1000;

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const sign = (payload) => crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");

function makeToken() {
  const payload = String(Date.now() + SESSION_MS);
  return payload + "." + sign(payload);
}
function validToken(token) {
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  return Number(payload) > Date.now();
}

function readCookie(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return "";
}

// Throttle password guessing: 5 failures per IP per 15 minutes.
const failures = new Map();
function tooManyAttempts(ip) {
  const rec = failures.get(ip);
  return !!rec && rec.count >= 5 && Date.now() - rec.first < 15 * 60 * 1000;
}
function noteFailure(ip) {
  const rec = failures.get(ip);
  if (!rec || Date.now() - rec.first > 15 * 60 * 1000) failures.set(ip, { count: 1, first: Date.now() });
  else rec.count++;
}

function login(req, res) {
  const ip = req.ip;
  if (tooManyAttempts(ip)) return res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });
  const password = (req.body && req.body.password) || "";
  if (!safeEqual(password, ADMIN_PASSWORD)) {
    noteFailure(ip);
    return res.status(401).json({ error: "Wrong password." });
  }
  failures.delete(ip);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=${makeToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure}`);
  res.json({ ok: true });
}

function logout(req, res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  res.json({ ok: true });
}

// Allows a signed-in admin session, or an automation calling with the x-api-key header.
function requireAdmin(req, res, next) {
  const key = req.headers["x-api-key"];
  if ((key && safeEqual(key, API_KEY)) || validToken(readCookie(req, COOKIE))) return next();
  res.status(401).json({ error: "Not signed in." });
}

module.exports = { login, logout, requireAdmin, validToken, readCookie, COOKIE };
