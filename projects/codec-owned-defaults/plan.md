# Codec-owned column defaults

## Summary

Reshape the contract IR's `ColumnDefault` to `{ kind: 'expression'; expression: string } | { kind: 'autoincrement' }` and move literal-rendering responsibility onto a required `renderSqlLiteral(value: TInput): string` method on the SQL codec interface. The `expression` branch carries every default that lowers to a `DEFAULT (<expr>)` clause — codec-rendered literals and raw function-form expressions alike. The `autoincrement` branch is a payload-free sentinel for the one default that doesn't emit a `DEFAULT` clause at all (it's realized as SERIAL/IDENTITY / INTEGER PRIMARY KEY AUTOINCREMENT at the column type). The legacy `kind: 'literal'`/`value: JsonValue` payload is removed. Both authoring surfaces (TS DSL, PSL) lower literals through codec methods at emit time. Success means: dialect coverage enforced at type-check time, no `decodeContractDefaults` runtime pass, autoincrement still works, and Mongo untouched.

**Spec:** [spec.md](./spec.md)

## Collaborators

| Role         | Person/Team                    | Context                                                                |
| ------------ | ------------------------------ | ---------------------------------------------------------------------- |
| Maker        | Serhii Tatarintsev             | Drives execution                                                       |
| Reviewer     | _TBD — see Open Items_         | Architectural review of the codec-interface change                     |
| Collaborator | Anyone touching SQL codecs     | Postgres/SQLite codec authors will need to add `renderSqlLiteral`      |
| Collaborator | PSL authoring owners           | PSL parser + printer paths flip atomically with the IR                 |

## Shipping Strategy

This is a workspace-internal change (no external consumers of `contract.json` exist outside the repo). The implicit gate between old and new behaviour is the contract IR shape itself — when the validator flips to `{ kind: 'expression'; expression: string } | { kind: 'autoincrement' }`, every producer (TS DSL emitter, PSL parser) must produce the new shape in lockstep, and every consumer (DDL renderer, PSL printer) must read it.

The plan separates milestones by what can land independently:

- **M1** is purely additive: every SQL codec gains `renderSqlLiteral`, and the factory requires it. No producer or consumer of `ColumnDefault` changes yet — DDL rendering still runs through the existing `renderDefaultLiteral` per-type logic. Safe to ship alone; if anything went wrong, no behavior has changed.
- **M2** is the atomic flip. The IR shape, both authoring surfaces, both DDL renderers, the type re-homing, the literal-pass for `null`, the diagnostic for `NULL` on `NOT NULL`, and `decodeContractDefaults` removal all land together. Fixtures are regenerated as part of the same change so `pnpm fixtures:check` proves the shape on disk. No feature flag — the test suite and `fixtures:check` are the shipping gate.
- **M3** is doc/cleanup, behaviour unchanged.

No backward-compat shims, in line with project policy: call sites flip in lockstep with the IR.

## Test Design

Test cases derived from the spec's acceptance criteria (Contract IR, SQL Codec, Authoring TS DSL, Authoring PSL, Semantics & Diagnostics, Mongo, Quality Gates) and from the Security non-functional section (adversarial inputs).

| AC          | TC    | Test Case                                                                                                                        | Type                | Milestone | Expected Outcome                                                                            |
| ----------- | ----- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------- | --------- | ------------------------------------------------------------------------------------------- |
| AC-CODEC-1  | TC-1  | SQL codec interface declares `renderSqlLiteral(value: TInput): string` as a required method                                       | Type test           | M1        | Property exists; signature matches `TInput → string`                                        |
| AC-CODEC-2  | TC-2  | SQL codec factory rejects construction of any codec missing `renderSqlLiteral`                                                    | Negative type test  | M1        | Compile error when factory input omits the method                                           |
| AC-CODEC-3  | TC-3  | Each Postgres codec's `renderSqlLiteral` produces the expected dialect-specific expression for representative inputs              | Unit                | M1        | Output strings match expected DDL fragments                                                 |
| AC-CODEC-4  | TC-4  | Each SQLite codec's `renderSqlLiteral` produces the expected dialect-specific expression for representative inputs                | Unit                | M1        | Output strings match expected DDL fragments                                                 |
| AC-CODEC-5  | TC-5  | No codec implementation throws at runtime for valid `TInput` values                                                                | Unit                | M1        | Each codec returns a string                                                                 |
| AC-CODEC-6  | TC-6  | Codec renderers correctly escape adversarial inputs: single quotes, backslashes, NULL bytes, unicode (Security NFR)                | Unit                | M1        | Output safely escaped per dialect; round-trips through the database                          |
| AC-IR-1     | TC-7  | Arktype `ColumnDefaultSchema` accepts `{ kind: 'expression', expression: string }` and `{ kind: 'autoincrement' }`, and rejects the legacy `{ kind: 'literal', value }` / `{ kind: 'function', expression }` shapes | Unit                | M2        | Validation passes for new shape; fails for legacy                                           |
| AC-IR-2     | TC-8  | `ColumnDefault`, `ColumnDefaultLiteralValue`, `ColumnDefaultLiteralInputValue` are exported only from `packages/2-sql/1-core/contract/src/`; not exported from framework foundation | Static (import)     | M2        | Imports resolve from SQL package; no framework export                                       |
| AC-IR-3     | TC-9  | All fixture contracts (`test/integration/test/**/contract.json` and equivalent) emit only the new shape for column defaults: every default is either `{ kind: 'expression', expression }` or `{ kind: 'autoincrement' }` | Integration         | M2        | All fixture contracts match new shape; no `value` field, no `literal`/`function` kinds      |
| AC-IR-4     | TC-10 | `pnpm fixtures:check` passes                                                                                                      | Integration         | M2        | Exit 0                                                                                      |
| AC-TS-1     | TC-11 | TS DSL `.default(literal)` produces a contract whose `default` is `{ kind: 'expression', expression: <rendered SQL string> }`. TS DSL `.default(autoincrement())` on a codec carrying the `autoincrement` trait lowers to `{ kind: 'autoincrement' }`. | Integration         | M2        | Emitted `contract.json` carries the union shape only; no `value` field                       |
| AC-TS (new) | TC-11a | TS DSL: `.default(autoincrement())` compiles on column builders whose codec carries the `autoincrement` trait (e.g. `pg/int4@1`, `sqlite/integer@1`) and fails to compile on builders whose codec does not (e.g. `pg/text@1`, `pg/bool@1`) | Type test (±)      | M2        | Compiles for trait-bearing codecs; compile error for others                                  |
| AC-TS-2 (+) | TC-12 | TS DSL `.default(matchingTInput)` compiles for representative codecs (string, int, bool, Date, bigint, Buffer, json)              | Type test (+)       | M2        | Compiles                                                                                    |
| AC-TS-2 (−) | TC-13 | TS DSL `.default(invalidValue)` fails to compile across the same representative codecs                                            | Type test (−)       | M2        | Compile error                                                                                |
| AC-PSL-1    | TC-14 | PSL literal-default lowering invokes `codec.decodeJson(jsonValue)` then `codec.renderSqlLiteral(decoded)`                          | Unit                | M2        | Spy verifies call order; final `default` is `{ kind: 'expression', expression }`             |
| AC-PSL-2    | TC-15 | PSL `@default(true)` on an int column emits a diagnostic naming the column path, codec id, and PSL source `file:line`             | Unit                | M2        | Diagnostic message contains all three fields                                                 |
| AC-PSL-3    | TC-16 | PSL `@default(now())` lands as `{ kind: 'expression', expression: 'now()' }` without invoking codec methods. PSL `@default(autoincrement())` on a column whose codec carries the `autoincrement` trait lowers to `{ kind: 'autoincrement' }`; on a column whose codec lacks the trait, PSL emits a diagnostic naming the column, codec id, and PSL source location. | Unit                | M2        | Function-form bypasses codec; autoincrement gated on trait                                   |
| AC-PSL-4    | TC-17 | PSL printer reads the new `ColumnDefault` union: `{ kind: 'autoincrement' }` prints as `@default(autoincrement())`; `{ kind: 'expression', expression }` maps known sentinels via `DEFAULT_FUNCTION_ATTRIBUTES`, otherwise raw-expression form | Unit                | M2        | Printer output handles both branches                                                         |
| AC-PSL-4    | TC-18 | PSL → contract → PSL round-trip survives without crashing (literal form may differ)                                                | Integration         | M2        | No errors; second-pass contract semantically equivalent                                      |
| AC-SEM-1    | TC-19 | NOT NULL column with a `null` literal default is rejected before codec dispatch with a diagnostic naming the column                | Unit                | M2        | Diagnostic raised; `codec.renderSqlLiteral` not called                                       |
| AC-SEM-2    | TC-20 | Nullable column with a `null` literal default renders to `{ kind: 'expression', expression: 'NULL' }` without invoking the codec   | Unit                | M2        | Codec not invoked; expression is `"NULL"`                                                    |
| AC-SEM-3    | TC-21 | `decodeContractDefaults` no longer exists in `packages/2-sql/1-core/contract/src/validate.ts`                                       | Static (grep)       | M2        | Symbol absent                                                                                |
| AC-SEM-4    | TC-22 | `Date`, `bigint`, `Buffer`, JSON values render to expected Postgres SQL expressions                                                | Unit                | M1        | Specific expression strings match (covered as part of TC-3)                                  |
| AC-SEM-4    | TC-23 | `Date`, `bigint`, `Buffer`, JSON values render to expected SQLite SQL expressions                                                  | Unit                | M1        | Specific expression strings match (covered as part of TC-4)                                  |
| AC-MONGO-1  | TC-24 | Mongo codec interface (`mongo-codec/src/codecs.ts`) and Mongo concrete codecs are unchanged in surface                              | Static (diff check) | M2        | No surface-level diff to Mongo codec types                                                   |
| AC-MONGO-2  | TC-25 | Mongo authoring/emission tests pass after the change                                                                              | Integration         | M2        | Existing Mongo test suite green                                                              |
| AC-QA-1     | TC-26 | `pnpm typecheck` passes across the workspace                                                                                       | Validation gate     | M2        | Exit 0                                                                                      |
| AC-QA-2     | TC-27 | `pnpm lint` passes across all packages                                                                                             | Validation gate     | M2        | Exit 0                                                                                      |
| AC-QA-3     | TC-28 | `pnpm lint:deps` passes (no new layering violations)                                                                                | Validation gate     | M2        | Exit 0                                                                                      |
| AC-QA-4     | TC-29 | `pnpm test:packages` passes                                                                                                         | Validation gate     | M2        | Exit 0                                                                                      |
| AC-QA-5     | TC-30 | `pnpm test:e2e` passes (covers Postgres DDL emission end-to-end)                                                                   | Validation gate     | M2        | Exit 0                                                                                      |
| AC-QA-6     | TC-31 | No new `any`, `@ts-expect-error` (outside negative type tests), or `as unknown as` introduced                                       | Static (lint+grep)  | M3        | No new instances                                                                             |
| AC-IR-1 / AC-SEM (new) | TC-32 | DDL renderer emits no `DEFAULT` clause for `{ kind: 'autoincrement' }` on Postgres and SQLite; column-type SERIAL/IDENTITY (Postgres) and INTEGER PRIMARY KEY AUTOINCREMENT (SQLite) emission is unchanged | Integration (DDL)   | M2        | Generated DDL omits the `DEFAULT` clause; SERIAL/AUTOINCREMENT column-type semantics intact  |

## Milestones

### Milestone 1: SQL codec foundation — `renderSqlLiteral` required

Adds `renderSqlLiteral(value: TInput): string` to the SQL codec interface, makes it required at the codec factory, and implements it on every Postgres and SQLite codec with adversarial-input unit tests. Purely additive — no producer or consumer of `ColumnDefault` changes yet. The DDL renderer continues to use its existing `renderDefaultLiteral` per-type logic until M2.

Demonstrable: a unit test calls `pgCodec.renderSqlLiteral(value)` and asserts the dialect-specific expression. The compile-time negative test demonstrates the factory rejects codecs missing the method.

**Tasks:**

- [ ] Add `renderSqlLiteral(value: TInput): string` to the SQL `Codec` interface in `packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts` (satisfies TC-1)
- [ ] Update the SQL codec factory in `packages/2-sql/4-lanes/relational-core/src/ast/codec-factory.ts` to require `renderSqlLiteral` on the input config (satisfies TC-2; downstream type-check failure surfaces missing implementations)
- [ ] Add a negative type test asserting the factory rejects a config that omits `renderSqlLiteral` (satisfies TC-2)
- [ ] Implement `renderSqlLiteral` on the SQL base codecs in `packages/2-sql/4-lanes/relational-core/src/ast/sql-codecs.ts` (`sql/char@1`, `sql/varchar@1`, `sql/int@1`, `sql/float@1`, `sql/text@1`, `sql/timestamp@1`, and any others present); add unit tests including adversarial inputs (satisfies TC-3/TC-4 indirectly via aliasing, TC-5, TC-6)
- [ ] Implement `renderSqlLiteral` on every Postgres codec in `packages/3-targets/3-targets/postgres/src/core/codecs.ts` (`pg/text@1`, `pg/int4@1`, `pg/int2@1`, `pg/int8@1`, `pg/float4@1`, `pg/float8@1`, `pg/bool@1`, `pg/enum@1`, `pg/json@1`, `pg/jsonb@1`, plus any aliased-from-base codecs); tag the integer codecs (`pg/int2@1`, `pg/int4@1`, `pg/int8@1`) with the `autoincrement` trait. Codecs that need their native type for casts (e.g. `pg/jsonb@1` producing `'<...>'::jsonb`) read it from their own descriptor's `meta.db.sql.postgres.nativeType` — no signature widening needed. `pg/enum@1` is an exception (no `meta`; enum type name is per-enum, not codec-static): emit bare `'<value>'` and rely on Postgres's column-context cast in DDL — sufficient for `DEFAULT` emission. Add unit tests covering valid inputs and adversarial inputs (quotes, backslashes, NULL bytes, unicode) per codec (satisfies TC-3, TC-5, TC-6, TC-22)
- [ ] Implement `renderSqlLiteral` on every SQLite codec in `packages/3-targets/3-targets/sqlite/src/core/codecs.ts` (`sqlite/text@1`, `sqlite/integer@1`, `sqlite/real@1`, `sqlite/blob@1`, `sqlite/datetime@1`, `sqlite/json@1`, `sqlite/bigint@1`); tag `sqlite/integer@1` only with the `autoincrement` trait. Add unit tests including adversarial inputs (satisfies TC-4, TC-5, TC-6, TC-23)
- [ ] Implement `renderSqlLiteral` on the pgvector extension codec in `packages/3-extensions/pgvector/src/core/codecs.ts` (`pg/vector@1`) with adversarial-input unit tests (satisfies TC-3, TC-5, TC-6 for vector)
- [ ] Implement `renderSqlLiteral` on the arktype-json extension codec in `packages/3-extensions/arktype-json/src/core/arktype-json-codec.ts` (`arktype/json@1`). Note this codec is constructed inside a per-typeParams factory function (`arktypeJsonCodecForSchema`), so the implementation must be present at the call to the SQL `codec(...)` factory; add adversarial-input tests (satisfies TC-3, TC-5, TC-6 for arktype-json)

**Validation gate:**

- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm lint`

### Milestone 2: IR collapse, authoring lower-through-codec, DDL switch

The atomic flip. `ColumnDefault` collapses to `{ expression: string }`. Both authoring surfaces lower literals through `renderSqlLiteral` (TS DSL) or `decodeJson + renderSqlLiteral` (PSL). DDL renderers in Postgres and SQLite read `expression` directly. `decodeContractDefaults` is removed. `null` literal defaults are handled in a literal pass before codec dispatch; `NULL` on `NOT NULL` columns is rejected. All fixture contracts are regenerated. Mongo paths are validated as untouched.

Demonstrable: emitted `contract.json` files contain only `{ expression: string }` for defaults; `pnpm fixtures:check` passes; Postgres e2e exercises DDL emission through the new path.

**Tasks:**

- [ ] Re-home `ColumnDefault`, `ColumnDefaultLiteralValue`, `ColumnDefaultLiteralInputValue` to `packages/2-sql/1-core/contract/src/types.ts`. Reshape `ColumnDefault` to the discriminated union `{ kind: 'expression'; expression: string } | { kind: 'autoincrement' }`. Update the Arktype validator in `packages/2-sql/1-core/contract/src/validators.ts` to match (two narrowed schemas joined). Remove any framework-foundation export of these types (satisfies TC-7, TC-8)
- [ ] Remove `decodeContractDefaults` from `packages/2-sql/1-core/contract/src/validate.ts` and remove its call site from `validateContract` (satisfies TC-21)
- [ ] Update TS DSL in `packages/2-sql/2-authoring/contract-ts/src/contract-dsl.ts`:
  - `.default(value)` types `value` as `TInput | AllowAutoincrement<TCodec>` where `AllowAutoincrement<TCodec>` resolves to the `AutoincrementSentinel` brand iff the codec's `traits` array contains `'autoincrement'`, otherwise `never`. The conditional uses `HasTrait<TCodec, 'autoincrement'>` over the existing `traits` field.
  - Export a top-level `autoincrement()` function that returns a uniquely-branded sentinel value (e.g. backed by `Symbol('autoincrement')`).
  - Keep `.defaultSql(expression)` (or equivalent) as the explicit function-form escape hatch.
  - (satisfies TC-11a, TC-12, TC-13)
- [ ] Update the contract emitter in `packages/2-sql/2-authoring/contract-ts/src/build-contract.ts`:
  - If `value === AutoincrementSentinel`, produce `{ kind: 'autoincrement' }` (codec not invoked).
  - Function-form defaults pass through as `{ kind: 'expression', expression: '<source>' }`.
  - `null` literal defaults: literal pass produces `{ kind: 'expression', expression: 'NULL' }` (codec not invoked).
  - `null` literal default on a `NOT NULL` column: emit a diagnostic naming the column path and codec id; no contract entry produced.
  - Other literals: invoke `codec.renderSqlLiteral(value)` and stamp `{ kind: 'expression', expression: <result> }`.
  - (satisfies TC-11, TC-19, TC-20)
- [ ] Update PSL literal-default lowering in `packages/2-sql/2-authoring/contract-psl/src/psl-column-resolution.ts` (and adjacent PSL files as needed):
  - `@default(autoincrement())` is recognized at parse time. If the column codec's `traits` include `'autoincrement'`, it lowers to `{ kind: 'autoincrement' }`. Otherwise PSL emits a diagnostic naming the column path, codec id, and PSL source `file:line`.
  - Other function-form (`now()`, `gen_random_uuid()`, etc.) lands as `{ kind: 'expression', expression: '<source>' }` directly.
  - Literal: `codec.decodeJson(jsonValue)` then `codec.renderSqlLiteral(decoded)`, stamped as `{ kind: 'expression', expression }`.
  - `decodeJson` failures surface as PSL diagnostics carrying column path, codec id, and PSL source `file:line`.
  - Same `null` / `NOT NULL` rules as TS DSL emitter (shared literal pass).
  - (satisfies TC-14, TC-15, TC-16)
- [ ] Update the PSL printer's `mapDefault` function in `packages/2-sql/9-family/src/core/psl-contract-infer/default-mapping.ts` (lines 15–32). Today it switches on legacy `columnDefault.kind` ('literal' / 'function'); after the reshape it switches on the new union: `'autoincrement'` prints as `@default(autoincrement())`; `'expression'` consults `DEFAULT_FUNCTION_ATTRIBUTES` to map known sentinels (e.g. `now()`, `gen_random_uuid()`) back to PSL attributes, otherwise emits raw-expression form (e.g. `` @default(`<expr>`) ``). Drop the `formatLiteralValue` helper if it becomes unreachable. Add a round-trip integration test (PSL → contract → PSL) asserting it survives without crashing (literal form may differ). (satisfies TC-17, TC-18)
- [ ] Simplify `buildColumnDefaultSql` in `packages/3-targets/3-targets/postgres/src/core/migrations/planner-ddl-builders.ts` to switch on the new `ColumnDefault` union: `kind: 'autoincrement'` returns the empty string (no `DEFAULT` clause; SERIAL/IDENTITY column-type emission elsewhere is unchanged); `kind: 'expression'` returns `DEFAULT (${expression})`. Remove the per-type `renderDefaultLiteral` switch (its responsibilities have moved into the codecs). Delete `assertSafeDefaultExpression` and its call site — the contract is developer-authored and the function's own docstring already states it is not a security boundary. (satisfies TC-32 for Postgres)
- [ ] Apply the analogous simplification to the SQLite DDL renderer in `packages/3-targets/3-targets/sqlite/src/core/migrations/planner-ddl-builders.ts`. Preserve the existing `now()` → `datetime('now')` translation for the `expression` branch (it remains a useful dialect-specific shorthand); delete `assertSafeDefaultExpression`. Add a runtime/emit-time diagnostic that rejects `{ kind: 'autoincrement' }` on any column that is not an `INTEGER PRIMARY KEY` (SQLite's autoincrement mechanism only operates on the rowid column); the diagnostic names the column path. (satisfies TC-32 for SQLite)
- [ ] Regenerate every fixture contract under `test/integration/test/**/contract.json` (and equivalents found by the scout) so `pnpm fixtures:check` passes against the new shape (satisfies TC-9, TC-10)
- [ ] Verify the Mongo codec interface and concrete Mongo codecs in `packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts` are unchanged at their public surface; run the Mongo-specific test suite to confirm no regression (satisfies TC-24, TC-25)

**Validation gate:**

- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm test:e2e`
- `pnpm lint`
- `pnpm lint:deps`
- `pnpm fixtures:check`

### Milestone 3: Close-out

Final verification, ADR housekeeping, and project deletion.

**Tasks:**

- [ ] Verify every acceptance criterion against its TC(s); record evidence in the close-out PR description (satisfies TC-26 through TC-30 as gate re-runs; satisfies TC-31 as static check)
- [ ] Update ADR 167 (`docs/architecture docs/adrs/ADR 167 - Typed default literal pipeline and extensibility.md`) to status "superseded by codec-owned-defaults"; add a close-out / pointer section to ADR 184 (`docs/architecture docs/adrs/ADR 184 - Codec-owned value serialization.md`) referencing this work and what it implemented
- [ ] Delete `projects/codec-owned-defaults/` (spec, plan, any transient artefacts). The close-out PR title or body must reference the Linear issue identifier so its linked GitHub integration auto-transitions on merge

**Validation gate:**

- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm test:e2e`
- `pnpm lint`
- `pnpm lint:deps`
