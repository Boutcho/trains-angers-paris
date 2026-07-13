// ============================================================
//  STOCKAGE DES TRAJETS RÉSERVÉS (carnet mensuel)
// ------------------------------------------------------------
//  On utilise Upstash Redis via son API "REST" : pas de librairie
//  à installer, juste des appels web avec une URL + un jeton, tous
//  deux rangés dans le coffre-fort Vercel :
//     UPSTASH_REDIS_REST_URL
//     UPSTASH_REDIS_REST_TOKEN
//
//  Un trajet réservé est stocké sous une clé par mois :
//     trajets:2026-07  ->  liste JSON de trajets
//
//  Chaque trajet =
//     { id, dir, trainNo, baseTime, delaySncf, delayManuel, cancelled }
//   - delaySncf  : retard vu par la SNCF au moment de l'enregistrement
//   - delayManuel: retard corrigé à la main (null si non corrigé)
//   Le retard "retenu" = delayManuel si défini, sinon delaySncf.
// ============================================================

// L'URL et le jeton peuvent être fournis sous plusieurs noms selon la façon
// dont la base a été connectée à Vercel :
//   - Upstash direct : UPSTASH_REDIS_REST_URL / _TOKEN
//   - via l'intégration KV de Vercel : KV_REST_API_URL / KV_REST_API_TOKEN
// On accepte les deux pour que ça marche sans rien reconfigurer.
const URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

// Repli local (si Upstash pas encore configuré) : mémoire de session.
// Permet de tester l'app avant de brancher la base. NON durable.
const memoireLocale = {};

function upstashConfigure() {
  return Boolean(URL && TOKEN);
}

// Appel bas niveau à Upstash (commande Redis via REST).
async function redis(command) {
  const res = await fetch(URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error(`Upstash ${res.status}`);
  const data = await res.json();
  return data.result;
}

function cleMois(mois) {
  return `trajets:${mois}`; // mois au format "2026-07"
}

// Lit la liste des trajets d'un mois.
async function lireMois(mois) {
  if (!upstashConfigure()) {
    return memoireLocale[mois] || [];
  }
  const raw = await redis(["GET", cleMois(mois)]);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

// Écrit la liste complète des trajets d'un mois.
async function ecrireMois(mois, trajets) {
  if (!upstashConfigure()) {
    memoireLocale[mois] = trajets;
    return;
  }
  await redis(["SET", cleMois(mois), JSON.stringify(trajets)]);
}

// Ajoute un trajet (ou le remplace s'il a le même id).
async function ajouterTrajet(mois, trajet) {
  const liste = await lireMois(mois);
  const i = liste.findIndex(t => t.id === trajet.id);
  if (i >= 0) liste[i] = trajet;
  else liste.push(trajet);
  await ecrireMois(mois, liste);
  return liste;
}

// Supprime un trajet par id.
async function supprimerTrajet(mois, id) {
  const liste = await lireMois(mois);
  const filtree = liste.filter(t => t.id !== id);
  await ecrireMois(mois, filtree);
  return filtree;
}

// Met à jour le retard SNCF d'arrivée d'un trajet déjà enregistré
// (utile quand on a réservé un train pas encore arrivé : sa valeur
// d'arrivée définitive n'était pas encore connue). Ne touche PAS
// au retard manuel s'il a été saisi.
async function rafraichirRetardSncf(mois, id, delaySncf, etat, cause) {
  const liste = await lireMois(mois);
  const t = liste.find(x => x.id === id);
  if (t) {
    t.delaySncf = Number(delaySncf) || 0;
    if (etat) t.etat = etat;
    if (cause !== undefined && cause !== null && cause !== "") t.cause = cause;
    await ecrireMois(mois, liste);
  }
  return liste;
}

// Corrige le retard manuel d'un trajet.
async function corrigerRetard(mois, id, delayManuel) {
  const liste = await lireMois(mois);
  const t = liste.find(x => x.id === id);
  if (t) {
    t.delayManuel = (delayManuel === null || delayManuel === "") ? null : Number(delayManuel);
    await ecrireMois(mois, liste);
  }
  return liste;
}

// Retard "retenu" pour un trajet (manuel prioritaire sur SNCF).
function retardRetenu(trajet) {
  if (trajet.delayManuel !== null && trajet.delayManuel !== undefined) {
    return Number(trajet.delayManuel) || 0;
  }
  return Number(trajet.delaySncf) || 0;
}

module.exports = {
  lireMois, ajouterTrajet, supprimerTrajet, corrigerRetard,
  rafraichirRetardSncf, retardRetenu, upstashConfigure,
};
