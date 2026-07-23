# D2 — SQL family + LSP derive scalar types from the unified namespace

**Slice plan:** `projects/remove-db-attributes/slices/unify-type-channel/plan.md` · **Tier:** orchestrator · **Branch:** `tml-2985-unify-type-channel`

## Task

D1 landed adapter contributions: every base scalar now exists as a top-level zero-arg `AuthoringTypeConstructorDescriptor` in the assembled `AuthoringContributions.type` (commit `7ec6d817`). This dispatch re-points the **SQL-family and LSP consumers** of the legacy `scalarTypeDescriptors` map at the unified namespace. The map channel itself stays alive (mongo still reads it; D4 deletes it).

## Outcome (property statement)

The SQL provider, the SQL symbol table's scalar-name input, `controlStack.scalarTypes`, and the language-server wiring all derive scalar-type knowledge from top-level zero-arg constructors in the assembled namespace, **such that** a bare type name `T` is semantically the zero-arg instantiation `T()` (one authoritative registration per type; the namespace is the single source of truth for the SQL path) and postgres + sqlite contract emission is **byte-identical** — the derived `ColumnDescriptor` map carries exactly the `{ codecId, nativeType }` the old codecLookup derivation produced, proven by parity tests.

## In

- `packages/2-sql/2-authoring/contract-psl/src/provider.ts` — `buildColumnDescriptorMap` (and the `buildSymbolTable` `scalarTypes` input at ~L114) derive from `context.authoringContributions.type` top-level zero-arg constructors instead of `context.scalarTypeDescriptors`/`codecLookup`.
- `packages/1-framework/1-core/framework-components/src/control/control-stack.ts` — `controlStack.scalarTypes` (grep for where the stack exposes `scalarTypes`; LSP consumes `project.controlStack.scalarTypes`) derives from the assembled namespace's top-level zero-arg-constructor names. Add/extend a shared helper (e.g. next to `collectContributedDescriptorPaths` in `framework-authoring.ts`) rather than re-walking ad hoc — one walk, many views.
- `packages/1-framework/3-tooling/language-server/src/config-resolution.ts` — `scalarTypes: [...stack.scalarTypeDescriptors.keys()]` re-derives from the namespace; the no-project default stays `[]`.
- Parity tests: for one representative schema each on postgres and sqlite, the emitted contract (or the resolved column-descriptor map) is deep-equal before/after — pin `{ codecId, nativeType }` for every base scalar. Existing interpreter/LSP tests must stay green **unweakened**.

## Out

- The mongo provider/interpreter (D3) — do not touch `packages/2-mongo-family/**` or `packages/3-mongo-target/**`.
- Deleting the map channel, `assembleScalarTypeDescriptors`, `ContractSourceContext.scalarTypeDescriptors`, adapter maps, or `validateScalarTypeCodecIds` (D4).
- Native types, `Json`/`Jsonb` re-binding, any authoring-syntax change.

## Edge cases

| Case | Disposition |
| --- | --- |
| Namespaced constructors (`sql.String`, `pg.enum`) in the walk | Excluded from scalar-name derivation — only **top-level** zero-arg entries are scalars. Entries with args or `entityRefArg` at top level: excluded from the *scalar* view (must not appear in `scalarTypes`). |
| `typeRef` behavior on named types | Unchanged — `toNamedTypeFieldDescriptor` consumes the same `ColumnDescriptor` shape. |
| Field presets / `resolveFieldTypeDescriptor` constructor path | Untouched — parameterized calls keep flowing through the existing `typeConstructor` resolution. |
| Emission drift anywhere | Halt condition — report, do not "fix forward". |
| Destructive git operations | **Forbidden**; commit with `git commit -s`. |

## Completed when

1. `rg 'scalarTypeDescriptors' packages/2-sql packages/1-framework/3-tooling/language-server --type ts -g '!*test*'` returns zero hits (the SQL + LSP paths no longer read the map).
2. Parity tests green; `pnpm typecheck`, per-touched-package lint + tests, LSP test suite, `pnpm fixtures:check` with zero drift.
3. `pnpm lint:deps` clean.

## Report back

Files touched; where `scalarTypes` derivation now lives; parity-test names; gates run + results; F1/F3/F14/F16 checked; commit SHA.
