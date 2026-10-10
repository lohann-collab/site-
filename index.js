// Site Emergency Hamburg — un seul fichier, Express, déployable sur Vercel (export de l'app).
"use strict";
const express = require("express");
const crypto = require("node:crypto");

const SERVER_NAME = "Emergency Hamburg";
const env = (k) => process.env[k] || "";
const PROD = !!process.env.VERCEL || process.env.NODE_ENV === "production";
const siteUrl = () => (env("NEXT_PUBLIC_SITE_URL") || "http://localhost:3000").replace(/\/$/, "");

// ---------- Contenu éditable (exemples génériques : adaptez-les) ----------
const SERVICES = [
  { name: "Polizei", desc: "Patrouilles, contrôles et interventions sur la voie publique.", featured: true },
  { name: "Feuerwehr", desc: "Incendies, sauvetages techniques et secours aux personnes." },
  { name: "Rettungsdienst", desc: "Prise en charge médicale et transport des blessés." },
  { name: "Civils", desc: "Habitants, commerçants et entreprises qui font vivre la ville." },
];
const TEAM = [
  ["Direction", "Renseignez ici les noms de votre équipe (tableau TEAM dans index.js)."],
  ["Administration", "Gestion technique et décisions de fond."],
  ["Modération", "Application du règlement et sanctions."],
  ["Recrutement", "Étude des candidatures des services."],
  ["Support", "Tickets et accompagnement des joueurs."],
];
const RULES = [
  ["Respect", "Aucune insulte, discrimination ou harcèlement, en jeu comme sur Discord."],
  ["Fair-play RP", "Interdiction du FailRP, du RDM/VDM et de l'exploitation de bugs."],
  ["Rôle et service", "Respectez la hiérarchie et les procédures de votre service."],
  ["Pas de métajeu", "Les informations obtenues hors du jeu ne peuvent pas être utilisées en jeu."],
  ["Décisions du staff", "Contestez une sanction par ticket, jamais en public."],
];
const DEPARTMENTS = ["Polizei", "Feuerwehr", "Rettungsdienst", "Autre service"];

// ---------- Sessions signées (HMAC-SHA256) ----------
const SESSION_COOKIE = "eh_session", STATE_COOKIE = "eh_oauth_state", NEXT_COOKIE = "eh_next";
const SESSION_TTL_S = 7 * 86400, RENEW_AFTER_S = 3 * 86400, STATE_TTL_S = 600;
const sign = (data, secret) => crypto.createHmac("sha256", secret).update(data).digest("base64url");
function assertSecret(s) { if (!s || s.length < 32) throw new Error("SESSION_SECRET doit contenir au moins 32 caractères."); return s; }
function createSession(user, secret, now = Math.floor(Date.now() / 1000)) {
  assertSecret(secret);
  const body = Buffer.from(JSON.stringify({ ...user, iat: now, exp: now + SESSION_TTL_S })).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}
function verifySession(token, secret, now = Math.floor(Date.now() / 1000)) {
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
const needsRenewal = (p, now = Math.floor(Date.now() / 1000)) => now - p.iat > RENEW_AFTER_S;
const idList = (v) => String(v || "").split(",").map((s) => s.trim()).filter((s) => /^\d{15,20}$/.test(s));
function panelRole(id, owners, devs) { if (idList(owners).includes(id)) return "owner"; if (idList(devs).includes(id)) return "dev"; return null; }

// ---------- OAuth2 (scope identify uniquement) ----------
const generateState = () => crypto.randomBytes(32).toString("hex");
function statesMatch(c, q) {
  if (!c || !q || !/^[0-9a-f]{64}$/.test(c) || !/^[0-9a-f]{64}$/.test(q)) return false;
  return crypto.timingSafeEqual(Buffer.from(c), Buffer.from(q));
}
function buildAuthorizeUrl(clientId, redirectUri, state) {
  const u = new URL("https://discord.com/oauth2/authorize");
  u.searchParams.set("client_id", clientId); u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code"); u.searchParams.set("scope", "identify");
  u.searchParams.set("state", state); u.searchParams.set("prompt", "none");
  return u.toString();
}
function checkCallback(query, cookieState) {
  if (!statesMatch(cookieState, query.state)) return { ok: false, error: "invalid_state" };
  if (query.error) return { ok: false, error: query.error === "access_denied" ? "access_denied" : "oauth_error" };
  const code = query.code;
  if (typeof code !== "string" || !code || code.length > 512 || !/^[\w.-]+$/.test(code)) return { ok: false, error: "missing_code" };
  return { ok: true, code };
}
function safeNext(n) { return typeof n === "string" && n.startsWith("/") && !n.startsWith("//") && !n.includes("\\") ? n : "/dashboard"; }
function sameOrigin(origin, site) { try { return !!origin && new URL(origin).origin === new URL(site).origin; } catch { return false; } }

// ---------- Validation, limitation de débit, webhook ----------
const clean = (v) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim() : "");
function validateApplication(raw) {
  const r = raw && typeof raw === "object" ? raw : {}, errors = {};
  const robloxName = clean(r.robloxName);
  if (!/^[A-Za-z0-9_]{3,20}$/.test(robloxName)) errors.robloxName = "Pseudo Roblox invalide (3 à 20 caractères : lettres, chiffres, _).";
  const age = typeof r.age === "number" ? r.age : Number(clean(r.age));
  if (!Number.isInteger(age) || age < 13 || age > 99) errors.age = "Âge invalide (13 à 99 ans).";
  const department = clean(r.department);
  if (!DEPARTMENTS.includes(department)) errors.department = "Service inconnu.";
  const experience = clean(r.experience); if (experience.length < 10 || experience.length > 1000) errors.experience = "Expérience : 10 à 1000 caractères.";
  const motivation = clean(r.motivation); if (motivation.length < 30 || motivation.length > 1500) errors.motivation = "Motivation : 30 à 1500 caractères.";
  const availability = clean(r.availability); if (availability.length < 5 || availability.length > 300) errors.availability = "Disponibilités : 5 à 300 caractères.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { robloxName, age, department, experience, motivation, availability } };
}
const buckets = new Map();
function rateLimit(key, max, windowMs, now = Date.now()) {
  const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= max) { buckets.set(key, hits); return { ok: false, retryAfterS: Math.ceil((windowMs - (now - hits[0])) / 1000) }; }
  hits.push(now); buckets.set(key, hits);
  if (buckets.size > 5000) for (const [k, v] of buckets) if (!v.some((t) => now - t < windowMs)) buckets.delete(k);
  return { ok: true, retryAfterS: 0 };
} // Limite : en mémoire, donc par instance serverless (protection partielle sur Vercel).
const isValidWebhookUrl = (u) => typeof u === "string" && u.length < 300 && /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(u);
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
function buildWebhookBody(a, user) {
  return {
    username: "Candidatures — site", allowed_mentions: { parse: [] },
    embeds: [{ title: "Nouvelle candidature (site web)", color: 0xd62828, description: `Candidat : <@${user.id}> (${cut(user.name, 60)})`,
      fields: [
        { name: "Pseudo Roblox", value: cut(a.robloxName, 100), inline: true }, { name: "Âge", value: String(a.age), inline: true },
        { name: "Service", value: a.department, inline: true }, { name: "Expérience", value: cut(a.experience, 1000) },
        { name: "Motivation", value: cut(a.motivation, 1000) }, { name: "Disponibilités", value: cut(a.availability, 300) } ],
      timestamp: new Date().toISOString() }],
  };
}

// ---------- Rendu HTML ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const CSS = `*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#0b0f1a;color:#cbd5e1;min-height:100vh;display:flex;flex-direction:column}
a{color:inherit;text-decoration:none}main{flex:1}.w{max-width:1100px;margin:0 auto;padding:0 16px}.n{max-width:680px;margin:0 auto;padding:0 16px}
header{position:sticky;top:0;background:#0b0f1ae6;border-bottom:1px solid #ffffff1a;z-index:9}header .w{display:flex;flex-wrap:wrap;align-items:center;gap:8px 20px;padding-top:12px;padding-bottom:12px}
.logo{font-weight:800;color:#fff;font-size:18px}nav{display:flex;gap:4px;overflow-x:auto}nav a{padding:6px 10px;border-radius:6px;white-space:nowrap;font-size:14px}nav a:hover{background:#ffffff0d;color:#fff}
.sp{margin-left:auto;display:flex;gap:8px;align-items:center}.btn,button{display:inline-block;background:#d62828;color:#fff;border:0;border-radius:8px;padding:9px 16px;font:600 14px system-ui;cursor:pointer}.btn:hover,button:hover{background:#9d1c1c}
.g{background:none;border:1px solid #ffffff26;color:#f1f5f9}.g:hover{background:#ffffff0d}h1{color:#fff;font-size:32px;margin:0 0 12px}h2{color:#fff}h3{color:#fff;margin:0}
.card{background:#121829;border:1px solid #ffffff1a;border-radius:12px;padding:20px}.f{border-color:#d6282899;box-shadow:0 0 0 1px #d6282866}.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
.hero{text-align:center;padding:72px 0;background:linear-gradient(#d628281f,transparent);border-bottom:1px solid #ffffff1a}.hero h1{font-size:clamp(36px,8vw,64px)}
.tag{color:#d62828;font:700 12px system-ui;text-transform:uppercase;letter-spacing:.12em}input,select,textarea{width:100%;background:#1b2338;border:1px solid #ffffff1a;border-radius:8px;color:#fff;padding:9px 12px;font:14px system-ui;margin-top:4px}
label{display:block;font-size:14px;margin-bottom:14px}.err{color:#f87171;font-size:13px}.ok{color:#4ade80}.m{color:#94a3b8;font-size:14px}footer{border-top:1px solid #ffffff1a;padding:28px 16px;text-align:center;font-size:12px;color:#64748b}
code{background:#1b2338;padding:1px 5px;border-radius:4px}.row{display:flex;justify-content:space-between;gap:12px;margin:8px 0}`;
function layout(title, body, session) {
  const role = session && panelRole(session.id, env("OWNER_DISCORD_IDS"), env("DEV_DISCORD_IDS"));
  const nav = [["/serveur", "Le serveur"], ["/equipe", "Équipe & règlement"], ["/recrutements", "Recrutements"], ["/support", "Support"]]
    .map(([h, l]) => `<a href="${h}">${l}</a>`).join("");
  const right = session
    ? `<a class="btn g" href="/dashboard">${esc(session.name)}</a>${role ? '<a class="btn g" href="/admin">Admin</a>' : ""}<form action="/api/auth/logout" method="post" style="margin:0"><button class="g" type="submit">Déconnexion</button></form>`
    : `<a class="btn" href="/connexion">Connexion Discord</a>`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0b0f1a">
<title>${esc(title)} | ${SERVER_NAME}</title><style>${CSS}</style></head><body><header><div class="w"><a class="logo" href="/">🚨 ${SERVER_NAME}</a><nav aria-label="Navigation principale">${nav}</nav><div class="sp">${right}</div></div></header>
<main>${body}</main><footer>© ${new Date().getFullYear()} ${SERVER_NAME}. Site communautaire non officiel, sans lien avec les créateurs du jeu Roblox « Emergency Hamburg ».</footer></body></html>`;
}
const invite = () => esc(env("NEXT_PUBLIC_DISCORD_INVITE_URL") || "#");
const PAGES = {
  home: () => `<section class="hero"><div class="w"><p class="tag">Serveur communautaire</p><h1>${SERVER_NAME}</h1>
<p style="max-width:640px;margin:0 auto 24px">Rejoignez une communauté francophone de jeu de rôle, et enfilez l'uniforme de la Polizei pour patrouiller dans les rues de la ville.</p>
<a class="btn" href="/recrutements">Rejoindre la Polizei</a> <a class="btn g" href="${invite()}" rel="noopener noreferrer">Rejoindre le Discord</a></div></section>
<section class="w" style="padding:48px 16px"><h2>Les services</h2><div class="grid">${SERVICES.map((s) =>
    `<article class="card${s.featured ? " f" : ""}">${s.featured ? '<p class="tag">À la une</p>' : ""}<h3>${esc(s.name)}</h3><p class="m">${esc(s.desc)}</p></article>`).join("")}</div></section>`,
  serveur: () => `<div class="n" style="padding:48px 16px"><h1>Présentation de ${SERVER_NAME}</h1><p>Notre communauté organise des sessions de jeu de rôle autour des services d'urgence et de la vie civile. Ce texte est un exemple : modifiez-le dans <code>index.js</code>.</p>
<h2>Ce que vous pouvez y faire</h2><ul>${SERVICES.map((s) => `<li><strong>${esc(s.name)}</strong> — ${esc(s.desc)}</li>`).join("")}</ul></div>`,
  equipe: () => `<div class="w" style="padding:48px 16px"><h1>Équipe</h1><div class="grid">${TEAM.map(([r, n]) => `<div class="card"><h3>${esc(r)}</h3><p class="m">${esc(n)}</p></div>`).join("")}</div>
<h2 style="margin-top:40px">Règlement</h2>${RULES.map(([t, b], i) => `<div class="card" style="margin-bottom:12px"><h3>${i + 1}. ${esc(t)}</h3><p class="m">${esc(b)}</p></div>`).join("")}</div>`,
  support: () => `<div class="n" style="padding:48px 16px"><h1>Support</h1><p>Les tickets sont gérés directement sur Discord, avec des salons privés entre vous et l'équipe de support :</p>
<ol><li>Rejoignez le serveur Discord.</li><li>Dans le salon de support, choisissez une catégorie dans le menu du panneau.</li><li>Décrivez votre demande dans le salon privé créé pour vous.</li></ol>
<a class="btn" href="${invite()}" rel="noopener noreferrer">Ouvrir Discord</a><p class="m" style="margin-top:24px">Les tickets ne sont pas créés depuis le site : la base SQLite du bot est hébergée chez DisHost et n'est volontairement pas accessible depuis Internet.</p></div>`,
  recrutements: (session) => `<div class="n" style="padding:48px 16px"><h1>Recrutements</h1><p>Une candidature en attente à la fois, transmise à l'équipe sur Discord. Vous pouvez aussi utiliser <code>/candidature</code> sur le serveur.</p>
${session ? `<form id="f" class="card" novalidate><label>Pseudo Roblox<input name="robloxName" required minlength="3" maxlength="20" autocomplete="off"><span class="err" data-k="robloxName"></span></label>
<label>Âge<input name="age" type="number" min="13" max="99" required><span class="err" data-k="age"></span></label>
<label>Service souhaité<select name="department">${DEPARTMENTS.map((d) => `<option>${d}</option>`).join("")}</select></label>
<label>Expérience<textarea name="experience" rows="3" required maxlength="1000"></textarea><span class="err" data-k="experience"></span></label>
<label>Motivation<textarea name="motivation" rows="5" required maxlength="1500"></textarea><span class="err" data-k="motivation"></span></label>
<label>Disponibilités<input name="availability" required maxlength="300"><span class="err" data-k="availability"></span></label>
<button type="submit">Envoyer ma candidature</button><p id="msg" role="status"></p></form>
<script>document.getElementById("f").addEventListener("submit",async function(e){e.preventDefault();var f=e.target,m=document.getElementById("msg");
f.querySelectorAll("[data-k]").forEach(function(x){x.textContent=""});m.textContent="Envoi…";m.className="";
try{var r=await fetch("/api/applications",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.fromEntries(new FormData(f)))});var b=await r.json();
if(r.ok){f.reset();m.textContent="Candidature envoyée ! Vous serez recontacté sur Discord.";m.className="ok"}else{m.textContent=b.error||"Erreur.";m.className="err";
Object.entries(b.fields||{}).forEach(function(kv){var s=f.querySelector('[data-k="'+kv[0]+'"]');if(s)s.textContent=kv[1]})}}catch(x){m.textContent="Réseau indisponible.";m.className="err"}});</script>`
    : `<div class="card" style="text-align:center"><p>Connectez-vous avec Discord pour postuler.</p><a class="btn" href="/connexion?next=/recrutements">Connexion Discord</a></div>`}</div>`,
};
const ERRORS = { access_denied: "Vous avez refusé l'autorisation sur Discord.", invalid_state: "Session de connexion expirée ou invalide. Réessayez.", missing_code: "Réponse de Discord incomplète. Réessayez.",
  oauth_error: "Discord a renvoyé une erreur. Réessayez.", token_exchange: "Échange avec Discord impossible. Réessayez.", profile: "Profil Discord illisible. Réessayez.",
  network: "Discord est injoignable pour le moment.", rate_limited: "Trop de tentatives. Patientez une minute.", config: "Connexion non configurée côté serveur." };

// ---------- Application ----------
const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()", "Strict-Transport-Security": "max-age=63072000; includeSubDomains" });
  const jar = {};
  for (const part of (req.headers.cookie || "").split(";")) { const i = part.indexOf("="); if (i > 0) jar[part.slice(0, i).trim()] = part.slice(i + 1).trim(); }
  req.cookiesMap = jar;
  const secret = env("SESSION_SECRET");
  req.session = secret.length >= 32 ? verifySession(jar[SESSION_COOKIE], secret) : null;
  req.role = req.session ? panelRole(req.session.id, env("OWNER_DISCORD_IDS"), env("DEV_DISCORD_IDS")) : null;
  next();
});
const setCookie = (res, name, value, { path = "/", maxAge } = {}) =>
  res.append("Set-Cookie", `${name}=${value}; Path=${path}; HttpOnly; SameSite=Lax; ${PROD ? "Secure; " : ""}${maxAge === undefined ? "" : `Max-Age=${maxAge}`}`.replace(/;\s*$/, ""));
const clearCookie = (res, name, path = "/") => setCookie(res, name, "", { path, maxAge: 0 });
const ipOf = (req) => (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "inconnu").toString().split(",")[0].trim();
const html = (res, status, body) => res.status(status).set("Cache-Control", "no-store").type("html").send(body);

for (const [path, key, title] of [["/", "home", "Accueil"], ["/serveur", "serveur", "Le serveur"], ["/equipe", "equipe", "Équipe & règlement"], ["/support", "support", "Support"], ["/recrutements", "recrutements", "Recrutements"]]) {
  app.get(path, (req, res) => html(res, 200, layout(title, PAGES[key](req.session), req.session)));
}
app.get("/connexion", (req, res) => {
  if (req.session) return res.redirect(safeNext(req.query.next));
  const e = typeof req.query.error === "string" ? req.query.error : "";
  html(res, 200, layout("Connexion", `<div class="n" style="padding:64px 16px"><div class="card" style="text-align:center"><h1>Connexion</h1>
<p class="m">Nous lisons uniquement votre identifiant, pseudo et avatar Discord (scope « identify »).</p>${e ? `<p class="err" role="alert">${esc(ERRORS[e] || "Erreur de connexion.")}</p>` : ""}
<a class="btn" href="/api/auth/login?next=${encodeURIComponent(safeNext(req.query.next))}">Se connecter avec Discord</a></div></div>`, null));
});
app.get("/dashboard", (req, res) => {
  if (!req.session) return res.redirect("/connexion?next=/dashboard"); // contrôle réel côté serveur
  const s = req.session;
  const av = s.avatar && /^[a-f0-9_]+$/i.test(s.avatar) ? `<img src="https://cdn.discordapp.com/avatars/${s.id}/${s.avatar}.png?size=96" alt="" width="64" height="64" style="border-radius:50%">` : "";
  html(res, 200, layout("Tableau de bord", `<div class="n" style="padding:48px 16px"><div style="display:flex;gap:16px;align-items:center">${av}<div><h1 style="margin:0">Bonjour, ${esc(s.name)}</h1><p class="m" style="margin:0">Compte Discord n°${esc(s.id)}</p></div></div>
<div class="grid" style="margin-top:32px"><a class="card" href="/recrutements"><h3>Postuler</h3><p class="m">Déposer une candidature à un service.</p></a><a class="card" href="/support"><h3>Support</h3><p class="m">Ouvrir un ticket sur Discord.</p></a>
${req.role ? '<a class="card" href="/admin"><h3>Administration</h3><p class="m">État du bot et configuration.</p></a>' : ""}</div></div>
<script>fetch("/api/auth/session",{credentials:"same-origin",cache:"no-store"}).catch(function(){})</script>`, s));
});
async function fetchBotStats() {
  const url = env("BOT_API_URL"), token = env("BOT_API_TOKEN");
  if (!url || token.length < 32 || (PROD && !url.startsWith("https://"))) return { ok: false, configured: false, reason: "API du bot non configurée." };
  try {
    const r = await fetch(`${url.replace(/\/$/, "")}/api/stats`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
    return r.ok ? { ok: true, configured: true, data: await r.json() } : { ok: false, configured: true, reason: `L'API du bot a répondu ${r.status}.` };
  } catch { return { ok: false, configured: true, reason: "API du bot injoignable." }; }
}
app.get("/admin", async (req, res) => {
  if (!req.session) return res.redirect("/connexion?next=/admin");
  if (!req.role) return html(res, 404, layout("Introuvable", `<div class="n" style="padding:64px 16px"><h1>Page introuvable</h1></div>`, req.session));
  const st = await fetchBotStats();
  const checks = [["Connexion Discord (client ID + secret + redirect)", !!(env("DISCORD_CLIENT_ID") && env("DISCORD_CLIENT_SECRET") && env("DISCORD_REDIRECT_URI"))],
    ["Secret de session (32+ caractères)", env("SESSION_SECRET").length >= 32], ["Webhook des candidatures", isValidWebhookUrl(env("DISCORD_APPLICATIONS_WEBHOOK_URL"))], ["API du bot", st.configured]];
  const stats = st.ok ? `<div class="grid">${[["Membres", st.data.members], ["Tickets ouverts", st.data.tickets_open], ["Candidatures", st.data.applications_pending], ["Avertissements", st.data.warnings_active]]
    .map(([k, v]) => `<div><div class="m">${k}</div><strong style="font-size:24px;color:#fff">${esc(v)}</strong></div>`).join("")}</div>`
    : `<p class="m">${st.configured ? esc(st.reason) : "Aucune API de bot configurée (BOT_API_URL / BOT_API_TOKEN) : statistiques en direct indisponibles."}</p>`;
  html(res, 200, layout("Administration", `<div class="n" style="padding:48px 16px"><h1>Administration <span class="tag">${req.role === "owner" ? "Owner" : "Développeur"}</span></h1>
<div class="card"><h2>État du bot</h2>${stats}</div><div class="card" style="margin-top:16px"><h2>Configuration du site</h2>${checks.map(([n, ok]) =>
    `<div class="row"><span>${n}</span><span class="${ok ? "ok" : "err"}">${ok ? "OK" : "Non configuré"}</span></div>`).join("")}</div>
${req.role === "owner" ? `<div class="card" style="margin-top:16px"><h2>Accès au panel (owner)</h2><p class="m">Variables Vercel <code>OWNER_DISCORD_IDS</code> et <code>DEV_DISCORD_IDS</code>, puis redéploiement.</p></div>` : ""}</div>`, req.session));
});

// --- OAuth2 ---
app.get("/api/auth/login", (req, res) => {
  const id = env("DISCORD_CLIENT_ID"), redirect = env("DISCORD_REDIRECT_URI");
  if (!id || !redirect || !env("DISCORD_CLIENT_SECRET")) return res.redirect(`${siteUrl()}/connexion?error=config`);
  const state = generateState();
  setCookie(res, STATE_COOKIE, state, { path: "/api/auth", maxAge: STATE_TTL_S });
  setCookie(res, NEXT_COOKIE, encodeURIComponent(safeNext(req.query.next)), { path: "/api/auth", maxAge: STATE_TTL_S });
  res.redirect(buildAuthorizeUrl(id, redirect, state));
});
app.get("/api/auth/callback/discord", async (req, res) => {
  const fail = (e) => { clearCookie(res, STATE_COOKIE, "/api/auth"); clearCookie(res, NEXT_COOKIE, "/api/auth"); return res.redirect(`${siteUrl()}/connexion?error=${e}`); };
  if (!rateLimit(`cb:${ipOf(req)}`, 20, 60000).ok) return fail("rate_limited");
  const chk = checkCallback(req.query, req.cookiesMap[STATE_COOKIE]);
  if (!chk.ok) return fail(chk.error);
  const secret = env("SESSION_SECRET");
  if (!env("DISCORD_CLIENT_ID") || !env("DISCORD_CLIENT_SECRET") || !env("DISCORD_REDIRECT_URI") || secret.length < 32) return fail("config");
  try {
    const tr = await fetch("https://discord.com/api/oauth2/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: env("DISCORD_CLIENT_ID"), client_secret: env("DISCORD_CLIENT_SECRET"), grant_type: "authorization_code", code: chk.code, redirect_uri: env("DISCORD_REDIRECT_URI") }),
      signal: AbortSignal.timeout(8000) });
    if (!tr.ok) return fail("token_exchange");
    const tok = await tr.json();
    if (!tok.access_token || String(tok.token_type).toLowerCase() !== "bearer") return fail("token_exchange");
    const mr = await fetch("https://discord.com/api/users/@me", { headers: { Authorization: `Bearer ${tok.access_token}` }, signal: AbortSignal.timeout(8000) });
    if (!mr.ok) return fail("profile");
    const me = await mr.json();
    if (!me.id || !/^\d{15,20}$/.test(me.id) || !me.username) return fail("profile");
    // Seule l'identité minimale est conservée ; le jeton d'accès Discord est abandonné.
    const value = createSession({ id: me.id, name: String(me.global_name || me.username).slice(0, 64), avatar: me.avatar || null }, secret);
    let next = "/dashboard"; try { next = safeNext(decodeURIComponent(req.cookiesMap[NEXT_COOKIE] || "")); } catch { /* valeur par défaut */ }
    setCookie(res, SESSION_COOKIE, value, { maxAge: SESSION_TTL_S });
    clearCookie(res, STATE_COOKIE, "/api/auth"); clearCookie(res, NEXT_COOKIE, "/api/auth");
    res.redirect(`${siteUrl()}${next}`);
  } catch { fail("network"); }
});
app.post("/api/auth/logout", (req, res) => {
  if (!sameOrigin(req.headers.origin, siteUrl())) return res.status(403).json({ error: "Origine refusée." });
  clearCookie(res, SESSION_COOKIE); res.redirect(303, `${siteUrl()}/`);
});
app.get("/api/auth/session", (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!req.session) return res.status(401).json({ user: null });
  if (needsRenewal(req.session)) setCookie(res, SESSION_COOKIE, createSession({ id: req.session.id, name: req.session.name, avatar: req.session.avatar }, env("SESSION_SECRET")), { maxAge: SESSION_TTL_S });
  res.json({ user: { id: req.session.id, name: req.session.name } });
});

// --- Candidatures et API admin ---
app.post("/api/applications", express.json({ limit: "10kb" }), async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!sameOrigin(req.headers.origin, siteUrl())) return res.status(403).json({ error: "Origine refusée." });
  if (!req.session) return res.status(401).json({ error: "Connexion Discord requise." });
  const rl = rateLimit(`app:${req.session.id}`, 3, 3600000);
  if (!rl.ok) return res.status(429).set("Retry-After", String(rl.retryAfterS)).json({ error: "Trop de tentatives. Réessayez plus tard." });
  const v = validateApplication(req.body);
  if (!v.ok) return res.status(422).json({ error: "Formulaire invalide.", fields: v.errors });
  const hook = env("DISCORD_APPLICATIONS_WEBHOOK_URL");
  if (!isValidWebhookUrl(hook)) return res.status(503).json({ error: "Les candidatures en ligne ne sont pas encore activées. Utilisez la commande /candidature sur Discord." });
  try {
    const r = await fetch(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(buildWebhookBody(v.value, req.session)), signal: AbortSignal.timeout(8000) });
    if (!r.ok) return res.status(502).json({ error: "Envoi impossible pour le moment." });
  } catch { return res.status(502).json({ error: "Envoi impossible pour le moment." }); }
  res.status(201).json({ ok: true });
});
app.use((err, req, res, next) => { // JSON invalide ou trop gros
  if (err && err.type === "entity.too.large") return res.status(413).json({ error: "Requête trop volumineuse." });
  if (err && err.type === "entity.parse.failed") return res.status(400).json({ error: "Corps JSON invalide." });
  next(err);
});
app.get("/api/admin/bot-stats", async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!req.session) return res.status(401).json({ error: "Non authentifié." });
  if (!req.role) return res.status(403).json({ error: "Accès refusé." });
  const st = await fetchBotStats();
  st.ok ? res.json(st.data) : res.status(503).json({ error: st.reason });
});
app.use((req, res) => html(res, 404, layout("Introuvable", `<div class="n" style="padding:64px 16px"><h1>Page introuvable</h1><a class="btn" href="/">Retour à l'accueil</a></div>`, req.session)));

module.exports = app;
module.exports.lib = { createSession, verifySession, needsRenewal, panelRole, generateState, statesMatch, buildAuthorizeUrl, checkCallback, safeNext, sameOrigin, validateApplication, rateLimit, isValidWebhookUrl, buildWebhookBody, buckets };
if (require.main === module) app.listen(process.env.PORT || 3000, () => console.log("Site prêt sur le port", process.env.PORT || 3000));
