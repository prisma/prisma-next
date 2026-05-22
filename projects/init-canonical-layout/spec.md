# Summary

Move `prisma-next init`'s default scaffold from `prisma/` to the canonical `src/prisma/` layout — consolidating the layout convention behind one named constant the call sites derive from.

# Purpose

`prisma-next init` should scaffold the same on-disk shape every other surface in the framework already treats as canonical (`src/prisma/...`), with the canonical layout root expressed in a single named place so the call sites that depend on it cannot drift apart again.

# At a glance

**Before.** `prisma-next init --target postgres --authoring psl` scaffolds:

```text
my-app/
├── prisma-next.config.ts
├── prisma/
│   ├── contract.prisma
│   └── db.ts
```

— while `examples/prisma-next-demo`, config normalization defaults, and ~30 docs/tests all speak `src/prisma/`. Multiple call sites independently hardcode the layout root and the init one disagrees.

**After.**

```text
my-app/
├── prisma-next.config.ts
└── src/
    └── prisma/
        ├── contract.prisma
        ├── contract.json   (after `pnpm prisma-next contract emit`)
        ├── contract.d.ts   (after emit)
        └── db.ts
```

— matching the demo. One named constant (`DEFAULT_CONTRACT_SOURCE_DIR`) lives in `config-types.ts`; init's `defaultSchemaPath` derives from it. Legacy `prisma/` content is not handled by init — users on non-default layouts supply `--schema-path`.

# Scope

## In scope

- Introduce `DEFAULT_CONTRACT_SOURCE_DIR` constant; rewire `defaultSchemaPath` and config normalization to derive from it.
- Remove the `resolveContractPath` static fallback; throw a typed error when `config.contract?.output` is undefined.
- Sweep stale references: `index.ts:75` (`--schema-path` flag help text), `contract-infer.ts:107` (example), `hygiene-gitattributes.ts` (comments).
- Update the init test surface (~6 files) and `command-helpers.test.ts` to assert against the canonical default and the new constant.

## Non-goals

- Legacy `prisma/` detect-and-warn or any compatibility code for past init defaults. Init declares the current canonical layout and accepts user-supplied overrides via `--schema-path`; it does not maintain detection of past defaults (see `design-decisions.md` § D5).
- Deleting or moving legacy `prisma/` content during `--force` re-init.
- Detecting non-canonical project shapes (Deno projects with no `src/`, monorepo package consumers, brownfield layouts). `--schema-path` continues to handle those.
- Touching the contract-space-package layout (ADR 212 carve-out). Verified non-interfering.
- Coordinating with the `@prisma-next/agent-skill` cluster. Cluster has been removed from the substrate (see D4 in `design-decisions.md`).

# Approach

The substantive code change is small (one new constant, call-site rewires, help-text derivation, six text/comment updates) but the test surface is wider (~6 init test files + the `command-helpers` throws test).

The consolidation and the user-visible default change ship in one PR because any partial shipping order leaves `main` in a known-inconsistent state where the project tells different stories about the default layout.

See `design-notes.md` for the principles, the model, alternatives considered.

# Project Definition of Done

- [ ] **PDoD1.** `pnpm prisma-next init --yes --target postgres --authoring psl` (and the mongo + typescript variants) in a fresh directory scaffolds files under `src/prisma/...`, matching `examples/prisma-next-demo`'s on-disk shape.
- [ ] **PDoD2.** Exactly one place in the codebase declares `'src/prisma'` as the layout root (`DEFAULT_CONTRACT_SOURCE_DIR` in `config-types.ts`); `defaultSchemaPath` and help text derive from it; no independent literal declarations remain.
- [ ] **PDoD4.** All init + `command-helpers` tests pass against the new defaults.
- [ ] **PDoD5.** `pnpm lint:deps` + `pnpm test:packages` green.
- [ ] **PDoD6.** Manual repro from the Linear ticket: fresh `init`, compare with `examples/prisma-next-demo/src/prisma/` — same shape.
- [ ] **PDoD7.** PR merged; Linear TML-2532 closed; mandatory final retro complete (output landed in canonical / project-context / ADR).
- [ ] **PDoD8.** `projects/init-canonical-layout/` deleted; no repo-wide references remain.
- [ ] **PDoD9.** Linear Project `[PN] Onboarding Audit` updated (TML-2532 marked Done; project itself stays open — it covers other audit tickets).

# Functional Requirements

- **FR1.** `defaultSchemaPath('psl')` returns `src/prisma/contract.prisma`; `defaultSchemaPath('typescript')` returns `src/prisma/contract.ts`. Both derive from `DEFAULT_CONTRACT_SOURCE_DIR`.
- **FR2.** Config normalization for the in-memory `typescriptContract()` provider falls back to `${DEFAULT_CONTRACT_SOURCE_DIR}/contract.json` when no output is supplied (in-memory-only narrow purpose).
- **FR3.** `resolveContractPath` throws a typed error when `config.contract?.output` is undefined (no static fallback).
- **FR5.** Stale-text sweep: `index.ts:75` help text derives from `defaultSchemaPath('psl')`; `contract-infer.ts:107` example and `hygiene-gitattributes.ts` comments use abstract phrasing or constant references.
- **FR6.** `db.ts` placement remains derived from `dirname(schemaPath)` (already correct in `init.ts`; verified).

# Non-Functional Requirements

- **NFR1.** No new dependencies. Pure refactor + one renamed constant + help-text derivation.
- **NFR2.** Existing `init` exit-code contract preserved.
- **NFR3.** `init` remains atomic: preconditions surface before any file write.

# Constraints + Assumptions

- **A1.** `init` scaffolds *application* projects only; contract-space packages (extensions, monorepo extension packages — ADR 212) intentionally use a different layout and never go through `init`. Verified by Grep: `init/` has zero contract-space concepts, and contract-space packages set `output` explicitly.
- **A2.** The cross-package dependency (init's templates importing from `@prisma-next/.../config`) is already present. Verified — `config` is a foundational package consumed by `cli`.

# Open Questions

None blocking. The design is settled; see `design-notes.md` § Open questions.

# References

- Linear: [TML-2532](https://linear.app/prisma-company/issue/TML-2532) (parent Linear Project: `[PN] Onboarding Audit`)
- Design notes: [`./design-notes.md`](./design-notes.md)
- Design decisions log: [`./design-decisions.md`](./design-decisions.md)
- Bug source: `packages/1-framework/3-tooling/cli/src/commands/init/templates/code-templates.ts:12-17`
- Canonical fact (today): `packages/1-framework/1-core/config/src/config-types.ts:43`
- Demo shape: `examples/prisma-next-demo/src/prisma/`
- ADR 212 (carve-out, unaffected): [`docs/architecture docs/adrs/ADR 212 - Contract spaces.md`](../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md)
