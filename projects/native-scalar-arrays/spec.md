# Summary

Add first-class one-dimensional scalar-list support to SQL contract authoring. Postgres lowers `String[]`, `Int[]`, and the other supported scalar-list forms to native array columns with array-specific codecs; SQLite does not pretend to have native arrays and emits an actionable diagnostic for this EA scope. PSL records both list/container nullability and element nullability, while multidimensional arrays and Postgres-specific array query operators are explicitly deferred.

# Context

## At a glance

Prisma Next currently accepts scalar list syntax in SQL PSL but stores it as JSON. That breaks the contract-first promise for common greenfield fields such as tags, scores, and ordered feature values: the schema says `String[]`, but the database sees `jsonb`. This project makes scalar lists a real SQL contract feature for Postgres.

```prisma
model Post {
  id       Int      @id
  tags     String[]
  aliases  String?[]
  scores   Int[]?
  labels   String?[]?
}
```

The PSL modifiers are parsed as postfix operators. `?` before `[]` applies to the element type; `?` after `[]` applies to the list container. Therefore `String?[]?` means `ReadonlyArray<string | null> | null`, not an ambiguous optional-list special case.

For Postgres, these fields lower to native array storage:

```ts
// Domain field shape
tags: {
  nullable: false,
  many: true,
  type: { kind: 'scalar', codecId: 'pg/text@1' }
}

// Storage column shape
tags: {
  nullable: false,
  nativeType: 'text[]',
  codecId: 'pg/text-array@1'
}
```

Domain fields keep the element codec and `many: true`; storage columns use the array codec. This avoids generated domain types like `ReadonlyArray<ReadonlyArray<string>>` while letting runtime encode/decode dispatch through the column-bound array codec.

## Problem

Workstream 5, milestone 2 of the May plan names native scalar arrays as a greenfield authoring blocker: `String[]`, `Int[]`, and related scalar lists should lower to native Postgres arrays such as `text[]` and `int4[]`, with their own codecs, not JSON. The checkpoint requires a SaaS skeleton with `tags String[]` to emit, migrate on fresh Postgres, and round-trip through `contract infer`.

The current SQL PSL path preserves the element codec briefly, but then deliberately swaps list storage to `Json`. The SQL TS path does the same for `field.many`, lowering it to `jsonb`. This produces working ordered values, but it loses native database semantics, makes introspection misleading, and forces users into JSON when Postgres already has a native scalar-list representation.

Prisma 6/7 supported scalar lists for Postgres and MongoDB but rejected optional scalar lists in the parser. Prisma Next does not need to inherit that restriction: its contract field model already has field-level `nullable` and `many`, and Postgres can represent a nullable array column. The missing piece is element nullability, because `T?[]` requires a separate bit from `T[]?`.

SQLite remains different. SQLite has no native scalar array column type. A JSON-backed typed-list compatibility mode may be useful later, but shipping it under the "native scalar arrays" milestone would blur the feature boundary and risk recreating the JSON workaround under a friendlier name.

## Approach

Define scalar list syntax as a postfix type modifier chain and support exactly one list dimension in EA. The four supported one-dimensional forms are:

| PSL | Meaning | Generated TypeScript shape |
| --- | --- | --- |
| `T[]` | non-null list of non-null elements | `ReadonlyArray<T>` |
| `T?[]` | non-null list of nullable elements | `ReadonlyArray<T | null>` |
| `T[]?` | nullable list of non-null elements | `ReadonlyArray<T> | null` |
| `T?[]?` | nullable list of nullable elements | `ReadonlyArray<T | null> | null` |

Extend the contract domain field shape with `elementNullable?: true`, valid only when `many: true`. Keep `nullable` as the container/column nullability bit. Storage columns remain column-oriented and use array-specific codec IDs such as `pg/text-array@1`; any array-codec parameters needed for element-null validation stay codec-owned.

Postgres array codecs are the runtime authority for ingress and egress. They reject nested arrays, reject null elements when the contract says `T[]` or `T[]?`, preserve order, preserve empty arrays, and keep `null` distinct from `[]` when the container is nullable. Database-level `CHECK` constraints for non-null elements are a follow-up, because the current SQL schema IR and migration planners do not model column checks as first-class contract output. If an out-of-band SQL write inserts a null element into a non-null-element list, decode fails as a contract violation.

Reject multidimensional arrays in the authoring path with a dedicated diagnostic. PostgreSQL supports multidimensional arrays, but dimensions are not enforced by the declared type, arrays can have non-1 lower bounds, and slicing/concatenation semantics are not equivalent to simple nested JavaScript arrays. Feature vectors and embeddings should use the existing pgvector extension rather than `Float[]` or `Float[][]`.

Do not add typed array query operators in this EA project. Postgres operators such as `@>`, `<@`, `&&`, and `ANY()` are target-specific and should live in the Postgres adapter's query-operation registry, not SQL core. The current operation-template path already supports adapter-owned functions like `ilike` and extension-owned functions like pgvector cosine distance; array query operations should use the same pattern in a follow-up.

# Requirements

## Functional Requirements

- **FR1.** PSL accepts and prints the four one-dimensional scalar-list forms: `T[]`, `T?[]`, `T[]?`, and `T?[]?`.
- **FR2.** PSL rejects multidimensional scalar-list syntax such as `T[][]`, `T?[][]`, and `T[][]?` with `PSL_UNSUPPORTED_MULTIDIMENSIONAL_ARRAY` or the closest stable diagnostic code chosen during implementation.
- **FR3.** Contract domain fields represent scalar-list semantics with `many: true`, container nullability in `nullable`, and element nullability in `elementNullable?: true`.
- **FR4.** Generated domain/type-map output uses the element codec plus the list modifiers to produce the expected TypeScript shapes for all four forms, without nested arrays unless the user has a future explicit multidimensional feature.
- **FR5.** Postgres PSL lowering maps supported scalar lists to native one-dimensional Postgres array columns with array-specific storage codecs, not JSON/JSONB.
- **FR6.** Postgres storage columns keep the array codec while domain fields keep the element codec, so runtime column-bound dispatch uses the correct array encode/decode path and generated model semantics stay element-oriented.
- **FR7.** Postgres array codecs support at least `String[]`, `Int[]`, `BigInt[]`, `Float[]`, `Boolean[]`, and `DateTime[]`, mapping to the corresponding existing scalar native types with `[]` appended.
- **FR8.** Runtime encode/decode preserves element order, preserves empty arrays, distinguishes `null` from `[]` for nullable containers, rejects nested arrays, and rejects null elements for non-null-element lists.
- **FR9.** Fresh Postgres migration planning and DDL rendering create native array columns such as `text[]` and `int4[]`.
- **FR10.** Postgres `contract infer` maps native one-dimensional scalar array columns back to the equivalent PSL list syntax and preserves container nullability.
- **FR11.** SQL TypeScript authoring can express the same scalar-list contracts as PSL and emits the same canonical contract for representative Postgres fixtures.
- **FR12.** SQLite SQL authoring emits an actionable diagnostic for scalar lists in EA. The diagnostic must explain that native scalar arrays are Postgres-only and suggest JSON or a future typed SQLite JSON-list compatibility mode rather than silently lowering to JSON.
- **FR13.** MongoDB scalar-list behavior remains unchanged.
- **FR14.** Array query operators are not added to SQL core in this project. Any future typed support for `@>`, `<@`, `&&`, or `ANY()` must be implemented as Postgres adapter query operations.

## Non-Functional Requirements

- **NFR1.** No backward-compat shim for newly authored SQL scalar lists. Existing hand-authored JSON columns remain valid JSON columns; new Postgres scalar-list authoring emits native arrays.
- **NFR2.** The design keeps target-specific behavior in target/adapters. SQL core may represent scalar-list semantics, but Postgres owns native array storage and Postgres-specific query operations.
- **NFR3.** The implementation is test-first. Parser, lowering, generated types, runtime codecs, migration DDL, and infer round-trip behavior each need focused tests before implementation changes.
- **NFR4.** The EA scope is small enough to land before release: storage, codec, typegen, migration, runtime round-trip, infer, and diagnostics only. Array filters, array update operators, GIN index helpers, DB-level element-null checks, and SQLite typed JSON fallback are follow-ups.
- **NFR5.** No artificial widening to `any` or blanket casts. Array codec and generated type changes must preserve the repo's existing type-safety constraints.

## Non-goals

- Multidimensional arrays.
- Arrays of value objects, relation fields, composite types, enum arrays, JSON arrays as Postgres native arrays, extension-native arrays, or arrays of parameterized custom native types.
- Postgres array query operators in SQL core.
- Postgres array update helpers such as push/append/concat.
- DB-level `CHECK` constraints for element non-nullability in EA.
- SQLite native scalar arrays. SQLite has no native scalar array column type.
- SQLite JSON-backed typed scalar-list compatibility in this project. It can be a follow-up with its own name and semantics.
- Backward-compatible exports or old JSON-list authoring aliases unless explicitly requested.

# Acceptance Criteria

- [ ] **AC1.** PSL parser and printer round-trip `String[]`, `String?[]`, `String[]?`, and `String?[]?`, preserving which `?` applies to the element and which applies to the list container. Covers FR1.
- [ ] **AC2.** PSL rejects `String[][]` and related multidimensional spellings with a focused scalar-list diagnostic and an actionable message that recommends pgvector for embeddings/feature vectors. Covers FR2.
- [ ] **AC3.** A Postgres PSL model with all four list-nullability forms emits domain fields with `many: true`, correct `nullable`, correct `elementNullable`, and element scalar codec IDs. Covers FR3, FR4, FR6.
- [ ] **AC4.** The same Postgres PSL model emits storage columns with native array types and array codec IDs, not `json`, `jsonb`, or JSON codecs. Covers FR5, FR7.
- [ ] **AC5.** Generated `contract.d.ts` type maps expose `ReadonlyArray<T>`, `ReadonlyArray<T | null>`, `ReadonlyArray<T> | null`, and `ReadonlyArray<T | null> | null` for the four forms. Covers FR4.
- [ ] **AC6.** Equivalent SQL TypeScript authoring and PSL fixtures for supported Postgres scalar lists emit the same canonical contract/core hash. Covers FR11.
- [ ] **AC7.** Fresh Postgres migration DDL for a model with `tags String[]` and `scores Int[]?` creates `text[]` and `int4[]` columns with the expected column nullability. Covers FR9.
- [ ] **AC8.** Runtime integration against Postgres inserts, selects, and updates scalar-list values while preserving order, preserving empty arrays, and distinguishing `null` from `[]` for nullable containers. Covers FR8.
- [ ] **AC9.** Runtime encode/decode rejects nested arrays and rejects null elements for non-null-element list fields. Covers FR8.
- [ ] **AC10.** Postgres `contract infer` maps `text[]`, `int4[]`, and other supported one-dimensional scalar arrays back to the expected PSL list spelling. Covers FR10.
- [ ] **AC11.** SQLite SQL authoring of scalar lists emits the EA diagnostic instead of lowering to JSON. Covers FR12.
- [ ] **AC12.** Existing MongoDB scalar-list tests still pass without contract-shape changes. Covers FR13.
- [ ] **AC13.** No new SQL-core array query functions are exposed by this project; docs and plan notes point future work to Postgres adapter query operations. Covers FR14, NFR2, NFR4.

# References

- `docs/planning/may-milestone.md` - WS5 Milestone 2 native scalar arrays.
- `packages/2-sql/2-authoring/contract-psl/src/psl-field-resolution.ts` - current SQL PSL list lowering to JSON.
- `packages/2-sql/2-authoring/contract-ts/src/build-contract.ts` - current TS `field.many` lowering to JSONB.
- `packages/1-framework/0-foundation/contract/src/domain-types.ts` - current `nullable` + `many` domain field shape.
- `packages/1-framework/2-authoring/psl-parser/src/parser.ts` and `packages/1-framework/2-authoring/psl-printer/src/serialize-print-document.ts` - current type modifier parsing/printing.
- `packages/3-targets/3-targets/postgres/src/core/migrations/planner-ddl-builders.ts` - Postgres DDL native type validation already accepts trailing `[]`.
- `packages/3-extensions/pgvector/` - dedicated vector type and vector operation extension.
- PostgreSQL arrays documentation: https://www.postgresql.org/docs/current/arrays.html
- PostgreSQL array functions/operators: https://www.postgresql.org/docs/current/functions-array.html
- PostgreSQL row and array comparisons: https://www.postgresql.org/docs/current/functions-comparisons.html

# Open Questions

- Should the TypeScript authoring surface spell element-nullability as `field.text().list({ elementNullable: true })`, `field.text().nullableElements().list()`, or another local pattern? The spec requires an explicit element-nullability control but leaves the final helper spelling to the implementer unless the team wants to pin it before implementation.
- Should DB-level element non-null checks be added as a follow-up project immediately after EA, or deferred until the SQL schema IR has a broader check-constraint design?
