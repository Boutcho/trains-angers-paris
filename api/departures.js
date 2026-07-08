// ============================================================
//  MINI-SERVEUR : l'intermédiaire entre ta page et la SNCF
// ------------------------------------------------------------
//  Ta page web appelle CE fichier (et pas la SNCF directement).
//  Lui va chercher les données à la SNCF, côté serveur, où le
//  blocage "CORS" n'existe pas. Ta clé SNCF vit ici, en sécurité.
// ============================================================

// Les codes des gares côté SNCF.
const GARES = {
  angers: "stop_area:SNCF:87484006",  // Angers-Saint-Laud
  paris:  "stop_area:SNCF:87391003",  // Paris-Montparnasse
};

export default async function handler(req, res) {
  // On autorise ta page web à appeler ce serveur.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  // La clé SNCF est lue depuis une "variable d'environnement"
  // (un coffre-fort de Vercel), pas écrite en dur dans le code.
  const KEY = process.env.SNCF_API_KEY;
  if (!KEY) {
    res.status(500).json({ error: "Clé SNCF non configurée sur le serveur." });
    return;
  }

  // La page nous dit quel sens elle veut : "angers-paris" ou "paris-angers".
  const dir = req.query.dir === "paris-angers" ? "paris-angers" : "angers-paris";
  const originId = dir === "angers-paris" ? GARES.angers : GARES.paris;

  const url = `https://api.sncf.com/v1/coverage/sncf/stop_areas/${originId}`
            + `/departures?count=30&data_freshness=realtime`;

  try {
    const sncfRes = await fetch(url, {
      headers: { "Authorization": "Basic " + Buffer.from(KEY + ":").toString("base64") },
    });

    if (!sncfRes.ok) {
      res.status(sncfRes.status).json({
        error: `La SNCF a répondu ${sncfRes.status}.`,
      });
      return;
    }

    const data = await sncfRes.json();
    // On met un cache court : évite de spammer la SNCF si plusieurs
    // rafraîchissements arrivent dans la même minute.
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=30");
    res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ error: "Impossible de joindre la SNCF." });
  }
}
