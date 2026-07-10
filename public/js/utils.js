// Petits helpers DOM + formatage, sans état.

export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];

export function todayISO() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function uid() {
  return globalThis.crypto?.randomUUID?.() || "x" + Math.random().toString(36).slice(2, 11);
}

export function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

export function fmtDate(iso) {
  const d = new Date(iso + "T00:00");
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export function stat(v, l) {
  return `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`;
}

let toastT;
export function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2200);
}
