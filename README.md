# Dunkerque RP — site web (projet à plat)

Aucun sous-dossier : tous les fichiers sont à la racine du dépôt.

| Fichier | Rôle |
|---|---|
| `index.js` | Routeur : sert les pages et les routes `/api` |
| `core.js` | Sessions signées, OAuth Discord, validation, réglages (`SERVER_NAME`, `DEPARTMENTS`) |
| `vercel.json`, `package.json` | Configuration Vercel (aucune dépendance npm) |
| `index.html`, `serveur.html`, `equipe.html`, `recrutements.html`, `support.html`, `connexion.html`, `dashboard.html`, `admin.html`, `404.html` | Pages |
| `style.css`, `app.js`, `favicon.svg` | Apparence et comportement |
| `site-config.js` | Lien d'invitation Discord (à renseigner) |
| `.env.example` | Variables à définir dans Vercel |

## Déployer sur Vercel

1. Mets **tous** ces fichiers à la racine du dépôt GitHub (supprime l'ancien `index.js`, l'ancien `vercel.json` et les anciens dossiers).
2. Vercel > Settings > Environment Variables : renseigne les variables de `.env.example`.
3. Discord Developer Portal > OAuth2 > Redirects : ajoute `https://dunkerquerp.vercel.app/api/auth/callback/discord`.
4. Ouvre `site-config.js` et renseigne le lien d'invitation Discord.
5. Redéploie. Vercel peut afficher un avertissement sur « builds » dans vercel.json : c'est normal.

## Modifier le contenu

- Textes, services, équipe, règlement : fichiers `.html` (commentaires `À modifier`).
- Services du formulaire de candidature : `DEPARTMENTS` en haut de `core.js`.
- Couleurs et polices : variables en haut de `style.css`.

Limite connue : la limitation de débit est en mémoire, donc partielle sur Vercel.
