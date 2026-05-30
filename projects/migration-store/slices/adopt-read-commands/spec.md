# Slice: adopt-read-commands

_Parent project `projects/migration-store/`. Outcome contributed: every CLI command that reads migration packages from disk adopts the one tolerant queryable model, and both hand-rolled loaders are deleted — the project's success signal (no second read-model; net deletion at the call sites)._

## At a glance

Re-point **every** CLI command that reads migration packages off its hand-rolled disk I/O — `enumerateMigrationSpaces` (list) and `loadMigrationPackages` (graph, log, db-sign, db-update, migration-plan, ref) — onto the `ContractSpaceAggregate` slice 1 made tolerant + queryable. Each command builds the aggregate once and reads `aggregate.spaces()` / `aggregate.app.graph()` / `.packages` / `.refs`. **Both** hand-rolled loaders (`enumerateMigrationSpaces` + `loadMigrationPackages`) are then deleted. The model is frozen — slice 1 owns it; this slice only adds consumers and removes the superseded I/O paths.

## Chosen design

Per project spec [§ Per-command consumption](../../spec.md). Each command builds the aggregate **once** via the offline-load pattern slice 1 established in `migration status` (`migration-status.ts:636-665`): `config` → `createControlStack` → `familyInstance.deserializeContract` → an **app contract shell** (`appContractShellForAggregateLoad`) as the fallback when the on-disk contract is absent/unreadable → `loadContractSpaceAggregate({ migrationsDir, deserializeContract, appContract })`. The shell fallback is the load-bearing detail: it lets these offline commands build the aggregate without requiring a readable contract, so **no contract-readability behaviour change** is introduced (`graph` keeps rendering without a contract marker when the contract is unreadable).

This assembly is ~30 lines, currently inline in `status`. **Decision:** extract a shared `buildReadAggregate(config, { migrationsDir })` helper (in the CLI aggregate-loader wrapper) so the seven call sites don't each duplicate it.

| Command | Was | Becomes |
|---|---|---|
| `list` | `enumerateMigrationSpaces({ projectMigrationsDir })` → `MigrationSpaceListEntry[]` | `aggregate.spaces()` → per-member `.packages`; `--space <id>` via `hasSpace` / `space(id)` |
| `graph` | `loadMigrationPackages(appMigrationsDir)` + `readRefs(refsDir)` | `aggregate.app.graph()` + `aggregate.app.refs` |
| `log` | `loadMigrationPackages(appMigrationsDir)` (bundles + graph) | `aggregate.app.graph()` + `aggregate.app.packages` |
| `db-sign` | `loadMigrationPackages` + `readRefs` → `parseContractRef` → `bundles.find(.metadata.to)` | `aggregate.app.graph()` + `.packages` + `.refs` (read path only) |
| `db-update` | same as db-sign (under `--to`) | `aggregate.app.graph()` + `.packages` + `.refs` (read path only) |
| `migration-plan` | `loadMigrationPackages` → `resolveFromForPlan({ bundles, graph, familyInstance })` | `aggregate.app.graph()` + `.packages` (read path only) |
| `ref` | `loadMigrationPackages` + `readRefs` → `parseContractRef` / `isGraphNode` / `findLatestMigration` → `bundles.find` | `aggregate.app.graph()` + `.packages` + `.refs` |

No command gains a `checkIntegrity()` gate — `loadMigrationPackages` never gated on integrity (it is tolerant `readMigrationsDir` + pure `reconstructGraph`), so the substitution is **behaviour-preserving everywhere**. For the writer / planner commands (db-sign, db-update, migration-plan), **only the package-read path moves**; their write / apply / plan behaviour is untouched. The DB-marker / applied-path logic in `log`, the ref-resolution + bundle-lookup in db-sign / db-update / ref, the from-resolution in migration-plan, and all rendering / `--json` / error envelopes are unchanged; only the source of packages / graph / refs moves.

## Coherence rationale

One reviewable thesis: **every CLI command that reads migration packages goes through the aggregate; both hand-rolled loaders are deleted.** Seven near-identical, behaviour-preserving substitutions against a frozen API, plus two deletions — one reviewer holds "all package-reading commands now share one model, the old loaders are gone" in one sitting. Folding all seven (rather than only list/graph/log) is what makes `loadMigrationPackages` genuinely unused and deletable; the partial alternative would leave a half-migrated state (three commands on the model, four still on the old helper) that is harder to review, not easier.

## Scope

**In:** `packages/1-framework/3-tooling/cli/src/commands/{migration-list,migration-graph,migration-log,db-sign,db-update,migration-plan,ref}.ts`; the shared `buildReadAggregate` helper (CLI aggregate-loader wrapper); deletion of `enumerateMigrationSpaces` (+ export + tests) **and** `loadMigrationPackages` (+ the `control-api/types.ts` doc-comment reference) once their last callers move; the affected unit tests.

**Out:** The model itself (frozen — slice 1). The **write / apply / plan** behaviour of db-update / db-sign / migration-plan — only their package-read path moves. No new rendered output, `--json` shape, or structured error codes.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
|---|---|---|
| `list` reserved-name + empty-state semantics | Preserve | `enumerateMigrationSpaces` synthesises `[{ spaceId: app, migrations: [] }]` when `migrations/` is missing/empty and treats per-space `refs/` as reserved (`--space refs` → `SPACE_NOT_FOUND`, not empty-state). The aggregate's space enumeration + the command layer must reproduce this exactly; pin with the existing `migration-list` tests. |
| `graph` offline + contract unreadable | Preserve | `graph` renders without a contract marker today (catches `readContractEnvelope` failure). The shell-contract fallback keeps this — no new "contract required" error. |
| Writer/planner commands' write path | Untouched | Only the package-read path of db-sign / db-update / migration-plan / ref moves. Their apply / sign / plan / ref-write behaviour, error envelopes, and DB interactions stay exactly as-is; pin with the existing command tests. |
| app-only read through all-spaces aggregate | Accept | Construction reads every space's packages/refs; lazy facets mean only `app.graph()` is realised. Matches the one-model design + `status` precedent. A single-space loader is a deferred future optimization. |

## Slice-specific done conditions

- [ ] `git grep enumerateMigrationSpaces` and `git grep loadMigrationPackages` over `packages/**/src` each return zero (both helpers deleted; every package-reading command on the aggregate).
- [ ] All seven commands produce identical human output, `--json`, and structured errors as before; the writer/planner commands' apply/sign/plan/ref-write behaviour is unchanged.
- [ ] Net deletion across the branch (seven call-site substitutions routed through one shared helper; two loaders removed).

## Open Questions

None. Scope settled with the operator (2026-05-30): fold all seven package-reading commands onto the aggregate and delete both hand-rolled loaders, satisfying the project-DoD item (`loadMigrationPackages` deleted) as written — no follow-up deferral. Decisions carried into the design: extract a shared `buildReadAggregate` helper; accept app-only reads building the all-spaces aggregate (lazy facets bound the cost).

## References

- Parent project: [`projects/migration-store/spec.md`](../../spec.md) (§ Per-command consumption, § Project Definition of Done), [`design-notes.md`](../../design-notes.md)
- Slice 1 (frozen model + offline-load pattern): [`../tolerant-queryable-aggregate/spec.md`](../tolerant-queryable-aggregate/spec.md); load pattern at `migration-status.ts:636-665`
- Linear issue: [TML-2716](https://linear.app/prisma-company/issue/TML-2716)
- Subsystem: [`docs/architecture docs/subsystems/7. Migration System.md`](../../../../docs/architecture%20docs/subsystems/7.%20Migration%20System.md)
- ADR: [ADR 212 — Contract spaces](../../../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md)

## Dispatch plan

Shape: one judgment site (the shared `buildReadAggregate` helper) isolated into D1 and proven on the simplest consumer, then mechanical fan-out of the two distinct substitution shapes — `loadMigrationPackages → aggregate.app.*` (D1–D2) and `enumerateMigrationSpaces → aggregate.spaces()` (D3). All dispatches: implementer `composer-2.5-fast`, reviewer `claude-opus-4-8-thinking-high` (operator standing split). Briefs are precise (the helper shape + the substitution seam are settled here), so composer tier holds.

### Dispatch 1: `buildReadAggregate` helper + `migration graph`

- **Outcome:** A shared `buildReadAggregate(config, { migrationsDir })` helper (in `utils/contract-space-aggregate-loader.ts`) returns a `ContractSpaceAggregate` built via the slice-1 offline pattern (`createControlStack` → `familyInstance.deserializeContract` → `appContractShellForAggregateLoad` fallback → `loadContractSpaceAggregate`), no integrity gate. `migration graph` reads through it: `aggregate.app.graph()` for the graph, `aggregate.app.refs` for ref markers, and the contract marker derived from the loaded app contract (preserving `EMPTY_CONTRACT_HASH`-on-unreadable). `migration graph`'s `loadMigrationPackages` + ad-hoc `readRefs` calls are gone; output / `--json` / `--dot` unchanged. Helper has a unit test; graph's tests pass unchanged.
- **Builds on:** The spec's chosen design + slice 1's `loadContractSpaceAggregate` / `appContractShellForAggregateLoad`.
- **Hands to:** A proven `buildReadAggregate` helper and the canonical `loadMigrationPackages → aggregate.app.*` adoption pattern the fan-out replicates.
- **Focus:** `contract-space-aggregate-loader.ts` (new helper), `migration-graph.ts`, their tests. The contract-marker-from-aggregate detail is the one judgment site. **Out:** the other consumers (D2/D3); the model (slice 1).

### Dispatch 2: fan out to the remaining `loadMigrationPackages` consumers + delete the helper

- **Outcome:** `migration log`, `db-sign`, `db-update`, `migration-plan`, and `ref` each build the aggregate via `buildReadAggregate` and read `aggregate.app.graph()` / `.packages` / `.refs` in place of `loadMigrationPackages(appMigrationsDir)` (+ their ad-hoc `readRefs` where present). For the writer/planner commands (`db-sign`, `db-update`, `migration-plan`), **only the package-read seam moves** — the ref-resolution, bundle-lookup, from-resolution, apply/sign/plan paths and all error envelopes are byte-for-byte unchanged. `loadMigrationPackages` then has zero callers and is deleted, along with the stale `control-api/types.ts` doc-comment reference. `git grep loadMigrationPackages` over `packages/**/src` returns zero. Each command's tests pass unchanged.
- **Builds on:** D1's `buildReadAggregate` helper + adoption pattern.
- **Hands to:** Every `loadMigrationPackages` consumer on the aggregate; the helper deleted.
- **Focus:** `migration-log.ts`, `db-sign.ts`, `db-update.ts`, `migration-plan.ts`, `ref.ts`, `command-helpers.ts` (delete `loadMigrationPackages`), `control-api/types.ts` (doc ref); their tests. Uniform substitution at the read seam — if any site's substitution is *not* uniform (the downstream logic needs something `aggregate.app.*` doesn't expose), halt and surface rather than reshaping the command. **Out:** `list` (D3).

### Dispatch 3: `migration list` → `aggregate.spaces()` + delete `enumerateMigrationSpaces`

- **Outcome:** `migration list` reads `aggregate.spaces()` (via `buildReadAggregate`) instead of `enumerateMigrationSpaces`, mapping members to its `MigrationSpaceListEntry` shape; `--space <id>` resolves via `hasSpace` / `space(id)`. The reserved-name exclusion + empty-state synthesis (`migrations/` missing/empty → `[{ spaceId: app, migrations: [] }]`; `--space refs` → `SPACE_NOT_FOUND`) are preserved exactly. `enumerateMigrationSpaces` (+ its `exports/` entry + its tests) is deleted; `git grep enumerateMigrationSpaces` over `packages/**/src` returns zero. `migration list` output / `--json` / structured errors unchanged; existing list tests pass.
- **Builds on:** D1's `buildReadAggregate` helper (not D2 — D3 only needs the helper, so it may run after D1 independently of D2).
- **Hands to:** Slice DoD met — every package-reading command on the one model; both hand-rolled loaders deleted.
- **Focus:** `migration-list.ts`, `enumerate-migration-spaces.ts` (+ export + tests) deletion; the reserved-name / empty-state edge cases are the judgment surface. **Out:** none — last dispatch.
