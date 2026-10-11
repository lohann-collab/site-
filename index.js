"use strict";
// Routeur unique : sert les pages HTML, les fichiers du site et les routes /api.
// Aucun sous-dossier, aucune dépendance npm.
const fs = require("node:fs");
const path = require("node:path");
const c = require("./core");

const PAGES = {
  "/": "index.html", "/serveur": "serveur.html", "/staff": "staff.html", "/zones": "zones.html",
  "/recrutements": "recrutements.html", "/support": "support.html", "/appel": "appel.html",
  "/connexion": "connexion.html", "/dashboard": "dashboard.html", "/activite": "activite.html",
  "/chat-staff": "chat-staff.html", "/sanctions": "sanctions.html", "/owner": "owner.html", "/dev": "dev.html",
};
const MOVED = { "/equipe": "/staff", "/admin": "/dev" }; // anciennes adresses
const FILES = {
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/app.js": ["app.js", "application/javascript; charset=utf-8"],
  "/site-config.js": ["site-config.js", "application/javascript; charset=utf-8"],
  "/favicon.svg": ["favicon.svg", "image/svg+xml"],
};
const HTML = "text/html; charset=utf-8";
const SECURITY = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://cdn.discordapp.com https://media.discordapp.net; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
};

const cache = new Map();
function read(name) {
  if (!cache.has(name)) cache.set(name, fs.readFileSync(path.join(__dirname, name)));
  return cache.get(name);
}
function serve(res, status, name, type, cacheControl) {
  res.statusCode = status;
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", cacheControl);
  res.end(read(name));
}
async function readBody(req) {
  if (req.body !== undefined) return req.body;
  const chunks = []; let size = 0;
  for await (const ch of req) { size += ch.length; if (size > 20000) return null; chunks.push(ch); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return undefined; }
}

async function jsonBody(req) {
  let b = await readBody(req);
  if (b === null) return null; // trop volumineux
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = undefined; } }
  return b && typeof b === "object" ? b : {};
}

// ---------- Connexion Discord ----------
function login(req, res) {
  if (req.method !== "GET") return c.methodNotAllowed(res, "GET");
  const id = c.env("DISCORD_CLIENT_ID");
  if (!id || !c.env("DISCORD_CLIENT_SECRET") || c.env("SESSION_SECRET").length < 32) return c.redirect(res, "/connexion?error=config");
  const state = c.generateState();
  const next = c.safeNext(c.query(req).next);
  c.addCookies(res, [
    c.cookie(c.STATE_COOKIE, state, { path: "/api/auth", maxAge: c.STATE_TTL_S }),
    c.cookie(c.NEXT_COOKIE, encodeURIComponent(next), { path: "/api/auth", maxAge: c.STATE_TTL_S }),
  ]);
  c.redirect(res, c.buildAuthorizeUrl(id, c.redirectUri(req), state));
}

async function callback(req, res) {
  if (req.method !== "GET") return c.methodNotAllowed(res, "GET");
  const fail = (e) => {
    c.addCookies(res, [c.clearCookie(c.STATE_COOKIE, "/api/auth"), c.clearCookie(c.NEXT_COOKIE, "/api/auth")]);
    return c.redirect(res, `/connexion?error=${e}`);
  };
  if (!c.rateLimit(`cb:${c.ipOf(req)}`, 20, 60000).ok) return fail("rate_limited");
  const cookies = c.parseCookies(req);
  const chk = c.checkCallback(c.query(req), cookies[c.STATE_COOKIE]);
  if (!chk.ok) return fail(chk.error);
  const secret = c.env("SESSION_SECRET");
  if (!c.env("DISCORD_CLIENT_ID") || !c.env("DISCORD_CLIENT_SECRET") || secret.length < 32) return fail("config");
  try {
    const tr = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: c.env("DISCORD_CLIENT_ID"), client_secret: c.env("DISCORD_CLIENT_SECRET"),
        grant_type: "authorization_code", code: chk.code, redirect_uri: c.redirectUri(req),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!tr.ok) return fail("token_exchange");
    const tok = await tr.json();
    if (!tok.access_token || String(tok.token_type).toLowerCase() !== "bearer") return fail("token_exchange");
    const mr = await fetch("https://discord.com/api/users/@me", { headers: { Authorization: `Bearer ${tok.access_token}` }, signal: AbortSignal.timeout(8000) });
    if (!mr.ok) return fail("profile");
    const me = await mr.json();
    if (!me.id || !/^\d{15,20}$/.test(me.id) || !me.username) return fail("profile");
    // Seule l'identité minimale est conservée ; le jeton d'accès Discord est abandonné.
    const value = c.createSession({ id: me.id, name: String(me.global_name || me.username).slice(0, 64), avatar: c.cleanAvatar(me.avatar) }, secret);
    let next = "/dashboard";
    try { next = c.safeNext(decodeURIComponent(cookies[c.NEXT_COOKIE] || "")); } catch { /* valeur par défaut */ }
    c.addCookies(res, [
      c.cookie(c.SESSION_COOKIE, value, { maxAge: c.SESSION_TTL_S }),
      c.clearCookie(c.STATE_COOKIE, "/api/auth"), c.clearCookie(c.NEXT_COOKIE, "/api/auth"),
    ]);
    // Journal « connexions au site » dans l'espace développeur (sans bloquer la connexion plus de 1,5 s).
    await Promise.race([
      c.botRequest("POST", "/log", { text: `Connexion au site : ${String(me.global_name || me.username).slice(0, 40)} (${me.id})` }),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
    c.redirect(res, next);
  } catch { fail("network"); }
}

function logout(req, res) {
  if (req.method !== "POST") return c.methodNotAllowed(res, "POST");
  if (!c.sameOrigin(req)) return c.send(res, 403, { error: "Origine refusée." });
  c.addCookies(res, [c.clearCookie(c.SESSION_COOKIE)]);
  c.send(res, 200, { ok: true });
}

async function session(req, res) {
  if (req.method !== "GET") return c.methodNotAllowed(res, "GET");
  const s = c.getSession(req);
  if (!s) return c.send(res, 200, { user: null, level: null, can_sanction: false });
  if (c.needsRenewal(s)) {
    c.addCookies(res, [c.cookie(c.SESSION_COOKIE, c.createSession({ id: s.id, name: s.name, avatar: c.cleanAvatar(s.avatar) }, c.env("SESSION_SECRET")), { maxAge: c.SESSION_TTL_S })]);
  }
  const a = await c.getAccess(s.id);
  c.send(res, 200, { user: { id: s.id, name: s.name, avatar: c.cleanAvatar(s.avatar) }, level: a.level, can_sanction: a.can_sanction });
}

// ---------- Candidatures ----------
async function applications(req, res) {
  if (req.method === "GET") return c.send(res, 200, { departments: c.DEPARTMENTS });
  if (req.method !== "POST") return c.methodNotAllowed(res, "GET, POST");
  if (!c.sameOrigin(req)) return c.send(res, 403, { error: "Origine refusée." });
  const s = c.getSession(req);
  if (!s) return c.send(res, 401, { error: "Connexion Discord requise." });
  const rl = c.rateLimit(`app:${s.id}`, 3, 3600000);
  if (!rl.ok) return c.send(res, 429, { error: "Trop de tentatives. Réessayez plus tard." }, { "Retry-After": String(rl.retryAfterS) });

  let body = await readBody(req);
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = undefined; } }
  if (body === null) return c.send(res, 413, { error: "Requête trop volumineuse." });
  if (!body || typeof body !== "object") return c.send(res, 400, { error: "Corps JSON invalide." });
  if (JSON.stringify(body).length > 10000) return c.send(res, 413, { error: "Requête trop volumineuse." });

  const v = c.validateApplication(body);
  if (!v.ok) return c.send(res, 422, { error: "Formulaire invalide.", fields: v.errors });
  const hook = c.env("DISCORD_APPLICATIONS_WEBHOOK_URL");
  if (!c.isValidWebhookUrl(hook)) return c.send(res, 503, { error: "Les candidatures en ligne ne sont pas encore activées. Utilisez la commande /candidature sur Discord." });
  try {
    const r = await fetch(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c.buildWebhookBody(v.value, s)), signal: AbortSignal.timeout(8000) });
    if (!r.ok) return c.send(res, 502, { error: "Envoi impossible pour le moment." });
  } catch { return c.send(res, 502, { error: "Envoi impossible pour le moment." }); }
  c.send(res, 201, { ok: true });
}

// ---------- Appel d'unban ----------
async function appeals(req, res) {
  if (req.method !== "POST") return c.methodNotAllowed(res, "POST");
  if (!c.sameOrigin(req)) return c.send(res, 403, { error: "Origine refusée." });
  const s = c.getSession(req);
  if (!s) return c.send(res, 401, { error: "Connexion Discord requise." });
  const rl = c.rateLimit(`appeal:${s.id}`, 2, 3600000);
  if (!rl.ok) return c.send(res, 429, { error: "Trop de tentatives. Réessayez plus tard." }, { "Retry-After": String(rl.retryAfterS) });
  const body = await jsonBody(req);
  if (body === null) return c.send(res, 413, { error: "Requête trop volumineuse." });
  const v = c.validateAppeal(body);
  if (!v.ok) return c.send(res, 422, { error: "Formulaire invalide.", fields: v.errors });
  const hook = c.env("APPEALS_WEBHOOK_URL") || c.env("DISCORD_APPLICATIONS_WEBHOOK_URL");
  if (!c.isValidWebhookUrl(hook)) return c.send(res, 503, { error: "Les demandes d'unban en ligne ne sont pas encore activées. Contactez l'équipe sur Discord." });
  try {
    const r = await fetch(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c.buildAppealBody(v.value, s)), signal: AbortSignal.timeout(8000) });
    if (!r.ok) return c.send(res, 502, { error: "Envoi impossible pour le moment." });
  } catch { return c.send(res, 502, { error: "Envoi impossible pour le moment." }); }
  c.send(res, 201, { ok: true });
}

// ---------- Données publiques du bot (en cache 30 s) ----------
const pub = new Map();
async function publicData(req, res, botPath) {
  if (req.method !== "GET") return c.methodNotAllowed(res, "GET");
  const hit = pub.get(botPath);
  if (hit && Date.now() - hit.t < 30000) return c.send(res, 200, hit.d);
  const r = await c.botRequest("GET", botPath);
  if (r.status === 200) pub.set(botPath, { t: Date.now(), d: r.data });
  c.send(res, r.status, r.data);
}

// ---------- Relais vers le bot (espace staff) : le bot vérifie lui-même les droits ----------
const BOT_ALLOW = [
  /^\/me\/stats$/, /^\/staffchat$/, /^\/members\/search$/, /^\/roles$/, /^\/sanctions$/, /^\/rankup$/,
  /^\/owner\/(backup|permissions|sanctions)$/, /^\/owner\/sanctions\/\d+\/remove$/, /^\/dev\/(logs|system)$/,
];
async function botRelay(req, res, pathname) {
  const s = c.getSession(req);
  if (!s) return c.send(res, 401, { error: "Connexion Discord requise." });
  const sub = pathname.slice("/api/bot".length);
  if (!BOT_ALLOW.some((r) => r.test(sub))) return c.send(res, 404, { error: "Route inconnue." });
  const write = req.method === "POST";
  if (!write && req.method !== "GET") return c.methodNotAllowed(res, "GET, POST");
  if (write && !c.sameOrigin(req)) return c.send(res, 403, { error: "Origine refusée." });
  const rl = c.rateLimit(`relay:${s.id}`, 120, 60000);
  if (!rl.ok) return c.send(res, 429, { error: "Trop de requêtes." }, { "Retry-After": String(rl.retryAfterS) });
  let search = "";
  try { search = new URL(req.url, "http://localhost").search; } catch { /* aucun paramètre */ }
  if (search.length > 200) return c.send(res, 414, { error: "Requête trop longue." });
  let body;
  if (write) {
    body = await jsonBody(req);
    if (body === null || JSON.stringify(body).length > 10000) return c.send(res, 413, { error: "Requête trop volumineuse." });
  }
  const r = await c.botRequest(req.method, sub + search, body, s.id);
  c.send(res, r.status, r.data);
}

// ---------- État de la configuration (espace développeur) ----------
async function siteStatus(req, res) {
  if (req.method !== "GET") return c.methodNotAllowed(res, "GET");
  const s = c.getSession(req);
  if (!s) return c.send(res, 401, { error: "Connexion Discord requise." });
  const a = await c.getAccess(s.id);
  if (c.LEVELS[a.level] < c.LEVELS.dev) return c.send(res, 403, { error: "Accès refusé." });
  const health = await c.botRequest("GET", "/health");
  const checks = [
    ["Connexion Discord (client ID + secret)", !!(c.env("DISCORD_CLIENT_ID") && c.env("DISCORD_CLIENT_SECRET"))],
    ["Secret de session (32 caractères minimum)", c.env("SESSION_SECRET").length >= 32],
    ["Webhook des candidatures", c.isValidWebhookUrl(c.env("DISCORD_APPLICATIONS_WEBHOOK_URL"))],
    ["Lien vers l'API du bot (URL + jeton)", c.botConfigured()],
    ["Le bot répond", health.status === 200],
  ].map(([label, ok]) => ({ label, ok }));
  c.send(res, 200, { checks });
}

const API = {
  "/api/auth/login": login, "/api/auth/callback/discord": callback, "/api/auth/logout": logout,
  "/api/auth/session": session, "/api/applications": applications, "/api/appeals": appeals,
  "/api/site-status": siteStatus,
  "/api/public/staff": (req, res) => publicData(req, res, "/staff"),
  "/api/public/announcement": (req, res) => publicData(req, res, "/announcement"),
  "/api/public/stats": (req, res) => publicData(req, res, "/stats"),
};

// ---------- Routeur ----------
module.exports = async (req, res) => {
  for (const k of Object.keys(SECURITY)) res.setHeader(k, SECURITY[k]);
  let pathname = "/";
  try { pathname = new URL(req.url, "http://localhost").pathname; } catch { /* accueil */ }
  if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.slice(0, -1);
  try {
    if (API[pathname]) return await API[pathname](req, res);
    if (pathname.startsWith("/api/bot/")) return await botRelay(req, res, pathname);
    if (MOVED[pathname]) return c.redirect(res, MOVED[pathname], 308);
    if (pathname.startsWith("/api/")) return c.send(res, 404, { error: "Route inconnue." });

    const isRead = req.method === "GET" || req.method === "HEAD";
    if (pathname.endsWith(".html")) { // anciennes adresses : /equipe.html -> /equipe
      const clean = pathname === "/index.html" ? "/" : pathname.slice(0, -5);
      if (PAGES[clean]) return c.redirect(res, clean, 308);
    }
    if (PAGES[pathname]) {
      if (!isRead) return c.methodNotAllowed(res, "GET, HEAD");
      return serve(res, 200, PAGES[pathname], HTML, "public, max-age=0, must-revalidate");
    }
    if (FILES[pathname]) {
      if (!isRead) return c.methodNotAllowed(res, "GET, HEAD");
      return serve(res, 200, FILES[pathname][0], FILES[pathname][1], "public, max-age=3600");
    }
    return serve(res, 404, "404.html", HTML, "no-store");
  } catch (e) {
    console.error(e);
    if (!res.headersSent) c.send(res, 500, { error: "Erreur interne." });
  }
};

// Lancement direct : « node index.js » (hébergement Node classique). Sur Vercel, le module est simplement importé.
if (require.main === module) {
  try { process.loadEnvFile(path.join(__dirname, ".env")); } catch { /* pas de fichier .env */ }
  const port = Number(process.env.PORT || process.env.SERVER_PORT || 3000);
  require("node:http").createServer(module.exports).listen(port, () => console.log(`Site Dunkerque RP sur le port ${port}`));
}
