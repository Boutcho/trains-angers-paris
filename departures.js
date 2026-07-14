// ============================================================
//  Tableau de bord : renvoie les trajets d'un sens à la page.
//  Options via l'URL :
//    ?dir=angers-paris | paris-angers
//    ?count=40           (nombre de trains, défaut 20)
//    ?full=1             (inclure les trains déjà partis aujourd'hui)
// ============================================================
const { getTrains } = require("./_sncf");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const KEY = process.env.SNCF_API_KEY;
  if (!KEY) { res.status(500).json({ error: "Clé SNCF non configurée sur le serveur." }); return; }

  const dir = req.query.dir === "paris-angers" ? "paris-angers" : "angers-paris";
  const count = Math.min(Math.max(parseInt(req.query.count) || 20, 1), 50);
  const sinceMidnight = req.query.full === "1";

  try {
    const trains = await getTrains(dir, KEY, { count, sinceMidnight });
    const lateCount = trains.filter(t => t.delayPertinent > 0 || t.cancelled).length;
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=30");
    res.status(200).json({ trains, lateCount });
  } catch (e) {
    const status = e.status || 502;
    res.status(status).json({ error: `La SNCF a répondu ${status}.` });
  }
};
