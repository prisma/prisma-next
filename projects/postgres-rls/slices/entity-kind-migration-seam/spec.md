# Slice: entity-kind-migration-seam

Parent project: `projects/postgres-rls/` ([spec](../../spec.md) · [plan](../../plan.md)). Design: [`adr-schema-diff-over-structured-ir.md`](../../specs/adr-schema-diff-over-structured-ir.md) (accepted) · seed [`extension-migration-participation.md`](../../specs/extension-migration-participation.md). Linear: [TML-2931](https://linear.app/prisma-company/issue/TML-2931).

## At a glance

Make both sides of the RLS schema diff homogeneous, derived schema IRs, and have the differ walk them. Today the expected side is read straight off the contract object inside `diffPostgresRlsPolicies`, the contract→schema derivation (`contractToSchema`) drops policies, and the planner branches on `isPostgresSchemaIR` to fail-loud on `migration plan`. After this slice: a Postgres contract projects to a populated `PostgresSchemaIR`; the differ walks two roots; the planner no longer branches on the command. Net observable change: `migration plan` emits `CREATE POLICY`; `db init` / `db update` / `db verify` are byte-for-byte unchanged.

This spec is prescriptive. Signatures, the walk algorithm, and the field values are fixed below. The implementer does not choose between alternatives; where a value is "unused on this side," it is still given an explicit value here.

## Design

Five change units, A–E. Each is independently committable and is the dispatch boundary. Anchors are `file:line` on this branch.

### Unit A — Framework: the tree-walking differ

File: `packages/1-framework/1-core/framework-components/src/control/schema-diff.ts` (currently the flat `diffNodes`, lines 16–84). Re-export: `packages/1-framework/1-core/framework-components/src/exports/control.ts:105`.

Replace the node interface and the differ. Exact target shapes:

```ts
/** A node the differ can descend into. The root implements only this. */
export interface DiffableRoot {
  children(): readonly DiffableNode[];
}

/** A node the differ also aligns and compares. Implemented by target IR nodes. */
export interface DiffableNode extends DiffableRoot {
  coord(): EntityCoordinate;
  isEqualTo(other: DiffableNode): boolean;
}

export function diffSchema(
  expected: DiffableRoot,
  actual: DiffableRoot,
): readonly SchemaDiffIssue[] {
  return diffChildren(expected.children(), actual.children());
}
```

- **`DiffableNode` keeps its name** — do NOT rename it (a CLI schema-view class already owns `DiffableNode` with ~33 call sites; that class is out of scope). Its method `identity()` is renamed to `coord()`, `children()` is added, and it now extends the new `DiffableRoot`. `SchemaDiffIssue.expected` / `.actual` stay typed `DiffableNode` (no retype). Keep `SchemaDiffOutcome`, `stableKey`, `outcomeMessage` exactly as they are.
- `diffChildren` is the per-level core — the existing `diffNodes` body (lines 38–83) with three changes: it is named `diffChildren`, it calls `node.coord()` instead of `node.identity()`, and after the matched-pair `mismatch` check it appends `diffChildren(e.children(), a.children())` (recursion into the matched pair). `missing` and `extra` emit one issue at the node's coordinate and do **not** recurse (the whole subtree is missing/extra). Emission order is preserved: per level, expected-map iteration order (missing/mismatch, each immediately followed by its matched-pair recursion), then actual-map iteration order (extra).
- For the current node set (all leaves — `children()` returns `[]`), `diffChildren` produces output **identical** to today's `diffNodes`: same issues, same order, same `coordinate`/`outcome`/`message`/`expected`/`actual` fields. This is the behavior-preservation contract.
- `diffNodes` is removed; `diffSchema` and the new `DiffableRoot` are exported from `exports/control.ts` (`DiffableNode` is already exported there).

### Unit B — Postgres leaf nodes: `coord()` + `children()`

Files: `packages/3-targets/3-targets/postgres/src/core/postgres-rls-policy.ts`, `.../postgres-role.ts`. These are the **only** two implementors of the interface (confirmed: `grep DiffableNode` matches only these plus the framework).

- Keep `import type { DiffableNode }` and `implements DiffableNode` (the interface keeps its name).
- Rename `identity()` → `coord()` (body unchanged).
- Add `children(): readonly DiffableNode[] { return []; }` to both (leaves).
- `isEqualTo(other: DiffableNode)` keeps its signature; in the error strings, `other.identity().entityKind` → `other.coord().entityKind`.
- `isPostgresRlsPolicy(node: DiffableNode | undefined)` and `assertPostgresRlsPolicy(...)` keep their param type; bodies unchanged.

### Unit C — `PostgresSchemaIR`: implement `DiffableRoot`

File: `packages/3-targets/3-targets/postgres/src/core/postgres-schema-ir.ts`.

- Implement `DiffableRoot`: `children(): readonly DiffableNode[] { return this.rlsPolicies; }`. **Roles are not yielded in this slice** (see Scope) — `children()` returns policies only.
- No other change. In particular, **do not** make the `annotations` bag injectable or otherwise touch it: nothing reads the contract-derived IR's annotations (the only reader of schema-IR `annotations` is the introspect→PSL path in `sql-schema-ir-to-psl-ast.ts`, which runs on the introspected IR), so project-from-contract lets the constructor build its default (unread) bag. The annotations bag is being retired in favour of typed fields (TML-2936); this slice does not extend it.

### Unit D — project-from-contract

New file: `packages/3-targets/3-targets/postgres/src/core/migrations/project-postgres-schema-from-contract.ts`.

```ts
/** Project a contract's Postgres RLS policy nodes. The contract carries them as PostgresRlsPolicy instances. */
export function collectContractRlsPolicies(
  contract: Contract<SqlStorage> | null,
): readonly PostgresRlsPolicy[] {
  if (contract === null) return [];
  return Object.values(contract.storage.namespaces).flatMap((ns) =>
    isPostgresSchema(ns) ? Object.values(ns.policy) : [],
  );
}

/** Same, for roles. Used only by the full-IR projection in this slice. */
export function collectContractRoles(
  contract: Contract<SqlStorage> | null,
): readonly PostgresRole[] { /* Object.values(ns.role) under isPostgresSchema */ }

/** The project-from-contract derivation: a populated PostgresSchemaIR. */
export function projectPostgresSchemaFromContract(
  contract: Contract<SqlStorage> | null,
  options: ContractToSchemaIROptions,
): PostgresSchemaIR {
  const sqlIr = contractToSchemaIR(contract, options); // tables (its annotations bag is unread — see Unit C)
  return new PostgresSchemaIR({
    tables: sqlIr.tables,
    rlsPolicies: collectContractRlsPolicies(contract),
    roles: collectContractRoles(contract),
    pgSchemaName: 'public',                // unbound→public default; read only by ddl-schema resolution
    pgVersion: '',                         // introspection-only; unused on the contract-derived side
    existingSchemas: [],                   // introspection-only; unused here
    nativeEnumTypeNames: [],               // introspection-only; unused here
  });
}
```

`collectContractRlsPolicies` matches today's expected-side construction in `diffPostgresRlsPolicies` exactly (the same `isPostgresSchema(ns) ? Object.values(ns.policy) : []` flatMap) — so the diff's expected side is unchanged.

Wire the hook: `packages/3-targets/3-targets/postgres/src/exports/control.ts:59` `contractToSchema` returns `projectPostgresSchemaFromContract(contract as …, { annotationNamespace: 'pg', …ifDefined('expandNativeType', expander), renderDefault: postgresRenderDefault })` — the same options object it passes today, now routed through the projection. Keep the existing contract-narrowing blind cast.

### Unit E — diff call sites: project + scope, drop the command branches

File: `packages/3-targets/3-targets/postgres/src/core/migrations/verify-postgres-rls-policies.ts`. Keep the exported name and signature `diffPostgresRlsPolicies({ contract, schema })`; replace the body. The differ walks the **full** actual tree; the owned-namespace decision is applied to the **outcomes**, not the inputs:

```ts
export function diffPostgresRlsPolicies(input: {
  readonly contract: Contract<SqlStorage>;
  readonly schema: PostgresSchemaIR;
}): readonly SchemaDiffIssue[] {
  const { contract, schema } = input;
  const expected: DiffableRoot = { children: () => collectContractRlsPolicies(contract) };
  const actual: DiffableRoot = { children: () => schema.rlsPolicies }; // full tree — no pre-filter
  const issues = diffSchema(expected, actual);

  // Manage / leave-alone (seed doc point 7), applied to outcomes: an `extra`
  // policy in a namespace this contract does not own belongs to another
  // contract space — leave it. This preserves the supabase multi-space
  // behavior without filtering the tree before the differ. Slice 2 folds this
  // into the unified control-policy disposition (`filterSchemaDiffIssues` /
  // `partitionCallsByControlPolicy`) alongside managed/external grading.
  const owned = new Set(Object.keys(contract.storage.namespaces).map(resolveNamespaceId));
  return issues.filter(
    (issue) =>
      issue.outcome !== 'extra' || owned.has(resolveNamespaceId(issue.coordinate.namespaceId)),
  );
}
```

`resolveNamespaceId` and `POSTGRES_DEFAULT_NAMESPACE_ID` are unchanged. This is **behavior-identical** to today's pre-filter: an unowned actual policy can never share a coordinate with an owned expected policy (expected policies are all in the contract's namespaces), so it only ever surfaces as `extra`, and the post-diff filter removes exactly the set the pre-filter did. The contract is read only for its policy nodes and its owned-namespace keys; the differ (`diffSchema`) receives two full roots and never sees the contract.

File: `packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts`.
- Delete the `migration plan` fail-loud block (lines 216–233) entirely.
- In `planRlsDiff` (line 292), replace `if (!isPostgresSchemaIR(options.schema)) { return []; }` with a narrowing assertion that throws: `if (!isPostgresSchemaIR(options.schema)) { throw new Error('planRlsDiff: options.schema must be a PostgresSchemaIR'); }`. Post-seam every command supplies a `PostgresSchemaIR` (introspection on the live paths, `contractToSchema` on `migration plan`), so this is an unreachable invariant guard, not a per-command branch. The rest of `planRlsDiff` (the issue→call mapping from line 304 down) is unchanged.

`collectSchemaDiffIssues` (`packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts:125`) is unchanged — it already narrows with `isPostgresSchemaIR` (a legitimate type guard, kept) and calls `diffPostgresRlsPolicies`, whose signature is preserved.

## Coherence rationale

One outcome: a Postgres contract is diffed for RLS the same way on every command. project-from-contract gives the expected side an IR form (Unit D); the differ consumes roots, not a contract (Units A, E); the planner's command branches are deleted (Unit E). Units B and C are the mechanical interface changes the new differ requires. A reviewer holds it as "the diff's inputs become symmetric, and the asymmetry-handling code is deleted."

## Scope

**In:** Units A–E exactly as specified, and a `migration plan` e2e proving `CREATE POLICY` emission.

**Out, with the explicit consequence:**
- **Role diffing.** `collectContractRoles` and the introspected `roles` are populated, but `PostgresSchemaIR.children()` yields **policies only**, so roles are never diffed or planned this slice. Missing-role detection and the policy→role edge are slice 2. (If `children()` yielded roles, the supabase shim's platform roles would surface as drift — that is slice 2's graded behavior, not this slice's.)
- **The derivation registry** (plan follow-on C). Derivations are written directly in the target.
- **The relational port** (plan follow-on A). Tables and columns stay on the legacy verifier; they are not placed in `children()`, so the differ never compares them.
- The recursive walk in `diffChildren` is built now (per the ADR) but is exercised only by the synthetic test in AC-7; no production node has children this slice.

## Files touched (complete list)

1. `…/framework-components/src/control/schema-diff.ts` — Unit A.
2. `…/framework-components/src/exports/control.ts` — export `diffSchema` + `DiffableRoot`, drop `diffNodes` (`DiffableNode` stays exported).
3. `…/postgres/src/core/postgres-rls-policy.ts`, `…/postgres-role.ts` — Unit B.
4. `…/postgres/src/core/postgres-schema-ir.ts` — Unit C.
5. `…/postgres/src/core/migrations/project-postgres-schema-from-contract.ts` — Unit D (new).
6. `…/postgres/src/exports/control.ts` — Unit D (wire `contractToSchema`).
7. `…/postgres/src/core/migrations/verify-postgres-rls-policies.ts`, `…/migrations/planner.ts` — Unit E.
8. Tests: `…/framework-components/test/schema-diff.test.ts`, `…/framework-components/test/rls-layer-invariant.test.ts`, `…/postgres/test/migrations/verify-postgres-rls-policies.test.ts`, plus the new `migration plan` e2e (AC-6).

## Pre-investigated edge cases

| Edge case | Disposition |
| --- | --- |
| `fromContract === null` on `migration plan` (initial migration) | `projectPostgresSchemaFromContract(null)` → empty tables, no policies. Expected = all `toContract` policies → all `missing` → all `CREATE`. Covered by AC-6. |
| Contract-derived IR's introspection-only fields | `pgSchemaName: 'public'`, `pgVersion: ''`, `existingSchemas: []`, `nativeEnumTypeNames: []` are fixed in Unit D. Nothing on the contract-derived path reads them except ddl-schema resolution, which expects `'public'`. |
| Contract-derived IR's annotations bag | Unread on the contract-derived side (the only schema-IR-annotations reader is the introspect→PSL path). project-from-contract lets the constructor build its default bag; nothing consumes it. The bag is not extended (TML-2936 retires it). |
| Owned-namespace suppression is post-diff | The differ walks the full actual tree; `diffPostgresRlsPolicies` filters `extra` issues in unowned namespaces afterward. Behavior-identical to the prior pre-filter (proven by AC-3's line-311 case passing unedited). |
| `coord()` rename reaching non-diff `identity()` | Only the diff path is renamed. `grep '\.identity('` shows exactly four framework sites + two error strings in the leaf nodes — all in scope. Unrelated `identity` symbols elsewhere are untouched. |

## Acceptance criteria

Each AC names the file(s) that prove it. "Unchanged" ACs are proven by existing tests passing without edit (beyond the mechanical `diffNodes`→`diffSchema` test-helper rename in AC-1).

- **AC-1 (differ behavior preserved).** `schema-diff.test.ts`, rewritten to call `diffSchema(rootOf(expected), rootOf(actual))` where `rootOf = (xs) => ({ children: () => xs })`, asserts the same issues (coordinate, outcome, message, expected, actual) and the same order as before for every existing flat case.
- **AC-2 (recursion).** A new `schema-diff.test.ts` case builds a synthetic two-level fixture: a parent node present on both sides whose `coord()` matches and `isEqualTo` is true, but whose `children()` differ on one child. `diffSchema` reports exactly one issue, at the **child's** coordinate. (Proves the walk descends matched pairs.)
- **AC-3 (RLS diff unchanged).** `verify-postgres-rls-policies.test.ts` passes unedited — same `diffPostgresRlsPolicies({ contract, schema })` calls, same expected issues, including the owned-namespace scoping case (the test at line 311, `contractOwningAuth`).
- **AC-4 (project-from-contract).** A new unit test on `projectPostgresSchemaFromContract`: a contract with one SELECT policy yields a `PostgresSchemaIR` whose `rlsPolicies` contains that policy and whose `tables` match `contractToSchemaIR`, and for which `isPostgresSchemaIR` returns true. (No assertion on `annotations` — it is unread on the contract-derived side.)
- **AC-5 (db paths unchanged).** The slice-1 lifecycle + drift e2e (`db init`/`db update`/`db verify` against PGlite) pass unedited.
- **AC-6 (migration plan emits RLS).** A new e2e: a contract declaring a SELECT policy, run through `migration plan` (no live DB), produces a migration whose ops include `CREATE POLICY` for that policy (and `ENABLE ROW LEVEL SECURITY` for its table). The fail-loud no longer fires.
- **AC-7 (no command branch, no fail-loud).** `grep` proof: `planner.ts` contains no `unsupportedOperation` RLS summary and no `isPostgresSchemaIR` call that returns `[]`; the only `isPostgresSchemaIR` in `planRlsDiff` throws.
- **AC-8 (layering).** `rls-layer-invariant.test.ts` passes; `git grep -niE 'rls|policy' packages/1-framework packages/2-sql ':!*.test.ts'` shows no RLS naming (the generic `ControlPolicy` matches are not RLS). `pnpm lint:deps` clean.
- **AC-9 (no regression).** `pnpm fixtures:check` clean; SQLite + Mongo suites green.

## Done conditions (gates)

`pnpm build`, `pnpm typecheck`, `pnpm test:packages`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm lint:deps`, `pnpm fixtures:check` — all green. AC-1 through AC-9 satisfied.

## References

- Parent: [`spec.md`](../../spec.md) · [`plan.md`](../../plan.md)
- Design ADR: [`adr-schema-diff-over-structured-ir.md`](../../specs/adr-schema-diff-over-structured-ir.md)
- Generic-differ design: [`design-generic-schema-differ.md`](../../specs/design-generic-schema-differ.md)
- Linear: [TML-2931](https://linear.app/prisma-company/issue/TML-2931)
