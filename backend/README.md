Trackrz Zig backend

Goal
Production backend for Trackrz, with bounded memory and durable file storage.
Written for Zig 0.16.0 (std.Io interface: the runtime injects `io` through
`main(init: std.process.Init)` and it is threaded explicitly through
networking and file access).

Shape
- Sequential HTTP server behind Caddy.
- Modules: main (entrypoint + routing), http (parse/serialize), api (handlers),
  auth (bearer password), store (snapshots + durable persistence),
  document (validation + canonical serialization), json_decode (typed JSON
  accessors), static (public/ files), config.
- One fixed 8 MiB request arena reused by the sequential server.
- One fixed request input buffer reused by the sequential server.
- Two fixed 2 MiB document buffers: active snapshot and next snapshot.
- Request body capped at 2 MiB.
- Static files served from public/.
- API parity for GET /api/data, PUT /api/data and POST /api/data.
- Durable update through temporary file, fsync, rename, backup and directory fsync.
- Sessions may reference deleted exercises: exoId only has to be well-formed,
  history outlives the exercise library.

Build
  zig build-exe backend/src/main.zig -O ReleaseSafe -fstrip -femit-bin=trackrz-server

Test
  zig test backend/src/document.zig

Run
  HOST=127.0.0.1 PORT=8000 ./trackrz-server

Notes
- Caddy should proxy /api/ to 127.0.0.1:8000 in production.
- Python is retained only in backup/ as an emergency fallback.
- The implementation is intentionally sequential and explicit.
