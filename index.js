"use strict";
// Routeur unique : sert les pages HTML, les fichiers du site et les routes /api.
// Aucun sous-dossier, aucune dépendance npm.
const fs = require("node:fs");
const path = require("node:path");
const c = require("./core");

const PAGES = {
  "/": "index.html", "/serveur": "serveur.html", "/equipe": "equipe.html", "/recrutements": "recrutements.html",
  "/support": "support.html", "/connexion": "connexion.html", "/dashboard": "dashboard.html", "/admin": "admin.html",
};
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
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://cdn.discordapp.com; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
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
    c.redirect(res, next);
  } catch { fail("network"); }
}

function logout(req, res) {
  if (req.method !== "POST") return c.methodNotAllowed(res, "POST");
  if (!c.sameOrigin(req)) return c.send(res, 403, { error: "Origine refusée." });
  c.addCookies(res, [c.clearCookie(c.SESSION_COOKIE)]);
  c.send(res, 200, { ok: true });
}

function session(req, res) {
  if (req.method !== "GET") return c.methodNotAllowed(res, "GET");
  const s = c.getSession(req);
  if (!s) return c.send(res, 200, { user: null, role: null });
  if (c.needsRenewal(s)) {
    c.addCookies(res, [c.cookie(c.SESSION_COOKIE, c.createSession({ id: s.id, name: s.name, avatar: c.cleanAvatar(s.avatar) }, c.env("SESSION_SECRET")), { maxAge: c.SESSION_TTL_S })]);
  }
  c.send(res, 200, { user: { id: s.id, name: s.name, avatar: c.cleanAvatar(s.avatar) }, role: c.roleOf(s.id) });
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

// ---------- Administration ----------
async function botStats(req, res) {
  if (req.method !== "GET") return c.methodNotAllowed(res, "GET");
  const s = c.getSession(req);
  if (!s) return c.send(res, 401, { error: "Non authentifié." });
  const role = c.roleOf(s.id);
  if (!role) return c.send(res, 403, { error: "Accès refusé." });
  const st = await c.fetchBotStats();
  const checks = [
    ["Connexion Discord (client ID + secret)", !!(c.env("DISCORD_CLIENT_ID") && c.env("DISCORD_CLIENT_SECRET"))],
    ["Secret de session (32 caractères minimum)", c.env("SESSION_SECRET").length >= 32],
    ["Webhook des candidatures", c.isValidWebhookUrl(c.env("DISCORD_APPLICATIONS_WEBHOOK_URL"))],
    ["API du bot", st.configured],
  ].map(([label, ok]) => ({ label, ok }));
  c.send(res, 200, { role, checks, stats: st.ok ? st.data : null, reason: st.ok ? null : st.reason });
}

const API = {
  "/api/auth/login": login, "/api/auth/callback/discord": callback, "/api/auth/logout": logout,
  "/api/auth/session": session, "/api/applications": applications, "/api/admin/bot-stats": botStats,
};

// ---------- Routeur ----------
module.exports = async (req, res) => {
  for (const k of Object.keys(SECURITY)) res.setHeader(k, SECURITY[k]);
  let pathname = "/";
  try { pathname = new URL(req.url, "http://localhost").pathname; } catch { /* accueil */ }
  if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.slice(0, -1);
  try {
    if (API[pathname]) return await API[pathname](req, res);
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
