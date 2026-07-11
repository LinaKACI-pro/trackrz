Trackrz Zig backend

Goal
Production backend for Trackrz, with bounded memory and durable file storage.

Shape
- Sequential HTTP server behind Caddy.
- Three focused modules: HTTP entrypoint, document validation and storage.
- One fixed 8 MiB request arena reused by the sequential server.
- One fixed request I/O buffer reused by the sequential server.
- Two fixed 2 MiB document buffers: active snapshot and next snapshot.
- Request body capped at 2 MiB.
- Static files served from public/.
- API parity for GET /api/data, PUT /api/data and POST /api/data.
- Durable update through temporary file, fsync, rename, backup and directory fsync.

Build
  .bench-tools/zig/zig-aarch64-macos-0.14.1/zig build-exe zig-backend/src/main.zig \
    -target aarch64-macos -O ReleaseFast -lc -fstrip \
    --cache-dir .bench-tools/zig-cache/local \
    --global-cache-dir .bench-tools/zig-cache/global \
    -femit-bin=.bench-tools/trackrz-server

Run
  HOST=127.0.0.1 PORT=8000 .bench-tools/trackrz-server

Benchmark
  node benchmarks/backend/benchmark.mjs
  SKIP_ZIG_BUILD=1 node benchmarks/backend/benchmark.mjs

Notes
- Caddy should proxy /api/ to 127.0.0.1:8000 in production.
- Python is retained only in backup/ as an emergency fallback.
- The implementation is intentionally sequential and explicit.
