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
| `graph` refs on a corrupt/unreadable refs dir | Tolerant by design (D1 R1, accepted) | The old `graph` wrapped `readRefs` in try/catch — one unreadable refs entry dropped **all** ref markers. Reading `aggregate.app.refs` omits only individually-bad refs. The app space never persists `migrations/app/refs/head.json` (its head is synthesized), so the **happy path is byte-identical**; the only delta is corruption-path tolerance, which is the intended improvement onto the tolerant model. AC-2's "identical output" is therefore a **happy-path** guarantee. |
| `head` ref decoration on extension-space `list` (D3 R1) | Restore strict parity | The tolerant `member.refs` (`readRefsTolerant`) deliberately excludes the structural `refs/head.json`; the old `list` (`readRefs`) included it, so an extension space's tip-migration row showed a `head` decoration. To keep this slice pure-adoption (no happy-path output change), the `list` mapper **folds `member.headRef` back into the by-destination-hash ref decoration**, preserving the old output exactly. Whether `head` *should* appear in `list` decorations at all is a separate semantics question → follow-up ticket, not this slice. |

## Slice-specific done conditions

- [ ] `git grep enumerateMigrationSpaces` and `git grep loadMigrationPackages` over `packages/**/src` each return zero (both helpers deleted; every package-reading command on the aggregate).
- [ ] All seven commands produce identical **happy-path** human output, `--json`, and structured errors as before; the writer/planner commands' apply/sign/plan/ref-write behaviour is unchanged. (Corruption-path refs rendering in `graph` is now tolerant by design — see edge-case table.)
- [ ] Each touched command's `--json` output is **pinned by a golden test** before this condition is marked PASS — structural-equivalence prose is not sufficient (D1 R1 reviewer recommendation). Includes backfilling a `--json` golden test for `migration graph`, which had no command-level test.
- [ ] Net deletion across the branch (seven call-site substitutions routed through one shared helper; two loaders removed).

## Amendment (2026-05-30): honest stand-in naming + view-model consolidation

Operator review of PR #644 surfaced a falsified planning assumption (invariant I12; recorded in [`../../design-decisions.md` § DD-1](../../design-decisions.md)): the slice met its original done conditions but did **not** honour the project's "one model / no second representation" signal for the list path. Two in-slice corrections, folded into the same PR (no new slice, no follow-up):

1. **Honest stand-in naming (no model change).** The CLI fabricates a placeholder app `Contract` when the live contract can't be loaded (`appContractShellForAggregateLoad`). The model stays as-is — the eager `appContract` is kept. **Rename** the fallback to describe what it is (an identity-only app-contract stand-in), with **no "offline"/"shell"** framing, and rewrite the `blindCast` reason to state the safety invariant: *read commands consume only `storage.storageHash` + `target`, never `models`.*
2. **View-model consolidation (full relocation — Option A).** The CLI-only `migration list` presentation cluster in `@prisma-next/migration-tools` is `MigrationListEntry` / `MigrationSpaceListEntry` / `MigrationListResult` **plus** `classifyMigrationListGraphTopology` + `MigrationListGraphTopology` + `MigrationEdgeKind` (+ its test) — every importer is in the CLI, and the classifier depends on `MigrationListEntry` (so the type cannot move without it). **Relocate the whole cluster** into the CLI presentation layer (trimming the two `migration-tools` public exports + their `tsdown` / `package.json` wiring); **inline** the aggregate→view mapping into the `migration list` consumer (deleting the detached `migration-space-list-from-aggregate.ts` util); keep the ref-decoration as one helper. The four `migration-list-*` formatters keep consuming the same view shape — only the import home moves.
3. **Adjacent fixes on the same branch:** move the `createControlStack` / `family.create` bootstrap inside `buildReadAggregate`'s `Result` error boundary (a bootstrap failure must become a `CliStructuredError`, not a thrown crash); fix the three `F11 → F14` cross-reference links in `drive/calibration/dod.md` + `drive/retro/findings.md`.

**Accepted trade-off:** the on-disk `readdir` for list space-ids stays — required because the frozen model always synthesises an `app` member; it is on-disk enumeration, not a second read-model.

### Added done conditions

- [ ] No `migration list` presentation symbol (`MigrationListEntry` / `MigrationSpaceListEntry` / `MigrationListResult` / `classifyMigrationListGraphTopology` / `MigrationListGraphTopology` / `MigrationEdgeKind`) is defined in or exported from `@prisma-next/migration-tools`; all live in the CLI presentation layer. `git grep -E "MigrationListEntry|classifyMigrationListGraphTopology" -- packages/1-framework/3-tooling/migration` returns zero; the `./migration-list-types` + `./migration-list-graph-topology` export entries are removed from `migration-tools`' `package.json` + `tsdown.config.ts`.
- [ ] The aggregate→view mapping lives in the `migration list` consumer, not a standalone `migration-tools`-adjacent util; `migration-space-list-from-aggregate.ts` is deleted.
- [ ] The CLI offline read-aggregate fallback contract is named for what it carries (identity-only app-contract stand-in), with a `blindCast` reason stating the read-only `storageHash`+`target` invariant. No "offline"/"shell" in the name.
- [ ] `buildReadAggregate` returns a `CliStructuredError` (not a thrown exception) on control-stack / family bootstrap failure.
- [ ] `migration list` happy-path human / `--json` / structured-error output unchanged (existing goldens + tests pass; head-ref parity preserved).

## Open Questions

None. Scope settled with the operator (2026-05-30): fold all seven package-reading commands onto the aggregate and delete both hand-rolled loaders, satisfying the project-DoD item (`loadMigrationPackages` deleted) as written — no follow-up deferral. Decisions carried into the design: extract a shared `buildReadAggregate` helper; accept app-only reads building the all-spaces aggregate (lazy facets bound the cost). Amendment (2026-05-30) above adds the view-model consolidation + honest stand-in naming; see [`../../design-decisions.md` § DD-1](../../design-decisions.md).

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
- **Focus:** `migration-log.ts`, `db-sign.ts`, `db-update.ts`, `migration-plan.ts`, `ref.ts`, `command-helpers.ts` (delete `loadMigrationPackages`), `control-api/types.ts` (doc ref); their tests. Uniform substitution at the read seam — if any site's substitution is *not* uniform (the downstream logic needs something `aggregate.app.*` doesn't expose — e.g. `aggregate.app.packages` must carry the `OnDiskMigrationPackage` fields the consumers read, notably `dirPath` for `db-sign`'s `end-contract.json`), halt and surface rather than reshaping the command. Each command passes the **top-level `migrationsDir`** to `buildReadAggregate` (not `appMigrationsDir` — D1 established this; the aggregate loader resolves `migrations/<space>/`). **Golden-test discipline (D1 R1 reviewer rec):** pin each touched command's `--json` with a golden test, and **backfill a `--json` golden test for `migration graph`** (D1 shipped it without one). **Out:** `list` (D3).

### Dispatch 3: `migration list` → `aggregate.spaces()` + delete `enumerateMigrationSpaces`

- **Outcome:** `migration list` reads `aggregate.spaces()` (via `buildReadAggregate`) instead of `enumerateMigrationSpaces`, mapping members to its `MigrationSpaceListEntry` shape; `--space <id>` resolves via `hasSpace` / `space(id)`. The reserved-name exclusion + empty-state synthesis (`migrations/` missing/empty → `[{ spaceId: app, migrations: [] }]`; `--space refs` → `SPACE_NOT_FOUND`) are preserved exactly. `enumerateMigrationSpaces` (+ its `exports/` entry + its tests) is deleted; `git grep enumerateMigrationSpaces` over `packages/**/src` returns zero. `migration list` output / `--json` / structured errors unchanged; existing list tests pass.
- **Builds on:** D1's `buildReadAggregate` helper (not D2 — D3 only needs the helper, so it may run after D1 independently of D2).
- **Hands to:** Slice DoD met — every package-reading command on the one model; both hand-rolled loaders deleted.
- **Focus:** `migration-list.ts`, `enumerate-migration-spaces.ts` (+ export + tests) deletion; the reserved-name / empty-state edge cases are the judgment surface. Pass the **top-level `migrationsDir`** to `buildReadAggregate`. **Golden-test discipline:** pin `migration list`'s `--json` with a golden test if not already covered. **Out:** none.

### Dispatch 4 (amendment 2026-05-30): honest stand-in naming + view-model consolidation + adjacent fixes

- **Outcome:** On PR #644's branch — (1) rename the CLI fallback app-contract from `appContractShellForAggregateLoad` to an identity-only stand-in name (no "offline"/"shell"), rewrite its `blindCast` reason to state the read-only `storageHash`+`target` invariant; (2) relocate the whole CLI-only `migration list` presentation cluster (`MigrationListEntry` / `MigrationSpaceListEntry` / `MigrationListResult` + `classifyMigrationListGraphTopology` / `MigrationListGraphTopology` / `MigrationEdgeKind` + its test) out of `@prisma-next/migration-tools` into the CLI presentation layer, trimming the `./migration-list-types` + `./migration-list-graph-topology` exports from `migration-tools`' `package.json` + `tsdown.config.ts`; inline the aggregate→view mapping into `migration list` (delete `migration-space-list-from-aggregate.ts`), keep the ref-decoration helper; the four `migration-list-*` formatters keep the same view shape (import home moves only); (3) move `createControlStack` / `family.create` inside `buildReadAggregate`'s `Result` boundary; (4) fix the three `F11 → F14` cross-reference links. `migration list` happy-path / `--json` / error output unchanged; greps for the relocated symbols in `migration-tools` and for the old fallback name return zero.
- **Builds on:** D3 (the list adoption + mapper this dispatch relocates) on the merged `#644` branch.
- **Hands to:** Slice `adopt-read-commands` truly complete — one model, one CLI-private presentation projection, honest naming; the project's "no second representation" signal met for the list path.
- **Focus:** `contract-space-aggregate-loader.ts` (rename + cast reason + try-boundary), `migration-list.ts` (inline mapper + import the relocated view types), the four `migration-list-*` formatters + graph fixtures (import home), the relocated presentation modules under `cli/src/utils/formatters/` (+ the classifier test under `cli/test/`), `migration-tools` (delete `migration-list-types.ts` / `migration-list-graph-topology.ts` + their `exports/` entries + `package.json` + `tsdown.config.ts`), `drive/calibration/dod.md` + `drive/retro/findings.md` (link fixes); the touched tests. **Re-run the gates on-disk after the move** (composer-reporting unreliable, per DD-1's parent incident — verify with build + `git grep`, not prose). **Out:** any model change (frozen); deleting the view types (kept, relocated).
