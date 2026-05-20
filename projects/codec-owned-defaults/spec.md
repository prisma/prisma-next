# Summary

Column defaults in the contract IR are stored as `{ kind: 'expression'; expression: string } | { kind: 'autoincrement' }`. The `expression` branch holds every default that lowers to a `DEFAULT (<expr>)` DDL clause — codec-rendered literals and raw function-form expressions alike. The `autoincrement` branch is a payload-free sentinel: it doesn't emit a `DEFAULT` clause at all and is realized at the column-type level (SERIAL/IDENTITY in Postgres, INTEGER PRIMARY KEY AUTOINCREMENT in SQLite). The SQL codec layer owns lowering literal values to dialect-specific expressions via a required `renderSqlLiteral(value: TInput): string` method. Both authoring surfaces (TS DSL and PSL) lower literals through codec methods — TS DSL invokes `renderSqlLiteral` directly, PSL chains `decodeJson + renderSqlLiteral` for runtime validation and rendering. `.default(value)` on the TS DSL is unconditionally available, with the value typed as the column codec's `TInput`.

# Description

A column default in `contract.json` sits in `storage.tables[].columns[].default` as a discriminated union:

- **`{ kind: 'expression'; expression: string }`** — the expression is a complete SQL fragment that the DDL renderer wraps as `DEFAULT (<expression>)`. This branch holds both codec-rendered literals (e.g. `'TRUE'`, `'1'`, `'2026-04-30T00:00:00Z'::timestamptz`) and raw function-form expressions authored directly (`now()`, `gen_random_uuid()`).
- **`{ kind: 'autoincrement' }`** — payload-free sentinel. Realized at the column-type level (SERIAL/IDENTITY in Postgres, INTEGER PRIMARY KEY AUTOINCREMENT in SQLite); no `DEFAULT` clause is emitted.

The contract is target-bound by the time defaults are rendered — every column carries a `codecId`, and the codec for that id owns the dialect-specific spelling of any literal value (`TRUE` vs `1`, `'2026-04-30T00:00:00Z'::timestamptz` vs ISO strings, JSON casts, escape rules).

Authoring captures literal values transiently:

- **TS DSL.** `.default(value)` accepts either the column codec's `TInput` or the `autoincrement()` sentinel, where the sentinel is admitted only when the column codec carries the `autoincrement` trait. For a non-sentinel value, the contract emitter dispatches to `codec.renderSqlLiteral(value)` and stamps `{ kind: 'expression', expression: <result> }` into the contract. For the sentinel, the emitter stamps `{ kind: 'autoincrement' }` and bypasses the codec. Function-form authoring (e.g. `.defaultSql('now()')`) also bypasses the codec, landing as `{ kind: 'expression', expression: '<source>' }`.
- **PSL.** The parser produces a `JsonValue` from the schema literal (PSL grammar is JSON-isomorphic). `codec.decodeJson(value)` validates and converts to `TInput`; `codec.renderSqlLiteral(decoded)` produces the expression, recorded as `{ kind: 'expression', expression }`. `decodeJson` failures surface as PSL diagnostics with file:line from the PSL AST.

The literal value never reaches `contract.json` — the SQL expression does.

Function-form defaults — `@default(now())`, `@default(gen_random_uuid())` — land directly as `{ kind: 'expression', expression: '<source>' }` without invoking codec methods. The function-form path expresses defaults that aren't reducible to a typed JS value. `@default(autoincrement())` is the only authored form that lands as the `autoincrement` sentinel rather than an expression; it is recognized at parse time, gated on the column codec carrying the `autoincrement` trait (PSL emits a diagnostic if the trait is absent), and lowered to `{ kind: 'autoincrement' }`.

`null` literal defaults render to `{ kind: 'expression', expression: 'NULL' }` uniformly across dialects, handled in the literal pass before codec dispatch. `renderSqlLiteral(value: TInput)` never receives `null` or `undefined`; codec authors can rely on a defined value.

Mongo column defaults are runtime-applied (Mongo has no DDL-level default mechanism) and live in `execution.mutations.defaults[]`, separate from the storage-level column default this spec governs. `ColumnDefault` therefore lives in the SQL domain, not the framework foundation; Mongo is unaffected.

# Requirements

## Functional Requirements

**FR1. Contract IR — default shape.** `storage.tables[].columns[].default` is the discriminated union `{ kind: 'expression'; expression: string } | { kind: 'autoincrement' }`. The `expression` branch carries every default that lowers to a `DEFAULT (<expr>)` clause; the `autoincrement` sentinel is payload-free and is realized at the column-type level. The Arktype validator and SQL types reflect this shape. The legacy `kind: 'literal'` branch's `value: JsonValue` payload is removed — literal-form defaults are merged into the `expression` branch and carry only the rendered SQL string.

**FR2. SQL codec method — `renderSqlLiteral` (required).** The SQL codec interface declares `renderSqlLiteral(value: TInput): string` as a required method. The SQL codec factory rejects construction of any codec that omits it. No identity fallback — codec authors decide dialect-specific spelling explicitly.

**FR3. TS DSL `.default(value)` is unconditionally available.** Every TS DSL column builder exposes `.default(value)`. The parameter accepts the column codec's `TInput`. It additionally accepts the `autoincrement()` sentinel, conditionally — only when the column codec carries the `autoincrement` trait. The contract emitter invokes `codec.renderSqlLiteral` for non-sentinel values and stamps `{ kind: 'autoincrement' }` for the sentinel.

**FR3a. `autoincrement` codec trait.** SQL codecs that support autoincrement column-type emission declare an `autoincrement` trait via the existing `traits` array on the codec interface. Postgres tags `pg/int2@1`, `pg/int4@1`, `pg/int8@1`; SQLite tags `sqlite/integer@1` only. Codecs without the trait do not accept the sentinel — `.default(autoincrement())` is a compile error on those columns, and PSL `@default(autoincrement())` produces a build-time diagnostic naming the column, codec id, and PSL source location.

**FR4. PSL lowers literals through the codec.** PSL literal defaults dispatch through `codec.decodeJson` followed by `codec.renderSqlLiteral`. `decodeJson` failures surface as PSL diagnostics with file:line.

**FR5. Function-form defaults.** Defaults expressed directly as SQL expressions (e.g. `@default(now())`, `@default(gen_random_uuid())`, `.defaultSql('...')`) land as `{ kind: 'expression', expression: '<source>' }` without invoking codec methods. The single exception is `autoincrement()`, recognized at parse time and lowered to `{ kind: 'autoincrement' }` (payload-free); the DDL renderer emits no `DEFAULT` clause for that branch and relies on column-type SERIAL/IDENTITY/AUTOINCREMENT semantics.

**FR6. NULL defaults.** A `null` literal default renders to `{ kind: 'expression', expression: 'NULL' }`, handled in the literal pass without invoking the codec. `null` literal defaults on NOT NULL columns are rejected with a diagnostic naming the column.

**FR7. `ColumnDefault` is a SQL-domain type.** `ColumnDefault` and its associated literal-input types live in the SQL domain, not the framework foundation. The Mongo codec interface gains nothing.

## Non-Functional Requirements

**NFR1. Type safety.** `.default(invalidValue)` where `invalidValue` does not match the column codec's `TInput` is a compile error in the TS DSL. No `any`, `as`, or `@ts-expect-error` in the implementation.

**NFR2. JS-native default values pass through without JSON round-trips in the TS DSL.** `Date`, `bigint`, `Buffer`, `Uint8Array`, and codec-defined branded types are accepted by `.default(...)` directly, where the codec's `TInput` admits them. PSL inputs go through `JsonValue` (PSL grammar is JSON-isomorphic), then through `codec.decodeJson` to `TInput` before rendering.

**NFR3. Dialect coverage is structural.** Because `renderSqlLiteral` is required by the codec factory, coverage is enforced at type-check time, not asserted by tests.

**NFR4. Diagnostics.** Failures include the column path (`table.column`) and codec id. PSL-side failures additionally include the PSL source location (file:line). Covered failure modes: NOT NULL with NULL default; PSL value rejected by `codec.decodeJson` (type mismatch, malformed input).

## Non-goals

- **Mongo storage defaults.** Mongo's runtime-applied default story (literal generators in `execution.mutations.defaults[]`) is a separate spec.
- **Surfacing the default's typed value in `contract.d.ts` column signatures** (e.g. making defaulted columns optional on insert types).
- **Reverse parsing of SQL expressions back to JS values.** The literal-to-expression direction is one-way at emit time. PSL printer round-trip is lossy by design: a contract whose defaults originated as PSL `@default(true)` may print back as `@default(\`TRUE\`)` (i.e. the rendered SQL expression in raw-expression form). Behaviour is preserved; literal form is not. If round-trip fidelity becomes a concern later, a codec-side reverse hook can be added without changing the IR.
- **PSL static type checking of default values against codec `TInput`.** PSL is parsed at runtime; type checking happens at lowering via `codec.decodeJson`.
- **Migration tooling that diff-renders defaults across versions.**

# Acceptance Criteria

## Contract IR

- [ ] `ColumnDefault` is the discriminated union `{ kind: 'expression'; expression: string } | { kind: 'autoincrement' }`. The legacy `kind: 'literal'` and `kind: 'function'` variants no longer exist; the legacy `value: JsonValue` payload is gone.
- [ ] `ColumnDefault`, `ColumnDefaultLiteralValue`, and `ColumnDefaultLiteralInputValue` live under `packages/2-sql/1-core/contract/src/`. None are exported from the framework foundation.
- [ ] All fixture contracts (`test/integration/test/**/contract.json` and equivalent) emit only the new shape: every default is either `{ kind: 'expression', expression: <string> }` or `{ kind: 'autoincrement' }`. No `value` field, no `literal`/`function` kinds appear.
- [ ] `pnpm fixtures:check` passes.

## SQL Codec

- [ ] The SQL codec interface declares `renderSqlLiteral(value: TInput): string` as a required method.
- [ ] The SQL codec factory rejects construction of any codec that omits `renderSqlLiteral`. A compile-time test demonstrates this.
- [ ] All Postgres codecs implement `renderSqlLiteral`.
- [ ] All SQLite codecs implement `renderSqlLiteral` consistently with the SQLite dialect.
- [ ] No codec implementation throws "not implemented" at runtime.
- [ ] Each codec's renderer is unit-tested with adversarial inputs (quotes, backslashes, NULL bytes, unicode).

## Authoring — TS DSL

- [ ] The contract emitter invokes `codec.renderSqlLiteral` during emission; literal-form defaults on disk are `{ kind: 'expression', expression: <rendered string> }`.
- [ ] `.default(value)` is available on every column builder, with `value` typed as the column codec's `TInput`. Compile-time tests demonstrate that mismatched types fail to compile and matching types succeed across a representative set of codecs.
- [ ] `.default(autoincrement())` compiles on column builders whose codec carries the `autoincrement` trait, and fails to compile on column builders whose codec does not. The TS DSL emitter lowers `.default(autoincrement())` to `{ kind: 'autoincrement' }` without invoking the codec.

## Authoring — PSL

- [ ] PSL literal defaults dispatch through `codec.decodeJson` followed by `codec.renderSqlLiteral` and land as `{ kind: 'expression', expression }`.
- [ ] PSL `@default(<typeMismatch>)` (e.g. `@default(true)` on an int column) fails with a diagnostic naming the column, codec id, and PSL source location.
- [ ] PSL function-form defaults (e.g. `@default(now())`, `@default(gen_random_uuid())`) land as `{ kind: 'expression', expression: '<source>' }` without invoking codec methods. `@default(autoincrement())` is recognized at parse time and, if the column codec carries the `autoincrement` trait, lowers to `{ kind: 'autoincrement' }`; otherwise PSL emits a diagnostic naming the column, codec id, and PSL source location.
- [ ] PSL printer reads the new `ColumnDefault` shape: `{ kind: 'autoincrement' }` prints as `@default(autoincrement())`; `{ kind: 'expression', expression }` maps known sentinels (e.g. `now()`, `gen_random_uuid()`) back to PSL attributes via the existing `DEFAULT_FUNCTION_ATTRIBUTES` lookup, otherwise emits raw-expression form. A round-trip test asserts that defaults survive PSL → contract → PSL emission without crashing (literal form is allowed to differ).

## Semantics & Diagnostics

- [ ] NOT NULL columns with `null` literal defaults are rejected before codec dispatch, with a diagnostic naming the column.
- [ ] `null` defaults render to `{ kind: 'expression', expression: 'NULL' }`, handled in the literal pass.
- [ ] No `decodeContractDefaults` function exists in `packages/2-sql/1-core/contract/src/validate.ts`.
- [ ] Tests assert `Date`, `bigint`, `Buffer`, and JSON values render to the expected SQL expressions for each dialect.
- [ ] DDL renderer emits no `DEFAULT` clause for `{ kind: 'autoincrement' }`; SERIAL/IDENTITY (Postgres) and INTEGER PRIMARY KEY AUTOINCREMENT (SQLite) column-type emission is unchanged.

## Mongo

- [ ] The Mongo codec interface and concrete Mongo codecs are unchanged.
- [ ] Mongo authoring/emission paths do not regress.

## Quality Gates

- [ ] `pnpm typecheck` passes across the workspace.
- [ ] `pnpm lint` passes across all packages.
- [ ] `pnpm lint:deps` passes (no new layering violations).
- [ ] `pnpm test:packages` passes.
- [ ] `pnpm test:e2e` passes (covers end-to-end emission and DDL paths through Postgres).
- [ ] No `any`, `@ts-expect-error` (outside negative type tests), or `as unknown as` casts introduced.

# Other Considerations

## Security

`renderSqlLiteral` produces SQL fragments embedded in DDL. Implementations must escape values correctly per dialect (single quotes, backslashes, identifier-vs-literal context). Escaping is owned by the codec; the emitter does no string concatenation. Adversarial-input unit tests (quotes, backslashes, NULL bytes, unicode) accompany each codec's renderer.

## Cost

Negligible. Build/emit cost gains one method dispatch per column with a default; no runtime cost surface.

## Observability

No new metrics or alerts. Lowering failures surface as build/emit-time errors with column path and codec id.

## Data Protection

Not applicable. No personal data flows through this change.

## Analytics

Not applicable. Internal tooling change.

# References

## Code

- `packages/1-framework/1-core/framework-components/src/shared/codec-types.ts` — framework codec interface (`encodeJson` / `decodeJson`)
- `packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts` — SQL codec interface; declares `renderSqlLiteral`
- `packages/2-sql/1-core/contract/src/types.ts` — SQL `ColumnDefault`
- `packages/2-sql/1-core/contract/src/validators.ts` — SQL Arktype validators
- `packages/2-sql/1-core/contract/src/validate.ts` — contract validation entry
- `packages/2-sql/2-authoring/contract-ts/src/contract-dsl.ts` — TS DSL `.default(...)`
- `packages/2-sql/2-authoring/contract-ts/src/build-contract.ts` — TS DSL emission path
- `packages/2-sql/2-authoring/contract-psl/src/psl-column-resolution.ts` — PSL literal default parsing
- `packages/1-framework/2-authoring/psl-printer/src/schema-validation.ts` — PSL printer
- `packages/3-targets/3-targets/postgres/src/core/codecs.ts` — Postgres codec implementations
- `packages/3-targets/3-targets/postgres/src/core/migrations/planner-ddl-builders.ts` — Postgres DDL renderer; delegates to `renderSqlLiteral`
- `packages/3-targets/3-targets/sqlite/src/core/codecs.ts` — SQLite codec implementations
- `packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts` — Mongo codec (unaffected)

## Architectural context

- `docs/architecture docs/adrs/ADR 184 - Codec-owned value serialization.md` — the broader codec-owned serialization plan; this spec implements the DDL-rendering and PSL-rendering halves directly on the SQL codec interface.
- `docs/architecture docs/adrs/ADR 167 - Typed default literal pipeline and extensibility.md` — older ADR on the typed default pipeline; superseded by this spec.
