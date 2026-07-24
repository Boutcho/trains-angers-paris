# AlerTrain — Suivi des trains Angers ⇄ Paris

## Contexte du projet
Le contexte complet (règles métier G30, architecture, pièges connus) est dans
**[CONTEXTE-PROJET.md](CONTEXTE-PROJET.md)** — le lire en premier avant toute
modification. Guides utilisateur : [GUIDE-DEPLOIEMENT.md](GUIDE-DEPLOIEMENT.md)
et [GUIDE-SUIVI-MENSUEL.md](GUIDE-SUIVI-MENSUEL.md).

## Profil de l'utilisateur — IMPORTANT
Adrien est **Product Owner, non-développeur**. Toujours :
- expliquer en langage clair, sans jargon (Git, CLI, code…) ;
- être explicite sur chaque étape de déploiement ou de configuration ;
- signaler honnêtement les limites et incertitudes plutôt que promettre un
  résultat non vérifié ;
- répondre en français.

## Stack
- **Hébergement :** Vercel (plan Hobby gratuit, usage non-commercial)
- **Backend :** fonctions serverless Node.js dans `/api` (fetch natif, pas de
  `package.json` — ne pas en ajouter sans raison)
- **Frontend :** `public/index.html` unique, HTML/CSS/JS vanilla
- **Base de données :** Upstash Redis · **Emails :** Resend ·
  **Planificateur :** cron-job.org · **Données trains :** API SNCF / Navitia

## Déploiement — comment livrer une modification
Le flux est : **commit + push sur GitHub → Vercel redéploie tout seul (~1 min)**.

Procédure quand une modification est prête et validée :
1. `git add` des fichiers modifiés puis `git commit` avec un message clair.
2. `git push` vers GitHub.
3. Vercel détecte le push et redéploie automatiquement. Prévenir Adrien que le
   déploiement prend ~1 min, et qu'un **rechargement forcé** du navigateur
   (`Ctrl + Maj + R`) peut être nécessaire pour voir les changements CSS.

Ne jamais pousser sans que la modification ait été validée par Adrien.

## Règles de sécurité
- **Aucun secret dans le code ni sur GitHub.** Les clés (SNCF, Resend,
  CRON_SECRET, Upstash) vivent uniquement dans **Vercel → Settings →
  Environment Variables**. Le `.gitignore` exclut `.env`.
- Après ajout/modification d'une variable d'environnement dans Vercel, il faut
  **redéployer** pour qu'elle soit prise en compte.

## Règle métier à ne jamais casser
Le calcul des Points Prime **G30 Proactive** (seuil > 15 min par trajet, barème
mensuel, retard **à l'arrivée**) est le cœur du projet. Voir CONTEXTE-PROJET.md
section 2 avant de toucher à `api/_points.js` ou `api/_sncf.js`.
