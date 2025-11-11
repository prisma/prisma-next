# Agents TL;DR — Prisma Next

Welcome. This is a contract‑first, agent‑friendly data layer. Start here for the shortest path to context, rules, and commands you’ll actually use.

## Start Here
- Architecture Overview: `docs/Architecture Overview.md`
- MVP Spec: `docs/MVP-Spec.md`
- Testing Guide: `docs/Testing Guide.md`
- Rules Index: `.cursor/rules/README.md`
- Repo Map & Layering: `architecture.config.json`

## Golden Rules
- Use pnpm and local scripts (not ad‑hoc `tsc`, `jest`): see `.cursor/rules/use-correct-tools.mdc`.
- Don’t branch on target; use adapters: `.cursor/rules/no-target-branches.mdc`.
- Keep tests concise; omit “should”: `.cursor/rules/omit-should-in-tests.mdc`.
- Keep docs current (READMEs, rules, links): `.cursor/rules/doc-maintenance.mdc`.
- Prefer links to canonical docs over long comments.

## Common Commands
```bash
pnpm build                 # Build via Turbo
pnpm test:packages         # Run package tests
pnpm test:e2e              # Run e2e tests
pnpm test:integration      # Run integration tests
pnpm test:all              # Run all tests (packages + examples + integration + e2e)
pnpm coverage:packages     # Coverage (packages only)
pnpm lint:deps             # Validate layering/imports
cd examples/todo-app && pnpm demo  # End-to-end demo
```

## Boundaries & Safety Rails
- No backward‑compat shims; update call sites instead: `.cursor/rules/no-backward-compatibility.md`.
- Package layering is enforced; fix violations rather than bypassing: see `scripts/check-imports.mjs` and `.cursor/rules/import-validation.mdc`.
- Capability‑gated features (e.g., includeMany, returning) must be enabled in contract capabilities.

## Quick Context
- Contract‑first: we emit `contract.json` and `contract.d.ts` only; queries compile at runtime.
- Modular packages with domain/layer/plane guardrails: `architecture.config.json`.
- Use Arktype for validation; extract types via `.infer` where needed: `.cursor/rules/arktype-usage.mdc`.
- Directory layout: the entire SQL target family (all layers and planes) lives under `packages/sql/**`. The top-level `packages/targets/**` is reserved for concrete target extension packs (e.g., Postgres, MySQL), not for family internals.

## Frequent Tasks
- Add SQL operation: see `docs/briefs/complete` and `.cursor/plans/add-sql-operation.md` (template).
- Split monolith into modules: `.cursor/plans/split-into-modules.md`.
- Fix import violation: `.cursor/plans/fix-import-violation.md`.

## Ask First
- Significant refactors to rule scope (`alwaysApply`) or architecture docs.
- Changes that affect demo, examples, or CI.

That’s it—follow links above for deep dives.
