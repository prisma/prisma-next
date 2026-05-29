# PPG Serverless Driver — Project Plan

## Summary

Ship `@prisma-next/driver-ppg-serverless` (data-plane driver wrapping `@prisma/ppg`'s WebSocket session API) and `@prisma-next/prisma-postgres-serverless` (facade mirroring `@prisma-next/postgres`'s composition surface, wired to the new driver). Control plane is out of scope (D4); users run migrations via the existing `@prisma-next/postgres` facade against a direct TCP URL.

**Spec:** `projects/ppg-serverless/spec.md`

## Sequencing rationale

- Slice 1 lands the catalog entry + driver package shell (passes `pnpm lint:deps`, exports a placeholder descriptor). Cheapest reviewable unit; unblocks everything downstream.
- Slice 2 implements the driver's "one-shot session per call" path — top-level `execute`/`query`/`executePrepared` open a PPG session, run the statement, close. This is the path the facade's non-transactional convenience surface uses.
- Slice 3 implements the driver's "long-lived session" path — `acquireConnection()` opens a session the caller reuses, and `beginTransaction()` issues `BEGIN`/`COMMIT`/`ROLLBACK` on it. Reuses the session lifecycle from Slice 2.
- Slices 2 and 3 are sequenced (not parallel) because Slice 3 reuses the session abstraction Slice 2 introduces. The transport is the same (WebSocket per D1); the slices differ in *who owns the session lifecycle*.
- Slice 4 scaffolds the facade package; depends only on Slice 1.
- Slice 5 wires the facade end-to-end; depends on Slices 3 + 4.
- Slice 6 validates against a live PPG instance and adds docs.

## Slices

### Slice 1: Driver package scaffold + catalog

**Outcome:** New `packages/3-targets/7-drivers/ppg-serverless/` package with `package.json` (`@prisma-next/driver-ppg-serverless`), tsconfigs, tsdown config, biome config. Single `./runtime` export wired up returning a placeholder descriptor with `familyId: 'sql'`, `targetId: 'postgres'`. `@prisma/ppg` pinned at an exact version in `pnpm-workspace.yaml`'s catalog.

**Builds on:** Nothing.

**Hands to:** Slices 2, 4.

**Focus:** Get the layering / lint topology right so the rest of the work doesn't fight import-lint. Verify `pnpm lint:deps` and `pnpm build` stay green with the empty package in place. No `pg` / `pg-cursor` / `@types/pg` in the dependency manifest (NFR2).

---

### Slice 2: Driver runtime — one-shot session calls (`execute`, `query`, `executePrepared`)

**Outcome:** `SqlDriver<PpgBinding>` runtime entrypoint. Top-level `execute`/`executePrepared`/`query` open a PPG `client.newSession()`, run the statement, collect/stream rows, close the session. `executePrepared` is a direct alias for `execute` (D2). Row values mapped from PPG's `Row.values` array into `Record<string, unknown>` using column metadata. PPG errors normalized through a new `normalize-error.ts`.

**Builds on:** Slice 1.

**Hands to:** Slice 3, Slice 5.

**Focus:** The session-per-call lifecycle. `acquireConnection` throws "not implemented" for now. Unit tests parallel `driver-postgres/test/driver.basic.test.ts` and `driver.errors.test.ts`, mocking PPG at the `client()` boundary.

---

### Slice 3: Driver runtime — long-lived sessions + transactions (`acquireConnection`, `beginTransaction`)

**Outcome:** `acquireConnection()` opens a PPG session and returns a `SqlConnection` whose `execute`/`query`/`executePrepared` route through that session for its lifetime. `beginTransaction()` issues `BEGIN` on the session and returns a `SqlTransaction` with `commit()`/`rollback()` issuing `COMMIT`/`ROLLBACK` on the same session. `release()` and `destroy(reason)` close the session.

**Builds on:** Slice 2.

**Hands to:** Slice 5.

**Focus:** Mirror the `PostgresConnectionImpl` / `PostgresTransactionImpl` split from `driver-postgres`, but backed by one PPG session per `acquireConnection` instead of a pg pool acquisition. No pool layer — PPG owns pooling on the server side.

---

### Slice 4: Facade package scaffold

**Outcome:** New `packages/3-extensions/prisma-postgres-serverless/` package with `package.json` (`@prisma-next/prisma-postgres-serverless`, mirroring `@prisma-next/postgres`'s deps but with `@prisma-next/driver-ppg-serverless` instead of `@prisma-next/driver-postgres`, and no `pg`/`@types/pg`), tsconfigs, tsdown config, biome config. Stub export files for `./config`, `./contract-builder`, `./family`, `./migration`, `./runtime`, `./target` (no `./control`, no `./serverless`).

**Builds on:** Slice 1.

**Hands to:** Slice 5.

**Focus:** Composition shape only — `./config`, `./contract-builder`, `./family`, `./migration`, `./target` compile as `export { default } from ...` re-forwards from upstream packs (identical to the existing `postgres` facade). `./runtime` is a placeholder until Slice 5.

---

### Slice 5: Facade runtime wiring

**Outcome:** `./runtime` export ports the existing `postgres.ts` to use `@prisma-next/driver-ppg-serverless/runtime`. Binding-construction path accepts `{ url }` or `{ ppgClient }` (a pre-constructed PPG client). `transaction()`, `prepare()`, `[Symbol.asyncDispose]` semantics identical to `@prisma-next/postgres`. Smoke tests at the facade boundary cover the same shapes as `postgres/test/` that don't require a live database (sql builder round-trip with mocked driver, transaction lifecycle wiring).

**Builds on:** Slices 3 + 4.

**Hands to:** Slice 6.

**Focus:** This is where the user-visible API surface materializes. The constraint is shape-parity with `@prisma-next/postgres`'s `runtime()` — same options, same returned client shape (minus orm methods that don't apply to data-plane-only).

---

### Slice 6: Integration tests + docs + close-out

**Outcome:**
- Extend `@prisma-next/test-utils` to surface `server.ppg.url` from the existing `createDevDatabase` programmatic server (new field on the `DevDatabase` return type; existing TCP `connectionString` consumers unaffected). (D6)
- Integration tests in `packages/3-extensions/prisma-postgres-serverless/test/` that round-trip SELECT/INSERT/transaction against `@prisma/dev`'s PPG endpoint in-process. Runs by default in CI; no env gating.
- READMEs for both new packages with a Cloudflare Workers usage example.
- Repo-level docs touched as needed (Repo Map updated to list the new packages; onboarding driver list if applicable).

**Builds on:** Slice 5.

**Hands to:** Project close-out.

**Focus:** Validation slice. After this lands, the project's acceptance criteria are checkable end-to-end — with real PPG-protocol coverage in CI, not just mocked-driver coverage.

---

## Close-out (required)

- [ ] Verify all acceptance criteria in `projects/ppg-serverless/spec.md`
- [ ] Migrate long-lived docs (driver README, facade README, any architecture notes) into `docs/` if they outgrow per-package READMEs
- [ ] Strip repo-wide references to `projects/ppg-serverless/**` (replace with canonical `docs/` links or remove)
- [ ] Delete `projects/ppg-serverless/`
