# Project 2 — Expanded type/operator surface — Plan

## Summary

Expand `@prisma-next/extension-cipherstash` from Project 1's `EncryptedString` + two operators to CipherStash Drizzle feature parity: five new encrypted column types (`EncryptedDouble`, `EncryptedBigInt`, `EncryptedDate`, `EncryptedBoolean`, `EncryptedJson`), eleven new predicate operators, four free-standing helpers (sort + JSON SELECT-expression), and `orderAndRange` on `EncryptedString`. Ships as a single PR with one validation gate against live Postgres + EQL.

**Spec:** [`spec.md`](spec.md)

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | William Madden | Drives execution. |
| Reviewer | Prisma Terminal team | Architectural review on the operator-surface split and the SDK shape change. |
| Collaborator | CipherStash team | Confirms the polymorphic SDK contract (FR1) and the remaining EQL lowering open question (`asc`/`desc` wrapping). |

## Shipping Strategy

Single PR, no feature flags. Backward compatibility is preserved by construction:

- **SDK shape widening is permissive.** `bulkEncrypt({ values: ReadonlyArray<unknown> })` accepts every shape `ReadonlyArray<string>` previously accepted. The existing string-typed callsites continue to compile and behave identically. The mock SDK is updated to pass `unknown` through verbatim, matching the prior pass-through behaviour for strings.
- **`EncryptedEnvelopeBase<T>` extraction is behavior-preserving.** The shared base houses verbatim copies of today's `EncryptedString` logic; `EncryptedString` becomes the first subclass. The existing 167-test suite is the regression gate.
- **`makeCipherstashCodecHooks(...)` factory adoption is behavior-preserving.** Refactoring `cipherstashStringCodecHooks` to use the factory must produce byte-identical `ops.json` from the example app's existing baseline migration regeneration. This is the load-bearing test that the refactor introduced no drift.
- **New codecs and operators are pure additions.** Existing applications don't import the new codecs, factories, envelopes, or operators; their behaviour is unchanged.
- **`EncryptedString` gains `orderAndRange` as a new optional flag** defaulting to `true`. Existing call sites that pass `equality` / `freeTextSearch` continue to work; columns authored before this PR are interpreted with the new default once the contract is re-emitted (a single new `cipherstashAddSearchConfig({..., index: 'ore'})` op appears in the regenerated migration). This is the one behavioral change at the user-contract level. Captured in AC-HOOK2 / AC-AUTH parity tests.

The implicit gate between old and new behaviour is the **codec id**: new codecs (`cipherstash/double@1`, etc.) only become active when a user authors a column using one of the new PSL constructors / TS factories. Until that happens, the contract diff sees no new fields and the codec lifecycle hooks for the new codecs don't fire.

## Test Design

Test cases derive directly from the spec's acceptance criteria. The TC IDs are referenced by tasks below. Compact form — each row covers one AC or a tightly-bound AC pair.

| AC | TC | Test case | Type | Expected outcome |
|---|---|---|---|---|
| AC-PKG1 | TC-PKG1 | `pnpm --filter @prisma-next/extension-cipherstash build` succeeds with new subpath exports registered | Build | Green build; new exports resolve in downstream `tsc --noEmit`. |
| AC-PKG2 | TC-PKG2 | `pnpm lint:deps` against the modified package | Lint | No new layering violations. |
| AC-SDK1 | TC-SDK1 | Type-test pinning `CipherstashSdk.bulkEncrypt({ values: ReadonlyArray<unknown> })` and `bulkDecrypt: Promise<ReadonlyArray<unknown>>` | Unit (type) | Compiles only when the polymorphic shape is declared. |
| AC-SDK2 | TC-SDK2 | Existing string-codec tests run against the updated mock SDK (no behavioural change) | Unit | All Project 1 tests pass without modification. |
| AC-ENV1 | TC-ENV1 | Unit test for `EncryptedEnvelopeBase<T>`: handle plumbing, `expose()`, redaction overrides | Unit | All five redaction overrides return `[REDACTED]`; handle round-trips. |
| AC-ENV2 | TC-ENV2 | `EncryptedString` refactor regression — all Project 1 envelope tests green without modification | Unit | 167-test suite continues to pass. |
| AC-ENV3 | TC-ENV3..7 | Unit tests for each new envelope (`Double`, `BigInt`, `Date`, `Boolean`, `Json`): `from(plaintext)`, `fromInternal({...})`, redaction overrides, `decrypt()` returns the right narrowed type | Unit | Round-trip works; `Promise<T>` shape matches the subclass. |
| AC-ENV4 | TC-ENV8 | Per-envelope regression test: `console.log(envelope)`, `JSON.stringify(envelope)`, `String(envelope)`, `\`${envelope}\``, and `util.inspect(envelope)` all produce `[REDACTED]` (or the per-type JSON placeholder) | Unit | No plaintext or ciphertext leaks through any coercion path. |
| AC-ENV5 | TC-ENV9 | `JSON.stringify` produces `{ "$encryptedDouble": "<opaque>" }` etc. per type | Unit | Placeholder shape verified per type. |
| AC-CODEC1 | TC-CODEC1 | Per codec, runtime parameterized descriptor declares correct `codecId`, `targetTypes`, `nativeType`, empty `traits`, params arktype schema | Unit | Descriptor matches spec FR4. |
| AC-CODEC2 | TC-CODEC2 | `createParameterizedCodecDescriptors(sdk)` returns six descriptors in stable order | Unit | Length and order verified. |
| AC-CODEC3 | TC-CODEC3 | Per codec, `encode(envelope, ctx)` extracts ciphertext; `decode(wire, ctx)` constructs the right envelope subclass | Unit | Round-trip with mock SDK. |
| AC-HOOK1 | TC-HOOK1 | `makeCipherstashCodecHooks({ flagToIndex, castAs })` factory output: added/dropped/altered events produce the correct `cipherstashAddSearchConfig` / `RemoveSearchConfig` calls | Unit | Matches existing hardcoded `cipherstashStringCodecHooks` output for the string case. |
| AC-HOOK2 | TC-HOOK2 | Example app baseline migration regenerates byte-identical `ops.json` after the string hook is refactored to use the factory | Integration | Hash and bytes preserved. |
| AC-HOOK3 | TC-HOOK3 | Each new codec hook configuration is wired into the extension descriptor's `controlPlaneHooks` map | Unit | Six entries present after wiring. |
| AC-HOOK4 | TC-HOOK4 | `CipherstashSearchIndex` accepts `'unique' \| 'match' \| 'ore' \| 'ste_vec'`; factories take all four | Unit (type) | Type-test compiles for each value. |
| AC-AUTH1 | TC-AUTH1 | PSL constructor for each type lowers to the expected `ColumnTypeDescriptor`; defaults applied | Unit | Round-trip via the contract emitter produces the right `typeParams`. |
| AC-AUTH2 | TC-AUTH2 | TS factory for each type lowers to the same descriptor as the PSL constructor | Unit | Byte-identical descriptor. |
| AC-AUTH3 | TC-AUTH3 | Parity fixtures emit byte-identical `contract.json` for PSL vs TS authoring of each type | Integration | Each new fixture produces matching `contract.json`. |
| AC-OP-PRED1 | TC-OPP1 | `cipherstashQueryOperations()` returns descriptors for all 13 predicate operators | Unit | All entries present with correct `self.codecId`. |
| AC-OP-PRED2 | TC-OPP2 | Per operator, SQL-snapshot test verifies the EQL function call template | Unit | Matches FR7 table. |
| AC-OP-PRED3 | TC-OPP3 | `cipherstashInArray([v1, v2, v3])` produces an OR-of-equalities lowering with three `ParamRef`s sharing the routing key | Unit | SQL snapshot + middleware grouping verified. |
| AC-OP-PRED4 | TC-OPP4 | `cipherstashBetween(min, max)` lowers to `eql_v2.gte(..., {{arg0}}) AND eql_v2.lte(..., {{arg1}})` | Unit | SQL snapshot. |
| AC-OP-PRED5 | TC-OPP5 | Type-visibility test: each predicate operator autocompletes on its target codec(s); negative test pins absence on non-cipherstash columns | Unit (type) | `@ts-expect-error` on each negative case. |
| AC-OP-HELPER1, HELPER2 | TC-OPH1 | `cipherstashAsc(col)` / `cipherstashDesc(col)` return `OrderByItem` with the right direction and EQL-wrapped inner expression | Unit | AST shape verified; SQL snapshot. |
| AC-OP-HELPER3, HELPER4 | TC-OPH2 | `cipherstashJsonbPathQueryFirst(col, path)` / `cipherstashJsonbGet(col, path)` return `Expression<ScopeField>` lowering to the right EQL JSONB function | Unit | SQL snapshot. |
| AC-OP-HELPER5 | TC-OPH3 | Each helper throws a descriptive error on non-cipherstash columns | Unit | Error thrown with the expected message. |
| AC-OP-TYPES1..3 | TC-OPT1 | Negative type-tests in the example app: cipherstash operators don't appear on non-cipherstash columns; JSON operators don't appear on non-`json@1` columns | Unit (type) | `@ts-expect-error` blocks pinning the negative cases. |
| AC-MW1 | TC-MW1 | Inserting N rows × multiple cipherstash columns of different types issues one `bulkEncrypt` per `(table, column)` group | Unit | Mock SDK call-count verified. |
| AC-MW2 | TC-MW2 | Middleware matches all six cipherstash codec ids (parameter survey test) | Unit | Each codec is grouped. |
| AC-DEC1 | TC-DEC1 | `decryptAll(rows)` walks for `EncryptedEnvelopeBase` instances; groups bulk-decrypt by `(table, column)` across heterogeneous types | Unit | One bulk call per group; mixed types in one input array. |
| AC-DEC2 | TC-DEC2 | After `decryptAll`, each touched envelope's `decrypt()` returns its cached plaintext synchronously with the narrowed type | Unit | Sync return; type assertions per subclass. |
| AC-E2E-NUM | TC-E2E1 | Live Postgres + EQL: `EncryptedDouble` insert/read; `cipherstashGt/Gte/Lt/Lte/Between` filter correctly; `cipherstashAsc/Desc` order correctly | E2E (integration) | Filtered rows match; sort order matches. |
| AC-E2E-BIGINT | TC-E2E2 | Live Postgres + EQL: `EncryptedBigInt` round-trip with values > `Number.MAX_SAFE_INTEGER`; range operators correct | E2E | No precision loss; range correct. |
| AC-E2E-DATE | TC-E2E3 | Live Postgres + EQL: `EncryptedDate` round-trip; calendar-date range queries correct; sort by date works | E2E | Date semantics correct (date-only, no time). |
| AC-E2E-BOOL | TC-E2E4 | Live Postgres + EQL: `EncryptedBoolean` round-trip; `cipherstashEq(true/false)`, `cipherstashNe`, `cipherstashInArray([true, false])` | E2E | Filters return expected rows. |
| AC-E2E-JSON | TC-E2E5 | Live Postgres + EQL: `EncryptedJson` round-trip; `cipherstashJsonbPathExists('$.k')`, `cipherstashJsonbPathQueryFirst('$.k')`, `cipherstashJsonbGet('$.k')` | E2E | Path existence and value-extraction return expected results. |
| AC-E2E-STR-RANGE | TC-E2E6 | Live Postgres + EQL: `EncryptedString({ orderAndRange: true })` supports `cipherstashGt('m')` and `cipherstashAsc` | E2E | String range and sort work. |
| AC-E2E-MIXED | TC-E2E7 | Live Postgres + EQL: query with predicates and ORDER BY across multiple cipherstash columns of different types issues the minimum SDK round-trips | E2E | One bulk-encrypt per `(table, column)` verified via SDK mock. |
| AC-EXAMPLE1, EXAMPLE2 | TC-EX1 | Example app schema includes one column of each new type; `pnpm --filter cipherstash-integration-example typecheck` is green | Integration | Type-check passes. |
| AC-DOC1, DOC3 | TC-DOC1 | Package `README.md` covers all five new types, the predicate-vs-helper split, the EQL search-config index types, and known limitations | Manual | Reviewer sign-off on docs. |
| AC-DOC2 | TC-DOC2 | Design decisions migrated to durable location at close-out: `DEVELOPING.md` amendment, ADR extension, or new ADR as appropriate | Manual | Documented locations are durable (not under `projects/`). |

**Coverage check.** Every spec AC maps to at least one TC. Two non-AC concerns are also tested:

- The behavior-preserving claim for the envelope-base + hook-factory refactor: TC-ENV2 and TC-HOOK2 are the regression gates.
- The CipherStash team's remaining open question on EQL lowering (`asc`/`desc` wrapping): resolved during T8 with the team and pinned by the relevant E2E TC once the canonical lowering is chosen. (JSON function names are already locked in the spec.)

## Milestones

### Milestone 1: Project 2 — single milestone

Spec FR1–FR10. All five new codecs, all 17 new operators (13 predicate + 4 helper), the shared envelope base, the codec-hook factory, the SDK shape change, the bulk-encrypt middleware extension, the example app extension, and the docs migration. Tasks are sequenced so each lands as a focused commit on the branch; the validation gate runs at PR-open time and re-runs on every push.

**Tasks** (sequenced; each task lands as one or more commits with a coherent diff; commits follow the repo's commit-as-you-go convention):

#### Substrate refactors — behavior-preserving (T1–T4)

These four tasks land before any new types or operators. Each is verified by the existing test suite passing without modification, plus the byte-identical baseline-migration regeneration check.

- [ ] **T1 — Generalise the SDK contract.** Widen `CipherstashSdk.bulkEncrypt({ values: ReadonlyArray<unknown> })` and `bulkDecrypt: Promise<ReadonlyArray<unknown>>` in `packages/3-extensions/cipherstash/src/execution/sdk.ts`. Update mock SDK fixtures in tests to use `unknown`-typed values pass-through. _(satisfies: TC-SDK1, TC-SDK2)_

- [ ] **T2 — Extract `EncryptedEnvelopeBase<T>`.** Create `packages/3-extensions/cipherstash/src/execution/envelope-base.ts` with the abstract base encapsulating handle, `expose()`, `decrypt({signal?})`, the five `[REDACTED]` overrides, and the handle-mutator helpers. Refactor `EncryptedString` (`./envelope.ts`) to extend the base; the existing public surface is preserved verbatim. _(satisfies: TC-ENV1, TC-ENV2)_

- [ ] **T3 — Introduce `makeCipherstashCodecHooks` factory.** Create `packages/3-extensions/cipherstash/src/migration/codec-hooks-factory.ts` housing the parameterized factory. Refactor `cipherstashStringCodecHooks` (in `migration/cipherstash-codec.ts`) to use the factory. Verify by regenerating the example app's baseline migration — `ops.json` must be byte-identical to today's. _(satisfies: TC-HOOK1, TC-HOOK2)_

- [ ] **T4 — Widen `CipherstashSearchIndex`.** Update the type union in `migration/call-classes.ts` to `'unique' | 'match' | 'ore' | 'ste_vec'`. Factory functions and call-class constructors accept the new values unchanged (the existing `castAs?` parameter accepts arbitrary strings already). Add a unit test pinning the widened type. _(satisfies: TC-HOOK4)_

#### Type expansion — Double, BigInt (T5)

These two codecs are nearly identical (both use `{ equality, orderAndRange }` flags; differ in `cast_as`). Ship as one task because the duplicated cost of separating them is high relative to the wiring.

- [ ] **T5 — `EncryptedDouble` + `EncryptedBigInt`.** Per codec:
  - New envelope subclass (`execution/envelopes/double.ts`, `bigint.ts`).
  - New parameterized codec descriptor + codec-runtime body (`execution/parameterized.ts` extension; new files under `execution/codecs/`).
  - PSL constructor (`contract/authoring.ts`); TS factory (`exports/column-types.ts`).
  - Codec hook configuration via the factory; wire into `exports/control.ts`.
  - Parity fixture under `test/integration/parity/cipherstash-encrypted-{double,bigint}/`.
  - Re-exports through `/runtime` subpath.
  - Per-codec unit tests pinning encode/decode, redaction, JSON-stringify placeholder.

  _(satisfies: TC-ENV3, TC-ENV4, TC-ENV5, TC-ENV8, TC-ENV9, TC-CODEC1, TC-CODEC2, TC-CODEC3, TC-HOOK3, TC-AUTH1, TC-AUTH2, TC-AUTH3)_

#### Type expansion — Date, Boolean, Json (T6)

Three more codecs, same pattern. Ship as one task; the marginal cost of a new codec is small once T5 establishes the template.

- [ ] **T6 — `EncryptedDate` + `EncryptedBoolean` + `EncryptedJson`.** Same per-codec checklist as T5. `EncryptedDate` ships with `parseDecryptedValue(unknown): Date` to narrow the SDK's `Promise<unknown>` to `Date` (the SDK returns ISO-shaped values on the wire; the codec narrows). `EncryptedBoolean` ships with `{ equality }` flag only. `EncryptedJson` ships with `{ searchableJson }` flag only and uses the `'ste_vec'` index. _(satisfies: TC-ENV3–9, TC-CODEC1–3, TC-HOOK3, TC-AUTH1–3 for these three types)_

#### Substrate extension for new types (T7)

- [ ] **T7 — Bulk-encrypt middleware + `decryptAll` widening.** Update the codec-id filter in `middleware/bulk-encrypt.ts` to match any of the six cipherstash codec ids. Update `decryptAll` in `execution/decrypt-all.ts` to walk for `EncryptedEnvelopeBase` instances (not specifically `EncryptedString`). Per-envelope-subclass narrowing happens via the subclass's `parseDecryptedValue` hook. _(satisfies: TC-MW1, TC-MW2, TC-DEC1, TC-DEC2)_

#### `EncryptedString` `orderAndRange` extension (T8)

- [ ] **T8 — Extend `EncryptedString` constructor.** Add the `orderAndRange` flag to the PSL constructor (`contract/authoring.ts`), the TS factory (`exports/column-types.ts`), the arktype params schema (`execution/parameterized.ts`), and the codec hook configuration (`{ equality: 'unique', freeTextSearch: 'match', orderAndRange: 'ore' }`). Update the existing string parity fixture to cover the new flag. Update the example app's existing schema with one column using `EncryptedString({ orderAndRange: true })`. _(satisfies subset of TC-AUTH1–3 for strings)_

#### Predicate operators (T9–T10)

- [ ] **T9 — Predicate operators wiring (registry).** Implement the eleven new predicate operators in `execution/operators.ts`:
  - `cipherstashNe`, `cipherstashInArray`, `cipherstashNotInArray`, `cipherstashNotIlike`.
  - `cipherstashGt`, `cipherstashGte`, `cipherstashLt`, `cipherstashLte`.
  - `cipherstashBetween`, `cipherstashNotBetween`.
  - `cipherstashJsonbPathExists`.

  Each follows the existing `eqlOperator(publicMethod, eqlFunction)` factory shape. `cipherstashInArray` builds a dynamic OR-of-equalities lowering template at impl time (one `ParamRef` per array element; common routing-key stamp). `cipherstashBetween` builds a two-bound template. Register against the right `self.codecId` (e.g. `cipherstashGt` against all four order-and-range-supporting codecs: `string`, `double`, `bigint`, `date`). _(satisfies: TC-OPP1, TC-OPP2, TC-OPP3, TC-OPP4)_

- [ ] **T10 — Predicate operator type-visibility.** Extend `types/operation-types.ts` with the eleven new entries, each typed for its target codec(s). Add negative type-tests in the package's test suite. _(satisfies: TC-OPP5, TC-OPT1)_

#### Free-standing helpers (T11)

- [ ] **T11 — Free-standing helpers.** Implement and export from `@prisma-next/extension-cipherstash/runtime`:
  - `cipherstashAsc(col)` / `cipherstashDesc(col)` — return `OrderByItem` wrapping a column expression in the EQL-friendly ORDER BY shape. The exact lowering (whether to use `eql_v2.order_by_<index>(col)` or bare column reference) is confirmed with the CipherStash team during this task; the choice is captured in `DEVELOPING.md`.
  - `cipherstashJsonbPathQueryFirst(col, path)` lowers to `eql_v2.jsonb_path_query_first({{col}}, {{path}})`. `cipherstashJsonbGet(col, path)` lowers to `eql_v2."->"({{col}}, {{path}})` using the `(eql_v2_encrypted, text)` overload. Both return `Expression<ScopeField>`.
  - Each helper validates the column's codec id and throws a descriptive error on mismatch.

  Tests: AST-shape unit tests + SQL-snapshot tests + error-path tests. _(satisfies: TC-OPH1, TC-OPH2, TC-OPH3)_

#### Example app and end-to-end validation (T12)

- [ ] **T12 — Example app extension + end-to-end tests.** Update `examples/cipherstash-integration` schema with one column of each new type and a sample query per type. Wire the example into the integration test suite with live Postgres + EQL coverage for all seven AC-E2E criteria (Number, BigInt, Date, Boolean, Json, String-range, Mixed-query SDK round-trip count). _(satisfies: TC-E2E1–7, TC-EX1, TC-OPT1)_

#### Documentation and close-out (T13)

- [ ] **T13 — Documentation + close-out.**
  - Update `packages/3-extensions/cipherstash/README.md` with all five new types, the predicate-vs-helper operator split, the EQL search-config index types in use, and a "Known limitations" section enumerating the explicitly-deferred surfaces (encrypted timestamp/datetime, non-bigint integer variants, re-encryption migration, per-column key-id override).
  - Migrate the design decisions captured in `projects/cipherstash-integration/project-2/spec.md` to a durable location. Likely shape: an amendment to ADR 211 (extension operator surface) capturing the predicate-vs-helper split, plus updates to `packages/3-extensions/cipherstash/DEVELOPING.md` for the per-codec wiring template. New ADR if scope warrants.
  - Strip repo-wide references to `projects/cipherstash-integration/project-2/**` (replace with canonical `docs/` links or remove).
  - Delete `projects/cipherstash-integration/project-2/` directory in the close-out PR.
  - Do NOT manually transition the Linear ticket — the GitHub integration auto-completes TML-2375 when the PR merges (provided the PR title or branch name carries the identifier; the branch name does).

  _(satisfies: TC-DOC1, TC-DOC2)_

**Validation gate.** The single validation gate runs at PR-open time and re-runs on every push. All commands must pass before the PR is mergeable.

- `pnpm --filter @prisma-next/extension-cipherstash build`
- `pnpm --filter @prisma-next/extension-cipherstash test`
- `pnpm typecheck` (workspace-wide — catches type-visibility regressions in downstream consumers)
- `pnpm test:packages` (workspace-wide — regression check across all extensions and the SQL lanes)
- `pnpm test:integration` (covers parity fixtures and integration-level regression)
- `pnpm test:e2e` (covers AC-E2E1–7 against live Postgres + EQL via PGlite)
- `pnpm --filter cipherstash-integration-example typecheck`
- `pnpm --filter cipherstash-integration-example test` (if the example has e2e coverage of the new types — wired in T12)
- `pnpm lint:deps`
- `pnpm fixtures:check` (covers parity fixture invariants)

## Open Items

Carried forward from the spec's open questions. Each resolves during execution; the resolution is captured in code and `DEVELOPING.md` rather than reopened as a design discussion.

1. **Exact lowering for `cipherstashAsc` / `cipherstashDesc`** — resolved in T11 against the bundled EQL functions. If the EQL bundle exposes a canonical ORDER BY wrapping function, use it. If bare column reference works via EQL's `<` / `>` overrides on `eql_v2_encrypted`, use that. The choice is pinned by TC-E2E1 (Number sort) at the live-Postgres level.

2. **`cipherstashInArray` lowering** — resolved in T9. Default: dynamic OR-of-equalities at impl time. If EQL surfaces a dedicated `eql_v2.in_array(col, encrypted_array)` function with better performance, swap to it. Either is correct; the choice is performance, not correctness.

3. **Should the close-out doc migration produce one ADR amendment or a new ADR?** Resolved in T13 by inspecting ADR 211's current scope and deciding whether the predicate-vs-helper split fits as an extension or merits its own ADR. Lean: amendment to ADR 211, since the split is a refinement of the namespaced-replacement-operators pattern rather than a new architectural decision.

4. **CipherStash team confirmation on the SDK polymorphic contract.** The user reported the team's request; T1 captures the wire-level shape. Surface to the team at the start of T1 for sign-off so the contract is locked before downstream tasks consume it.
