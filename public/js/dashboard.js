// Onglet Progression : KPIs, courbe par exo, graphe comparatif,
// records perso, historique et export JSON.

import { $, esc, fmtDate, todayISO, stat, toast } from "./utils.js";
import { db, save, serialize } from "./store.js";
import { exoName, exoType, est1rm, sessVolume, seriesFor } from "./metrics.js";

let selectedMultiExercises = null;

export function renderDashboard() {
  // KPIs
  const totalSessions = db.sessions.length;
  let totalVol = 0, totalSets = 0;
  db.sessions.forEach(s => s.exos.forEach(ex => { totalVol += sessVolume(ex); totalSets += ex.sets.length; }));
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const last30 = db.sessions.filter(s => {
    const age = today - new Date(`${s.date}T00:00:00`);
    return age >= 0 && age < 30 * 864e5;
  }).length;
  $("#kpis").innerHTML = `
    ${stat(totalSessions, "Séances totales")}
    ${stat(last30, "Séances (30 j)")}
    ${stat(Math.round(totalVol).toLocaleString("fr-FR"), "Volume total (kg)")}
    ${stat(totalSets, "Séries totales")}`;

  // sélecteur d'exo — seulement ceux qui ont des données
  const exoIds = [...new Set(db.sessions.flatMap(s => s.exos.map(e => e.exoId)))];
  const sel = $("#chart-ex"); const prev = sel.value;
  sel.innerHTML = exoIds.map(id => `<option value="${esc(id)}">${esc(exoName(id))}</option>`).join("");
  if (exoIds.includes(prev)) sel.value = prev;
  sel.onchange = () => { syncMetricOptions(); drawChart(); };
  $("#chart-metric").onchange = drawChart;
  syncMetricOptions();
  drawChart();
  $("#multi-metric").onchange = drawMultiChart;
  $("#multi-mode").onchange = drawMultiChart;
  drawMultiChart();
  renderPRs(); renderHistory();
}

// Les métriques dépendent du type de l'exo sélectionné
function syncMetricOptions() {
  const sel = $("#chart-metric"); const prev = sel.value;
  const type = exoType($("#chart-ex").value);
  sel.innerHTML = type === "pdc"
    ? `<option value="maxReps">Reps max</option><option value="volumeReps">Reps totales</option>`
    : type === "assistance"
      ? `<option value="minWeight">Assistance min</option><option value="maxReps">Reps max</option><option value="volumeReps">Reps totales</option>`
    : `<option value="maxWeight">Poids max</option><option value="volume">Volume total</option><option value="est1rm">1RM estimé</option>`;
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
}

function drawChart() {
  const exoId = $("#chart-ex").value;
  const metric = $("#chart-metric").value;
  const host = $("#chart");
  if (!exoId) { host.innerHTML = `<div class="empty"><div class="big">📊</div>Pas encore de données. Enregistre une séance !</div>`; return; }
  const pts = seriesFor(exoId, metric);
  if (pts.length < 1) { host.innerHTML = `<div class="empty">Pas de données pour cet exo.</div>`; return; }

  // s'adapte à la largeur dispo (téléphone) avec un plancher de lisibilité
  const W = Math.max(320, host.clientWidth || 620), H = 280, pad = { t: 20, r: 20, b: 34, l: 46 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const vals = pts.map(p => p.v);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min = Math.max(0, min - 5); max = max + 5; }
  const pen = max - min; min = Math.max(0, min - pen * 0.1); max = max + pen * 0.1;
  const n = pts.length;
  const x = i => pad.l + (n === 1 ? iw / 2 : iw * i / (n - 1));
  const y = v => pad.t + ih - ih * (v - min) / (max - min);

  let grid = "", labels = "";
  for (let i = 0; i <= 4; i++) {
    const gy = pad.t + ih * i / 4;
    const gv = max - (max - min) * i / 4;
    grid += `<line x1="${pad.l}" y1="${gy}" x2="${W - pad.r}" y2="${gy}" stroke="#2b303b" stroke-width="1"/>`;
    labels += `<text x="${pad.l - 8}" y="${gy + 4}" text-anchor="end">${Math.round(gv)}</text>`;
  }
  // labels x (adaptés à la largeur)
  let xlab = "";
  const step = Math.ceil(n / (W < 480 ? 4 : 6));
  pts.forEach((p, i) => { if (i % step === 0 || i === n - 1) { const d = p.date.slice(5).replace("-", "/"); xlab += `<text x="${x(i)}" y="${H - 12}" text-anchor="middle">${d}</text>`; } });

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const area = `M${x(0)},${pad.t + ih} ` + pts.map((p, i) => `L${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ") + ` L${x(n - 1)},${pad.t + ih} Z`;
  const dots = pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.v)}" r="4" fill="#ff5a36" stroke="#0f1115" stroke-width="2"><title>${p.date} — ${p.v}</title></circle>`).join("");
  const labelMetric = { maxWeight: "kg", minWeight: "kg d'assistance", volume: "kg vol.", est1rm: "kg (1RM)", maxReps: "reps", volumeReps: "reps tot." }[metric] || "";
  const chartLabel = `${exoName(exoId)}, évolution de ${$("#chart-metric").selectedOptions[0]?.textContent || metric}`;

  host.innerHTML = `<svg role="img" aria-label="${esc(chartLabel)}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <title>${esc(chartLabel)}</title>
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ff5a36" stop-opacity=".25"/><stop offset="100%" stop-color="#ff5a36" stop-opacity="0"/>
    </linearGradient></defs>
    ${grid}${labels}${xlab}
    <path d="${area}" fill="url(#g)"/>
    <path d="${line}" fill="none" stroke="#ff5a36" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
    <text x="${pad.l}" y="14" fill="#9aa3b2">${labelMetric}</text>
  </svg>`;
}

// Graphe comparatif : toutes les courbes (exos en charge) superposées, une couleur par exo
const PALETTE = ["#ff5a36", "#36d399", "#3b82f6", "#f59e0b", "#a855f7", "#ec4899", "#14b8a6", "#eab308", "#8b5cf6", "#ef4444", "#22c55e", "#0ea5e9", "#fb7185"];
function drawMultiChart() {
  const metric = $("#multi-metric").value;
  const mode = $("#multi-mode").value;
  const host = $("#multi-chart");
  const exoIds = [...new Set(db.sessions.flatMap(s => s.exos.map(e => e.exoId)))].filter(id => exoType(id) === "charge");
  if (selectedMultiExercises === null) selectedMultiExercises = new Set(exoIds.slice(0, 4));
  selectedMultiExercises = new Set([...selectedMultiExercises].filter(id => exoIds.includes(id)));
  if (!selectedMultiExercises.size && exoIds.length) selectedMultiExercises.add(exoIds[0]);
  let series = exoIds
    .filter(id => selectedMultiExercises.has(id))
    .map(id => ({ id, name: exoName(id), color: PALETTE[exoIds.indexOf(id) % PALETTE.length], pts: seriesFor(id, metric) }))
    .filter(s => s.pts.length);
  if (!series.length) { host.innerHTML = `<div class="empty">Pas de données.</div>`; $("#multi-legend").innerHTML = ""; return; }
  if (mode === "base100") series = series.map(s => { const base = s.pts[0].v || 1; return { ...s, pts: s.pts.map(p => ({ date: p.date, v: Math.round(p.v / base * 1000) / 10 })) }; });

  const allT = series.flatMap(s => s.pts.map(p => +new Date(p.date)));
  let tmin = Math.min(...allT), tmax = Math.max(...allT); if (tmin === tmax) tmax = tmin + 864e5;
  const allV = series.flatMap(s => s.pts.map(p => p.v));
  let min = Math.min(...allV), max = Math.max(...allV); if (min === max) { min -= 1; max += 1; }
  const pen = max - min; min = Math.max(0, min - pen * 0.08); max = max + pen * 0.08;

  const W = Math.max(320, host.clientWidth || 640), H = 300, pad = { t: 18, r: 16, b: 34, l: 46 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const x = t => pad.l + iw * (t - tmin) / (tmax - tmin);
  const y = v => pad.t + ih - ih * (v - min) / (max - min);

  let grid = "", ylab = "";
  for (let i = 0; i <= 4; i++) {
    const gy = pad.t + ih * i / 4, gv = max - (max - min) * i / 4;
    grid += `<line x1="${pad.l}" y1="${gy}" x2="${W - pad.r}" y2="${gy}" stroke="#2b303b"/>`;
    ylab += `<text x="${pad.l - 8}" y="${gy + 4}" text-anchor="end">${Math.round(gv)}</text>`;
  }
  const uniq = [...new Set(series.flatMap(s => s.pts.map(p => p.date)))].sort();
  let xlab = ""; const step = Math.ceil(uniq.length / (W < 480 ? 4 : 6));
  uniq.forEach((d, i) => { if (i % step === 0 || i === uniq.length - 1) xlab += `<text x="${x(+new Date(d))}" y="${H - 12}" text-anchor="middle">${d.slice(5).replace("-", "/")}</text>`; });
  let ref = "";
  if (mode === "base100" && 100 >= min && 100 <= max) ref = `<line x1="${pad.l}" y1="${y(100)}" x2="${W - pad.r}" y2="${y(100)}" stroke="#9aa3b2" stroke-dasharray="3 3" stroke-width="1" opacity=".4"/>`;

  let lines = "";
  series.forEach(s => {
    const c = s.color;
    const path = s.pts.map((p, i) => `${i ? 'L' : 'M'}${x(+new Date(p.date)).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
    lines += `<path d="${path}" fill="none" stroke="${c}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
    lines += s.pts.map(p => `<circle cx="${x(+new Date(p.date))}" cy="${y(p.v)}" r="3.2" fill="${c}" stroke="#0f1115" stroke-width="1.5"><title>${esc(s.name)} — ${p.date} — ${p.v}</title></circle>`).join("");
  });
  const unit = mode === "base100" ? "base 100" : { maxWeight: "kg", est1rm: "kg (1RM)", volume: "kg vol." }[metric];
  const multiLabel = `Comparaison de ${series.map(s => s.name).join(", ")}, ${unit}`;
  host.innerHTML = `<svg role="img" aria-label="${esc(multiLabel)}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><title>${esc(multiLabel)}</title>${grid}${ref}${ylab}${xlab}${lines}<text x="${pad.l}" y="13" fill="#9aa3b2">${unit}</text></svg>`;
  renderMultiLegend(exoIds);
}

function renderMultiLegend(exoIds) {
  const legend = $("#multi-legend"); legend.innerHTML = "";
  exoIds.forEach((id, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "item" + (selectedMultiExercises.has(id) ? " active" : "");
    button.setAttribute("aria-pressed", String(selectedMultiExercises.has(id)));
    const swatch = document.createElement("span");
    swatch.className = "swatch"; swatch.style.background = PALETTE[index % PALETTE.length];
    button.append(swatch, document.createTextNode(exoName(id)));
    button.onclick = () => {
      if (selectedMultiExercises.has(id) && selectedMultiExercises.size > 1) selectedMultiExercises.delete(id);
      else selectedMultiExercises.add(id);
      drawMultiChart();
    };
    legend.appendChild(button);
  });
}

function renderPRs() {
  const exoIds = [...new Set(db.sessions.flatMap(s => s.exos.map(e => e.exoId)))];
  if (!exoIds.length) { $("#prs").innerHTML = `<div class="empty">Aucun record pour le moment.</div>`; return; }
  const rows = exoIds.map(id => {
    let maxW = 0, minW = Infinity, maxVol = 0, best1rm = 0, maxReps = 0;
    db.sessions.forEach(s => s.exos.filter(x => x.exoId === id).forEach(ex => {
      ex.sets.forEach(st => { maxW = Math.max(maxW, st.weight); minW = Math.min(minW, st.weight); best1rm = Math.max(best1rm, est1rm(st)); maxReps = Math.max(maxReps, st.reps); });
      maxVol = Math.max(maxVol, sessVolume(ex));
    }));
    const type = exoType(id);
    return { name: exoName(id), type, maxW, minW: Number.isFinite(minW) ? minW : 0, maxVol, best1rm: Math.round(best1rm), maxReps };
  }).sort((a, b) => {
    const score = item => item.type === "pdc" ? item.maxReps : item.type === "assistance" ? -item.minW : item.best1rm;
    return score(b) - score(a);
  });
  $("#prs").innerHTML = rows.map(r => `
    <div class="flex-between" style="padding:10px 0;border-bottom:1px solid var(--border)">
      <span style="font-weight:600">${esc(r.name)}</span>
      <span style="color:var(--muted);font-size:13px">${r.type === "pdc"
        ? `<b style="color:var(--text)">${r.maxReps} reps</b> max`
        : r.type === "assistance"
          ? `<b style="color:var(--text)">${r.minW} kg</b> d'assistance min · <b style="color:var(--text)">${r.maxReps} reps</b> max`
        : `<b style="color:var(--text)">${r.maxW} kg</b> max ·
           <b style="color:var(--text)">${r.best1rm} kg</b> 1RM ·
           <b style="color:var(--text)">${Math.round(r.maxVol)}</b> vol.`}
      </span>
    </div>`).join("");
}

function renderHistory() {
  const h = $("#history");
  if (!db.sessions.length) { h.innerHTML = `<div class="empty"><div class="big">🏋️</div>Aucune séance enregistrée.<br>Va dans l'onglet « Séance » pour démarrer !</div>`; return; }
  h.innerHTML = [...db.sessions].reverse().map(s => `
    <div class="hist-item">
      <div class="hist-head">
        <span class="hist-date">${fmtDate(s.date)}</span>
        <div class="history-actions">
          <button type="button" class="ghost btn small" data-edit="${esc(s.id)}" aria-label="Modifier la séance du ${esc(fmtDate(s.date))}">Modifier</button>
          <button type="button" class="del" data-del="${esc(s.id)}" aria-label="Supprimer la séance du ${esc(fmtDate(s.date))}">✕</button>
        </div>
      </div>
      ${s.exos.map(ex => { const type = exoType(ex.exoId); const values = ex.sets.map(st => type === "pdc" ? `${st.reps} reps` : type === "assistance" ? `${st.reps} reps à ${st.weight}kg d'aide` : `${st.reps}×${st.weight}kg`).join(", "); return `<div class="hist-ex"><b>${esc(exoName(ex.exoId))}</b> — ${esc(values)}</div>`; }).join("")}
    </div>`).join("");
  h.querySelectorAll("[data-del]").forEach(b => b.onclick = () => {
    if (!confirm("Supprimer cette séance ?")) return;
    db.sessions = db.sessions.filter(s => s.id !== b.dataset.del);
    save(); renderDashboard();
  });
  h.querySelectorAll("[data-edit]").forEach(button => button.onclick = () => {
    const session = db.sessions.find(item => item.id === button.dataset.edit);
    if (session) editSession(session, button.closest(".hist-item"));
  });
}

function editSession(session, host) {
  host.innerHTML = "";
  const editor = document.createElement("div"); editor.className = "session-editor";
  const dateLabel = document.createElement("label"); dateLabel.textContent = "Date";
  const date = document.createElement("input"); date.type = "date"; date.value = session.date;
  dateLabel.appendChild(date); editor.appendChild(dateLabel);

  const inputs = [];
  session.exos.forEach(exercise => {
    const fieldset = document.createElement("fieldset");
    const legend = document.createElement("legend"); legend.textContent = exoName(exercise.exoId);
    fieldset.appendChild(legend);
    exercise.sets.forEach((item, index) => {
      const row = document.createElement("div"); row.className = "session-set-row";
      const label = document.createElement("span"); label.textContent = `Série ${index + 1}`;
      const reps = document.createElement("input");
      reps.type = "number"; reps.min = "0.01"; reps.step = "1"; reps.value = item.reps;
      reps.setAttribute("aria-label", `${exoName(exercise.exoId)}, série ${index + 1}, répétitions`);
      row.append(label, reps);
      let weight = null;
      if (exoType(exercise.exoId) !== "pdc") {
        weight = document.createElement("input");
        weight.type = "number"; weight.min = "0"; weight.step = "0.5"; weight.value = item.weight;
        weight.setAttribute("aria-label", `${exoName(exercise.exoId)}, série ${index + 1}, kilogrammes`);
        row.appendChild(weight);
      }
      inputs.push({ item, reps, weight }); fieldset.appendChild(row);
    });
    editor.appendChild(fieldset);
  });

  const actions = document.createElement("div"); actions.className = "edit-actions";
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "ghost btn"; cancel.textContent = "Annuler";
  const submit = document.createElement("button"); submit.type = "button"; submit.className = "btn"; submit.textContent = "Enregistrer";
  cancel.onclick = renderHistory;
  submit.onclick = () => {
    if (!date.value || inputs.some(input => !(+input.reps.value > 0) || (input.weight && +input.weight.value < 0))) {
      toast("Vérifie les valeurs de la séance"); return;
    }
    session.date = date.value;
    inputs.forEach(input => { input.item.reps = +input.reps.value; input.item.weight = input.weight ? +input.weight.value : 0; });
    db.sessions.sort((a, b) => a.date.localeCompare(b.date));
    save(); renderDashboard();
  };
  actions.append(cancel, submit); editor.appendChild(actions); host.appendChild(editor); date.focus();
}

$("#export-btn").onclick = () => {
  const blob = new Blob([serialize()], { type: "application/json" });
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url; a.download = "muscu-data-" + todayISO() + ".json"; a.click();
  URL.revokeObjectURL(url);
};

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!$("#tab-dashboard").classList.contains("hide")) { drawChart(); drawMultiChart(); }
  }, 120);
});
