# Slice 1.5 — Round 5: build the diff tree at derivation; review-comment cleanup

Prescriptive spec. Make exactly these changes. Tests before implementation.

Addresses Will's round-5 review comments on PR #868. The central change: the
schema IR must hold the database→table→policy tree built **once at derivation**,
not store a flat policy list and reassemble the tree inside `children()`.

## A. Build the table-node tree at derivation (comments #1, #10, mechanical #4)

Today `PostgresSchemaIR` stores a flat `rlsPolicies` array and `children()`
groups it into `PostgresTableNode`s on every call. Move the grouping to
derivation; the IR holds the table nodes; `children()` returns them.

1. **Shared grouping helper.** In `postgres-table-node.ts`, add:
   ```ts
   export function groupPoliciesIntoTableNodes(
     policies: readonly PostgresRlsPolicy[],
   ): readonly PostgresTableNode[]
   ```
   Group by `${namespaceId}/${tableName}`, first-seen order preserved, one
   `PostgresTableNode` per group (schemaName/tableName from the first policy).
   This is the ONE place grouping happens. (Lift the exact logic currently in
   `PostgresSchemaIR.children()`.)

2. **`PostgresSchemaIR` holds table nodes.**
   - `PostgresSchemaIRInput`: replace `rlsPolicies: readonly PostgresRlsPolicy[]` with `tableNodes: readonly PostgresTableNode[]`.
   - The class stores `readonly tableNodes` (frozen). `children()` returns `this.tableNodes` directly — no grouping, no `Map`, no allocation per call.
   - Add a derived read accessor `get rlsPolicies(): readonly PostgresRlsPolicy[]` that flattens `tableNodes` (for the few existing readers), OR update those readers to use `tableNodes`. Pick whichever is smaller; if you keep `rlsPolicies`, make it a getter so there is one source of truth.

3. **Both derivations build table nodes.**
   - `collect-contract-postgres-nodes.ts`: add `collectContractRlsTableNodes(contract): readonly PostgresTableNode[]` = `groupPoliciesIntoTableNodes(collectContractRlsPolicies(contract))`. Keep `collectContractRlsPolicies` (the collect+normalize step) — it is still the normalization site — but the derivation now consumes the grouped form. (This answers #10: the collector's output is grouped into the tree before it reaches the IR, not shoved on flat.)
   - `contract-to-postgres-schema-ir.ts`: pass `tableNodes: collectContractRlsTableNodes(contract)`.
   - `control-adapter.ts` introspection (the three `new PostgresSchemaIR({... rlsPolicies ...})` sites ~597, ~677, ~1190): build `tableNodes: groupPoliciesIntoTableNodes(rlsPolicies)`. For the multi-schema merge (~672), concatenate the per-schema `tableNodes` instead of flat policies (tables are distinct per schema, so no regrouping needed).

4. `diffPostgresSchema` ownership (the `expected.rlsPolicies.map(p => p.namespaceId)` read) now reads from `expected.tableNodes` (flatMap policies, or use each table node's `schemaName`).

## B. Move ownership filtering to the caller (comment #4-new)

Will: dropping `extra` issues by ownership is not the diff's job; and it raised
"won't we leave extra policies behind?" Behaviour is correct (an `extra` policy
in a namespace the contract does not own belongs to another contract space and is
deliberately left alone), but the placement is wrong.

- `diffPostgresSchema(expected, actual)` returns the whitelisted policy issues **without** the ownership filter — just the total diff filtered to policy-subject issues.
- Move the ownership drop into the callers that own contract/space context: `planPostgresSchemaDiff` (planner) and `collectSchemaDiffIssues` (control-adapter). Add one small exported helper `dropUnownedExtraPolicyIssues(issues, ownedSchemaNames)` (in `diff-postgres-schema.ts` or a sibling) the callers apply. `ownedSchemaNames` comes from the contract (the resolved declared namespaces) at the call site.
- Document at the call site that unowned `extra` policies are another space's and intentionally untouched.

## C. User-facing reference rendering (comment #5)

The framework `outcomeMessage` joins the path with `/`, and the CLI verify
formatter prints `issue.message` verbatim — so users see `public/profiles/p_…`,
which is not a valid Postgres qualified reference.

- Keep the framework `SchemaDiffIssue.message` as an internal diagnostic (leave `outcomeMessage` as-is; the framework is target-agnostic and must not render Postgres syntax).
- In the Postgres diff path (`diffPostgresSchema`, after whitelisting), set each issue's user-facing message from the **policy node**: render `policy "<name>" on "<schema>"."<table>"` (double-quoted identifiers, dotted qualification) using the `PostgresRlsPolicy` on `issue.expected ?? issue.actual`. Add a small `renderPostgresPolicyReference(policy)` helper. The issue the planner/formatter sees then carries a proper Postgres reference.
- Update the family test `schema-verify.control-policy.test.ts` (the `message` it asserts) to the new rendering. Update any other test asserting the slash-joined message.

## D. Small fixes

- **#2 `planner.ts` ~279 — unreachable guard.** Replace the ad-hoc `if (!isPostgresSchemaIR(...)) throw` + "unreachable" comment with the existing `assertPostgresSchemaIR(options.schema)` invariant assertion (it already exists in `postgres-rls-policy.ts`/types). If no such assert exists for the schema IR, add `assertPostgresSchemaIR`. One line, no explanatory comment.
- **#3 `planner.ts` ~208-213 — delete the redundant explanatory comment** above `const rlsCalls = this.planPostgresSchemaDiff(options);` (the same point is restated inside `planPostgresSchemaDiff`). Keep code unchanged.
- **#6 `schema-diff.ts` ~46 — `emitMissingSubtree`/`emitExtraSubtree`** loop → `node.children().flatMap((c) => emitMissingSubtree(c, path))` style. Behaviour identical.
- **#7 `schema-diff.ts:24` — `id()` method → property.** Change `DiffableNode` from `id(): string` to `readonly id: string`. Concrete nodes implement it as a getter (`get id(): string { return … }`) since they compute it: `PostgresRlsPolicy.id` → `this.name`; `PostgresTableNode.id` → `` `${this.schemaName}/${this.tableName}` ``; `PostgresSchemaIR.id` → `this.pgSchemaName`. Update the differ to read `node.id` (not `node.id()`), and all test stubs/impls. (A getter still computes; it just reads as a property at the call site, which is what Will wants.)
- **#8 `schema-diff.ts:15` — trim** "— including the database root —" from the `DiffableNode` doc comment.
- **#9 `examples/supabase/test/skeleton.integration.test.ts:529`** — replace `issue.path[issue.path.length - 1] === POLICY_WIRE_NAME` with reading the issue's subject node id: `(issue.expected ?? issue.actual)?.id === POLICY_WIRE_NAME` (property after #7). The issue carries the node; do not dig into the path tail.

## Not in scope (reply on the thread, do not change)

- **Renaming `PostgresSchemaIR` off "IR" (#4 naming).** 61 references; the class is ambiguous about database-vs-schema level. The structural fix above resolves the `children()`-rebuild that prompted the comment; the class-name/leveling is a separate decision. Leave the name.

## Tests (write first)

- `postgres-table-node.test.ts` / `rls-diffable-nodes.test.ts`: `groupPoliciesIntoTableNodes` groups by schema/table in first-seen order; `id` is a property returning the bare wire name / `schema/table` / `pgSchemaName`.
- `diff-postgres-schema.test.ts`: tree built at derivation (the existing nesting/path tests still pass with `children()` returning stored nodes); the user-facing message renders `policy "name" on "schema"."table"`; ownership now applied by the caller — adjust the ownership test to call the caller-side helper, and assert `diffPostgresSchema` alone no longer drops unowned extras.
- `schema-diff.test.ts`: total-descent tests use `id` as a property in stubs; `flatMap` form unchanged behaviour.
- Planner/integration: `migration plan` still emits `CREATE POLICY` + `ENABLE RLS`; the `assertPostgresSchemaIR` invariant path covered.

## Acceptance criteria

- AC-1 `PostgresSchemaIR.children()` returns stored `tableNodes`; no grouping/allocation in `children()`. Grouping happens once, at derivation, in `groupPoliciesIntoTableNodes`.
- AC-2 Both derivations (contract + introspection) build `tableNodes`; no flat `rlsPolicies` is "shoved onto the root" (it is at most a derived getter).
- AC-3 Ownership filtering is applied by the caller, not inside `diffPostgresSchema`.
- AC-4 `DiffableNode.id` is a property; all nodes + differ + tests updated.
- AC-5 User-facing policy diff messages render as `policy "name" on "schema"."table"`.
- AC-6 #2/#3/#6/#8/#9 done.
- Gates: full set (build, typecheck --force, **biome lint per package**, lint:deps, lint:casts, check:upgrade-coverage, fixtures:check, all test suites) green. Run biome (`turbo run lint`) — the previous round missed it.
