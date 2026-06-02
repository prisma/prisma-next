# Slice: Integration tests + docs

> **Status: HALTED at D1.** Slice 6's central premise — "`@prisma/dev`'s `server.ppg.url` is a `@prisma/ppg`-compatible endpoint we can integration-test against in-process, no env gating" — is empirically false against `@prisma/dev@0.24.7`. The endpoint exists but serves the **Prisma Accelerate / data-proxy GraphQL protocol** (consumed by `@prisma/client/edge`), not the **`@prisma/ppg`** raw-SQL protocol (`/v0/statement` + `/v0/session`) our facade depends on. The `prisma+postgres://` scheme is shared between both products; the wire protocols are not. Source-verified at `wip/team-expansion/dev/server/src/{accelerate.ts,query-plan-executor.ts,programmatic.ts}`. See [`projects/ppg-serverless/learnings.md`](../../learnings.md) for the full story, options surfaced to the operator (build a PPG-protocol shim in `@prisma-next/test-utils`, gate on hosted PPG via CI secret, or defer AC-4), and the decision (defer; draft PR; reconsider shim later).

> What DID land from Slice 6: the `ppgUrl` field on `DevDatabase` in `@prisma-next/test-utils`, surfacing the URL for forward compatibility (future upstream PPG support, or a future test shim). The JSDoc on the field documents the protocol mismatch in-place. Everything else in this spec (integration tests against the real PPG endpoint, READMEs, repo-map updates) is deferred.

_Parent project: [`projects/ppg-serverless/`](../../). The validation slice — after this, the project's acceptance criteria are checkable end-to-end against real PPG protocol (`@prisma/dev`'s in-process PPG endpoint), and the user-facing READMEs document the Cloudflare Workers integration path. Hands off to project close-out._

## At a glance

Extend `@prisma-next/test-utils`'s `createDevDatabase` to surface `server.ppg.url` (the PPG endpoint that `@prisma/dev` already exposes alongside its TCP connection string). Add integration tests in the facade package that round-trip SELECT, INSERT, and an explicit `transaction(...)` against that PPG endpoint, in-process, no env gating — replacing the mocked-driver coverage from Slice 5 with real PPG-protocol coverage. Write user-facing READMEs for the driver and the facade with a Cloudflare Workers usage example mirroring the existing `@prisma-next/postgres` README's edge example. Touch repo-level docs (Repo Map, onboarding driver list) to surface the new packages. Document that `./config` and `./contract-builder` ship as stubs through project DoD (no operator override of the working position from Slice 5 OQ1).

## Chosen design

### `@prisma-next/test-utils` extension

Surface `ppgUrl` on `DevDatabase` alongside `connectionString`. Both come from the same `startPrismaDevServer` server instance — `connectionString` already wraps `server.database.connectionString` through `normalizeConnectionString`; `ppgUrl` wraps `server.ppg.url` through the same normaliser (replace `localhost`/`::1` with `127.0.0.1` for cross-platform CI parity).

```diff
 export interface DevDatabase {
   readonly connectionString: string;
+  readonly ppgUrl: string;
   close(): Promise<void>;
 }
```

`createDevDatabase` populates `ppgUrl: normalizeConnectionString(server.ppg.url)`. Existing TCP-consumer callers see no change. `withDevDatabase` inherits the new field transparently.

**Backward compatibility:** the new field is required (not optional). All current consumers either ignore it or are TCP-only; adding a required field doesn't break them because they construct via `createDevDatabase`, not by hand. No existing test file constructs `DevDatabase` literally.

### Integration tests

New file at `packages/3-extensions/prisma-postgres-serverless/test/prisma-postgres-serverless.integration.test.ts`. Pattern: each test calls `await withDevDatabase(async (db) => { ... })`, uses `db.ppgUrl` to construct a facade client via `runtime({ url: db.ppgUrl, contract })`, runs the operation, asserts the result.

Coverage:

- **SELECT round-trip**: `CREATE TABLE` via the facade's runtime, `INSERT` a row, `SELECT` it back, assert shape + values. Uses `runtime.connection()` (raw connection, plan-bypass) for the DDL, then `runtime.execute(plan)` for the SELECT.
- **INSERT round-trip with rowCount**: insert a row via `connection.query('INSERT ... RETURNING ...')`, assert `rowCount` + returned row.
- **Transaction commit**: open `transaction(fn)`, insert a row inside, return; assert the row persists post-transaction.
- **Transaction rollback**: open transaction, insert a row, throw to trigger rollback; assert the row is NOT present post-transaction.
- **`acquireConnection` lifecycle**: acquire a connection, run two queries through it, release; verify both queries hit the same session (PPG-level — the connection holds one session for its lifetime per Slice 3).
- **Connection-level error normalisation**: issue a query that violates a constraint, assert the thrown error is a `SqlQueryError` with PPG's `sqlState` preserved.

Expected test count: 6–8.

**No env gating.** The test file runs by default in CI (`pnpm test:packages`) and locally (`pnpm --filter @prisma-next/prisma-postgres-serverless test`). `@prisma/dev` is already a workspace dep used by `@prisma-next/test-utils`, so no new package install or CI configuration is needed.

**`tsconfig.json` adjustment:** the facade's `tsconfig.json` already includes `test/**/*.ts`; no changes needed.

### READMEs

**`packages/3-targets/7-drivers/ppg-serverless/README.md`** — fill in the Architecture mermaid + Usage code block that were Slice-1 TODOs.

- Architecture mermaid: WebSocket-via-PPG-session flow (caller → SqlDriver → `@prisma/ppg.Client.newSession` → WS → PPG service).
- Usage: descriptor + connect pattern with both binding variants (`{ kind: 'url', url }` and `{ kind: 'ppgClient', client: existingClient }`). Note the data-plane-only scope (no `./control`). Note that the prepared-statement handle is accepted-but-unused (D2 from project spec).

**`packages/3-extensions/prisma-postgres-serverless/README.md`** — full Usage section + Cloudflare Workers example.

- Cloudflare Workers example mirroring the structure in `@prisma-next/postgres/README.md`'s edge example:
  ```ts
  import prismaPostgresServerless from '@prisma-next/prisma-postgres-serverless/runtime';
  import { Contract } from './contract.d.ts';
  import contractJson from './contract.json';

  const db = prismaPostgresServerless<Contract>({ contractJson });

  export default {
    async fetch(_req: Request, env: Env): Promise<Response> {
      const rows = await db.runtime().execute(
        db.sql.from(t).select(...).build()
      );
      return Response.json(rows);
    },
  };
  ```
- Document the **stubbed `./config` and `./contract-builder`** exports: users wanting `defineConfig` / `defineContract` should `import { defineConfig } from '@prisma-next/postgres/config'` and use a direct TCP URL for migration tooling (per D4 — control plane stays on the postgres facade). Surface this explicitly so users don't waste time discovering the stub-throw at runtime.
- Document the bindings: `{ url }` (driver-owned PPG client lifecycle) vs `{ ppgClient }` (caller-owned).
- Document the transaction surface (same shape as `@prisma-next/postgres`).
- Document NFR1 compatibility envelope: Node 20+, Cloudflare Workers, Vercel Edge, Deno, Bun edge.

Both READMEs use **neutral wording** throughout — no `Slice N`, no `D1`/`D2` references in source-shipping content (per `.agents/rules/no-transient-project-ids-in-code.mdc`).

### Repo-level docs

- [`docs/onboarding/Repo-Map-and-Layering.md`](../../../../docs/onboarding/Repo-Map-and-Layering.md) — add the two new packages to the appropriate sections (drivers under `packages/3-targets/7-drivers/`, extensions under `packages/3-extensions/`). One-line entries each, mirroring existing entries.
- No changes to ADRs (no architectural shift this project — same target / family / adapter; new driver + facade per the established pattern).
- No changes to `docs/architecture docs/subsystems/`.

### `./config` and `./contract-builder` close-out

These remain Slice-4 stubs per the working position from Slice 5 OQ1. The facade README explicitly documents the limitation and the workaround. **Slice 6 does NOT fill these in** — surfacing once more to the operator at slice-end via the project close-out's verification step.

## Coherence rationale

Two dispatches in this slice (validation, then docs) hang together as the project's "validation phase":

- D1 substitutes real PPG-protocol coverage for the mocked-driver coverage of prior slices. Without it, the project's AC-4 ("Integration test in `packages/3-extensions/prisma-postgres-serverless/test/` round-trips a SELECT, an INSERT, and an explicit `transaction(...)`") is unverifiable.
- D2 makes the new packages usable by external readers. Without it, AC-8 ("Facade README + driver README briefly document use, with a Cloudflare Workers example") is unverifiable.

Splitting D1 and D2 across slices would mean a slice closes without the AC it claims to validate. Both ship together.

## Scope

**In:**

- `test/utils/src/exports/index.ts` — add `ppgUrl: string` to `DevDatabase`; populate from `server.ppg.url`.
- `packages/3-extensions/prisma-postgres-serverless/test/prisma-postgres-serverless.integration.test.ts` — new integration tests against `@prisma/dev`'s PPG endpoint (6–8 tests).
- `packages/3-targets/7-drivers/ppg-serverless/README.md` — fill in Architecture + Usage from the Slice-1 TODO placeholders.
- `packages/3-extensions/prisma-postgres-serverless/README.md` — full Usage + Cloudflare Workers example + stub-export documentation.
- `docs/onboarding/Repo-Map-and-Layering.md` — add two new package entries.

**Out:**

- `./config` substantive impl. Documented as stub through project DoD.
- `./contract-builder` substantive impl. Documented as stub through project DoD.
- Any new dependencies. `@prisma/dev` is already a workspace dep via `@prisma-next/test-utils`.
- Updates to `@prisma-next/postgres`, `@prisma-next/driver-postgres`, adapters, target packs, framework, or any package outside the explicit In list.
- ADR authoring. No architectural shift to record.
- Project close-out (folder deletion, repo-wide reference stripping). That's `drive-close-project`'s job — runs AFTER this slice's DoD.

## Pre-investigated edge cases

| Edge case | Disposition |
|---|---|
| `@prisma/dev`'s `server.ppg.url` may use `localhost`/`::1` while CI runs against `127.0.0.1`. | Apply the existing `normalizeConnectionString` to `ppg.url` too. Mirrors how `database.connectionString` is handled. |
| The integration test's `CREATE TABLE` schema setup must not collide with other tests running in parallel. | Each test uses a fresh `@prisma/dev` server (`withDevDatabase` semantics). Tests are serialised within their file but isolated from other test files by the per-server PGlite-backed database. No schema cleanup needed. |
| PPG's session may behave differently from `pg`'s TCP socket on transaction rollback timing. | The integration test asserts post-transaction state via a fresh query — the assertion is observational, not timing-sensitive. PPG's transaction semantics are PostgreSQL semantics (it's just a transport layer); rollback is synchronous on commit/rollback statement completion. |
| `db.runtime().connection()` for raw DDL — does PPG support DDL through `Session.query`? | Yes — PPG forwards arbitrary SQL through the session; PGlite (the `@prisma/dev` backend) supports `CREATE TABLE` / `INSERT` / `SELECT` standard SQL. No PPG-specific DDL constraints. |
| The driver README's Slice-1 TODO comments (the `<!-- TODO -->` placeholders) need to be removed cleanly. | Replace with real content; the placeholders are the gate. No need to keep historical breadcrumbs. |
| Integration tests against PPG may be slow (WebSocket handshake per session). | Each test opens at most a few sessions; total runtime per file should be <30s. If a single test exceeds 10s, the test is overscoped — split. |

## Slice-specific done conditions

- [ ] `pnpm --filter @prisma-next/prisma-postgres-serverless test` includes the integration tests and they pass (SELECT, INSERT, transaction commit, transaction rollback, acquireConnection lifecycle, error normalisation).
- [ ] `pnpm --filter @prisma-next/test-utils typecheck` clean (the `DevDatabase` interface change shouldn't break callers; if it does, fix the callers).
- [ ] `pnpm test:packages` workspace-wide green — the AC-6 final check. This is the workspace-wide regression baseline; if any prior package's tests regress because of the `DevDatabase` extension, surface and fix.
- [ ] Driver README's Slice-1 TODO placeholders are replaced with real content.
- [ ] Facade README ships Usage + Cloudflare Workers example + stub-export documentation.
- [ ] `docs/onboarding/Repo-Map-and-Layering.md` lists both new packages.

CI-green, reviewer-accept, project-DoD floor (no `pg`/`@types/pg` in facade manifest; no bare `as`; no transient project IDs).

## Open Questions

1. **`./config` and `./contract-builder` substantive impls — operator confirmation needed?** Working position: **stay as stubs through project DoD** per Slice 5 OQ1. The facade README documents this clearly. _Override: if the operator wants them filled in, Slice 6 grows by ~300 LoC (defineConfig that omits the control driver field + tests + defineContract that mirrors postgres's identity transform); could be a D3 in this slice or deferred to a post-close-out follow-up._
2. **Integration test runner & CI integration.** Working position: tests run via `pnpm test:packages` (workspace-wide), no env gating, no separate `test:integration` command needed. The `@prisma/dev` in-process server is fast enough. _Override: if integration tests are too slow for the per-PR CI cycle, separate them into `pnpm test:integration` (gated to nightly / pre-merge)._
3. **README Cloudflare Workers example: full code block or pointer?** Working position: **full code block** — mirror the existing `@prisma-next/postgres/README.md`'s pattern. The example is the README's load-bearing user-facing artifact.

## References

- Parent project: [`projects/ppg-serverless/spec.md`](../../spec.md) — AC-4 (integration tests), AC-8 (READMEs), D6 (in-process `@prisma/dev` PPG endpoint).
- Slice plan: [`projects/ppg-serverless/plan.md`](../../plan.md) § Slice 6.
- Prior slices' SATISFIED state: [`projects/ppg-serverless/slices/05-facade-runtime/spec.md`](../05-facade-runtime/spec.md) (the facade runtime this slice validates).
- Existing facade README (READMEs to mirror): [`packages/3-extensions/postgres/README.md`](../../../../packages/3-extensions/postgres/README.md) (Cloudflare Workers example structure).
- Existing test-utils: [`test/utils/src/exports/index.ts`](../../../../test/utils/src/exports/index.ts) — `DevDatabase` interface, `createDevDatabase`, `withDevDatabase`, `normalizeConnectionString`.
- `@prisma/dev` `server.ppg.url` surface: `node_modules/.pnpm/@prisma+dev@*/node_modules/@prisma/dev/dist/state-CDXGsSbm.d.ts` — `exportsSchema.ppg.url`.
- Repo Map: [`docs/onboarding/Repo-Map-and-Layering.md`](../../../../docs/onboarding/Repo-Map-and-Layering.md).

## Adapter-impact section

**Adapters affected:** None. Validation + docs only.
