# Contexte projet — Suivi des trains Angers ⇄ Paris

> **À lire en premier.** Ce fichier résume le projet, ses règles métier, son
> architecture et les pièges déjà rencontrés. Il est destiné à Claude Code (ou
> à toute personne reprenant le projet) pour éviter de redécouvrir le contexte.

---

## 1. À quoi sert cette application

Application web personnelle d'Adrien, qui fait régulièrement le trajet
**Angers ⇄ Paris** en TGV avec un abonnement SNCF (Grand Voyageur / forfait).

Elle répond à trois besoins :

1. **Voir les retards en temps réel** sur la ligne, dans les deux sens.
2. **Être alerté par email** dès qu'un retard important est annoncé, avant le
   départ, pour pouvoir réagir (changer de train, prévenir, etc.).
3. **Suivre le cumul mensuel des retards** et estimer les **Points Prime**
   obtenables via le mécanisme d'indemnisation SNCF **G30 Proactive**.

### Profil de l'utilisateur — IMPORTANT

Adrien est **Product Owner, non-développeur**. Il faut :
- expliquer les concepts techniques en langage clair, sans jargon ;
- éviter de supposer des connaissances en code, Git, CLI, etc. ;
- être explicite sur les étapes de déploiement et de configuration ;
- signaler honnêtement les limites et les incertitudes plutôt que de
  promettre un résultat non vérifié.

---

## 2. Règles métier — le mécanisme G30 Proactive

Source officielle :
`https://www.tgvinoui.sncf/voyager/engagements/en-cas-de-retard/g30-proactive`

Ce sont **les règles les plus importantes du projet**. Toute modification du
calcul doit les respecter.

### Règle 1 — Seuil par trajet
Seul un retard **strictement supérieur à 15 minutes** est comptabilisé dans le
compteur mensuel. Un trajet à 15 min ou moins compte pour **0**. Un trajet à
18 min compte pour **18 min** (sa valeur entière, pas l'excédent).

### Règle 2 — Barème sur le cumul mensuel

| Retard cumulé sur le mois | Points Prime |
|---------------------------|-------------:|
| < 30 min                  |            0 |
| 30 – 59 min               |          800 |
| 1h – 1h59                 |        2 000 |
| 2h – 2h59                 |        3 000 |
| 3h – 3h59                 |        4 000 |
| 4h – 4h59                 |        8 000 |
| 5h et plus                |       12 500 |

### Règle 3 — C'est le retard À L'ARRIVÉE qui compte
La G30 se calcule sur le retard constaté **à l'arrivée** à destination, pas au
départ. Un train peut partir à l'heure et arriver en retard.

**Conséquence dans l'app :**
- le **calcul G30** utilise le retard d'arrivée (`delayG30`) ;
- les **alertes email** utilisent le retard **au départ** (`delayDep`), car
  c'est lui qui permet d'anticiper AVANT de partir ;
- l'utilisateur peut toujours **corriger manuellement** la valeur, et cette
  correction est **toujours prioritaire** sur la donnée SNCF.

### Règle 4 — Réservabilité
Une fois l'heure de **départ initiale** dépassée, il n'est plus possible de
réserver le train. D'où les indications « temps restant pour réserver » dans
l'interface et dans les emails.

---

## 3. Architecture

### Stack
- **Hébergement :** Vercel (plan Hobby gratuit, usage non-commercial)
- **Backend :** fonctions serverless Node.js dans `/api`
- **Frontend :** un seul fichier HTML/CSS/JS vanilla, sans framework
- **Base de données :** Upstash Redis (via l'intégration Vercel Storage)
- **Emails :** Resend
- **Planificateur :** cron-job.org (externe — voir pourquoi plus bas)
- **Données trains :** API SNCF / Navitia

### Pourquoi ce montage
- **Un proxy serveur est indispensable** : l'API SNCF ne peut pas être appelée
  directement depuis le navigateur (blocage CORS). Toute la communication passe
  par `/api`.
- **La clé SNCF vit côté serveur uniquement**, jamais dans la page.

### Arborescence

```
/api
  _sncf.js         Brique partagée : interroge la SNCF, calcule retards et états
  _points.js       Calcul des Points Prime G30 (règles ci-dessus)
  _storage.js      Lecture/écriture du carnet mensuel dans Upstash
  departures.js    Alimente le tableau de bord temps réel
  trajets.js       API du carnet mensuel (ajout, correction, resynchronisation)
  check-delays.js  Vérificateur d'alertes email (appelé par cron-job.org)
/public
  index.html       Toute l'interface (2 vues : temps réel + suivi mensuel)
vercel.json        Configuration Vercel
```

### Variables d'environnement (dans Vercel → Settings → Environment Variables)

| Variable | Rôle |
|---|---|
| `SNCF_API_KEY` | Clé API SNCF (numerique.sncf.com) |
| `RESEND_API_KEY` | Clé Resend pour l'envoi des emails |
| `ALERT_TO` | Destinataires des alertes, séparés par des virgules |
| `CRON_SECRET` | Secret protégeant `/api/check-delays` |
| `KV_REST_API_URL` | URL Upstash (ajoutée automatiquement par Vercel) |
| `KV_REST_API_TOKEN` | Token Upstash (ajouté automatiquement par Vercel) |

> **Piège connu :** Vercel nomme les variables Upstash `KV_REST_API_*` et non
> `UPSTASH_REDIS_REST_*`. Le code accepte **les deux** noms (voir `_storage.js`).

---

## 4. Concepts clés du code

### États d'un train (`etat`)
Calculé dans `_sncf.js` :
- `a_venir` — pas encore parti
- `en_route` — parti, pas encore arrivé
- `arrive` — arrivé (heure d'arrivée réelle passée)

### Les différents retards (tous en minutes, dans `_sncf.js`)
- `delayDep` — retard au départ → **utilisé par les alertes email**
- `delayArr` — retard à l'arrivée
- `delayG30` — retard retenu pour la G30 (= `delayArr`, repli sur `delayDep`)
- `delayPertinent` — valeur affichée dans la colonne « Retard » de l'interface,
  qui dépend de l'état : au départ si à venir, d'arrivée sinon

### Carnet mensuel
- Stocké par mois sous la clé Redis `trajets:AAAA-MM`
- Un trajet est rangé selon **le mois de sa date de départ** (la bascule d'un
  mois à l'autre est donc automatique et propre)
- Champs d'un trajet : `id`, `dir`, `trainNo`, `baseTime`, `delaySncf`,
  `delayManuel`, `cause`, `etat`, `fige`
- **`delayManuel` prime toujours sur `delaySncf`** dans le calcul
- **`fige: true`** signifie que le train est arrivé et que sa valeur est
  définitive — on ne la resynchronise plus

### Resynchronisation (dans `trajets.js`)
À chaque consultation du carnet, l'API réinterroge la SNCF pour les trajets
**du jour même** non figés, met à jour leur retard, et fige la valeur une fois
le train arrivé. Les corrections manuelles ne sont jamais écrasées.

---

## 5. Pièges déjà rencontrés (ne pas les refaire)

1. **CORS** — l'API SNCF est inappelable depuis le navigateur. Tout passe par
   `/api`. Ne jamais tenter un `fetch` direct vers `api.sncf.com` côté client.

2. **Cron Vercel gratuit = 1 exécution par jour maximum.** Inutilisable pour
   surveiller des trains. D'où **cron-job.org** en externe, qui appelle
   `/api/check-delays` toutes les 10 min avec l'en-tête
   `Authorization: Bearer <CRON_SECRET>`.

3. **Filtrage des trajets** — ne PAS lister les « départs » bruts d'une gare
   (Paris-Montparnasse envoie des trains partout). Utiliser l'endpoint
   **journeys** (from → to), qui ne renvoie que les trains reliant réellement
   les deux villes.

4. **Noms des variables Upstash** — voir le piège plus haut.

5. **`overflow:hidden` + position absolue** — une hauteur de ligne verrouillée
   avait coupé l'affichage de l'heure initiale barrée. Si l'on touche à la
   hauteur des lignes, vérifier que les heures barrées restent visibles.

6. **Champs d'arrivée de l'API** — leur nom peut varier selon la version.
   `_sncf.js` les cherche à plusieurs endroits (`base_arrival_date_time`, etc.).
   Si une valeur d'arrivée manque en production, c'est le premier endroit à
   regarder.

7. **La cause du retard n'est pas toujours fournie** par la SNCF. Le code
   cherche d'abord un message texte, puis se rabat sur une catégorie
   (« Retard signalé »), puis n'affiche rien. C'est une limite de la donnée.

---

## 6. Interface (`public/index.html`)

### Vue « Trains en direct »
Deux onglets (Angers → Paris / Paris → Angers), chacun avec une pastille rouge
indiquant le nombre de trains en retard.

Colonnes du tableau, dans l'ordre :
`Réservable | Départ | Arrivée | Destination | Train | Statut | Retard | Cause | Action`

- **Réservable** : compte à rebours figé au dernier rafraîchissement, basé sur
  l'heure de départ **initiale**. Vert, orange sous 10 min, « trop tard » ensuite.
- **Départ / Arrivée** : heure réelle en évidence, heure initiale barrée en dessous.
- **Cause** : tronquée avec « … », texte complet au survol.
- **Action** : pictogramme « + » pour marquer le train comme réservé (« ✓ » ensuite).

Deux cases à cocher : **« Retards seulement »** (cochée par défaut) et
**« Voir trains déjà partis »** (pour rattraper une saisie oubliée).

Rafraîchissement automatique toutes les 60 secondes.

### Vue « Mon suivi mensuel »
- Sélecteur de mois (12 derniers mois)
- Cumul du mois affiché en heures (« 1h35 »)
- Points Prime estimés + barre de progression vers le palier suivant
- Liste des trajets réservés avec date, heure, train, cause
- Champ de **correction manuelle** du retard par trajet
- Bandeau indiquant si le stockage est durable (base connectée) ou temporaire

### Contenu des emails d'alerte
Colonnes : `Sens | Départ prévu | Train | État | Cause | Réservable`
Déclenchement : retard **au départ** > 15 min, ou train supprimé.
Anti-spam : un même train n'est signalé qu'une fois (mémoire en RAM — voir
limites ci-dessous).

---

## 7. Limites connues et pistes d'amélioration

### Limites assumées
- **Mémoire anti-spam des alertes en RAM** : après une longue inactivité du
  serveur, une même alerte peut être renvoyée une fois. Migrer cette mémoire
  vers Redis règlerait le problème définitivement.
- **Resynchronisation limitée au jour même** : l'API SNCF ne permet pas de
  remonter loin dans le passé. Un trajet dont on ne consulte pas le carnet le
  jour même peut garder une valeur non finalisée → correction manuelle.
- **Estimation, pas montant officiel** : le compteur G30 est une estimation ;
  le montant crédité par la SNCF fait foi.
- **Plan Vercel Hobby = usage non-commercial.** Si le projet devenait un outil
  professionnel, il faudrait changer d'offre.

### Points en suspens (jamais tranchés)
- **Nombre de trains affichés** : actuellement 20 (40 avec les trains passés).
  La question « tous les trains de la journée vs seulement les prochaines
  heures » n'a jamais été tranchée avec l'utilisateur.
- **Vérification du calcul « Réservable » dans les emails** : l'utilisateur a
  eu l'impression que le temps affiché correspondait à l'arrivée plutôt qu'au
  départ. Le code utilise bien l'heure de départ (`baseTime` = `baseDep`), mais
  la vérification sur un email réel n'a pas été bouclée.
- **Idées évoquées** : masquer certaines colonnes pour aérer le tableau,
  décompte « Réservable » en temps réel plutôt que figé au rafraîchissement.

---

## 8. Déploiement

Le flux est : **fichiers sur GitHub → Vercel redéploie automatiquement (~1 min)**.

Rien d'autre à faire côté déploiement. En revanche :
- après ajout ou modification d'une variable d'environnement, il faut
  **redéployer** pour qu'elle soit prise en compte ;
- après un déploiement, penser au **rechargement forcé** du navigateur
  (`Cmd/Ctrl + Shift + R`) pour les changements CSS.

### Vérifications utiles
- `https://<app>.vercel.app/api/trajets?mois=AAAA-MM` → cherche
  `"stockageDurable":true` pour confirmer que la base répond.
- `https://<app>.vercel.app/api/departures?dir=angers-paris` → vérifie que le
  backend renvoie bien les champs attendus.
- Dans cron-job.org, le bouton **« Run now »** teste la chaîne complète des
  alertes email sans attendre un vrai retard.
- Ouvrir `/api/check-delays` dans un navigateur renvoie normalement
  `{"error":"Non autorisé."}` — **c'est le comportement attendu** (protection
  par `CRON_SECRET`), pas un bug.
