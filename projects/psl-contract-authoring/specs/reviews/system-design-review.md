# System Design Review — PSL Contract Parity Missing Behaviors

**Branch:** `psl-capabilities-and-extensions`
**Base:** `origin/main`
**Spec:** [psl-contract-parity-missing-behaviors.spec.md](../psl-contract-parity-missing-behaviors.spec.md)
**Review range:** `origin/main...HEAD` (9 commits)

## Problem & New Guarantees

This branch closes three PSL contract authoring gaps relative to TypeScript contract authoring:

1. **Framework metadata emission**: PSL-emitted contracts now include `extensionPacks` and `capabilities`, previously empty.
2. **Parameterized vector type DDL**: PSL-emitted contracts for pgvector `vector(N)` now render valid unquoted DDL, fixing the `"vector(1536)"` quoted-identifier bug.
3. **FK constraint naming**: PSL interpreter now accepts `@relation(..., map: "...")` and propagates the name into contract storage.

The existing invariant — *PSL-authored and TS-authored contracts for equivalent schemas produce byte-identical emitted artifacts* — was already enforced by the parity test harness at [test/integration/test/authoring/cli.emit-parity-fixtures.test.ts](test/integration/test/authoring/cli.emit-parity-fixtures.test.ts). This branch extends the fixtures exercising that harness to cover the previously-failing cases (pgvector named types, FK naming via `map`, extension pack metadata, capabilities).

## Subsystem Fit

### Contract Authoring (PSL Interpreter + Provider)

The PSL interpreter (`packages/2-sql/2-authoring/contract-psl/src/interpreter.ts`) handles two of the three fixes:

- **Vector type representation**: Named type descriptors for pgvector no longer embed the dimension in `nativeType` and no longer set `typeRef`. Instead, `nativeType: 'vector'` + `typeParams: { length }` is used. This matches the TS authoring path.
- **FK naming**: The `@relation` attribute parser now accepts `map` and records it as `constraintName`, which flows through to `foreignKey({ name: constraintName })`.

The PSL provider (`packages/2-sql/2-authoring/contract-psl/src/provider.ts`) handles framework metadata:

- **Architecture**: Rather than deriving capabilities/extension packs from the PSL schema (which has no surface area for this), the provider accepts them as explicit options (`extensionPacks`, `capabilitySources`) and merges them into the interpreted IR. This is pragmatic and mirrors how the TS authoring path currently requires manual capability configuration.
- **Determinism**: `sortDeep` ensures key ordering is lexicographic, making hashes stable regardless of merge order.

**Assessment**: The explicit-options approach is sound for the current milestone. It sidesteps the need for a discovery/derivation mechanism (spec Open Question 1) and keeps the provider simple. The merge semantics (deep merge of plain objects, last-write-wins for scalars) are reasonable and well-tested.

### Extension System (pgvector column types)

The `vector()` factory in `@prisma-next/extension-pgvector/column-types` was updated to emit `nativeType: 'vector'` instead of `nativeType: 'vector(1536)'`. This is a **breaking change to the contract IR shape** for any existing contracts using `vector(N)`.

**Assessment**: This is correctly treated as a bugfix. The old representation was semantically incorrect — embedding the dimension in `nativeType` conflated the base type with its parameters, preventing the planner from handling it correctly. All storage hashes change, which is expected and captured in updated fixtures.

### Migration Planner (Postgres)

The planner's `buildColumnTypeSql` function has a critical branch at [planner.ts (L812–L814)](packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts:812-814):

```typescript
if (column.typeRef) {
  return quoteIdentifier(column.nativeType);
}
```

This was the root cause of the `"vector(1536)"` bug: when `typeRef` was present, the planner quoted the entire `nativeType` value as an identifier.

The fix works by **removing `typeRef` from pgvector named type descriptors** so this branch is never hit for vector columns. The planner then falls through to `renderParameterizedTypeSql`, which delegates to `expandParameterizedNativeType`.

**Assessment**: This fix is correct and minimal. The `typeRef → quoteIdentifier` path remains valid for enum types and other named types where quoting is appropriate. The new `expandParameterizedNativeType` handler for `pg/vector@1` in `parameterized-types.ts` correctly validates the length parameter before expansion.

### Adapter (Postgres parameterized types)

A new `PG_VECTOR_CODEC_ID` case was added to `expandParameterizedNativeType` in `packages/3-targets/6-adapters/postgres/src/core/parameterized-types.ts`. It validates that `length` is a positive finite integer and expands `vector` + `length: 1536` → `vector(1536)`.

**Assessment**: Clean separation of concerns. The adapter owns the type-expansion logic, and the planner calls into it. The vector-specific validation (`length > 0`) is intentionally stricter than the general `isValidTypeParamNumber` (`value >= 0`), which makes sense since a zero-dimensional vector is meaningless.

## Boundary Correctness

### Import layering

- PSL provider (Layer 2: Authoring) imports from `@prisma-next/utils` and `@prisma-next/psl-parser` — appropriate.
- Parameterized type expansion in the adapter (Layer 6) is consumed by the planner (Layer 3) and schema verification — appropriate direction.
- The provider does **not** import adapter or planner code — correct boundary.

### Deterministic artifacts

The `sortDeep` function ensures merged capabilities/extension packs have deterministic key ordering. The parity test fixture asserts `tsContractJson === pslContractJson` (deep equal), which transitively asserts hash stability.

## ADRs

Added [ADR 170 - Parameterized native types in contracts](../../../docs/architecture%20docs/adrs/ADR%20170%20-%20Parameterized%20native%20types%20in%20contracts.md), documenting the convention that `nativeType` remains the base identifier while parameters live in `typeParams`, with adapter-owned expansion for both DDL rendering and schema verification.

## Test Strategy Adequacy

### What is proven

| Behavior | Test Evidence |
|---|---|
| pgvector `vector(N)` contract shape (nativeType + typeParams) | [interpreter.diagnostics.test.ts](packages/2-sql/2-authoring/contract-psl/test/interpreter.diagnostics.test.ts), [column-types.test.ts](packages/3-extensions/pgvector/test/column-types.test.ts) |
| Planner renders `vector(1536)` unquoted | [planner.case1.test.ts](packages/3-targets/3-targets/postgres/test/migrations/planner.case1.test.ts) |
| `expandParameterizedNativeType` handles pgvector | [parameterized-types.test.ts](packages/3-targets/6-adapters/postgres/test/parameterized-types.test.ts) |
| `@relation(map: ...)` accepted and FK name recorded | [interpreter.relations.test.ts](packages/2-sql/2-authoring/contract-psl/test/interpreter.relations.test.ts) |
| Provider emits extensionPacks and merged capabilities | [provider.test.ts](packages/2-sql/2-authoring/contract-psl/test/provider.test.ts) |
| TS/PSL parity (byte-identical emitted contracts) | [cli.emit-parity-fixtures.test.ts](test/integration/test/authoring/cli.emit-parity-fixtures.test.ts) |

### Gaps vs spec acceptance criteria

1. **E2E `dbInit` test for PSL-emitted pgvector schema**: Implemented in [psl.pgvector-dbinit.test.ts](../../../test/integration/test/authoring/psl.pgvector-dbinit.test.ts). This covers PSL provider → emit → `dbInit(plan/apply)` and asserts against the original `"vector(1536)"` quoting failure mode.

2. **Demo dual-mode test**: Implemented as [examples/prisma-next-demo/package.json](../../../examples/prisma-next-demo/package.json) script `pnpm test:dual-mode`, using a dedicated TS emit config [examples/prisma-next-demo/prisma-next.config.ts-contract.ts](../../../examples/prisma-next-demo/prisma-next.config.ts-contract.ts).

3. **No FK introspection test**: The spec mentions "introspect DB if feasible" for FK naming verification. The interpreter test asserts the FK name in contract storage, but no test verifies the constraint name in the database.

## Architectural Concerns

### 1. Provider type system bypass (Medium)

Resolved: the provider now merges `extensionPacks`/`capabilities` without unsafe casts and uses a typed `CapabilitySource` shape for `capabilitySources`.

### 2. Utility duplication (Low)

`isPlainObject`, `mergePlainObjects`, and `extensionPackMetaFromDescriptor` are duplicated across the provider and integration test config templates. The test duplication is tolerable (test helpers), but if the merge logic is needed in other providers it should be extracted.

### 3. `typeRef` path in planner remains a latent risk (Low)

The `typeRef → quoteIdentifier(nativeType)` path in the planner still exists and will quote any `nativeType` string verbatim if `typeRef` is set. This is correct for enums (e.g., quoting `user_type`), but any future extension type that uses `typeRef` with a parameterized `nativeType` would hit the same bug. The fix is local to pgvector (removing `typeRef`), not systemic (teaching the planner about parameterized type refs).

## Compatibility / Migration / Risk

- **Breaking**: The `nativeType` change from `'vector(1536)'` to `'vector'` changes storage hashes. Any existing contracts using the old format will need to be re-emitted.
- **Non-breaking**: The addition of `extensionPacks` and `capabilities` to previously-empty contract fields adds data without removing any. Hash changes are expected.
- **Demo**: The demo is now PSL-first. The old TS contract (`prisma/contract.ts`) is still present but no longer used by the default config. The no-emit workflow still references the TS contract.
- **Risk**: The `typeRef` removal from pgvector descriptors means columns using pgvector named types no longer have type-level "aliasing" information in the contract. This is fine for the migration planner but could affect downstream tooling that uses `typeRef` for display or documentation purposes.
