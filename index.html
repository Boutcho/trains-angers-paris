// ============================================================
//  CALCUL DES POINTS PRIME — Mécanisme G30 Proactive
// ------------------------------------------------------------
//  Règles officielles (tgvinoui.sncf, barème G30 Proactive) :
//
//  1) SEUIL PAR TRAJET : seul un retard STRICTEMENT supérieur à
//     15 minutes est comptabilisé dans le compteur mensuel.
//     Un train à 15 min ou moins compte pour 0.
//     Un train à 18 min compte pour 18 min.
//
//  2) BARÈME SUR LE CUMUL DU MOIS (en minutes) :
//        30–59 min   ->    800 pts
//        60–119 min  ->  2 000 pts
//        120–179 min ->  3 000 pts
//        180–239 min ->  4 000 pts
//        240–299 min ->  8 000 pts
//        300 min +   -> 12 500 pts
//     En dessous de 30 min cumulées : 0 pt.
// ============================================================

const SEUIL_TRAJET_MIN = 15;   // au-delà, le retard compte
const SEUIL_POINTS_MIN = 30;   // cumul minimum pour toucher des points

// Barème : chaque palier = { min: minutes cumulées mini, points }
// Trié du plus élevé au plus bas pour trouver le palier atteint.
const BAREME = [
  { min: 300, points: 12500, label: "5h et plus" },
  { min: 240, points: 8000,  label: "4h – 4h59" },
  { min: 180, points: 4000,  label: "3h – 3h59" },
  { min: 120, points: 3000,  label: "2h – 2h59" },
  { min: 60,  points: 2000,  label: "1h – 1h59" },
  { min: 30,  points: 800,   label: "30 – 59 min" },
];

// Un trajet compte-t-il ? (retard > 15 min et non annulé traité à part)
function minutesComptabilisees(delayMin) {
  const d = Number(delayMin) || 0;
  return d > SEUIL_TRAJET_MIN ? d : 0;
}

// À partir d'une liste de trajets {delayMin}, calcule le cumul retenu.
function cumulMinutes(trajets) {
  return trajets.reduce((total, t) => total + minutesComptabilisees(t.delayMin), 0);
}

// À partir d'un cumul de minutes, renvoie les points + le palier.
function pointsPourCumul(cumul) {
  if (cumul < SEUIL_POINTS_MIN) {
    return { points: 0, palier: "Moins de 30 min cumulées", prochainPalier: 30 };
  }
  const palier = BAREME.find(p => cumul >= p.min);
  // Minutes restantes avant le palier supérieur (pour l'affichage "il te manque X min").
  const idx = BAREME.indexOf(palier);
  const prochainPalier = idx > 0 ? BAREME[idx - 1].min : null;
  return {
    points: palier.points,
    palier: palier.label,
    prochainPalier, // null si déjà au max
  };
}

// Fonction tout-en-un : de la liste de trajets aux points.
function calculer(trajets) {
  const cumul = cumulMinutes(trajets || []);
  const res = pointsPourCumul(cumul);
  return {
    cumulMinutes: cumul,
    points: res.points,
    palier: res.palier,
    prochainPalier: res.prochainPalier,
    minutesAvantProchain: res.prochainPalier ? Math.max(0, res.prochainPalier - cumul) : null,
  };
}

module.exports = { calculer, cumulMinutes, pointsPourCumul, minutesComptabilisees, BAREME, SEUIL_TRAJET_MIN };
