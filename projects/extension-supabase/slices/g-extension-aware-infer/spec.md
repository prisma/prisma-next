# Slice G — `contract infer` omits elements the aggregate contract already describes

**Linear:** TML-2962
**Gate:** #894 (schema-node tree restructure) — merged. Independent of native enums, RLS, and the complete-contract work (Slice F).

## Requirement

`contract infer`'s job is to describe **what the aggregate contract doesn't already account for**. When a stack extension pack's contract space declares a DB element, infer must omit it from the `contract.prisma` it writes. A brownfield project sitting on top of an extension (e.g. Supabase) gets an inferred contract of *its own* tables, not the extension's.

## Substrate (as merged in #894)

- `contract infer` → `inspectLiveSchema` → CLI control client → family instance `inferPslContract(schemaIR)`.
- The family instance delegates to the **target-descriptor hook** `inferPslContract?: (schema: SqlSchemaIRNode) => PslDocumentAst` (`packages/2-sql/9-family/src/core/migrations/types.ts`); Postgres binds it in `packages/3-targets/3-targets/postgres/src/exports/control.ts` to `inferPostgresPslContract(tree)` (`core/psl-infer/infer-psl-contract.ts`).
- The input is the `PostgresDatabaseSchemaNode` tree: `database → namespaces[schemaName] → tables`. Namespace identity is first-class.
- `inferPostgresPslContract` gathers tables across the tree's namespaces into one flat map (stopgap TML-2958: the PSL writer walks a flat map; infer introspects a single namespace today) and throws on cross-schema duplicate table names.
- The family instance closes over the stack's `extensions`; each pack with a `contractSpace` carries `contractJson: Contract<SqlStorage>`, whose `storage.namespaces` is keyed by DDL schema name with `entries.table` keyed by DB table name.

## Design

Pass the partially-assembled contract aggregate **into the inferrer**; the inferrer decides what is already described. The caller does not pre-compute an omission set — that would be the caller doing the inferrer's job through a bespoke seam.

1. **Family instance** (`control-instance.ts`): compose the aggregate view from the stack packs' contract spaces **as-is** — a readonly collection of `{ id, contract }` (no merging; merging is the contract-spaces machinery's concern, TML-2397/2398, and the inferrer only needs membership tests). Pass it to the target hook.
2. **Hook signature** (`migrations/types.ts`): `inferPslContract?: (schema: SqlSchemaIRNode, context?: { aggregate: readonly ExtensionContractSpaceView[] }) => PslDocumentAst`. The framework-level `PslContractInferCapable` (CLI-facing family-instance capability) is unchanged — composition happens inside the family instance.
3. **Inferrer** (`inferPostgresPslContract`): while gathering tables per namespace, skip any table whose `(namespace.schemaName, tableName)` is declared by an aggregate member — i.e. the member contract's `storage.namespaces[schemaName].entries.table[tableName]` exists. Then strip surviving tables' `foreignKeys` whose `referencedTable` was omitted, so no dangling `@relation` to a nonexistent model is emitted.

Ordering matters twice:

- **Omit before the duplicate-name throw.** When introspection later broadens beyond `public` (Slice F), a pack-owned `auth.users` must be omitted before the flat-bucket collision check, so it cannot spuriously collide with an app `public.users`.
- **Omit before relation inference / name maps / topological sort** — all downstream structures are built only from surviving tables.

Namespace-correctness is by construction: matching is on `(schemaName, tableName)` tree identity, so a pack claiming `auth.users` can never suppress an app's `public.users`. No bare-name matching anywhere.

### Space semantics (and the re-infer future)

The aggregate members are **extension spaces: "not mine — omit."** Pure subtraction is correct for them.

On repeat invocations the aggregate will also contain the **app's own contract space: "mine — reconcile."** Subtraction would be wrong there (it would empty the inferred contract); instead infer modifies the app space according to the schema diff — and #894 made that diff a first-class target operation (`diffDatabaseSchema`). That re-infer behaviour is a follow-on, not this slice; this seam (aggregate-in) is what makes it reachable without re-plumbing. Inferred contract = introspected schema − what the aggregate accounts for; the same subtract-shape as verify, pointed at authoring.

## Definition of done

Tests first, then implementation.

- [ ] Target-level test (`inferPostgresPslContract`): a tree whose `public` namespace holds `app_table` + `t_owned`, aggregate containing a pack contract declaring `public.t_owned` → PSL AST has the app model, omits the pack model. Empty/absent aggregate → output byte-identical to today (existing tests stay green).
- [ ] Namespace-correctness test: aggregate member declares `users` under its `auth` namespace only; tree's `public` namespace holds `users` → the app's `Users` model is kept.
- [ ] Dangling-FK test: surviving `posts` has an FK to omitted `t_owned` → the emitted `Posts` model has no relation field referencing the omitted table (no dangling model type anywhere in the AST).
- [ ] Family-instance test: a `ControlStack` with an extension pack whose contract space declares a `public` table; `familyInstance.inferPslContract(tree)` omits it — proves the pack → aggregate → hook threading, not a hand-built aggregate.
- [ ] Duplicate-name interaction test: pack-claimed table omitted before the cross-schema duplicate check (two namespaces, same table name, one pack-claimed → no throw, app table survives).
- [ ] `pnpm fixtures:check` clean; pack-free infer output unchanged.

## Out of scope

- Re-infer / app-space reconciliation (diff-driven modification of an existing app contract) — follow-on enabled by this seam.
- Omitting non-table elements (enums, roles, policies) — the same membership test extends to them once the aggregate carries them; tables only for this slice.
- Broadening infer's introspection scope beyond the current single namespace (Slice F direction).
- Any change to `db verify` / control-policy behaviour.
