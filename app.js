(function () {
  "use strict";
  var SITE = window.SITE || {};
  var page = document.body.getAttribute("data-page") || "";

  function $(s) { return document.querySelector(s); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function safeNext(n) { return typeof n === "string" && n.charAt(0) === "/" && n.charAt(1) !== "/" && n.indexOf("\\") < 0 && n.indexOf("/api") !== 0 ? n : "/dashboard"; }
  function param(k) { return new URLSearchParams(location.search).get(k); }
  function avatarUrl(u) {
    if (!u || !/^\d{15,20}$/.test(u.id || "") || !/^[a-f0-9_]+$/i.test(u.avatar || "")) return "";
    return "https://cdn.discordapp.com/avatars/" + u.id + "/" + u.avatar + ".png?size=96";
  }

  // Liens vers le Discord (masqués tant que l'invitation n'est pas renseignée dans assets/config.js)
  document.querySelectorAll("[data-invite]").forEach(function (a) {
    if (SITE.invite) a.setAttribute("href", SITE.invite); else a.hidden = true;
  });

  var ready = fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" })
    .then(function (r) { return r.ok ? r.json() : { user: null, role: null }; })
    .catch(function () { return { user: null, role: null }; });

  // Zone utilisateur de l'en-tête
  ready.then(function (d) {
    var zone = $("#user-zone");
    if (!zone) return;
    zone.textContent = "";
    if (d.user) {
      var me = el("a", "btn btn-ghost", d.user.name); me.href = "/dashboard"; zone.appendChild(me);
      if (d.role) { var ad = el("a", "btn btn-ghost", "Admin"); ad.href = "/admin"; zone.appendChild(ad); }
      var out = el("button", "btn btn-ghost", "Déconnexion"); out.type = "button";
      out.addEventListener("click", function () {
        fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).finally(function () { location.href = "/"; });
      });
      zone.appendChild(out);
    } else if (page !== "connexion") {
      var lg = el("a", "btn btn-signal", "Connexion Discord");
      lg.href = "/connexion?next=" + encodeURIComponent(location.pathname);
      zone.appendChild(lg);
    }
  });

  var ERRORS = {
    access_denied: "Vous avez refusé l'autorisation sur Discord.",
    invalid_state: "La session de connexion a expiré ou n'est pas valide. Réessayez.",
    missing_code: "La réponse de Discord est incomplète. Réessayez.",
    oauth_error: "Discord a renvoyé une erreur. Réessayez.",
    token_exchange: "L'échange avec Discord a échoué. Réessayez.",
    profile: "Votre profil Discord est illisible. Réessayez.",
    network: "Discord est injoignable pour le moment. Réessayez dans un instant.",
    rate_limited: "Trop de tentatives. Patientez une minute.",
    config: "La connexion n'est pas encore configurée côté serveur."
  };

  if (page === "connexion") {
    var next = safeNext(param("next"));
    var e = param("error");
    if (e) { var box = $("#login-error"); box.textContent = ERRORS[e] || "Erreur de connexion."; box.hidden = false; }
    $("#login-link").href = "/api/auth/login?next=" + encodeURIComponent(next);
    ready.then(function (d) { if (d.user) location.replace(next); });
  }

  if (page === "dashboard") {
    ready.then(function (d) {
      if (!d.user) { location.replace("/connexion?next=/dashboard"); return; }
      $("#hello").textContent = "Bonjour, " + d.user.name;
      $("#idline").textContent = "Compte Discord n°" + d.user.id;
      var url = avatarUrl(d.user), img = $("#avatar");
      if (url) { img.src = url; img.hidden = false; }
      if (d.role) $("#admin-row").hidden = false;
    });
  }

  if (page === "recrutements") {
    ready.then(function (d) {
      if (!d.user) { $("#gate").hidden = false; return; }
      var form = $("#apply-form"), msg = $("#msg");
      form.hidden = false;
      fetch("/api/applications").then(function (r) { return r.json(); }).then(function (b) {
        var sel = form.elements.department;
        (b.departments || []).forEach(function (n) { var o = el("option", "", n); o.value = n; sel.appendChild(o); });
      }).catch(function () {});
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        form.querySelectorAll("[data-err]").forEach(function (x) { x.textContent = ""; });
        msg.textContent = "Envoi en cours…"; msg.className = "status";
        fetch("/api/applications", {
          method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(Object.fromEntries(new FormData(form)))
        }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return { ok: r.ok, b: b }; }); })
          .then(function (x) {
            if (x.ok) { form.reset(); msg.textContent = "Candidature envoyée. L'équipe vous recontacte sur Discord."; msg.className = "status ok"; return; }
            msg.textContent = x.b.error || "Une erreur est survenue."; msg.className = "status err";
            Object.keys(x.b.fields || {}).forEach(function (k) { var s = form.querySelector('[data-err="' + k + '"]'); if (s) s.textContent = x.b.fields[k]; });
          })
          .catch(function () { msg.textContent = "Réseau indisponible. Réessayez."; msg.className = "status err"; });
      });
    });
  }

  if (page === "admin") {
    ready.then(function (d) {
      if (!d.user) { location.replace("/connexion?next=/admin"); return; }
      if (!d.role) { $("#notfound").hidden = false; return; }
      $("#role-line").textContent = d.role === "owner" ? "Accès propriétaire" : "Accès développeur";
      $("#admin-body").hidden = false;
      if (d.role === "owner") $("#owner-note").hidden = false;
      fetch("/api/admin/bot-stats", { credentials: "same-origin", cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (b) {
          var stats = $("#stats"), list = $("#checks");
          if (b.stats) {
            var dl = el("dl", "stats");
            [["Membres", b.stats.members], ["Tickets ouverts", b.stats.tickets_open], ["Candidatures en attente", b.stats.applications_pending], ["Avertissements actifs", b.stats.warnings_active]].forEach(function (p) {
              var w = el("div"); w.appendChild(el("dt", "", p[0])); w.appendChild(el("dd", "", String(p[1]))); dl.appendChild(w);
            });
            stats.appendChild(dl);
          } else { stats.appendChild(el("p", "note", b.reason || "Statistiques indisponibles.")); }
          (b.checks || []).forEach(function (c) {
            var li = el("li"); li.appendChild(el("span", "", c.label)); li.appendChild(el("span", c.ok ? "good" : "bad", c.ok ? "OK" : "Non configuré")); list.appendChild(li);
          });
        })
        .catch(function () { $("#stats").appendChild(el("p", "note", "Impossible de charger les informations.")); });
    });
  }
})();
