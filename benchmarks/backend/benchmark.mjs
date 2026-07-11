import { cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const root = resolve(import.meta.dirname, "../..");
const zig = join(root, ".bench-tools/zig/zig-aarch64-macos-0.14.1/zig");
const zigBin = join(root, ".bench-tools/backend-server");
const sampleData = join(root, "benchmarks/data/sample-data.json");
const runs = 80;
const putRuns = 20;

function buildZig() {
  const result = spawnSync(zig, [
    "build-exe",
    "backend/src/main.zig",
    "-target",
    "aarch64-macos",
    "-O",
    "ReleaseFast",
    "-lc",
    "-fstrip",
    "--cache-dir",
    ".bench-tools/zig-cache/local",
    "--global-cache-dir",
    ".bench-tools/zig-cache/global",
    `-femit-bin=${zigBin}`,
  ], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) throw new Error("Zig build failed");
}

function prepareWorkdir(name) {
  const dir = join(root, ".bench-tools/backend-bench", name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "data"), { recursive: true });
  cpSync(join(root, "public"), join(dir, "public"), { recursive: true });
  cpSync(join(root, "backup/server.py"), join(dir, "server.py"));
  cpSync(sampleData, join(dir, "data/muscu-data.json"));
  cpSync(sampleData, join(dir, "data/muscu-data.bak.json"));
  return dir;
}

async function startServer(label, command, args, cwd, port) {
  const start = performance.now();
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), TRACKRZ_ROOT: cwd },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk.toString(); });
  child.stderr.on("data", chunk => { output += chunk.toString(); });

  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`${label} exited early:\n${output}`);
    try {
      const response = await fetch(`${url}/__ready`, { cache: "no-store" });
      if (response.status < 500) {
        await response.arrayBuffer();
        return { child, url, readyMs: performance.now() - start };
      }
    } catch {}
    await sleep(25);
  }
  child.kill("SIGTERM");
  throw new Error(`${label} did not become ready:\n${output}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise(resolve => child.once("exit", resolve));
}

async function measureGet(url, path, count) {
  const times = [];
  for (let i = 0; i < count; i++) {
    const t0 = performance.now();
    const response = await fetch(`${url}${path}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`${path} returned ${response.status}`);
    await response.arrayBuffer();
    times.push(performance.now() - t0);
  }
  return summarize(times);
}

async function measureOneGet(url, path) {
  const t0 = performance.now();
  const response = await fetch(`${url}${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  await response.arrayBuffer();
  return round(performance.now() - t0);
}

async function measurePut(url, cwd, count) {
  const times = [];
  for (let i = 0; i < count; i++) {
    const current = await fetch(`${url}/api/data`, { cache: "no-store" });
    const etag = current.headers.get("etag") || "\"0\"";
    const body = await current.json();
    body.sessions = body.sessions.slice();
    body.sessions.push({
      id: `bench-${i}`,
      date: "2026-07-11",
      exos: [{ exoId: "bench", sets: [{ reps: 8, weight: 80 }] }],
    });
    const t0 = performance.now();
    const response = await fetch(`${url}/api/data`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": etag },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`PUT returned ${response.status}: ${await response.text()}`);
    await response.arrayBuffer();
    times.push(performance.now() - t0);
  }
  return summarize(times);
}

function summarize(values) {
  const sorted = values.toSorted((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    minMs: round(sorted[0]),
    medianMs: round(sorted[Math.floor(sorted.length / 2)]),
    p95Ms: round(sorted[Math.floor(sorted.length * 0.95)]),
    avgMs: round(sum / values.length),
  };
}

function round(value) {
  return Number(value.toFixed(3));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function rssKb(pid) {
  const result = spawnSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" });
  if (result.status !== 0) return null;
  const value = Number.parseInt(result.stdout.trim(), 10);
  return Number.isFinite(value) ? value : null;
}

function binarySize(path) {
  return existsSync(path) ? statSync(path).size : null;
}

async function runOne(label, command, args, cwd, port) {
  const server = await startServer(label, command, args, cwd, port);
  try {
    const firstApiGetMs = await measureOneGet(server.url, "/api/data");
    const idleRssKb = rssKb(server.child.pid);
    const apiGet = await measureGet(server.url, "/api/data", runs);
    const staticGet = await measureGet(server.url, "/js/app.js", runs);
    const put = await measurePut(server.url, cwd, putRuns);
    const afterRssKb = rssKb(server.child.pid);
    return {
      readyMs: round(server.readyMs),
      firstApiGetMs,
      idleRssKb,
      afterBenchRssKb: afterRssKb,
      apiGet,
      staticGet,
      apiPut: put,
    };
  } finally {
    await stopServer(server.child);
  }
}

const rebuildZig = process.env.SKIP_ZIG_BUILD !== "1";
if (rebuildZig) buildZig();

const pythonDir = prepareWorkdir("python");
const zigDir = prepareWorkdir("zig");

const results = {
  date: new Date().toISOString(),
  methodology: {
    runs,
    putRuns,
    rebuildZig,
    note: "Each backend runs in its own temporary working directory with the same public/ assets and sample data file.",
  },
  size: {
    pythonServerPyBytes: binarySize(join(root, "backup/server.py")),
    zigBinaryBytes: binarySize(zigBin),
  },
  python: await runOne("python", "python3", ["server.py"], pythonDir, 9201),
  zig: await runOne("zig", zigBin, [], zigDir, 9202),
};

mkdirSync(join(root, "benchmarks/backend/results"), { recursive: true });
writeFileSync(join(root, "benchmarks/backend/results/latest.json"), JSON.stringify(results, null, 2));

console.log(JSON.stringify(results, null, 2));
