# Workers compatibility audit — Prisma Next + Cloudflare Hyperdrive

Audit performed against a throwaway `wrangler dev` worker in `wip/m1-spike/spike-worker/` using `pg@8.13.1` + `pg-cursor@2.12.1` against a local Postgres (`prisma_next_hyperdrive_audit`) wired through the `HYPERDRIVE` binding's `localConnectionString`. Workerd build `1.20250718.0`, `compatibility_flags = ["nodejs_compat"]`.

## TL;DR

- **Recommended topology:** **(c) wrapper-only** — add a `hyperdrive: env.HYPERDRIVE` input variant to the `@prisma-next/postgres` wrapper that internally constructs `new Client({ connectionString: hyperdrive.connectionString })` and routes to the **existing** `pgClient` `PostgresBinding` kind. No driver changes required.
- **Rationale (1 sentence):** The `pgClient` path in `PostgresDirectDriverImpl` already implements exactly the lifecycle Hyperdrive needs (lazy `client.connect()`, no `pg.Pool`, explicit `client.end()` on close, mutex-serialized `acquireConnection` for transaction affinity), and `pg` + `pg-cursor` work end-to-end in Workers under `nodejs_compat` — so the gap is purely ergonomic.

## 1. Transitive imports under `nodejs_compat`

Empirical findings from running a `pg.Client` end-to-end in a Worker, plus a static read of `@prisma-next/postgres/runtime`'s import graph.

**Empirical: `pg` + `pg-cursor` load and run cleanly under `nodejs_compat`.** The spike worker boots without import errors and successfully exercises Client connect, query, transaction, cursor read/close, and EXPLAIN flows. `pg` auto-pulls a Workers-aware socket adapter (`pg-cloudflare@1.3.0`, visible in the bundle) — no manual configuration needed.

**Static analysis of the PN runtime import graph from `@prisma-next/postgres/runtime`:**

| Package | Imports of concern | Workers risk |
| --- | --- | --- |
| `@prisma-next/postgres` (wrapper) | `import { type Client, Pool } from 'pg'` ([packages/3-extensions/postgres/src/runtime/postgres.ts L28](packages/3-extensions/postgres/src/runtime/postgres.ts)); same in [`binding.ts L1-2`](packages/3-extensions/postgres/src/runtime/binding.ts) | OK (pg works) |
| `@prisma-next/driver-postgres` | `import { Pool } from 'pg'` and `import Cursor from 'pg-cursor'` ([packages/3-targets/7-drivers/postgres/src/postgres-driver.ts L18-19](packages/3-targets/7-drivers/postgres/src/postgres-driver.ts)) — both **statically** imported and therefore bundled regardless of which binding kind is used | OK (both work); bundle-cost only |
| `@prisma-next/sql-runtime`, `@prisma-next/sql-builder`, `@prisma-next/sql-orm-client`, `@prisma-next/sql-relational-core`, `@prisma-next/framework-components`, `@prisma-next/sql-contract*`, `@prisma-next/contract`, `@prisma-next/target-postgres`, `@prisma-next/adapter-postgres`, `@prisma-next/utils` | Pure target-agnostic TypeScript — no `node:fs`, `node:net`, `node:tls`, `node:perf_hooks`, etc. at module load | None |
| arktype, pathe (third-party deps) | Both ship without Node-only module-load APIs and are widely deployed on Workers | None |

**No transitive imports of `@prisma-next/postgres/runtime` are expected to fail to load under `nodejs_compat`.** The risk surface is `pg` + `pg-cursor`, both empirically validated. Final empirical confirmation that the PN-bundled wrapper boots in Workers is deferred to M3 task 3.4 (where the example worker pulls PN through the workspace) — there is no static evidence to predict otherwise.

## 2. End-to-end via the existing `pgClient` binding

Although the spike worker did not bundle PN itself (see `wip/m1-spike/scratch.md` for the rationale — workspace-resolution plumbing in `wip/` was not worth the time), it exercises the **same `pg.Client` lifecycle** that PN's `PostgresDirectDriverImpl` would orchestrate. Each route:

1. constructs `new Client({ connectionString: env.HYPERDRIVE.connectionString })`,
2. `await client.connect()`,
3. issues queries,
4. `await client.end()` in a `finally`.

Result: every query/transaction/cursor route returned `ok: true`. Captured outputs:

- `GET /select` → 3 rows from `pn_audit_user`.
- `GET /transaction` → `BEGIN; INSERT … RETURNING; UPDATE … ; COMMIT;` committed and returned the new row id.
- `GET /cursor` → 4 rows in two batches of 2, then `cursor.close()` succeeded.
- `GET /cursor-large` → 1000-row TEMP TABLE, batches of 100, **early `break` at 300 rows with explicit `cursor.close()` cancelled the remaining rows cleanly**.
- `GET /explain` → `EXPLAIN (FORMAT JSON) …` returned the plan.
- `GET /error` → `relation "does_not_exist" does not exist` propagated to the caller as a normal pg error.

**Conclusion:** if you wire `postgres({ contract, pg: new Client({ connectionString: env.HYPERDRIVE.connectionString }) })` today, the underlying lifecycle works end-to-end. The remaining work is wrapper ergonomics (FR2) and confirming PN itself bundles cleanly (M3).

Caveat: the PN wrapper currently sets `cursor: { disabled: true }` unconditionally when constructing the driver ([postgres.ts L191-193](packages/3-extensions/postgres/src/runtime/postgres.ts)), so cursors are not in the runtime path today even though `pg-cursor` would work.

## 3. `pg-cursor` under Workers

**Empirical answer: `pg-cursor` works in Workers under `nodejs_compat` for the full open / read-batches / close cycle, including early-break cancellation.** The `/cursor-large` route opened a cursor over 1000 rows, read three 100-row batches, then called `cursor.close(cb)` to abort — the worker continued cleanly and pg did not leave the protocol in a stuck state.

**Static reachability / bundle impact:** `pg-cursor` is imported with a top-level `import Cursor from 'pg-cursor';` in [postgres-driver.ts L19](packages/3-targets/7-drivers/postgres/src/postgres-driver.ts), so it is bundled **regardless** of whether `cursor: { disabled: true }` is set at runtime. Wrapper-side disabling of cursors does not eliminate the bundle cost. Removing the static import (e.g. via dynamic import behind the `executeWithCursor` call site) is a possible future optimization, not a blocker.

This matches spec Decision §3's preferred outcome: the Workers/Hyperdrive path **can** keep cursor support.

## 4. Topology recommendation

**Choice: (c) wrapper-only.**

What this means in practice for M2:

- Extend `PostgresBindingInput` and `resolveOptionalPostgresBinding` ([packages/3-extensions/postgres/src/runtime/binding.ts](packages/3-extensions/postgres/src/runtime/binding.ts)) to accept `{ hyperdrive: HyperdriveLike }`, where `HyperdriveLike` is a structural type with at least `connectionString: string` (so consumers without `@cloudflare/workers-types` are not forced to install it).
- Translate the `hyperdrive` input to `{ kind: 'pgClient', client: new Client({ connectionString: hyperdrive.connectionString }) }`. This reuses the existing `pgClient` kind and `PostgresDirectDriverImpl` end-to-end.
- Drop the unconditional `cursor: { disabled: true }` for the hyperdrive path (per spec Decision §3 and §3 above) by either:
  - threading a `cursor` option through `PostgresBindingOptions`, or
  - removing the wrapper-level cursor-disable for all paths and letting consumers opt out (cleaner; affects existing behavior — flag in M2).
- Document the per-isolate vs. per-request construction pattern in the example README (see Open items below).

**Why the existing `pgClient` path satisfies FR3:**

- `PostgresDirectDriverImpl.acquireConnection()` calls `client.connect()` lazily on first use ([postgres-driver.ts L344-372, L392-416](packages/3-targets/7-drivers/postgres/src/postgres-driver.ts)).
- `PostgresDirectDriverImpl.close()` / `destroy()` call `client.end()` ([L383-390, L221-245](packages/3-targets/7-drivers/postgres/src/postgres-driver.ts)).
- No `Pool` is constructed on this code path — `pgClient` falls through to `PostgresDirectDriverImpl`, never `PostgresPoolDriverImpl` ([L442-446](packages/3-targets/7-drivers/postgres/src/postgres-driver.ts)).
- `AsyncMutex` serializes `acquireConnection` so a transaction sharing one socket is the natural behaviour (transaction affinity required by FR4).

### Why not the alternatives

- **(a) New binding kind on the existing driver** would duplicate `PostgresDirectDriverImpl`'s logic with no behavioural difference. The only thing a hyperdrive-specific binding would add is a typed `binding` field on the descriptor — cosmetic, not load-bearing. Reject.
- **(b) Sibling driver package** (`@prisma-next/driver-postgres-workers`) was the most invasive option and would split telemetry / error-normalization / cursor wiring across two packages. There is no Workers-incompatible code in the existing driver to extract. Reject.

## 5. Bundle-size baseline

`wrangler deploy --dry-run --outdir dist` against the spike worker (no PN wrapper, only `pg` + `pg-cursor` + Worker glue):

```
Total Upload: 272.51 KiB / gzip: 52.85 KiB
```

Largest contributors (full list in `wip/m1-spike/bundle-analysis.txt`):

- `pg` (`lib/{client,connection,connection-parameters,defaults,index,native, ...}.js`)
- `pg-protocol` (`dist/{parser,serializer,buffer-reader,buffer-writer,messages,index}.js`)
- `pg-types` (`{index,lib/{arrayParser,binaryParsers,builtins,textParsers}}.js`)
- `pg-cursor/index.js`
- `pg-pool/index.js` (still bundled even though the `pgClient` path doesn't use it)
- `pg-cloudflare/dist/index.js` (Workers-specific socket adapter, auto-pulled by `pg`)
- `pg-connection-string/index.js`, `pg-int8/index.js`
- `@cloudflare/unenv-preset/dist/runtime/node/{console,crypto,process,util}.mjs` + `polyfill/performance.mjs`

PN itself adds (rough estimate, to be confirmed in M3): roughly 20–80 KiB gzipped — wrapper, sql-runtime, sql-builder, ORM, framework-components, contract validation, and arktype tree-shaking output. Total Worker bundle for the example app should comfortably land well under the 1 MiB compressed target in spec NFR3.

## Caveats

- Audit performed against PG 15.10 (Postgres.app on `localhost`), not real Hyperdrive. Real Hyperdrive verification deferred to M4 task 4.2 per spec.
- The spike worker imports `pg` + `pg-cursor` directly rather than through `@prisma-next/postgres/runtime`. This was a deliberate trade-off (see [`wip/m1-spike/scratch.md`](../../../wip/m1-spike/scratch.md)) — getting the full PN workspace resolvable from inside `wip/` would have either polluted the root `pnpm-workspace.yaml` or required tarball plumbing, neither worth the time given that (i) the rest of PN is target-agnostic TS and (ii) M3 will scaffold a real example worker that pulls PN through the workspace and would surface any unexpected module-load issue then.
- Wrangler 3.114.17 emits a warning that compatibility date `2026-04-01` is newer than its installed runtime supports, falling back to `2025-07-18`. Inconsequential for this audit; M3's example worker should pin a compatibility date the installed wrangler supports.
- The wrapper currently caches `runtimeInstance` on the closure ([postgres.ts L151](packages/3-extensions/postgres/src/runtime/postgres.ts)). In Workers, constructing `postgres({...})` at module top-level would share one `pg.Client` across `fetch` invocations within an isolate — wrong. Per-request construction is the correct pattern. **Document in M3's example README and in M4's deployment guide.**

## Open items for the orchestrator's attention

1. **M2 task list shrinks substantially.** Tasks 2.1 (new binding kind) and 2.2 (new driver impl) become no-ops because the topology is (c). Concrete revised M2 scope:
   - 2.1' — extend `PostgresBindingInput` with `hyperdrive: HyperdriveLike` and translate it to the existing `{ kind: 'pgClient', client }` in `binding.ts`.
   - 2.2' — define structural `HyperdriveLike` type (just `{ connectionString: string }` is enough) and export it from the wrapper. Add `@cloudflare/workers-types` as a `devDependency` on the wrapper for typecheck purposes.
   - 2.3 — cursor wiring: per spec Decision §3, **enable cursors on the new path**. Either thread `cursor` through `PostgresBindingOptions` (less invasive) or change the wrapper-level default (cleaner). Decide in M2; either path satisfies AC-4 / TC-8a.
   - 2.4 — wrapper input variant — same scope as the original 2.4.
   - 2.5 — unit tests — TC-6, TC-9, TC-10, TC-11 still apply, just mocked through the existing `PostgresDirectDriverImpl`. TC-25 (driver/codec boundary) is automatically satisfied because no driver-layer change is happening.
   - 2.6 — type plumbing — same as original 2.6.
   - 2.7 — drop; no `architecture.config.json` change is needed (no new package, no new cross-package import).
2. **`runtimeInstance` caching** is a real ergonomic landmine in Workers. M3 task 3.2 should construct `postgres({...})` inside the `fetch` handler (not at module scope), and M3/M4 docs should call this out explicitly. Optionally, M2 could ship a tiny `createPerRequestPostgres(env)` helper, but this is not required for the AC.
3. **Bundle-cost cleanups (optional / post-M4):** `Pool` and `pg-cursor` are statically imported in [postgres-driver.ts](packages/3-targets/7-drivers/postgres/src/postgres-driver.ts). For the Workers path you only need `Client` + (conditionally) `Cursor`. A future refactor to dynamic-import `Pool` (only when a `pgPool`/`url` binding is actually used) would shave a few KiB but is not blocking. Track separately if desired.
4. **`pg-cloudflare` is auto-pulled.** No action needed, but worth noting in the deployment guide that pg's Workers socket adapter is the reason the `Client` actually works in workerd.
5. **Spec Decision §1 update:** the spec already anticipates the audit may push to (c); Decision §1 names (a) as the leading choice, with (b)/(c) as alternatives. Recommend keeping the spec as-is (it explicitly defers to the audit) and recording the (c) outcome only here in the audit + in the close-out notes.
