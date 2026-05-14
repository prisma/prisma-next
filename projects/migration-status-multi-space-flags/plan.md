# Project Plan

## Summary

Make `prisma-next migration status` answer its load-bearing question ("what will `apply` do?") cleanly across single- and multi-space apps. Default view focuses on the app space and surfaces extension spaces only when they have pending work. A new `--space <id>` selector scopes `--graph` / `--limit` and the in-detail history listing to one space at a time, leaving the renderer and JSON envelope unchanged. Snapshot tests pin the new multi-space output shape.

**Spec:** [`projects/migration-status-multi-space-flags/spec.md`](spec.md)

**Linear:** [TML-2475 — Make `prisma-next migration status` flags multi-space aware](https://linear.app/prisma-company/issue/TML-2475/make-prisma-next-migration-status-flags-multi-space-aware-graph-limit)

## Cross-project dependencies

This ticket is a deliberate follow-up to **M6 of TML-2397** (Contract spaces project; data-shape + per-space summary block landed on branch `tml-2397-migration-cli-aggregate`). It depends on:

- `MigrationStatusResult.spaces[]` and `totalPendingAcrossSpaces` already populated by `loadAggregateStatusSpaces` (lives in `packages/1-framework/3-tooling/cli/src/commands/migration-status.ts`).
- `buildContractSpaceAggregate` returning hydrated migration graphs per member (used today only to compute pending counts; this ticket additionally routes graph + bundles + edge-statuses through it for the focused space).
- `formatStatusSummary` / `formatSpaceLine` in the same module (filtered, not replaced).

No new framework or migration-tools changes are required; this is entirely a CLI-layer slice.

Sequencing-wise, TML-2475 should land **before** TML-2397's close-out so the subsystem doc (`docs/architecture docs/subsystems/7. Migration System.md`) can describe shipped behaviour rather than a deferred half-state.

## Shipping strategy

Everything in this slice is additive to the existing CLI surface:

- The default view becomes more focused (extension-space lines emitted only when `pendingCount > 0`). This is a strict reduction in default-view noise; no caller depends on extension lines appearing in the up-to-date case (the per-space block only entered the codebase under M6 and is not yet pinned by any external doc or fixture).
- `--space <id>` is a new flag; absence of the flag preserves today's behaviour exactly.
- `--ref` + non-app-space rejection is a new error; today's behaviour against the app space is unchanged.
- JSON envelope shape is unchanged.

No feature flag is needed; the change is safe to deploy in one PR.

## Test design

Acceptance criteria from the spec map onto the following test cases. All tests live in the CLI package (`packages/1-framework/3-tooling/cli/test/`) or under `test/integration/test/cli-journeys/`. Snapshot tests strip ANSI before comparison.

| TC | Spec ref | Type | What it verifies |
|---|---|---|---|
| TC-1 | AC1, AC10(a) | E2E | Default view with one pending extension space (e.g. `audit` ahead by two, `feature-flags` up to date) — output contains app-space block + one `[ext] audit` pending line; does not mention `feature-flags`. Snapshot. |
| TC-2 | AC2, AC10(b) | E2E | Default view with all extensions up to date — output is byte-identical (modulo hashes/timestamps) to the same command against a no-extensions app. Snapshot. |
| TC-3 | AC3 | E2E | `--space audit` against pending `audit` — output's migration table + summary line reflect `audit`'s history; app-space history not shown. |
| TC-4 | AC4, AC10(c) | E2E | `--graph --space audit` — dagre graph plots `audit`'s migration graph; node markers reflect `audit`'s marker / head; edge status icons reflect `audit`'s applied/pending edges. Snapshot. |
| TC-5 | AC5 | E2E | `--graph --space audit --limit 1` truncates to 1 visible edge plus `┊ (N earlier migrations)`; `--limit 5` against a 5-edge history shows all edges. |
| TC-6 | AC6 | Unit | `--space audit --ref production` returns structured error `CLI.REF_INCOMPATIBLE_WITH_NON_APP_SPACE`. Non-zero exit. Hint references app-space-only refs. |
| TC-7 | AC7 | Unit | `--space nonexistent` returns structured error; hint lists loaded space IDs (extensions alphabetical, then `app`). Non-zero exit. |
| TC-8 | AC8 | E2E | `--json` against multi-extension up-to-date app — output JSON includes `spaces[]` with every loaded space; `totalPendingAcrossSpaces: 0`. Same JSON shape under `--graph` and `--space` flags. |
| TC-9 | AC9 | E2E | `--space <ext-id>` against an extension space with no migrations on disk — exit zero; one-line message. |
| TC-10 | (spec FR3 ergonomics) | E2E | `--space app` is accepted as an explicit no-op; output matches the no-flag default. |
| TC-11 | (spec FR4 back-compat) | E2E | `--graph` (no `--space`) against a multi-extension app — renders the app-space graph, identical in shape to today. |

Unit-level coverage lives under `packages/1-framework/3-tooling/cli/test/commands/migration-status-*.test.ts` mirroring the existing pattern (e.g. `migration-status-aggregate-spaces.test.ts`). E2E coverage lives under `test/integration/test/cli-journeys/migration-status-multi-space.e2e.test.ts`.

## Milestones

This is a small, atomic slice. One milestone, sequenced for review-friendliness.

### Milestone 1: Multi-space flags

**Tasks:**

- [ ] **T1.** Filter the default-view per-space block to `pendingCount > 0` extension entries; drop the cross-space pending total line from the default view; degenerate case (no extension space has pending work) renders byte-identical to the pre-M6 single-space app output. Update `formatStatusSummary` / `formatSpaceLine` in `packages/1-framework/3-tooling/cli/src/commands/migration-status.ts`. (Covers TC-1, TC-2.)
- [ ] **T2.** Add the `--space <id>` flag to `createMigrationStatusCommand` (`commander` option). Thread it as `space?: string` into `executeMigrationStatusCommand`. Default value behaviour: undefined preserves today's app-space path. (Wires foundation for T3–T5.)
- [ ] **T3.** Inside `executeMigrationStatusCommand`, when `space` is set and non-`app`: load the chosen member from the contract-space aggregate (already loaded for the per-space summary today); route its hydrated graph, on-disk bundles, marker, head hash, and derived edge-statuses through the top-level `graph` / `bundles` / `edgeStatuses` / `markerHash` / `targetHash` / `contractHash` fields. When `space === 'app'` or unset, behaviour is today's. (Covers TC-3, TC-4, TC-10, TC-11.)
- [ ] **T4.** Derive per-space `edgeStatuses` by extracting the existing `deriveEdgeStatuses` function to operate on any `(graph, markerHash, targetHash, contractHash, mode)` tuple (it already does — confirm and reuse). (Supporting work for T3.)
- [ ] **T5.** Validation gates on `--space`: unknown ID → `CliStructuredError` whose hints list loaded space IDs; `--ref <name>` combined with `--space <non-app-id>` → `CliStructuredError` code `CLI.REF_INCOMPATIBLE_WITH_NON_APP_SPACE`. Both surface via the existing `handleResult` path with non-zero exit. (Covers TC-6, TC-7.)
- [ ] **T6.** Empty-graph case for `--space <id>`: when the selected space's on-disk graph has zero edges, emit a single-line "no migrations on disk" message and exit zero. Mirrors the app-space empty-migrations branch already in `executeMigrationStatusCommand`. (Covers TC-9.)
- [ ] **T7.** `--limit N` continues to apply to the rendered graph and history table; verify it operates on the focused space's data (no separate code path; falls out of T3). (Covers TC-5.)
- [ ] **T8.** Confirm JSON envelope serialises the full `spaces[]` aggregate regardless of `--space` / `--graph` / `--limit`. The existing internal-detail strip block (`graph`, `bundles`, `edgeStatuses`, `activeRefHash`, `activeRefName`, `diverged`) covers the new per-space-routed top-level fields automatically. (Covers TC-8.)
- [ ] **T9.** Unit tests for `--space` validation paths: unknown ID + ref-incompatibility (`migration-status-space-flag.test.ts` or extend `migration-status-aggregate-spaces.test.ts`). (Covers TC-6, TC-7.)
- [ ] **T10.** E2E snapshot test at `test/integration/test/cli-journeys/migration-status-multi-space.e2e.test.ts` mirroring the journey-helper pattern from `migration-status-diagnostics.e2e.test.ts`. Three scenarios:
  - default view with one pending extension space,
  - default view with all extensions up to date,
  - `--graph --space <ext-id>`.
  ANSI stripped; snapshots committed. (Covers TC-1, TC-2, TC-4 and pins the load-bearing AC10.)
- [ ] **T11.** Update `docs/architecture docs/subsystems/7. Migration System.md` § "Helpful Commands" — the `migration status` synopsis gains `[--space <id>]`. Update the prose passage that names the M6 deferral to describe shipped behaviour.
- [ ] **T12.** Update `packages/1-framework/3-tooling/cli/README.md` (if it documents `migration status` flags) with `--space <id>` semantics.

## Reasoning-effort checkpoints

The implementer runs at medium reasoning effort by default. Three points in the milestone are tricky enough that the implementer should pause and request a high-reasoning-effort review before continuing:

- **Checkpoint 1 — after T3 (data routing complete, before tests).** T3 routes per-space hydrated graph / bundles / edge-statuses through the top-level `MigrationStatusResult` fields. This is the highest-blast-radius change in the slice: it touches the back-compat surface that single-space callers rely on (the result type's app-space-only top-level fields). High-effort review catches: (a) off-by-one routing bugs where `space === 'app'` accidentally takes the extension path; (b) edge-status derivation correctness when the focused space has no marker; (c) any subtle JSON-envelope shape drift introduced by the new field-population path.
- **Checkpoint 2 — after T9–T10 (tests landed, before docs).** Snapshot tests pin the load-bearing AC10. High-effort review confirms the snapshots actually exercise the right code paths (not just incidental output), the multi-extension fixture is realistic enough to surface the multi-space code path, and ANSI stripping is applied consistently. Catches the "tests pass but don't prove the AC" failure mode.
- **Checkpoint 3 — close-out AC sweep.** Before deleting `projects/migration-status-multi-space-flags/`, run the full AC1–AC10 verification under high reasoning effort. The orchestrator handles trivial commits but AC verification is the kind of synthesis where missing a corner case is expensive — high effort is right here.

Outside those three points the work is mechanical enough that medium reasoning effort is the right gear.

**Validation gate:**

```bash
pnpm typecheck
pnpm lint:deps
pnpm test --filter @prisma-next/cli
pnpm test:integration -- --testPathPattern cli-journeys/migration-status
pnpm build
```

The integration filter narrows e2e runs to the migration-status family during dev; the full `pnpm test:integration` runs at PR-open time.

## Close-out (required)

- [ ] Verify all acceptance criteria in [`projects/migration-status-multi-space-flags/spec.md`](spec.md).
- [ ] Confirm `docs/architecture docs/subsystems/7. Migration System.md` describes shipped behaviour for `--space` / `--graph` / `--limit` on `migration status`.
- [ ] Strip references to `projects/migration-status-multi-space-flags/**` from any docs / READMEs that link into it during execution (replace with canonical `docs/` links or remove).
- [ ] Delete `projects/migration-status-multi-space-flags/` in the close-out commit.
- [ ] Coordinate with TML-2397 close-out (`docs T5.7`) so the subsystem doc lands consistent with this ticket's shipped behaviour.

## Open items

1. **Branch sequencing relative to TML-2397's `migration-cli-aggregate` branch.** This work assumes the M6 data-shape changes are present on `main` (or the active development line) by the time TML-2475 implementation starts. If `tml-2397-migration-cli-aggregate` is still in review when TML-2475 starts, this ticket's branch should fork off it rather than `main` to inherit `MigrationStatusResult.spaces[]`. The orchestrator handles the rebase if `migration-cli-aggregate` lands first.
2. **Whether to add a Linear sub-issue under the Contract Spaces project for documentation propagation (T11).** The doc update fits naturally inside this PR; if PR review prefers a separate doc commit, it lands in the same branch as a second commit. No separate ticket needed.
