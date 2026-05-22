# Design notes: init-canonical-layout

> Synthesized design document. Captures the settled design for moving `prisma-next init`'s default scaffold from `prisma/` to the canonical `src/prisma/` layout, consolidating the layout convention behind a single named constant, and adding a re-init safety net for users on the legacy layout.

## Principles this design serves

- **One fact, one home.** The canonical project-layout root is a single concept; expressing it in one named place lets every consumer derive from that fact instead of restating it.
- **Bug-class elimination over local patch.** Patching only the immediate symptom (`defaultSchemaPath`) leaves the structural cause (the same fact declared in N places that have to be kept in sync) intact. The fix collapses the declarations.
- **User-recoverable failure modes.** When a user-visible default changes, the migration path should be detectable and surfaced — even when we cannot safely automate the cleanup.
- **Application scaffolding ≠ contract-space package layout.** ADR 212 carves out a distinct layout for contract-space packages (`src/contract.*` directly, no `prisma/` subdir); this project's consolidation stays scoped to application scaffolding and does not brush the carve-out.

## The model

### The canonical project-layout root

A single constant `DEFAULT_PRISMA_DIR = 'src/prisma'` lives in `packages/1-framework/1-core/config/src/config-types.ts`, alongside `DEFAULT_CONTRACT_OUTPUT`. Three call sites that previously hardcoded the layout derive from it:

- `DEFAULT_CONTRACT_OUTPUT` is re-expressed as `${DEFAULT_PRISMA_DIR}/contract.json` (was hardcoded `'src/prisma/contract.json'`).
- `defaultSchemaPath(authoring)` in `packages/1-framework/3-tooling/cli/src/commands/init/templates/code-templates.ts` returns `${DEFAULT_PRISMA_DIR}/contract.${ext}` (was hardcoded `prisma/contract.${ext}` — the bug).
- The runtime fallback in `packages/1-framework/3-tooling/cli/src/utils/command-helpers.ts:102` derives from `DEFAULT_CONTRACT_OUTPUT` (transitively `DEFAULT_PRISMA_DIR`) (was hardcoded `'src/prisma/contract.json'`).

`init.ts` already derives `db.ts`'s location from `dirname(schemaPath)`, so `db.ts` follows the schema automatically once `defaultSchemaPath` returns the canonical root.

### Re-init detect-and-warn

When `init --reinit` runs and the project has co-located legacy `prisma/contract.{prisma,ts,json,d.ts}` or `prisma/db.ts` files alongside the now-default `src/prisma/...` scaffold, `init` emits a structured warning that names the orphaned files and tells the user how to clean up manually. **Files are not deleted.**

The literal `'prisma'` lives inline in the new branch in `init.ts` with a one-line comment naming it as the pre-fix default. It is deliberately not promoted to a named constant — giving the legacy value module-level semantic weight would invite drift in the wrong direction.

### Touchpoint sweep

Three stale references to `prisma/contract.prisma` not covered by the constant introduction:

- `packages/1-framework/3-tooling/cli/src/commands/init/index.ts:75` — `--schema-path` flag help text ("default: prisma/contract.prisma").
- `packages/1-framework/3-tooling/cli/src/commands/contract-infer.ts:107` — usage example writing to `./prisma/contract.prisma`.
- `packages/1-framework/3-tooling/cli/src/commands/init/hygiene-gitattributes.ts:23, 62` — explanatory comments.

All become "src/prisma/..." text updates in the same PR.

## Alternatives considered

- **Fix A (ticket's stated fix) — patch `defaultSchemaPath` alone, keep the runtime fallback as a "safety net."** Rejected because it leaves two-facts-that-happen-to-agree, the exact typology that produced this bug. The third call site (`command-helpers.ts:102`) was not enumerated in the ticket and would compound the drift surface.
- **Fix B shape 1 — derive scaffold root from `dirname(DEFAULT_CONTRACT_OUTPUT)`.** Rejected because `init` doesn't care about contract.json output paths — it cares about scaffold roots. Deriving via `dirname()` expresses the dependency awkwardly and a future contributor renaming `DEFAULT_CONTRACT_OUTPUT`'s basename misses that init scaffolds against the dirname.
- **Re-init option (a) — release-note manual cleanup, no detection.** Rejected because users who hit the bug will re-run `init --reinit` to recover and every one of them has to figure out the dual-layout cleanup unaided.
- **Re-init option (c) — extend `findStaleArtefacts` to delete the legacy `prisma/` files when only the recognised init scaffold is present.** Rejected as over-engineering for a one-time migration window: the deletion path needs defenses against false positives, and the warning-only approach is recoverable by the user with one command.
- **Two-slice project (consolidation as slice 1, detect-and-warn as slice 2).** Rejected because detect-and-warn is meaningful only against the new default; sequencing separately ships a known-failure-mode intermediate state to `main`.
- **Coordinate with `@prisma-next/agent-skill` cluster.** Originally an open coordination question; **moot** — the cluster was deleted from the substrate, so there is nothing to coordinate with.

## Open questions

None blocking. The design is settled.

## References

- Project spec: [`./spec.md`](./spec.md)
- Project plan: [`./plan.md`](./plan.md)
- Design decisions log: [`./design-decisions.md`](./design-decisions.md)
- Linear: [TML-2532](https://linear.app/prisma-company/issue/TML-2532)
- ADR 212 — Contract spaces (carve-out, unaffected): [`docs/architecture docs/adrs/ADR 212 - Contract spaces.md`](../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md)
- Layout rule (carve-out, unaffected): [`.cursor/rules/contract-space-package-layout.mdc`](../../.cursor/rules/contract-space-package-layout.mdc)
