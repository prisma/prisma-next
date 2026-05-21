# Summary

Move `prisma-next init`'s default scaffold from `prisma/` to the canonical `src/prisma/` layout — consolidating the layout convention behind one named constant the three call sites derive from, and adding a `--reinit` warning so users on the legacy layout can recover cleanly.

# Purpose

`prisma-next init` should scaffold the same on-disk shape every other surface in the framework already treats as canonical (`src/prisma/...`), with the canonical layout root expressed in a single named place so the three call sites that depend on it cannot drift apart again.

# At a glance

**Before.** `prisma-next init --target postgres --authoring psl` scaffolds:

```text
my-app/
├── prisma-next.config.ts
├── prisma/
│   ├── contract.prisma
│   └── db.ts
```

— while `examples/prisma-next-demo`, `DEFAULT_CONTRACT_OUTPUT`, and ~30 docs/tests all speak `src/prisma/`. Three call sites independently hardcode the layout root and the init one disagrees.

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

— matching the demo and the runtime fallback. One named constant (`DEFAULT_PRISMA_DIR`) lives in `config-types.ts`; init's `defaultSchemaPath`, `DEFAULT_CONTRACT_OUTPUT`, and the runtime fallback in `command-helpers.ts` all derive from it. A `--reinit` user with legacy `prisma/` files sees a structured warning naming the orphaned files.

# Scope

## In scope

- Introduce `DEFAULT_PRISMA_DIR` constant; rewire `DEFAULT_CONTRACT_OUTPUT`, `defaultSchemaPath`, and the `command-helpers.ts` runtime fallback to derive from it.
- Update `init`'s precondition phase to detect legacy `prisma/contract.{prisma,ts,json,d.ts}` + `prisma/db.ts` co-located with the new `src/prisma/` scaffold under `--reinit`, and emit a structured warning naming the orphaned files.
- Sweep stale references: `index.ts:75` (`--schema-path` flag help text), `contract-infer.ts:107` (example), `hygiene-gitattributes.ts` (comments).
- Update the init test surface (~6 files) and `command-helpers.test.ts` to assert against the canonical default and the new constant.
- Add a test asserting the detect-and-warn path fires on the legacy layout.

## Non-goals

- Deleting legacy `prisma/` content during `--reinit`. Surface via warning only.
- Re-promoting the `'prisma'` legacy literal to a named constant. Inlined with a comment.
- Detecting non-canonical project shapes (Deno projects with no `src/`, monorepo package consumers, brownfield layouts). `--schema-path` continues to handle those.
- Touching the contract-space-package layout (ADR 212 carve-out). Verified non-interfering.
- Coordinating with the `@prisma-next/agent-skill` cluster. Cluster has been removed from the substrate (see D4 in `design-decisions.md`).

# Approach

The substantive code change is small (one new constant, three call-site rewires, one new precondition branch in `init.ts`, six text/comment updates) but the test surface is wider (~6 init test files + the `command-helpers` fallback test + a new `--reinit` warning test).

The consolidation, the user-visible default change, and the re-init safety net ship in one PR because: (a) detect-and-warn is meaningful only against the new default, (b) the touchpoint sweep follows mechanically from the constant introduction, and (c) any partial shipping order leaves `main` in a known-inconsistent state where the project tells different stories about the default layout.

See `design-notes.md` for the principles, the model, alternatives considered.

# Project Definition of Done

- [ ] **PDoD1.** `pnpm prisma-next init --yes --target postgres --authoring psl` (and the mongo + typescript variants) in a fresh directory scaffolds files under `src/prisma/...`, matching `examples/prisma-next-demo`'s on-disk shape.
- [ ] **PDoD2.** Exactly one place in the codebase declares `'src/prisma'` as the layout root (`DEFAULT_PRISMA_DIR` in `config-types.ts`); `DEFAULT_CONTRACT_OUTPUT`, `defaultSchemaPath`, and the `command-helpers.ts` runtime fallback all derive from it.
- [ ] **PDoD3.** `init --reinit` against a project with legacy `prisma/` content emits the structured warning naming the orphaned files; legacy files are not deleted.
- [ ] **PDoD4.** All init + `command-helpers` tests pass against the new defaults.
- [ ] **PDoD5.** `pnpm lint:deps` + `pnpm test:packages` green.
- [ ] **PDoD6.** Manual repro from the Linear ticket: fresh `init`, compare with `examples/prisma-next-demo/src/prisma/` — same shape.
- [ ] **PDoD7.** PR merged; Linear TML-2532 closed; mandatory final retro complete (output landed in canonical / project-context / ADR).
- [ ] **PDoD8.** `projects/init-canonical-layout/` deleted; no repo-wide references remain.
- [ ] **PDoD9.** Linear Project `[PN] Onboarding Audit` updated (TML-2532 marked Done; project itself stays open — it covers other audit tickets).

# Functional Requirements

- **FR1.** `defaultSchemaPath('psl')` returns `src/prisma/contract.prisma`; `defaultSchemaPath('typescript')` returns `src/prisma/contract.ts`. Both derive from `DEFAULT_PRISMA_DIR`.
- **FR2.** `DEFAULT_CONTRACT_OUTPUT` continues to evaluate to `'src/prisma/contract.json'`, but expressed as `${DEFAULT_PRISMA_DIR}/contract.json` (single source of truth).
- **FR3.** The runtime fallback in `command-helpers.ts:102` derives from `DEFAULT_CONTRACT_OUTPUT` (transitively `DEFAULT_PRISMA_DIR`) rather than the current hardcoded literal.
- **FR4.** On `init --reinit`, when any of `prisma/contract.{prisma,ts,json,d.ts}` or `prisma/db.ts` exist co-located with the new `src/prisma/...` scaffold, `init` adds a structured warning to its output naming the orphaned files and the cleanup command.
- **FR5.** Stale-text sweep: `index.ts:75` help text, `contract-infer.ts:107` example, `hygiene-gitattributes.ts` comments all read `src/prisma/...`.
- **FR6.** `db.ts` placement remains derived from `dirname(schemaPath)` (already correct in `init.ts`; verified).

# Non-Functional Requirements

- **NFR1.** No new dependencies. Pure refactor + one new constant + one new precondition branch.
- **NFR2.** Existing `init` exit-code contract preserved. The new warning uses the existing `warnings` channel; no new exit code introduced.
- **NFR3.** `init` remains atomic: the new detect-and-warn branch runs in the precondition phase, so warnings surface before any file write.

# Constraints + Assumptions

- **A1.** `init` scaffolds *application* projects only; contract-space packages (extensions, monorepo extension packages — ADR 212) intentionally use a different layout and never go through `init`. Verified by Grep: `init/` has zero contract-space concepts, and contract-space packages set `output: 'src/contract.json'` explicitly so `DEFAULT_CONTRACT_OUTPUT` never affects them.
- **A2.** The cross-package dependency (init's templates importing from `@prisma-next/.../config`) is already present. Verified — `config` is a foundational package consumed by `cli`.
- **A3.** The `'prisma'` literal in the detect-and-warn branch is a one-time migration value; future contributors changing it would have to remember it's a legacy check. Mitigated by an inline comment.
- **A4.** Install base is small (pre-1.0 OSS-stage); the cost of one warning branch in `init.ts` is much smaller than the support cost of users re-initing into a confusing dual-layout state.

# Open Questions

None blocking. The design is settled; see `design-notes.md` § Open questions.

# References

- Linear: [TML-2532](https://linear.app/prisma-company/issue/TML-2532) (parent Linear Project: `[PN] Onboarding Audit`)
- Design notes: [`./design-notes.md`](./design-notes.md)
- Design decisions log: [`./design-decisions.md`](./design-decisions.md)
- Bug source: `packages/1-framework/3-tooling/cli/src/commands/init/templates/code-templates.ts:12-17`
- Canonical fact (today): `packages/1-framework/1-core/config/src/config-types.ts:43`
- Runtime fallback (third call site): `packages/1-framework/3-tooling/cli/src/utils/command-helpers.ts:102`
- Demo shape: `examples/prisma-next-demo/src/prisma/`
- ADR 212 (carve-out, unaffected): [`docs/architecture docs/adrs/ADR 212 - Contract spaces.md`](../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md)
