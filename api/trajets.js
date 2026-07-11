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
      const trajets = await lireMois(mois);
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
        trajets = await rafraichirRetardSncf(mois, body.id, body.delaySncf, body.etat);
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
