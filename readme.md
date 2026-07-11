# Trackrz

Trackrz is a focused workout tracking app built for people who want a simple, fast, and durable way to log strength training sessions.

The goal is not to be a social fitness platform or a bloated analytics dashboard. Trackrz is meant to stay close to the actual workflow: define exercises, log sessions, track sets, and keep the data clean over time.

## Product Angle

Trackrz focuses on the core loop of strength training:

- create and manage exercises
- log workout sessions
- record sets, reps, and weights
- keep history locally and predictably
- avoid unnecessary friction during training

The app is designed to be lightweight, direct, and usable on mobile as a web app.

## Data Angle

The data model is intentionally simple.

A workout log is treated as a structured document with:

- exercises
- sessions
- exercise references inside sessions
- sets attached to each session exercise
- a revision number used for safe updates

The backend validates the document before accepting writes. This keeps the stored data consistent and avoids silently persisting invalid states.

## Technical Philosophy

Trackrz follows a precision-first approach.

Instead of relying on large abstractions by default, the app favors:

- explicit data structures
- bounded memory usage
- predictable persistence
- simple HTTP behavior
- small moving parts
- clear ownership of data

The backend is written in Zig to keep memory and persistence behavior explicit. The frontend stays simple and focused on the user workflow.

## Backend

The Zig backend provides:

- `GET /api/data`
- `PUT /api/data`
- `POST /api/data`

It keeps the current document in memory, validates updates, writes changes atomically, and keeps a backup copy of the previous data file.

## Benchmarks

The repository includes benchmarks to compare:

- the current JavaScript frontend with a Dioxus/Rust experiment
- the previous Python backend with the Zig backend

Benchmark results are stored as reference data, but generated build artifacts are not committed.

## Deployment

The app is deployed through GitHub Actions to a Hetzner server.

On push, the workflow builds the Zig backend, syncs the app files to the server, and restarts the systemd service.
