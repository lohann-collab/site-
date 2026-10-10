# Site Emergency Hamburg — version plate (sans dossier)

Un seul fichier de code : `index.js` (Express). Aucune compilation, aucun dossier.
Fichiers : `index.js`, `package.json`, `.env.example`, `README.md`, `test.js` (tests, facultatif), `.gitignore`.

## Déploiement (GitHub + Vercel)
1. Créez un dépôt GitHub **privé** et déposez ces fichiers à la **racine** (glisser-déposer sur github.com suffit).
2. Vercel > *Add New > Project* > importez le dépôt. Laissez les réglages par défaut (Express détecté via `index.js`).
3. *Settings > Environment Variables* : ajoutez les variables de `.env.example` (ou importez votre fichier `vercel-site.env`).
4. Discord Developer Portal > votre application > *OAuth2 > Redirects* : ajoutez exactement
   `https://dunkerquerp.vercel.app/api/auth/callback/discord`, puis *Save Changes*.
5. Redéployez, puis testez `/connexion`.

Local : `npm install`, définir les variables d'environnement, `npm start` (http://localhost:3000).

## Pages et accès
`/`, `/serveur`, `/equipe`, `/support` publics · `/recrutements` (formulaire pour connectés) · `/dashboard` connecté · `/admin` owner et développeurs
(`OWNER_DISCORD_IDS`, `DEV_DISCORD_IDS`) — tout est vérifié côté serveur. Textes à adapter en haut de `index.js` (SERVICES, TEAM, RULES).

## Architecture
Le bot (DisHost, SQLite) et le site (Vercel) ne partagent aucune base : Vercel ne peut pas lire `database.db`.
- Les candidatures du site partent vers un salon Discord via **webhook sortant** (`DISCORD_APPLICATIONS_WEBHOOK_URL`, à saisir uniquement dans Vercel). Elles ne sont pas écrites dans la base du bot.
- Les tickets restent sur Discord. Les statistiques de `/admin` exigent une API HTTPS du bot (`BOT_API_URL` + `BOT_API_TOKEN`), possible seulement si DisHost ouvre un port public.

## Sécurité
État OAuth2 aléatoire en cookie HttpOnly, comparé en temps constant · scope `identify` seul · code échangé côté serveur, jeton Discord non conservé ·
session signée HMAC-SHA256 en cookie HttpOnly/Secure/SameSite=Lax, 7 jours, renouvellement glissant · déconnexion en POST avec contrôle d'Origin ·
validation stricte, limitation de débit (en mémoire : partielle sur Vercel serverless), en-têtes de sécurité, aucun secret dans le code.

## Tests
`npm test` : fonctions (session, rôles, OAuth2, formulaire, webhook) et routes HTTP (accès non autorisé, rôles, state, déconnexion, candidatures).
