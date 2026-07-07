# Slice G — `contract infer` omits elements the stack's extension packs describe

**Linear:** TML-2962 · **Follow-on:** TML-2977 (extract `ContractSpaceAggregate` base — not gating this slice)
**Gate:** #894 (schema-node tree restructure) — merged. Independent of native enums, RLS, and the complete-contract work (Slice F).

## Requirement

`contract infer`'s job is to describe **what the stack's contract spaces don't already account for**. When a stack extension pack's contract space declares a DB element, infer must omit it from the `contract.prisma` it writes. A brownfield project on top of an extension (e.g. Supabase) gets an inferred contract of *its own* tables, not the extension's.

## Substrate (as merged in #894)

- `contract infer` → `inspectLiveSchema` → CLI control client → family instance `inferPslContract(schemaIR)`.
- The family instance delegates to the **target-descriptor hook** `inferPslContract?: (schema: SqlSchemaIRNode) => PslDocumentAst` (`packages/2-sql/9-family/src/core/migrations/types.ts`); Postgres binds it in `packages/3-targets/3-targets/postgres/src/exports/control.ts` to `inferPostgresPslContract(tree)` (`core/psl-infer/infer-psl-contract.ts`).
- The input is the `PostgresDatabaseSchemaNode` tree: `database → namespaces[schemaName] → tables`. Namespace identity is first-class.
- The family instance closes over the stack's `extensions`; each pack with a `contractSpace` carries `contractJson: Contract<SqlStorage>`.

## Design — reuse the generic coordinate mechanism; mint nothing

The match is by **entity coordinate**, using the existing `elementCoordinates` generator from `@prisma-next/framework-components/ir` (yields `EntityCoordinate = { plane, namespaceId, entityKind, entityName }`). Both the family and the Postgres target already depend on framework-components, so this is a free reuse, not a new mechanism.

1. **Family instance** (`control-instance.ts`): forward the stack packs' described contracts to the target hook — `extensions.flatMap(e => e.contractSpace ? [e.contractSpace.contractJson] : [])`, typed `readonly Contract<SqlStorage>[]`. No new type; the family is a dumb forwarder of contracts it already holds.
2. **Hook signature** (`migrations/types.ts`): widen the existing `inferPslContract` method's parameter to `(schema, describedContracts?: readonly Contract<SqlStorage>[])`. **Add no new type declaration to this file** — reference the existing `Contract<SqlStorage>`. (The hook lives on `SqlControlTargetDescriptor`, which is in this file; widening the one existing signature is the only permitted touch here.)
3. **Postgres inferrer** (`inferPostgresPslContract`): build a lookup of declared coordinates by running `elementCoordinates(contract.storage)` over each described contract (keyed canonically on `(namespaceId, entityKind, entityName)`). While gathering the tree, omit any node whose coordinate is in the lookup — a table lives at `(namespace.schemaName, 'table', tableName)`. The match is **entity-agnostic** (tables today; enums/roles/policies for free as they enter the tree) and **coordinate-precise** (`namespaceId` = the tree's `schemaName` = the contract namespace `.id`, so a pack's `auth.users` cannot suppress an app's `public.users`).

**Deleted from the prior revision:** `SqlAggregateContractMember`, `SqlPslInferContext`, and the table-specific `isTableDescribedByAggregate`. Those minted a parallel "aggregate" concept and a per-entity test; the coordinate atom already exists.

Ordering (unchanged from the substrate, still required):

- **Omit before the cross-schema duplicate-name throw**, so a pack-claimed element in one namespace can't spuriously collide with a surviving same-named element in another once introspection broadens (Slice F).
- **Omit before relation inference / name maps / topological sort** — all built from surviving nodes only.
- **Strip surviving nodes' foreign keys** that reference an omitted table **only when the referenced name was omitted and has no surviving table** (survivor-aware), so no dangling `@relation` is emitted and a legitimate same-named relation in another namespace is never stripped.

Empty/absent `describedContracts` → output byte-identical to today (fast path, return-by-reference).

### Space semantics (and the re-infer future)

Extension pack spaces are **"not mine — omit"** — pure subtraction, all this slice needs. On repeat invocations the stack will also carry the **app's own** contract space (**"mine — reconcile"**): subtraction would empty the inferred contract, so infer instead modifies the app space per the schema diff (#894's `diffDatabaseSchema`). That re-infer behaviour is a follow-on, and — with TML-2977 — both the coordinate ownership query and the app+extension composition move onto the extracted `ContractSpaceAggregate` base; Slice G's inline `elementCoordinates` call collapses to a one-line delegation there.

## Definition of done

Tests first, then implementation.

- [ ] Target-level test (`inferPostgresPslContract`): a tree whose `public` namespace holds `app_table` + `t_owned`, one described contract declaring `public.t_owned` → PSL AST has the app model, omits the pack model. Empty/absent described contracts → output byte-identical to today (existing infer/print-psl suite stays green).
- [ ] Namespace-correctness test: a described contract declares `users` under its `auth` namespace only; tree's `public` namespace holds `users` → the app's `Users` model is kept. (Coordinate-precise: matched on namespace `.id`/`schemaName`, never bare name.)
- [ ] Entity-agnostic evidence: the match is coordinate-driven (`elementCoordinates`), not table-typed — a test or the shape of the code demonstrates the omission is keyed on `(namespaceId, entityKind, entityName)`, not a table-specific predicate.
- [ ] Dangling-FK tests: (a) surviving `posts` FK→omitted `t_owned` → emitted `Posts` has no relation to the omitted table; (b) surviving `posts` FK→`users` where `auth.users` is omitted but `public.users` survives → the relation is **kept** (survivor-aware).
- [ ] Family-instance / end-to-end test: real `postgresTargetDescriptor` + real family instance + a stack with a pack declaring a `public` table → `inferPslContract(tree)` omits it — proves the pack → hook forwarding, not a hand-built input.
- [ ] Duplicate-name interaction test: two namespaces, same table name, one pack-declared → no throw, app table survives.
- [ ] No new type in `migrations/types.ts`; no `SqlAggregateContractMember`/`SqlPslInferContext`/`isTableDescribedByAggregate` anywhere. `pnpm fixtures:check` clean; pack-free infer output unchanged.

## Out of scope

- Extracting the `ContractSpaceAggregate` base / coordinate-precise ownership query into framework-components (TML-2977).
- Re-infer / app-space reconciliation (diff-driven modification of an existing app contract) — follow-on this seam enables.
- Broadening infer's introspection scope beyond the current single namespace (Slice F direction).
- Any change to `db verify` / control-policy behaviour.
