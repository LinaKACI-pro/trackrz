// Métriques d'entraînement : lookups d'exos et séries temporelles par métrique.

import { db } from "./store.js";

export const exoName = id => (db.exos.find(e => e.id === id) || {}).name || "Exo supprimé";
export const exoType = id => (db.exos.find(x => x.id === id) || {}).type || "charge";
export const est1rm = s => s.weight * (1 + s.reps / 30); // Epley
export const sessVolume = ex => ["pdc", "assistance"].includes(exoType(ex.exoId))
  ? 0
  : ex.sets.reduce((a, s) => a + s.reps * s.weight, 0);

// Un point par séance contenant l'exo, pour la métrique demandée
export function seriesFor(exoId, metric) {
  const pts = [];
  db.sessions.forEach(s => {
    const ex = s.exos.find(x => x.exoId === exoId);
    if (!ex) return;
    let v;
    if (metric === "maxWeight") v = Math.max(...ex.sets.map(x => x.weight));
    else if (metric === "minWeight") v = Math.min(...ex.sets.map(x => x.weight));
    else if (metric === "volume") v = sessVolume(ex);
    else if (metric === "est1rm") v = Math.max(...ex.sets.map(est1rm));
    else if (metric === "maxReps") v = Math.max(...ex.sets.map(x => x.reps));
    else if (metric === "volumeReps") v = ex.sets.reduce((a, x) => a + x.reps, 0);
    else v = Math.max(...ex.sets.map(est1rm));
    pts.push({ date: s.date, v: Math.round(v * 10) / 10 });
  });
  return pts;
}
