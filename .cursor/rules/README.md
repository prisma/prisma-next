# Cursor Rules Index

Curated rules for agents and developers. Keep narrative in `docs/` and use these rulecards for quick, actionable guidance.

## Always Apply (curated)
- `.cursor/rules/use-correct-tools.mdc` — Use configured tools and scripts
- `.cursor/rules/no-target-branches.mdc` — Don’t branch on target; use adapters
- `.cursor/rules/omit-should-in-tests.mdc` — Test descriptions omit “should”
- `.cursor/rules/doc-maintenance.mdc` — Keep docs/READMEs/rules up‑to‑date

## Testing
- `.cursor/rules/testing-guide.mdc` — Testing guide pointers and patterns
- `.cursor/rules/vitest-expect-typeof.mdc` — Type test patterns
- `.cursor/rules/prefer-object-matcher.mdc` — Prefer object matchers over multiple individual expect().toBe() calls
- `.cursor/rules/use-ast-factories.mdc` — Use factory functions for creating AST nodes instead of manual object creation
- `.cursor/rules/cli-error-handling.mdc` — CLI command error handling patterns (throw errors, don't call process.exit)
- `.cursor/rules/cli-e2e-test-patterns.mdc` — CLI e2e test fixture patterns using shared fixture app

## Imports & Layering
- `.cursor/rules/import-validation.mdc` — Layering rules and exceptions
- `.cursor/rules/shared-plane-packages.mdc` — Pattern for creating shared plane packages
- `.cursor/rules/multi-plane-packages.mdc` — Packages that span multiple planes (shared, migration, runtime)
- `.cursor/rules/declarative-config.mdc` — Prefer declarative configuration over hardcoded logic
- `architecture.config.json` — Domain/Layer/Plane map

## SQL & Query Patterns
- `.cursor/rules/query-patterns.mdc` — Query DSL patterns
- `.cursor/rules/postgres-lateral-patterns.mdc` — LATERAL/json_agg patterns
- `.cursor/rules/include-many-patterns.mdc` — includeMany type inference

## TypeScript & Typing
- `.cursor/rules/typescript-patterns.mdc` — TS & architecture patterns
- `.cursor/rules/arktype-usage.mdc` — Arktype usage guidelines
- `.cursor/rules/type-extraction-from-contract.mdc` — Extracting types from contracts
- `.cursor/rules/no-inline-imports.mdc` — Prohibit inline type imports in source files
- `.cursor/rules/object-hasown.mdc` — Use Object.hasOwn() instead of hasOwnProperty()

## Refactoring
- `.cursor/rules/modular-refactoring-patterns.mdc` — Split monoliths into modules
- `.cursor/rules/moving-packages.mdc` — Guidelines for moving packages and updating relative paths
- `.cursor/rules/no-barrel-files.mdc` — Avoid barrels

## Testing
- `.cursor/rules/use-ast-factories.mdc` — Use factory functions for AST nodes in tests
- `.cursor/rules/use-contract-ir-factories.mdc` — Use factory functions for ContractIR objects in tests

## Architecture
- `.cursor/rules/schema-driven-architecture.mdc` — Read architecture overview first
- `.cursor/rules/contract-normalization-responsibilities.mdc` — Responsibilities
- `.cursor/rules/adapter-capability-declaration.mdc` — Adapter capability declaration (manifest + code)
- `.cursor/rules/config-validation-and-normalization.mdc` — Config validation and normalization patterns using Arktype

Notes
- Prefer short rulecards with Do/Don’t + examples; link to detailed docs in `docs/`.
- Keep `alwaysApply` minimal—default to scoped rules with `appliesTo` in frontmatter.
