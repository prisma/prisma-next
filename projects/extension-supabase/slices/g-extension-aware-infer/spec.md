# Slice G — Extension-aware `contract infer`

**Linear:** TML-2962
**Gate:** none. Independent of native enums, RLS, and the complete-contract work (Slice F).

## Requirement

When a stack extension pack claims a DB element, `contract infer` must omit that
element from the `contract.prisma` it writes. A brownfield project sitting on top
of an extension (e.g. Supabase) should get an inferred contract of *its own*
tables, not the extension's.

## Current behaviour (as-built)

- `contract infer` runs through `inspectLiveSchema`, which builds a control client
  from the config (packs included) and calls `client.inferPslContract(schema)`.
- Infer passes **no contract** to `introspect`, so the Postgres adapter reads the
  **`public`** schema only. The resulting `SqlSchemaIR.tables` is a flat map keyed
  by DB table name, with no schema qualifier.
- `client.inferPslContract` → SQL family instance `inferPslContract(schemaIR)` →
  `sqlSchemaIrToPslAst(schemaIR)`. The family instance holds the stack's
  `extensions`, but `inferPslContract` ignores them today.
- Each pack's `contractSpace.contractJson.storage.namespaces` is keyed by DDL
  schema id (`auth` / `public` / `storage`); each namespace's `entries.table` is
  keyed by DB table name. (The shipped Supabase pack owns tables in `auth` and
  `storage`; its `public` namespace is empty.)

So today infer already omits `auth.*` / `storage.*` incidentally — it never reads
those schemas. The real gap: a pack that claims a **`public`** table has that
table leak into the app's inferred contract.

## Design

Make `inferPslContract` extension-aware:

1. The family instance derives the set of **claimed table names in the schema
   infer reads (`public`)**: for each stack pack with a `contractSpace`, take the
   `public` namespace (`namespaces` entry whose `id === 'public'`) and collect its
   `entries.table` keys.
2. `sqlSchemaIrToPslAst` gains an options bag carrying `claimedTableNames`
   (`ReadonlySet<string>`). It drops any `schemaIR.tables` entry whose key/name is
   in that set before building models.

**Namespace-correctness (the important part):** only `public`-namespace claims
count. A pack claiming `auth.users` must NOT omit an app's `public.users`. Because
introspected tables are all `public` and pack claims are matched only against the
pack's `public` namespace, a same-named table in a non-public pack namespace never
clobbers an app table.

### Seams

- `packages/2-sql/9-family/src/core/psl-contract-infer/sql-schema-ir-to-psl-ast.ts`
  — `sqlSchemaIrToPslAst(schemaIR, options?)`; filter `tables` up front.
- `packages/2-sql/9-family/src/core/control-instance.ts` (`inferPslContract`, ~L892)
  — compute `claimedTableNames` from the closed-over `extensions`, pass through.

No introspection-scope change, no CLI change, no contract-shape change.

## Definition of done

Tests first, then implementation.

- [ ] Unit (`sql-schema-ir-to-psl-ast.test.ts`): given an IR with `app_table` +
      `t_owned` and `claimedTableNames: {'t_owned'}`, the AST contains `AppTable`
      and omits `TOwned`. With no options, output is unchanged (byte-identical to
      today — existing tests stay green).
- [ ] Family-instance test: build a `ControlStack` with an extension pack whose
      contract declares a table in its **`public`** namespace; `inferPslContract`
      on an IR containing that table + an app table omits the pack's table and
      keeps the app's.
- [ ] Namespace-correctness test: a pack that claims the table in a **non-public**
      namespace (`auth`) does NOT omit the same-named `public` table from infer.
- [ ] `pnpm fixtures:check` clean; existing infer output for pack-free stacks
      unchanged.

## Out of scope

- Broadening infer to introspect `auth`/`storage` (that's the complete-contract /
  Slice F direction, and pulls in native-enum handling).
- Omitting non-table elements (enums, roles) — tables only for this slice.
- Any change to `db verify` / control-policy behaviour.
