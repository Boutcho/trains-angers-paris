// ============================================================
//  API DE CONFIGURATION DES NOTIFICATIONS
// ------------------------------------------------------------
//  Pilote la plage d'envoi des alertes (jours autorisés) et la
//  mise en pause complète jusqu'à une date.
//
//    GET  /api/config              -> config actuelle (nettoyée)
//    POST /api/config {config:{…}} -> enregistre et renvoie la config
// ============================================================
const { lireConfig, ecrireConfig } = require("./_storage");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  try {
    if (req.method === "GET") {
      res.status(200).json(await lireConfig());
      return;
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const entree = body.config || body; // accepte {config:{…}} ou directement {…}
      const propre = await ecrireConfig(entree);
      res.status(200).json(propre);
      return;
    }

    res.status(405).json({ error: "Méthode non autorisée." });
  } catch (e) {
    res.status(500).json({ error: e.message || "Erreur serveur." });
  }
};
