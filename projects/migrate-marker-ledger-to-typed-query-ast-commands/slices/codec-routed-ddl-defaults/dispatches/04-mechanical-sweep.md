# Brief: D4 — Mechanical sweep: ExecutableStatement renames, interface fix, SerializedQueryPlan subsumption, review quick wins

## What this dispatch does

The PR #794 review round (artifacts under `../reviews/pr-794/`; design decisions in the spec's 2026-06-09 amendment) settled a set of renames and small fixes. This dispatch is the mechanical sweep — no codec wiring (D5), no bootstrap migration or walker deletion (D6). Everything here is rename / relocate / small-guard work that the later dispatches build on.

## Concrete changes

### 1. Renames (repo-wide, including tests and doc comments)

| Old | New |
| --- | --- |
| `DriverStatement` (type, `relational-core/src/ast/types.ts`) | `ExecutableStatement` |
| `lowerToDriverStatement` (method, everywhere) | `lowerToExecutableStatement` |
| `DdlDriverLowerer` (interface, `family-sql/src/core/control-adapter.ts`) | `ExecutableStatementLowerer` |

Internal helper names follow (e.g. `pgRenderDdlDriverStatement` → `pgRenderDdlExecutableStatement`, `PgDdlDriverStatementVisitor` → `PgDdlExecutableStatementVisitor`, same for SQLite; test file names `lower-to-driver-statement.test.ts` → `lower-to-executable-statement.test.ts`). Update doc comments that say "driver-ready statement" to name executability as the property: all values encoded, nothing left to transform before execution.

### 2. `SqlControlAdapter extends ExecutableStatementLowerer`

`packages/2-sql/9-family/src/core/control-adapter.ts`: `SqlControlAdapter` currently re-declares `lowerToDriverStatement` (line ~258) with the identical signature `ExecutableStatementLowerer` declares. Change `SqlControlAdapter` to extend `ExecutableStatementLowerer` and delete the duplicate declaration. (It already extends `ControlAdapterInstance<'sql', TTarget>` — interfaces support multiple extends.)

### 3. Subsume `SerializedQueryPlan`

- Delete `SerializedQueryPlan` from `packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts` (~line 91) and its re-export from `framework-components/src/exports/control.ts` (~line 50).
- Its only production consumer is `packages/3-targets/3-targets/postgres/src/core/migrations/operations/data-transform.ts` (import at line 64, return type at line 155). Replace with `ExecutableStatement` imported from `@prisma-next/sql-relational-core/ast`.
- The shape is identical (`{sql: string, params: readonly unknown[]}`), so this is type-level only — no behavior change. If the `params` mutability/readonly variance differs, conform the consumer.
- Grep for any other `SerializedQueryPlan` references (tests, docs, d.ts mappings) and update.

### 4. Review quick wins

1. **`isThenable` helper** — add to `@prisma-next/utils` (a new `promise.ts` module or alongside existing helpers; follow the package's layout):
   ```ts
   export function isThenable<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
     return typeof (value as { then?: unknown } | null)?.then === 'function';
   }
   ```
   Replace `instanceof Promise` at:
   - `packages/2-sql/9-family/src/core/sql-migration.ts:35` (the `providedInvariants` filter — flip the predicate accordingly)
   - `packages/3-targets/3-targets/postgres/src/core/migrations/render-ops.ts:37`
   Grep for any other `instanceof Promise` in production code added by this branch and replace.

2. **`ifDefined`** — `packages/3-targets/3-targets/sqlite/src/core/migrations/op-factory-call.ts` (~line 150) and the PG equivalent in `packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts`: replace `...(this.constraints ? { constraints: this.constraints } : {})` with the `ifDefined` helper from `@prisma-next/utils/defined`. Check its exact call shape from existing usages before writing.

3. **Delete mechanical re-export tests** — `packages/3-extensions/sqlite/test/migration/re-export.test.ts`. Check for a PG twin (`packages/3-extensions/postgres/test/migration/re-export.test.ts`) and delete it too if it has the same export-parity shape. If the PG file also contains non-parity assertions, delete only the parity ones.

4. **SQLite `renderOps` target assertion** — PG's `renderOps` has `assertPostgresOp` (fails loudly when a stray op targets a different target). SQLite's `renderOps` (`packages/3-targets/3-targets/sqlite/src/core/migrations/render-ops.ts`) lacks the equivalent. Add `assertSqliteOp` with the same shape, applied on both the sync and thenable branches.

5. **Non-finite-number guard in `sqliteInlineLiteral`** — `packages/3-targets/6-adapters/sqlite/src/core/control-adapter.ts`: PG's `pgInlineLiteral` throws on `NaN` / `±Infinity`; SQLite's helper doesn't. Add the same guard with a parallel message. Add the matching unit test (PG has one in its `lower-to-*` test file).

6. **Invalid-`Date` guard** — both inline-literal helpers call `value.toISOString()` on `Date` wires; an invalid Date throws an opaque `RangeError`. Guard with `Number.isNaN(value.getTime())` and throw a named error stating the column context available at that point.

7. **`Uint8Array` cast uses native type** — PG's `pgInlineLiteral` hardcodes `'\\x…'::bytea`. Use `::${nativeType}` instead (identical for bytea columns; correct for binary-wire custom types). SQLite has no cast syntax — unchanged.

8. **Byte-parity test rename** — `packages/3-targets/6-adapters/sqlite/test/migrations/create-table-call-byte-parity.test.ts`: the review found the name overpromises (it no longer compares against the pre-slice path). Rename file + describe blocks to what it pins now (e.g. `create-table-call-lowering.test.ts`, "CreateTableCall lowering output"). Don't change assertions.

## Out of scope

- Codec wiring, `DdlColumn.codecRef`, `{ contract: {} }` removal, operations memoization, fixtures (all D5).
- Marker/ledger bootstrap migration, `lower()` rejecting DDL, old DDL renderer deletion (all D6).
- The old renderer files (`ddl-renderer.ts` both adapters) — untouched in this dispatch.
- Runtime query path (`lower()`, `LoweredStatement`, `LoweredParam`, 5-runtime) — untouched as ever.

## Completed when

- [ ] Zero occurrences of `DriverStatement`, `lowerToDriverStatement`, `DdlDriverLowerer` anywhere (`git grep` clean, including test file names).
- [ ] `SqlControlAdapter extends ExecutableStatementLowerer`; no duplicate method declaration.
- [ ] `SerializedQueryPlan` deleted from framework-components; data-transform.ts uses `ExecutableStatement`; `git grep SerializedQueryPlan` clean.
- [ ] `isThenable` in `@prisma-next/utils` with unit test; zero `instanceof Promise` in this branch's production additions.
- [ ] `ifDefined` at both constraint-spread sites.
- [ ] Re-export parity tests deleted (SQLite + PG twin if present).
- [ ] SQLite `renderOps` asserts target id (both branches).
- [ ] `sqliteInlineLiteral` non-finite guard + test; both helpers guard invalid Date; PG `Uint8Array` casts `::${nativeType}`.
- [ ] Byte-parity test renamed.
- [ ] `pnpm typecheck` green workspace-wide; `pnpm test:packages` green; `pnpm fixtures:check` green (no regens expected); `pnpm lint:deps` + `pnpm lint:casts` green (no new bare casts).

## Halt conditions

- `SerializedQueryPlan` turns out to have consumers beyond data-transform.ts that can't import from relational-core (layering) — halt with the list.
- Any change wants to touch `ddl-renderer.ts`, the runtime path, or codec resolution — halt; wrong dispatch.
- More than 35 files (renames fan out, so the budget is higher than usual) — halt.
- 200+ tool calls without committing — halt.

## References

- **Spec (incl. 2026-06-09 amendment):** `../spec.md`
- **Plan (incl. amendment):** `../plan.md` § Dispatch 4
- **Review artifacts:** `../reviews/pr-794/` (`system-design-review.md` for the rename rationale; `code-review.md` F5/F6/F7/F10/F12/F13/F14)

## Operational metadata

- **Model tier:** sonnet — mechanical.
- **Time-box:** 90 minutes. **Tool-call budget:** 200 before committing intermediate state.

## Repo standing constraints

- Worktree: `/Users/wmadden/Projects/prisma/prisma-next/.claude/worktrees/adoring-swartz-9d66c0`. Branch: `tml-2867-codec-routed-ddl-defaults`.
- `pnpm`, never `npm`/`npx`. No bare `as` casts in production (`blindCast<T,'reason'>` if unavoidable; renames must preserve existing blindCast reason strings' accuracy). No TS import file extensions. No transient project refs in code or comments.

## Commit + sign-off

Commit on `tml-2867-codec-routed-ddl-defaults` (split into 2–3 focused commits if natural: renames+extends+subsumption / quick wins). Sign off as `Will Madden <madden@prisma.io>`. End with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
