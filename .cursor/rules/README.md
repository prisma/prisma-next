# Cursor Rules Index

Curated rules for agents and developers. Keep narrative in `docs/` and use these rulecards for quick, actionable guidance.

## Rulecard size budget

- **Soft limit**: 100 lines — prefer this for most rulecards
- **Hard limit**: 200 lines — rulecards above this must be **trimmed**, **split**, or have long examples moved to `docs/`

## Always Apply (minimal)

**Always-apply rules must be short, globally relevant, and stable.** If a rule only applies to a specific area (SQL, CLI, tests, package layout), scope it with `globs` and set `alwaysApply: false`.

- `.cursor/rules/git-staging.mdc` — Git staging/commit best practices (stage explicitly, keep commits focused)
- `.cursor/rules/use-correct-tools.mdc` — Use configured tools and scripts
- `.cursor/rules/doc-maintenance.mdc` — Keep docs/READMEs/rules up‑to‑date
- `.cursor/rules/read-agents-md.mdc` — Read AGENTS.md (onboarding deep dive is optional)
- `.cursor/rules/schema-driven-architecture.mdc` — Read architecture overview before writing code
- `.cursor/rules/omit-should-in-tests.mdc` — Test descriptions omit "should"

## Testing
- `.cursor/rules/testing-guide.mdc` — Testing guide pointers and patterns
- `.cursor/rules/test-import-patterns.mdc` — Test import patterns (source files, relative paths, don't export for tests)
- `.cursor/rules/test-file-organization.mdc` — Test file organization (max 500 lines, split by functionality)
- `.cursor/rules/test-database-limitations.mdc` — Test database limitations and patterns
- `.cursor/rules/test-fixture-typechecking.mdc` — Exclude test fixture config files from typechecking
- `.cursor/rules/typed-contract-in-tests.mdc` — Use typed Contract from fixtures in integration tests
- `.cursor/rules/vitest-expect-typeof.mdc` — Type test patterns
- `.cursor/rules/prefer-object-matcher.mdc` — Prefer object matchers over multiple individual expect().toBe() calls
- `.cursor/rules/use-ast-factories.mdc` — Use factory functions for creating AST nodes instead of manual object creation
- `.cursor/rules/use-contract-ir-factories.mdc` — Use factory functions for ContractIR objects in tests
- `.cursor/rules/cli-error-handling.mdc` — CLI command error handling patterns
- `.cursor/rules/cli-e2e-test-patterns.mdc` — CLI e2e test fixture patterns using shared fixture app
- `.cursor/rules/cli-package-exports.mdc` — CLI package export structure and import patterns

## Imports & Layering
- `.cursor/rules/import-validation.mdc` — Layering rules and exceptions
- `.cursor/rules/shared-plane-packages.mdc` — Pattern for creating shared plane packages
- `.cursor/rules/multi-plane-packages.mdc` — Packages that span multiple planes (shared, migration, runtime)
- `.cursor/rules/multi-plane-entrypoints.mdc` — Multi-plane entrypoints in a single package
- `.cursor/rules/directory-layout.mdc` — Directory layout (SQL family vs targets)
- `.cursor/rules/resolving-cyclic-dependencies.mdc` — How to resolve cyclic dependencies by checking for unused dependencies
- `.cursor/rules/declarative-config.mdc` — Prefer declarative configuration over hardcoded logic
- `architecture.config.json` — Domain/Layer/Plane map

## SQL & Query Patterns
- `.cursor/rules/query-patterns.mdc` — Query DSL patterns
- `.cursor/rules/postgres-lateral-patterns.mdc` — LATERAL/json_agg patterns
- `.cursor/rules/include-many-patterns.mdc` — includeMany type inference
- `.cursor/rules/sql-types-imports.mdc` — SQL types import path (use @prisma-next/sql-contract/types)

## TypeScript & Typing
- `.cursor/rules/typescript-patterns.mdc` — TS patterns index (short)
- `.cursor/rules/generic-parameters.mdc` — Generic parameter defaults
- `.cursor/rules/interface-factory-pattern.mdc` — Interface-based design + factories
- `.cursor/rules/type-predicates.mdc` — Replace blind casts with type predicates
- `.cursor/rules/test-mocking-patterns.mdc` — Test-only assertions and mocking patterns
- `.cursor/rules/arktype-usage.mdc` — Arktype usage guidelines
- `.cursor/rules/type-extraction-from-contract.mdc` — Extracting types from contracts
- `.cursor/rules/validate-contract-usage.mdc` — validateContract usage pattern (requires fully-typed contract type)
- `.cursor/rules/no-inline-imports.mdc` — Prohibit inline type imports in source files
- `.cursor/rules/object-hasown.mdc` — Use Object.hasOwn() instead of hasOwnProperty()
- `.cursor/rules/prefer-assertions-over-defensive-checks.mdc` — Prefer assertions over defensive checks (avoid schema validation redundancy)

## Refactoring
- `.cursor/rules/modular-refactoring-patterns.mdc` — Split monoliths into modules
- `.cursor/rules/moving-packages.mdc` — Guidelines for moving packages and updating relative paths
- `.cursor/rules/no-barrel-files.mdc` — Avoid barrels
- `.cursor/rules/no-backward-compatibility.md` — No backward-compat shims; update call sites instead

## Architecture
- `.cursor/rules/schema-driven-architecture.mdc` — Read architecture overview first
- `.cursor/rules/contract-normalization-responsibilities.mdc` — Contract normalization responsibilities
- `.cursor/rules/config-validation-and-normalization.mdc` — Config validation and normalization patterns using Arktype
- `.cursor/rules/control-plane-descriptors.mdc` — Control plane descriptor pattern (Control*Descriptor types, driver requirement)
- `.cursor/rules/family-instance-domain-actions.mdc` — Family instance domain actions (inline core logic, import helper functions)

Notes
- Prefer short rulecards with Do/Don’t + examples; link to detailed docs in `docs/`.
- Keep `alwaysApply` minimal—default to scoped rules with `globs` in frontmatter.
