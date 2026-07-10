import assert from "node:assert/strict";
import test from "node:test";

class StorageMock {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

globalThis.localStorage = new StorageMock();
globalThis.window = { addEventListener() {} };
globalThis.document = { addEventListener() {}, visibilityState: "visible" };

const store = await import("../public/js/store.js");

const exercise = { id: "squat", name: "Squat", group: "Jambes", type: "charge" };
const session = id => ({ id, date: "2026-07-10", exos: [{ exoId: "squat", sets: [{ reps: 8, weight: 80 }] }] });
const response = (data, status, etag) => new Response(JSON.stringify(data), { status, headers: { ETag: etag } });

test("persiste les changements et fusionne un conflit multi-appareils", async () => {
  globalThis.fetch = async () => response({ version: 1, revision: 0, exercises: [exercise], sessions: [] }, 200, '"0"');
  await store.loadData();

  store.db.sessions.push(session("local-1"));
  store.save();
  globalThis.fetch = async () => response({ ok: true, revision: 1 }, 200, '"1"');
  await store.retrySync();
  assert.equal(localStorage.getItem("muscu_pending"), null);

  store.db.sessions.push(session("local-2"));
  store.save();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return response({
        error: "conflict",
        revision: 2,
        data: { version: 1, revision: 2, exercises: [exercise], sessions: [session("local-1"), session("remote-1")] }
      }, 409, '"2"');
    }
    return response({ ok: true, revision: 3 }, 200, '"3"');
  };
  await store.retrySync();

  assert.deepEqual(store.db.sessions.map(item => item.id).sort(), ["local-1", "local-2", "remote-1"]);
  assert.equal(localStorage.getItem("muscu_pending"), null);
  assert.equal(localStorage.getItem("muscu_revision"), '"3"');
});
