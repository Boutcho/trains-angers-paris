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
const { lireConfig } = require("./_storage");

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
  const NTFY_TOPIC = process.env.NTFY_TOPIC;
  const NTFY_SERVER = process.env.NTFY_SERVER || "https://ntfy.sh";

  if (!KEY || !RESEND_KEY || !TO.length) {
    res.status(500).json({ error: "Configuration incomplète (clé SNCF, clé Resend ou destinataires)." });
    return;
  }

  // --- MODE TEST : ?test=1 force l'envoi d'une alerte de démonstration sur les
  //     deux canaux et renvoie le détail de chacun (diagnostic). Le secret
  //     reste exigé (on est déjà passé le contrôle d'autorisation ci-dessus). ---
  let isTest = false;
  try { isTest = new URL(req.url, "http://x").searchParams.get("test") === "1"; } catch (_) {}
  if (isTest) {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    const p = n => String(n).padStart(2, "0");
    const baseTime = `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    const demo = { dir: "angers-paris", trainNo: "TEST", baseTime, delayDep: 20, delayArr: 20, delayG30: 20, cause: "Test de configuration (a ignorer)", cancelled: false, uid: "test" };
    const result = {
      test: true,
      config: { from: FROM, destinataires: TO.length, resendKey: !!RESEND_KEY, sncfKey: !!KEY, ntfyTopic: !!NTFY_TOPIC },
    };
    try { await sendEmail(RESEND_KEY, FROM, TO, [demo]); result.email = { ok: true }; }
    catch (e) { result.email = { ok: false, detail: e.message }; }
    if (NTFY_TOPIC) {
      try { await sendPush(NTFY_SERVER, NTFY_TOPIC, [demo]); result.push = { ok: true }; }
      catch (e) { result.push = { ok: false, detail: e.message }; }
    } else {
      result.push = { ok: false, detail: "NTFY_TOPIC absent des variables Vercel" };
    }
    res.status(200).json(result);
    return;
  }

  // --- Respect de la configuration : pause complète + jours d'envoi ---
  // (le mode test ci-dessus n'y est pas soumis). En cas d'erreur de lecture,
  // on n'empêche PAS les alertes (on préfère un doublon rare à un silence total).
  try {
    const config = await lireConfig();
    const verdict = alertesAutorisees(config);
    if (!verdict.ok) {
      res.status(200).json({ ok: true, sent: 0, skipped: verdict.raison });
      return;
    }
  } catch (e) {
    console.error("Lecture config échouée, envoi sans restriction :", e.message);
  }

  const alerts = [];

  try {
    for (const dir of ["angers-paris", "paris-angers"]) {
      const trains = await getTrains(dir, KEY);
      for (const t of trains) {
        // Alertes basées sur le retard AU DÉPART (anticipation avant le départ).
        const bigDelay = t.delayDep >= SEUIL_MINUTES || t.cancelled;
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

    // Envoi sur les deux canaux, INDÉPENDAMMENT : l'échec de l'un ne doit
    // jamais empêcher l'autre. On rapporte le résultat de chacun.
    let email = false, push = false;
    try {
      await sendEmail(RESEND_KEY, FROM, TO, alerts);
      email = true;
    } catch (e) {
      console.error("Alerte email échouée :", e.message);
    }
    if (NTFY_TOPIC) {
      try {
        await sendPush(NTFY_SERVER, NTFY_TOPIC, alerts);
        push = true;
      } catch (e) {
        console.error("Notification push (ntfy) échouée :", e.message);
      }
    }

    res.status(200).json({ ok: true, sent: alerts.length, email, push });
  } catch (e) {
    res.status(502).json({ error: e.message || "Erreur pendant la vérification." });
  }
};

// --- Construction et envoi de l'email via Resend ---
async function sendEmail(apiKey, from, to, alerts) {
  const maintenant = new Date();
  const rows = alerts.map(a => {
    const sens = a.dir === "angers-paris" ? "Angers → Paris" : "Paris → Angers";
    const heure = fmtTime(a.baseTime);
    const etat = a.cancelled ? "SUPPRIMÉ" : `+${a.delayDep} min`;
    const cause = a.cause ? escapeHtmlMail(a.cause) : "—";
    const resa = calculReservable(a.baseTime, maintenant);
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">${sens}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">${heure}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">Train ${a.trainNo}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#c0392b;font-weight:bold;">${etat}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#666;">${cause}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;color:${resa.past?'#c0392b':'#2c7a3f'};font-size:13px;">${resa.texte}</td>
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
            <th style="padding:8px 12px;">Cause</th>
            <th style="padding:8px 12px;">Réservable</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="color:#888;font-size:12px;margin-top:20px;">
        Alerte automatique · Données SNCF · Seuil : ${SEUIL_MINUTES} min
      </p>
    </div>`;

  const subject = alerts.length === 1
    ? `🚄 Retard train ${alerts[0].trainNo} (${alerts[0].cancelled ? "supprimé" : "+" + alerts[0].delayDep + " min"})`
    : `🚄 ${alerts.length} trains en retard sur ta ligne`;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
    signal: AbortSignal.timeout(8000),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`Resend a répondu ${resp.status}. ${detail}`);
  }
}

// --- Construction et envoi de la notification push via ntfy ---
// ntfy accepte une publication en JSON : on y met le titre et le message
// (UTF-8, donc accents et emoji OK), une priorité haute, une pastille train
// et un lien qui ouvre le tableau de bord quand on tape la notification.
async function sendPush(server, topic, alerts) {
  const maintenant = new Date();
  let title, message;

  if (alerts.length === 1) {
    const a = alerts[0];
    const sens = a.dir === "angers-paris" ? "Angers → Paris" : "Paris → Angers";
    const etat = a.cancelled ? "SUPPRIMÉ" : `+${a.delayDep} min`;
    const resa = calculReservable(a.baseTime, maintenant);
    title = `🚄 Train ${a.trainNo} : ${etat}`;
    message =
      `${sens} · départ prévu ${fmtTime(a.baseTime)}\n` +
      `${resa.texte}` +
      (a.cause ? `\nCause : ${a.cause}` : "");
  } else {
    title = `🚄 ${alerts.length} trains en retard`;
    message = alerts.map(a => {
      const sens = a.dir === "angers-paris" ? "Angers→Paris" : "Paris→Angers";
      const etat = a.cancelled ? "supprimé" : `+${a.delayDep} min`;
      return `• ${sens} ${fmtTime(a.baseTime)} — Train ${a.trainNo} (${etat})`;
    }).join("\n");
  }

  const resp = await fetch(server.replace(/\/+$/, ""), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic,
      title,
      message,
      priority: 4,
      tags: ["bullettrain_side"],
      click: "https://trains-angers-paris.vercel.app/",
    }),
    signal: AbortSignal.timeout(8000),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`ntfy a répondu ${resp.status}. ${detail}`);
  }
}

// Jour ISO (1=lundi … 7=dimanche) et date "AAAA-MM-JJ" à l'heure de PARIS.
// Indispensable : le serveur Vercel tourne en heure universelle (UTC), pas en
// heure française. On demande donc explicitement le fuseau Europe/Paris.
function parisInfos() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Paris",
      weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date()).map(x => [x.type, x.value])
  );
  const jours = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { isoDay: jours[p.weekday] || 0, dateStr: `${p.year}-${p.month}-${p.day}` };
}

// Décide si l'on a le droit d'envoyer des alertes maintenant, selon la config.
function alertesAutorisees(config) {
  const { isoDay, dateStr } = parisInfos();
  // 1. Pause complète jusqu'à une date (incluse).
  if (config.pauseJusquau && dateStr <= config.pauseJusquau) {
    return { ok: false, raison: `en pause jusqu'au ${config.pauseJusquau}` };
  }
  // 2. Jours d'envoi (si la restriction est active).
  if (config.plageActive) {
    const jours = Array.isArray(config.jours) ? config.jours : [];
    if (!jours.includes(isoDay)) {
      return { ok: false, raison: "hors des jours d'envoi configurés" };
    }
  }
  return { ok: true };
}

function fmtTime(s) {
  if (!s) return "—";
  return `${s.slice(9,11)}h${s.slice(11,13)}`;
}

function escapeHtmlMail(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Calcule le temps restant avant l'heure de départ PRÉVUE, au moment de
// l'envoi du mail. Sert à savoir combien de temps il reste pour réserver.
// Une fois l'heure de départ prévue passée, la réservation n'est plus possible.
function calculReservable(baseDepart, maintenant) {
  if (!baseDepart) return { texte: "—", past: false };
  const dep = new Date(
    `${baseDepart.slice(0,4)}-${baseDepart.slice(4,6)}-${baseDepart.slice(6,8)}` +
    `T${baseDepart.slice(9,11)}:${baseDepart.slice(11,13)}:${baseDepart.slice(13,15)}`
  );
  const diffMin = Math.round((dep - maintenant) / 60000);
  if (diffMin <= 0) {
    return { texte: "trop tard pour réserver", past: true };
  }
  return { texte: `${fmtDuree(diffMin)} pour réserver`, past: false };
}

// Formate une durée en minutes vers "0h17" ou "23 min".
function fmtDuree(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0) return `${h}h${String(m).padStart(2,"0")}`;
  return `${m} min`;
}
