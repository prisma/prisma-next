# Slice 1.5 — Round 4: table-node ontology + total-descent differ

Prescriptive spec. The implementer makes exactly these changes. No freedoms.

This round addresses review comments on PR #868: the differ keys nodes by a
single sibling-unique id (not a parent-folded key), policies nest under a table
node, the differ stays a pure total diff, and ownership/whitelisting live in the
caller, not the differ.

## Scope

In:
- Node id is renamed `localKey()` → `id()` (done separately, in flight — assume `id()` below).
- A **table node** sits between the database root and policies. The policy's `id()` simplifies to its wire name.
- The framework differ becomes **total**: an unmatched node emits its own issue **and** descends, emitting an issue for every node in the missing/extra subtree.
- The Postgres RLS diff **whitelists** policy-subject issues in the caller; `diffPostgresSchema` is slimmed to diff + whitelist + ownership-from-expected. No contract→IR derivation inside it.
- `resolveNamespaceId` (the degraded duplicate) is deleted; namespace normalization happens **once, at derivation**, using the existing `resolveDdlSchemaForNamespaceStorage`.

Deferred (NOT this round):
- Renaming `PostgresSchemaIR` off "IR" (review comment #4). It stays the root node. Reason: the class is ambiguous about its level and has wide reach; that rename is its own change.
- Porting relational node types (tables/columns) onto the differ. The table node here groups policies only.

## The node ontology

The diff tree is three levels. Every node implements `DiffableNode` (`id()`, `isEqualTo()`, `children()`).

```
PostgresSchemaIR        (database root)  id() = pgSchemaName,         isEqualTo => true, children() = table nodes
  └─ PostgresTableNode  (table)          id() = "<schema>/<table>",   isEqualTo => true, children() = its policies
       └─ PostgresRlsPolicy (policy)     id() = name (wire name),     isEqualTo = body-by-wire-name, children() = []
```

The table and root nodes have `isEqualTo => true` because there are no
table-level or database-level attributes the RLS strategy diffs. Their
missing/extra issues are dropped by the caller's whitelist (below); nothing
special-cases them in the differ.

### New class: `PostgresTableNode`

New file `packages/3-targets/3-targets/postgres/src/core/postgres-table-node.ts`.

- Fields: `schemaName: string` (the **resolved** DDL schema name), `tableName: string`, `policies: readonly PostgresRlsPolicy[]`.
- `id(): string` → `` `${this.schemaName}/${this.tableName}` ``.
- `isEqualTo(_other: DiffableNode): boolean` → `true`.
- `children(): readonly DiffableNode[]` → `this.policies`.
- Follow the existing frozen-node pattern used by `PostgresRlsPolicy` (constructor input interface, `freezeNode(this)` if the sibling nodes do it). Match the conventions in `postgres-rls-policy.ts` exactly.
- Export a guard `isPostgresTableNode(node): node is PostgresTableNode` (discriminate on an enumerable `kind = 'table-node'` field, mirroring how `isPostgresRlsPolicy` uses `kind === 'policy'`). Export both from `src/exports/types.ts` alongside `isPostgresRlsPolicy`.

### `PostgresRlsPolicy` change

- `id()` becomes `` return this.name; `` (the wire name — now unique among its siblings, which are only the policies of one table). Delete the `${namespaceId}/${tableName}/` prefix and its explaining comment.
- Keep all fields (`namespaceId`, `tableName` stay — the planner and grouping read them).

### `PostgresSchemaIR.children()` change

Replace `return this.rlsPolicies;` with: group `this.rlsPolicies` by `(resolved schemaName, tableName)` and return one `PostgresTableNode` per group, each holding that group's policies.

- The grouping key uses the policy's **already-resolved** `namespaceId` (see "Normalization" — derivations must resolve it before constructing the policy, so grouping here is a plain string group; do **not** call a resolver inside `children()`).
- Order: group in first-seen policy order; within a group, preserve policy order. (Deterministic output for tests.)
- A table with zero policies yields no table node. That is correct — nothing to diff.

## Normalization (the landmine — read carefully)

Expected (contract-derived) and actual (introspected) table nodes must pair by
`id()`. `id()` embeds the schema name. Introspection already carries real schema
names (`row.schemaname`, e.g. `public`). The contract side may carry the unbound
sentinel. **If the two disagree, every table node falsely reports missing+extra.**

Requirement: **resolve the policy's `namespaceId` to its DDL schema name at
derivation time**, on the contract side, using the existing
`resolveDdlSchemaForNamespaceStorage(storage, namespaceId, schemaIr?)`
(`postgres-schema-ir-annotations.ts`). After this, every `PostgresRlsPolicy` —
from either derivation — carries a resolved schema name in `namespaceId`, so
`PostgresTableNode.id()` is a plain concat and the differ never needs a resolver.

- Do this in `collectContractRlsPolicies` / `contractToPostgresSchemaIR` (`collect-contract-postgres-nodes.ts` / `contract-to-postgres-schema-ir.ts`): when building each contract-side policy, set `namespaceId` to the resolved schema name.
- Confirm the planner still resolves DDL schema correctly afterward. `planPostgresSchemaDiff` calls `resolveDdlSchemaForNamespaceStorage(storage, issue.expected.namespaceId, …)`. If `namespaceId` is now already a resolved schema name (e.g. `public`), that call must still return the right schema. Verify against `resolveDdlSchemaForNamespaceStorage`'s logic; if a resolved name breaks the `storage.namespaces[namespaceId]` lookup, adjust the planner to handle an already-resolved name. **Add a multi-schema test (below) that would catch a regression here.**

Delete `resolveNamespaceId` from `postgres-schema.ts` (the degraded duplicate). Replace its two uses in `diff-postgres-schema.ts` per the slimming below.

### Known limitation: unbound namespace under a non-default `search_path`

The contract's **unbound** namespace resolves to `'public'` unconditionally at
derivation (`collectContractRlsPolicies` passes no `schemaIr`, so
`resolveDdlSchemaForNamespaceStorage` falls back to `'public'`). The introspected
side carries the live `current_schema()`. When the database's `search_path` does
**not** put `public` first, those disagree: expected `public/<table>` and actual
`<other>/<table>` fail to pair, producing a spurious `missing` (the policy is
re-`CREATE`d on every run) and an `extra` that ownership then drops. This is
**pre-existing** — the prior flat-key code had the same mismatch (and was worse:
it also emitted a spurious `DROP`). This change narrows it; it does not fix it.
A real fix threads the introspected `pgSchemaName` into derivation, which the
current call shape does not allow — out of scope here. A contract that declares
the namespace explicitly (a **bound** namespace) is unaffected, since its
`namespaceId` is the real schema name on both sides. Test 6 covers the
`public` case only.

## The differ becomes total (framework)

`packages/1-framework/1-core/framework-components/src/control/schema-diff.ts`.

Today `diffChildren` emits one missing/extra issue for an unmatched node and
stops. Change it so an unmatched node emits its own issue **and** recurses,
emitting an issue for every descendant of the missing/extra subtree.

Add two helpers:

```ts
function emitMissingSubtree(node: DiffableNode, parentPath: readonly string[]): SchemaDiffIssue[] {
  const path = [...parentPath, node.id()];
  const issues: SchemaDiffIssue[] = [
    { path, outcome: 'missing', message: outcomeMessage('missing', path), expected: node },
  ];
  for (const child of node.children()) issues.push(...emitMissingSubtree(child, path));
  return issues;
}
// symmetric emitExtraSubtree: outcome 'extra', field `actual: node`, recurse over node.children()
```

In `diffChildren`:
- expected node with no actual match → `issues.push(...emitMissingSubtree(expectedNode, parentPath))` (replaces the single missing push).
- actual node with no expected match → `issues.push(...emitExtraSubtree(actualNode, parentPath))`.
- matched pair → unchanged (`diffPair`, which mismatch-checks then recurses).

This is behavior-preserving for the current tests: leaves have no children, so a
missing/extra leaf still emits exactly one issue. Only unmatched non-leaf nodes
change — which only happens once table nodes exist.

Update the `diffSchemas`/`diffChildren` JSDoc to state the differ is **total**:
it reports every node-level difference; coalescing a parent change over its
children's is the planner's job (per the ADR).

## The caller: whitelist + slimmed `diffPostgresSchema`

`packages/3-targets/3-targets/postgres/src/core/migrations/diff-postgres-schema.ts`.

New signature — **takes two built IRs, no contract**:

```ts
export function diffPostgresSchema(
  expected: PostgresSchemaIR,
  actual: PostgresSchemaIR,
): readonly SchemaDiffIssue[]
```

Body:
1. `const issues = diffSchemas(expected, actual);`
2. **Whitelist** to policy-subject issues: keep only issues whose subject node is a policy — `issues.filter(i => isPostgresRlsPolicy(i.expected ?? i.actual))`. This drops the table-node and root-node missing/extra issues. (Widen this predicate when a future strategy owns another node type.)
3. **Ownership** (drop `extra` policies in namespaces the contract doesn't own): owned namespaces = the union of (a) the resolved schema names present in `expected`'s policies and (b) `expected.existingSchemas` — the resolved DDL schema names of **every** namespace the contract declares (populated by `contractToPostgresSchemaIR`). Including (b) means a declared namespace that happens to have no policies still counts as owned, so an `extra` DB policy there is reconciled (dropped from the DB), not ignored as another space's. Drop an `extra` issue whose policy's `namespaceId` ∉ owned. `missing`/`mismatch` pass through. Derive `owned` from `expected` — do **not** take the contract as a parameter.

Move `filterSchemaIssuesByOwnership` **out** of the framework `schema-diff.ts`
(it is not a diffing concern). Its logic now lives inline in `diffPostgresSchema`
as step 3 (or as a small private helper in that file). `schema-diff.ts` exports
only `DiffableNode`, `SchemaDiffIssue`, `SchemaDiffOutcome`, and `diffSchemas`.
Update `framework-components/src/exports/control.ts` to stop exporting
`filterSchemaIssuesByOwnership`.

Delete the spread-object reconstruction comment's apology, but keep a guard: add
a small `ensurePostgresSchemaIR(schema)` (a named helper in `postgres-schema-ir.ts`)
that returns the instance as-is or reconstructs it from a spread object, and have
the **callers** use it. Document it one line: works around `projectSchemaToSpace`
spreading the class.

### Callers build both sides

- `planner.ts` `planPostgresSchemaDiff`: build `const expected = contractToPostgresSchemaIR(<postgres contract>, { annotationNamespace: 'pg' });` and `const actual = ensurePostgresSchemaIR(options.schema);`, then `diffPostgresSchema(expected, actual)`. Keep reading `issue.expected`/`issue.actual` as `PostgresRlsPolicy` (they still are — whitelist guarantees it). The `blindCast` to `PostgresContract` moves here (or wherever the contract is narrowed); keep it minimal.
- `control-adapter.ts` `collectSchemaDiffIssues(contract, schema)`: same two-step build, then `diffPostgresSchema(expected, actual)`.

## Tests (write first, then implement)

All required. Names omit "should" (repo rule).

Framework differ (`framework-components/test/schema-diff.test.ts`):
1. **Total descent — missing subtree.** A root whose child node (with its own grandchild leaves) is absent on the actual side emits a missing issue for the child **and** for each grandchild, with correct paths. (Use generic stub nodes, not Postgres.)
2. **Total descent — extra subtree.** Symmetric.
3. **Leaves unchanged.** A missing/extra leaf still emits exactly one issue (guards the behavior-preserving claim).

Postgres (`target-postgres/test/migrations/diff-postgres-schema.test.ts`):
4. **Policies nest under table nodes.** Initial migration (empty actual): a contract with two tables each with a policy yields, after whitelist, exactly the two policy `missing` issues with paths `[schema, schema/table, name]`. No table-subject issue survives the whitelist.
5. **Same wire name on two tables — no collision** (port the existing regression; the policy `id()` is now just the wire name, table-node nesting keeps them distinct). Must not throw; both present → zero issues.
6. **Multi-schema normalization.** A contract with a policy in the **unbound** namespace and an introspected actual carrying schema `public` for the same policy: expected and actual table nodes pair (zero issues when equal). This is the landmine guard — it must fail if normalization is dropped.
7. **Ownership.** An `extra` policy in a namespace not present in `expected` is dropped; a `missing` policy in an owned namespace is kept.

`rls-diffable-nodes.test.ts`: add `PostgresTableNode.id()`/`isEqualTo()`/`children()` coverage; update `PostgresRlsPolicy.id()` to assert it returns the bare wire name.

Planner (`rls-planner.test.ts` / `rls-migration-plan.integration.test.ts`): the existing `CREATE POLICY` + `ENABLE RLS` assertions must still pass — they exercise the missing-table descent path end to end. Do not weaken them.

## ADR update

`projects/postgres-rls/specs/adr-schema-diff-over-structured-ir.md`:
- Replace `localKey()` with `id()` throughout; delete the stale duplicate paragraph (the one re-asserting "globally unique / now enforced by a throw").
- State the differ is **total** (reports every node difference; planner coalesces) and that ownership/whitelisting are caller-side post-diff filters, not differ concerns.
- Update "The table as a path segment vs. a diffed node": the table is now a diffed node; the policy `id()` is the wire name. Keep the note that relational table attributes are not yet diffed (table nodes are `isEqualTo => true` groupers for now).

## Acceptance criteria

- AC-1 `id()` everywhere; no `localKey`. (Separate dispatch.)
- AC-2 `PostgresTableNode` exists; root `children()` returns table nodes grouping policies; policy `id()` is the bare wire name.
- AC-3 The differ is total: unmatched non-leaf nodes descend (tests 1–3).
- AC-4 `diffPostgresSchema(expected, actual)` takes two IRs; whitelists policy issues; ownership derived from `expected`. `filterSchemaIssuesByOwnership` no longer in `schema-diff.ts`.
- AC-5 Namespace normalization at derivation; `resolveNamespaceId` deleted; `resolveDdlSchemaForNamespaceStorage` reused. Multi-schema test (test 6) passes.
- AC-6 `migration plan` still emits `CREATE POLICY` + `ENABLE RLS` (existing integration test green).
- Gates: build, typecheck (framework-components, target-postgres, adapter-postgres, cli), the four package test suites, `lint:deps`, `fixtures:check` — all green.
