// ============================================================
//  VÉRIFICATEUR D'ALERTES (réveillé par cron-job.org)
// ------------------------------------------------------------
//  Toutes les ~10 min, un service externe appelle cette adresse.
//  Elle :
//   1. demande les trajets Angers⇄Paris à la SNCF
//   2. repère les trains en retard de plus de 15 min (ou supprimés)
//   3. envoie un email aux destinataires configurés
//   4. retient ce qui a déjà été signalé pour ne pas spammer
//
//  MÉMOIRE "déjà signalé" : sur le plan gratuit, on n'a pas de
//  base de données. On utilise donc une astuce simple et gratuite :
//  Vercel Edge Config OU, plus simple encore, une mémoire courte en
//  RAM. Ici on choisit la version la plus simple à déployer : une
//  mémoire en RAM qui vit tant que la fonction reste "chaude".
//  Conséquence honnête : après une longue inactivité, un même gros
//  retard PEUT être re-signalé une fois. Acceptable pour ton usage.
//  (Je t'explique dans le guide comment passer à une mémoire durable
//   si un jour tu veux zéro doublon garanti.)
// ============================================================

const { getTrains } = require("./_sncf");

// Mémoire courte : uid de train -> déjà alerté ?
const alreadyAlerted = new Set();

const SEUIL_MINUTES = 15;

module.exports = async function handler(req, res) {
  // Sécurité : seul cron-job.org, qui connaît le secret, peut déclencher.
  const secret = process.env.CRON_SECRET;
  const auth = req.headers["authorization"] || "";
  if (secret && auth !== `Bearer ${secret}`) {
    res.status(401).json({ error: "Non autorisé." });
    return;
  }

  const KEY = process.env.SNCF_API_KEY;
  const RESEND_KEY = process.env.RESEND_API_KEY;
  const FROM = process.env.ALERT_FROM || "onboarding@resend.dev";
  const TO = (process.env.ALERT_TO || "").split(",").map(s => s.trim()).filter(Boolean);

  if (!KEY || !RESEND_KEY || !TO.length) {
    res.status(500).json({ error: "Configuration incomplète (clé SNCF, clé Resend ou destinataires)." });
    return;
  }

  const alerts = [];

  try {
    for (const dir of ["angers-paris", "paris-angers"]) {
      const trains = await getTrains(dir, KEY);
      for (const t of trains) {
        const bigDelay = t.delayMin >= SEUIL_MINUTES || t.cancelled;
        if (bigDelay && !alreadyAlerted.has(t.uid)) {
          alreadyAlerted.add(t.uid);
          alerts.push({ ...t, dir });
        }
      }
    }

    // Rien de neuf : on s'arrête là.
    if (!alerts.length) {
      res.status(200).json({ ok: true, sent: 0, message: "Aucun nouveau retard important." });
      return;
    }

    // On envoie un email récapitulatif.
    await sendEmail(RESEND_KEY, FROM, TO, alerts);
    res.status(200).json({ ok: true, sent: alerts.length });
  } catch (e) {
    res.status(502).json({ error: e.message || "Erreur pendant la vérification." });
  }
};

// --- Construction et envoi de l'email via Resend ---
async function sendEmail(apiKey, from, to, alerts) {
  const rows = alerts.map(a => {
    const sens = a.dir === "angers-paris" ? "Angers → Paris" : "Paris → Angers";
    const heure = fmtTime(a.baseTime);
    const etat = a.cancelled ? "SUPPRIMÉ" : `+${a.delayMin} min`;
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">${sens}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">${heure}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">Train ${a.trainNo}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#c0392b;font-weight:bold;">${etat}</td>
    </tr>`;
  }).join("");

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;">
      <h2 style="color:#c0392b;">🚄 Retard détecté sur ta ligne</h2>
      <p>Un ou plusieurs trains Angers ⇄ Paris ont plus de ${SEUIL_MINUTES} minutes de retard :</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="background:#f7f7f7;text-align:left;">
            <th style="padding:8px 12px;">Sens</th>
            <th style="padding:8px 12px;">Départ prévu</th>
            <th style="padding:8px 12px;">Train</th>
            <th style="padding:8px 12px;">État</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="color:#888;font-size:12px;margin-top:20px;">
        Alerte automatique · Données SNCF · Seuil : ${SEUIL_MINUTES} min
      </p>
    </div>`;

  const subject = alerts.length === 1
    ? `🚄 Retard train ${alerts[0].trainNo} (${alerts[0].cancelled ? "supprimé" : "+" + alerts[0].delayMin + " min"})`
    : `🚄 ${alerts.length} trains en retard sur ta ligne`;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`Resend a répondu ${resp.status}. ${detail}`);
  }
}

function fmtTime(s) {
  if (!s) return "—";
  return `${s.slice(9,11)}h${s.slice(11,13)}`;
}
