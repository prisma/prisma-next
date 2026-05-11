# Project 1 — Searchable-encryption MVP — CR follow-ups

This is the post-close-out follow-up scope for Project 1. The bulk of Project 1 shipped on `tml-2373-project-1-on-2397` and was closed out in M4/M5; two acceptance criteria were surfaced after close-out as code review items and remain in-scope for the project's reopened PR:

- **CR-1** — Cipherstash migration-op factories must be public, user-callable, and renderable via the codec hook.
- **CR-5** — Cipherstash query-operator type-visibility (`cipherstashEq` / `cipherstashIlike`) on model accessors and the SQL query builder.

Full design — file paths, code snippets, AC, ADR amendments planned — lives in [`../project-1-rebase-followups.md`](../project-1-rebase-followups.md). That document is the locked-in design. This spec is a thin orchestration surface naming the milestones, ACs, and out-of-scope.

# Intent

Project 1's stated outcome is a *production-grade* CipherStash integration. The migration scaffolder rendering cipherstash's contributions as verbose `rawSql({...})` blocks (CR-1) and the namespaced operators not being type-visible (CR-5) are correctness gaps against that intent — both should be invisible to the application author. CR-1 makes the codec-emitted ops indistinguishable in authoring ergonomics from `createTable` / `setNotNull`; CR-5 makes `cipherstashEq` autocomplete on a `cipherstash/string@1` column the same way `cosineDistance` autocompletes on a `pg/vector@1` column.

# Acceptance criteria

## AC-1 (CR-1) — Migration-op factories are public + renderable

Authoring side:

- `@prisma-next/extension-cipherstash/migration` exports `cipherstashAddSearchConfig` and `cipherstashRemoveSearchConfig` as public functions with `(args: { table, column, index, castAs? })` signatures.
- A user authoring a hand-written `migration.ts` can call `cipherstashAddSearchConfig({...})` directly and produce a `MigrationPlanOperation` indistinguishable from the planner-emitted equivalent.

Planner side:

- `prisma-next migration plan` against an app with `Encrypted<string>` columns (`equality: true, freeTextSearch: true`) produces a `migration.ts` whose codec-emitted ops render as `cipherstashAddSearchConfig({...})` and `cipherstashRemoveSearchConfig({...})` factory calls. **Zero** `rawSql({ id: 'cipherstash-codec.*', ... })` blocks.
- The rendered `migration.ts` carries `import { cipherstashAddSearchConfig, ... } from '@prisma-next/extension-cipherstash/migration';` automatically (deduped alongside postgres imports).

Round-trip / canonical-content invariants:

- Re-running `pnpm tsx migrations/.../migration.ts` re-emits `ops.json` byte-for-byte against pre-CR-1 baseline. Runtime op shape is unchanged; only IR / TS rendering changes.
- `migration.json` `migrationHash` is preserved (canonical content invariant).
- The `examples/cipherstash-integration/migrations/20260508T1721_migration/migration.ts` baseline regenerates with factory calls; its `migrationHash` is preserved.

## AC-2 (CR-5) — Operator type-visibility

Positive cases:

- `db.user.findMany({ where: { email: { cipherstashEq: '...' } } })` type-checks; `cipherstashEq` autocompletes on `email` (a `cipherstash/string@1` column).
- `db.user.findMany({ where: { email: { cipherstashIlike: '%...%' } } })` type-checks similarly for `cipherstashIlike`.
- `sql(t).where(t => t.email.cipherstashEq('...'))` type-checks against the SQL query builder; the call returns the right boolean expression type.

Negative cases:

- `cipherstashEq` does NOT autocomplete on a plain `pg/text@1` column (e.g. `name`).
- `db.user.findMany({ where: { email: { eq: '...' } } })` continues to NOT type-check (the equality-trait removal already enforces this; this AC reaffirms the negative).
- A negative type-test (`@ts-expect-error`) covers `cipherstashEq` on a non-cipherstash column.

End-to-end:

- The negative + positive type tests live in the `examples/cipherstash-integration` example app's typecheck (`pnpm --filter cipherstash-integration-example typecheck`).

## AC-3 — Architecture documentation reflects the changes

- **ADR 195** (Planner IR with two renderers): amended to record the framework `OpFactoryCall` interface promotion and the inheritance-with-abstract-methods pattern (postgres + mongo + cipherstash all use this; the visitor section in the current ADR is stale relative to the implementations).
- **ADR 212** (Codec lifecycle hooks): amended hook return type from `SqlMigrationPlanOperation[]` to `OpFactoryCall[]`; flow diagram updated.
- **ADR 211** (Extension operator surface — namespaced replacement operators): amended to note that namespaced replacement operators must also project type-visibility through `QueryOperationTypes`.

# Out of scope

- The pre-shipped Project 1 work (M3 / M3.5 / M4 / M5). Already merged onto this branch; not re-litigated here.
- Project 2 (`Encrypted<Number>`, `Encrypted<Date>`, `Encrypted<Boolean>`, `Encrypted<Json>`, `orderAndRange` + `searchableJson` operators). Project 2 has its own spec.
- `sql-raw-factory` (public `raw\`...\`` factory). Independent project, sibling spec.
- Tests for hand-written migrations using the new factories beyond the round-trip invariant in AC-1. The factories' runtime behavior is the same as the pre-CR-1 helpers, which already have coverage; the AC is about the rendering pipeline producing them.
- The TML-2435 Linear ticket. Cancelled at this milestone close (CR-5 supersedes it).

# References

- Locked-in design: [`../project-1-rebase-followups.md`](../project-1-rebase-followups.md)
- Plan + tasks + validation gates: [`plan.md`](plan.md)
- Project umbrella spec: [`../spec.md`](../spec.md)
- ADR 195 — Planner IR with two renderers: [`../../../docs/architecture docs/adrs/ADR 195 - Planner IR with two renderers.md`](../../../docs/architecture%20docs/adrs/ADR%20195%20-%20Planner%20IR%20with%20two%20renderers.md)
- ADR 211 — Extension operator surface: [`../../../docs/architecture docs/adrs/ADR 211 - Extension operator surface namespaced replacement operators.md`](../../../docs/architecture%20docs/adrs/ADR%20211%20-%20Extension%20operator%20surface%20namespaced%20replacement%20operators.md)
- ADR 212 — Codec lifecycle hooks: [`../../../docs/architecture docs/adrs/ADR 212 - Codec lifecycle hooks.md`](../../../docs/architecture%20docs/adrs/ADR%20212%20-%20Codec%20lifecycle%20hooks.md)
- Reference implementation for type-visibility (CR-5): pgvector's [`packages/3-extensions/pgvector/src/types/operation-types.ts`](../../../packages/3-extensions/pgvector/src/types/operation-types.ts)
