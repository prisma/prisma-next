# Agent Rules Index

Curated rules for agents and developers. Keep narrative in `docs/` and use these rulecards for quick, actionable guidance.

## Canonical home & sync

Every rule has a single canonical home: `.agents/rules/<name>.mdc` — the only git-tracked copy. Rule files must use the `.mdc` extension; the harnesses load `.mdc` only, so a `.md` rule is silently dead (`pnpm lint:rules:symlinks` rejects them). The `.cursor/rules/` and `.claude/rules/` trees are git-ignored presentation mirrors that contain nothing but relative symlinks back into `.agents/rules/`, exactly like the `skills add` model for skills.

```bash
pnpm rules:sync           # Consolidate stray rules + (re)generate the symlink trees
pnpm lint:rules:symlinks  # Fail if a tree is out of sync with canonical (runs in CI)
```

`rules:sync` also runs from `prepare`, so `pnpm install` rebuilds the trees automatically. **Add or edit rules at the canonical path** (`.agents/rules/`); a rule dropped only into `.cursor/rules` is git-ignored and will be lost. Run `pnpm rules:sync` after adding one.

## Rulecard size budget

- **Soft limit**: 100 lines — prefer this for most rulecards
- **Hard limit**: 200 lines — rulecards above this must be **trimmed**, **split**, or have long examples moved to `docs/`

## Footprint monitoring

Track context bloat with:

```bash
pnpm rules:footprint         # Report current footprint
pnpm lint:rules:footprint    # Check against thresholds (fails if exceeded)
```

Thresholds are defined in `.cursor/rules-footprint.config.json`.

Rules below are listed by bare filename; the canonical file is `.agents/rules/<name>` and the same name is symlinked into each presentation tree.

## Always Apply

**Always-apply rules must be short, globally relevant, and stable.** If a rule only applies to a specific area (SQL, CLI, tests, package layout), scope it with `globs` and set `alwaysApply: false`. These are the rules currently carrying `alwaysApply: true`:

- `read-agents-md.mdc` — Read AGENTS.md (onboarding deep dive is optional)
- `schema-driven-architecture.mdc` — Read the architecture overview before writing code
- `doc-maintenance.mdc` — Keep docs/READMEs/rules up‑to‑date
- `no-direct-lockfile-edits.mdc` — Never edit `pnpm-lock.yaml` manually; use `pnpm install`
- `omit-should-in-tests.mdc` — Test descriptions omit "should"
- `no-transient-project-ids-in-code.mdc` — No transient project/milestone/task IDs in code, comments, ADRs, or tests
- `optimize-for-human-time-on-prs.mdc` — Optimize for reviewer time; default to fewer, larger PRs
- `prefer-psl-in-design-docs.mdc` — Prefer PSL snippets when illustrating schema in design docs
- `explicit-opt-in-over-diagnostics.mdc` — Prefer explicit opt-in over emitting diagnostics for unsupported usage
- `namespace-diagnostic-wording.mdc` — User-facing wording for unrecognized/unavailable PSL namespaces
- `avoid-cleavage-in-prose.mdc` — Don't use "cleavage" as a metaphor in prose; prefer split/boundary/distinction
- `git-staging.mdc` — Git commit best practices: stage files explicitly, avoid `git add -A`, sign off

## Testing
- `test-import-patterns.mdc` — Test import patterns (source files, relative paths, don't export for tests)
- `test-file-organization.mdc` — Test file organization (max 500 lines, split by functionality)
- `test-intent-readability.mdc` — Tests must be readable by context (BDD-style grouping)
- `test-database-limitations.mdc` — Test database limitations and patterns
- `typed-contract-in-tests.mdc` — Use typed Contract from fixtures in integration tests
- `no-contract-data-patching-in-tests.mdc` — Never patch raw contract data in tests; use emitted fixtures or a user-facing authoring surface
- `vitest-expect-typeof.mdc` — Type test patterns
- `test-mocking-patterns.mdc` — Test-only assertions and mocking patterns
- `prefer-object-matcher.mdc` — Prefer object matchers over multiple individual expect().toBe() calls
- `sql-orm-client-whole-shape-assertions.mdc` — In sql-orm-client tests, assert the whole result shape (`toEqual`/snapshot) with explicit `select`
- `prefer-to-throw.mdc` — Use `expect().toThrow()` instead of manual try/catch blocks
- `no-tautological-tests.mdc` — Avoid tests that only restate fixture input structure
- `use-ast-factories.mdc` — Use factory functions for creating AST nodes instead of manual object creation
- `use-contract-ir-factories.mdc` — Use factory functions for ContractIR objects in tests
- `use-hash-constructors.mdc` — Use `coreHash()`/`profileHash()` constructors instead of `as never` casts
- `use-timeouts-helper-in-tests.mdc` — Use shared `timeouts` helpers instead of raw timeout numbers
- `tsdown-dist-layout-in-tests.mdc` — Use tsdown `dist/*.d.mts` paths in test tsconfig mappings

## CLI
- `cli-error-handling.mdc` — CLI command error handling patterns
- `cli-e2e-test-patterns.mdc` — CLI e2e test fixture patterns using shared fixture app
- `cli-test-fixture-cleanup.mdc` — Avoid committing generated CLI test fixtures
- `cli-package-exports.mdc` — CLI package export structure and auto-generated export patterns

## Imports & Layering
- `import-validation.mdc` — Layering rules and exceptions
- `no-inline-imports.mdc` — Prohibit inline type imports in source files
- `shared-plane-packages.mdc` — Pattern for creating shared plane packages
- `multi-plane-packages.mdc` — Packages that span multiple planes (shared, migration, runtime)
- `multi-plane-entrypoints.mdc` — Multi-plane entrypoints in a single package
- `directory-layout.mdc` — Directory layout (SQL family vs targets)
- `contract-space-package-layout.mdc` — On-disk layout for packages that expose a contract space
- `resolving-cyclic-dependencies.mdc` — Resolve cyclic dependencies by checking for unused dependencies
- `declarative-config.mdc` — Prefer declarative configuration over hardcoded logic
- `architecture.config.json` — Domain/Layer/Plane map

## MongoDB
- `mongo-no-obsolete-commands.mdc` — Use `aggregate` instead of obsolete `find`/`findOne`
- `mongodb-memory-server-setup.mdc` — MMS version pinning, vitest timeouts, and new-package checklist

## SQL & Query Patterns
- `query-patterns.mdc` — Query DSL patterns
- `postgres-lateral-patterns.mdc` — LATERAL/json_agg patterns
- `sql-types-imports.mdc` — SQL types import path (use @prisma-next/sql-contract/types)

## TypeScript & Typing
- `typescript-patterns.mdc` — TS patterns index (short)
- `jsdoc-line-width.mdc` — JSDoc prose: no manual ~80-column wraps; avoid orphaned doc blocks
- `generic-parameters.mdc` — Generic parameter defaults
- `interface-factory-pattern.mdc` — Interface-based design + factories
- `type-predicates.mdc` — Replace blind casts with type predicates
- `no-bare-casts.mdc` — No bare `as` in production code; use `blindCast`/`castAs`
- `as-contract-cast-smell.mdc` — `as Contract` is a smell; validate JSON with `validateContract`
- `arktype-usage.mdc` — Arktype usage guidelines
- `use-pathe-for-paths.mdc` — Prefer `pathe` over `node:path` in TypeScript files
- `use-if-defined.mdc` — Use the `ifDefined` helper for conditional object properties
- `type-extraction-from-contract.mdc` — Extracting types from contracts
- `object-hasown.mdc` — Use `Object.hasOwn()` instead of `hasOwnProperty()`
- `prefer-assertions-over-defensive-checks.mdc` — Prefer assertions over defensive checks (avoid schema validation redundancy)

## Refactoring
- `modular-refactoring-patterns.mdc` — Split monoliths into modules
- `moving-packages.mdc` — Guidelines for moving packages and updating relative paths
- `no-barrel-files.mdc` — Avoid barrels
- `no-backward-compatibility.mdc` — No backward-compat shims; update call sites instead

## Architecture
- `adr-writing.mdc` — ADR writing guidelines (clarity, flow, examples)
- `adr-examples-must-match-code.mdc` — ADR examples should be copy/pasteable and reflect real APIs
- `contract-default-values.mdc` — Validate emitted column defaults
- `config-validation-and-normalization.mdc` — Config validation and normalization patterns using Arktype
- `control-plane-descriptors.mdc` — Control plane descriptor pattern (Control*Descriptor types, driver requirement)
- `family-instance-domain-actions.mdc` — Family instance domain actions (inline core logic, import helper functions)
- `storage-type-hooks.mdc` — Codec-owned storage type hooks (avoid enum fields in shared IR)
- `capabilities-ownership.mdc` — Capabilities are adapter-reported; contracts declare requirements
- `tsdown-config-package-source-only.mdc` — Keep `@prisma-next/tsdown` exports source-only (no `.js` workaround files)

## Git, CI & workflow
- `no-target-branches.mdc` — Don't branch on target; use adapters
- `no-pull-request-target.mdc` — Never add `pull_request_target` to GitHub Actions workflows
- `no-linear-sub-issues.mdc` — Never create Linear sub-issues; use projects/milestones/relations/labels

## Docs & review writing
- `mermaid-compat.mdc` — Mermaid diagram syntax that renders on GitHub
- `review-scope-overrides.mdc` — When writing review artifacts, honor user-specified base branches
- `cursor-markdown-file-links.mdc` — Path-only repo-relative links in review markdown (Cursor does not resolve `:line` in link targets)

Notes
- Prefer short rulecards with Do/Don’t + examples; link to detailed docs in `docs/`.
- Keep `alwaysApply` minimal—default to scoped rules with `globs` in frontmatter.
