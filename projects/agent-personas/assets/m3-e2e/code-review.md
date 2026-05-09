# Code review — PR #434 (TML-2397 M1, framework mechanism)

**Lens:** principal-engineer persona (failure modes, operability, blast radius, cost vs complexity, programming practice).
**Review target:** commit `ee05b2b4f872a2458c8a822eb3f16c0eab556933`.
**Base:** `origin/main` — review range `origin/main..ee05b2b4f`.
**Source-pinning:** every file referenced below read at `ee05b2b4f` via `git show <sha>:<path>` or `git diff origin/main..ee05b2b4f`. Workspace-tree versions of `projects/extension-contract-spaces/**` not consulted.
**Spec input:** `projects/extension-contract-spaces/spec.md` and `.../specs/framework-mechanism.spec.md` at `ee05b2b4f`. AC verification covers the **sub-spec's** AM1–AM11 (the M1-relevant criteria); the project spec's AC1–AC16 are mostly M2/M3 territory and verified at the M1-applicable subset only.

## Summary

The framework-side mechanism is well-decomposed and the helpers are pure, deterministic, and individually well-tested. Two principal-engineer-class concerns are worth surfacing before M2 consumes this surface:

1. **AM2's literal text contradicts the shipped behaviour** — the sub-spec promises "idempotent migration of a pre-1.0 single-row marker"; the implementation fail-loud-rejects it with `LEGACY_MARKER_SHAPE`. The choice is operationally defensible (and the integration tests prove the rejection works) but the spec drift is real and should not propagate into M2's expectations.
2. **The `LEGACY_MARKER_SHAPE` remediation tells the operator to `DROP TABLE prisma_contract.marker`** — a destructive op against a control-plane table that today carries the operator's last applied state. *"Pre-1.0; re-run dbInit"* is honest framing, but the failure surface gives no signal about ledger preservation, and `dbInit` re-run on a fresh marker will rehydrate from on-disk migrations rather than from the dropped row. The blast radius is bounded (pre-1.0 callers only) but the escape hatch is sharp.

Beyond those two: the helpers are well-shaped, the duplicate-rejection / sort-determinism behaviour is locked in by tests, and the `deletable-node-modules.test.ts` fixture meaningfully verifies the AM11 "no descriptor import at apply time" property at the helper layer. Architect-class typology debt around naming (see `system-design-review.md` § A01–A07) is referred to that artefact and not re-litigated here.

## What looks solid

- **Pure helpers, no implicit I/O coupling.** `planAllSpaces`, `concatenateSpaceApplyInputs`, `detectSpaceContractDrift`, `verifyContractSpaces` are all pure functions with explicit input/output types. No global state, no implicit module-load-time side effects. Refactoring or composing them in M2 is going to be cheap.
- **Duplicate-id rejection at the helper boundary.** Both `planAllSpaces` and `concatenateSpaceApplyInputs` reject duplicate `spaceId`s with `MIGRATION.DUPLICATE_SPACE_ID` *before* invoking any user callback or producing any output. The pre-callback check matters: the planner stays pure on malformed input.
- **`detectSpaceContractDrift`'s three-way discriminant.** `noDrift` / `firstEmit` / `drift` keeps the "not actually drift, just first-emit" case explicit instead of collapsing it into the no-warning path. Operationally: the consumer can format an informative log line in all three cases without re-deriving the case from the inputs.
- **The `LEGACY_MARKER_SHAPE` detector is symmetric across Postgres and SQLite.** Same probe shape (column-name presence check), same error code, same remediation. The Postgres path uses `information_schema.columns`; the SQLite path uses `PRAGMA table_info`. Cross-target consistency is the cheap right answer here.
- **`deletable-node-modules.test.ts` is honest evidence for AM11.** It deletes `node_modules` before invoking the verifier + concat helpers, and the helpers succeed. The test invents the space id inline rather than importing the synthetic fixture — that decision is load-bearing because importing the fixture would defeat the "no descriptor import" property the test claims to verify. The test's docstring calls out this discipline explicitly.
- **`canonicalizeJson` everywhere it should be.** `emitPinnedSpaceArtefacts` runs the contract through `canonicalizeJson` before write; `materialiseMigrationPackage` does the same for `metadata.toContract`. Two callers on different machines produce byte-identical pinned files. That is the property NFR2 (WYSIWYG-completeness) needs and the diff lands it.
- **Failure-on-collision rather than silent overwrite for migrations.** `materialiseMigrationPackage` uses `flag: 'wx'` on `contract.json` and inherits `wx` semantics from `writeMigrationPackage` for `migration.json` / `ops.json`. Re-running emit against an existing migration directory throws — the architect's "framework owns these files" framing applies to the *pinned* files (which overwrite); migrations themselves stay strict-create. The asymmetry is intentional and the JSDoc explains it.

## Findings

Findings get unique IDs in this artefact's local sequence (`F<NN>`).

### F01. Sub-spec AM2 contradicts shipped marker-promotion behaviour

**Location:** spec — `projects/extension-contract-spaces/specs/framework-mechanism.spec.md § 2` (at `ee05b2b4f`); implementation — [packages/3-targets/3-targets/postgres/src/core/migrations/runner.ts](packages/3-targets/3-targets/postgres/src/core/migrations/runner.ts) lines 274–319, [packages/3-targets/3-targets/sqlite/src/core/migrations/runner.ts](packages/3-targets/3-targets/sqlite/src/core/migrations/runner.ts) lines 268–308; tests — [packages/3-targets/6-adapters/postgres/test/migrations/runner.errors.integration.test.ts](packages/3-targets/6-adapters/postgres/test/migrations/runner.errors.integration.test.ts) lines 108–172.

**Issue:** AM2 says: *"Marker schema migration SQL applies idempotently against (a) a fresh `prisma_contract.marker` table, (b) **a pre-migration single-row marker**, (c) an already-migrated marker."* The implementation does NOT do (b). The runner detects the legacy single-row shape and fails the entire `execute()` call with `LEGACY_MARKER_SHAPE`, leaving the legacy table untouched. The integration test at `runner.errors.integration.test.ts` lines 130–171 explicitly asserts the legacy table is rejected and not auto-promoted.

The sub-spec's prose comment under § 2 (at `ee05b2b4f`) does acknowledge the choice obliquely: *"the previous transitional auto-migration to the per-space-row schema has been removed"* — but AM2's *literal* acceptance criterion was not updated to match the M1-cleanup F2 decision. So a reader wiring M2 against AM2 today would build to the wrong contract.

**Why it matters (failure-mode probe):** if M2's CLI consumer reads AM2 literally and assumes the runner will silently promote a pre-1.0 marker, M2 will land code that pre-checks for pre-1.0 markers, calls `runner.execute`, and expects success — and instead get a structured `LEGACY_MARKER_SHAPE` failure that needs a different code path. The spec is the contract; the contract drift is real.

**Suggestion:** rewrite AM2 to reflect the implemented behaviour. Concretely:

```
- [ ] **AM2.** Brand-new databases create the per-space marker shape directly (no auto-migration of pre-1.0 single-row markers). The runner detects a pre-1.0 single-row marker (no `space` column) and fails dbInit with a structured `LEGACY_MARKER_SHAPE` failure pointing the operator at the documented remediation. Verified by dedicated integration tests on Postgres and SQLite that exercise (a) fresh, (b) legacy-single-row → fail with `LEGACY_MARKER_SHAPE`, (c) already-migrated → succeed.
```

This isn't a code change — it's a spec-sync change. But because the project spec is the durable artefact at the close-out boundary, this needs to land.

### F02. `LEGACY_MARKER_SHAPE` remediation is destructively under-specified

**Location:** [packages/3-targets/3-targets/postgres/src/core/migrations/runner.ts](packages/3-targets/3-targets/postgres/src/core/migrations/runner.ts) lines 309–319 — error message: *"Drop `prisma_contract.marker` and re-run `dbInit` to reinitialise from a clean baseline."* Same wording in the SQLite runner.

**Issue:** the remediation tells the operator to `DROP TABLE prisma_contract.marker`. That table is the control plane's source-of-truth for "what's been applied." Dropping it on a database that has had migrations applied doesn't lose the applied DDL (the structural objects survive) but it loses the marker's *applied-content-hash* and *applied-invariants* state. The operator runs `dbInit` again; the runner sees an empty marker table and (per the verifier flow) treats every loaded space as needing initial application — which then either succeeds (idempotent migrations) or fails with `MARKER_ORIGIN_MISMATCH`-class errors against existing structural state.

The error wording is honest about *"pre-1.0"* and *"re-initialise from a clean baseline"* — but it doesn't tell the operator that the ledger row will be lost, or that the next `dbInit` will need a contract on disk that the existing DB already matches. The blast radius is bounded by the pre-1.0 framing (real customer DBs aren't expected to be in this state once 1.0 ships) but the operability hand-holding for the people who *are* in this state today is missing.

**Constraint-vs-assumption probe:** the wording assumes the operator's database is recent enough that re-applying the contract from disk is idempotent against existing structural state. That is a reasonable assumption for the pre-1.0 audience, but it is an *assumption*, not a contract — and the error message reads as a contract.

**Suggestion:** expand the remediation hint to:

1. State explicitly that dropping the marker loses no DDL, only the applied-state ledger row.
2. Recommend the operator verify their on-disk migrations match the existing DB state before re-running `dbInit` (the current marker shape allows this — the `core_hash`, `profile_hash`, and `invariants` columns are inspectable before drop, even if the `space` column is absent).
3. Optionally: include a one-liner SQL snippet the operator can run pre-drop to capture the legacy row's hash for sanity-comparing against the contract on disk.

If the team's appetite is "this is pre-1.0 and we don't owe the operator more than this" — fine, but record that decision in the error message itself or in the docs the message points at, so a future-1.0 operator hitting this can see "this remediation was scoped pre-1.0."

### F03. `verifyContractSpaces` silently tolerates a missing marker for a declared-and-migrated space

**Location:** [packages/1-framework/3-tooling/migration/src/verify-contract-spaces.ts](packages/1-framework/3-tooling/migration/src/verify-contract-spaces.ts) lines 198–202.

```ts
const pinned = inputs.pinnedHashesBySpace.get(spaceId);
const marker = inputs.markerRowsBySpace.get(spaceId);
if (!pinned || !marker) {
  continue;
}
```

**Issue:** for a space that *is* declared in `loadedSpaces` AND has a pinned dir on disk AND has a pinned hash in `pinnedHashesBySpace` — but *no marker row* in `markerRowsBySpace` — the helper continues without surfacing a violation. The JSDoc at lines 156–169 explains this is intentional: *"`markerRowsBySpace` lacks an entry → no violation here; the live-DB compare in step 8 (out of scope of this helper) is where the absence shows up."*

The reasoning is "lazy creation of marker rows is per spec; a space without a marker row is a space whose first migration hasn't run yet, which the runner will handle." That's defensible. The failure mode it papers over: if the runner *did* apply migrations for this space but the marker write failed (or was rolled back due to an outer-transaction issue elsewhere), the verifier doesn't catch the inconsistency — it falls through to "no violation" and the apply-path runs the same migrations again.

**Failure-mode probe:** is there a concrete way the marker can be missing for a space whose migrations have been applied? Today (M1, single-app helper layer) — no, because the runner+marker-write share a transaction. M2 introduces the multi-space outer transaction; the failure mode there is "outer transaction commits, individual marker writes succeed, but a future re-emit fails due to plan/marker disagreement caught in a *different* code path." Not strictly this helper's concern — but the silent-fall-through here means the verifier doesn't help diagnose it either.

**Suggestion:** for M1, document the case in the JSDoc more pointedly — *"this fall-through is correct iff marker writes are guaranteed atomic with migration apply; M2's outer-transaction restructure must preserve that guarantee or this helper grows a 'pinned-without-marker' violation kind."* For M2, decide whether the helper grows that violation kind (cheap; one more discriminant in `SpaceVerifierViolation`) or whether the live-DB compare in the verifier's step 8 catches it crisply enough. Either is fine; choosing now is cheaper than diagnosing the silent fall-through later.

### F04. `concatenateSpaceApplyInputs` and `planAllSpaces` accept invalid space ids without complaint

**Location:** [packages/1-framework/3-tooling/migration/src/concatenate-space-apply-inputs.ts](packages/1-framework/3-tooling/migration/src/concatenate-space-apply-inputs.ts), [packages/1-framework/3-tooling/migration/src/plan-all-spaces.ts](packages/1-framework/3-tooling/migration/src/plan-all-spaces.ts).

**Issue:** both helpers accept `spaceId: string` without calling `assertValidSpaceId`. A caller that has not pre-validated space ids (e.g. a future test or M2 wiring that forgets the validation step) would happily pass `'app/../etc'` or `'CONTAINS UPPERCASE'` through; the planner / runner pipeline accepts them; the failure surfaces later (probably in `emitPinnedSpaceArtefacts` or `readPinnedContractHash`, both of which *do* validate, or in a filesystem call that produces a confusing `ENOENT`).

**Already-solved-here probe:** the pattern of "validate-at-the-edge" exists for ids in this very module (`assertValidSpaceId` is the validator; `ValidSpaceId` is the brand). The pattern just isn't applied at every helper boundary.

**Suggestion:** decide where the validation cliff lives — at every helper boundary, or once at descriptor-load time — and apply uniformly. The architect's `system-design-review.md` § A07 raises the symmetry concern; the principal-engineer concern is *"where does a malformed id surface, and is the surfacing crisp enough that a caller can fix it?"* Today the answer is "at the first FS-touching helper, with a validation error" — fine for in-process callers, less fine for callers that compose the helpers into a larger pipeline and read errors over an RPC boundary. Document the decision; if validation moves to descriptor-load time, drop the redundant `assertValidSpaceId` checks inside the helpers.

### F05. `concatenateSpaceApplyInputs` allows multiple app-space inputs silently

**Location:** [packages/1-framework/3-tooling/migration/src/concatenate-space-apply-inputs.ts](packages/1-framework/3-tooling/migration/src/concatenate-space-apply-inputs.ts) lines 76–82.

```ts
let appSpace: SpaceApplyInput<TOp> | undefined;
for (const input of inputs) {
  if (input.spaceId === APP_SPACE_ID) {
    appSpace = input;     // last write wins, silently
  } else {
    extensions.push(input);
  }
}
```

**Issue:** the duplicate-id check at the top (lines 67–73) catches duplicate `spaceId`s in general. So this loop's "last write wins" branch is unreachable in practice — except that the dedup check uses `Set`-membership semantics, and `'app' === 'app'`, so it'd be caught. OK. *On second read this is fine.* I'm walking back this finding — the `seen.has(input.spaceId)` check at the top fires before this loop runs.

**Resolution:** this finding is **withdrawn**; the dedup check upstream covers the case I was worried about. Leaving the section in for review-traceability — the principal-engineer's *"convince me the failure mode I described doesn't exist"* probe gets to fire and resolve.

### F06. `detectLegacyMarkerShape` runs *before* `ensureMarkerTableStatement` — verify the ordering invariant holds for re-entry

**Location:** [packages/3-targets/3-targets/postgres/src/core/migrations/runner.ts](packages/3-targets/3-targets/postgres/src/core/migrations/runner.ts) lines 274–286, [packages/3-targets/3-targets/sqlite/src/core/migrations/runner.ts](packages/3-targets/3-targets/sqlite/src/core/migrations/runner.ts) lines 268–280.

**Issue:** `ensureControlTables` runs (a) `ensurePrismaContractSchemaStatement`, (b) `detectLegacyMarkerShape`, (c) `ensureMarkerTableStatement`, (d) `ensureLedgerTableStatement`. The legacy detection has to run between (a) and (c) — between schema-exists and table-might-exist — which the diff does correctly.

The case I want to pressure-test: if `ensureControlTables` runs against a DB that has the new-shape marker (from a prior successful run) but a *failed* prior detection state (e.g. someone manually edited the table mid-flight), what happens? The detector queries `information_schema.columns`; if `space` is present it returns `okVoid()`. Manual-edit recovery is not a concern. ✓

The case I do want to flag: the Postgres path runs the legacy check *before* `ensureMarkerTableStatement` (which is `CREATE TABLE IF NOT EXISTS`), which is correct. The SQLite path mirrors this. **However** the Postgres path also runs `ensurePrismaContractSchemaStatement` first; the SQLite path doesn't (SQLite has no `prisma_contract` schema concept). So if Postgres `prisma_contract` schema doesn't exist, the legacy detection's `information_schema.columns` query returns zero rows (no `prisma_contract.marker` exists), `legacyDetection.ok` is `true`, and we proceed to `ensureMarkerTableStatement` which creates it. Correct.

**Resolution:** the ordering invariant holds. **No change.** Documenting the analysis here so a future reader knows the interaction has been pressure-tested.

### F07. `verify-contract-spaces.ts` sort key uses `<` / `>` on strings without explicit `localeCompare`

**Location:** [packages/1-framework/3-tooling/migration/src/verify-contract-spaces.ts](packages/1-framework/3-tooling/migration/src/verify-contract-spaces.ts) lines 244–249, and similarly in `concatenate-space-apply-inputs.ts` lines 88–92, `plan-all-spaces.ts` lines 73–77.

**Issue:** the sort comparators use raw `<`/`>` on strings rather than `localeCompare`. For ASCII-only space ids (which the `assertValidSpaceId` regex enforces) the result is identical, so this is correct *because of the validation*. The dependency between "space ids are pure ASCII" and "raw `<`/`>` is determinism-safe" is implicit.

**Suggestion:** add a one-line comment at one of the sort sites referring to `assertValidSpaceId`'s pattern as the property that makes raw `<`/`>` deterministic, so a future contributor relaxing the pattern doesn't quietly introduce locale-dependent ordering. Trivial.

## Deferred (out of scope)

These are concerns that would expand the PR's scope beyond M1 and are explicitly deferred per the project plan or per the user prompt's M2/M3 framing.

- **AM4 single-transaction outer-tx + multi-space rollback.** Helper-side concatenation lands in M1; the consuming runner's outer-transaction restructure is M2. Deferred per project plan.
- **AM7 drift-warning surface (CLI, log channel, severity).** The detector primitive lands in M1; the warning surface lands in M2. Deferred per project plan.
- **AM8 codec hook plumbing.** Hook contract lands in M1's spec; emitter wiring lands in M2 (T2.2 in the sub-spec's task plan). Deferred per project plan.
- **AM9 / AM10 `db init` / `db update` per-space.** The helper primitives (`findPathWithDecision`, per-space input shapes) land in M1; the CLI consumer wiring lands in M2 (T2.3 / T2.4). Deferred per project plan.
- **AM11 dbInit / db apply integration.** Helper-level no-descriptor property is verified by `deletable-node-modules.test.ts`; full integration lands in M2 once the consumer wiring exists. Helper-level coverage is what M1 owes.
- **AC3 — extension upgrade flow.** End-to-end behaviour requires M2's CLI-level `migrate` command. Deferred.
- **AC4 — monorepo composition.** Helpers are family-neutral; end-to-end monorepo demonstration is M3+ territory. Deferred.
- **AC10 — pgvector migration.** Explicitly M4 work per the project plan. Deferred.
- **AC11 — `databaseDependencies` removal.** Explicitly M5 close-out work. Deferred.
- **AC13 — orphan marker handling at dbInit time.** Helper-level coverage in `verifyContractSpaces` exists (`orphanMarker` violation kind); CLI-level reporting is M2.
- **AC14 — PR-diff shape after a bump.** End-to-end behaviour requires M2 CLI wiring. Deferred.
- **AC16 — declared-but-unmigrated CLI error.** Helper-level coverage exists (`declaredButUnmigrated` violation kind); CLI surface is M2.

## Already addressed

The PR itself absorbed several review-round findings before `ee05b2b4f`:

| ID | Fix | Commit |
|---|---|---|
| F1 (round 1) | brand-helper conversion replaced ad-hoc `as`-casts in `extension-test-contract-space` | `c44160a7a` |
| F2 (round 1) | stale mock SQL in `sql-runtime` test aligned to per-space marker schema | `4534b79ad` |
| F3 (round 1) | `planAllSpaces` rejects duplicates *before* any callback runs (atomicity); spy-not-called assertion locks it in | `cdba69117` |
| F2 (M1-cleanup) | transitional marker-shape auto-migration removed; replaced with structured `LEGACY_MARKER_SHAPE` detection — see F01 above for the AC-sync follow-up | `15e0534e1` |
| F3 (M1-cleanup) | `APP_SPACE_ID` canonicalised under `framework-components/control` | `9e39382e4` |
| F4 (M1-cleanup) | contract-space identity types hoisted to `framework-components/control`; `writeAuthoredMigrationPackage` → `materialiseMigrationPackage` | `68ebbeb25` |
| F6 (M1-cleanup) | `AuthoredContractSpace` → `ContractSpace`, `writeExtensionMigrationPackage` → `materialiseMigrationPackage` (typology flatten) | `f8649ba43` |

The architect-class typology corrections (F4, F6) shipped clean and the architect-pass on the surface at `ee05b2b4f` did not re-discover them — see `system-design-review.md` for the verification.

## Acceptance-criteria verification

Verifying against the **sub-spec's** AM1–AM11 (the M1-applicable criteria). The project spec's AC1–AC16 are mostly cross-milestone and are tagged as deferred above.

| AC | Verdict | Detail |
|---|---|---|
| AM1: descriptor `contractSpace` field present and typed; `pgvector` / `arktype-json` continue to typecheck | **PASS** | Code: [packages/2-sql/9-family/src/core/migrations/types.ts](packages/2-sql/9-family/src/core/migrations/types.ts) lines 130–144 — `readonly contractSpace?: ContractSpace<Contract<SqlStorage>>` is present. Test: [packages/2-sql/9-family/test/migrations.types.test-d.ts](packages/2-sql/9-family/test/migrations.types.test-d.ts) lines 90–93 has `expectTypeOf<SqlControlExtensionDescriptor<'postgres'>['contractSpace']>().toEqualTypeOf<ContractSpace<Contract<SqlStorage>> \| undefined>()`. Existing extensions (`pgvector`, `arktype-json`) don't set `contractSpace` and the field is optional, so they typecheck unchanged. |
| AM2: marker schema migration applies idempotently against (a) fresh, (b) pre-migration single-row, (c) already-migrated; Postgres + SQLite | **FAIL (as-written)** | The implementation does NOT apply idempotently against (b). The runner detects the legacy single-row shape and fails with `LEGACY_MARKER_SHAPE`. The integration test [packages/3-targets/6-adapters/postgres/test/migrations/runner.errors.integration.test.ts](packages/3-targets/6-adapters/postgres/test/migrations/runner.errors.integration.test.ts) lines 108–172 codifies the rejection. The choice is operationally defensible (M1-cleanup F2 made it deliberately) but the AC's literal text is stale — see F01. **(a) PASS / (b) FAIL-by-design, AC text needs sync / (c) PASS.** |
| AM3: `planAllSpaces` returns the same shape regardless of `extensionPacks` declaration order (deterministic alphabetical sort) | **PASS** | Code: [packages/1-framework/3-tooling/migration/src/plan-all-spaces.ts](packages/1-framework/3-tooling/migration/src/plan-all-spaces.ts) lines 69–77 — explicit alphabetical sort. Test: [packages/1-framework/3-tooling/migration/test/plan-all-spaces.test.ts](packages/1-framework/3-tooling/migration/test/plan-all-spaces.test.ts) lines 35–53 — the test name explicitly cites AM3 and exercises three different input orders against the same expected output. |
| AM4: per-space runner concatenates extensions-first-then-app; single transaction; mid-apply failure rolls back all spaces | **WEAK** | Concatenation logic: PASS — [packages/1-framework/3-tooling/migration/src/concatenate-space-apply-inputs.ts](packages/1-framework/3-tooling/migration/src/concatenate-space-apply-inputs.ts) lines 76–94, locked in by [packages/1-framework/3-tooling/migration/test/concatenate-space-apply-inputs.test.ts](packages/1-framework/3-tooling/migration/test/concatenate-space-apply-inputs.test.ts) lines 23–67. **Single-transaction + mid-apply rollback: NOT VERIFIED in M1** — the runner-side outer-transaction restructure lands at the SQL-family consumption site in M2 (T2.x). Helper-side primitives are in place but the runtime property is not exercisable yet. Marked deferred. |
| AM5: per-space verifier rejects all three orphan / missing cases with specified error messages | **PASS** | Code: [packages/1-framework/3-tooling/migration/src/verify-contract-spaces.ts](packages/1-framework/3-tooling/migration/src/verify-contract-spaces.ts) lines 207–238 — `declaredButUnmigrated`, `orphanPinnedDir`, `orphanMarker` (plus `hashMismatch` and `invariantsMismatch` beyond the AC). Each violation carries a `remediation` string with the spec-mandated guidance. Test: [packages/1-framework/3-tooling/migration/test/verify-contract-spaces.test.ts](packages/1-framework/3-tooling/migration/test/verify-contract-spaces.test.ts) covers each violation kind. **Note F03**: a missing-marker-with-pinned-and-loaded falls through silently — this is documented intent, not a violation of AM5. |
| AM6: pinned per-space artefacts written under `migrations/<space-id>/` with byte-equivalent canonical content; re-run idempotent | **PASS** | Code: [packages/1-framework/3-tooling/migration/src/emit-pinned-space-artefacts.ts](packages/1-framework/3-tooling/migration/src/emit-pinned-space-artefacts.ts) — three files (`contract.json`, `contract.d.ts`, `refs/head.json`) under `<projectMigrationsDir>/<spaceId>/`; `canonicalizeJson` for `contract.json` and `refs/head.json`; sorted `invariants` for byte-determinism. Test: [packages/1-framework/3-tooling/migration/test/emit-pinned-space-artefacts.test.ts](packages/1-framework/3-tooling/migration/test/emit-pinned-space-artefacts.test.ts) lines 22–80 — exercises canonical form, sorted invariants, byte-identity. Idempotency is structural (overwrite produces same bytes for same input); test "overwrites pre-existing pinned files" locks in the overwrite-permitted property. |
| AM7: drift detection — bumping descriptor without migrate produces a clear, non-fatal warning on next migrate | **WEAK** | Detector: PASS — [packages/1-framework/3-tooling/migration/src/detect-space-contract-drift.ts](packages/1-framework/3-tooling/migration/src/detect-space-contract-drift.ts) returns `kind: 'drift'` with the descriptor / pinned hashes for the consumer to format. Read-side primitive `readPinnedContractHash` is in place. **Warning-surfacing semantic (CLI-visible message, log channel, non-fatal-then-emit-proceed) lands at the M2 consumption site.** Helper layer verified; consumer wiring deferred. |
| AM8: codec hook fires for `'added'`/`'dropped'`/`'altered'`; `'altered'` does not fire on codec-id-only changes | **NOT VERIFIED** | M2 territory per project plan (T2.2 in the sub-spec's task ordering). No codec-hook code in this PR's diff. |
| AM9: `db init` per-space — fresh DB with synthetic test extension initialises both spaces in single tx; marker rows for `app` and `test-contract-space` exist | **NOT VERIFIED** | M2 territory. The synthetic test extension fixture is in place ([test/integration/test/contract-space-fixture/](test/integration/test/contract-space-fixture/)) but the per-space `db init` consumer wiring is M2. |
| AM10: `db update` per-space — bumping synthetic test extension's `headRef` advances only its space's marker | **NOT VERIFIED** | M2 territory. Same wiring gap. |
| AM11: with synthetic fixture's source removed, `dbInit` / `db apply` succeed (read user-repo only) | **WEAK** | Helper-level: PASS — [packages/1-framework/3-tooling/migration/test/deletable-node-modules.test.ts](packages/1-framework/3-tooling/migration/test/deletable-node-modules.test.ts) deletes `node_modules` before invoking `verifyContractSpaces` + `concatenateSpaceApplyInputs` + `emitPinnedSpaceArtefacts`; the test invents a `'test-contract-space'` id inline rather than importing the synthetic fixture (so no descriptor reach). **`dbInit` / `db apply` integration: NOT VERIFIED in M1** — same as AM9/AM10, requires the M2 CLI wiring. |

### Summary

| Result | Count | ACs |
|---|---|---|
| PASS | 4 | AM1, AM3, AM5, AM6 |
| FAIL (spec-text stale, code intentional) | 1 | AM2 |
| WEAK (helper-PASS, integration-NOT-VERIFIED) | 3 | AM4, AM7, AM11 |
| NOT VERIFIED (M2 territory by design) | 3 | AM8, AM9, AM10 |

The four PASS results are clean. The one FAIL is a spec-text-out-of-sync issue, not an implementation defect — the team made the deliberate F2 cleanup choice and forgot to update AM2's literal text. The three WEAK results have helper-level coverage and explicitly deferred integration-level coverage. The three NOT VERIFIED results match the user prompt's M2/M3 framing ("AM4-rollback, AM8, AM9, AM10, AM11-migrate-fails-informatively").

## Methodology

- **Source-pinning.** Every spec, test, and source file referenced read at `ee05b2b4f` via `git show <sha>:<path>` or `git diff origin/main..ee05b2b4f -- <path>`. Workspace-tree versions of `projects/extension-contract-spaces/**` not consulted (they contain post-PR work that would contaminate this review).
- **Probes applied.** Failure-mode, blast-radius, cheapest-alternative, operability, constraint-vs-assumption, already-solved-here — fired on the introduced helpers + the marker-promotion mechanism + the verifier's edge cases.
- **AC verification discipline.** For each AM I read (a) the implementing code, (b) the test that asserts the property, (c) the assertion's specificity. Mapping a file path next to an AC was treated as not-verification per the principal-engineer skill's "common traps." The FAIL on AM2 surfaced from reading the test assertions against the literal AC text.
- **Persona.** Principal-engineer persona loaded fresh at the start of this artefact's production. The persona's "out-of-scope" routes were honoured — naming/typology concerns referred to `system-design-review.md` (architect), orchestration concerns referred to `walkthrough.md` (tech-lead), adopter-learnability concerns flagged for devrel.
