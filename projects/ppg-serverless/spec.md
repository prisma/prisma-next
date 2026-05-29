# Summary

Ship a serverless-friendly Prisma Postgres driver target for prisma-next plus a sibling facade package. The driver wraps `@prisma/ppg` (HTTP + WebSocket transport) and lets users run prisma-next on edge runtimes that can't open TCP sockets. The facade mirrors the composition shape of `@prisma-next/postgres` so users get the same one-liner client.

# Description

Today, prisma-next's only Postgres path is `@prisma-next/driver-postgres`, which depends on `pg`/`pg-cursor`. That stack is fine on Node but it doesn't run on Cloudflare Workers, Vercel Edge, Deno Deploy, or browsers — none of which expose raw TCP sockets.

`@prisma/ppg` (the Prisma Postgres serverless driver) solves that on the wire side: it executes SQL against a Prisma Postgres instance over HTTPS (stateless, one query per request) or WebSocket (stateful, supports sessions and transactions). We bind it to prisma-next's existing SQL driver seam (`SqlDriver` from `@prisma-next/sql-relational-core/ast`) and ship a facade so consumers don't have to wire the stack themselves.

The SQL dialect, migration ops, adapter, and target pack are unchanged — PPG speaks the same Postgres protocol semantics, so `@prisma-next/target-postgres` and `@prisma-next/adapter-postgres` are reused as-is. The work is concentrated at two layers: the driver, and the facade.

**Users:**
- App developers deploying prisma-next to edge / serverless runtimes against Prisma Postgres.
- App developers running prisma-next from constrained environments (browsers, Bun edge, Deno Deploy) where `pg` won't load.

# Requirements

## Functional Requirements

**FR1. New driver package `@prisma-next/driver-ppg-serverless`** at `packages/3-targets/7-drivers/ppg-serverless/`.
- Ships only `./runtime` entrypoint. **No `./control` entrypoint** — control-plane operations (migrations, `dbInit`, `dbVerify`) are out of scope for this project; users run those via the existing `@prisma-next/postgres` facade against a direct TCP URL. (D4)
- Descriptor metadata: `familyId: 'sql'`, `targetId: 'postgres'` (same as `driver-postgres` — the target pack and adapter are reused).
- Runtime driver implements `SqlDriver<PpgBinding> & RuntimeDriverInstance<'sql', 'postgres'>`. Binding kinds:
  - `{ kind: 'url'; url: string }` — driver constructs its own `@prisma/ppg` client.
  - `{ kind: 'ppgClient'; client: PpgClient }` — user owns lifecycle (mirrors the existing `pgClient`/`pgPool` distinction).
- **All transport is WebSocket-via-PPG-session.** (D1) The driver does not use PPG's stateless HTTP path. Top-level `execute()`/`query()`/`executePrepared()` open a one-shot session per call. `acquireConnection()` opens a long-lived session the caller can reuse across multiple operations and transactions. The pool/connection model collapses to one-session-per-acquisition (PPG handles pooling on the wire side).
- `executePrepared` collapses to `execute` (PPG has no first-class prepare; params are already safely parameterized by PPG). The `handle.get/set` cache is accepted but unused. (D2)
- `beginTransaction()` issues `BEGIN`/`COMMIT`/`ROLLBACK` on the acquired session.
- `normalize-error.ts` translates PPG's `DatabaseError` / `WebSocketError` / `ValidationError` into the same `SqlQueryError`-shaped surface that `driver-postgres` produces.

**FR2. New facade package `@prisma-next/prisma-postgres-serverless`** at `packages/3-extensions/prisma-postgres-serverless/`.
- Exports: `./config`, `./contract-builder`, `./family`, `./migration`, `./runtime`, `./target`.
  - **No `./serverless` export** — the package name already signals its nature; the base `./runtime` is the edge-safe entrypoint. (D3)
  - **No `./control` export** — follows from D4 (driver has no control entrypoint).
- Wires `@prisma-next/driver-ppg-serverless/runtime` into the runtime entrypoint. Family, target, adapter, migration, config, and contract-builder exports are forwarded unchanged from the upstream packs.
- `runtime()` returns a `PrismaPostgresServerlessClient<TContract>` with the same shape as `PostgresClient<TContract>` (`sql`, `orm`, `context`, `connect()`, `runtime()`, `transaction()`, `prepare()`, `close()`, `[Symbol.asyncDispose]`).

**FR3. Connection-string handling.** PPG requires the `postgres://identifier:key@db.prisma.io:5432/postgres?sslmode=require` form. The facade and driver accept any `postgres://`/`postgresql://` URL, pass it to PPG, and let PPG produce the precise error if the host/key are wrong. We don't second-guess the URL shape at our layer.

**FR4. Catalog entry.** Add `@prisma/ppg` to `pnpm-workspace.yaml`'s `catalog:` block at a pinned exact version (Early Access — breakage must be visible at upgrade time).

## Non-Functional Requirements

**NFR1. Runtime-environment compatibility.** The driver and facade must build and run under Cloudflare Workers, Vercel Edge, Deno, Bun, and Node 20+. The only runtime APIs we depend on (transitively, through `@prisma/ppg`) are `fetch` and `WebSocket`.

**NFR2. No new transitive Node-only deps.** The driver package's `dependencies` field must not include `pg`, `pg-cursor`, `pg-pool`, or `@types/pg`. CI's import-lint must stay green.

**NFR3. Cast hygiene.** Per `.agents/rules/no-bare-casts.mdc`, no new bare `as` casts in production code. PPG's untyped `Row.values` -> typed result mapping uses `castAs<Row>` with a documented justification.

**NFR4. Error shape parity.** A query that hits a Postgres error (e.g., `42P01` undefined_table) must surface the same `SqlQueryError` subclass through both drivers, so middleware and user error handling don't branch on driver.

## Non-goals

- **Prisma ORM adapter (`@prisma/adapter-ppg`)** — orthogonal product surface, out of scope.
- **Hosted-PPG-only operation.** Local development is supported via `@prisma/dev`, which already exposes a PPG-compatible endpoint at `server.ppg.url` alongside its PGlite-backed TCP `connectionString`. Integration tests run against `@prisma/dev` in-process (the same `createDevDatabase` shape `test/utils` already exposes for the TCP driver), pointed at the PPG endpoint. No live cloud PPG instance is required for CI.
- **Cursor / paginated streaming parity with `pg-cursor`.** PPG's `CollectableIterator` streams natively row-by-row. The existing driver's `cursor` option (batched fetches via `pg-cursor`) has no PPG equivalent and is dropped from the new driver's options surface.
- **Prepared statements with explicit handles.** PPG has no first-class prepare; `executePrepared` collapses to `execute` (still parameterized). The handle is accepted but unused. See Q2.
- **Hyperdrive / other edge-DB intermediaries.** Out of scope.

# Acceptance Criteria

- [ ] `@prisma-next/driver-ppg-serverless` builds, lints, and ships a `./runtime` entrypoint.
- [ ] `@prisma-next/prisma-postgres-serverless` builds, lints, and ships `./config`, `./contract-builder`, `./family`, `./migration`, `./runtime`, `./target` exports.
- [ ] Driver passes the runtime-driver contract tests inherited from `driver-postgres` (with documented skip-list for prepared-statement-specific assertions and `pg-cursor`-specific assertions).
- [ ] Integration test in `packages/3-extensions/prisma-postgres-serverless/test/` round-trips a SELECT, an INSERT, and an explicit `transaction(...)` against `@prisma/dev`'s PPG endpoint (spun up in-process via the existing `@prisma-next/test-utils` pattern, extended to surface `server.ppg.url`). Runs by default in CI; no env gating.
- [ ] `pnpm lint:deps` is green (the driver respects the layering rules — Domain: SQL, Layer: 7-drivers).
- [ ] `pnpm build` and `pnpm test:packages` are green.
- [ ] Driver package depends on neither `pg` nor `pg-cursor` nor `@types/pg`.
- [ ] Facade README + driver README briefly document use, with a Cloudflare Workers example mirroring the existing `postgres-serverless` README's example.

# References

- [Prisma Postgres serverless driver docs](https://www.prisma.io/docs/postgres/database/serverless-driver)
- [`@prisma/ppg` npm package](https://www.npmjs.com/package/@prisma/ppg) (v1.0.1)
- [`prisma/ppg-client` GitHub repository](https://github.com/prisma/ppg-client)
- Existing TCP driver: [`packages/3-targets/7-drivers/postgres/`](../../packages/3-targets/7-drivers/postgres/) (`@prisma-next/driver-postgres`)
- Existing facade: [`packages/3-extensions/postgres/`](../../packages/3-extensions/postgres/) (`@prisma-next/postgres`)
- SQL driver seam: [`packages/2-sql/4-lanes/relational-core/src/ast/driver-types.ts`](../../packages/2-sql/4-lanes/relational-core/src/ast/driver-types.ts)
- Existing per-request edge precedent: [`packages/3-extensions/postgres/src/runtime/postgres-serverless.ts`](../../packages/3-extensions/postgres/src/runtime/postgres-serverless.ts)

# Resolved decisions

- **D1 — Transport: always WebSocket.** All driver calls go through PPG's `client().newSession()` (WebSocket). The stateless HTTP path is not used. Rationale: one transport mode is simpler to reason about; transactions and `acquireConnection`-based workloads need WS anyway; the per-call cost is acceptable for the serverless workloads this driver targets.

- **D2 — `executePrepared` collapses to `execute`.** PPG has no first-class prepare; PPG's own parameterization is safe against SQL injection. The `handle.get/set` cache parameter is accepted (so the seam signature still satisfies `SqlConnection`) but never written.

- **D3 — No `./serverless` facade export.** The whole `@prisma-next/prisma-postgres-serverless` package is the serverless facade; the package name is the signal. Base `./runtime` is the edge-safe entrypoint.

- **D4 — Control driver out of scope.** This project ships data-plane only. Users who need migrations / `dbInit` / `dbVerify` against the same database run those operations via the existing `@prisma-next/postgres` facade with a direct TCP URL (e.g., from CI). The new facade therefore omits both `./control` (no control entrypoint) and the driver omits its control export.

- **D5 — Early Access caveat acknowledged, not foregrounded.** `@prisma/ppg` is upstream-flagged Early Access. Since prisma-next itself is not production-ready, the EA label on the upstream dep doesn't change our overall posture; no special README disclosure is needed.

- **D6 — Local-dev integration tests via `@prisma/dev`.** `@prisma/dev`'s programmatic server (`startPrismaDevServer`) already exposes a PPG-compatible endpoint at `server.ppg.url` (alongside `server.database.connectionString` for TCP). Integration tests for the new driver and facade target that endpoint in-process, mirroring how `test/utils`'s `createDevDatabase` helper already handles the TCP driver. CI runs the integration tests without env gating.
