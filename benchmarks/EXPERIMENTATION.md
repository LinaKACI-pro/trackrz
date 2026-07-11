# Trackrz Experimentation

## Goal

Compare the current application with more system-programming-oriented versions to see what we gain or lose in size, memory usage, and response time.

The goal is not to prove that one technology is better everywhere. The goal is to measure whether a more precise approach, with fewer implicit allocations and more control over the data, fits this project better.

## Test Conditions

- Machine: macOS arm64 local.
- Data: same sample file, `benchmarks/data/sample-data.json`.
- Frontend: local measurement with Playwright Chromium.
- Backend: each server runs in its own temporary directory with the same `public/` assets.
- Zig backend: measured with `SKIP_ZIG_BUILD=1`, so the already-built binary is used, which is closer to a deployed server.
- Lower is better for time, size, and memory.

## Frontend

| Frontend | Raw | Gzip | Brotli | readyMs | DOM nodes |
|---|---:|---:|---:|---:|---:|
| Current JavaScript | 78.8 KiB | 24.8 KiB | 21.8 KiB | 37.8 ms | 218 |
| Rust + Dioxus/WASM | 465.2 KiB | 183.8 KiB | 148.7 KiB | 31.7 ms | 102 |

Legend:

- `Raw`: uncompressed size of the files loaded on first render.
- `Gzip`: size after gzip compression, close to what an HTTP server may send.
- `Brotli`: size after brotli compression, often better than gzip for the web.
- `readyMs`: time until the useful UI is present in the DOM.
- `DOM nodes`: number of DOM nodes rendered in the tested scenario.

Quick Reading:

Dioxus becomes ready slightly faster in this small test, but it sends much more code to the browser. For this app, the current JavaScript frontend remains lighter.

## Backend

| Backend | Size | readyMs | 1st API GET | API GET median | Static GET median | API PUT median | RSS idle |
|---|---:|---:|---:|---:|---:|---:|---:|
| Current Python | 14.2 KiB | 62.236 ms | 1.433 ms | 0.511 ms | 0.351 ms | 1.163 ms | 25.0 MiB |
| Optimized Zig | 174.8 KiB | 26.850 ms | 0.287 ms | 0.241 ms | 0.227 ms | 0.498 ms | 1.5 MiB |

Legend:

- `Size`: size of the Python server file or the compiled Zig binary.
- `readyMs`: time between process start and the first HTTP response.
- `1st API GET`: first real `GET /api/data` call after the server becomes reachable.
- `API GET median`: median over 80 `GET /api/data` calls.
- `Static GET median`: median over 80 calls to a static asset.
- `API PUT median`: median over 20 `PUT /api/data` writes.
- `RSS idle`: resident memory of the process just after startup.

Quick Reading:

The Zig backend better matches the precision goal:

- fixed and bounded memory;
- application data loaded once into memory;
- reused request buffer;
- less repeated work on hot paths.

In this test, Zig uses much less memory and responds faster than the current Python server.

## Caution

These measurements are local and synthetic. They give a direction, not an absolute production guarantee.

Before actually replacing the Python backend, we still need to check:

- strict parity for business validations;
- behavior on the Hetzner VPS;
- Caddy/systemd integration;
- data backup and restore;
- logs and errors under real conditions.
