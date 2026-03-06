# Walkthrough — PSL Contract Parity Missing Behaviors

Tracking: [TML-2039](https://linear.app/prisma-company/issue/TML-2039/m9-psl-contracts-lack-capabilities)

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
const extensionPacks = options?.extensionPacks
  ? mergePlainObjects(interpreted.value.extensionPacks, options.extensionPacks)
  : interpreted.value.extensionPacks;

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

## Intent

Bring PSL contract authoring to parity with TypeScript contract authoring for the behaviors exercised by the demo app: framework metadata (extension packs, capabilities), parameterized vector DDL, and FK constraint naming. The end goal is that `examples/prisma-next-demo` can switch between TS and PSL as its contract source with no behavioral difference — proven by a dual-mode emit test.

## Change map

- **Implementation**:
  - [packages/2-sql/2-authoring/contract-psl/src/provider.ts](packages/2-sql/2-authoring/contract-psl/src/provider.ts) — framework metadata merging with typed `CapabilitySource`
  - [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts](packages/2-sql/2-authoring/contract-psl/src/interpreter.ts) — vector type representation fix + `@relation(map: ...)` parsing
  - [packages/3-extensions/pgvector/src/exports/column-types.ts](packages/3-extensions/pgvector/src/exports/column-types.ts) — `vector()` factory nativeType fix
  - [packages/3-extensions/pgvector/src/exports/control.ts](packages/3-extensions/pgvector/src/exports/control.ts) — `expandNativeType` control-plane hook for vector(N)
  - [packages/3-targets/6-adapters/postgres/src/core/parameterized-types.ts](packages/3-targets/6-adapters/postgres/src/core/parameterized-types.ts) — vector(N) expansion
  - [examples/prisma-next-demo/prisma-next.config.ts](examples/prisma-next-demo/prisma-next.config.ts) — demo switched to PSL-first
  - [docs/architecture docs/adrs/ADR 170 - Parameterized native types in contracts.md](docs/architecture%20docs/adrs/ADR%20170%20-%20Parameterized%20native%20types%20in%20contracts.md) — convention for parameterized types
- **Tests (evidence)**:
  - [packages/2-sql/2-authoring/contract-psl/test/provider.test.ts](packages/2-sql/2-authoring/contract-psl/test/provider.test.ts) — vector shape + metadata emission (no type casts)
  - [packages/2-sql/2-authoring/contract-psl/test/interpreter.relations.test.ts](packages/2-sql/2-authoring/contract-psl/test/interpreter.relations.test.ts) — FK naming via `map`
  - [packages/3-targets/3-targets/postgres/test/migrations/planner.case1.test.ts](packages/3-targets/3-targets/postgres/test/migrations/planner.case1.test.ts) — DDL rendering (`vector(1536)` unquoted)
  - [packages/3-targets/6-adapters/postgres/test/parameterized-types.test.ts](packages/3-targets/6-adapters/postgres/test/parameterized-types.test.ts) — type expansion unit test
  - [test/integration/test/authoring/psl.pgvector-dbinit.test.ts](test/integration/test/authoring/psl.pgvector-dbinit.test.ts) — E2E: PSL → emit → dbInit against real database
  - [test/integration/test/authoring/cli.emit-parity-fixtures.test.ts](test/integration/test/authoring/cli.emit-parity-fixtures.test.ts) — TS/PSL parity enforcement

## The story

1. **Lock in regressions with tests first.** Before making fixes, new test cases and updated fixtures capture the precise failure modes (empty `extensionPacks`/`capabilities`, parameterized `nativeType` shape, unsupported `@relation(map: ...)`).

2. **Fix the vector type representation across the stack.** The root cause of the `"vector(1536)"` DDL bug was a conflation of two concerns: the PSL interpreter embedded the dimension in `nativeType` (`'vector(1536)'`) and set `typeRef`, which caused the planner's `quoteIdentifier` path to produce `"vector(1536)"`. The fix separates concerns: `nativeType` holds only the base type name, `typeParams` carries parameters, and target adapter expansion reassembles them into SQL. This convention is recorded in ADR 170.

3. **Provide a control-plane `expandNativeType` hook for pgvector.** The pgvector control descriptor now exposes an `expandNativeType` codec hook, ensuring schema verification also expands `vector` + `length` → `vector(1536)` consistently with the planner.

4. **Support `@relation(map: ...)` for FK constraint naming.** The interpreter's relation attribute parser is extended to accept the `map` argument, parse it as a quoted string, and flow it through the `foreignKey()` builder. The planner already uses `foreignKey.name` when present.

5. **Add framework metadata emission to the PSL provider.** The interpreter produces contract IR without `extensionPacks`/`capabilities` (it has no PSL surface for these). The provider merges them from explicit options (`extensionPacks`, `capabilitySources`), deep-merging and sorting keys for deterministic output. `capabilitySources` is typed as `readonly CapabilitySource[]` with an exported interface.

6. **Switch the demo to PSL-first and prove dual-mode equivalence.** The demo config switches from `typescriptContract(...)` to `prismaContract('./prisma/schema.prisma', ...)`. A second config (`prisma-next.config.ts-contract.ts`) preserves the TS path. The `test:dual-mode` script emits from each source in turn and runs the demo test suite against each, proving behavioral equivalence.

## Behavior changes & evidence

- **PSL-emitted contracts include extension pack metadata and capabilities**: Before → the PSL provider emitted `extensionPacks: {}` and `capabilities: {}`. After → these are populated from explicit sources (pack exports, adapter descriptors) and deep-merged deterministically.
  - **Why**: Runtime features (pgvector cosine queries, capability-gated operations) require these fields. Without them, the contract was structurally valid but functionally incomplete.
  - **Implementation**:
    - [packages/2-sql/2-authoring/contract-psl/src/provider.ts (L55–L70)](packages/2-sql/2-authoring/contract-psl/src/provider.ts) — `mergeCapabilitiesFromSources` with typed `CapabilitySource`
    - [packages/2-sql/2-authoring/contract-psl/src/provider.ts (L141–L165)](packages/2-sql/2-authoring/contract-psl/src/provider.ts) — merge and emit
  - **Tests**:
    - [packages/2-sql/2-authoring/contract-psl/test/provider.test.ts](packages/2-sql/2-authoring/contract-psl/test/provider.test.ts) — asserts extensionPacks and merged capabilities

- **pgvector `vector(N)` renders valid DDL**: Before → `nativeType: 'vector(1536)'` + `typeRef` caused `"vector(1536)"` (quoted identifier) in DDL. After → `nativeType: 'vector'` + `typeParams: { length: 1536 }` expands to `vector(1536)` (unquoted, valid SQL).
  - **Why**: Postgres does not treat `"vector(1536)"` as the `vector` extension type with a dimension parameter; it treats it as a type name containing parentheses, which doesn't exist.
  - **Implementation**:
    - [packages/3-extensions/pgvector/src/exports/column-types.ts](packages/3-extensions/pgvector/src/exports/column-types.ts) — `vector()` factory
    - [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts](packages/2-sql/2-authoring/contract-psl/src/interpreter.ts) — interpreter field resolution + named type descriptor
    - [packages/3-targets/6-adapters/postgres/src/core/parameterized-types.ts](packages/3-targets/6-adapters/postgres/src/core/parameterized-types.ts) — expansion
    - [packages/3-extensions/pgvector/src/exports/control.ts](packages/3-extensions/pgvector/src/exports/control.ts) — `expandNativeType` hook for schema verification
  - **Tests**:
    - [packages/3-targets/3-targets/postgres/test/migrations/planner.case1.test.ts](packages/3-targets/3-targets/postgres/test/migrations/planner.case1.test.ts) — DDL contains `vector(1536)` unquoted
    - [test/integration/test/authoring/psl.pgvector-dbinit.test.ts](test/integration/test/authoring/psl.pgvector-dbinit.test.ts) — E2E: PSL → emit → dbInit succeeds

- **`@relation(map: "...")` accepted and FK constraint name propagated**: Before → `map` argument on `@relation` produced `PSL_INVALID_RELATION_ATTRIBUTE`. After → accepted, parsed as string, recorded in contract storage as `foreignKeys[].name`.
  - **Why**: Prisma schemas commonly use `map` to name FK constraints. Without support, valid schemas failed interpretation.
  - **Implementation**:
    - [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts](packages/2-sql/2-authoring/contract-psl/src/interpreter.ts) — `map` argument parsing + FK builder wiring
  - **Tests**:
    - [packages/2-sql/2-authoring/contract-psl/test/interpreter.relations.test.ts](packages/2-sql/2-authoring/contract-psl/test/interpreter.relations.test.ts)
    - [test/integration/test/authoring/parity/map-attributes/](test/integration/test/authoring/parity/map-attributes/) — parity fixture

- **Demo switched from TS to PSL contract source** (no behavior change to end users): The demo config now uses `prismaContract('./prisma/schema.prisma', ...)`. The similarity-search query no longer needs runtime type guards because the contract types are fully resolved.
  - **Implementation**:
    - [examples/prisma-next-demo/prisma-next.config.ts](examples/prisma-next-demo/prisma-next.config.ts) — PSL config (default)
    - [examples/prisma-next-demo/prisma-next.config.ts-contract.ts](examples/prisma-next-demo/prisma-next.config.ts-contract.ts) — TS config (dual-mode)
    - [examples/prisma-next-demo/src/queries/similarity-search.ts](examples/prisma-next-demo/src/queries/similarity-search.ts) — simplified (no runtime type guards)
  - **Tests**:
    - Demo `test:dual-mode` script proves both modes pass

## Compatibility / migration / risk

- **Breaking contract shape**: The `nativeType` change from `'vector(1536)'` to `'vector'` changes storage hashes. Users must re-emit contracts via `prisma-next contract emit`.
- **New fields in contract JSON**: `extensionPacks` and `capabilities` are now populated where they were previously `{}`. Hash changes expected.
- **Demo config change**: The demo requires `@prisma-next/sql-contract-psl` as a new dependency. The TS contract (`prisma/contract.ts`) remains for the no-emit workflow and dual-mode testing.

## Follow-ups / open questions

- The `typeRef → quoteIdentifier(nativeType)` path in the planner remains for non-parameterized named types (e.g., enums). Any future parameterized extension type that uses `typeRef` would hit the same quoting issue — a systemic fix is deferred.
- Automatic capability derivation from target/extension packs (without explicit `capabilitySources`) is deferred (spec Open Question 1).

## Non-goals / intentionally out of scope

- Full Prisma ORM PSL surface area parity (e.g., implicit many-to-many).
- New extension packs or SQL operations beyond pgvector.
- Automatic capability derivation from composed packs (requires a discovery mechanism).
