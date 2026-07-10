import assert from "node:assert/strict";
import test from "node:test";

process.env.TZ = "Europe/Paris";
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : ["2026-07-10T22:30:00Z"])); }
};

const { todayISO, uid } = await import("../public/js/utils.js");

test("todayISO utilise la date locale et non UTC", () => {
  assert.equal(todayISO(), "2026-07-11");
});

test("uid génère des identifiants compatibles avec l’API", () => {
  const values = new Set(Array.from({ length: 50 }, uid));
  assert.equal(values.size, 50);
  assert.ok([...values].every(value => /^[A-Za-z0-9_-]+$/.test(value)));
});
