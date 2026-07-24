// ============================================================
//  API DU CARNET MENSUEL
// ------------------------------------------------------------
//  Gère les trajets que tu as marqués "réservé", leur correction
//  de retard, et renvoie le calcul de Points Prime à jour.
//
//  Une seule adresse, plusieurs actions via le paramètre "action" :
//    GET  /api/trajets?mois=2026-07              -> liste + calcul
//    POST /api/trajets  {action:"ajouter", mois, trajet}
//    POST /api/trajets  {action:"corriger", mois, id, delayManuel}
//    POST /api/trajets  {action:"supprimer", mois, id}
// ============================================================

const { lireMois, ajouterTrajet, supprimerTrajet, corrigerRetard, rafraichirRetardSncf, retardRetenu, upstashConfigure } = require("./_storage");
const { calculer } = require("./_points");
const { getTrains } = require("./_sncf");

// Resynchronise depuis la SNCF les trajets pas encore "finalisés".
// Un trajet est finalisé quand le train est arrivé ET qu'on a enregistré
// sa valeur définitive (drapeau "fige"). Tant que ce n'est pas le cas, on
// va rechercher son retard d'arrivée à jour.
// Important : on ne touche JAMAIS à une correction manuelle de l'utilisateur.
async function resynchroniser(mois, trajets) {
  const KEY = process.env.SNCF_API_KEY;
  if (!KEY) return trajets;

  // Quels trajets ont besoin d'une mise à jour ?
  const aMettreAJour = trajets.filter(t => !t.fige);
  if (!aMettreAJour.length) return trajets;

  // On ne peut interroger la SNCF que pour les trajets d'aujourd'hui ou
  // récents (l'API ne remonte pas indéfiniment dans le passé).
  const aujourdhui = new Date().toISOString().slice(0,10).replace(/-/g,""); // "20260724"
  const concernes = aMettreAJour.filter(t => (t.baseTime||"").slice(0,8) === aujourdhui);
  if (!concernes.length) return trajets;

  // On récupère les trains du jour dans les deux sens, en incluant les
  // trains déjà partis (pour capter les arrivées).
  const parSens = {};
  for (const dir of ["angers-paris", "paris-angers"]) {
    try {
      parSens[dir] = await getTrains(dir, KEY, { count: 40, sinceMidnight: true });
    } catch (e) { parSens[dir] = []; }
  }

  let modifie = false;
  for (const t of trajets) {
    if (t.fige) continue;
    if ((t.baseTime||"").slice(0,8) !== aujourdhui) continue;

    const liste = parSens[t.dir] || [];
    // On retrouve le train par son numéro et son horaire de départ prévu.
    const frais = liste.find(x =>
      String(x.trainNo) === String(t.trainNo) &&
      (x.baseTime||"").slice(0,13) === (t.baseTime||"").slice(0,13)
    );
    if (!frais) continue;

    const nouveauRetard = frais.delayG30 || 0;
    if (nouveauRetard !== t.delaySncf || frais.etat !== t.etat) {
      t.delaySncf = nouveauRetard;
      t.etat = frais.etat;
      if (frais.cause) t.cause = frais.cause;
      modifie = true;
    }
    // Une fois le train arrivé, on fige la valeur : c'est le retard définitif.
    if (frais.etat === "arrive" && !t.fige) {
      t.fige = true;
      modifie = true;
    }
  }

  if (modifie) {
    const { ecrireMoisPublic } = require("./_storage");
    await ecrireMoisPublic(mois, trajets);
  }
  return trajets;
}

// Recalcule points + cumul à partir des trajets stockés,
// en utilisant le retard "retenu" (manuel prioritaire).
function synthese(trajets) {
  const pourCalcul = trajets.map(t => ({ delayMin: retardRetenu(t) }));
  const res = calculer(pourCalcul);
  return {
    trajets: trajets.map(t => ({ ...t, delayRetenu: retardRetenu(t) })),
    ...res,
    stockageDurable: upstashConfigure(),
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const moisDefaut = new Date().toISOString().slice(0, 7); // "2026-07"

  try {
    if (req.method === "GET") {
      const mois = req.query.mois || moisDefaut;
      let trajets = await lireMois(mois);
      // On remet à jour les retards depuis la SNCF avant de calculer.
      trajets = await resynchroniser(mois, trajets);
      res.status(200).json(synthese(trajets));
      return;
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const mois = body.mois || moisDefaut;
      const action = body.action;

      let trajets;
      if (action === "ajouter") {
        // On génère un id stable si absent.
        const t = body.trajet || {};
        if (!t.id) t.id = `${t.dir}:${t.trainNo}:${(t.baseTime || "").slice(0,8)}:${Date.now()}`;
        if (t.delayManuel === undefined) t.delayManuel = null;
        trajets = await ajouterTrajet(mois, t);
      } else if (action === "corriger") {
        trajets = await corrigerRetard(mois, body.id, body.delayManuel);
      } else if (action === "rafraichir") {
        trajets = await rafraichirRetardSncf(mois, body.id, body.delaySncf, body.etat, body.cause);
      } else if (action === "supprimer") {
        trajets = await supprimerTrajet(mois, body.id);
      } else {
        res.status(400).json({ error: "Action inconnue." });
        return;
      }

      res.status(200).json(synthese(trajets));
      return;
    }

    res.status(405).json({ error: "Méthode non autorisée." });
  } catch (e) {
    res.status(500).json({ error: e.message || "Erreur serveur." });
  }
};
