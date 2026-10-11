# Dunkerque RP — site web (projet à plat)

Aucun sous-dossier. Le site ne contient aucune donnée du staff : il demande tout au **bot** (rôles, statistiques, sanctions, journaux) par une API protégée par un jeton. Le bot est dans un projet séparé (`dunkerque-rp-bot.zip`).

## Pages

| Page | Accès |
|---|---|
| Accueil, Le serveur (règlement), Nos staff, Zones safe, Recrutements, Support, Demande d'unban | tout le monde |
| `/dashboard` | tout membre connecté |
| `/activite` (messages, graphique, tickets, rôles, sanctions), `/chat-staff` | staff |
| `/sanctions` (sanction, derank, rank up) | owner + membres autorisés par l'owner |
| `/owner` (sauvegarde, droits, retrait de sanctions) | owner |
| `/dev` (journaux, CPU, RAM, état du site) | développeur + owner |

Le niveau (membre, staff, développeur, owner) est décidé par le **bot** d'après les rôles Discord. Chaque action est revérifiée par le bot, pas seulement par la page.

## Fichiers

`index.js` (routeur) · `core.js` (sessions, OAuth, relais vers le bot) · `*.html` · `style.css` · `app.js` · `site-config.js` · `vercel.json` · `package.json` · `.env.example`

## Déployer

1. Mets tous les fichiers à la racine du dépôt GitHub (supprime les anciens fichiers et dossiers).
2. Renseigne les variables de `.env.example` dans l'hébergeur. Pour que le staff fonctionne, `BOT_API_URL` et `BOT_API_TOKEN` sont obligatoires.
3. Discord Developer Portal > OAuth2 > Redirects : `https://TON-SITE/api/auth/callback/discord`.
4. Renseigne `invite` (et `session`) dans `site-config.js`.
5. Redéploie.

### Sans Vercel
Le site tourne aussi tout seul : `node index.js` (Node 20 ou plus, aucune installation de paquet). Le port est lu dans `PORT` ou `SERVER_PORT`, et les variables peuvent être mises dans un fichier `.env`. Mets `NODE_ENV=production` et place le site derrière HTTPS.

## Modifier le contenu

- Textes, services, règlement : fichiers `.html` (commentaires `À modifier`).
- Zones safe, lien Discord, lien de session : `site-config.js`.
- Services du formulaire de candidature : `DEPARTMENTS` en haut de `core.js`.
- Couleurs : variables en haut de `style.css`.

Limite connue : la limitation de débit est en mémoire (partielle sur Vercel).
