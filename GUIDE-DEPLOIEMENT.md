# 🚄 Suivi trains Angers ⇄ Paris — Guide complet (v2 : avec alertes email)

Cette version ajoute trois choses par rapport à la précédente :
1. **Correction du bug Paris → Angers** (plus de trains parasites).
2. **Bulle rouge** sur chaque onglet avec le nombre de trains en retard.
3. **Alertes email** dès qu'un train dépasse **15 min** de retard, avec
   plusieurs destinataires possibles.

---

# PARTIE A — LIVRER LES MODIFICATIONS (le tableau + les bulles)

Si tu as déjà déployé la version précédente, c'est très rapide.

## Si tu utilises GitHub (recommandé)
1. Ouvre ton dépôt `trains-angers-paris` sur GitHub.
2. Clique **Add file → Upload files**.
3. Glisse le contenu du nouveau dossier (le dossier `api` entier — il
   contient maintenant 3 fichiers — et le dossier `public`).
   GitHub remplacera les anciens fichiers par les nouveaux.
4. Clique **Commit changes**.
5. Vercel redéploie tout seul en ~1 minute. **C'est fait.**

Le tableau corrigé et les bulles sont maintenant en ligne. Les alertes email,
elles, demandent la Partie B ci-dessous.

## Si tu utilises la ligne de commande
Dans le dossier : `vercel --prod`

---

# PARTIE B — METTRE EN PLACE LES ALERTES EMAIL

Il y a trois briques à assembler. Compte **20 minutes** la première fois.

## Pourquoi ce montage (en 2 phrases)
Ta page web ne tourne que quand ton navigateur est ouvert. Pour être prévenu
même téléphone dans la poche, il faut un programme qui vérifie tout seul, à
intervalle régulier. On l'a construit ; il reste à le brancher à un service
d'envoi d'emails et à un "réveil" automatique.

---

## Brique 1 — Resend (l'envoi des emails)

1. Crée un compte gratuit sur **https://resend.com/signup**
   (gratuit jusqu'à 3 000 emails/mois — très large pour toi).
2. Une fois connecté, va dans **API Keys → Create API Key**.
3. Donne-lui un nom (ex. `trains`), laisse les options par défaut, crée-la.
4. **Copie la clé** (elle commence par `re_…`). Garde-la de côté.

> Note : par défaut Resend enverra depuis une adresse générique
> (`onboarding@resend.dev`). Ça marche tout de suite pour recevoir tes
> alertes. Si un jour tu veux envoyer depuis ta propre adresse, il faudra
> "vérifier un domaine" chez Resend — pas nécessaire pour démarrer.

---

## Brique 2 — Ranger les réglages dans le coffre-fort Vercel

Va dans **Vercel → ton projet → Settings → Environment Variables** et ajoute
ces variables (bouton **Add** pour chacune) :

| Name (nom exact)   | Value (valeur)                                   |
|--------------------|--------------------------------------------------|
| `SNCF_API_KEY`     | ta clé SNCF (déjà là normalement)                |
| `RESEND_API_KEY`   | la clé Resend `re_…` de la Brique 1              |
| `ALERT_TO`         | tes destinataires, séparés par des virgules      |
| `CRON_SECRET`      | un mot de passe inventé (≥16 caractères)         |

**Exemples de valeurs :**
- `ALERT_TO` → `adrien@exemple.fr,collegue@exemple.fr,famille@exemple.fr`
  (autant d'adresses que tu veux, séparées par des virgules, sans espace)
- `CRON_SECRET` → une longue suite au hasard, par ex.
  `train-alerte-9x7k2p4m8w1q` (invente la tienne, garde-la de côté)

Après avoir ajouté ces variables : **Deployments → (dernier) → ⋯ → Redeploy**
pour qu'elles soient prises en compte.

---

## Brique 3 — cron-job.org (le réveil automatique, gratuit)

> Pourquoi pas le cron de Vercel ? Sur le plan gratuit de Vercel, une tâche
> planifiée ne peut tourner qu'**une fois par jour** — inutile pour surveiller
> des trains. cron-job.org fait le même travail (un simple appel web sur
> minuterie) gratuitement et toutes les 10 minutes.

1. Crée un compte gratuit sur **https://cron-job.org/en/signup/**
2. Clique **Create cronjob**.
3. Remplis :
   - **Title** : `Alertes trains`
   - **URL** : `https://TON-ADRESSE.vercel.app/api/check-delays`
     (remplace par ta vraie adresse Vercel, garde bien `/api/check-delays`)
   - **Schedule** : choisis **Every 10 minutes**
     (ou "Custom" → toutes les 10 min ; tu peux mettre 5 si tu veux)
4. Déplie **Advanced / Headers** et ajoute un en-tête :
   - **Key** : `Authorization`
   - **Value** : `Bearer TON_CRON_SECRET`
     (le mot que tu as mis dans `CRON_SECRET`, précédé de `Bearer ` —
     attention à l'espace après "Bearer")
5. **Create / Save.**

C'est fini. Toutes les 10 minutes, cron-job.org réveille ton vérificateur,
qui envoie un email dès qu'un train dépasse 15 min de retard.

---

# VÉRIFIER QUE LES ALERTES MARCHENT

**Test immédiat sans attendre un vrai retard :**
Dans cron-job.org, ouvre ton job et clique **"Run now"** (ou "Test run").
- Réponse `{"ok":true,"sent":0,...}` → tout fonctionne, il n'y a juste
  aucun gros retard à cet instant (normal).
- Réponse `{"ok":true,"sent":2}` → 2 alertes envoyées, regarde ta boîte mail.
- Réponse `401 Non autorisé` → l'en-tête Authorization est mal saisi.
  Vérifie `Bearer ` + ton secret, et que `CRON_SECRET` est bien dans Vercel.
- Réponse `Configuration incomplète` → une variable manque dans Vercel
  (clé Resend ou `ALERT_TO`). Ajoute-la, redeploy.

---

# AJOUTER / RETIRER DES DESTINATAIRES PLUS TARD

C'est le point le plus simple : **Vercel → Settings → Environment Variables
→ `ALERT_TO` → Edit.** Ajoute ou enlève une adresse (séparées par virgules),
sauvegarde, puis **Redeploy**. Aucune modification de code nécessaire.

---

# CE QU'IL FAUT SAVOIR (transparence)

- **Doublon rare possible.** Le vérificateur retient les retards déjà signalés
  en mémoire courte. Après une longue période sans aucun retard, il se peut
  qu'un même gros retard soit signalé une deuxième fois. C'est rare et sans
  gravité. Si un jour tu veux zéro doublon garanti, on branchera une petite
  mémoire durable gratuite (Vercel KV / Upstash) — dis-le moi.
- **Seuil de 15 min.** Il est fixé dans `api/check-delays.js` (ligne
  `SEUIL_MINUTES = 15`). Pour le changer, modifie ce chiffre et redéploie —
  ou demande-moi.
- **Plan gratuit = usage perso.** Comme avant, si ça devient un outil pro EEX,
  on rebascule sur une offre adaptée.

---

# RÉCAP DES FICHIERS

- `public/index.html` — le tableau de bord (corrigé + bulles rouges)
- `api/_sncf.js` — la brique qui parle à la SNCF via les *trajets* (le correctif)
- `api/departures.js` — alimente le tableau de bord
- `api/check-delays.js` — le vérificateur d'alertes (réveillé par cron-job.org)
- `vercel.json` — la configuration
