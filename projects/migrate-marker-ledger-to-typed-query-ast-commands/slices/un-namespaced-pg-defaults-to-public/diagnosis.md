# Diagnosis: un-namespaced PG models default to `__unbound__` in storage

## Bug

An un-namespaced Postgres model (e.g. `model user { id String @id }`) correctly lands in `domain.namespaces['public']` but always produces an extra empty `storage.namespaces['__unbound__']` slot, even though no model uses the unbound namespace.

## D1 / D2 amendment 2026-06-16

D1 identified `build-contract.ts:748` as the locus and that fix is correct, but D2 found a **second, downstream injection site**: `packages/2-sql/9-family/src/core/ir/sql-contract-serializer-base.ts:hydrateSqlStorage` unconditionally re-injects `__unbound__` on every contract deserialize round-trip. The CLI emit pipeline calls `familyInstance.deserializeContract(enrichedIR)` between authoring and serializing, so the build-time fix alone doesn't reach the emitted artifact. Both sites need the same descriptor-driven gate (`defaultNamespaceId === UNBOUND_NAMESPACE_ID`). D2 added an `abstract get defaultNamespaceId(): string` to `SqlContractSerializerBase` and implemented it in the PG, SQLite, and Mongo serializers (plus the family-level fallback in `SqlContractSerializer`, which keeps the legacy unbound-injection behaviour to preserve the compatibility-shim semantics for callers that don't supply a target descriptor).

## Locus

**Two call sites:**

1. `packages/2-sql/2-authoring/contract-ts/src/build-contract.ts:748` (authoring time)
2. `packages/2-sql/9-family/src/core/ir/sql-contract-serializer-base.ts:hydrateSqlStorage` (deserialize round-trip)

### Locus 1 — `packages/2-sql/2-authoring/contract-ts/src/build-contract.ts:748`

```ts
namespaces: ensureUnboundNamespaceSlot(namespaces, createNamespace),
```

`ensureUnboundNamespaceSlot` (lines 299–318) unconditionally adds an empty `__unbound__` slot to storage when it isn't already present. For Postgres contracts where `defaultNamespaceId = 'public'` and no models use `UNBOUND_NAMESPACE_ID`, this injects an empty `SqlUnboundNamespace` (or `PostgresUnboundSchema` when `createNamespace` is provided) into every emitted contract.

## Both authoring paths affected

Both paths call `buildSqlContractFromDefinition`, so both carry the bug:

- **PSL interpreter**: `interpretPslDocumentToSqlContract` → `buildSqlContractFromDefinition`
- **TS builder**: `defineContract` → `buildContractDefinition` → `buildSqlContractFromDefinition`

The fix at line 748 covers both.

## What is correct vs. what is wrong

| | Expected | Actual |
|---|---|---|
| `domain.namespaces['public']` | defined, contains `user` model | correct |
| `domain.namespaces['__unbound__']` | undefined | correct |
| `storage.namespaces['public']` | defined, contains `user` table | correct |
| `storage.namespaces['__unbound__']` | **undefined** | **`SqlUnboundNamespace { entries: { table: {} } }`** |

## ADR-223 grep: residual `targetId === 'postgres'` branches

`packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:286`
`packages/2-sql/2-authoring/contract-ts/src/contract-builder.ts:177`
`packages/2-sql/2-authoring/contract-ts/src/contract-builder.ts:235`

All three are **input validation guards** that reject reserved namespace names (e.g. `"unbound"` is reserved on PG for the late-binding opt-in). None of them branch on target to route behavior. They are legitimate uses, not ADR-223 violations.

## Downstream consumers

`collectStorageNamespaceCoordinateIds` (build-contract.ts:283–297) correctly seeds storage namespace ids from `defaultNamespaceId` plus per-model coordinates. It never adds `UNBOUND_NAMESPACE_ID` — the problem is purely the unconditional call that follows.

The Postgres contract serializer (`postgres-contract-serializer.ts:104–121`) iterates all storage namespaces, so the empty `__unbound__` slot propagates into every emitted `contract.json` as a `kind: 'postgres-unbound-schema'` block. This is how the stale fixture at `examples/prisma-next-demo/fixtures/diamond/migrations/app/.../end-contract.json` acquired its spurious `__unbound__` in storage.

## Extension pack impact

The same bug manifests in baked extension pack contracts:

- `packages/3-extensions/pgvector/src/contract.json:16–21` — empty `__unbound__` in storage despite `domain.namespaces` containing only `public`
- `packages/3-extensions/paradedb/src/contract.json:16–21` — same

These contracts have no models at all. `public` is present (as the default namespace), `__unbound__` should be absent. D2 must regenerate these files.

SQLite and Mongo extension packs (e.g. `packages/3-extensions/sqlite/`) intentionally use `__unbound__` — that is their default namespace and the slot is correct.

The `supabase` extension test (`supabase-runtime.test.ts:37`) constructs `SqlUnboundNamespace.instance` directly to build a minimal storage fixture; that test is not emitting from a contract and is unaffected by this bug.

## Existing tests that codify the wrong behavior

`packages/2-sql/2-authoring/contract-ts/test/contract-builder.namespaces.test.ts` has six tests that all assert `'__unbound__'` is in `Object.keys(contract.storage.namespaces)` for PG contracts. These tests will need updating as part of D2. They currently pass, encoding the bug as expected behavior.

## Failing test (D1 deliverable)

`packages/2-sql/2-authoring/contract-psl/test/interpreter.namespaces.test.ts`

The test block at the top of that file (`un-namespaced PG model defaults to public namespace (TML-2916)`) runs RED on current main:

```
FAIL  test/interpreter.namespaces.test.ts > un-namespaced PG model defaults to public namespace (TML-2916) > places a bare model ...
AssertionError: expected SqlUnboundNamespace{ …(3) } to be undefined
 ❯ test/interpreter.namespaces.test.ts:39:47
```

Lines 36–38 pass (domain.public defined, storage.public defined, domain.__unbound__ undefined). Only line 39 (`storage.namespaces['__unbound__']` undefined) fails, pinpointing the bug.

## D2 fix sketch

1. Guard `ensureUnboundNamespaceSlot` so it only adds the slot when `defaultNamespaceId === UNBOUND_NAMESPACE_ID`. The new guard lives at the call site (line 748) or as a predicate argument:

   ```ts
   namespaces: definition.target.defaultNamespaceId === UNBOUND_NAMESPACE_ID
     ? ensureUnboundNamespaceSlot(namespaces, createNamespace)
     : namespaces,
   ```

   This keeps the slot for SQLite and Mongo (their `defaultNamespaceId` is `'__unbound__'`), and drops it for Postgres.

2. Update the six tests in `contract-builder.namespaces.test.ts` to no longer expect `'__unbound__'` in storage for PG contracts.

3. Regenerate baked extension pack contracts: `pgvector/src/contract.json`, `paradedb/src/contract.json`, and their `.d.ts` counterparts.

4. Regenerate the diamond fixture at `examples/prisma-next-demo/fixtures/diamond/migrations/app/` — that fixture was last generated at TML-2807 and now carries a stale `storage.__unbound__`. The `regen-example-migrations.mjs` CHAINS array does not include this path; D2 must invoke regen manually for that fixture chain or add it to CHAINS.

## D2 outcome on the diamond fixture chain

The diamond (and 6 sibling) fixtures under `examples/prisma-next-demo/fixtures/*/migrations/app/` cannot be regenerated by `regen-example-migrations.mjs` — the script requires a `contract.prisma` in each migration step (to recompute the end-state contract from PSL source), but these fixture chains store only `migration.ts` files per step plus a single root `contract.prisma` for the FINAL state. They were authored by hand at TML-2807's `f7f1ab97d refactor(demo): consolidate migration fixtures under fixtures/` and have no per-step contract source.

A `grep -rln "fixtures/diamond"` across `packages`, `apps`, `test`, and `examples` (excluding `.json`/`.d.ts`/`node_modules`/`dist`) returns zero hits — no code, test, or script reads these fixtures. They are stale documentation-only artifacts.

**D2 decision: leave these fixtures stale on this branch.** Adding a regen mechanism (apply migration.ts ops in sequence, capture end state) is out of scope for the TML-2916 bug-fix slice. The fixtures retain their main-state `__unbound__` shape until a follow-up slice adds a regen mechanism or rewrites them. No CI signal exercises them, so the staleness is invisible to checks.
