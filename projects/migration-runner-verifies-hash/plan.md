# Verify migration package integrity at load time — Plan

This plan executes the [spec](./spec.md): hoist the on-disk `migrationHash` integrity check out of the `migration apply` CLI command and into `readMigrationPackage` in `@prisma-next/migration-tools`, so every consumer (CLI commands, the future in-process apply path, the control client) inherits verification by construction. The same PR also cleans up vocabulary and file layout in `@prisma-next/migration-tools` (rename `migrationId` → `migrationHash`, `MigrationBundle` → `MigrationPackage`, `MigrationManifest` → `MigrationMetadata`; split `types.ts` into per-concept files; rename `attestation.ts` → `hash.ts`).

## Summary

The integrity work itself is small: one loader gets one extra step, one structured error gets added, one CLI loop gets deleted, one helper gets removed, two pieces of JSDoc get updated. The naming/structure refactor is mechanical but wide: type renames, field renames, file split, and a one-off codemod for 113 on-disk `migration.json` files. We sequence the integrity work first (Phases 1-3), then the rename + restructure (Phases 4-6), so each phase has a clear "what changed" frame and the integrity behavior is testable before we churn through identifiers.

**Spec:** [`spec.md`](./spec.md)

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | TBD (assignee on TML-2264) | Drives execution end-to-end. |
| Reviewer | Migration system owner | Reviews loader-boundary semantics + JSDoc invariants. |
| Coordination | Author of TML-2301 | The `Migration.run()` orchestrator added in TML-2301 must consume `readMigrationPackage` rather than raw `fs.readFile`; coordinate so the verifying loader exists when their wiring lands. Also: `MigrationMeta` rename (open question 3) is theirs to decide during the `migration-base.ts` split. |

## Critical risks up front

**False positives.** A bug in `computeMigrationHash` (e.g. canonicalization difference between write-time and verify-time) would manifest as every existing migration directory failing to load, blocking every migration command. Mitigation: the existing unit tests in `packages/1-framework/3-tooling/migration/test/attestation.test.ts` (round-trips a write → read → re-hash for fixtures) already gate this; we extend them rather than replace them. Phase 1 lands the new loader behavior under those tests before any consumer flips over. Additionally, the `pnpm test:integration` suite exercises every migration command's happy path against fixture directories — if canonicalization regressed, that suite fails before the new tampering tests do.

**Wire-format codemod accidentally re-hashing.** The codemod must rename only the JSON key, not re-emit the file. A naive implementation that round-trips the JSON could subtly change formatting (e.g. trailing newlines, quote style) without changing semantic content; the hash check still passes because `computeMigrationHash` strips the field before hashing. But sloppy serialization could still produce a noisy diff. Mitigation: the codemod (Phase 5) preserves the original `JSON.stringify` shape (2-space indent + trailing newline, matching the writer in `io.ts`); the resulting diff for each file is one-line.

**TML-2301 timing.** TML-2301 introduces a new on-disk loading path inside the `Migration.run()` orchestrator. If TML-2301 lands first and uses raw `fs.readFile` + `JSON.parse`, that path is exempted from verification. Mitigation: explicit cross-link in the TML-2301 spec, plus a one-line review check on its PR ("does it call `readMigrationPackage`?"). If TML-2301 lands first, this project's PR includes the trivial conversion.

**Rename conflicts with TML-2301.** TML-2301 splits `migration-base.ts` and may touch the same imports we rename here. Mitigation: rebase if necessary; both PRs change the same identifiers in the same files in mostly-compatible ways. The conflict surface is small (a half-dozen import lines).

## Where we're going

```
packages/1-framework/3-tooling/migration/src/
├── canonicalize-json.ts     # unchanged
├── dag.ts                   # imports updated; identifier renames
├── errors.ts                # + errorMigrationHashMismatch; rename errorDuplicateMigrationId → errorDuplicateMigrationHash
├── hash.ts                  # ⤳ renamed from attestation.ts
│                            #   exports: computeMigrationHash, verifyMigrationHash
│                            #   structural-canonicalization JSDoc on computeMigrationHash
├── io.ts                    # readMigrationPackage performs hash verification
│                            #   field/identifier renames
├── metadata.ts              # ⤳ extracted from types.ts
│                            #   exports: MigrationMetadata, MigrationHints
├── migration-base.ts        # imports updated; identifier renames (MigrationMeta kept as-is)
├── package.ts               # ⤳ extracted from types.ts
│                            #   exports: MigrationPackage, MigrationOps
│                            #   (MigrationOps lives here because a package contains ops)
└── graph.ts                 # ⤳ extracted from types.ts
                             #   exports: MigrationGraph, MigrationChainEntry

packages/1-framework/3-tooling/migration/src/exports/
└── (subpath barrels updated to match new files; ./types subpath replaced or barrel'd — open question 1)

packages/1-framework/3-tooling/cli/src/commands/
└── migration-apply.ts       # ⤳ delete the verifyMigrationBundle loop (and its import)

packages/1-framework/3-tooling/cli/src/utils/
└── command-helpers.ts       # loadMigrationBundles → loadMigrationPackages, loadAllBundles → loadAllMigrationPackages

packages/1-framework/1-core/framework-components/src/
└── control-migration-types.ts  # JSDoc note on MigrationRunner.execute: callers verify upstream

packages/1-framework/3-tooling/cli/src/control-api/operations/
└── migration-apply.ts       # JSDoc note on executeMigrationApply: pendingMigrations is trusted input

examples/**/migration*/*/migration.json   # 113 files: top-level field migrationId → migrationHash
```

## Concept cheatsheet

> Names below are the **target** names (post-rename). Where the current name differs, it appears in parentheses.

| Concept | What it is | Defined in |
|---|---|---|
| `MigrationPackage` (was `MigrationBundle`) | In-memory representation of an on-disk migration package: `{ dirName, dirPath, metadata, ops }`. | `migration-tools/src/package.ts` |
| `MigrationMetadata` (was `MigrationManifest`) | The full in-memory metadata record (parsed from `migration.json`). | `migration-tools/src/metadata.ts` |
| `computeMigrationHash(metadata, ops)` (was `computeMigrationId`) | Pure function: stripped metadata + ops → `sha256:…`. Stable; ADR 199. JSDoc carries the structural-canonicalization rationale. | `migration-tools/src/hash.ts` |
| `verifyMigrationHash(pkg)` (was `verifyMigrationBundle`) | Recompute hash from `pkg.metadata` + `pkg.ops`, compare to `pkg.metadata.migrationHash`. Returns `{ ok, storedHash, computedHash }`. | `migration-tools/src/hash.ts` |
| `readMigrationPackage(dir)` | Loader: read `migration.json` + `ops.json`, structurally validate, return `MigrationPackage`. **After this project: also verifies, throws on mismatch.** | `migration-tools/src/io.ts` |
| `readMigrationsDir(root)` | Enumerator: applies `readMigrationPackage` to every subdir. Inherits verification. | `migration-tools/src/io.ts` |
| `loadAllMigrationPackages(migrationsDir)` (was `loadAllBundles`) | CLI helper: wraps `readMigrationsDir` + reconstructs the migration graph. | `cli/src/utils/command-helpers.ts` |
| `MigrationToolsError` | Structured error class (`code`, `category`, `why`, `fix`, `details`). | `migration-tools/src/errors.ts` |
| `MigrationRunner.execute({ plan, … })` | Per-target SPI; consumes `MigrationPlan` (no `migrationHash`). Trusted input — does not verify. | `framework-components/src/control-migration-types.ts` |

## Phases

The work splits into three integrity-behavior phases (1-3) and three rename-and-restructure phases (4-6), then close-out. They can ship in a single PR but are reviewed in this order.

### Pre-flight — Architectural pre-conditions

The spec's load-bearing claim is that adding integrity verification to `readMigrationPackage` covers every existing on-disk loading path by construction (see [`spec.md` § Where the loader lives](./spec.md#where-the-loader-lives)). That assumption must hold *before* Phase 1 ships, not after — otherwise Phase 1's design is insufficient and would need either an additional verification call at the offending site, or a refactor to route through the loader.

**Tasks:**

- [ ] **T0.1 — Audit other on-disk loaders.** Grep for `readFile.*migration\.json`, `JSON\.parse.*manifest`, and any direct `fs` reads of migration files in `packages/`. Confirm zero non-loader paths construct a `MigrationBundle`/`MigrationPackage` from disk. Expected: only `migration-tools/src/io.ts` (the loader itself) shows up; test files reading `migration.json` for assertions are fine because they don't construct a bundle. **If the audit surfaces any production-source violation, STOP and surface to the parent agent / spec author** — that's a correctness invalidation of the spec, not a finding to address inside Phase 1.

**Validation gate for Pre-flight:** the audit returns zero non-loader bundle constructions in production source. Phase 1 cannot start until this gate passes.

### Phase 1 — Verifying loader (integrity behavior)

Add the integrity check to `readMigrationPackage` and the supporting error factory. Land tests-first per repo convention. Uses **current** names; the rename comes later.

**Tasks:**

- [ ] **T1.1 — Add `errorBundleCorrupt` factory.** In `packages/1-framework/3-tooling/migration/src/errors.ts`, add `errorBundleCorrupt(dir, storedMigrationId, computedMigrationId)` returning a `MigrationToolsError` with code `'MIGRATION.BUNDLE_CORRUPT'`. Mirror the prose shape from the deleted CLI error (see `migration-apply.ts:217-227`). (This factory is renamed to `errorMigrationHashMismatch` with code `MIGRATION.HASH_MISMATCH` in Phase 4.)
- [ ] **T1.2 — Add unit tests for the new loader behavior.** In `packages/1-framework/3-tooling/migration/test/io.test.ts` (or a sibling): three cases — happy path returns the bundle (regression of existing behavior); `ops.json` post-write tamper throws `MIGRATION.BUNDLE_CORRUPT` with populated `details`; `migration.json` field tamper (e.g. mutate `labels`) throws same. Reuse `writeMigrationPackage` + `createTestManifest` / `createTestOps` from `test/fixtures.ts`. Tests must fail before T1.3.
- [ ] **T1.3 — Wire verification into `readMigrationPackage`.** In `packages/1-framework/3-tooling/migration/src/io.ts`, after `validateOps`, call `verifyMigrationBundle` on the constructed bundle and throw `errorBundleCorrupt` if `result.ok === false`. T1.2 tests now pass.
- [ ] **T1.4 — Remove `verifyMigration(dir)`.** Delete the function from `packages/1-framework/3-tooling/migration/src/attestation.ts`. Remove its re-export from `src/exports/attestation.ts`. Update `test/attestation.test.ts` cases that called `verifyMigration` to call `readMigrationPackage` directly and assert on the thrown `MigrationToolsError` (the existing tests "detects tampered ops" and "detects tampered manifest field" — see `test/attestation.test.ts:186-249`).
- [ ] **T1.5 — Verify `verifyMigrationBundle` stays public and unchanged.** No code change; check `src/exports/attestation.ts` still exports it and its existing in-memory test (`test/attestation.test.ts:199-232`) still passes.

**Validation gate for Phase 1:** `pnpm -F @prisma-next/migration-tools test` passes, including the new tampering cases. `pnpm -F @prisma-next/migration-tools build` passes.

**Release coupling — Phase 1 must ship together with Phase 2.** Do not land Phase 1 on `main` without Phase 2's commit alongside it. The intermediate state ships double verification: every successful `migration apply` recomputes each package's hash twice (once inside `readMigrationPackage`, once inside the still-present CLI loop in `migration-apply.ts`). The cost is small and the path is not hot, but the duplication is wasted work and could surface as confusing diagnostics if a future test asserts on the loop's `errorRuntime` error shape vs. the loader's `errorBundleCorrupt`/`errorMigrationHashMismatch` shape. As of this plan a grep confirms no such test exists today; the constraint exists to avoid surprises if one is added between phases.

### Phase 2 — CLI clean-up + invariant docs (integrity behavior)

Drop the now-redundant CLI loop and document the trusted-input invariant on the runner SPI and the framework operation. No behavior change for consumers.

**Release coupling — Phase 2 must ship together with Phase 1.** Same constraint as the gate above. Phase 2 deletes the CLI loop that Phase 1 made redundant; landing Phase 2 without Phase 1 would remove the only verification step entirely (a correctness regression), and landing Phase 1 without Phase 2 leaves a wasted second hash per package on the apply path. The two phases are reviewed separately for clarity but always commit-pair on `main`.

**Tasks:**

- [ ] **T2.1 — Delete the CLI verification loop.** In `packages/1-framework/3-tooling/cli/src/commands/migration-apply.ts`: delete the `for (const bundle of migrations.bundles) { … }` block (lines 213-233 at HEAD). Delete the `verifyMigrationBundle` import on line 1.
- [ ] **T2.2 — Add JSDoc invariant to `MigrationRunner.execute`.** In `packages/1-framework/1-core/framework-components/src/control-migration-types.ts:334-361`, augment the existing comment block with a paragraph: "The `plan` parameter is trusted input. Callers are responsible for upstream verification of the originating migration package — typically by obtaining the package via `readMigrationPackage` from `@prisma-next/migration-tools/io`, which performs hash-integrity checks at the load boundary."
- [ ] **T2.3 — Add JSDoc invariant to `executeMigrationApply`.** In `packages/1-framework/3-tooling/cli/src/control-api/operations/migration-apply.ts`, add the same note (adapted to refer to `pendingMigrations`) to the operation function's docstring.

**Validation gate for Phase 2:** `pnpm -F @prisma-next/cli typecheck` passes, `pnpm -F @prisma-next/cli build` passes, `pnpm -F @prisma-next/cli test` passes (existing happy-path tests should be unchanged; if any test was implicitly depending on the duplicate verification loop's logging/wording, update it to match the new diagnostic).

### Phase 3 — End-to-end coverage (integrity behavior)

Prove the integration: every CLI command that loads packages hard-fails on tamper, with the unified diagnostic. The "same diagnostic across commands" property in the spec is a uniformity guarantee, not a presence guarantee — substring assertions are too weak to catch divergence (e.g. one command rendering `why`/`fix` while another renders only the code). Each tamper test below captures the rendered diagnostic text into a shared collection; a final assertion in T3.5 proves text equality across commands.

**Shared test scaffolding.** The four tamper tests share a fixture pattern. A test-only helper (likely in `cli/test/commands/_shared/diagnostic-fixture.ts` or co-located in each test) sets up a valid migration directory, mutates `ops.json` post-creation (append a synthetic op), invokes the CLI command, and returns the captured diagnostic text plus exit code. Each test asserts on its own row (non-zero exit + `MIGRATION.BUNDLE_CORRUPT` substring); the cross-command equality assertion is centralized in T3.5 (or an equivalent shared spec) so the uniformity property is testable in one place.

**Tasks:**

- [ ] **T3.1 — `migration apply` tamper integration test.** Add a case to `packages/1-framework/3-tooling/cli/test/commands/migration-apply.test.ts` (or its e2e sibling): set up a valid migration directory, mutate `ops.json` post-creation (append a synthetic op), invoke `migration apply`, assert non-zero exit + `MIGRATION.BUNDLE_CORRUPT` substring in the diagnostic. Capture the rendered diagnostic text into a shared collection (see scaffolding above) for the equality check in T3.5.
- [ ] **T3.2 — `migration plan` tamper integration test.** Same pattern in `migration-plan.test.ts`. Verify the diagnostic surfaces before any planning work happens. Capture the rendered diagnostic text into the shared collection.
- [ ] **T3.3 — `migration status` tamper integration test.** Same pattern in a `migration-status.test.ts` (create if missing — confirm whether one exists by quick scan of `packages/1-framework/3-tooling/cli/test/commands/`). Capture the rendered diagnostic text into the shared collection.
- [ ] **T3.4 — `migration show` tamper integration test.** Same pattern in `migration-show.test.ts` (`readMigrationPackage` is called directly here, not through `loadAllBundles`). Capture the rendered diagnostic text into the shared collection.
- [ ] **T3.5 — Cross-command diagnostic-equality assertion.** Add a single assertion (in a shared spec or as the final step of the suite) that proves text equality across all four commands — concretely: `expect(new Set(diagnosticTexts).size).toBe(1)` or an equivalent canonical-string comparison. This is the assertion that pins the spec's "same human-readable diagnostic regardless of which command triggered the load" acceptance criterion. Substring presence (T3.1-T3.4) is a necessary but not sufficient condition; this task is what catches divergence (e.g. one command rendering only the code while another renders the full `why`/`fix`).
- [ ] **T3.6 — Confirm existing happy-path integration tests are untouched.** Run `pnpm -F @prisma-next/cli test:integration` (or repo-equivalent); zero pre-existing tests should need adjustment apart from the diagnostic-text change in `migration apply`'s tamper test from before this work (if such a test existed for the now-removed CLI loop).
- [ ] **T3.7 — File the emit-drift follow-up Linear issue.** Title: "Implement ADR 192 step 2: emit-drift detection for `migration.ts`". Description: re-emit `migration.ts` in-memory at apply time and compare its hash to `ops.json`; covers the user-edited-migration.ts-after-emit failure mode that the bundle-integrity check does not. File under WS4 / M11. Link this spec from the new issue and link the new issue from `spec.md` § Out of scope.

**Validation gate for Phase 3:** `pnpm test:integration` passes; the four new tamper cases all hit the new diagnostic; the cross-command equality assertion from T3.5 passes (proving uniformity, not just presence); `pnpm lint:deps` reports zero violations (no new cross-plane edges introduced).

> **Checkpoint:** at the end of Phase 3 the integrity work is complete and could ship as-is. Phases 4-6 are the naming + restructure cleanup that's bundled into the same PR.

### Phase 4 — Type renames + file split

Land the type renames and the `types.ts` split. This is the biggest single source-code diff in the project but it is mechanical: one search-and-replace per identifier, plus moving definitions between files.

**Tasks:**

- [ ] **T4.1 — Create `metadata.ts`.** Extract `MigrationManifest` and `MigrationHints` from `types.ts` into a new `packages/1-framework/3-tooling/migration/src/metadata.ts`. Rename the interface to `MigrationMetadata`. Update its JSDoc to use "metadata" vocabulary (e.g. "metadata envelope" instead of "manifest envelope"). Re-export from `types.ts` as a barrel during this task to keep imports green; delete the barrel in T4.7.
- [ ] **T4.2 — Create `package.ts`.** Extract `MigrationBundle` from `types.ts` into `packages/1-framework/3-tooling/migration/src/package.ts`. Rename the interface to `MigrationPackage`. Rename its `manifest` field to `metadata`. Also move `MigrationOps` from `types.ts` into `package.ts` — it lives here because a package contains ops. Re-export both types from `types.ts` as a barrel.
- [ ] **T4.3 — Create `graph.ts`.** Extract `MigrationGraph` and `MigrationChainEntry` from `types.ts` into `packages/1-framework/3-tooling/migration/src/graph.ts`. Rename the `migrationId` field on `MigrationChainEntry` to `migrationHash`. Re-export from `types.ts` as a barrel.
- [ ] **T4.4 — Rename `attestation.ts` → `hash.ts`.** `git mv packages/1-framework/3-tooling/migration/src/attestation.ts packages/1-framework/3-tooling/migration/src/hash.ts`. Inside the file: rename `computeMigrationId` → `computeMigrationHash`; rename `verifyMigrationBundle` → `verifyMigrationHash`; rename `VerifyResult.storedMigrationId/computedMigrationId` → `storedHash/computedHash`; update parameter names (`manifest` → `metadata`, `bundle` → `pkg`); rewrite the JSDoc on `computeMigrationHash` per [`spec.md` § Documentation home](./spec.md#documentation-home); add a brief JSDoc on `verifyMigrationHash` pointing at it.
- [ ] **T4.5 — Update `errors.ts`.** Rename `errorBundleCorrupt` → `errorMigrationHashMismatch`; rename its code `MIGRATION.BUNDLE_CORRUPT` → `MIGRATION.HASH_MISMATCH`; update parameter names (`storedMigrationId/computedMigrationId` → `storedHash/computedHash`). Rename `errorDuplicateMigrationId` → `errorDuplicateMigrationHash` and its code `MIGRATION.DUPLICATE_MIGRATION_ID` → `MIGRATION.DUPLICATE_MIGRATION_HASH`. Update prose in unrelated factories that mention "migrationId" to say "migrationHash".
- [ ] **T4.6 — Update consumers.** Search-and-replace identifiers across `packages/`:
  - `MigrationBundle` → `MigrationPackage`
  - `MigrationManifest` → `MigrationMetadata`
  - `migrationId` → `migrationHash` (TS only; the JSON field rename is Phase 5)
  - `bundle.manifest` → `pkg.metadata`
  - `computeMigrationId` → `computeMigrationHash`
  - `verifyMigrationBundle` → `verifyMigrationHash`
  - `verifyMigrationBundle` import path `@prisma-next/migration-tools/attestation` → `@prisma-next/migration-tools/hash`

  Files affected: `migration-tools/src/{io,errors,migration-base,dag}.ts`, `migration-tools/test/**/*.ts`, `cli/src/commands/migration-{apply,plan,show,status,new}.ts`, `cli/src/utils/command-helpers.ts`, `cli/test/**/*.ts`. Exclude `migration-base.ts`'s `MigrationMeta` (kept as-is per Decision 7 and open question 3).
- [ ] **T4.7 — Delete `types.ts`.** Once T4.1-T4.6 are green and all consumers import from the per-concept files, remove the barrel re-exports in `types.ts` and `git rm` the file. Update `package.json` `exports` per open question 1: replace `./types` with `./metadata`, `./package`, `./graph` subpaths, **or** keep `./types` as a barrel pointing at the three. (Default in spec: replace.)

**Validation gate for Phase 4:** `pnpm -F @prisma-next/migration-tools test` passes; `pnpm -F @prisma-next/cli test` passes; `pnpm typecheck` passes across the workspace; all the previously-added integration tests in Phase 3 still pass with their assertion strings updated to `MIGRATION.HASH_MISMATCH`.

### Phase 5 — Wire-format codemod for `migration.json`

Rename the on-disk JSON field `migrationId` → `migrationHash` in all 113 `migration.json` files. Mechanical and one-off.

**Tasks:**

- [ ] **T5.1 — Run the codemod.** Execute the script from [`spec.md` § Wire-format migration](./spec.md#wire-format-migration) against the workspace root. Verify with `git diff --stat` that all 113 files are touched and only the top-level field name changed (no value changes, no formatting changes other than the field's position).
- [ ] **T5.2 — Update arktype schema.** In `migration-tools/src/io.ts`, the schema `MigrationMetadataSchema` (renamed from `MigrationManifestSchema` in T4.4 or done here) lists `migrationHash: 'string'` (renamed from `migrationId: 'string'`). This is the wire-format validation point.
- [ ] **T5.3 — Run the full test suite.** `pnpm test` across the workspace. Migration-graph fixture tests (`packages/1-framework/3-tooling/migration/test/dag.test.ts` and similar) must reconstruct correctly from the renamed fields. CLI integration tests that load `examples/**/migration-fixtures/` must pass.
- [ ] **T5.4 — Sanity-check hash values.** Pick one of the example app migrations (e.g. `examples/prisma-next-demo/migrations/20260422T0720_initial/`); manually run `readMigrationPackage` on it (e.g. via a one-off script) and confirm the loader does not throw. This validates that the field rename did not break hash verification.

**Validation gate for Phase 5:** `pnpm test` (workspace-wide) passes. Every `migration.json` under the repo carries `migrationHash`, none carries `migrationId`. `rg '"migrationId"' --type json` (against the workspace, excluding `node_modules`) returns zero hits.

### Phase 6 — CLI helper renames + README refresh

The mechanical tail of the rename work: CLI helper functions and the package's README.

**Tasks:**

- [ ] **T6.1 — Rename CLI helpers.** In `packages/1-framework/3-tooling/cli/src/utils/command-helpers.ts`: `loadMigrationBundles` → `loadMigrationPackages`, `loadAllBundles` → `loadAllMigrationPackages`, `MigrationBundleSet` (or whatever the wrapping type is — verify name during execution) → `MigrationPackageSet`. Update all call sites in `cli/src/commands/` and `cli/test/`.
- [ ] **T6.2 — Refresh package READMEs.** Two READMEs require terminology + framing updates from the integrity work and the rename:
  - **`migration-tools/README.md`.** Update terminology throughout (`MigrationBundle` → `MigrationPackage`, `migrationId` → `migrationHash`, `attestation` → `hash` where it refers to the file/subpath, etc.). Replace the "Attestation framing" section with a corrected description: post-ADR-199, `computeMigrationHash` hashes a 2-tuple of (canonical stripped metadata, canonical ops), not a 4-tuple. Update the architecture mermaid diagram to reflect new file names. Update the "Export Subpaths" table.
  - **`cli/README.md`.** Rewrite step 2 of `migration apply` "What it does" (around line 1038) to describe the load-boundary check instead of the now-deleted apply-time loop; use Phase 4 vocabulary so it lands once. The current text reads: *"**Defense in depth:** rehashes `(manifest, ops)` for each loaded bundle and confirms it matches the stored `migrationId`. If a bundle has been hand-edited or partially written since emit, apply aborts with a structured runtime error pointing at the offending directory and asks the developer to re-run `node migrations/<dir>/migration.ts` (or restore from version control)."* The replacement should describe the check happening at `readMigrationPackage` time (in step 1's wording, since step 1 is the package-load step) and use `migrationHash` / `MigrationPackage` / "metadata + ops" vocabulary. Audit the rest of the file for any other `migrationId` / `MigrationBundle` / `attestation` drift while you're there.
- [ ] **T6.3 — Final search audit.** `rg 'migrationId|MigrationBundle|MigrationManifest|verifyMigrationBundle|computeMigrationId|loadMigrationBundles|loadAllBundles' packages/ examples/` should return zero hits in production source (the only acceptable hits are in test fixture *file names* like `attestation.test.ts` if tests weren't renamed — note as cleanup if any). `attestation.ts` should not exist.

**Validation gate for Phase 6:** `pnpm test` passes. The audit at T6.3 returns no production hits. `pnpm build` across the workspace passes.

### Close-out (last commits of the implementation PR)

- [ ] **C1 — Verify acceptance criteria.** Walk through `spec.md` § Acceptance criteria; tick each box (in the PR description, not in the spec — the spec is about to be deleted).
- [ ] **C2 — Long-lived doc updates.** This project does not produce new ADRs; the existing ADR 192 already documents the two-step verification model. Optionally update ADR 192's "Verification on apply" section to remove the parenthetical noting that step 1 lives in CLI code (it now lives in the loader). ADR 199 is **not** retroactively edited — it was written using the term `migrationId` and that's the historical record. The structural-canonicalization rationale lives permanently as JSDoc on `computeMigrationHash` (per [`spec.md` § Documentation home](./spec.md#documentation-home)).
- [ ] **C3 — Strip references.** Grep the repo for `projects/migration-runner-verifies-hash`. Replace any references with canonical doc links (likely none beyond this folder itself).
- [ ] **C4 — Delete the project folder.** Last commit removes `projects/migration-runner-verifies-hash/` in its entirety.

## Test coverage

Every acceptance criterion in `spec.md` is mapped to a test below. Identifiers below use the **target** names; tests added in Phase 1-3 use the current names and get renamed in Phase 4.

| Acceptance criterion | Test type | Task | Notes |
|---|---|---|---|
| `readMigrationPackage` throws `MIGRATION.HASH_MISMATCH` on hash mismatch with populated `details` | Unit | T1.2 (both tampering cases) | New cases in `migration-tools/test/io.test.ts`. Code/error name swap during T4.5. |
| `readMigrationsDir` propagates the same error from any failing child | Unit | T1.2 (extend with one multi-package case) | Reuse the same fixture pattern; assert error propagates from one bad subdir. |
| `migration apply` hard-fails on tampered package with the unified diagnostic | Integration | T3.1 | Replaces equivalent test against the deleted CLI loop, if one existed. |
| `migration plan` hard-fails on tampered package | Integration | T3.2 | New. |
| `migration status` hard-fails on tampered package | Integration | T3.3 | New (and confirms the `loadAllMigrationPackages` path covers status). |
| `migration show` hard-fails on tampered package | Integration | T3.4 | Direct `readMigrationPackage` caller — exercises the non-`loadAllMigrationPackages` path. |
| `migration new` hard-fails on tampered package when reading the existing graph | Integration | (deferred) | `migration new` calls `readMigrationsDir` to compute `from`. The change makes this fail at the loader; covering this with a dedicated test is low-value relative to the other four. **Decision:** rely on T1.2 (loader-level) + the unified diagnostic; do not add a CLI-level test for `migration new` unless a reviewer disagrees. |
| Same diagnostic text across all commands | Integration | T3.5 (text equality) — set on top of T3.1-T3.4 (presence) | T3.5 asserts `expect(new Set(diagnosticTexts).size).toBe(1)` over the four commands' captured outputs. Substring presence alone is too weak (one command could render `why`/`fix` while another renders only the code). |
| Intact-package apply behaves identically pre/post change | Integration | T3.6 | Existing happy-path suite passes without modification. |
| `verifyMigration(dir)` removed; no production references | Static | T1.4 + grep audit | `rg verifyMigration packages/` returns zero hits in `src/` after deletion. |
| `verifyMigrationHash` API at `migration-tools/src/hash.ts` | Unit | T4.4 + T1.5 | Existing in-memory test (renamed from `attestation.test.ts`) still passes. |
| `migration-apply.ts` no longer imports `verifyMigrationBundle`/`verifyMigrationHash` and has no per-package loop | Static | T2.1 + grep | Trivial verification. |
| `MigrationRunner.execute` JSDoc carries the trusted-input invariant | Manual | T2.2 | Reviewer-checked; no automated assertion. |
| `executeMigrationApply` JSDoc carries the trusted-input invariant | Manual | T2.3 | Reviewer-checked. |
| `types.ts` deleted; per-concept files exist | Static | T4.7 + grep | `ls packages/1-framework/3-tooling/migration/src/` shows `metadata.ts`, `package.ts`, `graph.ts`; no `types.ts`. |
| `attestation.ts` renamed to `hash.ts` | Static | T4.4 | `git log --diff-filter=R` shows the rename. |
| All 113 on-disk `migration.json` files carry `migrationHash` | Static | T5.3 | `rg '"migrationId"' --type json` returns zero. |
| `computeMigrationHash` carries the structural-canonicalization JSDoc | Manual | T4.4 | Reviewer-checked against the verbatim text in `spec.md` § Documentation home. |
| Identifiers across `packages/` use target names | Static | T4.6 + T6.3 | Final audit at T6.3. |
| No new cross-plane edges | Static | T3.6 (lint:deps step) | `pnpm lint:deps` passes. |

## Open items

- **TML-2301 ordering.** Coordinate with the assignee. If TML-2301 merges first, add a one-line check to its PR review that `Migration.run()`'s on-disk loading goes through `readMigrationPackage` (under whichever name it has at that point). If this ticket merges first, no coordination needed beyond the cross-link in TML-2301's spec.
- **`MigrationMeta` rename.** Open question 3 in the spec. Defer to TML-2301; this PR keeps `MigrationMeta` as-is.
- **`./types` export subpath shape.** Open question 1 in the spec. Default: replace with `./metadata` + `./package` + `./graph`.
- **`errorMigrationHashMismatch` export visibility.** Open question 2. Default: export.
- **Codemod commit organization.** Open question 4. Default: single commit for all 113 files.
- **ADR 192 wording update.** Optional close-out tweak (C2); not required for the project to be considered complete.
- **Emit-drift follow-up ticket** (T3.7) is filed but not executed in this project. It belongs to the same milestone (WS4 / M11) and is a natural successor.
- **Cross-package test-helper consolidation.** `writeTestPackage` is currently duplicated as a near-identical helper across `migration-tools/test/fixtures.ts` and several CLI tests (e.g. `cli/test/commands/migration-e2e.test.ts`, `migration-plan.test.ts`). Each copy builds an attested package and writes it to disk. The duplication exists because `migration-tools` does not export a `test`/`testing` subpath the CLI tests can depend on. When Phase 4's file split + Phase 6's Export Subpaths refresh expose a clean way to publish a `@prisma-next/migration-tools/testing` subpath, consolidate to a single shared helper at that point and delete the CLI copies. Defer until then; the duplication does not block this project.
