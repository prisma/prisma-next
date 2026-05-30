# migration-store — project learnings

Working ledger of patterns surfaced during this run. Reviewed at close-out; cross-cutting lessons migrate to durable docs, project-local ones drop with the project.

## Calibration

- **Package test gate command.** `pnpm test:packages -- migration` is **not** a package filter — the `-- <arg>` is a vitest path filter applied across the whole workspace, so it matches every path containing "migration" (adapters, CLI, …) and fails on unrelated infra (postgres ECONNRESET, missing `prisma-next` bin). The correct per-package gate is **`pnpm --filter @prisma-next/migration-tools test`** (+ `cd <pkg> && pnpm typecheck` for package-scoped typecheck). The phrasing `pnpm test:packages -- <pkg>` in `drive/calibration/sizing.md` is misleading and a candidate for a follow-up fix. Use the `--filter` form in all remaining briefs.

## Design / process

- **"Disk-only" over-literalism (D2 halt).** The spec's `{ migrationsDir, deserializeContract }` signature was my own shorthand; it provably can't source the app's live contract (which always comes from the central compiled PSL, never `migrations/`, and is absent on greenfield). Resolved: `appContract` is a **required** caller-supplied input; the app `headRef` is synthesised from `appContract.storage.storageHash`. Lesson: when writing a spec signature, distinguish "loads migration *state* from disk" from "takes *only* a directory" — the live contract is an input you compare against the model, not part of it.
- **Member-shape change is atomic with the intra-package apply/verify engine.** Folded that engine re-point into D2 (not D3); D3 is now only the CLI-package consumers.

## Calibration (cont.)

- **Behavioural "reports all" ACs must be verified empirically, not read-verified (D3 → D4 escapee).** The D3 reviewer passed AC-5 ("`migration check` reports all violations at once") by reading the code for *no-first-failure-bail* across check's own `PN-MIG-CHECK-*` codes. But `migration check` was never actually wired to `checkIntegrity()` — it still ran app-space-only per-package logic, so the *relocated* self-edge (`sameSourceAndTarget`) and orphan-space-dir checks were never re-acquired there (spec § Blast radius names `check` explicitly). The gap was invisible to code-reading and only surfaced when D4 ran a real all-three-problems fixture through `check` and got 1-of-3. Lesson: when an AC asserts a *behaviour over a populated input* ("reports all", "tolerates", "refuses"), the reviewer must run the command against a fixture that actually carries the inputs — a structural/code read is insufficient. Candidate retro item for slice-1 close.

## Decisions flagged for reviewer scrutiny (D2)

Carried into the D2 Opus review as triage items — see `code-review.md`:
deleted graph-walk desync test; corrupt `refs`/`head.json` swallowed with no dedicated violation kind; stricter extension enumeration (`RESERVED_SPACE_SUBDIR_NAMES` + `isValidSpaceId`) vs the old orphan-dir scan; removed loader Result types + `HydratedMigrationGraph` from exports.
