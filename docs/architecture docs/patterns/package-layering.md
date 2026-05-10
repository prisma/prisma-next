# Pattern: Package layering — domains × layers × planes

**Status:** Stable
**Maintainer:** architect

## Intent

Packages are organised along three orthogonal axes:

- **Domains:** Framework (target-agnostic) and per-target families (SQL, Document, Mongo, Targets, Extensions).
- **Layers:** Core → Authoring → Tooling → Lanes → Runtime → Adapters / Drivers — responsibility tiers, expressing dependency direction.
- **Planes:** Migration vs Runtime (vs Shared) — code in the migration plane must not import runtime-plane code; runtime may consume migration _artifacts_ (JSON manifests), never migration code.

Imports flow **downward and outward only**. Cross-axis violations are caught by `pnpm lint:deps`. The catalogue records the structural shape; the canonical mapping and the full rules live in [`Package-Layering.md`](../Package-Layering.md).

## When to use

- Whenever you create a new package — the directory hierarchy and naming convention pin where it goes.
- Whenever you add an import — `lint:deps` checks the direction; this pattern is the rationale for what those checks enforce.
- Whenever you reach for a "shared utilities" package — the layering rules say that shared code lives at a layer at-or-below every consumer; if there is no such layer, the shape is wrong.

## When NOT to use

- **Single-package projects** — the layering pattern is for cross-package boundaries; one package is its own bounded context.
- **Examples and integration tests** — these are explicitly outside the layering rule (they consume from many layers); the pattern still informs how you reason about their consumption, but it doesn't constrain their imports.
- **Tooling under `scripts/`** — repo-level scripts are not packages and have no layer; doc-tooling helpers like the catalogue link-checker are the canonical example.

## Structure

The full directory mapping is in [`Package-Layering.md`](../Package-Layering.md). At a glance:

```
packages/
├── 1-framework/        # Framework domain (target-agnostic)
│   ├── 1-core/         # Lowest layer; foundational types
│   ├── 3-tooling/      # Emitters, CLIs
│   └── 5-runtime/      # Runtime orchestration
├── 2-sql/              # SQL family domain
│   ├── 1-relational-core/, 3-tooling/, 4-lanes/, 5-runtime/, 9-family/, …
├── 2-mongo-family/     # Document family domain
│   └── 1-core/, 3-tooling/, 4-query/, 6-transport/, 9-family/, …
├── 3-targets/          # Per-target packages (Postgres, SQLite, …)
│   ├── 3-targets/postgres/, 6-adapters/postgres/, 7-drivers/postgres/, …
├── 3-mongo-target/     # Mongo target
└── 3-extensions/       # Extension packs (pgvector, sql-orm-client, …)
```

Within a package, the migration plane and runtime plane are separated as sibling entry points (`exports/runtime.ts`, `exports/migration.ts`); a package straddles planes only by exposing both, never by mixing them in one module.

The mapping is machine-readable in [`architecture.config.json`](../../../architecture.config.json) and enforced by `pnpm lint:deps`, which composes:

- `depcruise --config dependency-cruiser.config.mjs packages` — the core layering rules.
- [`scripts/lint-framework-target-imports.mjs`](../../../scripts/lint-framework-target-imports.mjs) — guards the framework / target boundary specifically.
- [`scripts/lint-app-space-id.mjs`](../../../scripts/lint-app-space-id.mjs) — guards the contract `appSpaceId` constant lives only where it should.

## Reference implementations / sources of truth

| Source | Path | Demonstrates |
|---|---|---|
| Canonical doc | [`docs/architecture docs/Package-Layering.md`](../Package-Layering.md) | The full layering rules, naming conventions, and per-domain mapping. |
| Machine-readable mapping | [`architecture.config.json`](../../../architecture.config.json) | The package → (domain, layer, plane) assignments `lint:deps` consumes. |
| Layering enforcement | [`dependency-cruiser.config.mjs`](../../../dependency-cruiser.config.mjs) (`depcruise`), [`scripts/lint-framework-target-imports.mjs`](../../../scripts/lint-framework-target-imports.mjs), [`scripts/lint-app-space-id.mjs`](../../../scripts/lint-app-space-id.mjs) | The enforcement run by `pnpm lint:deps`. |

## Related ADRs

- [ADR 140 — Package Layering & Target-Family Namespacing](../adrs/ADR%20140%20-%20Package%20Layering%20&%20Target-Family%20Namespacing.md) — the codifying decision for the layering and naming.
- [ADR 005 — Thin Core Fat Targets](../adrs/ADR%20005%20-%20Thin%20Core%20Fat%20Targets.md) — the framing principle the layering operationalises.
- [ADR 150 — Family-Agnostic CLI and Pack Entry Points](../adrs/ADR%20150%20-%20Family-Agnostic%20CLI%20and%20Pack%20Entry%20Points.md) — the entry-point conventions that fall out of the layering.

## Related patterns

- [SPI at the lowest consuming layer](./spi-at-lowest-consuming-layer.md) — the pattern that formalises "interfaces live at the lowest layer that can host them"; it is the operational rule for cross-layer dispatch under this layering.
- [Adapter SPI for target-specific behaviour](./adapter-spi.md) — the layering puts adapters in their own layer; this pattern explains what adapters carry.

## Related rules

- [`.cursor/rules/import-validation.mdc`](../../../.cursor/rules/import-validation.mdc) — the tactical rule for `pnpm lint:deps`.
- [`.cursor/rules/no-barrel-files.mdc`](../../../.cursor/rules/no-barrel-files.mdc) — barrel files defeat the layering by hiding what a package consumes.
- [`.cursor/rules/multi-plane-packages.mdc`](../../../.cursor/rules/multi-plane-packages.mdc) — how a package straddles migration and runtime planes cleanly.
- [`.cursor/rules/multi-plane-entrypoints.mdc`](../../../.cursor/rules/multi-plane-entrypoints.mdc) — how a multi-plane package exposes its entry points without leaking cross-plane code.

## Cautions / common mistakes

- **Cross-plane imports.** A migration-plane module that imports from a runtime-plane module is a structural defect; the planes communicate through artifacts, not code.
- **Upward imports across layers.** Core importing from Tooling (or Tooling importing from Lanes) inverts the dependency direction; the SPI pattern exists to invert dependencies _without_ violating the layering.
- **Cross-domain imports without going through the framework.** A SQL-family package importing from a Mongo-family package leaks family-specific concepts across domains; routes that need to share types should lift them to the framework domain or rethink the cross-domain coupling.
- **A "utils" package that everyone imports.** Shared utilities that consumers from several layers depend on must live at a layer at-or-below every consumer. If there is no such layer, the utility either belongs at the framework Core layer or should be split per-consumer.
