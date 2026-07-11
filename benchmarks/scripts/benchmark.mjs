import { brotliCompressSync, gzipSync } from "node:zlib";
import { createServer } from "node:http";
import { extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../..");
const dioxusDir = join(root, "benchmarks/dioxus");
const dioxusDist = join(dioxusDir, "dist/public");

const currentAssets = [
  "public/index.html",
  "public/css/style.css",
  "public/js/app.js",
  "public/js/dashboard.js",
  "public/js/exercises.js",
  "public/js/metrics.js",
  "public/js/store.js",
  "public/js/utils.js",
  "public/js/workout.js",
  "public/manifest.webmanifest",
  "public/sw.js"
];

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

function listFiles(dir) {
  const found = [];
  for (const item of readdirSync(dir)) {
    const path = join(dir, item);
    const stat = statSync(path);
    if (stat.isDirectory()) found.push(...listFiles(path));
    else found.push(path);
  }
  return found;
}

function assetSummary(label, files) {
  const rows = files.map(file => {
    const body = readFileSync(file);
    return {
      file: relative(root, file),
      bytes: body.length,
      gzip: gzipSync(body).length,
      brotli: brotliCompressSync(body).length
    };
  });
  const total = rows.reduce((acc, row) => ({
    bytes: acc.bytes + row.bytes,
    gzip: acc.gzip + row.gzip,
    brotli: acc.brotli + row.brotli
  }), { bytes: 0, gzip: 0, brotli: 0 });
  return { label, total, rows };
}

function printSize(summary) {
  console.log(`\n${summary.label}`);
  console.log(`  raw:    ${formatBytes(summary.total.bytes)}`);
  console.log(`  gzip:   ${formatBytes(summary.total.gzip)}`);
  console.log(`  brotli: ${formatBytes(summary.total.brotli)}`);
}

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 / 1024).toFixed(2)} MiB`;
}

function buildDioxus() {
  const dx = spawnSync("dx", ["bundle", "--web", "--release"], {
    cwd: dioxusDir,
    stdio: "inherit"
  });
  if (dx.status !== 0) {
    throw new Error("Dioxus build failed. Install dx with `curl -sSL https://dioxus.dev/install.sh | bash` or `cargo install dioxus-cli`.");
  }
}

async function measureWithPlaywright() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    try {
      const localPlaywright = pathToFileURL(join(root, ".bench-tools/playwright/node_modules/playwright/index.mjs")).href;
      ({ chromium } = await import(localPlaywright));
    } catch {
      return null;
    }
  }

  let servers;
  try {
    servers = [
      await staticServer(join(root, "public"), 41731),
      await staticServer(dioxusDist, 41732)
    ];
  } catch {
    return null;
  }
  try {
    const browser = await chromium.launch();
    try {
      return {
        current: await pageTiming(browser, "http://127.0.0.1:41731/", "#picker .ex-chip"),
        dioxus: await pageTiming(browser, "http://127.0.0.1:41732/", ".chip")
      };
    } finally {
      await browser.close();
    }
  } finally {
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
  }
}

function staticServer(base, port) {
  const server = createServer((request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    let path = decodeURIComponent(url.pathname);
    if (path === "/api/data") {
      const body = readFileSync(join(root, "benchmarks/data/sample-data.json"));
      response.writeHead(200, { "content-type": "application/json", "etag": "\"bench\"" });
      response.end(body);
      return;
    }
    if (path === "/") path = "/index.html";
    const file = resolve(base, `.${path}`);
    if (!file.startsWith(base)) {
      response.writeHead(403);
      response.end("forbidden");
      return;
    }
    try {
      const body = readFileSync(file);
      response.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("not found");
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function pageTiming(browser, url, readySelector) {
  const timings = [];
  for (let i = 0; i < 7; i++) {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(readySelector);
    const value = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0];
      return {
        ready: performance.now(),
        load: nav.loadEventEnd - nav.startTime,
        domContentLoaded: nav.domContentLoadedEventEnd - nav.startTime,
        nodes: document.querySelectorAll("*").length
      };
    });
    await page.close();
    if (i > 1) timings.push(value);
  }
  return medianTiming(timings);
}

function medianTiming(values) {
  const sortedLoad = values.map(item => item.load).sort((a, b) => a - b);
  const sortedDom = values.map(item => item.domContentLoaded).sort((a, b) => a - b);
  const sortedReady = values.map(item => item.ready).sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return {
    readyMs: Number(sortedReady[middle].toFixed(1)),
    loadMs: Number(sortedLoad[middle].toFixed(1)),
    domContentLoadedMs: Number(sortedDom[middle].toFixed(1)),
    nodes: values[middle].nodes
  };
}

const args = new Set(process.argv.slice(2));
if (args.has("--build-dioxus")) buildDioxus();

const currentSummary = assetSummary("Current JS frontend", currentAssets.map(file => join(root, file)));
const dioxusFiles = statSync(dioxusDist, { throwIfNoEntry: false })?.isDirectory()
  ? listFiles(dioxusDist).filter(file => !file.endsWith(".br") && !file.endsWith(".gz"))
  : [];

printSize(currentSummary);
if (dioxusFiles.length) {
  const dioxusSummary = assetSummary("Dioxus Rust/WASM frontend", dioxusFiles);
  printSize(dioxusSummary);
  const perf = await measureWithPlaywright(currentSummary, dioxusSummary);
  if (perf) {
    console.log("\nBrowser timing median, 5 measured runs after 2 warmups");
    console.table(perf);
  } else {
    console.log("\nBrowser timing skipped. Install Playwright and allow local 127.0.0.1 servers to enable it.");
  }
} else {
  console.log("\nDioxus dist not found. Run: node benchmarks/scripts/benchmark.mjs --build-dioxus");
}
