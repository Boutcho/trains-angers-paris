# 🚄 Suivi trains Angers ⇄ Paris — Guide (suivi mensuel, retards & causes)

## Nouveautés de cette version

1. **Cause du retard affichée partout, quand elle est disponible :**
   - dans la vue « Trains en direct », sous le retard ;
   - dans le carnet mensuel, sous chaque trajet réservé (conservée) ;
   - dans les alertes email, en colonne « Cause ».
2. **Colonne « Retard » intelligente** (des versions précédentes) : montre la
   donnée pertinente selon l'état — au départ / en route / arrivé.
3. **Calcul G30 sur le retard à l'arrivée** ; **alertes email sur le retard au
   départ** (anticipation).

## Important à savoir sur la cause

La cause vient des « perturbations » que la SNCF publie dans l'API. Elle n'est
**pas toujours renseignée** :
- Si la SNCF fournit un message précis → tu vois la vraie cause
  (ex. « Incident technique », « Personne sur les voies »).
- Si elle ne donne qu'une catégorie → tu vois un libellé générique
  (« Retard signalé », « Train supprimé »).
- Si aucune info n'est disponible → rien n'est affiché (le retard reste visible).

C'est une limite de la donnée SNCF, pas de l'app : on affiche le mieux
disponible pour chaque train.

---

## LIVRER CETTE VERSION

Dépose les fichiers du dossier sur GitHub, Vercel redéploie tout seul (~1 min).
Aucune nouvelle variable à configurer.

Fichiers modifiés cette fois :
- `api/_sncf.js` — extraction de la cause depuis les perturbations
- `public/index.html` — affichage de la cause (vue directe + carnet)
- `api/_storage.js` + `api/trajets.js` — conservation/màj de la cause
- `api/check-delays.js` — colonne « Cause » dans l'email + correctif interne
  (les alertes utilisent désormais explicitement le retard au départ)

Inchangés : `api/_points.js`, `api/departures.js`, `vercel.json`

---

## CE QU'IL FAUT SAVOIR (transparence)

- **Cause = au mieux disponible.** Voir ci-dessus : elle dépend de ce que la
  SNCF publie.
- **Champs API à confirmer en direct.** Le nom exact des champs de perturbation
  peut varier selon la version de l'API. Le code cherche à plusieurs endroits ;
  si une cause attendue n'apparaissait pas une fois en ligne, envoie-moi un
  exemple de réponse et j'ajuste.
- **Estimation G30, pas montant officiel.** Le montant crédité par la SNCF fait
  foi.
