# Walkthrough — PSL Contract Parity Missing Behaviors

## Key snippets

### Before / After — Vector type representation in contract storage

```typescript
// BEFORE — nativeType embeds dimension; typeRef triggers quoteIdentifier in planner
namedTypeDescriptors.set(declaration.name, {
  codecId: 'pg/vector@1',
  nativeType: `vector(${length})`,
  typeRef: declaration.name,
});
```

```typescript
// AFTER — nativeType is base type only; typeParams carries dimension; no typeRef
namedTypeDescriptors.set(declaration.name, {
  codecId: 'pg/vector@1',
  nativeType: 'vector',
  typeParams: { length },
});
```

### New — Provider merges framework metadata into PSL-emitted contracts

```typescript
// NEW — provider merges extensionPacks and capabilities from explicit sources
const extensionPacks = options?.extensionPacks
  ? mergePlainObjects(base.extensionPacks ?? {}, options.extensionPacks)
  : (base.extensionPacks ?? {});

const mergedCapabilities = mergeCapabilities(
  interpreted.value.capabilities,
  mergeCapabilitiesFromSources(options?.capabilitySources),
);

return ok({
  ...interpreted.value,
  extensionPacks: sortDeepTyped(extensionPacks),
  capabilities: sortDeepTyped(mergedCapabilities),
});
```

## Sources

- Spec: [psl-contract-parity-missing-behaviors.spec.md](../psl-contract-parity-missing-behaviors.spec.md)
- Plan: [psl-contract-parity-missing-behaviors-plan.md](../../plans/psl-contract-parity-missing-behaviors-plan.md)
- Commit range: `origin/main...HEAD`

Commits:

```
271c5e940 refactor(prisma-next-demo): emit from PSL without contract shaping
b5cea85a5 test(integration): update parity fixtures for pgvector and FK naming
6ab78f1b8 fix(extension-pgvector): keep nativeType parameter-free for vector(N)
27093bed9 feat(sql-contract-psl): support @relation(map: ...) FK naming
219da2f2c fix(sql-contract-psl): emit pgvector vector(N) as base type + params
e6be130fa feat(adapter-postgres): expand pgvector vector(N) native types
ff63898d0 feat(sql-contract-psl): emit framework metadata in provider
e94990f40 test: lock in PSL parity regressions
0766ea841 Add docs
```

## Intent

Bring PSL contract authoring to parity with TypeScript contract authoring for the behaviors exercised by the demo app: framework metadata (extension packs, capabilities), parameterized vector DDL, and FK constraint naming. The end goal is that `examples/prisma-next-demo` can switch between TS and PSL as its contract source with no behavioral difference.

## Change map

- **Implementation**:
  - [packages/2-sql/2-authoring/contract-psl/src/provider.ts (L11–L156)](packages/2-sql/2-authoring/contract-psl/src/provider.ts:11-156) — framework metadata merging
  - [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L559–L562)](packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:559-562) — vector type representation fix
  - [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L1025–L1038)](packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:1025-1038) — `@relation(map: ...)` parsing
  - [packages/3-extensions/pgvector/src/exports/column-types.ts (L41–L44)](packages/3-extensions/pgvector/src/exports/column-types.ts:41-44) — `vector()` factory nativeType fix
  - [packages/3-targets/6-adapters/postgres/src/core/parameterized-types.ts (L87–L98)](packages/3-targets/6-adapters/postgres/src/core/parameterized-types.ts:87-98) — vector(N) expansion
  - [examples/prisma-next-demo/prisma-next.config.ts](examples/prisma-next-demo/prisma-next.config.ts) — demo switched to PSL-first
- **Tests (evidence)**:
  - [packages/2-sql/2-authoring/contract-psl/test/provider.test.ts (L264–L334)](packages/2-sql/2-authoring/contract-psl/test/provider.test.ts:264-334) — vector shape + metadata emission
  - [packages/2-sql/2-authoring/contract-psl/test/interpreter.relations.test.ts (L216–L249)](packages/2-sql/2-authoring/contract-psl/test/interpreter.relations.test.ts:216-249) — FK naming
  - [packages/3-targets/3-targets/postgres/test/migrations/planner.case1.test.ts (L293–L352)](packages/3-targets/3-targets/postgres/test/migrations/planner.case1.test.ts:293-352) — DDL rendering
  - [packages/3-targets/6-adapters/postgres/test/parameterized-types.test.ts (L118–L128)](packages/3-targets/6-adapters/postgres/test/parameterized-types.test.ts:118-128) — type expansion
  - [test/integration/test/authoring/cli.emit-parity-fixtures.test.ts](test/integration/test/authoring/cli.emit-parity-fixtures.test.ts) — TS/PSL parity enforcement
  - [test/integration/test/authoring/psl.pgvector-dbinit.test.ts](test/integration/test/authoring/psl.pgvector-dbinit.test.ts) — PSL → emit → dbInit coverage
  - [examples/prisma-next-demo/package.json](examples/prisma-next-demo/package.json) — `pnpm test:dual-mode` runs demo suite in TS and PSL emit modes

## ADR

- [ADR 170 - Parameterized native types in contracts](../../../docs/architecture%20docs/adrs/ADR%20170%20-%20Parameterized%20native%20types%20in%20contracts.md) documents the convention: base `nativeType` + structured `typeParams`, expanded by the adapter for DDL and verification.

## The story

1. **Lock in regressions with tests first.** Before making fixes, existing test fixtures and new test cases capture the precise failure modes (empty `extensionPacks`/`capabilities`, parameterized `nativeType` shape, unsupported `@relation(map: ...)`).

2. **Fix the vector type representation across the stack.** The root cause of the `"vector(1536)"` DDL bug was a conflation of two concerns: the PSL interpreter embedded the dimension in `nativeType` (`'vector(1536)'`) and set `typeRef`, which caused the planner's `quoteIdentifier` path to produce `"vector(1536)"`. The fix separates concerns: `nativeType` holds only the base type name, `typeParams` carries parameters, and a new adapter-level expansion function reassembles them into SQL.

3. **Support `@relation(map: ...)` for FK constraint naming.** The interpreter's relation attribute parser is extended to accept the `map` argument, parse it as a quoted string, and flow it through the `foreignKey()` builder. The planner already uses `foreignKey.name` when present.

4. **Add framework metadata emission to the PSL provider.** The interpreter produces contract IR without `extensionPacks`/`capabilities` (it has no PSL surface for these). The provider merges them from explicit options (`extensionPacks`, `capabilitySources`), deep-merging and sorting keys for deterministic output.

5. **Switch the demo to PSL-first.** The demo config switches from `typescriptContract(contract, ...)` to `prismaContract('./prisma/schema.prisma', ...)`, passing pgvector pack metadata and adapter capabilities as sources. The similarity-search query simplifies because the type system now correctly exposes `cosineDistance` on vector columns.

## Behavior changes & evidence

- **PSL-emitted contracts include extension pack metadata and capabilities**: Before → the PSL provider emitted `extensionPacks: {}` and `capabilities: {}`. After → these are populated from explicit sources (pack exports, adapter descriptors) and deep-merged deterministically.
  - **Why**: Runtime features (pgvector cosine queries, capability-gated operations) require these fields to be populated. Without them, the contract was structurally valid but functionally incomplete.
  - **Implementation**:
    - [packages/2-sql/2-authoring/contract-psl/src/provider.ts (L46–L61)](packages/2-sql/2-authoring/contract-psl/src/provider.ts:46-61) — `mergeCapabilitiesFromSources`
    - [packages/2-sql/2-authoring/contract-psl/src/provider.ts (L139–L151)](packages/2-sql/2-authoring/contract-psl/src/provider.ts:139-151) — merge and emit
  - **Tests**:
    - [packages/2-sql/2-authoring/contract-psl/test/provider.test.ts (L288–L310)](packages/2-sql/2-authoring/contract-psl/test/provider.test.ts:288-310) — asserts extensionPacks and merged capabilities

- **pgvector `vector(N)` renders valid DDL**: Before → `nativeType: 'vector(1536)'` + `typeRef` caused `"vector(1536)"` (quoted identifier) in DDL. After → `nativeType: 'vector'` + `typeParams: { length: 1536 }` expands to `vector(1536)` (unquoted, valid SQL).
  - **Why**: Postgres does not treat `"vector(1536)"` as the `vector` extension type with a dimension parameter; it treats it as a type name containing parentheses, which doesn't exist.
  - **Implementation**:
    - [packages/3-extensions/pgvector/src/exports/column-types.ts (L41–L44)](packages/3-extensions/pgvector/src/exports/column-types.ts:41-44) — `vector()` factory
    - [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L559–L562)](packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:559-562) — interpreter field resolution
    - [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L1180–L1183)](packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:1180-1183) — named type descriptor
    - [packages/3-targets/6-adapters/postgres/src/core/parameterized-types.ts (L87–L98)](packages/3-targets/6-adapters/postgres/src/core/parameterized-types.ts:87-98) — expansion
  - **Tests**:
    - [packages/3-targets/3-targets/postgres/test/migrations/planner.case1.test.ts (L293–L352)](packages/3-targets/3-targets/postgres/test/migrations/planner.case1.test.ts:293-352) — DDL contains `vector(1536)` unquoted
    - [packages/3-targets/6-adapters/postgres/test/parameterized-types.test.ts (L118–L128)](packages/3-targets/6-adapters/postgres/test/parameterized-types.test.ts:118-128) — expansion unit test
    - [packages/3-extensions/pgvector/test/column-types.test.ts](packages/3-extensions/pgvector/test/column-types.test.ts) — factory produces correct shape

- **`@relation(map: "...")` accepted and FK constraint name propagated**: Before → `map` argument on `@relation` produced `PSL_INVALID_RELATION_ATTRIBUTE`. After → accepted, parsed as string, recorded in contract storage as `foreignKeys[].name`.
  - **Why**: Prisma schemas commonly use `map` to name FK constraints. Without support, valid schemas failed interpretation, and orphaned backrelation diagnostics compounded the confusion.
  - **Implementation**:
    - [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L985)](packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:985) — `map` added to allowed arguments
    - [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L1025–L1038)](packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:1025-1038) — parse `map` value
    - [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L1503)](packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:1503) — pass to FK builder
  - **Tests**:
    - [packages/2-sql/2-authoring/contract-psl/test/interpreter.relations.test.ts (L216–L249)](packages/2-sql/2-authoring/contract-psl/test/interpreter.relations.test.ts:216-249)
    - [test/integration/test/authoring/parity/map-attributes/](test/integration/test/authoring/parity/map-attributes/) — parity fixture

- **Demo switched from TS to PSL contract source** (no behavior change to end users): The demo config now uses `prismaContract('./prisma/schema.prisma', ...)`. The similarity-search query no longer needs runtime type guards because the contract types are fully resolved.
  - **Implementation**:
    - [examples/prisma-next-demo/prisma-next.config.ts](examples/prisma-next-demo/prisma-next.config.ts)
    - [examples/prisma-next-demo/prisma/schema.prisma](examples/prisma-next-demo/prisma/schema.prisma)
    - [examples/prisma-next-demo/src/queries/similarity-search.ts](examples/prisma-next-demo/src/queries/similarity-search.ts)
  - **Tests**:
    - Demo's existing type tests updated to match new contract shape

## Compatibility / migration / risk

- **Breaking contract shape**: The `nativeType` change from `'vector(1536)'` to `'vector'` is a breaking change for existing pgvector contracts. Storage hashes change. Users must re-emit contracts via `prisma-next contract emit`.
- **New fields in contract JSON**: `extensionPacks` and `capabilities` are now populated where they were previously `{}`. This changes `profileHash`. No existing contract validation will reject the new fields (they are additive).
- **`typeRef` removed from pgvector columns**: Columns referencing pgvector named types no longer include `typeRef` in the contract. Downstream tooling that relied on `typeRef` for pgvector columns will need adjustment (if any exists).
- **Demo config change**: The demo's default config now requires `@prisma-next/sql-contract-psl` as a dependency (added to `package.json`). The TS contract (`prisma/contract.ts`) remains for the no-emit workflow but is no longer the default.

## Follow-ups / open questions

- **Missing E2E dbInit test**: Spec requires a test running PSL → emit → dbInit on a pgvector schema against a real database. Only unit/integration tests exist for the planner DDL rendering.
- **Missing demo dual-mode test**: Spec requires proving the demo passes in both TS and PSL modes. The demo currently runs PSL-only.
- **ADR for parameterized type convention**: The decision to separate `nativeType` (base type) from `typeParams` (parameters) is a convention that future extension types should follow but is not yet documented in an ADR.
- **`typeRef` path in planner**: The `if (column.typeRef) return quoteIdentifier(column.nativeType)` path in the planner remains. Any future parameterized extension type that uses `typeRef` would hit the same quoting issue. A systemic fix (teaching the planner about parameterized type refs) is deferred.
- **Provider type safety**: The `as unknown as` / `as never` casts in the provider should be replaced with proper typing once the contract IR type includes `capabilities` and `extensionPacks` fields.

## Non-goals / intentionally out of scope

- Full Prisma ORM PSL surface area parity (e.g., implicit many-to-many).
- New extension packs or SQL operations beyond pgvector.
- Automatic capability derivation from target/extension packs (requires a discovery mechanism; spec Open Question 1).
