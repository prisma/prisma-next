# Native Scalar Arrays Plan

## Summary

Build one-dimensional SQL scalar-list support for Prisma Next EA. Success means Postgres authoring emits native array columns with array codecs, generated types model container and element nullability correctly, fresh Postgres migrations and runtime round-trips work, SQLite gets an explicit non-native diagnostic, and multidimensional arrays/query operators are consciously deferred.

**Spec:** `projects/native-scalar-arrays/spec.md`

## Collaborators

| Role | Person/Team | Context |
| --- | --- | --- |
| Maker | Alberto / WS5 contract authoring | Drives the greenfield authoring milestone and owns the final scope cuts |
| Reviewer | SQL contract + authoring reviewer | Reviews PSL/TS lowering, contract IR, and generated type-map changes |
| Reviewer | Postgres target/adapter reviewer | Reviews codecs, DDL, runtime round-trip behavior, and infer mapping |
| Collaborator | Query lanes maintainer | Confirms array query operators stay out of SQL core and fit the adapter operation model as follow-up |
| Collaborator | Mongo/SQLite maintainers | Confirms Mongo remains unchanged and SQLite emits the intended EA diagnostic |

## Shipping Strategy

Ship in small, deployable slices. Existing JSON columns and existing contracts remain valid; only newly authored Postgres scalar lists switch from JSON lowering to native arrays. Milestone 1 can land with parser/IR/typegen groundwork and no target behavior change. Milestone 2 turns on Postgres authoring lowering once array codecs exist. Milestone 3 proves the behavior through migration, runtime, and infer. Milestone 4 closes the documentation and explicit deferrals.

No feature flag is needed. The implicit gate is authoring: users only get native Postgres arrays when they author scalar lists after the lowering change. SQLite is gated by a diagnostic, so it cannot silently produce JSON-backed behavior under the native-array milestone.

## Test Design

| AC | Test ID | Type | Verification |
| --- | --- | --- | --- |
| AC1 | TC1 | Unit | PSL parser/printer round-trips `String[]`, `String?[]`, `String[]?`, and `String?[]?` while preserving element versus container nullability. |
| AC2 | TC2 | Unit | PSL rejects `String[][]`, `String?[][]`, and `String[][]?` with the chosen multidimensional-array diagnostic and a message recommending pgvector for vectors. |
| AC3 | TC3 | Unit | SQL PSL interpreter emits domain fields with `many: true`, correct `nullable`, correct `elementNullable`, and element codec IDs for all four forms. |
| AC4 | TC4 | Unit | SQL PSL interpreter emits Postgres storage columns with `text[]`, `int4[]`, etc. and array codec IDs, never JSON/JSONB, for supported scalar lists. |
| AC5 | TC5 | Type test | Emitter-generated type maps expose the four expected `ReadonlyArray` shapes without nested arrays. |
| AC6 | TC6 | Unit | Equivalent Postgres PSL and SQL TS scalar-list fixtures emit identical canonical contract/core hash. |
| AC7 | TC7 | Integration/unit migration | Fresh Postgres migration DDL includes `text[]` and `int4[]` with expected column nullability. |
| AC8 | TC8 | Integration | Postgres runtime insert/select/update round-trips ordered arrays, empty arrays, and nullable containers. |
| AC9 | TC9 | Unit/integration | Array codecs reject nested arrays and null elements for non-null-element fields on encode/decode. |
| AC10 | TC10 | Integration/unit infer | Postgres infer maps one-dimensional native array columns back to the expected PSL list spelling. |
| AC11 | TC11 | Unit | SQLite SQL authoring of scalar lists emits the EA diagnostic and does not emit JSON-list storage. |
| AC12 | TC12 | Package regression | Existing Mongo scalar-list tests pass unchanged. |
| AC13 | TC13 | Type/regression | SQL core does not gain array query operations; Postgres-specific array operation notes are documented as follow-up work. |

## Milestone 1: Syntax, IR, And Type Generation

Add scalar-list semantics to the authoring and contract layers without enabling Postgres native storage yet. This milestone makes the syntax and generated type shape unambiguous.

### Tasks

- [ ] Add parser support for element nullability in list type modifiers and focused rejection for multidimensional syntax. Covers TC1, TC2.
- [ ] Fix PSL printer formatting so `T?[]`, `T[]?`, and `T?[]?` print from AST/IR without dropping either modifier. Covers TC1.
- [ ] Extend `ContractField` and SQL contract validation with `elementNullable?: true`, valid only with `many: true`. Covers TC3.
- [ ] Update SQL emitter/domain type generation so scalar-list fields wrap the element codec output/input according to `many`, `nullable`, and `elementNullable`, without nested array output for array storage codecs. Covers TC5.
- [ ] Add initial tests around current JSON-list lowering expectations and flip them to the intended semantic shape before implementation changes. Covers TC3, TC5.

### Validation Gate

- `pnpm -F @prisma-next/psl-parser test`
- `pnpm -F @prisma-next/psl-printer test`
- `pnpm -F @prisma-next/sql-contract test`
- `pnpm -F @prisma-next/sql-contract-emitter test`
- `pnpm -F @prisma-next/sql-contract typecheck`
- `pnpm -F @prisma-next/sql-contract-emitter typecheck`

## Milestone 2: Postgres Array Codecs And Authoring Lowering

Add Postgres array codec descriptors and switch SQL Postgres PSL/TS scalar-list lowering from JSON to native arrays.

### Tasks

- [ ] Add Postgres array codec IDs and descriptors for the EA scalar set: text, int4, int8, float8, bool, and DateTime's chosen native type. Covers TC4, TC8, TC9.
- [ ] Implement array codec encode/decode/JSON paths with order preservation, empty-array preservation, nested-array rejection, and element-null validation. Covers TC8, TC9.
- [ ] Add target array descriptor lookup from scalar element descriptor to array storage descriptor; reject unsupported scalar-list element types with a precise diagnostic. Covers TC4.
- [ ] Change SQL PSL list lowering to keep the element codec on the domain field and use the array codec/native type on storage. Covers TC3, TC4.
- [ ] Change SQL TS authoring to expose scalar lists and element-nullability, then lower through the same storage/domain split as PSL. Covers TC6.
- [ ] Preserve SQLite diagnostic behavior: SQL SQLite scalar lists fail authoring with the EA diagnostic rather than falling back to JSON. Covers TC11.

### Validation Gate

- `pnpm -F @prisma-next/target-postgres test`
- `pnpm -F @prisma-next/sql-contract-psl test`
- `pnpm -F @prisma-next/sql-contract-ts test`
- `pnpm -F @prisma-next/sql-contract-psl typecheck`
- `pnpm -F @prisma-next/sql-contract-ts typecheck`
- `pnpm -F @prisma-next/target-postgres typecheck`

## Milestone 3: Migration, Runtime, And Infer Round-Trip

Prove the feature end-to-end on Postgres: fresh migration DDL, runtime round-trip, and `contract infer` returning equivalent PSL.

### Tasks

- [ ] Add migration planner/DDL tests for fresh Postgres tables with required and nullable scalar-list columns. Covers TC7.
- [ ] Add Postgres runtime integration tests for insert/select/update of ordered values, empty arrays, nullable containers, nullable elements, rejected null elements, and rejected nested arrays. Covers TC8, TC9.
- [ ] Update Postgres infer/type mapping so one-dimensional native array columns map back to PSL scalar-list syntax, including nullable container spelling. Covers TC10.
- [ ] Add a SaaS skeleton fixture with `tags String[]` and at least one nullable-list field to satisfy the May milestone checkpoint. Covers TC4, TC7, TC10.
- [ ] Run Mongo scalar-list regression tests or the package suite that covers them to confirm Mongo behavior is unchanged. Covers TC12.

### Validation Gate

- `pnpm -F @prisma-next/family-sql test`
- `pnpm -F @prisma-next/adapter-postgres test`
- `pnpm -F @prisma-next/sql-runtime test`
- `pnpm -F @prisma-next/sql-contract-psl test`
- `pnpm -F @prisma-next/sql-contract-ts test`
- `pnpm -F @prisma-next/family-sql typecheck`
- `pnpm -F @prisma-next/adapter-postgres typecheck`
- `pnpm -F @prisma-next/sql-runtime typecheck`

## Milestone 4: Docs, Deferrals, And Close-Out

Document the shipped surface, explicitly record what is deferred, and close the transient project packet.

### Tasks

- [ ] Update relevant SQL authoring docs and examples to describe the four PSL list-nullability forms, Postgres native storage, SQLite diagnostic behavior, and the multidimensional-array rejection. Covers TC1, TC2, TC11.
- [ ] Document Postgres array query operators as follow-up adapter query operations, not SQL core operations. Include candidate names (`has`, `hasEvery`, `hasSome`, `isSubsetOf`, `isEmpty`) and the operator mapping (`array_position`, `@>`, `&&`, `<@`, `cardinality`) as non-shipped design notes. Covers TC13.
- [ ] Document pgvector guidance for embeddings/feature vectors instead of multidimensional arrays or `Float[]` misuse. Covers TC2.
- [ ] Verify all acceptance criteria are covered by tests or explicit manual checks. Covers TC1-TC13.
- [ ] Move any durable decisions that should survive the project into the appropriate docs/architecture location, then delete `projects/native-scalar-arrays/` during project close-out. Covers project lifecycle.

### Validation Gate

- `pnpm test:packages`
- `pnpm lint:deps`
- `pnpm build`

## Follow-Up Candidates

- Postgres adapter query operations for arrays: `has`, `hasEvery`, `hasSome`, `isSubsetOf`, `isEmpty`, plus documentation for GIN indexes.
- DB-level element non-null checks once SQL schema IR and migration planners have first-class check-constraint output.
- SQLite typed scalar-list compatibility backed by JSON `TEXT`, explicitly named as compatibility storage rather than native arrays.
- Enum arrays and arrays of selected extension-native scalar types once typeRef/native-type rendering can quote array types correctly.
- Array update operators such as append/concat/push.

## Resolved Decisions

- PSL uses postfix modifier syntax: `T[]`, `T?[]`, `T[]?`, and `T?[]?`.
- `T?[]?` parses as `((((T)?)[])?)`: nullable element, then list, then nullable container.
- Prisma Next supports optional scalar lists for Postgres; it does not inherit Prisma 6/7's parser restriction.
- EA supports one-dimensional scalar lists only.
- Multidimensional arrays are rejected, with pgvector recommended for embeddings/feature vectors.
- Postgres storage uses native arrays and array-specific codecs; newly authored Postgres scalar lists do not lower to JSON.
- Domain fields use the element codec plus `many`/nullability metadata; storage columns use the array codec.
- SQLite does not get native scalar arrays in EA and does not silently lower scalar lists to JSON.
- Array query operators are deferred and belong in Postgres adapter query operations, not SQL core.

## Open Questions

- Confirm the SQL TypeScript authoring spelling for nullable elements. The plan assumes an explicit helper/option, with `field.text().list({ elementNullable: true })` as the working candidate, but implementation can choose the local builder pattern before tests are finalized.
- Confirm whether the final multidimensional-array diagnostic code should be a new `PSL_UNSUPPORTED_MULTIDIMENSIONAL_ARRAY` or reuse an existing stable unsupported-field diagnostic with a more specific message.
