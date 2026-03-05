# Code Review — PSL Contract Parity Missing Behaviors

**Branch:** `psl-capabilities-and-extensions`
**Base:** `origin/main`
**Spec:** [psl-contract-parity-missing-behaviors.spec.md](../psl-contract-parity-missing-behaviors.spec.md)
**Review range:** `origin/main...HEAD` (9 commits, 32 files, +978 −173)

## Summary

The branch delivers three PSL contract authoring fixes (framework metadata emission, vector(N) DDL rendering, FK naming via `@relation(map: ...)`), switches the demo to PSL-first, and updates integration parity fixtures to match. The implementation is well-structured and the fixes are correct, with good unit and integration test coverage. Main concerns are around type safety bypasses in the provider and missing E2E acceptance test coverage per the spec.

## What Looks Solid

- **Root cause fix for vector DDL**: The separation of `nativeType: 'vector'` from `typeParams: { length }` is clean and addresses the root cause correctly. The fix spans the right layers: extension column types → interpreter → adapter type expansion → planner rendering.
- **Parity test harness**: The existing `cli.emit-parity-fixtures.test.ts` provides strong guarantees — it asserts byte-identical emitted contracts between TS and PSL authoring, including hash equality. The updated fixtures exercise the new behaviors.
- **`@relation(map: ...)` implementation**: The interpreter change is minimal and well-integrated. It follows the same pattern as existing `onDelete`/`onUpdate` argument handling.
- **`sortDeep` for deterministic output**: Proper approach for ensuring hash stability across different merge orderings.
- **Demo simplification**: The `similarity-search.ts` cleanup (removing runtime type guards for `hasVectorOpsColumn`) is a tangible sign that the type system now works correctly with PSL-emitted contracts.

## Blocking Issues

### F01 — Provider test bypasses its own type system with `as unknown as never`

**Status:** Resolved

**Issue:** The provider test casts the options object to `as unknown as never`:

```typescript
const contract = prismaContract('./schema.prisma', {
  composedExtensionPacks: ['pgvector'],
  extensionPacks: { pgvector: pgvectorPack },
  capabilitySources: [postgresAdapterMeta, pgvectorPack],
} as unknown as never);
```

The comment says "Intentionally not typed yet; provider will accept this in a follow-up milestone" — but `extensionPacks` and `capabilitySources` *are* defined on `PrismaContractOptions` in the same branch. This cast hides any type errors in the test's usage of the provider API.

**Suggestion:** Remove the `as unknown as never` cast. If the export barrel doesn't re-export the updated type, fix the export so tests exercise the real API surface.

### F02 — Missing E2E `dbInit` test for PSL-emitted pgvector schema

**Status:** Resolved

**Issue:** The spec explicitly requires: *"CI includes at least one test that runs PSL provider → emitted artifacts → dbInit on a schema containing a dimensioned pgvector column, and asserts the migration runner succeeds."* This is absent. The planner unit test proves DDL rendering is correct, but there is no test exercising the full pipeline (PSL → contract → planner → runner) that would catch integration issues between layers.

**Suggestion:** Add an integration test (possibly in `test/integration/test/`) that takes the `pgvector-named-type` fixture, emits a contract from PSL, and runs `dbInit` against a test database. This is the test that would have caught the original `"vector(1536)"` bug.

### F03 — Missing demo dual-mode E2E test

**Status:** Resolved

**Issue:** The spec requires: *"There is an end-to-end test that proves the demo test suite passes when configured to use TS contract source and PSL contract source."* The demo has been switched to PSL-only. While the parity fixtures prove IR equivalence, no test runs the demo's own test suite in both modes.

**Suggestion:** Add a test (or CI job) that runs the demo tests with each config. This could be as simple as two config files (one TS, one PSL) and a test runner that exercises both.

## Non-Blocking Concerns

### F04 — Provider uses unsafe casts to graft capabilities onto IR

**Status:** Resolved

**Issue:** The provider casts `interpreted.value` to an ad-hoc type to access `capabilities` and `extensionPacks`, then uses `as never` when spreading the result:

```typescript
const base = interpreted.value as unknown as {
  readonly capabilities?: Record<string, unknown> | undefined;
  readonly extensionPacks?: Record<string, unknown> | undefined;
};
// ...
return ok({
  ...interpreted.value,
  extensionPacks: sortDeep(extensionPacks) as never,
  capabilities: sortDeep(mergedCapabilities) as never,
});
```

This bypasses compile-time checks. If the IR's `capabilities` field changes shape, no type error will flag the mismatch.

**Suggestion:** Extend the interpreter's return type (or the contract IR type) to include optional `capabilities` and `extensionPacks` fields so the provider doesn't need to cast.

### F05 — `capabilitySources` accepts `readonly unknown[]`

**Status:** Resolved

**Issue:** The `capabilitySources` option is typed as `readonly unknown[]`, providing no type guidance to consumers. A caller could pass anything (numbers, strings, etc.) and the merge logic would silently skip non-objects.

**Suggestion:** Define a minimal interface, e.g.:

```typescript
interface CapabilitySource {
  readonly capabilities?: Record<string, Record<string, unknown>>;
}
```

This documents the expected shape and gives type errors for clearly wrong inputs.

### F06 — Utility duplication across provider and test templates

**Status:** Deferred

**Location:**
- [packages/2-sql/2-authoring/contract-psl/src/provider.ts (L11–L61)](packages/2-sql/2-authoring/contract-psl/src/provider.ts:11-61)
- [test/integration/test/authoring/templates/prisma-next.config.parity-ts.ts (L8–L58)](test/integration/test/authoring/templates/prisma-next.config.parity-ts.ts:8-58)
- [test/integration/test/authoring/templates/prisma-next.config.parity-psl.ts (L9–L25)](test/integration/test/authoring/templates/prisma-next.config.parity-psl.ts:9-25)

**Issue:** `isPlainObject`, `mergePlainObjects`, and `extensionPackMetaFromDescriptor` are duplicated. The TS parity config template also duplicates `mergeCapabilitiesFromSources`. While test duplication is tolerable, the core merge logic should live in one place if it will be reused across providers.

**Suggestion:** Extract the merge utilities to a shared module (e.g., `@prisma-next/utils/merge`) if these are needed beyond the PSL provider. For now, at minimum add a comment in the test templates noting they are intentional copies.

### F07 — Demo type tests changed from `expectTypeOf` to manual pattern

**Status:** Deferred

**Location:**
- [examples/prisma-next-demo/src/queries/get-user-posts.types.test.ts](examples/prisma-next-demo/src/queries/get-user-posts.types.test.ts)
- [examples/prisma-next-demo/src/queries/similarity-search.test-d.ts](examples/prisma-next-demo/src/queries/similarity-search.test-d.ts)
- [examples/prisma-next-demo/src/queries/similarity-search.types.test.ts](examples/prisma-next-demo/src/queries/similarity-search.types.test.ts)

**Issue:** These tests replace `expectTypeOf` (from vitest) with a manual `Expect<Equal<A, B>>` pattern. This is a tangential change to the PSL parity work. While the manual pattern is reliable, the motivation for the switch isn't documented and could confuse future contributors.

**Suggestion:** If there was a specific issue with `expectTypeOf` that motivated this change (e.g., false positives with branded types), document it briefly in a commit message or comment. If it was opportunistic cleanup, consider separating it into its own commit for clarity.

### F08 — `no-emit/context.ts` change is tangential

**Status:** Deferred (acknowledged; left as-is)

**Location:** [examples/prisma-next-demo/src/prisma-no-emit/context.ts (L3, L15)](examples/prisma-next-demo/src/prisma-no-emit/context.ts:3-15)

**Issue:** Adding `pgvector` to `extensionPacks` in the no-emit workflow is a separate fix (previously the no-emit workflow didn't include pgvector, making it silently incomplete). While correct, it's unrelated to PSL parity and should be called out in commit/PR description.

**Suggestion:** Acknowledge this as a pre-existing gap fix in the commit or PR description.

### F09 — No ADR for the vector type representation change

**Status:** Resolved

**Issue:** The change from `nativeType: 'vector(1536)'` to `nativeType: 'vector'` + `typeParams` is a design decision that affects all future parameterized extension types. This pattern ("base type in `nativeType`, parameters in `typeParams`, expansion in the adapter") should be documented so future extension authors follow it.

**Suggestion:** Add an ADR under `docs/architecture docs/adrs/` documenting the convention: parameterized native types must store the base type name in `nativeType` and carry parameters in `typeParams`, with expansion handled by the target adapter's `expandParameterizedNativeType`.

## Nits

### F10 — `PG_VECTOR_CODEC_ID` defined locally in parameterized-types.ts

**Status:** Deferred

**Location:** [packages/3-targets/6-adapters/postgres/src/core/parameterized-types.ts (L35)](packages/3-targets/6-adapters/postgres/src/core/parameterized-types.ts:35)

**Issue:** The constant `PG_VECTOR_CODEC_ID = 'pg/vector@1'` is defined locally rather than imported from a shared codec-ids module. Other codec IDs in the same file are imported from `./codec-ids`.

**Suggestion:** If pgvector codec IDs are exported from the pgvector extension pack or a shared location, import from there for consistency.

### F11 — Vector length validation differs from `isValidTypeParamNumber`

**Status:** Deferred

**Location:** [packages/3-targets/6-adapters/postgres/src/core/parameterized-types.ts (L89–L94)](packages/3-targets/6-adapters/postgres/src/core/parameterized-types.ts:89-94)

**Issue:** The vector-specific validation inlines its checks (`typeof length === 'number' && Number.isFinite(length) && Number.isInteger(length) && length > 0`) rather than reusing `isValidTypeParamNumber` (which checks `>= 0`). The `> 0` difference is intentional (zero-dim vectors are meaningless), but the duplication of the other three checks is unnecessary.

**Suggestion:** Could be `isValidTypeParamNumber(length) && length > 0`, or leave as-is since the intent is clear.

## Acceptance-Criteria Traceability

| Acceptance Criterion | Implementation | Evidence |
|---|---|---|
| `extensionPacks` emitted for composed pgvector | [provider.ts (L139–L141)](packages/2-sql/2-authoring/contract-psl/src/provider.ts:139-141) merges pack metadata | [provider.test.ts (L291–L295)](packages/2-sql/2-authoring/contract-psl/test/provider.test.ts:291-295) asserts `extensionPacks.pgvector` matches; [pgvector-named-type/expected.contract.json](test/integration/test/authoring/parity/pgvector-named-type/expected.contract.json) parity fixture |
| `capabilities.postgres` emitted | [provider.ts (L143–L146)](packages/2-sql/2-authoring/contract-psl/src/provider.ts:143-146) merges capabilities from sources | [provider.test.ts (L297–L304)](packages/2-sql/2-authoring/contract-psl/test/provider.test.ts:297-304) asserts merged capabilities; parity fixture |
| Vector DDL valid (`vector(1536)` unquoted) | [column-types.ts (L43)](packages/3-extensions/pgvector/src/exports/column-types.ts:43) `nativeType: 'vector'`; [parameterized-types.ts (L87–L98)](packages/3-targets/6-adapters/postgres/src/core/parameterized-types.ts:87-98) expands to `vector(N)` | [planner.case1.test.ts](packages/3-targets/3-targets/postgres/test/migrations/planner.case1.test.ts) asserts `"embedding" vector(1536)` and `NOT "vector(1536)"`; [parameterized-types.test.ts](packages/3-targets/6-adapters/postgres/test/parameterized-types.test.ts) |
| Vector contract shape compatible with migrations | [interpreter.ts (L562)](packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:562) emits `nativeType: 'vector'` + `typeParams`; no `typeRef` | [interpreter.diagnostics.test.ts](packages/2-sql/2-authoring/contract-psl/test/interpreter.diagnostics.test.ts) asserts new shape; planner test asserts correct DDL |
| `@relation(map: ...)` supported | [interpreter.ts (L1025–L1038)](packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:1025-1038) parses `map`; [interpreter.ts (L1503)](packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:1503) passes to FK builder | [interpreter.relations.test.ts](packages/2-sql/2-authoring/contract-psl/test/interpreter.relations.test.ts) asserts FK name in storage; [map-attributes parity fixture](test/integration/test/authoring/parity/map-attributes/) |
| No regression | Existing tests updated for new contract shape | Updated fixtures and snapshot assertions |
| **New E2E test (PSL → dbInit)** | [psl.pgvector-dbinit.test.ts](test/integration/test/authoring/psl.pgvector-dbinit.test.ts) exercises PSL → emit → dbInit | Integration test asserts dbInit plan/apply succeeds and avoids `"vector(1536)"` |
| **Demo dual-mode test** | `pnpm test:dual-mode` | [examples/prisma-next-demo/package.json](examples/prisma-next-demo/package.json), [examples/prisma-next-demo/prisma-next.config.ts-contract.ts](examples/prisma-next-demo/prisma-next.config.ts-contract.ts) |
| **FK introspection test** | **NOT IMPLEMENTED** | Spec mentions "where observable via introspection" |
