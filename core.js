"use strict";
// Outils partagés par les fonctions /api : sessions signées, OAuth Discord, validation, limitation de débit.
const crypto = require("node:crypto");

// ---------- Réglages du serveur (à adapter) ----------
const SERVER_NAME = "Dunkerque RP";
// Doit correspondre aux services proposés dans le formulaire de candidature.
const DEPARTMENTS = ["Police nationale", "Sapeurs-pompiers", "SAMU", "Autre service"];

const env = (k) => process.env[k] || "";
const PROD = !!process.env.VERCEL || process.env.NODE_ENV === "production";

const SESSION_COOKIE = "dk_session";
const STATE_COOKIE = "dk_oauth_state";
const NEXT_COOKIE = "dk_next";
const SESSION_TTL_S = 7 * 86400;
const RENEW_AFTER_S = 3 * 86400;
const STATE_TTL_S = 600;
const nowS = () => Math.floor(Date.now() / 1000);

// ---------- HTTP ----------
function query(req) {
  if (req.query && typeof req.query === "object") return req.query;
  try { return Object.fromEntries(new URL(req.url, "http://localhost").searchParams); } catch { return {}; }
}
function send(res, status, body, headers) {
  res.statusCode = status;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (headers) for (const k of Object.keys(headers)) res.setHeader(k, headers[k]);
  res.end(JSON.stringify(body));
}
function redirect(res, location, status = 302) {
  res.statusCode = status;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Location", location);
  res.end();
}
const methodNotAllowed = (res, allow) => send(res, 405, { error: "Méthode non autorisée." }, { Allow: allow });
const hostOf = (req) => String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
function baseUrl(req) {
  const proto = PROD ? "https" : String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  return `${proto}://${hostOf(req)}`;
}
const redirectUri = (req) => env("DISCORD_REDIRECT_URI") || `${baseUrl(req)}/api/auth/callback/discord`;
// Requête « même origine » : compare l'en-tête Origin au domaine réellement utilisé (plus de dépendance à une variable d'URL).
function sameOrigin(req) {
  const o = req.headers.origin;
  if (o) { try { return new URL(o).host === hostOf(req); } catch { return false; } }
  return req.headers["sec-fetch-site"] === "same-origin";
}
const ipOf = (req) => String(req.headers["x-forwarded-for"] || (req.socket && req.socket.remoteAddress) || "inconnu").split(",")[0].trim();

// ---------- Cookies ----------
function parseCookies(req) {
  const jar = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) jar[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return jar;
}
function cookie(name, value, { path = "/", maxAge } = {}) {
  const a = [`${name}=${value}`, `Path=${path}`, "HttpOnly", "SameSite=Lax"];
  if (PROD) a.push("Secure");
  if (maxAge !== undefined) a.push(`Max-Age=${maxAge}`);
  return a.join("; ");
}
const clearCookie = (name, path = "/") => cookie(name, "", { path, maxAge: 0 });
function addCookies(res, list) {
  const prev = res.getHeader("Set-Cookie");
  res.setHeader("Set-Cookie", (prev ? (Array.isArray(prev) ? prev : [prev]) : []).concat(list));
}

// ---------- Sessions signées (HMAC-SHA256) ----------
const sign = (data, secret) => crypto.createHmac("sha256", secret).update(data).digest("base64url");
function createSession(user, secret, now = nowS()) {
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET doit contenir au moins 32 caractères.");
  const body = Buffer.from(JSON.stringify({ ...user, iat: now, exp: now + SESSION_TTL_S })).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}
function verifySession(token, secret, now = nowS()) {
  if (!token || typeof token !== "string" || token.length > 2048 || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const a = Buffer.from(parts[1]), b = Buffer.from(sign(parts[0], secret));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (typeof p.id !== "string" || !/^\d{15,20}$/.test(p.id)) return null;
    if (typeof p.exp !== "number" || typeof p.iat !== "number" || p.exp <= now) return null;
    return p;
  } catch { return null; }
}
const needsRenewal = (p, now = nowS()) => now - p.iat > RENEW_AFTER_S;
function getSession(req) {
  const secret = env("SESSION_SECRET");
  return secret.length >= 32 ? verifySession(parseCookies(req)[SESSION_COOKIE], secret) : null;
}
const idList = (v) => String(v || "").split(",").map((s) => s.trim()).filter((s) => /^\d{15,20}$/.test(s));
function roleOf(id) {
  if (idList(env("OWNER_DISCORD_IDS")).includes(id)) return "owner";
  if (idList(env("DEV_DISCORD_IDS")).includes(id)) return "dev";
  return null;
}
const cleanAvatar = (a) => (typeof a === "string" && /^[a-f0-9_]+$/i.test(a) ? a : null);

// ---------- OAuth2 Discord (scope identify uniquement) ----------
const generateState = () => crypto.randomBytes(32).toString("hex");
function statesMatch(c, q) {
  if (!c || !q || !/^[0-9a-f]{64}$/.test(c) || !/^[0-9a-f]{64}$/.test(q)) return false;
  return crypto.timingSafeEqual(Buffer.from(c), Buffer.from(q));
}
function buildAuthorizeUrl(clientId, redirectUriValue, state) {
  const u = new URL("https://discord.com/oauth2/authorize");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUriValue);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "identify");
  u.searchParams.set("state", state);
  u.searchParams.set("prompt", "none");
  return u.toString();
}
function checkCallback(q, cookieState) {
  if (!statesMatch(cookieState, q.state)) return { ok: false, error: "invalid_state" };
  if (q.error) return { ok: false, error: q.error === "access_denied" ? "access_denied" : "oauth_error" };
  const code = q.code;
  if (typeof code !== "string" || !code || code.length > 512 || !/^[\w.-]+$/.test(code)) return { ok: false, error: "missing_code" };
  return { ok: true, code };
}
function safeNext(n) {
  return typeof n === "string" && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/api") && !n.includes("\\") ? n : "/dashboard";
}

// ---------- Candidatures ----------
const clean = (v) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim() : "");
function validateApplication(raw) {
  const r = raw && typeof raw === "object" ? raw : {}, errors = {};
  const robloxName = clean(r.robloxName);
  if (!/^[A-Za-z0-9_]{3,20}$/.test(robloxName)) errors.robloxName = "Pseudo Roblox invalide (3 à 20 caractères : lettres, chiffres, _).";
  const age = typeof r.age === "number" ? r.age : Number(clean(r.age));
  if (!Number.isInteger(age) || age < 13 || age > 99) errors.age = "Âge invalide (13 à 99 ans).";
  const department = clean(r.department);
  if (!DEPARTMENTS.includes(department)) errors.department = "Service inconnu.";
  const experience = clean(r.experience);
  if (experience.length < 10 || experience.length > 1000) errors.experience = "Expérience : 10 à 1000 caractères.";
  const motivation = clean(r.motivation);
  if (motivation.length < 30 || motivation.length > 1500) errors.motivation = "Motivation : 30 à 1500 caractères.";
  const availability = clean(r.availability);
  if (availability.length < 5 || availability.length > 300) errors.availability = "Disponibilités : 5 à 300 caractères.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { robloxName, age, department, experience, motivation, availability } };
}
// Limite en mémoire : par instance serverless, donc protection partielle sur Vercel.
const buckets = new Map();
function rateLimit(key, max, windowMs, now = Date.now()) {
  const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= max) { buckets.set(key, hits); return { ok: false, retryAfterS: Math.ceil((windowMs - (now - hits[0])) / 1000) }; }
  hits.push(now); buckets.set(key, hits);
  if (buckets.size > 5000) for (const [k, v] of buckets) if (!v.some((t) => now - t < windowMs)) buckets.delete(k);
  return { ok: true, retryAfterS: 0 };
}
const isValidWebhookUrl = (u) => typeof u === "string" && u.length < 300 && /^https:\/\/((ptb|canary)\.)?(discord|discordapp)\.com\/api\/webhooks\//.test(u);
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
function buildWebhookBody(a, user) {
  return {
    username: `Candidatures — ${SERVER_NAME}`,
    allowed_mentions: { parse: [] },
    embeds: [{
      title: "Nouvelle candidature (site web)",
      color: 0xf2b705,
      description: `Candidat : <@${user.id}> (${cut(String(user.name || "inconnu"), 60)})`,
      fields: [
        { name: "Pseudo Roblox", value: cut(a.robloxName, 100), inline: true },
        { name: "Âge", value: String(a.age), inline: true },
        { name: "Service", value: a.department, inline: true },
        { name: "Expérience", value: cut(a.experience, 1000) },
        { name: "Motivation", value: cut(a.motivation, 1000) },
        { name: "Disponibilités", value: cut(a.availability, 300) },
      ],
      timestamp: new Date().toISOString(),
    }],
  };
}

// ---------- API du bot (statistiques de /admin) ----------
async function fetchBotStats() {
  const url = env("BOT_API_URL"), token = env("BOT_API_TOKEN");
  if (!url || token.length < 32 || (PROD && !url.startsWith("https://"))) return { ok: false, configured: false, reason: "API du bot non configurée." };
  try {
    const r = await fetch(`${url.replace(/\/$/, "")}/api/stats`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return { ok: false, configured: true, reason: `L'API du bot a répondu ${r.status}.` };
    const d = await r.json();
    const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    return { ok: true, configured: true, data: { members: n(d.members), tickets_open: n(d.tickets_open), applications_pending: n(d.applications_pending), warnings_active: n(d.warnings_active) } };
  } catch { return { ok: false, configured: true, reason: "API du bot injoignable." }; }
}

module.exports = {
  env, PROD, SESSION_COOKIE, STATE_COOKIE, NEXT_COOKIE, SESSION_TTL_S, STATE_TTL_S, DEPARTMENTS,
  query, send, redirect, methodNotAllowed, hostOf, baseUrl, redirectUri, sameOrigin, ipOf,
  parseCookies, cookie, clearCookie, addCookies,
  createSession, verifySession, needsRenewal, getSession, roleOf, cleanAvatar,
  generateState, statesMatch, buildAuthorizeUrl, checkCallback, safeNext,
  validateApplication, rateLimit, isValidWebhookUrl, buildWebhookBody, fetchBotStats, buckets,
};
