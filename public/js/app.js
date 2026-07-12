// Point d'entrée : câblage global (tabs, pill de sync, fix date-picker)
// puis chargement des données et affichage de la vue Séance.

import { $, $$ } from "./utils.js";
import { clearPassword, hasPassword, loadData, retrySync, setStatusListener, setPassword } from "./store.js";
import { initSessionView } from "./workout.js";
import { renderDashboard } from "./dashboard.js";
import { renderExoList } from "./exercises.js";

// indicateur de sync dans le header + écran de connexion si le serveur exige un mot de passe
let wasAuth = false;   // un 401 a déjà eu lieu → le prochain 401 = mot de passe incorrect
setStatusListener(state => {
  if (state === "auth") {
    $("#login").classList.remove("hide");
    $("#login-err").classList.toggle("hide", !wasAuth);
    wasAuth = true;
    $("#login-pw").focus();
    return;
  }
  const el = $("#sync-pill"); if (!el) return;
  const map = {
    load: "⏳ chargement…",
    ok: "✓ synchronisé",
    saving: "↻ sauvegarde…",
    offline: "⚠️ hors-ligne",
    conflict: "⚠️ conflit à résoudre",
    storage: "⚠️ stockage indisponible",
    rejected: "⚠️ données refusées"
  };
  el.textContent = map[state] || "";
  el.className = "file-pill" + (["offline", "conflict", "storage", "rejected"].includes(state) ? " warn" : "");
  el.title = ["offline", "conflict"].includes(state) ? "Réessayer la synchronisation" : "";
  el.setAttribute("aria-label", `État de la synchronisation : ${map[state] || state}`);
});

$("#sync-pill").addEventListener("click", () => retrySync());

async function submitLogin() {
  const pw = $("#login-pw").value.trim();
  if (!pw) return;
  setPassword(pw);
  $("#logout-btn").classList.remove("hide");
  $("#login").classList.add("hide");
  await loadData();               // re-tente ; un nouveau 401 rouvrira l'écran avec l'erreur
  initSessionView();
}
$("#login-go").onclick = submitLogin;
$("#login-pw").addEventListener("keydown", e => { if (e.key === "Enter") submitLogin(); });
$("#logout-btn").classList.toggle("hide", !hasPassword());
$("#logout-btn").onclick = () => { clearPassword(); location.reload(); };

// tabs — la nav du haut (desktop) et la tabbar du bas (mobile) restent synchronisées
const tabButtons = $$("[data-tab]");
tabButtons.forEach(b => b.onclick = () => {
  tabButtons.forEach(x => {
    const active = x.dataset.tab === b.dataset.tab;
    x.classList.toggle("active", active);
    x.setAttribute("aria-selected", String(active));
  });
  ["session", "dashboard", "exos"].forEach(t => {
    const panel = $("#tab-" + t), hidden = t !== b.dataset.tab;
    panel.classList.toggle("hide", hidden);
    panel.hidden = hidden;
  });
  if (b.dataset.tab === "dashboard") renderDashboard();
  if (b.dataset.tab === "exos") renderExoList();
  window.scrollTo({ top: 0 });
});

$$('[role="tablist"]').forEach(nav => nav.addEventListener("keydown", e => {
  if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
  const tabs = [...nav.querySelectorAll('[role="tab"]')];
  const current = tabs.indexOf(document.activeElement);
  if (current < 0) return;
  e.preventDefault();
  const direction = e.key === "ArrowRight" ? 1 : -1;
  const next = tabs[(current + direction + tabs.length) % tabs.length];
  next.focus(); next.click();
}));

$("#login").addEventListener("keydown", e => {
  if (e.key !== "Tab") return;
  const controls = [$("#login-pw"), $("#login-go")];
  const current = controls.indexOf(document.activeElement);
  e.preventDefault();
  controls[(current + (e.shiftKey ? -1 : 1) + controls.length) % controls.length].focus();
});

// Date inputs : le picker natif s'ouvrait puis se refermait aussitôt
// (course mousedown/click qui re-toggle le popup). On désactive le toggle
// natif et on ouvre nous-mêmes le picker, une seule fois, au clic.
$$('input[type="date"]').forEach(inp => {
  inp.addEventListener("mousedown", e => e.preventDefault());
  inp.addEventListener("click", () => {
    inp.focus({ preventScroll: true });
    try { inp.showPicker(); } catch (_) {}
  });
});

// init
await loadData();
initSessionView();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
