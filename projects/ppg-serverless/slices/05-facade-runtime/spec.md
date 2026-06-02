# Slice: Facade runtime wiring

_Parent project: [`projects/ppg-serverless/`](../../). Outcome this slice contributes: the new facade's `./runtime` export ships a real factory that returns a `PrismaPostgresServerlessClient<TContract>` — same shape as `PostgresClient<TContract>` from `@prisma-next/postgres`, swapping the TCP driver for the PPG-serverless driver. After this slice, a user can compose a working data-plane client end-to-end through the facade. Slice 6 then validates against `@prisma/dev`'s PPG endpoint._

## At a glance

Port `packages/3-extensions/postgres/src/runtime/postgres.ts` to the new facade as the substantive `./runtime` export, with two pinned deltas: (a) driver swap (`@prisma-next/driver-postgres/runtime` → `@prisma-next/driver-ppg-serverless/runtime`), and (b) binding shape from 3 variants down to 2 (drop `pgPool` — PPG handles pooling on the wire side). Also port `binding.ts` (simpler — no `pg.Pool` wrapping, no URL→Pool conversion in `toRuntimeBinding`). Replace Slice 4's `./runtime` placeholder stub with this real factory. Add smoke tests at the facade boundary modelled on `postgres/test/postgres.test.ts` — sql builder round-trip with mocked PPG client, transaction lifecycle wiring, close/asyncDispose semantics. Leave `./config` and `./contract-builder` as the Slice 4 stubs — those are out of scope for this slice and surface to the operator at slice end.

## Chosen design

### `src/runtime/binding.ts`

Mirror `packages/3-extensions/postgres/src/runtime/binding.ts` with three deltas:

1. No `pg.Pool` / `pg.Client` import. Replace with `import type { Client as PpgClient } from '@prisma/ppg'`.
2. `PpgServerlessBinding` has 2 variants instead of 3:
   ```ts
   export type PpgServerlessBinding =
     | { readonly kind: 'url'; readonly url: string }
     | { readonly kind: 'ppgClient'; readonly client: PpgClient };
   ```
3. `PpgServerlessBindingInput` has 2 cases (`{ binding }` or `{ url }`) — no `pg` case. The `instanceof Pool` / `instanceof Client` runtime checks go away; a `{ ppgClient: PpgClient }` input gets the explicit `kind: 'ppgClient'` mapping. Validation of the URL format is preserved (must be `postgres://` or `postgresql://` — same as postgres facade).

### `src/runtime/prisma-postgres-serverless.ts`

Mirror `packages/3-extensions/postgres/src/runtime/postgres.ts` line-by-line with these deltas:

1. **Imports:**
   - Drop `import { type Client, Pool } from 'pg'` and `import postgresDriver from '@prisma-next/driver-postgres/runtime'`.
   - Add `import ppgDriver from '@prisma-next/driver-ppg-serverless/runtime'`.
   - Import binding helpers from `./binding` (the new local module).

2. **`PrismaPostgresServerlessClient<TContract>` interface:** same as `PostgresClient<TContract>` (sql, orm, raw, context, stack, connect, runtime, transaction, prepare, close, [Symbol.asyncDispose]) — no methods dropped. Rename only.

3. **`PrismaPostgresServerlessOptions<TContract>`:** same shape as `PostgresOptions<TContract>` minus the `poolOptions` block (no Pool to configure). All other options (`extensions`, `middleware`, `verifyMarker`, `contract` / `contractJson`) pass through unchanged.

4. **`toRuntimeBinding()`:** simpler — for `{ kind: 'url' }`, pass directly to the driver as `{ kind: 'url', url }`. No Pool wrapping. For `{ kind: 'ppgClient' }`, pass directly.

5. **`ownedDispose`:** only set when the facade owns the lifecycle. For `{ kind: 'url' }`, the PPG `client(config)` factory is synchronous and produces no persistent resource (sessions are per-call) — the driver's `close()` is enough cleanup. `ownedDispose` collapses to a no-op or is removed.

6. **`driver.create({ cursor: { disabled: true } })`:** no `cursor` option on PPG. Drop the `create()` arg or pass `undefined`.

7. **Transaction wiring:** identical to postgres — `withTransaction` from `@prisma-next/sql-runtime`, `sqlBuilder` rebound, `ormBuilder` rebound against `txCtx.execute`, transaction context as Object.assign-prototype.

8. **Closure-cached runtime/driver lifecycle:** identical to postgres — `getRuntime()` lazily constructs on first call; `connect()` reads optional binding from `options.binding/url/ppgClient` or accepts it via the argument; `close()` awaits any pending connect and runs `ownedDispose`.

The substantive 95% of the code is byte-identical to postgres.ts with `Postgres*` → `PrismaPostgresServerless*` / `PpgServerless*` rename and the binding-shape adjustment.

### `src/exports/runtime.ts` (replace Slice 4 stub)

```ts
export type { PpgServerlessBinding } from '../runtime/binding';
export type {
  PrismaPostgresServerlessClient,
  PrismaPostgresServerlessOptions,
  PrismaPostgresServerlessOptionsBase,
  PrismaPostgresServerlessOptionsWithContract,
  PrismaPostgresServerlessOptionsWithContractJson,
} from '../runtime/prisma-postgres-serverless';
export { default } from '../runtime/prisma-postgres-serverless';
```

(Replaces the Slice 4 placeholder. The exports map in `package.json` doesn't change.)

### `src/exports/config.ts` and `src/exports/contract-builder.ts`

**Unchanged from Slice 4** — still stubs. Surfaced to operator at slice end as Open Question.

### `architecture.config.json` delta

Two new glob entries for the new `src/runtime/**` directory (mirroring postgres facade's `src/runtime/**` entry at line ~303):

```jsonc
{
  "glob": "packages/3-extensions/prisma-postgres-serverless/src/runtime/**",
  "domain": "extensions",
  "layer": "adapters",
  "plane": "runtime"
}
```

(One entry for the whole directory — the runtime files are all runtime-plane.)

### Test surface (`test/`)

Smoke tests at facade boundary mirroring `postgres/test/postgres.test.ts`. Cover:

- Facade construction with `{ contractJson }` and `{ contract }` — both return a client.
- `sql.from(table).select(...).build()` round-trip — no driver call, just contract → sql-builder typing.
- `transaction(fn)` — facade routes through `withTransaction`, the transaction context exposes `sql` and `orm` rebound to the tx execute function.
- `connect(binding)` — driver receives the binding, marked connected.
- `close()` — driver close + ownedDispose (no-op for `{ kind: 'url' }` in this driver).
- `[Symbol.asyncDispose]` — delegates to close().
- Mocking strategy: pass `{ kind: 'ppgClient', client: fakePpgClient }` binding. The fake client is the one from `packages/3-targets/7-drivers/ppg-serverless/test/_fakes.ts` — reuse via a path-based import (the facade tests don't have access to the driver's internal test utilities by convention, so likely a local copy or a slimmer fake at `test/_fakes.ts` in the facade package).

Expected test count: 8–12.

### Module structure delta

```
packages/3-extensions/prisma-postgres-serverless/src/
├── exports/
│   ├── config.ts                              # Slice 4 stub, unchanged
│   ├── contract-builder.ts                    # Slice 4 stub, unchanged
│   ├── family.ts                              # Slice 4 one-liner, unchanged
│   ├── migration.ts                           # Slice 4 one-liner, unchanged
│   ├── runtime.ts                             # major change — replace stub with real exports
│   └── target.ts                              # Slice 4 one-liner, unchanged
└── runtime/                                   # NEW directory
    ├── binding.ts                             # NEW
    └── prisma-postgres-serverless.ts          # NEW (ported postgres.ts)
```

## Coherence rationale

One PR-shaped unit: the facade's substantive runtime materializes here, with shape-parity to `@prisma-next/postgres`'s `runtime()`. Splitting (e.g. "binding now, runtime next slice") leaves the slice mid-implementation; the runtime needs the binding's resolved shape and the binding type signature. One reviewer holds the coherence: "facade runtime works through a mocked PPG driver; transactions wire correctly; close semantics are clean."

## Scope

**In:**

- `packages/3-extensions/prisma-postgres-serverless/src/runtime/binding.ts` — new.
- `packages/3-extensions/prisma-postgres-serverless/src/runtime/prisma-postgres-serverless.ts` — new (ported postgres.ts).
- `packages/3-extensions/prisma-postgres-serverless/src/exports/runtime.ts` — replace Slice 4 stub with real re-exports.
- `packages/3-extensions/prisma-postgres-serverless/test/` — new directory with smoke tests + a local fake PPG client helper.
- `architecture.config.json` — one new glob entry for `src/runtime/**`.

**Out:**

- `./config` and `./contract-builder` substantive impls — remain as Slice 4 stubs. Surfaced to operator at slice end (see Open Question 1).
- Integration tests against `@prisma/dev`'s PPG endpoint — Slice 6.
- README polish — Slice 6.
- Updates to driver-ppg-serverless or postgres facade.
- The `postgres-serverless.ts` per-request pattern from `@prisma-next/postgres/src/runtime/postgres-serverless.ts` — out per project spec D3 (no `./serverless` export; the package name is the signal, and the base `./runtime` IS the edge-safe entrypoint for this facade).

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
|---|---|---|
| PPG `client(config)` is sync; `Client` has no `.close()`. | `ownedDispose` for `{ kind: 'url' }` is a no-op (or omitted entirely). Driver's `close()` is the only teardown. | Driver-side close was settled in Slice 2; facade just calls it. |
| Test fake reuse from driver package. | The facade tests can either (a) duplicate a slim fake locally, or (b) cross-package import from `@prisma-next/driver-ppg-serverless/test/...`. The codebase convention is (a) — package test directories are not typically shared. Local copy in `test/_fakes.ts`. | Mirrors how postgres facade tests duplicate fakes from driver-postgres tests. |
| `connect()` race: closure-cached driver is created lazily on `getRuntime()`; if `connect()` is called before any query, the driver materializes through `getRuntime()` then `connectDriver()` runs. | Identical to postgres pattern — both code paths handled correctly there. Port the same `connectPromise` / `driverConnected` state machine. | Don't optimise; port. |
| `transaction()` returns `PrismaPostgresServerlessTransactionContext<TContract>` with `sql` and `orm` re-bound to the transaction's `execute`. The `Object.assign(Object.create(txCtx), { sql, orm })` pattern from postgres preserves the live `invalidated` getter. | Port verbatim. The comment on the pattern in postgres.ts is load-bearing context. | Keep the comment. |
| `prepare()` — runs through `getRuntime().prepare(...)` with the sql builder closure. PPG doesn't have server-side prepared statements (Slice 2's D2 — `executePrepared` collapses to `execute`). The facade's `prepare()` still works as a typed-statement helper; the underlying driver just runs it ad-hoc. | Identical surface to postgres; behaviour differs only at the driver layer (transparently). | No facade-level change. |

## Slice-specific done conditions

- [ ] `pnpm --filter @prisma-next/prisma-postgres-serverless test` passes the new smoke tests (≥8 tests covering construction, sql builder, transaction, connect, close, asyncDispose).
- [ ] `pnpm lint:deps` green (one new arch-config entry).
- [ ] The facade's `runtime()` factory has shape-parity with `@prisma-next/postgres`'s `postgres()` factory — same options surface (minus `poolOptions`), same returned client interface (`sql`, `orm`, `raw`, `context`, `stack`, `connect`, `runtime`, `transaction`, `prepare`, `close`, `[Symbol.asyncDispose]`).

CI-green, reviewer-accept, project-DoD floor (no `pg` / `@types/pg`; no bare `as`; no transient project IDs) inherited.

## Open Questions

1. **`./config` and `./contract-builder` substantive impls — defer to Slice 6 (close-out) or accept as stubs through project DoD?** Working position: **accept as stubs through project DoD** unless the operator wants them filled in. Rationale: the project plan's Slice 5 wording focuses on `./runtime` shape parity; `./config`'s substantive impl hits the "no control driver" dilemma (project plan bars `@prisma-next/driver-postgres` from the facade's deps, but `coreDefineConfig` requires a control driver field — surfaceable design decision). Users wanting a config helper can use `@prisma-next/postgres`'s `defineConfig` directly with a TCP URL (per D4 — the project explicitly endorses this path). `./contract-builder` is mostly identity-transform type machinery; less load-bearing. Either both stay as stubs (documented limitation) or Slice 6 fills them in with either (a) a runtime-only `defineConfig` that omits the control driver field, or (b) a `defineConfig` that accepts a user-supplied control driver as an option.
2. **Facade test fake — local copy or shared utility?** Working position: **local copy** at `test/_fakes.ts` (mirrors postgres facade's pattern). Cross-package test imports add noise without value. _Override: if the driver's fake is genuinely identical to what the facade needs, consider hoisting to a shared `@prisma-next/test-utils` helper._
3. **`prepare()` shape parity — does the SqlDriver's `executePrepared` (which collapses to `execute` for PPG per D2) work with the facade's `prepare()` API?** Working position: **yes** — the facade's `prepare()` returns a typed `PreparedStatement` wrapper that calls `runtime.prepare()`; downstream the driver's `executePrepared` is called via the prepared-statement adapter. The collapse happens at the driver layer transparently. The facade's API is unchanged. _Verify by reading `@prisma-next/sql-runtime`'s `runtime.prepare()` impl if uncertain._

## References

- Parent project: [`projects/ppg-serverless/spec.md`](../../spec.md) — FR2 (facade exports), D1 (WS-only), D2 (executePrepared collapses).
- Slice plan: [`projects/ppg-serverless/plan.md`](../../plan.md) § Slice 5.
- Prior slices: [`projects/ppg-serverless/slices/04-facade-scaffold/spec.md`](../04-facade-scaffold/spec.md) (the scaffold this slice fills in).
- Reference template (the substantive port target): [`packages/3-extensions/postgres/src/runtime/postgres.ts`](../../../../packages/3-extensions/postgres/src/runtime/postgres.ts), [`packages/3-extensions/postgres/src/runtime/binding.ts`](../../../../packages/3-extensions/postgres/src/runtime/binding.ts).
- Reference tests: [`packages/3-extensions/postgres/test/postgres.test.ts`](../../../../packages/3-extensions/postgres/test/postgres.test.ts), [`packages/3-extensions/postgres/test/postgres-close.test.ts`](../../../../packages/3-extensions/postgres/test/postgres-close.test.ts), [`packages/3-extensions/postgres/test/transaction.types.test-d.ts`](../../../../packages/3-extensions/postgres/test/transaction.types.test-d.ts).
- Driver runtime (the seam this slice wires to): [`packages/3-targets/7-drivers/ppg-serverless/src/exports/runtime.ts`](../../../../packages/3-targets/7-drivers/ppg-serverless/src/exports/runtime.ts) — descriptor, `PpgBinding`, unbound wrapper.
- `@prisma-next/sql-runtime` surface (`createRuntime`, `withTransaction`, etc.): [`packages/2-sql/4-lanes/sql-runtime/src/`](../../../../packages/2-sql/4-lanes/sql-runtime/src/) — read only if the port hits an unfamiliar API.

## Adapter-impact section

**Adapters affected:** None. Facade wires the existing `@prisma-next/adapter-postgres` and `@prisma-next/target-postgres` packs unchanged.
