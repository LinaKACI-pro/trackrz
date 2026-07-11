Trackrz Dioxus benchmark

Purpose
Compare the current static JavaScript frontend with a small Rust + Dioxus 0.7 app that renders the same kind of workout tracker surface: exercise picker, KPIs, progress rows and history.

Build
1. Install the Dioxus CLI if needed:
   curl -sSL https://dioxus.dev/install.sh | bash

2. Build and measure:
   node benchmarks/scripts/benchmark.mjs --build-dioxus

3. Measure again without rebuilding:
   node benchmarks/scripts/benchmark.mjs

Notes
- Size for the current app includes index.html, CSS, JS modules, manifest and service worker.
- Size for Dioxus includes the generated web bundle in benchmarks/dioxus/dist/public.
- Browser timings are measured only if the Node package "playwright" is available.
- The Dioxus app is intentionally isolated from production and does not change server.py or public/.
