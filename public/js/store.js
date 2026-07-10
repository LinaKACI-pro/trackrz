// Store serveur + cache local résilient.
// Une copie "base" représente la dernière version confirmée par le serveur ;
// "pending" contient les changements locaux tant qu'ils ne sont pas confirmés.

export let db = { exos: [], sessions: [] };

const CACHE_KEY = "muscu_cache";
const BASE_KEY = "muscu_base";
const PENDING_KEY = "muscu_pending";
const REV_KEY = "muscu_revision";
const PW_KEY = "muscu_pw";
const TYPES = new Set(["charge", "pdc", "assistance"]);

let dirty = Boolean(localStorage.getItem(PENDING_KEY));
let serverRevision = localStorage.getItem(REV_KEY) || '"0"';
let statusListener = () => {};
let saveT;
let pushPromise = null;

export function setStatusListener(fn) { statusListener = fn; }

function normalize(json) {
  return {
    exos: Array.isArray(json?.exercises) ? json.exercises.map(e => ({
      id: e.id,
      name: e.name,
      group: e.group || "Autre",
      type: TYPES.has(e.type) ? e.type : "charge"
    })) : [],
    sessions: Array.isArray(json?.sessions) ? json.sessions : []
  };
}

function documentFrom(state = db) {
  return { version: 1, exercises: state.exos, sessions: state.sessions };
}

export function serialize() {
  return JSON.stringify(documentFrom(), null, 2);
}

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch (_) { return null; }
}

function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch (_) { statusListener("storage"); return false; }
}

function readPending() {
  const value = readJson(PENDING_KEY);
  return value && value.data && typeof value.baseRevision === "string" ? value : null;
}

function authHeaders() {
  const pw = localStorage.getItem(PW_KEY);
  return pw ? { "Authorization": "Bearer " + pw } : {};
}

export function setPassword(pw) { localStorage.setItem(PW_KEY, pw); }
export function clearPassword() { localStorage.removeItem(PW_KEY); }
export function hasPassword() { return Boolean(localStorage.getItem(PW_KEY)); }

function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function mergeCollection(base, local, remote) {
  const baseById = new Map(base.map(x => [x.id, x]));
  const localById = new Map(local.map(x => [x.id, x]));
  const remoteById = new Map(remote.map(x => [x.id, x]));
  const ids = [...new Set([...remote.map(x => x.id), ...local.map(x => x.id), ...base.map(x => x.id)])];
  const merged = [];

  ids.forEach(id => {
    const before = baseById.get(id), here = localById.get(id), there = remoteById.get(id);
    let chosen;
    if (before === undefined) chosen = here === undefined ? there : here;
    else if (here === undefined) chosen = same(there, before) ? undefined : there;
    else if (there === undefined) chosen = same(here, before) ? undefined : here;
    else if (same(here, before)) chosen = there;
    else if (same(there, before) || same(here, there)) chosen = here;
    else chosen = here; // même élément modifié des deux côtés : la version locale gagne
    if (chosen !== undefined) merged.push(chosen);
  });
  return merged;
}

function mergeDocuments(base, local, remote) {
  const merged = {
    version: 1,
    exercises: mergeCollection(base.exercises || [], local.exercises || [], remote.exercises || []),
    sessions: mergeCollection(base.sessions || [], local.sessions || [], remote.sessions || [])
  };
  merged.sessions.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return merged;
}

function rememberServerState(data, revision) {
  const document = documentFrom(normalize(data));
  serverRevision = revision || serverRevision;
  localStorage.setItem(REV_KEY, serverRevision);
  writeJson(BASE_KEY, document);
  writeJson(CACHE_KEY, document);
  return document;
}

export async function loadData() {
  const pending = readPending();
  if (pending) {
    db = normalize(pending.data);
    dirty = true;
    writeJson(CACHE_KEY, pending.data);
    await pushData();
    return;
  }

  statusListener("load");
  try {
    const response = await fetch("/api/data", { cache: "no-store", headers: authHeaders() });
    if (response.status === 401) { statusListener("auth"); return; }
    if (!response.ok) throw new Error("load failed");
    const raw = await response.json();
    db = normalize(raw);
    rememberServerState(raw, response.headers.get("ETag") || '"0"');
    dirty = false;
    localStorage.removeItem(PENDING_KEY);
    statusListener("ok");
  } catch (_) {
    const cached = readJson(CACHE_KEY);
    db = cached ? normalize(cached) : { exos: [], sessions: [] };
    statusListener("offline");
  }
}

export function save() {
  const data = documentFrom();
  writeJson(CACHE_KEY, data);
  const pending = readPending();
  writeJson(PENDING_KEY, { data, baseRevision: pending?.baseRevision || serverRevision });
  dirty = true;
  clearTimeout(saveT);
  saveT = setTimeout(pushData, 400);
}

async function sendDocument(data, revision, keepalive = false) {
  return fetch("/api/data", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "If-Match": revision, ...authHeaders() },
    body: JSON.stringify(data),
    keepalive
  });
}

async function pushLoop() {
  if (!dirty) return;
  statusListener("saving");

  for (let attempt = 0; attempt < 4; attempt++) {
    let pending = readPending();
    if (!pending) {
      pending = { data: documentFrom(), baseRevision: serverRevision };
      writeJson(PENDING_KEY, pending);
    }
    const sent = pending.data;
    try {
      const response = await sendDocument(sent, pending.baseRevision);
      if (response.status === 401) { statusListener("auth"); return; }

      if (response.status === 409) {
        const conflict = await response.json();
        const remote = documentFrom(normalize(conflict.data));
        const base = readJson(BASE_KEY) || { version: 1, exercises: [], sessions: [] };
        const latestLocal = readPending()?.data || sent;
        const merged = mergeDocuments(base, latestLocal, remote);
        const remoteRevision = response.headers.get("ETag") || `"${conflict.revision || 0}"`;
        db = normalize(merged);
        rememberServerState(remote, remoteRevision);
        writeJson(CACHE_KEY, merged);
        writeJson(PENDING_KEY, { data: merged, baseRevision: remoteRevision });
        dirty = true;
        continue;
      }

      if (!response.ok) throw new Error("save failed");
      const newRevision = response.headers.get("ETag") || serverRevision;
      rememberServerState(sent, newRevision);
      const latest = readPending();
      if (!latest || same(latest.data, sent)) {
        localStorage.removeItem(PENDING_KEY);
        dirty = false;
        statusListener("ok");
        return;
      }
      writeJson(PENDING_KEY, { data: latest.data, baseRevision: newRevision });
      dirty = true;
    } catch (_) {
      statusListener("offline");
      return;
    }
  }
  statusListener("conflict");
}

async function pushData() {
  if (pushPromise) return pushPromise;
  pushPromise = pushLoop();
  try { await pushPromise; }
  finally { pushPromise = null; }
}

export function retrySync() {
  return dirty ? pushData() : loadData();
}

function flush() {
  if (!dirty) return;
  const pending = readPending();
  if (!pending) return;
  try { sendDocument(pending.data, pending.baseRevision, true); } catch (_) {}
}

window.addEventListener("pagehide", flush);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flush();
  else if (dirty) pushData();
});
window.addEventListener("online", () => { if (dirty) pushData(); });
