// Onglet Séance : sélection des exos, mode guidé (série par série,
// timer de repos, brouillon persistant) et résumé avant enregistrement.

import { $, $$, esc, todayISO, uid, toast, stat } from "./utils.js";
import { db, save } from "./store.js";
import { exoName } from "./metrics.js";

let selected = new Set();   // exoIds cochés avant de commencer
let workout = null;         // séance en cours { date, exos:[{exoId, sets:[{reps,weight,done}]}], cur:{e,s}, restEnd }
const DRAFT_KEY = "muscu_draft";
let restTimer = null;

// Garde l'écran allumé pendant la séance (repos entre les séries).
let wakeLock = null;
async function acquireWakeLock() {
  if (wakeLock || !navigator.wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => { wakeLock = null; });
  } catch (_) { wakeLock = null; }
}
function releaseWakeLock() {
  try { wakeLock?.release(); } catch (_) {}
  wakeLock = null;
}
function inWorkout() { return !$("#view-workout").classList.contains("hide"); }
// Le verrou saute quand l'onglet passe en arrière-plan : on le reprend au retour.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && inWorkout()) acquireWakeLock();
});

const GROUPS = ["Pectoraux", "Dos", "Épaules", "Biceps", "Triceps", "Jambes", "Fessiers", "Abdos", "Mollets", "Autre"];
const TYPES = [
  ["charge", "Charge (kg)"],
  ["pdc", "Poids du corps"],
  ["assistance", "Machine assistée (kg d'aide)"]
];

function saveDraft() {
  if (workout) localStorage.setItem(DRAFT_KEY, JSON.stringify(workout));
  else localStorage.removeItem(DRAFT_KEY);
}
function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch (e) { return null; }
}

function showView(v) {
  ["select", "workout", "summary"].forEach(x => $("#view-" + x).classList.toggle("hide", x !== v));
  if (v === "workout") acquireWakeLock(); else releaseWakeLock();
  if (v === "select") { renderQuickStart(); renderResume(); renderPicker(); }
  if (v === "workout") renderWorkout();
  if (v === "summary") renderSummary();
}

// --- Vue sélection ---
export function renderPicker() {
  const p = $("#picker"); p.innerHTML = "";
  if (!db.exos.length) {
    p.innerHTML = `
      <div class="session-empty-create">
        <div class="empty">Crée ton premier exercice pour démarrer une séance.</div>
        <div class="row" style="align-items:flex-end">
          <div style="flex:2">
            <label for="session-ex-name">Nom de l'exo</label>
            <input type="text" id="session-ex-name" placeholder="ex. Développé couché">
          </div>
          <div>
            <label for="session-ex-group">Groupe</label>
            <select id="session-ex-group">${GROUPS.map(group => `<option>${esc(group)}</option>`).join("")}</select>
          </div>
          <div>
            <label for="session-ex-type">Type</label>
            <select id="session-ex-type">${TYPES.map(([value, label]) => `<option value="${value}">${esc(label)}</option>`).join("")}</select>
          </div>
          <button type="button" class="btn" id="session-add-ex" style="flex:0 0 auto">Créer</button>
        </div>
      </div>`;
    $("#session-add-ex").onclick = createExerciseFromSession;
    $("#session-ex-name").addEventListener("keydown", e => { if (e.key === "Enter") $("#session-add-ex").click(); });
    $("#start-bar").classList.add("hide");
    return;
  }
  const groups = {};
  db.exos.forEach(e => (groups[e.group] = groups[e.group] || []).push(e));
  Object.keys(groups).sort().forEach(g => {
    groups[g].forEach(e => {
      const div = document.createElement("button");
      div.type = "button";
      div.className = "ex-chip" + (selected.has(e.id) ? " selected" : "");
      div.setAttribute("aria-pressed", String(selected.has(e.id)));
      div.innerHTML = `<div class="name">${esc(e.name)}</div><div class="grp">${esc(e.group)}</div>`;
      div.onclick = () => { selected.has(e.id) ? selected.delete(e.id) : selected.add(e.id); renderPicker(); };
      p.appendChild(div);
    });
  });
  $("#start-bar").classList.toggle("hide", !selected.size);
  $("#start-workout").textContent = `Commencer la séance (${selected.size} exo${selected.size > 1 ? "s" : ""})`;
}

function createExerciseFromSession() {
  const name = $("#session-ex-name").value.trim();
  if (!name) { toast("Donne un nom à l'exo"); return; }
  if (db.exos.some(e => e.name.localeCompare(name, "fr", { sensitivity: "base" }) === 0)) {
    toast("Cet exercice existe déjà"); return;
  }
  const exercise = {
    id: uid(),
    name,
    group: $("#session-ex-group").value,
    type: $("#session-ex-type").value
  };
  db.exos.push(exercise);
  selected.add(exercise.id);
  save();
  renderPicker();
  toast("Exo créé ✓");
}

// Séances types = compositions d'exos déjà faites (dédupliquées, les + récentes d'abord)
function renderQuickStart() {
  const host = $("#quick-list"), card = $("#quick-card");
  const seen = new Set(), templates = [];
  [...db.sessions].reverse().forEach(s => {
    const ids = s.exos.map(e => e.exoId).filter(id => db.exos.some(x => x.id === id));
    if (ids.length < 2) return;
    const key = [...ids].sort().join(",");
    if (seen.has(key)) return;
    seen.add(key); templates.push(ids);
  });
  const top = templates.slice(0, 3);
  card.classList.toggle("hide", !top.length);
  host.innerHTML = "";
  top.forEach(ids => {
    const groups = [...new Set(ids.map(id => (db.exos.find(e => e.id === id) || {}).group))].join(" + ");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "quick-chip";
    btn.innerHTML = `<span class="q-title">▶ ${esc(groups)} · ${ids.length} exos</span><span class="q-sub">${esc(ids.map(exoName).join(", "))}</span>`;
    btn.onclick = () => { selected = new Set(ids); startWorkout(); };
    host.appendChild(btn);
  });
}

function renderResume() {
  const b = $("#resume-banner");
  const d = loadDraft();
  if (!d || workout) { b.classList.add("hide"); return; }
  const done = d.exos.reduce((a, e) => a + e.sets.filter(s => s.done).length, 0);
  b.classList.remove("hide");
  b.innerHTML = `<div><b>Séance en cours</b> · ${d.exos.length} exos · ${done} série${done > 1 ? "s" : ""} validée${done > 1 ? "s" : ""}</div>
    <div style="display:flex;gap:8px">
      <button type="button" class="btn small" id="resume-yes">Reprendre</button>
      <button type="button" class="ghost btn small" id="resume-no">Supprimer</button>
    </div>`;
  $("#resume-yes").onclick = () => { workout = d; showView("workout"); };
  $("#resume-no").onclick = () => { if (confirm("Supprimer la séance en cours ?")) { localStorage.removeItem(DRAFT_KEY); renderResume(); } };
}

// Pré-remplit toutes les séries depuis la dernière fois où l'exo a été fait
function prefillSets(exoId) {
  for (let i = db.sessions.length - 1; i >= 0; i--) {
    const ex = db.sessions[i].exos.find(x => x.exoId === exoId);
    if (ex && ex.sets.length) return ex.sets.map(s => ({ reps: s.reps, weight: s.weight, done: false }));
  }
  return [{ reps: "", weight: "", done: false }];
}

const shortDate = iso => new Date(iso + "T00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

// Rappel de la dernière séance où l'exo a été fait (pour situer sa progression)
function lastTime(exoId, type) {
  for (let i = db.sessions.length - 1; i >= 0; i--) {
    const s = db.sessions[i];
    const ex = s.exos.find(x => x.exoId === exoId);
    if (ex && ex.sets.length) {
      const text = ex.sets.map(t => type === "pdc" ? `${t.reps}` : `${t.reps}×${t.weight}`).join(", ");
      return `Dernière fois · ${shortDate(s.date)} : ${text}`;
    }
  }
  return null;
}

function startWorkout() {
  if (!selected.size) return;
  workout = {
    date: todayISO(),
    exos: [...selected].map(id => ({ exoId: id, sets: prefillSets(id) })),
    cur: { e: 0, s: 0 },
    restEnd: 0
  };
  selected = new Set();
  saveDraft(); showView("workout");
}
$("#start-workout").onclick = startWorkout;

// --- Vue séance guidée ---
function firstUndone(ex) { return ex.sets.findIndex(s => !s.done); }
function nextTarget(fromE) {   // prochaine série non faite, en partant de l'exo fromE
  const n = workout.exos.length;
  for (let k = 0; k < n; k++) {
    const i = (fromE + k) % n;
    const s = firstUndone(workout.exos[i]);
    if (s !== -1) return { e: i, s };
  }
  return null;
}

function renderWorkout() {
  const w = workout; if (!w) { showView("select"); return; }
  const { e, s } = w.cur;
  const ex = w.exos[e];
  const exo = db.exos.find(x => x.id === ex.exoId) || { name: "Exo supprimé", group: "?", type: "charge" };
  const isPdc = exo.type === "pdc";
  const isAssistance = exo.type === "assistance";

  const totalSets = w.exos.reduce((a, x) => a + x.sets.length, 0);
  const doneSets = w.exos.reduce((a, x) => a + x.sets.filter(t => t.done).length, 0);
  $("#wk-bar").style.width = (totalSets ? doneSets / totalSets * 100 : 0) + "%";
  $("#wk-count").textContent = `${doneSets}/${totalSets}`;
  const progress = $(".wk-progress");
  progress.setAttribute("aria-valuemax", String(totalSets));
  progress.setAttribute("aria-valuenow", String(doneSets));
  progress.setAttribute("aria-valuetext", `${doneSets} séries terminées sur ${totalSets}`);

  $("#wk-group").textContent = exo.group;
  $("#wk-exo-name").textContent = exo.name;
  const last = lastTime(ex.exoId, exo.type);
  $("#wk-last").textContent = last || "";
  $("#wk-last").classList.toggle("hide", !last);
  $("#wk-set-label").textContent = `Série ${s + 1} sur ${ex.sets.length}`;

  // chips des séries (tape une série validée pour la corriger)
  $("#wk-done").innerHTML = ex.sets.map((t, i) => {
    const cls = i === s ? "cur" : (t.done ? "ok" : "");
    const txt = t.done ? (isPdc ? `${t.reps}` : `${t.reps}×${t.weight}${isAssistance ? " aide" : ""}`) : (i + 1);
    return `<button type="button" class="set-chip ${cls}" data-i="${i}" ${i === s ? 'aria-current="step"' : ""}>${t.done ? "✓ " : ""}${esc(txt)}</button>`;
  }).join("");
  $$("#wk-done .set-chip").forEach(c => c.onclick = () => { w.cur.s = +c.dataset.i; saveDraft(); renderWorkout(); });

  const cu = ex.sets[s];
  $("#wk-reps").value = cu.reps;
  $("#wk-weight").value = cu.weight;
  $("#wk-weight-st").classList.toggle("hide", isPdc);
  $("#wk-weight-st .unit").textContent = isAssistance ? "kg aide" : "kg";
  $("#wk-weight").setAttribute("aria-label", isAssistance ? "Assistance en kilogrammes" : "Poids en kilogrammes");
  $("#w-minus").setAttribute("aria-label", isAssistance ? "réduire l'assistance de 2.5 kg" : "moins 2.5 kg");
  $("#w-plus").setAttribute("aria-label", isAssistance ? "augmenter l'assistance de 2.5 kg" : "plus 2.5 kg");

  // nav entre exos
  $("#wk-exo-nav").innerHTML = w.exos.map((x, i) => {
    const allDone = x.sets.length && x.sets.every(t => t.done);
    const cls = i === e ? "cur" : (allDone ? "ok" : "");
    return `<button type="button" class="exo-nav-chip ${cls}" data-i="${i}" ${i === e ? 'aria-current="step"' : ""}>${allDone ? "✓ " : ""}${esc(exoName(x.exoId))}</button>`;
  }).join("");
  $$("#wk-exo-nav .exo-nav-chip").forEach(c => c.onclick = () => {
    const i = +c.dataset.i, f = firstUndone(w.exos[i]);
    w.cur = { e: i, s: f === -1 ? w.exos[i].sets.length - 1 : f };
    saveDraft(); renderWorkout();
  });

  renderRest();
}

// steppers
function syncCur() {
  if (!workout) return;
  const { e, s } = workout.cur, st = workout.exos[e].sets[s];
  st.reps = $("#wk-reps").value;
  st.weight = $("#wk-weight").value;
  saveDraft();
}
function stepInput(sel, delta) {
  const el = $(sel);
  el.value = Math.max(0, Math.round(((+el.value || 0) + delta) * 10) / 10);
  syncCur();
}

// Appui maintenu = répétition qui accélère ; le clic clavier (Entrée/Espace) reste géré.
function holdRepeat(el, step) {
  let slowTimer, fastTimer, viaPointer = false;
  const stop = () => { clearTimeout(slowTimer); clearInterval(fastTimer); };
  el.addEventListener("pointerdown", e => {
    e.preventDefault();
    viaPointer = true;
    step();
    let delay = 120;
    slowTimer = setTimeout(function run() {
      step();
      delay = Math.max(45, delay - 6);
      fastTimer = setTimeout(run, delay);
    }, 420);
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach(ev => el.addEventListener(ev, stop));
  el.addEventListener("click", () => { if (viaPointer) { viaPointer = false; return; } step(); });
}
holdRepeat($("#reps-minus"), () => stepInput("#wk-reps", -1));
holdRepeat($("#reps-plus"), () => stepInput("#wk-reps", +1));
holdRepeat($("#w-minus"), () => stepInput("#wk-weight", -2.5));
holdRepeat($("#w-plus"), () => stepInput("#wk-weight", +2.5));
$("#wk-reps").oninput = syncCur;
$("#wk-weight").oninput = syncCur;

$("#wk-validate").onclick = () => {
  const w = workout, { e, s } = w.cur;
  const ex = w.exos[e];
  const exo = db.exos.find(x => x.id === ex.exoId) || {};
  const reps = +$("#wk-reps").value || 0;
  if (reps <= 0) { toast("Indique tes reps 💪"); return; }
  const weight = exo.type === "pdc" ? 0 : (+$("#wk-weight").value || 0);
  ex.sets[s] = { reps, weight, done: true };
  const nxt = nextTarget(e);
  if (!nxt) { w.restEnd = 0; saveDraft(); showView("summary"); return; }
  w.cur = nxt;
  startRest();
  saveDraft(); renderWorkout();
};

$("#wk-add-set").onclick = () => {
  const ex = workout.exos[workout.cur.e];
  if (ex.sets.length >= 100) { toast("Limite de 100 séries par exo"); return; }
  const last = ex.sets[ex.sets.length - 1] || { reps: "", weight: "" };
  ex.sets.push({ reps: last.reps, weight: last.weight, done: false });
  saveDraft(); renderWorkout();
};

$("#wk-skip").onclick = () => {   // passe à l'exo suivant qui a des séries restantes
  const w = workout, n = w.exos.length;
  for (let k = 1; k < n; k++) {
    const i = (w.cur.e + k) % n;
    const f = firstUndone(w.exos[i]);
    if (f !== -1) { w.cur = { e: i, s: f }; saveDraft(); renderWorkout(); return; }
  }
  showView("summary");            // plus rien ailleurs → résumé
};

$("#wk-finish").onclick = () => showView("summary");
$("#wk-quit").onclick = () => {
  if (confirm("Abandonner la séance ? (rien ne sera enregistré)")) {
    workout = null; saveDraft(); showView("select");
  }
};

// ajout d'exo en pleine séance
$("#wk-add-exo").onclick = () => {
  const host = $("#sheet-grid"); host.innerHTML = "";
  const inW = new Set(workout.exos.map(x => x.exoId));
  db.exos.filter(e => !inW.has(e.id)).forEach(e => {
    const d = document.createElement("button");
    d.type = "button";
    d.className = "ex-chip";
    d.innerHTML = `<div class="name">${esc(e.name)}</div><div class="grp">${esc(e.group)}</div>`;
    d.onclick = () => {
      workout.exos.push({ exoId: e.id, sets: prefillSets(e.id) });
      workout.cur = { e: workout.exos.length - 1, s: 0 };
      closeSheet();
      saveDraft(); renderWorkout();
    };
    host.appendChild(d);
  });
  if (!host.children.length) host.innerHTML = `<div class="empty">Tous les exercices sont déjà dans la séance.</div>`;
  openSheet();
};
let sheetReturnFocus = null;
function openSheet() {
  sheetReturnFocus = document.activeElement;
  $("#sheet").classList.remove("hide");
  $("#sheet-close").focus();
}
function closeSheet() {
  $("#sheet").classList.add("hide");
  if (sheetReturnFocus instanceof HTMLElement) sheetReturnFocus.focus();
}
$("#sheet-close").onclick = closeSheet;
$("#sheet").addEventListener("click", e => { if (e.target === $("#sheet")) closeSheet(); });
document.addEventListener("keydown", e => {
  if ($("#sheet").classList.contains("hide")) return;
  if (e.key === "Escape") { closeSheet(); return; }
  if (e.key !== "Tab") return;
  const controls = [...$("#sheet").querySelectorAll("button:not([disabled])")];
  if (!controls.length) return;
  const current = controls.indexOf(document.activeElement);
  e.preventDefault();
  controls[(current + (e.shiftKey ? -1 : 1) + controls.length) % controls.length].focus();
});

// --- Timer de repos ---
function restDur() { const v = localStorage.getItem("muscu_rest"); return v === null ? 90 : +v; }
function startRest() {
  const d = restDur();
  workout.restEnd = d ? Date.now() + d * 1000 : 0;
}
function renderRest() {
  clearInterval(restTimer);
  const el = $("#rest-banner");
  const tick = () => {
    if (!workout || !workout.restEnd || Date.now() >= workout.restEnd) {
      if (workout && workout.restEnd && Date.now() >= workout.restEnd) {
        workout.restEnd = 0; saveDraft();
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      }
      el.classList.add("hide"); clearInterval(restTimer); return;
    }
    const left = Math.ceil((workout.restEnd - Date.now()) / 1000);
    $("#rest-time").textContent = Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0");
    el.classList.remove("hide");
  };
  tick();
  restTimer = setInterval(tick, 250);
}
$("#rest-skip").onclick = () => { workout.restEnd = 0; saveDraft(); renderRest(); };
$("#rest-dur").onchange = e => {
  localStorage.setItem("muscu_rest", e.target.value);
  if (+e.target.value === 0 && workout) { workout.restEnd = 0; saveDraft(); renderRest(); }
};

// --- Vue résumé ---
function renderSummary() {
  const w = workout; if (!w) { showView("select"); return; }
  let vol = 0, sets = 0;
  const rows = w.exos.map(x => {
    const done = x.sets.filter(t => t.done && t.reps > 0);
    if (!done.length) return "";
    const exo = db.exos.find(z => z.id === x.exoId) || {};
    done.forEach(t => { vol += t.reps * (+t.weight || 0); sets++; });
    const str = done.map(t => exo.type === "pdc"
      ? `${t.reps} reps`
      : exo.type === "assistance" ? `${t.reps} reps à ${t.weight}kg d'aide` : `${t.reps}×${t.weight}kg`).join(", ");
    return `<div class="hist-ex" style="padding:8px 0"><b>${esc(exo.name || "?")}</b> — ${esc(str)}</div>`;
  }).join("");
  $("#sum-kpis").innerHTML = stat(sets, "Séries validées") + stat(Math.round(vol).toLocaleString("fr-FR"), "Volume (kg)");
  $("#sum-list").innerHTML = rows || `<div class="empty">Aucune série validée.</div>`;
  $("#sum-date").value = w.date;
}
$("#sum-back").onclick = () => showView("workout");
$("#sum-abandon").onclick = () => {
  if (confirm("Ne rien enregistrer et supprimer cette séance ?")) { workout = null; saveDraft(); showView("select"); }
};
$("#sum-save").onclick = () => {
  const w = workout;
  const exos = w.exos.map(x => ({
    exoId: x.exoId,
    sets: x.sets.filter(t => t.done && t.reps > 0).map(t => ({ reps: +t.reps, weight: +t.weight || 0 }))
  })).filter(x => x.sets.length);
  if (!exos.length) { toast("Aucune série validée 💪"); return; }
  db.sessions.push({ id: uid(), date: $("#sum-date").value || todayISO(), exos });
  db.sessions.sort((a, b) => a.date.localeCompare(b.date));
  save();
  workout = null; saveDraft();
  showView("select");
  toast("Séance enregistrée ✓");
};

// au chargement : reprend direct une séance du jour non terminée
export function initSessionView() {
  const d = loadDraft();
  if (d && d.date === todayISO()) { workout = d; showView("workout"); }
  else showView("select");
}

// état initial des contrôles de l'onglet
$("#rest-dur").value = String(restDur());
