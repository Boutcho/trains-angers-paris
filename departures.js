// ============================================================
//  BRIQUE PARTAGÉE : parler à la SNCF correctement
// ------------------------------------------------------------
//  Utilisée à la fois par le tableau de bord (/api/departures)
//  et par le vérificateur d'alertes (/api/check-delays).
//
//  Nouveauté clé : au lieu de lister les "départs" bruts d'une
//  gare (qui partent dans toutes les directions), on demande les
//  TRAJETS ("journeys") d'Angers à Paris (ou l'inverse). La SNCF
//  ne renvoie alors QUE les trains qui relient vraiment les deux
//  villes. Fini les trains parasites vers Bordeaux ou Rennes.
// ============================================================

const GARES = {
  angers: "stop_area:SNCF:87484006",  // Angers-Saint-Laud
  paris:  "stop_area:SNCF:87391003",  // Paris-Montparnasse
};

// Transforme une date SNCF "20260708T173000" en objet Date.
function parseSncfDate(s) {
  if (!s) return null;
  return new Date(
    `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(9,11)}:${s.slice(11,13)}:${s.slice(13,15)}`
  );
}

// Récupère les trajets d'Angers→Paris ou Paris→Angers.
// Renvoie une liste simplifiée : horaire prévu, horaire réel,
// retard en minutes, numéro de train, statut.
//
// Paramètres optionnels (opts) :
//   count         : nombre de trajets (défaut 20)
//   sinceMidnight : si true, part de minuit du jour courant pour
//                   inclure les trains DÉJÀ PARTIS (rattrapage de saisie).
async function getTrains(dir, key, opts = {}) {
  const from = dir === "paris-angers" ? GARES.paris : GARES.angers;
  const to   = dir === "paris-angers" ? GARES.angers : GARES.paris;

  const count = opts.count || 20;

  // Point de départ dans le temps : soit maintenant (prochains trains),
  // soit minuit aujourd'hui (pour voir aussi les trains déjà partis).
  let datetimeParam = "";
  if (opts.sinceMidnight) {
    const now = new Date();
    const y = now.getFullYear();
    const mo = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    datetimeParam = `&datetime=${y}${mo}${d}T000000`;
  }

  const url = `https://api.sncf.com/v1/coverage/sncf/journeys`
            + `?from=${from}&to=${to}`
            + `&datetime_represents=departure${datetimeParam}`
            + `&count=${count}&data_freshness=realtime`;

  const res = await fetch(url, {
    headers: { "Authorization": "Basic " + Buffer.from(key + ":").toString("base64") },
  });
  if (!res.ok) {
    const err = new Error(`SNCF ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const journeys = data.journeys || [];
  // Les perturbations sont dans un tableau à part, reliées aux trajets
  // par identifiant. On les indexe par id pour un accès rapide.
  const disruptionsById = {};
  for (const d of (data.disruptions || [])) {
    if (d.id) disruptionsById[d.id] = d;
  }
  const trains = [];
  const maintenant = new Date();

  for (const j of journeys) {
    // Dans un trajet, on cherche la section "train" (public_transport).
    const section = (j.sections || []).find(s => s.type === "public_transport");
    if (!section) continue;

    const info = section.display_informations || {};

    // --- HEURES DE DÉPART (prévue = base, réelle = amended/real) ---
    const baseDep = section.base_departure_date_time || j.departure_date_time;
    const realDep = section.departure_date_time || j.departure_date_time;

    // --- HEURES D'ARRIVÉE (prévue + réelle) ---
    // Selon les versions de l'API, le champ peut s'appeler différemment ;
    // on cherche donc à plusieurs endroits, du plus précis au plus général.
    const baseArr = section.base_arrival_date_time
                 || info.base_arrival_date_time
                 || j.arrival_date_time;
    const realArr = section.arrival_date_time
                 || info.arrival_date_time
                 || j.arrival_date_time;

    // --- Retards en minutes ---
    const delayDep = diffMinutes(baseDep, realDep);
    const delayArr = diffMinutes(baseArr, realArr);

    // --- État du train : pas parti / en route / arrivé ---
    // On privilégie l'info SNCF si elle existe, sinon on se base sur l'heure.
    const arrEffective = parseSncfDate(realArr);
    const depEffective = parseSncfDate(realDep);
    const sectionState = (section.data_freshness || "").toLowerCase();

    let etat;
    if (arrEffective && arrEffective <= maintenant) {
      etat = "arrive";          // l'arrivée réelle est passée -> terminé
    } else if (depEffective && depEffective <= maintenant) {
      etat = "en_route";        // parti mais pas encore arrivé
    } else {
      etat = "a_venir";         // pas encore parti
    }

    // --- Retard "pertinent" selon l'état (la colonne intelligente) ---
    //   à venir  -> retard au départ (anticipation)
    //   en route -> retard d'arrivée recalculé en direct
    //   arrivé   -> retard d'arrivée définitif
    let delayPertinent, natureRetard;
    if (etat === "a_venir") {
      delayPertinent = delayDep;
      natureRetard = "depart";
    } else if (etat === "en_route") {
      delayPertinent = (delayArr !== null) ? delayArr : delayDep;
      natureRetard = "en_route";
    } else {
      delayPertinent = (delayArr !== null) ? delayArr : delayDep;
      natureRetard = "arrivee";
    }

    const status = (info.status || j.status || "").toLowerCase();
    const cancelled = status.includes("delet") || status.includes("no_service");

    // --- Cause du retard (si disponible dans les perturbations) ---
    const cause = extraireCause(j, section, disruptionsById);

    trains.push({
      trainNo: info.headsign || info.trip_short_name || "—",
      // départ
      baseTime: baseDep,
      realTime: realDep,
      delayDep: Math.max(0, delayDep || 0),
      // arrivée
      baseArrTime: baseArr,
      realArrTime: realArr,
      delayArr: (delayArr === null) ? null : Math.max(0, delayArr),
      // cause du retard (texte lisible ou null)
      cause,
      // synthèse "colonne intelligente"
      etat,                       // a_venir | en_route | arrive
      natureRetard,               // depart | en_route | arrivee
      delayPertinent: Math.max(0, delayPertinent || 0),
      // le retard qui compte pour la G30 = retard à l'arrivée (ou départ en repli)
      delayG30: (delayArr === null) ? Math.max(0, delayDep || 0) : Math.max(0, delayArr),
      cancelled,
      uid: `${dir}:${info.headsign || info.trip_short_name || "x"}:${(baseDep || "").slice(0,8)}`,
    });
  }

  return trains;
}

// Différence en minutes entre deux dates SNCF. null si l'une manque.
function diffMinutes(base, real) {
  const b = parseSncfDate(base), r = parseSncfDate(real);
  if (!b || !r) return null;
  return Math.round((r - b) / 60000);
}

// Extrait un texte de cause lisible pour un trajet.
// Stratégie, du plus précis au plus général :
//   1) le message rédigé par la SNCF dans la perturbation liée (vraie cause)
//   2) à défaut, le libellé de sévérité ("retard important" -> "Retard signalé")
//   3) sinon null (rien à afficher)
function extraireCause(journey, section, disruptionsById) {
  // Rassembler les liens de perturbation présents sur le trajet et la section.
  const liens = []
    .concat(journey.links || [])
    .concat(section.links || [])
    .concat((section.display_informations || {}).links || []);

  const dispSet = new Set();
  for (const l of liens) {
    if (l && (l.type === "disruption" || l.rel === "disruptions") && l.id) {
      dispSet.add(l.id);
    }
  }

  // Chercher un message texte dans les perturbations liées.
  for (const id of dispSet) {
    const d = disruptionsById[id];
    if (!d) continue;
    const msg = premierMessage(d);
    if (msg) return nettoyer(msg);
  }

  // Repli : libellé de sévérité de la première perturbation liée.
  for (const id of dispSet) {
    const d = disruptionsById[id];
    if (!d) continue;
    const sev = (d.severity && (d.severity.name || d.severity.effect)) || "";
    const label = libelleSeverite(sev);
    if (label) return label;
  }

  return null;
}

// Récupère le premier message texte d'une perturbation.
function premierMessage(d) {
  const msgs = d.messages || [];
  for (const m of msgs) {
    const t = (m && (m.text || (m.channel && m.text))) || "";
    if (t && t.trim()) return t;
  }
  return null;
}

// Transforme un code de sévérité en libellé court et lisible.
function libelleSeverite(sev) {
  const s = (sev || "").toLowerCase();
  if (!s) return null;
  if (s.includes("delay") || s.includes("retard")) return "Retard signalé";
  if (s.includes("delet") || s.includes("suppr") || s.includes("no_service")) return "Train supprimé";
  if (s.includes("modified") || s.includes("detour")) return "Trajet modifié";
  return "Perturbation signalée";
}

// Nettoie un message SNCF : enlève le HTML éventuel, coupe si trop long.
function nettoyer(txt) {
  let t = String(txt).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (t.length > 120) t = t.slice(0, 117).trim() + "…";
  return t;
}

module.exports = { getTrains, parseSncfDate, GARES };
