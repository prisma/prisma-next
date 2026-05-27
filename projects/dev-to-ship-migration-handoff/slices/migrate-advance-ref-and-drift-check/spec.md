# Slice: `migrate` — `--advance-ref` flag + apply-time drift check

_Parent project: [`projects/dev-to-ship-migration-handoff/`](../../). This slice satisfies **FR8**, **FR9 (runner enforcement on `--to`)**, **FR17**, **NFR6**, **PDoD4 (runner side)**, and **PDoD5** from [the project spec](../../spec.md). It closes the **cold-clone drift trap** and completes the project's end-to-end J4 workflow at the runner layer._

## At a glance

After this slice ships, `migrate` exposes the new `--advance-ref <name>` flag (mirroring Slice 2's `db init` / `db update` wiring with one key asymmetry — `migrate` has **no implicit default**; ref advancement only fires on explicit opt-in). The command also runs a **pre-DDL marker drift check** that refuses cleanly when the live DB marker isn't reachable in the on-disk migration graph, with a new structured `markerMismatch` discriminant naming both hashes. The existing `pathUnreachable` payload's `fix` text gets meaningful affordances (it's empty today per the scout report).

Three observable changes:

1. **`--advance-ref <name>` flag on `migrate`.** Opt-in only. After successful apply, the named ref + paired snapshot are written to `migrations/app/refs/<name>.{json,contract.json,contract.d.ts}`. The advancement hash is the post-apply marker; the snapshot source mirrors Slice 2 D2's `db update --to <ref>` logic (current contract by default; matching bundle's `end-contract.{json,d.ts}` when `--to <ref-or-hash>` is provided).
2. **Pre-DDL marker drift check.** Before invoking `client.migrationApply(...)`, read the live marker; if it isn't a graph node in the on-disk app graph (the universal "from must be a graph node" invariant applied at apply time), refuse with a structured `markerMismatch` diagnostic naming both the marker hash and the on-disk graph's reachable hashes. The diagnostic's `fix` text suggests the right recovery path (`migration plan --from <graph-tip>` to formalize the gap, or `ref set db <marker-hash>` to align the local ref with the live state).
3. **`pathUnreachable` payload improvement.** When the runner's graph-walk fails with no reachable path, the existing `MIGRATION_PATH_NOT_FOUND` failure (current `fix: ''` per scout report) gets a meaningful `fix` text. This is structurally distinct from the new `markerMismatch` (which fires BEFORE the runner is invoked); `pathUnreachable` remains the runner's surface for the in-graph-walk failure case.

```mermaid
flowchart TD
    Start[migrate] --> Connect[client.connect]
    Connect --> ReadMarker[client.readAllMarkers]
    ReadMarker --> IsNode{marker.hash<br/>is a graph node?}
    IsNode -->|no, AND graph non-empty AND marker present| RefuseDrift[<b>REFUSE: markerMismatch</b><br/>name both hashes;<br/>fix suggests migration plan --from tip<br/>OR ref set db marker-hash]
    IsNode -->|yes, or marker absent (greenfield), or graph empty| Apply[client.migrationApply]
    Apply -->|ok| AdvanceRef{--advance-ref<br/>provided?}
    Apply -->|failure: MIGRATION_PATH_NOT_FOUND| RefuseUnreachable[Refuse pathUnreachable<br/>with NEW improved fix text]
    Apply -->|failure: other| RefuseOther[Refuse with existing mapping]
    AdvanceRef -->|yes| WriteRef[writeRefPaired<br/>name → markerHash + snapshot]
    AdvanceRef -->|no| Success[Success]
    WriteRef --> Success
```

## Scope

### In scope

- **`@prisma-next/cli` `migrate.ts` `--advance-ref <name>` wiring** (mirrors Slice 2 D2's `db init`/`db update` pattern; reuse `cli/src/utils/ref-advancement.ts` helpers `computeRefAdvancementName`, `executeRefAdvancement`, `readContractIR`, `buildRefAdvancementFields`):
  - Add `--advance-ref <name>` to the command's option list.
  - Extend `MigrateCommandOptions` with `readonly advanceRef?: string`.
  - **Asymmetry from Slice 2:** `migrate` does **NOT** have the implicit-`db` default. `computeRefAdvancementName` returns `null` (no advancement) when `advanceRef` is undefined, regardless of whether `--db` is the default URL or not. Only explicit `--advance-ref <name>` fires advancement. This matches the design-discussion outcome ("`db` isn't magic, just a simple default. `--advance-ref` is opt-in, not automatic"). Implementation note: pass `options.db` as some marker value (e.g., a non-default sentinel) so `computeRefAdvancementName`'s db-default path doesn't fire, OR call `executeRefAdvancement` directly without going through `computeRefAdvancementName` when `migrate` semantics differ enough. Final shape settled at dispatch time.
  - After successful `client.migrationApply(...)`, compute the advancement hash:
    - Use `result.markerHash` from `MigrationApplySuccess` (the post-apply app-member marker).
    - Snapshot source — mirrors Slice 2 D2's `contractJsonPathForSnapshot` switch:
      - When `options.to` is provided AND resolves to a bundle (ref / raw hash / dir name / `<dir>^`): the snapshot source is the bundle's `end-contract.{json,d.ts}` files.
      - When `options.to` is absent: the snapshot source is the current contract's emitted `contract.{json,d.ts}` files.
  - Extend `MigrateResult` interface with optional `advancedRef?: { name: string; hash: string } | null`. Populate when ref advancement runs; leave `null` (or absent) when it doesn't.
  - Output formatter changes:
    - Human output: add a final line `Advanced ref "<name>" → sha256:<hash>` when `advancedRef` is populated. Mirrors Slice 2's wording.
    - JSON output: `advancedRef` field surfaces in the envelope automatically via the existing `JSON.stringify` path.
- **Pre-DDL drift check** at the boundary just after `client.connect(dbConnection)` + just before `client.migrationApply(...)`:
  - Call `client.readAllMarkers()` (already wired for invariant validation at `migrate.ts:233`).
  - Pull the app-space marker: `allMarkers.get('app') ?? null`.
  - Apply the universal "from must be a graph node" invariant: if `appMarker !== null` AND `!isGraphNode(appMarker.storageHash, graph)` AND the graph is non-empty, refuse with `markerMismatch`.
  - **Edge case — greenfield apply (marker absent):** apply proceeds normally; the runner handles the null-marker → first-bundle transition.
  - **Edge case — empty graph:** if the graph is empty AND the marker is present, this is a genuinely weird state (the user has a DB marker but no migration bundles). The pre-DDL check should still refuse here with `markerMismatch` (the empty graph has no nodes; the marker isn't reachable). The `fix` text in this case suggests `migration plan` (which now auto-baselines per Slice 3) or repopulating the graph.
  - **Edge case — `--to <ref-or-hash>` provided:** the drift check applies independently of `--to`. The check is about whether the START point (live marker) is reachable in the graph, not the END point.
  - Diagnostic shape: new CLI error factory `errorMarkerMismatch(markerHash, reachableHashes, graphTipHash?)` in `cli/src/utils/cli-errors.ts`. The `meta.code` value: `MIGRATION.MARKER_MISMATCH` (or `MIGRATION.MARKER_NOT_IN_GRAPH` for symmetry with Slice 1's `HASH_NOT_IN_GRAPH`; final naming settled at dispatch time per spec § Open Questions).
- **`pathUnreachable` payload improvement** — when `client.migrationApply(...)` returns `failure.code === 'MIGRATION_PATH_NOT_FOUND'`, the CLI mapping at `mapApplyFailure` (currently a generic `errorRuntime` wrapper) gets a specific branch:
  - Detect the failure code via `failure.code` and route to a new factory `errorPathUnreachable(...)` (or extend `mapApplyFailure` to inline the specific branch).
  - The `fix` text enumerates concrete recovery affordances:
    - "Run `prisma-next migration list` to see the on-disk graph."
    - "Run `prisma-next migration plan --from <marker-hash>` to formalize the gap." (When the marker IS a graph node but the destination isn't reachable.)
    - "Run `prisma-next ref set db <reachable-hash>` if the local `db` ref drifted from the live marker." (When the issue is local ref / DB-marker confusion.)
  - The `why` text names both the marker hash (origin) and the destination hash, with the in-graph-walk dead-ends list if the runner surfaces it via `failure.meta`.
- **Tests** at the cli unit + integration layers:
  - Unit-test `--advance-ref` wiring (mirroring Slice 2's `cli.db-ref-advancement.e2e.test.ts` for `migrate`).
  - Unit-test the pre-DDL drift check function in isolation: greenfield marker-absent (proceed), graph-empty (refuse), marker-IS-graph-node (proceed), marker-NOT-graph-node (refuse), `--to <ref>` variants (drift check fires independently of `--to`).
  - Integration test: cold-clone drift e2e — clone repo (i.e., set up the migration graph) but use a DB with a marker that isn't in the graph; assert `migrate` refuses with `markerMismatch` + actionable diagnostic.
  - Integration test: **full TML-2629 J4 reproduction with `migrate --advance-ref db`** — the e2e that complements Slice 3's planner-side validation. After `db init` → contract edit → `db update` → `migration plan` (produces auto-baseline pair) → `migrate --advance-ref db`, assert: (a) both bundles apply (b) `db` ref + paired snapshot advance to the post-apply marker. This is the **end-to-end project acceptance test**.
  - Integration test: `pathUnreachable` improved diagnostic surfaces in JSON output with the new `fix` text.

### Out of scope (this slice)

- **Implicit `db`-default rule for `migrate`.** Per design discussion, `migrate --advance-ref` is opt-in only. No implicit advancement.
- **Documentation updates.** Skill + subsystem-doc updates live in Stack 5.
- **`ref set` graph-membership enforcement.** Parallel A.
- **`@prisma-next/migration-tools/` source changes.** This slice only consumes Slice 1's primitives via the CLI; no new primitives.
- **Runner-side changes to the visitor SPI.** The pre-DDL drift check is CLI-side; the runner stays unchanged (its existing `MIGRATION_PATH_NOT_FOUND` failure is the in-graph-walk surface). The new `markerMismatch` is a CLI-layer refuse BEFORE the runner is invoked.
- **`migration recover` command** (project spec OQ1). Defer to project close-out decision; if it ships, that's its own slice.
- **Output-format polish for the `markerMismatch` diagnostic.** Working position is descriptive prose with bullet-listed `fix` affordances. Final wording iterates at slice close based on the dispatch's UX feel.
- **`ContractMarkerRecord.invariants` handling for the drift check.** The drift check is hash-based only (marker.storageHash vs graph.nodes). Invariant-based path selection remains the runner's job; this slice doesn't touch it.

## Approach

### `--advance-ref` wiring (Dispatch 1)

`migrate.ts` already has the post-success branch where `MigrationApplySuccess` lands; the new wiring inserts ref advancement after the success branch, before the result envelope is returned.

```typescript
// Illustrative — final shape at dispatch time.
const applyResult = await client.migrationApply({ ... });
if (!applyResult.ok) return notOk(mapApplyFailure(applyResult.failure));

let refAdvancementFields: { advancedRef?: { name: string; hash: string } | null } = {
  advancedRef: null,
};

if (options.advanceRef !== undefined) {
  const advancementHash = applyResult.value.markerHash;
  const contractJsonPathForSnapshot = options.to
    ? <matching-bundle>.end-contract.json
    : contractPathAbsolute;
  try {
    const contractIR = await readContractIR(contractJson, contractJsonPathForSnapshot);
    const result = await executeRefAdvancement(
      refsDir,
      options.advanceRef,
      advancementHash,
      contractIR,
    );
    refAdvancementFields = { advancedRef: result };
  } catch (error) {
    if (MigrationToolsError.is(error)) {
      return notOk(mapMigrationToolsError(error));
    }
    throw error;
  }
}

return ok({ ..., ...refAdvancementFields });
```

The advancement hash is `markerHash` (the post-apply app-member marker, not the contract hash directly). For `--to`-less invocations, `markerHash` equals the current contract's `storage.storageHash` (so the snapshot source is the current contract). For `--to <bundle-or-ref>` invocations, `markerHash` equals the bundle's `metadata.to` value (so the snapshot source is the bundle's `end-contract.{json,d.ts}`).

### Pre-DDL drift check (Dispatch 2)

Inserted in `executeMigrateCommand` after `client.connect(dbConnection)` and `client.readAllMarkers()` but before `client.migrationApply(...)`. The check is small (~15 LoC):

```typescript
// Illustrative — final shape at dispatch time.
await client.connect(dbConnection);
const allMarkers = await client.readAllMarkers();
const appMarker = allMarkers.get('app') ?? null;

if (appMarker !== null && !isGraphNode(appMarker.storageHash, appPackages.graph)) {
  return notOk(
    errorMarkerMismatch(
      appMarker.storageHash,
      [...appPackages.graph.nodes].sort(),
      findLatestMigration(appPackages.graph)?.to ?? null,
    ),
  );
}

// Existing invariant validation + migrationApply call follows.
```

The `errorMarkerMismatch` factory produces a `CliStructuredError` with:
- `meta.code: 'MIGRATION.MARKER_MISMATCH'` (or final naming per OQ1).
- `why`: names both hashes — `"DB marker is sha256:<marker-hash>, but the on-disk migration graph reaches: <enumerated reachable hashes>."`.
- `fix`: bulleted recovery affordances:
  - `"Run \`prisma-next migration plan --from <reachable-tip>\` if the live marker is canonical and the on-disk graph needs catching up."`
  - `"Run \`prisma-next ref set db sha256:<marker-hash>\` if the on-disk graph is canonical and the local \`db\` ref drifted."`
  - `"Investigate whether the database was migrated by an out-of-band process."`

The check is **independent of `--to`** — drift is a START-point concern (live marker reachability), not an END-point concern.

### `pathUnreachable` payload improvement (Dispatch 2)

The current `mapApplyFailure` at `migrate.ts:77` wraps every `MigrationApplyFailure` into a generic `errorRuntime` with empty `fix` semantics:

```typescript
function mapApplyFailure(failure: MigrationApplyFailure): CliStructuredErrorType {
  return errorRuntime(failure.summary, {
    why: failure.why ?? 'Migration runner failed',
    fix: 'Fix the issue and re-run `prisma-next migrate --to <contract>` — previously applied migrations are preserved.',
    meta: failure.meta ?? {},
  });
}
```

The new branch:

```typescript
function mapApplyFailure(failure: MigrationApplyFailure): CliStructuredErrorType {
  if (failure.code === 'MIGRATION_PATH_NOT_FOUND') {
    return errorPathUnreachable(failure);
  }
  return errorRuntime(...);  // existing generic
}
```

The new `errorPathUnreachable(failure)` factory produces a `CliStructuredError` with:
- `meta.code: 'MIGRATION.PATH_UNREACHABLE'` (or whatever name aligns with existing runner conventions; dispatch-time decision).
- `why`: names origin + destination hashes, plus dead-ends from `failure.meta` if the runner surfaces them.
- `fix`: enumerated recovery affordances similar to `markerMismatch` but tailored to "graph-walk found no path" rather than "marker isn't in graph":
  - `"Run \`prisma-next migration list\` to see the on-disk graph."`
  - `"Run \`prisma-next migration plan --from <marker> --to <destination>\` to introduce the missing path."`
  - `"Run \`prisma-next migration show <bundle>\` for any bundle in the path you expected."`

### Reused helpers

- `buildRefAdvancementFields` from `cli/src/utils/ref-advancement.ts` (Slice 2 D2). May need a small extension to support the `migrate`-specific advancement-hash-from-marker pattern, OR `migrate.ts` can call `computeRefAdvancementName` + `executeRefAdvancement` directly (the lower-level helpers) and skip `buildRefAdvancementFields`'s plan/apply mode discriminator (which doesn't apply to `migrate`). Final shape at dispatch time.
- `isGraphNode` from `@prisma-next/migration-tools/migration-graph` (Slice 1). Pre-DDL drift check uses it directly.
- `readContractIR` from `cli/src/utils/ref-advancement.ts` (Slice 2 D2). Reads the paired `.json` + `.d.ts` into a `ContractIR`.

## Edge cases (Example-Mapping)

| Edge case | Disposition | Notes |
|---|---|---|
| `migrate` with no `--advance-ref`, default `--db` | **Handle (no advancement)** | Default behavior; nothing written to refs. Mirrors Slice 2's "non-default DB + no flag" pattern (no implicit `db` advancement). Test covers. |
| `migrate --advance-ref staging` (default DB, current contract) | **Handle** | Apply to default DB; write `staging` ref + paired snapshot of current contract. Hash = post-apply marker = current contract's `storageHash`. Test covers. |
| `migrate --advance-ref staging --db <other-url>` | **Handle** | Apply to other DB; write `staging` ref + paired snapshot. Hash = post-apply marker on the other DB (same contract → same hash). Test covers. |
| `migrate --to <ref-name> --advance-ref staging` | **Handle** | Apply to ref's hash; write `staging` ref + paired snapshot from matching bundle's `end-contract.{json,d.ts}`. Hash = the ref's hash = post-apply marker. Test covers. |
| `migrate --to <raw-hash> --advance-ref staging` | **Handle** | Same as ref-name case; snapshot source is the matching bundle's `end-contract.*`. Test covers. |
| `migrate --to <bundle-dir-name> --advance-ref staging` | **Handle** | Same; bundle is found by `parseContractRef`'s `migration-to` provenance. Test covers. |
| `migrate --to <bundle-dir-name>^ --advance-ref staging` | **Handle** | Same; bundle is found by `parseContractRef`'s `migration-from` provenance. Test covers. |
| `migrate --advance-ref staging` but contract is unchanged (no-op apply) | **Handle (no-op apply + advancement)** | Apply does nothing; marker stays at current hash; the `--advance-ref` still writes the ref. Idempotent — re-running produces the same ref content. Test covers. |
| `migrate` no apply needed (no-op) + no `--advance-ref` | **Handle (no-op)** | Standard "already up to date" path. No advancement. Test covers (regression). |
| `migrate --advance-ref staging` but apply fails (e.g., runner error) | **Handle (no advancement)** | Failure path returns early via `mapApplyFailure`; advancement never runs. The named ref is **not** written. Test covers. |
| `migrate --advance-ref` with invalid ref name (slash, dots, spaces) | **Handle** | `executeRefAdvancement` → `writeRefPaired` → `validateRefName` rejects → `MIGRATION.INVALID_REF_NAME` surfaces via `mapMigrationToolsError`. Test covers. |
| `migrate --advance-ref staging` ref-write fails after apply success | **Handle (drift accepted)** | Apply succeeded; ref write failed. The DB is migrated; the local ref is not. User gets the structured error in output. Re-running `migrate --advance-ref staging` after fixing the cause repopulates the ref (idempotent rewrite). Mirrors Slice 2's NFR4 stance. Test covers. |
| Pre-DDL drift check: marker absent (greenfield DB) | **Handle (proceed)** | The check short-circuits when `appMarker === null`. Apply proceeds normally; the runner handles the null-marker case. Test covers. |
| Pre-DDL drift check: marker present, graph empty | **Refuse (markerMismatch)** | The genuinely-weird state. `fix` text suggests `migration plan` (which auto-baselines per Slice 3) or repopulating the graph from VCS. Test covers. |
| Pre-DDL drift check: marker present, IS a graph node | **Handle (proceed)** | Default healthy state. Apply proceeds. Test covers (regression). |
| Pre-DDL drift check: marker present, NOT a graph node, graph non-empty | **Refuse (markerMismatch)** | The **cold-clone drift** scenario the slice closes. `fix` text suggests `migration plan --from <reachable-tip>` or `ref set db <marker-hash>`. Test covers — this is the slice's defining refuse path. |
| Pre-DDL drift check + `--to <ref-or-hash>` provided | **Handle (drift check fires independently)** | Drift is about START, not END. The check uses the live marker as the START point regardless of `--to`. Test covers. |
| Pre-DDL drift check passes; runner returns `MIGRATION_PATH_NOT_FOUND` | **Refuse (improved `pathUnreachable`)** | This is the in-graph-walk failure case — marker IS a graph node, but no path exists to the destination. Diagnostic gets the new `fix` text. Test covers. |
| Pre-DDL drift check passes; runner returns `RUNNER_FAILED` (DDL error) | **Refuse (existing generic mapping)** | Unchanged behavior; the existing `errorRuntime` wrapper handles it. Test covers (regression). |
| `migrate --json` with `markerMismatch` refuse | **Handle** | Structured error surfaces in JSON via `handleResult`'s existing path. Test covers. |
| `migrate --json` with successful `--advance-ref` | **Handle** | `advancedRef: { name, hash }` field surfaces in the JSON envelope. Test covers. |
| `migrate --quiet` with `--advance-ref` | **Handle** | The `Advanced ref ...` line is suppressed in `--quiet` mode but the `--json` envelope (if requested) still carries `advancedRef`. Test covers. |
| `migrate` with extension packs declared | **Handle (drift check is app-only)** | Per project spec NFR5: extension-space drift is the runner's job. Pre-DDL drift check only validates the app member's marker. Extension-space migration packages flow through `migrationApply` unchanged. Test covers. |
| Pre-DDL drift check is bypassed via `--force` (NOT implemented in this slice) | **Explicitly out** | No force flag. If a real workflow needs to bypass the drift check, that's its own discussion. The drift check is hard-refuse for this slice. |
| `markerMismatch` + the marker was advanced by `db update` past graph (similar to plan-time forgot-the-flag) | **Refuse cleanly** | The forgot-the-flag is the planner-side counterpart (Slice 3); `markerMismatch` is the runner-side counterpart for the same state. The `fix` text difference: planner says "use `--from <reachable>`"; runner says "run `migration plan` to formalize the gap, then re-run `migrate`." Tests cover both sides. |

## Slice Definition of Done

Per `drive/calibration/dod.md § Slice-DoD overlay` + the canonical SDoD:

- [ ] **SDoD1.** All "Done when" gates from the slice plan pass: `pnpm typecheck`, `pnpm vitest run` direct in `@prisma-next/cli`, `pnpm vitest run` direct in `test/integration/`, `pnpm lint:deps`, `pnpm build --filter @prisma-next/cli`, `pnpm fixtures:check`.
- [ ] **SDoD2.** Every pre-named edge case handled per its disposition. The "explicitly out" rows (force flag) are documented as out-of-scope in spec; no implicit handling.
- [ ] **SDoD3.** Reviewer verdict `SATISFIED` on `projects/dev-to-ship-migration-handoff/reviews/code-review.md`.
- [ ] **SDoD4.** Manual-QA — **required**: this slice closes the project's J4 trap end-to-end. The `manual-qa.md` extends the slice-3 J4 walkthrough with the `migrate --advance-ref db` step + the cold-clone drift scenario. Authored at slice close-out via `drive-qa-plan`.
- [ ] **SDoD5.** Slice doesn't touch out-of-scope surfaces: no edits to `db-init.ts`, `db-update.ts`, `migration-plan.ts`, `ref.ts`. No subsystem-doc edits. No `@prisma-next/migration-tools/` source modifications. No runner / visitor-SPI changes.
- [ ] **SDoD6.** Existing `migrate.ts` tests still pass unmodified, except where the pre-DDL drift check changes test fixture expectations (some existing tests may need updating to include marker setup that satisfies the new check). The slice plan enumerates which tests need touching at dispatch time.
- [ ] **SDoD7.** No new public-export drift: `pnpm lint:deps` clean. No new exports outside `@prisma-next/cli`. Slice 1's primitives (`isGraphNode`, `writeRefPaired`) are consumed via existing exports.

## Open Questions

1. **Error code naming for the pre-DDL refuse.** Options: `MIGRATION.MARKER_MISMATCH`, `MIGRATION.MARKER_NOT_IN_GRAPH`, `MIGRATION.MARKER_NOT_REACHABLE`. Working position: `MIGRATION.MARKER_MISMATCH` (project spec § FR17 uses "drift"; "mismatch" reads naturally). Decide at dispatch time after grepping existing error code conventions.
2. **Error code naming for the improved `pathUnreachable`.** The existing failure code is `MIGRATION_PATH_NOT_FOUND` (in `MigrationApplyFailureCode`); the CLI's mapping may use a different shape. Working position: keep the runner-side failure code unchanged + introduce a CLI-side meta-code `MIGRATION.PATH_UNREACHABLE` that maps to it. Decide at dispatch time.
3. **`MigrateResult.advancedRef` shape vs `MigrationCommandResult` shape.** Slice 2's envelope uses `advancedRef?: { name; hash } | null` and `plannedAdvanceRef?: { name; hash } | null` (the latter for dry-run mode). `migrate` has no dry-run, so only `advancedRef` is relevant. Confirm at dispatch time.
4. **Pre-DDL drift check ordering vs invariant validation.** The existing `migrate.ts` does invariant validation at L232 (`if (refEntry && refEntry.invariants.length > 0)`) AFTER `client.connect`. The new drift check should run BEFORE invariant validation (drift is a stronger refuse — invariants don't matter if the apply itself can't proceed). Final ordering at dispatch time.
5. **Extension-space markers and the drift check.** Project spec NFR5 says extension-space drift is the runner's job; this slice's pre-DDL drift check is app-only. Confirm at dispatch time that this stance is correct — i.e., the drift check pulls `allMarkers.get('app')` only, not every marker.
6. **Recovery affordance: `migration recover` command.** Project spec OQ1 deferred. If close-out decision says "ship the command", that's its own slice (not this one). The diagnostic `fix` text in this slice references existing commands (`migration plan`, `ref set`), not `migration recover`.

## References

- Parent project: [`projects/dev-to-ship-migration-handoff/spec.md`](../../spec.md) §§ FR8, FR9 (runner), FR17, NFR6, PDoD4 (runner), PDoD5
- Project plan: [`projects/dev-to-ship-migration-handoff/plan.md`](../../plan.md) § Stack 4
- Project design notes: [`projects/dev-to-ship-migration-handoff/design-notes.md`](../../design-notes.md)
- Project scenarios: [`projects/dev-to-ship-migration-handoff/scenarios.md`](../../scenarios.md) — cold-clone drift + J4 trap-closing exercise this slice
- CLI surface delta: [`projects/dev-to-ship-migration-handoff/cli-surface.md`](../../cli-surface.md)
- Foundation slice: [`../foundation-refs-paired-snapshots/spec.md`](../foundation-refs-paired-snapshots/spec.md) — consumes `writeRefPaired`, `isGraphNode`
- Slice 2 (helper source): [`../db-cmds-ref-integration/spec.md`](../db-cmds-ref-integration/spec.md) — reuses `cli/src/utils/ref-advancement.ts`
- Slice 3 (sister slice): [`../plan-ref-aware-and-auto-baseline/spec.md`](../plan-ref-aware-and-auto-baseline/spec.md) — planner-side counterpart of the universal "from must be a graph node" invariant
- Existing `migrate` command: [`packages/1-framework/3-tooling/cli/src/commands/migrate.ts`](../../../../packages/1-framework/3-tooling/cli/src/commands/migrate.ts)
- Linear issue: _not created (operator declined Linear sync)_
