# ADR 140 — Package Layering & Target-Family Namespacing

## Context

- The repository currently mixes contract authoring DSLs, relational schema builders, query lanes, and ORM logic in `@prisma-next/sql-query`. This makes changes risky and creates accidental coupling across unrelated features.
- The runtime implementation (`packages/runtime/src/runtime.ts`) binds directly to SQL types (`SqlContract`, `SqlStorage`, SQL drivers), preventing a truly target-family agnostic runtime as envisioned by ADR 005 (Thin Core, Fat Targets).
- We want the filesystem to reflect Clean Architecture rings and family boundaries so developers cannot accidentally introduce cyclic or inward dependencies.
- We also want a repeatable, discoverable structure for future target families (e.g., document/mongo) without touching existing SQL packages.

## Decision

Adopt a package layout that encodes both Clean Architecture rings and target-family namespaces:

- Introduce explicit rings under `packages/`: `core/`, `authoring/`, `targets/`, `lanes/`, `runtime/`, `adapters/`.
- Group SQL-specific packages under a dedicated namespace (`packages/sql/**`) for family cohesion (contract types/emitter/ops, lanes, runtime, and adapters).
- Extract a target-agnostic runtime core (`packages/runtime/core`) that owns plan verification, plugin lifecycle, and the runtime SPI. Family-specific runtimes (e.g., `packages/sql/sql-runtime`) implement the SPI and plug into core via context.
- Keep the emitter core target-agnostic with family hooks; SQL-specific validation and `.d.ts` generation live in the SQL family hook.
- Avoid transitional shims unless required internally; there are no external consumers.

## Details

### Directory Topology

```
packages/
  core/
    contract/            (contract types + plan metadata)
    plan/                (plan helpers, diagnostics, shared errors)
    operations/          (target-neutral op registry + capability helpers)
  authoring/
    contract-authoring/  (TS builders, canonicalization, schema DSL)
    contract-ts/         (TS authoring surface, if split further)
    contract-psl/        (PSL parser + IR, future)
  targets/
    sql/
      contract-types/
      operations/
      emitter/
  lanes/
    relational-core/     (schema + column builders, operation attachment, AST types)
    sql-lane/            (relational DSL + raw lane)
    orm-lane/            (ORM builder, includes, relation filters)
  runtime/
    core/                (target-agnostic runtime kernel: verification, plugins, SPI)
  sql/
    sql-runtime/         (SQL runtime implementation of the SPI)
    postgres/
      postgres-adapter/
      postgres-driver/
    # mysql/, sqlite/ can mirror postgres/
  document/
    # future document family mirrors sql/ layout
  compat/
    compat-prisma/       (optional facades/shims if needed later)
```

### Dependency Rules

`core → authoring → targets → lanes → runtime(core) → family-runtime → adapters`

- Inner rings never import from outer rings.
- Family namespaces (e.g., `packages/sql/**`) can depend on inner rings and on their own family packages, but not across families.
- Enforce with tsconfig path groups and ESLint `import/no-restricted-paths` plus a CI import-graph check.

### Runtime Separation

- `packages/runtime/core` exposes a target-agnostic SPI (verification, plugin lifecycle, telemetry), no direct imports from `targets/*`.
- `packages/sql/sql-runtime` implements the SPI using SQL adapters and codecs from `packages/targets/sql/*` and `packages/sql/postgres/*`.
- This enables booting the runtime with a non-SQL family by swapping in another family-runtime package that implements the same SPI.

### Emitter Hooks

- Emitter remains target-agnostic with a hook registry keyed by `targetFamily`.
- SQL-specific validation and `.d.ts` generation are implemented by the SQL hook under `packages/targets/sql/emitter`.

## Consequences

### Positive

- Clear ownership and boundaries; reduced blast radius for changes.
- Prevents cyclic/inward dependencies via structure and lint rules.
- Readable, repeatable path for adding new target families without touching SQL.
- Paves the way for a truly target-agnostic runtime core.

### Trade-offs

- More packages to manage and release.
- Short-term migration effort moving files and updating imports.
- Some duplication across families (e.g., similar lane patterns) is expected and acceptable.

## Migration Plan (High-Level)

1) Scaffold the new folder skeleton and path aliases; add import guardrails and CI checks.
2) Extract `contract-authoring` out of `@prisma-next/sql-query` into `packages/authoring/contract-authoring`.
3) Stand up `lanes/relational-core` and move schema/column builders and operation attachment there.
4) Split lanes into `sql-lane` and `orm-lane`; keep tests with their respective packages.
5) Restructure `sql-target` under `targets/sql` and keep a curated entrypoint for adapters.
6) Extract `runtime/core` and move SQL-specific execution into `sql/sql-runtime`.
7) Remove legacy re-exports; no external consumers means we can delete transitional shims once internal callsites are updated.

## Alternatives Considered

- Keep current packages and rely solely on lint rules: Lower friction, but the filesystem continues to obscure boundaries and invites drift.
- One monolithic `sql` package with subfolders: Better grouping, but still intermixes rings (lanes, target, runtime) and weakens guardrails.
- Heavy use of transitional shims: Easier migration, but adds maintenance overhead with no external consumers to justify it.

## References

- ADR 005 — Thin Core, Fat Targets
- ADR 011 — Unified Plan Model
- ADR 016 — Adapter SPI for Lowering
- ADR 121 — Contract.d.ts structure and relation typing
- Brief: docs/briefs/12-Package-Layering.md

