(function () {
  "use strict";
  var SITE = window.SITE || {};
  var page = document.body.getAttribute("data-page") || "";
  var LEVELS = { member: 0, staff: 1, dev: 2, owner: 3 };

  // ---------- outils ----------
  function $(s) { return document.querySelector(s); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function param(k) { return new URLSearchParams(location.search).get(k); }
  function safeNext(n) { return typeof n === "string" && n.charAt(0) === "/" && n.charAt(1) !== "/" && n.indexOf("\\") < 0 && n.indexOf("/api") !== 0 ? n : "/dashboard"; }
  function safeImg(u) { return typeof u === "string" && /^https:\/\/(cdn|media)\.discordapp\.(com|net)\//.test(u) ? u : ""; }
  function fmtDate(sec) { return new Date(sec * 1000).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }
  function fmtTime(sec) { return new Date(sec * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
  function fmtBytes(n) { return n >= 1073741824 ? (n / 1073741824).toFixed(1) + " Go" : Math.round(n / 1048576) + " Mo"; }
  function fmtUptime(s) { var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return (d ? d + " j " : "") + h + " h " + m + " min"; }

  function api(path, opts) {
    opts = opts || {};
    var init = { credentials: "same-origin", cache: "no-store", method: opts.method || "GET", headers: {} };
    if (opts.body !== undefined) { init.method = opts.method || "POST"; init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(opts.body); }
    return fetch(path, init)
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, data: d }; }); })
      .catch(function () { return { ok: false, status: 0, data: { error: "Réseau indisponible." } }; });
  }
  function poll(fn, ms) { fn(); setInterval(function () { if (document.visibilityState === "visible") fn(); }, ms); }
  function say(node, text, good) { node.textContent = text; node.className = "status " + (good ? "ok" : "err"); }

  // ---------- liens Discord / session ----------
  document.querySelectorAll("[data-invite]").forEach(function (a) { if (SITE.invite) a.setAttribute("href", SITE.invite); else a.hidden = true; });
  document.querySelectorAll("[data-session]").forEach(function (a) { if (SITE.session) a.setAttribute("href", SITE.session); else a.hidden = true; });

  var ready = api("/api/auth/session").then(function (r) { return r.ok ? r.data : { user: null, level: null, can_sanction: false }; });

  ready.then(function (d) {
    var zone = $("#user-zone");
    if (!zone) return;
    clear(zone);
    if (d.user) {
      var me = el("a", "btn btn-ghost", d.user.name); me.href = "/dashboard"; zone.appendChild(me);
      var out = el("button", "btn btn-ghost", "Déconnexion"); out.type = "button";
      out.addEventListener("click", function () { api("/api/auth/logout", { method: "POST", body: {} }).then(function () { location.href = "/"; }); });
      zone.appendChild(out);
    } else if (page !== "connexion") {
      var lg = el("a", "btn btn-signal", "Connexion Discord");
      lg.href = "/connexion?next=" + encodeURIComponent(location.pathname);
      zone.appendChild(lg);
    }
  });

  // Page réservée : redirige si déconnecté, affiche #denied si le niveau est insuffisant.
  function guard(test, cb) {
    ready.then(function (d) {
      if (!d.user) { location.replace("/connexion?next=" + encodeURIComponent(location.pathname)); return; }
      if (!test(d)) { var x = $("#denied"); if (x) x.hidden = false; return; }
      var c = $("#content"); if (c) c.hidden = false;
      cb(d);
    });
  }
  var atLeast = function (min) { return function (d) { return LEVELS[d.level] >= LEVELS[min]; }; };

  // ---------- composants ----------
  function renderPeople(box, list, emptyText) {
    clear(box);
    if (!list || !list.length) { box.appendChild(el("li", "empty", emptyText)); return; }
    list.forEach(function (p) {
      var li = el("li", "person");
      var img = el("img"); img.alt = ""; img.width = 48; img.height = 48; img.loading = "lazy";
      if (safeImg(p.avatar)) img.src = p.avatar;
      var t = el("div"); t.appendChild(el("b", "", p.name)); if (p.role) t.appendChild(el("span", "", p.role));
      li.appendChild(img); li.appendChild(t); box.appendChild(li);
    });
  }

  function renderAnnouncement(box) {
    api("/api/public/announcement").then(function (r) {
      clear(box);
      var a = r.ok && r.data.announcement;
      if (!a) { box.appendChild(el("p", "empty", r.ok ? "Aucune annonce pour le moment." : "Les annonces sont momentanément indisponibles.")); return; }
      var wrap = el("div", "announce");
      wrap.appendChild(el("p", "", a.content || ""));
      wrap.appendChild(el("small", "", "Par " + a.author + " · " + new Date(a.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })));
      var u = safeImg(a.image); if (u) { var img = el("img"); img.src = u; img.alt = ""; img.loading = "lazy"; wrap.appendChild(img); }
      box.appendChild(wrap);
    });
  }

  function barChart(box, rows) {
    clear(box);
    var ns = "http://www.w3.org/2000/svg", W = 640, H = 220, L = 34, R = 6, T = 10, B = 26;
    var max = Math.max(1, Math.max.apply(null, rows.map(function (r) { return r.count; })));
    var top = max <= 4 ? 4 : Math.ceil(max / 4) * 4;
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.setAttribute("class", "chart"); svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Messages envoyés par jour sur les 30 derniers jours");
    function add(tag, attrs, text) { var n = document.createElementNS(ns, tag); Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); }); if (text != null) n.textContent = text; svg.appendChild(n); return n; }
    for (var i = 0; i <= 4; i++) {
      var y = T + (H - T - B) * (1 - i / 4);
      add("line", { x1: L, x2: W - R, y1: y, y2: y, "class": "grid-line" });
      add("text", { x: L - 6, y: y + 4, "text-anchor": "end", "class": "axis" }, String(Math.round(top * i / 4)));
    }
    var slot = (W - L - R) / rows.length;
    rows.forEach(function (r, idx) {
      var h = (H - T - B) * r.count / top;
      add("rect", { x: L + idx * slot + slot * .15, y: H - B - h, width: slot * .7, height: Math.max(h, r.count ? 1 : 0), "class": "bar" });
    });
    [0, Math.floor(rows.length / 2), rows.length - 1].forEach(function (idx) {
      var d = rows[idx].day.slice(8) + "/" + rows[idx].day.slice(5, 7);
      add("text", { x: L + idx * slot + slot / 2, y: H - 8, "text-anchor": "middle", "class": "axis" }, d);
    });
    box.appendChild(svg);
  }

  // Sélecteur de membre (recherche côté bot).
  function makePicker(input, results, pickedBox, onPick) {
    var timer = null, current = null;
    function choose(m) {
      current = m; clear(results); input.value = "";
      clear(pickedBox);
      var chip = el("span", "picked"); chip.appendChild(el("b", "", m.name));
      var b = el("button", "btn btn-small", "Changer"); b.type = "button";
      b.addEventListener("click", function () { current = null; clear(pickedBox); input.hidden = false; input.focus(); onPick(null); });
      chip.appendChild(b); pickedBox.appendChild(chip); input.hidden = true; onPick(m);
    }
    input.addEventListener("input", function () {
      clearTimeout(timer);
      var q = input.value.trim();
      if (q.length < 2) { clear(results); return; }
      timer = setTimeout(function () {
        api("/api/bot/members/search?q=" + encodeURIComponent(q)).then(function (r) {
          clear(results);
          (r.data.members || []).forEach(function (m) {
            var li = el("li"), b = el("button"); b.type = "button";
            var img = el("img"); img.alt = ""; if (safeImg(m.avatar)) img.src = m.avatar;
            b.appendChild(img); b.appendChild(el("span", "", m.name + (m.role ? " · " + m.role : "")));
            b.addEventListener("click", function () { choose(m); });
            li.appendChild(b); results.appendChild(li);
          });
          if (!results.firstChild) results.appendChild(el("li", "empty", r.ok ? "Aucun membre trouvé." : (r.data.error || "Recherche impossible.")));
        });
      }, 300);
    });
    return { get: function () { return current; } };
  }

  function sanctionLine(s, who) {
    var li = el("li"), left = el("div");
    left.appendChild(el("span", "tag" + (s.active ? "" : " tag-off"), s.type));
    left.appendChild(document.createTextNode(" " + (who === "moderator" ? "par " + s.moderator : s.user) + (s.reason ? " — " + s.reason : "")));
    li.appendChild(left); li.appendChild(el("small", "", fmtDate(s.created_at)));
    return li;
  }

  // ---------- pages ----------
  if (page === "home") {
    renderAnnouncement($("#annonce"));
    api("/api/public/stats").then(function (r) {
      if (!r.ok) return;
      var box = $("#facts");
      [[r.data.members, "membres"], [r.data.staff_online, "staff en service"]].forEach(function (p) {
        var d = el("div"); d.appendChild(el("b", "", String(p[0]))); d.appendChild(el("span", "", p[1])); box.appendChild(d);
      });
    });
  }

  if (page === "staff") {
    api("/api/public/staff").then(function (r) {
      var d = r.ok ? r.data : {};
      var msg = r.ok ? null : "Liste momentanément indisponible.";
      renderPeople($("#g-owners"), d.owners, msg || "Aucun owner affiché.");
      renderPeople($("#g-devs"), d.devs, msg || "Aucun développeur affiché.");
      renderPeople($("#g-onduty"), d.onduty, msg || "Personne n'est en service pour le moment.");
      renderPeople($("#g-staff"), d.staff, msg || "Aucun membre du staff affiché.");
    });
  }

  if ($("#zones")) {
    var zbox = $("#zones"), zlist = SITE.zones || [];
    if (page === "home") zlist = zlist.slice(0, 3);
    zlist.forEach(function (z) {
      var li = el("li"), fig = el("figure");
      if (typeof z.image === "string" && /^(\/|https:\/\/)/.test(z.image) && z.image) { var img = el("img"); img.src = z.image; img.alt = z.name; img.loading = "lazy"; fig.appendChild(img); }
      else fig.appendChild(el("div", "zone-ph", z.name));
      var cap = el("figcaption"); cap.appendChild(el("b", "", z.name)); if (z.description) cap.appendChild(document.createTextNode(z.description));
      fig.appendChild(cap); li.appendChild(fig); zbox.appendChild(li);
    });
  }

  if (page === "connexion") {
    var next = safeNext(param("next")), e = param("error");
    var ERRORS = {
      access_denied: "Vous avez refusé l'autorisation sur Discord.", invalid_state: "La session de connexion a expiré ou n'est pas valide. Réessayez.",
      missing_code: "La réponse de Discord est incomplète. Réessayez.", oauth_error: "Discord a renvoyé une erreur. Réessayez.",
      token_exchange: "L'échange avec Discord a échoué. Réessayez.", profile: "Votre profil Discord est illisible. Réessayez.",
      network: "Discord est injoignable pour le moment. Réessayez dans un instant.", rate_limited: "Trop de tentatives. Patientez une minute.",
      config: "La connexion n'est pas encore configurée côté serveur."
    };
    if (e) { var box = $("#login-error"); box.textContent = ERRORS[e] || "Erreur de connexion."; box.hidden = false; }
    $("#login-link").href = "/api/auth/login?next=" + encodeURIComponent(next);
    ready.then(function (d) { if (d.user) location.replace(next); });
  }

  if (page === "dashboard") {
    ready.then(function (d) {
      if (!d.user) { location.replace("/connexion?next=/dashboard"); return; }
      $("#hello").textContent = "Bonjour, " + d.user.name;
      var labels = { member: "Membre", staff: "Staff", dev: "Développeur", owner: "Owner" };
      $("#idline").textContent = labels[d.level] || "Membre";
      if (/^\d{15,20}$/.test(d.user.id) && /^[a-f0-9_]+$/i.test(d.user.avatar || "")) {
        var img = $("#avatar"); img.src = "https://cdn.discordapp.com/avatars/" + d.user.id + "/" + d.user.avatar + ".png?size=96"; img.hidden = false;
      }
      document.querySelectorAll("[data-min]").forEach(function (n) { if (LEVELS[d.level] >= LEVELS[n.getAttribute("data-min")]) n.hidden = false; });
      document.querySelectorAll("[data-perm='sanction']").forEach(function (n) { if (d.can_sanction || d.level === "owner") n.hidden = false; });
      renderAnnouncement($("#annonce"));
    });
  }

  if (page === "recrutements" || page === "appel") {
    ready.then(function (d) {
      if (!d.user) { $("#gate").hidden = false; return; }
      var form = $("#apply-form"), msg = $("#msg");
      form.hidden = false;
      if (page === "recrutements") {
        api("/api/applications").then(function (r) {
          var sel = form.elements.department;
          (r.data.departments || []).forEach(function (n) { var o = el("option", "", n); o.value = n; sel.appendChild(o); });
        });
      }
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        form.querySelectorAll("[data-err]").forEach(function (x) { x.textContent = ""; });
        msg.textContent = "Envoi en cours…"; msg.className = "status";
        api(page === "appel" ? "/api/appeals" : "/api/applications", { body: Object.fromEntries(new FormData(form)) }).then(function (r) {
          if (r.ok) { form.reset(); say(msg, page === "appel" ? "Demande envoyée. L'équipe vous répondra sur Discord." : "Candidature envoyée. L'équipe vous recontacte sur Discord.", true); return; }
          say(msg, r.data.error || "Une erreur est survenue.", false);
          Object.keys(r.data.fields || {}).forEach(function (k) { var s = form.querySelector('[data-err="' + k + '"]'); if (s) s.textContent = r.data.fields[k]; });
        });
      });
    });
  }

  if (page === "activite") {
    guard(atLeast("staff"), function () {
      api("/api/bot/me/stats").then(function (r) {
        if (!r.ok) { say($("#msg"), r.data.error || "Statistiques indisponibles.", false); return; }
        var d = r.data;
        $("#n-messages").textContent = String(d.messages_total);
        $("#n-tickets").textContent = String(d.tickets_taken);
        barChart($("#chart"), d.messages_by_day);
        var chips = $("#roles"); clear(chips);
        [["Rôle le plus haut", d.highest_role], ["Rôle le plus bas", d.lowest_role]].forEach(function (p) {
          var li = el("li", "chip"), dot = el("span", "dot");
          if (p[1] && /^#[0-9a-f]{6}$/i.test(p[1].color) && p[1].color !== "#000000") dot.style.background = p[1].color;
          li.appendChild(dot); li.appendChild(document.createTextNode(p[0] + " : " + (p[1] ? p[1].name : "aucun"))); chips.appendChild(li);
        });
        var rec = $("#received"), giv = $("#given"); clear(rec); clear(giv);
        d.sanctions_received.forEach(function (s) { rec.appendChild(sanctionLine(s, "moderator")); });
        d.sanctions_given.forEach(function (s) { giv.appendChild(sanctionLine(s, "user")); });
        if (!rec.firstChild) rec.appendChild(el("li", "empty", "Aucune sanction reçue."));
        if (!giv.firstChild) giv.appendChild(el("li", "empty", "Aucune sanction donnée."));
      });
    });
  }

  if (page === "chat-staff") {
    guard(atLeast("staff"), function (d) {
      var box = $("#chat"), lastId = 0, form = $("#chat-form"), input = $("#chat-input");
      function add(m) {
        var near = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
        var row = el("div", "msg"); row.appendChild(el("b", "", m.name)); row.appendChild(el("time", "", fmtTime(m.created_at)));
        row.appendChild(el("div", "", m.content)); box.appendChild(row);
        lastId = Math.max(lastId, m.id); if (near) box.scrollTop = box.scrollHeight;
      }
      function load() {
        api("/api/bot/staffchat?after=" + lastId).then(function (r) {
          if (r.ok) { r.data.messages.forEach(add); if (!lastId && !box.firstChild) box.appendChild(el("p", "empty", "Aucun message pour le moment.")); }
        });
      }
      poll(function () { if (box.firstChild && box.firstChild.className === "empty") clear(box); load(); }, 8000);
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var text = input.value.trim(); if (!text) return;
        api("/api/bot/staffchat", { body: { content: text } }).then(function (r) { if (r.ok) { input.value = ""; load(); } else say($("#msg"), r.data.error || "Envoi impossible.", false); });
      });
    });
  }

  if (page === "sanctions") {
    guard(function (d) { return d.can_sanction || d.level === "owner"; }, function () {
      var roles = [], member = null, msg = $("#msg");
      var picker = makePicker($("#q"), $("#results"), $("#picked"), function (m) { member = m; fillRank(); });
      var kind = $("#kind"), rem = $("#remove-role"), add = $("#add-role"), rankSel = $("#rank-role");
      function opts(sel, list, placeholder) {
        clear(sel); var p = el("option", "", placeholder); p.value = ""; sel.appendChild(p);
        list.forEach(function (r) { var o = el("option", "", r.name + (r.assignable ? "" : " (trop haut pour le bot)")); o.value = r.id; o.disabled = !r.assignable; sel.appendChild(o); });
      }
      function posOf(id) { var r = roles.filter(function (x) { return x.id === id; })[0]; return r ? r.position : null; }
      function fillAdd() { var p = posOf(rem.value); opts(add, roles.filter(function (r) { return p === null || r.position < p; }), "Rôle à mettre (plus bas)"); }
      function fillRank() { var p = member ? member.position : 0; opts(rankSel, roles.filter(function (r) { return r.position > p; }), "Rôle à donner (plus haut)"); }
      function syncKind() { $("#derank-fields").hidden = kind.value !== "derank"; $("#reason-field").hidden = kind.value === "rien"; }
      api("/api/bot/roles").then(function (r) { if (!r.ok) { say(msg, r.data.error || "Rôles indisponibles.", false); return; } roles = r.data.roles; opts(rem, roles, "Rôle à retirer"); fillAdd(); fillRank(); });
      rem.addEventListener("change", fillAdd); kind.addEventListener("change", syncKind); syncKind();
      document.querySelectorAll(".tab").forEach(function (t) {
        t.addEventListener("click", function () {
          document.querySelectorAll(".tab").forEach(function (x) { x.setAttribute("aria-selected", x === t ? "true" : "false"); });
          $("#sec-sanction").hidden = t.getAttribute("data-tab") !== "sanction"; $("#sec-rank").hidden = t.getAttribute("data-tab") !== "rank";
          msg.textContent = "";
        });
      });
      function send(path, body) {
        if (!member) { say(msg, "Choisissez d'abord un membre.", false); return; }
        body.user_id = member.id; msg.textContent = "Envoi en cours…"; msg.className = "status";
        api(path, { body: body }).then(function (r) { say(msg, r.ok ? (r.data.message || "Fait.") : (r.data.error || "Échec."), r.ok); });
      }
      $("#sec-sanction").addEventListener("submit", function (ev) {
        ev.preventDefault();
        send("/api/bot/sanctions", { type: kind.value, reason: $("#reason").value, remove_role_id: rem.value, add_role_id: add.value });
      });
      $("#sec-rank").addEventListener("submit", function (ev) { ev.preventDefault(); send("/api/bot/rankup", { add_role_id: rankSel.value }); });
    });
  }

  if (page === "owner") {
    guard(atLeast("owner"), function () {
      var msg = $("#msg"), member = null;
      $("#backup").addEventListener("click", function () {
        say(msg, "Sauvegarde en cours…", true);
        api("/api/bot/owner/backup", { body: {} }).then(function (r) {
          if (!r.ok) { say(msg, r.data.error || "Sauvegarde impossible.", false); return; }
          var a = el("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(r.data, null, 2)], { type: "application/json" }));
          a.download = "sauvegarde-dunkerque-rp-" + new Date().toISOString().slice(0, 10) + ".json"; document.body.appendChild(a); a.click(); a.remove();
          say(msg, "Sauvegarde téléchargée.", true);
        });
      });
      makePicker($("#q"), $("#results"), $("#picked"), function (m) { member = m; });
      function setPerm(id, grant) {
        api("/api/bot/owner/permissions", { body: { user_id: id, grant: grant } }).then(function (r) { say(msg, r.ok ? "Droit mis à jour." : (r.data.error || "Échec."), r.ok); loadPerms(); });
      }
      $("#grant").addEventListener("click", function () { if (!member) { say(msg, "Choisissez d'abord un membre.", false); return; } setPerm(member.id, true); });
      $("#revoke").addEventListener("click", function () { if (!member) { say(msg, "Choisissez d'abord un membre.", false); return; } setPerm(member.id, false); });
      function loadPerms() {
        api("/api/bot/owner/permissions").then(function (r) {
          var ul = $("#perms"); clear(ul);
          (r.data.users || []).forEach(function (u) {
            var li = el("li"); li.appendChild(el("span", "", u.name));
            var b = el("button", "btn btn-small btn-danger", "Retirer"); b.type = "button"; b.addEventListener("click", function () { setPerm(u.id, false); });
            li.appendChild(b); ul.appendChild(li);
          });
          if (!ul.firstChild) ul.appendChild(el("li", "empty", "Personne n'a ce droit pour le moment."));
        });
      }
      function loadSanctions() {
        api("/api/bot/owner/sanctions?limit=50").then(function (r) {
          var ul = $("#sanctions"); clear(ul);
          (r.data.sanctions || []).forEach(function (s) {
            var li = sanctionLine(s, "user"); li.firstChild.appendChild(document.createTextNode(" (par " + s.moderator + ")"));
            if (s.active) {
              var b = el("button", "btn btn-small btn-danger", "Retirer et restaurer"); b.type = "button";
              b.addEventListener("click", function () {
                b.disabled = true;
                api("/api/bot/owner/sanctions/" + s.id + "/remove", { body: {} }).then(function (x) { say(msg, x.ok ? (x.data.message || "Sanction retirée.") : (x.data.error || "Échec."), x.ok); loadSanctions(); });
              });
              li.appendChild(b);
            }
            ul.appendChild(li);
          });
          if (!ul.firstChild) ul.appendChild(el("li", "empty", "Aucune sanction enregistrée."));
        });
      }
      loadPerms(); loadSanctions();
    });
  }

  if (page === "dev") {
    guard(atLeast("dev"), function () {
      var kind = "console", box = $("#logs");
      document.querySelectorAll(".tab").forEach(function (t) {
        t.addEventListener("click", function () {
          kind = t.getAttribute("data-kind");
          document.querySelectorAll(".tab").forEach(function (x) { x.setAttribute("aria-selected", x === t ? "true" : "false"); });
          loadLogs(true);
        });
      });
      function loadLogs(force) {
        api("/api/bot/dev/logs?kind=" + kind + "&limit=150").then(function (r) {
          if (!r.ok) { box.textContent = r.data.error || "Journaux indisponibles."; return; }
          var near = force || box.scrollHeight - box.scrollTop - box.clientHeight < 60;
          box.textContent = r.data.logs.length ? r.data.logs.map(function (l) { return "[" + fmtTime(l.created_at) + "] " + l.text; }).join("\n") : "Aucune entrée.";
          if (near) box.scrollTop = box.scrollHeight;
        });
      }
      function meter(name, used, total, text) {
        var row = el("div", "meter-row"), p = el("p"); p.appendChild(el("span", "", name)); p.appendChild(el("span", "", text));
        var m = el("div", "meter"), s = el("span"); s.style.width = Math.min(100, Math.max(0, total ? used / total * 100 : used)) + "%";
        m.appendChild(s); row.appendChild(p); row.appendChild(m); return row;
      }
      function loadSystem() {
        api("/api/bot/dev/system").then(function (r) {
          var box = $("#system"); clear(box);
          if (!r.ok || !r.data.available) { box.appendChild(el("p", "note", r.ok ? "Mesures indisponibles (psutil non installé sur le bot)." : (r.data.error || "Bot injoignable."))); return; }
          var d = r.data;
          box.appendChild(meter("CPU utilisé", d.cpu_percent, 0, Math.round(d.cpu_percent) + " %"));
          box.appendChild(meter("RAM utilisée", d.ram_used, d.ram_total, fmtBytes(d.ram_used) + " / " + fmtBytes(d.ram_total)));
          box.appendChild(meter("Mémoire (disque) utilisée", d.disk_used, d.disk_total, fmtBytes(d.disk_used) + " / " + fmtBytes(d.disk_total)));
          box.appendChild(el("p", "note", "Le bot utilise " + fmtBytes(d.process_ram) + " de RAM" + (d.latency_ms != null ? " · latence Discord " + d.latency_ms + " ms" : "") + " · en ligne depuis " + fmtUptime(d.uptime_s)));
        });
      }
      poll(function () { loadLogs(false); loadSystem(); }, 5000);
      api("/api/site-status").then(function (r) {
        var ul = $("#checks"); clear(ul);
        (r.data.checks || []).forEach(function (c) { var li = el("li"); li.appendChild(el("span", "", c.label)); li.appendChild(el("span", c.ok ? "good" : "bad", c.ok ? "OK" : "À configurer")); ul.appendChild(li); });
      });
    });
  }
})();
