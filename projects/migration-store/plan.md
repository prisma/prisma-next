# migration-store — Plan

**Spec:** `projects/migration-store/spec.md`
**Tracking issue:** [TML-2709](https://linear.app/prisma-company/issue/TML-2709)
**Linear Project:** [\[PN\] May: Migrations](https://linear.app/prisma-company/project/d16ebd98-535e-440b-9a10-076f55468412)
**External dependency:** [TML-2697](https://linear.app/prisma-company/issue/TML-2697) (PR #603) — this branch is stacked on its head.

## At a glance

Two slices in a stack. Slice 1 is the keystone: it separates **build** from **judge** in the contract-space model and re-points every consumer that relied on load-time throws, behaviour-preserving. Slice 2 then adopts the model in the three read commands that aren't on the aggregate yet, deleting their hand-rolled disk I/O. The cut is forced by an atomicity constraint, not preference: the self-edge throw can only be removed where it is re-acquired, and the `loadContractSpaceAggregate` signature change is atomic with apply/verify, so the whole "model becomes tolerant + integrity becomes a query" knot is one reviewable unit.

## Composition

### Stack (deliver in order)

1. **Slice `tolerant-queryable-aggregate`** — Linear: [TML-2715](https://linear.app/prisma-company/issue/TML-2715)
   - **Outcome:** `ContractSpaceAggregate` loads tolerantly from disk alone (`{ migrationsDir, deserializeContract }`), exposes raw `packages` + user-authored `refs` + nullable `headRef` per space, lazy memoised `graph()` / `contract()` facets, and query methods (`listSpaces` / `hasSpace` / `space` / `spaces`). `reconstructGraph` is pure (no self-edge throw); `readMigrationsDir` is tolerant (no throw on disk content). Integrity is a `checkIntegrity()` query returning the full `IntegrityViolation[]`. The consumers that previously gated on load-time throws — `migration check`, the apply path, `db verify`, and `migration status` / `show` — gate explicitly via `checkIntegrity()` with behaviour preserved (modulo intended self-edge tolerance and `check` reporting all violations at once).
   - **Builds on:** TML-2697 (PR #603) head — `enumerateMigrationSpaces` / ref-handling surface.
   - **Hands to:** A tolerant, queryable, lazily-facetted `ContractSpaceAggregate` + a `checkIntegrity()` query that downstream read commands consume without re-implementing disk I/O or integrity policy.
   - **Focus:** The model (`aggregate/`), `migration-graph.ts`, `io.ts`, and the *correctness-gating* consumers (check / apply / verify) plus the two existing aggregate readers (status / show). Cross-consumer integration tests pin a self-edge / hash-mismatch / orphan-space-dir project. **Out of scope:** list / graph / log (they aren't on the aggregate yet — slice 2).

2. **Slice `adopt-read-commands`** — Linear: [TML-2716](https://linear.app/prisma-company/issue/TML-2716)
   - **Outcome:** **Every** CLI command that reads migration packages from disk — `migration list` / `graph` / `log` **and** the package-read path of `db-sign` / `db-update` / `migration-plan` / `ref` — builds the unified model once (via a shared `buildReadAggregate` helper) and reads `aggregate.spaces()` / `aggregate.app.graph()` / `.packages` / `.refs`. Both hand-rolled loaders (`enumerateMigrationSpaces` and `loadMigrationPackages`) are deleted. None gate on load (the substitution is behaviour-preserving; `loadMigrationPackages` never gated). For the writer/planner commands only the read seam moves; their write/apply/plan behaviour is untouched.
   - **Builds on:** Slice 1's tolerant queryable aggregate + the read-aggregate load pattern (`buildReadAggregate` with an identity-only app-contract stand-in when the live contract is unreadable).
   - **Hands to:** All migration package-reading commands on one model — the project's success signal (no second read-model *or* second representation; net deletion at the call sites; both loaders deleted).
   - **Focus:** The seven CLI command files + the shared `buildReadAggregate` helper + deletion of both hand-rolled loaders. **Out of scope:** the model itself (frozen in slice 1); the write/apply/plan behaviour of db-sign / db-update / migration-plan (only their read seam moves). **Scope note (settled 2026-05-30):** grounding found `loadMigrationPackages` had six callers, not just list/graph/log, so all seven package-reading commands are folded in to make the helper genuinely deletable rather than leaving a half-migrated state. **Amendment (2026-05-30):** operator review of PR #644 folded in honest naming of the app-contract stand-in + relocation of `migration list`'s view-model out of `@prisma-next/migration-tools` into CLI-private presentation (no second representation in a shared package) — see [`design-decisions.md` § DD-1](./design-decisions.md) and the slice spec's Dispatch 4.

## Dependencies (external)

- [ ] **TML-2697 / PR #603** — *open.* This branch is stacked on its head (`enumerateMigrationSpaces`, ref handling, multi-space `list`). Slice 1 builds directly on that surface. PR #603 must merge before this project's PRs can merge to `main`; until then the stack rebases on its head.

## Sequencing rationale

The stack order is forced, not chosen. The spec's transitional-shape constraint says the self-edge / hash throws may be removed only in the same change that re-acquires them at the correctness-gating consumers, and `loadContractSpaceAggregate`'s signature change is atomic with apply/verify construction. That knot — pure graph build + tolerant load + `checkIntegrity()` + every current consumer — is irreducibly slice 1. Slice 2 is pure net-deletion adoption that depends on slice 1's query API existing, so it cannot precede or parallelise with it. There is no third parallel thread: the project is small enough that two stacked slices is the whole shape.

Slice 1 is the heavy slice; `drive-plan-slice` decomposes it into dispatches at pickup (the model change, the integrity-surface extraction, the per-consumer re-pointing, and the cross-consumer integration tests are natural dispatch boundaries within the one reviewable thesis: *validation moved from load-time throws to a `checkIntegrity()` query, behaviour preserved*).
