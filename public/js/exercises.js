// Onglet Mes exos : bibliothèque d'exercices (ajout / suppression).

import { $, esc, uid, toast } from "./utils.js";
import { db, save } from "./store.js";
import { renderPicker } from "./workout.js";

const GROUPS = ["Pectoraux", "Dos", "Épaules", "Biceps", "Triceps", "Jambes", "Fessiers", "Abdos", "Mollets", "Autre"];
const TYPES = [
  ["charge", "Charge (kg)"],
  ["pdc", "Poids du corps"],
  ["assistance", "Machine assistée (kg d'aide)"]
];

$("#add-ex").onclick = () => {
  const name = $("#new-ex-name").value.trim();
  if (!name) { toast("Donne un nom à l'exo"); return; }
  if (db.exos.some(e => e.name.localeCompare(name, "fr", { sensitivity: "base" }) === 0)) {
    toast("Cet exercice existe déjà"); return;
  }
  db.exos.push({ id: uid(), name, group: $("#new-ex-group").value, type: $("#new-ex-type").value });
  save(); $("#new-ex-name").value = "";
  renderExoList(); renderPicker();
  toast("Exo ajouté ✓");
};
$("#new-ex-name").addEventListener("keydown", e => { if (e.key === "Enter") $("#add-ex").click(); });
$("#ex-search").addEventListener("input", renderExoList);

function editExercise(row, exercise) {
  const groupOptions = GROUPS.map(group => `<option ${group === exercise.group ? "selected" : ""}>${esc(group)}</option>`).join("");
  const typeOptions = TYPES.map(([value, label]) => `<option value="${value}" ${value === exercise.type ? "selected" : ""}>${esc(label)}</option>`).join("");
  row.className = "edit-exercise";
  row.innerHTML = `
    <label>Nom<input class="edit-name" value="${esc(exercise.name)}"></label>
    <label>Groupe<select class="edit-group">${groupOptions}</select></label>
    <label>Type<select class="edit-type">${typeOptions}</select></label>
    <div class="edit-actions">
      <button type="button" class="ghost btn small edit-cancel">Annuler</button>
      <button type="button" class="btn small edit-save">Enregistrer</button>
    </div>`;
  const nameInput = row.querySelector(".edit-name");
  nameInput.focus(); nameInput.select();
  row.querySelector(".edit-cancel").onclick = renderExoList;
  row.querySelector(".edit-save").onclick = () => {
    const name = nameInput.value.trim();
    if (!name) { toast("Donne un nom à l'exo"); return; }
    if (db.exos.some(item => item.id !== exercise.id && item.name.localeCompare(name, "fr", { sensitivity: "base" }) === 0)) {
      toast("Cet exercice existe déjà"); return;
    }
    exercise.name = name;
    exercise.group = row.querySelector(".edit-group").value;
    exercise.type = row.querySelector(".edit-type").value;
    save(); renderExoList(); renderPicker(); toast("Exercice modifié ✓");
  };
}

export function renderExoList() {
  const el = $("#ex-list"); el.innerHTML = "";
  const groups = {};
  const query = $("#ex-search").value.trim().toLocaleLowerCase("fr");
  const visible = db.exos.filter(e => !query || `${e.name} ${e.group}`.toLocaleLowerCase("fr").includes(query));
  visible.forEach(e => (groups[e.group] = groups[e.group] || []).push(e));
  if (!visible.length) {
    el.innerHTML = `<div class="empty">${db.exos.length ? "Aucun exercice ne correspond à la recherche." : "Ajoute ton premier exercice."}</div>`;
    return;
  }
  Object.keys(groups).sort().forEach(g => {
    const h = document.createElement("div");
    h.innerHTML = `<div class="pill" style="margin:14px 0 8px">${esc(g)}</div>`;
    el.appendChild(h);
    groups[g].forEach(e => {
      const row = document.createElement("div");
      row.className = "flex-between";
      row.style.cssText = "padding:9px 0; border-bottom:1px solid var(--border)";
      const used = db.sessions.some(s => s.exos.some(x => x.exoId === e.id));
      const typeLabel = { pdc: "poids du corps", assistance: "assisté", charge: "charge" }[e.type] || e.type;
      row.innerHTML = `<span style="font-weight:600">${esc(e.name)}<span class="type-tag">${esc(typeLabel)}</span></span>`;
      const actions = document.createElement("div"); actions.className = "exercise-actions";
      const edit = document.createElement("button");
      edit.type = "button"; edit.className = "ghost btn small"; edit.textContent = "Modifier";
      edit.setAttribute("aria-label", `Modifier ${e.name}`);
      edit.onclick = () => editExercise(row, e);
      const del = document.createElement("button");
      del.type = "button"; del.className = "del"; del.textContent = "✕";
      del.setAttribute("aria-label", `Supprimer ${e.name}`);
      del.onclick = () => {
        if (used && !confirm(`"${e.name}" a des séances enregistrées. Supprimer quand même ? (l'historique reste)`)) return;
        db.exos = db.exos.filter(x => x.id !== e.id);
        save(); renderExoList(); renderPicker();
      };
      actions.append(edit, del);
      row.appendChild(actions);
      el.appendChild(row);
    });
  });
}
