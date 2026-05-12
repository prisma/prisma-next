# Contract Spaces — Mongo Port — Project Plan

## Summary

Bring the Mongo family to parity with SQL on contract spaces. Single-PR project: one branch (`tml-2408-port-contract-spaces-to-the-mongo-family`, already started off the M6 tip of TML-2397), one PR, structured as a focused commit sequence.

**Spec:** [`spec.md`](./spec.md)

## Collaborators

| Role     | Person/Team    | Context                                                                                  |
|----------|----------------|------------------------------------------------------------------------------------------|
| Maker    | William Madden | Drives execution                                                                          |
| Reviewer | William Madden | Self-review against ADR 212 (no fresh design risk; this is a port to a second family)    |

## Shipping strategy

- **Branch:** `tml-2408-port-contract-spaces-to-the-mongo-family`, currently rebased onto the tip of TML-2457 (the contract-spaces SQL refactor that landed `ContractSpace<TContract>` in `framework-components/control` and removed `APP_SPACE_ID` coupling from the framework helpers).
- **PR:** single PR titled with `(TML-2408)` so Linear's GitHub integration auto-completes the issue on merge.
- **Commit-as-you-go:** each commit is a logically coherent slice; validation gates green at every commit.
- **Backwards compatibility:** the marker upgrade is automatic and idempotent. Pre-port single-doc Mongo markers are detected and upgraded on first read. No user action required; no version flag; no migration script.
- **Forward compatibility:** the per-space data-op session-transaction refinement is a non-breaking future addition. The atomicity model documented in subsystem 10 says so explicitly.

### Why one PR is the default

This is a port to a mechanism that already exists (specified in [ADR 212](../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md), shipped on the SQL family under TML-2397), behind one Linear issue, with one reviewer. The five phases below are commit clusters, **not PR boundaries**:

- **No fresh design risk.** The architectural decisions are settled. The only Mongo-specific call — the resumable per-space atomicity model — is one paragraph in `spec.md` § Approach and one subsection in subsystem 10. Staged rollout buys nothing because there's nothing to de-risk in stages.
- **The system is partially-on / partially-off otherwise.** P1 alone (marker schema gains `space`) is a coherent commit but an incoherent PR — it changes the marker doc shape while everything above is still single-space, with no user-facing value. Only at P5 does "Mongo extensions can declare a contract space" become a true thing about the system.
- **Reviewer cost.** Splitting amplifies context-switch cost: every reviewer reloads the same "what is a contract space, what is the marker, what is `executeAcrossSpaces`" mental model on each PR. One PR pays that cost once.
- **Size is reasonable.** Estimated diff: ~1000–1300 LOC of substantive change. Reviewable, with the commit-cluster structure giving the reviewer natural reading boundaries.

### Reassessment checkpoints (split-if-triggered)

Pre-committed split points. Not predictions — flag if any of these trip during execution and treat them as a signal to peel scope into a follow-up PR rather than push through.

1. **Schema-prune generalisation grows invasive (end of T3.2 / T3.3).** The choice between option A (extractor callbacks; touches every SQL call site) and option B (duck-type both shapes; localised) is recorded in T3.2's commit. If option A is selected and ends up touching ≥ 8 SQL-side call sites, peel "framework-tools: generalise schema projection for non-SQL families" into its own PR landing first; rebase the Mongo port behind it. Option B keeps the change localised and stays in this PR.
2. **Mongo `.d.ts` renderer recon surprise (start of P4).** If T4.1's reconnaissance finds the renderer doesn't exist (rather than just needing wiring), renderer authoring belongs in a separate PR. The mechanism PR can land first against the existing renderer surface; the wiring follows.
3. **Diff exceeds ~1500 LOC (end of P3).** Past that, review fatigue starts to dominate even with good commit structure. Most likely cause: fixture / e2e scaffolding heavier than estimated. Mitigation: split P5 (synthetic fixture + e2e + subsystem doc) into a follow-up "Mongo contract-space integration tests" PR. The mechanism PR ships first; the tests are a hard quality gate but architecturally independent.

The reassessment is a single explicit step at the end of P3: check the diff size, check whether T3.2 went option-A or option-B, decide whether to land P4 + P5 in this PR or split. If none of the triggers fire, push through to P5 in the same PR.

### Reasoning-effort checkpoints

The agent runs at **medium reasoning effort by default**. Mechanical work (parameter threading, type lifts, recon-and-wire, test/doc authoring) doesn't need more than that. A small set of moments do — design choices with second-order effects, subtle idempotency / state-machine contracts, and final self-review — and the agent **does not have introspection into its configured reasoning effort**, so the upgrades have to be operator-driven.

When the agent reaches a `[checkpoint: high reasoning]` marker in the task list, it will **pause and prompt the operator to upgrade the reasoning effort** before proceeding. After the checkpoint completes, the agent will **prompt the operator to downgrade back to medium** before continuing into the next mechanical slice.

The four checkpoints:

1. **CKPT-1 — End of P1's T1.2 (legacy-upgrade design).** The idempotent legacy-shape upgrade is small but easy to get subtly wrong. Reasoning: concurrent-upgrade race, partial-write recovery, three-state correctness (fresh / legacy / already-upgraded). Scope: design the upgrade strategy + write the tests; commit; hand control back. Estimated duration: short.
2. **CKPT-2 — Start of P3, before T3.2 (schema-prune design).** Decide option A (extractor callbacks; touches every SQL call site) vs option B (duck-type both shapes; localised). Wrong-then-rebase costs more than upgrade-and-think. Scope: read SQL call sites, weigh extensibility vs blast radius, commit the decision in T3.2's commit message; hand control back. Estimated duration: short.
3. **CKPT-3 — End of P3 (split-or-push reassessment).** Already documented above as the reassessment step. Multi-signal judgment call (LOC budget, generalisation cleanliness, downstream-phase fit) — exactly where higher reasoning earns its keep. Scope: walk the three triggers from § Reassessment checkpoints; record the decision in the PR description draft; hand control back. Estimated duration: short.
4. **CKPT-4 — End of P5, pre-PR (final self-review).** Full-branch self-review against the spec's ACs and NFR5. Self-review is the highest-leverage place for high reasoning because finding holes in your own work is fundamentally harder than producing it. Scope: walk every AC, walk every NFR, sniff for cargo-culted SQL patterns, sniff for test theatre; produce a "self-review pass" note in the PR description. Estimated duration: medium-long.

Mid-execution signals that should trigger an unscheduled upgrade prompt (the agent flags, the operator decides):

- Cargo-culting symptoms (e.g., copying SQL outer-transaction structure into the Mongo runner, where Mongo doesn't have one).
- "Fix" commits in the same phase that walk back the prior commit's design.
- Tests that pass but don't visibly exercise the property they claim to verify.
- Plausible-looking generalisations that quietly break duck-typing fall-through.

## Test design

Tests derive from the spec's acceptance criteria. The fixture work is the load-bearing scaffolding for the e2e tests; build it before consuming.

| AC   | TC    | Test case                                                                                                                                          | Type        | Phase | Expected outcome                                                                          |
|------|-------|----------------------------------------------------------------------------------------------------------------------------------------------------|-------------|-------|-------------------------------------------------------------------------------------------|
| AC1  | TC-1  | `createMongoFamilyInstance` accepts a stack with a Mongo extension descriptor exposing `contractSpace`                                             | Unit        | P2    | Returns a family instance; `assertDescriptorSelfConsistency` passes                       |
| AC1  | TC-2  | Stale `headRef.hash` on the descriptor → `createMongoFamilyInstance` throws `MIGRATION.DESCRIPTOR_HEAD_HASH_MISMATCH`                              | Unit        | P2    | Mirrors SQL family fail-fast                                                              |
| AC2  | TC-3  | Fresh DB → `initMarker(space='app', ...)` writes `{_id: 'app', space: 'app', ...}`                                                                 | Integration | P1    | Doc exists; query by `_id: 'app'` returns it                                              |
| AC2  | TC-4  | Legacy `{_id: 'marker', ...}` present → first `readMarker(space='app', ...)` non-mutatingly detects, then upgrade write rewrites to `_id: 'app'` | Integration | P1    | Idempotent on rerun                                                                       |
| AC2  | TC-5  | Already-upgraded DB → `readMarker(space='app')` is a no-op for the legacy path                                                                     | Integration | P1    | Three-state idempotency complete                                                          |
| AC3  | TC-6  | `readMarker(space='cipherstash')` on a DB with a `cipherstash`-keyed doc returns that doc                                                          | Integration | P1    | Per-space read works                                                                      |
| AC3  | TC-7  | `executeAcrossSpaces([app, ext1])` runs both spaces; degenerate single-space case still passes                                                     | Integration | P3    | Both markers advanced                                                                     |
| AC4  | TC-8  | Two-space aggregate: extension succeeds, app fails verify → extension marker advanced, app marker untouched, response `failingSpace: 'app'`        | Integration | P3    | Resumable failure semantics                                                               |
| AC4  | TC-9  | After TC-8, re-run with corrected app plan → app marker advances; extension is no-op skip                                                          | Integration | P3    | Resume works                                                                              |
| AC5  | TC-10 | Aggregate with two members claiming the same collection → loader returns `disjointnessViolation`                                                   | Unit        | P3    | Mongo extractor wired                                                                     |
| AC5  | TC-11 | `projectSchemaToSpace` removes other-member collections from a Mongo `MongoSchemaIR.collections` array                                             | Unit        | P3    | Generalisation is correct                                                                 |
| AC6  | TC-12 | After `migration apply` of the fixture aggregate, pinned files exist with byte-equivalent content                                                  | Integration | P4    | `migrations/<fixtureId>/{contract.json,contract.d.ts,refs/head.json}` byte-equal          |
| AC6  | TC-13 | Re-running `migration apply` with no contract change rewrites pinned files byte-equivalently                                                       | Integration | P4    | Idempotency holds                                                                         |
| AC7  | TC-14 | Synthetic fixture aggregate → `plan` → `apply` → `verify` succeeds; marker collection has rows for `app` and `<fixtureId>` with expected hashes    | E2E         | P5    | Full happy path                                                                           |
| AC7  | TC-15 | After TC-14, hand-edit the fixture-owned collection on the live DB → `db verify` fails with per-space remediation hint                             | E2E         | P5    | Per-space verifier wired                                                                  |
| AC8  | TC-16 | Existing Mongo integration / e2e suite passes unchanged with no extension declared                                                                  | Integration | P1–P5 | Baseline preserved at every commit                                                        |
| AC9  | TC-17 | `docs/architecture docs/subsystems/10. MongoDB Family.md` carries a "Contract spaces" subsection                                                   | Doc         | P5    | Reviewer reads the section and finds it complete                                          |
| AC11 | TC-18 | Aggregate apply with a `MongoFamilyInstance` whose stack has zero codec runtime instances loaded                                                   | Integration | P3    | `executeAcrossSpaces` succeeds; both markers advance; no codec lookup occurs              |

## Phases (commit-clusters in one PR)

Each phase below is one or more commits. Per the [commit-as-you-go rule](/.cursor/rules/commit-as-you-go.mdc), validation gates must be green at every commit. The five-phase split mirrors the spec's section ordering and keeps each commit's blast radius small.

### Phase 1 — Marker schema gain `space`

Make the Mongo marker collection space-keyed without yet enabling multi-space (the runner still calls with `'app'` only). Includes the legacy-shape upgrade.

**Tasks:**

- ✅ **T1.1** Marker collection schema change: `marker-ledger.ts` keys docs by `_id: <spaceId>`, with `space: <spaceId>` carried alongside. `readMarker(space)` / `initMarker(space, ...)` / `updateMarker(space, expectedFrom, ...)` / `writeLedgerEntry(space, entry)` all take a `space` parameter. Ledger doc shape gains `space` too. (TC-3)
- ✅ **T1.2** `[checkpoint: high reasoning — CKPT-1]` Legacy-shape detection: a non-mutating precheck in `readMarker` that detects `{_id: 'marker', ...}` and rewrites it to `{_id: 'app', space: 'app', ...}` idempotently on next read. Unit + integration tests covering fresh / legacy / already-upgraded states. (TC-4, TC-5)
  - **Before starting:** agent prompts operator: *"Reaching CKPT-1 (legacy-upgrade idempotency). Please upgrade reasoning effort to high before I continue."* Wait for confirmation.
  - **On completion:** agent prompts operator: *"CKPT-1 complete. Please downgrade reasoning effort back to medium before T1.3."* Wait for confirmation before resuming.
- ✅ **T1.3** `MarkerOperations` interface (`mongo-runner.ts`) threads `space` through. `MongoMigrationRunner.execute` reads `options.plan.spaceId` and passes it to every marker op. Per-space ledger entries. (TC-6) — *substance absorbed into T1.1's commit; the interface and runner changes were inseparable from the schema change in practice.*

**Validation gate:**

- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm test:integration` (Mongo path; uses `mongodb-memory-server`)
- `pnpm lint:deps`
- `pnpm build`

### Phase 2 — Descriptor surface + family-instance multi-space

Lift the non-app rejection in the family instance. Add the descriptor field. Add the descriptor self-consistency check.

**Tasks:**

- ✅ **T2.1** `MongoControlExtensionDescriptor.contractSpace?: ContractSpace<MongoContract<MongoStorage>>`. (TC-1)
- ✅ **T2.2** `MongoFamilyInstance.readMarker(space)` accepts any space id; remove the non-app rejection. `readAllMarkers` returns the full multi-space map (queries the marker collection with no `_id` filter). (TC-6)
- ✅ **T2.3** `assertDescriptorSelfConsistency` wired into `createMongoFamilyInstance` over each extension's `(contractSpace.contractJson, contractSpace.headRef.hash)`. Mirrors SQL family. (TC-2)
- ✅ **T2.4** Add `packages/2-mongo-family/9-family/vitest.config.ts` so the new TC-1 / TC-2 unit tests actually run through the package gate. Plan amendment surfaced during P2 R1 — `family-mongo` has no `vitest.config.ts` (a pre-existing gap from the projects-mode vitest migration), and the descriptor self-consistency tests added in T2.3 typecheck but don't execute today. Mirror the config from a sibling Mongo package (e.g. `packages/2-mongo-family/7-runtime/vitest.config.ts` or `packages/3-mongo-target/1-mongo-target/vitest.config.ts`).

**Validation gate:** same as Phase 1.

### Phase 3 — Multi-space runner + schema-prune generalisation

Lift the `length !== 1` rejection. Iterate per-space. Generalise `projectSchemaToSpace` and the loader's disjointness extractor for Mongo.

**Tasks:**

- ✅ **T3.1** `mongoTargetDescriptor.executeAcrossSpaces` iterates `perSpaceOptions` in caller order. Per-space `runner.execute`; on `notOk`, return `MultiSpaceRunnerFailure { ...failure, failingSpace }` immediately. On full success, `{ perSpaceResults: [...] }`. (TC-7, TC-8, TC-9)
- ✅ **T3.2** `[checkpoint: high reasoning — CKPT-2]` Generalise `projectSchemaToSpace` to handle Mongo's storage shape. **Decision recorded — option B (duck-type both shapes).** Rationale: option A's "loud failure for missing registration" property *inverts* the existing helper contract (silent fall-through preserves disjointness-off-but-correct for unknown families); option A also requires a new registration mechanism on top of the call-site plumbing, expanding blast radius beyond the surface count. Option B keeps the change inside `migration-tools`: an extra branch for `.collections` (`Array.isArray` for `MongoSchemaIR`'s array form, `typeof === 'object'` for the record form on contract-storage); record-shaped fall-through preserved unchanged. Layer-boundary check: do NOT import `MongoSchemaIR` (the class); return a plain `{...schema, collections: prunedArray}` and let downstream consumers duck-type, mirroring the existing SQL pattern. (TC-11)
  - **Before starting:** agent prompts operator: *"Reaching CKPT-2 (schema-prune option A vs B). Please upgrade reasoning effort to high before I continue."* Wait for confirmation.
  - **On completion (covers T3.2 + T3.3, since T3.3 reuses the decision):** agent prompts operator: *"CKPT-2 complete (T3.2 + T3.3 both landed under option B). Please downgrade reasoning effort back to medium before T3.4."* Wait for confirmation before resuming.
- ✅ **T3.3** Generalise the loader's `extractTableNames` disjointness check to extract Mongo collection names under option B. **Rename to `extractStorageElementNames`** (the existing name is a misnomer once it handles collections too). Single call site in `loader.ts`. (TC-10)
- [ ] **T3.4** Wire the multi-space runner's per-space verify step: project the introspected schema to the space's slice via `projectSchemaToSpace` (or the Mongo extractor) and call `verifyMongoSchema` on the projection. Marker advances iff verify passes. (TC-8, TC-9). **Refresh TC-8 alongside this wiring:** P3 R1's TC-8 leans on today's whole-DB verify catching the first-applied space's collection as "extras". Per-space verify projects the schema to the space's slice, so the failure cause shifts — TC-8 must be updated to manufacture a per-space contract violation (e.g. an op that succeeds at the AST level but produces a state that fails per-space verify against the space's own contract). AC4's contract under test (`failingSpace` plumbing, advanced ext marker, app marker null, resume convergence) is preserved.
- [ ] **T3.5** Codec-rehydration guardrail (NFR5): integration test that constructs a `MongoFamilyInstance` whose stack carries no codec runtime instances, loads a previously-emitted aggregate (app + extension), and runs `executeAcrossSpaces` against `mongodb-memory-server`. Both markers advance; the runner never performs a codec instance lookup. The test is the executable boundary that enforces "rehydrated ops carry no codec dependency"; if it goes red on a future change, the change has regressed the property. (TC-18)

**Validation gate:** same as Phase 1, plus: synthetic fixture's two-space aggregate test passes locally before phase ends (lifted out of the strict gate so the fixture work in P4 can land coherently).

**End-of-P3 checkpoint — CKPT-3 (split-or-push reassessment):**

- **Before starting:** agent prompts operator: *"Reaching CKPT-3 (end-of-P3 reassessment: do we land P4 + P5 in this PR, or split?). Please upgrade reasoning effort to high before I continue."* Wait for confirmation.
- **Activity:** walk the three triggers from § Reassessment checkpoints (schema-prune invasiveness, .d.ts renderer recon outlook, current diff size); record the decision in the PR description draft; if splitting, draft the follow-up issue scope; hand control back.
- **On completion:** agent prompts operator: *"CKPT-3 complete. Decision: [push through to P4 / split P5 to follow-up]. Please downgrade reasoning effort back to medium before P4."* Wait for confirmation before resuming.

### Phase 4 — On-disk pinned artefacts

Wire Mongo's `contract.d.ts` renderer through `emitContractSpaceArtefacts`. Aggregate loader reads pinned Mongo contracts via the existing target-agnostic helpers.

**Tasks:**

- [ ] **T4.1** Locate the Mongo `.d.ts` renderer (recon during implementation; likely under `@prisma-next/family-mongo` or `@prisma-next/target-mongo`). Wire it through whatever pass `emitContractSpaceArtefacts` calls today for the SQL family. (TC-12)
- [ ] **T4.2** Verify aggregate-loader pinned-contract reads work for Mongo contracts (`readContractSpaceContract`, `readContractSpaceHeadRef`, `listContractSpaceDirectories`); these are target-agnostic but worth a smoke test against a Mongo-shaped contract.
- [ ] **T4.3** Idempotency test: rerunning `migration apply` with no contract change rewrites pinned files byte-equivalently. (TC-13)

**Validation gate:** same as Phase 1.

### Phase 5 — End-to-end test + subsystem doc

Synthetic Mongo extension fixture, e2e walk through the full pipeline, subsystem doc 10 update.

**Tasks:**

- [ ] **T5.1** Synthetic Mongo extension fixture under `test/integration/test/contract-space-fixture-mongo/` (or co-located with the existing SQL fixture if symmetry reads better). One descriptor with `contractSpace`: one collection, one index, one validator, one baseline migration, one head ref. (TC-14)
- [ ] **T5.2** E2E test: aggregate with one Mongo extension fixture + an app schema → `migration plan` produces app-space + extension-space migration dirs → `migration apply` advances both markers → `db verify` (strict) passes. (TC-14)
- [ ] **T5.3** E2E test: hand-edit the fixture-owned collection on the live DB → `db verify` fails with per-space remediation hint. (TC-15)
- [ ] **T5.4** Subsystem doc update: `docs/architecture docs/subsystems/10. MongoDB Family.md` gains a "Contract spaces" subsection covering the mechanism summary, the per-space atomicity model verbatim, and the data-transformation carve-out as a follow-up. (TC-17)
- [ ] **T5.5** Subsystem 7 cross-reference: one-liner in `docs/architecture docs/subsystems/7. Migration System.md` pointing at subsystem 10's atomicity section.
- [ ] **T5.6** `[checkpoint: high reasoning — CKPT-4]` Final self-review pass against the spec's ACs and NFRs, then PR description (walkthrough using the [`drive-pr-walkthrough`](/.claude/skills/drive-pr-walkthrough/SKILL.md) skill); PR title carries `(TML-2408)`.
  - **Before starting:** agent prompts operator: *"Reaching CKPT-4 (final self-review pre-PR). Please upgrade reasoning effort to high before I continue."* Wait for confirmation.
  - **Activity:** walk every AC (AC1–AC11), walk every NFR (NFR1–NFR5), sniff for cargo-culted SQL patterns, sniff for test theatre (tests that pass without exercising the property they claim to verify), record findings as a "self-review pass" note in the PR description, fix any holes found before raising.
  - **On completion:** agent prompts operator: *"CKPT-4 complete. PR is ready to raise. Reasoning effort can be returned to medium (or whatever default you prefer for review-cycle work)."*

**Validation gate (final):**

- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm test:integration`
- `pnpm test:e2e`
- `pnpm lint:deps`
- `pnpm build`

## Out of scope (called out so close-out doesn't accidentally absorb them)

- **Codec lifecycle hooks for Mongo.** Out of scope per the parent ticket; deferred until a Mongo extension materialises with codec-driven schema needs.
- **Per-space data-op session transactions on replica sets.** Recorded as a follow-up in the subsystem doc; no consumer requesting it.
- **Cross-space transaction support.** Architecturally unavailable for Mongo DDL; documented in the subsystem doc rather than left as a TODO.
- **TML-2397 close-out.** Independent lifecycle (parent project dir removal under `projects/extension-contract-spaces/`).
- **TML-2457 (`APP_SPACE_ID` coupling reduction).** Independent ticket; does not block or interleave with this work.

## Open Items

Carrying forward from `spec.md` § Open Questions:

1. **Schema-prune generalisation shape.** Option A (extractor callbacks) vs Option B (union duck-typing). Decide at Phase 3; record in commit message + spec amendment if the choice surprises a future reader.
2. **Mongo `.d.ts` renderer location.** Reconnaissance during Phase 4; expected to be straightforward (mirror the SQL wiring path).
3. **ADR vs subsystem-doc placement of the atomicity rule.** Default: subsystem 10 inline. Promote to ADR if PR review surfaces cross-cutting concerns.

Project-derived items needing resolution during execution:

- (none yet — this section will populate during implementation if surprises surface)
