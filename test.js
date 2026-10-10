// Lancer : npm test   (node --test test.js)
"use strict";
process.env.SESSION_SECRET = "s".repeat(48);
process.env.NEXT_PUBLIC_SITE_URL = "https://dunkerquerp.vercel.app";
process.env.OWNER_DISCORD_IDS = "1521943443549720606";
process.env.DEV_DISCORD_IDS = "1068567990343303168,1529530952026423401";
process.env.DISCORD_CLIENT_ID = "111111111111111111";
process.env.DISCORD_CLIENT_SECRET = "secret-de-test";
process.env.DISCORD_REDIRECT_URI = "https://dunkerquerp.vercel.app/api/auth/callback/discord";
delete process.env.DISCORD_APPLICATIONS_WEBHOOK_URL;

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const app = require("./index.js");
const L = app.lib;
const SECRET = process.env.SESSION_SECRET, SITE = process.env.NEXT_PUBLIC_SITE_URL;
const OWNER = "1521943443549720606", DEV = "1068567990343303168", STRANGER = "999999999999999999";
const cookieFor = (id) => `eh_session=${L.createSession({ id, name: "Test", avatar: null }, SECRET)}`;

// ---------- Fonctions ----------
test("session : aller-retour, altération, expiration, secret", () => {
  const t = L.createSession({ id: OWNER, name: "A", avatar: null }, SECRET, 1000);
  assert.equal(L.verifySession(t, SECRET, 1001).id, OWNER);
  assert.equal(L.verifySession(t.slice(0, -2) + "xx", SECRET, 1001), null);
  assert.equal(L.verifySession(t, "b".repeat(48), 1001), null);
  assert.equal(L.verifySession(t, SECRET, 1000 + 7 * 86400 + 1), null);
  for (const bad of ["", "abc", "a.b.c", undefined, "x".repeat(3000)]) assert.equal(L.verifySession(bad, SECRET), null);
  const forged = Buffer.from(JSON.stringify({ id: STRANGER, name: "x", iat: 1000, exp: 9e9 })).toString("base64url");
  assert.equal(L.verifySession(`${forged}.${t.split(".")[1]}`, SECRET, 1001), null);
  assert.throws(() => L.createSession({ id: OWNER }, "court"));
  assert.equal(L.needsRenewal(L.verifySession(t, SECRET, 1001), 1000 + 4 * 86400), true);
});
test("rôles du panel", () => {
  const o = process.env.OWNER_DISCORD_IDS, d = process.env.DEV_DISCORD_IDS;
  assert.equal(L.panelRole(OWNER, o, d), "owner");
  assert.equal(L.panelRole(DEV, o, d), "dev");
  assert.equal(L.panelRole(STRANGER, o, d), null);
  assert.equal(L.panelRole(OWNER, "*,abc", ""), null);
});
test("OAuth2 : state, URL, callback, redirections, CSRF", () => {
  const s = L.generateState();
  assert.match(s, /^[0-9a-f]{64}$/); assert.notEqual(s, L.generateState());
  assert.equal(L.statesMatch(s, s), true); assert.equal(L.statesMatch(s, L.generateState()), false); assert.equal(L.statesMatch(undefined, s), false);
  const u = new URL(L.buildAuthorizeUrl("1", process.env.DISCORD_REDIRECT_URI, s));
  assert.equal(u.searchParams.get("scope"), "identify"); assert.equal(u.searchParams.get("redirect_uri"), process.env.DISCORD_REDIRECT_URI);
  assert.deepEqual(L.checkCallback({ code: "abc", state: L.generateState() }, s), { ok: false, error: "invalid_state" });
  assert.deepEqual(L.checkCallback({ error: "access_denied", state: s }, s), { ok: false, error: "access_denied" });
  assert.deepEqual(L.checkCallback({ state: s }, s), { ok: false, error: "missing_code" });
  assert.deepEqual(L.checkCallback({ state: s, code: "a b<script>" }, s), { ok: false, error: "missing_code" });
  assert.deepEqual(L.checkCallback({ state: s, code: "AbC123" }, s), { ok: true, code: "AbC123" });
  for (const bad of ["//evil.com", "https://evil.com", "\\evil", null, ""]) assert.equal(L.safeNext(bad), "/dashboard");
  assert.equal(L.safeNext("/admin"), "/admin");
  assert.equal(L.sameOrigin(SITE, SITE), true); assert.equal(L.sameOrigin("https://evil.com", SITE), false); assert.equal(L.sameOrigin(undefined, SITE), false);
});
const GOOD = { robloxName: "Hans_123", age: 17, department: "Polizei", experience: "Deux ans sur Emergency Hamburg.", motivation: "Je souhaite aider à animer le serveur et patrouiller avec sérieux.", availability: "Soirs et week-ends" };
test("formulaire de candidature", () => {
  assert.equal(L.validateApplication(GOOD).ok, true); assert.equal(L.validateApplication({ ...GOOD, age: "17" }).ok, true);
  for (const [k, v] of Object.entries({ robloxName: "a b", age: 12, department: "Hacker", experience: "court", motivation: "trop court", availability: "" })) {
    const r = L.validateApplication({ ...GOOD, [k]: v }); assert.equal(r.ok, false, k); assert.ok(r.errors[k], k);
  }
  assert.equal(L.validateApplication(null).ok, false);
});
test("webhook : URL validée, aucun ping, limitation de débit", () => {
  assert.equal(L.isValidWebhookUrl("https://discord.com/api/webhooks/1/abc"), true);
  assert.equal(L.isValidWebhookUrl("https://evil.com/api/webhooks/1/abc"), false);
  assert.deepEqual(L.buildWebhookBody(GOOD, { id: OWNER, name: "x" }).allowed_mentions.parse, []);
  L.buckets.clear();
  assert.equal(L.rateLimit("ip", 2, 1000, 0).ok, true); assert.equal(L.rateLimit("ip", 2, 1000, 10).ok, true);
  assert.equal(L.rateLimit("ip", 2, 1000, 20).ok, false); assert.equal(L.rateLimit("ip", 2, 1000, 1500).ok, true);
});

// ---------- Routes HTTP réelles ----------
let server, base;
before(async () => { server = app.listen(0); await new Promise((r) => server.once("listening", r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
const req = (path, o = {}) => fetch(base + path, { redirect: "manual", ...o });

test("pages publiques accessibles", async () => {
  for (const p of ["/", "/serveur", "/equipe", "/support", "/recrutements", "/connexion"]) assert.equal((await req(p)).status, 200, p);
  const home = await (await req("/")).text();
  assert.match(home, /À la une/); assert.equal((await req("/")).headers.get("x-frame-options"), "DENY");
  assert.equal((await req("/inconnue")).status, 404);
});
test("accès non autorisé : dashboard/admin redirigent, APIs refusent", async () => {
  for (const p of ["/dashboard", "/admin"]) { const r = await req(p); assert.equal(r.status, 302); assert.match(r.headers.get("location"), /^\/connexion/); }
  assert.equal((await req("/api/admin/bot-stats")).status, 401);
  assert.equal((await req("/api/auth/session")).status, 401);
  assert.equal((await req("/dashboard", { headers: { cookie: "eh_session=forge.signature" } })).status, 302);
});
test("rôles : inconnu = 404/403, owner et dev = accès", async () => {
  assert.equal((await req("/admin", { headers: { cookie: cookieFor(STRANGER) } })).status, 404);
  assert.equal((await req("/api/admin/bot-stats", { headers: { cookie: cookieFor(STRANGER) } })).status, 403);
  for (const id of [OWNER, DEV]) {
    assert.equal((await req("/admin", { headers: { cookie: cookieFor(id) } })).status, 200);
    assert.equal((await req("/api/admin/bot-stats", { headers: { cookie: cookieFor(id) } })).status, 503); // pas d'API bot configurée
  }
  assert.equal((await req("/dashboard", { headers: { cookie: cookieFor(STRANGER) } })).status, 200);
});
test("login : state en cookie HttpOnly, URL Discord avec scope identify", async () => {
  const r = await req("/api/auth/login?next=/admin");
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get("location"));
  assert.equal(loc.origin, "https://discord.com"); assert.equal(loc.searchParams.get("scope"), "identify");
  const sc = r.headers.getSetCookie().join("\n");
  assert.match(sc, /eh_oauth_state=[0-9a-f]{64}; Path=\/api\/auth; HttpOnly; SameSite=Lax/);
  assert.ok(sc.includes(loc.searchParams.get("state")));
});
test("callback : state absent/invalide rejeté avant tout échange", async () => {
  let r = await req("/api/auth/callback/discord?code=abc&state=" + "a".repeat(64));
  assert.match(r.headers.get("location"), /error=invalid_state/);
  r = await req("/api/auth/callback/discord?error=access_denied");
  assert.match(r.headers.get("location"), /error=invalid_state/);
  const s = L.generateState();
  r = await req(`/api/auth/callback/discord?error=access_denied&state=${s}`, { headers: { cookie: `eh_oauth_state=${s}` } });
  assert.match(r.headers.get("location"), /error=access_denied/);
});
test("déconnexion : POST + Origin obligatoires, cookie supprimé", async () => {
  assert.equal((await req("/api/auth/logout", { method: "POST" })).status, 403);
  assert.equal((await req("/api/auth/logout", { method: "POST", headers: { origin: "https://evil.com" } })).status, 403);
  assert.equal((await req("/api/auth/logout")).status, 404);
  const r = await req("/api/auth/logout", { method: "POST", headers: { origin: SITE, cookie: cookieFor(OWNER) } });
  assert.equal(r.status, 303); assert.match(r.headers.getSetCookie().join(), /eh_session=; Path=\/; HttpOnly.*Max-Age=0/);
});
test("candidatures : origine, session, validation, webhook non configuré", async () => {
  const post = (headers, body) => req("/api/applications", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
  assert.equal((await post({}, GOOD)).status, 403);
  assert.equal((await post({ origin: SITE }, GOOD)).status, 401);
  const h = { origin: SITE, cookie: cookieFor(DEV) };
  assert.equal((await post(h, "pas du json")).status, 400);
  assert.equal((await post(h, { ...GOOD, age: 5 })).status, 422);
  assert.equal((await post(h, { ...GOOD, motivation: "x".repeat(20000) })).status, 413);
  assert.equal((await post(h, GOOD)).status, 503);
  L.buckets.clear();
});
