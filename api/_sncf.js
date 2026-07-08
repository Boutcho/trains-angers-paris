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

// Récupère les prochains trajets d'Angers→Paris ou Paris→Angers.
// Renvoie une liste simplifiée : horaire prévu, horaire réel,
// retard en minutes, numéro de train, statut.
async function getTrains(dir, key) {
  const from = dir === "paris-angers" ? GARES.paris : GARES.angers;
  const to   = dir === "paris-angers" ? GARES.angers : GARES.paris;

  // On demande jusqu'à 12 trajets à venir, avec données temps réel.
  const url = `https://api.sncf.com/v1/coverage/sncf/journeys`
            + `?from=${from}&to=${to}`
            + `&datetime_represents=departure`
            + `&count=12&data_freshness=realtime`;

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
  const trains = [];

  for (const j of journeys) {
    // Dans un trajet, on cherche la section "train" (public_transport).
    const section = (j.sections || []).find(s => s.type === "public_transport");
    if (!section) continue;

    const info = section.display_informations || {};
    const base = section.base_departure_date_time || j.departure_date_time;
    const real = section.departure_date_time || j.departure_date_time;

    let delayMin = 0;
    const b = parseSncfDate(base), r = parseSncfDate(real);
    if (b && r) delayMin = Math.round((r - b) / 60000);

    const status = (info.status || j.status || "").toLowerCase();
    const cancelled = status.includes("delet") || status.includes("no_service");

    trains.push({
      trainNo: info.headsign || info.trip_short_name || "—",
      baseTime: base,
      realTime: real,
      delayMin: delayMin > 0 ? delayMin : 0,
      cancelled,
      // Identifiant stable d'un train pour un jour donné, pour ne
      // pas envoyer deux fois la même alerte.
      uid: `${dir}:${info.headsign || info.trip_short_name || "x"}:${(base || "").slice(0,8)}`,
    });
  }

  return trains;
}

module.exports = { getTrains, parseSncfDate, GARES };
