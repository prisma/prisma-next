# Brief: Port postgres.ts → facade runtime + binding + smoke tests

## Task

Replace the Slice-4 placeholder in `packages/3-extensions/prisma-postgres-serverless/src/exports/runtime.ts` with a real substantive runtime factory by porting `packages/3-extensions/postgres/src/runtime/postgres.ts` (and its sibling `binding.ts`) to the new facade. Five pinned deltas:

1. **Driver swap:** `@prisma-next/driver-postgres/runtime` → `@prisma-next/driver-ppg-serverless/runtime`.
2. **No `pg.Pool` / `pg.Client` imports.** Use `import type { Client as PpgClient } from '@prisma/ppg'`.
3. **Binding has 2 variants** (not 3): `{ url }` or `{ ppgClient }`. Drop the `pgPool` variant entirely.
4. **`PrismaPostgresServerlessOptions` drops the `poolOptions` block.** PPG handles pooling.
5. **`driver.create()` takes no `cursor` option.** Drop the `{ cursor: { disabled: true } }` arg.

The full design — module structure, type signatures, the `Object.assign(Object.create(txCtx), ...)` pattern with its load-bearing comment, the test surface — is at `projects/ppg-serverless/slices/05-facade-runtime/spec.md § Chosen design`. **Re-read it.**

## Scope

**In:**

- `packages/3-extensions/prisma-postgres-serverless/src/runtime/binding.ts` — new (~70 LoC; mirror postgres facade's `binding.ts` with the simplifications listed).
- `packages/3-extensions/prisma-postgres-serverless/src/runtime/prisma-postgres-serverless.ts` — new (~250 LoC; substantive port of `postgres.ts`).
- `packages/3-extensions/prisma-postgres-serverless/src/exports/runtime.ts` — replace Slice 4 stub with real re-exports from `../runtime/prisma-postgres-serverless` and `../runtime/binding`.
- `packages/3-extensions/prisma-postgres-serverless/test/` — new directory with `_fakes.ts` (local fake `Client`/`Session`) + `prisma-postgres-serverless.test.ts` (≥8 smoke tests).
- `architecture.config.json` — one new glob entry for `src/runtime/**` (`domain: extensions, layer: adapters, plane: runtime`).

**Out:**

- `./config` substantive impl — remains as Slice 4 stub.
- `./contract-builder` substantive impl — remains as Slice 4 stub.
- Anything touching `@prisma-next/postgres`, `@prisma-next/driver-ppg-serverless`, or any framework / adapter / target package.
- Integration tests against a live `@prisma/dev` PPG endpoint — Slice 6.
- README polish — Slice 6.

## Completed when

1. `pnpm --filter @prisma-next/prisma-postgres-serverless build` exits 0; emits the same 6 `dist/*.mjs` + 6 `dist/*.d.mts` as Slice 4 (contents change, file count stays).
2. `pnpm --filter @prisma-next/prisma-postgres-serverless test` exits 0. **≥8 tests** covering:
   - Construction with `{ contractJson }`.
   - Construction with `{ contract }`.
   - `sql.from(...).select(...).build()` returns a typed plan (no driver call required).
   - `transaction(fn)` — fn receives a context with `sql` + `orm`; queries route through the transaction.
   - `connect(binding)` — second connect throws "already connected".
   - `close()` — idempotent; second close is a no-op.
   - `[Symbol.asyncDispose]` — delegates to `close()`.
   - End-to-end: facade → driver → mocked PPG → roundtripped row.
3. `pnpm lint:deps` exits 0.
4. `pnpm --filter ... lint` exits 0.
5. `pnpm --filter ... typecheck` exits 0.
6. No `pg` / `@types/pg` in manifest (carryover check):
   ```sh
   jq -r '.dependencies, .devDependencies | keys[]?' packages/3-extensions/prisma-postgres-serverless/package.json | sort -u | grep -E '^(pg|@types/pg)$' && echo "FAIL" || echo "OK"
   ```
7. **No transient project IDs:**
   ```sh
   git diff --cached -U0 -- ':!projects/' | grep -E '^\+' | grep -oE '\b(T[0-9]+\.[0-9]+|TC-?[0-9]+|AC-?[0-9]+|FR[0-9]+|NFR[0-9]+|CKPT-[0-9]+|AM[0-9]+|D[0-9]+|M[0-9]+\.[0-9]+|P[0-9]+ R[0-9]+|M[0-9]+ review|Slice [0-9]+)\b' | sort -u
   ```
   Plus manual prose-attribution sweep. Both must return empty.
8. The runtime export's default function returns a client object with **all of**: `sql`, `orm`, `raw`, `context`, `stack`, `connect`, `runtime`, `transaction`, `prepare`, `close`, `[Symbol.asyncDispose]` — verified by test assertions.
9. No bare `as` casts in production code. `castAs` / `blindCast` with reason strings where needed.

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes go in the same dispatch with a one-line note.

**Source-string rule** (F1/F2/F3 lessons): every string this brief or spec prescribes that lands in source code or README inherits `.agents/rules/no-transient-project-ids-in-code.mdc`. Run the canonical regex + manual prose-attribution sweep before final commit.

## References

- **Slice spec:** [`projects/ppg-serverless/slices/05-facade-runtime/spec.md`](../spec.md).
- **Slice plan:** [`projects/ppg-serverless/slices/05-facade-runtime/plan.md`](../plan.md).
- **Substantive port targets:** [`packages/3-extensions/postgres/src/runtime/postgres.ts`](../../../../../packages/3-extensions/postgres/src/runtime/postgres.ts) (the full factory), [`packages/3-extensions/postgres/src/runtime/binding.ts`](../../../../../packages/3-extensions/postgres/src/runtime/binding.ts) (the binding helpers).
- **Reference tests** (model the smoke tests on these): [`packages/3-extensions/postgres/test/postgres.test.ts`](../../../../../packages/3-extensions/postgres/test/postgres.test.ts), [`packages/3-extensions/postgres/test/postgres-close.test.ts`](../../../../../packages/3-extensions/postgres/test/postgres-close.test.ts).
- **Driver surface (the seam):** [`packages/3-targets/7-drivers/ppg-serverless/src/exports/runtime.ts`](../../../../../packages/3-targets/7-drivers/ppg-serverless/src/exports/runtime.ts) — the `PpgBinding` type (`{ kind: 'url', url } | { kind: 'ppgClient', client }`), the `RuntimeDriverInstance & SqlDriver<PpgBinding>` type, the `create()` factory.
- **Driver test fake (model `_fakes.ts` on this):** [`packages/3-targets/7-drivers/ppg-serverless/test/_fakes.ts`](../../../../../packages/3-targets/7-drivers/ppg-serverless/test/_fakes.ts). Copy a slim subset to the facade's `test/_fakes.ts` — facade tests don't need the connection / transaction / query-history probes; just `newSession` returning a session whose `query` returns canned resultsets.
- **`@prisma-next/sql-runtime`:** the facade uses `createSqlExecutionStack`, `createExecutionContext`, `createRuntime`, `withTransaction`, `instantiateExecutionStack` — read these signatures if the port hits an unfamiliar API.

**Calibration entries that apply:**

- [`drive/calibration/failure-modes.md § F5`](../../../../drive/calibration/failure-modes.md#f5-destructive-git-operations-executed-by-subagents-without-orchestrator-approval) — no destructive git ops.
- [`drive/calibration/grep-library.md § Cross-cutting anti-patterns`](../../../../drive/calibration/grep-library.md#cross-cutting-anti-patterns) — standing rules.

## Edge cases

| Edge case | Disposition |
|---|---|
| **`PpgServerlessBinding` shape vs Slice 4's placeholder `PpgServerlessFacadeBinding`.** Slice 4 published `{ url } | { ppgClient }` without the `kind` discriminant; this slice introduces the canonical `{ kind: 'url' } | { kind: 'ppgClient' }` shape. | Replace the Slice 4 placeholder. The Slice 4 binding was a stub; this slice's binding is the real one. Export `PpgServerlessBinding` from `./runtime` (new name; the Slice 4 `PpgServerlessFacadeBinding` is removed). |
| **`PrismaPostgresServerlessOptions` shape.** Slice 4 stubbed `{ binding: PpgServerlessFacadeBinding }`; the real shape is a union of `{ contract; binding?; url?; ppgClient? }` + `extensions?` + `middleware?` + `verifyMarker?` (no `poolOptions`). | Replace Slice 4's stub completely. The new shape is documented in the spec. |
| **`toRuntimeBinding()` for `{ kind: 'url' }`.** Postgres facade wraps the URL into a `Pool` instance + sets `ownedDispose` to `pool.end()`. PPG has no Pool. | Pass `{ kind: 'url', url }` directly to the driver. `ownedDispose` for `{ kind: 'url' }` is omitted (no resource to dispose). |
| **`getRuntime()` lifecycle.** The lazy closure cache pattern is preserved verbatim from postgres.ts (`runtimeInstance`, `runtimeDriver`, `driverConnected`, `connectPromise`, `backgroundConnectError`, `closed`, `ownedDispose`). | Port verbatim. Don't optimise. |
| **`driver.create()` call signature.** Postgres calls `driverDescriptor.create({ cursor: { disabled: true } })`. PPG driver's `create()` takes either nothing or empty options. | Call `driverDescriptor.create()` with no argument (or `undefined` — equivalent given `TCreateOptions = void` in the driver descriptor). |
| **`prepare()` shape.** Identical to postgres facade — `getRuntime().prepare(declaration, (params) => callback(sql, params))`. PPG's `executePrepared` aliases `execute` at the driver layer; transparent to facade. | Port verbatim. |
| **`runtime.execute(plan)` returns an AsyncIterable from the driver layer** — for ORM, the facade wraps it. | Port verbatim. |
| **Test fake.** Facade tests pass `{ ppgClient: fakeClient }` to the facade's `runtime()`. The fake doesn't need the full surface of the driver's `_fakes.ts` — just `newSession` + a session that returns canned resultsets. | Build a slim local fake at `test/_fakes.ts` — don't reuse driver's `_fakes.ts` via cross-package import. |
| **Destructive git ops forbidden** (F5). |  |

## Operational metadata

- **Model tier:** Recommended: Sonnet (substantive port + new tests + careful preservation of subtle state-machine logic in `getRuntime()`). Past Slice 2 / Slice 3 dispatches were Sonnet-tier and completed cleanly under similar shapes.
- **Time-box:** 120 minutes wall-clock. Overrun → halt and surface.
- **Halt conditions:**
  - `@prisma-next/sql-runtime` API drift makes the port not compile — surface with specific type error.
  - Diff exceeds ~20 files OR ~1000 LoC — surface for re-decomposition.
  - `./config` or `./contract-builder` substantive impls needed to make tests pass — surface; that's out of slice.
  - Any test wants `@prisma/dev` server — surface; mock-only.

## Commit organisation

Use your judgment:

- **Single commit:** `feat(prisma-postgres-serverless): wire runtime factory through driver-ppg-serverless`.
- **Two commits:** (1) src (binding + runtime + exports rewrite + arch config); (2) tests. Lets the reviewer compare expected vs actual behaviour in two passes — recommended for this slice given the test-first iteration is the regression-baseline-equivalent.

Surface your commit choice in the wrap-up.

**No `git add -A`.** **No `--amend`** on prior commits. **No push** (project policy: single PR at project close-out).
