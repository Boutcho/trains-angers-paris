// ============================================================
//  Tableau de bord : renvoie les trajets d'un sens à la page.
//  Utilise la brique partagée _sncf.js (trajets fiables).
// ============================================================
const { getTrains } = require("./_sncf");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const KEY = process.env.SNCF_API_KEY;
  if (!KEY) { res.status(500).json({ error: "Clé SNCF non configurée sur le serveur." }); return; }

  const dir = req.query.dir === "paris-angers" ? "paris-angers" : "angers-paris";

  try {
    const trains = await getTrains(dir, KEY);
    const lateCount = trains.filter(t => t.delayMin > 0 || t.cancelled).length;
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=30");
    res.status(200).json({ trains, lateCount });
  } catch (e) {
    const status = e.status || 502;
    res.status(status).json({ error: `La SNCF a répondu ${status}.` });
  }
};
